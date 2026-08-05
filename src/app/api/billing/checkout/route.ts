import { requireUser } from '@/lib/auth';
import { handle, ok, ApiError, ERROR } from '@/lib/http';
import { enforceRateLimit } from '@/lib/ratelimit';
import { PORTONE, findPlan, newPaymentId, billingStatus } from '@/lib/portone';
import { log } from '@/lib/logger';
import { auditSecurity } from '@/lib/audit';
import type { PlanId } from '@/lib/billing';

export const dynamic = 'force-dynamic';

// 구독 결제 개시(스캐폴딩).
// build now, activate on approval:
//  - 테스트 모드: 실결제 없이 결제 파라미터(storeId/channelKey/paymentId)만 발급.
//    프론트 SDK가 이 값으로 결제창을 띄우는 흐름을 검증할 수 있다.
//  - 라이브 모드(PAYMENTS_LIVE=true): 실PG 빌링키 발급 로직이 필요 → [승인 필요].
export async function POST(req: Request) {
  return handle(async () => {
    enforceRateLimit(req, { key: 'billing:checkout', limit: 10, windowMs: 60_000 });
    const u = await requireUser();

    let body: any = {};
    try { body = await req.json(); } catch { /* empty body allowed */ }
    const planId = String(body.planId || '') as PlanId;
    if (!planId) throw new ApiError(ERROR.VALIDATION, '요금제(planId)를 지정하세요');

    const plan = findPlan(planId);
    if (!plan) throw new ApiError(ERROR.VALIDATION, '존재하지 않는 요금제입니다');
    if (plan.id === 'enterprise') {
      throw new ApiError(ERROR.VALIDATION, 'Enterprise는 도입 문의로 진행됩니다(직접 결제 불가)');
    }

    // 라이브 모드는 실PG 연동 전까지 차단(실결제 방지 안전장치).
    if (PORTONE.live) {
      throw new ApiError(ERROR.SERVER, '실결제 연동은 아직 승인 대기 상태입니다. [승인 필요]');
    }

    const paymentId = newPaymentId(planId);
    log.info('billing.checkout.scaffold', { userId: u.id, planId, paymentId, mode: 'test' });
    await auditSecurity('BILLING_CHECKOUT_SCAFFOLD', { userId: u.id, entity: 'billing', entityId: paymentId, detail: { planId, mode: 'test' } });

    // 프론트 결제 SDK가 사용할 파라미터. apiSecret/webhookSecret은 절대 포함하지 않는다.
    return ok({
      ok: true,
      mode: 'test',
      paymentId,
      storeId: PORTONE.storeId,
      channelKey: PORTONE.channelKey,
      plan: { id: plan.id, name: plan.name, price: plan.price, unit: plan.unit ?? '' },
      customer: { id: String(u.id), email: u.email, name: u.name },
      redirectUrl: '/pricing?checkout=scaffold',
      billing: billingStatus(),
      note: '테스트 스캐폴딩 응답입니다. 실결제는 발생하지 않습니다. [승인 필요]',
    });
  });
}
