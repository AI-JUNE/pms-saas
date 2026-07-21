import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { users } from '@/db/schema';
import { requireUser, verifyPassword, hashPassword } from '@/lib/auth';
import { handle, ok, ApiError, ERROR } from '@/lib/http';
export const dynamic = 'force-dynamic';
export async function PATCH(req: Request) {
  return handle(async () => {
    const u = await requireUser();
    const body = await req.json();
    // 비밀번호 변경
    if (body.newPassword !== undefined) {
      const currentPassword = body.currentPassword, newPassword = body.newPassword;
      if (!currentPassword || !newPassword) throw new ApiError(ERROR.VALIDATION, '현재/새 비밀번호를 입력하세요');
      if (String(newPassword).length < 8) throw new ApiError(ERROR.VALIDATION, '새 비밀번호는 8자 이상이어야 합니다');
      const row = (await db.select().from(users).where(eq(users.id, u.id)).limit(1))[0];
      if (!row || !verifyPassword(String(currentPassword), row.passwordHash)) throw new ApiError(ERROR.UNAUTHORIZED, '현재 비밀번호가 올바르지 않습니다');
      await db.update(users).set({ passwordHash: hashPassword(String(newPassword)) }).where(eq(users.id, u.id));
      return ok({ ok: true });
    }
    // 이름 변경
    const name = body.name;
    if (!name || !String(name).trim()) throw new ApiError(ERROR.VALIDATION, '이름을 입력하세요');
    await db.update(users).set({ name: String(name).trim() }).where(eq(users.id, u.id));
    return ok();
  });
}
