/**
 * issueLinks.test.ts — 이슈 관계(차단함·연관·중복). 2026-10-07 (주간 수동, ROADMAP ⑦ 79 잔여분)
 * 파일만 읽는다 — 네트워크·DB 미사용.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  LINK_KINDS, LINK_LABEL, LINK_INVERSE_LABEL, isDirectional, parseLinkKind, validateLink, isDuplicateLink,
  describeLink, linkCounts, blockedBy, normalizeIssueCode,
} from '../src/lib/issueLinks.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (...p: string[]) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

test('종류는 폐쇄 목록 3개, blocks 만 방향이 있다', () => {
  assert.deepEqual([...LINK_KINDS], ['blocks', 'relates', 'duplicates']);
  assert.equal(isDirectional('blocks'), true); assert.equal(isDirectional('relates'), false); assert.equal(isDirectional('duplicates'), false);
  assert.equal(parseLinkKind(' Blocks '), 'blocks');
  assert.equal(parseLinkKind('depends'), null);
  assert.equal(parseLinkKind(null), null);
  for (const k of LINK_KINDS) { assert.ok(LINK_LABEL[k] && LINK_INVERSE_LABEL[k], k); }
});

test('validateLink: 자기 참조·미지 종류·잘못된 id 를 거부한다', () => {
  const ok = validateLink({ srcIssueId: '3', dstIssueId: 4, kind: 'relates' });
  assert.equal(ok.ok, true); if (ok.ok) assert.deepEqual(ok.value, { srcIssueId: 3, dstIssueId: 4, kind: 'relates' });
  const self = validateLink({ srcIssueId: 3, dstIssueId: 3, kind: 'blocks' });
  assert.equal(self.ok, false); if (!self.ok) assert.ok(self.errors.some((e) => e.code === 'SELF'));
  const bad = validateLink({ srcIssueId: 0, dstIssueId: 'x', kind: 'nope' });
  assert.equal(bad.ok, false); if (!bad.ok) assert.deepEqual(bad.errors.map((e) => e.field).sort(), ['dstIssueId', 'kind', 'srcIssueId']);
});

test('isDuplicateLink: 무방향 종류는 양방향으로 중복, blocks 는 방향별로 다르다', () => {
  const existing = [{ srcIssueId: 1, dstIssueId: 2, kind: 'relates' }, { srcIssueId: 1, dstIssueId: 2, kind: 'blocks' }];
  assert.equal(isDuplicateLink(existing, { srcIssueId: 2, dstIssueId: 1, kind: 'relates' }), true);
  assert.equal(isDuplicateLink(existing, { srcIssueId: 1, dstIssueId: 2, kind: 'blocks' }), true);
  assert.equal(isDuplicateLink(existing, { srcIssueId: 2, dstIssueId: 1, kind: 'blocks' }), false, '역방향 차단은 다른 관계(순환이지만 저장은 허용 — 화면이 보여준다)');
  assert.equal(isDuplicateLink(existing, { srcIssueId: 1, dstIssueId: 2, kind: 'duplicates' }), false);
  assert.equal(isDuplicateLink([], { srcIssueId: 1, dstIssueId: 2, kind: 'relates' }), false);
});

test('describeLink: 관점에 따라 라벨·방향이 바뀐다', () => {
  const l = { srcIssueId: 10, dstIssueId: 20, kind: 'blocks' };
  assert.deepEqual(describeLink(l, 10), { otherId: 20, kind: 'blocks', label: '차단함', direction: 'out' });
  assert.deepEqual(describeLink(l, 20), { otherId: 10, kind: 'blocks', label: '차단됨', direction: 'in' });
  assert.equal(describeLink({ srcIssueId: 1, dstIssueId: 2, kind: 'duplicates' }, 2).label, '원본');
  assert.equal(describeLink({ srcIssueId: 1, dstIssueId: 2, kind: 'weird' }, 1).kind, null, '모르는 종류는 추측하지 않는다');
});

test('linkCounts / blockedBy / normalizeIssueCode', () => {
  const links = [
    { srcIssueId: 1, dstIssueId: 5, kind: 'blocks' }, { srcIssueId: 2, dstIssueId: 5, kind: 'blocks' },
    { srcIssueId: 5, dstIssueId: 6, kind: 'relates' }, { srcIssueId: 7, dstIssueId: 5, kind: 'bogus' },
  ];
  assert.deepEqual(linkCounts(links), { blocks: 2, relates: 1, duplicates: 0, total: 3 });
  const status: Record<number, string> = { 1: 'closed', 2: 'open' };
  assert.deepEqual(blockedBy(links, 5, (id) => status[id]), [2], '해결된 차단자는 세지 않는다');
  assert.deepEqual(blockedBy(links, 6, (id) => status[id]), []);
  assert.equal(normalizeIssueCode(' iss-0002 '), 'ISS-0002');
  assert.equal(normalizeIssueCode(null), '');
});

// ── 실제 소스 배선 ────────────────────────────────────────────────────────────

test('[실제 소스] 관계 라우트·스키마·DDL·상세 UI 배선', () => {
  const src = read('src', 'app', 'api', 'issues', '[id]', 'links', 'route.ts');
  assert.ok(src.includes('validateLink(') && src.includes('isDuplicateLink('), '검증·중복 판정 누락');
  assert.ok(src.includes('requirePermission('), '쓰기 권한(RBAC) 검사 누락');
  const ex = Array.from(src.matchAll(/^export\s+(?:async\s+)?(?:function|const)\s+(\w+)/gm)).map((m) => m[1]).sort();
  assert.deepEqual(ex, ['DELETE', 'GET', 'POST', 'dynamic'], 'route.ts 는 HTTP 메서드·설정 외 export 금지');
  assert.ok(read('src', 'db', 'schema.ts').includes("pgTable('issue_links'"), 'drizzle 선언 누락');
  assert.ok(/CREATE TABLE IF NOT EXISTS issue_links/.test(read('src', 'lib', 'migrate.ts')), '멱등 DDL 누락');
  assert.ok(read('src', 'components', 'ResourceView.tsx').includes('<IssueLinks '), '이슈 상세에 관계 섹션이 없다');
  const comp = read('src', 'components', 'IssueLinks.tsx');
  assert.ok(comp.includes('/links') && comp.includes('describeLink('), '관계 컴포넌트가 API·라벨 규칙을 쓰지 않는다');
});
