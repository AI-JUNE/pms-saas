/**
 * externalReconcile.test.ts — 복구가 **되돌리지 못하는 외부 상태**와의 대조(RUNBOOK §3 6-2단계·§3-9). 2026-10-15
 *
 * ── 왜 필요한가 ──────────────────────────────────────────────────────────────
 * §3 1~8단계·§5·§2·§4 는 모두 이 DB 안의 상태를 다룬다. 그런데 결제 제공자 쪽 결제·구독은 복구가
 * 되돌리지 못하고, 그 반영 결과(`organizations.plan` + 감사 이벤트 `BILLING_PLAN_APPLIED`)만
 * T-ε 로 되돌아간다 — 결제한 조직은 플랜이 내려가고 해지한 조직은 유료 플랜이 되살아난다.
 * 4단계는 `organizations` 를 **행 수로만** 세므로 둘 다 `ok` 로 통과하고, 차단 중의 503 은
 * 미들웨어가 내므로 로그에도 결제 이벤트로 남지 않는다.
 *
 * 그래서 (a) 구간 판정 자체(끝은 **해제 시각**이고, 없으면 차단 시각으로 **좁히지 않는다**),
 * (b) 배선(health 응답·RUNBOOK 6-2단계·7단계 선행 조건), (c) **결제 반영 경로의 모양**과
 * **웹훅이 차단 예외에 끼어들지 않았는지**를 파일 수준에서 고정한다.
 * 이 테스트는 **파일만 읽는다** — 네트워크·DB 를 쓰지 않고 `process.env` 도 바꾸지 않는다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  ACTION_WINDOW_END_BEFORE_START,
  ACTION_WINDOW_END_UNRECORDED,
  ACTION_WINDOW_OK,
  APPLIED_PLAN_COLUMN,
  BILLING_WEBHOOK_PATH,
  DRIFT_DIRECTIONS,
  EXTERNAL_LIMITS,
  EXTERNAL_RECONCILED_ENV,
  EXTERNAL_SYSTEMS,
  RECONCILE_STATES,
  RECONCILE_STEPS,
  RECONCILE_VERDICTS,
  assessReconcileWindow,
  auditHealthWiring,
  auditPlanColumnBlindSpot,
  auditRunbookExternal,
  auditWebhookNotExempt,
  auditWebhookRoute,
  driftFor,
  externalLogLine,
  externalReconcileStatus,
  externalStateCheck,
  planApplyActive,
  paymentsLive,
  reconciledAtFromEnv,
  reconcilePlanFor,
  reconcileText,
  systemFor,
} from '../src/lib/externalReconcile.ts';
import { ENV_VARS } from '../src/lib/envRegistry.ts';
import { TRANSIENT_KEYS } from '../src/lib/envPresence.ts';
import { FREEZE_EXEMPT } from '../src/lib/writeFreeze.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (...p: string[]) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

const RP = '2026-10-15T12:55:00+09:00'; // 복구 시점 T-ε
const FROZE = '2026-10-15T13:10:00+09:00'; // 차단을 **건** 시각(§3-7 유실 구간의 끝)
const RELEASED = '2026-10-15T15:40:00+09:00'; // 차단을 **푼** 시각(대조 구간의 끝)
const NOW = new Date('2026-10-15T16:00:00+09:00');

/* ─────────────────────────── 구간 판정 ─────────────────────────── */

test('대조 구간: 끝은 **해제 시각**이고 §3-7 유실 구간보다 넓다', () => {
  const w = assessReconcileWindow({ restorePoint: RP, releasedAt: RELEASED, freezeAt: FROZE, now: NOW });
  assert.equal(w.verdict, 'ok');
  assert.equal(w.startsAt, new Date(RP).toISOString());
  assert.equal(w.endsAt, new Date(RELEASED).toISOString());
  assert.equal(w.endKind, 'release');
  assert.equal(w.minutes, 165); // 12:55 → 15:40
  assert.equal(w.hours, 2.75);
  // 차단 시각은 **참고용**이고 구간의 끝이 아니다.
  assert.equal(w.freezeAt, new Date(FROZE).toISOString());
  assert.ok(new Date(w.endsAt!).getTime() > new Date(w.freezeAt!).getTime(), '유실 구간보다 넓지 않다');
  assert.equal(w.action, ACTION_WINDOW_OK);
  assert.equal(w.caveats.length, 3);
  assert.ok(w.caveats.some((c) => /넓다/.test(c)), '§3-7 과의 차이를 말하지 않는다');
});

test('끝이 없으면 **차단 시각으로 좁히지 않는다** — end_unrecorded 로 멈춘다', () => {
  for (const missing of ['', '   ', null, undefined]) {
    const w = assessReconcileWindow({ restorePoint: RP, releasedAt: missing, freezeAt: FROZE, now: NOW });
    assert.equal(w.verdict, 'end_unrecorded');
    assert.equal(w.endsAt, null, '차단 시각을 끝으로 썼다');
    assert.equal(w.endKind, null);
    assert.equal(w.minutes, null);
    assert.equal(w.hours, null);
    // 참고용으로는 돌려주되 판정에는 쓰지 않는다.
    assert.equal(w.freezeAt, new Date(FROZE).toISOString());
    assert.equal(w.action, ACTION_WINDOW_END_UNRECORDED);
  }
});

test('복구 시점을 못 읽으면 추측하지 않는다', () => {
  for (const bad of ['', '어제', '2026-02-30T00:00:00+09:00', '2026-13-01T00:00:00+09:00', null, 12345]) {
    const w = assessReconcileWindow({ restorePoint: bad, releasedAt: RELEASED, now: NOW });
    assert.equal(w.verdict, 'invalid_restore_point', `추측했다: ${String(bad)}`);
    assert.equal(w.startsAt, null);
    assert.equal(w.minutes, null);
  }
});

test('끝이 판독 불가면 「없음」으로 덮지 않는다 — invalid_end', () => {
  const w = assessReconcileWindow({ restorePoint: RP, releasedAt: '오후 세시쯤', now: NOW });
  assert.equal(w.verdict, 'invalid_end');
  assert.equal(w.endsAt, null);
  assert.equal(w.minutes, null);
});

test('끝이 시작보다 앞이면 음수를 0 으로 깎아 「대조할 것이 없다」로 만들지 않는다', () => {
  const w = assessReconcileWindow({ restorePoint: RELEASED, releasedAt: RP, now: NOW });
  assert.equal(w.verdict, 'end_before_start');
  assert.equal(w.minutes, null);
  assert.equal(w.hours, null);
  assert.equal(w.endsAt, new Date(RP).toISOString(), '끝 시각을 숨겼다 — 어느 쪽이 틀렸는지 못 본다');
  assert.equal(w.action, ACTION_WINDOW_END_BEFORE_START);
});

test('끝이 미래면 구간을 확정하지 않는다 — 그 뒤 거절되는 웹훅이 빠진다', () => {
  const w = assessReconcileWindow({
    restorePoint: RP,
    releasedAt: '2026-10-15T23:00:00+09:00',
    now: NOW,
  });
  assert.equal(w.verdict, 'future_end');
  assert.equal(w.minutes, null);
  assert.equal(new Set(RECONCILE_VERDICTS).has(w.verdict), true);
});

/* ─────────────────────────── 정본 목록 ─────────────────────────── */

test('외부 상태 정본: 전건이 「왜 검증에 안 걸리는가」와 「지금 상태」를 함께 적는다', () => {
  assert.ok(EXTERNAL_SYSTEMS.length >= 3);
  for (const s of EXTERNAL_SYSTEMS) {
    for (const f of ['key', 'system', 'holds', 'reverted', 'cannotRevert', 'effect', 'silent', 'today'] as const) {
      assert.ok(String(s[f]).trim().length > 0, `${s.key} 의 ${f} 가 비었다`);
    }
  }
  // 결제 반영 경로가 정본 목록의 첫 항목이고, 행 수 대조의 사각지대를 명시한다.
  const pay = systemFor('payment_plan_apply');
  assert.ok(pay, '결제 반영 항목이 없다');
  assert.ok(pay!.reverted.includes(APPLIED_PLAN_COLUMN));
  assert.match(pay!.silent, /행 수/);
  // 웹훅 항목은 「수동 대조가 필요하다」는 FREEZE_LIMITS 의 약속과 같은 구간을 가리킨다.
  const hook = systemFor('payment_webhook_ack');
  assert.match(hook!.effect, /재시도/);
  assert.equal(systemFor('없는키'), null);
  assert.equal(systemFor(null), null);
});

test('어긋남은 두 방향이고, 한쪽은 **아무도 신고하지 않는다**', () => {
  assert.equal(DRIFT_DIRECTIONS.length, 2);
  const paid = driftFor('paid_not_applied');
  const revoked = driftFor('revoked_but_restored');
  assert.ok(paid && revoked);
  assert.match(paid!.fix, /재결제를 요청하지 않는다/, '이중 청구 경고가 없다');
  assert.match(revoked!.whoReports, /아무도/);
  assert.equal(driftFor('other'), null);
  // 절차는 양방향 대조와 기록(그 뒤 해제)까지 말한다.
  assert.ok(RECONCILE_STEPS.length >= 5);
  assert.equal(RECONCILE_STEPS[RECONCILE_STEPS.length - 1].what.includes(EXTERNAL_RECONCILED_ENV), true);
  for (const s of RECONCILE_STEPS) {
    assert.ok(s.why.trim() && s.evidence.trim(), `${s.n}단계의 근거가 비었다`);
  }
});

test('사각지대: 제공자 재시도 창 길이를 코드가 정하지 않는다', () => {
  const src = read('src', 'lib', 'externalReconcile.ts');
  assert.equal(/RETRY_WINDOW|RETRY_HOURS/.test(src), false, '재시도 창 상수를 두었다');
  assert.equal(/retryWindow\w*\s*(=|\?\?)\s*\d/.test(src), false, '재시도 창 폴백 수치를 두었다');
  assert.ok(
    EXTERNAL_LIMITS.some((l) => /재시도.*(언제까지|모른다)/.test(l)),
    '재시도 창을 모른다는 사실을 한계로 내보내지 않는다',
  );
  // §3-7 과 다른 구간이라는 사실도 한계에 적는다(두 수치를 섞으면 고지가 틀린다).
  assert.ok(EXTERNAL_LIMITS.some((l) => /3-7/.test(l)));
});

/* ─────────────────────────── env·판정 ─────────────────────────── */

test('기록 시각: 전용 키만 인정하고 판독 불가는 「기록됨」으로 올리지 않는다', () => {
  assert.equal(reconciledAtFromEnv({}).at, null);
  assert.equal(reconciledAtFromEnv({ RECOVERY_EXTERNAL_RECONCILED_AT: '  ' }).raw, null);
  const good = reconciledAtFromEnv({ RECOVERY_EXTERNAL_RECONCILED_AT: RELEASED });
  assert.equal(good.at, new Date(RELEASED).toISOString());
  const bad = reconciledAtFromEnv({ RECOVERY_EXTERNAL_RECONCILED_AT: '2026-02-30T00:00:00+09:00' });
  assert.equal(bad.raw, '2026-02-30T00:00:00+09:00');
  assert.equal(bad.at, null);
  // 다른 키로는 읽지 않는다.
  assert.equal(reconciledAtFromEnv({ RECOVERY_SECURITY_REAPPLIED_AT: RELEASED }).at, null);
});

test('스위치는 실제 반영 게이트와 글자 그대로 같게 읽는다 — true 만 ON', () => {
  for (const v of ['1', 'yes', 'TRUE', ' true', '']) {
    assert.equal(planApplyActive({ BILLING_APPLY_LIVE: v, PAYMENTS_LIVE: 'true' }), false, `느슨하게 읽었다: ${v}`);
    assert.equal(paymentsLive({ PAYMENTS_LIVE: v }), false);
  }
  assert.equal(planApplyActive({ BILLING_APPLY_LIVE: 'true', PAYMENTS_LIVE: 'true' }), true);
  // 반영 스위치 한쪽만 켜져 있으면 되돌아갈 반영이 없다.
  assert.equal(planApplyActive({ BILLING_APPLY_LIVE: 'true' }), false);
});

test('health 체크: 상태 전이와 required:false — 반영 OFF 가 평상시 not_applicable', () => {
  const live = { BILLING_APPLY_LIVE: 'true', PAYMENTS_LIVE: 'true' };

  const off = externalStateCheck({ env: {} });
  assert.equal(off.detail.state, 'not_applicable');
  assert.equal(off.ok, true);
  assert.equal(off.required, false);
  assert.match(String(off.detail.note), /결제가 없다는 뜻은 아니다/);

  assert.equal(externalStateCheck({ env: live }).detail.state, 'normal');
  assert.equal(externalStateCheck({ env: { ...live, RECOVERY_WRITE_FREEZE: 'true' } }).detail.state, 'pending');
  assert.equal(externalStateCheck({ env: { ...live, RECOVERY_WRITE_FREEZE: 'true' } }).ok, false);

  const recorded = externalStateCheck({
    env: { ...live, RECOVERY_WRITE_FREEZE: 'true', RECOVERY_EXTERNAL_RECONCILED_AT: RELEASED },
  });
  assert.equal(recorded.detail.state, 'recorded');
  assert.equal(recorded.ok, true);

  const stale = externalStateCheck({ env: { ...live, RECOVERY_EXTERNAL_RECONCILED_AT: RELEASED } });
  assert.equal(stale.detail.state, 'stale_record');
  assert.equal(stale.ok, false);

  // 반영이 OFF 여도 값이 남아 있으면 치우라고 말한다(다음 사건의 근거로 쓰인다).
  assert.equal(externalStateCheck({ env: { RECOVERY_EXTERNAL_RECONCILED_AT: RELEASED } }).detail.state, 'stale_record');

  const invalid = externalStateCheck({ env: { ...live, RECOVERY_EXTERNAL_RECONCILED_AT: '어제' } });
  assert.equal(invalid.detail.state, 'invalid_record');
  assert.equal(invalid.ok, false);

  for (const s of [off, recorded, stale, invalid]) {
    assert.equal(new Set(RECONCILE_STATES).has(s.detail.state as never), true);
  }
  assert.equal(externalReconcileStatus({}).state, 'not_applicable');
});

test('공개 응답·로그에 조직·금액·결제 식별자가 나가지 않는다', () => {
  const check = externalStateCheck({
    env: {
      BILLING_APPLY_LIVE: 'true',
      PAYMENTS_LIVE: 'true',
      PORTONE_API_SECRET: 'live-secret-9999',
      PORTONE_WEBHOOK_SECRET: 'whsec-abcdef',
      DATABASE_URL: 'postgres://u:p@ep-secret.neon.tech/db',
      RECOVERY_WRITE_FREEZE: 'true',
      RECOVERY_WRITE_FREEZE_AT: FROZE,
    },
  });
  const dump = JSON.stringify(check);
  for (const value of ['live-secret-9999', 'whsec-abcdef', 'ep-secret', 'postgres://']) {
    assert.equal(dump.includes(value), false, `공개 응답에 설정값이 나갔다: ${value}`);
  }
  assert.deepEqual(check.detail.limits, EXTERNAL_LIMITS);
  // 차단 시각은 참고용으로만 담고, 결제 웹훅이 예외가 아니라는 사실을 함께 낸다.
  assert.equal(check.detail.freezeAt, new Date(FROZE).toISOString());
  assert.equal(check.detail.webhookExempt, false);

  const plan = reconcilePlanFor({ restorePoint: RP, releasedAt: RELEASED, freezeAt: FROZE, now: NOW });
  const line = externalLogLine(plan);
  assert.match(line, /^\[externalReconcile\] window=ok /);
  assert.equal(/org|plan=|원|KRW/.test(line), false, `로그에 업무 값이 들어갔다: ${line}`);
  const text = reconcileText(plan);
  assert.match(text, /양방향/);
  assert.match(text, new RegExp(EXTERNAL_RECONCILED_ENV));
});

/* ─────────────────────────── 배선·원문 점검 ─────────────────────────── */

test('레지스트리·임시 키 등록 — 복구 시 조용히 유실되지 않고 평상시 유실로도 보고되지 않는다', () => {
  const v = ENV_VARS.find((e) => e.key === EXTERNAL_RECONCILED_ENV);
  assert.ok(v, `${EXTERNAL_RECONCILED_ENV} 가 레지스트리에 없다`);
  assert.ok(v!.note.trim().length > 0);
  assert.equal(TRANSIENT_KEYS.includes(EXTERNAL_RECONCILED_ENV), true, '평상시 미설정이 유실로 보고된다');
});

test('실제 health 라우트 배선 — 판정만 하고 버리는 꼴도 잡는다', () => {
  assert.deepEqual(auditHealthWiring(read('src', 'app', 'api', 'health', 'route.ts')), []);
  assert.deepEqual(auditHealthWiring(''), [
    'externalReconcile 을 import 하지 않는다',
    'externalStateCheck() 를 호출하지 않는다',
  ]);
  const dropped = `import { externalStateCheck } from '@/lib/externalReconcile';\nexternalStateCheck();`;
  assert.deepEqual(auditHealthWiring(dropped), [
    '판정 결과를 checks.externalState 로 내보내지 않는다 — 판정만 하고 버린다',
  ]);
});

test('실제 결제 웹훅 라우트의 모양 — 반영 경로가 바뀌면 §3-9 표를 함께 고치게 한다', () => {
  assert.deepEqual(auditWebhookRoute(read('src', 'app', 'api', 'billing', 'webhook', 'route.ts')), []);
  const problems = auditWebhookRoute('export async function POST() { return new Response("ok"); }');
  assert.equal(problems.length, 3, `모양 변경을 놓쳤다: ${problems.join(' / ')}`);
  assert.ok(problems.some((p) => p.includes(APPLIED_PLAN_COLUMN)));
});

test('결제 웹훅은 차단 예외에 **없어야** 한다 — 열면 대조할 흔적조차 사라진다', () => {
  assert.deepEqual(auditWebhookNotExempt(), []);
  assert.equal(
    FREEZE_EXEMPT.some((e) => e.path === BILLING_WEBHOOK_PATH),
    false,
    '결제 웹훅이 차단 예외 목록에 들어갔다',
  );
  // 4단계가 organizations 를 행 수로만 보는 전제도 함께 고정한다.
  assert.deepEqual(auditPlanColumnBlindSpot(), []);
});

test('실제 RUNBOOK 배선 — 6-2단계·7단계 선행 조건·§3-9 가 사라지면 실패한다', () => {
  const md = read('RUNBOOK.md');
  assert.deepEqual(auditRunbookExternal(md), []);

  // 7단계가 6-2 완료를 선행 조건으로 걸지 않으면(해제 뒤 대조는 늦다) 잡아낸다.
  const loosened = md.replace('**6-2단계 대조를 마친 뒤에만**', '');
  assert.notEqual(loosened, md, '7단계 문구를 찾지 못했다 — 가드를 함께 볼 것');
  assert.ok(
    auditRunbookExternal(loosened).some((p) => /7단계/.test(p)),
    '7단계 선행 조건 회귀를 놓쳤다',
  );

  // §3-9 절이 사라지면 산출 명령·근거가 모두 없어진다.
  const without = md.replace(/^### 3-9\./m, '### 3-9x.');
  assert.ok(auditRunbookExternal(without).some((p) => /3-9/.test(p)));
  assert.ok(auditRunbookExternal('').length > 0);
});
