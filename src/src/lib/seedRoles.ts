import { db } from '@/db';
import { permissions, rolePermissions } from '@/db/schema';
export const RESOURCES = ['project','phase','member','requirement','issue','risk','task','document','meeting','sprint','interface','infra','firewall','procurement','board'];
export const ACTIONS = ['read','write','approve','admin'];
const RANK: Record<string, number> = { read: 1, write: 2, approve: 3, admin: 4 };
const ROLE_LEVEL: Record<string, string> = { member: 'write', pm: 'approve', pmo: 'approve', admin: 'admin' };
export async function ensurePermissions() {
  for (const r of RESOURCES) for (const a of ACTIONS) await db.insert(permissions).values({ resource: r, action: a, label: `${r}:${a}` }).onConflictDoNothing();
}
export async function grantDefaultRoles(orgId: number) {
  await ensurePermissions(); const perms = await db.select().from(permissions);
  for (const [role, maxAction] of Object.entries(ROLE_LEVEL)) for (const p of perms)
    if ((RANK[p.action] ?? 9) <= (RANK[maxAction] ?? 0)) await db.insert(rolePermissions).values({ orgId, role, permissionId: p.id }).onConflictDoNothing();
}
