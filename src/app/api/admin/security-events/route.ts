import { and, or, eq, lt, desc } from 'drizzle-orm';
import { db } from '@/db';
import { auditLog, users } from '@/db/schema';
import { requireUser } from '@/lib/auth';
import { SECURITY_ORG } from '@/lib/audit';
import { handle, ok, ApiError, ERROR } from '@/lib/http';
export const dynamic = 'force-dynamic';

// 보안 이벤트 열람 — 슈퍼관리자 전용.
// 대상: orgId=SECURITY_ORG(0) sentinel 이벤트 + entity='auth' 이벤트(가입처럼 org 컨텍스트가 붙는 경우 포함).
// detail에는 기록 시점에 이미 마스킹된 값만 저장되어 있다(mask.ts) — 여기서 원문 PII를 만들지 않는다.
export async function GET(req: Request) {
  return handle(async () => {
    const u = await requireUser();
    if (!u.isSuperadmin) throw new ApiError(ERROR.FORBIDDEN, '슈퍼관리자만 열람할 수 있습니다');
    const url = new URL(req.url);
    const event = (url.searchParams.get('event') || '').trim();
    const cursor = Number(url.searchParams.get('cursor') || 0);
    const limitRaw = Number(url.searchParams.get('limit') || 100);
    const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? limitRaw : 100, 1), 200);
    const scope = or(eq(auditLog.orgId, SECURITY_ORG), eq(auditLog.entity, 'auth'));
    const conds = [scope];
    if (event) conds.push(eq(auditLog.event, event));
    if (Number.isFinite(cursor) && cursor > 0) conds.push(lt(auditLog.id, cursor));
    const rows = await db.select({
      id: auditLog.id, orgId: auditLog.orgId, event: auditLog.event, entity: auditLog.entity,
      entityId: auditLog.entityId, detail: auditLog.detail, createdAt: auditLog.createdAt,
      userName: users.name,
    }).from(auditLog).leftJoin(users, eq(auditLog.userId, users.id))
      .where(and(...conds)).orderBy(desc(auditLog.id)).limit(limit);
    return ok({ rows, nextCursor: rows.length === limit ? rows[rows.length - 1].id : null });
  });
}
