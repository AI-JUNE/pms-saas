// 비밀번호 해시 유틸 — 순수 모듈(DB·Next 의존 없음). node --test에서 직접 검증 가능.
// auth.ts가 재수출하므로 기존 '@/lib/auth' 임포트 경로는 그대로 동작한다.
import crypto from 'crypto';

export function hashPassword(pw: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  return `${salt}:${crypto.scryptSync(pw, salt, 64).toString('hex')}`;
}

export function verifyPassword(pw: string, stored: string): boolean {
  const [salt, hash] = stored.split(':'); if (!salt || !hash) return false;
  const a = Buffer.from(crypto.scryptSync(pw, salt, 64).toString('hex'), 'hex'); const b = Buffer.from(hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
