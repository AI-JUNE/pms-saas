import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { projects, phases, tasks, issues, risks, requirements, documents, tests } from '@/db/schema';
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
    const [ph, tk, is, rk, rq, dc, ts] = await Promise.all([
      db.select().from(phases).where(and(eq(phases.orgId, org), eq(phases.projectId, pid))),
      db.select().from(tasks).where(and(eq(tasks.orgId, org), eq(tasks.projectId, pid))),
      db.select().from(issues).where(and(eq(issues.orgId, org), eq(issues.projectId, pid))),
      db.select().from(risks).where(and(eq(risks.orgId, org), eq(risks.projectId, pid))),
      db.select().from(requirements).where(and(eq(requirements.orgId, org), eq(requirements.projectId, pid))),
      db.select().from(documents).where(and(eq(documents.orgId, org), eq(documents.projectId, pid))),
      db.select().from(tests).where(and(eq(tests.orgId, org), eq(tests.projectId, pid))),
    ]);
    const avg = tk.length ? Math.round(tk.reduce((s, t) => s + (t.progress || 0), 0) / tk.length) : 0;
    const starts = tk.map((t) => t.startDate ? new Date(t.startDate).getTime() : null).filter((x): x is number => !!x);
    const ends = tk.map((t) => t.endDate ? new Date(t.endDate).getTime() : null).filter((x): x is number => !!x);
    let plannedPct = 0;
    if (starts.length && ends.length) { const ss = Math.min(...starts), ee = Math.max(...ends), now = Date.now(); plannedPct = ee > ss ? Math.round(Math.max(0, Math.min(1, (now - ss) / (ee - ss))) * 100) : 0; }
    const spi = plannedPct > 0 ? +(avg / plannedPct).toFixed(2) : null;
    // EVM(획득가치) — 공수(계획시간)가 있으면 시간 기준, 없으면 작업 수 기준.
    const sumPlanned = tk.reduce((s, t) => s + (t.plannedHours || 0), 0);
    const sumActual = tk.reduce((s, t) => s + (t.actualHours || 0), 0);
    const useHours = sumPlanned > 0;
    const evmUnit = useHours ? '시간' : '작업';
    const bac = useHours ? sumPlanned : tk.length;
    const ev = useHours
      ? +tk.reduce((s, t) => s + (t.plannedHours || 0) * (t.progress || 0) / 100, 0).toFixed(2)
      : +(tk.reduce((s, t) => s + (t.progress || 0), 0) / 100).toFixed(2);
    const pv = +((bac * plannedPct) / 100).toFixed(2);
    const ac = useHours ? sumActual : null;
    const sv = +(ev - pv).toFixed(2);
    const evmSpi = pv > 0 ? +(ev / pv).toFixed(2) : null;
    const cpi = (useHours && sumActual > 0) ? +(ev / sumActual).toFixed(2) : null;
    // 테스트 실행 리포트 집계
    const tResult = (v: string) => ts.filter((t) => t.result === v).length;
    const tStatus = (v: string) => ts.filter((t) => t.status === v).length;
    const tPass = tResult('pass'), tFail = tResult('fail');
    const tExecuted = tPass + tFail + tResult('blocked');
    const passRate = (tPass + tFail) > 0 ? Math.round(tPass / (tPass + tFail) * 100) : null;
    return ok({
      project: pj,
      phases: { total: ph.length, done: ph.filter((p) => p.status === 'done').length, list: ph.map((p) => ({ id: p.id, code: p.code, name: p.name, status: p.status })) },
      tasks: { total: tk.length, done: tk.filter((t) => t.status === 'done').length, doing: tk.filter((t) => t.status === 'doing').length, avgProgress: avg },
      issues: { total: is.length, open: is.filter((i) => i.status !== 'closed' && i.status !== 'resolved').length, byPriority: { critical: is.filter((i)=>i.priority==='critical').length, high: is.filter((i)=>i.priority==='high').length, medium: is.filter((i)=>i.priority==='medium').length, low: is.filter((i)=>i.priority==='low').length } },
      risks: { total: rk.length, high: rk.filter((r) => r.level === 'high').length, byLevel: { high: rk.filter((r)=>r.level==='high').length, medium: rk.filter((r)=>r.level==='medium').length, low: rk.filter((r)=>r.level==='low').length } },
      requirements: { total: rq.length, approved: rq.filter((r) => r.status === 'approved').length },
      schedule: { plannedPct, actualPct: avg, spi },
      evm: { unit: evmUnit, bac, pv, ev, ac, sv, spi: evmSpi, cpi },
      documents: { total: dc.length, approved: dc.filter((d) => d.status === 'approved').length },
      tests: { total: ts.length, executed: tExecuted, pass: tPass, fail: tFail, blocked: tResult('blocked'), na: tResult('na'), passRate, byStatus: { draft: tStatus('draft'), dev: tStatus('dev'), pl: tStatus('pl'), pm: tStatus('pm'), done: tStatus('done') } },
    });
  });
}
