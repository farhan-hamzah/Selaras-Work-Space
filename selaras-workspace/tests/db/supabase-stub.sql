-- Stub minimal lingkungan Supabase untuk menguji migration di PGlite.
-- Meniru hal yang relevan bagi RLS: role API, auth.uid() dari klaim JWT,
-- tabel auth.users, dan default privileges Supabase pada schema public
-- (Supabase memberi ALL ke anon/authenticated/service_role untuk objek baru —
-- migration kita harus mencabutnya sendiri, dan test membuktikannya).

create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;
-- Role yang dipakai server Supabase Auth (GoTrue) saat menulis schema auth.
create role supabase_auth_admin nologin noinherit;

create schema auth;

create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Kolom yang relevan dari auth.sessions milik Supabase Auth (migration
-- 20220811173540, 20221003041400, 20221114143122, 20231027141322). Satu baris =
-- satu sesi login; Auth menghapusnya saat logout.
create type auth.aal_level as enum ('aal1', 'aal2', 'aal3');

create table auth.sessions (
  id           uuid primary key,
  user_id      uuid not null references auth.users (id) on delete cascade,
  created_at   timestamptz,
  updated_at   timestamptz,
  factor_id    uuid,
  aal          auth.aal_level,
  not_after    timestamptz,
  refreshed_at timestamp,
  user_agent   text,
  ip           inet,
  tag          text
);

-- Seperti di Supabase: hanya Auth yang menulis tabel sesi; role API tidak
-- punya hak apa pun atas tabel di schema auth.
grant usage on schema auth to supabase_auth_admin;
grant select on auth.users to supabase_auth_admin;
grant select, insert, update, delete on auth.sessions to supabase_auth_admin;

-- Sama dengan definisi auth.uid() di Supabase.
create function auth.uid() returns uuid
language sql stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

create function auth.role() returns text
language sql stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant execute on all functions in schema auth to anon, authenticated, service_role;

grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
