import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  PARTNER_MIGRATION_DDL, PARTNER_TIERS, partnerChannelEnabled, normalizePartnerCode, parsePartnerTier, parsePartnerStatus,
  contractParty, resolvePartnerId, isDirectContract, partnerScopeFor, filterOrgsByScope, publicPartner, partnerChannelStatus,
} from '../src/lib/partner.ts';

const SRC = path.join(process.cwd(), 'src');

test('switch is OFF by default and only "true" turns it on', () => {
  assert.equal(partnerChannelEnabled({}), false);
  assert.equal(partnerChannelEnabled({ PARTNER_CHANNEL_ENABLED: '1' }), false);
  assert.equal(partnerChannelEnabled({ PARTNER_CHANNEL_ENABLED: 'TRUE' }), false);
  assert.equal(partnerChannelEnabled({ PARTNER_CHANNEL_ENABLED: 'true' }), true);
});

test('partner DDL draft is idempotent and NOT wired into boot-time MIGRATION_DDL', () => {
  for (const s of PARTNER_MIGRATION_DDL) assert.match(s, /IF NOT EXISTS|IF EXISTS/);
  assert.ok(PARTNER_MIGRATION_DDL.some((s) => /ALTER TABLE IF EXISTS organizations ADD COLUMN IF NOT EXISTS partner_id/.test(s)));
  // partner_id 는 nullable(직접 계약) — NOT NULL 금지
  const alter = PARTNER_MIGRATION_DDL.find((s) => s.includes('partner_id'))!;
  assert.ok(!/NOT NULL/.test(alter));
  // 부팅 자동 실행되는 migrate.ts 에는 partner 관련 DDL 이 없어야 한다(라이브 DDL 적용은 승인 필요)
  const migrate = fs.readFileSync(path.join(SRC, 'lib', 'migrate.ts'), 'utf8');
  assert.ok(!/partner/i.test(migrate), 'migrate.ts must not contain partner DDL before approval');
  // drizzle organizations 스키마에도 partnerId 가 아직 없어야 한다(DDL 미적용 상태에서 선언하면 select 가 깨짐)
  const schema = fs.readFileSync(path.join(SRC, 'db', 'schema.ts'), 'utf8');
  const orgBlock = schema.slice(schema.indexOf("pgTable('organizations'"), schema.indexOf("pgTable('memberships'"));
  assert.ok(!/partner/i.test(orgBlock), 'schema.ts organizations must not declare partner_id before DDL is applied');
});

test('normalizePartnerCode enforces charset and length', () => {
  assert.equal(normalizePartnerCode(' j2m1 '), 'J2M1');
  assert.equal(normalizePartnerCode('ab-cd'), 'AB-CD');
  assert.equal(normalizePartnerCode('a'), null);            // 너무 짧음
  assert.equal(normalizePartnerCode('-abc'), null);         // 하이픈으로 시작
  assert.equal(normalizePartnerCode('abc-'), null);         // 하이픈으로 끝
  assert.equal(normalizePartnerCode('a'.repeat(21)), null); // 너무 김
  assert.equal(normalizePartnerCode('a'.repeat(20)), 'A'.repeat(20));
  assert.equal(normalizePartnerCode('제이투'), null);
  assert.equal(normalizePartnerCode(12), null);
  assert.equal(normalizePartnerCode(null), null);
});

test('tier/status parsing falls back to safe defaults; contract party follows tier', () => {
  assert.equal(parsePartnerTier('reseller'), 'reseller');
  assert.equal(parsePartnerTier('agency'), 'agency');
  assert.equal(parsePartnerTier('whitelabel'), 'agency');
  assert.equal(parsePartnerTier(undefined), 'agency');
  assert.equal(parsePartnerStatus('suspended'), 'suspended');
  assert.equal(parsePartnerStatus('ended'), 'ended');
  assert.equal(parsePartnerStatus('bogus'), 'active');
  assert.deepEqual(PARTNER_TIERS, ['agency', 'reseller']);
  assert.equal(contractParty('agency'), 'gowon');
  assert.equal(contractParty('reseller'), 'partner');
});

test('resolvePartnerId: OFF → always null; ON → positive integer only', () => {
  assert.equal(resolvePartnerId({ id: 1, partnerId: 7 }, false), null);
  assert.equal(resolvePartnerId({ id: 1, partnerId: 7 }, true), 7);
  assert.equal(resolvePartnerId({ id: 1 }, true), null);                  // 컬럼 미적용 row
  assert.equal(resolvePartnerId({ id: 1, partnerId: null }, true), null);
  assert.equal(resolvePartnerId({ id: 1, partnerId: 0 }, true), null);
  assert.equal(resolvePartnerId({ id: 1, partnerId: -3 }, true), null);
  assert.equal(resolvePartnerId({ id: 1, partnerId: 2.5 }, true), null);
  assert.equal(resolvePartnerId(null, true), null);
  assert.equal(isDirectContract({ id: 1, partnerId: 7 }, false), true);
  assert.equal(isDirectContract({ id: 1, partnerId: 7 }, true), false);
  assert.equal(isDirectContract({ id: 1 }, true), true);
});

test('partnerScopeFor: superadmin or OFF → all; partner viewer → partner scope', () => {
  assert.deepEqual(partnerScopeFor({ isSuperadmin: true, partnerId: 3 }, true), { kind: 'all' });
  assert.deepEqual(partnerScopeFor({ isSuperadmin: false, partnerId: 3 }, false), { kind: 'all' });
  assert.deepEqual(partnerScopeFor({ isSuperadmin: false, partnerId: 3 }, true), { kind: 'partner', partnerId: 3 });
  assert.deepEqual(partnerScopeFor({ isSuperadmin: false, partnerId: null }, true), { kind: 'all' });
  assert.deepEqual(partnerScopeFor({ isSuperadmin: false, partnerId: 0 }, true), { kind: 'all' });
});

test('filterOrgsByScope keeps only orgs attributed to the partner', () => {
  const rows = [{ id: 1, partnerId: 3 }, { id: 2, partnerId: null }, { id: 3 }, { id: 4, partnerId: 5 }, { id: 5, partnerId: 3 }];
  assert.deepEqual(filterOrgsByScope(rows, { kind: 'all' }, true).map((r) => r.id), [1, 2, 3, 4, 5]);
  assert.deepEqual(filterOrgsByScope(rows, { kind: 'partner', partnerId: 3 }, true).map((r) => r.id), [1, 5]);
  // 스위치 OFF 면 파트너 스코프여도 아무 조직도 귀속되지 않는다(우발 노출 방지)
  assert.deepEqual(filterOrgsByScope(rows, { kind: 'partner', partnerId: 3 }, false), []);
});

test('publicPartner strips contact details', () => {
  const p = publicPartner({ id: 1, code: 'J2M1', name: '제이투모로우원', tier: 'agency', status: 'active', contactName: '홍길동', contactEmail: 'x@example.com' });
  assert.deepEqual(p, { id: 1, code: 'J2M1', name: '제이투모로우원', tier: 'agency', status: 'active', contractParty: 'gowon' });
  assert.ok(!('contactEmail' in p) && !('contactName' in p));
});

test('partnerChannelStatus reports switch and draft state without invented numbers', () => {
  const off = partnerChannelStatus({});
  assert.equal(off.enabled, false);
  assert.equal(off.resellerActive, false);
  assert.equal(off.ddlApplied, 'unknown');
  assert.equal(off.ddlDraftStatements, PARTNER_MIGRATION_DDL.length);
  assert.match(off.note, /승인/);
  const on = partnerChannelStatus({ PARTNER_CHANNEL_ENABLED: 'true' });
  assert.equal(on.enabled, true);
  assert.equal(on.resellerActive, false);
});
