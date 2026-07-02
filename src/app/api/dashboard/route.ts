import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { projects, requirements, issues, risks, tasks, documents } from '@/db/schema';
import { requireUser } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { handle, ok } from '@/lib/http';
export const dynamic = 'force-dynamic';

export async function GET() {
  return handle(async () => {
    const ctx = await requireTenant(await requireUser());
    const org = ctx.orgId, me = ctx.user.name;
    const [pj, rq, is, rk, tk, dc] = await Promise.all([
      db.select().from(projects).where(eq(projects.orgId, org)),
      db.select().from(requirements).where(eq(requirements.orgId, org)),
      db.select().from(issues).where(eq(issues.orgId, org)),
      db.select().from(risks).where(eq(risks.orgId, org)),
      db.select().from(tasks).where(eq(tasks.orgId, org)),
      db.select().from(documents).where(eq(documents.orgId, org)),
    ]);
    return ok({
      projects: pj, requirements: rq, issues: is, risks: rk, tasks: tk, documents: dc,
      myWork: { tasks: tk.filter((t) => t.assignee === me), issues: is.filter((i) => i.assignee === me) },
    });
  });
}
