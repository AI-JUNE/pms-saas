/**
 * hubName.test.ts — 이름 하나로(GOWON 프로젝트 허브) + 허브 안의 제안서·발표본 작성(EPA). 2026-10-28 사용자 결정
 * "외부 EPA 도 고원 프로젝트 HUB 에 하나로", "PMS 라는 단어보다는 포털이나 허브로 하나의 명칭으로".
 * 화면에 보이는 글자만 본다 — 코드·저장소·환경 변수·쿠키 이름(pms_session 등)은 그대로 둔다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (...p: string[]) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
// 금지 이름(사람·사내 회사·사내 도구)은 GOWON 저장소에 글자 그대로 남기지 않는다 → base64
const unb = (t: string) => Buffer.from(t, 'base64').toString('utf8');
const BAN = new RegExp(unb('XGJFQ1NcYnzsnbTslKjsl5DsiqR8RUNT7YWU66CI7L2kfOuwsOuqheykgHxSMlIyMQ=='));
const INTERNAL_LOGO = unb('ZWNzX2xvZ28ucG5n');
function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [path.join(dir, e.name)] : []);
}

test('화면 글자에 PMS 가 남지 않는다(주석·환경 변수·저장 키 제외)', () => {
  const hits: string[] = [];
  for (const f of [...walk(path.join(ROOT, 'src', 'app')), ...walk(path.join(ROOT, 'src', 'components'))]) {
    fs.readFileSync(f, 'utf8').split(/\r?\n/).forEach((l, i) => {
      const code = l.replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//g, '');
      if (/^\s*\*/.test(l)) return;
      if (/PMS(?!_)/.test(code.replace(/pms[._]/gi, ''))) hits.push(path.relative(ROOT, f) + ':' + (i + 1));
    });
  }
  assert.deepEqual(hits, []);
});

test('대표 이름·탭 제목·로고', () => {
  const layout = read('src', 'app', 'layout.tsx');
  assert.match(layout, /applicationName: 'GOWON 프로젝트 허브'/);
  assert.match(layout, /siteName: 'GOWON 프로젝트 허브'/);
  assert.match(read('src', 'components', 'Logo.tsx'), /<div className="brand-name">프로젝트 허브<\/div>/);
  assert.match(read('src', 'components', 'Shell.tsx'), /document\.title = title \? `\$\{title\} — 프로젝트 허브` : 'GOWON 프로젝트 허브'/);
});

test('허브 안의 제안서·발표본 작성(EPA) — 메뉴·경로·사본(외부판 = 발표 연습 켬)', () => {
  assert.match(read('src', 'components', 'Shell.tsx'), /\{ href: '\/apps\/authoring', label: '제안서·발표본 작성', icon: Presentation \}/);
  assert.match(read('src', 'lib', 'appRoutes.ts'), /\{ href: '\/apps\/authoring', label: '제안서·발표본 작성'/);
  assert.ok(fs.existsSync(path.join(ROOT, 'src', 'app', 'apps', 'authoring', 'page.tsx')));
  const html = read('public', 'apps', 'authoring', 'index.html');
  assert.match(html, /const EDITION='external';/, '허브 사본은 외부판(발표 연습 켬)');
  assert.doesNotMatch(html, BAN, '외부 사본에 금지 이름 없음');
  assert.ok(!fs.existsSync(path.join(ROOT, 'public', 'apps', 'authoring', 'assets', INTERNAL_LOGO)), '사내 로고 파일은 사본에서 뺀다');
});

test('허브 사본 네 개(3003·3004·3005·3007) 모두 사내 회사 이름·로고 없음 — 10-28 외부 허브에 그대로 보이던 문제', () => {
  for (const key of ['quality', 'strategy', 'performance', 'authoring']) {
    const html = read('public', 'apps', key, 'index.html');
    const m = html.match(new RegExp(BAN.source.split(String.raw`\b`).join(''))); // 앞뒤에 글자가 붙어 쓴 경우까지
    assert.equal(m ? m[0] : null, null, key + ' 사본에 금지 이름');
  }
});
