import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { permissions, rolePermissions } from '@/db/schema';
import { ApiError, ERROR } from './http';
import type { TenantContext } from './tenant';
import { actionSatisfies } from './rbacRank.ts';
export { ACTION_RANK } from './rbacRank.ts';
export async function hasPermission(ctx: TenantContext, resource: string, action: string): Promise<boolean> {
  if (ctx.isOrgAdmin || ctx.user.isSuperadmin) return true;
  const rows = await db.select({ action: permissions.action }).from(rolePermissions)
    .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
    .where(and(eq(rolePermissions.orgId, ctx.orgId), eq(rolePermissions.role, ctx.role), eq(permissions.resource, resource)));
  return actionSatisfies(rows.map((r) => r.action), action);
}
export async function requirePermission(ctx: TenantContext, resource: string, action: string) {
  if (!(await hasPermission(ctx, resource, action))) throw new ApiError(ERROR.FORBIDDEN, `권한이 없습니다 (${resource}:${action})`);
}
