import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { memberships } from '@/db/schema';
import { ApiError, ERROR } from './http';
import type { SessionUser } from './auth';
export type TenantContext = { user: SessionUser; orgId: number; role: string; isOrgAdmin: boolean };
export async function requireTenant(user: SessionUser): Promise<TenantContext> {
  let m;
  if (user.activeOrgId) m = (await db.select().from(memberships).where(and(eq(memberships.userId, user.id), eq(memberships.orgId, user.activeOrgId))).limit(1))[0];
  if (!m) m = (await db.select().from(memberships).where(eq(memberships.userId, user.id)).limit(1))[0];
  if (!m) throw new ApiError(ERROR.FORBIDDEN, '소속된 조직이 없습니다');
  return { user, orgId: m.orgId, role: m.role, isOrgAdmin: m.isOrgAdmin };
}
