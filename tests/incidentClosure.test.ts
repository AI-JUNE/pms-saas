/**
 * incidentClosure.test.ts — RUNBOOK §3 8단계(사후)의 유실 구간 확정·기록. 2026-10-10
 *
 * ── 왜 필요한가 ──────────────────────────────────────────────────────────────
 * §3 말미는 「손실 구간을 반드시 이해관계자에게 고지한다 — **2단계 차단을 언제 걸었는지가 그
 * 구간의 끝이다**」라고 적어 두었는데,
 *  (1) 그 「언제」가 어디에도 기록되지 않았다(차단은 불리언 하나, `/api/health` 는 현재 상태만
 *      말하고, **7단계는 그 스위치를 지우라고 지시한다**). 해제 뒤에는 차단이 걸려 있었다는
 *      사실조차 응답에 남지 않으므로 고지 구간을 사람 기억으로 적게 된다.
 *  (2) 손에 든 유일한 수치(§3-6 `lossMinutes`)는 **산출한 순간까지**라 고지 수치가 아니다 —
 *      절차가 지시하는 대로 1단계에서 산출하면 조사·보존·승인에 쓴 시간이 빠져 실제보다 작다.
 *  (3) §6 표의 「소요시간」은 읽는 코드(`recovery.parseDurationMin`)만 있고 만드는 코드가 없었다.
 *
 * 그래서 (a) 판정 자체(끝이 없으면 **수치를 지어내지 않는다**)와 (b) 배선(health 응답·RUNBOOK
 * 문장)을 파일 수준에서 고정한다. 이 테스트는 **파일만 읽는다** — 네트워크·DB 를 쓰지 않고
 * `process.env` 도 바꾸지 않는다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  ACTION_LOSS_END_UNRECORDED,
  CAVEAT_END_IS_EFFECTIVE_TIME,
  CAVEAT_END_IS_SWITCH,
  CAVEAT_NOT_THE_PLAN_NUMBER,
  CAVEAT_WINDOW_IS_TIME_ONLY,
  CLOSURE_LIMITS,
  CLOSURE_STATES,
  FREEZE_AT_ENV,
  LOSS_VERDICTS,
  UNKNOWN_CELL,
  assessDuration,
  assessLossWindow,
  auditHealthWiring,
  auditRunbookClosure,
  closureCheck,
  closureLogLine,
  closureText,
  freezeAtFromEnv,
  incidentClosureStatus,
  incidentRecordDraft,
  lossWindowStatus,
} from '../src/lib/incidentClosure.ts';
import { parseInstant } from '../src/lib/incidentEvidence.ts';
import { ENV_VARS } from '../src/lib/envRegistry.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (...p: string[]) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

const NOW = new Date('2026-10-09T14:00:00+09:00');
const RP = '2026-10-09T12:55:00+09:00'; // 복구 시점 T-ε
const FROZE = '2026-10-09T13:40:00+09:00'; // 차단 실효 = 구간의 끝(45분 뒤)

test('유실 구간: 끝(차단 실효 시각)이 있을 때만 확정한다', () => {
  const w = assessLossWindow({ restorePoint: RP, frozenAt: FROZE, now: NOW });
  assert.equal(w.verdict, 'ok');
  assert.equal(w.startsAt, '2026-10-09T03:55:00.000Z');
  assert.equal(w.endsAt, '2026-10-09T04:40:00.000Z');
  assert.equal(w.endKind, 'freeze');
  assert.equal(w.minutes, 45);
  assert.equal(w.hours, 1);
  assert.match(w.notice, /유실 구간: .*45분/);
  // 고지 문구는 구간의 끝이 무엇인지 말한다(그 뒤의 저장은 애초에 받지 않았다).
  assert.match(w.notice, /쓰기 차단 실효/);
  assert.ok(LOSS_VERDICTS.includes(w.verdict));
});

test('끝이 기록되지 않으면 구간을 추정하지 않는다 ⬅ 고지 수치를 지어내지 않는다', () => {
  const w = assessLossWindow({ restorePoint: RP, now: NOW });
  assert.equal(w.verdict, 'end_unrecorded');
  assert.equal(w.minutes, null, '구간을 수치로 내지 않는다');
  assert.equal(w.hours, null);
  assert.equal(w.endsAt, null);
  assert.equal(w.endKind, null);
  // 참고용 경과시간은 **따로** 둔다 — 확정치와 섞지 않는다.
  assert.equal(w.elapsedMinutes, 65);
  assert.equal(w.action, ACTION_LOSS_END_UNRECORDED);
  assert.match(w.notice, /확정하지 못했습니다/);
  assert.ok(!/\d+분\)/.test(w.notice), '미확정인데 구간 수치가 문구에 들어 있다');
  // 빈 문자열·공백도 「미기록」이다(공백을 시각으로 읽지 않는다).
  assert.equal(assessLossWindow({ restorePoint: RP, frozenAt: '  ', now: NOW }).verdict, 'end_unrecorded');
});

test('판독 불가·순서 역전·미래는 각각 다른 판정으로 멈춘다', () => {
  assert.equal(assessLossWindow({ restorePoint: '어제', frozenAt: FROZE, now: NOW }).verdict, 'invalid_restore_point');
  assert.equal(assessLossWindow({ restorePoint: RP, frozenAt: '13:40', now: NOW }).verdict, 'invalid_end');

  // 끝이 시작보다 앞 — 음수를 0 으로 깎아 「유실 없음」으로 만들지 않는다.
  const rev = assessLossWindow({ restorePoint: FROZE, frozenAt: RP, now: NOW });
  assert.equal(rev.verdict, 'end_before_restore');
  assert.equal(rev.minutes, null);
  assert.match(rev.action, /0 으로 바꿔/);

  const fut = assessLossWindow({ restorePoint: RP, frozenAt: '2026-10-09T23:00:00+09:00', now: NOW });
  assert.equal(fut.verdict, 'future_end');
  assert.equal(fut.minutes, null);
});

test('차단을 걸지 않았으면 전환 시각을 끝으로 쓰고, 그 사실을 함께 말한다', () => {
  const w = assessLossWindow({ restorePoint: RP, switchedAt: FROZE, now: NOW });
  assert.equal(w.verdict, 'ok');
  assert.equal(w.endKind, 'switch');
  assert.equal(w.minutes, 45);
  assert.ok(w.caveats.includes(CAVEAT_END_IS_SWITCH));
  assert.match(w.notice, /운영 DB 전환/);
  // 차단 시각이 있으면 그쪽이 정본이다.
  assert.equal(assessLossWindow({ restorePoint: RP, frozenAt: FROZE, switchedAt: '2026-10-09T13:50:00+09:00', now: NOW }).endKind, 'freeze');
});

test('고지 문구에 §3-6 수치를 쓰지 말라는 경고가 항상 붙는다', () => {
  for (const w of [
    assessLossWindow({ restorePoint: RP, frozenAt: FROZE, now: NOW }),
    assessLossWindow({ restorePoint: RP, now: NOW }),
    assessLossWindow({ restorePoint: 'x', now: NOW }),
  ]) {
    assert.ok(w.caveats.includes(CAVEAT_NOT_THE_PLAN_NUMBER), 'lossMinutes 경고가 빠졌다');
    assert.ok(w.caveats.includes(CAVEAT_WINDOW_IS_TIME_ONLY), '구간은 시간만 말한다는 경고가 빠졌다');
    assert.ok(w.caveats.includes(CAVEAT_END_IS_EFFECTIVE_TIME), '저장 시각 ≠ 실효 시각 경고가 빠졌다');
  }
});

test('구간을 확정했다 ≠ 이만큼만 유실됐다 ⬅ 사각지대를 함께 내보낸다', () => {
  const st = lossWindowStatus({ restorePoint: RP, frozenAt: FROZE, now: NOW });
  assert.equal(st.verdict, 'ok');
  assert.equal(st.limits, CLOSURE_LIMITS);
  assert.ok(st.limits.length >= 5);
  assert.ok(st.freezeLimits.length > 0, '차단이 막지 못한 경로를 함께 보내지 않는다');
  assert.match(st.runbook, /8단계/);
  assert.ok(st.limits.some((l) => /건수/.test(l)), '구간이 건수를 말하지 않는다는 한계가 없다');
  assert.ok(st.limits.some((l) => /RPO/.test(l)), 'RPO 약속이 아니라는 한계가 없다');

  const text = closureText(st);
  assert.match(text, /\[ok\]/);
  assert.ok(text.split('\n').length > 5, '사람이 읽을 요약에 한계·할 일이 함께 나온다');
  // 로그 한 줄에는 시각·판정만 — 담당자·행 내용이 섞이지 않는다.
  assert.equal(
    closureLogLine(assessLossWindow({ restorePoint: RP, frozenAt: FROZE, now: NOW })),
    '[closure] loss=ok start=2026-10-09T03:55:00.000Z end=2026-10-09T04:40:00.000Z endKind=freeze min=45',
  );
  assert.match(closureLogLine(assessLossWindow({ restorePoint: RP, now: NOW })), /loss=end_unrecorded .*end=\?$/);
});

test('소요시간: 1단계 중단 결정 ~ 7단계 차단 해제. 못 읽으면 계산하지 않는다', () => {
  const d = assessDuration({ startedAt: '2026-10-09T12:30:00+09:00', endedAt: '2026-10-09T14:05:00+09:00' });
  assert.equal(d.verdict, 'ok');
  assert.equal(d.minutes, 95);
  assert.equal(d.cell, '95분');

  assert.equal(assessDuration({ startedAt: null, endedAt: FROZE }).verdict, 'invalid_start');
  assert.equal(assessDuration({ startedAt: FROZE, endedAt: '' }).verdict, 'invalid_end');
  for (const bad of [
    assessDuration({ startedAt: null, endedAt: FROZE }),
    assessDuration({ startedAt: FROZE, endedAt: '' }),
    assessDuration({ startedAt: FROZE, endedAt: RP }),
  ]) {
    assert.equal(bad.minutes, null, '판독 불가·역전에 수치를 적지 않는다');
    assert.equal(bad.cell, UNKNOWN_CELL, '표 칸을 추측으로 채우지 않는다');
  }
  assert.equal(assessDuration({ startedAt: FROZE, endedAt: RP }).verdict, 'negative');
});

test('§6 표 초안: 검증 결과·담당은 자동으로 채우지 않는다', () => {
  const draft = incidentRecordDraft({
    date: '2026-10-09', kind: '사건', restorePoint: RP, frozenAt: FROZE,
    startedAt: '2026-10-09T12:30:00+09:00', endedAt: '2026-10-09T14:05:00+09:00', now: NOW,
  });
  assert.equal(
    draft.row,
    `| 2026-10-09 | 사건 | 2026-10-09T03:55:00.000Z | 95분 | ${UNKNOWN_CELL} | ${UNKNOWN_CELL} | 유실 구간 2026-10-09T03:55:00.000Z ~ 2026-10-09T04:40:00.000Z(45분, 고지 완료 여부 확인) |`,
  );
  assert.deepEqual(draft.missing, ['검증 결과', '담당']);
  assert.match(draft.note, /자동화는 §6 표를 채우지 않는다/);
  // 「정상」을 자동으로 적으면 리허설 신선도 판정이 거짓 ok 가 된다.
  assert.ok(!/정상/.test(draft.row), '검증 결과를 자동으로 적었다');

  const thin = incidentRecordDraft({ date: 'x', kind: '월간', restorePoint: 'x', now: NOW });
  assert.ok(thin.missing.includes('일자') && thin.missing.includes('유형(정기/사건)'));
  assert.ok(thin.missing.includes('복구 대상 시점') && thin.missing.includes('소요시간'));
  assert.ok(thin.missing.includes('비고(유실 구간)'));
  assert.ok(thin.row.startsWith(`| ${UNKNOWN_CELL} | ${UNKNOWN_CELL} |`));
  // 비실존 날짜를 「일자」로 받지 않는다.
  assert.ok(incidentRecordDraft({ date: '2026-02-30', now: NOW }).missing.includes('일자'));
});

test('env 로더: 설정값만 인정하고 기본값을 만들지 않는다', () => {
  assert.deepEqual(freezeAtFromEnv({}), { raw: null, at: null });
  assert.deepEqual(freezeAtFromEnv({ RECOVERY_WRITE_FREEZE_AT: FROZE }), {
    raw: FROZE, at: '2026-10-09T04:40:00.000Z',
  });
  // 못 읽는 값을 「기록됨」으로 올리지 않는다.
  assert.deepEqual(freezeAtFromEnv({ RECOVERY_WRITE_FREEZE_AT: '어제 밤' }), { raw: '어제 밤', at: null });
});

test('/api/health 체크: 차단 중 미기록을 **기록할 수 있는 동안** 드러낸다', () => {
  const normal = closureCheck({ env: {} });
  assert.equal(normal.ok, true);
  assert.equal(normal.required, false, 'required:false — 어느 경우에도 503 이 되지 않는다');
  assert.equal(normal.detail.state, 'normal');

  const unrecorded = closureCheck({ env: { RECOVERY_WRITE_FREEZE: 'true' } });
  assert.equal(unrecorded.detail.state, 'frozen_unrecorded');
  assert.equal(unrecorded.ok, false, '차단 중 미기록이 degraded 로 드러나지 않는다');
  assert.match(String(unrecorded.detail.note), /지금/);

  const recorded = closureCheck({ env: { RECOVERY_WRITE_FREEZE: 'true', RECOVERY_WRITE_FREEZE_AT: FROZE } });
  assert.equal(recorded.detail.state, 'recorded');
  assert.equal(recorded.ok, true);
  assert.equal(recorded.detail.frozenAt, '2026-10-09T04:40:00.000Z');

  // 해제 후 값이 남아 있으면 **다음 사건의 구간 끝**이 된다 — 드러내서 지우게 한다.
  const stale = closureCheck({ env: { RECOVERY_WRITE_FREEZE_AT: FROZE } });
  assert.equal(stale.detail.state, 'stale_record');
  assert.equal(stale.ok, false);
  assert.match(String(stale.detail.note), /다음 사건/);

  const invalid = closureCheck({ env: { RECOVERY_WRITE_FREEZE: 'true', RECOVERY_WRITE_FREEZE_AT: 'x' } });
  assert.equal(invalid.detail.state, 'invalid_record');
  assert.equal(invalid.ok, false);

  // 스위치는 'true' 문자열만 ON(writeFreeze 와 같은 규율).
  assert.equal(closureCheck({ env: { RECOVERY_WRITE_FREEZE: '1' } }).detail.state, 'normal');

  // 공개 엔드포인트다 — 연결 문자열·행 수·담당자가 섞여 들어가지 않는다.
  const dump = JSON.stringify(recorded.detail);
  assert.ok(!/postgres:\/\/|neon\.tech|password|rows|담당/i.test(dump));
  for (const s of [normal, unrecorded, recorded, stale, invalid]) {
    assert.ok(CLOSURE_STATES.includes(s.detail.state as never));
  }
  assert.equal(incidentClosureStatus({}).state, 'normal');
  assert.equal(incidentClosureStatus({ RECOVERY_WRITE_FREEZE_AT: FROZE }).recordKey, FREEZE_AT_ENV);
});

test('모듈에 임의 구간 기본값이 숨어 있지 않다(DB·fs·next 미접근)', () => {
  const src = read('src', 'lib', 'incidentClosure.ts');
  assert.ok(!/(minutes|loss\w*|duration)\s*(\?\?|\|\|)\s*\d/i.test(src), '구간·소요시간 기본값 폴백이 있다');
  assert.ok(!/from\s+['"]@?\/?db|drizzle-orm|node:fs|next\//.test(src), 'DB·fs·next 를 가져온다');
  assert.ok(!/\b(insert|update|delete|create table|alter table)\b/i.test(src), '쓰기·DDL 이 섞여 있다');
});

test('배선: /api/health 가 유실 구간 확정 가능 여부를 응답에 실어 보낸다', () => {
  assert.deepEqual(auditHealthWiring(read('src', 'app', 'api', 'health', 'route.ts')), []);
  assert.ok(auditHealthWiring("import { closureCheck } from '@/lib/incidentClosure';").length > 0);
  assert.ok(
    auditHealthWiring("import { closureCheck } from '@/lib/incidentClosure';\nconst c = closureCheck();").length > 0,
    '판정만 하고 버리는 꼴을 걸러야 한다',
  );
  assert.deepEqual(
    auditHealthWiring("import { closureCheck } from '@/lib/incidentClosure';\nchecks.incidentClosure = closureCheck();"),
    [],
  );
});

test('배선: RUNBOOK 8단계·2단계가 되돌아가면 실패한다', () => {
  const runbook = read('RUNBOOK.md');
  assert.deepEqual(auditRunbookClosure(runbook), []);
  assert.ok(runbook.includes('### 3-7.'), '§3-7 절이 있다');
  assert.ok(runbook.includes('checks.incidentClosure'), '평상시 확인 수단이 적혀 있다');

  // 「health 확인하고 6절에 기록」 한 줄로 되돌아가면 실패한다.
  assert.ok(
    auditRunbookClosure('## 3. DB 복구 절차\n2. 쓰기 차단\n3. x\n8. **사후** — health 확인, 6절 기록.\n### 3-1.').length > 0,
  );
  assert.ok(auditRunbookClosure(runbook.replace(/### 3-7\./g, '### 3-7-removed.')).length > 0);
  assert.ok(auditRunbookClosure('').length > 0);
});

test('env 레지스트리·RUNBOOK §4 에 차단 시각 키가 등록돼 있다', () => {
  const def = ENV_VARS.find((v) => v.key === FREEZE_AT_ENV);
  assert.ok(def, '레지스트리에 등록되지 않았다 — 복구에서 조용히 유실된다');
  assert.equal(def.kind, 'config');
  assert.equal(def.group, '복구 리허설');
  assert.match(def.note, /유실 구간/);
  assert.ok(read('RUNBOOK.md').includes(`\`${FREEZE_AT_ENV}\``));
});

test('[실제 버그] 타임존이 붙은 새벽 시각을 「비실존 날짜」로 거절하지 않는다', () => {
  // KST 00:00~09:00 은 UTC 로 전날이다. 날짜 존재 판정을 UTC 변환 결과로 하면 RUNBOOK 이
  // 지시한 정상 입력(`+09:00`)이 invalid 로 떨어진다 — 야간 사건이 바로 그 구간이다.
  assert.equal(parseInstant('2026-10-09T03:05:00+09:00')?.toISOString(), '2026-10-08T18:05:00.000Z');
  const w = assessLossWindow({
    restorePoint: '2026-10-09T02:50:00+09:00',
    frozenAt: '2026-10-09T03:20:00+09:00',
    now: new Date('2026-10-09T04:00:00+09:00'),
  });
  assert.equal(w.verdict, 'ok');
  assert.equal(w.minutes, 30);
  // 비실존 날짜는 여전히 거절한다.
  for (const bad of ['2026-02-30', '2026-13-01', '2026-11-31T00:00:00+09:00']) {
    assert.equal(parseInstant(bad), null, String(bad));
  }
});
