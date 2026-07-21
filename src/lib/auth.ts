import { cookies } from 'next/headers';
import crypto from 'crypto';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { users, sessions } from '@/db/schema';
import { ApiError, ERROR } from './http';
const COOKIE = process.env.SESSION_COOKIE || 'pms_session';
const SESSION_DAYS = 7;
export function hashPassword(pw: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  return `${salt}:${crypto.scryptSync(pw, salt, 64).toString('hex')}`;
}
export function verifyPassword(pw: string, stored: string): boolean {
  const [salt, hash] = stored.split(':'); if (!salt || !hash) return false;
  const a = Buffer.from(crypto.scryptSync(pw, salt, 64).toString('hex'), 'hex'); const b = Buffer.from(hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
export async function createSession(userId: number, userAgent?: string) {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 864e5);
  await db.insert(sessions).values({ token, userId, expiresAt, userAgent });
  cookies().set(COOKIE, token, { httpOnly: true, sameSite: 'lax', path: '/', expires: expiresAt });
  return token;
}
export async function destroySession() {
  const token = cookies().get(COOKIE)?.value;
  if (token) await db.delete(sessions).where(eq(sessions.token, token));
  cookies().delete(COOKIE);
}
export type SessionUser = { id: number; email: string; name: string; isSuperadmin: boolean; activeOrgId: number | null };
export async function getCurrentUser(): Promise<SessionUser | null> {
  const token = cookies().get(COOKIE)?.value; if (!token) return null;
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
