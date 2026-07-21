import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { memberships, users } from '@/db/schema';
import { requireUser, hashPassword } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { handle, ok, ApiError, ERROR } from '@/lib/http';
export const dynamic = 'force-dynamic';
const genTemp = () => 'pms-' + Math.random().toString(36).slice(2, 8);
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
    const body = await req.json();
    const membershipId = Number(body.membershipId);
    if (!membershipId) throw new ApiError(ERROR.VALIDATION, '대상을 지정하세요');
    const m = (await db.select().from(memberships).where(and(eq(memberships.id, membershipId), eq(memberships.orgId, ctx.orgId))).limit(1))[0];
    if (!m) throw new ApiError(ERROR.NOT_FOUND, '대상을 찾을 수 없습니다');
    // 비밀번호 초기화 → 임시 비번 반환(관리자가 본인에게 전달)
    if (body.resetPassword) {
      const temp = genTemp();
      await db.update(users).set({ passwordHash: hashPassword(temp) }).where(eq(users.id, m.userId));
      return ok({ tempPassword: temp });
    }
    // 활성/비활성 (본인 비활성화 금지)
    if (typeof body.isActive === 'boolean') {
      if (m.userId === ctx.user.id && body.isActive === false) throw new ApiError(ERROR.VALIDATION, '본인 계정은 비활성화할 수 없습니다');
      await db.update(users).set({ isActive: body.isActive }).where(eq(users.id, m.userId));
      return ok();
    }
    // 역할 변경
    if (body.role) {
      await db.update(memberships).set({ role: body.role, isOrgAdmin: body.role === 'admin' })
        .where(and(eq(memberships.id, membershipId), eq(memberships.orgId, ctx.orgId)));
      return ok();
    }
    throw new ApiError(ERROR.VALIDATION, '변경할 항목이 없습니다');
  });
}
