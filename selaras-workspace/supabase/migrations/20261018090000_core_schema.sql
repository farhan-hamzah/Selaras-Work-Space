-- =============================================================================
-- Fase 0 — Skema inti IT Selaras Workspace (SRS Bagian 6)
--
-- Seluruh tabel & enum dibuat sekaligus (Implementation Plan, Fase 0 tugas 5).
-- Kontrol akses (RLS, grant kolom, guard trigger) ada di migration berikutnya:
--   20261018090100_access_control.sql
-- Audit log (trigger pencatatan atomik, append-only) ada di:
--   20261018090200_audit_log.sql
-- =============================================================================

-- Schema untuk helper internal. TIDAK diekspos lewat Data API (PostgREST hanya
-- mengekspos schema "public" & "graphql_public" — lihat supabase/config.toml).
create schema if not exists private;

-- -----------------------------------------------------------------------------
-- Enum (SRS 6.4) — role global (profiles.role) sengaja TEXT + CHECK, bukan enum
-- -----------------------------------------------------------------------------
create type public.project_status as enum ('planning', 'active', 'on_hold', 'completed', 'cancelled');
create type public.priority_level as enum ('low', 'medium', 'high', 'critical');
create type public.project_member_role as enum ('owner', 'member', 'viewer');
create type public.task_status as enum ('todo', 'in_progress', 'review', 'done', 'cancelled');

-- -----------------------------------------------------------------------------
-- profiles — 1:1 dengan auth.users, menyimpan role GLOBAL & status aktif
-- -----------------------------------------------------------------------------
create table public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  full_name     varchar(255) not null,
  display_name  varchar(100),
  avatar_url    text,
  role          text not null default 'staff' check (role in ('admin', 'staff')),
  is_active     boolean not null default true,
  last_login_at timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on column public.profiles.role is 'Role GLOBAL (D4: admin selalu menang). Hanya bisa diubah lewat public.admin_set_user_role().';
comment on column public.profiles.is_active is 'Dicek di setiap request (NFR-SEC-06) DAN di setiap policy RLS. Hanya bisa diubah lewat public.admin_set_user_active().';

-- -----------------------------------------------------------------------------
-- projects
-- -----------------------------------------------------------------------------
create table public.projects (
  id          uuid primary key default gen_random_uuid(),
  name        varchar(255) not null check (length(btrim(name)) > 0),
  description text,
  status      public.project_status not null default 'planning',
  priority    public.priority_level not null default 'medium',
  -- RESTRICT: pengguna yang pernah membuat project dinonaktifkan, bukan dihapus.
  created_by  uuid not null references public.profiles (id) on delete restrict,
  start_date  date,
  due_date    date,
  deleted_at  timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint projects_dates_check check (start_date is null or due_date is null or due_date >= start_date)
);

-- -----------------------------------------------------------------------------
-- project_members — role PER-PROJECT (D3)
-- -----------------------------------------------------------------------------
create table public.project_members (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  role       public.project_member_role not null default 'member',
  joined_at  timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_members_project_user_key unique (project_id, user_id)
);

-- -----------------------------------------------------------------------------
-- tasks
-- -----------------------------------------------------------------------------
create table public.tasks (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects (id) on delete cascade,
  title        varchar(500) not null check (length(btrim(title)) > 0),
  description  text,
  status       public.task_status not null default 'todo',
  priority     public.priority_level not null default 'medium',
  assignee_id  uuid references public.profiles (id) on delete set null,  -- D2: boleh edit (selama masih owner/member)
  created_by   uuid not null references public.profiles (id) on delete restrict, -- D2: boleh edit (selama masih owner/member)
  due_date     date,
  completed_at timestamptz,  -- diisi otomatis oleh trigger saat status = 'done'
  deleted_at   timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- activity_logs — append-only (FR-LOG-04). Mekanisme penulisan: lihat
-- 20261018090200_audit_log.sql.
-- user_id sengaja TANPA foreign key: log adalah catatan sejarah dan harus tetap
-- menyimpan ID pelaku walaupun akun pelaku kelak dihapus (ON DELETE SET NULL
-- akan menghapus jejak pelaku sekaligus membutuhkan UPDATE pada tabel log).
-- -----------------------------------------------------------------------------
create table public.activity_logs (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid,
  action        text not null check (action ~ '^[A-Z][A-Z_]*$'),
  resource_type text not null,
  resource_id   uuid,
  description   text not null,
  metadata      jsonb not null default '{}'::jsonb,
  ip_address    inet,
  user_agent    text,
  -- clock_timestamp(): waktu kejadian sebenarnya; now() akan sama untuk semua
  -- entri dalam satu transaksi sehingga urutan log tidak bisa dibedakan.
  created_at    timestamptz not null default clock_timestamp()
);

-- -----------------------------------------------------------------------------
-- Index (SRS 6.6) + index foreign key yang sering dipakai join/filter
-- -----------------------------------------------------------------------------
create index idx_tasks_project_id on public.tasks (project_id) where deleted_at is null;
create index idx_tasks_assignee_id on public.tasks (assignee_id) where deleted_at is null;
create index idx_tasks_status on public.tasks (status) where deleted_at is null;
create index idx_tasks_created_by on public.tasks (created_by);
create index idx_projects_created_by on public.projects (created_by);
create index idx_project_members_user on public.project_members (user_id);
create index idx_activity_logs_user_id on public.activity_logs (user_id);
create index idx_activity_logs_created on public.activity_logs (created_at desc);
create index idx_activity_logs_resource on public.activity_logs (resource_type, resource_id);

-- -----------------------------------------------------------------------------
-- updated_at otomatis (NFR-REL-01)
-- -----------------------------------------------------------------------------
create function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger set_updated_at before update on public.profiles
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.projects
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.project_members
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.tasks
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- handle_new_user(): buat profile untuk setiap user baru di auth.users.
-- Role SELALU 'staff' — tidak pernah diambil dari user_metadata, karena metadata
-- bisa diisi sendiri oleh pengguna saat sign-up.
-- -----------------------------------------------------------------------------
create function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, display_name)
  values (
    new.id,
    left(coalesce(
      nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
      nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
      'Pengguna'
    ), 255),
    left(nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''), 100)
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();
