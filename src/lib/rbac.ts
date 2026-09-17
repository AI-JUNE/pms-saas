import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { permissions, rolePermissions } from '@/db/schema';
import { ApiError, ERROR } from './http';
import type { TenantContext } from './tenant';
import { actionSatisfies } from './rbacRank.ts';
import { isPartnerRole, partnerCanAccess, partnerRoleEnabled } from './partnerRbac.ts';
export { ACTION_RANK } from './rbacRank.ts';
export async function hasPermission(ctx: TenantContext, resource: string, action: string): Promise<boolean> {
  // 파트너 담당자(partner_admin)는 조직 관리자 권한을 승계하지 않는다. 스위치 OFF 면 전부 거부(fail-closed).
  if (isPartnerRole(ctx.role)) return partnerCanAccess(resource, action, partnerRoleEnabled());
  if (ctx.isOrgAdmin || ctx.user.isSuperadmin) return true;
  const rows = await db.select({ action: permissions.action }).from(rolePermissions)
    .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
    .where(and(eq(rolePermissions.orgId, ctx.orgId), eq(rolePermissions.role, ctx.role), eq(permissions.resource, resource)));
  return actionSatisfies(rows.map((r) => r.action), action);
}
export async function requirePermission(ctx: TenantContext, resource: string, action: string) {
  if (!(await hasPermission(ctx, resource, action))) throw new ApiError(ERROR.FORBIDDEN, `권한이 없습니다 (${resource}:${action})`);
}
