import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { applySecurityHeaders } from './lib/securityHeaders';
const COOKIE = process.env.SESSION_COOKIE || 'pms_session';
const P = ['/dashboard','/projects','/phases','/members','/requirements','/issues','/risks','/tasks','/backlog','/documents','/interfaces','/infra','/firewall','/procurement','/boards','/meetings','/notifications'];
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
