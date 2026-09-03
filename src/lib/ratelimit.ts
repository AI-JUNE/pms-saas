import { ApiError, ERROR } from './http.ts';

// 인메모리 슬라이딩 윈도우 rate limiter.
// 주의: 단일 인스턴스 메모리 기준. 다중 인스턴스/서버리스 환경에서는
// [승인 필요] 단계에서 Redis(Upstash) 등 공유 스토어로 승격 필요.
// 여기서는 무료·무의존으로 브루트포스 1차 방어를 제공한다.

type Hit = { count: number; resetAt: number };
const buckets = new Map<string, Hit>();

// 메모리 누수 방지: 주기적으로 만료 버킷 정리(요청 시 lazy sweep).
let lastSweep = 0;
function sweep(now: number) {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
}

export interface RateLimitOptions {
  /** 버킷 이름(라우트 구분). 예: 'auth:login' */
  key: string;
  /** 윈도우당 허용 요청 수 */
  limit: number;
  /** 윈도우 길이(ms) */
  windowMs: number;
}

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  resetAt: number;
  retryAfterSec: number;
}

/** IP 추출: 프록시/버셀 헤더 우선, 없으면 익명 버킷. */
export function clientIp(req: Request): string {
  const h = req.headers;
  const fwd = h.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  return h.get('x-real-ip') || h.get('cf-connecting-ip') || 'anon';
}

/** 카운트만 하고 결과 반환(throw 없음). */
export function rateLimit(id: string, opts: RateLimitOptions): RateLimitResult {
  const now = Date.now();
  sweep(now);
  const k = `${opts.key}:${id}`;
  let hit = buckets.get(k);
  if (!hit || hit.resetAt <= now) {
    hit = { count: 0, resetAt: now + opts.windowMs };
    buckets.set(k, hit);
  }
  hit.count += 1;
  const remaining = Math.max(0, opts.limit - hit.count);
  const retryAfterSec = Math.max(0, Math.ceil((hit.resetAt - now) / 1000));
  return { ok: hit.count <= opts.limit, remaining, resetAt: hit.resetAt, retryAfterSec };
}

/** 한도 초과 시 표준 429 ApiError를 던진다. */
export function enforceRateLimit(req: Request, opts: RateLimitOptions): void {
  const r = rateLimit(clientIp(req), opts);
  if (!r.ok) {
    throw new ApiError(
      ERROR.TOO_MANY,
      '요청이 너무 많습니다. 잠시 후 다시 시도하세요.',
      { retryAfterSec: r.retryAfterSec },
    );
  }
}

// 자주 쓰는 프리셋.
export const RL = {
  authLogin: { key: 'auth:login', limit: 8, windowMs: 60_000 },       // 로그인 시도 분당 8회
  authRegister: { key: 'auth:register', limit: 5, windowMs: 60_000 }, // 가입 분당 5회
  authAuto: { key: 'auth:auto', limit: 20, windowMs: 60_000 },
  // 공개(인증 불필요) API — 남용 방어용. 정상 사용/모니터링을 막지 않도록 넉넉히 잡는다.
  publicHealth: { key: 'public:health', limit: 120, windowMs: 60_000 },   // 업타임 모니터 여유분
  publicPlans: { key: 'public:plans', limit: 60, windowMs: 60_000 },      // 랜딩 요금제 조회
  publicAsset: { key: 'public:asset', limit: 60, windowMs: 60_000 },      // 외부 fetch 동반 자산
  billingWebhook: { key: 'billing:webhook', limit: 120, windowMs: 60_000 }, // PG 재시도 폭주 방어
} as const;

/**
 * handle() 래퍼가 없는 라우트(직접 Response 반환)를 위한 검사기.
 * 한도 초과면 표준 429 Response(코드·Retry-After 포함)를 반환하고, 통과면 null.
 */
export function rateLimitResponse(req: Request, opts: RateLimitOptions): Response | null {
  const r = rateLimit(clientIp(req), opts);
  if (r.ok) return null;
  return new Response(
    JSON.stringify({ ok: false, code: 'TOO_MANY', message: '요청이 너무 많습니다. 잠시 후 다시 시도하세요.', retryAfterSec: r.retryAfterSec }),
    { status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': String(Math.max(1, r.retryAfterSec)) } },
  );
}
