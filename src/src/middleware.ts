import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
const COOKIE = process.env.SESSION_COOKIE || 'pms_session';
const P = ['/dashboard','/projects','/phases','/members','/requirements','/issues','/risks','/tasks','/backlog','/documents','/interfaces','/infra','/firewall','/procurement','/boards','/meetings','/notifications'];
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (P.some((p) => pathname.startsWith(p)) && !req.cookies.get(COOKIE)) {
    const url = req.nextUrl.clone(); url.pathname = '/login'; return NextResponse.redirect(url);
  }
  return NextResponse.next();
}
export const config = { matcher: ['/dashboard/:path*','/projects/:path*','/phases/:path*','/members/:path*','/requirements/:path*','/issues/:path*','/risks/:path*','/tasks/:path*','/backlog/:path*','/documents/:path*','/interfaces/:path*','/infra/:path*','/firewall/:path*','/procurement/:path*','/boards/:path*','/meetings/:path*','/notifications/:path*'] };
