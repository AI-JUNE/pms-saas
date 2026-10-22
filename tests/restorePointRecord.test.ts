/**
 * restorePointRecord.test.ts — 「무엇으로 복구했는가」의 영구 기록(RUNBOOK §6·§6-7). 2026-10-22
 *
 * ── 왜 필요한가 ──────────────────────────────────────────────────────────────
 * §6-4 기록 정본은 두 칸을 `judgedBy: null` 로 남겨 두었다 — `복구 대상 시점` 과 `비고`.
 * 그 둘은 하필 **유실 구간의 두 끝**이 사는 자리인데, 구간의 두 끝을 담는 env
 * (`RECOVERY_RESTORE_POINT`·`RECOVERY_WRITE_FREEZE_AT`)는 **임시 키**이고 §3 7·8단계는 그것을
 * 지우라고 지시한다. 그래서 (가) 사건이 끝나는 순간 §1 RPO 를 실측으로 견줄 근거가 영구히
 * 사라지고(RTO 쪽은 2026-10-20 에 표의 `소요시간` 을 읽는 판정이 생겼다), (나) 표 칸은 파싱조차
 * 되지 않아 판독 불가·타임존 없는 값·행 일자보다 뒤인 값이 모두 「기록됨」으로 보였고,
 * (다) 같은 순간을 적는 두 칸(표 시점 ↔ 비고 구간 시작)과 고지 발신 시각을 대조한 적이 없었다.
 *
 * 그래서 (a) 판독의 엄격함(타임존·왕복·분 불일치), (b) 판정 순서와 「값을 지어내지 않는다」 규율,
 * (c) RPO 실측의 자격(연습 제외·§6-5 게이트), (d) 배선(health 응답·관측 정본·§6-4 기록 정본·
 * §1-2 대조·§3-7 표 초안 칸 수·§6-7 문서·체크리스트)을 파일 수준에서 고정한다.
 * 이 테스트는 **파일만 읽는다** — 네트워크·DB 를 쓰지 않고 `process.env` 도 바꾸지 않는다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  RECORD_DRIFTS,
  RECORD_LIMITS,
  RECORD_MISREADS,
  RECORD_RUNBOOK_REF,
  RECORD_VERDICTS,
  REMARK_COLUMN,
  TARGET_COLUMN,
  WINDOW_HOMES,
  WITHHELD_NO_ROW,
  WITHHELD_NO_WINDOW,
  WITHHELD_REHEARSAL,
  assessRecord,
  auditDraftRow,
  auditHealthWiring,
  auditLedgerHomes,
  auditObjectivesWiring,
  auditRunbookRecord,
  auditWindowHomes,
  homeFor,
  parseRecordedInstant,
  parseRemarkWindow,
  publicRecord,
  recordLogLine,
  recordText,
  recordedLossMinutes,
  restorePointRecordCheck,
  restorePointRecordStatus,
  restorePrecedents,
} from '../src/lib/restorePointRecord.ts';
import { LEDGER_FIELDS, TABLE_COLUMNS, parseLedgerTable, type LedgerRow } from '../src/lib/rehearsalLedger.ts';
import { PROCEDURE_UNITS } from '../src/lib/rehearsalCoverage.ts';
import { CHECK_OBSERVATIONS, parseVocabulary } from '../src/lib/rehearsalObservation.ts';
import { incidentRecordDraft, lossWindowStatus } from '../src/lib/incidentClosure.ts';
import { noticeFromEnv, recordRemark } from '../src/lib/lossNotice.ts';
import { rehearsalAttainment } from '../src/lib/recoveryObjectives.ts';
import { TRANSIENT_KEYS } from '../src/lib/envPresence.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (...p: string[]) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const RUNBOOK = read('RUNBOOK.md');

const NOW = new Date('2026-10-10T12:00:00Z');
const RP = '2026-10-09T12:55:00+09:00'; // 실제 적용한 복구 시점
const FROZE = '2026-10-09T13:40:00+09:00'; // 차단 실효 = 구간의 끝(45분 뒤)
const RP_ISO = '2026-10-09T03:55:00.000Z';
const END_ISO = '2026-10-09T04:40:00.000Z';

function rowOf(over: Partial<LedgerRow> = {}): LedgerRow {
  return {
    row: 1,
    date: '2026-10-09',
    kind: 'incident',
    target: RP_ISO,
    durationMin: 95,
    result: 'pass',
    owner: '운영담당',
    note: `유실 구간 ${RP_ISO} ~ ${END_ISO}(45분) · 고지 2026-10-09T05:10:00.000Z`,
    scope: '',
    unpassed: '',
    ...over,
  };
}

/* ───────────────────────────── 정본 ───────────────────────────── */

test('WINDOW_HOMES: 구간의 두 끝이 **지워지는 쪽과 영구 쪽**을 함께 적는다', () => {
  assert.equal(WINDOW_HOMES.length, 2);
  assert.deepEqual(
    WINDOW_HOMES.map((h) => h.end),
    ['start', 'end'],
  );
  assert.equal(homeFor('start')?.durableCell, TARGET_COLUMN);
  assert.equal(homeFor('end')?.durableCell, REMARK_COLUMN);
  assert.equal(homeFor('어딘가'), null, '모르는 끝에 집을 지어냈다');
  for (const h of WINDOW_HOMES) {
    assert.ok(h.transientEnv.startsWith('RECOVERY_'), '임시 키 이름이 아니다');
    assert.ok(h.cleared.trim() && h.judgedBy.trim() && h.madeBy.trim(), `${h.end} 설명이 비었다`);
    assert.match(h.judgedBy, /restorePointRecord/, '읽는 판정이 이 모듈을 가리키지 않는다');
  }
});

test('auditWindowHomes: 두 끝이 **임시 키**라는 전제를 실제 목록과 대조한다', () => {
  assert.deepEqual(auditWindowHomes(TRANSIENT_KEYS), [], auditWindowHomes(TRANSIENT_KEYS).join(' / '));
  const problems = auditWindowHomes(['RECOVERY_WRITE_FREEZE_AT']);
  assert.ok(
    problems.some((p) => p.includes('RECOVERY_RESTORE_POINT')),
    '임시 키 목록에서 빠진 끝을 그냥 통과시켰다 — 이 절의 전제가 바뀐 것이다',
  );
});

test('RECORD_MISREADS: 이 칸을 읽지 않으면 **거짓이 되는 판정**을 적어 둔다', () => {
  assert.ok(RECORD_MISREADS.length >= 4);
  const judgements = RECORD_MISREADS.map((m) => m.judgement).join(' ');
  assert.match(judgements, /attainment\.rpo/, 'RPO 대조가 거짓 보류가 되는 사실이 빠졌다');
  assert.match(judgements, /canClearMarkers/, '표지 삭제 게이트가 이 칸을 보지 않는 사실이 빠졌다');
  for (const m of RECORD_MISREADS) assert.ok(m.says.trim() && m.why.trim(), `${m.judgement} 설명이 비었다`);
});

/* ───────────────────────────── 판독 ───────────────────────────── */

test('parseRecordedInstant: 미기재·판독 불가·타임존 없음을 **구분한다**', () => {
  assert.deepEqual(parseRecordedInstant('  '), { raw: '', recorded: false, at: null, zoneless: false });

  const ok = parseRecordedInstant(RP);
  assert.deepEqual([ok.recorded, ok.at, ok.zoneless], [true, RP_ISO, false]);

  // 값이 있는데 못 읽는 것은 「기록 없음」이 아니다.
  const bad = parseRecordedInstant('어제 밤');
  assert.deepEqual([bad.recorded, bad.at, bad.zoneless], [true, null, false]);
  assert.equal(parseRecordedInstant('2026-10-09 22:00 KST').at, null, '어휘 밖 표기를 읽어 주었다');

  // 타임존이 없으면 UTC 로 읽혀 한국시간 기준 9시간 이른 시점이 된다(§3-6 의 그 함정).
  const zoneless = parseRecordedInstant('2026-10-09T12:55:00');
  assert.deepEqual([zoneless.at, zoneless.zoneless], ['2026-10-09T12:55:00.000Z', true]);
  assert.equal(parseRecordedInstant('2026-10-09').zoneless, true, '날짜만 적은 칸도 00:00Z 로 읽힌다');
  assert.equal(parseRecordedInstant('2026-02-30T00:00:00Z').at, null, '비실존 날짜를 받아 주었다');
});

test('parseRemarkWindow: §3-10 문구를 되읽고 **분 불일치는 채택하지 않는다**', () => {
  const w = parseRemarkWindow(`유실 구간 ${RP_ISO} ~ ${END_ISO}(45분) · 고지 2026-10-09T05:10:00.000Z`);
  assert.deepEqual([w.found, w.startsAt, w.endsAt, w.minutes], [true, RP_ISO, END_ISO, 45]);
  assert.equal(w.noticedAt, '2026-10-09T05:10:00.000Z');
  assert.deepEqual(w.invalid, []);

  // 자유 메모에서 숫자를 주워 오지 않는다.
  const memo = parseRemarkWindow('로그인 확인까지 정상, 45분 정도 걸렸다');
  assert.deepEqual([memo.found, memo.minutes], [false, null]);

  // 「미확정」은 구간이 아니라 **미확정 사실**의 기록이다.
  const undetermined = parseRemarkWindow('유실 구간 미확정(end_unrecorded) · 고지 [확인 필요] — [확인 필요]');
  assert.deepEqual([undetermined.found, undetermined.undetermined, undetermined.minutes], [true, true, null]);
  assert.equal(undetermined.noticedAt, null, 'placeholder 를 고지 시각으로 읽었다');
  assert.deepEqual(undetermined.invalid, [], 'placeholder 는 어긋남이 아니다');

  // 손으로 고친 흔적 — 어느 쪽도 고르지 않는다.
  const edited = parseRemarkWindow(`유실 구간 ${RP_ISO} ~ ${END_ISO}(20분)`);
  assert.equal(edited.minutes, null);
  assert.ok(edited.invalid.some((i) => i.includes('다르다')));

  const reversed = parseRemarkWindow(`유실 구간 ${END_ISO} ~ ${RP_ISO}(45분)`);
  assert.equal(reversed.minutes, null);
  assert.ok(reversed.invalid.some((i) => i.includes('앞이다')));

  // 「구간을 말하고 있는데 못 읽는다」와 「아예 없다」는 다르다 — 수치만 채택하지 않는다.
  const unreadable = parseRemarkWindow('유실 구간 어제 ~ 오늘(45분)');
  assert.deepEqual([unreadable.found, unreadable.minutes], [true, null]);
  assert.deepEqual(unreadable.invalid, ['구간 시작 판독 불가', '구간 끝 판독 불가']);
});

test('[실제 함수] §3-7·§3-10 이 만든 비고 문구가 **그대로 되읽힌다**(왕복)', () => {
  const notice = noticeFromEnv(
    {
      RECOVERY_RESTORE_POINT: RP,
      RECOVERY_WRITE_FREEZE_AT: FROZE,
      RECOVERY_LOSS_NOTICE_AT: '2026-10-09T14:10:00+09:00',
      RECOVERY_WRITE_FREEZE: 'true',
    },
    NOW,
  );
  const roundtrip = parseRemarkWindow(recordRemark(notice));
  assert.deepEqual(
    [roundtrip.startsAt, roundtrip.endsAt, roundtrip.minutes],
    [notice.window.startsAt, notice.window.endsAt, notice.window.minutes],
    'recordRemark() 문구가 파서와 어긋났다 — 기록은 적혀 있는데 판정만 사라지는 회귀다',
  );
  assert.equal(roundtrip.noticedAt, notice.noticedAt);

  const draft = incidentRecordDraft({
    date: '2026-10-09', kind: '사건', restorePoint: RP, frozenAt: FROZE,
    startedAt: '2026-10-09T12:30:00+09:00', endedAt: '2026-10-09T14:05:00+09:00', now: NOW,
  });
  const fromDraft = parseRemarkWindow(draft.row);
  const loss = lossWindowStatus({ restorePoint: RP, frozenAt: FROZE, now: NOW });
  assert.deepEqual([fromDraft.startsAt, fromDraft.endsAt, fromDraft.minutes], [loss.startsAt, loss.endsAt, loss.minutes]);
});

test('[실제 함수] §6 표 초안의 칸 수가 표의 열 수와 같다 ⬅ 뒤쪽 신설 열이 조용히 비던 자리', () => {
  const draft = incidentRecordDraft({
    date: '2026-10-09', kind: '사건', restorePoint: RP, frozenAt: FROZE,
    startedAt: '2026-10-09T12:30:00+09:00', endedAt: '2026-10-09T14:05:00+09:00', now: NOW,
  });
  assert.deepEqual(auditDraftRow(draft.row), [], auditDraftRow(draft.row).join(' / '));
  assert.ok(draft.missing.includes('범위'), '범위는 사람 몫인데 요구하지 않았다');
  assert.ok(!/정상/.test(draft.row), '검증 결과를 자동으로 적었다');

  // 칸이 모자란 초안(2026-10-22 이전 모양)은 잡는다.
  const old = `| 2026-10-09 | 사건 | ${RP_ISO} | 95분 | - | - | 유실 구간 … |`;
  assert.ok(auditDraftRow(old).some((p) => p.includes('빈 칸')));
  assert.ok(auditDraftRow('표가 아니다').length > 0);
});

/* ───────────────────────────── 판정 ───────────────────────────── */

test('assessRecord: 두 칸이 서로 맞으면 ok 이고 그때만 durable 이다', () => {
  const a = assessRecord({ row: rowOf(), env: {}, now: NOW });
  assert.equal(a.verdict, 'ok');
  assert.equal(a.basis, 'table');
  assert.equal(a.durable, true);
  assert.equal(a.lossMinutes, 45, '사건 행의 구간이 RPO 실측으로 나오지 않았다');
  assert.equal(a.withheld, null);
  assert.ok(RECORD_VERDICTS.includes(a.verdict));
});

test('assessRecord: 판독 불가 → 타임존 → 일자 모순 → 어긋남 → 미기재 순서다', () => {
  assert.equal(assessRecord({ row: rowOf({ target: '어제 밤' }), now: NOW }).verdict, 'unreadable_target');
  assert.equal(
    assessRecord({ row: rowOf({ target: '2026-10-09T12:55:00' }), now: NOW }).verdict,
    'zoneless_target',
    '타임존 없는 값을 통과시켰다 — 9시간 어긋난 시점이 기록으로 남는다',
  );
  assert.equal(
    assessRecord({ row: rowOf({ date: '2026-10-09', target: '2026-10-11T01:00:00Z' }), now: NOW }).verdict,
    'target_after_date',
    '복구 시점이 행 일자보다 뒤인 기록을 통과시켰다',
  );
  assert.equal(
    assessRecord({ row: rowOf({ target: '2026-10-09T03:00:00.000Z' }), now: NOW }).verdict,
    'window_disagrees',
    '같은 순간을 적는 두 칸이 다른데 통과시켰다',
  );
  assert.equal(
    assessRecord({ row: rowOf({ note: '로그인 확인 정상' }), now: NOW }).verdict,
    'window_unrecorded',
    '사건 행인데 구간이 없다',
  );
  assert.equal(
    assessRecord({ row: rowOf({ note: `유실 구간 ${RP_ISO} ~ ${END_ISO}(45분)` }), now: NOW }).verdict,
    'notice_unrecorded',
    '고지 발신 시각의 영구 기록이 없는데 ok 가 났다',
  );
});

test('assessRecord: **연습 행에는 구간을 요구하지 않는다**(§6-6 과 같은 규율)', () => {
  const regular = assessRecord({ row: rowOf({ kind: 'periodic', note: '메모' }), now: NOW });
  assert.equal(regular.verdict, 'ok', '연습 행에 사건의 의무를 물었다');
  assert.equal(regular.lossMinutes, null);
  assert.equal(regular.withheld, WITHHELD_REHEARSAL);

  const unread = assessRecord({ row: rowOf({ kind: 'unknown', note: '메모' }), now: NOW });
  assert.equal(unread.lossMinutes, null, '유형을 모르는데 실측 자격을 주었다');
  assert.match(unread.withheld ?? '', /지어내지 않는다|모른다/);
});

test('assessRecord: 표지만 남은 상태를 **아직 옮겨 적을 수 있는 동안** 드러낸다', () => {
  const live = assessRecord({ env: { RECOVERY_RESTORE_POINT: RP, RECOVERY_WRITE_FREEZE_AT: FROZE }, now: NOW });
  assert.equal(live.verdict, 'ephemeral_only');
  assert.equal(live.basis, 'env', '표를 보지 않았다는 사실을 적지 않았다');
  assert.equal(live.durable, false);
  assert.equal(live.lossMinutes, null);
  assert.equal(live.withheld, WITHHELD_NO_ROW);
  assert.match(live.action, /옮겨 적는다/);

  // 표에 아직 안 적힌 행 + 표지 → 미기재 쪽을 먼저 말한다.
  const partial = assessRecord({ row: rowOf({ target: '', note: '' }), env: { RECOVERY_RESTORE_POINT: RP }, now: NOW });
  assert.equal(partial.verdict, 'ephemeral_only');

  // 값이 있는데 못 읽는 표지는 키 이름만 남긴다(값은 담지 않는다).
  const broken = assessRecord({ env: { RECOVERY_RESTORE_POINT: '어제' }, now: NOW });
  assert.deepEqual(broken.markers.unreadable, ['RECOVERY_RESTORE_POINT']);

  // 평상시(표지 없음)는 판정 보류이고 degraded 가 아니다.
  const normal = assessRecord({ env: {}, now: NOW });
  assert.deepEqual([normal.verdict, normal.basis], ['no_record', 'none']);
});

test('recordedLossMinutes: 영구 기록에서만 RPO 실측을 꺼내고 이유를 함께 돌려준다', () => {
  assert.deepEqual(recordedLossMinutes(null), { minutes: null, withheld: WITHHELD_NO_ROW });
  assert.deepEqual(recordedLossMinutes(rowOf()), { minutes: 45, withheld: null });
  assert.deepEqual(recordedLossMinutes(rowOf({ note: '메모' })), { minutes: null, withheld: WITHHELD_NO_WINDOW });
  assert.equal(recordedLossMinutes(rowOf({ kind: 'periodic' })).withheld, WITHHELD_REHEARSAL);
});

test('restorePrecedents: 되감은 거리를 **일 단위로만** 말한다(ε 를 만들지 않는다)', () => {
  const rows = [
    rowOf({ row: 1, date: '2026-09-01', kind: 'periodic', target: '2026-08-30T00:00:00Z' }),
    rowOf({ row: 2, date: '2026-10-09', target: '2026-10-09 22:00 KST' }),
    rowOf({ row: 3, date: '2026-10-10', target: '' }),
  ];
  const p = restorePrecedents(rows);
  assert.equal(p.length, 2, '미기재 행을 전례로 세었다');
  assert.deepEqual([p[0].daysBefore, p[0].kind], [2, 'regular']);
  assert.deepEqual([p[1].at, p[1].daysBefore], [null, null], '판독 못 한 시점으로 거리를 지어냈다');
  assert.ok(RECORD_LIMITS.some((l) => l.includes('ε')), 'ε 를 산출하지 못한다는 한계가 빠졌다');
});

/* ───────────────────────────── 출력·응답 ───────────────────────────── */

test('restorePointRecordCheck: 평상시는 ok, 표지가 남아 있으면 degraded 다(503 은 아니다)', () => {
  const normal = restorePointRecordCheck({ env: {}, now: NOW });
  assert.deepEqual([normal.ok, normal.required], [true, false]);
  assert.equal(normal.detail.verdict, 'no_record');
  assert.equal(normal.detail.runbook, RECORD_RUNBOOK_REF);
  assert.deepEqual(normal.detail.limits, RECORD_LIMITS);

  const live = restorePointRecordCheck({ env: { RECOVERY_RESTORE_POINT: RP }, now: NOW });
  assert.equal(live.ok, false, '표지만 남은 상태를 드러내지 않았다');
  assert.equal(live.required, false, '복구 판정이 서비스를 내리면 복구 자신이 막힌다');
});

test('응답·로그에 **시각·분 값을 담지 않는다**(무인증 응답이라 구간을 역산할 수 있다)', () => {
  const a = assessRecord({ row: rowOf(), env: { RECOVERY_RESTORE_POINT: RP }, now: NOW });
  const dump = JSON.stringify(publicRecord(a)) + recordLogLine(a);
  for (const leak of [RP_ISO, END_ISO, '45분', '45', RP, '운영담당']) {
    assert.ok(!dump.includes(leak), `공개 응답·로그에 ${leak} 이 들어갔다`);
  }
  const pub = publicRecord(a) as Record<string, unknown>;
  assert.deepEqual(
    [pub.targetRecorded, pub.targetReadable, pub.windowRecorded, pub.noticeRecorded],
    [true, true, true, true],
  );

  // 사람용 요약·명령에는 수치를 적는다(로그·응답과 다른 경로다).
  assert.match(recordText(a), /45분/);
  const status = restorePointRecordStatus({ RECOVERY_RESTORE_POINT: RP }, NOW);
  assert.equal(status.verdict, 'ephemeral_only');
  assert.match(status.line, /verdict=ephemeral_only/);
});

/* ─────────────────────── 배선(실제 소스·문서) ─────────────────────── */

test('[실제 소스] §6-4 기록 정본이 두 칸을 **읽는 판정으로** 선언한다', () => {
  assert.deepEqual(auditLedgerHomes(LEDGER_FIELDS), [], auditLedgerHomes(LEDGER_FIELDS).join(' / '));
  const reverted = LEDGER_FIELDS.map((f) => (f.key === 'target' ? { ...f, judgedBy: null } : f));
  assert.ok(
    auditLedgerHomes(reverted).some((p) => p.includes('judgedBy: null')),
    'judgedBy 가 null 로 되돌아갔는데 아무 말도 하지 않는다',
  );
  const renamed = LEDGER_FIELDS.map((f) => (f.key === 'note' ? { ...f, judgedBy: 'lib/다른곳.ts' } : f));
  assert.ok(auditLedgerHomes(renamed).some((p) => p.includes('§6-7')));
});

test('[실제 소스] §1-2 가 **영구 기록**에서 RPO 실측을 읽는다', () => {
  const src = read('src', 'lib', 'recoveryObjectives.ts');
  assert.deepEqual(auditObjectivesWiring(src), [], auditObjectivesWiring(src).join(' / '));
  assert.ok(auditObjectivesWiring('const x = 1').length >= 2, '배선이 사라져도 통과한다');

  const header = `| ${TABLE_COLUMNS.join(' | ')} |\n| ${TABLE_COLUMNS.map(() => '---').join(' | ')} |`;
  const row = (kind: string, note: string) =>
    `| 2026-10-09 | ${kind} | ${RP_ISO} | 95분 | 정상 | 운영담당 | ${note} |  |  |`;
  const noticed = `유실 구간 ${RP_ISO} ~ ${END_ISO}(45분) · 고지 2026-10-09T05:10:00.000Z`;
  const env = { RECOVERY_RTO_MINUTES: '240', RECOVERY_RPO_MINUTES: '30' };

  const incident = rehearsalAttainment({ markdown: `${header}\n${row('사건', noticed)}`, env });
  assert.equal(incident.rpo.attainment, 'exceeded', '표에 적힌 구간을 약속과 견주지 않았다');
  assert.equal(incident.rpo.overBy, 15);
  assert.equal(incident.rpoWithheld, null);

  // 연습 행의 구간은 약속의 실측이 아니다(§6-6).
  const regular = rehearsalAttainment({ markdown: `${header}\n${row('정기', noticed)}`, env });
  assert.equal(regular.rpo.attainment, 'unjudged');
  assert.equal(regular.rpoWithheld, WITHHELD_REHEARSAL);

  // 끝까지 가지 않은 기록(§6-5 자격 없음)의 구간도 쓰지 않는다.
  const partial = `| 2026-10-09 | 사건 | ${RP_ISO} | 95분 | 부분 통과 | 운영담당 | ${noticed} |  |  |`;
  const unpassed = rehearsalAttainment({ markdown: `${header}\n${partial}`, env });
  assert.equal(unpassed.rpo.attainment, 'unjudged');
  assert.ok((unpassed.rpoWithheld ?? '').length > 0);
});

test('[실제 소스] /api/health 가 이 판정을 **관측보다 앞에** 싣는다', () => {
  const route = read('src', 'app', 'api', 'health', 'route.ts');
  assert.deepEqual(auditHealthWiring(route), [], auditHealthWiring(route).join(' / '));

  assert.ok(auditHealthWiring('import x from "y"').length >= 3);
  const judgedAndDropped = route.replace('checks.restorePointRecord = restorePointRecordCheck(', 'restorePointRecordCheck(');
  assert.ok(
    auditHealthWiring(judgedAndDropped).some((p) => p.includes('판정만 하고 버리는')),
    '판정만 하고 버리는 배선을 통과시켰다',
  );
  // 관측 뒤로 밀리면 그 관측에서 조용히 빠진다(§6-3).
  const moved = route
    .replace(/\n  checks\.restorePointRecord = restorePointRecordCheck\(\);\n/, '\n')
    .replace(
      'const body = buildHealthBody(',
      'checks.restorePointRecord = restorePointRecordCheck();\n\n  const body = buildHealthBody(',
    );
  assert.ok(auditHealthWiring(moved).some((p) => p.includes('뒤에 실린다')));
});

test('[실제 소스] 관측 정본·절차 단위에 등록돼 있고 어휘가 정본에서 읽힌다', () => {
  const obs = CHECK_OBSERVATIONS.find((o) => o.check === 'restorePointRecord');
  assert.ok(obs, '관측 정본(§6-3)에 등록되지 않았다 — 리허설이 이 장치를 보지 않는다');
  assert.deepEqual([obs?.role, obs?.field, obs?.cited], ['observe', 'verdict', true]);
  assert.deepEqual([...(obs?.degradedWhen ?? [])].sort(), ['incident', 'rehearsal']);
  assert.deepEqual(
    parseVocabulary(read('src', 'lib', 'restorePointRecord.ts'), 'RECORD_VERDICTS'),
    [...RECORD_VERDICTS],
    '어휘 정본을 §6-3 이 읽을 수 없다',
  );

  const unit = PROCEDURE_UNITS.find((u) => u.key === '6-7');
  assert.ok(unit, '절차 단위(§6-2)에 등록되지 않았다 — 리허설 범위에서 빠진다');
  assert.ok(unit?.cited, '체크리스트가 이 소절을 번호로 인용하지 않는다');
});

test('[실제 문서] RUNBOOK 6-7 과 표 머리말·체크리스트가 이 판정을 적고 있다', () => {
  assert.deepEqual(auditRunbookRecord(RUNBOOK), [], auditRunbookRecord(RUNBOOK).join(' / '));
  assert.ok(auditRunbookRecord('# 다른 문서').length > 0);

  // 표 머리말이 기재 규칙(타임존)을 적어 둔다 — 적지 않으면 zoneless 가 계속 들어온다.
  const head = RUNBOOK.slice(RUNBOOK.indexOf('## 6. 복구 리허설 기록'), RUNBOOK.search(/^###\s*기한 추적/m));
  assert.match(head, /타임존/);
  assert.match(head, /6-7/);

  // 표 자체는 자동으로 채우지 않는다(§6 의 약속은 그대로다).
  assert.match(RUNBOOK, /자동화 에이전트는 이 표를 임의로 채우지 않는다/);
  const rows = parseLedgerTable(RUNBOOK).rows;
  assert.deepEqual(rows, [], '표가 자동으로 채워졌다');

  for (const d of RECORD_DRIFTS) assert.ok(d.what.trim() && d.why.trim(), `${d.key} 설명이 비었다`);
});
