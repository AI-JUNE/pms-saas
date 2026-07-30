import { handle, ok, sendError, ERROR } from '@/lib/http';
import { verifyWebhook, PORTONE } from '@/lib/portone';
import { log } from '@/lib/logger';

export const dynamic = 'force-dynamic';

// 포트원 결제 웹훅 수신(스캐폴딩).
// build now, activate on approval:
//  - 서명 검증 → 이벤트 파싱 → 로깅까지 수행한다.
//  - 실제 구독상태(organizations.plan) 반영은 라이브 승격 시 활성화 → [승인 필요].
//    지금은 검증·로깅만 하고 항상 200으로 ack(PG 재시도 폭주 방지).
export async function POST(req: Request) {
  return handle(async () => {
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

    // [승인 필요] 실구독 반영: PAYMENTS_LIVE 승격 후 아래 지점에서 org.plan 업데이트.
    // 예: Paid → organizations.plan = planId, 감사로그 기록.

    return ok({ ok: true, received: true, type, verified: v.verified });
  });
}
