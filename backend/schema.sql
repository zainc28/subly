-- ============================================================
-- Subly — Supabase schema
-- Run this in the Supabase SQL Editor (project → SQL Editor → New query)
-- ============================================================

-- ── Enable UUID extension ────────────────────────────────────────────────────
create extension if not exists "uuid-ossp";

-- ── users (mirrors auth.users, auto-populated via trigger) ──────────────────

create table if not exists public.users (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text,
  tier        text not null default 'free' check (tier in ('free', 'pro')),
  minutes_used_today integer not null default 0,
  minutes_limit      integer not null default 30,
  last_usage_date    date,
  created_at  timestamptz not null default now()
);

alter table public.users enable row level security;

-- Users can only read/update their own row
create policy "users: select own" on public.users
  for select using (auth.uid() = id);

create policy "users: update own" on public.users
  for update using (auth.uid() = id);

-- ── Auto-create users row on signup ─────────────────────────────────────────

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.users (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ── user_dictionaries ────────────────────────────────────────────────────────

create table if not exists public.user_dictionaries (
  id                uuid primary key default uuid_generate_v4(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  word              text not null,
  transliteration   text not null default '',
  translation       text not null,
  context_sentence  text not null default '',
  source_language   text not null default 'unknown',
  video_url         text not null default '',
  created_at        timestamptz not null default now()
);

create index if not exists user_dictionaries_user_id_idx on public.user_dictionaries(user_id);
create index if not exists user_dictionaries_word_idx     on public.user_dictionaries(user_id, word);

alter table public.user_dictionaries enable row level security;

-- Users can only access their own saved words
create policy "dictionaries: select own" on public.user_dictionaries
  for select using (auth.uid() = user_id);

create policy "dictionaries: insert own" on public.user_dictionaries
  for insert with check (auth.uid() = user_id);

create policy "dictionaries: delete own" on public.user_dictionaries
  for delete using (auth.uid() = user_id);

-- ── increment_usage RPC ──────────────────────────────────────────────────────
-- Call this from the backend to track minutes consumed.

create or replace function public.increment_usage(user_id_param uuid, minutes_param integer)
returns void
language plpgsql
security definer
as $$
declare
  today date := current_date;
begin
  update public.users
  set
    minutes_used_today = case
      when last_usage_date = today then minutes_used_today + minutes_param
      else minutes_param
    end,
    last_usage_date = today
  where id = user_id_param;
end;
$$;
