/**
 * lpCopy.test.ts — 소개 페이지 문구 규칙. 2026-10-29 사용자: "전문 PM 이 쓴 문구, 가운데 점과 AI 같은 내용 제거,
 * 막대그래프와 '아·현·설' 같은 글자 표시는 아이콘으로". 주석은 빼고 화면에 나오는 코드만 본다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const code = (...p: string[]) => fs.readFileSync(path.join(ROOT, ...p), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
const FILES = [['src', 'app', 'lp', 'LpClient.tsx'], ['src', 'app', 'lp', 'page.tsx'], ['src', 'app', 'page.tsx'], ['src', 'app', 'login', 'page.tsx'], ['src', 'app', 'layout.tsx']];

test('화면 문구에 가운데 점이 없다', () => {
  for (const f of FILES) assert.equal((code(...f).match(/·/g) || []).length, 0, f.join('/'));
});

test('소개 페이지에 이모지 아이콘이 없다(선 아이콘으로)', () => {
  const s = code('src', 'app', 'lp', 'LpClient.tsx');
  assert.equal(s.replace(/©/g, '').match(/\p{Extended_Pictographic}/u)?.[0] ?? null, null, '저작권 표시 ©는 제외');
  assert.match(s, /from 'lucide-react'/);
});

test("업무 목록은 한 글자 동그라미('아·현·설') 대신 업무 유형 아이콘", () => {
  const s = code('src', 'app', 'lp', 'LpClient.tsx');
  assert.doesNotMatch(s, /lp-av/, '머리글자 동그라미 없음');
  assert.match(s, /<Layers size=\{16\} \/><\/span><span className="tn"><b>아키텍처 설계/);
  assert.match(s, /<ScanSearch size=\{16\} \/><\/span><span className="tn"><b>현황 분석/);
});

test('움직임은 줄이기 설정을 따르고, 예시 숫자에는 데모 표기', () => {
  const s = code('src', 'app', 'lp', 'LpClient.tsx');
  assert.match(s, /prefers-reduced-motion:reduce/);
  assert.match(s, /matchMedia\('\(prefers-reduced-motion: reduce\)'\)/);
  assert.ok((s.match(/<em>데모 화면<\/em>/g) || []).length >= 1, '대시보드 예시에 데모 화면 표기');
  assert.match(s, /특정 고객사의 운영 실적이 아닙니다/);
});

test('데모 보기는 회원가입 없이 둘러보기로 들어간다', () => {
  const s = code('src', 'app', 'lp', 'LpClient.tsx');
  assert.match(s, /fetch\('\/api\/auth\/guest', \{ method: 'POST' \}\)/);
});
