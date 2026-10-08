import { and, eq, desc, gte, lt, or, like, type SQL } from 'drizzle-orm';
import { db } from '@/db';
import { auditLog, users } from '@/db/schema';
import { requireUser } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { assertScreenAccess } from '@/lib/rbac';
import { handle, ok } from '@/lib/http';
import { auditAdminAccess } from '@/lib/audit';
import { parseAuditFilters, actionPatterns, escapeLike, dayStart, dayAfter, hasActiveFilter, auditRetentionStatus } from '@/lib/auditQuery';
import { captureStatus, oldestIdOf } from '@/lib/incidentEvidence';
export const dynamic = 'force-dynamic';

// 감사로그 검색 — 필터는 lib/auditQuery 가 해석한 값만 SQL 조건으로 쓴다. 읽기 전용(쓰기·삭제 없음).
// 보존정책은 응답에 함께 실어 보내되(decided:false = 운영 확정 전 기본값) 정리 작업은 수행하지 않는다 [승인 사항].
// `capture` 는 이 결과가 limit 에서 **잘렸는지**를 판정해 함께 내보낸다(lib/incidentEvidence).
// 정렬이 desc(id) 라 잘리는 쪽은 가장 오래된 기록 — RUNBOOK §3 1단계가 보라고 한 「T 직전」이다.
// 추가 조회 0: 이미 받은 행 수·id 만 본다.
export async function GET(req: Request) {
  return handle(async () => {
    const ctx = await requireTenant(await requireUser());
    assertScreenAccess(ctx, '/audit');
    const f = parseAuditFilters(new URL(req.url).searchParams);
    const conds: SQL[] = [eq(auditLog.orgId, ctx.orgId)];
    if (f.actorId) conds.push(eq(auditLog.userId, f.actorId));
    if (f.action) { const pats = actionPatterns(f.action).map((p) => like(auditLog.event, p)); conds.push(pats.length === 1 ? pats[0] : (or(...pats) as SQL)); }
    if (f.entity) conds.push(eq(auditLog.entity, f.entity));
    if (f.entityId) conds.push(eq(auditLog.entityId, f.entityId));
    if (f.from) conds.push(gte(auditLog.createdAt, dayStart(f.from)));
    if (f.to) conds.push(lt(auditLog.createdAt, dayAfter(f.to)));
    if (f.cursor) conds.push(lt(auditLog.id, f.cursor));
    if (f.q) { const p = `%${escapeLike(f.q)}%`; conds.push(or(like(auditLog.event, p.toUpperCase()), like(auditLog.event, p), like(auditLog.entityId, p), like(auditLog.entity, p)) as SQL); }
    const rows = await db.select({
      id: auditLog.id, event: auditLog.event, entity: auditLog.entity, entityId: auditLog.entityId,
      detail: auditLog.detail, createdAt: auditLog.createdAt, userId: auditLog.userId, userName: users.name,
    }).from(auditLog).leftJoin(users, eq(auditLog.userId, users.id))
      .where(and(...conds)).orderBy(desc(auditLog.id)).limit(f.limit);
    const capture = captureStatus({ rowCount: rows.length, limit: f.limit, oldestId: oldestIdOf(rows), bounded: !!(f.from || f.to) });
    await auditAdminAccess(ctx, req, { detail: { count: rows.length, filtered: hasActiveFilter(f), truncated: capture.reachedLimit } });
    return ok({ rows, capture, retention: auditRetentionStatus(process.env), problems: f.problems, filters: { ...f, problems: undefined } });
  }, req);
}
