-- =============================================================================
-- Revisi review Fase 0, poin 1 — celah perubahan role per-project lewat
-- "keluarkan lalu tambahkan lagi".
--
-- Masalah: owner boleh mengeluarkan member/viewer dan boleh menambah
-- member/viewer. Digabung, owner bisa mengeluarkan Viewer lalu memasukkannya
-- lagi sebagai Member (atau sebaliknya). Hasilnya sama dengan mengubah role
-- per-project, yang seharusnya khusus Admin (FR-ADM-04, aturan turunan a).
--
-- Perbaikan:
--   * Role terakhir setiap pengguna yang dikeluarkan dari project disimpan di
--     private.project_member_removals (trigger AFTER DELETE, tidak bisa
--     dilewati role API mana pun).
--   * Saat non-Admin menambahkan kembali pengguna tersebut, role-nya harus sama
--     dengan role terakhirnya. Role berbeda = perubahan role = hanya Admin.
--   * Menambahkan pengguna yang belum pernah menjadi anggota project tidak
--     terpengaruh.
-- Tabel riwayat ada di schema private (tidak diekspos Data API) dan tidak
-- di-grant ke role API, sehingga owner tidak bisa menghapus riwayat untuk
-- mengakali aturan ini.
-- =============================================================================

-- Tanpa foreign key (seperti activity_logs): riwayat harus tetap ada walaupun
-- baris yang dirujuk berubah, dan trigger tetap aman saat penghapusan berantai.
create table private.project_member_removals (
  project_id uuid not null,
  user_id    uuid not null,
  last_role  public.project_member_role not null,
  removed_at timestamptz not null default now(),
  removed_by uuid,  -- auth.uid() pelaku; NULL bila oleh service role / sistem
  primary key (project_id, user_id)
);

comment on table private.project_member_removals is
  'Role terakhir pengguna yang dikeluarkan dari project. Dipakai guard_project_member_insert agar non-Admin tidak bisa mengubah role lewat hapus lalu tambah lagi.';

revoke all on table private.project_member_removals from public, anon, authenticated, service_role;

create function private.remember_member_removal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into private.project_member_removals (project_id, user_id, last_role, removed_at, removed_by)
  values (old.project_id, old.user_id, old.role, now(), auth.uid())
  on conflict (project_id, user_id) do update
    set last_role  = excluded.last_role,
        removed_at = excluded.removed_at,
        removed_by = excluded.removed_by;
  return null;
end;
$$;

create trigger remember_member_removal
  after delete on public.project_members
  for each row execute function private.remember_member_removal();

-- Role terakhir p_user_id di project ini sebelum dikeluarkan (NULL bila belum pernah).
create function private.removed_member_role(p_project_id uuid, p_user_id uuid)
returns public.project_member_role
language sql
stable
security definer
set search_path = ''
as $$
  select r.last_role
  from private.project_member_removals r
  where r.project_id = p_project_id and r.user_id = p_user_id;
$$;

-- Guard (SECURITY INVOKER, seperti guard_task_write) agar current_user tetap
-- role yang sedang request. Admin, service role, dan pemilik DB tidak dibatasi.
create function private.guard_project_member_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_last_role public.project_member_role;
begin
  if current_user not in ('anon', 'authenticated') or private.is_admin() then
    return new;
  end if;

  v_last_role := private.removed_member_role(new.project_id, new.user_id);
  if v_last_role is not null and v_last_role is distinct from new.role then
    raise exception
      'Pengguna ini sebelumnya % di project ini. Mengubah role per-project (termasuk lewat hapus lalu tambah lagi) hanya bisa dilakukan Admin',
      v_last_role
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger guard_project_member_insert
  before insert on public.project_members
  for each row execute function private.guard_project_member_insert();

revoke all on all functions in schema private from public;
grant execute on function private.removed_member_role(uuid, uuid) to authenticated, service_role;
