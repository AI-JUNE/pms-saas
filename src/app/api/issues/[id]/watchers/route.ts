import { and, eq, asc } from 'drizzle-orm';
import { db } from '@/db';
import { issueWatchers } from '@/db/schema';
import { requireUser } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { handle, ok } from '@/lib/http';
export const dynamic = 'force-dynamic';
export async function GET(_req: Request, c: { params: { id: string } }) {
  return handle(async () => {
    const ctx = await requireTenant(await requireUser());
    const issueId = Number(c.params.id);
    const rows = await db.select().from(issueWatchers)
      .where(and(eq(issueWatchers.orgId, ctx.orgId), eq(issueWatchers.issueId, issueId)))
      .orderBy(asc(issueWatchers.id));
    return ok({ watchers: rows, watching: rows.some((w) => w.userId === ctx.user.id) });
  });
}
// 현재 사용자의 관심(watch) 상태 토글
export async function POST(_req: Request, c: { params: { id: string } }) {
  return handle(async () => {
    const ctx = await requireTenant(await requireUser());
    const issueId = Number(c.params.id);
    const existing = (await db.select().from(issueWatchers)
      .where(and(eq(issueWatchers.orgId, ctx.orgId), eq(issueWatchers.issueId, issueId), eq(issueWatchers.userId, ctx.user.id))).limit(1))[0];
    if (existing) {
      await db.delete(issueWatchers).where(eq(issueWatchers.id, existing.id));
      return ok({ watching: false });
    }
    await db.insert(issueWatchers).values({ orgId: ctx.orgId, issueId, userId: ctx.user.id, userName: ctx.user.name });
    return ok({ watching: true });
  });
}
