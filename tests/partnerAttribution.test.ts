import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  PARTNER_ATTRIBUTION_DDL, ATTRIBUTION_SOURCES, attributionEnabled, parseAttributionSource, parseEndReason, normalizeIsoDate,
  normalizeOwnerRef, validateAttribution, closeAttribution, isActiveOn, activeAttribution, auditAttributionRows,
  attributionEvidence, publicAttribution, type PartnerAttribution,
} from '../src/lib/partnerAttribution.ts';

const SRC = path.join(process.cwd(), 'src');
const TODAY = '2026-09-16';

test('switch OFF by default; only "true" enables', () => {
  assert.equal(attributionEnabled({}), false);
  assert.equal(attributionEnabled({ PARTNER_ATTRIBUTION_ENABLED: '1' }), false);
  assert.equal(attributionEnabled({ PARTNER_ATTRIBUTION_ENABLED: 'true' }), true);
});

test('DDL draft is idempotent, one open record per org, and NOT wired into boot-time MIGRATION_DDL', () => {
  for (const s of PARTNER_ATTRIBUTION_DDL) assert.match(s, /IF NOT EXISTS/);
  assert.ok(PARTNER_ATTRIBUTION_DDL.some((s) => /UNIQUE INDEX .* WHERE ended_at IS NULL/.test(s)));
  const create = PARTNER_ATTRIBUTION_DDL[0];
  assert.match(create, /partner_id integer REFERENCES partners\(id\) ON DELETE SET NULL/);
  assert.ok(!/email|phone/.test(create), 'no contact columns');
  const migrate = fs.readFileSync(path.join(SRC, 'lib', 'migrate.ts'), 'utf8');
  assert.ok(!/partner_attributions/.test(migrate));
  const schema = fs.readFileSync(path.join(SRC, 'db', 'schema.ts'), 'utf8');
  assert.ok(!/partner_attributions/.test(schema));
});

test('enum parsers reject free strings', () => {
  assert.equal(ATTRIBUTION_SOURCES.length, 5);
  assert.equal(parseAttributionSource('partner_sales'), 'partner_sales');
  assert.equal(parseAttributionSource('anything'), null);
  assert.equal(parseAttributionSource(1), null);
  assert.equal(parseEndReason('correction'), 'correction');
  assert.equal(parseEndReason('x'), null);
});

test('normalizeIsoDate accepts only real YYYY-MM-DD', () => {
  assert.equal(normalizeIsoDate('2026-09-16'), '2026-09-16');
  assert.equal(normalizeIsoDate(' 2026-02-28 '), '2026-02-28');
  assert.equal(normalizeIsoDate('2026-02-30'), null);
  assert.equal(normalizeIsoDate('2026-9-1'), null);
  assert.equal(normalizeIsoDate('2026-09-16T00:00:00Z'), null);
  assert.equal(normalizeIsoDate(20260916), null);
});

test('normalizeOwnerRef refuses contact info', () => {
  assert.equal(normalizeOwnerRef('김담당'), '김담당');
  assert.equal(normalizeOwnerRef('EMP-1023'), 'EMP-1023');
  assert.equal(normalizeOwnerRef('a@b.com'), null);
  assert.equal(normalizeOwnerRef('010-1234-5678'), null);
  assert.equal(normalizeOwnerRef('x'.repeat(41)), null);
  assert.equal(normalizeOwnerRef(''), null);
});

test('validateAttribution: valid partner record', () => {
  const r = validateAttribution({ orgId: 7, partnerId: 2, partnerCode: 'j2m1', source: 'partner_sales', contractDate: '2026-09-01', ownerRef: '박영업', memo: ' 첫 계약 ', recordedBy: 1 }, TODAY);
  assert.ok(r.ok);
  if (r.ok) {
    assert.equal(r.value.partnerCode, 'J2M1');
    assert.equal(r.value.memo, '첫 계약');
    assert.equal(r.value.endedAt, null);
    assert.equal(r.value.recordedBy, 1);
  }
});

test('validateAttribution: field errors and evidence contradictions', () => {
  const bad = validateAttribution({ orgId: 0, source: 'nope', contractDate: '2027-01-01', partnerId: -1, partnerCode: '!', ownerRef: 'a@b' }, TODAY);
  assert.ok(!bad.ok);
  if (!bad.ok) {
    const fields = bad.errors.map((e) => `${e.field}:${e.code}`);
    for (const f of ['orgId:REQUIRED', 'source:ENUM', 'contractDate:FUTURE', 'partnerId:INVALID', 'partnerCode:FORMAT', 'ownerRef:PII']) assert.ok(fields.includes(f), f);
  }
  const noPartner = validateAttribution({ orgId: 1, source: 'partner_referral', contractDate: '2026-01-01' }, TODAY);
  assert.ok(!noPartner.ok && noPartner.errors.some((e) => e.field === 'partnerId' && e.code === 'REQUIRED'));
  const directWithPartner = validateAttribution({ orgId: 1, source: 'direct', partnerId: 3, contractDate: '2026-01-01' }, TODAY);
  assert.ok(!directWithPartner.ok && directWithPartner.errors.some((e) => e.code === 'CONFLICT'));
  const direct = validateAttribution({ orgId: 1, source: 'direct', contractDate: '2026-01-01' }, TODAY);
  assert.ok(direct.ok && direct.value.partnerId === null);
  const badDate = validateAttribution({ orgId: 1, source: 'direct', contractDate: 'x' }, TODAY);
  assert.ok(!badDate.ok && badDate.errors.some((e) => e.code === 'DATE'));
});

const A = (p: Partial<PartnerAttribution>): PartnerAttribution => ({ orgId: 1, partnerId: 2, partnerCode: 'J2M1', source: 'partner_sales', contractDate: '2026-01-01', endedAt: null, endReason: null, ...p });

test('closeAttribution never mutates and enforces ordering', () => {
  const a = A({});
  const r = closeAttribution(a, '2026-06-30', 'partner_changed');
  assert.ok(r.ok && r.value.endedAt === '2026-06-30' && r.value.endReason === 'partner_changed');
  assert.equal(a.endedAt, null);
  assert.deepEqual(closeAttribution(A({ endedAt: '2026-02-01' }), '2026-03-01', 'correction'), { ok: false, code: 'ALREADY_ENDED' });
  assert.deepEqual(closeAttribution(a, '2025-12-31', 'correction'), { ok: false, code: 'BEFORE_CONTRACT' });
  assert.deepEqual(closeAttribution(a, 'bad', 'correction'), { ok: false, code: 'DATE' });
});

test('isActiveOn / activeAttribution use half-open [contractDate, endedAt)', () => {
  const a = A({ contractDate: '2026-01-01', endedAt: '2026-07-01' });
  assert.equal(isActiveOn(a, '2025-12-31'), false);
  assert.equal(isActiveOn(a, '2026-01-01'), true);
  assert.equal(isActiveOn(a, '2026-06-30'), true);
  assert.equal(isActiveOn(a, '2026-07-01'), false);
  const b = A({ partnerId: 9, contractDate: '2026-07-01' });
  assert.equal(activeAttribution([a, b], '2026-03-01')?.partnerId, 2);
  assert.equal(activeAttribution([a, b], '2026-08-01')?.partnerId, 9);
  assert.equal(activeAttribution([a, b], '2025-01-01'), null);
});

test('auditAttributionRows flags overlaps, multiple open, missing reason', () => {
  const ok = auditAttributionRows([A({ endedAt: '2026-07-01', endReason: 'partner_changed' }), A({ partnerId: 9, contractDate: '2026-07-01' })]);
  assert.deepEqual(ok, { ok: true, problems: [] });
  const bad = auditAttributionRows([
    A({}), A({ partnerId: 9, contractDate: '2026-03-01' }),                      // 열린 기록 2건 + 겹침
    A({ orgId: 2, contractDate: '2026-05-01', endedAt: '2026-04-01' }),           // 종료일 < 계약일, 사유 누락
  ]);
  assert.equal(bad.ok, false);
  assert.ok(bad.problems.some((p) => p.includes('열린 귀속 기록 2건')));
  assert.ok(bad.problems.some((p) => p.includes('겹침')));
  assert.ok(bad.problems.some((p) => p.includes('앞섬')));
  assert.ok(bad.problems.some((p) => p.includes('사유 누락')));
});

test('attributionEvidence groups active orgs by partner as of a day', () => {
  const rows = [
    A({ orgId: 1 }), A({ orgId: 3 }),
    A({ orgId: 2, partnerId: 9, partnerCode: 'P9' }),
    A({ orgId: 4, partnerId: null, partnerCode: null, source: 'direct' }),
    A({ orgId: 5, contractDate: '2026-12-01' }),                                   // 아직 미유효
  ];
  const ev = attributionEvidence(rows, TODAY);
  const p2 = ev.find((g) => g.partnerId === 2)!;
  assert.deepEqual(p2.orgIds, [1, 3]);
  assert.deepEqual(ev.find((g) => g.partnerId === 9)!.orgIds, [2]);
  assert.deepEqual(ev.find((g) => g.partnerId === null)!.orgIds, [4]);
  assert.ok(!ev.some((g) => g.orgIds.includes(5)));
});

test('publicAttribution omits memo and recordedBy', () => {
  const p = publicAttribution(A({ id: 5, memo: '비공개', recordedBy: 1 }));
  assert.ok(!('memo' in p) && !('recordedBy' in p));
  assert.equal(p.id, 5);
});
