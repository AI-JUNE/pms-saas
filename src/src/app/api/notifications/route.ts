import { and, eq, desc } from 'drizzle-orm';
import { db } from '@/db';
import { notifications } from '@/db/schema';
import { requireUser } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { handle, ok } from '@/lib/http';
export const dynamic = 'force-dynamic';
export async function GET() {
  return handle(async () => {
    const ctx = await requireTenant(await requireUser());
    const rows = await db.select().from(notifications).where(and(eq(notifications.orgId, ctx.orgId), eq(notifications.userId, ctx.user.id))).orderBy(desc(notifications.id)).limit(50);
    return ok(rows);
  });
}
export async function POST() {
  return handle(async () => {
    const ctx = await requireTenant(await requireUser());
    await db.update(notifications).set({ isRead: true }).where(and(eq(notifications.orgId, ctx.orgId), eq(notifications.userId, ctx.user.id)));
    return ok();
  });
}
