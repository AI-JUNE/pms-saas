import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { projects, tasks, issues, risks } from '@/db/schema';
import { requireUser } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { handle, ok } from '@/lib/http';
export const dynamic = 'force-dynamic';

export async function GET() {
  return handle(async () => {
    const ctx = await requireTenant(await requireUser());
    const org = ctx.orgId; const me = ctx.user.name;
    const [pj, tk, is, rk] = await Promise.all([
      db.select().from(projects).where(eq(projects.orgId, org)),
      db.select().from(tasks).where(and(eq(tasks.orgId, org), eq(tasks.assignee, me))),
      db.select().from(issues).where(and(eq(issues.orgId, org), eq(issues.assignee, me))),
      db.select().from(risks).where(and(eq(risks.orgId, org), eq(risks.owner, me))),
    ]);
    const pmap: Record<number, string> = {}; for (const p of pj) pmap[p.id] = p.code || '';
    const tag = (r: any) => ({ ...r, projectCode: pmap[r.projectId] || '' });
    return ok({ name: me, tasks: tk.map(tag), issues: is.map(tag), risks: rk.map(tag) });
  });
}
