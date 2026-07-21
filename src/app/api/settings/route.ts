import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { organizations } from '@/db/schema';
import { requireUser } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { handle, ok, ApiError, ERROR } from '@/lib/http';
export const dynamic = 'force-dynamic';
const genCode = () => (Math.random().toString(36).slice(2, 10) + '00000000').slice(0, 8).toUpperCase();
export async function GET() {
  return handle(async () => {
    const ctx = await requireTenant(await requireUser());
    let org: any = (await db.select().from(organizations).where(eq(organizations.id, ctx.orgId)).limit(1))[0];
    if (org && !org.inviteCode && ctx.isOrgAdmin) {
      const code = genCode();
      await db.update(organizations).set({ inviteCode: code }).where(eq(organizations.id, ctx.orgId));
      org = { ...org, inviteCode: code };
    }
    return ok({ org, role: ctx.role, isOrgAdmin: ctx.isOrgAdmin });
  });
}
export async function PATCH(req: Request) {
  return handle(async () => {
    const ctx = await requireTenant(await requireUser());
    if (!ctx.isOrgAdmin && !ctx.user.isSuperadmin) throw new ApiError(ERROR.FORBIDDEN, '관리자만 변경할 수 있습니다');
    const body = await req.json();
    if (body.regenerateInvite) {
      const code = genCode();
      await db.update(organizations).set({ inviteCode: code }).where(eq(organizations.id, ctx.orgId));
      return ok({ inviteCode: code });
    }
    if (body.name) await db.update(organizations).set({ name: body.name }).where(eq(organizations.id, ctx.orgId));
    return ok();
  });
}
