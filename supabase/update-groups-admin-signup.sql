-- Groups, admin lock and sign-up
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

-- A team member or a place can be in any number of groups.
alter table public.team_members add column if not exists group_ids uuid[] not null default '{}';
alter table public.complexes add column if not exists group_ids uuid[] not null default '{}';

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

-- 4. Sign-up: each person has their own 6-digit passcode -----------------------
-- Stored hashed in its own table that nobody can read through the API.
create table if not exists public.member_pins (
  member_id uuid primary key references public.team_members(id) on delete cascade,
  pin_hash text not null
);
alter table public.member_pins enable row level security;
revoke all on public.member_pins from anon, authenticated;

-- Lets the app know this update has been run.
create or replace function public.app_version()
returns int language sql immutable as $$ select 2 $$;

-- Sign up: needs the team passcode. Adds the person to the team with their groups.
create or replace function public.sign_up(p_name text, p_pin text, p_groups uuid[])
returns uuid
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  clean text := btrim(coalesce(p_name, ''));
  new_id uuid;
begin
  if not public.has_team_code() then
    raise exception 'Wrong team passcode';
  end if;
  if clean = '' then
    raise exception 'Enter your name';
  end if;
  if coalesce(p_pin, '') !~ '^[0-9]{6}$' then
    raise exception 'Your passcode must be exactly 6 digits';
  end if;
  if exists (select 1 from public.team_members t where lower(t.name) = lower(clean)) then
    raise exception 'That name is already on the team. Sign in instead, or add your last name.';
  end if;

  insert into public.team_members (name, group_ids)
  values (clean, coalesce(
    (select array_agg(g.id) from public.groups g where g.active and g.id = any(coalesce(p_groups, '{}'))),
    '{}'))
  returning id into new_id;

  insert into public.member_pins (member_id, pin_hash)
  values (new_id, crypt(p_pin, gen_salt('bf')));
  return new_id;
end;
$$;

-- Sign in on a new phone. Someone a leader added sets their passcode the first time.
create or replace function public.sign_in(p_name text, p_pin text)
returns uuid
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  found_id uuid;
  saved_hash text;
begin
  if not public.has_team_code() then
    raise exception 'Wrong team passcode';
  end if;
  if coalesce(p_pin, '') !~ '^[0-9]{6}$' then
    raise exception 'Your passcode must be exactly 6 digits';
  end if;

  select t.id into found_id
  from public.team_members t
  where t.active and lower(t.name) = lower(btrim(coalesce(p_name, '')))
  order by t.created_at
  limit 1;
  if found_id is null then
    raise exception 'No one by that name. Check the list or sign up.';
  end if;

  select p.pin_hash into saved_hash from public.member_pins p where p.member_id = found_id;
  if saved_hash is null then
    insert into public.member_pins (member_id, pin_hash)
    values (found_id, crypt(p_pin, gen_salt('bf')));
  elsif saved_hash <> crypt(p_pin, saved_hash) then
    raise exception 'Wrong passcode';
  end if;
  return found_id;
end;
$$;

-- Admins can clear a forgotten passcode; the person's next sign-in sets a new one.
create or replace function public.reset_pin(p_member uuid)
returns void
language plpgsql security definer
set search_path = public, extensions
as $$
begin
  if not public.has_admin_code() then
    raise exception 'Only an admin can reset a passcode';
  end if;
  delete from public.member_pins where member_id = p_member;
end;
$$;

grant execute on function public.app_version() to anon;
grant execute on function public.sign_up(text, text, uuid[]) to anon;
grant execute on function public.sign_in(text, text) to anon;
grant execute on function public.reset_pin(uuid) to anon;

notify pgrst, 'reload schema';
