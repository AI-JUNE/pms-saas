import { getCurrentUser } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { handle, ok } from '@/lib/http';
export const dynamic = 'force-dynamic';
export async function GET() {
  return handle(async () => {
    const user = await getCurrentUser(); if (!user) return ok({ authenticated: false });
    const t = await requireTenant(user).catch(() => null);
    return ok({ authenticated: true, user, org: t ? { orgId: t.orgId, role: t.role, isOrgAdmin: t.isOrgAdmin } : null });
  });
}
