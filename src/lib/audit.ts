import { db } from '@/db';
import { auditLog } from '@/db/schema';
import type { TenantContext } from './tenant';
import { ADMIN_AUDIT_ENTITY, accessMeta, adminAccessEvent, sanitizeAccessDetail } from './auditAccess';

// 조직 컨텍스트가 없는 보안/시스템 이벤트용 sentinel orgId (audit_log.org_id는 FK가 아님)
export const SECURITY_ORG = 0;

// 감사로그 기록 실패가 본 트랜잭션(로그인/CRUD 등)을 깨뜨리지 않도록 무해화한다.
async function insertAudit(values: { orgId: number; userId: number | null; event: string; entity: string | null; entityId: string | null; detail: string | null }) {
  try { await db.insert(auditLog).values(values); }
  catch (e) { console.error('[audit] insert 실패', e); }
}

export async function audit(ctx: TenantContext, event: string, opts: { entity?: string; entityId?: string | number; detail?: unknown } = {}) {
  await insertAudit({ orgId: ctx.orgId, userId: ctx.user.id, event,
    entity: opts.entity ?? null, entityId: opts.entityId != null ? String(opts.entityId) : null,
    detail: opts.detail != null ? JSON.stringify(opts.detail) : null });
}

/**
 * 관리 기능 접근 이력 — 열람(GET)까지 포함해 기록한다.
 * 이벤트명은 요청 경로/메서드에서 파생하며, detail은 sanitizeAccessDetail로 PII·비밀값을 제거한다.
 * 실패해도 본 요청을 깨뜨리지 않는다(insertAudit이 흡수).
 */
export async function auditAdminAccess(
  ctx: TenantContext,
  req: Request,
  opts: { entityId?: string | number; detail?: Record<string, unknown> } = {},
) {
  const url = new URL(req.url);
  const event = adminAccessEvent(url.pathname, req.method);
  const detail = { ...accessMeta(req), ...sanitizeAccessDetail(opts.detail) };
  await insertAudit({
    orgId: ctx.orgId,
    userId: ctx.user.id,
    event,
    entity: ADMIN_AUDIT_ENTITY,
    entityId: opts.entityId != null ? String(opts.entityId) : null,
    detail: JSON.stringify(detail),
  });
}

// 인증·결제 등 조직 컨텍스트가 아직 없는 시점의 보안 이벤트 기록.
// PII 원문 저장 금지 — 이메일 등은 호출부에서 maskEmail로 마스킹해 detail에 담는다.
export async function auditSecurity(event: string, opts: { userId?: number | null; orgId?: number; entity?: string; entityId?: string | number; detail?: unknown } = {}) {
  await insertAudit({ orgId: opts.orgId ?? SECURITY_ORG, userId: opts.userId ?? null, event,
    entity: opts.entity ?? 'auth', entityId: opts.entityId != null ? String(opts.entityId) : null,
    detail: opts.detail != null ? JSON.stringify(opts.detail) : null });
}
