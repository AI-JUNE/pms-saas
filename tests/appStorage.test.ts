// 제안 앱 브라우저 저장 삭제(외부 오픈 관문 S-1, 2026-10-21).
// 포털 사본 HTML 이 실제로 쓰는 저장 키를 읽어 와 목록이 빠짐없는지 확인한다 — 앱이 새 키를 쓰기 시작하면 여기서 깨진다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { APP_STORAGE_KEYS, isAppStorageKey, clearAppStorage } from '../src/lib/appStorage.ts';

const APPS = path.join(import.meta.dirname, '..', 'public', 'apps');

/** HTML 안에서 localStorage 에 쓰는 고정 키(문자열 리터럴·대문자 상수)를 모은다. 변수 이름(k 등)은 접두사로 덮는다. */
function keysUsed(html: string): string[] {
  const consts: Record<string, string> = {};
  // `const A='x', B='y'` 처럼 한 줄에 여러 개 선언한 경우도 읽는다
  for (const m of html.matchAll(/(?:(?:const|let|var)\s+|,\s*)([A-Z_][A-Z0-9_]*)\s*=\s*['"]([^'"]+)['"]/g)) consts[m[1]] = m[2];
  const out = new Set<string>();
  for (const m of html.matchAll(/localStorage\.setItem\(\s*(['"][^'"]+['"]|[A-Z_][A-Z0-9_]*)/g)) {
    const a = m[1];
    out.add(/^['"]/.test(a) ? a.slice(1, -1) : (consts[a] ?? a));
  }
  return [...out];
}

for (const app of ['quality', 'strategy', 'performance']) {
  test(`${app}: 사본이 쓰는 저장 키는 전부 삭제 대상에 포함`, () => {
    const html = fs.readFileSync(path.join(APPS, app, 'index.html'), 'utf8');
    const used = keysUsed(html);
    assert.ok(used.length > 0, '저장 키를 하나도 못 읽었다 — 추출 규칙 점검');
    const missing = used.filter((k) => !isAppStorageKey(k));
    assert.deepEqual(missing, [], `appStorage.ts 에 없는 키: ${missing.join(', ')}`);
  });
}

test('목록의 정확 키는 실제로 어느 앱 사본에든 등장한다(죽은 항목 방지)', () => {
  const all = ['quality', 'strategy', 'performance'].map((a) => fs.readFileSync(path.join(APPS, a, 'index.html'), 'utf8')).join('\n');
  const dead = Object.values(APP_STORAGE_KEYS).flat().filter((k) => !all.includes(k));
  assert.deepEqual(dead, []);
});

test('clearAppStorage: 앱 키·동적 키만 지우고 포털 자체 키는 남긴다', () => {
  const data = new Map<string, string>([
    ['qualibid_results_v1', '[]'], ['ecs_results_v1', '[]'], ['cx_clients', '{}'], ['cx_iv_struct_cache_v1:abc', 'x'],
    ['llmAuditLog', '[]'], ['llmConsentSkip:anthropic', '1'],
    ['pms_theme', 'dark'], ['nextauth', 'keep'],
  ]);
  const store = {
    get length() { return data.size; },
    key: (i: number) => [...data.keys()][i] ?? null,
    removeItem: (k: string) => { data.delete(k); },
  };
  const removed = clearAppStorage(store);
  assert.equal(removed.length, 6);
  assert.deepEqual([...data.keys()].sort(), ['nextauth', 'pms_theme']);
});

test('기본 로그아웃은 지우지 않고, 삭제는 확인창을 거친 별도 메뉴로만', () => {
  const shell = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'components', 'Shell.tsx'), 'utf8');
  assert.match(shell, /onClick=\{\(\) => logout\(\)\}/, '기본 로그아웃 = wipe 없음');
  assert.match(shell, /if \(window\.confirm\('[^']*'\)\) logout\(true\)/, '삭제 로그아웃은 확인 후에만');
  assert.equal((shell.match(/clearAppStorage\(/g) || []).length, 1);
});
