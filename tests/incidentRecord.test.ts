// **사건 행이 있는지를 묻는 쪽이 없다**(RUNBOOK §6-10 · §3 8단계 3번 · §6 · §3-10 · §3-23). 2026-11-02
//
// 이 파일이 지키는 것은 셋이다.
//  (1) **침묵을 통과로 덮지 않는다** — §6 표에 사건 행이 한 줄도 없는 상태를 `not_applicable`
//      (「적을 것이 없다」)이나 `no_record`(「미실시」)로 넘기지 않는다. 8단계 4번이 인용하는
//      런타임 게이트는 **2번만** 보므로, 3번을 거른 채 표지를 지우는 길이 열려 있었다.
//  (2) **거짓 차단을 만들지 않는다** — 표지가 없는 평상시에는 표를 묻지 않고(`no_incident`),
//      귀속을 말할 수 없는 상태는 보류(`unanchored`·`no_table`·`boundary_only`)로 남긴다.
//      하루 경계는 임의로 봐주지 않는다.
//  (3) **fail-closed** — 런타임 판정(2번)을 넣지 않은 `clearGate` 는 통과시키지 않는다.
// 더해서 실제 `lib/lossNotice.ts`·`lib/remarkSlots.ts`·`lib/ledgerPurpose.ts`·헬스 라우트·
// 절차 단위 정본·이 모듈과 RUNBOOK 원문을 대조해 문서와 코드가 함께 낡지 않게 한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  ACTION_REC_NO_INCIDENT, ACTION_REC_UNRECORDED, CAVEAT_CLEARED_IS_SILENT, CAVEAT_DAY_BOUNDARY,
  CAVEAT_ROW_IS_A_CLAIM, INCIDENT_ROW_CELLS, RECORD_LIMITS, RECORD_MISREADS, RECORD_PURPOSE_VALUE,
  RECORD_RUNBOOK_REF, RECORD_STEP, RECORD_VERDICTS, STEP8_GATE_SIGHT,
  assessIncidentRecord, auditCellRegistry, auditClearGateBlindSpot, auditNoNewHealthCheck,
  auditPurposeRoleSource, auditRowReaderPrecondition, auditRunbookIncidentRecord, cellFor,
  clearGate, emptyCellsOf, incidentRecordLine, incidentRecordStatus, incidentRecordText,
  requiredColumns, unseenGateItems, type IncidentCellKey,
} from '../src/lib/incidentRecord.ts';
import { LEDGER_FIELDS, parseLedgerTable, type LedgerRow } from '../src/lib/rehearsalLedger.ts';
import { ANCHOR_ENV } from '../src/lib/incidentTimeline.ts';
import { assessNotice } from '../src/lib/lossNotice.ts';
import { assessRemarkSlots } from '../src/lib/remarkSlots.ts';
import { PROCEDURE_UNITS } from '../src/lib/rehearsalCoverage.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (...rel: string[]) => fs.readFileSync(path.join(ROOT, ...rel), 'utf8');
const RUNBOOK = read('RUNBOOK.md');
const SELF_SRC = read('src', 'lib', 'incidentRecord.ts');
const NOTICE_SRC = read('src', 'lib', 'lossNotice.ts');
const REMARK_SRC = read('src', 'lib', 'remarkSlots.ts');
const PURPOSE_SRC = read('src', 'lib', 'ledgerPurpose.ts');
const HEALTH_SRC = read('src', 'app', 'api', 'health', 'route.ts');

/** 사건 하루 — 차단 2026-10-30 12:30 (KST) → 앵커 날짜는 UTC 로 2026-10-30 */
const FROZE = '2026-10-30T12:30:00+09:00';
const MARKERS_OPEN = { [ANCHOR_ENV]: FROZE };
const MARKERS_CLEARED: Record<string, string | undefined> = {};

/** 필수 칸이 모두 찬 사건 행 */
function row(over: Partial<LedgerRow> = {}): LedgerRow {
  return {
    row: 1,
    date: '2026-10-30',
    kind: 'incident',
    kindRaw: RECORD_PURPOSE_VALUE,
    target: '2026-10-30T11:50:00+09:00',
    durationMin: 215,
    result: 'pass',
    owner: '운영 담당',
    note: '유실 구간 2026-10-30T11:50:00+09:00~2026-10-30T12:30:00+09:00',
    scope: '',
    unpassed: '',
    ...over,
  };
}

const rehearsal = (over: Partial<LedgerRow> = {}) =>
  row({ row: 2, kind: 'periodic', kindRaw: '정기', ...over });
const check = (over: Partial<LedgerRow> = {}) => row({ row: 3, kind: 'periodic', kindRaw: '점검', ...over });

/* ─────────────────────────────── 정본 ─────────────────────────────── */

test('정본: 8단계 4번의 게이트가 보는 넷 중 **둘은 보는 쪽이 없다** ⬅ 이 절이 생긴 이유', () => {
  assert.equal(STEP8_GATE_SIGHT.length, 4);
  const unseen = unseenGateItems();
  assert.equal(unseen.length, 2);
  assert.deepEqual(unseen.map((g) => g.key), ['ledger_row', 'row_cells']);
  // 보는 쪽이 없는 항목은 전부 3번이다 — 2번은 §3-10 이 이미 본다(중복 보고 금지)
  for (const g of unseen) assert.equal(g.item, '8단계 3번');
  for (const g of STEP8_GATE_SIGHT) {
    assert.ok(g.what.trim() && g.quiet.trim(), `${g.key} 에 설명이 없다`);
  }
  assert.equal(RECORD_STEP, '§3 8단계 3번');
});

test('정본: 행이 없을 때 거짓이 되는 판정 5건에 어느 판정이·무엇이라고·왜가 적혀 있다', () => {
  assert.equal(RECORD_MISREADS.length, 5);
  assert.deepEqual(RECORD_MISREADS.map((m) => m.key), [
    'nothing_to_write', 'gate_opens_without_row', 'incident_looks_like_never',
    'promise_measured_by_practice', 'silence_after_clear',
  ]);
  for (const m of RECORD_MISREADS) {
    assert.ok(m.reader.trim() && m.says.trim() && m.why.trim(), `${m.key} 가 비었다`);
  }
});

test('정본: 사건 행의 칸이 §6-4 LEDGER_FIELDS 와 **양방향**으로 맞는다', () => {
  assert.deepEqual(auditCellRegistry(), []);
  assert.equal(INCIDENT_ROW_CELLS.length, LEDGER_FIELDS.length);
  // 리허설 칸 셋은 사건 행에서 필수가 아니고, 그 이유가 적혀 있다
  assert.deepEqual(INCIDENT_ROW_CELLS.filter((c) => !c.required).map((c) => c.field), ['duration', 'scope', 'unpassed']);
  assert.ok(cellFor('duration')?.blankOk?.includes('[확인 필요]'));
  assert.equal(cellFor('없는칸'), null);
});

test('열 이름을 복제하지 않는다 — §6-4 정본에서 가져온다', () => {
  assert.deepEqual(requiredColumns(), ['일자', '유형', '복구 대상 시점', '검증 결과', '담당', '비고']);
  // 열 이름이 바뀌면 이 쪽도 함께 바뀐다(리터럴을 들고 있지 않다는 뜻이다)
  const renamed = LEDGER_FIELDS.map((f) => (f.key === 'owner' ? { ...f, column: '담당자' } : f));
  assert.ok(requiredColumns(INCIDENT_ROW_CELLS, renamed).includes('담당자'));
});

test('사각지대를 함께 내보낸다 — 「게이트가 아니다」까지 적는다', () => {
  assert.ok(RECORD_LIMITS.includes(CAVEAT_ROW_IS_A_CLAIM));
  assert.ok(RECORD_LIMITS.includes(CAVEAT_CLEARED_IS_SILENT));
  assert.ok(RECORD_LIMITS.includes(CAVEAT_DAY_BOUNDARY));
  assert.ok(RECORD_LIMITS.some((l) => /게이트가 아니다/.test(l)));
  assert.equal(RECORD_VERDICTS.length, 9);
});

/* ─────────────────────────── 판정 ─────────────────────────── */

test('평상시(표지 없음)에는 표를 묻지 않는다 ⬅ 평상시마다 경보가 뜨면 아무도 보지 않는다', () => {
  const a = assessIncidentRecord({ rows: [], tableFound: true, markers: MARKERS_CLEARED });
  assert.equal(a.verdict, 'no_incident');
  assert.equal(a.captureOpen, false);
  assert.equal(a.action, ACTION_REC_NO_INCIDENT);
  // 지난 사건의 행이 표에 있어도 평상시 판정은 그대로다(영구 기록은 이 판정의 대상이 아니다)
  assert.equal(assessIncidentRecord({ rows: [row()], markers: MARKERS_CLEARED }).verdict, 'no_incident');
});

test('앵커를 읽을 수 없으면 보류다 — 「행이 없다」로 단정하지 않는다', () => {
  const a = assessIncidentRecord({ rows: [], markers: { [ANCHOR_ENV]: '어제 12시쯤' } });
  assert.equal(a.verdict, 'unreadable_anchor');
  assert.equal(a.anchorAt, null);
});

test('앵커가 없으면 어느 행이 이번 사건인지 말할 수 없다(보류)', () => {
  const a = assessIncidentRecord({ rows: [row()], markers: { RECOVERY_LOSS_NOTICE_AT: FROZE } });
  assert.equal(a.verdict, 'unanchored');
  assert.deepEqual(a.attributed, []);
  assert.equal(a.incidentRows, 1, '행을 세기는 한다 — 귀속만 말하지 못한다');
});

test('표를 못 찾은 것은 「행이 없다」가 아니라 판정 불가다', () => {
  const a = assessIncidentRecord({ rows: [], tableFound: false, markers: MARKERS_OPEN });
  assert.equal(a.verdict, 'no_table');
});

test('앵커 이후의 사건 행이 하나도 없으면 `unrecorded` ⬅ 8단계 3번 미수행', () => {
  const a = assessIncidentRecord({ rows: [], tableFound: true, markers: MARKERS_OPEN });
  assert.equal(a.verdict, 'unrecorded');
  assert.equal(a.action, ACTION_REC_UNRECORDED);
  assert.equal(a.captureOpen, true, '표지가 남아 있는 동안이 적을 수 있는 유일한 기회다');
});

test('사건 행이 전부 앵커보다 앞이면 지난 사건의 기록이다 — 이번 것으로 세지 않는다', () => {
  const a = assessIncidentRecord({ rows: [row({ date: '2026-09-01' })], markers: MARKERS_OPEN });
  assert.equal(a.verdict, 'predating_only');
  assert.deepEqual(a.predating, [1]);
  assert.deepEqual(a.attributed, []);
});

test('앵커 **전날** 행은 귀속을 말할 수 없다 — 통과로도 미기록으로도 세지 않는다', () => {
  const a = assessIncidentRecord({ rows: [row({ date: '2026-10-29' })], markers: MARKERS_OPEN });
  assert.equal(a.verdict, 'boundary_only');
  assert.deepEqual(a.boundary, [1]);
  assert.ok(a.caveats.includes(CAVEAT_DAY_BOUNDARY));
});

test('앵커 이후의 사건 행이 하나면 `recorded` — 그 행 번호를 돌려준다', () => {
  const a = assessIncidentRecord({ rows: [row()], markers: MARKERS_OPEN });
  assert.equal(a.verdict, 'recorded');
  assert.equal(a.matchedRow, 1);
  assert.equal(a.matchedDate, '2026-10-30');
  assert.deepEqual(a.emptyCells, []);
});

test('앵커 이후의 사건 행이 둘 이상이면 가를 수 없다(`ambiguous`)', () => {
  const a = assessIncidentRecord({
    rows: [row(), row({ row: 4, date: '2026-10-31' })],
    markers: MARKERS_OPEN,
  });
  assert.equal(a.verdict, 'ambiguous');
  assert.deepEqual(a.attributed, [1, 4]);
  assert.equal(a.matchedRow, null, '하나로 정해지지 않으면 행을 고르지 않는다');
});

test('리허설·점검 행을 사건 행으로 세지 않는다(§6-8 목적으로 가른다)', () => {
  const a = assessIncidentRecord({ rows: [rehearsal(), check()], markers: MARKERS_OPEN });
  assert.equal(a.incidentRows, 0);
  assert.equal(a.verdict, 'unrecorded');
});

test('필수 칸이 비어 있으면 적어 둔 행도 반쪽이다 — 열 이름으로 말한다', () => {
  const a = assessIncidentRecord({
    rows: [row({ target: '', owner: '', note: '' })],
    markers: MARKERS_OPEN,
  });
  assert.equal(a.verdict, 'recorded');
  assert.deepEqual(a.emptyCells, ['복구 대상 시점', '담당', '비고']);
});

test('규율상 비워 두는 칸을 미기록으로 세지 않는다(소요시간·범위·미통과 단위)', () => {
  const { missing, blankByRule } = emptyCellsOf(row({ durationMin: null }));
  assert.deepEqual(missing, []);
  assert.deepEqual(blankByRule, ['소요시간', '범위', '미통과 단위']);
});

test('모르는 칸을 **지어내 읽지 않는다** — 열 이름도 추측하지 않는다', () => {
  // 열이 늘고 정본만 먼저 고쳐진 상태. 읽을 길이 없으면 빈 칸으로 보고하고 키 이름을 그대로 쓴다.
  const { missing } = emptyCellsOf(row(), [
    { field: '아직없는칸' as IncidentCellKey, required: true, why: '열이 늘었다', blankOk: null },
  ]);
  assert.deepEqual(missing, ['아직없는칸']);
  // 정본 대조가 그 상태를 **양방향으로** 잡는다
  const problems = auditCellRegistry([
    { field: '아직없는칸' as IncidentCellKey, required: true, why: '열이 늘었다', blankOk: null },
  ]);
  assert.ok(problems.some((p) => /LEDGER_FIELDS 에 없다/.test(p)));
  assert.ok(problems.some((p) => /사건 행 정본에 없다/.test(p)), '반대 방향(열이 늘었는데 정본에 없다)도 잡는다');
  assert.ok(
    auditCellRegistry([{ field: 'note', required: false, why: '', blankOk: null }]).length >= 2,
    '설명·면제 이유가 비면 잡는다',
  );
});

test('판독할 수 없는 `검증 결과` 를 「적었다」로 세지 않는다', () => {
  const { missing } = emptyCellsOf(row({ result: 'unknown' }));
  assert.deepEqual(missing, ['검증 결과']);
});

/* ─────────────────── 표지 삭제(8단계 4번) 선행 조건 ─────────────────── */

test('clearGate: 평상시에는 지울 표지가 없다 — 막지 않고 표도 묻지 않는다', () => {
  const g = clearGate({ record: assessIncidentRecord({ markers: MARKERS_CLEARED }) });
  assert.equal(g.clearable, true);
  assert.deepEqual(g.blockers, []);
  assert.equal(g.unseenByRuntime.length, 2);
});

test('clearGate: 런타임 판정(2번)을 넣지 않으면 통과시키지 않는다(fail-closed)', () => {
  const g = clearGate({ record: assessIncidentRecord({ rows: [row()], markers: MARKERS_OPEN }) });
  assert.equal(g.clearable, false);
  assert.ok(g.blockers.some((b) => /canClearMarkers/.test(b)));
});

test('clearGate: 런타임이 막고 있으면 그 이유를 **그대로** 쓴다(판정을 복제하지 않는다)', () => {
  const g = clearGate({
    record: assessIncidentRecord({ rows: [row()], markers: MARKERS_OPEN }),
    runtimeClearable: false,
    runtimeBlockers: ['고지 수행 기록이 없다'],
  });
  assert.equal(g.clearable, false);
  assert.deepEqual(g.blockers, ['고지 수행 기록이 없다']);
});

test('clearGate: 2번·3번이 모두 끝났으면 통과한다', () => {
  const g = clearGate({
    record: assessIncidentRecord({ rows: [row()], markers: MARKERS_OPEN }),
    runtimeClearable: true,
  });
  assert.equal(g.clearable, true);
  assert.deepEqual(g.blockers, []);
});

test('clearGate: **표에 행이 없는데 런타임이 통과시키는** 바로 그 상태를 막는다 ⬅ 이 절의 핵심', () => {
  const record = assessIncidentRecord({ rows: [], tableFound: true, markers: MARKERS_OPEN });
  assert.equal(record.verdict, 'unrecorded');
  const g = clearGate({ record, runtimeClearable: true, runtimeBlockers: [] });
  assert.equal(g.clearable, false);
  assert.ok(g.blockers.some((b) => /사건 행이 없다/.test(b)));
});

test('clearGate: 보류 판정도 통과시키지 않는다(판정 불가는 통과가 아니다)', () => {
  for (const markers of [{ [ANCHOR_ENV]: '12시쯤' }, { RECOVERY_LOSS_NOTICE_AT: FROZE }]) {
    const g = clearGate({ record: assessIncidentRecord({ markers }), runtimeClearable: true });
    assert.equal(g.clearable, false, JSON.stringify(markers));
  }
  const noTable = clearGate({
    record: assessIncidentRecord({ tableFound: false, markers: MARKERS_OPEN }),
    runtimeClearable: true,
  });
  assert.equal(noTable.clearable, false);
});

test('clearGate: 행은 있지만 필수 칸이 빈 상태도 막는다 — 지운 뒤에는 적을 수 없다', () => {
  const g = clearGate({
    record: assessIncidentRecord({ rows: [row({ note: '' })], markers: MARKERS_OPEN }),
    runtimeClearable: true,
  });
  assert.equal(g.clearable, false);
  assert.ok(g.blockers.some((b) => b.includes('비고')));
});

/* ─────────────────────────── 출력 ─────────────────────────── */

test('로그 한 줄은 판정·개수만 담는다 — 시각·일자·담당자를 담지 않는다', () => {
  const line = incidentRecordLine(assessIncidentRecord({ rows: [row({ note: '' })], markers: MARKERS_OPEN }));
  assert.match(line, /verdict=recorded/);
  assert.match(line, /empty_cells=1/);
  assert.ok(!line.includes('2026-10-30'), '일자가 로그에 들어갔다');
  assert.ok(!line.includes('운영 담당'), '담당자가 로그에 들어갔다');
});

test('요약은 수치·판정과 근거 절만 말한다', () => {
  const s = incidentRecordStatus({ rows: [], tableFound: true, markers: MARKERS_OPEN });
  assert.equal(s.verdict, 'unrecorded');
  assert.equal(s.unseen, 2);
  assert.equal(s.misreads, 5);
  assert.equal(s.limits, RECORD_LIMITS.length);
  assert.equal(s.ref, RECORD_RUNBOOK_REF);
  assert.match(incidentRecordText(assessIncidentRecord({ rows: [row()], markers: MARKERS_OPEN })), /1번/);
  // 앵커가 없을 때 날짜를 지어내지 않는다
  const unanchored = incidentRecordText(assessIncidentRecord({ rows: [row()], markers: { RECOVERY_LOSS_NOTICE_AT: FROZE } }));
  assert.match(unanchored, /앵커 없음/);
  assert.ok(!unanchored.includes('귀속'), '귀속을 말할 수 없는데 수치를 적었다');
});

/* ─────────────────── 실제 소스·문서와의 대조 ─────────────────── */

test('[실제 소스] 런타임 게이트가 **3번을 보지 못한다는 사실**을 그 자리에서 말한다', () => {
  assert.deepEqual(auditClearGateBlindSpot(NOTICE_SRC), []);
  // 한계가 빠지면 CI 가 잡는다
  assert.ok(auditClearGateBlindSpot('export const x = 1').length > 0);
  assert.ok(auditClearGateBlindSpot('canClearMarkers 만 있다').length >= 2);

  // 실제 판정이 `unseen` 을 싣는다 — 차단 중 고지까지 적은 상태에서도 3번은 남는다
  const a = assessNotice({
    restorePoint: '2026-10-30T11:50:00+09:00',
    frozenAt: FROZE,
    noticedAt: '2026-10-30T16:00:00+09:00',
    frozen: true,
  });
  assert.equal(a.canClearMarkers, true, '런타임은 2번만 보므로 통과한다(그것이 이 절의 출발점이다)');
  assert.equal(a.unseen.length, 2);
  assert.ok(a.unseen.some((u) => /6-10/.test(u)));
  // 평상시에는 거짓 경보를 만들지 않는다
  assert.deepEqual(assessNotice({ frozen: false }).unseen, []);
});

test('[실제 소스] §3-23 이 **행이 없을 때** not_applicable 로 돌려준다 ⬅ nothing_to_write 의 근거', () => {
  assert.deepEqual(auditRowReaderPrecondition(REMARK_SRC), []);
  assert.ok(auditRowReaderPrecondition('const f = () => 1').length > 0);
  // 분기는 있는데 **돌려주는 값이 바뀐** 경우도 잡는다(정본 설명이 거짓이 된다)
  assert.ok(auditRowReaderPrecondition("if (!row) return base('empty', …)").length > 0);
  // 실제 동작 — 8단계 3번을 통째로 거른 상태가 「적을 것이 없다」로 나온다
  assert.equal(assessRemarkSlots().verdict, 'not_applicable');
});

test('[실제 소스] 사건 행만이 RTO 실측 자격을 갖는다는 정본이 §6-8 에 그대로 있다', () => {
  assert.deepEqual(auditPurposeRoleSource(PURPOSE_SRC), []);
  assert.equal(auditPurposeRoleSource('').length, 2);
});

test('[실제 소스] 런타임 체크를 만들지 않았다 ⬅ 런타임은 §6 표를 읽지 못한다', () => {
  assert.deepEqual(auditNoNewHealthCheck(HEALTH_SRC), []);
  assert.ok(auditNoNewHealthCheck('checks.incidentRecord = incidentRecordCheck()').length > 0);
});

test('[실제 소스] 신규 env·조회·쓰기 0 — 모듈이 process.env 를 건드리지 않는다', () => {
  // 주석을 걷어 낸 **코드**만 본다 — 주석의 「`process.env` 미접근」이 접근으로 세어지면
  // 이 가드가 영구히 빨갛게 남고, 빨간 가드는 아무도 보지 않는다.
  const code = SELF_SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.ok(!/process\.env/.test(code), 'env 를 직접 읽는다 — 표지는 명시 인자로만 받는다');
  assert.ok(!/drizzle|CREATE TABLE|INSERT INTO|UPDATE |DELETE /.test(code));
  assert.ok(!/node:fs|next\//.test(code), '문서·파일을 직접 읽는다 — 표는 명시 인자로만 받는다');
});

test('[실제 문서] §6-10 과 8단계의 유도·체크리스트 인용이 살아 있다', () => {
  assert.deepEqual(auditRunbookIncidentRecord(RUNBOOK), []);
  assert.ok(auditRunbookIncidentRecord('# 빈 문서').length > 0);
  // 8단계에서 유도가 빠지면 잡는다 — **뒤따르는 절의 언급으로 메워지지 않는다**
  const synthetic = [
    '### 6-10. 그 행이 있는가',
    ...RECORD_MISREADS.map((m) => `- ${m.key}`),
    '8. **사후** — 네 가지를 순서대로 한다.',
    '   1. canClearMarkers 를 본다',
    '### 리허설 체크리스트',
    '- [ ] 6-10 명령으로 판정했다',
  ].join('\n');
  const problems = auditRunbookIncidentRecord(synthetic);
  assert.ok(problems.some((p) => /8단계가 §6-10/.test(p)), problems.join(' / '));

  // 4번이 런타임 게이트를 인용하지 않게 되면(둘을 함께 보는 자리다) 잡는다
  const noGate = synthetic.replace('   1. canClearMarkers 를 본다', '   1. 지운다');
  assert.ok(auditRunbookIncidentRecord(noGate).some((p) => /런타임 게이트를 인용하지 않는다/.test(p)));

  // 체크리스트에서 인용이 빠지면 리허설에서 이름으로 찾을 수 없다
  const noCite = synthetic.replace('- [ ] 6-10 명령으로 판정했다', '- [ ] 판정했다');
  assert.ok(auditRunbookIncidentRecord(noCite).some((p) => /체크리스트가 §6-10 을 인용하지 않는다/.test(p)));
  // 체크리스트 구간 자체가 없어진 경우와 구별한다
  assert.ok(
    auditRunbookIncidentRecord(synthetic.replace('### 리허설 체크리스트', '### 딴 절')).some((p) => /체크리스트가 없다/.test(p)),
  );
});

test('[실제 문서] 절차 단위 6-10 이 정본에 등록돼 있다 ⬅ 등록하지 않으면 범위 판정이 그대로 ok 가 된다', () => {
  const unit = PROCEDURE_UNITS.find((u) => u.key === '6-10');
  assert.ok(unit, '단위 6-10 이 정본에 없다');
  assert.equal(unit?.cited, true);
  assert.ok(unit?.skipped.includes('canClearMarkers'));
});

test('[실제 문서] 이 표를 자동으로 채우지 않는다 — 실제 RUNBOOK 에는 사건 행이 없다', () => {
  const t = parseLedgerTable(RUNBOOK);
  assert.equal(t.found, true, '§6 표를 찾지 못했다');
  const a = assessIncidentRecord({ rows: t.rows, tableFound: t.found, markers: MARKERS_OPEN });
  assert.equal(a.incidentRows, 0, '자동화가 사건 행을 적어 넣었다');
  assert.equal(a.verdict, 'unrecorded');
  // 표지가 없는 평상시 판정으로는 경보가 뜨지 않는다
  assert.equal(assessIncidentRecord({ rows: t.rows, tableFound: t.found }).verdict, 'no_incident');
});
