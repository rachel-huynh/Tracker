-- =====================================================================
--  SSP BOD Dashboard — ACCESS CONTROL ENFORCED BY THE DATABASE
--  Project: dplefzmvkqukmtnebnhd   Table: public.dashboard_store
--
--  WHY. The address + publishable key are inside the public page, and any
--  signed-in reviewer can copy them from F12. That is normal — but until now
--  the database trusted anyone holding them:
--    • anonymous visitors could READ every row (the "Sign-in required" switch
--      was only checked in the browser, AFTER the data had downloaded);
--    • any signed-in account could OVERWRITE the store, and the role list
--      lived inside the store itself, so a reviewer could make themselves admin.
--  After this file, the database decides. Copying the key gives nobody more
--  than their own login already allows.
--
--  WHO CAN DO WHAT (after this file)
--    not signed in   → read ONLY while an admin has "public view" ON; never write
--    role view       → read
--    role edit       → read + publish
--    role admin      → read + publish + manage users + public-view switch
--    signed in but NOT in dashboard_users → nothing
--
--  HOW TO RUN
--    1. Replace YOUR-ADMIN-EMAIL in section 1 with the email you sign in with.
--    2. Supabase → SQL Editor → paste this whole file → Run. Idempotent: safe
--       to run again. It fails fast (lock_timeout) instead of hanging if a
--       reviewer's tab is holding the table — just run it again.
--    3. Open the dashboard, sign in, Users tab → "Import users from old list"
--       copies your existing reviewers into the new table.
--    4. Supabase → Authentication → Sign In / Providers → Email:
--       turn OFF "Allow new users to sign up". (Not strictly needed any more —
--       an unlisted account gets nothing — but it stops strangers making accounts.)
-- =====================================================================
set lock_timeout = '5s';

-- ---------------------------------------------------------------------
-- 1.  TABLES — who is allowed in, and the public-view switch
-- ---------------------------------------------------------------------
create table if not exists public.dashboard_users (
  email       text primary key check (email = lower(email)),
  name        text,
  position    text,
  role        text not null default 'view' check (role in ('admin','edit','view')),
  updated_at  timestamptz not null default now()
);

create table if not exists public.dashboard_config (
  id           int primary key default 1 check (id = 1),
  public_view  boolean not null default false,
  updated_by   text,
  updated_at   timestamptz not null default now()
);
insert into public.dashboard_config (id) values (1) on conflict (id) do nothing;

-- First admin. Without this row nobody can manage users (on purpose: the old
-- "first person to sign in becomes admin" rule is gone).
do $$
declare v_admin text := lower(trim('projectassistant@jvcplaza.vn'));
begin
  if v_admin like '%your-admin-email%' then
    if not exists (select 1 from public.dashboard_users where role = 'admin') then
      raise exception 'Edit section 1: replace YOUR-ADMIN-EMAIL with your sign-in email, then run again.';
    end if;                      -- already set up on an earlier run → nothing to do
  else
    insert into public.dashboard_users (email, role) values (v_admin, 'admin')
      on conflict (email) do update set role = 'admin', updated_at = now();
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 2.  HELPERS — read by the policies. SECURITY DEFINER so a policy on one
--     table can look at another without granting direct access to it.
-- ---------------------------------------------------------------------
create or replace function public.dash_role() returns text
  language sql stable security definer set search_path = public as $$
  select role from public.dashboard_users
   where email = lower(coalesce(auth.jwt() ->> 'email', ''));
$$;

create or replace function public.dash_public() returns boolean
  language sql stable security definer set search_path = public as $$
  select coalesce((select public_view from public.dashboard_config where id = 1), false);
$$;

revoke all on function public.dash_role(), public.dash_public() from public;
grant execute on function public.dash_role(), public.dash_public() to anon, authenticated;

-- An admin cannot remove or demote the LAST admin (would lock everyone out).
create or replace function public.dash_keep_one_admin() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if old.role = 'admin'
     and (tg_op = 'DELETE' or new.role <> 'admin')
     and not exists (select 1 from public.dashboard_users where role = 'admin' and email <> old.email)
  then
    raise exception 'At least one admin must remain.';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
drop trigger if exists dash_keep_one_admin on public.dashboard_users;
create trigger dash_keep_one_admin before update or delete on public.dashboard_users
  for each row execute function public.dash_keep_one_admin();

-- ---------------------------------------------------------------------
-- 3.  dashboard_store — replace EVERY existing policy (whatever its name)
-- ---------------------------------------------------------------------
alter table public.dashboard_store enable row level security;

do $$
declare p record;
begin
  for p in select policyname from pg_policies
            where schemaname = 'public' and tablename = 'dashboard_store'
  loop
    execute format('drop policy %I on public.dashboard_store', p.policyname);
  end loop;
end $$;

create policy "store read: listed users"
  on public.dashboard_store for select to authenticated
  using (public.dash_role() is not null);

create policy "store read: public view"
  on public.dashboard_store for select to anon
  using (public.dash_public());

create policy "store insert: editors"
  on public.dashboard_store for insert to authenticated
  with check (public.dash_role() in ('admin','edit'));

create policy "store update: editors"
  on public.dashboard_store for update to authenticated
  using (public.dash_role() in ('admin','edit'))
  with check (public.dash_role() in ('admin','edit'));

create policy "store delete: editors, chunk rows only"
  on public.dashboard_store for delete to authenticated
  using (public.dash_role() in ('admin','edit') and id <> 'ssp');

-- ---------------------------------------------------------------------
-- 4.  dashboard_users — listed users see the list; only admins change it
-- ---------------------------------------------------------------------
alter table public.dashboard_users enable row level security;
drop policy if exists "users read"   on public.dashboard_users;
drop policy if exists "users write"  on public.dashboard_users;

create policy "users read"
  on public.dashboard_users for select to authenticated
  using (public.dash_role() is not null);

create policy "users write"
  on public.dashboard_users for all to authenticated
  using (public.dash_role() = 'admin')
  with check (public.dash_role() = 'admin');

-- ---------------------------------------------------------------------
-- 5.  dashboard_config — anyone may read the switch (the login screen needs
--     it); only an admin may flip it
-- ---------------------------------------------------------------------
alter table public.dashboard_config enable row level security;
drop policy if exists "config read"   on public.dashboard_config;
drop policy if exists "config write"  on public.dashboard_config;

create policy "config read"
  on public.dashboard_config for select to anon, authenticated
  using (true);

create policy "config write"
  on public.dashboard_config for update to authenticated
  using (public.dash_role() = 'admin')
  with check (public.dash_role() = 'admin');

grant select on public.dashboard_config to anon, authenticated;
grant update on public.dashboard_config to authenticated;
grant select, insert, update, delete on public.dashboard_users to authenticated;

-- ---------------------------------------------------------------------
-- 6.  CHECK — should list 5 store policies, 2 users, 2 config, and you as admin
-- ---------------------------------------------------------------------
select tablename, policyname, cmd, roles
  from pg_policies
 where schemaname = 'public'
   and tablename in ('dashboard_store','dashboard_users','dashboard_config')
 order by tablename, cmd, policyname;

select email, role from public.dashboard_users order by role, email;
