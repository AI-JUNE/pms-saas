import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  APP_SCREENS, PUBLIC_SCREENS, UNGATED_SCREENS_KNOWN, ENTRY_HREFS,
  allScreens, normalizePath, findScreen, isKnownScreen, displayPath, editDistance,
  suggestScreens, entryScreens, parseGatedPrefixes, parseNavHrefs, isGatedBy,
  auditSessionGate, auditNavTargets, auditIndexBlock, auditPageFiles, appRoutesStatus,
} from '../src/lib/appRoutes.ts';
import { PUBLIC_PATHS, DISALLOW_PREFIXES } from '../src/lib/siteMeta.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/** src/app 아래 page.tsx 를 훑어 라우트 경로로. 동적 세그먼트(`[id]`)는 상위 화면에 포함되므로 제외. */
function pageHrefs(): string[] {
  const base = path.join(ROOT, 'src', 'app');
  const out: string[] = [];
  const walk = (dir: string, seg: string[]) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) {
        if (e.name === 'api' || e.name.startsWith('_')) continue;
        walk(path.join(dir, e.name), [...seg, e.name]);
      } else if (e.name === 'page.tsx') {
        if (seg.some((s) => s.startsWith('[') || s.startsWith('('))) continue;
        out.push('/' + seg.join('/'));
      }
    }
  };
  walk(base, []);
  return out.map((h) => (h === '/' ? '/' : h)).sort();
}

test('normalizePath: 쿼리·해시·끝 슬래시 제거, 경로가 아니면 빈 문자열', () => {
  assert.equal(normalizePath('/tasks/'), '/tasks');
  assert.equal(normalizePath('/tasks?q=1#top'), '/tasks');
  assert.equal(normalizePath('/'), '/');
  assert.equal(normalizePath('///'), '/');
  assert.equal(normalizePath('tasks'), '');
  assert.equal(normalizePath('https://x/tasks'), '');
  assert.equal(normalizePath(null), '');
  assert.equal(normalizePath(undefined), '');
});

test('findScreen / isKnownScreen: 정확 일치와 하위 경로', () => {
  assert.equal(findScreen('/tasks')?.label, '업무 (WBS)');
  assert.equal(findScreen('/tasks/')?.href, '/tasks');
  assert.equal(findScreen('/nope'), null);
  assert.equal(findScreen('/projects/12'), null, '상세는 정확 일치가 아니다');
  assert.equal(isKnownScreen('/projects/12'), true, '하위 경로는 알려진 화면');
  assert.equal(isKnownScreen('/projects'), true);
  assert.equal(isKnownScreen('/projectz'), false);
  assert.equal(isKnownScreen('/'), true);
  assert.equal(isKnownScreen('/nope/deep'), false);
});

test('displayPath: 쿼리 제거 + 과도한 길이 절단', () => {
  assert.equal(displayPath('/tasks?token=secret'), '/tasks');
  assert.equal(displayPath('/' + 'a'.repeat(100), 10).length, 11);
  assert.equal(displayPath('nonsense'), '');
});

test('editDistance: cap 을 넘으면 cap+1 로 끊는다', () => {
  assert.equal(editDistance('tasks', 'tasks'), 0);
  assert.equal(editDistance('taks', 'tasks'), 1);
  assert.equal(editDistance('porjects', 'projects'), 2);
  assert.equal(editDistance('abc', 'xyzxyzxyz', 3), 4);
  assert.equal(editDistance('', 'ab', 3), 2);
});

test('suggestScreens: 오타·부분 일치만 추천하고 근거 없으면 비운다', () => {
  assert.equal(suggestScreens('/dashbord')[0].href, '/dashboard');
  assert.equal(suggestScreens('/porjects')[0].href, '/projects');
  assert.equal(suggestScreens('/task')[0].href, '/tasks');
  assert.deepEqual(suggestScreens('/qqqqzzzz'), [], '근거 없는 추천을 지어내지 않는다');
  assert.deepEqual(suggestScreens('/'), []);
  assert.deepEqual(suggestScreens('bad-input'), []);
  assert.ok(suggestScreens('/tests').length <= 4, '기본 상한을 지킨다');
  assert.equal(suggestScreens('/tests', 1).length, 1);
  assert.deepEqual(suggestScreens('/tests', 0), []);
});

test('entryScreens: ENTRY_HREFS 가 모두 실재하는 화면', () => {
  const e = entryScreens();
  assert.equal(e.length, ENTRY_HREFS.length);
  for (const s of e) assert.ok(s.label, `${s.href} 라벨 누락`);
});

test('parseGatedPrefixes / parseNavHrefs: 실제 소스에서 목록을 읽어낸다', () => {
  assert.deepEqual(parseGatedPrefixes("const P = ['/a','/b'];"), ['/a', '/b']);
  assert.deepEqual(parseGatedPrefixes('const Q = ["/a"];'), []);
  assert.deepEqual(parseGatedPrefixes(null), []);
  const p = parseGatedPrefixes(read(path.join('src', 'middleware.ts')));
  assert.ok(p.length > 0, 'middleware.ts 에서 세션 게이트 목록을 못 읽었다(형식 변경?)');
  assert.ok(p.includes('/dashboard'));
  const nav = parseNavHrefs(read(path.join('src', 'components', 'Shell.tsx')));
  assert.ok(nav.includes('/dashboard') && nav.includes('/settings'), 'Shell NAV 파싱 실패');
  assert.equal(new Set(nav).size, nav.length, '중복 제거');
});

test('isGatedBy: middleware 와 같은 느슨한 startsWith 규칙', () => {
  assert.equal(isGatedBy('/projects', ['/projects']), true);
  assert.equal(isGatedBy('/projects/1', ['/projects']), true);
  assert.equal(isGatedBy('/test-cycles', ['/tests']), false);
  assert.equal(isGatedBy('/settings', ['/dashboard']), false);
});

test('레지스트리 ↔ 실제 page.tsx 파일이 1:1 이어야 한다', () => {
  const { unregistered, stale } = auditPageFiles(pageHrefs());
  assert.deepEqual(unregistered, [], `레지스트리에 없는 화면 파일: ${unregistered.join(', ')}`);
  assert.deepEqual(stale, [], `파일 없는 등록 화면(깨진 링크 위험): ${stale.join(', ')}`);
});

test('메뉴(Shell NAV)에 실재하지 않는 링크가 없어야 한다', () => {
  const nav = parseNavHrefs(read(path.join('src', 'components', 'Shell.tsx')));
  const { dead } = auditNavTargets(nav);
  assert.deepEqual(dead, [], `메뉴에만 있고 화면이 없는 링크: ${dead.join(', ')}`);
});

test('앱 화면은 전부 검색 색인 차단 대상이어야 한다', () => {
  const exposed = auditIndexBlock(DISALLOW_PREFIXES);
  assert.deepEqual(exposed, [], `robots 색인 차단에서 빠진 앱 화면: ${exposed.join(', ')}`);
});

test('공개 화면 목록이 siteMeta.PUBLIC_PATHS 와 같아야 한다', () => {
  assert.deepEqual(
    PUBLIC_SCREENS.map((s) => s.href).sort(),
    [...PUBLIC_PATHS].sort(),
  );
});

test('세션 게이트: 알려진 미결 목록 밖의 새 미게이트 화면이 없어야 한다', () => {
  const prefixes = parseGatedPrefixes(read(path.join('src', 'middleware.ts')));
  const { ungated } = auditSessionGate(prefixes);
  const unexpected = ungated.filter((h) => !UNGATED_SCREENS_KNOWN.includes(h));
  assert.deepEqual(unexpected, [], `세션 게이트(middleware P)에 빠진 새 화면: ${unexpected.join(', ')}`);
  // 알려진 목록은 실제 미게이트 화면의 부분집합이어야 한다(고쳐 놓고 목록을 안 지운 상태 방지).
  const fixed = UNGATED_SCREENS_KNOWN.filter((h) => !ungated.includes(h));
  assert.deepEqual(fixed, [], `이미 게이트된 경로가 미결 목록에 남아 있다: ${fixed.join(', ')}`);
});

test('레지스트리 자체 무결성: href 중복 없음, 라벨·형식 규약', () => {
  const all = allScreens();
  assert.equal(new Set(all.map((s) => s.href)).size, all.length, 'href 중복');
  for (const s of all) {
    assert.equal(normalizePath(s.href), s.href, `정규형이 아닌 href: ${s.href}`);
    assert.ok(s.label.trim().length > 0, `라벨 누락: ${s.href}`);
    assert.ok(/[가-힣A-Za-z]/.test(s.label), `라벨 형식: ${s.href}`);
  }
  assert.ok(APP_SCREENS.every((s) => s.access === 'session'));
  assert.ok(PUBLIC_SCREENS.every((s) => s.access === 'public'));
  const st = appRoutesStatus();
  assert.equal(st.screens, APP_SCREENS.length);
  assert.equal(st.publicScreens, PUBLIC_SCREENS.length);
  assert.equal(st.knownUngated, UNGATED_SCREENS_KNOWN.length);
});

test('404 화면은 없는 경로를 지어내지 않는다(레지스트리 경유만)', () => {
  const src = read(path.join('src', 'app', 'not-found.tsx'));
  assert.ok(src.includes("from '@/lib/appRoutes'"), '레지스트리를 쓰지 않는다');
  assert.ok(src.includes('main-content') && src.includes('skip-link'), '본문 랜드마크·스킵링크 누락');
  // 하드코딩된 앱 경로는 기본 진입점 2개(/dashboard·/)만 허용 — 나머지는 레지스트리에서 나와야 한다.
  const hard = Array.from(src.matchAll(/href="(\/[^"]*)"/g)).map((m) => m[1]).filter((h) => h !== '#main-content');
  for (const h of hard) assert.ok(['/dashboard', '/'].includes(h), `하드코딩된 경로: ${h}`);
});
