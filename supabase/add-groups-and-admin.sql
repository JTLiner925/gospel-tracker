-- Groups + admin lock
-- Paste this whole file into Supabase → SQL Editor → New query.
-- BEFORE running: change CHANGE-ME-admin-passcode (below) to your admin passcode, 8+ characters.
-- Safe to run more than once. It never changes the team passcode or any saved data.

-- 1. Admin passcode (stored hashed, next to the team passcode) -----------------
alter table public.app_secret add column if not exists admin_hash text;

update public.app_secret
set admin_hash = extensions.crypt('CHANGE-ME-admin-passcode', extensions.gen_salt('bf'))
where id = 1 and admin_hash is null;

-- True when the request carries both the team passcode and the admin passcode.
create or replace function public.has_admin_code()
returns boolean
language sql stable security definer
set search_path = public, extensions
as $$
  select public.has_team_code() and exists (
    select 1 from public.app_secret
    where admin_hash = crypt(
      coalesce(current_setting('request.headers', true)::json ->> 'x-admin-code', ''),
      admin_hash)
  );
$$;

-- Only admins can change either passcode.
create or replace function public.change_team_code(new_code text)
returns void
language plpgsql security definer
set search_path = public, extensions
as $$
begin
  if not public.has_admin_code() then
    raise exception 'Only an admin can change the team passcode';
  end if;
  if length(coalesce(new_code, '')) < 8 then
    raise exception 'Passcode must be at least 8 characters';
  end if;
  update public.app_secret set passcode_hash = crypt(new_code, gen_salt('bf')) where id = 1;
end;
$$;

create or replace function public.change_admin_code(new_code text)
returns void
language plpgsql security definer
set search_path = public, extensions
as $$
begin
  if not public.has_admin_code() then
    raise exception 'Only an admin can change the admin passcode';
  end if;
  if length(coalesce(new_code, '')) < 8 then
    raise exception 'Passcode must be at least 8 characters';
  end if;
  update public.app_secret set admin_hash = crypt(new_code, gen_salt('bf')) where id = 1;
end;
$$;

grant execute on function public.has_admin_code() to anon;
grant execute on function public.change_admin_code(text) to anon;

-- 2. Groups --------------------------------------------------------------------
create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- A team member can be in any number of groups.
alter table public.team_members add column if not exists group_ids uuid[] not null default '{}';

-- 3. Everyone on the team can read these lists; only admins can change them ---
do $$
declare t text;
begin
  foreach t in array array['team_members','complexes','groups'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists team_access on public.%I', t);
    execute format('drop policy if exists team_read on public.%I', t);
    execute format('drop policy if exists admin_insert on public.%I', t);
    execute format('drop policy if exists admin_update on public.%I', t);
    execute format('drop policy if exists admin_delete on public.%I', t);
    execute format(
      'create policy team_read on public.%I for select to anon, authenticated
         using ((select public.has_team_code()))', t);
    execute format(
      'create policy admin_insert on public.%I for insert to anon, authenticated
         with check ((select public.has_admin_code()))', t);
    execute format(
      'create policy admin_update on public.%I for update to anon, authenticated
         using ((select public.has_admin_code()))
         with check ((select public.has_admin_code()))', t);
    execute format(
      'create policy admin_delete on public.%I for delete to anon, authenticated
         using ((select public.has_admin_code()))', t);
    execute format('grant select, insert, update, delete on public.%I to anon', t);
  end loop;
end $$;

notify pgrst, 'reload schema';
