/**
 * recoveryObjectives.ts — 절차의 **약속**(RTO/RPO)과 실측의 대조(RUNBOOK §1 · §1-2). 2026-10-20
 *
 * ── 왜 필요한가 ───────────────────────────────────────────────────────────────
 * 앞 배치들이 §1·§2·§3 1~8단계·§4·§5·§6 을 소절 20개로 쪼개 전부 기계적으로 판정하게 만들었다.
 * 그 판정들이 말하는 것은 하나같이 **「그 단계를 했는가」**다. 그런데 이 절차가 지키기로 한 것은
 * 단계가 아니라 수치 두 개다 — §1 의 **목표 복구시간(RTO)·목표 복구시점(RPO)**. 그리고 그 칸은
 * 작성 이후 줄곧 `[확인 필요 — 계약 확정 후 기재]` 로 비어 있다.
 *
 *  (1) **비어 있다는 사실이 어디에도 드러나지 않았다.** §1 의 다른 `[확인 필요]`(PITR 보존기간)는
 *      배치183 이 `checks.recoveryWindow` 로 평상시에 드러내게 했고, 그래서 복구일이 아니라
 *      평상시에 사람을 찌른다. 목표치 칸에는 그런 장치가 없다 — 읽는 코드가 하나도 없으므로
 *      **영구히 비어 있어도 전 응답이 `ok` 다.** 가장 조용한 방향이다(아무것도 나빠지지 않는다).
 *
 *  (2) **그래서 어떤 판정도 「늦었다」·「많이 잃었다」를 말하지 못한다.** §3-7 은 유실 구간을
 *      분으로 확정하고(`assessLossWindow.minutes`) §3-10 은 그 구간을 **되돌릴 수 없는 고지**로
 *      내보내는데, 그 수치가 **약속을 넘겼는지**는 아무도 판정하지 않는다. 고지문에는 구간만
 *      적히고 「약속은 얼마였는가」가 없다 — 받는 쪽은 그것이 예정된 범위인지 알 수 없고,
 *      넘긴 복구와 지킨 복구가 **기록에서 구별되지 않는다.**
 *
 *  (3) **실측과 목표가 만나는 자리가 없었다.** §6-4 가 적어 둔 그대로다 — 소요시간은 §6 표에만
 *      살고(`LEDGER_FIELDS.duration.judgedBy: null` = 적히지만 **읽는 판정이 없다**) 목표치는
 *      어디에도 없으니, 리허설을 열 번 해도 「목표 안에 끝났는가」는 한 번도 계산되지 않는다.
 *
 *  (4) **목표를 적는 순간 생기는 더 조용한 구멍** — 이미 사람이 넣은 설정값들이 목표의 상한·
 *      해상도를 정해 버린다. ⓐ RTO 가 PITR 보존 창(`RECOVERY_PITR_RETENTION_HOURS`)보다 길면,
 *      목표 시간 안에 끝내도 그 사이 **T 가 창 밖으로 밀려** 복구 자체가 불가능해진다(§3-6 의
 *      `deadline` 이 그 전진을 수치로 적어 둔 바로 그 구간이다). ⓑ RPO 가 기준 스냅샷 갱신 기한
 *      (`RECOVERY_BASELINE_MAX_AGE_DAYS`)보다 짧으면, 복구 뒤 §3 4단계 대조로는 그 목표를 지켰는지
 *      **확인할 방법이 없다**(§4-10 `blindWindow` 가 그 사각 구간이다 — 스냅샷 이후 생긴 행의
 *      유실은 「기준치 이상」을 그대로 통과한다). 둘 다 **선언만으로 달성 불가능한 약속**이고,
 *      어느 쪽도 오류를 내지 않는다.
 *
 * 그래서 이 모듈은
 *   · 목표 2건을 **정본**으로 두고(`OBJECTIVES` — 약속의 내용 · 실측을 만드는 곳 · 그 실측이
 *     사는 집 · 비어 있으면 조용히 생기는 일),
 *   · 값은 **env 에서만** 읽고(`RECOVERY_RTO_MINUTES`·`RECOVERY_RPO_MINUTES`) 미설정을 추측하지
 *     않으며(`unset` — 임의 목표치 금지),
 *   · 설정끼리의 모순을 대조하고(`assessFeasibility` → `rto_exceeds_retention`·
 *     `rpo_below_baseline_resolution`. 상대 설정값을 모르면 **모순 없음으로 올리지 않고**
 *     `unjudgedConflicts` 로 남긴다),
 *   · 실측과 대조하고(`compareToObjective` → `met` · `exceeded` · **`unjudged`** · **`unreadable`**.
 *     RPO 실측은 §3-7 구간, RTO 실측은 §6 표 소요시간이다),
 *   · 그 상태를 `/api/health` 로 드러낸다(`recoveryObjectivesCheck` — **required: false**).
 *
 * 원칙
 * - 순수 모듈: DB·next·fs 미접근, **신규 조회·쓰기·DDL 0**. env 는 인자로 받는다(기본값만 process.env).
 * - **임의 수치 금지.** 목표치·보존기간·기한의 기본값을 만들지 않는다. 업계 관행(RTO 4시간 등)을
 *   코드가 들고 오지 않는다 — 비어 있으면 `unset`(= 「약속이 없다」)이고 판정을 지어내지 않는다.
 * - **판독 불가는 통과가 아니다.** 실측을 못 읽으면 `unreadable` 로 남기고 `met` 으로 올리지 않는다.
 * - **공개 응답에 수치를 담지 않는다.** 목표 분·실측 분·초과 분은 전부 응답에서 제외하고 판정·키
 *   이름·boolean 만 담는다(무인증 응답이다 — 구간 수치는 §3-10 이 이미 같은 이유로 뺐다).
 * - **중복 보고 금지.** 구간 자체의 판정은 §3-7 이 하고 여기서 다시 만들지 않는다 — 이 모듈이
 *   더하는 것은 「그 구간이 약속을 넘겼는가」 하나뿐이다.
 */

import { assessLossWindow, freezeAtFromEnv } from './incidentClosure.ts';
import { restorePointFromEnv } from './lossNotice.ts';
import { baselineMaxAgeDays } from './recoveryBaseline.ts';
import { retentionHours } from './recoveryWindow.ts';
import { latestLedgerRow, parseLedgerTable, type LedgerField, type LedgerRow } from './rehearsalLedger.ts';
import { kindState, measurementOrigin, roleFor, type KindState, type MeasurementOrigin } from './rehearsalKind.ts';
import { attainmentEligibility, type AttainmentEligibility } from './rehearsalOutcome.ts';

/** 응답·문서에서 근거 절을 찾을 수 있게 한다 */
export const OBJECTIVES_RUNBOOK_REF = 'RUNBOOK §1 · §1-2';

/** 목표 복구시간(분). **평상시 미설정이 §1 `[확인 필요]` 그대로의 상태다** */
export const RTO_ENV = 'RECOVERY_RTO_MINUTES';

/** 목표 복구시점 = 허용 유실 시간(분). 같은 규율 */
export const RPO_ENV = 'RECOVERY_RPO_MINUTES';

const MIN_PER_HOUR = 60;
const MIN_PER_DAY = 1440;

/** 오타 방어용 상한(1년). **기본값이 아니다** — 미설정은 끝까지 미설정이다 */
const MAX_OBJECTIVE_MIN = 525600;

/* ─────────────────────────── 목표 정본(2건) ─────────────────────────── */

export type ObjectiveKey = 'rto' | 'rpo';

/** 실측이 사는 집 — 런타임이 볼 수 있는가를 가른다 */
export type MeasureHome = 'env' | 'table';

export interface Objective {
  key: ObjectiveKey;
  /** §1 표기 */
  label: string;
  envKey: string;
  /** 무엇을 약속하는가 */
  promise: string;
  /** 그 약속의 **실측**을 만드는 곳 */
  measuredBy: string;
  /** 그 실측이 사는 집. `table` 이면 런타임은 보지 못한다(§6-4 와 같은 규율) */
  measureHome: MeasureHome;
  /** 비어 있는 동안 조용히 생기는 일 */
  blank: string;
}

export const OBJECTIVES: readonly Objective[] = [
  {
    key: 'rto',
    label: '목표 복구시간(RTO)',
    envKey: RTO_ENV,
    promise: '중단 결정(§3 1단계)부터 쓰기 차단 해제(§3 7단계)까지 **몇 분 안에** 서비스를 되돌릴 것인가',
    measuredBy: 'lib/incidentClosure.ts assessDuration(1단계 중단 결정 ~ 7단계 해제) → §6 표 `소요시간` 열',
    measureHome: 'table',
    blank:
      '리허설을 몇 번 해도 「목표 안에 끝났는가」가 계산되지 않는다 — 소요시간은 표에 쌓이고(읽는 판정이 없다) ' +
      '§1 은 비어 있어, 두 시간짜리 리허설과 이틀짜리 리허설이 §6 표에서 똑같이 `정상` 으로 남는다',
  },
  {
    key: 'rpo',
    label: '목표 복구시점(RPO)',
    envKey: RPO_ENV,
    promise: '복구 시점(T-ε)부터 쓰기 차단까지 **몇 분 분량의 쓰기**까지 잃어도 되는가',
    measuredBy: 'lib/incidentClosure.ts assessLossWindow(§3-7 유실 구간) → §3-10 고지 문구',
    measureHome: 'env',
    blank:
      '되돌릴 수 없는 고지에 구간만 적히고 「약속은 얼마였는가」가 없다 — 받는 쪽은 그것이 예정된 범위인지 ' +
      '알 수 없고, 약속을 넘긴 복구와 지킨 복구가 기록에서 구별되지 않는다',
  },
];

/** 모르는 키는 null — 지어내지 않는다 */
export function objectiveFor(key: unknown): Objective | null {
  const k = String(key ?? '').trim();
  return OBJECTIVES.find((o) => o.key === k) ?? null;
}

/* ─────────────────────────── 값 읽기(env 만) ─────────────────────────── */

/**
 * - `unset`   : 키가 없다(**평상시** — §1 `[확인 필요]` 와 같은 상태다).
 * - `blank`   : 키는 있는데 공백뿐이다 — 대시보드에는 「있다」로 보인다.
 * - `invalid` : 값이 있는데 분 정수로 읽히지 않는다(`4h`·`4시간`·`0`·음수·소수).
 * - `set`     : 분 정수로 읽혔다.
 */
export type ObjectiveState = 'unset' | 'blank' | 'invalid' | 'set';

export interface ObjectiveValue {
  key: ObjectiveKey;
  envKey: string;
  state: ObjectiveState;
  /** 분. `set` 이 아니면 null — 추측하지 않는다 */
  minutes: number | null;
}

/**
 * **분 정수만** 인정한다. `4h`·`4시간`·`240m` 같은 표기는 받지 않는다(`invalid`) —
 * 키 이름이 `_MINUTES` 이고, 단위를 코드가 해석해 주기 시작하면 「4」가 4분인지 4시간인지
 * 모르는 값이 들어온다. `0` 도 거절한다(0분 복구는 약속이 아니라 오기다).
 */
export function parseObjectiveMinutes(raw: unknown): number | null {
  const s = String(raw ?? '').trim();
  if (!/^\d{1,7}$/.test(s)) return null;
  const n = Number(s);
  return n >= 1 && n <= MAX_OBJECTIVE_MIN ? n : null;
}

function readObjective(env: Record<string, string | undefined>, o: Objective): ObjectiveValue {
  const raw = env[o.envKey];
  if (raw === undefined) return { key: o.key, envKey: o.envKey, state: 'unset', minutes: null };
  if (!raw.trim()) return { key: o.key, envKey: o.envKey, state: 'blank', minutes: null };
  const minutes = parseObjectiveMinutes(raw);
  return minutes === null
    ? { key: o.key, envKey: o.envKey, state: 'invalid', minutes: null }
    : { key: o.key, envKey: o.envKey, state: 'set', minutes };
}

/** 목표 2건의 설정 상태. **값을 돌려주지만 응답에는 담지 않는다**(아래 `recoveryObjectivesCheck`) */
export function objectivesFromEnv(
  env: Record<string, string | undefined> = process.env,
): Record<ObjectiveKey, ObjectiveValue> {
  // 스캔이 찾을 수 있도록 리터럴로 한 번 읽는다(정본은 위 상수다).
  const literal: Record<string, string | undefined> = {
    [RTO_ENV]: env.RECOVERY_RTO_MINUTES,
    [RPO_ENV]: env.RECOVERY_RPO_MINUTES,
  };
  return {
    rto: readObjective(literal, OBJECTIVES[0]),
    rpo: readObjective(literal, OBJECTIVES[1]),
  };
}

/* ───────────────────── 설정끼리의 모순(달성 가능성) ───────────────────── */

export const CONFLICT_KINDS = ['rto_exceeds_retention', 'rpo_below_baseline_resolution'] as const;
export type ConflictKind = (typeof CONFLICT_KINDS)[number];

export interface Conflict {
  kind: ConflictKind;
  /** 무엇이 어긋났는가(수치는 호출자가 본다 — 응답에는 종류만 나간다) */
  how: string;
  fix: string;
}

const CONFLICT_TEXT: Record<ConflictKind, Omit<Conflict, 'kind'>> = {
  rto_exceeds_retention: {
    how:
      '목표 복구시간이 PITR 보존 창보다 길다 — 목표 안에 끝내도 그 사이 손상 시각 T 가 창 밖으로 밀려 ' +
      '복구 자체가 불가능해진다(§3-6 `deadline` 이 그 전진을 수치로 적는다). 선언만으로 달성 불가능한 약속이다',
    fix: `보존 창(\`RECOVERY_PITR_RETENTION_HOURS\`)을 늘리거나(플랜 변경) 목표(\`${RTO_ENV}\`)를 창 안으로 줄인다`,
  },
  rpo_below_baseline_resolution: {
    how:
      '허용 유실 시간이 기준 스냅샷 갱신 기한보다 짧다 — 복구 뒤 §3 4단계 행 수 대조는 **스냅샷 시점까지**만 ' +
      '보장하므로(§4-10 `blindWindow`) 그 목표를 지켰는지 확인할 경로가 없다. 지켜도 증명되지 않는 약속이다',
    fix: `스냅샷 갱신 기한(\`RECOVERY_BASELINE_MAX_AGE_DAYS\`)을 목표 안으로 줄이거나(§2 점검 주기) 목표(\`${RPO_ENV}\`)를 그 해상도에 맞춘다`,
  },
};

export function conflictText(kind: unknown): Conflict | null {
  const k = String(kind ?? '');
  const found = CONFLICT_KINDS.find((c) => c === k);
  return found ? { kind: found, ...CONFLICT_TEXT[found] } : null;
}

export interface FeasibilityInput {
  rtoMinutes: number | null;
  rpoMinutes: number | null;
  /** PITR 보존 창(시간). 모르면 null — **대조하지 않는다** */
  retentionHours: number | null;
  /** 기준 스냅샷 갱신 기한(일). 모르면 null */
  baselineMaxAgeDays: number | null;
}

export interface Feasibility {
  conflicts: ConflictKind[];
  /** 상대 설정값을 몰라 **하지 못한** 대조 — 「모순 없음」으로 올리지 않는다 */
  unjudged: string[];
}

/**
 * 목표와 다른 설정값의 모순을 본다. **상대 값을 모르면 통과시키지 않고 미판정으로 남긴다** —
 * 「대조했는데 문제 없었다」와 「대조하지 못했다」는 다르다.
 */
export function assessFeasibility(input: FeasibilityInput): Feasibility {
  const conflicts: ConflictKind[] = [];
  const unjudged: string[] = [];

  if (input.rtoMinutes === null) {
    unjudged.push(`rto_exceeds_retention: 목표(${RTO_ENV})가 없어 대조하지 않았다`);
  } else if (input.retentionHours === null) {
    unjudged.push('rto_exceeds_retention: 보존 창(RECOVERY_PITR_RETENTION_HOURS)을 몰라 대조하지 않았다');
  } else if (input.rtoMinutes > input.retentionHours * MIN_PER_HOUR) {
    conflicts.push('rto_exceeds_retention');
  }

  if (input.rpoMinutes === null) {
    unjudged.push(`rpo_below_baseline_resolution: 목표(${RPO_ENV})가 없어 대조하지 않았다`);
  } else if (input.baselineMaxAgeDays === null) {
    unjudged.push('rpo_below_baseline_resolution: 스냅샷 기한(RECOVERY_BASELINE_MAX_AGE_DAYS)을 몰라 대조하지 않았다');
  } else if (input.rpoMinutes < input.baselineMaxAgeDays * MIN_PER_DAY) {
    conflicts.push('rpo_below_baseline_resolution');
  }

  return { conflicts, unjudged };
}

/* ───────────────────────────── 실측과의 대조 ───────────────────────────── */

export const ATTAINMENTS = ['met', 'exceeded', 'unjudged', 'unreadable'] as const;
export type Attainment = (typeof ATTAINMENTS)[number];

export interface AttainmentResult {
  key: ObjectiveKey;
  attainment: Attainment;
  /** 목표(분). 없으면 null */
  targetMinutes: number | null;
  /** 실측(분). 없거나 판독 못 했으면 null */
  measuredMinutes: number | null;
  /** 초과분(분). `exceeded` 일 때만 */
  overBy: number | null;
  note: string;
}

const isMeasure = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;

/**
 * 실측 하나를 목표와 견준다. **같으면 `met`** 이고, 목표나 실측이 없으면 `unjudged`(판정 보류),
 * 실측이 수치로 읽히지 않으면 `unreadable` 이다 — **`met` 으로 올리지 않는다.**
 */
export function compareToObjective(key: ObjectiveKey, targetMinutes: number | null, measured: unknown): AttainmentResult {
  const shell = { key, targetMinutes, measuredMinutes: null, overBy: null };
  if (measured === null || measured === undefined) {
    return { ...shell, attainment: 'unjudged', note: '실측이 없어 판정하지 않았다(리허설·사건에서만 생긴다)' };
  }
  if (!isMeasure(measured)) {
    return { ...shell, attainment: 'unreadable', note: '실측을 수치로 읽을 수 없어 판정하지 않았다 — 통과가 아니다' };
  }
  const m = Math.round(measured);
  if (targetMinutes === null) {
    return {
      ...shell,
      measuredMinutes: m,
      attainment: 'unjudged',
      note: `목표(${objectiveFor(key)?.envKey ?? ''})가 없어 실측을 견줄 대상이 없다`,
    };
  }
  if (m <= targetMinutes) {
    return { ...shell, measuredMinutes: m, attainment: 'met', note: '실측이 목표 안이다(이번 한 번에 대한 사실이다)' };
  }
  return {
    ...shell,
    measuredMinutes: m,
    overBy: m - targetMinutes,
    attainment: 'exceeded',
    note: '실측이 목표를 넘겼다 — 고지·사후 기록에 그 사실을 함께 적는다',
  };
}

/** 런타임이 **env 만으로** 알 수 있는 실측 */
export interface MeasuredFromEnv {
  /** §3-7 유실 구간(분). 구간이 확정되지 않으면 null */
  rpoMinutes: number | null;
  /** 런타임은 §6 표를 읽지 않으므로 **항상 null** 이다(그 사실을 숨기지 않는다) */
  rtoMinutes: null;
  /** 왜 RTO 실측이 없는가 */
  rtoNote: string;
}

export const RTO_MEASURE_NOT_IN_ENV =
  'RTO 실측(소요시간)은 §6 표에만 있고 런타임은 저장소 파일을 읽지 않는다 — 대조는 §1-2 명령·CI 가 한다';

export function measuredFromEnv(
  env: Record<string, string | undefined> = process.env,
  now?: Date,
): MeasuredFromEnv {
  const window = assessLossWindow({
    restorePoint: restorePointFromEnv(env).raw ?? undefined,
    frozenAt: freezeAtFromEnv(env).raw ?? undefined,
    now,
  });
  return { rpoMinutes: window.minutes, rtoMinutes: null, rtoNote: RTO_MEASURE_NOT_IN_ENV };
}

/* ───────────────────────────── 종합 판정 ───────────────────────────── */

export const OBJECTIVE_VERDICTS = ['ok', 'unset', 'partial', 'invalid', 'breached', 'infeasible'] as const;
export type ObjectiveVerdict = (typeof OBJECTIVE_VERDICTS)[number];

export const ACTION_OBJ_OK =
  '목표 2건이 적혀 있고 설정과 모순이 없으며 실측도 목표 안이다. `ok` 는 **「약속이 적혀 있다」**까지이고 ' +
  '지킬 수 있다는 뜻이 아니다 — 리허설 소요시간을 §1-2 명령으로 계속 견준다';
export const ACTION_OBJ_UNSET =
  `목표치가 없다 — §1 의 \`[확인 필요]\` 그대로다. 어떤 판정도 「늦었다」·「많이 잃었다」를 말할 수 없고 ` +
  `유실 고지에는 구간만 적힌다. 계약·약관의 수치를 확인해 \`${RTO_ENV}\`·\`${RPO_ENV}\`(분)에 넣고 §1 표기를 함께 채운다 ` +
  '(임의 수치를 코드가 들고 오지 않는다 — 비어 있는 동안은 판정 보류다)';
export const ACTION_OBJ_PARTIAL =
  '목표 한쪽만 적혀 있다 — 나머지 한쪽에 대한 대조는 `unjudged` 로 남는다(통과가 아니다). 두 수치는 함께 정한다';
export const ACTION_OBJ_INVALID =
  `목표 값을 **분 정수**로 읽을 수 없다(\`4h\`·\`4시간\`·\`0\`·소수는 받지 않는다 — 「4」가 분인지 시간인지 ` +
  '모르는 값을 해석해 주지 않는다). 분으로 다시 적는다';
export const ACTION_OBJ_BREACHED =
  '실측이 목표를 넘겼다 — 고지문(§3-10)과 §6 표 비고에 **약속 대비 초과**를 함께 적는다. ' +
  '수치를 깎지 않는다(초과를 적지 않으면 다음 사건에서도 같은 약속이 유지된다)';
export const ACTION_OBJ_INFEASIBLE =
  '목표가 다른 설정값과 모순이다 — 선언만으로 달성(또는 증명)할 수 없는 약속이다. `conflicts` 의 종류별 ' +
  '조치를 §1-2 표에서 보고, 설정과 목표 중 어느 쪽을 고칠지는 사람이 정한다';

const ACTION: Record<ObjectiveVerdict, string> = {
  ok: ACTION_OBJ_OK,
  unset: ACTION_OBJ_UNSET,
  partial: ACTION_OBJ_PARTIAL,
  invalid: ACTION_OBJ_INVALID,
  breached: ACTION_OBJ_BREACHED,
  infeasible: ACTION_OBJ_INFEASIBLE,
};

/** 어긋남이 생기는 세 방향 — 전부 **응답은 200 이라** 사람 눈으로는 알아챌 수 없다 */
export const OBJECTIVE_DRIFTS: readonly { key: string; how: string }[] = [
  {
    key: 'objective_stays_blank',
    how:
      '§1 의 `[확인 필요]` 가 비어 있는 동안 전 절차는 「단계를 했는가」만 말한다 — 약속 대비 늦음·유실은 ' +
      '아무도 말하지 않고, 비어 있다는 사실조차 응답에 나오지 않는다(아무것도 나빠지지 않는 쪽이다)',
  },
  {
    key: 'promise_outgrows_setting',
    how:
      '계약으로 목표가 촘촘해지는데 보존 창·스냅샷 기한 설정은 그대로다 — 목표는 선언만으로 달성 불가능해지고 ' +
      '(또는 지켜도 증명되지 않고) 그 모순은 복구일에야 드러난다',
  },
  {
    key: 'measure_lives_only_in_table',
    how:
      '실측(소요시간)은 §6 표에만 쌓이고 목표는 env 에만 있어 **둘이 만나는 자리가 없다**(§6-4 가 ' +
      '「읽는 판정이 없다」고 적어 둔 그 칸이다) — 리허설을 몇 번 해도 목표 대비 판정은 생기지 않는다',
  },
];

/** 보장하지 **못하는** 것 — 응답·RUNBOOK 에 함께 내보낸다 */
export const OBJECTIVE_LIMITS: readonly string[] = [
  '목표치는 **사람이 적은 계약 수치**다 — 계약·약관이 바뀌어도 코드는 모른다(§2 월 점검에서 함께 확인한다)',
  '`ok` 는 「약속이 적혀 있고 설정과 모순이 없다」까지다 — **지킬 수 있다는 뜻이 아니다**(실측은 리허설·사건에서만 생긴다)',
  `RTO 실측은 §6 표 \`소요시간\` 에만 있어 런타임 \`attainment.rto\` 는 \`unjudged\` 다 — ${RTO_MEASURE_NOT_IN_ENV}`,
  'RPO 실측은 §3-7 구간이고 그 한계가 그대로다 — 구간은 **시간**이고 실제로 잃은 행 수는 아무도 세지 않는다',
  '`met` 은 **이번 한 번**에 대한 사실이다 — 다음 사건의 규모를 말하지 않는다',
  '공개 응답에는 **수치를 담지 않는다**(목표 분·실측 분·초과 분). 판정·키 이름·boolean 뿐이다',
  '약속을 **누구에게** 했는지(계약 상대·약관 조항)는 코드가 모른다 — 고지 대상 판정은 §3-10 이 한다',
  '리허설 선언(§6-1) 중에 잰 구간은 **약속 대조에서 뺀다**(§6-6 `measurementOrigin`) — 연습값으로 `met`·`exceeded` 를 내지 않는다. 선언 없이 리허설하면 그 구간은 사건 실측으로 세어진다',
];

export interface ObjectiveAssessment {
  verdict: ObjectiveVerdict;
  rto: ObjectiveValue;
  rpo: ObjectiveValue;
  /** 적혀 있는 목표 */
  configured: ObjectiveKey[];
  /** 비어 있는 목표(미설정·공백) */
  missing: ObjectiveKey[];
  /** 값이 있는데 읽히지 않는 목표 */
  unreadable: ObjectiveKey[];
  conflicts: ConflictKind[];
  unjudgedConflicts: string[];
  attainment: Record<ObjectiveKey, AttainmentResult>;
  /** 실측이 목표를 넘긴 목표 */
  breached: ObjectiveKey[];
  /** 그 실측이 **사건의 것인가 연습의 것인가**(§6-6). `withheld` 면 대조에서 뺐다 */
  measurement: MeasurementOrigin;
  action: string;
  caveats: readonly string[];
}

export interface ObjectiveInput {
  env?: Record<string, string | undefined>;
  now?: Date;
  /** 실측을 직접 넘긴다(§1-2 명령은 §6 표 소요시간을 여기로 준다) */
  measured?: { rto?: unknown; rpo?: unknown };
  /** 상대 설정값. 넘기지 않으면 env 에서 읽는다 */
  retentionHours?: number | null;
  baselineMaxAgeDays?: number | null;
}

// 상대 설정값은 **각 정본 로더**로 읽는다 — 같은 판독 규칙을 두 번 쓰지 않는다
// (여기서 다시 파싱하면 한쪽 규칙이 바뀌어도 둘 다 조용히 「읽었다」를 낸다).

/**
 * 판정 순서: **판독 불가 → 약속 없음 → 한쪽만 → 실측 초과 → 설정 모순 → ok**.
 * 실측 초과(이미 일어난 사실)를 설정 모순(아직 일어나지 않은 일)보다 앞에 둔다.
 */
export function assessObjectives(args?: ObjectiveInput): ObjectiveAssessment {
  const env = args?.env ?? process.env;
  const values = objectivesFromEnv(env);
  const measuredEnv = measuredFromEnv(env, args?.now);

  const configured = OBJECTIVES.filter((o) => values[o.key].state === 'set').map((o) => o.key);
  const missing = OBJECTIVES.filter((o) => values[o.key].state === 'unset' || values[o.key].state === 'blank').map(
    (o) => o.key,
  );
  const unreadable = OBJECTIVES.filter((o) => values[o.key].state === 'invalid').map((o) => o.key);

  // 인자로 `null` 을 받으면 「모른다」는 뜻이다 — env 로 되돌아가 추측하지 않는다.
  const feas = assessFeasibility({
    rtoMinutes: values.rto.minutes,
    rpoMinutes: values.rpo.minutes,
    retentionHours: args && 'retentionHours' in args ? (args.retentionHours ?? null) : retentionHours(env),
    baselineMaxAgeDays:
      args && 'baselineMaxAgeDays' in args ? (args.baselineMaxAgeDays ?? null) : baselineMaxAgeDays(env),
  });

  // §6-6: 리허설 선언 중의 구간은 **연습값**이다 — 체크리스트가 채우라고 지시하는 두 키
  // (RECOVERY_RESTORE_POINT·RECOVERY_WRITE_FREEZE_AT)가 그대로 실측이 되면, 고지 대상도
  // 유실도 없는 연습이 `met`(약속을 지켰다)이나 `exceeded`(→ `breached`)로 기록된다.
  // 선언을 판독할 수 없을 때도 「사건이다」로 올리지 않는다(판정 보류가 통과보다 앞이다).
  const origin = measurementOrigin({ env });
  const envRpo = origin.trusted ? measuredEnv.rpoMinutes : null;
  const attainment: Record<ObjectiveKey, AttainmentResult> = {
    rto: compareToObjective('rto', values.rto.minutes, args?.measured?.rto ?? measuredEnv.rtoMinutes),
    rpo: compareToObjective('rpo', values.rpo.minutes, args?.measured?.rpo ?? envRpo),
  };
  const withheldHere = origin.withheld && (args?.measured?.rpo ?? null) === null;
  if (withheldHere) {
    attainment.rpo = { ...attainment.rpo, note: `연습 구간이라 약속 대조에서 뺐다(§6-6) — ${origin.why}` };
  }
  const breached = OBJECTIVES.filter((o) => attainment[o.key].attainment === 'exceeded').map((o) => o.key);

  const verdict: ObjectiveVerdict =
    unreadable.length > 0
      ? 'invalid'
      : missing.length === OBJECTIVES.length
        ? 'unset'
        : missing.length > 0
          ? 'partial'
          : breached.length > 0
            ? 'breached'
            : feas.conflicts.length > 0
              ? 'infeasible'
              : 'ok';

  return {
    verdict,
    rto: values.rto,
    rpo: values.rpo,
    configured,
    missing,
    unreadable,
    conflicts: feas.conflicts,
    unjudgedConflicts: feas.unjudged,
    attainment,
    breached,
    measurement: origin,
    action: ACTION[verdict],
    caveats: OBJECTIVE_LIMITS,
  };
}

/* ─────────────────── §6 표 소요시간과의 대조(§1-2 명령) ─────────────────── */

export interface RehearsalAttainment {
  /** 표의 최신 행(없으면 null) */
  row: LedgerRow | null;
  /** 그 행의 소요시간 대 RTO */
  rto: AttainmentResult;
  /** 그 행의 소요시간이 **RTO 실측 자격**이 있는가(§6-5) */
  eligibility: AttainmentEligibility;
  /** 그 행이 연습인가 사건인가(§6-6) */
  kind: KindState;
  /** 그 소요시간이 약속의 **실측**인가 **하한**인가 */
  basis: 'measurement' | 'lower_bound' | 'unknown';
  /** 그 리허설에서는 실제 유실이 없다 — 구간 대조는 사건에서만 한다 */
  note: string;
}

export const REHEARSAL_HAS_NO_LOSS =
  '리허설에는 고지 대상 유실이 없으므로 RPO 대조는 하지 않는다(§3-7 구간은 실제 사건에서만 생긴다)';

export const INCIDENT_HAS_LOSS =
  '사건 행이다 — 유실 구간(RPO 실측)은 §3-7 이 산출하고 런타임 `attainment.rpo` 가 대조한다(§6-6)';

export const KIND_UNREAD_NOTE =
  '유형을 읽을 수 없어 이 소요시간이 연습값인지 사건 실측인지 모른다(§6-6) — `met` 을 「약속을 지킬 수 있다」로 읽지 않는다';

/**
 * §6 표의 **최신 행 소요시간**을 RTO 와 견준다 — `LEDGER_FIELDS.duration` 을 **읽는 판정**이
 * 여기서 처음 생긴다(§6-4 가 「적히지만 읽는 판정이 없다」고 적어 둔 칸이다).
 * 문서 원문은 **인자로 받는다**(이 모듈은 파일을 읽지 않는다).
 *
 * 2026-10-21: **`검증 결과` 를 먼저 본다**(§6-5 `attainmentEligibility`). 그전에는 결과를 보지
 * 않아 `부분 통과` 리허설의 소요시간이 그대로 실측이 됐는데, 절차를 끝까지 가지 않은 리허설은
 * 당연히 짧으므로 **약속을 지킨 것(`met`)으로 기록된다** — 수치를 깎지 않으면서 그렇게 된다.
 * 자격이 없으면 실측을 넘기지 않아 `unjudged`(= 판정 보류) 로 남는다.
 */
export function rehearsalAttainment(args: {
  markdown: unknown;
  env?: Record<string, string | undefined>;
}): RehearsalAttainment {
  const values = objectivesFromEnv(args?.env ?? process.env);
  const row = latestLedgerRow(parseLedgerTable(args?.markdown).rows);
  const eligibility = attainmentEligibility(row);
  // §6-6: 그 행이 연습인지 사건인지 함께 말한다. 리허설에는 1단계 중단 결정·실사용자 트래픽·
  // 고지가 없으므로 그 소요시간은 **하한**이고, `met` 은 「약속을 지킬 수 있다」가 아니다.
  const kind = row ? kindState(row.kind) : 'absent';
  const role = roleFor(kind);
  return {
    row,
    rto: compareToObjective('rto', values.rto.minutes, eligibility.eligible && row ? row.durationMin : null),
    eligibility,
    kind,
    basis: role ? role.rtoEvidence : 'unknown',
    note:
      !row || kind === 'regular'
        ? REHEARSAL_HAS_NO_LOSS
        : kind === 'incident'
          ? INCIDENT_HAS_LOSS
          : KIND_UNREAD_NOTE,
  };
}

/* ───────────────────────── §1 표기와의 대조(CI·명령) ───────────────────────── */

export type DocObjectiveState = 'missing' | 'placeholder' | 'documented' | 'unreadable';

export interface DocumentedObjectives {
  state: DocObjectiveState;
  /** 문서에서 읽은 목표(분). 못 읽으면 null — 지어내지 않는다 */
  rtoMinutes: number | null;
  rpoMinutes: number | null;
  /** 판정 근거가 된 §1 줄 원문(없으면 null) */
  line: string | null;
}

const DOC_LINE = /^-\s*목표 복구시간\(RTO\).*$/m;

/**
 * §1 의 목표 줄을 읽는다. **`[확인 필요]` 는 `placeholder`** 이고(= 비어 있다), 수치가 적혀 있으면
 * 백틱 안의 `RTO 240분` 꼴만 인정한다 — 자유 문장에서 숫자를 주워 오지 않는다(`unreadable`).
 */
export function documentedObjectives(markdown: unknown): DocumentedObjectives {
  const s = String(markdown ?? '');
  const m = DOC_LINE.exec(s);
  if (!m) return { state: 'missing', rtoMinutes: null, rpoMinutes: null, line: null };
  const line = m[0];
  if (/\[확인 필요/.test(line)) return { state: 'placeholder', rtoMinutes: null, rpoMinutes: null, line };
  const pick = (label: string): number | null => {
    const hit = new RegExp(`\`${label}\\s+(\\d{1,7})분\``).exec(line);
    return hit ? parseObjectiveMinutes(hit[1]) : null;
  };
  const rtoMinutes = pick('RTO');
  const rpoMinutes = pick('RPO');
  const state: DocObjectiveState = rtoMinutes === null || rpoMinutes === null ? 'unreadable' : 'documented';
  return { state, rtoMinutes, rpoMinutes, line };
}

/** 문서와 env 가 **같은 약속을 말하는지**. 어느 쪽도 정본으로 단정하지 않고 차이만 적는다 */
export function reconcileDocumented(args: {
  markdown: unknown;
  env?: Record<string, string | undefined>;
}): { doc: DocumentedObjectives; differs: ObjectiveKey[]; undocumented: ObjectiveKey[]; unwired: ObjectiveKey[] } {
  const doc = documentedObjectives(args?.markdown);
  const values = objectivesFromEnv(args?.env ?? process.env);
  const docMin: Record<ObjectiveKey, number | null> = { rto: doc.rtoMinutes, rpo: doc.rpoMinutes };
  const differs: ObjectiveKey[] = [];
  const undocumented: ObjectiveKey[] = [];
  const unwired: ObjectiveKey[] = [];
  for (const o of OBJECTIVES) {
    const envMin = values[o.key].minutes;
    const dMin = docMin[o.key];
    if (envMin !== null && dMin === null) undocumented.push(o.key);
    else if (envMin === null && dMin !== null) unwired.push(o.key);
    else if (envMin !== null && dMin !== null && envMin !== dMin) differs.push(o.key);
  }
  return { doc, differs, undocumented, unwired };
}

/* ───────────────────────────── 출력 ───────────────────────────── */

/**
 * `/api/health` 체크. **required: false** — 약속이 비어 있다고 서비스를 내리면 복구가 자기 자신을 막는다.
 * **수치는 담지 않는다**(목표 분·실측 분·초과 분). 판정·키 이름·상태 어휘만 담는다.
 */
export function recoveryObjectivesCheck(args?: ObjectiveInput): {
  ok: boolean;
  required: false;
  detail: Record<string, unknown>;
} {
  const a = assessObjectives(args);
  return {
    ok: a.verdict === 'ok',
    required: false,
    detail: {
      verdict: a.verdict,
      rto: a.rto.state,
      rpo: a.rpo.state,
      keys: OBJECTIVES.map((o) => o.envKey),
      configured: a.configured,
      missing: a.missing,
      unreadable: a.unreadable,
      conflicts: a.conflicts,
      unjudgedConflicts: a.unjudgedConflicts.length,
      attainment: { rto: a.attainment.rto.attainment, rpo: a.attainment.rpo.attainment },
      // 그 실측이 사건의 것인가 연습의 것인가(§6-6). 값·구간 분은 담지 않는다
      measurement: a.measurement.measurement,
      measurementOrigin: a.measurement.origin,
      breached: a.breached,
      drifts: OBJECTIVE_DRIFTS.map((d) => d.key),
      runbook: OBJECTIVES_RUNBOOK_REF,
      limits: OBJECTIVE_LIMITS,
      action: a.action,
    },
  };
}

/** 사람이 읽는 요약(보고·문서용). 수치를 지어내지 않는다 */
export function objectivesText(args?: ObjectiveInput): string[] {
  const a = assessObjectives(args);
  const lines = [`판정: ${a.verdict}`];
  for (const o of OBJECTIVES) {
    const v = a[o.key];
    lines.push(`${o.label}: ${v.state}${v.minutes === null ? '' : ` (${v.minutes}분)`} — ${o.envKey}`);
  }
  for (const key of a.conflicts) lines.push(`모순 ${key}: ${conflictText(key)?.how ?? ''}`);
  for (const u of a.unjudgedConflicts) lines.push(`미판정 ${u}`);
  for (const o of OBJECTIVES) {
    const at = a.attainment[o.key];
    const over = at.overBy === null ? '' : ` (초과 ${at.overBy}분)`;
    lines.push(`${o.key} 실측 대조: ${at.attainment}${over} — ${at.note}`);
  }
  lines.push(`해야 할 일: ${a.action}`);
  return lines;
}

/** 운영 로그 한 줄 — 판정·상태·개수만 담는다(목표 분·실측 분 없음) */
export function objectivesLogLine(args?: ObjectiveInput): string {
  const a = assessObjectives(args);
  const parts = [
    '[recoveryObjectives]',
    `verdict=${a.verdict}`,
    `rto=${a.rto.state}`,
    `rpo=${a.rpo.state}`,
    `attainment=${a.attainment.rto.attainment}|${a.attainment.rpo.attainment}`,
    `conflicts=${a.conflicts.length}`,
  ];
  if (a.conflicts.length > 0) parts.push(`kinds=${a.conflicts.join('|')}`);
  if (a.breached.length > 0) parts.push(`breached=${a.breached.join('|')}`);
  return parts.join(' ');
}

/** 배선 상태 요약(문서·보고용) */
export function objectivesStatus(args?: ObjectiveInput): {
  verdict: ObjectiveVerdict;
  configured: number;
  conflicts: number;
  drifts: number;
  limits: number;
  action: string;
} {
  const a = assessObjectives(args);
  return {
    verdict: a.verdict,
    configured: a.configured.length,
    conflicts: a.conflicts.length,
    drifts: OBJECTIVE_DRIFTS.length,
    limits: OBJECTIVE_LIMITS.length,
    action: a.action,
  };
}

/* ───────────────────────────── 정적 점검 ───────────────────────────── */

/** 정본 모양 — 약속·실측 출처·유실 설명이 비면 이 판정은 이유를 말하지 못한다 */
export function auditObjectiveShape(objectives: readonly Objective[] = OBJECTIVES): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const o of objectives) {
    if (seen.has(o.key)) problems.push(`목표 ${o.key} 가 정본에 두 번 있다`);
    seen.add(o.key);
    if (!o.envKey.endsWith('_MINUTES')) {
      problems.push(`목표 ${o.key} 의 키 이름(${o.envKey})에 단위가 없다 — 「4」가 분인지 시간인지 모르는 값이 들어온다`);
    }
    if (!o.promise.trim() || !o.measuredBy.trim() || !o.blank.trim()) {
      problems.push(`목표 ${o.key} 의 약속·실측 출처·공백 시 생기는 일 설명이 비었다`);
    }
  }
  for (const key of CONFLICT_KINDS) {
    const t = conflictText(key);
    if (!t || !t.how.trim() || !t.fix.trim()) problems.push(`모순 ${key} 의 설명·조치가 비었다`);
  }
  return problems;
}

/**
 * 목표 키가 레지스트리에 있고 **임시 키 목록에는 없는지**.
 * 임시 키로 넣으면 §2 키 이름 스냅샷 대조에서 빠져(평상시 미설정이 정상인 키로 취급된다)
 * 복구 때 약속이 유실된 사실이 드러나지 않는다 — 목표치는 **평상시에도 있어야 하는 설정**이다.
 */
export function auditRegistrySources(
  vars: readonly { key: string }[],
  transient: readonly string[],
): string[] {
  const known = new Set(vars.map((v) => v.key));
  const problems: string[] = [];
  for (const o of OBJECTIVES) {
    if (!known.has(o.envKey)) problems.push(`${o.envKey} 가 env 레지스트리에 없다`);
    if (transient.includes(o.envKey)) {
      problems.push(`${o.envKey} 가 임시 키 목록에 있다 — 목표치는 복구 중에만 넣는 표지가 아니라 영구 설정이다`);
    }
  }
  return problems;
}

/**
 * 실측이 사는 집(§6 표 `소요시간`)이 **이 판정에 연결돼 있는지**.
 * 끊어지면 목표와 실측이 다시 만나지 않는데(`measure_lives_only_in_table`) 응답은 그대로 200 이다.
 */
export function auditMeasureHome(fields: readonly LedgerField[]): string[] {
  const problems: string[] = [];
  const duration = fields.find((f) => f.key === 'duration');
  if (!duration) {
    problems.push('기록 정본에 소요시간 칸이 없다 — RTO 실측이 사는 집이 사라졌다');
    return problems;
  }
  if (!duration.column) problems.push('소요시간 칸에 §6 표 열이 없다 — 실측이 저장소에 남지 않는다');
  if (!duration.judgedBy || !/recoveryObjectives/.test(duration.judgedBy)) {
    problems.push(
      '소요시간 칸의 judgedBy 가 이 모듈을 가리키지 않는다 — 실측과 목표가 만나는 자리가 다시 없어진다' +
        '(§6-4 가 「적히지만 읽는 판정이 없다」고 적어 둔 상태로 되돌아간다)',
    );
  }
  return problems;
}

/** §1·§1-2 가 **목표를 적는 절차**로 남아 있는지 */
export function auditRunbookObjectives(src: unknown): string[] {
  const s = String(src ?? '');
  const problems: string[] = [];
  if (!/^###\s*1-2\./m.test(s)) problems.push('§1-2 절이 사라졌다 — 목표치를 적고 실측과 견주는 유일한 자리다');
  for (const o of OBJECTIVES) {
    if (!s.includes(o.envKey)) problems.push(`RUNBOOK 에 목표 키 ${o.envKey} 가 없다`);
  }
  if (!/checks\.recoveryObjectives/.test(s)) problems.push('RUNBOOK 에 checks.recoveryObjectives 확인 지시가 없다');
  if (!/rehearsalAttainment\(|objectivesText\(/.test(s)) problems.push('§1-2 에 실측 대조 명령이 없다');
  for (const key of CONFLICT_KINDS) {
    if (!s.includes(key)) problems.push(`§1-2 에 모순 종류 ${key} 가 없다`);
  }
  for (const d of OBJECTIVE_DRIFTS) {
    if (!s.includes(d.key)) problems.push(`§1-2 에 어긋남 방향 ${d.key} 가 없다`);
  }
  // §1 **본문**이 그 키와 §1-2 를 가리켜야 한다(보존기간 줄과 같은 규율) — 가리키지 않으면
  // 수치를 문서에만 적고 판정은 영구히 `unset` 으로 남는다(응답은 그대로 200 이다).
  if (documentedObjectives(s).state === 'missing') problems.push('§1 에 목표 복구시간(RTO) 줄이 없다');
  const head = s.slice(s.indexOf('## 1. '), s.search(/^###\s*1-1\./m));
  if (!head) problems.push('§1 본문을 찾을 수 없다');
  else {
    for (const o of OBJECTIVES) {
      if (!head.includes(o.envKey)) problems.push(`§1 본문이 목표 키 ${o.envKey} 를 가리키지 않는다 — 문서에만 적고 판정은 unset 으로 남는다`);
    }
    if (!/1-2/.test(head)) problems.push('§1 본문이 §1-2 를 가리키지 않는다');
  }
  const at = s.search(/^###\s*리허설 체크리스트/m);
  if (at < 0) problems.push('§6 에 리허설 체크리스트가 없다');
  else if (!/checks\.recoveryObjectives/.test(s.slice(at))) {
    problems.push('리허설 체크리스트에 목표치·소요시간 대조 항목이 없다');
  }
  return problems;
}

/** `/api/health` 배선 — 판정만 하고 버리는 꼴도 잡는다 */
export function auditHealthWiring(src: unknown): string[] {
  const s = String(src ?? '');
  const problems: string[] = [];
  if (!/from\s+['"]@\/lib\/recoveryObjectives['"]/.test(s)) problems.push('recoveryObjectives 를 import 하지 않는다');
  if (!/recoveryObjectivesCheck\(/.test(s)) problems.push('recoveryObjectivesCheck() 를 호출하지 않는다');
  if (!/checks\.recoveryObjectives\s*=\s*recoveryObjectivesCheck\(/.test(s)) {
    problems.push('판정 결과를 checks.recoveryObjectives 에 싣지 않는다(판정만 하고 버리는 꼴)');
  }
  return problems;
}
