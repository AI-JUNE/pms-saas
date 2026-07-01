import { db } from '@/db';
import { auditLog } from '@/db/schema';
import type { TenantContext } from './tenant';
export async function audit(ctx: TenantContext, event: string, opts: { entity?: string; entityId?: string | number; detail?: unknown } = {}) {
  await db.insert(auditLog).values({ orgId: ctx.orgId, userId: ctx.user.id, event,
    entity: opts.entity, entityId: opts.entityId != null ? String(opts.entityId) : null,
    detail: opts.detail != null ? JSON.stringify(opts.detail) : null });
}
