import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { organizations } from '@/db/schema';
import { handle, ok, sendError, ERROR } from '@/lib/http';
import { verifyWebhook, PORTONE } from '@/lib/portone';
import { BILLING_APPLY_LIVE, decideWebhookAction } from '@/lib/billingWebhook';
import { auditSecurity } from '@/lib/audit';
import { log } from '@/lib/logger';
import { enforceRateLimit, RL } from '@/lib/ratelimit';

export const dynamic = 'force-dynamic';

// 포트원 결제 웹훅 수신(스캐폴딩).
// build now, activate on approval:
//  - 서명 검증 → 이벤트 파싱 → 로깅까지 수행한다.
//  - 실제 구독상태(organizations.plan) 반영은 라이브 승격 시 활성화 → [승인 필요].
//    지금은 검증·로깅만 하고 항상 200으로 ack(PG 재시도 폭주 방지).
export async function POST(req: Request) {
  return handle(async () => {
    enforceRateLimit(req, RL.billingWebhook);
    const raw = await req.text();
    const sig = req.headers.get('x-portone-signature') || req.headers.get('webhook-signature');
    const v = verifyWebhook(raw, sig);

    if (!v.ok) {
      log.warn('billing.webhook.reject', { reason: v.reason });
      return sendError(ERROR.UNAUTHORIZED, '웹훅 서명 검증 실패');
    }

    let event: any = {};
    try { event = raw ? JSON.parse(raw) : {}; } catch { /* non-JSON ping */ }
    const type = event?.type || event?.event || 'unknown';
    const paymentId = event?.data?.paymentId || event?.paymentId || null;

    log.info('billing.webhook.received', {
      type, paymentId, verified: v.verified, live: PORTONE.live,
    });

    // 플랜 반영 판정(순수모듈). 기본 OFF(BILLING_APPLY_LIVE=false) → 항상 ignore 사유만 로깅.
    // 실반영 활성화(BILLING_APPLY_LIVE=true + PAYMENTS_LIVE=true)는 [승인 필요].
    const decision = decideWebhookAction({
      type, paymentId,
      customData: event?.data?.customData ?? event?.customData,
      verified: v.verified, live: PORTONE.live, applyEnabled: BILLING_APPLY_LIVE,
    });

    if (decision.action === 'apply') {
      // 여기 도달 = 서명 검증 + 두 플래그 모두 ON(승인 완료 상태)일 때만.
      await db.update(organizations)
        .set({ plan: decision.planId })
        .where(eq(organizations.id, decision.orgId));
      await auditSecurity('BILLING_PLAN_APPLIED', {
        userId: decision.userId, orgId: decision.orgId,
        entity: 'billing', entityId: String(paymentId ?? ''),
        detail: { planId: decision.planId, type },
      });
      log.info('billing.webhook.applied', { orgId: decision.orgId, planId: decision.planId });
      return ok({ ok: true, received: true, type, verified: v.verified, applied: true });
    }

    log.info('billing.webhook.ignored', { reason: decision.reason });
    return ok({ ok: true, received: true, type, verified: v.verified, applied: false, reason: decision.reason });
  }, req);
}
