import { runMigrations } from '@/lib/migrate';
import { requireUser } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { handle, ok, ApiError, ERROR } from '@/lib/http';
import { auditAdminAccess } from '@/lib/audit';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  return handle(async () => {
    const ctx = await requireTenant(await requireUser());
    if (!ctx.isOrgAdmin && !ctx.user.isSuperadmin) throw new ApiError(ERROR.FORBIDDEN, '관리자만 실행할 수 있습니다');
    await auditAdminAccess(ctx, req);
    const r = await runMigrations();
    return ok(r);
  }, req);
}
