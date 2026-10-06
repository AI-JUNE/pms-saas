/**
 * writeFreeze.test.ts — RUNBOOK §3 2단계(쓰기 차단) 게이트. 2026-10-06
 *
 * ── 왜 필요한가 ──────────────────────────────────────────────────────────────
 * 2단계가 빠지면 3단계(복구 브랜치 생성) 이후 운영 DB 에 들어온 쓰기가 5단계 전환에서
 * 전부 사라진다. 그런데 4단계 검증은 **복구 브랜치**를 세므로 그 유실을 볼 수 없고,
 * `switchReady: true` 와 전환 성공이 나와 **복구가 「성공」으로 보인다.**
 * 그래서 (1) 차단 판정 자체와 (2) 미들웨어 배선이 살아 있는지를 파일 수준에서 고정한다.
 * 배선이 빠져도 화면은 그대로 돌기 때문에 사람 눈으로는 알아챌 수 없는 회귀다.
 *
 * 이 테스트는 **파일만 읽는다** — 네트워크·DB 를 쓰지 않고 process.env 도 바꾸지 않는다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  FREEZE_CODE,
  FREEZE_EXEMPT,
  FREEZE_LIMITS,
  FREEZE_RETRY_AFTER_SEC,
  FREEZE_STATUS,
  WRITE_FREEZE_ENV,
  auditFreezeWiring,
  auditMatcherCoverage,
  exemptFor,
  freezeDecision,
  freezeLogLine,
  freezeResponseBody,
  methodKind,
  writeFreezeCheck,
  writeFreezeEnabled,
  writeFreezeStatus,
} from '../src/lib/writeFreeze.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (...p: string[]) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

const ON = { enabled: true };

// ── 메서드 분류 ─────────────────────────────────────────────────────────────

test('methodKind: 모르는 메서드를 「읽기」로 가정하지 않는다', () => {
  for (const m of ['GET', 'get', ' head ', 'OPTIONS']) assert.equal(methodKind(m), 'read', m);
  for (const m of ['POST', 'put', 'PATCH', 'delete']) assert.equal(methodKind(m), 'write', m);
  // 목록 밖·빈 값·비문자열은 unknown → 차단 쪽으로 기운다(유실 방지가 목적이다).
  for (const m of ['TRACE', 'CONNECT', '', '   ', null, undefined, 42, {}]) {
    assert.equal(methodKind(m), 'unknown', String(m));
  }
});

// ── 예외 경로 ───────────────────────────────────────────────────────────────

test('exemptFor: 복구가 쓰는 경로만 통과하고, 수상한 경로는 예외로 보지 않는다', () => {
  assert.equal(exemptFor('/api/admin/migrate')?.path, '/api/admin/migrate');
  assert.equal(exemptFor('/api/admin/migrate/')?.path, '/api/admin/migrate');
  assert.equal(exemptFor('//api/admin/migrate')?.path, '/api/admin/migrate', '중복 슬래시로 예외가 깨진다');
  assert.equal(exemptFor('/api/auth/login')?.path, '/api/auth/login');
  // 접두사 흉내 — /api/auth/loginX 는 다른 경로다(경계를 / 로만 인정한다).
  assert.equal(exemptFor('/api/auth/loginX'), null);
  assert.equal(exemptFor('/api/issues'), null);
  // 경로 우회·판독 불가는 fail-closed.
  assert.equal(exemptFor('/api/issues/../admin/migrate'), null);
  assert.equal(exemptFor('/api/admin/%2e%2e/migrate'), null);
  assert.equal(exemptFor('api/admin/migrate'), null, '절대경로가 아니면 예외로 보지 않는다');
  assert.equal(exemptFor(null), null);
  assert.equal(exemptFor('/'), null);
});

test('예외 목록은 전건 사유를 달고 있다 ⬅ 사유 없는 예외를 두지 않는다', () => {
  assert.ok(FREEZE_EXEMPT.length > 0);
  for (const e of FREEZE_EXEMPT) {
    assert.ok(e.path.startsWith('/api/'), `예외는 API 경로만: ${e.path}`);
    assert.ok(e.why.trim().length > 10, `사유 누락: ${e.path}`);
  }
  // migrate 는 DDL 을 쓴다는 사실을 숨기지 않는다.
  assert.match(String(FREEZE_EXEMPT.find((e) => e.path.endsWith('/migrate'))?.writes), /DDL/);
});

// ── 스위치 ──────────────────────────────────────────────────────────────────

test("스위치는 'true' 문자열만 ON ⬅ 오설정이 ON 으로 읽히면 전 사용자의 저장이 막힌다", () => {
  assert.equal(writeFreezeEnabled({ RECOVERY_WRITE_FREEZE: 'true' }), true);
  for (const v of ['1', 'yes', 'TRUE', 'True', ' true', '', undefined]) {
    assert.equal(writeFreezeEnabled({ RECOVERY_WRITE_FREEZE: v }), false, String(v));
  }
  assert.equal(writeFreezeEnabled({}), false, '미설정이 기본 OFF 여야 한다');
  assert.equal(WRITE_FREEZE_ENV, 'RECOVERY_WRITE_FREEZE');
});

// ── 판정 ────────────────────────────────────────────────────────────────────

test('freezeDecision: OFF 면 아무것도 바꾸지 않는다(기본값)', () => {
  for (const m of ['GET', 'POST', 'DELETE', 'TRACE']) {
    const d = freezeDecision({ method: m, path: '/api/issues', enabled: false });
    assert.equal(d.outcome, 'off', m);
    assert.equal(d.blocked, false);
    assert.equal(d.status, null);
  }
  // enabled 가 boolean true 가 아니면(문자열·1 등) 차단하지 않는다 — 실수로 켜지지 않게.
  const loose = freezeDecision({ method: 'POST', path: '/api/issues', enabled: 'true' as unknown as boolean });
  assert.equal(loose.outcome, 'off');
});

test('freezeDecision: 차단 중에도 조회는 열려 있다', () => {
  for (const m of ['GET', 'HEAD', 'OPTIONS']) {
    const d = freezeDecision({ ...ON, method: m, path: '/api/issues' });
    assert.equal(d.outcome, 'read', m);
    assert.equal(d.blocked, false);
  }
  // 화면(페이지) 조회도 막지 않는다.
  assert.equal(freezeDecision({ ...ON, method: 'GET', path: '/dashboard' }).outcome, 'read');
});

test('freezeDecision: 쓰기는 503 WRITE_FROZEN 으로 막고 Retry-After 를 준다', () => {
  const d = freezeDecision({ ...ON, method: 'PATCH', path: '/api/issues/12' });
  assert.equal(d.outcome, 'blocked');
  assert.equal(d.blocked, true);
  assert.equal(d.kind, 'write');
  assert.equal(d.status, FREEZE_STATUS);
  assert.equal(d.status, 503);
  assert.equal(d.code, FREEZE_CODE);
  assert.equal(d.retryAfterSec, FREEZE_RETRY_AFTER_SEC);
  assert.equal(d.exemptWhy, null);
  // 메서드 전건
  for (const m of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    assert.equal(freezeDecision({ ...ON, method: m, path: '/api/tasks' }).blocked, true, m);
  }
});

test('freezeDecision: 모르는 메서드도 막고, 그 사실을 따로 표시한다', () => {
  const d = freezeDecision({ ...ON, method: 'TRACE', path: '/api/tasks' });
  assert.equal(d.outcome, 'blocked_unknown_method');
  assert.equal(d.blocked, true);
  assert.equal(d.kind, 'unknown');
  assert.equal(d.method, 'TRACE');
  // 메서드를 못 읽어도 통과시키지 않는다.
  assert.equal(freezeDecision({ ...ON, method: undefined, path: '/api/tasks' }).blocked, true);
  assert.equal(freezeDecision({ ...ON, method: '', path: '/api/tasks' }).method, '?');
});

test('freezeDecision: 복구 절차가 쓰는 경로는 사유와 함께 통과한다', () => {
  const mig = freezeDecision({ ...ON, method: 'POST', path: '/api/admin/migrate' });
  assert.equal(mig.outcome, 'exempt');
  assert.equal(mig.blocked, false);
  assert.match(String(mig.exemptWhy), /6단계/);
  for (const p of ['/api/auth/login', '/api/auth/logout', '/api/client-errors']) {
    assert.equal(freezeDecision({ ...ON, method: 'POST', path: p }).outcome, 'exempt', p);
  }
  // 예외가 아닌 인증 경로(가입)는 막는다 — 차단 중 가입분은 전환에서 사라진다.
  assert.equal(freezeDecision({ ...ON, method: 'POST', path: '/api/auth/register' }).blocked, true);
});

test('freezeDecision: 판독 불가 경로는 예외로 통과하지 않는다(fail-closed)', () => {
  const d = freezeDecision({ ...ON, method: 'POST', path: '/api/x/../admin/migrate' });
  assert.equal(d.blocked, true, '경로 우회로 예외를 얻을 수 있다');
  assert.equal(d.path, '/api/x/../admin/migrate', '로그용으로 원문을 남긴다');
  assert.equal(freezeDecision({ ...ON, method: 'POST', path: null }).blocked, true);
});

test('응답 본문·로그: 표준 에러 모양을 따르고 본문·쿠키를 담지 않는다', () => {
  const d = freezeDecision({ ...ON, method: 'POST', path: '/api/issues' });
  const body = freezeResponseBody(d);
  assert.equal(body.ok, false);
  assert.equal(body.code, 'WRITE_FROZEN');
  assert.match(body.message, /조회는/);
  assert.match(body.runbook, /§3 2단계/);
  // code·message 가 비어 온 판정에서도 기본값으로 메운다(빈 응답을 내지 않는다).
  const bare = freezeResponseBody({ ...d, code: null, message: null });
  assert.equal(bare.code, 'WRITE_FROZEN');
  assert.ok(bare.message.length > 0);

  const line = freezeLogLine(d);
  assert.match(line, /freeze=blocked/);
  assert.match(line, /method=POST/);
  assert.match(line, /path=\/api\/issues/);
  assert.match(freezeLogLine(freezeDecision({ ...ON, method: 'POST', path: '/api/auth/login' })), /exempt=1/);
});

// ── /api/health 체크 ────────────────────────────────────────────────────────

test('writeFreezeCheck: 차단 중에는 degraded 로 드러내고 503 은 만들지 않는다', () => {
  const off = writeFreezeCheck({ env: {} });
  assert.equal(off.ok, true);
  assert.equal(off.required, false);
  assert.equal(off.detail.frozen, false);
  assert.deepEqual(off.detail.exempt, []);

  const on = writeFreezeCheck({ env: { RECOVERY_WRITE_FREEZE: 'true' } });
  assert.equal(on.ok, false, '차단 중이면 degraded 여야 2단계 확인이 성립한다');
  assert.equal(on.required, false, 'required 가 true 면 복구 중 503 이 되어 모니터를 오염시킨다');
  assert.equal(on.detail.frozen, true);
  assert.deepEqual(on.detail.exempt, FREEZE_EXEMPT.map((e) => e.path));
  assert.deepEqual(on.detail.limits, FREEZE_LIMITS);
});

test('차단은 「유실 없음」을 뜻하지 않는다 ⬅ 막지 못하는 경로를 함께 내보낸다', () => {
  assert.ok(FREEZE_LIMITS.length >= 4);
  const joined = FREEZE_LIMITS.join('\n');
  assert.match(joined, /DATABASE_URL/, '직접 DB 접속이 사각지대라는 사실이 빠졌다');
  assert.match(joined, /프리뷰|다른 배포/, '배포별로 켜야 한다는 사실이 빠졌다');
  assert.match(joined, /웹훅/, '외부 웹훅 유실 가능성이 빠졌다');
});

test('writeFreezeStatus: 요약은 상태만 말하고 수치를 지어내지 않는다', () => {
  const s = writeFreezeStatus({});
  assert.equal(s.frozen, false);
  assert.equal(s.switchKey, 'RECOVERY_WRITE_FREEZE');
  assert.deepEqual(s.exemptPaths, FREEZE_EXEMPT.map((e) => e.path));
  assert.equal(s.limits, FREEZE_LIMITS.length);
  assert.match(s.note, /기본 OFF|OFF\(기본값\)/);
  assert.match(writeFreezeStatus({ RECOVERY_WRITE_FREEZE: 'true' }).note, /ON/);
});

// ── 배선 정적 점검(함수 단위) ───────────────────────────────────────────────

test('auditFreezeWiring: 게이트가 빠진 미들웨어를 전부 잡는다', () => {
  assert.ok(auditFreezeWiring('export function middleware(){ return NextResponse.next(); }').length >= 2);
  // 판정은 하지만 분기하지 않는 경우(가장 조용한 회귀) — 반드시 잡아야 한다.
  const noBranch = `import { freezeDecision } from './lib/writeFreeze';
    freezeDecision({ method: req.method, path: pathname, enabled: process.env.RECOVERY_WRITE_FREEZE === 'true' });
    return NextResponse.next();`;
  assert.ok(auditFreezeWiring(noBranch).some((p) => /분기/.test(p)));
  // 스위치를 느슨하게 읽는 경우
  const loose = `import { freezeDecision } from './lib/writeFreeze';
    const f = freezeDecision({ method: req.method, path: pathname, enabled: Boolean(process.env.RECOVERY_WRITE_FREEZE) });
    if (f.blocked) return new Response('', { status: 503 });`;
  assert.ok(auditFreezeWiring(loose).some((p) => /true/.test(p)));
  // 판정이 통과 뒤로 밀린 경우
  const late = `import { freezeDecision } from './lib/writeFreeze';
    const res = NextResponse.next();
    const f = freezeDecision({ method: req.method, path: pathname, enabled: process.env.RECOVERY_WRITE_FREEZE === 'true' });
    if (f.blocked) { void 503; }`;
  assert.ok(auditFreezeWiring(late).some((p) => /뒤에 있다/.test(p)));
  assert.ok(auditFreezeWiring(null).length > 0);
});

test('auditMatcherCoverage: matcher 가 api 를 제외하면 잡는다', () => {
  assert.deepEqual(auditMatcherCoverage(`const config = { matcher: ['/((?!_next/static).*)'] };`), []);
  const excluded = auditMatcherCoverage(`const config = { matcher: ['/((?!api|_next).*)'] };`);
  assert.equal(excluded.length, 1);
  assert.match(excluded[0], /api 를 제외/);
  assert.match(auditMatcherCoverage('없음')[0], /matcher/);
  assert.ok(auditMatcherCoverage(`const config = { matcher: ['/dashboard'] };`).length > 0);
});

// ── 실제 소스·문서 대조 ────────────────────────────────────────────────────

test('[실제 소스] src/middleware.ts 가 쓰기 차단 게이트를 물고 있다', () => {
  const mw = read('src', 'middleware.ts');
  assert.deepEqual(auditFreezeWiring(mw), [],
    '미들웨어가 유일한 적용 지점이다 — 한 줄이 빠지면 차단이 조용히 사라진다');
  assert.deepEqual(auditMatcherCoverage(mw), []);
  // 차단 응답에도 보안 헤더가 붙어야 한다(응답 조립 뒤에 applySecurityHeaders 가 온다).
  assert.ok(mw.indexOf('freezeDecision(') < mw.indexOf('applySecurityHeaders('),
    '차단 응답이 보안 헤더를 건너뛴다');
  // 세션 게이트(기존 동작)를 밀어내지 않았다.
  assert.match(mw, /req\.cookies\.get\(COOKIE\)/);
});

test('[실제 소스] /api/health 가 차단 상태를 노출한다 ⬅ 2단계의 유일한 확인 수단', () => {
  const route = read('src', 'app', 'api', 'health', 'route.ts');
  assert.match(route, /writeFreezeCheck\(\)/);
  assert.match(route, /checks\.writeFreeze\s*=/);
  // route.ts 는 HTTP 메서드·설정 외 export 금지(Vercel 빌드 실패 원인).
  const exports = [...route.matchAll(/^export\s+(?:async\s+)?(?:function\s+(\w+)|const\s+(\w+))/gm)]
    .map((m) => m[1] ?? m[2]).sort();
  assert.deepEqual(exports, ['GET', 'dynamic']);
});

test('[실제 소스] 쓰기 차단이 DB·DDL 을 건드리지 않는다(판정만 한다)', () => {
  const src = read('src', 'lib', 'writeFreeze.ts');
  for (const bad of ['@/db', "from './db", 'drizzle', 'CREATE TABLE', 'ALTER TABLE', 'db.execute']) {
    assert.ok(!src.includes(bad), `순수 모듈에 ${bad} 가 들어왔다`);
  }
});

test('[실제 문서] RUNBOOK 이 2단계·해제·체크리스트를 스위치 이름으로 적고 있다', () => {
  const md = read('RUNBOOK.md');
  // §3 2단계가 더 이상 「수행할 수 없는 문장」이 아니다.
  assert.match(md, /2\. \*\*쓰기 차단\*\* — 운영 배포의 환경변수 `RECOVERY_WRITE_FREEZE=true`/);
  assert.match(md, /### 3-3\. 쓰기 차단/);
  // 해제 단계가 절차에 있다 — 끄지 않으면 서비스가 읽기전용으로 남는다.
  assert.match(md, /7\. \*\*쓰기 차단 해제\*\*/);
  // 리허설이 2단계를 실제로 검증한다(켜기·거절 확인·해제).
  const list = md.slice(md.indexOf('### 리허설 체크리스트'));
  assert.match(list, /checks\.writeFreeze\.detail\.frozen` 이 `true`/);
  assert.match(list, /WRITE_FROZEN/);
  assert.match(list, /쓰기 차단 \*\*해제\*\*/);
  // 예외 경로는 코드가 정본이고 문서가 그것을 그대로 적는다.
  for (const e of FREEZE_EXEMPT) {
    assert.ok(md.includes(e.path), `RUNBOOK 3-3 예외 표에 ${e.path} 가 없다`);
  }
  // Vercel 트래픽 차단으로 대신하면 복구 자신이 막힌다는 경고가 살아 있다.
  assert.match(md, /Vercel 트래픽 차단으로 대신하지 말 것/);
});
