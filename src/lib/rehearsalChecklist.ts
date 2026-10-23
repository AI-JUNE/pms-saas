/**
 * rehearsalChecklist.ts — 체크리스트의 **칸 상태**는 누구의 것인가(RUNBOOK §6 · §6-9). 2026-10-23
 *
 * ── 왜 필요한가 ───────────────────────────────────────────────────────────────
 * §6 표에는 두 겹의 보호가 있다 — 머리말의 「**자동화 에이전트는 이 표를 임의로 채우지 않는다**」
 * 한 줄과, 그 문구가 사라지면 CI 를 실패시키는 점검이다(2026-09-21 부터). 그런데 **같은 절에
 * 사람이 손으로 상태를 적는 자리가 하나 더 있다**: 아래 「리허설 체크리스트」의 `- [ ]` 칸
 * 58개다. 그 칸에는 두 보호가 **하나도 없다.**
 *
 *  (1) **체크는 수행보다 오래 남는다**(`carried_over_ticks`). 체크리스트는 저장소 파일 **한 벌**
 *      이고 수행 단위로 복사되지 않는다. 한 번 체크하면 다음 리허설과 **다음 사건 복구**가 그
 *      체크를 물려받는다 — 이미 수행된 것으로 보이는 항목을 건너뛰는데, 체크 상태를 읽는 판정은
 *      **어디에도 없다**(전 판정이 env 와 §6 표만 본다. `basis` 가 `env` 인 그 응답들이다).
 *  (2) **커밋할 의도 없이도 영구화된다**(`autopush_commits_ticks`). 이 저장소는 AutoPush 가
 *      20분마다 **미커밋 변경까지** 커밋·배포한다. 리허설 중에 열어 둔 체크 몇 개가 그대로
 *      판본이 된다 — 「저장하지 않았으니 괜찮다」가 성립하지 않는다.
 *  (3) **같은 문법이 「완료」로 쓰이는 파일이 같은 저장소에 있다**(`same_syntax_as_backlog`).
 *      `COMMERCIAL_READINESS.md` 에서 `- [ ]`→`- [x]` 는 **자동 개발이 매 배치 수행하는 동작**
 *      이다. 문법이 한 글자도 다르지 않아서, 그 동작이 이 체크리스트에 번져도 막는 것이 없다.
 *  (4) **체크에는 「누구의 것인가」가 없다**(`no_run_identity`). §6-8(2026-10-23)은 같은 표의
 *      행을 **연습·사건·점검** 세 목적으로 갈라 놓았는데, 체크 칸에는 일자도 유형도 없다.
 *      그래서 올바르게 체크된 체크리스트조차 §6 표의 **어느 행에도 귀속되지 않는다** —
 *      수행 기록으로 쓸 수 없는 상태이면서 다음 수행을 오염시키기만 한다.
 *  (5) **그 상태가 판독 단계에서 접혔다**(`box_folded_at_parse`). §6-3 `parseChecklistItems` 의
 *      정규식은 `\[[ xX]\]` 였다 — `[ ]` 와 `[x]` 가 **그 순간 같은 항목**이 되어, 체크 상태를
 *      본 판정이 하나도 없었다. 그 밖의 글자(`- [-]`)는 **항목으로 세어지지도 않았다**(인용
 *      대조에서 조용히 빠진다. `mark` 신설로 셋을 구분한다).
 *  (6) **단위보다 잘다**(`coarser_than_units`). §6-2 범위 기록은 **소절 단위**라 한 단위가 들고
 *      있는 항목이 몇 개인지 말하지 않는다 — 그 한계는 `COVERAGE_LIMITS` 에 적혀 있었지만
 *      **셀 수단이 없었다**(`unitItemLoad` 가 센다).
 *
 * 그래서 이 모듈은
 *   · 칸의 상태를 **접지 않고** 셋으로 읽고(`boxState` — `open`/`checked`/**`unreadable`**),
 *   · 체크 상태와 수행 기록의 **집을 정본으로** 갈라 적고(`CHECKLIST_HOMES`),
 *   · 판본이 깨끗한지 판정하고(`assessChecklist` → `carried_over`·`all_checked`·`unreadable_box`),
 *   · 항목을 **단위로 세고**(`unitItemLoad`·`unitsWithoutItems`), 범위 기록을 **항목 목록으로
 *     풀어 주고**(`checklistScopePlan` — 소절 선언이 어느 항목을 덮는지 사람이 볼 수 있게),
 *   · **CI 에서 전 칸이 비어 있는지 검사한다**(`auditBoxesOpen` — 이것이 이 장치의 핵심이다.
 *     체크가 커밋되는 순간 CI 가 실패한다).
 *
 * 원칙
 * - 순수 모듈: DB·next·fs·`process.env` 미접근, **신규 env 0 · 신규 조회·쓰기·DDL 0**.
 *   문서 원문은 **인자로** 받는다.
 * - **런타임 체크를 만들지 않았다.** 체크 상태는 저장소 파일에만 있고 런타임은 문서를 읽지
 *   않는다 — 없는 신호를 `/api/health` 에 만들면 그 자체가 거짓 보증이 된다(§6-9 는 저장소
 *   명령과 CI 로만 판정한다. `lib/schemaBaseline.ts`·`lib/countSemantics.ts` 와 같은 자리다).
 * - **임의 귀속 금지.** 빈 칸이 「수행하지 않았다」는 뜻이 아니고 체크가 「수행했다」는 뜻도
 *   아니다 — 이 판정이 말하는 것은 **판본이 깨끗한가**뿐이다. 표를 채우지 않는 것과 같은 규율로
 *   칸도 채우지 않는다.
 * - **판독 불가를 숨기지 않는다.** 모르는 글자는 `open` 으로도 `checked` 로도 올리지 않고,
 *   판정이 하나를 고르더라도 체크된 항목과 판독 불가 항목을 **둘 다** 내보낸다.
 */
import { PROCEDURE_UNITS, type ProcedureUnit } from './rehearsalCoverage.ts';
import { checklistSection, parseChecklistItems, type ChecklistItem } from './rehearsalObservation.ts';

/** 응답·문서에서 근거 절을 찾을 수 있게 한다 */
export const CHECKLIST_RUNBOOK_REF = 'RUNBOOK §6 · §6-9';

/** 체크리스트 구간의 제목(§6-3 `checklistSection` 과 같은 자리를 본다) */
export const CHECKLIST_HEADING = '리허설 체크리스트';

/** 수행 기록이 사는 곳 — 체크 칸이 아니다 */
export const RECORD_HOMES_NOTE = '§6 표(일자·유형·범위·미통과 단위)와 환경변수';

/* ─────────────────── 두 기록의 집(정본) ─────────────────── */

export interface ChecklistHome {
  /** 무엇의 기록인가 */
  what: string;
  /** 어디에 사는가 */
  home: string;
  /** 수행 단위로 **새로 생기는가**(= 다음 수행이 물려받지 않는가) */
  perRun: boolean;
  /** 누가 읽는가 — 아무도 읽지 않으면 그 사실을 적는다 */
  readBy: string;
  /** 그것을 수행 기록으로 쓰면 무슨 일이 생기는가 */
  ifUsedAsRecord: string;
}

export const CHECKLIST_HOMES: readonly ChecklistHome[] = [
  {
    what: '체크리스트의 칸 상태(`- [ ]`/`- [x]`)',
    home: '저장소 파일 `RUNBOOK.md` **한 벌** — git 이력에 남고 AutoPush 가 미커밋 변경까지 커밋한다',
    perRun: false,
    readBy: '아무도 — 전 판정이 env 와 §6 표만 본다(§6-3 추출도 상태를 보지 않았다)',
    ifUsedAsRecord:
      '다음 리허설·다음 사건 복구가 지난 체크를 물려받아 이미 수행된 것으로 보이는 항목을 건너뛴다 — 어느 응답도 달라지지 않는다',
  },
  {
    what: '그 수행이 **언제·무엇을·어디까지** 했는가',
    home: `${RECORD_HOMES_NOTE}(§6-2 범위 · §6-5 미통과 단위 · §6-8 유형)`,
    perRun: true,
    readBy: '`checks.recovery`·`checks.rehearsalCoverage`·`checks.rehearsalOutcome`·`checks.ledgerPurpose`',
    ifUsedAsRecord: '제 자리다 — 수행 기록은 여기에만 남긴다',
  },
];

/* ─────────────────── 거짓이 되는 판정(정본) ─────────────────── */

export interface ChecklistMisread {
  key: string;
  /** 어느 판정·동작이 */
  judgement: string;
  /** 무슨 말을 하게 되는가 */
  says: string;
  /** 왜 그것이 거짓인가 */
  why: string;
}

export const CHECKLIST_MISREADS: readonly ChecklistMisread[] = [
  {
    key: 'carried_over_ticks',
    judgement: '사람이 보는 체크리스트',
    says: '그 항목은 이미 수행했다',
    why: '체크리스트는 저장소 파일 한 벌이라 체크가 수행보다 오래 남는다 — 지난 리허설의 체크를 다음 사건 복구가 물려받는다',
  },
  {
    key: 'autopush_commits_ticks',
    judgement: '「저장하지 않았으니 판본은 그대로다」',
    says: '열어 둔 체크는 사라진다',
    why: 'AutoPush 가 20분마다 **미커밋 변경까지** 커밋·배포한다 — 커밋할 의도 없이도 체크가 판본이 된다',
  },
  {
    key: 'same_syntax_as_backlog',
    judgement: '§6 머리말의 「표를 임의로 채우지 않는다」 보호',
    says: '사람이 적는 자리는 자동화가 건드리지 않는다',
    why: '그 문구와 CI 점검은 **표**에만 있다 — 같은 절의 체크 칸은 `COMMERCIAL_READINESS.md` 의 완료 표시와 문법이 같은데 아무 보호가 없었다',
  },
  {
    key: 'no_run_identity',
    judgement: '체크된 체크리스트',
    says: '이 수행은 이 항목들을 했다',
    why: '칸에는 일자도 유형도 없다 — §6-8 이 가른 연습·사건·점검 중 **어느 수행의 체크인지** 말하지 못해 §6 표의 어느 행에도 귀속되지 않는다',
  },
  {
    key: 'box_folded_at_parse',
    judgement: '§6-3 `parseChecklistItems`',
    says: '체크리스트 항목은 N개다',
    why: '정규식 `\\[[ xX]\\]` 이 `[ ]` 와 `[x]` 를 같은 항목으로 담았다(상태를 버린다) — 그 밖의 글자는 **항목으로 세어지지도 않았다**',
  },
  {
    key: 'coarser_than_units',
    judgement: '§6-2 `checks.rehearsalCoverage` 의 `covered`',
    says: '그 단위는 범위에 들어 있다',
    why: '범위는 **소절 단위**다 — 한 단위가 들고 있는 항목 중 몇을 수행했는지는 말하지 않고, 셀 수단도 없었다',
  },
];

/** 모르는 키는 null — 지어내지 않는다 */
export function misreadFor(key: unknown): ChecklistMisread | null {
  return CHECKLIST_MISREADS.find((m) => m.key === key) ?? null;
}

/* ─────────────────────────── 칸 판독 ─────────────────────────── */

/**
 * - `open`      : `- [ ]` — 비어 있다(**판본의 정상 상태**)
 * - `checked`   : `- [x]`·`- [X]`
 * - `unreadable`: 그 밖(`- []`·`- [-]`·`- [o]`) — **어느 쪽으로도 올리지 않는다.**
 *   깃허브는 체크박스로 그리지 않고, 2026-10-23 까지의 §6-3 추출은 이 줄을 **항목으로 세지도
 *   않았다**(단위 인용 대조에서 조용히 빠진다).
 */
export type BoxState = 'open' | 'checked' | 'unreadable';

export function boxState(mark: unknown): BoxState {
  if (typeof mark !== 'string') return 'unreadable';
  if (mark === ' ') return 'open';
  if (mark === 'x' || mark === 'X') return 'checked';
  return 'unreadable';
}

export interface ChecklistBox {
  /** 1부터 세는 항목 번호(§6-3 `ChecklistItem.index` 와 같은 번호다) */
  index: number;
  state: BoxState;
  /** 칸 안의 글자 원문 — 접지 않고 담는다 */
  mark: string;
  /** 항목 전문(이어진 줄까지 합친 것) */
  text: string;
  /** 이 항목이 **번호로 인용하는** 절차 단위(§6-2 와 같은 규칙) */
  units: string[];
}

/**
 * 소절 번호 인용 탐지. 숫자 경계로 찾고 「§3 6-1단계」처럼 **단계**를 가리키는 표기는
 * 소절 인용으로 세지 않는다 — §6-2 `auditChecklistCitations` 와 **같은 규칙**이어야 한다
 * (다르면 `cited` 선언과 항목 수가 서로 다른 말을 한다. `auditCitationRule` 이 고정한다).
 */
export function unitsCitedIn(text: unknown, units: readonly ProcedureUnit[] = PROCEDURE_UNITS): string[] {
  const s = String(text ?? '');
  return units.filter((u) => new RegExp(`(?<!\\d)${u.key.replace('-', '\\-')}(?!\\d|단계)`).test(s)).map((u) => u.key);
}

/**
 * 체크리스트 구간의 칸을 전부 읽는다. 구간을 못 찾으면 **null** —
 * 「항목이 없다」로 단정하지 않는다(§6-3 `checklistSection` 과 같은 규율).
 */
export function parseChecklistBoxes(
  runbookSrc: unknown,
  units: readonly ProcedureUnit[] = PROCEDURE_UNITS,
): ChecklistBox[] | null {
  if (checklistSection(runbookSrc) === null) return null;
  return parseChecklistItems(runbookSrc).map((item: ChecklistItem) => ({
    index: item.index,
    state: boxState(item.mark),
    mark: item.mark,
    text: item.text,
    units: unitsCitedIn(item.text, units),
  }));
}

/* ─────────────────── 항목을 단위로 세기 ─────────────────── */

export interface UnitItemLoad {
  unit: string;
  title: string;
  /** 이 단위를 인용하는 항목 번호 */
  items: number[];
  /** 그중 체크된 항목 수 */
  checked: number;
  /** §6-2 정본의 `cited` 선언 */
  cited: boolean;
}

/**
 * 단위마다 체크리스트 항목이 몇 개인지. §6-2 범위 기록은 **소절 하나**를 적으면 그 단위를
 * 덮은 것으로 세는데, 그 단위가 항목 셋을 들고 있을 수 있다 — 그 수치가 여기서 나온다.
 */
export function unitItemLoad(
  boxes: readonly ChecklistBox[],
  units: readonly ProcedureUnit[] = PROCEDURE_UNITS,
): UnitItemLoad[] {
  return units.map((u) => {
    const mine = boxes.filter((b) => b.units.includes(u.key));
    return {
      unit: u.key,
      title: u.title,
      items: mine.map((b) => b.index),
      checked: mine.filter((b) => b.state === 'checked').length,
      cited: u.cited,
    };
  });
}

/**
 * 체크리스트 항목이 **하나도 없는** 단위 — 리허설에서 할 일이 적혀 있지 않다는 뜻이다.
 * §6-2 는 그 단위도 범위 기록에 적을 수 있게 해 두었으므로(목록은 정본에서 나온다)
 * 「적혀 있지 않은 것을 수행했다고 적는」 길이 열려 있다. **유실로 단정하지 않는다** —
 * `cited: false` 로 선언된 단위는 그 사실이 이미 §6-2 정본에 적혀 있다.
 */
export function unitsWithoutItems(
  boxes: readonly ChecklistBox[],
  units: readonly ProcedureUnit[] = PROCEDURE_UNITS,
): string[] {
  return unitItemLoad(boxes, units)
    .filter((l) => l.items.length === 0)
    .map((l) => l.unit);
}

/** 어느 단위도 인용하지 않는 항목 — §3 1~8단계 **본 절차** 항목이다(문제가 아니다) */
export function unattributedItems(boxes: readonly ChecklistBox[]): number[] {
  return boxes.filter((b) => b.units.length === 0).map((b) => b.index);
}

export interface ScopePlan {
  /** 범위 기록이 덮는 단위를 인용하는 항목 */
  inScope: number[];
  /** 범위에 **없는** 단위만 인용하는 항목 — 이번 수행에서 빠진다 */
  outOfScope: number[];
  /** 단위를 인용하지 않는 항목 — 본 절차라 범위와 무관하게 수행한다 */
  unattributed: number[];
  note: string;
}

/**
 * 범위 기록(소절 목록)을 **항목 목록으로 풀어 준다**. 기록이 없으면 전 항목을
 * `outOfScope` 로 돌리지 않고 `null` 쪽 설명을 붙인다 — **임의 범위 금지**(§6-2 와 같은 규율).
 */
export function checklistScopePlan(
  boxes: readonly ChecklistBox[],
  record: { units?: readonly string[] } | null | undefined,
): ScopePlan {
  const unattributed = unattributedItems(boxes);
  const declared = new Set((record?.units ?? []).map((u) => String(u)));
  if (declared.size === 0) {
    return {
      inScope: [],
      outOfScope: [],
      unattributed,
      note: '범위 기록이 없다 — 어느 항목이 덮였는지 판정 보류다(§6-2 `unrecorded`). 전 항목을 「빠졌다」로도 올리지 않는다',
    };
  }
  const attributed = boxes.filter((b) => b.units.length > 0);
  return {
    inScope: attributed.filter((b) => b.units.some((u) => declared.has(u))).map((b) => b.index),
    outOfScope: attributed.filter((b) => !b.units.some((u) => declared.has(u))).map((b) => b.index),
    unattributed,
    note: '범위에 적힌 소절을 인용하는 항목만 `inScope` 다 — 수행 여부가 아니라 **적힌 범위**를 푼 것이다',
  };
}

/* ─────────────────── 어긋남의 방향 ─────────────────── */

export interface ChecklistDrift {
  key: string;
  when: string;
  /** 누가 알아채는가 */
  who: string;
}

export const CHECKLIST_DRIFTS: readonly ChecklistDrift[] = [
  {
    key: 'ticks_outlive_the_run',
    when: '수행 중 체크한 칸이 그대로 커밋돼 판본이 된다',
    who: '2026-10-23 까지 **아무도** — 전 판정이 env·표만 본다. 이제 `auditBoxesOpen` 이 CI 에서 잡는다',
  },
  {
    key: 'items_appended_after_ticks',
    when: '배치가 항목을 **뒤에** 덧붙여 앞은 `[x]`, 새 항목만 `[ ]` 로 남는다',
    who: '아무도 — §6-2 는 소절만 세므로 항목이 늘어난 사실이 체크 상태에 가려진다',
  },
  {
    key: 'box_state_dropped_at_parse',
    when: '§6-3 추출이 칸의 글자를 다시 접어 버린다(`[ xX]` 꼴로 되돌아간다)',
    who: '`auditBoxStateKept`(CI) — 접히면 체크를 읽는 판정이 영구히 사라지는데 응답은 그대로 돈다',
  },
];

/* ─────────────────────────── 판정 ─────────────────────────── */

export const CHECKLIST_VERDICTS = ['no_checklist', 'all_checked', 'carried_over', 'unreadable_box', 'ok'] as const;

export type ChecklistVerdict = (typeof CHECKLIST_VERDICTS)[number];

const ACTION: Record<ChecklistVerdict, string> = {
  no_checklist:
    `저장소 문서에서 「${CHECKLIST_HEADING}」 구간을 찾을 수 없다 — **「항목이 없다」가 아니라 판정 불가다.** ` +
    '제목이 바뀌었거나 구간이 사라졌는지 본다(같은 구간을 읽는 §6-3 인용 대조와 §6-2 `cited` 판정도 함께 멈춘다).',
  all_checked:
    '**전 항목이 체크돼 있다** — 다음 리허설·다음 사건 복구가 이 체크를 그대로 물려받는다. ' +
    `칸을 전부 \`- [ ]\` 로 되돌리고, 수행 기록은 ${RECORD_HOMES_NOTE} 에만 남긴다(§6-9). ` +
    '수행할 때는 이 목록을 **복사해** 복사본에 체크한다(보관은 저장소 밖 — §3-5 와 같은 규율).',
  carried_over:
    '**체크가 남아 있는 칸이 있다** — 저장소 파일은 판본이고 수행 단위로 복사되지 않으므로, 그 칸은 ' +
    '다음 수행에서 「이미 했다」로 읽힌다(체크에는 일자·유형이 없어 어느 수행의 것인지도 말하지 못한다). ' +
    `칸을 \`- [ ]\` 로 되돌리고 수행 기록은 ${RECORD_HOMES_NOTE} 에만 남긴다(§6-9).`,
  unreadable_box:
    '칸 안의 글자를 **판독할 수 없다**(`- []`·`- [-]` 꼴) — 깃허브는 체크박스로 그리지 않고, ' +
    '§6-3 추출은 2026-10-23 까지 그 줄을 **항목으로 세지도 않았다**(단위 인용 대조에서 조용히 빠진다). ' +
    '`- [ ]` 로 고친다.',
  ok: `판본의 칸이 전부 비어 있다 — 수행할 때는 복사본에 체크하고 기록은 ${RECORD_HOMES_NOTE} 에 남긴다(§6-9).`,
};

const VERDICT_NOTE: Record<ChecklistVerdict, string> = {
  no_checklist: '구간을 못 찾았다 — 판정 불가다',
  all_checked: '판본이 전부 체크돼 있다',
  carried_over: '지난 수행의 체크가 남아 있다',
  unreadable_box: '항목으로 세어지지 않는 칸이 있다',
  ok: '판본이 깨끗하다',
};

export const CHECKLIST_LIMITS: readonly string[] = [
  '이 판정은 **저장소 파일만 본다** — 런타임은 문서를 읽지 않으므로 `/api/health` 에는 체크 상태가 나오지 않는다(없는 신호를 만들지 않았다)',
  '빈 칸이 「수행하지 않았다」는 뜻이 아니고 체크가 「수행했다」는 뜻도 아니다 — 이 판정이 말하는 것은 **판본이 깨끗한가**뿐이다',
  '복사본에 체크했는지·그 복사본을 보관했는지는 **저장소 밖**이라 말하지 못한다(§3-5 의 조사 근거와 같은 한계다)',
  '단위 귀속은 항목 본문이 **소절 번호를 인용하는지**로만 본다(§6-2 와 같은 규칙) — 번호를 인용하지 않는 항목은 어느 단위에도 귀속되지 않는다(§3 1~8단계 본 절차 항목이다)',
  '항목 수·단위별 항목 수는 **문서 상태**다 — 그 항목을 사람이 수행했는지는 말하지 않는다(수행은 §6-2 범위·§6-5 미통과가 말하고, 그조차 「적었다」까지다)',
  '`- [a](link)` 처럼 한 글자 괄호로 시작하는 불릿도 **판독 불가 칸**으로 보고된다 — 체크리스트 구간에는 링크 불릿을 두지 않는다',
  '체크 칸을 비워 두게 한 것이 「체크리스트가 지켜졌다」는 뜻은 아니다 — 수행 자체는 사람 몫이고, 이 장치는 **판본이 거짓 근거가 되는 길**만 막는다',
];

export interface ChecklistAssessment {
  verdict: ChecklistVerdict;
  /** 무엇을 보고 판정했는가 — 저장소 문서다(런타임 응답이 아니다) */
  basis: 'repository';
  heading: string;
  /** 전체 항목 수(구간을 못 찾으면 0) */
  total: number;
  open: number;
  /** 체크된 항목 번호 — 판정이 하나를 고르더라도 **둘 다** 내보낸다 */
  checkedItems: number[];
  /** 판독할 수 없는 칸의 항목 번호 */
  unreadableItems: number[];
  /** 판독 불가 칸의 글자(원문. 개수만으로는 무엇을 고쳐야 할지 모른다) */
  unreadableMarks: string[];
  /** 단위를 인용하지 않는 항목 수 */
  unattributed: number;
  /** 항목이 하나도 없는 단위 */
  unitsWithoutItems: string[];
  action: string;
  caveats: readonly string[];
}

/**
 * 판정 순서: 구간 없음 → **전부 체크** → 일부 체크 → 판독 불가 칸 → ok.
 *
 * 체크가 남은 것을 먼저 말한다 — 그것이 다음 수행을 **건너뛰게** 만드는 상태다. 판독 불가
 * 칸은 그 뒤에 말하지만 `unreadableItems` 는 **언제나** 함께 내보낸다(하나가 다른 하나를
 * 덮으면 둘 중 하나는 영구히 안 보인다. §3-11 과 같은 규율).
 */
export function assessChecklist(
  runbookSrc: unknown,
  units: readonly ProcedureUnit[] = PROCEDURE_UNITS,
): ChecklistAssessment {
  const boxes = parseChecklistBoxes(runbookSrc, units);
  const shell = {
    basis: 'repository' as const,
    heading: CHECKLIST_HEADING,
    caveats: CHECKLIST_LIMITS,
  };
  if (boxes === null) {
    return {
      ...shell,
      verdict: 'no_checklist',
      total: 0,
      open: 0,
      checkedItems: [],
      unreadableItems: [],
      unreadableMarks: [],
      unattributed: 0,
      unitsWithoutItems: [],
      action: ACTION.no_checklist,
    };
  }

  const checkedItems = boxes.filter((b) => b.state === 'checked').map((b) => b.index);
  const unreadable = boxes.filter((b) => b.state === 'unreadable');
  const open = boxes.filter((b) => b.state === 'open').length;
  const body = {
    ...shell,
    total: boxes.length,
    open,
    checkedItems,
    unreadableItems: unreadable.map((b) => b.index),
    unreadableMarks: [...new Set(unreadable.map((b) => b.mark))],
    unattributed: unattributedItems(boxes).length,
    unitsWithoutItems: unitsWithoutItems(boxes, units),
  };
  const verdict: ChecklistVerdict =
    boxes.length > 0 && checkedItems.length === boxes.length
      ? 'all_checked'
      : checkedItems.length > 0
        ? 'carried_over'
        : unreadable.length > 0
          ? 'unreadable_box'
          : 'ok';
  return { ...body, verdict, action: ACTION[verdict] };
}

/* ───────────────────────────── 출력 ───────────────────────────── */

/** 사람이 읽는 요약 — **수치를 지어내지 않는다** */
export function checklistText(a: ChecklistAssessment): string {
  const head = `${a.verdict}(${VERDICT_NOTE[a.verdict]}) · basis=${a.basis}`;
  const body =
    a.verdict === 'no_checklist'
      ? `「${a.heading}」 구간을 찾지 못했다`
      : `항목 ${a.total} · 비어 있음 ${a.open} · 체크 ${a.checkedItems.length} · 판독 불가 ${a.unreadableItems.length}` +
        (a.checkedItems.length > 0 ? `\n체크된 항목: ${a.checkedItems.join(',')}` : '') +
        (a.unreadableItems.length > 0 ? `\n판독 불가 항목: ${a.unreadableItems.join(',')}` : '');
  return `${head}\n${body}\n${a.action}`;
}

/** 구조화 로그 한 줄 — **판정·개수만**(항목 본문·담당·비고 없음) */
export function checklistLogLine(a: ChecklistAssessment): string {
  return [
    'recovery_rehearsal_checklist',
    `verdict=${a.verdict}`,
    `basis=${a.basis}`,
    `total=${a.total}`,
    `checked=${a.checkedItems.length}`,
    `unreadable=${a.unreadableItems.length}`,
  ].join(' ');
}

/** 명령용 요약(저장소에서만 쓴다 — 공개 엔드포인트가 없다) */
export function checklistStatus(runbookSrc: unknown): {
  verdict: ChecklistVerdict;
  total: number;
  text: string;
  line: string;
} {
  const a = assessChecklist(runbookSrc);
  return { verdict: a.verdict, total: a.total, text: checklistText(a), line: checklistLogLine(a) };
}

/* ─────────────────────────── 정적 점검(CI) ─────────────────────────── */

/**
 * **이 장치의 핵심** — 판본의 칸이 전부 비어 있는지. 체크가 커밋되는 순간 CI 가 실패한다.
 *
 * 체크는 어느 응답도 바꾸지 않으므로(전 판정이 env·표만 본다) 이 점검이 없으면 영구히 남는다.
 */
export function auditBoxesOpen(runbookSrc: unknown, units: readonly ProcedureUnit[] = PROCEDURE_UNITS): string[] {
  const a = assessChecklist(runbookSrc, units);
  const problems: string[] = [];
  if (a.verdict === 'no_checklist') {
    problems.push(`RUNBOOK 에서 「${CHECKLIST_HEADING}」 구간을 찾을 수 없다 — 칸 상태를 판정할 수 없다`);
    return problems;
  }
  if (a.total === 0) problems.push(`「${CHECKLIST_HEADING}」 구간에 항목이 없다 — 체크리스트가 사라졌는지 본다`);
  if (a.checkedItems.length > 0) {
    problems.push(
      `체크리스트 항목 ${a.checkedItems.join(',')} 가 체크된 채 저장소에 들어 있다 — ` +
        `판본은 수행 단위로 복사되지 않으므로 다음 리허설·다음 사건 복구가 그 체크를 물려받는다(${RECORD_HOMES_NOTE} 에만 기록한다)`,
    );
  }
  for (const b of a.unreadableItems) {
    problems.push(`체크리스트 항목 ${b} 의 칸을 판독할 수 없다 — \`- [ ]\` 로 고친다(그 줄은 항목 인용 대조에서 빠진다)`);
  }
  return problems;
}

/** 머리말이 **판본 규율**을 적고 있는지 — 문구가 사라지면 체크가 다시 「기록」으로 쓰인다 */
export function auditChecklistInstruction(md: unknown): string[] {
  const s = String(md ?? '');
  const section = checklistSection(s);
  if (section === null) return [`RUNBOOK 에서 「${CHECKLIST_HEADING}」 구간을 찾을 수 없다`];
  const head = section.split(/^\s*-\s*\[/m)[0];
  const problems: string[] = [];
  if (!/저장소 파일의 칸에는 체크하지 않는다/.test(head)) {
    problems.push('체크리스트 머리말이 「저장소 파일의 칸에는 체크하지 않는다」를 적지 않는다 — 체크가 판본이 되는 길이 다시 열린다');
  }
  if (!/임의로 채우지 않는다/.test(head)) {
    problems.push('체크리스트 머리말에 「임의로 채우지 않는다」가 없다 — §6 표에만 있던 보호가 칸에는 없던 것이 §6-9 의 출발점이다');
  }
  if (!/6-9/.test(head)) problems.push('체크리스트 머리말이 §6-9 를 가리키지 않는다 — 판정·명령을 찾을 수 없다');
  if (!/복사/.test(head)) problems.push('체크리스트 머리말이 **복사해서 쓴다**는 수행 방법을 적지 않는다 — 칸을 비우라고만 하면 적을 곳이 없다');
  return problems;
}

/**
 * §6-3 추출이 칸의 글자를 **버리지 않는지**. 접히면 체크를 읽는 판정이 영구히 사라지는데
 * 응답은 그대로 돈다(§6-8 이 `kindRaw` 로 고친 것과 같은 자리다).
 */
export function auditBoxStateKept(observationSrc: unknown): string[] {
  const s = String(observationSrc ?? '');
  const problems: string[] = [];
  if (s.includes('\\[[ xX]\\]')) {
    problems.push('체크리스트 추출이 칸의 글자를 세 값으로 접는 정규식(`[ xX]`)으로 되돌아갔다 — `[ ]` 와 `[x]` 가 같은 항목이 된다');
  }
  if (!/mark/.test(s)) problems.push('`ChecklistItem` 이 칸의 글자 원문(`mark`)을 담지 않는다 — 체크 상태를 되살릴 수 없다');
  if (!/checked/.test(s)) problems.push('`ChecklistItem` 이 `checked` 를 담지 않는다');
  // 정규식 원문 그대로 찾는다 — 칸 안의 글자를 **잡아 두는** 꼴인지만 본다
  if (!s.includes('([^\\]]?)')) {
    problems.push('체크리스트 추출 정규식이 칸 안의 글자를 **잡아 두지 않는다** — 판독 불가 칸이 다시 항목에서 빠진다');
  }
  return problems;
}

/**
 * 단위 인용 규칙이 §6-2 와 **같은지**. 다르면 `cited` 선언과 항목 수가 서로 다른 말을 한다
 * (한쪽은 「인용된다」, 다른 쪽은 「항목 0개」 — 어느 쪽도 오류를 내지 않는다).
 */
export function auditCitationRule(coverageSrc: unknown): string[] {
  const s = String(coverageSrc ?? '');
  const problems: string[] = [];
  if (!s.includes('(?<!\\\\d)')) problems.push('§6-2 인용 탐지가 숫자 경계(`(?<!\\d)`)를 쓰지 않는다 — 규칙이 갈라졌다');
  if (!s.includes('(?!\\\\d|단계)')) {
    problems.push('§6-2 인용 탐지가 「단계」 표기를 제외하지 않는다 — §6-1 이 늘 인용된 것으로 보인다');
  }
  return problems;
}

/** §6-9 가 **문서에 남아 있는지**와 판정 어휘를 적고 있는지 */
export function auditRunbookChecklistSection(md: unknown): string[] {
  const s = String(md ?? '');
  const problems: string[] = [];
  if (!/^###\s*6-9\./m.test(s)) problems.push('RUNBOOK 에 §6-9 소절이 없다 — 판정의 근거 절이 사라졌다');
  for (const v of CHECKLIST_VERDICTS) {
    if (!s.includes(`\`${v}\``)) problems.push(`§6-9 판정 표에 \`${v}\` 가 없다`);
  }
  if (!/rehearsalChecklist/.test(s)) problems.push('§6-9 가 판정 모듈(`lib/rehearsalChecklist.ts`)을 가리키지 않는다');
  for (const m of CHECKLIST_MISREADS) {
    if (!s.includes(`\`${m.key}\``)) problems.push(`§6-9 가 거짓이 되는 판정 \`${m.key}\` 를 적지 않는다`);
  }
  return problems;
}

/** 정본 자신의 모양 — 사유 없는 선언을 두지 않는다 */
export function auditChecklistCanon(
  homes: readonly ChecklistHome[] = CHECKLIST_HOMES,
  misreads: readonly ChecklistMisread[] = CHECKLIST_MISREADS,
  drifts: readonly ChecklistDrift[] = CHECKLIST_DRIFTS,
): string[] {
  const problems: string[] = [];
  if (!homes.some((h) => !h.perRun)) problems.push('수행 단위로 복사되지 않는 기록(= 체크 칸)이 정본에서 사라졌다');
  if (!homes.some((h) => h.perRun)) problems.push('수행 기록의 집이 정본에서 사라졌다 — 체크 칸 말고 어디에 적는지를 적어 둔다');
  for (const h of homes) {
    if (!h.what.trim() || !h.home.trim() || !h.readBy.trim() || !h.ifUsedAsRecord.trim()) {
      problems.push(`기록의 집 「${h.what}」 에 빈 칸이 있다`);
    }
  }
  const keys = new Set<string>();
  for (const m of misreads) {
    if (!m.key.trim() || !m.judgement.trim() || !m.says.trim() || !m.why.trim()) problems.push(`거짓 판정 ${m.key} 에 빈 칸이 있다`);
    if (keys.has(m.key)) problems.push(`거짓 판정 키가 겹친다: ${m.key}`);
    keys.add(m.key);
  }
  for (const d of drifts) {
    if (!d.key.trim() || !d.when.trim() || !d.who.trim()) problems.push(`어긋남 ${d.key} 에 빈 칸이 있다`);
  }
  return problems;
}

/**
 * 이 모듈이 **런타임 체크를 만들지 않았는지**. 체크 상태는 저장소에만 있는데 `/api/health`
 * 에 싣는 순간 그 응답은 **문서를 본 적 없는 판정**이 된다(`basis` 를 적을 수조차 없다).
 */
export function auditNoRuntimeCheck(healthSrc: unknown): string[] {
  const s = String(healthSrc ?? '');
  return /rehearsalChecklist/.test(s)
    ? ['`/api/health` 가 체크리스트 판정을 싣고 있다 — 런타임은 저장소 문서를 읽지 않으므로 그 응답은 거짓 보증이 된다(§6-9 는 CI·저장소 명령으로만 판정한다)']
    : [];
}
