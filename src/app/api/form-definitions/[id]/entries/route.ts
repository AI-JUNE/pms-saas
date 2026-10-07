import { and, eq, desc } from 'drizzle-orm';
import { db } from '@/db';
import { formDefinitions, formEntries } from '@/db/schema';
import { requireUser } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { handle, ok, ApiError, ERROR } from '@/lib/http';
import { audit } from '@/lib/audit';
import { parseFieldDefs, validateFormValues } from '@/lib/formRender';
export const dynamic = 'force-dynamic';

// 커스텀 양식 입력(form_entries) — 정의(form_definitions.fields)대로 **서버에서 다시 검증**해 저장한다.
// ?documentId= 로 특정 산출물에 매인 입력만 조회할 수 있다. 테이블이 없는 배포에서는 조회가 빈 목록(unavailable:true).

async function loadDef(orgId: number, id: number) {
  return (await db.select().from(formDefinitions).where(and(eq(formDefinitions.id, id), eq(formDefinitions.orgId, orgId))).limit(1))[0];
}

export async function GET(req: Request, c: { params: { id: string } }) {
  return handle(async () => {
    const ctx = await requireTenant(await requireUser());
    const defId = Number(c.params.id);
    if (!Number.isInteger(defId) || defId <= 0) throw new ApiError(ERROR.VALIDATION, '양식이 올바르지 않습니다');
    const def = await loadDef(ctx.orgId, defId);
    if (!def) throw new ApiError(ERROR.NOT_FOUND, '양식을 찾을 수 없습니다');
    const parsed = parseFieldDefs(def.fields);
    const docParam = new URL(req.url).searchParams.get('documentId');
    const docId = docParam ? Number(docParam) : null;
    const conds = [eq(formEntries.orgId, ctx.orgId), eq(formEntries.formDefinitionId, defId)];
    if (docId && Number.isInteger(docId) && docId > 0) conds.push(eq(formEntries.documentId, docId));
    let rows: any[] = [];
    try {
      rows = await db.select().from(formEntries).where(and(...conds)).orderBy(desc(formEntries.id));
    } catch (e: any) {
      console.error('[form-entries] 조회 실패(테이블 미생성?)', String(e?.message || e));
      return ok({ defs: parsed.defs, format: parsed.format, problems: parsed.problems, rows: [], unavailable: true });
    }
    return ok({ defs: parsed.defs, format: parsed.format, problems: parsed.problems, rows });
  });
}

export async function POST(req: Request, c: { params: { id: string } }) {
  return handle(async () => {
    const ctx = await requireTenant(await requireUser());
    await requirePermission(ctx, 'document', 'write');
    const defId = Number(c.params.id);
    const def = await loadDef(ctx.orgId, defId);
    if (!def) throw new ApiError(ERROR.NOT_FOUND, '양식을 찾을 수 없습니다');
    const parsed = parseFieldDefs(def.fields);
    if (!parsed.defs.length) throw new ApiError(ERROR.VALIDATION, '양식에 정의된 항목이 없습니다. 먼저 양식 항목을 구성하세요');
    const body = await req.json();
    const result = validateFormValues(parsed.defs, body?.values && typeof body.values === 'object' ? body.values : {});
    if (!result.ok) throw new ApiError(ERROR.VALIDATION, result.errors.map((e) => e.message).join(' · '), { fields: result.errors });
    const docIdRaw = body?.documentId;
    const documentId = docIdRaw != null && docIdRaw !== '' && Number.isInteger(Number(docIdRaw)) && Number(docIdRaw) > 0 ? Number(docIdRaw) : null;
    let row: any;
    try {
      const ins: any[] = await db.insert(formEntries).values({
        orgId: ctx.orgId, projectId: def.projectId, formDefinitionId: defId, documentId,
        data: JSON.stringify(result.values), createdBy: ctx.user.id, authorName: ctx.user.name,
      }).returning();
      row = ins[0];
    } catch (e: any) {
      console.error('[form-entries] 저장 실패(테이블 미생성?)', String(e?.message || e));
      throw new ApiError(ERROR.SERVER, '양식 입력을 저장할 수 없습니다. 관리자에게 「스키마 업데이트」 실행을 요청하세요');
    }
    await audit(ctx, 'FORMENTRY_CREATE', { entity: 'formDefinitions', entityId: defId, detail: { entryId: row.id, documentId, fields: parsed.defs.length } });
    return ok(row, 201);
  });
}
