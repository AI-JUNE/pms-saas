// 포트원(PortOne) 구독 결제 스캐폴딩 단일 소스.
// build now, activate on approval: 여기서는 테스트키 기반 스캐폴딩만 제공한다.
// 실결제/실빌링 승격은 PAYMENTS_LIVE=true + 라이브 키 주입 후에만 [승인 필요].
import crypto from 'crypto';
import { PAYMENTS_LIVE, type PlanId, PLANS } from './billing';

// 환경변수(테스트키). 미설정 시 안전한 더미값 사용(스캐폴딩 동작 확인용).
export const PORTONE = {
  storeId: process.env.PORTONE_STORE_ID || 'store-test-0000',
  channelKey: process.env.PORTONE_CHANNEL_KEY || 'channel-key-test-0000',
  apiSecret: process.env.PORTONE_API_SECRET || '', // 서버 전용. 절대 클라이언트 노출 금지.
  webhookSecret: process.env.PORTONE_WEBHOOK_SECRET || '',
  // 라이브 여부: 결제 실활성 플래그와 동일 소스.
  live: PAYMENTS_LIVE,
} as const;

// 결제 스캐폴딩 상태(마켓플레이스/운영 점검용).
export function billingStatus() {
  return {
    live: PORTONE.live,
    provider: 'portone',
    mode: PORTONE.live ? 'live' : 'test',
    configured: {
      storeId: PORTONE.storeId !== 'store-test-0000',
      channelKey: PORTONE.channelKey !== 'channel-key-test-0000',
      apiSecret: PORTONE.apiSecret.length > 0,
      webhookSecret: PORTONE.webhookSecret.length > 0,
    },
    note: PORTONE.live
      ? '실결제 활성. 라이브 키로 동작 중.'
      : '테스트 모드(스캐폴딩). 실결제 비활성 — 활성화는 [승인 필요].',
  };
}

export function findPlan(planId: string) {
  return PLANS.find((p) => p.id === planId);
}

// 결제 세션 식별자(멱등키). 실제 PG 발급 전 로컬 스캐폴딩용.
export function newPaymentId(planId: PlanId): string {
  return `pms_${planId}_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
}

// 포트원 웹훅 서명 검증(스캐폴딩).
// 실키 주입 시 HMAC-SHA256(body, webhookSecret) 비교로 위변조를 차단한다.
// 시크릿 미설정(테스트) 상태에서는 검증을 우회하되 그 사실을 리턴한다.
export function verifyWebhook(rawBody: string, signature: string | null): { ok: boolean; verified: boolean; reason?: string } {
  if (!PORTONE.webhookSecret) {
    return { ok: true, verified: false, reason: 'webhook-secret-not-set(test)' };
  }
  if (!signature) return { ok: false, verified: false, reason: 'missing-signature' };
  const expected = crypto.createHmac('sha256', PORTONE.webhookSecret).update(rawBody).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
  return { ok, verified: ok, reason: ok ? undefined : 'signature-mismatch' };
}
