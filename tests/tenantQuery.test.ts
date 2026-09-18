import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  resolveReadScope, tenantFilter, scopeOrgIds, scopeAllows, soleOrgId, writableOrgId,
  tenantQueryStatus, TenantScopeError,
} from '../src/lib/tenantQuery.ts';

const SRC = path.join(process.cwd(), 'src');

test('활성 조직이 있으면 기존 동작과 동일한 단일 조직 스코프', () => {
  const s = resolveReadScope({ orgId: 7 });
  assert.deepEqual(s, { kind: 'org', orgId: 7 });
  assert.deepEqual(tenantFilter(s), { op: 'eq', column: 'orgId', orgId: 7 });
  assert.equal(soleOrgId(s), 7);
  assert.equal(writableOrgId(s), 7);
});

test('fail-closed: 스코프를 정할 수 없으면 조건 없음이 아니라 deny', () => {
  for (const input of [{}, { orgId: null }, { orgId: 0 }, { orgId: -1 }, { orgId: 1.5 }, { orgId: '3' as any }]) {
    const s = resolveReadScope(input as any);
    assert.equal(s.kind, 'none', JSON.stringify(input));
    assert.equal(tenantFilter(s).op, 'deny');
    assert.deepEqual(scopeOrgIds(s), []);
    assert.throws(() => soleOrgId(s), (e: any) => e instanceof TenantScopeError && e.code === 'NO_TENANT_SCOPE');
  }
});

test('파트너 스위치 OFF 면 partnerOrgIds 는 무시된다(현재 운영 상태)', () => {
  const s = resolveReadScope({ orgId: null, partnerRole: true, partnerOrgIds: [1, 2, 3], partnerEnabled: false });
  assert.equal(s.kind, 'none');
  assert.equal(scopeOrgIds(s).length, 0);
});

test('파트너 역할이 아니면 스위치가 ON 이어도 다중 조직이 열리지 않는다', () => {
  const s = resolveReadScope({ orgId: null, partnerRole: false, partnerOrgIds: [1, 2], partnerEnabled: true });
  assert.equal(s.kind, 'none');
});

test('파트너 스코프: 중복·비정수 제거 후 정렬, 1건이면 단일 스코프로 축약', () => {
  const many = resolveReadScope({ partnerRole: true, partnerEnabled: true, partnerOrgIds: [5, 2, 2, 0, -3, 2.5 as any, 9] });
  assert.deepEqual(many, { kind: 'orgs', orgIds: [2, 5, 9], via: 'partner' });
  assert.deepEqual(tenantFilter(many), { op: 'in', column: 'orgId', orgIds: [2, 5, 9] });
  const one = resolveReadScope({ partnerRole: true, partnerEnabled: true, partnerOrgIds: [4, 4] });
  assert.deepEqual(one, { kind: 'org', orgId: 4 });
  const empty = resolveReadScope({ partnerRole: true, partnerEnabled: true, partnerOrgIds: [] });
  assert.equal(empty.kind, 'none');
});

test('다중 조직 조회 배선은 미활성 — soleOrgId 는 조용히 첫 조직을 쓰지 않고 거절한다', () => {
  const s = resolveReadScope({ partnerRole: true, partnerEnabled: true, partnerOrgIds: [2, 5] });
  assert.throws(() => soleOrgId(s), (e: any) => e instanceof TenantScopeError && e.code === 'MULTI_ORG_SCOPE_NOT_WIRED');
  // 파트너는 읽기 전용 → 쓰기 경로로는 어떤 조직도 얻지 못한다
  assert.throws(() => writableOrgId(s), (e: any) => e.code === 'READ_ONLY_SCOPE');
  assert.throws(() => writableOrgId(resolveReadScope({})), (e: any) => e.code === 'READ_ONLY_SCOPE');
});

test('scopeAllows 런타임 가드', () => {
  const one = resolveReadScope({ orgId: 7 });
  assert.equal(scopeAllows(one, 7), true);
  assert.equal(scopeAllows(one, 8), false);
  assert.equal(scopeAllows(one, '7' as any), false);
  assert.equal(scopeAllows(one, null), false);
  const many = resolveReadScope({ partnerRole: true, partnerEnabled: true, partnerOrgIds: [2, 5] });
  assert.equal(scopeAllows(many, 5), true);
  assert.equal(scopeAllows(many, 6), false);
  assert.equal(scopeAllows(resolveReadScope({}), 1), false);
});

test('상태 요약에 임의 수치가 없고 2계층·화이트라벨은 미활성으로 보고된다', () => {
  const st = tenantQueryStatus(resolveReadScope({ orgId: 3 }));
  assert.equal(st.scopeKind, 'org');
  assert.equal(st.filterOp, 'eq');
  assert.equal(st.orgCount, 1);
  assert.equal(st.multiOrgWired, false);
  assert.equal(st.whitelabel, false);
});

test('순수 모듈 — drizzle·db·next 를 import 하지 않는다', () => {
  const src = fs.readFileSync(path.join(SRC, 'lib/tenantQuery.ts'), 'utf8');
  for (const bad of ['drizzle-orm', '@/db', 'next/']) assert.ok(!src.includes(bad), `tenantQuery.ts must not import ${bad}`);
  assert.ok(!/process\.env/.test(src), 'env 는 인자로 주입한다');
});

test('설정기반 CRUD 목록 조회가 tenantQuery seam 을 경유한다', () => {
  const src = fs.readFileSync(path.join(SRC, 'lib/crud.ts'), 'utf8');
  assert.match(src, /from '\.\/tenantQuery\.ts'/);
  // orgId 는 스코프에서 파생되어야 한다(ctx.orgId 직접 사용 금지 — GET 목록 경로)
  assert.match(src, /eq\(t\.orgId,\s*soleOrgId\(resolveReadScope\(/);
});
