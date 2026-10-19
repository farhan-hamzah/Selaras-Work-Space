-- =============================================================================
-- Audit log — KOREKSI #4: penyimpanan log yang terjamin, bukan fire-and-forget.
--
-- Prinsip:
--   * Perubahan data (task, project, member, role/status akun) dicatat oleh
--     TRIGGER di dalam TRANSAKSI YANG SAMA dengan perubahan datanya. Hasilnya
--     atomik: data berubah <=> log tersimpan. Jika INSERT log gagal, seluruh
--     perubahan di-rollback dan API menerima error (fail-closed). Tidak ada
--     jalur kode aplikasi yang bisa "lupa" mencatat.
--   * Event autentikasi (login/logout) tidak mengubah tabel aplikasi, jadi
--     dicatat lewat RPC public.log_auth_event() yang di-AWAIT oleh server;
--     kebijakan retry & fallback ada di lapisan aplikasi (docs/review-fase-0.md).
--   * Tabel append-only: tidak ada UPDATE/DELETE/TRUNCATE untuk role mana pun
--     (termasuk service_role), ditegakkan oleh REVOKE + trigger penolak.
--   * Role API tidak bisa INSERT langsung ke activity_logs, sehingga log tidak
--     bisa dipalsukan (user_id selalu diambil dari auth.uid(), bukan dari input).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Penulis log tunggal. Kegagalan parsing header TIDAK boleh membatalkan
-- transaksi (ditangkap), tetapi kegagalan INSERT harus naik (fail-closed).
-- -----------------------------------------------------------------------------
create function private.write_activity_log(
  p_action        text,
  p_resource_type text,
  p_resource_id   uuid,
  p_description   text,
  p_metadata      jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_headers jsonb;
  v_claims  jsonb;
  v_ip      inet;
begin
  begin
    v_headers := nullif(current_setting('request.headers', true), '')::jsonb;
  exception when others then
    v_headers := null;
  end;

  begin
    v_claims := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  exception when others then
    v_claims := null;
  end;

  -- x-client-ip / x-client-user-agent diisi server Next.js dengan data
  -- pengguna akhir (src/lib/supabase/server.ts); fallback ke header gateway.
  begin
    v_ip := nullif(btrim(split_part(
      coalesce(v_headers ->> 'x-client-ip', v_headers ->> 'x-forwarded-for', ''), ',', 1
    )), '')::inet;
  exception when others then
    v_ip := null;
  end;

  insert into public.activity_logs
    (user_id, action, resource_type, resource_id, description, metadata, ip_address, user_agent)
  values (
    auth.uid(),
    p_action,
    p_resource_type,
    p_resource_id,
    p_description,
    coalesce(p_metadata, '{}'::jsonb)
      || jsonb_build_object('actor_role', coalesce(v_claims ->> 'role', 'system')),
    v_ip,
    left(coalesce(v_headers ->> 'x-client-user-agent', v_headers ->> 'user-agent'), 512)
  );
end;
$$;

-- Nama tampilan untuk deskripsi log (ID tetap disimpan di metadata).
create function private.profile_label(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select p.full_name from public.profiles p where p.id = p_user_id),
    case when p_user_id is null then '(tidak ada)' else p_user_id::text end
  );
$$;

create function private.project_label(p_project_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select pr.name from public.projects pr where pr.id = p_project_id), p_project_id::text);
$$;

-- -----------------------------------------------------------------------------
-- Trigger audit per tabel (AFTER, FOR EACH ROW, SECURITY DEFINER).
-- -----------------------------------------------------------------------------

-- TASKS: TASK_CREATED / TASK_STATUS_CHANGED / TASK_ASSIGNED / TASK_UPDATED / TASK_DELETED
create function private.audit_task_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_meta    jsonb := jsonb_build_object('project_id', new.project_id, 'title', new.title);
  v_changes jsonb := '{}'::jsonb;
begin
  if tg_op = 'INSERT' then
    perform private.write_activity_log(
      'TASK_CREATED', 'task', new.id,
      format('Task "%s" dibuat', new.title),
      v_meta || jsonb_build_object('status', new.status, 'priority', new.priority, 'assignee_id', new.assignee_id)
    );
    return null;
  end if;

  if old.deleted_at is null and new.deleted_at is not null then
    perform private.write_activity_log(
      'TASK_DELETED', 'task', new.id, format('Task "%s" dihapus', new.title), v_meta
    );
    return null;
  end if;

  if new.status is distinct from old.status then
    perform private.write_activity_log(
      'TASK_STATUS_CHANGED', 'task', new.id,
      format('Status task "%s": %s -> %s', new.title, old.status, new.status),
      v_meta || jsonb_build_object('changes', jsonb_build_object(
        'status', jsonb_build_object('old', old.status, 'new', new.status)))
    );
  end if;

  if new.assignee_id is distinct from old.assignee_id then
    perform private.write_activity_log(
      'TASK_ASSIGNED', 'task', new.id,
      format('Assignee task "%s": %s -> %s', new.title,
        private.profile_label(old.assignee_id), private.profile_label(new.assignee_id)),
      v_meta || jsonb_build_object('changes', jsonb_build_object(
        'assignee_id', jsonb_build_object('old', old.assignee_id, 'new', new.assignee_id)))
    );
  end if;

  if new.title is distinct from old.title then
    v_changes := v_changes || jsonb_build_object('title', jsonb_build_object('old', old.title, 'new', new.title));
  end if;
  if new.description is distinct from old.description then
    v_changes := v_changes || jsonb_build_object('description', jsonb_build_object('old', old.description, 'new', new.description));
  end if;
  if new.priority is distinct from old.priority then
    v_changes := v_changes || jsonb_build_object('priority', jsonb_build_object('old', old.priority, 'new', new.priority));
  end if;
  if new.due_date is distinct from old.due_date then
    v_changes := v_changes || jsonb_build_object('due_date', jsonb_build_object('old', old.due_date, 'new', new.due_date));
  end if;

  if v_changes <> '{}'::jsonb then
    perform private.write_activity_log(
      'TASK_UPDATED', 'task', new.id,
      format('Task "%s" diperbarui', new.title),
      v_meta || jsonb_build_object('changes', v_changes)
    );
  end if;

  return null;
end;
$$;

create trigger audit_task_change
  after insert or update on public.tasks
  for each row execute function private.audit_task_change();

-- PROJECTS: PROJECT_CREATED / PROJECT_UPDATED / PROJECT_DELETED
create function private.audit_project_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_changes jsonb := '{}'::jsonb;
begin
  if tg_op = 'INSERT' then
    perform private.write_activity_log(
      'PROJECT_CREATED', 'project', new.id,
      format('Project "%s" dibuat', new.name),
      jsonb_build_object('status', new.status, 'priority', new.priority)
    );
    return null;
  end if;

  if old.deleted_at is null and new.deleted_at is not null then
    perform private.write_activity_log(
      'PROJECT_DELETED', 'project', new.id, format('Project "%s" dihapus', new.name), '{}'::jsonb
    );
    return null;
  end if;

  if new.name is distinct from old.name then
    v_changes := v_changes || jsonb_build_object('name', jsonb_build_object('old', old.name, 'new', new.name));
  end if;
  if new.description is distinct from old.description then
    v_changes := v_changes || jsonb_build_object('description', jsonb_build_object('old', old.description, 'new', new.description));
  end if;
  if new.status is distinct from old.status then
    v_changes := v_changes || jsonb_build_object('status', jsonb_build_object('old', old.status, 'new', new.status));
  end if;
  if new.priority is distinct from old.priority then
    v_changes := v_changes || jsonb_build_object('priority', jsonb_build_object('old', old.priority, 'new', new.priority));
  end if;
  if new.start_date is distinct from old.start_date then
    v_changes := v_changes || jsonb_build_object('start_date', jsonb_build_object('old', old.start_date, 'new', new.start_date));
  end if;
  if new.due_date is distinct from old.due_date then
    v_changes := v_changes || jsonb_build_object('due_date', jsonb_build_object('old', old.due_date, 'new', new.due_date));
  end if;

  if v_changes <> '{}'::jsonb then
    perform private.write_activity_log(
      'PROJECT_UPDATED', 'project', new.id,
      format('Project "%s" diperbarui', new.name),
      jsonb_build_object('changes', v_changes)
    );
  end if;

  return null;
end;
$$;

create trigger audit_project_change
  after insert or update on public.projects
  for each row execute function private.audit_project_change();

-- PROJECT_MEMBERS: PROJECT_MEMBER_ADDED / _ROLE_CHANGED / _REMOVED
create function private.audit_project_member_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform private.write_activity_log(
      'PROJECT_MEMBER_ADDED', 'project', new.project_id,
      format('%s ditambahkan ke project "%s" sebagai %s',
        private.profile_label(new.user_id), private.project_label(new.project_id), new.role),
      jsonb_build_object('member_user_id', new.user_id, 'role', new.role)
    );
  elsif tg_op = 'UPDATE' then
    if new.role is distinct from old.role then
      perform private.write_activity_log(
        'PROJECT_MEMBER_ROLE_CHANGED', 'project', new.project_id,
        format('Role %s di project "%s": %s -> %s', private.profile_label(new.user_id),
          private.project_label(new.project_id), old.role, new.role),
        jsonb_build_object('member_user_id', new.user_id,
          'changes', jsonb_build_object('role', jsonb_build_object('old', old.role, 'new', new.role)))
      );
    end if;
  else
    perform private.write_activity_log(
      'PROJECT_MEMBER_REMOVED', 'project', old.project_id,
      format('%s (%s) dikeluarkan dari project "%s"', private.profile_label(old.user_id),
        old.role, private.project_label(old.project_id)),
      jsonb_build_object('member_user_id', old.user_id, 'role', old.role)
    );
  end if;
  return null;
end;
$$;

create trigger audit_project_member_change
  after insert or update or delete on public.project_members
  for each row execute function private.audit_project_member_change();

-- PROFILES: USER_ROLE_CHANGED / USER_ACTIVATED / USER_DEACTIVATED (FR-ADM-06)
create function private.audit_profile_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.role is distinct from old.role then
    perform private.write_activity_log(
      'USER_ROLE_CHANGED', 'profile', new.id,
      format('Role global %s diubah: %s -> %s', new.full_name, old.role, new.role),
      jsonb_build_object('changes', jsonb_build_object('role', jsonb_build_object('old', old.role, 'new', new.role)))
    );
  end if;

  if new.is_active is distinct from old.is_active then
    perform private.write_activity_log(
      case when new.is_active then 'USER_ACTIVATED' else 'USER_DEACTIVATED' end,
      'profile', new.id,
      format('Akun %s %s', new.full_name, case when new.is_active then 'diaktifkan' else 'dinonaktifkan' end),
      '{}'::jsonb
    );
  end if;

  return null;
end;
$$;

create trigger audit_profile_change
  after update on public.profiles
  for each row execute function private.audit_profile_change();

-- -----------------------------------------------------------------------------
-- Event autentikasi (FR-AUTH-06). Dipanggil server Next.js dengan sesi pengguna,
-- di-AWAIT, dan hasilnya diperiksa. user_id selalu auth.uid() — tidak bisa
-- dipalsukan. USER_LOGIN_FAILED (belum ada sesi) ditulis server memakai
-- service role, lihat docs/review-fase-0.md.
-- -----------------------------------------------------------------------------
create function public.log_auth_event(p_action text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or not private.is_active_user() then
    raise exception 'Sesi tidak valid atau akun nonaktif' using errcode = '42501';
  end if;
  if p_action is null or p_action not in ('USER_LOGIN', 'USER_LOGOUT') then
    raise exception 'Aksi tidak valid untuk log autentikasi' using errcode = '22023';
  end if;

  if p_action = 'USER_LOGIN' then
    update public.profiles set last_login_at = now() where id = v_uid;
  end if;

  perform private.write_activity_log(
    p_action, 'auth', v_uid,
    case p_action when 'USER_LOGIN' then 'Pengguna login' else 'Pengguna logout' end,
    '{}'::jsonb
  );
end;
$$;

revoke all on function public.log_auth_event(text) from public, anon;
grant execute on function public.log_auth_event(text) to authenticated;


-- -----------------------------------------------------------------------------
-- Append-only (FR-LOG-04): tidak ada role yang boleh UPDATE/DELETE/TRUNCATE,
-- termasuk Admin dan service_role. Retensi/arsip (bila kelak diperlukan) harus
-- lewat migration terpisah yang ditinjau, bukan dari aplikasi.
-- -----------------------------------------------------------------------------
create function private.reject_activity_log_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'activity_logs bersifat append-only: % tidak diizinkan', tg_op
    using errcode = '42501';
end;
$$;

create trigger activity_logs_append_only
  before update or delete on public.activity_logs
  for each row execute function private.reject_activity_log_mutation();

create trigger activity_logs_no_truncate
  before truncate on public.activity_logs
  for each statement execute function private.reject_activity_log_mutation();

revoke update, delete, truncate on public.activity_logs from service_role;

-- Semua fungsi di schema private tertutup untuk PUBLIC; helper yang dipakai
-- policy sudah di-grant eksplisit ke authenticated di migration akses.
revoke all on all functions in schema private from public;
