import { sql } from 'drizzle-orm';
import { db } from '@/db';
export async function nextSeq(orgId: number, scope: string): Promise<number> {
  // tenant-scan: allow(counters upsert — org_id 파라미터로 스코프, sql 태그 템플릿이라 바인딩 처리됨)
  const rows: any = await db.execute(sql`INSERT INTO counters (org_id, scope, value) VALUES (${orgId}, ${scope}, 1) ON CONFLICT (org_id, scope) DO UPDATE SET value = counters.value + 1 RETURNING value`);
  const r = rows.rows ? rows.rows[0] : rows[0]; return Number(r.value);
}
export function formatCode(prefix: string, n: number, width = 4): string { return `${prefix}-${String(n).padStart(width, '0')}`; }
