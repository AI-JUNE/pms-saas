import { and, eq, desc } from 'drizzle-orm';
import { db } from '@/db';
import { auditLog, users } from '@/db/schema';
import { requireUser } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { handle, ok } from '@/lib/http';
export const dynamic = 'force-dynamic';
export async function GET() {
  return handle(async () => {
    const ctx = await requireTenant(await requireUser());
    const rows = await db.select({
      id: auditLog.id, event: auditLog.event, entity: auditLog.entity, entityId: auditLog.entityId,
      createdAt: auditLog.createdAt, userName: users.name,
    }).from(auditLog).leftJoin(users, eq(auditLog.userId, users.id))
      .where(eq(auditLog.orgId, ctx.orgId)).orderBy(desc(auditLog.id)).limit(100);
    return ok(rows);
  });
}
