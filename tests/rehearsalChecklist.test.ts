/**
 * rehearsalChecklist.test.ts — 체크리스트의 **칸 상태**는 누구의 것인가(RUNBOOK §6·§6-9). 2026-10-23
 *
 * ── 왜 필요한가 ──────────────────────────────────────────────────────────────
 * §6 표는 「임의로 채우지 않는다」 문구와 CI 점검으로 두 겹 지켜지는데, **같은 절에서 사람이
 * 손으로 상태를 적는 다른 자리**인 리허설 체크리스트의 `- [ ]` 칸에는 그 둘이 하나도 없었다.
 * 체크리스트는 저장소 파일 **한 벌**이고 수행 단위로 복사되지 않으므로, 한 번 체크하면 다음
 * 리허설과 **다음 사건 복구**가 그 체크를 물려받는다 — AutoPush 가 미커밋 변경까지 커밋하므로
 * 커밋할 의도 없이도 영구화되고, 체크 상태를 읽는 판정은 어디에도 없었다(전 판정이 env·표만
 * 본다). 거기에 §6-3 추출 정규식 `\[[ xX]\]` 이 `[ ]` 와 `[x]` 를 **같은 항목**으로 접었고,
 * 그 밖의 글자가 든 줄은 **항목으로 세어지지도 않았다**.
 *
 * 그래서 (a) 칸 판독의 경계(셋을 접지 않는다), (b) 판정 순서와 「둘 다 내보낸다」 규율,
 * (c) 항목을 단위로 세는 규칙이 §6-2 와 같다는 사실, (d) 배선(칸 글자 보존·§6-2 단위 등록·
 * **런타임 체크를 만들지 않았다는 사실**·머리말 규율·§6-9 문서)을 파일 수준에서 고정한다.
 * **핵심은 「실제 RUNBOOK.md 의 전 칸이 비어 있다」** 한 건이다 — 체크가 커밋되면 CI 가 실패한다.
 * 이 테스트는 **파일만 읽는다** — 네트워크·DB 를 쓰지 않고 `process.env` 도 바꾸지 않는다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  CHECKLIST_DRIFTS,
  CHECKLIST_HEADING,
  CHECKLIST_HOMES,
  CHECKLIST_LIMITS,
  CHECKLIST_MISREADS,
  CHECKLIST_RUNBOOK_REF,
  CHECKLIST_VERDICTS,
  assessChecklist,
  auditBoxStateKept,
  auditBoxesOpen,
  auditChecklistCanon,
  auditChecklistInstruction,
  auditCitationRule,
  auditNoRuntimeCheck,
  auditRunbookChecklistSection,
  boxState,
  checklistLogLine,
  checklistScopePlan,
  checklistStatus,
  checklistText,
  misreadFor,
  parseChecklistBoxes,
  unattributedItems,
  unitItemLoad,
  unitsCitedIn,
  unitsWithoutItems,
} from '../src/lib/rehearsalChecklist.ts';
import { PROCEDURE_UNITS, parseCoverageRecord, unitFor, type ProcedureUnit } from '../src/lib/rehearsalCoverage.ts';
import { parseChecklistItems } from '../src/lib/rehearsalObservation.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (...p: string[]) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const RUNBOOK = read('RUNBOOK.md');

/** 합성 체크리스트 — 실제 문서를 건드리지 않고 판정을 본다 */
function doc(lines: string[]): string {
  return ['## 6. 복구 리허설 기록', '', `### ${CHECKLIST_HEADING}`, '', ...lines, ''].join('\n');
}

const UNITS: readonly ProcedureUnit[] = [
  { key: '3-6', title: '복구 시점 산출', since: '2026-10-09', cited: true, skipped: 'ε 를 눈대중으로 정한다' },
  { key: '3-11', title: '행 수 감소의 뜻', since: '2026-10-22', cited: true, skipped: '감소를 한 문장으로 읽는다' },
  { key: '6-9', title: '칸 상태', since: '2026-10-23', cited: true, skipped: '체크를 물려받는다' },
];

/* ───────────────────────────── 칸 판독의 경계 ───────────────────────────── */

test('boxState: 셋을 접지 않는다 ⬅ 모르는 글자를 비었다·체크로 올리지 않는다', () => {
  assert.equal(boxState(' '), 'open');
  assert.equal(boxState('x'), 'checked');
  assert.equal(boxState('X'), 'checked');
  // 깃허브가 체크박스로 그리지 않는 꼴 — 어느 쪽으로도 올리지 않는다
  assert.equal(boxState(''), 'unreadable');
  assert.equal(boxState('-'), 'unreadable');
  assert.equal(boxState('o'), 'unreadable');
  assert.equal(boxState(null), 'unreadable');
  assert.equal(boxState(undefined), 'unreadable');
});

test('parseChecklistBoxes: 구간을 못 찾으면 null ⬅ 「항목이 없다」로 단정하지 않는다', () => {
  assert.equal(parseChecklistBoxes('# 다른 문서\n- [ ] 항목'), null);
  assert.equal(parseChecklistBoxes(''), null);
  assert.deepEqual(parseChecklistBoxes(doc([])), []);
});

test('parseChecklistBoxes: 판독 불가 칸도 **항목으로 센다** ⬅ 그전에는 조용히 빠졌다', () => {
  const boxes = parseChecklistBoxes(doc(['- [ ] 첫째', '- [-] 둘째', '- [x] 셋째']), UNITS)!;
  assert.deepEqual(
    boxes.map((b) => [b.index, b.state, b.mark]),
    [
      [1, 'open', ' '],
      [2, 'unreadable', '-'],
      [3, 'checked', 'x'],
    ],
  );
});

test('§6-3 추출이 칸의 글자를 담고 이어진 줄은 그대로 합친다', () => {
  const items = parseChecklistItems(doc(['- [x] 첫째 항목 —', '      이어진 줄', '- [ ] 둘째']));
  assert.equal(items.length, 2);
  assert.equal(items[0].mark, 'x');
  assert.equal(items[0].checked, true);
  assert.equal(items[0].text, '첫째 항목 — 이어진 줄');
  assert.equal(items[1].checked, false);
  assert.equal(items[1].mark, ' ');
});

/* ───────────────────────── 항목을 단위로 세기 ───────────────────────── */

test('unitsCitedIn: 숫자 경계·「단계」 표기를 §6-2 와 같은 규칙으로 본다', () => {
  // `3-11` 을 `3-1` 로 세지 않는다
  assert.deepEqual(unitsCitedIn('`data.unexplained` 가 비어 있다(3-11)', UNITS), ['3-11']);
  assert.deepEqual(unitsCitedIn('복구 시점을 §3-6 명령으로 산출했다', UNITS), ['3-6']);
  // 「§3 6-1단계」는 **단계**를 가리키는 표기다 — 소절 인용으로 세지 않는다
  assert.deepEqual(unitsCitedIn('보안 상태를 재적용했다(§3 6-1단계)', UNITS), []);
  assert.deepEqual(unitsCitedIn('본 절차 항목이다', UNITS), []);
});

test('unitItemLoad·unitsWithoutItems·unattributedItems: 단위별 항목 수를 센다', () => {
  const boxes = parseChecklistBoxes(doc(['- [ ] §3-6 산출', '- [x] §3-6 재확인', '- [ ] 로그인 정상']), UNITS)!;
  const load = unitItemLoad(boxes, UNITS);
  assert.deepEqual(load.find((l) => l.unit === '3-6'), {
    unit: '3-6',
    title: '복구 시점 산출',
    items: [1, 2],
    checked: 1,
    cited: true,
  });
  // 항목이 하나도 없는 단위 — 리허설에서 할 일이 적혀 있지 않다는 뜻이다
  assert.deepEqual(unitsWithoutItems(boxes, UNITS), ['3-11', '6-9']);
  // 번호를 인용하지 않는 항목은 본 절차 항목이다(문제가 아니다)
  assert.deepEqual(unattributedItems(boxes), [3]);
});

test('checklistScopePlan: 기록이 없으면 전 항목을 「빠졌다」로 올리지 않는다 ⬅ 임의 범위 금지', () => {
  const boxes = parseChecklistBoxes(doc(['- [ ] §3-6 산출', '- [ ] 로그인 정상']), UNITS)!;
  const none = checklistScopePlan(boxes, null);
  assert.deepEqual(none.inScope, []);
  assert.deepEqual(none.outOfScope, []);
  assert.deepEqual(none.unattributed, [2]);
  assert.match(none.note, /판정 보류/);
  assert.deepEqual(checklistScopePlan(boxes, { units: [] }).outOfScope, []);
});

test('checklistScopePlan: 범위 선언을 항목 목록으로 푼다', () => {
  const boxes = parseChecklistBoxes(doc(['- [ ] §3-6 산출', '- [ ] §3-11 확인', '- [ ] 로그인 정상']), UNITS)!;
  const plan = checklistScopePlan(boxes, parseCoverageRecord('asOf=2026-10-23;units=3-6'));
  assert.deepEqual(plan.inScope, [1]);
  assert.deepEqual(plan.outOfScope, [2]);
  assert.deepEqual(plan.unattributed, [3]);
});

/* ───────────────────────────── 판정 ───────────────────────────── */

test('assessChecklist: 판본이 비어 있으면 ok 이고 수치를 지어내지 않는다', () => {
  const a = assessChecklist(doc(['- [ ] 첫째', '- [ ] 둘째']), UNITS);
  assert.equal(a.verdict, 'ok');
  assert.equal(a.basis, 'repository');
  assert.equal(a.total, 2);
  assert.equal(a.open, 2);
  assert.deepEqual(a.checkedItems, []);
  assert.deepEqual(a.unreadableItems, []);
});

test('assessChecklist: 체크가 남으면 carried_over, 전부면 all_checked ⬅ 다음 수행이 물려받는다', () => {
  const some = assessChecklist(doc(['- [ ] 첫째', '- [x] 둘째', '- [ ] 셋째']), UNITS);
  assert.equal(some.verdict, 'carried_over');
  assert.deepEqual(some.checkedItems, [2]);
  assert.match(some.action, /다음 수행|다음 리허설|되돌/);

  const all = assessChecklist(doc(['- [x] 첫째', '- [X] 둘째']), UNITS);
  assert.equal(all.verdict, 'all_checked');
  assert.deepEqual(all.checkedItems, [1, 2]);
  // 항목이 0개인 구간은 「전부 체크」가 아니다
  assert.equal(assessChecklist(doc([]), UNITS).verdict, 'ok');
});

test('assessChecklist: 체크와 판독 불가를 **둘 다** 내보낸다 ⬅ 하나가 다른 하나를 덮지 않는다', () => {
  const a = assessChecklist(doc(['- [x] 첫째', '- [-] 둘째', '- [] 셋째']), UNITS);
  assert.equal(a.verdict, 'carried_over');
  assert.deepEqual(a.checkedItems, [1]);
  assert.deepEqual(a.unreadableItems, [2, 3]);
  assert.deepEqual(a.unreadableMarks, ['-', '']);

  const onlyUnreadable = assessChecklist(doc(['- [ ] 첫째', '- [-] 둘째']), UNITS);
  assert.equal(onlyUnreadable.verdict, 'unreadable_box');
  assert.deepEqual(onlyUnreadable.unreadableItems, [2]);
});

test('assessChecklist: 구간이 없으면 no_checklist(판정 불가) — 0건으로 통과시키지 않는다', () => {
  const a = assessChecklist('# 다른 문서', UNITS);
  assert.equal(a.verdict, 'no_checklist');
  assert.equal(a.total, 0);
  assert.match(a.action, /판정 불가/);
  assert.ok(CHECKLIST_VERDICTS.includes(a.verdict));
});

/* ───────────────────────────── 출력 ───────────────────────────── */

test('출력: 요약·로그가 항목 **본문**을 담지 않는다(판정·개수·번호만)', () => {
  const src = doc(['- [x] 담당자 홍길동이 비고에 적은 민감한 문구', '- [ ] 둘째']);
  const a = assessChecklist(src, UNITS);
  const line = checklistLogLine(a);
  assert.match(line, /^recovery_rehearsal_checklist /);
  assert.match(line, /verdict=carried_over/);
  assert.match(line, /total=2 checked=1 unreadable=0/);
  assert.ok(!line.includes('홍길동'), '로그에 항목 본문이 들어갔다');
  const text = checklistText(a);
  assert.ok(!text.includes('홍길동'), '요약에 항목 본문이 들어갔다');
  assert.match(text, /체크된 항목: 1/);

  const status = checklistStatus(src);
  assert.equal(status.verdict, 'carried_over');
  assert.equal(status.total, 2);
  assert.ok(status.line.includes('basis=repository'));
  assert.match(checklistText(assessChecklist('# 없음', UNITS)), /구간을 찾지 못했다/);
});

/* ───────────────────────────── 정본의 모양 ───────────────────────────── */

test('정본: 기록의 집·거짓 판정·어긋남에 빈 칸이 없고 키가 겹치지 않는다', () => {
  assert.deepEqual(auditChecklistCanon(), []);
  assert.equal(CHECKLIST_RUNBOOK_REF, 'RUNBOOK §6 · §6-9');
  assert.ok(CHECKLIST_HOMES.some((h) => !h.perRun && /아무도/.test(h.readBy)));
  assert.equal(misreadFor('carried_over_ticks')?.key, 'carried_over_ticks');
  assert.equal(misreadFor('없는키'), null);

  assert.ok(auditChecklistCanon([{ ...CHECKLIST_HOMES[0], readBy: ' ' }, CHECKLIST_HOMES[1]]).length > 0);
  assert.ok(auditChecklistCanon(CHECKLIST_HOMES, [CHECKLIST_MISREADS[0], CHECKLIST_MISREADS[0]]).length > 0);
  assert.ok(auditChecklistCanon(CHECKLIST_HOMES, CHECKLIST_MISREADS, [{ key: 'x', when: '', who: 'a' }]).length > 0);
  // 수행 기록의 집이 사라지면 「칸 말고 어디에 적는가」가 없어진다
  assert.ok(auditChecklistCanon([CHECKLIST_HOMES[0]]).length > 0);
});

test('한계: 저장소 파일만 본다는 사실과 「빈 칸 ≠ 미수행」을 함께 내보낸다', () => {
  const joined = CHECKLIST_LIMITS.join(' ');
  assert.match(joined, /저장소 파일만 본다/);
  assert.match(joined, /빈 칸이 「수행하지 않았다」는 뜻이 아니고/);
  assert.match(joined, /저장소 밖/);
  assert.deepEqual(assessChecklist(doc(['- [ ] 첫째']), UNITS).caveats, CHECKLIST_LIMITS);
});

/* ───────────────────────── 정적 점검(합성 입력) ───────────────────────── */

test('auditBoxesOpen: 체크·판독 불가·구간 소실·항목 0개를 전부 잡는다', () => {
  assert.deepEqual(auditBoxesOpen(doc(['- [ ] 첫째', '- [ ] 둘째']), UNITS), []);
  assert.equal(auditBoxesOpen(doc(['- [x] 첫째', '- [ ] 둘째']), UNITS).length, 1);
  assert.match(auditBoxesOpen(doc(['- [x] 첫째']), UNITS)[0], /물려받는다/);
  assert.equal(auditBoxesOpen(doc(['- [ ] 첫째', '- [-] 둘째']), UNITS).length, 1);
  assert.match(auditBoxesOpen('# 다른 문서', UNITS)[0], /찾을 수 없다/);
  assert.match(auditBoxesOpen(doc([]), UNITS)[0], /항목이 없다/);
});

test('auditChecklistInstruction: 머리말에서 판본 규율이 빠지면 잡는다', () => {
  const good = doc([
    '> **이 목록은 판본이다 — 저장소 파일의 칸에는 체크하지 않는다.** 복사해 쓰고',
    '> 기록은 6절 표에만 남긴다(아래 6-9). 자동화 에이전트는 이 칸도 임의로 채우지 않는다.',
    '',
    '- [ ] 첫째',
  ]);
  assert.deepEqual(auditChecklistInstruction(good), []);
  assert.ok(auditChecklistInstruction(doc(['- [ ] 첫째'])).length >= 3);
  assert.match(auditChecklistInstruction('# 다른 문서')[0], /찾을 수 없다/);
  // 항목 뒤에 적어 두면 머리말이 아니다 — 읽기 전에 눈에 들어오지 않는다
  const afterItems = doc(['- [ ] 첫째', '> 저장소 파일의 칸에는 체크하지 않는다 · 복사 · 임의로 채우지 않는다 · 6-9']);
  assert.ok(auditChecklistInstruction(afterItems).length > 0);
});

test('auditBoxStateKept: 칸의 글자를 접는 정규식으로 되돌아가면 잡는다', () => {
  const folded = "const started = /^\\s*-\\s*\\[[ xX]\\]\\s*(.*)$/.exec(line);";
  const problems = auditBoxStateKept(folded);
  assert.ok(problems.length >= 3);
  assert.match(problems[0], /접는 정규식/);
  const kept = 'interface ChecklistItem { mark: string; checked: boolean }\nconst re = /^\\s*-\\s*\\[([^\\]]?)\\]\\s*(.*)$/;';
  assert.deepEqual(auditBoxStateKept(kept), []);
});

test('auditCitationRule: §6-2 인용 규칙이 갈라지면 잡는다', () => {
  assert.ok(auditCitationRule('new RegExp(`${u.key}`)').length === 2);
  assert.deepEqual(auditCitationRule('new RegExp(`(?<!\\\\d)${u.key}(?!\\\\d|단계)`)'), []);
});

test('auditRunbookChecklistSection: 판정 어휘·거짓 판정 키·모듈 이름 누락을 잡는다', () => {
  assert.ok(auditRunbookChecklistSection('### 6-9. 제목만').length > 0);
  assert.match(auditRunbookChecklistSection('내용 없음')[0], /6-9 소절이 없다/);
});

test('auditNoRuntimeCheck: 런타임 응답에 실으면 잡는다 ⬅ 문서를 본 적 없는 판정이 된다', () => {
  assert.deepEqual(auditNoRuntimeCheck('checks.recovery = recoveryCheck();'), []);
  assert.match(auditNoRuntimeCheck("import {x} from '@/lib/rehearsalChecklist';")[0], /거짓 보증/);
});

/* ───────────────────── 실제 저장소 파일과 대조 ───────────────────── */

test('[실제 문서] RUNBOOK 체크리스트의 **전 칸이 비어 있다** ⬅ 체크가 커밋되면 다음 복구가 물려받는다', () => {
  assert.deepEqual(auditBoxesOpen(RUNBOOK), []);
  const a = assessChecklist(RUNBOOK);
  assert.equal(a.verdict, 'ok');
  assert.ok(a.total > 40, `체크리스트 항목이 ${a.total}개다 — 구간이 잘렸는지 본다`);
  assert.equal(a.open, a.total);
});

test('[실제 문서] 체크리스트 머리말이 판본 규율을 적고 있고 §6-9 가 남아 있다', () => {
  assert.deepEqual(auditChecklistInstruction(RUNBOOK), []);
  assert.deepEqual(auditRunbookChecklistSection(RUNBOOK), []);
  // 표의 보호 문구도 그대로다 — §6-9 는 그 문구가 **칸에는 없던** 것에서 출발했다
  assert.match(RUNBOOK, /자동화 에이전트는 이 표를 임의로 채우지 않는다/);
});

test('[실제 소스] §6-3 추출이 칸의 글자를 보존하고, §6-2 와 인용 규칙이 같다', () => {
  assert.deepEqual(auditBoxStateKept(read('src', 'lib', 'rehearsalObservation.ts')), []);
  assert.deepEqual(auditCitationRule(read('src', 'lib', 'rehearsalCoverage.ts')), []);
});

test('[실제 소스] `/api/health` 에 체크리스트 판정이 실려 있지 않다 ⬅ 런타임은 문서를 읽지 않는다', () => {
  assert.deepEqual(auditNoRuntimeCheck(read('src', 'app', 'api', 'health', 'route.ts')), []);
});

test('[실제 정본] 항목이 인용하는 단위는 모두 `cited: true` 로 선언돼 있다', () => {
  const boxes = parseChecklistBoxes(RUNBOOK)!;
  assert.ok(boxes.length > 0);
  const load = unitItemLoad(boxes);
  for (const l of load) {
    if (l.items.length > 0) {
      assert.equal(l.cited, true, `단위 ${l.unit} 는 항목 ${l.items.length}개를 들고 있는데 cited: false 로 선언돼 있다`);
    }
  }
  // 항목이 없는 단위는 §6-2 정본이 `cited: false` 로 적어 둔 것들이다(이름으로 찾을 수 없다)
  for (const key of unitsWithoutItems(boxes)) {
    assert.equal(unitFor(key)?.cited, false, `단위 ${key} 는 cited: true 인데 체크리스트 항목이 0개다`);
  }
  // §6-9 자신이 단위로 등록돼 있고 항목을 들고 있다
  assert.equal(unitFor('6-9')?.cited, true);
  assert.ok(load.find((l) => l.unit === '6-9')!.items.length >= 1);
  // 번호를 인용하지 않는 항목(§3 1~8단계 본 절차)은 그대로 있다 — 문제가 아니다
  assert.ok(unattributedItems(boxes).length > 0);
  assert.equal(PROCEDURE_UNITS.some((u) => u.key === '6-9'), true);
});
