// 세션 쿠키 서명 (2026-10-21, 외부 오픈 관문 I-2)
//
// 왜: 미들웨어는 Edge 에서 돌아 DB 를 못 본다. 그래서 지금까지 `/apps/*` 등 게이트는 세션 쿠키가
//   **있는지만** 봤다 — 아무 값이나 넣은 쿠키로 화면·제안 앱 원본 HTML 이 열렸다.
//   쿠키 값을 `토큰.HMAC(토큰)` 으로 바꾸면 미들웨어가 DB 조회 없이 위조를 거를 수 있다.
//   진짜 세션인지(만료·비활성)는 지금처럼 getCurrentUser 가 DB 로 확인한다.
//
// 켜는 법: 운영 환경변수 SESSION_SECRET(32자 이상)을 넣는다. 없으면 서명·검증을 하지 않는다(현행 그대로).
//   켜는 순간 서명 없는 기존 쿠키는 무효 → 전원 한 번 다시 로그인한다(RUNBOOK §4).
//
// Edge·Node 양쪽에서 같은 코드가 돌도록 Web Crypto(globalThis.crypto.subtle)만 쓴다.

const enc = new TextEncoder();
export const SECRET_MIN = 32;

/** 비밀값이 쓸 만한지. 짧은 값은 "켜지 않음" 으로 본다(우연히 짧게 넣어 무력한 서명이 되는 것보다 낫다). */
export function secretUsable(secret: string | undefined): secret is string {
  return typeof secret === 'string' && secret.length >= SECRET_MIN;
}

async function hmacHex(secret: string, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(msg));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** 길이가 같은 두 문자열을 시간 차 없이 비교 */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

/** 쿠키에 넣을 값. 비밀값이 없으면 토큰 그대로. */
export async function signToken(token: string, secret: string | undefined): Promise<string> {
  if (!secretUsable(secret)) return token;
  return `${token}.${await hmacHex(secret, token)}`;
}

/**
 * 쿠키 값 → DB 토큰. 위조·형식 오류면 null.
 * 비밀값이 없으면 값이 있기만 하면 그대로 돌려준다(현행 "존재만 확인" 과 같은 동작).
 */
export async function verifyCookie(value: string | undefined | null, secret: string | undefined): Promise<string | null> {
  if (!value) return null;
  if (!secretUsable(secret)) return value;
  const i = value.lastIndexOf('.');
  if (i <= 0) return null;
  const token = value.slice(0, i);
  const sig = value.slice(i + 1);
  if (!/^[0-9a-f]{64}$/.test(sig)) return null;
  return safeEqual(sig, await hmacHex(secret, token)) ? token : null;
}
