import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { organizations } from '@/db/schema';
import { requireUser } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { handle, ok, ApiError, ERROR } from '@/lib/http';
export const dynamic = 'force-dynamic';
export async function GET() {
  return handle(async () => {
    const ctx = await requireTenant(await requireUser());
    const org = (await db.select().from(organizations).where(eq(organizations.id, ctx.orgId)).limit(1))[0];
    return ok({ org, role: ctx.role, isOrgAdmin: ctx.isOrgAdmin });
  });
}
export async function PATCH(req: Request) {
  return handle(async () => {
    const ctx = await requireTenant(await requireUser());
    if (!ctx.isOrgAdmin && !ctx.user.isSuperadmin) throw new ApiError(ERROR.FORBIDDEN, '관리자만 변경할 수 있습니다');
    const { name } = await req.json();
    if (name) await db.update(organizations).set({ name }).where(eq(organizations.id, ctx.orgId));
    return ok();
  });
}
