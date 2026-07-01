import { requireUser } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { seedDemo } from '@/lib/demoSeed';
import { handle, ok, ApiError, ERROR } from '@/lib/http';
export const dynamic = 'force-dynamic';
export async function POST() {
  return handle(async () => {
    const ctx = await requireTenant(await requireUser());
    if (!ctx.isOrgAdmin && !ctx.user.isSuperadmin) throw new ApiError(ERROR.FORBIDDEN, '관리자만 실행할 수 있습니다');
    await seedDemo(ctx.orgId, ctx.user.id);
    return ok();
  });
}
