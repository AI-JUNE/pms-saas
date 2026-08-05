import { destroySession, getCurrentUser } from '@/lib/auth';
import { auditSecurity } from '@/lib/audit';
import { handle, ok } from '@/lib/http';
export const dynamic = 'force-dynamic';
export async function POST() {
  return handle(async () => {
    const u = await getCurrentUser();
    await destroySession();
    if (u) await auditSecurity('AUTH_LOGOUT', { userId: u.id });
    return ok();
  });
}
