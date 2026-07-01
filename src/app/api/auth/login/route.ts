import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { users, memberships } from '@/db/schema';
import { verifyPassword, createSession } from '@/lib/auth';
import { handle, ok, ApiError, ERROR } from '@/lib/http';
export const dynamic = 'force-dynamic';
export async function POST(req: Request) {
  return handle(async () => {
    const { email, password } = await req.json();
    if (!email || !password) throw new ApiError(ERROR.VALIDATION, '이메일과 비밀번호를 입력하세요');
    const u = (await db.select().from(users).where(eq(users.email, email)).limit(1))[0];
    if (!u || !u.isActive || !verifyPassword(password, u.passwordHash)) throw new ApiError(ERROR.UNAUTHORIZED, '이메일 또는 비밀번호가 올바르지 않습니다');
    await createSession(u.id, req.headers.get('user-agent') || undefined);
    const orgs = await db.select().from(memberships).where(eq(memberships.userId, u.id));
    return ok({ ok: true, user: { id: u.id, email: u.email, name: u.name }, orgs });
  });
}
