import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildSecurityHeaders,
  applySecurityHeaders,
  isEmbeddableDocument,
  EMBEDDABLE_PREFIXES,
} from '../src/lib/securityHeaders.ts';

const ROOT = path.resolve(import.meta.dirname, '..');

const asMap = (env?: string, pathname?: string) =>
  new Map(buildSecurityHeaders({ vercelEnv: env, pathname }).map((h) => [h.key, h.value]));

test('기본 헤더 5종: nosniff·frame DENY·frame-ancestors·referrer·permissions', () => {
  const m = asMap();
  assert.equal(m.get('X-Content-Type-Options'), 'nosniff');
  assert.equal(m.get('X-Frame-Options'), 'DENY');
  assert.equal(m.get('Content-Security-Policy'), "frame-ancestors 'none'");
  assert.equal(m.get('Referrer-Policy'), 'strict-origin-when-cross-origin');
  assert.equal(m.get('Permissions-Policy'), 'camera=(), microphone=(), geolocation=()');
});

test('HSTS: production 에서만 포함, 보수적 값(서브도메인·preload 없음)', () => {
  assert.equal(asMap('production').get('Strict-Transport-Security'), 'max-age=15552000');
  for (const env of [undefined, '', 'preview', 'development']) {
    assert.equal(asMap(env).has('Strict-Transport-Security'), false, String(env));
  }
});

test('CSP 는 frame-ancestors 단독 — script/style 정책 미포함(화면 파손 방지)', () => {
  const csp = asMap('production').get('Content-Security-Policy') ?? '';
  assert.ok(!/script-src|style-src|default-src/.test(csp));
});

test('키 중복·빈 값 없음', () => {
  const list = buildSecurityHeaders({ vercelEnv: 'production' });
  assert.equal(new Set(list.map((h) => h.key)).size, list.length);
  for (const h of list) assert.ok(h.key.length > 0 && h.value.length > 0);
});

test('applySecurityHeaders: Headers 호환 객체에 일괄 set', () => {
  const bag = new Map<string, string>();
  applySecurityHeaders({ set: (k, v) => void bag.set(k, v) }, { vercelEnv: 'production' });
  assert.equal(bag.get('X-Frame-Options'), 'DENY');
  assert.equal(bag.get('Strict-Transport-Security'), 'max-age=15552000');
  const bag2 = new Map<string, string>();
  applySecurityHeaders({ set: (k, v) => void bag2.set(k, v) });
  assert.equal(bag2.has('Strict-Transport-Security'), false);
});

// ── 제안 앱 원본 HTML 의 same-origin 프레임 예외 ─────────────────────────────
// 배경: X-Frame-Options: DENY 는 **same-origin 프레임도** 막는다(SAMEORIGIN 과 달리 예외 없음).
// 미들웨어가 전 경로에 DENY 를 찍고 있었으므로 /apps/<key>/index.html 을 iframe 으로
// 띄우는 포털 앱 3종은 화면만 뜨고 프레임 내용이 차단됐다. 그 문서만 self 로 좁혀 허용한다.

test('제안 앱 원본 HTML 만 same-origin 프레임 허용 — 나머지는 DENY 유지', () => {
  const framed = asMap('production', '/apps/quality/index.html');
  assert.equal(framed.get('X-Frame-Options'), 'SAMEORIGIN');
  assert.equal(framed.get('Content-Security-Policy'), "frame-ancestors 'self'");
  // 완화는 클릭재킹 헤더 2종에만. 나머지는 그대로여야 한다.
  assert.equal(framed.get('X-Content-Type-Options'), 'nosniff');
  assert.equal(framed.get('Referrer-Policy'), 'strict-origin-when-cross-origin');
  assert.equal(framed.get('Strict-Transport-Security'), 'max-age=15552000');

  for (const p of ['/apps/quality', '/dashboard', '/api/health', '/login', '/', undefined]) {
    const m = asMap('production', p);
    assert.equal(m.get('X-Frame-Options'), 'DENY', String(p));
    assert.equal(m.get('Content-Security-Policy'), "frame-ancestors 'none'", String(p));
  }
});

test('isEmbeddableDocument: 문서 확장자 + /apps/ 접두사 둘 다 만족할 때만 true', () => {
  assert.equal(isEmbeddableDocument('/apps/strategy/index.html'), true);
  assert.equal(isEmbeddableDocument('/apps/performance/index.htm'), true);
  assert.equal(isEmbeddableDocument('/apps/quality/index.html?v=2#top'), true);
  // 자산·호스트 라우트·다른 트리·경로 탈출·쓰레기 입력은 전부 거부(fail-closed)
  for (const bad of [
    '/apps/quality/assets/xlsx.min.js',
    '/apps/_shared/PretendardVariable.woff2',
    '/apps/quality',
    '/apps',
    '/admin/index.html',
    '/apps/../admin/index.html',
    'apps/quality/index.html',
    '',
    null,
    undefined,
    123,
  ]) {
    assert.equal(isEmbeddableDocument(bad as unknown), false, String(bad));
  }
});

test('[대조] AppFrame 이 실제로 쓰는 iframe src 가 프레임 허용 판정을 받는다', () => {
  // 예외 목록과 실제 iframe 경로가 어긋나면 앱이 다시 조용히 죽는다.
  const src = fs.readFileSync(path.join(ROOT, 'src', 'components', 'AppFrame.tsx'), 'utf8');
  const m = src.match(/const src = `([^`]+)`/);
  assert.ok(m, 'AppFrame 의 iframe src 조립식을 찾지 못했다 — 이 대조 테스트를 갱신할 것');
  const probe = m[1].replace('${appKey}', 'quality');
  assert.equal(isEmbeddableDocument(probe), true, `AppFrame src(${probe}) 가 프레임 차단 대상이다`);
  // 접두사 목록이 앱 트리보다 넓어지지 않았는지도 확인한다.
  assert.deepEqual([...EMBEDDABLE_PREFIXES], ['/apps/']);

  // 미들웨어가 pathname 을 넘기지 않으면 위 예외가 런타임에 전혀 적용되지 않는다(조용한 회귀).
  const mw = fs.readFileSync(path.join(ROOT, 'src', 'middleware.ts'), 'utf8');
  const call = mw.match(/applySecurityHeaders\(([\s\S]*?)\);/);
  assert.ok(call, 'middleware 의 applySecurityHeaders 호출을 찾지 못했다');
  assert.match(call[1], /pathname/, 'middleware 가 applySecurityHeaders 에 pathname 을 넘기지 않는다');
});
