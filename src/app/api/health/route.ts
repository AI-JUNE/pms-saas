import { NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { db } from '@/db';

export const dynamic = 'force-dynamic';

// 공개 헬스체크: 인증 불필요. 업타임 모니터·로드밸런서·마켓플레이스 상태 점검용.
// DB 연결을 가볍게 핑(select 1)하고, 실패해도 표준 포맷으로 503 반환(크래시 없음).
const startedAt = Date.now();
const VERSION = process.env.APP_VERSION || '0.12.0';

export async function GET() {
  const at = new Date().toISOString();
  const uptimeSec = Math.round((Date.now() - startedAt) / 1000);
  let dbOk = false;
  let dbLatencyMs: number | null = null;
  let dbError: string | null = null;
  try {
    const t0 = Date.now();
    await db.execute(sql`select 1`);
    dbLatencyMs = Date.now() - t0;
    dbOk = true;
  } catch (e: unknown) {
    dbError = e instanceof Error ? e.message : 'db error';
  }
  const healthy = dbOk;
  const body = {
    ok: healthy,
    status: healthy ? 'ok' : 'degraded',
    service: 'prism-pms',
    version: VERSION,
    time: at,
    uptimeSec,
    checks: {
      db: { ok: dbOk, latencyMs: dbLatencyMs, ...(dbError ? { error: dbError } : {}) },
    },
  };
  return NextResponse.json(body, {
    status: healthy ? 200 : 503,
    headers: { 'Cache-Control': 'no-store' },
  });
}
