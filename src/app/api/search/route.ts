import { and, eq, or, ilike } from 'drizzle-orm';
import { db } from '@/db';
import { projects, issues, requirements, risks, tasks, documents, members, meetings } from '@/db/schema';
import { requireUser } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { handle, ok } from '@/lib/http';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  return handle(async () => {
    const ctx = await requireTenant(await requireUser());
    const q = (new URL(req.url).searchParams.get('q') || '').trim();
    if (q.length < 1) return ok([]);
    const like = `%${q}%`;
    const org = ctx.orgId;
    const [pj, is, rq, rk, tk, dc, mb, mt] = await Promise.all([
      db.select().from(projects).where(and(eq(projects.orgId, org), or(ilike(projects.name, like), ilike(projects.code, like)))).limit(5),
      db.select().from(issues).where(and(eq(issues.orgId, org), or(ilike(issues.title, like), ilike(issues.code, like)))).limit(6),
      db.select().from(requirements).where(and(eq(requirements.orgId, org), or(ilike(requirements.title, like), ilike(requirements.code, like)))).limit(5),
      db.select().from(risks).where(and(eq(risks.orgId, org), or(ilike(risks.title, like), ilike(risks.code, like)))).limit(5),
      db.select().from(tasks).where(and(eq(tasks.orgId, org), or(ilike(tasks.name, like), ilike(tasks.code, like)))).limit(5),
      db.select().from(documents).where(and(eq(documents.orgId, org), or(ilike(documents.title, like), ilike(documents.code, like)))).limit(5),
      db.select().from(members).where(and(eq(members.orgId, org), ilike(members.name, like))).limit(5),
      db.select().from(meetings).where(and(eq(meetings.orgId, org), or(ilike(meetings.title, like), ilike(meetings.code, like)))).limit(5),
    ]);
    const out: any[] = [];
    const add = (rows: any[], type: string, href: string, tf: string) => { for (const r of rows) out.push({ type, code: r.code, title: r[tf], href }); };
    add(pj, 'project', '/projects', 'name');
    add(is, 'issue', '/issues', 'title');
    add(rq, 'requirement', '/requirements', 'title');
    add(rk, 'risk', '/risks', 'title');
    add(tk, 'task', '/tasks', 'name');
    add(dc, 'document', '/documents', 'title');
    add(mb, 'member', '/members', 'name');
    add(mt, 'meeting', '/meetings', 'title');
    return ok(out);
  });
}
