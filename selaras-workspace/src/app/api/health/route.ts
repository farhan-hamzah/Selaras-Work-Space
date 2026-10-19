import { connection } from 'next/server'
import { checkSupabaseHealth } from '@/lib/supabase/health'

/**
 * GET /api/health — publik (SRS 5.2). Fase 0 DoD #2:
 *   200 { status: "success", data: { supabase: "connected", ... } }
 *   503 { status: "error",   data: { supabase: "<state>" }, message }
 */
export async function GET() {
  await connection() // selalu dievaluasi saat request, tidak pernah di-prerender

  const health = await checkSupabaseHealth()
  const headers = { 'Cache-Control': 'no-store' }

  if (health.state === 'connected') {
    return Response.json(
      {
        status: 'success',
        data: {
          supabase: 'connected',
          latencyMs: health.latencyMs,
          database: health.database,
        },
      },
      { headers },
    )
  }

  return Response.json(
    { status: 'error', data: { supabase: health.state }, message: health.message },
    { status: 503, headers },
  )
}
