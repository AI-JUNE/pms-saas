import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  CLAIM_REGISTRY, claimSpec, auditPlanClaims, seatClaim,
  freeTrialSeats, freeTrialClaim, planClaimsStatus,
} from '../src/lib/planClaims.ts';
import { PLANS } from '../src/lib/billing.ts';
import { SEAT_LIMIT } from '../src/lib/entitlements.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('실제 요금제 카드 문구가 엔타이틀먼트와 어긋나지 않는다(과장 0건)', () => {
  const a = auditPlanClaims();
  assert.deepEqual(a.issues, [], a.issues.map((i) => i.message).join('\n'));
  assert.equal(planClaimsStatus({}).consistent, true);
});

test('모든 카드 문구가 레지스트리에 등록되어 있다', () => {
  for (const p of PLANS) {
    for (const f of p.features) {
      assert.ok(claimSpec(f), `미등록 문구(${p.id}): "${f}" — CLAIM_REGISTRY 에 추가하라`);
    }
  }
});

test('상위 플랜 전용 기능을 하위 카드가 약속하면 over_promised 로 잡는다', () => {
  const bad = [{ id: 'basic' as const, features: ['EVM 성과관리(SPI·CPI·PV·EV·AC)'] }];
  const a = auditPlanClaims(bad);
  assert.equal(a.issues.length, 1);
  assert.equal(a.issues[0].code, 'over_promised');
  assert.equal(a.issues[0].feature, 'evm');
});

test('미등록 문구와 잘못된 승계를 각각 잡는다', () => {
  const a = auditPlanClaims([
    { id: 'pro' as const, features: ['무제한 그 무엇'] },
    { id: 'basic' as const, features: ['Pro 전체 포함'] }, // 하위가 상위를 승계 주장
  ]);
  assert.deepEqual(a.issues.map((i) => i.code).sort(), ['bad_inherit', 'unmapped']);
});

test('계약·운영 조건은 unverifiable 로 분리되어 사람 확인 대상으로 남는다', () => {
  const a = auditPlanClaims();
  assert.ok(a.unverifiable.length > 0);
  for (const u of a.unverifiable) {
    assert.equal(u.plan, 'enterprise'); // SLA·조달·전용 인프라는 Enterprise 에만
    assert.equal(CLAIM_REGISTRY[u.claim].kind, 'unverifiable');
  }
});

test('카드에 안 적힌 사용 가능 기능은 오류가 아니라 정보(unclaimed)로만 보고한다', () => {
  const a = auditPlanClaims();
  assert.equal(a.issues.length, 0);
  for (const u of a.unclaimed) assert.ok(u.feature && u.label);
});

test('좌석 문구는 SEAT_LIMIT 에서 파생된다', () => {
  assert.equal(seatClaim('basic'), `최대 ${SEAT_LIMIT.basic!.toLocaleString('ko-KR')}명`);
  assert.equal(seatClaim('pro'), `최대 ${SEAT_LIMIT.pro!.toLocaleString('ko-KR')}명`);
  assert.equal(seatClaim('enterprise'), '좌석 수 무제한');
  assert.equal(seatClaim('platinum'), '좌석 정책 미정');
  assert.equal(seatClaim(undefined), '좌석 정책 미정');
});

test('무료 체험 좌석은 env 만 인정하고 기본값이 없다', () => {
  assert.equal(freeTrialSeats({}), null);
  assert.equal(freeTrialClaim({}), null);
  assert.equal(freeTrialSeats({ PRICING_FREE_TRIAL_SEATS: '5' }), 5);
  assert.equal(freeTrialClaim({ PRICING_FREE_TRIAL_SEATS: '5' }), '5명까지 무료로 체험할 수 있습니다');
  // 형식 밖·0·음수·소수는 거부(추측 금지)
  for (const v of ['', ' ', 'abc', '0', '-3', '2.5', '５']) {
    assert.equal(freeTrialSeats({ PRICING_FREE_TRIAL_SEATS: v }), null, `거부되어야 함: ${JSON.stringify(v)}`);
  }
  // Basic 좌석 상한보다 많은 무료 좌석은 모순 → 문구 생략
  assert.equal(freeTrialSeats({ PRICING_FREE_TRIAL_SEATS: String(SEAT_LIMIT.basic! + 1) }), null);
});

test('요금제 문구·화면에 인원수 리터럴이 하드코딩되어 있지 않다', () => {
  // 과거 "5인까지 무료 체험" 처럼 근거 없는 수치가 다시 들어오는 것을 막는다.
  const seatLiteral = /[0-9]+\s*인/;
  const billing = read('src/lib/billing.ts');
  assert.equal(seatLiteral.test(billing), false, 'billing.ts 에 인원수 문구가 하드코딩되었다');
  const page = read('src/app/pricing/page.tsx');
  assert.equal(seatLiteral.test(page), false, 'pricing/page.tsx 에 인원수 문구가 하드코딩되었다');
  // planClaims.ts 자체도 좌석 수 리터럴을 갖지 않는다(전부 SEAT_LIMIT/env 파생)
  const mod = read('src/lib/planClaims.ts');
  assert.equal(seatLiteral.test(mod), false);
});

test('가격 페이지가 좌석·무료체험을 파생 함수로만 표시한다', () => {
  const page = read('src/app/pricing/page.tsx');
  assert.match(page, /seatClaim\(/);
  assert.match(page, /freeTrialClaim\(/);
  // 무료 체험 문구는 조건부 — 근거 없으면 아무 약속도 하지 않는다
  assert.match(page, /freeTrial \?/);
});

test('planClaimsStatus 는 시크릿 없이 요약만 돌려준다', () => {
  const s = planClaimsStatus({ PRICING_FREE_TRIAL_SEATS: '5' });
  assert.equal(s.plans, PLANS.length);
  assert.equal(s.issues, 0);
  assert.equal(s.freeTrialSeats, 5);
  assert.deepEqual(Object.keys(s).sort(), ['consistent', 'freeTrialSeats', 'issues', 'plans', 'unclaimed', 'unverifiable']);
});
