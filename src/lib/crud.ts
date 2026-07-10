import { and, eq, desc, asc } from 'drizzle-orm';
import { db } from '@/db';
import { projects, tasks, phases, issueJournals } from '@/db/schema';
import { requireUser } from './auth';
import { requireTenant, type TenantContext } from './tenant';
import { requirePermission } from './rbac';
import { nextSeq, formatCode } from './codegen';
import { audit } from './audit';
import { handle, ok, ApiError, ERROR } from './http';
type Scope = 'org' | 'project' | 'user';
// approveOn: 지정 필드 값이 목록에 포함되면 'write'가 아닌 'approve' 권한을 요구(결재 경계)
export type CrudConfig = { table: any; resource: string; scope: Scope; codePrefix?: string; fields: string[]; required?: string[]; transform?: (values: any) => any; orderAsc?: boolean; guardDelete?: (ctx: TenantContext, id: number) => Promise<void>; approveOn?: { field: string; values: string[] }; journal?: boolean; };
async function ctxOf(): Promise<TenantContext> { return requireTenant(await requireUser()); }
async function assertProject(orgId: number, projectId: number) {
  const p = (await db.select().from(projects).where(and(eq(projects.id, projectId), eq(projects.orgId, orgId))).limit(1))[0];
  if (!p) throw new ApiError(ERROR.NOT_FOUND, '프로젝트를 찾을 수 없습니다');
}
export function collection(cfg: CrudConfig) {
  const GET = (req: Request) => handle(async () => {
    const ctx = await ctxOf(); const t = cfg.table; const conds = [eq(t.orgId, ctx.orgId)];
    if (cfg.scope === 'project') { const pid = new URL(req.url).searchParams.get('projectId'); if (pid) conds.push(eq(t.projectId, Number(pid))); }
    if (cfg.scope === 'user') conds.push(eq(t.userId, ctx.user.id));
    const rows: any = await db.select().from(t).where(and(...conds)).orderBy(cfg.orderAsc ? asc(t.id) : desc(t.id)); return ok(rows);
  });
  const POST = (req: Request) => handle(async () => {
    const ctx = await ctxOf(); if (cfg.scope !== 'user') await requirePermission(ctx, cfg.resource, 'write');
    const body = await req.json(); const t = cfg.table; const values: any = { orgId: ctx.orgId };
    if (cfg.scope === 'project') { const pid = Number(body.projectId); if (!pid) throw new ApiError(ERROR.VALIDATION, '프로젝트를 선택하세요'); await assertProject(ctx.orgId, pid); values.projectId = pid; }
    if (cfg.scope === 'user') values.userId = ctx.user.id;
    for (const f of cfg.fields) if (body[f] !== undefined && body[f] !== '') values[f] = body[f];
    for (const r of cfg.required ?? []) if (values[r] === undefined || values[r] === '') throw new ApiError(ERROR.VALIDATION, `필수 항목을 입력하세요`);
    if (cfg.transform) Object.assign(values, cfg.transform(values));
    if (cfg.codePrefix) { const key = cfg.scope === 'project' ? `${cfg.codePrefix}:${values.projectId}` : cfg.codePrefix; values.code = formatCode(cfg.codePrefix, await nextSeq(ctx.orgId, key)); }
    const ins: any = await db.insert(t).values(values).returning(); const row = ins[0];
    await audit(ctx, `${cfg.resource.toUpperCase()}_CREATE`, { entity: cfg.resource, entityId: row.id }); return ok(row, 201);
  });
  return { GET, POST };
}
export function item(cfg: CrudConfig) {
  const PATCH = (req: Request, c: { params: { id: string } }) => handle(async () => {
    const ctx = await ctxOf(); if (cfg.scope !== 'user') await requirePermission(ctx, cfg.resource, 'write');
    const t = cfg.table; const body = await req.json(); const patch: any = {};
    // 결재(승인/반려) 경계: 상태를 결재 확정값으로 바꾸는 경우 'approve' 권한 추가 요구
    if (cfg.approveOn && cfg.approveOn.values.includes(body[cfg.approveOn.field])) await requirePermission(ctx, cfg.resource, 'approve');
    const before: any = cfg.journal ? (await db.select().from(t).where(and(eq(t.id, Number(c.params.id)), eq(t.orgId, ctx.orgId))).limit(1))[0] : null;
    for (const f of cfg.fields) if (body[f] !== undefined && body[f] !== null && body[f] !== '') patch[f] = body[f];
    if (cfg.transform) Object.assign(patch, cfg.transform({ ...body, ...patch }));
    const uw: any[] = [eq(t.id, Number(c.params.id)), eq(t.orgId, ctx.orgId)]; if (cfg.scope === 'user') uw.push(eq(t.userId, ctx.user.id)); const upd: any = await db.update(t).set(patch).where(and(...uw)).returning(); const row = upd[0];
    if (!row) throw new ApiError(ERROR.NOT_FOUND, '대상을 찾을 수 없습니다');
    if (cfg.journal && before) {
      const changes: { field: string; from: any; to: any }[] = [];
      for (const f of cfg.fields) { if (patch[f] !== undefined && String(before[f] ?? '') !== String(row[f] ?? '')) changes.push({ field: f, from: before[f] ?? null, to: row[f] ?? null }); }
      if (changes.length) { try { await db.insert(issueJournals).values({ orgId: ctx.orgId, issueId: row.id, userId: ctx.user.id, authorName: ctx.user.name, changes: JSON.stringify(changes) }); } catch (e) { console.error('[journal] insert 실패', e); } }
    }
    await audit(ctx, `${cfg.resource.toUpperCase()}_UPDATE`, { entity: cfg.resource, entityId: row.id }); return ok(row);
  });
  const DELETE = (_req: Request, c: { params: { id: string } }) => handle(async () => {
    const ctx = await ctxOf(); if (cfg.scope !== 'user') await requirePermission(ctx, cfg.resource, 'write'); const t = cfg.table;
    if (cfg.guardDelete) await cfg.guardDelete(ctx, Number(c.params.id));
    const dw: any[] = [eq(t.id, Number(c.params.id)), eq(t.orgId, ctx.orgId)]; if (cfg.scope === 'user') dw.push(eq(t.userId, ctx.user.id)); const res: any = await db.delete(t).where(and(...dw)).returning();
    if (!res[0]) throw new ApiError(ERROR.NOT_FOUND, '대상을 찾을 수 없습니다');
    await audit(ctx, `${cfg.resource.toUpperCase()}_DELETE`, { entity: cfg.resource, entityId: c.params.id }); return ok();
  });
  return { PATCH, DELETE };
}
export const RISK_TRANSFORM = (v: any) => {
  const p = Number(v.probability) || 3, i = Number(v.impact) || 3; const s = p * i;
  return { probability: p, impact: i, level: s >= 15 ? 'high' : s >= 8 ? 'medium' : 'low' };
};
export const DOCUMENTS_TRANSFORM = (v: any) => {
  if (v.status === 'approved') return { approvedAt: new Date() };
  if (v.status === 'rejected' || v.status === 'draft' || v.status === 'review') return { approvedAt: null };
  return {};
};
// ---- 삭제 정합성 가드 (관련 데이터가 남아있으면 삭제 차단) ----
// 상위 작업 삭제 시 하위 작업 고아 방지: parentId가 이 작업을 가리키는 하위 작업이 있으면 차단
export const GUARD_TASK_CHILDREN = async (ctx: TenantContext, id: number) => {
  const dep = await db.select({ id: tasks.id }).from(tasks)
    .where(and(eq(tasks.orgId, ctx.orgId), eq(tasks.parentId, id))).limit(1);
  if (dep[0]) throw new ApiError(ERROR.VALIDATION, '하위 작업이 있어 삭제할 수 없습니다. 먼저 하위 작업을 삭제하거나 상위 작업을 변경하세요');
};
// 단계 삭제 시 해당 단계를 사용하는 업무가 있으면 차단(업무의 phase 텍스트=단계명)
export const GUARD_PHASE_IN_USE = async (ctx: TenantContext, id: number) => {
  const ph = (await db.select({ name: phases.name }).from(phases)
    .where(and(eq(phases.id, id), eq(phases.orgId, ctx.orgId))).limit(1))[0];
  if (!ph) return;
  const dep = await db.select({ id: tasks.id }).from(tasks)
    .where(and(eq(tasks.orgId, ctx.orgId), eq(tasks.phase, ph.name))).limit(1);
  if (dep[0]) throw new ApiError(ERROR.VALIDATION, '이 단계를 사용 중인 업무가 있어 삭제할 수 없습니다. 먼저 해당 업무의 단계를 변경하세요');
};
