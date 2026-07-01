import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { permissions, rolePermissions } from '@/db/schema';
import { ApiError, ERROR } from './http';
import type { TenantContext } from './tenant';
export const ACTION_RANK: Record<string, number> = { read: 1, write: 2, approve: 3, admin: 4 };
export async function hasPermission(ctx: TenantContext, resource: string, action: string): Promise<boolean> {
  if (ctx.isOrgAdmin || ctx.user.isSuperadmin) return true;
  const need = ACTION_RANK[action] ?? 99;
  const rows = await db.select({ action: permissions.action }).from(rolePermissions)
    .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
    .where(and(eq(rolePermissions.orgId, ctx.orgId), eq(rolePermissions.role, ctx.role), eq(permissions.resource, resource)));
  return rows.some((r) => (ACTION_RANK[r.action] ?? 0) >= need);
}
export async function requirePermission(ctx: TenantContext, resource: string, action: string) {
  if (!(await hasPermission(ctx, resource, action))) throw new ApiError(ERROR.FORBIDDEN, `권한이 없습니다 (${resource}:${action})`);
}
