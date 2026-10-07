import { and, eq, desc } from 'drizzle-orm';
import { db } from '@/db';
import { attachments } from '@/db/schema';
import { requireUser } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { handle, ok, ApiError, ERROR } from '@/lib/http';
import { audit } from '@/lib/audit';
import { createStorageAdapter, maxAttachmentMb, attachmentRetentionDays, attachmentExpiry, validateAttachmentInput, isAttachableEntity } from '@/lib/attachments';
export const dynamic = 'force-dynamic';

// 첨부 메타데이터 — build now, activate on approval.
// STORAGE_PROVIDER 미설정(기본)이면 파일 본문을 받지 않는다(formData/arrayBuffer 호출 없음). 파일명·크기·형식·만료일만 기록한다.
// 테이블이 아직 없는 배포(ensureSchema 가 돌기 전)에서는 조회가 빈 목록으로, 등록은 명시적 오류로 떨어진다 — 조용히 성공하지 않는다.
const RESOURCE_OF: Record<string, string> = { issues: 'issue', documents: 'document' };

export async function GET(req: Request) {
  return handle(async () => {
    const ctx = await requireTenant(await requireUser());
    const u = new URL(req.url);
    const entity = String(u.searchParams.get('entity') || '');
    const entityId = Number(u.searchParams.get('entityId'));
    if (!isAttachableEntity(entity) || !Number.isInteger(entityId) || entityId <= 0) throw new ApiError(ERROR.VALIDATION, 'entity/entityId 가 올바르지 않습니다');
    const adapter = createStorageAdapter(process.env);
    let rows: any[] = [];
    try {
      rows = await db.select().from(attachments)
        .where(and(eq(attachments.orgId, ctx.orgId), eq(attachments.entity, entity), eq(attachments.entityId, entityId)))
        .orderBy(desc(attachments.id));
    } catch (e: any) {
      console.error('[attachments] 조회 실패(테이블 미생성?)', String(e?.message || e));
      return ok({ rows: [], storage: { provider: adapter.kind, canStore: adapter.canStore, notice: adapter.notice }, unavailable: true });
    }
    return ok({ rows, storage: { provider: adapter.kind, canStore: adapter.canStore, notice: adapter.notice, maxMb: maxAttachmentMb(process.env) } });
  }, req);
}

export async function POST(req: Request) {
  return handle(async () => {
    const ctx = await requireTenant(await requireUser());
    const body = await req.json();
    const entity = String(body?.entity || '');
    if (!isAttachableEntity(entity)) throw new ApiError(ERROR.VALIDATION, '첨부를 지원하지 않는 대상입니다');
    await requirePermission(ctx, RESOURCE_OF[entity], 'write');
    const maxBytes = maxAttachmentMb(process.env) * 1024 * 1024;
    const v = validateAttachmentInput({ entity, entityId: body?.entityId, filename: body?.filename, size: body?.size, mime: body?.mime }, { maxBytes });
    if (!v.ok) throw new ApiError(ERROR.VALIDATION, v.errors.map((e) => e.message).join(' · '), { fields: v.errors });
    const adapter = createStorageAdapter(process.env);
    const retention = attachmentRetentionDays(process.env);
    const now = new Date();
    let row: any;
    try {
      const ins: any[] = await db.insert(attachments).values({
        orgId: ctx.orgId, entity: v.value.entity, entityId: v.value.entityId,
        filename: v.value.filename, size: v.value.size, mime: v.value.mime,
        provider: adapter.kind, storageKey: null, status: adapter.status,
        expiresAt: attachmentExpiry(now, retention.days),
        uploadedBy: ctx.user.id, uploaderName: ctx.user.name,
      }).returning();
      row = ins[0];
    } catch (e: any) {
      console.error('[attachments] 등록 실패(테이블 미생성?)', String(e?.message || e));
      throw new ApiError(ERROR.SERVER, '첨부 기록을 저장할 수 없습니다. 관리자에게 「스키마 업데이트」 실행을 요청하세요');
    }
    await audit(ctx, 'ATTACHMENT_CREATE', { entity: 'attachments', entityId: row.id, detail: { target: `${entity}#${v.value.entityId}`, status: adapter.status, size: v.value.size } });
    return ok({ ...row, notice: adapter.notice }, 201);
  }, req);
}
