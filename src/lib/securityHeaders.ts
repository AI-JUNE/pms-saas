// HTTP 보안 응답 헤더 (공통 P0-6 상용 하드닝) — 순수 모듈
// Edge 미들웨어에서 사용하므로 Node 전용 API 금지.
//
// 원칙: "켜도 화면이 깨지지 않고, 되돌리기 쉬운" 안전한 헤더만 기본 적용한다.
//  - CSP 는 frame-ancestors 단일 지시어만 적용(클릭재킹 차단). script/style 정책은
//    Next 인라인 스크립트와 충돌해 화면 파손 위험 → 도입 시 Report-Only 부터 [승인 필요].
//  - HSTS 는 운영(production)에서만, includeSubDomains/preload 없이 max-age 180일로
//    시작한다(오설정 시 되돌리기 가능한 보수적 값). 스테이징/프리뷰에는 미적용.
//  - Permissions-Policy 는 앱이 쓰지 않는 고위험 센서만 차단(카메라·마이크·위치).
//    결제(PortOne)는 자체 iframe/리다이렉트 방식이라 영향 없음 — payment 지시어는
//    PG 결제창 호환 확인 전까지 미적용(보수적).
//  - 예외 1건: 포털이 품은 제안 앱 **원본 HTML** 은 우리 화면이 같은 오리진 iframe 으로
//    띄우는 문서다. DENY / frame-ancestors 'none' 은 same-origin 프레임까지 막으므로
//    (SAMEORIGIN 과 달리 DENY 는 예외가 없다) 그 문서만 self 로 좁혀 허용한다.
//    호스트 라우트(/apps/quality)는 프레임될 이유가 없으므로 DENY 를 그대로 유지한다.

export type HeaderEntry = { key: string; value: string };

/**
 * 같은 오리진 iframe 안에서 **문서로 떠야 하는** 경로 접두사.
 * 현재는 제안 앱 원본 HTML(`/apps/<key>/index.html`) 뿐이다 — 늘리기 전에
 * "우리 화면이 직접 iframe 으로 띄우는 문서인가"를 확인할 것.
 */
export const EMBEDDABLE_PREFIXES = ['/apps/'] as const;

/**
 * 해당 경로가 same-origin 프레임 허용 대상인지. fail-closed —
 * 판단이 서지 않으면 false(=DENY 유지)를 돌려준다.
 */
export function isEmbeddableDocument(pathname: unknown): boolean {
  const p = String(pathname ?? '').split(/[?#]/)[0];
  if (!p.startsWith('/') || p.includes('..')) return false;
  // 문서(.html)만. 호스트 라우트·API·자산은 프레임될 필요가 없다.
  if (!/\.html?$/i.test(p)) return false;
  return EMBEDDABLE_PREFIXES.some((d) => p.startsWith(d));
}

/**
 * 전 라우트 공통 보안 응답 헤더 목록.
 * vercelEnv==='production' 일 때만 HSTS 포함. pathname 이 프레임 허용 문서면
 * 클릭재킹 헤더 2종만 self 로 완화하고 나머지는 동일하다.
 */
export function buildSecurityHeaders(opts?: { vercelEnv?: string; pathname?: string }): HeaderEntry[] {
  const isProd = (opts?.vercelEnv ?? '') === 'production';
  const embeddable = isEmbeddableDocument(opts?.pathname);
  const list: HeaderEntry[] = [
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'X-Frame-Options', value: embeddable ? 'SAMEORIGIN' : 'DENY' },
    { key: 'Content-Security-Policy', value: embeddable ? "frame-ancestors 'self'" : "frame-ancestors 'none'" },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  ];
  if (isProd) list.push({ key: 'Strict-Transport-Security', value: 'max-age=15552000' });
  return list;
}

/** Headers 호환 객체(set 만 요구)에 보안 헤더를 일괄 적용한다. */
export function applySecurityHeaders(
  headers: { set(key: string, value: string): void },
  opts?: { vercelEnv?: string; pathname?: string },
): void {
  for (const { key, value } of buildSecurityHeaders(opts)) headers.set(key, value);
}
