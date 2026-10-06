import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { applySecurityHeaders } from './lib/securityHeaders';
import { freezeDecision, freezeLogLine, freezeResponseBody } from './lib/writeFreeze';
const COOKIE = process.env.SESSION_COOKIE || 'pms_session';
// ⚠️ 세션 게이트 접두사. 여기서 **빼면** 그 화면이 로그인 없이 열린다 — 추가는 안전, 삭제는 위험.
//   '/apps' 는 제안 앱(2026-09-29 편입). matcher 가 제외하는 건 _next/static·_next/image·favicon 뿐이라
//   이 한 줄이 라우트(/apps/quality)와 원본 HTML(/apps/quality/index.html)을 **함께** 막는다.
//   원본 HTML 은 public/ 정적 파일이라 별도 가드가 없다 — 이 접두사가 유일한 경계다.
const P = ['/dashboard','/projects','/phases','/members','/requirements','/issues','/risks','/tasks','/backlog','/documents','/interfaces','/infra','/firewall','/procurement','/boards','/meetings','/notifications','/apps'];
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  let res: NextResponse;
  // RUNBOOK §3 2단계(쓰기 차단) — 복구 작업 중 운영 DB 에 들어오는 쓰기를 막는다.
  //   미들웨어가 유일한 적용 지점이다: 라우트 38곳 중 handle(fn, req) 로 req 를 넘기는 곳은
  //   13곳뿐이라 lib/http.ts 는 메서드·경로를 모르는 호출이 많다. 여기는 matcher 가 전 경로를
  //   덮으므로 설정기반 CRUD 40개 라우트와 앞으로 생길 라우트까지 함께 걸린다.
  //   스위치를 여기서 직접 읽는 이유: Edge 런타임은 process.env.KEY 를 빌드 시 리터럴로
  //   치환하므로 env 객체를 통째로 넘기면 키가 비어 올 수 있다(writeFreeze.ts 주석 참고).
  const freeze = freezeDecision({
    method: req.method,
    path: pathname,
    enabled: process.env.RECOVERY_WRITE_FREEZE === 'true',
  });
  if (freeze.blocked) {
    console.warn('[write-freeze]', freezeLogLine(freeze));
    res = NextResponse.json(freezeResponseBody(freeze), {
      status: freeze.status ?? 503,
      headers: {
        'Retry-After': String(freeze.retryAfterSec ?? 120),
        'Cache-Control': 'no-store',
      },
    });
  } else if (P.some((p) => pathname.startsWith(p)) && !req.cookies.get(COOKIE)) {
    const url = req.nextUrl.clone(); url.pathname = '/login'; res = NextResponse.redirect(url);
  } else {
    res = NextResponse.next();
  }
  // 공통 P0-6: 전 라우트 보안 응답 헤더(clickjacking·MIME 스니핑·referrer 최소화, 운영만 HSTS)
  //   pathname 을 넘기는 이유: 제안 앱 원본 HTML 은 우리 화면이 same-origin iframe 으로
  //   띄우는 문서인데 기본값 X-Frame-Options: DENY 가 그것까지 막는다(DENY 는 same-origin 예외 없음).
  applySecurityHeaders(res.headers, { vercelEnv: process.env.VERCEL_ENV, pathname });
  return res;
}
// 정적 자산(_next)·파비콘 제외 전 경로 — 페이지 게이트는 위 P 프리픽스에서만 동작(기존과 동일)
export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'] };
