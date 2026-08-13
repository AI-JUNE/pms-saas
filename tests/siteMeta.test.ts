import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PUBLIC_PATHS,
  DISALLOW_PREFIXES,
  resolveSiteUrl,
  isIndexablePath,
  buildRobotsRules,
  buildSitemapEntries,
} from '../src/lib/siteMeta.ts';

test('resolveSiteUrl: SITE_URL 최우선·끝슬래시 제거', () => {
  assert.equal(resolveSiteUrl({ SITE_URL: 'https://pms.gowon.kr/' }), 'https://pms.gowon.kr');
  assert.equal(
    resolveSiteUrl({ SITE_URL: 'https://a.kr', NEXT_PUBLIC_SITE_URL: 'https://b.kr' }),
    'https://a.kr',
  );
});

test('resolveSiteUrl: 스킴 없는 VERCEL_URL 도 https 로 보정', () => {
  assert.equal(resolveSiteUrl({ VERCEL_URL: 'pms-abc.vercel.app' }), 'https://pms-abc.vercel.app');
});

test('resolveSiteUrl: 미주입/잘못된 값이면 기본값(빌드 실패 방지)', () => {
  assert.equal(resolveSiteUrl({}), 'https://pms.example.com');
  assert.equal(resolveSiteUrl({ SITE_URL: '   ' }), 'https://pms.example.com');
  assert.equal(resolveSiteUrl({ SITE_URL: 'ht!tp://%%%' }), 'https://pms.example.com');
});

test('isIndexablePath: 공개 경로만 true', () => {
  for (const p of PUBLIC_PATHS) assert.equal(isIndexablePath(p), true, p);
  assert.equal(isIndexablePath('/pricing/'), true); // 끝슬래시 정규화
});

test('isIndexablePath: 인증 뒤 앱 화면·API 는 전부 false', () => {
  const secret = [
    '/dashboard',
    '/dashboard/1',
    '/projects/42',
    '/api/health',
    '/api/billing/webhook',
    '/admin/security',
    '/settings/billing',
    '/documents/9',
    '/audit',
  ];
  for (const p of secret) assert.equal(isIndexablePath(p), false, p);
});

test('isIndexablePath: 미지의 경로는 기본 비색인(화이트리스트 방식)', () => {
  assert.equal(isIndexablePath('/whatever-new-page'), false);
  assert.equal(isIndexablePath('relative/path'), false);
  assert.equal(isIndexablePath(''), false);
  assert.equal(isIndexablePath(undefined), false);
});

test('buildRobotsRules: production 이 아니면 전면 차단', () => {
  const preview = buildRobotsRules({ VERCEL_ENV: 'preview' });
  assert.deepEqual(preview.disallow, ['/']);
  assert.deepEqual(preview.allow, []);
  const dev = buildRobotsRules({ NODE_ENV: 'development' });
  assert.deepEqual(dev.disallow, ['/']);
  assert.deepEqual(buildRobotsRules({}).disallow, ['/']);
});

test('buildRobotsRules: production 이면 공개 허용 + 앱/API 차단', () => {
  const r = buildRobotsRules({ VERCEL_ENV: 'production' });
  assert.equal(r.userAgent, '*');
  assert.ok(r.allow.includes('/pricing'));
  assert.ok(r.disallow.includes('/api/'));
  assert.ok(r.disallow.includes('/dashboard'));
  // 공개 경로가 차단 목록에 섞여 들어가지 않아야 한다.
  for (const p of PUBLIC_PATHS) assert.equal(r.disallow.includes(p), false, p);
});

test('DISALLOW_PREFIXES: 공개 경로를 잡아먹지 않는다', () => {
  for (const p of PUBLIC_PATHS) {
    for (const d of DISALLOW_PREFIXES) {
      assert.notEqual(p, d, `${p} 가 차단 접두사와 충돌`);
    }
  }
});

test('buildSitemapEntries: 공개 경로만·절대 URL·우선순위 범위', () => {
  const at = new Date('2026-08-13T00:00:00Z');
  const entries = buildSitemapEntries('https://pms.gowon.kr/', at);
  assert.equal(entries.length, PUBLIC_PATHS.length);
  assert.equal(entries[0].url, 'https://pms.gowon.kr/');
  assert.ok(entries.some((e) => e.url === 'https://pms.gowon.kr/pricing'));
  for (const e of entries) {
    assert.ok(e.url.startsWith('https://pms.gowon.kr'), e.url);
    assert.ok(e.priority > 0 && e.priority <= 1, String(e.priority));
    assert.equal(e.lastModified.getTime(), at.getTime());
    assert.equal(e.url.includes('/dashboard'), false);
    assert.equal(e.url.includes('/api'), false);
  }
});

test('buildSitemapEntries: 잘못된 base 도 안전한 기본값으로 대체', () => {
  const entries = buildSitemapEntries('nope://bad');
  assert.ok(entries.every((e) => e.url.startsWith('https://')));
});
