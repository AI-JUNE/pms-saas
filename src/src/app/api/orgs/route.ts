import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { organizations, memberships } from '@/db/schema';
import { requireUser } from '@/lib/auth';
import { handle, ok } from '@/lib/http';
export const dynamic = 'force-dynamic';
export async function GET() {
  return handle(async () => {
    const user = await requireUser();
    const rows = await db.select({ orgId: organizations.id, name: organizations.name, slug: organizations.slug, role: memberships.role, isOrgAdmin: memberships.isOrgAdmin })
      .from(memberships).innerJoin(organizations, eq(memberships.orgId, organizations.id)).where(eq(memberships.userId, user.id));
    return ok(rows);
  });
}
