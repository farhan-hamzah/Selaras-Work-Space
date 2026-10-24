-- =============================================================================
-- Revisi review Fase 0, poin 2 — USER_LOGIN / USER_LOGOUT harus berasal dari
-- proses autentikasi yang valid.
--
-- Masalah: public.log_auth_event() bisa dipanggil langsung oleh siapa pun yang
-- punya sesi (Data API + publishable key). Pengguna bisa mencatat USER_LOGOUT
-- tanpa benar-benar logout, atau USER_LOGIN berulang kali tanpa login.
--
-- Perbaikan: event dicatat dari tabel sesi Supabase Auth (auth.sessions).
-- Tabel ini hanya ditulis oleh server Auth (role supabase_auth_admin); role API
-- tidak punya hak apa pun atasnya dan schema auth tidak diekspos Data API.
--   * INSERT = Auth menerbitkan sesi baru setelah login berhasil (password,
--              magic link, OTP, OAuth, SSO). Refresh token TIDAK membuat sesi
--              baru, jadi tidak tercatat sebagai login.
--   * DELETE = sesi diakhiri oleh Auth: POST /logout (scope local, global,
--              others), pencabutan sesi (ganti password, unenroll MFA), atau
--              akun dihapus.
-- Trigger berjalan dalam transaksi yang sama dengan perubahan sesi. Bila log
-- gagal tersimpan, login/logout ikut gagal (fail-closed), sama seperti log
-- perubahan data.
--
-- Supabase mengizinkan trigger pada auth.sessions (changelog "Restricting
-- access on auth, storage, and realtime schemas", 21 April 2025). Kolom yang
-- dipakai (id, user_id, created_at, not_after, aal, ip, user_agent) berasal dari
-- migration Supabase Auth; diperiksa ulang oleh `npm run verify:supabase`.
-- =============================================================================

drop function public.log_auth_event(text);

create function private.audit_auth_session()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    update public.profiles set last_login_at = now() where id = new.user_id;

    insert into public.activity_logs
      (user_id, action, resource_type, resource_id, description, metadata, ip_address, user_agent)
    values (
      new.user_id, 'USER_LOGIN', 'auth', new.user_id,
      format('%s login', private.profile_label(new.user_id)),
      jsonb_build_object(
        'session_id', new.id,
        'aal', new.aal,
        -- Akun nonaktif yang belum di-ban masih bisa login di Auth (RLS tetap
        -- menolak semua datanya). Ditandai agar mudah ditemukan saat audit.
        'account_active', (select p.is_active from public.profiles p where p.id = new.user_id),
        'actor_role', 'supabase_auth'
      ),
      new.ip,
      left(new.user_agent, 512)
    );
    return null;
  end if;

  -- Sesi yang sudah kedaluwarsa (not_after terlewati) dibersihkan Auth secara
  -- berkala. Itu bukan logout, jadi tidak dicatat.
  if old.not_after is not null and old.not_after <= now() then
    return null;
  end if;

  -- IP & user agent = nilai terakhir yang dicatat Auth pada sesi tersebut.
  insert into public.activity_logs
    (user_id, action, resource_type, resource_id, description, metadata, ip_address, user_agent)
  values (
    old.user_id, 'USER_LOGOUT', 'auth', old.user_id,
    format('%s logout', private.profile_label(old.user_id)),
    jsonb_build_object(
      'session_id', old.id,
      'session_started_at', old.created_at,
      'actor_role', 'supabase_auth'
    ),
    old.ip,
    left(old.user_agent, 512)
  );
  return null;
end;
$$;

create trigger on_auth_session_change
  after insert or delete on auth.sessions
  for each row execute function private.audit_auth_session();

revoke all on all functions in schema private from public;
