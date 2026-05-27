-- ════════════════════════════════════════════════════
-- DR4G0N 5P34K — Supabase Table Setup
-- Run this in Supabase → SQL Editor → New Query
-- ════════════════════════════════════════════════════

-- 1. USERS TABLE
create table if not exists users (
  id          bigserial primary key,
  uid         text unique not null,
  email       text,
  name        text,
  photo       text,
  gemini_key  text,
  sessions    int default 0,
  messages    int default 0,
  corrections int default 0,
  streak      int default 0,
  last_active timestamptz default now(),
  created_at  timestamptz default now()
);

-- 2. SESSIONS TABLE
create table if not exists sessions (
  id          bigserial primary key,
  uid         text not null,
  messages    int default 0,
  corrections int default 0,
  duration    int default 0,
  created_at  timestamptz default now()
);

-- 3. DISABLE RLS (easiest setup — anon key can read/write)
alter table users   disable row level security;
alter table sessions disable row level security;

-- Done! Your tables are ready.
