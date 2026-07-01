import { and, eq, desc } from 'drizzle-orm';
import { db } from '@/db';
import { projects } from '@/db/schema';
import { requireUser } from './auth';
import { requireTenant, type TenantContext } from './tenant';
import { requirePermission } from './rbac';
import { nextSeq, formatCode } from './codegen';
import { audit } from './audit';
import { handle, ok, ApiError, ERROR } from './http';
type Scope = 'org' | 'project';
export type CrudConfig = { table: any; resource: string; scope: Scope; codePrefix?: string; fields: string[]; required?: string[]; transform?: (values: any) => any; };
async function ctxOf(): Promise<TenantContext> { return requireTenant(await requireUser()); }
async function assertProject(orgId: number, projectId: number) {
  const p = (await db.select().from(projects).where(and(eq(projects.id, projectId), eq(projects.orgId, orgId))).limit(1))[0];
  if (!p) throw new ApiError(ERROR.NOT_FOUND, '프로젝트를 찾을 수 없습니다');
}
export function collection(cfg: CrudConfig) {
  const GET = (req: Request) => handle(async () => {
    const ctx = await ctxOf(); const t = cfg.table; const conds = [eq(t.orgId, ctx.orgId)];
    if (cfg.scope === 'project') { const pid = new URL(req.url).searchParams.get('projectId'); if (pid) conds.push(eq(t.projectId, Number(pid))); }
    const rows: any = await db.select().from(t).where(and(...conds)).orderBy(desc(t.id)); return ok(rows);
  });
  const POST = (req: Request) => handle(async () => {
    const ctx = await ctxOf(); await requirePermission(ctx, cfg.resource, 'write');
    const body = await req.json(); const t = cfg.table; const values: any = { orgId: ctx.orgId };
    if (cfg.scope === 'project') { const pid = Number(body.projectId); if (!pid) throw new ApiError(ERROR.VALIDATION, '프로젝트를 선택하세요'); await assertProject(ctx.orgId, pid); values.projectId = pid; }
    for (const f of cfg.fields) if (body[f] !== undefined) values[f] = body[f];
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
    const ctx = await ctxOf(); await requirePermission(ctx, cfg.resource, 'write');
    const t = cfg.table; const body = await req.json(); const patch: any = {};
    for (const f of cfg.fields) if (body[f] !== undefined) patch[f] = body[f];
    if (cfg.transform) Object.assign(patch, cfg.transform({ ...body, ...patch }));
    const upd: any = await db.update(t).set(patch).where(and(eq(t.id, Number(c.params.id)), eq(t.orgId, ctx.orgId))).returning(); const row = upd[0];
    if (!row) throw new ApiError(ERROR.NOT_FOUND, '대상을 찾을 수 없습니다');
    await audit(ctx, `${cfg.resource.toUpperCase()}_UPDATE`, { entity: cfg.resource, entityId: row.id }); return ok(row);
  });
  const DELETE = (_req: Request, c: { params: { id: string } }) => handle(async () => {
    const ctx = await ctxOf(); await requirePermission(ctx, cfg.resource, 'write'); const t = cfg.table;
    const res: any = await db.delete(t).where(and(eq(t.id, Number(c.params.id)), eq(t.orgId, ctx.orgId))).returning();
    if (!res[0]) throw new ApiError(ERROR.NOT_FOUND, '대상을 찾을 수 없습니다');
    await audit(ctx, `${cfg.resource.toUpperCase()}_DELETE`, { entity: cfg.resource, entityId: c.params.id }); return ok();
  });
  return { PATCH, DELETE };
}
export const RISK_TRANSFORM = (v: any) => {
  const p = Number(v.probability) || 3, i = Number(v.impact) || 3; const s = p * i;
  return { probability: p, impact: i, level: s >= 15 ? 'high' : s >= 8 ? 'medium' : 'low' };
};
