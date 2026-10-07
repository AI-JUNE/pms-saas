/**
 * auditQuery.test.ts — 감사로그 검색 필터·보존정책. 2026-10-07 (주간 수동, ROADMAP ⑩ 31)
 *
 * 보존 일수는 env 로만 확정된다. 미설정 기본값(365)은 응답에 decided:false 로 드러난다 — 결정된 것처럼 보이지 않게.
 * 삭제 작업은 이 저장소에 없다(테스트가 라우트에 delete 가 없음을 검사). 파일만 읽는다 — 네트워크·DB 미사용.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  AUDIT_ACTIONS, AUDIT_LIMIT_DEFAULT, AUDIT_LIMIT_MAX, DEFAULT_AUDIT_RETENTION_DAYS, RETENTION_PENDING_NOTE,
  isRealDate, dayAfter, dayStart, parseAuditFilters, hasActiveFilter, actionOfEvent, escapeLike, actionPatterns, parseDetail,
  auditRetentionPolicy, retentionCutoff, auditRetentionStatus,
} from '../src/lib/auditQuery.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (...p: string[]) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

test('isRealDate / dayStart / dayAfter: 비실존 날짜 거부, 포함 범위를 < 조건으로', () => {
  assert.equal(isRealDate('2026-10-07'), true);
  assert.equal(isRealDate('2026-02-30'), false);
  assert.equal(isRealDate('2026-13-01'), false);
  assert.equal(isRealDate('20261007'), false);
  assert.equal(dayStart('2026-10-07').toISOString(), '2026-10-07T00:00:00.000Z');
  assert.equal(dayAfter('2026-10-31').toISOString(), '2026-11-01T00:00:00.000Z');
});

test('parseAuditFilters: 정상 값은 받고, 못 읽는 값은 버리며 problems 에 적는다(요청 거절 없음)', () => {
  const f = parseAuditFilters(new URLSearchParams('actor=7&action=update&entity=issues&entityId=12&from=2026-10-01&to=2026-10-07&q=Hong&limit=50&cursor=900'));
  assert.deepEqual(f, { actorId: 7, action: 'UPDATE', entity: 'issues', entityId: '12', from: '2026-10-01', to: '2026-10-07', q: 'hong', limit: 50, cursor: 900, problems: [] });
  assert.equal(hasActiveFilter(f), true);
  const g = parseAuditFilters({ actor: '-1', action: 'PURGE', entity: '1bad', entityId: 'a b', from: '2026-02-30', to: 'x', limit: '0', cursor: 'z' });
  assert.equal(g.actorId, null); assert.equal(g.action, null); assert.equal(g.entity, null); assert.equal(g.entityId, null);
  assert.equal(g.from, null); assert.equal(g.to, null); assert.equal(g.limit, AUDIT_LIMIT_DEFAULT); assert.equal(g.cursor, null);
  assert.equal(g.problems.length, 8);
  assert.equal(hasActiveFilter(g), false);
  const h = parseAuditFilters(new URLSearchParams('limit=99999&from=2026-10-07&to=2026-10-01'));
  assert.equal(h.limit, AUDIT_LIMIT_MAX, '상한을 넘지 않는다');
  assert.equal(h.from, null); assert.equal(h.to, null); assert.match(h.problems[0], /from 이 to 보다/);
  assert.equal(parseAuditFilters(new URLSearchParams('')).limit, AUDIT_LIMIT_DEFAULT);
  assert.equal(parseAuditFilters(new URLSearchParams('q=' + 'a'.repeat(200))).q?.length, 80, '검색어 길이 제한');
});

test('actionOfEvent / actionPatterns / escapeLike', () => {
  assert.equal(actionOfEvent('TASKS_CREATE'), 'CREATE');
  assert.equal(actionOfEvent('ISSUE_UPDATE'), 'UPDATE');
  assert.equal(actionOfEvent('AUTH_LOGIN_FAIL'), 'AUTH');
  assert.equal(actionOfEvent('admin.audit.view'), 'ACCESS');
  assert.equal(actionOfEvent('WEIRD'), null);
  assert.equal(actionOfEvent(null), null);
  assert.deepEqual(actionPatterns('CREATE'), ['%\\_CREATE']);
  assert.deepEqual(actionPatterns('AUTH'), ['AUTH\\_%']);
  assert.deepEqual(actionPatterns('ACCESS'), ['admin.%']);
  assert.equal(escapeLike('a%b_c\\'), 'a\\%b\\_c\\\\');
  assert.deepEqual([...AUDIT_ACTIONS], ['CREATE', 'UPDATE', 'DELETE', 'ACCESS', 'AUTH']);
});

test('parseDetail: JSON 객체는 그대로, 깨진 값은 raw 로 보존(지어내지 않는다)', () => {
  assert.deepEqual(parseDetail('{"count":3}'), { count: 3 });
  assert.deepEqual(parseDetail('[1,2]'), { value: [1, 2] });
  assert.deepEqual(parseDetail('not json'), { raw: 'not json' });
  assert.equal(parseDetail(''), null);
  assert.equal(parseDetail(null), null);
});

test('보존정책: env 만 확정으로 인정, 미설정 기본값은 decided:false 로 드러난다', () => {
  const d = auditRetentionPolicy({});
  assert.equal(d.days, DEFAULT_AUDIT_RETENTION_DAYS); assert.equal(d.decided, false); assert.equal(d.source, 'default'); assert.equal(d.note, RETENTION_PENDING_NOTE);
  assert.match(d.note, /확인 필요/); assert.match(d.note, /자동 삭제는 수행하지 않습니다/);
  const e = auditRetentionPolicy({ AUDIT_RETENTION_DAYS: '730' });
  assert.equal(e.days, 730); assert.equal(e.decided, true); assert.equal(e.source, 'env');
  assert.equal(auditRetentionPolicy({ AUDIT_RETENTION_DAYS: '7' }).decided, false, '범위 밖은 확정으로 보지 않는다');
  assert.equal(auditRetentionPolicy({ AUDIT_RETENTION_DAYS: '1y' }).decided, false);
  const now = new Date('2026-10-07T12:00:00Z');
  assert.equal(retentionCutoff(now, 365).toISOString().slice(0, 10), '2025-10-07');
  const s = auditRetentionStatus({}, now);
  assert.equal(s.cutoff, '2025-10-07'); assert.equal(s.decided, false);
});

// ── 실제 소스 배선 ────────────────────────────────────────────────────────────

test('[실제 소스] /api/audit 가 필터를 쓰고, 보존정책을 응답에 담되 삭제는 하지 않는다', () => {
  const src = read('src', 'app', 'api', 'audit', 'route.ts');
  assert.ok(src.includes('parseAuditFilters('), '필터 파서 미사용');
  assert.ok(src.includes('auditRetentionStatus(process.env'), '보존정책이 응답에 없다');
  assert.ok(/detail:\s*auditLog\.detail/.test(src), '상세(detail)를 돌려주지 않아 상세 서랍이 빌 수 있다');
  assert.ok(!/db\.delete\(|db\.update\(/.test(src), '감사로그 라우트에 쓰기가 있다 — 보존정책 정리는 승인 사항');
  assert.ok(src.includes('assertScreenAccess('), '화면 정책(/audit) 검사 누락');
  const page = read('src', 'app', 'audit', 'page.tsx');
  for (const k of ['actor', 'from', 'to']) assert.ok(page.includes(`'${k}'`) || page.includes(`${k}=`) || page.includes(`${k}:`), `화면 필터 ${k} 누락`);
  assert.ok(page.includes('parseDetail(') || page.includes('detail'), '상세 서랍 누락');
  assert.ok(page.includes('retention'), '보존정책 안내 누락');
  const env = read('src', 'lib', 'envRegistry.ts');
  assert.ok(env.includes("key: 'AUDIT_RETENTION_DAYS'"), 'env 레지스트리 누락');
});
