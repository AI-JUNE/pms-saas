import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  PARTNER_ROLE, PARTNER_RBAC_DDL, PARTNER_READABLE_RESOURCES, partnerRoleEnabled, isPartnerRole,
  parsePartnerMemberStatus, partnerCanAccess, partnerIdOfMember, visibleOrgIds, canViewOrg,
  filterVisibleOrgs, decidePartnerAccess, partnerRoleStatus, type PartnerMember,
} from '../src/lib/partnerRbac.ts';
import type { PartnerAttribution } from '../src/lib/partnerAttribution.ts';

const SRC = path.join(process.cwd(), 'src');
const DAY = '2026-09-17';

const member = (over: Partial<PartnerMember> = {}): PartnerMember =>
  ({ partnerId: 7, userId: 1, role: PARTNER_ROLE, status: 'active', ...over });

const attr = (over: Partial<PartnerAttribution> = {}): PartnerAttribution =>
  ({ orgId: 10, partnerId: 7, source: 'partner_sales', contractDate: '2026-01-01', endedAt: null, ...over });

test('switch OFF by default; only "true" enables', () => {
  assert.equal(partnerRoleEnabled({}), false);
  assert.equal(partnerRoleEnabled({ PARTNER_ROLE_ENABLED: '1' }), false);
  assert.equal(partnerRoleEnabled({ PARTNER_ROLE_ENABLED: 'TRUE' }), false);
  assert.equal(partnerRoleEnabled({ PARTNER_ROLE_ENABLED: 'true' }), true);
});

test('DDL draft is idempotent and NOT wired into boot-time MIGRATION_DDL / drizzle schema', () => {
  for (const s of PARTNER_RBAC_DDL) assert.match(s, /IF NOT EXISTS/);
  assert.match(PARTNER_RBAC_DDL[0], /partner_id integer NOT NULL REFERENCES partners\(id\) ON DELETE CASCADE/);
  assert.ok(!/email|phone|password/.test(PARTNER_RBAC_DDL[0]), 'no contact/secret columns');
  assert.ok(PARTNER_RBAC_DDL.some((s) => /UNIQUE INDEX .* \(partner_id, user_id\)/.test(s)));
  const migrate = fs.readFileSync(path.join(SRC, 'lib', 'migrate.ts'), 'utf8');
  assert.ok(!/partner_members/.test(migrate), 'partner_members must not run at boot');
  const schema = fs.readFileSync(path.join(SRC, 'db', 'schema.ts'), 'utf8');
  assert.ok(!/partner_members/.test(schema));
});

test('partnerCanAccess is read-only, whitelisted, fail-closed', () => {
  assert.equal(partnerCanAccess('organization', 'read', false), false, 'switch OFF denies everything');
  for (const r of PARTNER_READABLE_RESOURCES) assert.equal(partnerCanAccess(r, 'read', true), true);
  for (const a of ['write', 'approve', 'admin', 'delete', '']) {
    assert.equal(partnerCanAccess('organization', a, true), false, `action ${a} must be denied`);
  }
  for (const r of ['project', 'task', 'issue', 'requirement', 'member', 'document', 'audit', '']) {
    assert.equal(partnerCanAccess(r, 'read', true), false, `resource ${r} must be denied`);
  }
  assert.equal(partnerCanAccess(null, 'read', true), false);
  assert.equal(partnerCanAccess('organization', null, true), false);
});

test('rbac.ts routes partner_admin away from the org-admin shortcut', () => {
  const rbac = fs.readFileSync(path.join(SRC, 'lib', 'rbac.ts'), 'utf8');
  const partnerLine = rbac.indexOf('isPartnerRole(ctx.role)');
  const adminLine = rbac.indexOf('ctx.isOrgAdmin');
  assert.ok(partnerLine > -1, 'rbac.ts must handle partner_admin');
  assert.ok(partnerLine < adminLine, 'partner check must precede the isOrgAdmin shortcut');
});

test('partnerIdOfMember gates on switch, role and status', () => {
  assert.equal(partnerIdOfMember(member(), false), null);
  assert.equal(partnerIdOfMember(member(), true), 7);
  assert.equal(partnerIdOfMember(member({ status: 'suspended' }), true), null);
  assert.equal(partnerIdOfMember(member({ role: 'admin' as never }), true), null);
  assert.equal(partnerIdOfMember(member({ partnerId: 0 }), true), null);
  assert.equal(partnerIdOfMember(member({ partnerId: 1.5 }), true), null);
  assert.equal(partnerIdOfMember(null, true), null);
  assert.equal(isPartnerRole(PARTNER_ROLE), true);
  assert.equal(isPartnerRole('admin'), false);
  assert.equal(parsePartnerMemberStatus('suspended'), 'suspended');
  assert.equal(parsePartnerMemberStatus('nonsense'), 'active');
});

test('visibility comes from attributions and ends at endedAt (half-open)', () => {
  const rows = [
    attr({ orgId: 10 }),
    attr({ orgId: 11, endedAt: '2026-09-17', endReason: 'converted_direct' }), // 종료일 당일부터 비가시
    attr({ orgId: 12, endedAt: '2026-09-18', endReason: 'partner_changed' }),
    attr({ orgId: 13, partnerId: 8 }),                                        // 다른 파트너
    attr({ orgId: 14, partnerId: null, source: 'direct' }),                   // 직접 계약
    attr({ orgId: 10 }),                                                      // 중복
  ];
  assert.deepEqual(visibleOrgIds(7, rows, DAY), [10, 12]);
  assert.deepEqual(visibleOrgIds(null, rows, DAY), []);
  assert.equal(canViewOrg(7, 10, rows, DAY), true);
  assert.equal(canViewOrg(7, 11, rows, DAY), false);
  assert.equal(canViewOrg(7, 13, rows, DAY), false);
  assert.equal(canViewOrg(null, 10, rows, DAY), false);
  assert.deepEqual(filterVisibleOrgs([{ id: 10 }, { id: 11 }, { id: 13 }], 7, rows, DAY), [{ id: 10 }]);
  assert.deepEqual(filterVisibleOrgs([{ id: 10 }], 7, rows, '2025-12-31'), [], '계약일 이전은 비가시');
});

test('decidePartnerAccess: disabled → DISABLED, out of scope → FORBIDDEN, own org read → allow', () => {
  const rows = [attr({ orgId: 10 })];
  const base = { member: member(), resource: 'organization', action: 'read', attributions: rows, day: DAY };
  assert.deepEqual(
    { ...decidePartnerAccess({ ...base, enabled: false }) },
    { allow: false, code: 'DISABLED', message: '파트너 역할이 비활성 상태입니다' },
  );
  assert.equal(decidePartnerAccess({ ...base, enabled: true, orgId: 10 }).allow, true);
  assert.equal(decidePartnerAccess({ ...base, enabled: true, orgId: 99 }).code, 'FORBIDDEN');
  assert.equal(decidePartnerAccess({ ...base, action: 'write', enabled: true, orgId: 10 }).code, 'FORBIDDEN');
  assert.equal(decidePartnerAccess({ ...base, resource: 'task', enabled: true, orgId: 10 }).code, 'FORBIDDEN');
  assert.equal(decidePartnerAccess({ ...base, member: null, enabled: true }).code, 'FORBIDDEN');
  assert.equal(decidePartnerAccess({ ...base, enabled: true }).allow, true, 'orgId 미지정은 범위 검사 생략');
  assert.equal(decidePartnerAccess({ ...base, enabled: true, orgId: 10, attributions: [] }).code, 'FORBIDDEN');
});

test('status summary carries no invented metrics and defaults to OFF', () => {
  const off = partnerRoleStatus({});
  assert.equal(off.enabled, false);
  assert.equal(off.writeAllowed, false);
  assert.equal(off.role, PARTNER_ROLE);
  assert.equal(off.ddlDraftStatements, PARTNER_RBAC_DDL.length);
  assert.equal(off.ddlApplied, 'unknown');
  assert.match(off.note, /승인/);
  assert.equal(partnerRoleStatus({ PARTNER_ROLE_ENABLED: 'true' }).enabled, true);
  assert.ok(!JSON.stringify(off).match(/\d+(\.\d+)?%/), 'no percentage claims');
});
