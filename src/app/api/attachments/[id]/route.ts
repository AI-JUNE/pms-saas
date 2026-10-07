import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { attachments } from '@/db/schema';
import { requireUser } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { handle, ok, ApiError, ERROR } from '@/lib/http';
import { audit } from '@/lib/audit';
export const dynamic = 'force-dynamic';
const RESOURCE_OF: Record<string, string> = { issues: 'issue', documents: 'document' };

// 첨부 기록 삭제 — 메타데이터 전용이라 지울 파일 본문은 없다. 저장소가 붙으면 여기서 어댑터 delete 를 함께 호출한다.
export async function DELETE(req: Request, c: { params: { id: string } }) {
  return handle(async () => {
    const ctx = await requireTenant(await requireUser());
    const id = Number(c.params.id);
    if (!Number.isInteger(id) || id <= 0) throw new ApiError(ERROR.VALIDATION, '대상이 올바르지 않습니다');
    const row = (await db.select().from(attachments).where(and(eq(attachments.id, id), eq(attachments.orgId, ctx.orgId))).limit(1))[0];
    if (!row) throw new ApiError(ERROR.NOT_FOUND, '첨부를 찾을 수 없습니다');
    // 올린 사람 본인이 아니면 해당 리소스 쓰기 권한이 필요하다
    if (row.uploadedBy !== ctx.user.id) await requirePermission(ctx, RESOURCE_OF[row.entity] ?? row.entity, 'write');
    await db.delete(attachments).where(and(eq(attachments.id, id), eq(attachments.orgId, ctx.orgId)));
    await audit(ctx, 'ATTACHMENT_DELETE', { entity: 'attachments', entityId: id, detail: { target: `${row.entity}#${row.entityId}` } });
    return ok();
  }, req);
}
