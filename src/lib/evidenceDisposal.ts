/**
 * evidenceDisposal.ts — 절차가 **만들어 내는** DB 밖 사본의 처분(RUNBOOK §3-17·§3-5). 2026-10-28
 *
 * ── 왜 필요한가 ───────────────────────────────────────────────────────────────
 * §3-15 는 「이 절차에서 되돌릴 수 없는 일은 **둘**」이라 적어 두었다 — 8단계 2번의 대외 고지와
 * 5단계 전환으로 사라지는 감사 이력. 그런데 **세 번째가 있다.** §3-5 는 그 사라지는 이력을
 * 지키려고 **DB 밖으로 사본을 내보내라고 지시하고**, 2026-10-26(§3-16)에 그 사본에 **전 테넌트의
 * 메일 주소**가 들어왔다. 한번 내보낸 사본은 복구도·전환도·표지 삭제도 되돌리지 못한다 —
 * 절차가 **스스로 만들어 내는** 유일한 되돌릴 수 없는 산출물이다. 그런데
 *
 *  (1) **처분을 지시하는 단계가 없었다.** §3-5 는 「보존 기간·폐기는 사람이 정한다」 한 줄이고
 *      그 뒤 어떤 단계도 그 사본을 다시 가리키지 않는다. 8단계는 네 가지를 지시하지만 전부
 *      **env 표지와 §6 표**에 대한 것이다 — 사본은 저장소·DB·env 어디에도 없으므로 어떤 판정도
 *      그것을 보지 못하고, 무기한 남아도 **응답이 하나도 달라지지 않는다.**
 *
 *  (2) **사본의 존재를 아는 유일한 단서를 8단계 4번이 지운다.** 「사본이 만들어졌다」고 말하는
 *      것은 `RECOVERY_EVIDENCE_PRESERVED_AT` 하나이고(§3-15), 8단계 4번은 그것을 **여섯 키
 *      전건**과 함께 지우라고 지시한다. 그 지시는 §3-14 때문에 옳다 — 남기면 다음 사건이
 *      물려받는다. 그래서 지우는 것이 맞고, **지운 뒤에는 어느 사건이 어떤 사본을 만들었는지
 *      묻는 수단이 없다.** 폐기 기한은 그 표지가 **아직 있는 동안**에만 산출할 수 있다.
 *
 *  (3) **리허설마다 한 벌씩 쌓인다.** §6 체크리스트는 명단 조회를 「실제로 1회 돌려」 보라고
 *      지시하고(§3-16 의 점검 대상이다) 마지막 항목은 「리허설 브랜치 정리」다 — **브랜치는
 *      정리 대상인데 그 리허설이 만든 사본은 아니다.** 리허설은 `RECOVERY_REHEARSAL_INTERVAL_DAYS`
 *      주기로 되돌아오므로 사본은 주기마다 한 벌씩 늘고, 늘어난 사실을 말하는 자리가 없다.
 *
 *  (4) **삭제 요구권이 사본에 닿지 않는다.** 탈퇴·파기로 서비스 DB 에서 지워도 사본은 그대로다.
 *      보관 위치가 「사내 보관소·티켓 첨부」(§3-5 2번)라 **티켓 시스템이 처리위탁 고지
 *      (`lib/legalDisclosure.ts`)에 없으면 고지되지 않은 위탁**이 되고, 사본에 든 주소는
 *      이미 서비스에 없는 사람의 것일 수 있다.
 *
 * 그래서 이 모듈은 — **사본을 코드가 다룰 수는 없으므로** — 표지가 아직 있는 동안
 * 폐기 기한을 산출해 「그 날짜를 **지금** 영구 기록으로 옮겨라」고 말하고, 절차가 만들어 내는
 * 사본의 정본과 그 사각지대를 판정과 함께 내보낸다.
 *
 * 원칙
 * - 순수 모듈: DB·next·fs·`process.env` 미접근. **신규 조회·쓰기·DDL 0 · 신규 런타임 체크 0 ·
 *   신규 표지 0**. 같은 국면을 `checks.incidentClosure` 가 이미 보고하므로 **그 자리에서** 말한다.
 * - **임의 보관기간 금지**: 기한은 `RECOVERY_EVIDENCE_RETENTION_DAYS` 만 인정하고, 미설정이면
 *   `unjudged`(= 「기한을 모른다」)로 남긴다 — 법정 보존기간·사내 규정을 코드가 정하지 않는다.
 * - **판정 어휘와 `ok` 를 바꾸지 않는다.** 폐기는 사람이 하는 일이고 코드가 확인할 수 없다 —
 *   미폐기로 `ok` 를 내리면 복구일에 거짓 차단이 된다. 달라지는 것은 **다음에 할 일**이다.
 * - **공개 응답에 새 시각을 노출하지 않는다** — 기한 날짜는 §3-17 의 1줄 명령에서만 나온다.
 */
import {
  PRESERVED_AT_ENV,
  assessPreservation,
  preservedAtFromEnv,
  type PreservationAssessment,
} from './evidencePreservation.ts';
import { parseInstant } from './incidentEvidence.ts';
import { addDays, parseRehearsalDate } from './recovery.ts';

/** 응답·문서에서 근거 절을 찾을 수 있게 한다 */
export const DISPOSAL_RUNBOOK_REF = 'RUNBOOK §3-17·§3-5';

/**
 * 사본의 **보관 기한**(일). 사람이 정한다 — 미설정이면 기한 판정을 보류하고
 * 임의 기본 보관기간을 만들지 않는다(`RECOVERY_REHEARSAL_INTERVAL_DAYS` 와 같은 규율).
 *
 * ※ 이 키는 **사건 표지가 아니다** — 8단계 4번의 삭제 대상에 넣으면 사건이 끝날 때마다
 *   기한 판정이 영구히 보류된다(`auditNotAMarker` 가 그것을 CI 로 잡는다).
 */
export const RETENTION_ENV = 'RECOVERY_EVIDENCE_RETENTION_DAYS';

/* ───────────────────── 절차가 만들어 내는 DB 밖 사본 ───────────────────── */

export interface ExportedCopy {
  /** 사본의 이름 */
  artifact: string;
  /** 그것을 만들라고 지시하는 자리 */
  madeBy: string;
  /** 사본에 들어 있는 것 */
  contains: string;
  /** 개인정보가 들어 있는가 */
  personalData: boolean;
  /** 내보낸 뒤 **되돌릴 수 있는가** — 전건 false 가 이 장치의 전제다 */
  recallable: false;
  /** 서비스 DB 의 삭제·파기(탈퇴 처리·삭제 요구)가 이 사본에 **닿는가** */
  erasureReaches: boolean;
  /** 리허설을 돌릴 때도 만들어지는가(= 주기마다 한 벌씩 는다) */
  madeInRehearsal: boolean;
}

/**
 * §3-5 가 DB 밖으로 내보내라고 지시하는 사본 전건. 셋 다 **복구 대상 밖**에 두라고
 * 지시한 것이므로(그래야 전환과 함께 사라지지 않는다) 복구·전환·표지 삭제가 **되돌리지 못한다**.
 */
export const EXPORTED_COPIES: readonly ExportedCopy[] = [
  {
    artifact: '감사로그 사본',
    madeBy: '§3-5 2번(`GET /api/audit` 를 커서로 끝까지 받아 DB 밖에 저장)',
    contains: '업무 데이터 변경 이력 + **행위자 이름**(§3-5 2번이 「접근통제되는 보관소에 둔다」고 적어 둔 이유다)',
    personalData: true,
    recallable: false,
    erasureReaches: false,
    madeInRehearsal: true,
  },
  {
    artifact: '보안·인증 이벤트 사본',
    madeBy: '§3-5 2번(`GET /api/admin/security-events` — 슈퍼관리자 전용)',
    contains: '로그인·비밀번호 재설정·잠금 이력(계정 식별자)',
    personalData: true,
    recallable: false,
    erasureReaches: false,
    madeInRehearsal: true,
  },
  {
    artifact: '조직·회원 명단',
    madeBy: '§3-5 3번(`noticeAudience.ROSTER_SNAPSHOT_SQL` 를 **복구 전 DB** 에 1회 실행)',
    contains: '전 테넌트의 조직·구성원과 **연락처**(`users.email`) · `created_at`',
    personalData: true,
    recallable: false,
    erasureReaches: false,
    // §6 체크리스트는 이 조회를 「실제로 1회 돌려」 조직 수·회원 수가 나오는지 보라고 지시한다 —
    // 그래서 리허설마다 **운영 메일 주소 한 벌**이 DB 밖으로 더 나간다.
    madeInRehearsal: true,
  },
];

/* ─────────────────────── 사본이 남아도 드러나지 않는 이유 ─────────────────────── */

export interface DisposalBlindSpot {
  key: string;
  /** 무엇이 보이지 않는가 */
  what: string;
  /** 왜 어떤 판정도 그것을 말하지 못하는가 */
  why: string;
}

/** 전건 **드러나지 않는다** — 사본은 저장소·DB·env 어디에도 없다 */
export const DISPOSAL_BLIND_SPOTS: readonly DisposalBlindSpot[] = [
  {
    key: 'copy_invisible',
    what: '사본이 **존재하는지** 자체',
    why: '보관소는 저장소·DB·env 밖이다 — 코드가 닿는 세 곳 어디에도 사본의 흔적이 없다. 이 모듈이 보는 것은 「만들라고 지시했고, 만들었다고 적힌 시각이 있다」까지다',
  },
  {
    key: 'marker_cleared',
    what: '**어느 사건**이 사본을 만들었는가',
    why: `8단계 4번이 ${PRESERVED_AT_ENV} 를 지우라고 지시한다(§3-14 때문에 옳다) — 지운 뒤에는 기한의 기준점이 없어 폐기 기한을 다시 산출할 수 없다`,
  },
  {
    key: 'rehearsal_accrual',
    what: '사본이 **몇 벌** 있는가',
    why: '리허설마다 한 벌씩 늘지만 세는 자리가 없다 — 체크리스트의 마지막 항목은 「리허설 브랜치 정리」이고 사본은 그 목록에 없다',
  },
  {
    key: 'erasure_gap',
    what: '사본 안의 **탈퇴·파기 대상**',
    why: '서비스 DB 의 삭제는 사본에 닿지 않는다 — 이미 서비스에 없는 사람의 주소가 사본에 남아 있을 수 있고, 그 사실은 어느 응답에도 나오지 않는다',
  },
  {
    key: 'processor_undisclosed',
    what: '보관소가 **고지된 수탁자인가**',
    why: '보관 위치가 「사내 보관소·티켓 첨부」(§3-5 2번)라 티켓 시스템이 처리위탁 고지(`lib/legalDisclosure.ts`)에 없으면 **고지되지 않은 위탁**이 된다 — 코드는 보관 위치를 모르므로 대조할 수 없다',
  },
];

/* ─────────────────────────── 기한 ─────────────────────────── */

export interface RetentionSetting {
  raw: string | null;
  /** 판독한 일수. 형식 밖·0 이하·소수는 null — 추측하지 않는다 */
  days: number | null;
}

/**
 * 보관 기한(일). `RECOVERY_EVIDENCE_RETENTION_DAYS` **만** 인정한다.
 *
 * 1 이상의 정수만 받는다 — `0`·음수·소수는 판독 실패로 둔다(「즉시 폐기」를 수치로 받아
 * 주면 사본을 만들지 않은 것과 같은 모습이 되고, 그 둘은 전혀 다른 상태다).
 *
 * ※ 키를 **리터럴로** 읽는다 — `env[RETENTION_ENV]` 로 쓰면 `envRegistry.scanEnvReads` 가
 *   잡지 못해, 레지스트리·RUNBOOK §4 에서 빠져도 CI 가 조용히 통과한다(= 복구에서 유실된다).
 */
export function retentionFromEnv(env: Record<string, string | undefined> = {}): RetentionSetting {
  const raw = (env.RECOVERY_EVIDENCE_RETENTION_DAYS ?? '').trim();
  if (!raw) return { raw: null, days: null };
  if (!/^\d+$/.test(raw)) return { raw, days: null };
  const days = Number(raw);
  if (!Number.isSafeInteger(days) || days < 1) return { raw, days: null };
  return { raw, days };
}

export interface DisposalDeadline {
  /** 폐기 기한(YYYY-MM-DD). 기준점·기한 중 하나가 없으면 null — 날짜를 지어내지 않는다 */
  dueDate: string | null;
  /** 기한을 넘긴 일수. `due` 일 때만 수치이고 그 밖에는 null */
  overdueDays: number | null;
}

/**
 * 보존 시각 + 기한 일수 → 폐기 기한. 시각까지 비교하면 같은 날 안에서 「지났다/안 지났다」가
 * 갈려 기한이 재현되지 않으므로 **날짜**에 일수를 더한다.
 *
 * ※ 그 날짜는 **표기된 날짜 그대로**다(`parseInstant` 와 같은 규율) — UTC 로 환산한 날짜를 쓰면
 *   `+09:00` 으로 적은 심야 시각이 **전날**이 되어 기한이 하루 앞당겨진다. 보관 기한은 사람이
 *   보관소 규정으로 정한 수치라, 적어 둔 날짜에서 세는 것이 맞다.
 */
export function disposalDeadline(preservedAt: unknown, days: number | null, asOf: unknown): DisposalDeadline {
  const base = parseInstant(preservedAt);
  const baseDate = parseRehearsalDate(String(preservedAt ?? '').trim().slice(0, 10));
  if (!base || !baseDate || days === null) return { dueDate: null, overdueDays: null };
  const dueDate = addDays(baseDate, days);
  const today = parseRehearsalDate(String(asOf ?? '').slice(0, 10));
  if (!today) return { dueDate, overdueDays: null };
  const diff = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${dueDate}T00:00:00Z`)) / 86_400_000);
  return { dueDate, overdueDays: diff > 0 ? diff : null };
}

/* ─────────────────────────── 판정 ─────────────────────────── */

export const DISPOSAL_VERDICTS = [
  'not_applicable',
  'invalid_record',
  'invalid_retention',
  'carried_basis',
  'unjudged',
  'scheduled',
  'due',
] as const;
export type DisposalVerdict = (typeof DISPOSAL_VERDICTS)[number];

export const ACTION_DISPOSAL_NONE =
  `이 배포의 env 로는 사본이 있는지 말할 수 없다 — ${PRESERVED_AT_ENV} 가 없으면 기한의 기준점도 없다. ` +
  '지난 사건·리허설이 만든 사본의 처분은 §6 표 비고에 적어 둔 기한으로만 추적된다(§3-17)';
export const ACTION_DISPOSAL_INVALID_RECORD =
  `${PRESERVED_AT_ENV} 를 타임존 붙인 ISO 로 다시 적는다 — 기한의 기준점을 읽을 수 없으면 ` +
  '폐기 기한을 산출할 수 없고, 8단계 4번에서 그 값을 지우면 다시 산출할 기회가 없다';
export const ACTION_DISPOSAL_INVALID_RETENTION =
  `${RETENTION_ENV} 를 **1 이상의 정수(일)** 로 다시 적는다 — 판독 불가를 「기한 없음」으로도 ` +
  '「즉시 폐기」로도 세지 않는다';
export const ACTION_DISPOSAL_CARRIED =
  `${PRESERVED_AT_ENV} 가 이번 차단보다 **앞선** 값이다(§3-14) — 그 값으로 산출한 기한은 ` +
  '**지난 사건의 사본**에 대한 것이고, 이번 사건의 사본에는 기준점이 아직 없다. 먼저 §3-15 의 ' +
  '할 일(차단 뒤로 다시 받아 시각을 다시 적는다)을 끝낸 뒤 이 기한을 다시 산출한다';
export const ACTION_DISPOSAL_UNJUDGED =
  `${RETENTION_ENV} 가 비어 있어 폐기 기한을 판정하지 않는다 — 법정 보존기간·사내 규정을 코드가 ` +
  '정하지 않는다. 일수를 정해 §4-7 에 넣으면 그때부터 기한이 산출된다(판정 보류이고 통과가 아니다)';
export const ACTION_DISPOSAL_SCHEDULED =
  '폐기 기한을 산출했다 — 그 날짜를 **지금** §6 표 비고에 옮겨 적는다. 8단계 4번에서 ' +
  `${PRESERVED_AT_ENV} 를 지우면 기준점이 사라져 기한을 다시 산출할 수 없고, 사본은 보관소에 남는다`;
export const ACTION_DISPOSAL_DUE =
  '폐기 기한이 지났다 — 보관소의 사본(감사로그·보안 이벤트·조직·회원 명단)을 폐기하고 ' +
  '폐기한 사실을 §6 표 비고에 적는다. 코드는 폐기를 확인할 수 없다(보관소는 저장소·DB·env 밖이다)';

const VERDICT_NOTE: Record<DisposalVerdict, string> = {
  not_applicable: `보존 기록이 없다 — 이 배포의 env 는 사본의 존재를 말하지 않는다(${DISPOSAL_BLIND_SPOTS[0].key})`,
  invalid_record: `${PRESERVED_AT_ENV} 를 읽을 수 없어 기한의 기준점이 없다`,
  invalid_retention: `${RETENTION_ENV} 를 읽을 수 없다 — 「기한 없음」으로 내려앉히지 않는다`,
  carried_basis: '기준점이 지난 사건의 표지다 — 산출되는 기한은 이번 사본의 것이 아니다',
  unjudged: '기한 일수가 설정되지 않아 폐기 기한을 판정하지 않는다(임의 보관기간을 쓰지 않는다)',
  scheduled: '폐기 기한을 산출했다 — 기준점이 지워지기 전에 영구 기록으로 옮긴다',
  due: '폐기 기한이 지났다 — 보관소의 사본을 폐기한다',
};

export const CAVEAT_DISPOSAL_NOT_VERIFIED =
  '**폐기를 코드가 확인하지 않는다** — 보관소는 저장소·DB·env 밖이고, 이 판정은 「기한이 언제인가」까지만 말한다';
export const CAVEAT_DISPOSAL_EXISTENCE_UNKNOWN =
  '사본이 **실제로 만들어졌는지도** 이 값으로는 알 수 없다 — 보존 기록은 사람이 적은 주장이다(§3-15 와 같은 한계)';
export const CAVEAT_DISPOSAL_BASIS_EPHEMERAL =
  `기한의 기준점(${PRESERVED_AT_ENV})은 8단계 4번에서 **지우라고 지시된 값**이다 — 지운 뒤에는 ` +
  '기한을 다시 산출할 수 없으므로 영구 기록(§6 표 비고)으로 옮기는 것이 유일한 수단이다';

export const DISPOSAL_LIMITS: readonly string[] = [
  CAVEAT_DISPOSAL_NOT_VERIFIED,
  CAVEAT_DISPOSAL_EXISTENCE_UNKNOWN,
  CAVEAT_DISPOSAL_BASIS_EPHEMERAL,
  '사본이 **몇 벌** 있는지 세지 않는다 — 리허설마다 한 벌씩 늘고, 이 판정은 이 배포 env 의 한 벌만 본다',
  '보관 **위치**를 모르므로 처리위탁 고지(`lib/legalDisclosure.ts`)와 대조하지 않는다 — 고지되지 않은 위탁인지는 사람이 본다',
  '서비스 DB 의 삭제·파기가 사본에 닿지 않는다는 사실을 말할 뿐, 사본 안에 **누가** 남아 있는지는 보지 않는다',
  '기한을 넘긴 사본이 있어도 `/api/health` 는 **degraded 로도 바뀌지 않는다** — 새 체크를 만들지 않았다(§3-17)',
];

export interface DisposalAssessment {
  verdict: DisposalVerdict;
  /** 기한의 기준점(= §3-5 보존을 마친 시각). 판독 실패·미설정이면 null */
  basisAt: string | null;
  /** 그 기준점이 **이번 사건**의 것이라고 말할 수 있는가(§3-14) */
  basisCorroborated: boolean;
  /** 설정된 보관 기한(일). 미설정·판독 실패면 null */
  retentionDays: number | null;
  dueDate: string | null;
  overdueDays: number | null;
  /** 절차가 만들어 내는 사본 수 */
  copies: number;
  /** 그중 개인정보가 들어 있는 사본 수 */
  personalDataCopies: number;
  /** 지금 할 일이 있는가 — 읽는 쪽이 조건식을 다시 짜면 판정이 두 곳에서 갈린다 */
  actionable: boolean;
  action: string;
  note: string;
  caveats: readonly string[];
}

/**
 * 사본 처분의 판정.
 *
 * 판정 순서: 기준점을 **읽을 수 있는가** → 기준점이 **있는가**(없으면 기한을 말할 자리가 아니다) →
 * 기한 값이 **판독되는가** → 기준점이 **이번 사건의 것인가** → 기한이 **설정됐는가** → 기한 경과.
 *
 * 순서를 바꾸면 (가) 지난 사건의 표지로 산출한 기한이 `due` 로 나와 **이번 사본을 폐기 대상으로**
 * 보고하고(실제로 폐기해야 하는 것은 지난 사본이고, 이번 사본은 기준점조차 없다),
 * (나) 판독 불가한 기한 값이 `unjudged`(= 「정하면 된다」)로 덮여 **이미 정해 둔 정책이 사라진 것**을
 * 알아챌 수 없다.
 */
export function assessDisposal(input?: {
  env?: Record<string, string | undefined>;
  /** 오늘(YYYY-MM-DD 또는 ISO). 기본값은 호출 시각 */
  asOf?: string | Date;
  /** 이미 계산한 보존 판정이 있으면 그대로 쓴다(두 번 계산하면 어긋날 수 있다) */
  preservation?: PreservationAssessment;
}): DisposalAssessment {
  const env = input?.env ?? {};
  const asOf = input?.asOf ?? new Date();
  const asOfIso = asOf instanceof Date ? asOf.toISOString() : String(asOf);
  const pres = input?.preservation ?? assessPreservation({ env });
  const retention = retentionFromEnv(env);
  // 기한의 기준 날짜는 **적어 둔 표기 그대로**에서 센다 — `pres.preservedAt` 은 UTC 로 정규화된
  // 값이라 `+09:00` 심야 시각이 전날로 바뀐다(위 `disposalDeadline` 주석).
  const deadline = disposalDeadline(preservedAtFromEnv(env).raw, retention.days, asOfIso);

  let verdict: DisposalVerdict;
  if (pres.state === 'invalid_record') verdict = 'invalid_record';
  else if (!pres.preservedAt) verdict = 'not_applicable';
  else if (retention.raw && retention.days === null) verdict = 'invalid_retention';
  else if (pres.basis === 'carried_over') verdict = 'carried_basis';
  else if (retention.days === null) verdict = 'unjudged';
  else if (deadline.overdueDays !== null) verdict = 'due';
  else verdict = 'scheduled';

  const ACTION: Record<DisposalVerdict, string> = {
    not_applicable: ACTION_DISPOSAL_NONE,
    invalid_record: ACTION_DISPOSAL_INVALID_RECORD,
    invalid_retention: ACTION_DISPOSAL_INVALID_RETENTION,
    carried_basis: ACTION_DISPOSAL_CARRIED,
    unjudged: ACTION_DISPOSAL_UNJUDGED,
    scheduled: ACTION_DISPOSAL_SCHEDULED,
    due: ACTION_DISPOSAL_DUE,
  };

  return {
    verdict,
    basisAt: pres.preservedAt,
    basisCorroborated: pres.corroborated,
    retentionDays: retention.days,
    dueDate: verdict === 'carried_basis' || verdict === 'not_applicable' ? null : deadline.dueDate,
    overdueDays: deadline.overdueDays,
    copies: EXPORTED_COPIES.length,
    personalDataCopies: EXPORTED_COPIES.filter((c) => c.personalData).length,
    // `not_applicable` 은 평상시 상태다 — 할 일로 올리면 상시 떠 있는 문구가 되어
    // 정작 사본이 있는 국면의 할 일을 덮는다(§3-14 가 같은 이유로 둔 규율).
    actionable: verdict !== 'not_applicable' && verdict !== 'scheduled',
    action: ACTION[verdict],
    note: VERDICT_NOTE[verdict],
    caveats: DISPOSAL_LIMITS,
  };
}

/* ─────────────────────────── 출력 ─────────────────────────── */

/** 로그 한 줄. 판정·일수만 — **날짜는 담지 않는다** */
export function disposalLine(a: DisposalAssessment): string {
  const parts = [`disposal=${a.verdict}`, `retention=${a.retentionDays ?? 'unset'}`, `copies=${a.copies}`];
  if (a.overdueDays !== null) parts.push(`overdueDays=${a.overdueDays}`);
  return `[disposal] ${parts.join(' ')}`;
}

/** 사람이 읽는 요약(§3-17 의 1줄 명령이 출력하는 것) — **여기에만** 기한 날짜가 나온다 */
export function disposalText(a: DisposalAssessment): string {
  const lines = [
    `[${a.verdict}] 기준점 ${a.basisAt ?? '(미설정)'} · 보관 기한 ${a.retentionDays ?? '(미설정)'}일 · 폐기 기한 ${a.dueDate ?? '(산출 불가)'}`,
    `· 절차가 만드는 DB 밖 사본 ${a.copies}건(개인정보 포함 ${a.personalDataCopies}건) — 전건 **되돌릴 수 없다**`,
    `· 드러나지 않는 것 ${DISPOSAL_BLIND_SPOTS.length}건`,
  ];
  if (a.overdueDays !== null) lines.push(`· 기한을 ${a.overdueDays}일 넘겼다`);
  lines.push(`→ ${a.action}`);
  for (const c of a.caveats) lines.push(`※ ${c}`);
  return lines.join('\n');
}

/**
 * 공개 응답용 필터 — **새 날짜를 노출하지 않는다**(기준점·폐기 기한 모두 제외).
 * 사건 중 무인증 응답에서 기한 날짜는 보존 시각을 되돌려 말해 주는 값이다(§2-3).
 */
export function publicDisposal(a: DisposalAssessment): {
  verdict: DisposalVerdict;
  retentionConfigured: boolean;
  overdueDays: number | null;
  copies: number;
  runbook: string;
} {
  return {
    verdict: a.verdict,
    retentionConfigured: a.retentionDays !== null,
    overdueDays: a.overdueDays,
    copies: a.copies,
    runbook: DISPOSAL_RUNBOOK_REF,
  };
}

/** 배선 상태 요약(문서·보고용) */
export function disposalStatus(env: Record<string, string | undefined> = {}, asOf?: string | Date): {
  verdict: DisposalVerdict;
  retentionKey: string;
  copies: number;
  blindSpots: number;
  limits: number;
  action: string;
} {
  const a = assessDisposal({ env, asOf });
  return {
    verdict: a.verdict,
    retentionKey: RETENTION_ENV,
    copies: EXPORTED_COPIES.length,
    blindSpots: DISPOSAL_BLIND_SPOTS.length,
    limits: DISPOSAL_LIMITS.length,
    action: a.action,
  };
}

/* ─────────────────────────── 정적 점검 ─────────────────────────── */

/** 정본 자신의 모양 — 사본 목록·사각지대가 사유 없이 비어 있지 않은지 */
export function auditDisposalCanon(
  copies: readonly ExportedCopy[] = EXPORTED_COPIES,
  spots: readonly DisposalBlindSpot[] = DISPOSAL_BLIND_SPOTS,
): string[] {
  const problems: string[] = [];
  if (copies.length === 0) problems.push('사본 정본이 비었다 — 절차가 무엇을 만들어 내는지 적을 자리가 사라졌다');
  for (const c of copies) {
    if (!c.madeBy.trim()) problems.push(`${c.artifact} 를 만들라고 지시하는 자리가 적혀 있지 않다`);
    if (!c.contains.trim()) problems.push(`${c.artifact} 에 무엇이 들어 있는지 적혀 있지 않다`);
    if (c.recallable !== false) {
      problems.push(`${c.artifact} 가 되돌릴 수 있다고 선언돼 있다 — 회수 경로가 생겼다면 이 절이 아니라 그 경로를 가리켜야 한다`);
    }
    if (c.erasureReaches) {
      problems.push(
        `${c.artifact} 에 서비스 DB 의 삭제가 닿는다고 선언돼 있다 — 사실이면 그 경로를 적고, 아니면 이 선언을 되돌릴 것`,
      );
    }
  }
  if (!copies.some((c) => c.personalData)) {
    problems.push('개인정보가 든 사본이 하나도 없다고 선언돼 있다 — §3-5 3번의 명단이 빠졌는지 볼 것');
  }
  if (spots.length === 0) problems.push('사각지대 정본이 비었다');
  for (const s of spots) {
    if (!s.what.trim() || !s.why.trim()) problems.push(`사각지대 ${s.key} 에 설명이 없다`);
  }
  return problems;
}

/**
 * 보관 기한 키가 **사건 표지가 아닌지**. 표지로 등록하면 8단계 4번의 전건 삭제 대상이 되어
 * 사건이 끝날 때마다 기한 판정이 `unjudged` 로 돌아가고, 그 사실은 어느 응답에도 나오지 않는다.
 */
export function auditNotAMarker(markers: unknown, transient: unknown): string[] {
  const rows = Array.isArray(markers) ? markers : [];
  const keys = Array.isArray(transient) ? transient.map((k) => String(k)) : [];
  const problems: string[] = [];
  if (rows.length === 0) problems.push('사건 표지 목록을 읽을 수 없다 — INCIDENT_MARKERS 의 모양이 바뀌었으면 이 가드를 함께 볼 것');
  else if (rows.some((m) => String((m as { key?: unknown })?.key ?? m ?? '') === RETENTION_ENV)) {
    problems.push(`${RETENTION_ENV} 가 사건 표지에 들어 있다 — 사건이 끝날 때마다 기한 판정이 보류로 돌아간다`);
  }
  if (keys.length === 0) problems.push('임시 키 목록을 읽을 수 없다 — TRANSIENT_KEYS 의 모양이 바뀌었으면 이 가드를 함께 볼 것');
  else if (keys.includes(RETENTION_ENV)) {
    problems.push(`${RETENTION_ENV} 가 임시 키 목록에 있다 — 보관 정책은 평상시에도 남아 있어야 하는 설정값이다`);
  }
  return problems;
}

/** 레지스트리 등록 — 빠지면 복구에서 조용히 유실되고 §4 문서 대조도 함께 멈춘다 */
export function auditRegistryCoverage(vars: readonly { key: string }[] = []): string[] {
  const known = new Set(vars.map((v) => v.key));
  return known.has(RETENTION_ENV) ? [] : [`${RETENTION_ENV} 가 env 레지스트리에 없다 — 복구 시 조용히 유실된다`];
}

/** `src/lib/incidentClosure.ts` 원문 — 판정을 **응답에 실어 보내는지**까지 본다 */
export function auditClosureWiring(src: unknown): string[] {
  const s = String(src ?? '');
  const problems: string[] = [];
  if (!/from\s+['"]\.\/evidenceDisposal\.ts['"]/.test(s)) {
    problems.push('incidentClosure 가 evidenceDisposal 을 import 하지 않는다');
  }
  if (!/assessDisposal\(/.test(s)) problems.push('incidentClosure 가 assessDisposal() 을 호출하지 않는다');
  if (!/disposalVerdict\s*:/.test(s)) {
    problems.push('incidentClosure 가 disposalVerdict 를 detail 에 담지 않는다 — 판정만 하고 버린다');
  }
  if (!/disposalRetentionConfigured\s*:/.test(s)) {
    problems.push('incidentClosure 가 disposalRetentionConfigured 를 detail 에 담지 않는다 — 기한 미설정이 보이지 않는다');
  }
  if (/disposalDueDate\s*:/.test(s)) {
    problems.push('incidentClosure 가 폐기 기한 **날짜**를 detail 에 담는다 — 무인증 응답에 보존 시각을 되돌려 말해 준다(§2-3)');
  }
  return problems;
}

/**
 * `app/api/health/route.ts` 원문 — **새 체크가 생기지 않았는지**.
 * 사본 처분은 사람이 하는 일이고 코드가 확인할 수 없다 — 체크를 만들면 폐기하지 않은 사건이
 * 영구 degraded 가 되고(§2-2 가 「상시로 읽는 쪽은 degraded 를 보지 못한다」고 적어 둔 신호가 하나 더 는다),
 * §6-3 인용 정본도 함께 갈라진다.
 */
export function auditNoNewHealthCheck(src: unknown): string[] {
  const s = String(src ?? '');
  const problems: string[] = [];
  if (/from\s+['"]@\/lib\/evidenceDisposal['"]/.test(s)) {
    problems.push('헬스 라우트가 evidenceDisposal 을 직접 import 한다 — 판정은 기존 체크 안에서 말한다');
  }
  if (/checks\.evidenceDisposal\s*=/.test(s)) {
    problems.push('checks.evidenceDisposal 이 새로 생겼다 — degraded 가 늘고 인용 정본이 갈라진다');
  }
  return problems;
}

/**
 * `RUNBOOK.md` 원문 — §3-17 과 그것을 가리키는 단계가 함께 남아 있는지.
 * 특히 **8단계 4번이 「지우기 전에 기한을 옮겨 적는다」를 지시하는지**를 본다 — 그 문장이 빠지면
 * 기준점이 사라진 뒤에 기한을 되찾을 수 없고, 사본은 보관소에 남는다.
 */
export function auditRunbookDisposal(md: unknown): string[] {
  const s = String(md ?? '');
  const problems: string[] = [];

  if (!/^###\s*3-17\./m.test(s)) problems.push('§3-17(사본의 처분) 절이 없다');
  if (!/assessDisposal\(|disposalText\(/.test(s)) problems.push('§3-17 에 처분 판정 산출 명령이 없다');
  if (!s.includes(RETENTION_ENV)) problems.push(`${RETENTION_ENV} 가 문서에 없다 — 기한을 넣을 자리를 담당자가 모른다`);
  for (const v of DISPOSAL_VERDICTS) {
    if (!new RegExp(`\`${v}\``).test(s)) problems.push(`§3-17 판정 표에 ${v} 행이 없다`);
  }
  for (const spot of DISPOSAL_BLIND_SPOTS) {
    if (!s.includes(spot.key)) problems.push(`§3-17 에 사각지대 ${spot.key} 가 없다`);
  }
  if (!/disposalVerdict/.test(s)) {
    problems.push('문서가 disposalVerdict 를 가리키지 않는다 — 담당자가 판정을 읽을 자리가 없다');
  }

  const sec3 = s.match(/^##\s*3\.\s[\s\S]*?(?=^###\s*3-1\.)/m)?.[0] ?? '';
  if (!sec3) {
    problems.push('§3 본문을 찾지 못했다 — 문서 구조가 바뀌었으면 이 가드를 함께 볼 것');
    return problems;
  }
  const i8 = sec3.search(/^8\.\s/m);
  const step8 = i8 < 0 ? '' : sec3.slice(i8);
  if (!step8) problems.push('§3 8단계를 찾지 못했다');
  else if (!/3-17/.test(step8)) {
    problems.push(
      '8단계가 §3-17 로 유도하지 않는다 — 표지를 지우기 전에 폐기 기한을 영구 기록으로 옮기라는 ' +
        '지시가 사라지면, 지운 뒤에 기한을 되찾을 수 없고 사본은 보관소에 남는다',
    );
  }

  // §3-5 는 사본을 **만들라고** 지시하는 자리다 — 거기서 처분 절로 유도하지 않으면
  // 「보존 기간·폐기는 사람이 정한다」 한 줄로 되돌아가고, 그 줄은 읽는 판정이 없는 메모다.
  const sec35 = s.match(/^###\s*3-5\.[\s\S]*?(?=^###\s*3-6\.)/m)?.[0] ?? '';
  if (!sec35) problems.push('§3-5 절을 찾지 못했다');
  else if (!/3-17/.test(sec35)) problems.push('§3-5 가 §3-17 로 유도하지 않는다 — 사본을 만드는 자리에 처분 지시가 없다');

  return problems;
}
