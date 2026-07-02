import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { projects, phases, tasks, issues, risks, requirements, documents } from '@/db/schema';
import { requireUser } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { handle, ok, ApiError, ERROR } from '@/lib/http';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  return handle(async () => {
    const ctx = await requireTenant(await requireUser());
    const pid = Number(new URL(req.url).searchParams.get('projectId'));
    if (!pid) throw new ApiError(ERROR.VALIDATION, 'projectId가 필요합니다');
    const org = ctx.orgId;
    const [pj] = await db.select().from(projects).where(and(eq(projects.orgId, org), eq(projects.id, pid)));
    if (!pj) throw new ApiError(ERROR.NOT_FOUND, '프로젝트를 찾을 수 없습니다');
    const [ph, tk, is, rk, rq, dc] = await Promise.all([
      db.select().from(phases).where(and(eq(phases.orgId, org), eq(phases.projectId, pid))),
      db.select().from(tasks).where(and(eq(tasks.orgId, org), eq(tasks.projectId, pid))),
      db.select().from(issues).where(and(eq(issues.orgId, org), eq(issues.projectId, pid))),
      db.select().from(risks).where(and(eq(risks.orgId, org), eq(risks.projectId, pid))),
      db.select().from(requirements).where(and(eq(requirements.orgId, org), eq(requirements.projectId, pid))),
      db.select().from(documents).where(and(eq(documents.orgId, org), eq(documents.projectId, pid))),
    ]);
    const avg = tk.length ? Math.round(tk.reduce((s, t) => s + (t.progress || 0), 0) / tk.length) : 0;
    const starts = tk.map((t) => t.startDate ? new Date(t.startDate).getTime() : null).filter((x): x is number => !!x);
    const ends = tk.map((t) => t.endDate ? new Date(t.endDate).getTime() : null).filter((x): x is number => !!x);
    let plannedPct = 0;
    if (starts.length && ends.length) { const ss = Math.min(...starts), ee = Math.max(...ends), now = Date.now(); plannedPct = ee > ss ? Math.round(Math.max(0, Math.min(1, (now - ss) / (ee - ss))) * 100) : 0; }
    const spi = plannedPct > 0 ? +(avg / plannedPct).toFixed(2) : null;
    return ok({
      project: pj,
      phases: { total: ph.length, done: ph.filter((p) => p.status === 'done').length, list: ph.map((p) => ({ id: p.id, code: p.code, name: p.name, status: p.status })) },
      tasks: { total: tk.length, done: tk.filter((t) => t.status === 'done').length, doing: tk.filter((t) => t.status === 'doing').length, avgProgress: avg },
      issues: { total: is.length, open: is.filter((i) => i.status !== 'closed' && i.status !== 'resolved').length },
      risks: { total: rk.length, high: rk.filter((r) => r.level === 'high').length },
      requirements: { total: rq.length, approved: rq.filter((r) => r.status === 'approved').length },
      schedule: { plannedPct, actualPct: avg, spi },
      documents: { total: dc.length, approved: dc.filter((d) => d.status === 'approved').length },
    });
  });
}
