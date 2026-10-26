/**
 * shellPrefs.test.ts — 화면 틀 즐겨찾기·결재 대기 배지. 2026-10-26 PMS 개편 P0-5
 * 순수 함수 + 소스 확인 — 네트워크·DB 미사용.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { FAV_MAX, parseFavs, toggleFav, myApprovals, approvalBadges } from '../src/lib/shellPrefs.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (...p: string[]) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

test('parseFavs: 화면 주소만, 중복 제거, 최대 8개, 허용 목록 적용', () => {
  assert.deepEqual(parseFavs('["/tasks","/tasks","/issues"]'), ['/tasks', '/issues']);
  assert.deepEqual(parseFavs('["https://x.y","//evil","javascript:1",3,"/a b","/risks"]'), ['/risks']);
  assert.deepEqual(parseFavs('깨진 값'), []); assert.deepEqual(parseFavs(null), []); assert.deepEqual(parseFavs('{"a":1}'), []);
  assert.deepEqual(parseFavs(['/tasks', '/admin'], ['/tasks']), ['/tasks']);
  assert.equal(parseFavs(Array.from({ length: 12 }, (_, i) => '/p' + i)).length, FAV_MAX);
});

test('toggleFav: 넣고 빼고, 가득 차면 가장 오래된 것을 민다', () => {
  assert.deepEqual(toggleFav([], '/tasks'), ['/tasks']);
  assert.deepEqual(toggleFav(['/tasks', '/issues'], '/tasks'), ['/issues']);
  const full = Array.from({ length: FAV_MAX }, (_, i) => '/p' + i);
  const n = toggleFav(full, '/new');
  assert.equal(n.length, FAV_MAX); assert.equal(n[0], '/p1'); assert.equal(n.at(-1), '/new');
});

test('myApprovals: 결재자 = 나, 문서는 검토·방화벽은 신청 단계만', () => {
  const list = myApprovals(' 김PM ', [
    { id: 1, code: 'D1', title: '설계서', status: 'review', approver: '김PM' },
    { id: 2, title: '계획서', status: 'review', approver: '박' },
    { id: 3, title: '완료', status: 'approved', approver: '김PM' },
  ], [
    { id: 9, code: 'FW1', title: 'DB 포트', status: 'requested', approver: '김PM ' },
    { id: 10, title: '승인됨', status: 'approved', approver: '김PM' },
  ]);
  assert.deepEqual(list.map((x) => [x.kind, x.id, x.href]), [['document', 1, '/documents'], ['firewall', 9, '/firewall']]);
  assert.deepEqual(approvalBadges(list), { '/documents': 1, '/firewall': 1 });
  assert.deepEqual(myApprovals('', [{ status: 'review', approver: '' }], []), []);
});

test('결재 대기 API 는 조직 범위·읽기 전용이고 화면 틀이 배지·즐겨찾기·뒤로를 쓴다', () => {
  const api = read('src', 'app', 'api', 'approvals', 'route.ts');
  assert.match(api, /requireTenant\(await requireUser\(\)\)/);
  assert.match(api, /eq\(documents\.orgId, org\)/); assert.match(api, /eq\(firewallRequests\.orgId, org\)/);
  assert.doesNotMatch(api, /export async function (POST|PATCH|PUT|DELETE)/);
  const sh = read('src', 'components', 'Shell.tsx');
  assert.match(sh, /\/api\/approvals/); assert.match(sh, /flipFav/); assert.match(sh, /router\.back\(\)/); assert.match(sh, /즐겨찾기/);
});
