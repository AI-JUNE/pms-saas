import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { users } from '@/db/schema';
import { getCurrentUser, createSession } from '@/lib/auth';
import { handle, ok } from '@/lib/http';
export const dynamic = 'force-dynamic';

// 로그인 없이 자동 접속: 세션 없으면 기본 계정으로 세션 생성 (내부/데모용)
export async function POST() {
  return handle(async () => {
    const cur = await getCurrentUser();
    if (cur) return ok({ ok: true, already: true });
    const u = (await db.select().from(users).where(eq(users.email, 'admin@pms.com')).limit(1))[0]
      || (await db.select().from(users).where(eq(users.isActive, true)).limit(1))[0]
      || (await db.select().from(users).limit(1))[0];
    if (!u) return ok({ ok: false });
    await createSession(u.id);
    return ok({ ok: true });
  });
}
