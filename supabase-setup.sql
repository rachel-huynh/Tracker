-- =====================================================================
--  SSP BOD Dashboard — Supabase setup / repair
--  Project: dplefzmvkqukmtnebnhd   Table: public.dashboard_store   Row: 'ssp'
--
--  Fixes, in order of what you hit:
--    Connection terminated / upstream request timeout       → STEP 0
--    42P01 relation "public.dashboard_store" does not exist  → section A
--    TypeError: Failed to fetch (payload 13.1 MB)            → STEP 1
--    canceling statement ... statement timeout [57014]       → section C
--
--  "Failed to fetch" is a TRANSPORT failure — the request never reached
--  Postgres, so there is no SQLSTATE and nothing in the Supabase logs. The
--  body was simply too big. 57014 = query_canceled, the write running past
--  statement_timeout. Neither is a permissions problem — RLS says 42501.
--
--  HOW TO RUN. The editor gave "Connection terminated due to connection
--  timeout" when the whole file was run in one go — so do not. Highlight
--  ONE section and press Run. Every statement is idempotent, so re-running
--  a section is always safe.
--
--  If you only run one thing, run STEP 1 below: it is what the app needs
--  today and it finishes in milliseconds. Everything after it is optional.
--
--  Why a whole-file run can hang: the DDL sections take a lock on
--  dashboard_store, and the app, a reviewer's open tab or Realtime can be
--  holding that table at the time. The session settings on the next line
--  make that fail FAST with a readable error instead of sitting on the
--  connection until the editor gives up.
-- =====================================================================

-- ---------------------------------------------------------------------
-- STEP 0.  IS THE TABLE STUCK?  ***check this FIRST***
--
--     Symptom: the SQL editor says "Connection terminated due to connection
--     timeout", the app says "upstream request timeout", and even a one-row
--     SELECT on dashboard_store never comes back — while the REST endpoint
--     itself answers instantly. That combination means the API is healthy
--     and something is SITTING ON THE TABLE.
--
--     Usual cause: an editor run that was cut off mid-statement. The tab
--     closed, the backend did not, and it is still holding the lock that
--     CREATE POLICY / ALTER TABLE takes — which blocks even plain reads.
--
--     Neither query below touches dashboard_store, so they answer even
--     while it is locked. Run them in a NEW editor tab.
-- ---------------------------------------------------------------------
-- 0a. who is running what, longest first
select pid,
       state,
       wait_event_type,
       now() - query_start as running_for,
       left(regexp_replace(query, E'[
 ]+', ' ', 'g'), 90) as query
  from pg_stat_activity
 where datname = current_database()
   and pid <> pg_backend_pid()
   and state <> 'idle'
 order by query_start;

-- 0b. anything actually BLOCKED, and who is blocking it
select w.pid as blocked_pid, l.pid as blocking_pid,
       now() - w.query_start as blocked_for,
       left(regexp_replace(w.query, E'[
 ]+', ' ', 'g'), 60) as blocked_query
  from pg_stat_activity w
  cross join lateral unnest(pg_blocking_pids(w.pid)) as l(pid)
 where w.datname = current_database();

-- 0c. THEN terminate the blocker by pid (put the real number in):
--     select pg_terminate_backend(12345);
--
--     Or, simplest and always safe: Supabase dashboard →
--     Project Settings → General → Restart project. That clears every
--     stuck session in one go. Wait for it to come back, then run STEP 1.


-- Run this line with whichever section you are running.
set lock_timeout = '5s';        -- do not queue behind another lock
set statement_timeout = '60s';  -- and never sit on the connection


-- ---------------------------------------------------------------------
-- STEP 1.  WHAT THE APP NEEDS TODAY  ***run this one***
--          Adds the last missing column and the policy that lets the app
--          tidy up its own leftover parts. Milliseconds, no table rewrite.
-- ---------------------------------------------------------------------
alter table public.dashboard_store add column if not exists data_gz     text;
alter table public.dashboard_store add column if not exists data_enc    text;
alter table public.dashboard_store add column if not exists data_bytes  bigint;
alter table public.dashboard_store add column if not exists data_chunks int;

drop policy if exists "dashboard_store delete" on public.dashboard_store;
create policy "dashboard_store delete"
  on public.dashboard_store for delete
  to authenticated
  using (id <> 'ssp');          -- the main row can never be deleted from the app

do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema='public' and table_name='dashboard_store'
                and column_name='data' and is_nullable='NO')
  then alter table public.dashboard_store alter column data drop not null;
  end if;
end $$;
-- STEP 1 ends here. Publish from the app now; the rest of this file is
-- optional tuning and diagnostics.


-- ---------------------------------------------------------------------
-- A.  THE TABLE ITSELF — create it if it is not there
--
--     42P01 "relation public.dashboard_store does not exist" means this
--     project has no table yet. Two ways to land here: a brand-new project,
--     or the SQL editor is open on the WRONG project. Check the project ref
--     in the browser URL against the one at the top of this file before
--     going further — creating the table in the wrong project will look
--     like it worked and the app still will not publish.
--
--     Idempotent: safe whether the table is missing, partial, or complete.
-- ---------------------------------------------------------------------
create table if not exists public.dashboard_store (
  id          text primary key,
  data        jsonb,
  updated_by  text,
  updated_at  timestamptz default now(),
  client_id   text
);

-- columns an older copy of the table may predate (the app writes all of these)
alter table public.dashboard_store add column if not exists data       jsonb;
alter table public.dashboard_store add column if not exists updated_by text;
alter table public.dashboard_store add column if not exists updated_at timestamptz default now();
alter table public.dashboard_store add column if not exists client_id  text;

-- Supabase's default privileges usually cover this, but a table created from
-- the SQL editor does not always inherit them. RLS below still decides who
-- may actually see or change a row; these grants only open the door.
grant select                         on public.dashboard_store to anon, authenticated;
grant insert, update, delete         on public.dashboard_store to authenticated;


-- ---------------------------------------------------------------------
-- B.  BEFORE — what you have right now (read-only, changes nothing)
-- ---------------------------------------------------------------------
select current_database() as database, current_user as run_as;

select rolname, rolconfig
  from pg_roles
 where rolname in ('anon','authenticated','service_role');

select id,
       pg_size_pretty(pg_column_size(data)::bigint)                as data_column,
       pg_size_pretty(pg_total_relation_size('public.dashboard_store')) as table_total,
       updated_by, updated_at
  from public.dashboard_store
 where id = 'ssp';

select policyname, cmd, roles
  from pg_policies
 where schemaname = 'public' and tablename = 'dashboard_store'
 order by cmd, policyname;


-- ---------------------------------------------------------------------
-- C.  RAISE THE SERVER-SIDE STATEMENT TIMEOUT
--     Supabase ships ~8s for `authenticated`. Parsing 8 MB of JSON into
--     jsonb and TOASTing it does not fit. This alone unblocks publishing,
--     with no change to the app.
-- ---------------------------------------------------------------------
alter role authenticated set statement_timeout = '120s';
alter role anon          set statement_timeout = '120s';   -- anonymous reviewers read the same row

-- make PostgREST pick the new settings up without waiting for a redeploy
notify pgrst, 'reload config';


-- ---------------------------------------------------------------------
-- D.  ROW-LEVEL SECURITY — confirm, do not assume
--     Your policies were never the problem, but this makes the intended
--     state explicit: everyone may READ the single shared row, only a
--     signed-in user may WRITE it.
--     NOTE: policy names below are mine. If section 0 listed policies under
--     DIFFERENT names that do the same thing, drop those instead of adding
--     these, or you will end up with two permissive policies (harmless, but
--     confusing later).
-- ---------------------------------------------------------------------
alter table public.dashboard_store enable row level security;

drop policy if exists "dashboard_store read"   on public.dashboard_store;
create policy "dashboard_store read"
  on public.dashboard_store for select
  to anon, authenticated
  using (true);

drop policy if exists "dashboard_store insert" on public.dashboard_store;
create policy "dashboard_store insert"
  on public.dashboard_store for insert
  to authenticated
  with check (true);

drop policy if exists "dashboard_store update" on public.dashboard_store;
create policy "dashboard_store update"
  on public.dashboard_store for update
  to authenticated
  using (true) with check (true);


-- ---------------------------------------------------------------------
-- E.  REALTIME — make sure the table publishes changes at all
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename  = 'dashboard_store')
  then
    alter publication supabase_realtime add table public.dashboard_store;
  end if;
end $$;


-- ---------------------------------------------------------------------
-- F.  SCHEMA FOR THE COMPRESSED PAYLOAD (same statements as STEP 1,
--     kept here with the reasoning; running either one is enough)
--
--     Adds a text column for a gzip+base64 payload, plus a part counter for
--     payloads too big for one request. Storing text skips the server-side
--     JSON parse entirely and compression cuts the transfer; 13.1 MB of raw
--     JSON lands around 4 MB, and anything over ~3 MB is split across rows.
--
--     The app writes these columns as of 21 Sep 2026. Until this section has
--     been run it detects the missing columns and falls back to the old
--     uncompressed write — which is exactly what was failing at 13.1 MB.
--
--     Everything here is idempotent and nullable; `data` is made nullable so
--     a gz-only row can be written without a dummy JSON value.
-- ---------------------------------------------------------------------
alter table public.dashboard_store add column if not exists data_gz    text;   -- gzip, base64
alter table public.dashboard_store add column if not exists data_enc   text;   -- e.g. 'gzip+base64'
alter table public.dashboard_store add column if not exists data_bytes bigint; -- uncompressed size, for diagnostics
alter table public.dashboard_store add column if not exists data_chunks int;    -- parts, when split

-- The app splits a payload larger than ~3 MB of base64 across sibling rows
-- ssp#0, ssp#1, ... and leaves only a pointer (data_chunks) in row 'ssp'.
-- The read/insert/update policies above are table-wide, so those rows need no
-- extra grants. This DELETE policy is only so a publish that needs FEWER parts
-- than the last one can tidy up the leftovers; without it they linger harmlessly
-- (the reader takes exactly data_chunks of them and ignores the rest).
drop policy if exists "dashboard_store delete" on public.dashboard_store;
create policy "dashboard_store delete"
  on public.dashboard_store for delete
  to authenticated
  using (id <> 'ssp');          -- the main row can never be deleted from the app

do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema='public' and table_name='dashboard_store'
                and column_name='data' and is_nullable='NO')
  then
    alter table public.dashboard_store alter column data drop not null;
  end if;
end $$;


-- ---------------------------------------------------------------------
-- G.  KEEP REALTIME MESSAGES SMALL   ***the one most likely to block***
--
--     ALTER PUBLICATION takes a lock on the table. If the app, a reviewer's
--     open tab or Realtime itself is holding it, this statement waits — and
--     waiting on a whole-file run is what ends as "Connection terminated".
--     With the lock_timeout at the top it now fails in 5s with "canceling
--     statement due to lock timeout" instead. If that happens: close the
--     dashboard tabs and run this section again on its own.
--
--     Supabase Realtime caps a record at ~1 MB. On a multi-MB row the whole
--     change message is dropped, which is why reviewers stopped auto-
--     refreshing — silently, with no error anywhere.
--
--     SAFE TO RUN. The app handler no longer reads the store out of the
--     payload: it treats the event as a doorbell and re-fetches. Publishing
--     only the small columns keeps the message well under the cap, so the
--     row can grow without ever breaking live updates again.
--
--     The column list must keep `client_id` — the handler uses it to ignore
--     the echo of its own write instead of pulling the whole store back for
--     nothing.
--
--     DROP + ADD, never `set table`: `alter publication ... set table X`
--     replaces the publication's ENTIRE table list with X, silently taking
--     every other table in the project off realtime. Column lists need
--     PostgreSQL 15, so on an older project this step is skipped and
--     realtime simply carries the whole row as before.
-- ---------------------------------------------------------------------
do $$
begin
  if current_setting('server_version_num')::int >= 150000 then
    if exists (select 1 from pg_publication_tables
                where pubname='supabase_realtime'
                  and schemaname='public' and tablename='dashboard_store')
    then execute 'alter publication supabase_realtime drop table public.dashboard_store';
    end if;
    execute 'alter publication supabase_realtime add table public.dashboard_store '
         || '(id, updated_by, updated_at, client_id)';
  else
    raise notice 'PostgreSQL % — column lists need 15+, realtime left carrying the full row',
                 current_setting('server_version');
  end if;
end $$;


-- ---------------------------------------------------------------------
-- H.  AFTER — confirm everything took
-- ---------------------------------------------------------------------
select rolname, rolconfig
  from pg_roles
 where rolname in ('anon','authenticated');

-- the table now has every column the app writes
select column_name, data_type
  from information_schema.columns
 where table_schema='public' and table_name='dashboard_store'
 order by ordinal_position;

-- What is actually stored (empty until the first Publish).
-- pg_column_size, NOT length(): length() has to DETOAST and decompress the
-- whole value, so on a row holding megabytes this one SELECT is slow enough
-- to be what times the editor out. pg_column_size reads the stored size.
select id,
       data is not null                                    as has_plain_json,
       pg_size_pretty(pg_column_size(data_gz)::bigint)     as gz_stored,
       data_enc, data_chunks,
       pg_size_pretty(coalesce(data_bytes,0)::bigint)      as uncompressed,
       updated_by, updated_at
  from public.dashboard_store
 order by id;
