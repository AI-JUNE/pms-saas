import { cookies } from 'next/headers';
import crypto from 'crypto';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { users, sessions } from '@/db/schema';
import { ApiError, ERROR } from './http';
import { signToken, verifyCookie } from './sessionSig';
const COOKIE = process.env.SESSION_COOKIE || 'pms_session';
const SESSION_DAYS = 7;
export { hashPassword, verifyPassword } from './password.ts'; // 순수 모듈로 분리(테스트 가능), 경로 호환 재수출
// opts.prefix: 둘러보기 손님 세션 표지(lib/guestMode.ts GUEST_PREFIX) — 미들웨어가 DB 없이 손님 쓰기를 막는다 · opts.days: 만료(기본 7일)
export async function createSession(userId: number, userAgent?: string, opts: { prefix?: string; days?: number } = {}) {
  const token = (opts.prefix || '') + crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + (opts.days ?? SESSION_DAYS) * 864e5);
  await db.insert(sessions).values({ token, userId, expiresAt, userAgent });
  // SESSION_SECRET 이 있으면 `토큰.서명` 으로 넣는다 — 미들웨어가 DB 없이 위조를 거른다(sessionSig.ts)
  cookies().set(COOKIE, await signToken(token, process.env.SESSION_SECRET), { httpOnly: true, sameSite: 'lax', path: '/', expires: expiresAt });
  return token;
}
export async function destroySession() {
  const token = await verifyCookie(cookies().get(COOKIE)?.value, process.env.SESSION_SECRET);
  if (token) await db.delete(sessions).where(eq(sessions.token, token));
  cookies().delete(COOKIE);
}
export type SessionUser = { id: number; email: string; name: string; isSuperadmin: boolean; activeOrgId: number | null };
export async function getCurrentUser(): Promise<SessionUser | null> {
  const token = await verifyCookie(cookies().get(COOKIE)?.value, process.env.SESSION_SECRET); if (!token) return null;
  const rows = await db.select({
    id: users.id, email: users.email, name: users.name, isSuperadmin: users.isSuperadmin,
    activeOrgId: sessions.activeOrgId, expiresAt: sessions.expiresAt, isActive: users.isActive,
  }).from(sessions).innerJoin(users, eq(sessions.userId, users.id)).where(eq(sessions.token, token)).limit(1);
  const r = rows[0]; if (!r || !r.isActive || new Date(r.expiresAt) < new Date()) return null;
  return { id: r.id, email: r.email, name: r.name, isSuperadmin: r.isSuperadmin, activeOrgId: r.activeOrgId };
}
export async function requireUser(): Promise<SessionUser> {
  const u = await getCurrentUser(); if (!u) throw new ApiError(ERROR.UNAUTHORIZED, '로그인이 필요합니다'); return u;
}
