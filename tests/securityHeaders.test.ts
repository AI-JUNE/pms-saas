import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSecurityHeaders, applySecurityHeaders } from '../src/lib/securityHeaders.ts';

const asMap = (env?: string) =>
  new Map(buildSecurityHeaders({ vercelEnv: env }).map((h) => [h.key, h.value]));

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
