// 절차가 **만들어 낸 사본**의 처분 테스트(RUNBOOK §3-17·§3-5). 2026-10-28
//
// 이 파일이 지키는 것은 하나다 — **되돌릴 수 없는 일은 둘이 아니라 셋이었다.**
//  (1) §3-5 는 DB 밖으로 사본을 내보내라고 지시하는데(행위자 이름·전 테넌트 메일 주소)
//      그 사본의 **처분을 지시하는 단계가 없었다** — 사본은 저장소·DB·env 밖이라
//      무기한 남아도 응답이 하나도 달라지지 않는다
//  (2) 기한의 **유일한 기준점**을 8단계 4번이 지우라고 지시한다(§3-14 때문에 옳다) —
//      그래서 기한은 표지가 **아직 있는 동안**에만 산출할 수 있다
//  (3) 리허설마다 한 벌씩 쌓이는데 체크리스트의 「리허설 브랜치 정리」에는 사본이 없다
//  (4) 그러면서도 `state`·`ok` 어휘를 바꾸지 않고 새 체크·새 표지를 만들지 않는다
//      (폐기는 보관소에서 일어나는 일이라 코드가 확인할 수 없다)
//  (5) 임의 보관기간을 만들지 않는다 — 미설정은 `unjudged`(판정 보류)이고 통과가 아니다
// 더해서 실제 배선·정본·`/api/health` 라우트·RUNBOOK 원문을 대조해 문서와 코드가 함께 낡지 않게 한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  ACTION_DISPOSAL_CARRIED, ACTION_DISPOSAL_DUE, ACTION_DISPOSAL_INVALID_RECORD,
  ACTION_DISPOSAL_INVALID_RETENTION, ACTION_DISPOSAL_NONE, ACTION_DISPOSAL_SCHEDULED,
  ACTION_DISPOSAL_UNJUDGED, CAVEAT_DISPOSAL_BASIS_EPHEMERAL, CAVEAT_DISPOSAL_EXISTENCE_UNKNOWN,
  CAVEAT_DISPOSAL_NOT_VERIFIED, DISPOSAL_BLIND_SPOTS, DISPOSAL_LIMITS, DISPOSAL_RUNBOOK_REF,
  DISPOSAL_VERDICTS, EXPORTED_COPIES, RETENTION_ENV, assessDisposal, auditClosureWiring,
  auditDisposalCanon, auditNoNewHealthCheck, auditNotAMarker, auditRegistryCoverage,
  auditRunbookDisposal, disposalDeadline, disposalLine, disposalStatus, disposalText,
  publicDisposal, retentionFromEnv,
} from '../src/lib/evidenceDisposal.ts';
import { PRESERVED_AT_ENV } from '../src/lib/evidencePreservation.ts';
import { closureCheck } from '../src/lib/incidentClosure.ts';
import { ANCHOR_ENV } from '../src/lib/incidentTimeline.ts';
import { INCIDENT_MARKERS } from '../src/lib/healthDisclosure.ts';
import { TRANSIENT_KEYS } from '../src/lib/envPresence.ts';
import { ENV_VARS } from '../src/lib/envRegistry.ts';
import { PROCEDURE_UNITS } from '../src/lib/rehearsalCoverage.ts';
import { parseChecklistBoxes, unitItemLoad } from '../src/lib/rehearsalChecklist.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (...rel: string[]) => fs.readFileSync(path.join(ROOT, ...rel), 'utf8');
const RUNBOOK = read('RUNBOOK.md');
const MODULE_SRC = read('src', 'lib', 'evidenceDisposal.ts');
const CLOSURE_SRC = read('src', 'lib', 'incidentClosure.ts');
const ROUTE_SRC = read('src', 'app', 'api', 'health', 'route.ts');

/** 한 사건의 정상 순서 — 2단계 차단 → §3-5 보존 */
const T_FREEZE = '2026-10-28T02:10:00+09:00';
const T_PRESERVE = '2026-10-28T02:25:00+09:00';
/** 지난 복구(몇 달 전)가 남긴 값 */
const T_OLD = '2026-06-02T11:00:00+09:00';
const TODAY = '2026-10-28';

const FROZEN: Record<string, string | undefined> = {
  RECOVERY_WRITE_FREEZE: 'true',
  [ANCHOR_ENV]: T_FREEZE,
  [PRESERVED_AT_ENV]: T_PRESERVE,
};

/* ─────────────────────────────── 정본 ─────────────────────────────── */

test('정본: 사본 셋이 사유와 함께 적혀 있고 모양 점검을 통과한다', () => {
  assert.deepEqual(auditDisposalCanon(), []);
  assert.equal(EXPORTED_COPIES.length, 3, '절차가 만들어 내는 사본 수가 바뀌었다 — §3-5·§3-17 을 함께 볼 것');
  assert.ok(EXPORTED_COPIES.some((c) => c.madeBy.includes('/api/audit')));
  assert.ok(EXPORTED_COPIES.some((c) => c.madeBy.includes('security-events')));
  assert.ok(EXPORTED_COPIES.some((c) => c.madeBy.includes('ROSTER_SNAPSHOT_SQL')));
  // ⬅ 이 장치의 전제 둘: 내보낸 사본은 **회수할 수 없고**, 서비스 DB 의 삭제가 **닿지 않는다**
  for (const c of EXPORTED_COPIES) {
    assert.equal(c.recallable, false, `${c.artifact} 가 회수 가능하다고 선언됐다`);
    assert.equal(c.erasureReaches, false, `${c.artifact} 에 삭제가 닿는다고 선언됐다`);
    assert.equal(c.personalData, true, `${c.artifact} 에 개인정보가 없다고 선언됐다`);
  }
  // 리허설에서도 만들어진다는 사실이 적혀 있어야 「주기마다 한 벌씩 는다」를 말할 수 있다
  assert.ok(EXPORTED_COPIES.every((c) => c.madeInRehearsal));
  assert.equal(DISPOSAL_BLIND_SPOTS.length, 5);
  assert.deepEqual(
    DISPOSAL_BLIND_SPOTS.map((s) => s.key),
    ['copy_invisible', 'marker_cleared', 'rehearsal_accrual', 'erasure_gap', 'processor_undisclosed'],
  );
});

test('정본 모양 점검이 회수 가능·삭제 도달·개인정보 없음 선언을 잡는다', () => {
  const base = EXPORTED_COPIES[0];
  const bad = auditDisposalCanon(
    [{ ...base, recallable: true as unknown as false, erasureReaches: true, personalData: false, madeBy: ' ', contains: '' }],
    [{ key: 'x', what: '', why: '' }],
  );
  assert.ok(bad.length >= 5, bad.join('\n'));
  assert.ok(bad.some((p) => /되돌릴 수 있다/.test(p)));
  assert.ok(bad.some((p) => /삭제가 닿는다/.test(p)));
  assert.ok(bad.some((p) => /개인정보가 든 사본이 하나도 없다/.test(p)));
  assert.deepEqual(auditDisposalCanon([], []), [
    '사본 정본이 비었다 — 절차가 무엇을 만들어 내는지 적을 자리가 사라졌다',
    '개인정보가 든 사본이 하나도 없다고 선언돼 있다 — §3-5 3번의 명단이 빠졌는지 볼 것',
    '사각지대 정본이 비었다',
  ]);
});

/* ─────────────────────────── 기한 로더 ─────────────────────────── */

test('보관 기한은 env 만 인정하고 임의 기본값을 만들지 않는다', () => {
  assert.deepEqual(retentionFromEnv({}), { raw: null, days: null });
  assert.deepEqual(retentionFromEnv({ [RETENTION_ENV]: '  ' }), { raw: null, days: null });
  assert.deepEqual(retentionFromEnv({ [RETENTION_ENV]: ' 90 ' }), { raw: '90', days: 90 });
  // 판독 불가·0 이하·소수는 「기한 없음」이 아니라 **판독 실패**로 둔다
  for (const raw of ['0', '-1', '90.5', '90일', 'ninety', '1e3']) {
    assert.deepEqual(retentionFromEnv({ [RETENTION_ENV]: raw }), { raw, days: null }, raw);
  }
});

test('폐기 기한은 기준점 날짜 + 일수이고, 둘 중 하나가 없으면 산출하지 않는다', () => {
  assert.deepEqual(disposalDeadline(T_PRESERVE, 90, TODAY), { dueDate: '2027-01-26', overdueDays: null });
  assert.deepEqual(disposalDeadline(T_PRESERVE, null, TODAY), { dueDate: null, overdueDays: null });
  assert.deepEqual(disposalDeadline('', 90, TODAY), { dueDate: null, overdueDays: null });
  assert.deepEqual(disposalDeadline('2026-02-30T00:00:00Z', 90, TODAY), { dueDate: null, overdueDays: null });
  // 오늘을 읽을 수 없으면 기한은 내고 경과는 말하지 않는다 — 수치를 지어내지 않는다
  assert.deepEqual(disposalDeadline(T_PRESERVE, 90, 'later'), { dueDate: '2027-01-26', overdueDays: null });
  // 경과 일수
  assert.deepEqual(disposalDeadline(T_OLD, 30, TODAY), { dueDate: '2026-07-02', overdueDays: 118 });
  // 기한 당일은 아직 넘기지 않았다
  assert.deepEqual(disposalDeadline('2026-10-18T00:00:00Z', 10, TODAY), { dueDate: '2026-10-28', overdueDays: null });
});

/* ─────────────────────────── 판정 ─────────────────────────── */

test('평상시에는 사본의 존재를 말하지 않는다 — 상시 떠 있는 할 일을 만들지 않는다', () => {
  const a = assessDisposal({ env: {}, asOf: TODAY });
  assert.equal(a.verdict, 'not_applicable');
  assert.equal(a.actionable, false, '평상시 할 일로 올리면 정작 사본이 있는 국면의 할 일을 덮는다');
  assert.equal(a.action, ACTION_DISPOSAL_NONE);
  assert.deepEqual([a.basisAt, a.dueDate, a.overdueDays, a.retentionDays], [null, null, null, null]);
  // 기한만 설정돼 있어도 기준점이 없으면 판정이 올라가지 않는다
  assert.equal(assessDisposal({ env: { [RETENTION_ENV]: '90' }, asOf: TODAY }).verdict, 'not_applicable');
});

test('기한을 정해 두지 않으면 `unjudged` 로 남긴다 — 임의 보관기간을 쓰지 않는다', () => {
  const a = assessDisposal({ env: FROZEN, asOf: TODAY });
  assert.equal(a.verdict, 'unjudged');
  assert.equal(a.action, ACTION_DISPOSAL_UNJUDGED);
  assert.equal(a.actionable, true, '판정 보류는 통과가 아니다 — 할 일로 남아야 한다');
  assert.equal(a.dueDate, null, '기한 없이 날짜를 지어냈다');
  // 모듈 어디에도 기본 보관기간 리터럴이 없다(§3-6·§2-1 과 같은 규율)
  assert.ok(!/(^|[^\w])(?:30|60|90|365)\s*(?:일|days)/.test(MODULE_SRC), '기본 보관기간 리터럴이 들어왔다');
});

test('기한이 있으면 산출하고, 기준점이 지워지기 전에 옮겨 적으라고 말한다', () => {
  const a = assessDisposal({ env: { ...FROZEN, [RETENTION_ENV]: '90' }, asOf: TODAY });
  assert.equal(a.verdict, 'scheduled');
  assert.equal(a.dueDate, '2027-01-26');
  assert.equal(a.overdueDays, null);
  assert.equal(a.retentionDays, 90);
  assert.equal(a.basisCorroborated, true);
  assert.equal(a.action, ACTION_DISPOSAL_SCHEDULED);
  assert.ok(/영구|§6 표 비고|지금/.test(a.action));
  assert.equal(a.actionable, false, '기한을 산출한 상태를 상시 할 일로 올리면 `due` 가 묻힌다');
  assert.deepEqual([a.copies, a.personalDataCopies], [3, 3]);
});

test('기한이 지나면 `due` + 경과 일수 — 폐기 대상을 이름으로 말한다', () => {
  const a = assessDisposal({ env: { ...FROZEN, [RETENTION_ENV]: '1' }, asOf: '2026-11-30' });
  assert.equal(a.verdict, 'due');
  assert.equal(a.overdueDays, 32);
  assert.equal(a.action, ACTION_DISPOSAL_DUE);
  assert.ok(/명단/.test(a.action), '무엇을 폐기해야 하는지 적혀 있지 않다');
  assert.equal(a.actionable, true);
});

test('판정 순서: 못 읽는 값·지난 사건의 기준점이 기한 판정보다 먼저다', () => {
  // (가) 기준점 판독 불가 — 기한이 있어도 산출하지 않는다
  const invalidRecord = assessDisposal({
    env: { ...FROZEN, [PRESERVED_AT_ENV]: '2026-13-40', [RETENTION_ENV]: '90' },
    asOf: TODAY,
  });
  assert.equal(invalidRecord.verdict, 'invalid_record');
  assert.equal(invalidRecord.action, ACTION_DISPOSAL_INVALID_RECORD);

  // (나) 기한 값 판독 불가 — `unjudged`(= 「정하면 된다」)로 덮이면 사라진 정책을 알아챌 수 없다
  const invalidRetention = assessDisposal({ env: { ...FROZEN, [RETENTION_ENV]: '90일' }, asOf: TODAY });
  assert.equal(invalidRetention.verdict, 'invalid_retention');
  assert.equal(invalidRetention.action, ACTION_DISPOSAL_INVALID_RETENTION);

  // (다) 지난 사건의 표지 — 그 값으로 산출한 기한은 **이번 사본**의 것이 아니다.
  //     순서를 바꾸면 이번 사본이 폐기 대상으로 보고되고(기준점조차 없다) 지난 사본은 남는다.
  const carried = assessDisposal({
    env: { ...FROZEN, [PRESERVED_AT_ENV]: T_OLD, [RETENTION_ENV]: '30' },
    asOf: TODAY,
  });
  assert.equal(carried.verdict, 'carried_basis');
  assert.equal(carried.action, ACTION_DISPOSAL_CARRIED);
  assert.equal(carried.basisCorroborated, false);
  assert.equal(carried.dueDate, null, '지난 사건 기준으로 산출한 날짜를 이번 사본의 기한으로 내보냈다');
});

test('판정 어휘가 문서 표와 같고 전건에 할 일이 있다', () => {
  assert.equal(DISPOSAL_VERDICTS.length, 7);
  const seen = new Set(
    [
      assessDisposal({ env: {}, asOf: TODAY }),
      assessDisposal({ env: FROZEN, asOf: TODAY }),
      assessDisposal({ env: { ...FROZEN, [RETENTION_ENV]: '90' }, asOf: TODAY }),
      assessDisposal({ env: { ...FROZEN, [RETENTION_ENV]: '1' }, asOf: '2026-11-30' }),
      assessDisposal({ env: { ...FROZEN, [RETENTION_ENV]: 'x' }, asOf: TODAY }),
      assessDisposal({ env: { ...FROZEN, [PRESERVED_AT_ENV]: 'nope' }, asOf: TODAY }),
      assessDisposal({ env: { ...FROZEN, [PRESERVED_AT_ENV]: T_OLD }, asOf: TODAY }),
    ].map((a) => {
      assert.ok(a.action.length > 30, `${a.verdict} 의 할 일이 비었다`);
      assert.ok(a.note.length > 10, `${a.verdict} 의 설명이 비었다`);
      assert.equal(a.caveats, DISPOSAL_LIMITS);
      return a.verdict;
    }),
  );
  assert.deepEqual([...seen].sort(), [...DISPOSAL_VERDICTS].sort(), '판정 하나가 어떤 입력으로도 나오지 않는다');
});

test('기본 asOf 는 호출 시각이고 `preservation` 을 받아 두 번 계산하지 않는다', () => {
  // 기준점이 미래면 기한도 미래다 — 오늘을 넘기지 않았다
  const future = assessDisposal({
    env: { ...FROZEN, [PRESERVED_AT_ENV]: '2099-01-01T00:00:00Z', [ANCHOR_ENV]: '2099-01-01T00:00:00Z', [RETENTION_ENV]: '1' },
  });
  assert.equal(future.verdict, 'scheduled');
  assert.equal(future.overdueDays, null);
  // Date 로 넘긴 asOf 도 같은 판정
  assert.equal(
    assessDisposal({ env: { ...FROZEN, [RETENTION_ENV]: '1' }, asOf: new Date('2026-11-30T00:00:00Z') }).verdict,
    'due',
  );
});

/* ─────────────────────────── 출력 ─────────────────────────── */

test('출력: 로그·공개 응답에 **날짜가 없고** 기한은 1줄 명령에만 나온다', () => {
  const a = assessDisposal({ env: { ...FROZEN, [RETENTION_ENV]: '1' }, asOf: '2026-11-30' });
  const line = disposalLine(a);
  assert.match(line, /^\[disposal\] disposal=due retention=1 copies=3 overdueDays=32$/);
  for (const out of [line, JSON.stringify(publicDisposal(a))]) {
    assert.ok(!out.includes('2026-10-28'), `기준점 날짜가 ${out} 에 들어갔다`);
    assert.ok(!out.includes('2026-10-29'), '폐기 기한 날짜가 공개 응답에 들어갔다');
    assert.ok(!/\d{4}-\d{2}-\d{2}/.test(out), `날짜가 노출됐다: ${out}`);
  }
  assert.deepEqual(publicDisposal(a), {
    verdict: 'due', retentionConfigured: true, overdueDays: 32, copies: 3, runbook: DISPOSAL_RUNBOOK_REF,
  });
  assert.equal(publicDisposal(assessDisposal({ env: FROZEN, asOf: TODAY })).retentionConfigured, false);

  // 사람이 읽는 요약에는 기한이 나오고 한계가 함께 실린다
  const text = disposalText(a);
  assert.ok(text.includes('2026-10-29'), '1줄 명령이 폐기 기한을 말하지 않는다');
  assert.ok(text.includes('32일'));
  for (const c of [CAVEAT_DISPOSAL_NOT_VERIFIED, CAVEAT_DISPOSAL_EXISTENCE_UNKNOWN, CAVEAT_DISPOSAL_BASIS_EPHEMERAL]) {
    assert.ok(text.includes(c), '한계를 판정과 함께 내보내지 않았다');
  }
  assert.ok(disposalText(assessDisposal({ env: {}, asOf: TODAY })).includes('(미설정)'));
});

test('상태 요약', () => {
  const s = disposalStatus({ ...FROZEN, [RETENTION_ENV]: '90' }, TODAY);
  assert.deepEqual(
    [s.verdict, s.retentionKey, s.copies, s.blindSpots, s.limits],
    ['scheduled', RETENTION_ENV, 3, 5, DISPOSAL_LIMITS.length],
  );
  assert.equal(s.action, ACTION_DISPOSAL_SCHEDULED);
  assert.equal(disposalStatus({}).verdict, 'not_applicable');
});

/* ─────────────────────── 배선(실제 소스) ─────────────────────── */

test('incidentClosure: `state`·`ok` 어휘는 그대로이고 처분 판정만 더해진다', () => {
  const scheduled = closureCheck({ env: { ...FROZEN, [RETENTION_ENV]: '90' } });
  assert.deepEqual([scheduled.detail.state, scheduled.ok, scheduled.required], ['recorded', true, false]);
  assert.equal(scheduled.detail.disposalVerdict, 'scheduled');
  assert.equal(scheduled.detail.disposalRetentionConfigured, true);
  assert.equal(scheduled.detail.disposalOverdueDays, null);
  assert.equal(scheduled.detail.disposalCopies, 3);

  // 기한 미설정이 평상시 운용이다 — 그래도 `ok` 를 끌어내리지 않고 할 일만 같은 칸에서 말한다
  const unjudged = closureCheck({ env: FROZEN });
  assert.deepEqual([unjudged.detail.state, unjudged.ok], ['recorded', true]);
  assert.equal(unjudged.detail.disposalVerdict, 'unjudged');
  assert.equal(unjudged.detail.disposalRetentionConfigured, false);
  assert.ok(String(unjudged.detail.note).includes(RETENTION_ENV), '같은 칸에서 할 일을 말하지 않으면 응답에만 남는다');

  // 평상시에는 한 글자도 더 달라지지 않는다
  const normal = closureCheck({ env: {} });
  assert.deepEqual([normal.detail.state, normal.detail.disposalVerdict], ['normal', 'not_applicable']);
  assert.ok(!String(normal.detail.note).includes(RETENTION_ENV));

  // **기한 날짜는 detail 에 담지 않는다**(무인증 응답이 보존 시각을 되돌려 말해 준다 — §2-3)
  assert.ok(!JSON.stringify(scheduled.detail).includes('2027-01-26'));
  assert.equal(scheduled.detail.disposalDueDate, undefined);
});

test('[실제 소스] 판정을 응답에 실어 보내고 새 체크를 만들지 않는다', () => {
  assert.deepEqual(auditClosureWiring(CLOSURE_SRC), []);
  assert.deepEqual(auditNoNewHealthCheck(ROUTE_SRC), []);

  // 판정만 하고 버리는 꼴·기한 날짜 노출을 잡는다
  assert.ok(auditClosureWiring('').length >= 4);
  assert.ok(
    auditClosureWiring(`${CLOSURE_SRC}\n disposalDueDate: 1,`).some((p) => /날짜/.test(p)),
    '기한 날짜를 detail 에 담아도 통과한다',
  );
  assert.ok(
    auditNoNewHealthCheck("import { x } from '@/lib/evidenceDisposal';\nchecks.evidenceDisposal = x();").length === 2,
  );
});

test('[실제 정본] 기한 키는 사건 표지도 임시 키도 아니고 레지스트리에 있다', () => {
  assert.deepEqual(auditNotAMarker(INCIDENT_MARKERS, TRANSIENT_KEYS), []);
  assert.deepEqual(auditRegistryCoverage(ENV_VARS), []);
  // 표지·임시 키로 등록되면 사건마다 기한 판정이 보류로 돌아간다
  assert.equal(auditNotAMarker([{ key: RETENTION_ENV, kind: 'record' }], ['x']).length, 1);
  assert.equal(auditNotAMarker([{ key: 'A' }], [RETENTION_ENV]).length, 1);
  assert.equal(auditNotAMarker([], []).length, 2, '목록을 읽을 수 없으면 「없다」로 단정하지 않는다');
  assert.equal(auditRegistryCoverage([]).length, 1);

  // 레지스트리 설명에 「사건 표지가 아니다」가 남아 있어야 8단계 4번에서 지우지 않는다
  const def = ENV_VARS.find((v) => v.key === RETENTION_ENV);
  assert.ok(def && def.kind === 'config' && /사건 표지가 아니다/.test(def.note));

  // 키를 **리터럴로** 읽어야 `scanEnvReads` 가 잡는다 — 상수 경유로 바꾸면 레지스트리·§4 에서
  // 빠져도 CI 가 조용히 통과하고, 그 상태가 바로 「복구에서 조용히 유실되는」 설정값이다
  assert.ok(MODULE_SRC.includes(`env.${RETENTION_ENV}`), '기한 키를 상수 경유로 읽는다 — 소스 스캔에서 빠진다');
});

/* ─────────────────────── 문서(실제 RUNBOOK) ─────────────────────── */

test('[실제 RUNBOOK] §3-17 과 그것을 가리키는 단계가 함께 남아 있다', () => {
  assert.deepEqual(auditRunbookDisposal(RUNBOOK), []);
  assert.ok(auditRunbookDisposal('').length > 0);

  // 8단계 4번이 이 절로 유도하지 않으면 기준점이 지워진 뒤 기한을 되찾을 수 없다
  const no8 = RUNBOOK.replace(/3-17/g, '3-99');
  assert.ok(auditRunbookDisposal(no8).some((p) => /8단계/.test(p)), '8단계 유도 누락을 잡지 못한다');
  // §3-5(사본을 만드는 자리)에 처분 지시가 사라지는 경우
  const sec35 = RUNBOOK.match(/^###\s*3-5\.[\s\S]*?(?=^###\s*3-6\.)/m)![0];
  const stripped = RUNBOOK.replace(sec35, sec35.replace(/3-17/g, '3-5'));
  assert.ok(auditRunbookDisposal(stripped).some((p) => /3-5 가/.test(p)));
});

test('[실제 RUNBOOK] §3-17 이 절차 단위로 등록되고 체크리스트가 인용한다', () => {
  const unit = PROCEDURE_UNITS.find((u) => u.key === '3-17');
  assert.ok(unit, '절차 단위에 3-17 이 없다 — 범위 기록이 가리킬 곳이 없다');
  assert.equal(unit!.cited, true);
  assert.equal(unit!.since, '2026-10-28');
  assert.ok(/사본/.test(unit!.skipped), '거른 결과 설명이 사본을 가리키지 않는다');

  const boxes = parseChecklistBoxes(RUNBOOK);
  assert.ok(boxes, '체크리스트를 찾지 못했다');
  const load = unitItemLoad(boxes!).find((u) => u.unit === '3-17');
  assert.ok(load && load.items.length >= 2, '§3-17 을 인용하는 체크리스트 항목이 2개 미만이다');
  // §6-9: 저장소 파일의 칸은 **비어 있어야** 한다 — 체크가 남으면 다음 수행이 물려받는다
  assert.equal(load!.checked, 0, '§3-17 체크리스트 항목이 체크된 채 커밋됐다');
});

test('[실제 RUNBOOK] 사본 셋과 사각지대가 문서에 모두 적혀 있다', () => {
  const at = RUNBOOK.search(/^###\s*3-17\./m);
  const section = RUNBOOK.slice(at, RUNBOOK.indexOf('\n## ', at));
  for (const c of EXPORTED_COPIES) {
    assert.ok(section.includes(c.artifact), `§3-17 표에 ${c.artifact} 행이 없다`);
  }
  for (const s of DISPOSAL_BLIND_SPOTS) assert.ok(section.includes(s.key), `사각지대 ${s.key} 가 §3-17 에 없다`);
  // 「새 체크·새 표지를 만들지 않았다」는 약속이 문서에 남아 있어야 다음 배치가 되돌리지 않는다
  assert.ok(/새 체크도 새 표지도 만들지 않았다/.test(section));
  // §4-7 에 기한 키가 문서화돼 있다(envRegistry 문서 대조가 이 자리를 본다)
  assert.ok(RUNBOOK.includes(RETENTION_ENV));
});
