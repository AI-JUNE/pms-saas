import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { members, tasks, issues } from '@/db/schema';
import { requireUser } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { handle, ok } from '@/lib/http';
export const dynamic = 'force-dynamic';

export async function GET() {
  return handle(async () => {
    const ctx = await requireTenant(await requireUser());
    const org = ctx.orgId;
    const [mem, tk, is] = await Promise.all([
      db.select().from(members).where(eq(members.orgId, org)),
      db.select().from(tasks).where(eq(tasks.orgId, org)),
      db.select().from(issues).where(eq(issues.orgId, org)),
    ]);
    const map: Record<string, any> = {};
    const ensure = (n?: string | null) => { if (!n) return null; if (!map[n]) map[n] = { name: n, taskOpen: 0, taskDone: 0, issueOpen: 0 }; return map[n]; };
    for (const m of mem) ensure(m.name);
    for (const t of tk) { const e = ensure(t.assignee); if (e) { if (t.status === 'done') e.taskDone++; else e.taskOpen++; } }
    for (const i of is) { const e = ensure(i.assignee); if (e && !['resolved', 'closed'].includes(i.status)) e.issueOpen++; }
    const rows = Object.values(map).sort((a: any, b: any) => (b.taskOpen + b.issueOpen) - (a.taskOpen + a.issueOpen));
    return ok(rows);
  });
}
