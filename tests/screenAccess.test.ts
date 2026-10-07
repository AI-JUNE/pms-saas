/**
 * screenAccess.test.ts — 화면(URL) 단위 역할 접근 정책. 2026-10-07 (주간 수동, ROADMAP ⑩ 28)
 *
 * 왜 필요한가: 일반 멤버가 /admin 에서 구성원 전원의 이메일을 볼 수 있었다(쓰기만 막혀 있었다).
 * 정책 표 하나를 Shell 메뉴·서버 레이아웃·API 세 곳이 함께 쓰므로, 표와 배선을 파일 수준에서 고정한다.
 * 이 테스트는 파일만 읽는다 — 네트워크·DB 를 쓰지 않는다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  SCREEN_POLICY, ROLE_LEVEL, LEVEL_RANK, DEFAULT_LEVEL,
  normalizeHref, principalLevel, requiredLevel, levelSatisfies, screenDecision, canAccessScreen,
  filterNav, forbiddenMessage, screenAccessError, auditScreenPolicy, accessMatrix, screenAccessStatus,
} from '../src/lib/screenAccess.ts';
import { APP_SCREENS } from '../src/lib/appRoutes.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (...p: string[]) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

const member = { role: 'member', isOrgAdmin: false };
const pm = { role: 'pm', isOrgAdmin: false };
const pmo = { role: 'pmo', isOrgAdmin: false };
const admin = { role: 'admin', isOrgAdmin: true };
const su = { role: 'member', isOrgAdmin: false, isSuperadmin: true };
const partner = { role: 'partner_admin', isOrgAdmin: false };

test('principalLevel: 슈퍼관리자·조직관리자는 admin, 역할 표 밖은 member, 파트너는 null', () => {
  assert.equal(principalLevel(member), 'member');
  assert.equal(principalLevel(pm), 'lead');
  assert.equal(principalLevel(pmo), 'lead');
  assert.equal(principalLevel(admin), 'admin');
  assert.equal(principalLevel(su), 'admin');
  assert.equal(principalLevel({ role: 'member', isOrgAdmin: true }), 'admin', 'isOrgAdmin 은 역할 문자열보다 우선');
  assert.equal(principalLevel({ role: 'viewer' }), 'member', '미지 역할은 최소 등급(잠금 방지)');
  assert.equal(principalLevel(partner), null);
  assert.equal(principalLevel(null), null);
});

test('requiredLevel: 표의 가장 긴 접두사, 표 밖은 member(기본 허용)', () => {
  assert.equal(requiredLevel('/admin'), 'admin');
  assert.equal(requiredLevel('/admin/security'), 'admin');
  assert.equal(requiredLevel('/admin/security/?x=1'), 'admin');
  assert.equal(requiredLevel('/audit'), 'lead');
  assert.equal(requiredLevel('/settings/billing'), 'admin');
  assert.equal(requiredLevel('/settings'), 'member', '/settings 자체는 모두에게 열린다(내 계정)');
  assert.equal(requiredLevel('/administrator'), 'member', '접두사 흉내는 다른 경로다');
  assert.equal(requiredLevel('/tasks'), 'member');
  assert.equal(requiredLevel(''), DEFAULT_LEVEL);
  assert.equal(requiredLevel(null), DEFAULT_LEVEL);
});

test('권한 매트릭스: 역할 × 관리 화면', () => {
  const m = accessMatrix();
  assert.deepEqual(m.member, { '/admin': false, '/admin/security': false, '/audit': false, '/settings/billing': false });
  assert.deepEqual(m.pm, { '/admin': false, '/admin/security': false, '/audit': true, '/settings/billing': false });
  assert.deepEqual(m.pmo, { '/admin': false, '/admin/security': false, '/audit': true, '/settings/billing': false });
  assert.deepEqual(m.admin, { '/admin': true, '/admin/security': true, '/audit': true, '/settings/billing': true });
  // 업무 화면은 모든 역할에 열려 있다(사용자 잠금 방지)
  for (const p of [member, pm, pmo, admin, su]) {
    for (const href of ['/dashboard', '/tasks', '/issues', '/settings', '/projects/12', '/apps/quality']) {
      assert.equal(canAccessScreen(p, href), true, `${p.role} ${href}`);
    }
  }
  assert.equal(canAccessScreen(su, '/admin/security'), true);
});

test('screenDecision: 조직 정보가 없으면 관리 화면만 거부, 파트너 역할은 전부 거부', () => {
  assert.equal(screenDecision(null, '/tasks').allowed, true);
  const noOrg = screenDecision(null, '/admin');
  assert.equal(noOrg.allowed, false); assert.equal(noOrg.reason, 'no_org');
  const p = screenDecision(partner, '/tasks');
  assert.equal(p.allowed, false); assert.equal(p.reason, 'partner_role');
  assert.equal(screenDecision({ ...partner, isSuperadmin: true }, '/admin').allowed, true, '슈퍼관리자는 역할 문자열에 막히지 않는다');
  const d = screenDecision(member, '/admin');
  assert.equal(d.reason, 'insufficient_role'); assert.equal(d.required, 'admin'); assert.equal(d.have, 'member');
  assert.match(forbiddenMessage(d), /관리자 권한이 필요/);
  assert.match(forbiddenMessage(noOrg), /소속 조직/);
  assert.match(forbiddenMessage(p), /파트너/);
  const e = screenAccessError(d);
  assert.equal(e?.status, 403); assert.equal(e?.code, 'FORBIDDEN');
  assert.equal(screenAccessError(screenDecision(admin, '/admin')), null);
});

test('levelSatisfies / LEVEL_RANK 는 단조', () => {
  assert.ok(LEVEL_RANK.member < LEVEL_RANK.lead && LEVEL_RANK.lead < LEVEL_RANK.admin);
  assert.equal(levelSatisfies('lead', 'member'), true);
  assert.equal(levelSatisfies('member', 'lead'), false);
  assert.equal(levelSatisfies(null, 'member'), false);
  assert.ok(Object.values(ROLE_LEVEL).every((l) => l in LEVEL_RANK));
});

test('filterNav: 주체를 모르면(로딩 전) 관리 화면을 숨기고, 관리자는 전부 본다', () => {
  const nav = [{ href: '/dashboard' }, { href: '/admin' }, { href: '/audit' }, { href: '/settings' }];
  assert.deepEqual(filterNav(nav, null).map((n) => n.href), ['/dashboard', '/settings']);
  assert.deepEqual(filterNav(nav, member).map((n) => n.href), ['/dashboard', '/settings']);
  assert.deepEqual(filterNav(nav, pm).map((n) => n.href), ['/dashboard', '/audit', '/settings']);
  assert.deepEqual(filterNav(nav, admin).map((n) => n.href), nav.map((n) => n.href));
});

test('normalizeHref: 쿼리·해시·끝 슬래시 제거', () => {
  assert.equal(normalizeHref('/admin/?x=1#y'), '/admin');
  assert.equal(normalizeHref('admin'), '');
  assert.equal(normalizeHref(undefined), '');
});

test('정책 표의 경로는 전부 실존 화면이다 ⬅ 오타 난 키는 아무것도 막지 않는다', () => {
  const a = auditScreenPolicy(APP_SCREENS.map((s) => s.href));
  assert.deepEqual(a.unknownTargets, []);
  assert.deepEqual(a.adminScreens, ['/admin', '/admin/security', '/settings/billing']);
  const st = screenAccessStatus();
  assert.equal(st.policies, Object.keys(SCREEN_POLICY).length);
  assert.equal(st.adminOnly, 3); assert.equal(st.leadOnly, 1); assert.equal(st.defaultLevel, 'member');
});

// ── 실제 소스 배선 ────────────────────────────────────────────────────────────

test('[실제 소스] Shell 이 정책으로 메뉴를 거른다', () => {
  const shell = read('src', 'components', 'Shell.tsx');
  assert.ok(shell.includes("from '@/lib/screenAccess'"), 'Shell 이 screenAccess 를 쓰지 않는다');
  assert.ok(/filterNav\(/.test(shell), '사이드바 메뉴 필터 누락');
  assert.ok(/canAccessScreen\([^)]*'\/audit'\)/.test(shell), '사용자 메뉴의 감사 로그 링크가 정책을 보지 않는다');
});

test('[실제 소스] 관리 화면 3곳에 서버 레이아웃 게이트가 있다', () => {
  for (const [dir, href] of [[['admin'], '/admin'], [['audit'], '/audit'], [['settings', 'billing'], '/settings/billing']] as Array<[string[], string]>) {
    const p = path.join(ROOT, 'src', 'app', ...dir, 'layout.tsx');
    assert.ok(fs.existsSync(p), `${href} 레이아웃 없음`);
    const src = fs.readFileSync(p, 'utf8');
    assert.ok(src.includes('ScreenGate'), `${href} 레이아웃이 ScreenGate 를 쓰지 않는다`);
    assert.ok(src.includes(`href="${href}"`), `${href} 레이아웃의 href 가 다르다`);
  }
  const gate = read('src', 'components', 'ScreenGate.tsx');
  assert.ok(gate.includes('screenDecision(') && gate.includes("redirect('/login')"), 'ScreenGate 가 판정·리다이렉트를 하지 않는다');
  assert.ok(!gate.includes("'use client'"), 'ScreenGate 는 서버 컴포넌트여야 한다(세션 쿠키를 서버에서 읽는다)');
});

test('[실제 소스] 화면이 부르는 API 도 같은 정책으로 403 을 낸다 ⬅ UI 우회 차단', () => {
  const pairs: Array<[string[], string]> = [
    [['admin', 'users'], '/admin'],
    [['audit'], '/audit'],
    [['billing', 'subscription'], '/settings/billing'],
  ];
  for (const [seg, href] of pairs) {
    const src = read('src', 'app', 'api', ...seg, 'route.ts');
    assert.ok(src.includes('assertScreenAccess('), `${seg.join('/')} 라우트에 assertScreenAccess 없음`);
    assert.ok(src.includes(`'${href}'`), `${seg.join('/')} 라우트의 href 가 ${href} 가 아니다`);
  }
  const rbac = read('src', 'lib', 'rbac.ts');
  assert.ok(rbac.includes('export function assertScreenAccess'), 'rbac.ts 가 assertScreenAccess 를 내보내지 않는다');
});
