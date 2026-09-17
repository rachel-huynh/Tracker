-- =====================================================================
--  SSP BOD Dashboard — Supabase setup / repair
--  Project: dplefzmvkqukmtnebnhd   Table: public.dashboard_store   Row: 'ssp'
--
--  Fixes: Publish failed — canceling statement due to statement timeout
--         [SQLSTATE 57014] (payload 8.1 MB)
--
--  57014 = query_canceled: the write ran past statement_timeout. This is NOT
--  a permissions problem — an RLS rejection is 42501, never 57014.
--
--  Run the whole file in the Supabase SQL editor. Every statement is
--  idempotent, so it is safe to re-run.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 0.  BEFORE — what you have right now (read-only, changes nothing)
-- ---------------------------------------------------------------------
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
-- 1.  THE ACTUAL FIX — raise the statement timeout
--     Supabase ships ~8s for `authenticated`. Parsing 8 MB of JSON into
--     jsonb and TOASTing it does not fit. This alone unblocks publishing,
--     with no change to the app.
-- ---------------------------------------------------------------------
alter role authenticated set statement_timeout = '120s';
alter role anon          set statement_timeout = '120s';   -- anonymous reviewers read the same row

-- make PostgREST pick the new settings up without waiting for a redeploy
notify pgrst, 'reload config';


-- ---------------------------------------------------------------------
-- 2.  ROW-LEVEL SECURITY — confirm, do not assume
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
-- 3.  REALTIME — make sure the table actually publishes changes
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
-- 4.  SCHEMA FOR THE COMPRESSED PAYLOAD  ***OPTIONAL — see note***
--
--     Adds a text column for a gzip+base64 payload. Storing text skips the
--     server-side JSON parse entirely, and compression cuts the transfer;
--     8.1 MB lands around 2-3 MB.
--
--     *** These columns do NOTHING until the app is changed to write them. ***
--     Running this section is harmless either way — it only adds nullable
--     columns. `data` is made nullable so a future gz-only row can be
--     written without a dummy JSON value.
-- ---------------------------------------------------------------------
alter table public.dashboard_store add column if not exists data_gz    text;   -- gzip, base64
alter table public.dashboard_store add column if not exists data_enc   text;   -- e.g. 'gzip+base64'
alter table public.dashboard_store add column if not exists data_bytes bigint; -- uncompressed size, for diagnostics

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
-- 5.  KEEP REALTIME MESSAGES SMALL  ***OPTIONAL — needs an app change***
--
--     Supabase Realtime caps a record at ~1 MB. On an 8 MB row the whole
--     change message is dropped, which is why reviewers stopped auto-
--     refreshing — silently, with no error anywhere.
--
--     SAFE TO RUN NOW. The app handler no longer reads the store out of the
--     payload: it treats the event as a doorbell and re-fetches. Publishing
--     only the small columns keeps the message well under the cap, so the
--     row can grow without ever breaking live updates again.
--
--     The column list must keep `client_id` — the handler uses it to ignore
--     the echo of its own write instead of pulling 8 MB back for nothing.
-- ---------------------------------------------------------------------
alter publication supabase_realtime
  set table public.dashboard_store (id, updated_by, updated_at, client_id);


-- ---------------------------------------------------------------------
-- 6.  AFTER — confirm the timeout took
-- ---------------------------------------------------------------------
select rolname, rolconfig
  from pg_roles
 where rolname in ('anon','authenticated');
