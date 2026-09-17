import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  settlementEnabled, parseRate, loadCommissionConfig, rateFor, applyRounding, parsePeriod, inPeriod,
  isBillableLine, auditRevenueLines, buildSettlement, partnerSettlementView, csvCell, toSettlementCsv,
  toSettlementDetailCsv, settlementFilename, settlementStatus,
  type CommissionConfig, type RevenueLine,
} from '../src/lib/settlement.ts';
import type { PartnerAttribution } from '../src/lib/partnerAttribution.ts';

const SRC = path.join(process.cwd(), 'src');
const P = '2026-08';

const attr = (orgId: number, partnerId: number | null, contractDate: string, endedAt: string | null = null, partnerCode: string | null = null): PartnerAttribution => ({
  orgId, partnerId, partnerCode, source: partnerId === null ? 'direct' : 'partner_sales', contractDate, endedAt, endReason: endedAt ? 'partner_changed' : null,
});
const line = (orgId: number, chargedAt: string, amountKRW: number, extra: Partial<RevenueLine> = {}): RevenueLine => ({ orgId, chargedAt, amountKRW, status: 'paid', ...extra });

const cfg = (over: Partial<CommissionConfig> = {}): CommissionConfig => ({ rates: { DEFAULT: 0.2 }, rounding: 'floor', basis: 'net', ...over });

test('switch OFF by default; only "true" enables', () => {
  assert.equal(settlementEnabled({}), false);
  assert.equal(settlementEnabled({ PARTNER_SETTLEMENT_ENABLED: '1' }), false);
  assert.equal(settlementEnabled({ PARTNER_SETTLEMENT_ENABLED: 'true' }), true);
});

test('no commission rate is hardcoded in the module', () => {
  const src = fs.readFileSync(path.join(SRC, 'lib', 'settlement.ts'), 'utf8');
  // 요율 리터럴(0.xx)이 모듈에 박혀 있으면 안 된다. 허용: 반올림 배율(1e6/1e4)
  assert.ok(!/rates\s*:\s*\{[^}]*\d/.test(src), '기본 요율 리터럴 금지');
  assert.match(src, /PARTNER_COMMISSION_RATES/);
  // 요율 미설정이면 계산하지 않는다
  const r = buildSettlement({ period: P, lines: [line(1, '2026-08-05', 10000)], attributions: [attr(1, 7, '2026-01-01', null, 'J2M1')], config: cfg({ rates: {} }) });
  assert.ok(r.ok);
  const row = r.value.partners[0];
  assert.equal(row.status, 'rate_unconfigured');
  assert.equal(row.commissionKRW, null);
  assert.equal(r.value.totals.commissionKRW, 0);
  assert.equal(r.value.totals.partnersWithoutRate, 1);
});

test('parseRate accepts number/percent, rejects out-of-range', () => {
  assert.equal(parseRate(0.25), 0.25);
  assert.equal(parseRate('25%'), 0.25);
  assert.equal(parseRate('0.3'), 0.3);
  assert.equal(parseRate('100%'), 1);
  assert.equal(parseRate('-1%'), null);
  assert.equal(parseRate('120%'), null);
  assert.equal(parseRate('abc'), null);
  assert.equal(parseRate(''), null);
  assert.equal(parseRate(null), null);
});

test('loadCommissionConfig reads JSON and key=value forms, defaults floor/net', () => {
  const empty = loadCommissionConfig({});
  assert.ok(empty.ok && Object.keys(empty.value.rates).length === 0 && empty.value.rounding === 'floor' && empty.value.basis === 'net');

  const json = loadCommissionConfig({ PARTNER_COMMISSION_RATES: '{"DEFAULT":"20%","j2m1":0.25}' });
  assert.ok(json.ok);
  assert.deepEqual(json.value.rates, { DEFAULT: 0.2, J2M1: 0.25 });

  const kv = loadCommissionConfig({ PARTNER_COMMISSION_RATES: 'DEFAULT=15%, J2M1=0.3', PARTNER_COMMISSION_ROUNDING: 'round', PARTNER_COMMISSION_BASIS: 'gross' });
  assert.ok(kv.ok);
  assert.deepEqual(kv.value.rates, { DEFAULT: 0.15, J2M1: 0.3 });
  assert.equal(kv.value.rounding, 'round');
  assert.equal(kv.value.basis, 'gross');

  const bad = loadCommissionConfig({ PARTNER_COMMISSION_RATES: '{"J2M1":2}', PARTNER_COMMISSION_ROUNDING: 'bankers' });
  assert.ok(!bad.ok);
  assert.ok(bad.errors.some((e) => e.code === 'RATE'));
  assert.ok(bad.errors.some((e) => e.field === 'PARTNER_COMMISSION_ROUNDING'));
  assert.ok(!loadCommissionConfig({ PARTNER_COMMISSION_RATES: '{oops' }).ok);
  assert.ok(!loadCommissionConfig({ PARTNER_COMMISSION_RATES: 'J2M1' }).ok);
});

test('rateFor prefers partner code over DEFAULT; null when unconfigured', () => {
  const c = cfg({ rates: { DEFAULT: 0.2, J2M1: 0.25 } });
  assert.equal(rateFor(c, 'j2m1'), 0.25);
  assert.equal(rateFor(c, 'OTHER'), 0.2);
  assert.equal(rateFor(c, null), 0.2);
  assert.equal(rateFor(cfg({ rates: {} }), 'J2M1'), null);
  assert.equal(applyRounding(1234.7, 'floor'), 1234);
  assert.equal(applyRounding(1234.4, 'round'), 1234);
  assert.equal(applyRounding(1234.1, 'ceil'), 1235);
});

test('parsePeriod is a half-open month range', () => {
  const p = parsePeriod('2026-08');
  assert.deepEqual(p, { period: '2026-08', start: '2026-08-01', endExclusive: '2026-09-01' });
  assert.ok(inPeriod('2026-08-31', p!));
  assert.ok(!inPeriod('2026-09-01', p!));
  assert.ok(!inPeriod('2026-07-31', p!));
  assert.equal(parsePeriod('2026-13'), null);
  assert.equal(parsePeriod('2026-8'), null);
  assert.equal(parsePeriod(20268), null);
  assert.equal(buildSettlement({ period: 'x', lines: [], attributions: [], config: cfg() }).ok, false);
});

test('only paid/refunded lines inside the period count', () => {
  const p = parsePeriod(P)!;
  assert.ok(isBillableLine(line(1, '2026-08-01', 1000), p));
  assert.ok(isBillableLine(line(1, '2026-08-01', 1000, { status: 'refunded' }), p));
  assert.ok(!isBillableLine(line(1, '2026-08-01', 1000, { status: 'failed' }), p));
  assert.ok(!isBillableLine(line(1, '2026-09-01', 1000), p));
  assert.ok(!isBillableLine(line(0, '2026-08-01', 1000), p));

  const problems = auditRevenueLines([
    line(1, '2026-07-31', 1000),
    line(2, '2026-08-02', 1000, { refundKRW: 2000 }),
    line(3, '20260802', 1000),
    line(0, '2026-08-02', 1000),
  ], p);
  assert.equal(problems.length, 4);
  assert.ok(problems.some((s) => /정산기간/.test(s)));
  assert.ok(problems.some((s) => /초과/.test(s)));
});

test('lines attribute per charge date, splitting a mid-period partner change', () => {
  const attributions = [
    attr(1, 7, '2026-01-01', '2026-08-15', 'J2M1'),   // 8/15 부터 비귀속
    attr(1, 9, '2026-08-15', null, 'OTHER'),
  ];
  const lines = [line(1, '2026-08-10', 10000), line(1, '2026-08-20', 10000)];
  const r = buildSettlement({ period: P, lines, attributions, config: cfg({ rates: { J2M1: 0.25, OTHER: 0.1 } }) });
  assert.ok(r.ok);
  const j2m1 = r.value.partners.find((x) => x.partnerId === 7)!;
  const other = r.value.partners.find((x) => x.partnerId === 9)!;
  assert.equal(j2m1.netKRW, 10000);
  assert.equal(j2m1.commissionKRW, 2500);
  assert.equal(other.netKRW, 10000);
  assert.equal(other.commissionKRW, 1000);
  assert.equal(r.value.totals.commissionKRW, 3500);
  assert.equal(partnerSettlementView(r.value, 7)!.orgCount, 1);
  assert.equal(partnerSettlementView(r.value, 99), null);
});

test('refunds reduce net; basis gross ignores them; direct contracts earn no commission', () => {
  const attributions = [attr(1, 7, '2026-01-01', null, 'J2M1'), attr(2, null, '2026-01-01')];
  const lines = [line(1, '2026-08-10', 10000, { refundKRW: 4000 }), line(2, '2026-08-11', 50000)];

  const net = buildSettlement({ period: P, lines, attributions, config: cfg({ rates: { DEFAULT: 0.25 } }) });
  assert.ok(net.ok);
  const pRow = net.value.partners.find((x) => x.partnerId === 7)!;
  assert.equal(pRow.grossKRW, 10000);
  assert.equal(pRow.refundKRW, 4000);
  assert.equal(pRow.netKRW, 6000);
  assert.equal(pRow.baseKRW, 6000);
  assert.equal(pRow.commissionKRW, 1500);

  const direct = net.value.partners.find((x) => x.partnerId === null)!;
  assert.equal(direct.netKRW, 50000);
  assert.equal(direct.commissionKRW, null);
  assert.equal(direct.rate, null);
  assert.equal(direct.status, 'ok');
  assert.equal(net.value.totals.commissionKRW, 1500);
  assert.equal(net.value.totals.netKRW, 56000);

  const gross = buildSettlement({ period: P, lines, attributions, config: cfg({ rates: { DEFAULT: 0.25 }, basis: 'gross' }) });
  assert.ok(gross.ok);
  assert.equal(gross.value.partners.find((x) => x.partnerId === 7)!.commissionKRW, 2500);

  // 과다 환불은 청구액까지만 반영(음수 매출 금지)
  const over = buildSettlement({ period: P, lines: [line(1, '2026-08-10', 10000, { refundKRW: 99999 })], attributions, config: cfg() });
  assert.ok(over.ok);
  assert.equal(over.value.partners[0].netKRW, 0);
});

test('revenue with no attribution record is separated, not silently assigned', () => {
  const r = buildSettlement({ period: P, lines: [line(5, '2026-08-10', 30000)], attributions: [], config: cfg() });
  assert.ok(r.ok);
  assert.equal(r.value.partners.length, 0);
  assert.deepEqual(r.value.unattributed.orgIds, [5]);
  assert.equal(r.value.unattributed.netKRW, 30000);
  assert.equal(r.value.totals.netKRW, 30000);
  assert.equal(r.value.totals.commissionKRW, 0);
  assert.ok(r.value.warnings.some((w) => /귀속 기록 없는 매출/.test(w)));
});

test('CSV export escapes formulas and carries totals', () => {
  assert.equal(csvCell('=1+1'), "'=1+1");
  assert.equal(csvCell('a,b'), '"a,b"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell(null), '');

  const r = buildSettlement({
    period: P,
    lines: [line(1, '2026-08-10', 10000, { refundKRW: 1000 }), line(2, '2026-08-11', 20000), line(5, '2026-08-12', 7000)],
    attributions: [attr(1, 7, '2026-01-01', null, 'J2M1'), attr(2, 7, '2026-02-01', null, 'J2M1')],
    config: cfg({ rates: { J2M1: 0.25 } }),
  });
  assert.ok(r.ok);
  const csv = toSettlementCsv(r.value);
  assert.ok(csv.startsWith('﻿'));
  assert.match(csv, /기간,파트너ID/);
  assert.match(csv, /J2M1/);
  assert.match(csv, /25%/);
  assert.match(csv, /귀속없음/);
  assert.match(csv, /합계/);
  const detail = toSettlementDetailCsv(r.value);
  assert.equal(detail.trim().split('\r\n').length, 3);   // 헤더 + 조직 2
  assert.equal(settlementFilename(r.value), 'settlement_2026-08_summary.csv');
  assert.equal(settlementFilename({ ...r.value, period: '../etc/passwd' }, 'detail'), 'settlement__detail.csv');
});

test('settlementStatus reports config health without inventing numbers', () => {
  const off = settlementStatus({});
  assert.equal(off.enabled, false);
  assert.equal(off.ratesConfigured, 0);
  assert.equal(off.hasDefaultRate, false);
  assert.match(off.note, /승인 후/);
  const on = settlementStatus({ PARTNER_SETTLEMENT_ENABLED: 'true', PARTNER_COMMISSION_RATES: 'DEFAULT=20%' });
  assert.equal(on.enabled, true);
  assert.equal(on.ratesConfigured, 1);
  assert.equal(on.hasDefaultRate, true);
  const broken = settlementStatus({ PARTNER_COMMISSION_BASIS: 'weird' });
  assert.equal(broken.configOk, false);
  assert.ok(broken.configErrors.length > 0);
});

test('settlement module stays pure: no DB/next imports and no new DDL', () => {
  const src = fs.readFileSync(path.join(SRC, 'lib', 'settlement.ts'), 'utf8');
  assert.ok(!/from '\.\/db|drizzle-orm|next\/server/.test(src), 'DB·next 의존 금지');
  assert.ok(!/CREATE TABLE/i.test(src), '신규 DDL 금지(기존 청구 내역에서 집계)');
});
