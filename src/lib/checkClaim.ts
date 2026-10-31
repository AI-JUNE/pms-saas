/**
 * checkClaim.ts — §2 월 점검 **일자는 주장이다**(RUNBOOK §2-4). 2026-10-31
 *
 * ── 왜 필요한가 ───────────────────────────────────────────────────────────────
 * §2-1(`lib/periodicCheck.ts`)은 「날짜 없는 설정값의 확인 시점은 그 값을 확인하라고 지시한
 * 절차가 마지막으로 돌아간 날이다」로 구멍을 닫았다. 그 장치의 **유일한 입력**은
 * `RECOVERY_LAST_CHECK` 한 줄이고, 그 한 줄이 하는 일은 작지 않다 — 주기 안이면
 * `trusted: true` 가 되어 보존 창 길이(§2 1번)와 연결 대상 지문(§2 4번)이 `confirmed` 로
 * 올라간다. §3-6 이 「그 시점으로 되돌릴 수 있다」를 말할 때 기준으로 삼는 수치가 바로 그것이다.
 *
 * 그런데 그 한 줄은 **사람이 적은 주장**이고, `PERIODIC_LIMITS` 가 그 사실을 두 줄로 적어
 * 두었다 — 「점검했다고 **적었다**는 뜻이다(값이 바뀌지 않아도 날짜만 갱신될 수 있다)」·
 * 「점검 일자 하나가 1·4번 두 값의 확인 시점을 대표한다」. 적어 두기만 했고 **닫는 장치가
 * 없었다.** 그래서:
 *
 *  (1) **날짜만 갱신하면 전 판정이 올라간다.** §2 를 열지 않고 `RECOVERY_LAST_CHECK` 만
 *      오늘로 고쳐 적으면 `verdict: ok` · `trusted: true` · `untrusted: []` 가 되고,
 *      §2-1 이 막으려던 상태(옛 플랜 기준의 보존 창으로 §3-6 이 `ok` 를 내는 것)가 **경고
 *      하나 없이** 되돌아온다. 리허설 체크리스트도 그 두 칸을 그대로 인용한다.
 *  (2) **대조할 수 있는 값이 이미 둘 있는데 쓰이지 않았다.** §2 가 공급하는 값 중 둘은
 *      **자기 날짜를 품는다** — 3번 행 수 기준 스냅샷(`RECOVERY_DATA_BASELINE` 의 `asOf`)과
 *      4번 설정 키 이름 스냅샷(`RECOVERY_ENV_BASELINE` 의 `asOf`). 그 둘이 반년 전 날짜인데
 *      점검 일자가 어제라면 그 점검에서 3·4번은 **수행되지 않았다** — 기계적으로 말할 수 있는
 *      사실이다. 그런데 두 값의 신선도는 각자 다른 축(§3-2 기한·§4-12 목록)으로만 판정되고,
 *      **점검 일자와 견준 적이 없다.**
 *  (3) **거꾸로도 틀린다.** 스냅샷은 갱신했는데 7번(날짜 적기)을 거르면, 점검 일자는 옛 날짜로
 *      남아 `overdue` 가 뜨고 사람은 「또 밀렸다」로 읽는다 — 경보가 사실과 다르면 다음부터
 *      아무도 보지 않는다.
 *  (4) **표 쪽은 아예 비교되지 않는다.** §2 6번은 같은 점검을 §6 표에 `점검` 행으로 적으라고
 *      지시하고 §6-8 이 그 어휘를 만들었는데, §6-4 는 **리허설 키만** 표와 대조한다(점검 쪽을
 *      env 로 올리지 않는 규율은 옳다 — 그 대신 `RECOVERY_LAST_CHECK` 와 대조하는 쪽이
 *      없었다). 그래서 표에 점검 행이 없어도, 표의 점검 행이 env 날짜와 달라도 아무 말이 없다.
 *
 * 이 모듈은 **새 값을 요구하지 않고** 이미 적혀 있는 것끼리 견준다 — 주장(점검 일자) ↔ 그
 * 점검이 남겼어야 하는 값의 `asOf`, 그리고 주장 ↔ §6 표의 `점검` 행.
 *
 * 원칙
 * - **순수**: DB·next·fs·`process.env` 미접근. env 는 **인자로** 받는다. 신규 조회·쓰기·DDL 0,
 *   신규 런타임 체크 0, 신규 사건 표지 0, **신규 env 0**(대조에 쓰는 네 키는 이미 §2 가 쓰는 것이다).
 * - **판독을 복제하지 않는다**: 날짜 판독은 `parseRehearsalDate`, 행 수 스냅샷은 §3-2
 *   `parseCountBaseline`, 키 목록 스냅샷은 §4-12 `parseEnvBaseline`, 행의 목적은 §6-8
 *   `purposeOfRow` 를 그대로 쓴다. 같은 문구를 두 곳에서 읽으면 갈라진 쪽이 아무 응답도
 *   바꾸지 않으므로 영구히 남는다.
 * - **게이트가 아니다**: 이 판정으로 `ok`·상태 코드·`trusted`·`switchReady` 를 바꾸지 않는다.
 *   달라지는 것은 **다음에 할 일**이다(점검을 거른 배포에 거짓 차단을 만들면 아무도 보지 않는다).
 * - **임의 허용 오차 금지**: 「며칠까지는 같은 점검으로 본다」를 코드가 정하지 않는다. 하루라도
 *   앞선 값은 `lagging`(= 그 점검에서 갱신되지 않았다)이고, **한 주기 이상** 앞선 것만
 *   `skipped` 로 올린다 — 그 주기도 `RECOVERY_CHECK_INTERVAL_DAYS` 설정값(인자)뿐이다.
 * - **구분할 수 없는 것을 구분했다고 하지 않는다**: `aligned` 는 「그 날짜에 갱신됐다」까지이고
 *   콘솔 수치와 맞는지(오기)는 보지 않는다. 날짜 없는 두 값은 **어떤 대조도 받지 못한다** —
 *   그 사실을 `undatable` 로 응답에 적는다.
 */

import { DATA_BASELINE_ENV } from './baselineScope.ts';
import { EXPECTED_DB_ENV } from './dbIdentity.ts';
import { ENV_BASELINE_ENV, parseEnvBaseline } from './envPresence.ts';
import { purposeOfRow } from './ledgerPurpose.ts';
import { parseRehearsalDate } from './recovery.ts';
import { parseCountBaseline } from './recoveryVerify.ts';
import { PITR_RETENTION_ENV } from './recoveryWindow.ts';
import type { LedgerRow } from './rehearsalLedger.ts';

/** 응답·문서에서 근거 절을 찾을 수 있게 한다 */
export const CLAIM_RUNBOOK_REF = 'RUNBOOK §2-4 · §2 · §2-1';

const MS_DAY = 86400000;

/* ─────────────────── 주장을 뒷받침할 수 있는 축(정본) ─────────────────── */

export interface ClaimSource {
  /** §2 의 단계 번호 */
  step: number;
  /** 그 단계가 남기는 값의 설정 키. 표에만 사는 기록은 null */
  key: string | null;
  /** 그 기록이 사는 곳 — `table` 은 **런타임이 읽지 못한다** */
  home: 'env' | 'table';
  /** 그 값이 **자기 날짜를 품는가**. false 면 이 판정도 대조하지 못한다 */
  dated: boolean;
  /** 판독을 맡는 곳(여기서 다시 읽지 않는다) */
  reader: string;
  /** 대조되면 **무엇이** 확인되는가 */
  corroborates: string;
  /** 대조되지 않을 때 조용히 생기는 일 */
  ifMissing: string;
}

/**
 * §2 가 공급하는 값 전건. **네 줄 중 둘만 대조할 수 있다** — 그 비대칭이 이 절의 요지다.
 * `auditSourceCanon` 이 §2 단계 정본(`MONTHLY_STEPS`)과 **양방향으로** 대조하므로,
 * §2 에 값을 공급하는 단계가 늘면 여기에 적지 않는 한 CI 가 막는다.
 */
export const CLAIM_SOURCES: readonly ClaimSource[] = [
  {
    step: 1,
    key: PITR_RETENTION_ENV,
    home: 'env',
    dated: false,
    reader: 'lib/recoveryWindow.ts (시간 수치뿐 — 날짜를 품지 않는다)',
    corroborates: '없다 — 이 값의 확인 시점은 점검 일자 말고 어디에도 없다',
    ifMissing:
      '§2-1 이 이 값을 `confirmed` 로 올리는 근거가 **주장 하나**뿐인 채로 남는다 — ' +
      '옛 플랜 기준 수치로 §3-6 이 창 밖 시점에 `ok` 와 deadline 을 낸다',
  },
  {
    step: 3,
    key: DATA_BASELINE_ENV,
    home: 'env',
    dated: true,
    reader: 'lib/recoveryVerify.ts parseCountBaseline (`asOf`)',
    corroborates: '3번 행 수 기준 스냅샷 갱신 — 그 점검에서 복구 검증을 실제로 호출했다',
    ifMissing:
      '스냅샷이 낡은 채 점검 일자만 새것이 된다 — 행을 잃은 DB 도 「기준치 이상」을 만족하고, ' +
      '기한(`RECOVERY_BASELINE_MAX_AGE_DAYS`)이 미설정이면 §3-2 는 낡음을 `unjudged` 로 보류한다',
  },
  {
    step: 4,
    key: ENV_BASELINE_ENV,
    home: 'env',
    dated: true,
    reader: 'lib/envPresence.ts parseEnvBaseline (`asOf`)',
    corroborates: '4번 설정 키 이름 스냅샷 갱신 — 그 점검에서 헬스 응답을 실제로 읽었다',
    ifMissing:
      '복구일에 「무엇이 빠졌는가」를 판정할 기준이 옛 키 목록이다 — 그 사이 **추가된 키의 유실은 ' +
      '유실로 세어지지 않는다**(§4-12 는 기준 자신의 신선도를 판정하지 않는다)',
  },
  {
    step: 4,
    key: EXPECTED_DB_ENV,
    home: 'env',
    dated: false,
    reader: 'lib/dbIdentity.ts (지문뿐 — 날짜를 품지 않는다)',
    corroborates: '없다 — 이 값의 확인 시점은 점검 일자 말고 어디에도 없다',
    ifMissing:
      '의도한 엔드포인트 변경 뒤 갱신을 거르면 `mismatch` 가 평상시 상태로 굳어 경고로서의 뜻을 ' +
      '잃고, 반대로 옛 지문과 우연히 같으면 §3 5단계 전환 미반영을 `match` 로 덮는다',
  },
  {
    step: 6,
    key: null,
    home: 'table',
    dated: true,
    reader: 'lib/rehearsalLedger.ts parseLedgerTable · lib/ledgerPurpose.ts purposeOfRow (행의 `일자`)',
    corroborates: '6번 §6 표 `점검` 행 기록 — 사람이 그 날짜로 행을 남겼다',
    ifMissing:
      '점검 이력이 **env 한 줄에만** 남는다 — §4 가 「복구 대상」으로 선언한 자리이고 §5-1 Promote 는 ' +
      '옛 배포의 env 스냅샷으로 되돌아간다. 사라지면 「한 번도 점검하지 않은 배포」와 같아진다',
  },
];

/** 키로 정본 한 줄을 찾는다(응답·문구에서 쓴다) */
export function claimSourceFor(key: unknown): ClaimSource | null {
  const k = typeof key === 'string' ? key : '';
  return CLAIM_SOURCES.find((s) => s.key === k) ?? null;
}

/** 실제로 대조할 수 있는 축 — env 에 살고 자기 날짜를 품는 것뿐이다(둘) */
export function datedEnvSources(): ClaimSource[] {
  return CLAIM_SOURCES.filter((s) => s.home === 'env' && s.dated && s.key !== null);
}

/* ─────────────────── 이 대조가 없으면 거짓이 되는 판정 ─────────────────── */

export interface ClaimMisread {
  key: string;
  /** 그 상태가 **무슨 말을 하게 되는가** */
  says: string;
  /** 왜 거짓인가 */
  why: string;
}

export const CLAIM_MISREADS: readonly ClaimMisread[] = [
  {
    key: 'date_is_performance',
    says: '점검 일자가 주기 안이니 §2 를 돌았다',
    why:
      '그 한 줄은 사람이 적은 **주장**이고, 그것만으로 `trusted: true` 가 되어 보존 창·지문이 ' +
      '`confirmed` 로 올라간다 — §2 를 열지 않고 날짜만 고쳐 적어도 같은 응답이 나온다',
  },
  {
    key: 'empty_untrusted_is_fresh',
    says: '`detail.untrusted` 가 비었으니 설정값이 최근 확인된 것이다',
    why:
      '그 목록은 **점검 일자 하나에서** 파생된다(`assessSettingFreshness`) — 값 쪽을 본 적이 없으므로 ' +
      '반년 묵은 수치도 날짜가 새것이면 빈 목록이 된다',
  },
  {
    key: 'stale_snapshot_is_separate',
    says: '스냅샷이 낡았으면 §3-2 가 `stale` 로 말해 준다',
    why:
      '§3-2 는 **기한 설정값이 있을 때만** 낡음을 판정하고(미설정은 `unjudged` 보류), 그 판정은 ' +
      '「값이 낡았다」까지다 — 「점검했다는 날짜가 그 단계를 포함하지 않았다」는 다른 사실이다',
  },
  {
    key: 'overdue_is_skipped',
    says: '`overdue` 니까 아무것도 하지 않았다',
    why:
      '7번(날짜 적기)만 거른 점검도 `overdue` 로 보인다 — 스냅샷의 `asOf` 는 새것인데 경보가 뜨고, ' +
      '사실과 다른 경보는 다음부터 읽히지 않는다',
  },
  {
    key: 'table_row_is_checked',
    says: '§6 표에 점검 행이 쌓여 있으니 기록이 대조된다',
    why:
      '§6-4 는 **리허설 키만** 표와 대조한다(점검 쪽을 env 로 올리지 않는 규율은 옳다) — ' +
      '`RECOVERY_LAST_CHECK` 와 표의 `점검` 행을 견주는 쪽이 없었다',
  },
];

export function claimMisreadFor(key: unknown): ClaimMisread | null {
  const k = typeof key === 'string' ? key : '';
  return CLAIM_MISREADS.find((m) => m.key === k) ?? null;
}

/** 이 판정이 **보지 못하는** 자리 — 숨기지 않고 응답·문서에 함께 싣는다 */
export const CLAIM_BLIND_SPOTS: readonly string[] = [
  '날짜 없는 두 값(1번 보존 창·4번 지문)은 **어떤 대조도 받지 못한다** — 이 판정이 `corroborated` 여도 그 둘의 확인 시점은 여전히 주장뿐이다',
  '점검 일자와 두 스냅샷의 날짜를 **함께** 고쳐 적으면 `aligned` 가 된다 — 적힌 날짜끼리의 정합만 보고 수행 자체를 보지 못한다',
  '§2 2·5번은 **읽기만 하는 단계**라 남기는 값이 없다 — 수행 여부를 말할 축이 처음부터 없다',
  '표 쪽(6번)은 런타임이 읽지 못한다 — §2-4 명령과 CI 만 본다(`basis: env`)',
  '이 배포 스코프의 env 만 본다 — §3 4단계가 읽는 벌(Preview)의 점검 이력은 여기 없다(§3-13)',
];

/* ───────────────────────────── 판정 타입 ───────────────────────────── */

/**
 * - `aligned`    : 값의 기준일이 점검 일자와 같다 — 그 점검에서 갱신됐다.
 * - `ahead`      : 값이 점검 일자보다 **뒤**다(= 점검 일자가 뒤처져 적혔다. 7번을 거른 꼴).
 * - `lagging`    : 값이 점검 일자보다 앞선다 — 그 점검에서 갱신되지 않았다.
 * - `skipped`    : 한 **주기 이상** 앞선다 — 그 점검은 이 단계를 수행하지 않았다고 말할 수 있다.
 * - `undated`    : 값은 있는데 `asOf` 가 없다 — 대조 불가(언제 기준인지 모른다).
 * - `unreadable` : 값이 들어 있으나 판독하지 못했다 — **없는 것과 구분한다**.
 * - `absent`     : 값이 없다 — 각 체크가 이미 미설정으로 드러낸다(중복 보고하지 않는다).
 * - `undatable`  : 그 값은 자기 날짜를 품을 수 없다 — **이 축은 영구히 대조되지 않는다**.
 * - `table_only` : §6 표에만 사는 기록 — 런타임이 읽지 못한다.
 * - `unjudged`   : 점검 일자를 축으로 쓸 수 없어 대조하지 않았다(보류이고 통과가 아니다).
 */
export const SOURCE_VERDICTS = [
  'aligned',
  'ahead',
  'lagging',
  'skipped',
  'undated',
  'unreadable',
  'absent',
  'undatable',
  'table_only',
  'unjudged',
] as const;
export type SourceVerdict = (typeof SOURCE_VERDICTS)[number];

export interface ClaimRow {
  /** 설정 키(표 쪽은 `§6 표 점검 행`) */
  label: string;
  step: number;
  verdict: SourceVerdict;
  /** 그 값이 품은 기준일. 판독 못 했으면 null — **지어내지 않는다** */
  asOf: string | null;
  /** 점검 일자보다 며칠 앞선 값인가(음수 = 값이 더 새것). 판정 불가면 null */
  lagDays: number | null;
  corroborates: string;
  ifMissing: string;
}

/**
 * - `corroborated`  : 대조 가능한 축 중 적어도 하나가 점검 일자와 맞고, 어긋난 축이 없다.
 * - `partly`        : 어긋난 축이 있다(하루 이상 앞선 값) — 그 단계는 그 점검에서 갱신되지 않았다.
 * - `contradicted`  : 한 **주기 이상** 앞선 축이 있다 — 그 점검은 그 단계를 수행하지 않았다.
 * - `date_behind`   : 값이 모두 점검 일자보다 새것이다 — 7번(날짜 적기)이 밀렸다.
 * - `uncorroborated`: 대조할 수 있는 축이 하나도 없다 — 날짜는 **주장 그대로**다.
 * - `no_claim`      : 점검 일자가 없거나 축으로 쓸 수 없다(판독 불가·미래) — §2-1 이 이미 말한다.
 */
export const CLAIM_VERDICTS = [
  'corroborated',
  'partly',
  'contradicted',
  'date_behind',
  'uncorroborated',
  'no_claim',
] as const;
export type ClaimVerdict = (typeof CLAIM_VERDICTS)[number];

export interface ClaimAssessment {
  verdict: ClaimVerdict;
  /** 대조의 축 — 판독된 점검 일자. 쓸 수 없으면 null */
  claimDate: string | null;
  rows: ClaimRow[];
  /** 주장을 뒷받침하는 키 */
  corroborating: string[];
  /** 주장과 어긋나는 키 */
  contradicting: string[];
  /** 대조 자체가 불가능한 축(날짜를 품지 않거나 표에 산다) */
  unverifiable: string[];
  /**
   * §2-1 의 `trusted: true`(= 날짜 없는 설정값을 「최근 확인된 값」으로 쓰는 것)가
   * **뒷받침되는가**. false 가 `trusted` 를 뒤집지는 않는다 — 게이트가 아니다.
   */
  trustQualified: boolean;
  /** `trusted` 가 무엇까지 뜻하는지 한 줄 */
  qualifies: string;
  action: string | null;
  caveats: readonly string[];
}

/* ───────────────────────────── 조치·주의 문구 ───────────────────────────── */

export function actionClaimCorroborated(keys: readonly string[]): string {
  return (
    `점검 일자가 ${keys.join(', ')} 의 기준일과 맞다 — 그 점검에서 해당 단계가 돌았다. ` +
    '다만 날짜 없는 두 값(보존 창·지문)은 대조 대상이 아니다(§2-4 사각지대)'
  );
}

export function actionClaimPartly(keys: readonly string[]): string {
  return (
    `점검 일자보다 앞선 기준일: ${keys.join(', ')} — 그 점검에서 해당 §2 단계가 갱신되지 않았다. ` +
    '지금 그 단계를 수행해 값을 갱신하거나(§2 3·4번), 실제 점검한 날짜로 바로잡을 것'
  );
}

export function actionClaimContradicted(keys: readonly string[], lagDays: number): string {
  return (
    `점검 일자가 주기 안인데 ${keys.join(', ')} 의 기준일은 ${lagDays}일 전이다 — **한 주기 이상** ` +
    '앞서므로 그 점검은 해당 단계를 수행하지 않았다. `detail.trusted` 와 빈 `untrusted` 는 ' +
    '그 날짜에서 파생된 값이라 보존 창·지문의 「최근 확인」을 뒷받침하지 않는다 — 단계를 수행해 ' +
    '값을 갱신한 뒤 날짜를 적을 것(§2-4)'
  );
}

export function actionClaimDateBehind(keys: readonly string[]): string {
  return (
    `${keys.join(', ')} 의 기준일이 점검 일자보다 새것이다 — 단계는 돌았는데 7번(점검 일자 적기)이 ` +
    '밀렸다. 실제 점검한 날짜를 `RECOVERY_LAST_CHECK` 에 적을 것 — 사실과 다른 `overdue` 는 ' +
    '다음부터 읽히지 않는다'
  );
}

export const ACTION_CLAIM_UNCORROBORATED =
  '점검 일자를 뒷받침할 축이 하나도 없다 — §2 3·4번 스냅샷이 비었거나 `asOf` 가 없다. ' +
  '두 스냅샷을 갱신해 두면 다음 점검부터 「날짜만 갱신」이 기계적으로 드러난다(§2-4)';

export const ACTION_CLAIM_NO_CLAIM =
  '점검 일자가 없거나(판독 불가·미래) 대조의 축으로 쓸 수 없다 — 그 상태는 `checks.periodicCheck` ' +
  '가 `absent`/`invalid_date`/`future` 로 이미 말한다. 날짜를 바로잡으면 대조가 시작된다';

export const CAVEAT_ALIGNED_IS_NOT_CORRECT =
  '`aligned` 는 **「그 날짜에 갱신됐다」**까지다 — 옮겨 적은 수치가 Neon 콘솔과 맞는지(오기)는 ' +
  '이 판정도 보지 않는다(§2-1 `CAVEAT_RETENTION_IS_HUMAN_VALUE` 와 같은 한계다)';

export const CAVEAT_UNDATED_STAY_CLAIMS =
  '대조되는 축은 **자기 날짜를 품은 둘**뿐이다 — 정작 신선도가 점검 일자에 걸려 있는 두 값(보존 창 ' +
  '길이·연결 대상 지문)은 날짜를 품지 않아 영구히 `undatable` 이다(`corroborated` 가 그 둘을 보증하지 않는다)';

export const CAVEAT_CLAIM_NOT_A_GATE =
  '이 판정은 **게이트가 아니다** — `ok`·상태 코드·`trusted`·`switchReady` 를 바꾸지 않는다. ' +
  '점검을 거른 배포에 거짓 차단을 만들면 그때부터 아무도 이 판정을 보지 않는다';

/** 이 판정이 보장하지 **못하는** 것 — 응답·RUNBOOK 에 그대로 실어 보낸다 */
export const CLAIM_LIMITS: readonly string[] = [
  CAVEAT_ALIGNED_IS_NOT_CORRECT,
  CAVEAT_UNDATED_STAY_CLAIMS,
  CAVEAT_CLAIM_NOT_A_GATE,
  ...CLAIM_BLIND_SPOTS.slice(1),
];

/* ───────────────────────────── 판독 ───────────────────────────── */

function dayIndex(iso: string): number {
  return Math.floor(new Date(`${iso}T00:00:00Z`).getTime() / MS_DAY);
}

function isoOf(d: Date): string {
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

/** 값 한 칸의 상태 — **미설정·판독 불가·날짜 없음을 섞지 않는다** */
export interface SourceStamp {
  state: 'absent' | 'unreadable' | 'undated' | 'dated';
  asOf: string | null;
}

/**
 * 대조 축 한 줄의 기준일을 읽는다. 판독은 **각 축의 주인 모듈**이 한다 —
 * 행 수 스냅샷은 §3-2, 키 목록 스냅샷은 §4-12.
 */
export function sourceStamp(source: ClaimSource, env: Record<string, string | undefined>): SourceStamp {
  if (source.key === null) return { state: 'absent', asOf: null };
  const raw = String(env[source.key] ?? '').trim();
  if (!raw) return { state: 'absent', asOf: null };
  if (!source.dated) return { state: 'undated', asOf: null };

  if (source.key === DATA_BASELINE_ENV) {
    const parsed = parseCountBaseline(raw);
    if (!parsed) return { state: 'unreadable', asOf: null };
    if (parsed.asOf) return { state: 'dated', asOf: parsed.asOf };
    // 쓸 수 있는 것이 하나도 없는 값은 「날짜가 없다」가 아니라 **판독 못 했다**다(고칠 대상이 다르다).
    const usable = Object.keys(parsed.counts).length > 0;
    return { state: usable ? 'undated' : 'unreadable', asOf: null };
  }
  if (source.key === ENV_BASELINE_ENV) {
    const parsed = parseEnvBaseline(raw);
    if (!parsed) return { state: 'unreadable', asOf: null };
    if (parsed.asOf) return { state: 'dated', asOf: parsed.asOf };
    return { state: parsed.keys.length > 0 ? 'undated' : 'unreadable', asOf: null };
  }
  // 정본에 `dated: true` 로 올라왔으나 판독기를 배선하지 않은 축 — 추측하지 않고 보고한다.
  return { state: 'unreadable', asOf: null };
}

/* ───────────────────────────── 판정 ───────────────────────────── */

/**
 * 점검 일자(주장)와 그 점검이 남겼어야 하는 값의 기준일을 대조한다.
 *
 * 판정 순서를 지킨다 — 축이 없으면(`no_claim`) 값을 봐도 의미가 없고, **한 주기 이상** 앞선
 * 값(`skipped`)이 하루 앞선 값(`lagging`)에 덮이지 않으며, 대조 가능한 축이 없는 상태
 * (`uncorroborated`)를 「맞다」로 올리지 않는다.
 */
export function assessCheckClaim(args: {
  lastCheck?: unknown;
  intervalDays?: number | null;
  env?: Record<string, string | undefined>;
  now?: Date;
}): ClaimAssessment {
  const env = args.env ?? {};
  const interval =
    typeof args.intervalDays === 'number' && Number.isInteger(args.intervalDays) && args.intervalDays >= 1
      ? args.intervalDays
      : null;

  const raw = typeof args.lastCheck === 'string' ? args.lastCheck.trim() : '';
  const parsedDate = raw ? parseRehearsalDate(raw) : null;
  const today = isoOf(args.now ?? new Date());
  // 미래 일자는 §2-1 이 `future` 로 거른다 — 여기서도 **축으로 쓰지 않는다**.
  const claimDate = parsedDate && today && parsedDate > today ? null : parsedDate;

  const rows: ClaimRow[] = CLAIM_SOURCES.map((s) => {
    const base = {
      label: s.key ?? '§6 표 점검 행',
      step: s.step,
      corroborates: s.corroborates,
      ifMissing: s.ifMissing,
      asOf: null as string | null,
      lagDays: null as number | null,
    };
    if (s.home === 'table') return { ...base, verdict: 'table_only' as SourceVerdict };
    if (!s.dated) return { ...base, verdict: 'undatable' as SourceVerdict };

    const stamp = sourceStamp(s, env);
    if (stamp.state === 'absent') return { ...base, verdict: 'absent' as SourceVerdict };
    if (stamp.state === 'unreadable') return { ...base, verdict: 'unreadable' as SourceVerdict };
    if (stamp.state === 'undated') return { ...base, verdict: 'undated' as SourceVerdict };
    if (!claimDate) return { ...base, asOf: stamp.asOf, verdict: 'unjudged' as SourceVerdict };

    const lagDays = dayIndex(claimDate) - dayIndex(stamp.asOf as string);
    const verdict: SourceVerdict =
      lagDays === 0
        ? 'aligned'
        : lagDays < 0
          ? 'ahead'
          : interval !== null && lagDays >= interval
            ? 'skipped'
            : 'lagging';
    return { ...base, asOf: stamp.asOf, lagDays, verdict };
  });

  const pick = (v: SourceVerdict) => rows.filter((r) => r.verdict === v).map((r) => r.label);
  const aligned = pick('aligned');
  const ahead = pick('ahead');
  const lagging = pick('lagging');
  const skipped = pick('skipped');
  const unverifiable = rows
    .filter((r) => r.verdict === 'undatable' || r.verdict === 'table_only')
    .map((r) => r.label);

  const common = {
    claimDate,
    rows,
    corroborating: aligned,
    contradicting: [...skipped, ...lagging],
    unverifiable,
    caveats: CLAIM_LIMITS,
  };

  if (!claimDate) {
    return {
      ...common,
      verdict: 'no_claim',
      corroborating: [],
      contradicting: [],
      trustQualified: false,
      qualifies: '점검 일자가 축으로 쓸 수 없는 상태다 — 대조하지 않았다(보류이고 통과가 아니다)',
      action: ACTION_CLAIM_NO_CLAIM,
    };
  }

  if (skipped.length) {
    const worst = Math.max(...rows.filter((r) => r.verdict === 'skipped').map((r) => r.lagDays ?? 0));
    return {
      ...common,
      verdict: 'contradicted',
      trustQualified: false,
      qualifies:
        '`trusted: true` 는 이 날짜에서 파생된 값이고, 그 날짜가 **적어도 한 단계에 대해 거짓**이다 — ' +
        '보존 창·지문의 「최근 확인」을 뒷받침하지 않는다',
      action: actionClaimContradicted(skipped, worst),
    };
  }

  if (lagging.length) {
    return {
      ...common,
      verdict: 'partly',
      trustQualified: false,
      qualifies:
        '적어도 한 단계는 이 점검에서 갱신되지 않았다 — 그 날짜로 날짜 없는 값을 「최근 확인」이라 ' +
        '부를 근거가 그만큼 약하다',
      action: actionClaimPartly(lagging),
    };
  }

  if (aligned.length) {
    return {
      ...common,
      verdict: 'corroborated',
      trustQualified: true,
      qualifies:
        '대조된 단계는 이 날짜에 돌았다 — 다만 **날짜 없는 두 값은 대조 대상이 아니다**(그 둘의 ' +
        '확인은 여전히 주장뿐이다)',
      action: actionClaimCorroborated(aligned),
    };
  }

  if (ahead.length) {
    return {
      ...common,
      verdict: 'date_behind',
      trustQualified: false,
      qualifies:
        '값이 점검 일자보다 새것이다 — 단계는 돌았으니 위험 쪽으로 기울지는 않지만, 날짜 없는 두 값이 ' +
        '**언제** 확인됐는지는 여전히 알 수 없다',
      action: actionClaimDateBehind(ahead),
    };
  }

  return {
    ...common,
    verdict: 'uncorroborated',
    trustQualified: false,
    qualifies: '이 날짜를 뒷받침하는 축이 하나도 없다 — `trusted: true` 는 **주장 그대로**다',
    action: ACTION_CLAIM_UNCORROBORATED,
  };
}

/* ─────────────────── 표 쪽 대조(§2 6번 — 명령·CI 에서만) ─────────────────── */

/**
 * - `aligned`        : 표의 마지막 `점검` 행 일자가 점검 일자와 같다.
 * - `row_newer`      : 표에 더 새 점검 행이 있다 — 7번(날짜 적기)을 거렀다.
 * - `env_newer`      : env 가 더 새것이다 — 6번(표 기록)을 거렀다.
 * - `no_check_row`   : 표에 `점검` 행이 없다 — 점검 이력이 env 한 줄에만 있다.
 * - `no_table`       : 표를 넘기지 않았다(런타임) — **「행이 없다」가 아니라 보지 않았다**.
 * - `unreadable_row` : `유형` 칸을 읽을 수 없어 점검 행인지 가릴 수 없다(§6-8).
 * - `unjudged`       : 점검 일자가 없어 대조하지 않았다.
 */
export const ROW_VERDICTS = [
  'aligned',
  'row_newer',
  'env_newer',
  'no_check_row',
  'no_table',
  'unreadable_row',
  'unjudged',
] as const;
export type RowVerdict = (typeof ROW_VERDICTS)[number];

export interface CheckRowReconcile {
  verdict: RowVerdict;
  /** 표에서 찾은 마지막 점검 행의 일자 */
  rowDate: string | null;
  /** env 쪽 점검 일자 */
  envDate: string | null;
  /** 표에서 센 점검 행 수 */
  checkRows: number;
  /** 무엇을 해야 하나 */
  action: string | null;
  /** 판정의 근거가 **표를 읽은 것인가** */
  basis: 'table' | 'env';
}

/**
 * §6 표의 `점검` 행과 `RECOVERY_LAST_CHECK` 를 대조한다. 런타임은 저장소 파일을 읽지 않으므로
 * 표를 넘기지 않으면 `no_table`(= 보지 않았다)이고 **「기록이 없다」로 단정하지 않는다**.
 * 목적 판독은 §6-8 `purposeOfRow` 를 그대로 쓴다 — 「정기 점검」을 리허설로 올리지 않는 규율이
 * 그 모듈에 있다.
 */
export function reconcileCheckRow(args: {
  rows?: readonly LedgerRow[] | null;
  lastCheck?: unknown;
  now?: Date;
}): CheckRowReconcile {
  const raw = typeof args.lastCheck === 'string' ? args.lastCheck.trim() : '';
  const parsed = raw ? parseRehearsalDate(raw) : null;
  const today = isoOf(args.now ?? new Date());
  const envDate = parsed && today && parsed > today ? null : parsed;

  if (!args.rows) {
    return {
      verdict: 'no_table',
      rowDate: null,
      envDate,
      checkRows: 0,
      action: '§2-4 명령으로 저장소의 §6 표를 함께 읽어 대조할 것 — 런타임 응답은 표를 보지 못한다',
      basis: 'env',
    };
  }

  const past = args.rows.filter((r) => (today ? r.date <= today : true));
  const checks = past.filter((r) => purposeOfRow(r) === 'check');
  const ambiguous = past.filter((r) => {
    const p = purposeOfRow(r);
    return p === 'ambiguous' || p === 'unreadable';
  });
  const rowDate = checks.length ? checks.reduce((a, b) => (a.date >= b.date ? a : b)).date : null;
  const shell = { rowDate, envDate, checkRows: checks.length, basis: 'table' as const };

  if (!envDate) {
    return { ...shell, verdict: 'unjudged', action: ACTION_CLAIM_NO_CLAIM };
  }
  if (!rowDate) {
    return {
      ...shell,
      verdict: ambiguous.length ? 'unreadable_row' : 'no_check_row',
      action: ambiguous.length
        ? '`유형` 칸을 `점검` 으로 적어 점검 행을 가릴 수 있게 할 것(§6-8 — 겹치는 말은 `ambiguous` 다)'
        : `§6 표에 \`유형: 점검\` 행이 없다 — ${envDate} 점검을 §2 6번대로 표에 1줄 적을 것(env 한 줄만 남으면 Promote 롤백·시크릿 유실로 이력이 사라진다)`,
    };
  }
  if (rowDate === envDate) {
    return { ...shell, verdict: 'aligned', action: null };
  }
  if (rowDate > envDate) {
    return {
      ...shell,
      verdict: 'row_newer',
      action: `표의 점검 행은 ${rowDate} 인데 \`RECOVERY_LAST_CHECK\` 는 ${envDate} 다 — §2 7번을 거른 것이므로 날짜를 맞출 것`,
    };
  }
  return {
    ...shell,
    verdict: 'env_newer',
    action: `\`RECOVERY_LAST_CHECK\` 는 ${envDate} 인데 표의 마지막 점검 행은 ${rowDate} 다 — §2 6번(표 1줄 기록)을 거른 것이다`,
  };
}

/* ───────────────────────────── 출력 ───────────────────────────── */

/** 공개 응답에 실을 모양 — **설정값·행 수·키 목록을 담지 않는다**(판정·키 이름·일자·일수만) */
export function publicClaim(a: ClaimAssessment): Record<string, unknown> {
  return {
    verdict: a.verdict,
    claimDate: a.claimDate,
    corroborating: a.corroborating,
    contradicting: a.contradicting,
    unverifiable: a.unverifiable,
    trustQualified: a.trustQualified,
    qualifies: a.qualifies,
    rows: a.rows.map((r) => ({ label: r.label, step: r.step, verdict: r.verdict, asOf: r.asOf, lagDays: r.lagDays })),
    action: a.action,
    ref: CLAIM_RUNBOOK_REF,
    limits: CLAIM_LIMITS,
  };
}

/** 사람이 읽을 요약 */
export function claimText(a: ClaimAssessment, row?: CheckRowReconcile): string {
  const parts = [`§2 점검 일자의 근거: ${a.verdict}`];
  if (a.claimDate) parts.push(`점검 일자 ${a.claimDate}`);
  if (a.corroborating.length) parts.push(`뒷받침 ${a.corroborating.join(', ')}`);
  if (a.contradicting.length) parts.push(`어긋남 ${a.contradicting.join(', ')}`);
  if (a.unverifiable.length) parts.push(`대조 불가 ${a.unverifiable.join(', ')}`);
  if (row) parts.push(`표 대조 ${row.verdict}`);
  const head = `${parts.join(' · ')}.`;
  const tail = [a.action, row?.action].filter((s): s is string => Boolean(s)).map((s) => `→ ${s}`);
  return tail.length ? `${head}\n${tail.join('\n')}` : head;
}

/** 로그 한 줄 — 판정·키 이름·일자·일수만 */
export function claimLine(a: ClaimAssessment, row?: CheckRowReconcile): string {
  const parts = [`verdict=${a.verdict}`];
  if (a.claimDate) parts.push(`claim_date=${a.claimDate}`);
  parts.push(`trust_qualified=${a.trustQualified}`);
  if (a.corroborating.length) parts.push(`corroborated=${a.corroborating.join(',')}`);
  if (a.contradicting.length) parts.push(`contradicted=${a.contradicting.join(',')}`);
  if (row) parts.push(`row=${row.verdict}`);
  return `[check-claim] ${parts.join(' ')}`;
}

/** 설정 상태 요약(문서·보고용). 값은 담지 않는다 */
export function claimStatus(env: Record<string, string | undefined>): {
  axes: number;
  datedAxes: number;
  configured: string[];
  note: string;
} {
  const dated = datedEnvSources();
  const configured = dated.filter((s) => String(env[s.key as string] ?? '').trim() !== '').map((s) => s.key as string);
  return {
    axes: CLAIM_SOURCES.length,
    datedAxes: dated.length,
    configured,
    note:
      configured.length === 0
        ? '대조 축이 하나도 설정되지 않았다 — 점검 일자는 주장 그대로다(uncorroborated)'
        : `${configured.length}개 축의 기준일로 점검 일자를 대조한다 — 날짜 없는 값은 대조하지 않는다`,
  };
}

/* ───────────────────────────── 정적 점검 ───────────────────────────── */

/**
 * §2 단계 정본(`MONTHLY_STEPS`)과 **양방향** 대조. 값을 공급하는 단계가 늘었는데 대조 축에
 * 적지 않으면(= 그 단계를 거른 점검이 영구히 드러나지 않으면) CI 를 실패시킨다.
 * `MONTHLY_STEPS` 는 **인자로** 받는다 — `lib/periodicCheck.ts` 가 이 모듈을 쓰므로 거꾸로 import 하지 않는다.
 */
export function auditSourceCanon(
  steps: readonly { step: number; supplies: string | null }[],
  claimKey: string,
  sources: readonly ClaimSource[] = CLAIM_SOURCES,
): string[] {
  const problems: string[] = [];
  const keys = new Set(sources.map((s) => s.key).filter((k): k is string => k !== null));
  for (const st of steps) {
    if (!st.supplies || st.supplies === claimKey) continue;
    if (!keys.has(st.supplies)) {
      problems.push(
        `§2 ${st.step}번이 공급하는 ${st.supplies} 가 대조 축 정본에 없다 — 그 단계를 거른 점검이 드러나지 않는다`,
      );
    }
  }
  const declared = new Set(steps.map((s) => s.step));
  for (const s of sources) {
    if (!declared.has(s.step)) problems.push(`대조 축 ${s.key ?? '표'} 의 §2 ${s.step}번 단계가 정본에 없다`);
    if (s.home === 'env' && s.key === null) problems.push('env 축에 키 이름이 없다');
    if (s.home === 'table' && s.key !== null) problems.push(`표 축 ${s.key} 에 설정 키가 붙어 있다`);
  }
  if (!sources.some((s) => s.dated && s.home === 'env')) {
    problems.push('대조할 수 있는 축이 하나도 없다 — 이 판정은 늘 uncorroborated 가 된다');
  }
  return problems;
}

/**
 * 날짜 없는 설정값 정본(`UNDATED_SETTINGS`)과 대조. 그 목록에 있는 키는 이 축에서
 * **`dated: false`** 여야 한다 — 한쪽이 바뀌면 「대조되지 않는 축」이 조용히 뒤집힌다.
 */
export function auditUndatedCanon(undated: readonly { key: string }[]): string[] {
  const problems: string[] = [];
  for (const u of undated) {
    const src = claimSourceFor(u.key);
    if (!src) {
      problems.push(`${u.key} 는 §2-1 이 신선도를 점검 일자에 걸어 둔 값인데 대조 축 정본에 없다`);
      continue;
    }
    if (src.dated) {
      problems.push(`${u.key} 가 대조 축에서 dated: true 다 — §2-1 은 그 값에 날짜가 없다고 선언했다`);
    }
  }
  for (const s of CLAIM_SOURCES) {
    if (s.home !== 'env' || s.dated || s.key === null) continue;
    if (!undated.some((u) => u.key === s.key)) {
      problems.push(`${s.key} 를 dated: false 로 두었는데 §2-1 의 날짜 없는 설정값 정본에 없다`);
    }
  }
  return problems;
}

/** `lib/periodicCheck.ts` 가 이 판정을 **응답에 실어** 보내는지 원문으로 고정한다 */
export function auditPeriodicWiring(src: unknown): string[] {
  const s = String(src ?? '');
  const problems: string[] = [];
  if (!/from\s+'\.\/checkClaim\.ts'/.test(s)) problems.push('periodicCheck 가 checkClaim 을 import 하지 않는다');
  if (!/assessCheckClaim\(/.test(s)) problems.push('assessCheckClaim() 을 호출하지 않는다');
  if (!/claim:\s*publicClaim\(/.test(s)) {
    problems.push('판정을 detail.claim 으로 내보내지 않는다 — 판정만 하고 버리는 꼴이다');
  }
  if (!/intervalDays/.test(s)) problems.push('주기를 넘기지 않는다 — skipped(한 주기 이상)를 판정할 수 없다');
  return problems;
}

/** 새 런타임 체크를 만들지 않았는지 — 판정은 `checks.periodicCheck` 안에서 말한다 */
export function auditNoNewHealthCheck(src: unknown): string[] {
  const s = String(src ?? '');
  return /checks\.checkClaim\s*=/.test(s)
    ? ['`/api/health` 에 checkClaim 체크가 생겼다 — 이 판정은 §2-1 체크 상세로만 나간다(중복 보고 금지)']
    : [];
}

/** 새 환경변수를 만들지 않았는지 — 대조는 **이미 있는 네 키**로만 한다 */
export function auditNoNewEnv(src: unknown): string[] {
  const s = String(src ?? '');
  const problems: string[] = [];
  const known = new Set<string>([
    PITR_RETENTION_ENV,
    DATA_BASELINE_ENV,
    ENV_BASELINE_ENV,
    EXPECTED_DB_ENV,
    'RECOVERY_LAST_CHECK',
    'RECOVERY_CHECK_INTERVAL_DAYS',
    'RECOVERY_BASELINE_MAX_AGE_DAYS',
  ]);
  for (const m of s.matchAll(/RECOVERY_[A-Z0-9_]+/g)) {
    if (!known.has(m[0])) problems.push(`새 환경변수 ${m[0]} 를 들고 있다 — 이 판정은 신규 env 0 이다`);
  }
  if (/process\.env\s*[.[]/.test(s)) problems.push('process.env 에 접근한다 — env 는 명시 인자로만 받는다');
  return problems;
}

/**
 * 순수 모듈 규율 — DB·fs·next 가 들어오지 않았는지, 그리고 **판독을 복제하지 않았는지**.
 * (탐지 패턴은 정규식으로 둔다 — 금지 문자열을 그대로 적으면 그 문자열이 이 소스에 걸려
 *  늘 거짓 경보가 된다.)
 */
export function auditSelfSource(src: unknown): string[] {
  const s = String(src ?? '');
  const problems: string[] = [];
  if (/from\s+['"]@\/db/.test(s) || /drizzle\-orm/.test(s)) problems.push('DB 를 import 한다 — 신규 조회 0 이어야 한다');
  if (/from\s+['"]next/.test(s) || /from\s+['"]node:fs['"]/.test(s)) problems.push('next·fs 를 import 한다 — 순수 모듈이 아니다');
  if (/\breadFileSync\s*\(/.test(s)) problems.push('파일을 읽는다 — 표는 인자로 받는다(런타임은 저장소를 읽지 않는다)');
  if (!/from\s+['"]\.\/recoveryVerify\.ts['"]/.test(s)) {
    problems.push('행 수 스냅샷 판독(`parseCountBaseline`)을 재사용하지 않는다 — §3-2 와 형식 판독이 갈라진다');
  }
  if (!/from\s+['"]\.\/envPresence\.ts['"]/.test(s)) {
    problems.push('키 목록 스냅샷 판독(`parseEnvBaseline`)을 재사용하지 않는다 — §4-12 와 형식 판독이 갈라진다');
  }
  if (!/from\s+['"]\.\/ledgerPurpose\.ts['"]/.test(s)) {
    problems.push('목적 판독(`purposeOfRow`)을 재사용하지 않는다 — 「정기 점검」이 다시 리허설로 접힌다(§6-8)');
  }
  if (!/from\s+['"]\.\/recovery\.ts['"]/.test(s)) {
    problems.push('날짜 판독(`parseRehearsalDate`)을 재사용하지 않는다 — 엄격 파서가 갈라진다');
  }
  return problems;
}

/** 실제 `RUNBOOK.md` 점검 — §2-4 가 **닿을 수 있는 절차**로 남아 있는지 */
export function auditRunbookClaim(src: unknown): string[] {
  const s = String(src ?? '');
  const problems: string[] = [];
  if (!/^###\s*2-4\./m.test(s)) problems.push('RUNBOOK 에 §2-4 소절이 없다 — 판정의 근거 절이 사라졌다');
  for (const v of CLAIM_VERDICTS) {
    if (!s.includes(`\`${v}\``)) problems.push(`§2-4 판정 표에 \`${v}\` 가 없다`);
  }
  for (const m of CLAIM_MISREADS) {
    if (!s.includes(`\`${m.key}\``)) problems.push(`§2-4 가 거짓이 되는 판정 \`${m.key}\` 를 적지 않는다`);
  }
  if (!/assessCheckClaim\(/.test(s)) problems.push('§2-4 에 산출 명령이 없다 — 판정에 닿을 수단이 문서에 없다');
  if (!/reconcileCheckRow\(/.test(s)) problems.push('§2-4 가 표 쪽 대조(6번)를 적지 않는다');
  if (!s.includes('detail.claim')) problems.push('§2-4 가 평상시 확인 수단(detail.claim)을 적지 않는다');

  const start = s.search(/^##\s*2\.\s/m);
  const end = s.search(/^##\s*3\.\s/m);
  const sec2 = start >= 0 && end > start ? s.slice(start, end) : '';
  if (!sec2) {
    problems.push('§2 본문을 찾을 수 없다');
    return problems;
  }
  if (!/2-4/.test(sec2.slice(0, sec2.search(/^###\s*2-1\./m) >= 0 ? sec2.search(/^###\s*2-1\./m) : sec2.length))) {
    problems.push('§2 단계 본문이 2-4 로 유도하지 않는다 — 점검하는 사람이 이 대조에 닿지 못한다');
  }
  return problems;
}
