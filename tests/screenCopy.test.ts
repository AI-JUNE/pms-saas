/**
 * screenCopy.test.ts — 로그인 뒤 공통 화면(메뉴, 대시보드)과 요금제의 문구 규칙. 2026-10-29 사용자: "전문 PM 이 쓴 문구,
 * 가운데 점과 AI 같은 내용 제거". 약관과 개인정보처리방침은 법령 표현("열람·정정·삭제·처리정지")을 따르므로 대상이 아니다.
 * 주석은 빼고 화면에 나오는 코드만 본다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PLANS } from '../src/lib/billing.ts';
import { ACTION_META } from '../src/lib/actionNeeded.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const code = (...p: string[]) => fs.readFileSync(path.join(ROOT, ...p), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/;\s*\/\/.*$/gm, ';'); // 문장 뒤 줄 끝 주석
const FILES = [
  ['src', 'components', 'Shell.tsx'], ['src', 'components', 'Forbidden.tsx'], ['src', 'app', 'dashboard', 'page.tsx'],
  ['src', 'app', 'pricing', 'page.tsx'], ['src', 'lib', 'appRoutes.ts'],
];

test('메뉴, 대시보드, 요금제 화면에 가운데 점이 없다', () => {
  for (const f of FILES) assert.equal((code(...f).match(/·/g) || []).length, 0, f.join('/'));
});

test('모든 화면 파일에 가운데 점이 없다(입력 글머리표를 떼는 정규식 문자 묶음은 동작 코드라 제외)', () => {
  // 법령 표현을 따르는 약관과 개인정보처리방침, 결제 시험 버튼은 대상이 아니다.
  const SKIP = ['src/app/terms/', 'src/app/privacy/', 'src/app/pricing/CheckoutButton.tsx'];
  const bad: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(path.join(ROOT, d), { withFileTypes: true })) {
      const rel = `${d}/${e.name}`;
      if (SKIP.some((s) => rel.startsWith(s))) continue;
      if (e.isDirectory()) { if (e.name !== 'api') walk(rel); continue; }
      if (!e.name.endsWith('.tsx')) continue;
      const s = code(...rel.split('/')).replace(/\[[^\]\n]*·[^\]\n]*\]/g, '');
      const n = (s.match(/·/g) || []).length;
      if (n) bad.push(`${rel} ${n}`);
    }
  };
  walk('src/app'); walk('src/components');
  assert.deepEqual(bad, []);
});

test('요금제 카드와 조치 필요 이름표에 가운데 점이 없다', () => {
  for (const p of PLANS) for (const s of [p.unit ?? '', p.note, p.desc, ...p.features]) assert.doesNotMatch(s, /·/, `${p.id}: ${s}`);
  for (const m of Object.values(ACTION_META)) assert.doesNotMatch(m.label + m.hint, /·/, m.label);
});

test('근거 없는 표시를 하지 않는다', () => {
  assert.ok(!PLANS.some((p) => /가장 많이/.test(p.note)), '선택 비율을 잰 적이 없으므로 인기 표시 금지');
  const shell = code('src', 'components', 'Shell.tsx');
  assert.doesNotMatch(shell, /연결됨/, '실제 상태를 보지 않는 고정 연결 표시 금지');
  assert.doesNotMatch(shell, /v17/, '고정된 빌드 번호 표시 금지');
  const dash = code('src', 'app', 'dashboard', 'page.tsx');
  assert.equal(dash.match(/\p{Extended_Pictographic}/u)?.[0] ?? null, null, '대시보드 인사말에 이모지 없음');
  assert.doesNotMatch(dash, /한눈에/);
});
