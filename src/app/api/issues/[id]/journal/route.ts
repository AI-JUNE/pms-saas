import { and, eq, desc } from 'drizzle-orm';
import { db } from '@/db';
import { issueJournals } from '@/db/schema';
import { requireUser } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { handle, ok } from '@/lib/http';
export const dynamic = 'force-dynamic';
export async function GET(_req: Request, c: { params: { id: string } }) {
  return handle(async () => {
    const ctx = await requireTenant(await requireUser());
    const rows = await db.select().from(issueJournals)
      .where(and(eq(issueJournals.orgId, ctx.orgId), eq(issueJournals.issueId, Number(c.params.id))))
      .orderBy(desc(issueJournals.id));
    return ok(rows);
  });
}
