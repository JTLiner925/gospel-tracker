-- Gospel Tracker database setup
-- Paste this whole file into Supabase → SQL Editor → New query, then click Run.
-- BEFORE running: change the team passcode on the last line of section 1,
-- and the admin passcode (CHANGE-ME-admin-passcode) in section 4.

create extension if not exists pgcrypto with schema extensions;

-- 1. Team passcode ------------------------------------------------------------
-- The passcode is stored hashed. Nobody can read this table through the API.
create table if not exists public.app_secret (
  id int primary key default 1 check (id = 1),
  passcode_hash text not null
);
alter table public.app_secret enable row level security;
revoke all on public.app_secret from anon, authenticated;

insert into public.app_secret (passcode_hash)
values (extensions.crypt('CHANGE-ME-to-a-long-phrase', extensions.gen_salt('bf')))
on conflict (id) do nothing;

-- True when the request carries the right passcode in the x-team-code header.
create or replace function public.has_team_code()
returns boolean
language sql stable security definer
set search_path = public, extensions
as $$
  select exists (
    select 1 from public.app_secret
    where passcode_hash = crypt(
      coalesce(current_setting('request.headers', true)::json ->> 'x-team-code', ''),
      passcode_hash)
  );
$$;

create or replace function public.change_team_code(new_code text)
returns void
language plpgsql security definer
set search_path = public, extensions
as $$
begin
  if not public.has_team_code() then
    raise exception 'Not authorized';
  end if;
  if length(coalesce(new_code, '')) < 8 then
    raise exception 'Passcode must be at least 8 characters';
  end if;
  update public.app_secret set passcode_hash = crypt(new_code, gen_salt('bf')) where id = 1;
end;
$$;

grant execute on function public.has_team_code() to anon;
grant execute on function public.change_team_code(text) to anon;

-- 2. Tables -------------------------------------------------------------------
create table if not exists public.team_members (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.complexes (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null default 'apartments' check (kind in ('apartments','neighborhood')),
  address text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
-- For databases created before neighborhoods were added:
alter table public.complexes add column if not exists kind text not null default 'apartments';

create table if not exists public.people (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  complex_id uuid references public.complexes(id) on delete set null,
  building text,
  unit text,
  household text,
  prayer_request text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One row per door knocked. Conversation details are filled when outcome = 'conversation'.
create table if not exists public.visits (
  id uuid primary key default gen_random_uuid(),
  visited_at timestamptz not null default now(),
  complex_id uuid references public.complexes(id) on delete set null,
  building text,
  unit text,
  fisher_ids uuid[] not null default '{}',
  outcome text not null check (outcome in ('conversation','no_answer','not_interested','come_back','skip')),
  person_id uuid references public.people(id) on delete set null,
  shared text[] not null default '{}',
  light text check (light in ('green','yellow','red','believer')),
  response text check (response in ('accepted','interested','rejected')),
  notes text,
  lat double precision,
  lng double precision,
  accuracy real,
  created_at timestamptz not null default now()
);
-- For databases created before the map was added:
alter table public.visits add column if not exists lat double precision;
alter table public.visits add column if not exists lng double precision;
alter table public.visits add column if not exists accuracy real;
-- For databases created before the Believer option was added:
alter table public.visits drop constraint if exists visits_light_check;
alter table public.visits add constraint visits_light_check check (light in ('green','yellow','red','believer'));

create table if not exists public.follow_ups (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.people(id) on delete cascade,
  visit_id uuid references public.visits(id) on delete set null,
  kinds text[] not null default '{}',
  assigned_to uuid references public.team_members(id) on delete set null,
  due_date date,
  notes text,
  done boolean not null default false,
  done_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists visits_complex_idx on public.visits (complex_id, visited_at desc);
create index if not exists visits_person_idx on public.visits (person_id);
create index if not exists visits_time_idx on public.visits (visited_at desc);
create index if not exists follow_ups_open_idx on public.follow_ups (done, due_date);
create index if not exists people_unit_idx on public.people (complex_id, building, unit);

-- 3. Lock every table behind the passcode ------------------------------------
do $$
declare t text;
begin
  foreach t in array array['people','visits','follow_ups'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists team_access on public.%I', t);
    execute format(
      'create policy team_access on public.%I for all to anon, authenticated
         using ((select public.has_team_code()))
         with check ((select public.has_team_code()))', t);
    execute format('grant select, insert, update, delete on public.%I to anon', t);
  end loop;
end $$;

-- 4. Admin passcode (stored hashed, next to the team passcode) -----------------
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

-- 5. Groups --------------------------------------------------------------------
create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- A team member can be in any number of groups.
alter table public.team_members add column if not exists group_ids uuid[] not null default '{}';

-- 6. Everyone on the team can read these lists; only admins can change them ---
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
