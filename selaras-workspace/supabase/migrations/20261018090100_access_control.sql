-- =============================================================================
-- Kontrol akses — menyamakan policy database dengan matriks permission
-- (SRS 3.7, keputusan D1–D4) + KOREKSI #1:
--   (a) Viewer tidak pernah bisa mengubah task, walaupun dia creator/assignee.
--       Hak edit creator/assignee (D2) hanya berlaku selama role-nya di project
--       tersebut masih 'owner' atau 'member', dan akunnya masih aktif.
--   (b) Akun nonaktif (profiles.is_active = false) ditolak oleh SEMUA policy,
--       walaupun JWT-nya masih valid secara kriptografis (NFR-SEC-06).
--   (c) Staff tidak bisa mengubah role/status akunnya sendiri: kolom role &
--       is_active tidak di-grant ke role API, dijaga trigger, dan hanya bisa
--       diubah lewat fungsi admin yang memeriksa is_admin() di database.
--
-- Lapisan yang dipakai (semua diuji di tests/db/*.test.ts):
--   1. GRANT tingkat kolom  -> kolom apa yang BOLEH disentuh role API sama sekali
--   2. RLS policy           -> baris mana yang boleh dibaca/diubah
--   3. Guard trigger        -> aturan yang butuh nilai lama vs baru (assign, role)
--   4. Fungsi RPC           -> aksi khusus (soft delete, ubah role/status akun)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Helper (SECURITY DEFINER agar tidak memicu rekursi RLS; search_path kosong)
--    Semua helper mensyaratkan akun AKTIF — inilah yang membuat akun nonaktif
--    otomatis ditolak oleh setiap policy.
-- -----------------------------------------------------------------------------
create function private.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.is_active
  );
$$;

-- D1/D4: Admin (dan masih aktif) selalu menang.
create function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.is_active and p.role = 'admin'
  );
$$;

-- Role per-project milik pengguna saat ini.
-- NULL bila: bukan member, akun nonaktif, atau project sudah di-soft-delete.
create function private.project_role(p_project_id uuid)
returns public.project_member_role
language sql
stable
security definer
set search_path = ''
as $$
  select pm.role
  from public.project_members pm
  join public.profiles p on p.id = pm.user_id
  join public.projects pr on pr.id = pm.project_id
  where pm.project_id = p_project_id
    and pm.user_id = auth.uid()
    and p.is_active
    and pr.deleted_at is null;
$$;

create function private.project_is_live(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.projects pr
    where pr.id = p_project_id and pr.deleted_at is null
  );
$$;

-- Apakah p_user_id boleh menjadi assignee di project ini (owner/member aktif).
create function private.is_project_contributor(p_project_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.project_members pm
    join public.profiles p on p.id = pm.user_id
    where pm.project_id = p_project_id
      and pm.user_id = p_user_id
      and pm.role in ('owner', 'member')
      and p.is_active
  );
$$;

-- Apakah pengguna saat ini berbagi minimal satu project aktif dengan p_user_id
-- (untuk menampilkan nama rekan satu project / assignee).
create function private.shares_project_with(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_active_user() and exists (
    select 1
    from public.project_members mine
    join public.project_members theirs on theirs.project_id = mine.project_id
    join public.projects pr on pr.id = mine.project_id
    where mine.user_id = auth.uid()
      and theirs.user_id = p_user_id
      and pr.deleted_at is null
  );
$$;

-- D2 + koreksi #1(a): siapa yang boleh mengedit / mengubah status sebuah task.
create function private.can_edit_task(p_project_id uuid, p_created_by uuid, p_assignee_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when private.is_admin() then private.project_is_live(p_project_id)
    else coalesce(
      case private.project_role(p_project_id)
        when 'owner'  then true
        -- Member: hanya task yang dia buat ATAU yang di-assign kepadanya.
        when 'member' then auth.uid() = p_created_by or auth.uid() = p_assignee_id
        -- Viewer: TIDAK PERNAH, walaupun creator/assignee task tersebut.
        else false
      end,
      false
    )
  end;
$$;

-- -----------------------------------------------------------------------------
-- 2. GRANT — least privilege. Default Supabase memberi ALL pada tabel baru ke
--    anon & authenticated; kita cabut lalu beri hanya yang diperlukan.
--    Kolom yang TIDAK tercantum (role, is_active, created_by, project_id,
--    deleted_at, completed_at, ...) tidak bisa diubah langsung oleh role API.
-- -----------------------------------------------------------------------------
revoke all on table
  public.profiles, public.projects, public.project_members, public.tasks, public.activity_logs
from anon, authenticated;

grant select on public.profiles to authenticated;
grant update (full_name, display_name, avatar_url) on public.profiles to authenticated;

grant select on public.projects to authenticated;
grant insert (name, description, status, priority, start_date, due_date, created_by) on public.projects to authenticated;
grant update (name, description, status, priority, start_date, due_date) on public.projects to authenticated;

grant select, delete on public.project_members to authenticated;
grant insert (project_id, user_id, role) on public.project_members to authenticated;
grant update (role) on public.project_members to authenticated;

grant select on public.tasks to authenticated;
grant insert (project_id, title, description, status, priority, assignee_id, due_date, created_by) on public.tasks to authenticated;
grant update (title, description, status, priority, assignee_id, due_date) on public.tasks to authenticated;

grant select on public.activity_logs to authenticated;

-- -----------------------------------------------------------------------------
-- 3. RLS policy (NFR-SEC-02: semua tabel). Tidak ada policy untuk anon.
--    Pola (select fn()) dipakai agar Postgres mengevaluasinya sekali per query.
-- -----------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.project_members enable row level security;
alter table public.tasks enable row level security;
alter table public.activity_logs enable row level security;

-- PROFILES ---------------------------------------------------------------------
create policy profiles_select on public.profiles
  for select to authenticated
  using (
    (select private.is_admin())
    or (id = (select auth.uid()) and (select private.is_active_user()))
    or private.shares_project_with(id)
  );

-- Baris sendiri (hanya kolom nama/avatar — lihat GRANT) atau admin.
create policy profiles_update on public.profiles
  for update to authenticated
  using ((select private.is_admin()) or (id = (select auth.uid()) and (select private.is_active_user())))
  with check ((select private.is_admin()) or (id = (select auth.uid()) and (select private.is_active_user())));
-- Tidak ada INSERT (dibuat oleh trigger handle_new_user) dan DELETE.

-- PROJECTS ---------------------------------------------------------------------
-- Lihat: admin semua (D1), selain itu hanya project tempat ia terdaftar.
create policy projects_select on public.projects
  for select to authenticated
  using (
    deleted_at is null
    and ((select private.is_admin()) or private.project_role(id) is not null)
  );

-- Buat: admin saja (FR-PROJ-02).
create policy projects_insert on public.projects
  for insert to authenticated
  with check ((select private.is_admin()) and created_by = (select auth.uid()));

-- Edit detail: admin atau owner project (FR-PROJ-03, D3).
create policy projects_update on public.projects
  for update to authenticated
  using (deleted_at is null and ((select private.is_admin()) or private.project_role(id) = 'owner'))
  with check (deleted_at is null and ((select private.is_admin()) or private.project_role(id) = 'owner'));
-- Hapus: tidak ada policy DELETE (soft delete, NFR-REL-02) -> public.soft_delete_project().

-- PROJECT_MEMBERS --------------------------------------------------------------
create policy project_members_select on public.project_members
  for select to authenticated
  using ((select private.is_admin()) or private.project_role(project_id) is not null);

-- Tambah member: admin (role apa pun) atau owner (hanya member/viewer).
-- Menjadikan seseorang owner = mengubah role per-project = khusus Admin (FR-ADM-04).
create policy project_members_insert on public.project_members
  for insert to authenticated
  with check (
    private.project_is_live(project_id)
    and (
      (select private.is_admin())
      or (private.project_role(project_id) = 'owner' and role in ('member', 'viewer'))
    )
  );

-- Ubah role per-project: admin saja (FR-ADM-04).
create policy project_members_update on public.project_members
  for update to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

-- Hapus member: admin, atau owner untuk member/viewer (FR-PROJ-04).
create policy project_members_delete on public.project_members
  for delete to authenticated
  using (
    (select private.is_admin())
    or (private.project_role(project_id) = 'owner' and role in ('member', 'viewer'))
  );

-- TASKS ------------------------------------------------------------------------
create policy tasks_select on public.tasks
  for select to authenticated
  using (
    deleted_at is null
    and private.project_is_live(project_id)
    and ((select private.is_admin()) or private.project_role(project_id) is not null)
  );

-- Buat task: admin/owner/member, bukan viewer (FR-TASK-02).
-- Member hanya boleh membiarkan task tanpa assignee atau meng-assign dirinya
-- sendiri; assign ke orang lain = FR-TASK-06 (admin/owner).
create policy tasks_insert on public.tasks
  for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and private.project_is_live(project_id)
    and (
      (select private.is_admin())
      or private.project_role(project_id) = 'owner'
      or (
        private.project_role(project_id) = 'member'
        and (assignee_id is null or assignee_id = (select auth.uid()))
      )
    )
  );

-- Edit / ubah status: admin, owner, atau member yang creator/assignee (D2).
-- Viewer & akun nonaktif selalu ditolak (koreksi #1a, #1b) — lihat can_edit_task().
create policy tasks_update on public.tasks
  for update to authenticated
  using (deleted_at is null and private.can_edit_task(project_id, created_by, assignee_id))
  with check (deleted_at is null and private.can_edit_task(project_id, created_by, assignee_id));
-- Hapus: tidak ada policy DELETE (soft delete) -> public.soft_delete_task().

-- ACTIVITY_LOGS ----------------------------------------------------------------
-- Baca: admin saja. Tidak ada policy INSERT/UPDATE/DELETE untuk role API:
-- log hanya ditulis oleh trigger & fungsi SECURITY DEFINER (lihat migration audit).
create policy activity_logs_select on public.activity_logs
  for select to authenticated
  using ((select private.is_admin()));

-- -----------------------------------------------------------------------------
-- 4. Guard trigger — aturan yang tidak bisa diekspresikan RLS karena butuh
--    membandingkan nilai lama vs baru. Hanya berlaku untuk request dari role API
--    (anon/authenticated); fungsi SECURITY DEFINER & service role melewatinya.
-- -----------------------------------------------------------------------------

-- Koreksi #1(c): role/is_active/last_login_at tidak bisa diubah lewat Data API,
-- termasuk oleh pemilik baris itu sendiri. (Lapis kedua setelah GRANT kolom.)
create function private.guard_profile_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('anon', 'authenticated') and (
       new.id is distinct from old.id
    or new.role is distinct from old.role
    or new.is_active is distinct from old.is_active
    or new.last_login_at is distinct from old.last_login_at
    or new.created_at is distinct from old.created_at
  ) then
    raise exception 'Role dan status akun hanya bisa diubah Admin melalui fungsi admin'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger guard_profile_update
  before update on public.profiles
  for each row execute function private.guard_profile_update();

create function private.guard_task_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- completed_at mengikuti status (berlaku untuk semua pemanggil).
  if new.status = 'done' then
    if tg_op = 'INSERT' or old.status is distinct from 'done' then
      new.completed_at := now();
    else
      new.completed_at := old.completed_at;
    end if;
  else
    new.completed_at := null;
  end if;

  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;

  -- FR-TASK-06: assign/reassign hanya admin atau owner project.
  if tg_op = 'UPDATE'
     and new.assignee_id is distinct from old.assignee_id
     and not (private.is_admin() or coalesce(private.project_role(new.project_id) = 'owner', false)) then
    raise exception 'Hanya Admin atau owner project yang boleh meng-assign task'
      using errcode = '42501';
  end if;

  -- Integritas: assignee baru harus owner/member aktif di project tersebut.
  if new.assignee_id is not null
     and (tg_op = 'INSERT' or new.assignee_id is distinct from old.assignee_id)
     and not private.is_project_contributor(new.project_id, new.assignee_id) then
    raise exception 'Assignee harus owner/member aktif pada project ini'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger guard_task_write
  before insert or update on public.tasks
  for each row execute function private.guard_task_write();

-- Fungsi private: tidak bisa dipanggil siapa pun kecuali yang diberi grant.
-- authenticated butuh EXECUTE pada helper karena dievaluasi di dalam policy
-- dan guard trigger (dengan hak akses pengguna yang sedang request).
revoke all on all functions in schema private from public;
grant usage on schema private to authenticated, service_role;
grant execute on function
  private.is_active_user(),
  private.is_admin(),
  private.project_role(uuid),
  private.project_is_live(uuid),
  private.is_project_contributor(uuid, uuid),
  private.shares_project_with(uuid),
  private.can_edit_task(uuid, uuid, uuid)
to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 5. RPC — aksi yang sengaja tidak dibuka lewat UPDATE/DELETE biasa.
--    Kode error: 42501 = tidak berhak, P0002 = tidak ditemukan, 22023 = input
--    tidak valid. Lapisan API memetakan ke HTTP 403/404/400.
-- -----------------------------------------------------------------------------

-- FR-TASK-06 + NFR-REL-02: hapus task (soft delete) — admin atau owner project.
create function public.soft_delete_task(p_task_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project_id uuid;
  v_role public.project_member_role;
begin
  select t.project_id into v_project_id
  from public.tasks t
  where t.id = p_task_id and t.deleted_at is null;

  v_role := private.project_role(v_project_id);

  -- Jangan bocorkan keberadaan task kepada yang tidak bisa melihatnya.
  if v_project_id is null or not (private.is_admin() or v_role is not null) then
    raise exception 'Task tidak ditemukan' using errcode = 'P0002';
  end if;
  if not (private.is_admin() or v_role = 'owner') then
    raise exception 'Hanya Admin atau owner project yang boleh menghapus task' using errcode = '42501';
  end if;

  update public.tasks set deleted_at = now() where id = p_task_id;
end;
$$;

-- FR-PROJ-02 + NFR-REL-02: hapus project (soft delete) — admin saja.
create function public.soft_delete_project(p_project_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_admin() then
    if private.project_role(p_project_id) is null then
      raise exception 'Project tidak ditemukan' using errcode = 'P0002';
    end if;
    raise exception 'Hanya Admin yang boleh menghapus project' using errcode = '42501';
  end if;

  update public.projects set deleted_at = now()
  where id = p_project_id and deleted_at is null;
  if not found then
    raise exception 'Project tidak ditemukan' using errcode = 'P0002';
  end if;
end;
$$;

-- FR-ADM-04 + koreksi #1(c): ubah role global — admin saja, dicek di database.
create function public.admin_set_user_role(p_user_id uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'Hanya Admin yang boleh mengubah role global' using errcode = '42501';
  end if;
  if p_role is null or p_role not in ('admin', 'staff') then
    raise exception 'Role tidak valid' using errcode = '22023';
  end if;
  if p_user_id = auth.uid() and p_role <> 'admin' then
    raise exception 'Admin tidak bisa menurunkan role akunnya sendiri' using errcode = '22023';
  end if;

  update public.profiles set role = p_role where id = p_user_id;
  if not found then
    raise exception 'Pengguna tidak ditemukan' using errcode = 'P0002';
  end if;
end;
$$;

-- FR-ADM-05: aktif/nonaktifkan akun — admin saja, dicek di database.
-- Pencabutan sesi di sisi Supabase Auth (ban) dilakukan oleh endpoint admin
-- SETELAH fungsi ini sukses — lihat docs/review-fase-0.md, koreksi #3.
create function public.admin_set_user_active(p_user_id uuid, p_is_active boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'Hanya Admin yang boleh mengubah status akun' using errcode = '42501';
  end if;
  if p_is_active is null then
    raise exception 'Status tidak valid' using errcode = '22023';
  end if;
  if p_user_id = auth.uid() and not p_is_active then
    raise exception 'Admin tidak bisa menonaktifkan akunnya sendiri' using errcode = '22023';
  end if;

  update public.profiles set is_active = p_is_active where id = p_user_id;
  if not found then
    raise exception 'Pengguna tidak ditemukan' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function
  public.soft_delete_task(uuid),
  public.soft_delete_project(uuid),
  public.admin_set_user_role(uuid, text),
  public.admin_set_user_active(uuid, boolean)
from public, anon;
grant execute on function
  public.soft_delete_task(uuid),
  public.soft_delete_project(uuid),
  public.admin_set_user_role(uuid, text),
  public.admin_set_user_active(uuid, boolean)
to authenticated;
