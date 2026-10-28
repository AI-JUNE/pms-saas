// 전환 뒤 남는 **원본(손상) 브랜치**의 처분 테스트(RUNBOOK §3-18·§3 5단계). 2026-10-28
//
// 이 파일이 지키는 것은 하나다 — **전환이 끝난 순간 DB 는 두 벌이고, 절차는 한 벌만 가리켰다.**
//  (1) 8단계 2번이 「유실」이라 **되돌릴 수 없게** 고지하는 행은 원본 브랜치의 **현재 상태**로
//      남아 있다(조회로 닿는다) — 고지 전에 「꺼낼 수 있는지」를 보라고 지시하는 자리가 없었다
//  (2) 꺼낼 범위를 말해 주는 두 값을 8단계 4번이 지운다(§3-14 때문에 **옳다**) — 그래서 범위는
//      표지가 **아직 있는 동안**에만 산출할 수 있다
//  (3) 원본은 전 테넌트 데이터 한 벌이고 탈퇴·파기가 닿지 않는데, 어떤 응답도 그것을 말하지 않는다
//  (4) 체크리스트의 「브랜치 정리」가 **어느 브랜치인지** 말하지 않으면 사건에서 유일본을 지운다
//  (5) 그러면서도 `state`·`ok` 어휘를 바꾸지 않고 **새 체크·새 표지·새 env 를 만들지 않는다**
//      (브랜치의 존재·처분은 코드가 확인할 수 없다 — 미처분으로 `ok` 를 내리면 거짓 차단이 된다)
// 더해서 실제 배선·`/api/health` 라우트·이 모듈 원문·RUNBOOK 원문을 대조해 문서와 코드가 함께 낡지 않게 한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  ACTION_SOURCE_CARRIED, ACTION_SOURCE_DECLARED, ACTION_SOURCE_EXTRACTABLE, ACTION_SOURCE_INVALID,
  ACTION_SOURCE_NONE, ACTION_SOURCE_RANGE_UNKNOWN, CAVEAT_SOURCE_COORDINATES_EPHEMERAL,
  CAVEAT_SOURCE_EXISTENCE_UNKNOWN, CAVEAT_SOURCE_NOT_A_RECOVERY, NOTICE_ENV, RANGE_END_ENV,
  RANGE_START_ENV, SOURCE_BLIND_SPOTS, SOURCE_HOLDINGS, SOURCE_LIMITS, SOURCE_RUNBOOK_REF,
  SOURCE_VERDICTS, assessSourceBranch, auditKeyAgreement, auditNoNewEnv, auditNoNewHealthCheck,
  auditNoticeWiring, auditRunbookSource, auditSourceCanon, publicSourceBranch, sourceBranchStatus,
  sourceFromEnv, sourceLine, sourceText,
} from '../src/lib/sourceBranch.ts';
import { FREEZE_AT_ENV } from '../src/lib/incidentClosure.ts';
import { NOTICE_AT_ENV, RESTORE_POINT_ENV, lossNoticeCheck } from '../src/lib/lossNotice.ts';
import { ANCHOR_ENV } from '../src/lib/incidentTimeline.ts';
import { PROCEDURE_UNITS } from '../src/lib/rehearsalCoverage.ts';
import { parseChecklistBoxes, unitItemLoad } from '../src/lib/rehearsalChecklist.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (...rel: string[]) => fs.readFileSync(path.join(ROOT, ...rel), 'utf8');
const RUNBOOK = read('RUNBOOK.md');
const MODULE_SRC = read('src', 'lib', 'sourceBranch.ts');
const NOTICE_SRC = read('src', 'lib', 'lossNotice.ts');
const ROUTE_SRC = read('src', 'app', 'api', 'health', 'route.ts');

/** 한 사건의 정상 순서 — 3단계 T-ε → 2단계 차단 실효(앵커) → 8단계 2번 고지 */
const T_RESTORE = '2026-10-28T01:30:00+09:00';
const T_FREEZE = '2026-10-28T02:10:00+09:00';
const T_NOTICE = '2026-10-28T06:00:00+09:00';
/** 지난 복구(몇 달 전)가 남긴 값 */
const T_OLD = '2026-06-02T11:00:00+09:00';
const NOW = new Date('2026-10-28T12:00:00Z');

/** 범위가 확정된 사건(고지 전) */
const RANGED: Record<string, string | undefined> = {
  RECOVERY_WRITE_FREEZE: 'true',
  [RANGE_START_ENV]: T_RESTORE,
  [RANGE_END_ENV]: T_FREEZE,
};

/* ─────────────────────────────── 정본 ─────────────────────────────── */

test('정본: 원본에만 남는 것 셋이 「지우면 사라지는 것」과 함께 적혀 있다', () => {
  assert.deepEqual(auditSourceCanon(), []);
  assert.equal(SOURCE_HOLDINGS.length, 3, '원본에만 남는 것의 수가 바뀌었다 — §3-18 을 함께 볼 것');
  assert.deepEqual(SOURCE_HOLDINGS.map((h) => h.key), ['loss_window_rows', 'damaged_state', 'straggler_writes']);
  // ⬅ 이 장치의 전제: 전건 **유일본**이고, 브랜치가 살아 있는 동안 **조회로** 닿는다
  for (const h of SOURCE_HOLDINGS) {
    assert.equal(h.onlyCopy, true, `${h.key} 가 유일본이 아니라고 선언됐다`);
    assert.equal(h.readableNow, true, `${h.key} 가 조회로 닿지 않는다고 선언됐다 — 그러면 「꺼낼 수 있다」가 성립하지 않는다`);
    assert.ok(h.lostOnDelete.length > 20, `${h.key} 를 지울 때 사라지는 것이 적혀 있지 않다`);
  }
  assert.equal(SOURCE_BLIND_SPOTS.length, 6);
  assert.deepEqual(SOURCE_BLIND_SPOTS.map((s) => s.key), [
    'branch_invisible', 'path_unknown', 'coordinates_cleared',
    'damage_took_the_rows', 'erasure_gap', 'rehearsal_conflated',
  ]);
});

test('정본 모양 점검이 유일본 아님·설명 공란·유실 구간 행 누락을 잡는다', () => {
  const base = SOURCE_HOLDINGS[0];
  const bad = auditSourceCanon(
    [{ ...base, key: 'x', onlyCopy: false as unknown as true, what: ' ', lostOnDelete: '' }],
    [{ key: 'y', what: '', why: '' }],
  );
  assert.ok(bad.length >= 4, bad.join('\n'));
  assert.ok(bad.some((p) => /유일본이 아니라고/.test(p)));
  assert.ok(bad.some((p) => /유실 구간 행이 정본에서 빠졌다/.test(p)));
  assert.deepEqual(auditSourceCanon([], []), [
    '원본에만 남는 것의 정본이 비었다 — 지울 때 사라지는 것을 적을 자리가 사라졌다',
    '유실 구간 행이 정본에서 빠졌다 — 고지문이 「유실」이라 부르는 바로 그 대상이다',
    '사각지대 정본이 비었다',
  ]);
});

/* ─────────────────────────── 판정 ─────────────────────────── */

test('평상시에는 원본 브랜치를 말하지 않는다 — 상시 떠 있는 할 일을 만들지 않는다', () => {
  const a = assessSourceBranch({ env: {}, now: NOW });
  assert.equal(a.verdict, 'not_applicable');
  assert.equal(a.actionable, false, '평상시 할 일로 올리면 정작 판단할 자리가 있는 국면의 할 일을 덮는다');
  assert.equal(a.decisionDue, false);
  assert.equal(a.action, ACTION_SOURCE_NONE);
  assert.deepEqual([a.rangeKnown, a.claimFinal, a.noticeBasis], [false, false, 'absent']);
});

test('범위가 확정됐고 고지 전이면 `extractable` — 「지금이 꺼낼지 판단할 자리」라고 말한다', () => {
  const a = assessSourceBranch({ env: RANGED, now: NOW });
  assert.equal(a.verdict, 'extractable');
  assert.equal(a.rangeKnown, true);
  assert.equal(a.claimFinal, false);
  assert.equal(a.decisionDue, true);
  assert.equal(a.action, ACTION_SOURCE_EXTRACTABLE);
  assert.ok(/고지 전이다/.test(a.action) && /꺼내지 않기로 하면/.test(a.action));
  assert.deepEqual([a.holdings, a.readableHoldings], [3, 3]);
  // 구간 수치는 §3-7 판정을 그대로 쓴다 — 여기서 다시 만들지 않는다
  assert.equal(a.window.verdict, 'ok');
  assert.equal(a.window.minutes, 40);
});

test('고지가 나가면 `declared_lost` — 남은 일은 **처분 확정**이라고 말한다', () => {
  const a = assessSourceBranch({ env: { ...RANGED, [NOTICE_ENV]: T_NOTICE }, now: NOW });
  assert.equal(a.verdict, 'declared_lost');
  assert.equal(a.claimFinal, true);
  assert.equal(a.noticeBasis, 'anchor');
  assert.equal(a.action, ACTION_SOURCE_DECLARED);
  // 한쪽으로 확정하라고 말하고(§3-12 와 같은 규율), 두 선택지의 결과를 함께 적는다
  assert.ok(/남긴다/.test(a.action) && /지운다/.test(a.action) && /표지를 지우기 전에/.test(a.action));
});

test('두 끝 중 하나가 없으면 `range_unknown` — 꺼낼 범위를 추정하지 않는다', () => {
  const endOnly = assessSourceBranch({ env: { [RANGE_END_ENV]: T_FREEZE }, now: NOW });
  assert.equal(endOnly.verdict, 'range_unknown');
  assert.equal(endOnly.rangeKnown, false);
  assert.equal(endOnly.action, ACTION_SOURCE_RANGE_UNKNOWN);
  assert.equal(endOnly.window.verdict, 'invalid_restore_point');

  // 시작만 적힌 경우도 같다 — 끝을 모르면 구간이 닫히지 않는다
  const startOnly = assessSourceBranch({ env: { [RANGE_START_ENV]: T_RESTORE }, now: NOW });
  assert.equal(startOnly.verdict, 'range_unknown');
  assert.equal(startOnly.window.verdict, 'end_unrecorded');

  // 고지 기록이 있어도 범위를 모르는 쪽이 먼저다 — 범위 없는 「유실」 고지가 가장 조용한 오류다
  const notified = assessSourceBranch({ env: { [RANGE_END_ENV]: T_FREEZE, [NOTICE_ENV]: T_NOTICE }, now: NOW });
  assert.equal(notified.verdict, 'range_unknown');
});

test('판정 순서: 못 읽는 값·지난 사건의 고지 기록이 범위 판정보다 먼저다', () => {
  // (가) 고지 시각 판독 불가 — 「미기록」으로 섞으면 할 일이 달라진다
  const badNotice = assessSourceBranch({ env: { ...RANGED, [NOTICE_ENV]: '2026-13-40' }, now: NOW });
  assert.equal(badNotice.verdict, 'invalid_record');
  assert.equal(badNotice.action, ACTION_SOURCE_INVALID);

  // (나) 좌표 판독 불가 — `range_unknown`(= 「적으면 된다」)으로 덮이면 **잘못 적힌 값**을 못 본다
  const badStart = assessSourceBranch({ env: { ...RANGED, [RANGE_START_ENV]: 'yesterday' }, now: NOW });
  assert.equal(badStart.verdict, 'invalid_record');

  // (다) 지난 사건이 남긴 고지 시각 — 이번 고지는 **아직 나가지 않았다**.
  //      순서를 바꾸면 `declared_lost` 가 나와 추출 판단의 자리를 건너뛰고, 그 상태로 표지를
  //      지우면 범위까지 함께 사라진다.
  const carried = assessSourceBranch({ env: { ...RANGED, [NOTICE_ENV]: T_OLD }, now: NOW });
  assert.equal(carried.verdict, 'carried_basis');
  assert.equal(carried.noticeBasis, 'carried_over');
  assert.equal(carried.claimFinal, false, '지난 사건의 표지로 「고지가 나갔다」고 말했다');
  assert.equal(carried.action, ACTION_SOURCE_CARRIED);
});

test('판정 어휘가 문서 표와 같고 전건에 할 일·설명이 있다', () => {
  assert.equal(SOURCE_VERDICTS.length, 6);
  const seen = new Set(
    [
      assessSourceBranch({ env: {}, now: NOW }),
      assessSourceBranch({ env: RANGED, now: NOW }),
      assessSourceBranch({ env: { ...RANGED, [NOTICE_ENV]: T_NOTICE }, now: NOW }),
      assessSourceBranch({ env: { [RANGE_END_ENV]: T_FREEZE }, now: NOW }),
      assessSourceBranch({ env: { ...RANGED, [NOTICE_ENV]: 'nope' }, now: NOW }),
      assessSourceBranch({ env: { ...RANGED, [NOTICE_ENV]: T_OLD }, now: NOW }),
    ].map((a) => {
      assert.ok(a.action.length > 30, `${a.verdict} 의 할 일이 비었다`);
      assert.ok(a.note.length > 10, `${a.verdict} 의 설명이 비었다`);
      assert.equal(a.caveats, SOURCE_LIMITS);
      return a.verdict;
    }),
  );
  assert.deepEqual([...seen].sort(), [...SOURCE_VERDICTS].sort(), '판정 하나가 어떤 입력으로도 나오지 않는다');
});

test('한계 목록이 「있는지 모른다」·「꺼낼 수 있다 ≠ 되돌릴 수 있다」·「좌표는 지워진다」를 담는다', () => {
  for (const c of [CAVEAT_SOURCE_EXISTENCE_UNKNOWN, CAVEAT_SOURCE_NOT_A_RECOVERY, CAVEAT_SOURCE_COORDINATES_EPHEMERAL]) {
    assert.ok(SOURCE_LIMITS.includes(c));
  }
  assert.ok(SOURCE_LIMITS.some((l) => /degraded 로도 바뀌지 않는다/.test(l)));
  assert.ok(SOURCE_LIMITS.some((l) => /PITR/.test(l)), '손상이 그 구간을 지운 경우를 한계로 내보내지 않는다');
});

/* ─────────────────────────── 출력 ─────────────────────────── */

test('출력: 로그·공개 응답에 **좌표가 없고** 구간은 1줄 명령에만 나온다', () => {
  const a = sourceFromEnv(RANGED, NOW);
  const line = sourceLine(a);
  assert.match(line, /^recovery_source_branch source=extractable range=known notice=absent holdings=3$/);
  for (const out of [line, JSON.stringify(publicSourceBranch(a))]) {
    assert.ok(!/\d{4}-\d{2}-\d{2}/.test(out), `좌표·시각이 노출됐다: ${out}`);
    assert.ok(!/분|minutes/.test(out), `구간 수치가 노출됐다: ${out}`);
  }
  assert.deepEqual(publicSourceBranch(a), {
    verdict: 'extractable', rangeKnown: true, claimFinal: false, holdings: 3, runbook: SOURCE_RUNBOOK_REF,
  });

  // 사람이 읽는 요약에는 좌표가 나오고, 지울 때 사라지는 것과 한계가 함께 실린다
  const text = sourceText(a);
  assert.ok(text.includes('2026-10-27T16:30:00.000Z'), '1줄 명령이 구간의 시작을 말하지 않는다');
  for (const h of SOURCE_HOLDINGS) assert.ok(text.includes(h.key), `${h.key} 가 요약에서 빠졌다`);
  for (const c of SOURCE_LIMITS) assert.ok(text.includes(c), '한계를 판정과 함께 내보내지 않았다');
  assert.ok(sourceText(sourceFromEnv({}, NOW)).includes('(미기록)'));
});

test('상태 요약', () => {
  const s = sourceBranchStatus(RANGED, NOW);
  assert.deepEqual(
    [s.verdict, s.rangeKnown, s.holdings, s.blindSpots, s.limits],
    ['extractable', true, 3, 6, SOURCE_LIMITS.length],
  );
  assert.equal(s.action, ACTION_SOURCE_EXTRACTABLE);
  assert.equal(sourceBranchStatus({}).verdict, 'not_applicable');
});

/* ─────────────────────── 배선(실제 소스) ─────────────────────── */

test('lossNotice: `state`·`ok` 어휘는 그대로이고 원본 브랜치 판정만 더해진다', () => {
  const ranged = lossNoticeCheck({ env: RANGED, now: NOW });
  assert.deepEqual([ranged.detail.state, ranged.ok, ranged.required], ['due', false, false]);
  assert.equal(ranged.detail.sourceVerdict, 'extractable');
  assert.equal(ranged.detail.sourceRangeKnown, true);
  assert.equal(ranged.detail.sourceHoldings, 3);
  assert.ok(String(ranged.detail.sourceNote).includes('고지 전이다'));

  // 고지가 기록되면 `notified` + 처분 확정 안내로 바뀌는데 `ok` 는 그대로 true 다
  const notified = lossNoticeCheck({ env: { ...RANGED, [NOTICE_AT_ENV]: T_NOTICE }, now: NOW });
  assert.deepEqual([notified.detail.state, notified.ok], ['notified', true]);
  assert.equal(notified.detail.sourceVerdict, 'declared_lost');

  // 평상시에는 한 글자도 더 달라지지 않는다
  const normal = lossNoticeCheck({ env: {}, now: NOW });
  assert.deepEqual([normal.detail.state, normal.detail.sourceVerdict, normal.ok], ['normal', 'not_applicable', true]);

  // **좌표는 detail 에 담지 않는다**(무인증 응답에서 그 구간의 쓰기를 노리는 데 쓰인다 — §2-3)
  const dump = JSON.stringify(ranged.detail);
  assert.ok(!dump.includes('2026-10-27T16:30:00.000Z'), '구간의 시작이 공개 응답에 들어갔다');
  assert.equal(ranged.detail.sourceStartsAt, undefined);
  assert.equal(ranged.detail.sourceWindow, undefined);
});

test('[실제 소스] 판정을 응답에 실어 보내고 새 체크·새 env 를 만들지 않는다', () => {
  assert.deepEqual(auditNoticeWiring(NOTICE_SRC), []);
  assert.deepEqual(auditNoNewHealthCheck(ROUTE_SRC), []);
  assert.deepEqual(auditNoNewEnv(MODULE_SRC), []);

  // 판정만 하고 버리는 꼴·좌표 노출을 잡는다
  assert.ok(auditNoticeWiring('').length >= 5);
  assert.ok(
    auditNoticeWiring(`${NOTICE_SRC}\n      sourceStartsAt: 1,`).some((p) => /좌표/.test(p)),
    '구간 좌표를 detail 에 담아도 통과한다',
  );
  assert.equal(
    auditNoNewHealthCheck("import { x } from '@/lib/sourceBranch';\nchecks.sourceBranch = x();").length,
    2,
  );
  // 새 표지를 받기 시작하면(= 8단계 4번에서 지울 것이 는다) CI 로 잡는다
  assert.ok(auditNoNewEnv("const v = env.RECOVERY_SOURCE_BRANCH_KEPT;").length === 1);
  assert.ok(auditNoNewEnv('process.env.X').some((p) => /순수 모듈/.test(p)));
});

test('[실제 정본] 좌표 키 이름이 §3-10·§3-7 의 선언과 같다', () => {
  assert.deepEqual(
    auditKeyAgreement({ restorePoint: RESTORE_POINT_ENV, freezeAt: FREEZE_AT_ENV, noticeAt: NOTICE_AT_ENV }),
    [],
  );
  assert.equal(RANGE_END_ENV, ANCHOR_ENV, '구간의 끝은 §3-14 의 귀속 앵커와 같은 값이다');
  // 이름이 갈리면 이 판정은 늘 비어 있는 env 를 읽어 **평상시만** 내보낸다(응답은 200 이다)
  assert.equal(auditKeyAgreement({ restorePoint: 'RECOVERY_RP', freezeAt: FREEZE_AT_ENV, noticeAt: NOTICE_AT_ENV }).length, 1);
  assert.equal(auditKeyAgreement({}).length, 3);
  // 키를 **리터럴로** 읽어야 `envRegistry.scanEnvReads` 가 잡는다
  for (const key of [RANGE_START_ENV, RANGE_END_ENV, NOTICE_ENV]) {
    assert.ok(MODULE_SRC.includes(`env.${key}`), `${key} 를 상수 경유로 읽는다 — 소스 스캔에서 빠진다`);
  }
});

/* ─────────────────────── 문서(실제 RUNBOOK) ─────────────────────── */

test('[실제 RUNBOOK] §3-18 과 그것을 가리키는 단계가 함께 남아 있다', () => {
  assert.deepEqual(auditRunbookSource(RUNBOOK), []);
  assert.ok(auditRunbookSource('').length > 0);

  // 5단계·8단계 유도와 체크리스트의 「브랜치 정리」 지시가 사라지는 경우
  const no318 = RUNBOOK.replace(/3-18/g, '3-99');
  const problems = auditRunbookSource(no318);
  assert.ok(problems.some((p) => /5단계/.test(p)), '5단계 유도 누락을 잡지 못한다');
  assert.ok(problems.some((p) => /8단계/.test(p)), '8단계 유도 누락을 잡지 못한다');
  assert.ok(problems.some((p) => /브랜치 정리/.test(p)), '「어느 브랜치인지」 누락을 잡지 못한다');
});

test('[실제 RUNBOOK] §3-18 이 절차 단위로 등록되고 체크리스트가 인용한다', () => {
  const unit = PROCEDURE_UNITS.find((u) => u.key === '3-18');
  assert.ok(unit, '절차 단위에 3-18 이 없다 — 범위 기록이 가리킬 곳이 없다');
  assert.equal(unit!.cited, true);
  assert.equal(unit!.since, '2026-10-28');
  assert.ok(/원본|유일본/.test(unit!.skipped), '거른 결과 설명이 원본 브랜치를 가리키지 않는다');

  const boxes = parseChecklistBoxes(RUNBOOK);
  assert.ok(boxes, '체크리스트를 찾지 못했다');
  const load = unitItemLoad(boxes!).find((u) => u.unit === '3-18');
  assert.ok(load && load.items.length >= 2, '§3-18 을 인용하는 체크리스트 항목이 2개 미만이다');
  // §6-9: 저장소 파일의 칸은 **비어 있어야** 한다 — 체크가 남으면 다음 수행이 물려받는다
  assert.equal(load!.checked, 0, '§3-18 체크리스트 항목이 체크된 채 커밋됐다');
});

test('[실제 RUNBOOK] 남는 것 셋과 사각지대가 문서에 모두 적혀 있다', () => {
  const at = RUNBOOK.search(/^###\s*3-18\./m);
  assert.ok(at > 0);
  const section = RUNBOOK.slice(at, RUNBOOK.indexOf('\n## ', at));
  for (const h of SOURCE_HOLDINGS) assert.ok(section.includes(h.key), `§3-18 표에 ${h.key} 행이 없다`);
  for (const s of SOURCE_BLIND_SPOTS) assert.ok(section.includes(s.key), `사각지대 ${s.key} 가 §3-18 에 없다`);
  // 「새 체크·새 표지·새 env 를 만들지 않았다」는 약속이 문서에 남아 있어야 다음 배치가 되돌리지 않는다
  assert.ok(/새 체크도 새 표지도 새 env 도 만들지 않았다/.test(section));
  // 전환이 **연결 문자열만** 바꾼다는 사실이 5단계에 적혀 있어야 두 벌이 된 것을 담당자가 안다
  assert.ok(/원본 브랜치는 그대로 남는다/.test(RUNBOOK));
});
