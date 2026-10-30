/**
 * projectFallback.test.ts — 2026-10-30 운영 둘러보기에서 찾은 화면 문제 두 가지.
 *  1) 저장된 프로젝트 선택이 없을 때 위쪽 막대(Shell)는 첫 프로젝트를 보여 주는데, 목록 화면(ResourceView)은
 *     "프로젝트가 없습니다"를 띄우고 전체 프로젝트 행을 섞어 보여 줬다 → 목록도 첫 프로젝트를 쓴다.
 *  2) 창 폭이 800px 안팎이면 위쪽 화면 제목이 한 글자씩 세로로 꺾였다 → 한 줄 + 줄임표.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (...p: string[]) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

test('목록 화면은 저장된 선택이 없으면 위쪽 막대와 같이 첫 프로젝트를 쓴다', () => {
  const s = read('src', 'components', 'ResourceView.tsx');
  const shell = read('src', 'components', 'Shell.tsx');
  assert.match(shell, /localStorage\.getItem\('pms\.project'\)\) \|\| \(a\[0\]\?\.id \?\? null\)/, '막대는 첫 프로젝트로 대체(기준)');
  assert.match(s, /if \(!projectScoped \|\| saved\) \{ setPid\(saved\); load\(saved\); return; \}/, '저장된 선택이 있으면 그대로');
  assert.match(s, /fetch\('\/api\/projects'\)[\s\S]{0,200}const first = Array\.isArray\(d\) && d\[0\]\?\.id \? Number\(d\[0\]\.id\) : null;/, '없으면 첫 프로젝트');
  assert.match(s, /localStorage\.setItem\('pms\.project', String\(first\)\)/, '고른 프로젝트를 저장해 화면 사이 이동에도 같게');
});

test('위쪽 화면 제목은 한 줄 + 줄임표(좁은 창에서 세로로 꺾이지 않게)', () => {
  const css = read('src', 'app', 'globals.css');
  const base = css.split('\n').find((l) => l.startsWith('.tb-title{font-size:16px')) || '';
  for (const p of ['min-width:0', 'overflow:hidden', 'text-overflow:ellipsis', 'white-space:nowrap']) assert.ok(base.includes(p), p);
});
