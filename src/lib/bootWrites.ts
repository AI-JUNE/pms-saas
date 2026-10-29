/**
 * bootWrites.ts — 「읽기 전용」이라 적어 둔 **4단계 검증이 검증 대상을 바꾼다**(RUNBOOK §3-19·§3 4단계). 2026-10-29
 *
 * ── 왜 필요한가 ───────────────────────────────────────────────────────────────
 * §3 4단계는 「복구 브랜치 연결문자열을 **스테이징 환경의 `DATABASE_URL` 에 넣고 기동한 뒤**,
 * 슈퍼관리자로 `GET /api/admin/recovery-verify` 를 호출한다(**읽기 전용 — DDL·쓰기 없음**)」다.
 * 그 괄호는 **엔드포인트**에 대해서만 참이다. 그 엔드포인트에 닿으려면 먼저 **기동**해야 하고,
 * 기동하는 쪽은 2단계 쓰기 차단이 걸린 운영 배포가 **아니라** 아무 제한도 없는 스테이징이다.
 *
 *  (1) **기동 자체가 쓴다.** `src/instrumentation.ts` 는 요청을 받기 전에 `ensureSchema()`(DDL)와
 *      `ensureRecoveryAdmin()`(`users`·`organizations`·`memberships` + 기본 권한 insert)을 돌린다.
 *      뒤의 것은 **소스에 하드코딩된 비밀번호**를 가진 계정을 만든다 — 그리고 그 브랜치가
 *      5단계에서 **운영이 된다.**
 *
 *  (2) **대조 대상이 대조 행위로 커진다.** 4단계가 세는 핵심 테이블 13개 중 `users`·
 *      `organizations`·`memberships`·`audit_log` 가 기동·로그인·열람 기록으로 올라간다.
 *      화면을 한 번 열어 「둘러보기」가 돌면 `seedDemo` 가 `projects`·`issues`·`tasks` 까지
 *      채운다. 응답의 행 수는 **총합**이라 그 증가분이 어디에서 왔는지 구분되지 않고,
 *      기준치에 **못 미치던**(`short`) 테이블이 그대로 `ok` 로 올라갈 수 있다.
 *
 *  (3) **지울 수단이 없다.** 그 쓰기는 전부 「없으면 만든다」꼴의 멱등 가드라서, 지워도
 *      **다음 기동이 다시 만든다.** 전환 뒤에는 운영 DB 안의 행이다.
 *
 *  (4) **§3-8 의 표에 없다.** §3-8 은 복구가 **되돌리는** 접근 수단을 정본화했는데, 이 계정들은
 *      되돌아온 것이 아니라 **검증이 새로 만든 것**이라 그 표에 들어 있지 않다. 6-1단계
 *      재적용 목록으로도 추릴 수 없다(§3-5 보존본의 보안 이벤트에 없는 계정이다).
 *
 *  (5) **리허설에서는 드러나지 않는다.** 리허설 브랜치는 체크리스트 마지막 항목이 정리하므로
 *      같은 일이 일어나도 흔적이 남지 않는다 — 「리허설에서 통과했다」가 이 구멍에 대해
 *      아무 말도 하지 않는다.
 *
 * 그래서 이 모듈은 — **쓰기를 코드가 되돌릴 수는 없으므로** —
 *   · 기동·검증이 만들어 내는 쓰기를 **정본**으로 두고(어느 테이블에 닿는가 · 4단계 대조에
 *     섞이는가 · 막을 수단이 있는가 · 거르면 조용히 생기는 일),
 *   · 그중 **막을 수 있는 것만** 스위치로 막고(`RECOVERY_BOOT_WRITES_OFF` — 기본 OFF 라
 *     평상시 동작은 한 글자도 바뀌지 않는다. 둘러보기는 이미 있는 `PMS_GUEST_DISABLED` 를 쓴다),
 *   · **막아도 남는 것**을 판정과 함께 내보내고(전건 차단을 「유실 없음」으로 읽지 않게 한다),
 *   · 4단계 응답(`/api/admin/recovery-verify`)의 `bootWrites` 로 **행 수를 보기 전에** 말한다.
 *
 * 원칙
 * - 순수 모듈: DB·next·fs·`process.env` 미접근. **신규 조회·쓰기·DDL 0 · 신규 런타임 체크 0 ·
 *   신규 사건 표지 0.** 판정은 env 스냅샷 해석뿐이다.
 * - **`switchReady` 를 내리지 않는다.** 스위치가 꽂혀 있지 않다는 이유로 전환을 막으면 복구일에
 *   **거짓 차단**이 된다(§3-18·§3-17 과 같은 규율) — 달라지는 것은 **다음에 할 일**이다.
 * - **스위치는 `'true'` 만 ON.** `1`·`yes`·`TRUE` 는 OFF 로 읽히는데 넣은 사람은 ON 으로 믿으므로
 *   그 상태를 `invalid_switch` 로 **따로** 말한다(통과가 아니다).
 * - **구분할 수 없는 것을 구분하지 않는다**: 이 판정은 **읽는 배포 자신의 env** 만 본다 —
 *   4단계를 수행하는 스테이징이 실제로 그 값을 받았는지는 **그 배포의 응답**으로만 알 수 있다.
 */
import { isSwitchOn, presenceOf } from './envPresence.ts';
import { CORE_TABLES } from './recoveryVerify.ts';

/** 응답·문서에서 근거 절을 찾을 수 있게 한다 */
export const BOOT_RUNBOOK_REF = 'RUNBOOK §3-19·§3 4단계';

/**
 * 기동 시 **복구용 관리자 생성**을 건너뛰는 스위치. `'true'` 일 때만 ON 이고
 * **미설정(=기존 동작 유지)이 기본값**이다 — 운영 평상시에는 한 글자도 바뀌지 않는다.
 *
 * ※ 이 키는 **사건 표지가 아니다** — 운영 배포가 아니라 4단계를 수행하는 **스테이징**에 넣는
 *   값이라, §3 8단계 4번의 삭제 목록(여섯 키)에 들어가면 지울 대상이 늘고 지우는 자리도 틀린다
 *   (`auditNotAMarker` 가 그것을 CI 로 잡는다). 평상시 미설정이 정상이므로 임시 키이기는 하다.
 */
export const BOOT_SUPPRESS_ENV = 'RECOVERY_BOOT_WRITES_OFF';

/**
 * 둘러보기(손님) 입장을 막는 **이미 있는** 스위치. 새 키를 만들지 않는다 —
 * 늘어나는 키마다 복구에서 유실될 것이 하나씩 는다(§4-12).
 */
export const GUEST_DISABLE_ENV = 'PMS_GUEST_DISABLED';

/* ──────────────────── 기동·검증이 만들어 내는 쓰기(정본) ──────────────────── */

export interface BootWrite {
  key: string;
  /** 언제 일어나는가 */
  trigger: string;
  /** 어디서 — 파일·함수(테스트가 그 원문이 아직 쓰기를 하는지 대조한다) */
  origin: string;
  /** 무엇을 쓰는가 */
  writes: string;
  kind: 'ddl' | 'insert';
  /** 닿는 테이블 */
  tables: readonly string[];
  /** 막을 수단(env 키). **없으면 `null`** — 그 사실을 숨기지 않는다 */
  suppressedBy: string | null;
  /** 전환(5단계)으로 **운영이 되는 DB 에 남는가** */
  persists: boolean;
  /** 거르면 조용히 생기는 일 */
  consequence: string;
}

/**
 * 4단계를 수행하면 복구 브랜치에 일어나는 쓰기. 「읽기 전용」은 **엔드포인트**에 대해서만 참이다.
 *
 * ※ `schema_ddl` 은 **막지 않는다** — 6단계가 어차피 지시하는 일이고, 막으면 스키마가 덜 맞는
 *   DB 에서 조회 자체가 깨져 4단계가 `unverified` 로만 끝난다(§3-1). 막을 수 없는 것과
 *   막지 않기로 한 것을 **같은 줄로** 적어 두는 쪽이 정직하다.
 */
export const BOOT_WRITES: readonly BootWrite[] = [
  {
    key: 'schema_ddl',
    trigger: '배포 기동(첫 요청 이전)',
    origin: 'src/instrumentation.ts → lib/migrate.ensureSchema',
    writes: '`MIGRATION_DDL` 의 멱등 DDL 전문(CREATE TABLE IF NOT EXISTS · ALTER TABLE IF EXISTS)',
    kind: 'ddl',
    tables: [],
    // 6단계가 지시하는 일을 4단계가 미리 하는 것이라 결과는 같다 — 막으면 조회가 깨진다.
    suppressedBy: null,
    persists: true,
    consequence:
      '복구 브랜치의 스키마가 **검증 전에** 현재 코드 기준으로 바뀐다 — 「전환 직전에 무엇이 들어 있었나」를 되돌려 볼 수단이 없다(행 수는 바뀌지 않는다)',
  },
  {
    key: 'recovery_admin',
    trigger: '배포 기동(첫 요청 이전)',
    origin: 'src/instrumentation.ts → lib/bootstrap.ensureRecoveryAdmin',
    writes: '복구용 관리자 계정 1건 + 데모 조직 + 소속 — **비밀번호가 소스에 하드코딩돼 있다**',
    kind: 'insert',
    tables: ['users', 'organizations', 'memberships'],
    suppressedBy: BOOT_SUPPRESS_ENV,
    persists: true,
    consequence:
      '**알려진 비밀번호의 관리자 계정**이 전환으로 운영이 되는 DB 에 들어간다. §3-8 은 복구가 **되돌리는** 접근 수단을 정본화했는데 이것은 되돌아온 것이 아니라 **새로 생긴 것**이라 그 표에 없고, 6-1단계 재적용 목록(§3-5 보존본)으로도 추릴 수 없다',
  },
  {
    key: 'default_roles',
    trigger: '위 계정 생성에 뒤따라(최초 1회)',
    origin: 'lib/seedRoles.grantDefaultRoles · ensurePermissions',
    writes: '권한 정의와 역할-권한 부여 행(onConflictDoNothing)',
    kind: 'insert',
    tables: ['permissions', 'role_permissions'],
    suppressedBy: BOOT_SUPPRESS_ENV,
    persists: true,
    consequence:
      '핵심 테이블 13개에는 없어 **4단계 대조에 아무 흔적도 남기지 않는다** — 권한 표가 복구 시점과 달라져도 어떤 판정도 그것을 말하지 않는다',
  },
  {
    key: 'guest_demo_seed',
    trigger: '그 배포의 **화면을 한 번 열면**(둘러보기 입장)',
    origin: 'src/app/api/auth/guest/route.ts → lib/demoSeed.seedDemo',
    writes: '데모 조직·손님 계정·소속과, 비어 있는 표를 채우는 **데모 데이터 한 벌**',
    kind: 'insert',
    tables: [
      'organizations', 'users', 'memberships',
      'projects', 'phases', 'members', 'requirements', 'tasks', 'issues', 'risks', 'documents',
    ],
    suppressedBy: GUEST_DISABLE_ENV,
    persists: true,
    consequence:
      '4단계가 세는 핵심 테이블 대부분에 **행이 더해진다** — 손상으로 비어 버린 표일수록 더 많이 채워지므로(빈 표만 채운다), 기준치에 **못 미치던 테이블이 `ok` 로 올라간다.** 그 증가분은 응답 어디에도 따로 적혀 있지 않다',
  },
  {
    key: 'verify_access_record',
    trigger: '4단계 수행자의 **로그인과 검증 호출** 자체',
    origin: 'lib/auth.createSession · lib/audit.auditSecurity(adminAccessEvent)',
    writes: '세션 1건과 보안·열람 감사 행',
    kind: 'insert',
    tables: ['sessions', 'audit_log'],
    // 로그인하지 않으면 엔드포인트에 닿지 못한다 — 막을 수 있는 성질의 쓰기가 아니다.
    suppressedBy: null,
    persists: true,
    consequence:
      '`audit_log` 는 4단계가 세는 핵심 테이블이고 **앱에 삭제 경로가 없어** §3-11 이 감소를 `unexplained` 로 다루는 표다 — 검증이 그 표를 **늘리므로**, 감사 이력이 줄어든 상태가 그만큼 가려진다',
  },
];

/** 4단계가 행 수를 세는 핵심 테이블과 겹치는 것만 — 대조 수치가 올라가는 쪽 */
export function coreTablesOf(w: BootWrite): string[] {
  const core = new Set(CORE_TABLES);
  return w.tables.filter((t) => core.has(t));
}

/* ──────────────────── 드러나지 않는 이유(사각지대) ──────────────────── */

export interface BootBlindSpot {
  key: string;
  /** 무엇이 보이지 않는가 */
  what: string;
  /** 왜 어떤 판정도 그것을 말하지 못하는가 */
  why: string;
}

export const BOOT_BLIND_SPOTS: readonly BootBlindSpot[] = [
  {
    key: 'counts_are_gross',
    what: '행 수 가운데 **검증이 만든 몫**',
    why: '4단계 응답의 수치는 `count(*)` 총합이다 — 기동·로그인·열람·둘러보기가 더한 행과 복구된 행이 같은 숫자 안에 섞여 있고, 나누어 줄 기준이 없다(기준 스냅샷은 §2 월 점검의 **운영** 수치다)',
  },
  {
    key: 'freeze_is_elsewhere',
    what: '2단계 **쓰기 차단이 이 배포에는 걸려 있지 않다**는 사실',
    why: '차단은 운영 배포의 env 이고(§3-3) 4단계는 **스테이징**에서 한다 — 같은 DB 를 보면서 한쪽만 잠겨 있는 상태이고, `/api/health` 의 `checks.writeFreeze` 는 **그 배포 자신의** 설정만 말한다',
  },
  {
    key: 'idempotent_means_permanent',
    what: '지운 뒤에도 **다시 생긴다**는 것',
    why: '전부 「없으면 만든다」꼴의 멱등 가드다 — 지우면 다음 기동·다음 입장이 같은 행을 다시 만든다. 되돌리려면 **코드 쪽 스위치**가 필요하고, 그래서 이 절이 스위치를 만들었다',
  },
  {
    key: 'rehearsal_hides_it',
    what: '리허설에서 같은 일이 일어났다는 **흔적**',
    why: '체크리스트 마지막 항목이 리허설 브랜치를 정리하므로 만들어진 행도 함께 사라진다 — 「리허설에서 통과했다」가 이 구멍에 대해 아무 말도 하지 않는다(§3-18 `rehearsal_conflated` 와 반대 방향이다)',
  },
  {
    key: 'not_a_restored_row',
    what: '새로 생긴 계정이 **§3-8 표에 없다**는 것',
    why: '§3-8 은 복구가 **되돌리는** 접근 수단(되살아난 세션·옛 비밀번호·풀린 잠금)의 정본이다 — 검증이 **새로 만든** 계정은 되돌아온 것이 아니라 그 표의 대상이 아니고, §3-5 보존본의 보안 이벤트에도 없다',
  },
  {
    key: 'scope_unknown',
    what: '**4단계를 수행하는 배포**가 이 설정을 받았는지',
    why: '이 판정은 읽는 배포 자신의 env 만 본다(§3-13 과 같은 한계) — 스테이징에 넣었는지는 **그 배포의 응답**으로만 알 수 있고, 환경변수는 재배포 전까지 반영되지 않는다(§3 5단계)',
  },
];

/* ─────────────────────────── 판정 ─────────────────────────── */

export const BOOT_VERDICTS = [
  /** 스위치 값이 들어 있는데 `'true'` 가 아니다 — **OFF 로 읽히는데 넣은 사람은 ON 으로 믿는다** */
  'invalid_switch',
  /** 막을 수 있는 쓰기를 **전부** 막았다 — 그래도 막지 못하는 것은 남는다 */
  'suppressed',
  /** 일부만 막혔다 */
  'partially_suppressed',
  /** 아무것도 막히지 않았다(**기본값**) */
  'unsuppressed',
] as const;
export type BootVerdict = (typeof BOOT_VERDICTS)[number];

export const ACTION_BOOT_INVALID =
  `\`${BOOT_SUPPRESS_ENV}\`·\`${GUEST_DISABLE_ENV}\` 중 \`'true'\` 가 아닌 값이 들어 있다 — ` +
  '`1`·`yes`·`TRUE`·공백은 **OFF 로 읽힌다**(넣은 사람은 켠 줄 안다). 소문자 `true` 로 다시 적고 ' +
  '**재배포한 뒤** 다시 호출한다 — 환경변수는 재배포 전까지 반영되지 않는다(§3 5단계)';

export const ACTION_BOOT_UNSUPPRESSED =
  `이 배포는 기동·입장 쓰기가 **전부 열려 있다**(기본값) — 복구 브랜치를 물린 채라면 ` +
  `\`${BOOT_SUPPRESS_ENV}=true\`·\`${GUEST_DISABLE_ENV}=true\` 를 **이 배포 스코프에** 넣고 재배포한 뒤 ` +
  '다시 호출한다. 이미 행이 만들어졌다면 지우지 말고(다음 기동이 다시 만든다) **만들어진 사실을** ' +
  '6절 표 비고에 적고 아래 행 수를 그만큼 낮춰 읽는다';

export const ACTION_BOOT_PARTIAL =
  '막을 수 있는 쓰기 가운데 **일부만** 막혔다 — 열려 있는 쪽이 닿는 핵심 테이블은 아래 ' +
  '`openCoreTables` 에 적혀 있다. 나머지 스위치를 넣고 재배포한 뒤 다시 호출한다';

export const ACTION_BOOT_SUPPRESSED =
  '막을 수 있는 것은 전부 막혔다 — **그래도 남는 것이 있다**(스키마 DDL · 로그인 세션 · 열람 감사 행). ' +
  '그 쓰기는 이 검증을 하려면 반드시 일어나므로, 아래 `unstoppableCoreTables` 의 증가분을 감안해 ' +
  '행 수를 읽고 **전건 차단을 「대조 대상이 깨끗하다」로 읽지 않는다**';

const ACTION: Record<BootVerdict, string> = {
  invalid_switch: ACTION_BOOT_INVALID,
  suppressed: ACTION_BOOT_SUPPRESSED,
  partially_suppressed: ACTION_BOOT_PARTIAL,
  unsuppressed: ACTION_BOOT_UNSUPPRESSED,
};

const NOTE: Record<BootVerdict, string> = {
  invalid_switch: '스위치가 **느슨하게 적혀** OFF 로 읽힌다 — 넣어 두고 켠 줄 아는 상태가 가장 조용하다',
  suppressed: '막을 수 있는 쓰기는 멈췄다 — 막지 못하는 쓰기는 그대로 일어난다',
  partially_suppressed: '일부만 막혔다 — 열려 있는 쪽이 핵심 테이블에 닿는지 함께 본다',
  unsuppressed: '기본값이다 — 기동·입장 쓰기가 복구 브랜치에 그대로 들어간다',
};

export const CAVEAT_BOOT_NOT_A_ROLLBACK =
  '**막는 것은 되돌리는 것이 아니다** — 이미 만들어진 행은 그대로 남고, 지워도 다음 기동이 다시 만든다. ' +
  '코드는 그 행을 세지도 지우지도 않는다(쓰기 0)';

export const CAVEAT_BOOT_SELF_SCOPE =
  '**읽는 배포 자신의 env 만 본다** — 4단계를 수행하는 스테이징이 이 설정을 받았는지는 그 배포의 응답으로만 알 수 있다(§3-13)';

export const CAVEAT_BOOT_RESIDUAL =
  '**전건 차단이 「대조 대상이 깨끗하다」를 뜻하지 않는다** — 스키마 DDL·로그인 세션·열람 감사 행은 이 검증의 전제라 막을 수 없다';

export const BOOT_LIMITS: readonly string[] = [
  CAVEAT_BOOT_NOT_A_ROLLBACK,
  CAVEAT_BOOT_SELF_SCOPE,
  CAVEAT_BOOT_RESIDUAL,
  '만들어진 행의 **수를 세지 않는다** — 세려면 복구 브랜치에 조회를 더해야 하고, 그 수치도 복구된 행과 나눌 기준이 없다',
  '행 수 응답에서 그 몫을 **빼지 않는다** — 빼면 지어낸 수치가 기준치 대조에 들어간다(§3-2 의 「임의 기준치 금지」와 같은 규율)',
  '기동 쓰기가 일어났는지 **확인하지 않는다** — 스위치가 꽂혀 있었는지만 말한다(기동은 이 호출보다 앞선다)',
  `${GUEST_DISABLE_ENV} 는 둘러보기만 막는다 — 가입(\`/api/auth/register\`)으로 들어오는 쓰기는 그대로다`,
];

export interface BootAssessment {
  verdict: BootVerdict;
  /** 막히지 않은 쓰기의 키 */
  openWrites: readonly string[];
  /** 막을 수 있는데 막히지 않은 쓰기의 키 */
  suppressibleOpen: readonly string[];
  /** 애초에 막을 수 없는 쓰기의 키 */
  unstoppable: readonly string[];
  /** 막히지 않은 쓰기가 닿는 **핵심 테이블**(4단계 대조에 섞이는 쪽) */
  openCoreTables: readonly string[];
  /** 전부 막아도 남는 쓰기가 닿는 핵심 테이블 */
  unstoppableCoreTables: readonly string[];
  /** 스위치 상태(값은 담지 않는다) */
  switches: readonly { key: string; on: boolean; loose: boolean }[];
  /** 지금 할 일이 있는가 — 읽는 쪽이 조건식을 다시 짜면 판정이 두 곳에서 갈린다 */
  actionable: boolean;
  action: string;
  note: string;
  caveats: readonly string[];
}

function uniqSorted(xs: readonly string[]): string[] {
  return [...new Set(xs)].sort();
}

/**
 * 기동·검증 쓰기의 판정.
 *
 * 판정 순서: **느슨하게 적힌 스위치** → 전건 차단 → 일부 차단 → 기본값.
 *
 * `invalid_switch` 를 맨 앞에 두는 이유: `RECOVERY_BOOT_WRITES_OFF=1` 은 **OFF 로 읽히므로**
 * 그 뒤의 판정은 `unsuppressed` 와 글자 하나 다르지 않은데, 넣은 사람은 켠 줄 안다 —
 * 「넣지 않았다」와 「넣었는데 안 걸렸다」는 할 일이 다르다(넣는다 / 고쳐 적는다).
 */
export function assessBootWrites(input?: {
  env?: Record<string, string | undefined>;
  writes?: readonly BootWrite[];
}): BootAssessment {
  const env = input?.env ?? {};
  const writes = input?.writes ?? BOOT_WRITES;

  const switchKeys = uniqSorted(writes.map((w) => w.suppressedBy).filter((k): k is string => Boolean(k)));
  const switches = switchKeys.map((key) => ({
    key,
    on: isSwitchOn(env, key),
    // 값이 들어 있는데 ON 으로 읽히지 않는다 = 느슨하게 적혔다.
    loose: presenceOf(env, key) !== 'absent' && !isSwitchOn(env, key),
  }));
  const onKeys = new Set(switches.filter((s) => s.on).map((s) => s.key));

  const open = writes.filter((w) => !w.suppressedBy || !onKeys.has(w.suppressedBy));
  const suppressibleOpen = open.filter((w) => w.suppressedBy);
  const unstoppable = writes.filter((w) => !w.suppressedBy);

  let verdict: BootVerdict;
  if (switches.some((s) => s.loose)) verdict = 'invalid_switch';
  else if (suppressibleOpen.length === 0) verdict = 'suppressed';
  else if (suppressibleOpen.length < writes.filter((w) => w.suppressedBy).length) verdict = 'partially_suppressed';
  else verdict = 'unsuppressed';

  return {
    verdict,
    openWrites: open.map((w) => w.key),
    suppressibleOpen: suppressibleOpen.map((w) => w.key),
    unstoppable: unstoppable.map((w) => w.key),
    openCoreTables: uniqSorted(open.flatMap(coreTablesOf)),
    unstoppableCoreTables: uniqSorted(unstoppable.flatMap(coreTablesOf)),
    switches,
    // `suppressed` 에도 할 일이 남는다 — 막지 못하는 쓰기를 감안해 읽으라는 것이 할 일이다.
    actionable: true,
    action: ACTION[verdict],
    note: NOTE[verdict],
    caveats: BOOT_LIMITS,
  };
}

/** env 스냅샷으로 판정한다(라우트·명령에서 같은 경로를 쓴다) */
export function bootWritesFromEnv(env: Record<string, string | undefined> = {}): BootAssessment {
  return assessBootWrites({ env });
}

/* ─────────────────────────── 출력 ─────────────────────────── */

/** 로그 한 줄. 판정·개수만 — **값은 담지 않는다** */
export function bootWritesLine(a: BootAssessment): string {
  return [
    'recovery_boot_writes',
    `boot=${a.verdict}`,
    `open=${a.openWrites.length}/${BOOT_WRITES.length}`,
    `core=${a.openCoreTables.length}`,
  ].join(' ');
}

/** 사람이 읽는 요약(§3-19 의 1줄 명령이 출력하는 것) */
export function bootWritesText(a: BootAssessment): string {
  const lines = [
    `[${a.verdict}] 막히지 않은 쓰기 ${a.openWrites.length}/${BOOT_WRITES.length}건 · ` +
      `대조에 섞이는 핵심 테이블 ${a.openCoreTables.length}개`,
    `· 스위치: ${a.switches.map((s) => `${s.key}=${s.on ? 'on' : s.loose ? '느슨함(OFF로 읽힘)' : 'off'}`).join(' · ')}`,
    `· 막을 수 없는 쓰기 ${a.unstoppable.length}건 → 핵심 테이블 ${a.unstoppableCoreTables.join(', ') || '(없음)'}`,
    `· 드러나지 않는 것 ${BOOT_BLIND_SPOTS.length}건`,
  ];
  for (const w of BOOT_WRITES) {
    const state = a.openWrites.includes(w.key) ? '열림' : '막힘';
    lines.push(`  - [${state}] ${w.key}(${w.origin}) → ${w.consequence}`);
  }
  lines.push(`→ ${a.action}`);
  for (const c of a.caveats) lines.push(`※ ${c}`);
  return lines.join('\n');
}

/**
 * 4단계 응답용 필터. 슈퍼관리자 전용 응답이라 테이블 이름은 담되
 * **env 값·행 수는 담지 않는다**(값은 애초에 판정에 들어 있지 않다).
 */
export function publicBootWrites(a: BootAssessment): {
  verdict: BootVerdict;
  openWrites: readonly string[];
  openCoreTables: readonly string[];
  unstoppableCoreTables: readonly string[];
  action: string;
  caveats: readonly string[];
  runbook: string;
} {
  return {
    verdict: a.verdict,
    openWrites: a.openWrites,
    openCoreTables: a.openCoreTables,
    unstoppableCoreTables: a.unstoppableCoreTables,
    action: a.action,
    caveats: a.caveats,
    runbook: BOOT_RUNBOOK_REF,
  };
}

/** 배선 상태 요약(문서·보고용) */
export function bootWritesStatus(env: Record<string, string | undefined> = {}): {
  verdict: BootVerdict;
  writes: number;
  openWrites: number;
  blindSpots: number;
  limits: number;
  action: string;
} {
  const a = bootWritesFromEnv(env);
  return {
    verdict: a.verdict,
    writes: BOOT_WRITES.length,
    openWrites: a.openWrites.length,
    blindSpots: BOOT_BLIND_SPOTS.length,
    limits: BOOT_LIMITS.length,
    action: a.action,
  };
}

/* ─────────────────────────── 정적 점검 ─────────────────────────── */

/** 정본 자신의 모양 — 막을 수단·결과가 사유 없이 비어 있지 않은지 */
export function auditBootCanon(
  writes: readonly BootWrite[] = BOOT_WRITES,
  spots: readonly BootBlindSpot[] = BOOT_BLIND_SPOTS,
): string[] {
  const problems: string[] = [];
  if (writes.length === 0) problems.push('기동 쓰기 정본이 비었다 — 「읽기 전용」이 참이 되었다면 이 절을 지워야 한다');
  const seen = new Set<string>();
  for (const w of writes) {
    if (seen.has(w.key)) problems.push(`중복 키: ${w.key}`);
    seen.add(w.key);
    if (!w.origin.trim()) problems.push(`${w.key} 에 어디서 일어나는지 적혀 있지 않다`);
    if (!w.consequence.trim()) problems.push(`${w.key} 에 거르면 생기는 일이 적혀 있지 않다`);
    if (w.kind === 'insert' && w.tables.length === 0) problems.push(`${w.key} 가 insert 인데 대상 테이블이 비었다`);
    if (!w.persists) {
      problems.push(`${w.key} 가 운영에 남지 않는다고 선언돼 있다 — 남지 않는 쓰기라면 이 절의 대상이 아니다`);
    }
  }
  if (!writes.some((w) => w.suppressedBy === null)) {
    problems.push('막을 수 없는 쓰기가 하나도 없다고 선언돼 있다 — 전건 차단이 「대조 대상이 깨끗하다」로 읽히게 된다');
  }
  if (!writes.some((w) => w.suppressedBy)) {
    problems.push('막을 수 있는 쓰기가 하나도 없다 — 스위치를 만든 이유가 사라졌다');
  }
  if (spots.length === 0) problems.push('사각지대 정본이 비었다');
  for (const s of spots) {
    if (!s.what.trim() || !s.why.trim()) problems.push(`사각지대 ${s.key} 에 설명이 없다`);
  }
  return problems;
}

/**
 * 실제 `src/instrumentation.ts` 원문 — 스위치가 **분기로** 걸려 있는지.
 *  · 스위치를 읽지 않으면 이 절의 해법이 배선되지 않은 것이고,
 *  · 느슨하게 읽으면(`!== 'false'`·`Boolean()`) 오설정이 ON 으로 읽혀 **복구용 계정이 사라지고**,
 *  · `ensureSchema` 까지 함께 막으면 스키마가 덜 맞는 DB 에서 4단계가 `unverified` 로만 끝난다.
 */
export function auditInstrumentationSource(src: unknown): string[] {
  const s = String(src ?? '');
  const problems: string[] = [];
  if (!s.includes(BOOT_SUPPRESS_ENV)) {
    problems.push(`instrumentation 이 ${BOOT_SUPPRESS_ENV} 를 읽지 않는다 — 막을 수단이 배선되지 않았다`);
  } else if (!new RegExp(`env\\.${BOOT_SUPPRESS_ENV}\\s*===\\s*'true'`).test(s)) {
    problems.push(`${BOOT_SUPPRESS_ENV} 를 \`=== 'true'\` 로 읽지 않는다 — 느슨한 판독은 오설정을 ON 으로 읽는다`);
  }
  if (!/ensureRecoveryAdmin/.test(s)) {
    problems.push('instrumentation 이 ensureRecoveryAdmin 을 부르지 않는다 — 정본의 recovery_admin 항목이 낡았다');
  }
  if (!/ensureSchema/.test(s)) {
    problems.push('instrumentation 이 ensureSchema 를 부르지 않는다 — 정본의 schema_ddl 항목이 낡았다');
  }
  // 스위치 분기가 `ensureSchema` 쪽을 덮으면 조회가 깨진다 — 스위치 언급이 ensureSchema 보다 **뒤**에 와야 한다.
  const iSwitch = s.indexOf(BOOT_SUPPRESS_ENV);
  const iSchema = s.indexOf('ensureSchema');
  const iAdmin = s.indexOf('ensureRecoveryAdmin');
  if (iSwitch >= 0 && iSchema >= 0 && iSwitch < iSchema) {
    problems.push('스위치가 ensureSchema 앞에 걸려 있다 — 스키마 정합까지 막으면 4단계 조회가 unverified 로만 끝난다(§3-1)');
  }
  if (iSwitch >= 0 && iAdmin >= 0 && iSwitch > iAdmin) {
    problems.push('스위치가 ensureRecoveryAdmin 뒤에 있다 — 판정만 하고 분기하지 않는 꼴이다');
  }
  return problems;
}

/**
 * 실제 `src/lib/bootstrap.ts`·`src/app/api/auth/guest/route.ts` 원문 —
 * 정본이 「쓴다」고 적어 둔 것이 **아직 쓰기인지**. 쓰기가 사라졌다면 이 절이 낡은 것이고,
 * 막는 스위치가 빠졌다면 해법이 풀린 것이다.
 */
export function auditWriteSources(bootstrapSrc: unknown, guestSrc: unknown): string[] {
  const b = String(bootstrapSrc ?? '');
  const g = String(guestSrc ?? '');
  const problems: string[] = [];
  if (!/db\.insert\(users\)/.test(b) || !/db\.insert\(memberships\)/.test(b)) {
    problems.push('bootstrap 이 더 이상 users·memberships 에 쓰지 않는다 — 정본의 recovery_admin 항목을 함께 고칠 것');
  }
  if (!/grantDefaultRoles/.test(b)) {
    problems.push('bootstrap 이 grantDefaultRoles 를 부르지 않는다 — 정본의 default_roles 항목이 낡았다');
  }
  if (!new RegExp(`env\\.${GUEST_DISABLE_ENV}\\s*===\\s*'true'`).test(g)) {
    problems.push(`둘러보기 라우트가 ${GUEST_DISABLE_ENV} 를 \`=== 'true'\` 로 읽지 않는다 — 4단계에서 막을 수단이 사라진다`);
  }
  if (!/seedDemo\(/.test(g)) {
    problems.push('둘러보기 라우트가 seedDemo 를 부르지 않는다 — 정본의 guest_demo_seed 항목이 낡았다');
  }
  return problems;
}

/**
 * `app/api/admin/recovery-verify/route.ts` 원문 — 판정을 **응답에 실어 보내는지**까지 본다.
 * 판정만 하고 버리면 4단계 담당자가 행 수를 **그대로** 읽는다(응답은 200 이다).
 */
export function auditVerifyWiring(src: unknown): string[] {
  const s = String(src ?? '');
  const problems: string[] = [];
  if (!/from\s+['"]@\/lib\/bootWrites['"]/.test(s)) problems.push('recovery-verify 가 bootWrites 를 import 하지 않는다');
  if (!/bootWritesFromEnv\(|assessBootWrites\(/.test(s)) problems.push('recovery-verify 가 기동 쓰기 판정을 호출하지 않는다');
  if (!/bootWrites\s*:/.test(s)) {
    problems.push('recovery-verify 응답에 bootWrites 가 없다 — 판정만 하고 버린다');
  }
  if (!/publicBootWrites\(/.test(s)) {
    problems.push('recovery-verify 가 공개 필터를 거치지 않는다 — env 값이 응답에 섞일 수 있다');
  }
  return problems;
}

/**
 * `app/api/health/route.ts` 원문 — **새 체크가 생기지 않았는지**.
 * 기동 쓰기는 평상시 **정상 동작**이다 — 체크를 만들면 전 운영 배포가 상시 degraded 가 되고
 * (§2-2) §6-3 인용 정본도 함께 갈라진다.
 */
export function auditNoNewHealthCheck(src: unknown): string[] {
  const s = String(src ?? '');
  const problems: string[] = [];
  if (/from\s+['"]@\/lib\/bootWrites['"]/.test(s)) {
    problems.push('헬스 라우트가 bootWrites 를 직접 import 한다 — 기동 쓰기는 평상시 정상 동작이다');
  }
  if (/checks\.bootWrites\s*=/.test(s)) {
    problems.push('checks.bootWrites 가 새로 생겼다 — 전 운영 배포가 상시 degraded 가 된다');
  }
  return problems;
}

/**
 * 새 스위치가 **사건 표지가 아닌지**. 표지 목록(§3 8단계 4번이 지우라고 지시하는 키)에 들어오면
 * 지울 대상이 늘고 **지우는 자리도 틀린다** — 이 키는 운영 배포가 아니라 4단계를 수행하는
 * 스테이징에 넣는 값이다. 순환 import 를 만들지 않도록 목록을 **받는다**.
 */
export function auditNotAMarker(markers: readonly { key: string }[], transient: readonly string[]): string[] {
  const problems: string[] = [];
  if (markers.length === 0) problems.push('사건 표지 목록을 읽을 수 없다 — INCIDENT_MARKERS 의 모양이 바뀌었으면 이 가드를 함께 볼 것');
  if (markers.some((m) => m.key === BOOT_SUPPRESS_ENV)) {
    problems.push(`${BOOT_SUPPRESS_ENV} 가 사건 표지로 등록됐다 — 운영 배포의 국면을 말하는 값이 아니다(스테이징 설정이다)`);
  }
  if (transient.length === 0) problems.push('임시 키 목록을 읽을 수 없다 — TRANSIENT_KEYS 의 모양이 바뀌었으면 이 가드를 함께 볼 것');
  else if (!transient.includes(BOOT_SUPPRESS_ENV)) {
    problems.push(`${BOOT_SUPPRESS_ENV} 가 임시 키 목록에 없다 — 평상시 미설정이 정상인데 거짓 missing 으로 보고된다`);
  }
  return problems;
}

/**
 * `RUNBOOK.md` 원문 — §3-19 와 그것을 가리키는 단계가 함께 남아 있는지. 특히
 *  · 4단계가 이 절로 유도하지 않으면 「읽기 전용」이라는 문장만 남고,
 *  · 판정 표·사각지대가 빠지면 담당자가 응답의 뜻을 읽을 자리가 없다.
 */
export function auditRunbookSource(md: unknown): string[] {
  const s = String(md ?? '');
  const problems: string[] = [];

  if (!/^###\s*3-19\./m.test(s)) problems.push('§3-19(검증이 만들어 내는 쓰기) 절이 없다');
  if (!/bootWritesText\(|assessBootWrites\(/.test(s)) problems.push('§3-19 에 판정 산출 명령이 없다');
  if (!s.includes(BOOT_SUPPRESS_ENV)) problems.push(`${BOOT_SUPPRESS_ENV} 가 문서에 없다 — 막는 방법이 사라진다`);
  for (const v of BOOT_VERDICTS) {
    if (!new RegExp(`\`${v}\``).test(s)) problems.push(`§3-19 판정 표에 ${v} 행이 없다`);
  }
  for (const spot of BOOT_BLIND_SPOTS) {
    if (!s.includes(spot.key)) problems.push(`§3-19 에 사각지대 ${spot.key} 가 없다`);
  }

  const sec3 = s.match(/^##\s*3\.\s[\s\S]*?(?=^###\s*3-1\.)/m)?.[0] ?? '';
  if (!sec3) {
    problems.push('§3 본문을 찾지 못했다 — 문서 구조가 바뀌었으면 이 가드를 함께 볼 것');
    return problems;
  }
  const i4 = sec3.search(/^4\.\s/m);
  const step4 = i4 < 0 ? '' : sec3.slice(i4).split(/^5\.\s/m)[0];
  if (!step4) problems.push('§3 4단계를 찾지 못했다');
  else if (!/3-19/.test(step4)) {
    problems.push('4단계가 §3-19 로 유도하지 않는다 — 「읽기 전용」이라는 문장만 남고 기동 쓰기가 절차에서 사라진다');
  }
  return problems;
}
