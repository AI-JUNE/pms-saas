import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { users } from '@/db/schema';
import { requireUser } from '@/lib/auth';
import { handle, ok, ApiError, ERROR } from '@/lib/http';
export const dynamic = 'force-dynamic';
export async function PATCH(req: Request) {
  return handle(async () => {
    const u = await requireUser();
    const { name } = await req.json();
    if (!name || !String(name).trim()) throw new ApiError(ERROR.VALIDATION, '이름을 입력하세요');
    await db.update(users).set({ name: String(name).trim() }).where(eq(users.id, u.id));
    return ok();
  });
}
