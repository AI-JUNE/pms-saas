import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { applySecurityHeaders } from './lib/securityHeaders';
const COOKIE = process.env.SESSION_COOKIE || 'pms_session';
// ⚠️ 세션 게이트 접두사. 여기서 **빼면** 그 화면이 로그인 없이 열린다 — 추가는 안전, 삭제는 위험.
//   '/apps' 는 제안 앱(2026-09-29 편입). matcher 가 제외하는 건 _next/static·_next/image·favicon 뿐이라
//   이 한 줄이 라우트(/apps/quality)와 원본 HTML(/apps/quality/index.html)을 **함께** 막는다.
//   원본 HTML 은 public/ 정적 파일이라 별도 가드가 없다 — 이 접두사가 유일한 경계다.
const P = ['/dashboard','/projects','/phases','/members','/requirements','/issues','/risks','/tasks','/backlog','/documents','/interfaces','/infra','/firewall','/procurement','/boards','/meetings','/notifications','/apps'];
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  let res: NextResponse;
  if (P.some((p) => pathname.startsWith(p)) && !req.cookies.get(COOKIE)) {
    const url = req.nextUrl.clone(); url.pathname = '/login'; res = NextResponse.redirect(url);
  } else {
    res = NextResponse.next();
  }
  // 공통 P0-6: 전 라우트 보안 응답 헤더(clickjacking·MIME 스니핑·referrer 최소화, 운영만 HSTS)
  applySecurityHeaders(res.headers, { vercelEnv: process.env.VERCEL_ENV });
  return res;
}
// 정적 자산(_next)·파비콘 제외 전 경로 — 페이지 게이트는 위 P 프리픽스에서만 동작(기존과 동일)
export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'] };
