/**
 * recoveryBaseline.ts — 기준 스냅샷이 **언제 기준인지**를 따진다. 2026-10-05
 *
 * ── 왜 필요한가 ───────────────────────────────────────────────────────────────
 * `lib/recoveryVerify.ts` 는 복구된 DB 의 행 수를 기준 스냅샷(`RECOVERY_DATA_BASELINE`)과
 * 대조해 `ok`/`short`/`empty`… 를 판정한다. 그런데 그 판정은 스냅샷의 **날짜를 보지 않았다** —
 * `asOf` 를 응답에 그대로 되돌려 주기만 했다. 그래서 다음 두 가지가 전부 `ok` 로 나왔다.
 *
 *  (1) **낡은 스냅샷** — RUNBOOK §2 는 스냅샷을 월 1회 갱신하라고 지시하지만, 그 갱신이
 *      빠졌는지 알려 주는 장치가 어디에도 없었다(`/api/health` 의 `checks.recovery` 는
 *      리허설 신선도만 본다). 스냅샷이 8개월 낡으면 그 수치는 현재 규모보다 한참 낮으므로,
 *      행을 대량으로 잃은 DB 도 「전 테이블이 기준치 이상」을 만족한다 → `switchReady: true`
 *      → RUNBOOK §3 5단계(운영 `DATABASE_URL` 교체)로 넘어간다.
 *  (2) **날짜 없는 스냅샷** — `asOf` 없이 수치만 넣어도 `parseCountBaseline` 은 받아 준다.
 *      그 경우 「손상 전 기대치」인지 작년 수치인지 **알 방법이 없는데도** `ok` 가 나왔다.
 *
 * §3 4단계가 요구하는 것은 「**손상 전** 기대치와 대조」다. 시점을 모르는 수치, 또는 갱신
 * 기한을 넘긴 수치는 그 요구를 만족하지 못한다 — 이 모듈이 그것을 기계적으로 가린다.
 *
 * ── 복구일에 스냅샷을 다시 뜨면 안 된다 ──────────────────────────────────────
 * 점검 응답은 다음 기준치로 쓸 `snapshot` 문자열을 돌려준다. 이것을 **복구 검증 중에**
 * `RECOVERY_DATA_BASELINE` 에 넣으면 복구 대상 DB 를 자기 자신과 비교하게 되어 그 뒤 모든
 * 판정이 `ok` 로 나온다 — 기준치가 영구히 망가진다. 그래서 `snapshotAdoption()` 이 "언제
 * 넣어도 되는지"를 응답·로그에 함께 실어 보낸다. 엔드포인트는 자기가 월 점검 중인지 복구
 * 검증 중인지 알 수 없으므로 **단정하지 않고 조건을 말한다**.
 *
 * 원칙
 * - 임의 주기 금지: 갱신 기한은 `RECOVERY_BASELINE_MAX_AGE_DAYS` 설정값만 인정한다.
 *   미설정이면 기한 판정을 **보류**한다(`unjudged`) — 「월 1회」를 코드가 임의로 정하지 않는다.
 * - fail-safe: 신선도를 확인할 수 없으면 `trusted` 를 올리지 않는다. 단, 기한 미설정은
 *   「기한을 모른다」이지 「낡았다」가 아니므로 기존 판정을 끌어내리지 않는다.
 * - DB·파일시스템 미접근. 행 수를 담지 않는다(공개 `/api/health` 에 노출되는 값이다).
 */

import { addDays, parseRehearsalDate } from './recovery.ts';

/** 갱신 기한 설정 키. 미설정이면 기한 판정을 하지 않는다 */
export const BASELINE_MAX_AGE_ENV = 'RECOVERY_BASELINE_MAX_AGE_DAYS';

/**
 * - `absent`   : 스냅샷 자체가 없다(판정은 recoveryVerify 의 `no_baseline` 이 담당).
 * - `undated`  : 수치는 있는데 기준일이 없거나 형식이 틀렸다 → 시점을 모른다.
 * - `future`   : 기준일이 미래다 → 오타·시계 오차. 기록으로 쓸 수 없다.
 * - `stale`    : 기준일이 갱신 기한을 넘겼다.
 * - `unjudged` : 기준일은 유효하나 기한(또는 현재 시각)을 몰라 신선도를 판정하지 않았다.
 * - `ok`       : 기한 안에 있다.
 */
export type BaselineAgeStatus = 'absent' | 'undated' | 'future' | 'stale' | 'unjudged' | 'ok';

export interface BaselineStamp {
  /** 기준일(YYYY-MM-DD). 판독 불가·미기재면 null */
  asOf: string | null;
  /** 스냅샷이 담은 **테이블 수**(행 수가 아니다) */
  tables: number;
}

export interface BaselineAge {
  status: BaselineAgeStatus;
  asOf: string | null;
  /** 기준일로부터 경과 일수. 판정 불가면 null */
  ageDays: number | null;
  /** 판정에 쓴 기한(일). 미설정이면 null → stale 판정을 하지 않는다 */
  maxAgeDays: number | null;
  /** 스냅샷 갱신 기한(기준일 + maxAgeDays). 둘 중 하나라도 없으면 null */
  dueDate: string | null;
  /** 스냅샷이 담은 테이블 수 */
  tables: number;
  /** 이 스냅샷을 「손상 전 기대치」로 써도 되는가. false 면 행 수 판정을 ok 로 올리지 않는다 */
  trusted: boolean;
  /** 사람이 해야 할 일 한 줄 */
  action: string | null;
  /** `ok` 가 보장하지 **못하는** 구간을 수치로 적은 한 줄. 판정 불가면 null */
  blindWindow: string | null;
}

const MS_DAY = 86400000;

function dayIndex(iso: string): number {
  return Math.floor(new Date(`${iso}T00:00:00Z`).getTime() / MS_DAY);
}

function isoOf(d: Date): string {
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

/* ───────────────────────────── 조치 문구 ───────────────────────────── */

/**
 * 복구 검증 중에는 기준치를 "지금" 다시 뜰 수 없다 — 그 수치가 바로 의심 대상이다.
 * 세 상태(undated/future/stale) 모두 같은 함정을 공유하므로 문구를 한곳에 둔다.
 */
const NO_RESNAPSHOT =
  '복구 검증 중이라면 지금 스냅샷을 다시 뜨지 말 것 — 복구 대상 DB 를 자기 자신과 비교하게 되어 이후 판정이 항상 ok 로 나온다. ' +
  '손상 전 수치는 다른 근거(이전 월 점검 기록·모니터링 이력·Neon 원본 브랜치 조회)로 확인하고 §3 4단계를 사람이 판단할 것';

export const ACTION_BASELINE_ABSENT =
  `기준 스냅샷이 없다 — 정상 운영 중에 RUNBOOK §2 월 점검으로 \`${BASELINE_MAX_AGE_ENV}\` 와 함께 설정할 것`;

export const ACTION_BASELINE_UNDATED =
  '기준 스냅샷에 기준일(asOf)이 없어 「손상 전」 수치인지 알 수 없다 — 수치만으로는 대조가 성립하지 않는다. ' +
  `스냅샷에 \`asOf=YYYY-MM-DD\` 를 포함해 다시 설정할 것(RUNBOOK §3-2). ${NO_RESNAPSHOT}`;

export const ACTION_BASELINE_FUTURE =
  '기준 스냅샷의 기준일이 미래다 — 오타이거나 시계가 어긋났다. 기록으로 쓸 수 없다. ' +
  `실제 스냅샷을 뜬 날짜로 바로잡을 것(RUNBOOK §3-2). ${NO_RESNAPSHOT}`;

export function actionBaselineStale(dueDate: string, ageDays: number): string {
  return (
    `기준 스냅샷이 갱신 기한(${dueDate})을 넘겼다 — ${ageDays}일 된 수치는 현재 규모보다 낮아, ` +
    `행을 잃은 DB 도 「기준치 이상」을 만족시킨다. ${NO_RESNAPSHOT}. ` +
    '재발 방지로 RUNBOOK §2 월 점검 주기를 지킬 것'
  );
}

export const ACTION_BASELINE_NO_MAX_AGE =
  `갱신 기한(\`${BASELINE_MAX_AGE_ENV}\`)이 설정되지 않아 스냅샷이 낡았는지 판정하지 않았다 — 임의 기본 주기를 쓰지 않는다(RUNBOOK §2)`;

export const ACTION_BASELINE_CLOCK =
  '현재 시각을 읽을 수 없어 기준 스냅샷의 나이를 판정하지 못했다 — 서버 시계를 확인할 것';

/* ───────────────────────────── 기한 로더 ───────────────────────────── */

/**
 * 스냅샷 갱신 기한(일). `RECOVERY_BASELINE_MAX_AGE_DAYS` 설정값만 인정한다.
 * 미설정·형식 밖·범위 밖은 null — RUNBOOK 이 「월 1회」라고 적어 두었어도 코드가
 * 그 수치를 임의로 들고 오지 않는다(리허설 주기와 같은 규율).
 */
export function baselineMaxAgeDays(env: Record<string, string | undefined> = process.env): number | null {
  const raw = (env.RECOVERY_BASELINE_MAX_AGE_DAYS ?? '').trim();
  if (!raw || !/^\d{1,4}$/.test(raw)) return null;
  const n = Number(raw);
  return n >= 1 && n <= 3650 ? n : null;
}

function normalizeMaxAge(raw: unknown): number | null {
  if (typeof raw !== 'number' || !Number.isInteger(raw)) return null;
  return raw >= 1 && raw <= 3650 ? raw : null;
}

/* ───────────────────────────── 판정 ───────────────────────────── */

/**
 * 기준 스냅샷의 신선도 판정. **행 수를 보지 않는다** — 날짜와 덮은 테이블 수만 본다.
 * `trusted` 가 false 인 상태는 `undated`·`future`·`stale`·`absent` 뿐이다.
 */
export function assessBaselineAge(args: {
  stamp: BaselineStamp | null;
  now?: Date;
  maxAgeDays?: number | null;
}): BaselineAge {
  const maxAgeDays = normalizeMaxAge(args.maxAgeDays ?? null);
  const stamp = args.stamp;
  const tables = stamp && Number.isInteger(stamp.tables) && stamp.tables > 0 ? stamp.tables : 0;
  const shell = { maxAgeDays, tables, ageDays: null, dueDate: null, blindWindow: null };

  if (!stamp || tables === 0) {
    return { ...shell, status: 'absent', asOf: null, trusted: false, action: ACTION_BASELINE_ABSENT };
  }

  const asOf = parseRehearsalDate(stamp.asOf);
  if (!asOf) {
    return { ...shell, status: 'undated', asOf: null, trusted: false, action: ACTION_BASELINE_UNDATED };
  }

  const today = isoOf(args.now ?? new Date());
  if (!today) {
    return { ...shell, status: 'unjudged', asOf, trusted: true, action: ACTION_BASELINE_CLOCK };
  }

  const ageDays = dayIndex(today) - dayIndex(asOf);
  if (ageDays < 0) {
    return { ...shell, status: 'future', asOf, trusted: false, action: ACTION_BASELINE_FUTURE };
  }

  const dueDate = maxAgeDays === null ? null : addDays(asOf, maxAgeDays);
  const blindWindow =
    `${asOf} 이후 ~ ${today} 현재(${ageDays}일) 구간에 생긴 행의 유실은 이 대조로 알 수 없다(RPO 구간)`;
  const common = { maxAgeDays, tables, asOf, ageDays, dueDate, blindWindow };

  if (dueDate && today > dueDate) {
    return { ...common, status: 'stale', trusted: false, action: actionBaselineStale(dueDate, ageDays) };
  }
  if (dueDate === null) {
    return { ...common, status: 'unjudged', trusted: true, action: ACTION_BASELINE_NO_MAX_AGE };
  }
  return { ...common, status: 'ok', trusted: true, action: `다음 스냅샷 갱신 기한: ${dueDate}` };
}

/** 로그 한 줄. 날짜·일수만 — 행 수는 담지 않는다 */
export function baselineAgeLine(age: BaselineAge): string {
  const parts = [`baseline=${age.status}`];
  if (age.asOf) parts.push(`baseline_as_of=${age.asOf}`);
  if (age.ageDays !== null) parts.push(`baseline_age_days=${age.ageDays}`);
  if (age.maxAgeDays !== null) parts.push(`baseline_max_age=${age.maxAgeDays}`);
  return parts.join(' ');
}

/* ───────────────────────────── 스냅샷 채택 안전장치 ───────────────────────────── */

export type SnapshotAdoption = 'forbidden' | 'normal_operation_only';

export const SNAPSHOT_ADOPT_FORBIDDEN =
  '이 수치를 기준치로 넣지 말 것 — 이번 점검이 이미 스키마·행 수 이상을 가리켰다. ' +
  '의심스러운 DB 의 수치를 기준으로 삼으면 다음 점검부터 그 손상이 「정상」이 된다';

export const SNAPSHOT_ADOPT_NORMAL_ONLY =
  '이 수치는 **정상 운영 중**(RUNBOOK §2 월 점검)에만 RECOVERY_DATA_BASELINE 에 넣는다. ' +
  '복구 검증 중에 넣으면 복구 대상 DB 를 자기 자신과 비교하게 되어 이후 판정이 항상 ok 로 나온다';

/** 이번 점검 결과가 이미 이상을 가리킨 판정 — 그 수치는 기준치가 될 수 없다 */
const UNFIT_VERDICTS = new Set(['empty', 'incomplete', 'short', 'unverified']);

/**
 * 돌려준 `snapshot` 을 기준치로 **채택해도 되는지**.
 * 엔드포인트는 자기가 월 점검 중인지 복구 검증 중인지 알 수 없으므로 단정하지 않고
 * 조건을 말한다 — 다만 이미 이상이 드러난 판정에서는 분명히 금지한다.
 */
export function snapshotAdoption(verdict: unknown): { adopt: SnapshotAdoption; note: string } {
  const v = String(verdict ?? '').trim();
  return UNFIT_VERDICTS.has(v)
    ? { adopt: 'forbidden', note: SNAPSHOT_ADOPT_FORBIDDEN }
    : { adopt: 'normal_operation_only', note: SNAPSHOT_ADOPT_NORMAL_ONLY };
}

/** 배선 상태 요약(문서·보고용). 행 수는 담지 않는다 */
export function baselineAgeStatus(env: Record<string, string | undefined> = process.env): {
  maxAgeConfigured: boolean;
  maxAgeDays: number | null;
  note: string;
} {
  const maxAgeDays = baselineMaxAgeDays(env);
  return {
    maxAgeConfigured: maxAgeDays !== null,
    maxAgeDays,
    note: maxAgeDays === null
      ? `${BASELINE_MAX_AGE_ENV} 미설정 — 스냅샷이 낡았는지 판정하지 않는다(임의 기본 주기 없음)`
      : `스냅샷이 ${maxAgeDays}일을 넘기면 stale 로 내려 switchReady 를 막는다`,
  };
}
