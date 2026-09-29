/**
 * portalApps.test.ts — 포털에 넣은 제안 앱(public/apps/*)의 자산 무결성. 2026-09-29
 *
 * ── 왜 필요한가 ──────────────────────────────────────────────────────────────
 * 제안 앱은 원본 HTML 을 public/apps/<key>/ 에 그대로 넣고 iframe 으로 띄운다.
 * 이 구조의 약점은 **자산이 빠져도 아무도 모른다**는 것이다.
 *   · HTML 이 `assets/xlsx.min.js` 를 참조하는데 파일이 없으면,
 *     서버 설정에 따라 404 대신 HTML 이 200 으로 돌아온다(SPA 폴백).
 *     브라우저는 그걸 스크립트로 읽다 실패하고, 화면은 멀쩡한데 **기능만 죽는다.**
 *     (2026-09-28 사내 3005 nginx 에서 실제로 확인한 함정이다.)
 *   · 폰트를 세 앱이 한 벌(`_shared/`)로 공유하게 바꿨다. 누가 원본을 다시 복사해
 *     넣으면 `assets/PretendardVariable.woff2` 참조가 되살아나 2MB 가 도로 세 벌이 된다.
 * 둘 다 화면만 봐서는 바로 드러나지 않는다. 그래서 파일 수준에서 고정한다.
 *
 * 이 테스트는 파일만 읽는다 — 네트워크·DB·LLM API 를 쓰지 않는다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const APPS_DIR = path.join(ROOT, 'public', 'apps');

/** 포털이 iframe 으로 띄우는 앱. src/app/apps/<key>/page.tsx 의 appKey 와 같아야 한다. */
const APP_KEYS = ['quality', 'strategy', 'performance'] as const;
const SHARED_FONT = '_shared/PretendardVariable.woff2';

const htmlOf = (key: string) => fs.readFileSync(path.join(APPS_DIR, key, 'index.html'), 'utf8');

/**
 * 사내망에만 있는 **고객사 문서** 폴더. 포털 사본에 넣지 않는다 — 이 저장소는 Vercel 로
 * 공개 배포되고, git 이력에 한 번 들어가면 지우기 어렵다.
 * 3005 원본은 `자료실/` 아래 고객사 회의록·분석보고서·PoC 기획서를 링크한다(2026-09-29 기준 11건).
 * 포털에서는 이 링크가 열리지 않는 게 **의도된 동작**이다.
 */
const INTRANET_ONLY_DIRS = ['자료실/'] as const;

/** HTML 이 참조하는 로컬 자산 경로(외부 URL·data: 제외). 쿼리·해시는 뗀다. */
function localRefs(html: string): string[] {
  const out = new Set<string>();
  for (const m of html.matchAll(/(?:src|href)\s*=\s*["']([^"']+)["']|url\(\s*["']?([^"')]+)["']?\s*\)/g)) {
    const raw = (m[1] ?? m[2] ?? '').trim();
    if (!raw || /^(?:[a-z]+:|\/\/|#|data:)/i.test(raw)) continue;   // 외부·앵커·data URI
    if (raw.startsWith('/')) continue;                                // 절대경로는 PMS 라우트다
    if (raw.includes('${') || raw.includes("'+") || raw.includes('"+')) continue; // 스크립트가 조립하는 경로
    // 경로처럼 생긴 것만. 3005 에는 `src='평균 컬럼(콜 가중)'` 처럼 **JS 변수 src 에 라벨을 담는**
    // 코드가 있어, 속성처럼 보이지만 파일이 아니다(2026-09-29 첫 실행에서 오탐 3건).
    const p = raw.split(/[?#]/)[0];
    if (/\s|[()÷]/.test(p) || !/\.[A-Za-z0-9]{1,6}$/.test(p)) continue;
    out.add(p);
  }
  return [...out];
}

const isIntranetOnly = (ref: string) => INTRANET_ONLY_DIRS.some((d) => ref.startsWith(d));

test('포털 앱 3종의 index.html 이 존재한다', () => {
  for (const key of APP_KEYS) {
    assert.ok(fs.existsSync(path.join(APPS_DIR, key, 'index.html')), `public/apps/${key}/index.html 이 없다`);
  }
});

test('각 앱 페이지 라우트가 같은 appKey 를 쓴다 (파일과 라우트가 어긋나지 않는다)', () => {
  for (const key of APP_KEYS) {
    const page = path.join(ROOT, 'src', 'app', 'apps', key, 'page.tsx');
    assert.ok(fs.existsSync(page), `src/app/apps/${key}/page.tsx 가 없다`);
    const src = fs.readFileSync(page, 'utf8');
    assert.match(src, new RegExp(`appKey=["']${key}["']`), `${key} 페이지의 appKey 가 다르다`);
  }
});

test('HTML 이 참조하는 로컬 자산이 전부 실제로 있다 ⬅ 없으면 화면은 멀쩡한데 기능만 죽는다', () => {
  for (const key of APP_KEYS) {
    const refs = localRefs(htmlOf(key)).filter((r) => !isIntranetOnly(r));
    assert.ok(refs.length > 0, `${key}: 로컬 자산 참조를 하나도 못 찾았다 — 추출 규칙이 빗나갔을 수 있다`);
    const missing = refs.filter((r) => !fs.existsSync(path.join(APPS_DIR, key, r)));
    assert.deepEqual(missing, [], `${key}: 참조했지만 없는 파일 → ${missing.join(', ')}`);
  }
});

test('고객사 문서(자료실)가 포털 사본에 들어오지 않았다 ⬅ 공개 배포 저장소다', () => {
  // 원본을 통째로 다시 복사하면 자료실까지 딸려 온다. 그러면 고객사 회의록·보고서가
  // Vercel 공개 배포본과 git 이력에 실린다. 파일이 아니라 **폴더 존재 자체**를 막는다.
  for (const key of APP_KEYS) {
    for (const d of INTRANET_ONLY_DIRS) {
      const dir = path.join(APPS_DIR, key, d);
      assert.ok(!fs.existsSync(dir), `${key}: ${d} 가 포털 사본에 있다 — 고객사 문서다. 즉시 제거할 것`);
    }
  }
  // 대조: 3005 원본이 실제로 자료실을 참조하고 있어야 이 가드가 의미 있다.
  const perfRefs = localRefs(htmlOf('performance')).filter(isIntranetOnly);
  assert.ok(perfRefs.length > 0, 'performance 가 자료실을 참조하지 않는다 — 가드 전제가 바뀌었으니 이 테스트를 재검토할 것');
});

test('공유 폰트는 한 벌이다 — 앱마다 사본이 되살아나지 않았다', () => {
  assert.ok(fs.existsSync(path.join(APPS_DIR, SHARED_FONT)), `${SHARED_FONT} 가 없다`);
  for (const key of APP_KEYS) {
    const html = htmlOf(key);
    assert.ok(!html.includes('assets/PretendardVariable.woff2'),
      `${key}: 앱 전용 폰트 경로가 되살아났다 — 원본을 다시 복사했다면 ../${SHARED_FONT} 로 바꿔야 한다`);
    assert.ok(!fs.existsSync(path.join(APPS_DIR, key, 'assets', 'PretendardVariable.woff2')),
      `${key}: assets/ 에 폰트 사본이 있다 (2MB 중복)`);
    assert.ok(html.includes(`../${SHARED_FONT}`), `${key}: 공유 폰트를 참조하지 않는다`);
  }
});

test('공개 번들에 API 키가 박혀 있지 않다', () => {
  // 세 앱은 키를 사용자가 화면에서 입력하고 브라우저에만 둔다. 소스에 들어가면 공개 배포본에서 그대로 읽힌다.
  const keyLike = /["'](?:sk-[A-Za-z0-9_-]{20,}|sk-ant-[A-Za-z0-9_-]{20,}|AIza[A-Za-z0-9_-]{30,})["']/;
  for (const key of APP_KEYS) {
    assert.ok(!keyLike.test(htmlOf(key)), `${key}: API 키로 보이는 문자열이 있다`);
  }
});

test('[대조] 추출 규칙이 실제로 누락을 잡는다', () => {
  // 검사가 무엇이든 통과시키는 상태가 아닌지, 가짜 HTML 로 확인한다.
  const fake = `<script src="assets/nope.js"></script><link href="assets/x.css"><img src="https://cdn/x.png">
    <style>@font-face{src:url('../${SHARED_FONT}')}</style>`;
  const refs = localRefs(fake).sort();
  assert.deepEqual(refs, ['../_shared/PretendardVariable.woff2', 'assets/nope.js', 'assets/x.css'].sort());
  const missing = refs.filter((r) => !fs.existsSync(path.join(APPS_DIR, 'quality', r)));
  assert.ok(missing.includes('assets/nope.js'), '없는 파일을 놓쳤다');
});
