/**
 * guestMode.test.ts — 둘러보기(손님) 모드. 2026-10-28 사용자 요청("회원가입 없이 바로 볼 수 있도록")
 * 로그인을 없애지 않고 데모 전용 조직에 읽기 전용 손님으로 — 쓰기는 미들웨어가 막는다. 순수 함수 + 소스 확인.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { GUEST_PREFIX, GUEST_EMAIL, DEMO_ORG_SLUG, GUEST_ALLOW_WRITE, isGuestToken, isGuestEmail, guestWriteDecision } from '../src/lib/guestMode.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (...p: string[]) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const G = GUEST_PREFIX + 'a'.repeat(64), U = 'b'.repeat(64);

test('손님 토큰·메일·켜기 스위치', () => {
  assert.equal(isGuestToken(G), true);
  assert.equal(isGuestToken(U), false);
  assert.equal(isGuestToken(GUEST_PREFIX + 'x'), false, '너무 짧은 표지는 손님 아님');
  assert.equal(isGuestToken(null), false);
  assert.equal(isGuestEmail(' Guest@Demo.Gowon '), true); assert.equal(isGuestEmail('user@a.com'), false);
});

test('손님은 읽기만 — /api 쓰기는 403, 로그아웃·다시 입장만 허용', () => {
  for (const m of ['POST', 'PATCH', 'PUT', 'DELETE']) {
    const d = guestWriteDecision({ method: m, path: '/api/issues', token: G });
    assert.equal(d.blocked, true, m); assert.equal(d.status, 403); assert.equal(d.body?.code, 'GUEST_READ_ONLY');
  }
  assert.equal(guestWriteDecision({ method: 'POST', path: '/api/profile', token: G }).blocked, true, '프로필·비밀번호 변경도 막힘');
  assert.equal(guestWriteDecision({ method: 'POST', path: '/api/auth/password-reset', token: G }).blocked, true);
  for (const p of GUEST_ALLOW_WRITE) assert.equal(guestWriteDecision({ method: 'POST', path: p, token: G }).blocked, false, p);
  assert.equal(guestWriteDecision({ method: 'GET', path: '/api/issues', token: G }).blocked, false, '읽기는 허용');
  assert.equal(guestWriteDecision({ method: 'HEAD', path: '/api/dashboard', token: G }).blocked, false);
  assert.equal(guestWriteDecision({ method: 'POST', path: '/dashboard', token: G }).blocked, false, '화면 경로는 대상 아님');
  assert.equal(guestWriteDecision({ method: 'POST', path: '/api/issues', token: U }).blocked, false, '일반 사용자는 그대로');
  assert.equal(guestWriteDecision({ method: 'POST', path: '/api/issues', token: null }).blocked, false, '로그인 안 함은 각 API 가 401');
});

test('입장 API — 데모 조직(초대 코드 없음)·무작위 비밀번호·짧은 세션·요청 제한·끄기·감사', () => {
  const r = read('src', 'app', 'api', 'auth', 'guest', 'route.ts');
  assert.match(r, /eq\(organizations\.slug, DEMO_ORG_SLUG\)/);
  assert.match(r, /inviteCode: null/, '누구도 데모 조직에 가입할 수 없다');
  assert.match(r, /passwordHash: hashPassword\(crypto\.randomBytes\(48\)/, '손님 계정은 비밀번호로 로그인할 수 없다');
  assert.match(r, /role: 'member', isOrgAdmin: false/, '관리자 아님');
  assert.match(r, /createSession\(d\.userId, .*\{ prefix: GUEST_PREFIX, days: GUEST_SESSION_DAYS \}\)/);
  assert.match(r, /enforceRateLimit\(req, RL\.authGuest\)/);
  assert.match(r, /process\.env\.PMS_GUEST_DISABLED === 'true'/, '끄는 스위치(=== true 규칙)');
  assert.equal((r.match(/tenant-scan: allow/g) || []).length, 1, '조직 범위 예외는 데모 조직 찾기 1곳');
  assert.match(r, /auditSecurity\('AUTH_GUEST_ENTER'/);
  assert.match(r, /if \(created\) \{ try \{ await seedDemo/, '샘플 데이터는 데모 조직을 처음 만들 때 한 번만');
  assert.equal(DEMO_ORG_SLUG, 'gowon-demo'); assert.ok(GUEST_EMAIL.endsWith('@demo.gowon'));
});

test('세션 표지·미들웨어·화면 연결', () => {
  const a = read('src', 'lib', 'auth.ts');
  assert.match(a, /const token = \(opts\.prefix \|\| ''\) \+ crypto\.randomBytes\(32\)/);
  assert.match(a, /\(opts\.days \?\? SESSION_DAYS\)/);
  const m = read('src', 'middleware.ts');
  assert.match(m, /guestWriteDecision\(\{ method: req\.method, path: pathname, token: \(tok = await verifyCookie/);
  assert.ok(m.indexOf('freeze.blocked') < m.indexOf('guestWriteDecision({'), '복구 중 쓰기 차단이 먼저');
  assert.match(m, /P\.some\(\(p\) => pathname\.startsWith\(p\)\) && !tok\)/, '로그인 게이트는 그대로(같은 토큰 확인)');
  assert.match(read('src', 'lib', 'ratelimit.ts'), /authGuest: \{ key: 'auth:guest'/);
  assert.match(read('src', 'app', 'api', 'auth', 'me', 'route.ts'), /guest: isGuestEmail\(user\.email\)/);
  const lp = read('src', 'app', 'login', 'page.tsx');
  assert.match(lp, /fetch\('\/api\/auth\/guest', \{ method: 'POST' \}\)/); assert.match(lp, /회원가입 없이 둘러보기/);
  assert.match(read('src', 'components', 'Shell.tsx'), /me\?\.guest && <div className="guest-bar"/);
});
