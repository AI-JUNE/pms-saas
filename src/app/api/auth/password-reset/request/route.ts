import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { users, passwordResetTokens } from '@/db/schema';
import { handle, ok, ApiError, ERROR } from '@/lib/http';
import { enforceRateLimit, RL } from '@/lib/ratelimit';
import { auditSecurity } from '@/lib/audit';
import {
  RESET_REQUEST_RESPONSE, createMailAdapter, resetTtlMinutes, generateResetToken, hashResetToken, resetExpiry,
  emailLooksValid, buildResetMail, resetAuditDetail,
} from '@/lib/passwordReset';
export const dynamic = 'force-dynamic';

// 비밀번호 재설정 요청 — build now, activate on approval.
//  · 응답은 계정 유무와 무관하게 같다(계정 열거 방지). 토큰은 응답에 절대 담지 않는다.
//  · 메일은 MAIL_PROVIDER 로만 켠다. 미설정(기본)이면 log 스텁 — 실제 발송 0. 그 사실을 delivery 로 알려 화면이 정직하게 안내한다.
//  · 토큰 원문은 저장하지 않는다(sha256 해시만).
export async function POST(req: Request) {
  return handle(async () => {
    enforceRateLimit(req, RL.authReset);
    const body = await req.json().catch(() => ({}));
    const email = String(body?.email ?? '').trim();
    if (!emailLooksValid(email)) throw new ApiError(ERROR.VALIDATION, '이메일 형식을 확인해 주세요');
    const mailer = createMailAdapter(process.env);
    const ttl = resetTtlMinutes(process.env);
    const u = (await db.select({ id: users.id, email: users.email, isActive: users.isActive }).from(users).where(eq(users.email, email)).limit(1))[0];
    let delivered: 'log' | 'none' | 'skipped' = 'skipped';
    if (u && u.isActive) {
      const token = generateResetToken();
      try {
        await db.insert(passwordResetTokens).values({ userId: u.id, tokenHash: hashResetToken(token), expiresAt: resetExpiry(new Date(), ttl) });
        const origin = new URL(req.url).origin;
        const r = await mailer.send(buildResetMail(origin, u.email, token, ttl));
        delivered = r.delivered;
      } catch (e: any) {
        // 테이블 미생성 등 — 요청자에게는 같은 응답을 주고 서버 로그·감사로그에만 남긴다
        console.error('[password-reset] 토큰 저장 실패', String(e?.message || e));
        delivered = 'none';
      }
    }
    await auditSecurity('AUTH_PW_RESET_REQUEST', { userId: u?.id ?? null, detail: resetAuditDetail({ email, delivered, found: !!u }) });
    return ok({ ok: true, message: RESET_REQUEST_RESPONSE, delivery: mailer.kind, canSend: mailer.canSend });
  }, req);
}
