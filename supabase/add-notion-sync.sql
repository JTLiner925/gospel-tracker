-- Notion sync
-- Paste this whole file into Supabase → SQL Editor → New query, then click Run.
-- Nothing to edit. Safe to run more than once. It never changes passcodes or saved data.
-- Run this AFTER the tracker-sync function has been deployed.

-- 1. Bookkeeping: which app record matches which Notion row --------------------
-- Only the sync function (service role) can read or write this.
create table if not exists public.notion_sync (
  kind text not null,
  app_id uuid not null,
  page_id text not null,
  snapshot jsonb not null default '{}',
  primary key (kind, app_id)
);
alter table public.notion_sync enable row level security;
revoke all on public.notion_sync from anon, authenticated;
grant all on public.notion_sync to service_role;

-- A random key the schedule uses to prove it is allowed to start a sync, and a lock so two
-- syncs never run at once.
alter table public.app_secret add column if not exists sync_key text;
alter table public.app_secret add column if not exists sync_lock timestamptz;
update public.app_secret
set sync_key = encode(extensions.gen_random_bytes(24), 'hex')
where id = 1 and sync_key is null;
grant all on public.app_secret to service_role;
grant all on public.member_pins to service_role;

-- 2. Helpers for the sync function ---------------------------------------------
-- These run with the caller's own rights, and only the service role is allowed to call them,
-- so nobody holding just the team passcode can use them.

-- Set the team or admin passcode typed into Notion.
create or replace function public.sync_set_code(p_which text, p_code text)
returns void
language plpgsql
set search_path = public, extensions
as $$
begin
  if length(coalesce(p_code, '')) < 8 then
    raise exception 'Passcode must be at least 8 characters';
  end if;
  if p_which = 'team' then
    update public.app_secret set passcode_hash = crypt(p_code, gen_salt('bf')) where id = 1;
  elsif p_which = 'admin' then
    update public.app_secret set admin_hash = crypt(p_code, gen_salt('bf')) where id = 1;
  else
    raise exception 'Unknown passcode';
  end if;
end;
$$;

-- Set one person's 6-digit passcode, or clear it when p_pin is null.
create or replace function public.sync_set_pin(p_member uuid, p_pin text)
returns void
language plpgsql
set search_path = public, extensions
as $$
begin
  if p_pin is null then
    delete from public.member_pins where member_id = p_member;
  elsif p_pin !~ '^[0-9]{6}$' then
    raise exception 'Passcode must be exactly 6 digits';
  else
    insert into public.member_pins (member_id, pin_hash)
    values (p_member, crypt(p_pin, gen_salt('bf')))
    on conflict (member_id) do update set pin_hash = excluded.pin_hash;
  end if;
end;
$$;

-- Who has a passcode (never the passcode itself).
create or replace function public.sync_pin_members()
returns setof uuid
language sql stable
set search_path = public
as $$ select member_id from public.member_pins $$;

-- Doors that are new, or changed, since they were last copied to Notion. Oldest first.
create or replace function public.sync_pending_visits(p_limit int default 300)
returns setof jsonb
language sql stable
set search_path = public
as $$
  select to_jsonb(v) || jsonb_build_object('_hash', md5(v::text), '_page', s.page_id)
  from public.visits v
  left join public.notion_sync s on s.kind = 'visits' and s.app_id = v.id
  where s.app_id is null or s.snapshot ->> 'hash' is distinct from md5(v::text)
  order by v.visited_at
  limit p_limit;
$$;

revoke execute on function public.sync_set_code(text, text) from public, anon, authenticated;
revoke execute on function public.sync_set_pin(uuid, text) from public, anon, authenticated;
revoke execute on function public.sync_pin_members() from public, anon, authenticated;
revoke execute on function public.sync_pending_visits(int) from public, anon, authenticated;
grant execute on function public.sync_set_code(text, text) to service_role;
grant execute on function public.sync_set_pin(uuid, text) to service_role;
grant execute on function public.sync_pin_members() to service_role;
grant execute on function public.sync_pending_visits(int) to service_role;

-- 3. Run the sync every 5 minutes -----------------------------------------------
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'gospel-tracker-notion-sync',
  '*/5 * * * *',
  $job$
  select net.http_post(
    url := 'https://zohiurezsbstkztxklbs.supabase.co/functions/v1/tracker-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-sync-key', (select sync_key from public.app_secret where id = 1)
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 140000
  );
  $job$
);

notify pgrst, 'reload schema';
