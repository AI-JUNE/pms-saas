import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { users, sessions, passwordResetTokens } from '@/db/schema';
import { hashPassword } from '@/lib/auth';
import { handle, ok, ApiError, ERROR } from '@/lib/http';
import { enforceRateLimit, RL } from '@/lib/ratelimit';
import { auditSecurity } from '@/lib/audit';
import { hashResetToken, tokenLooksValid, evaluateResetToken, verdictMessage, validateNewPassword } from '@/lib/passwordReset';
export const dynamic = 'force-dynamic';

// 비밀번호 재설정 확인 — 토큰(원문) + 새 비밀번호. 토큰은 해시로만 조회하고 1회 소모한다.
// 성공 시 그 사용자의 **모든 세션을 폐기**한다(탈취된 세션이 살아남지 못하게). 로그인은 다시 해야 한다.
export async function POST(req: Request) {
  return handle(async () => {
    enforceRateLimit(req, RL.authReset);
    const body = await req.json().catch(() => ({}));
    const token = String(body?.token ?? '');
    const pwErr = validateNewPassword(body?.password);
    if (pwErr) throw new ApiError(ERROR.VALIDATION, pwErr);
    if (!tokenLooksValid(token)) throw new ApiError(ERROR.VALIDATION, verdictMessage('not_found'));
    const hash = hashResetToken(token);
    const row = (await db.select().from(passwordResetTokens).where(eq(passwordResetTokens.tokenHash, hash)).limit(1))[0];
    const verdict = evaluateResetToken(row, new Date());
    if (verdict !== 'ok' || !row) {
      await auditSecurity('AUTH_PW_RESET_FAIL', { userId: row?.userId ?? null, detail: { verdict } });
      throw new ApiError(ERROR.VALIDATION, verdictMessage(verdict));
    }
    const u = (await db.select({ id: users.id, isActive: users.isActive }).from(users).where(eq(users.id, row.userId)).limit(1))[0];
    if (!u || !u.isActive) throw new ApiError(ERROR.VALIDATION, verdictMessage('not_found'));
    await db.update(users).set({ passwordHash: hashPassword(String(body.password)) }).where(eq(users.id, u.id));
    await db.update(passwordResetTokens).set({ usedAt: new Date() }).where(eq(passwordResetTokens.id, row.id));
    await db.delete(sessions).where(eq(sessions.userId, u.id));
    await auditSecurity('AUTH_PW_RESET', { userId: u.id });
    return ok({ ok: true, message: '비밀번호가 변경되었습니다. 새 비밀번호로 다시 로그인해 주세요.' });
  }, req);
}
