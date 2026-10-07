/**
 * loginA11y.test.ts — 로그인(/login) 탭 키보드 접근성. 2026-10-07 (주간 수동, ROADMAP ⑨ 19 잔여 메모)
 *
 * 배치140·172 메모: 로그인 탭이 마우스 전용 div 였으나 인증 화면이라 야간 금지였다. 주간에 처리하며 구조를 파일 수준에서 고정한다.
 * 파일만 읽는다 — 네트워크·DB 미사용.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (...p: string[]) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

test('[실제 소스] /login 탭은 tablist/tab/tabpanel 시맨틱과 화살표 키 이동을 갖는다', () => {
  const src = read('src', 'app', 'login', 'page.tsx');
  assert.ok(src.includes('role="tablist"'), 'tablist 누락');
  assert.ok((src.match(/role="tab"/g) ?? []).length >= 2, 'tab 역할 2개 이상이어야 한다(로그인·회원가입)');
  assert.ok(src.includes('aria-selected='), 'aria-selected 누락');
  assert.ok(src.includes('aria-controls='), 'aria-controls 누락');
  assert.ok(src.includes('role="tabpanel"') && src.includes('aria-labelledby='), 'tabpanel/aria-labelledby 누락');
  assert.ok(src.includes('ArrowLeft') && src.includes('ArrowRight'), '화살표 키 이동 누락');
  assert.ok(src.includes("'Home'") && src.includes("'End'"), 'Home/End 이동 누락');
  assert.ok(/tabIndex=\{mode === /.test(src) || /tabIndex=\{[^}]*\? 0 : -1\}/.test(src), '로빙 tabIndex(활성 탭만 0) 누락');
  assert.ok(/<button[^>]*className=\{`auth-tab/.test(src), '탭은 button 이어야 한다(div 는 포커스를 받지 못한다)');
  assert.ok(!/<div[^>]*className=\{`auth-tab/.test(src), '마우스 전용 div 탭이 남아 있다');
  assert.ok(src.includes('/reset-password'), '비밀번호 재설정 링크 누락');
});

test('[실제 소스] .auth-tab 이 button 으로 바뀌어도 모양이 유지되고 포커스 링이 보인다', () => {
  const css = read('src', 'app', 'globals.css');
  const rule = css.match(/\.auth-tab\{[^}]*\}/)?.[0] ?? '';
  assert.ok(/border:\s*0|border:\s*none/.test(rule), '.auth-tab 의 button 기본 테두리 제거 누락');
  assert.ok(/cursor:\s*pointer/.test(rule), '.auth-tab cursor 누락');
  assert.ok(/font(-family)?:\s*inherit/.test(rule), '.auth-tab 글꼴 상속 누락(button 은 기본 글꼴을 쓴다)');
  assert.ok(/\[role="tab"\][^{]*:focus-visible/.test(css) || /\.auth-tab:focus-visible/.test(css), '탭 포커스 링 누락');
});
