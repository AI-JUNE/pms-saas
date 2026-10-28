// 둘러보기(손님) 모드 — 순수 모듈(DB·next 의존 없음, Edge 미들웨어에서도 쓴다). 2026-10-28 사용자 요청:
//   "외부 PMS 회원가입이 안 돼 — 우선 회원가입 페이지 없이 바로 볼 수 있도록".
//
// 로그인 자체를 없애면 운영 DB 의 모든 조직 데이터가 열리므로, 대신 **데모 전용 조직에 읽기 전용 손님**으로 들어간다.
//   - 손님 세션 토큰은 GUEST_PREFIX 로 시작한다 → 미들웨어가 DB 없이 손님을 알아본다(토큰은 DB 에 그대로 있어야만 통한다)
//   - 손님의 쓰기(GET·HEAD·OPTIONS 밖의 /api 요청)는 로그아웃만 빼고 미들웨어가 403 으로 막는다 — 데모 데이터·손님 계정을 아무도 못 바꾼다
//   - 데모 조직은 초대 코드가 없다(누구도 그 조직에 가입할 수 없다). 실제 고객 조직과 섞이지 않는다
//   - 끄기: 환경 변수 PMS_GUEST_DISABLED=true (스위치는 === 'true' 로만 판정하는 규칙 — 기본은 켜짐)

export const GUEST_PREFIX = 'g_';
export const GUEST_EMAIL = 'guest@demo.gowon';
export const GUEST_NAME = '둘러보기 손님';
export const DEMO_ORG_SLUG = 'gowon-demo';
export const DEMO_ORG_NAME = 'GOWON 데모 조직';
export const GUEST_SESSION_DAYS = 1;
export const GUEST_ALLOW_WRITE = ['/api/auth/logout', '/api/auth/guest'];

export function isGuestToken(token: string | null | undefined): boolean {
  return typeof token === 'string' && token.startsWith(GUEST_PREFIX) && token.length > GUEST_PREFIX.length + 16;
}
export function isGuestEmail(email: unknown): boolean {
  return String(email ?? '').trim().toLowerCase() === GUEST_EMAIL;
}

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);
export type GuestDecision = { blocked: boolean; status?: number; body?: { ok: false; code: string; message: string } };

/** 손님 세션의 쓰기를 막을지 — /api 아래 GET·HEAD·OPTIONS 밖의 요청(로그아웃·다시 입장 제외) */
export function guestWriteDecision(o: { method: string; path: string; token: string | null | undefined }): GuestDecision {
  if (!isGuestToken(o.token)) return { blocked: false };
  const m = String(o.method || 'GET').toUpperCase(), p = String(o.path || '');
  if (SAFE.has(m) || !p.startsWith('/api/')) return { blocked: false };
  if (GUEST_ALLOW_WRITE.some((a) => p === a)) return { blocked: false };
  return { blocked: true, status: 403, body: { ok: false, code: 'GUEST_READ_ONLY', message: '둘러보기 모드에서는 저장·변경할 수 없습니다 — 회원가입 후 이용해 주세요' } };
}
