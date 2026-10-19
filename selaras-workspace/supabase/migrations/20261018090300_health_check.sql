-- =============================================================================
-- Health check untuk GET /api/health (Fase 0, DoD #2 & #4).
-- Aman dipanggil publik: hanya mengembalikan waktu server dan kelengkapan skema,
-- tidak ada data pengguna.
-- =============================================================================
create function public.health_check()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'database', 'ok',
    'server_time', now(),
    'tables_expected', 5,
    'tables_found', (
      select count(*)
      from pg_catalog.pg_tables
      where schemaname = 'public'
        and tablename in ('profiles', 'projects', 'project_members', 'tasks', 'activity_logs')
    ),
    'enums_expected', 4,
    'enums_found', (
      select count(*)
      from pg_catalog.pg_type t
      join pg_catalog.pg_namespace n on n.oid = t.typnamespace
      where n.nspname = 'public'
        and t.typtype = 'e'
        and t.typname in ('project_status', 'priority_level', 'project_member_role', 'task_status')
    ),
    'rls_enabled_tables', (
      select count(*)
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relkind = 'r'
        and c.relrowsecurity
        and c.relname in ('profiles', 'projects', 'project_members', 'tasks', 'activity_logs')
    )
  );
$$;

revoke all on function public.health_check() from public;
grant execute on function public.health_check() to anon, authenticated, service_role;
