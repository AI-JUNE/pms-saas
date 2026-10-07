import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { permissions, rolePermissions } from '@/db/schema';
import { ApiError, ERROR } from './http';
import type { TenantContext } from './tenant';
import { actionSatisfies } from './rbacRank.ts';
import { isPartnerRole, partnerCanAccess, partnerRoleEnabled } from './partnerRbac.ts';
import { screenDecision, forbiddenMessage } from './screenAccess.ts';
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
/**
 * 화면(URL) 단위 역할 등급 검사 — lib/screenAccess 정책을 **그 화면이 부르는 API** 에도 적용한다(UI 우회 차단).
 * 동기·DB 조회 없음: 등급은 ctx(role·isOrgAdmin·isSuperadmin)만으로 정해진다. 거부면 표준 403.
 */
export function assertScreenAccess(ctx: TenantContext, href: string): void {
  const d = screenDecision({ role: ctx.role, isOrgAdmin: ctx.isOrgAdmin, isSuperadmin: ctx.user.isSuperadmin }, href);
  if (!d.allowed) throw new ApiError(ERROR.FORBIDDEN, forbiddenMessage(d), { screen: d.href, required: d.required });
}
