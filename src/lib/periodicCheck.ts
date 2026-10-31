/**
 * periodicCheck.ts — RUNBOOK **§2 정기 점검(월 1회)** 의 이행과, 그 점검만이 갱신하는
 * **날짜 없는 설정값들의 신선도**를 판정한다. 2026-10-13
 *
 * ── 왜 필요한가 ───────────────────────────────────────────────────────────────
 * §3(DB 복구) 1~8단계와 §5(배포 롤백)를 모두 기계화한 뒤 보면, 그 판정들이 「대조」하는
 * 기준값은 전부 **§2 월 점검 한 곳에서만** 공급된다 — 보존 창 길이(§2 1번), 행 수 기준
 * 스냅샷(3번), 환경변수 스냅샷과 연결 대상 지문(4번). 그런데 §2 자체에는 아무 장치가 없었다.
 *
 *  (1) **점검이 밀렸는지 알려 주는 것이 없었다.** §2 6번은 「6절 표에 1줄 기록」이지만 그 표는
 *      사람이 읽는 표이고, 코드가 보는 것은 `RECOVERY_LAST_REHEARSAL`(리허설)뿐이다. 월 점검을
 *      반년 거른 배포와 지난주에 점검한 배포가 `/api/health` 응답에서 **똑같이 보인다**.
 *  (2) **공급되는 값 중 날짜를 가진 것은 `RECOVERY_DATA_BASELINE` 하나뿐이다.** 그 하나는
 *      `lib/recoveryBaseline.ts` 가 `asOf` 로 낡음을 판정하지만, `RECOVERY_PITR_RETENTION_HOURS`
 *      와 `RECOVERY_EXPECTED_DB` 는 **수치·지문만 있고 언제 확인한 값인지가 없다** — 그래서
 *      한 번 넣으면 영구히 신뢰된다(`pitrWindowCheck` 는 `ok: hours !== null`, `compareIdentity`
 *      는 접두사가 같으면 `match`).
 *
 * 그 둘이 합쳐지면 §3-6 이 막으려고 만든 상태가 **설정값의 신선도 쪽으로 되돌아온다**.
 * Neon 플랜을 내리거나 보존 설정을 바꾼 뒤 §2 가 밀리면, 옛 수치(예: 720시간)가 그대로 남아
 * `planRestorePoint` 는 `windowStart = now - 720h` 로 창을 계산한다 — 실제로는 창 밖인 T 에
 * **`ok` 와 넉넉한 `deadline` 을 돌려준다.** 담당자는 §3 1단계 선행 확인을 통과하고 2단계
 * **쓰기 차단(전 사용자 저장 503)** 을 건 뒤, 3단계에서 Neon 콘솔을 열고서야 그 시점으로는
 * 브랜치를 만들 수 없다는 것을 안다 — **복구는 불가능한데 서비스는 멈춘 상태**다. 어느 단계도
 * 오류를 내지 않는다. `WINDOW_LIMITS` 첫 줄은 이 한계(「보존기간은 사람이 적은 설정값이다 —
 * 플랜 변경을 코드가 알 수 없다」)를 이미 적어 두었지만, 닫는 장치가 없었다.
 *
 * 이 모듈은 「마지막 점검 일자」 하나로 그 구멍을 닫는다 — 날짜 없는 설정값의 **확인 시점**은
 * 그 값을 확인하라고 지시한 절차(§2)가 마지막으로 돌아간 날이다.
 *
 * 원칙
 * - **임의 주기 금지**: 점검 주기는 `RECOVERY_CHECK_INTERVAL_DAYS` 설정값만 인정한다. RUNBOOK 이
 *   「월 1회」라고 적어 두었어도 코드가 그 수치를 들고 오지 않는다(리허설·스냅샷과 같은 규율).
 *   미설정이면 기한 판정을 **보류**(`unjudged`)하고 기존 판정을 끌어내리지 않는다.
 * - **신선도 문제는 DB 문제가 아니다**: 점검이 밀렸다는 사실로 `switchReady` 를 내리지 않는다.
 *   그 값은 복구 대상 DB 의 상태를 뜻하고, 이쪽은 **기준값의 자격**을 뜻한다(판정 순서 규율).
 * - **미설정과 낡음을 섞지 않는다**: 설정되지 않은 값은 각 체크가 이미 미설정으로 드러내므로
 *   여기서 `stale` 로 중복 보고하지 않는다(`not_set`).
 * - 판정은 입력 해석뿐 — DB·네트워크·파일시스템 미접근, 신규 조회·쓰기·DDL 0. 행 수·자격증명·
 *   담당자를 담지 않는다(공개 `/api/health` 에 나가는 값이다).
 */

import { assessCheckClaim, publicClaim } from './checkClaim.ts';
import { addDays, parseRehearsalDate } from './recovery.ts';

/** 마지막 §2 월 점검 일자(YYYY-MM-DD) 설정 키 */
export const LAST_CHECK_ENV = 'RECOVERY_LAST_CHECK';
/** 점검 주기(일) 설정 키. 미설정이면 기한 판정을 하지 않는다 */
export const CHECK_INTERVAL_ENV = 'RECOVERY_CHECK_INTERVAL_DAYS';

const MS_DAY = 86400000;
/** 오타 방어용 범위(일). **기본 주기가 아니다** — 미설정은 null 로 남긴다 */
const INTERVAL_MAX_DAYS = 3650;

/* ───────────────────────────── §2 절차 정본 ───────────────────────────── */

export interface MonthlyStep {
  /** §2 의 단계 번호 */
  step: number;
  /** 그 단계가 하는 일 한 줄 */
  does: string;
  /** 그 단계가 **갱신하는** 설정 키. 확인만 하는 단계는 null */
  supplies: string | null;
  /** 그 설정값이 **자기 날짜를 품는가**. false 면 신선도의 근거가 점검 일자뿐이다 */
  dated: boolean;
  /** 이 단계를 거르면 조용히 생기는 일 — 어느 단계도 오류를 내지 않는다 */
  ifSkipped: string;
}

/**
 * §2 정기 점검의 단계별 정본. **무엇이 어디로 공급되는지**를 적어 둔다 —
 * 문서만 보면 「확인한다」로 보이는 단계가 실은 §3 판정의 유일한 공급원이다.
 */
export const MONTHLY_STEPS: readonly MonthlyStep[] = [
  {
    step: 1,
    does: 'Neon 콘솔에서 PITR 보존 창 길이(시간)를 확인해 수치로 적는다',
    supplies: 'RECOVERY_PITR_RETENTION_HOURS',
    dated: false,
    ifSkipped:
      '플랜·보존 설정을 바꿔도 옛 수치가 남아 §3-6 이 **창 밖 시점에 `ok` 와 deadline 을 낸다** — ' +
      '담당자는 2단계 쓰기 차단(전 사용자 저장 503)을 건 뒤 3단계에서야 복구 불가를 안다',
  },
  {
    step: 2,
    does: '`GET /api/health` 의 db 체크·version·commit 이 배포본과 맞는지 본다',
    supplies: null,
    dated: false,
    ifSkipped: '배포 메타가 어긋난 상태가 평상시에 드러나지 않는다(롤백 고정은 §5-1 이 따로 본다)',
  },
  {
    step: 3,
    does: '`GET /api/admin/recovery-verify` 의 `data.snapshot` 을 기준 스냅샷에 넣는다',
    supplies: 'RECOVERY_DATA_BASELINE',
    dated: true,
    ifSkipped:
      '스냅샷이 낡아 현재 규모보다 낮아진다 — 행을 잃은 DB 도 「기준치 이상」을 만족한다. ' +
      '다만 이 값은 `asOf` 를 품으므로 §3-2(`lib/recoveryBaseline.ts`)가 낡음을 따로 판정한다',
  },
  {
    step: 4,
    does: '환경변수 스냅샷이 최신인지 확인하고, 연결 대상 지문(`match`)을 함께 본다',
    supplies: 'RECOVERY_EXPECTED_DB',
    dated: false,
    ifSkipped:
      '지문이 언제 기준인지 알 수 없는 채 `match` 를 계속 낸다 — 의도한 엔드포인트 변경 후 갱신을 ' +
      '거르면 §3 5단계 전환 확인이 **옛 기준과의 대조**가 된다. 시크릿 키 목록 누락은 복구일에만 드러난다',
  },
  {
    step: 5,
    does: '`checks.recovery.detail.baseline.status` 가 `ok` 인지 본다',
    supplies: null,
    dated: false,
    ifSkipped: '3번이 밀린 사실(스냅샷 `stale`/`undated`)을 확인하는 지점이 사라진다',
  },
  {
    step: 6,
    does: '§6 표에 점검 결과 1줄을 기록한다',
    supplies: null,
    dated: false,
    ifSkipped:
      '표는 사람이 읽는 기록이고 코드가 보는 것은 리허설 키뿐이다 — 기록을 거르면 ' +
      '점검 이력이 어디에도 남지 않는다',
  },
  {
    step: 7,
    does: `점검을 마친 날짜를 \`${LAST_CHECK_ENV}\` 에 적는다`,
    supplies: LAST_CHECK_ENV,
    dated: true,
    ifSkipped:
      '날짜 없는 설정값(1·4번)의 **확인 시점**이 사라져, 반년 거른 배포와 지난주 점검한 배포가 ' +
      '`/api/health` 에서 똑같이 보인다',
  },
];

/* ───────────────────────────── 날짜 없는 설정값 ───────────────────────────── */

export interface UndatedSetting {
  key: string;
  /** 이 키를 읽는 모듈(저장소 루트 기준) — 키가 옮겨 가면 정본을 함께 고치도록 고정한다 */
  ownerFile: string;
  /** 그 값을 쓰는 판정 */
  usedBy: string;
  /** 확인이 낡았을 때 **그 판정이 어떻게 틀리는가** */
  risk: string;
}

/**
 * **자기 날짜를 품지 않는** 설정값 정본. 이 값들의 신선도는 §2 점검 일자뿐이다.
 * (`RECOVERY_DATA_BASELINE` 은 `asOf` 를 품으므로 여기에 없다 — 중복 판정하지 않는다.)
 */
export const UNDATED_SETTINGS: readonly UndatedSetting[] = [
  {
    key: 'RECOVERY_PITR_RETENTION_HOURS',
    ownerFile: 'src/lib/recoveryWindow.ts',
    usedBy: '§3-6 복구 시점이 보존 창 안인지(`planRestorePoint`)',
    risk:
      '실제 보존 창보다 긴 수치가 남으면 창 밖 시점에 `ok` 가 나온다 — 쓰기 차단을 건 뒤 ' +
      '3단계에서 복구 불가를 알게 된다(복구 불가 + 서비스 정지)',
  },
  {
    key: 'RECOVERY_EXPECTED_DB',
    ownerFile: 'src/lib/dbIdentity.ts',
    usedBy: '§3-4 전환이 이 배포에 반영됐는지(`compareIdentity`)',
    risk:
      '엔드포인트를 의도적으로 바꾼 뒤 갱신을 거르면 `mismatch` 가 평상시 상태로 굳어 ' +
      '경고로서의 뜻을 잃고, 반대로 옛 지문과 우연히 같으면 전환 미반영을 `match` 로 덮는다',
  },
];

/* ───────────────────────────── 판정 타입 ───────────────────────────── */

/**
 * - `absent`       : 점검 일자가 없다 — 한 번도 적지 않았거나 지웠다.
 * - `invalid_date` : 적혀 있으나 읽을 수 없다(형식 밖·비실존 날짜) → **없는 것과 구분한다**.
 * - `future`       : 점검 일자가 미래다(오타·시계 어긋남). 기록으로 쓸 수 없다.
 * - `overdue`      : 주기를 넘겼다.
 * - `unjudged`     : 일자는 유효하나 주기(또는 현재 시각)를 몰라 기한을 판정하지 않았다.
 * - `ok`           : 주기 안이다.
 */
export const CHECK_VERDICTS = ['absent', 'invalid_date', 'future', 'overdue', 'unjudged', 'ok'] as const;
export type CheckVerdict = (typeof CHECK_VERDICTS)[number];

export interface MonthlyCheckAssessment {
  verdict: CheckVerdict;
  /** 정규화된 점검 일자(YYYY-MM-DD). 판독 불가면 null — 지어내지 않는다 */
  lastDate: string | null;
  /** 점검 일자로부터 경과 일수. 판정 불가면 null */
  ageDays: number | null;
  /** 판정에 쓴 주기(일). 미설정이면 null → `overdue` 판정을 하지 않는다 */
  intervalDays: number | null;
  /** 다음 점검 기한(점검 일자 + 주기). 둘 중 하나라도 없으면 null */
  dueDate: string | null;
  /** 날짜 없는 설정값을 「최근 확인된 값」으로 써도 되는가 */
  trusted: boolean;
  /** 확인되지 않은 구간을 수치로 적은 한 줄. 판정 불가면 null */
  unconfirmedWindow: string | null;
  /** 사람이 해야 할 일 한 줄 */
  action: string | null;
  caveats: readonly string[];
}

/**
 * - `not_set`     : 값이 없다 — 신선도 문제가 아니다(각 체크가 이미 미설정으로 드러낸다).
 * - `unconfirmed` : 값은 있는데 **확인 시점을 모른다**(점검 일자 없음·판독 불가·미래).
 * - `stale`       : 마지막 확인이 주기를 넘겼다.
 * - `unjudged`    : 주기 미설정 — 낡았는지 판정하지 않았다.
 * - `confirmed`   : 주기 안에 확인됐다.
 */
export type SettingTrust = 'not_set' | 'unconfirmed' | 'stale' | 'unjudged' | 'confirmed';

export interface SettingFreshness {
  key: string;
  trust: SettingTrust;
  /** 이 값이 마지막으로 확인된 날(= §2 점검 일자). 모르면 null */
  confirmedAt: string | null;
  usedBy: string;
  /** 낡았을 때 그 판정이 어떻게 틀리는가 — `confirmed` 에서도 함께 내보낸다 */
  risk: string;
}

/* ───────────────────────────── 조치·주의 문구 ───────────────────────────── */

export const ACTION_CHECK_ABSENT =
  `§2 정기 점검 일자가 없다 — 점검을 수행하고 그 날짜를 \`${LAST_CHECK_ENV}\` 에 적을 것. ` +
  '적히기 전까지 보존 창 길이·연결 대상 지문은 **언제 확인한 값인지 알 수 없는 수치**다(§2-1)';

export const ACTION_CHECK_INVALID =
  `§2 점검 일자를 읽을 수 없다 — \`${LAST_CHECK_ENV}\` 를 \`YYYY-MM-DD\` 로 적을 것. ` +
  '판독할 수 없는 값을 「점검했다」로 세지 않는다';

export const ACTION_CHECK_FUTURE =
  '§2 점검 일자가 미래다 — 오타이거나 서버 시계가 어긋났다. 실제 점검한 날짜로 바로잡을 것. ' +
  '미래 일자를 「최근 확인」으로 세지 않는다';

export function actionCheckOverdue(dueDate: string, ageDays: number): string {
  return (
    `§2 정기 점검이 기한(${dueDate})을 넘겼다 — 마지막 점검이 ${ageDays}일 전이다. ` +
    'Neon 콘솔의 「복구 가능 시점」과 연결 대상 지문을 다시 확인해 설정값을 갱신할 것(§2 1·4번). ' +
    '그 전까지 §3-6 의 보존 창 판정은 **옛 수치 기준**이다'
  );
}

export const ACTION_CHECK_NO_INTERVAL =
  `점검 주기(\`${CHECK_INTERVAL_ENV}\`)가 설정되지 않아 점검이 밀렸는지 판정하지 않았다 — ` +
  'RUNBOOK 이 「월 1회」라고 적어 두었어도 코드가 그 수치를 임의로 쓰지 않는다(§2-1)';

export const ACTION_CHECK_CLOCK =
  '현재 시각을 읽을 수 없어 점검 신선도를 판정하지 못했다 — 서버 시계를 확인할 것';

export function actionCheckOk(dueDate: string): string {
  return `다음 §2 정기 점검 기한: ${dueDate}`;
}

export const CAVEAT_CHECK_IS_A_CLAIM =
  '점검 일자는 **「점검했다고 적었다」**는 뜻이다 — 각 단계를 실제로 수행했는지, 수치를 콘솔과 ' +
  '대조했는지는 이 판정이 확인하지 않는다(값이 바뀌지 않아도 날짜만 갱신될 수 있다). ' +
  '그 주장을 **자기 날짜를 품은 값과 대조**한 결과는 `detail.claim` 에 있다(§2-4)';

export const CAVEAT_RETENTION_IS_HUMAN_VALUE =
  '보존 창 길이는 **정본이 Neon 콘솔**이고 설정값은 사람이 옮겨 적은 사본이다 — 점검 일자가 ' +
  '최근이어도 옮겨 적는 과정의 오기는 이 판정으로 걸러지지 않는다';

export const CAVEAT_NOT_A_DB_VERDICT =
  '이 판정은 **기준값의 자격**만 말한다 — 복구 대상 DB 의 상태(행 수·스키마)는 §3 4·6단계가 본다. ' +
  '점검이 밀렸다는 사실로 `switchReady` 를 내리지 않는다';

/** 점검 신선도가 보장하지 **못하는** 것 — 응답·RUNBOOK 에 그대로 실어 보낸다 */
export const PERIODIC_LIMITS: readonly string[] = [
  CAVEAT_CHECK_IS_A_CLAIM,
  CAVEAT_RETENTION_IS_HUMAN_VALUE,
  CAVEAT_NOT_A_DB_VERDICT,
  '이 판정은 **이 배포의 env 만** 본다 — 다른 스코프(Preview)·다른 배포의 설정값은 알 수 없다',
  '점검 일자 하나가 1·4번 두 값의 확인 시점을 대표한다 — 그중 하나만 확인한 점검도 같은 날짜로 적힌다',
];

/* ───────────────────────────── 설정 로더 ───────────────────────────── */

/**
 * 점검 주기(일). `RECOVERY_CHECK_INTERVAL_DAYS` 설정값만 인정한다.
 * 미설정·형식 밖·범위 밖은 null — 「월 1회」를 코드가 수치로 들고 오지 않는다.
 */
export function checkIntervalDays(env: Record<string, string | undefined> = process.env): number | null {
  const raw = (env.RECOVERY_CHECK_INTERVAL_DAYS ?? '').trim();
  if (!raw || !/^\d{1,4}$/.test(raw)) return null;
  const n = Number(raw);
  return n >= 1 && n <= INTERVAL_MAX_DAYS ? n : null;
}

/** 마지막 점검 일자 원문(미설정이면 null). 판정은 `assessMonthlyCheck` 가 한다 */
export function lastCheckFromEnv(env: Record<string, string | undefined> = process.env): string | null {
  const raw = (env.RECOVERY_LAST_CHECK ?? '').trim();
  return raw ? raw : null;
}

function normalizeInterval(raw: unknown): number | null {
  if (typeof raw !== 'number' || !Number.isInteger(raw)) return null;
  return raw >= 1 && raw <= INTERVAL_MAX_DAYS ? raw : null;
}

function dayIndex(iso: string): number {
  return Math.floor(new Date(`${iso}T00:00:00Z`).getTime() / MS_DAY);
}

function isoOf(d: Date): string {
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

/* ───────────────────────────── 판정 ───────────────────────────── */

/**
 * §2 점검 신선도 판정. 판정 순서를 지킨다 — 값이 없으면(`absent`) 주기를 봐도 의미가 없고,
 * 읽을 수 없는 값(`invalid_date`)을 「없다」로 덮지 않으며(고칠 대상이 다르다), 주기 미설정은
 * 「밀렸다」가 아니라 「기한을 모른다」(`unjudged`)다.
 */
export function assessMonthlyCheck(args: {
  lastCheck?: unknown;
  now?: Date;
  intervalDays?: number | null;
}): MonthlyCheckAssessment {
  const intervalDays = normalizeInterval(args.intervalDays ?? null);
  const shell = {
    intervalDays,
    ageDays: null,
    dueDate: null,
    unconfirmedWindow: null,
    caveats: PERIODIC_LIMITS,
  };

  const raw = typeof args.lastCheck === 'string' ? args.lastCheck.trim() : '';
  if (!raw) {
    return { ...shell, verdict: 'absent', lastDate: null, trusted: false, action: ACTION_CHECK_ABSENT };
  }

  const lastDate = parseRehearsalDate(raw);
  if (!lastDate) {
    return { ...shell, verdict: 'invalid_date', lastDate: null, trusted: false, action: ACTION_CHECK_INVALID };
  }

  const today = isoOf(args.now ?? new Date());
  if (!today) {
    return { ...shell, verdict: 'unjudged', lastDate, trusted: true, action: ACTION_CHECK_CLOCK };
  }

  const ageDays = dayIndex(today) - dayIndex(lastDate);
  if (ageDays < 0) {
    return { ...shell, verdict: 'future', lastDate, trusted: false, action: ACTION_CHECK_FUTURE };
  }

  const dueDate = intervalDays === null ? null : addDays(lastDate, intervalDays);
  const unconfirmedWindow =
    `${lastDate} 이후 ~ ${today} 현재(${ageDays}일) 구간의 Neon 플랜·보존 설정·엔드포인트 변경은 ` +
    '이 설정값들에 반영되지 않았다';
  const common = { ...shell, lastDate, ageDays, dueDate, unconfirmedWindow };

  if (dueDate && today > dueDate) {
    return { ...common, verdict: 'overdue', trusted: false, action: actionCheckOverdue(dueDate, ageDays) };
  }
  if (dueDate === null) {
    return { ...common, verdict: 'unjudged', trusted: true, action: ACTION_CHECK_NO_INTERVAL };
  }
  return { ...common, verdict: 'ok', trusted: true, action: actionCheckOk(dueDate) };
}

/**
 * 날짜 없는 설정값별 신선도. **미설정과 낡음을 섞지 않는다** — 값이 없으면 각 체크가 이미
 * 미설정을 드러내므로 여기서 중복 보고하지 않는다(`not_set`).
 */
export function assessSettingFreshness(args: {
  check: MonthlyCheckAssessment;
  env?: Record<string, string | undefined>;
}): SettingFreshness[] {
  const env = args.env ?? process.env;
  const check = args.check;
  return UNDATED_SETTINGS.map((s) => {
    const configured = String(env[s.key] ?? '').trim() !== '';
    const base = { key: s.key, usedBy: s.usedBy, risk: s.risk };
    if (!configured) {
      return { ...base, trust: 'not_set' as SettingTrust, confirmedAt: null };
    }
    const trust: SettingTrust =
      check.verdict === 'ok'
        ? 'confirmed'
        : check.verdict === 'overdue'
          ? 'stale'
          : check.verdict === 'unjudged'
            ? 'unjudged'
            : 'unconfirmed';
    return { ...base, trust, confirmedAt: check.lastDate };
  });
}

/** 낡음·확인불가 상태인 설정 키만 추린다(응답·로그용) */
export function untrustedSettings(rows: readonly SettingFreshness[]): string[] {
  return rows.filter((r) => r.trust === 'stale' || r.trust === 'unconfirmed').map((r) => r.key);
}

/* ───────────────────────────── 출력 ───────────────────────────── */

/** 사람이 읽을 요약. 날짜·일수·키 이름만 담는다(값·행 수·담당자 없음) */
export function periodicCheckText(check: MonthlyCheckAssessment, rows: readonly SettingFreshness[]): string {
  const parts = [`§2 정기 점검: ${check.verdict}`];
  if (check.lastDate) parts.push(`마지막 점검 ${check.lastDate}`);
  if (check.ageDays !== null) parts.push(`${check.ageDays}일 경과`);
  if (check.dueDate) parts.push(`기한 ${check.dueDate}`);
  const bad = untrustedSettings(rows);
  if (bad.length) parts.push(`확인 시점을 믿을 수 없는 설정: ${bad.join(', ')}`);
  const text = `${parts.join(' · ')}.`;
  return check.action ? `${text}\n→ ${check.action}` : text;
}

/** 로그 한 줄. 판정·날짜·일수·키 이름만 */
export function periodicCheckLine(check: MonthlyCheckAssessment, rows: readonly SettingFreshness[]): string {
  const parts = [`verdict=${check.verdict}`];
  if (check.lastDate) parts.push(`last_check=${check.lastDate}`);
  if (check.ageDays !== null) parts.push(`age_days=${check.ageDays}`);
  if (check.intervalDays !== null) parts.push(`interval_days=${check.intervalDays}`);
  const bad = untrustedSettings(rows);
  if (bad.length) parts.push(`untrusted=${bad.join(',')}`);
  return `[periodic-check] ${parts.join(' ')}`;
}

/* ───────────────────────────── /api/health 체크 ───────────────────────────── */

/**
 * §2 점검이 밀렸는지와, 그 점검만이 갱신하는 날짜 없는 설정값의 신선도를 **평상시에** 드러낸다.
 * 복구일에 「보존 창 안이다」를 받은 뒤 쓰기 차단을 걸고 나서 복구 불가를 아는 순서를 뒤집는 장치다.
 *
 * **required: false** — 점검이 밀려도 degraded(200)로만 드러내고 503 을 만들지 않는다.
 * 공개 엔드포인트이므로 설정 **값**은 담지 않는다(키 이름·날짜·일수만).
 */
export function periodicCheckHealth(args?: {
  env?: Record<string, string | undefined>;
  now?: Date;
}): { ok: boolean; required: false; detail: Record<string, unknown> } {
  const env = args?.env ?? process.env;
  const intervalDays = checkIntervalDays(env);
  const check = assessMonthlyCheck({
    lastCheck: lastCheckFromEnv(env),
    now: args?.now,
    intervalDays,
  });
  const settings = assessSettingFreshness({ check, env });
  // 그 점검 일자가 **주장이 아닌 근거를 갖는지**(§2-4). 위 `trusted`·`untrusted` 는 전부 날짜
  // 한 줄에서 파생되므로, §2 를 열지 않고 날짜만 고쳐 적어도 같은 응답이 나온다 — 그래서 §2 가
  // 공급하는 값 중 **자기 날짜를 품은 둘**(3번 행 수 스냅샷·4번 키 목록 스냅샷)의 기준일과
  // 견준다. 게이트가 아니다 — `ok`·`trusted` 를 바꾸지 않고 **다음에 할 일**만 달라진다.
  const claim = assessCheckClaim({
    lastCheck: lastCheckFromEnv(env),
    intervalDays,
    env,
    now: args?.now,
  });
  return {
    ok: check.verdict === 'ok' || check.verdict === 'unjudged',
    required: false,
    detail: {
      verdict: check.verdict,
      lastDate: check.lastDate,
      ageDays: check.ageDays,
      intervalDays: check.intervalDays,
      dueDate: check.dueDate,
      trusted: check.trusted,
      unconfirmedWindow: check.unconfirmedWindow,
      settings,
      untrusted: untrustedSettings(settings),
      claim: publicClaim(claim),
      configKeys: { lastCheck: LAST_CHECK_ENV, interval: CHECK_INTERVAL_ENV },
      action: check.action,
      limits: PERIODIC_LIMITS,
    },
  };
}

/** 설정 상태 요약(문서·보고용). 값은 담지 않는다 */
export function periodicCheckStatus(env: Record<string, string | undefined> = process.env): {
  intervalConfigured: boolean;
  intervalDays: number | null;
  lastCheckConfigured: boolean;
  note: string;
} {
  const intervalDays = checkIntervalDays(env);
  const last = lastCheckFromEnv(env);
  return {
    intervalConfigured: intervalDays !== null,
    intervalDays,
    lastCheckConfigured: last !== null,
    note:
      intervalDays === null
        ? `${CHECK_INTERVAL_ENV} 미설정 — 점검이 밀렸는지 판정하지 않는다(임의 기본 주기 없음)`
        : `마지막 점검이 ${intervalDays}일을 넘기면 overdue 로 내려 날짜 없는 설정값을 stale 로 표시한다`,
  };
}

/* ───────────────────────────── 배선 정적 점검 ───────────────────────────── */

/** `/api/health` 가 점검 신선도를 **응답에 실어** 보내는지 원문으로 고정한다 */
export function auditHealthWiring(src: unknown): string[] {
  const s = String(src ?? '');
  const problems: string[] = [];
  if (!/from\s+['"]@\/lib\/periodicCheck['"]/.test(s)) problems.push('periodicCheck 를 import 하지 않는다');
  if (!/periodicCheckHealth\(/.test(s))
    problems.push('periodicCheckHealth() 를 호출하지 않는다 — 점검이 밀린 사실이 평상시에 드러나지 않는다');
  if (!/checks\.periodicCheck\s*=\s*periodicCheckHealth\(/.test(s))
    problems.push('판정을 checks.periodicCheck 로 내보내지 않는다(판정만 하고 버리는 꼴)');
  return problems;
}

/**
 * 날짜 없는 설정값의 **소유 모듈이 그 키를 여전히 읽는지** 원문으로 대조한다.
 * 키가 다른 모듈로 옮겨 가거나 이름이 바뀌면 이 정본이 조용히 낡으므로(= 신선도를 엉뚱한
 * 값에 걸어 둔 채 `confirmed` 를 계속 낸다) CI 를 실패시킨다.
 */
export function auditOwnerSources(sources: Record<string, string | undefined>): string[] {
  const problems: string[] = [];
  for (const s of UNDATED_SETTINGS) {
    const src = sources[s.ownerFile];
    if (src === undefined) {
      problems.push(`${s.ownerFile} 원문을 받지 못했다(${s.key} 의 소유 모듈)`);
      continue;
    }
    if (!src.includes(s.key)) problems.push(`${s.ownerFile} 가 ${s.key} 를 더 이상 읽지 않는다 — 정본을 고칠 것`);
  }
  return problems;
}

/**
 * 실제 `RUNBOOK.md` 점검 — §2 가 **이행이 추적되는 절차**로 남아 있는지.
 * 점검 일자 기록 단계나 §2-1 이 사라지면(= 다시 「확인한다」 6줄로 돌아가면) CI 를 실패시킨다.
 */
export function auditRunbookPeriodic(src: unknown): string[] {
  const s = String(src ?? '');
  const problems: string[] = [];
  if (!s.includes(LAST_CHECK_ENV)) problems.push(`점검 일자 키(${LAST_CHECK_ENV})가 문서에 없다`);
  if (!s.includes(CHECK_INTERVAL_ENV)) problems.push(`점검 주기 키(${CHECK_INTERVAL_ENV})가 문서에 없다`);
  if (!/###\s*2-1\./.test(s)) problems.push('§2-1(점검 신선도) 절이 없다');
  if (!s.includes('checks.periodicCheck')) problems.push('평상시 확인 수단(checks.periodicCheck)이 적혀 있지 않다');

  const start = s.search(/^##\s*2\.\s/m);
  const end = s.search(/^##\s*3\.\s/m);
  const sec2 = start >= 0 && end > start ? s.slice(start, end) : '';
  if (!sec2) {
    problems.push('§2 본문을 찾을 수 없다');
    return problems;
  }
  if (!sec2.includes(LAST_CHECK_ENV)) problems.push('§2 단계 본문에 점검 일자 기록 단계가 없다');
  if (!sec2.includes('2-1')) problems.push('§2 본문이 2-1 을 가리키지 않는다 — 담당자가 신선도 절차에 닿지 못한다');
  for (const step of MONTHLY_STEPS) {
    if (step.supplies && !sec2.includes(step.supplies)) {
      problems.push(`§2 본문에 ${step.supplies} 갱신 단계가 없다(${step.step}번)`);
    }
  }
  return problems;
}
