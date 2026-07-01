import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { memberships, users } from '@/db/schema';
import { requireUser } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { handle, ok, ApiError, ERROR } from '@/lib/http';
export const dynamic = 'force-dynamic';
export async function GET() {
  return handle(async () => {
    const ctx = await requireTenant(await requireUser());
    const rows = await db.select({
      membershipId: memberships.id, userId: users.id, name: users.name, email: users.email,
      role: memberships.role, isOrgAdmin: memberships.isOrgAdmin, isActive: users.isActive, createdAt: users.createdAt,
    }).from(memberships).innerJoin(users, eq(memberships.userId, users.id)).where(eq(memberships.orgId, ctx.orgId));
    return ok(rows);
  });
}
export async function PATCH(req: Request) {
  return handle(async () => {
    const ctx = await requireTenant(await requireUser());
    if (!ctx.isOrgAdmin && !ctx.user.isSuperadmin) throw new ApiError(ERROR.FORBIDDEN, '관리자만 변경할 수 있습니다');
    const { membershipId, role } = await req.json();
    if (!membershipId || !role) throw new ApiError(ERROR.VALIDATION, '값을 입력하세요');
    await db.update(memberships).set({ role, isOrgAdmin: role === 'admin' })
      .where(and(eq(memberships.id, Number(membershipId)), eq(memberships.orgId, ctx.orgId)));
    return ok();
  });
}
