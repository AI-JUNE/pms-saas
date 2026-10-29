/**
 * verifierPointer.ts — **검증을 수행한 배포가 전환 뒤에도 같은 DB 를 쥐고 있다**
 * (RUNBOOK §3-20 · §3 4단계·5단계·8단계 4번). 2026-10-29
 *
 * ── 왜 필요한가 ───────────────────────────────────────────────────────────────
 * §3 4단계는 「복구 브랜치 연결문자열을 **스테이징 환경의 `DATABASE_URL` 에 넣고 기동한 뒤**
 * `GET /api/admin/recovery-verify` 를 호출한다」다. 5단계는 「운영 `DATABASE_URL` 을 **그 복구
 * 브랜치로 교체**하고 재배포한다」다. 그래서 전환이 끝난 순간 **그 브랜치는 운영 DB 가 되는데,
 * 4단계를 수행한 배포는 그것을 가리키는 연결 문자열을 그대로 쥐고 있다** — 그리고
 * **그것을 떼라고 말하는 단계가 어디에도 없었다.**
 *
 *  (1) **전환 뒤 그 배포의 쓰기는 운영에 들어간다.** 2단계 차단은 **운영 배포의 env** 이고
 *      (§3-3 `FREEZE_LIMITS`) 4단계 수행처는 스테이징이다 — 같은 DB 를 보면서 한쪽만 잠긴
 *      상태이고, 7단계 해제는 운영 쪽 키를 지우는 일이라 **이 배포는 처음부터 끝까지 잠긴 적이
 *      없다.** 설정기반 CRUD 40개가 그 배포에서도 그대로 열려 있다.
 *
 *  (2) **6-1단계 재적용이 그 뒤 기동으로 되돌아간다.** §3-19 가 정본화한 기동 쓰기
 *      (`ensureRecoveryAdmin` — **소스에 하드코딩된 비밀번호**의 관리자)는 멱등 가드라
 *      **다음 기동이 다시 만든다.** 전환 뒤 그 「다음 기동」은 운영 DB 에 쓴다 — 6-1단계에서
 *      세션을 전부 폐기하고 비밀번호를 재적용해도, 그 배포가 한 번 더 뜨는 순간 계정이 돌아온다.
 *      §3-19 가 「이미 만들어진 행은 지우지 않는다(다음 기동이 다시 만든다)」고 적어 둔 그 성질이
 *      **전환 뒤에는 운영 DB 에 대해** 작동한다.
 *
 *  (3) **지우라고 지시하는 자리가 없다.** 8단계 4번이 지우는 것은 **운영 스코프의 env 표지
 *      여섯**이고 `DATABASE_URL` 은 그 목록에 없다 — 있어서도 안 된다(운영의 그 값은 복구된 DB 를
 *      가리켜야 한다). 지워야 하는 것은 **다른 배포의 같은 이름 키**이고, 그 배포는 8단계의
 *      어느 줄에도 나오지 않는다.
 *
 *  (4) **어떤 응답도 그것을 말하지 않는다.** 전환 뒤 `checks.dbIdentity` 는 **양쪽 배포에서 같은
 *      지문**을 낸다(지문은 「이 배포가 어느 DB 를 보도록 설정됐는가」까지다 — §3-4). 운영 응답은
 *      다른 배포의 설정을 **볼 수 없고**(§3-13), 스테이징 스코프에는 사건 표지가 없어 그 배포는
 *      「사건 중인지」조차 모른다(§3-14 의 귀속 기준점이 거기에 없다).
 *
 *  (5) **리허설에서는 반대 방향으로 조용하다.** 체크리스트 마지막 항목이 복구 브랜치를 정리하므로
 *      포인터는 **죽은 브랜치**를 가리킨 채 남는다 — 다음 리허설·다음 사건의 4단계가 그 옛 값에서
 *      시작하고, 브랜치가 아직 살아 있으면 **옛 DB 의 행 수를 센다**(§3-4 가 지문 대조를 요구하는
 *      이유가 바로 그것인데, 떼라는 지시가 없으면 그 실수가 매번 되돌아온다).
 *
 * 그래서 이 모듈은 — **코드가 다른 배포의 env 를 고칠 수는 없으므로** —
 *   · 4단계를 수행한 배포가 **무엇을 계속 쥐고 있는가**를 정본으로 두고,
 *   · **이 배포 자신이** 기준 지문이 가리키는 DB 를 쥐고 있는지 판정하고(= 그 판정을 내놓는
 *     쪽이 바로 포인터를 쥔 배포다. `/api/admin/recovery-verify` 는 그 배포가 서는 엔드포인트다),
 *   · 가려낼 수 없는 것(전환 **전** 4단계 수행 중과 전환 **뒤** 미처분이 같은 값이다)을
 *     판정으로 덮지 않고 **결정을 요구하는 것**으로 돌려주고,
 *   · 절차가 그 처분을 **지시하는 자리**(4단계 끝·5단계·8단계 4번)를 갖게 한다.
 *
 * 원칙
 * - 순수 모듈: DB·next·fs·`process.env` 미접근. **신규 조회·쓰기·DDL 0 · 신규 런타임 체크 0 ·
 *   신규 사건 표지 0 · 신규 env 0** — 이미 있는 세 키(`DATABASE_URL`·`RECOVERY_EXPECTED_DB`·
 *   `VERCEL_ENV`)의 판독을 재사용한다.
 * - **판독 방식을 복제하지 않는다** — 배포 역할은 `rehearsalScope.deploymentRole()`, 지문은
 *   `dbIdentity.identify`/`parseExpected` 정본을 쓴다. 여기서 다시 읽으면 판독이 두 곳에서
 *   갈리고, 갈라진 쪽은 아무 응답도 바꾸지 않으므로 영구히 남는다(`auditSelfSource` 가 잡는다).
 * - **`switchReady` 를 내리지 않는다.** 포인터가 남아 있다는 이유로 전환을 막으면 4단계 자신이
 *   막힌다(그 상태가 **정상 수행 중**의 모습이다) — 달라지는 것은 **다음에 할 일**이다
 *   (§3-17·§3-18·§3-19 와 같은 규율).
 * - **임의 귀속 금지** — 역할을 모르면(`VERCEL_ENV` 없음) 「운영이다」도 「스테이징이다」도 아닌
 *   `scope_unknown` 으로 멈춘다. 기준 지문이 없으면 `no_reference` 이고 **통과가 아니다**.
 */
import {
  DB_URL_ENV, EXPECTED_DB_ENV, identify, parseExpected,
  type DbIdentity, type ExpectedFailure, type ConnFailure,
} from './dbIdentity.ts';
import { deploymentRole, type DeploymentRole } from './rehearsalScope.ts';

/** 응답·문서에서 근거 절을 찾을 수 있게 한다 */
export const POINTER_RUNBOOK_REF = 'RUNBOOK §3-20 · §3 4단계·5단계·8단계 4번';

/**
 * 이 판정이 **다시 읽지 않고 재사용하는** 키. 신규 env 는 0 이다 —
 * 늘어나는 키마다 복구에서 유실될 것이 하나씩 늘고(§4-12), 그 유실은 조용하다.
 */
export const REUSED_KEYS: readonly string[] = [DB_URL_ENV, EXPECTED_DB_ENV, 'VERCEL_ENV'];

/* ──────────────── 4단계 수행 배포가 계속 쥐고 있는 것(정본) ──────────────── */

export interface VerifierHolding {
  key: string;
  /** 무엇을 쥐고 있는가 */
  what: string;
  /** 어느 단계가 쥐게 했는가 */
  acquiredIn: string;
  /** 어디서 — 파일·절(테스트가 그 원문이 아직 그 일을 하는지 대조한다) */
  origin: string;
  /** 전환(5단계) 뒤 그것이 닿는 곳이 **운영 DB** 인가 */
  reachesProduction: boolean;
  /** 무엇이 떼어 내는가. **코드가 아니다** — 그 사실을 숨기지 않는다 */
  removedBy: string;
  /** 떼지 않으면 조용히 생기는 일 */
  consequence: string;
}

/**
 * 전부 **전환 뒤 운영 DB 에 닿는다**(`reachesProduction`) — 그것이 이 절의 전제다.
 * 그리고 전부 **사람이 떼야 한다**(`removedBy`) — 코드는 다른 배포의 env 를 고치지 못한다.
 */
export const VERIFIER_HOLDINGS: readonly VerifierHolding[] = [
  {
    key: 'db_pointer',
    what: '복구 브랜치 연결 문자열 — 5단계가 **운영으로 승격시킨 바로 그 DB** 를 가리킨다',
    acquiredIn: '§3 4단계(「스테이징 환경의 `DATABASE_URL` 에 넣고 기동한 뒤」)',
    origin: 'Vercel 환경변수(이 배포 스코프의 `DATABASE_URL`)',
    reachesProduction: true,
    removedBy: '사람 — 이 배포 스코프의 값을 되돌리고 **재배포**한다(환경변수는 재배포 전까지 반영되지 않는다)',
    consequence:
      '전환 뒤 이 배포에서 들어온 **모든 쓰기가 운영 DB 로 들어간다** — 사용자 눈에는 스테이징이지만 행은 운영에 남고, 어느 응답도 그 사실을 말하지 않는다',
  },
  {
    key: 'unfrozen_writes',
    what: '2단계 쓰기 차단이 **걸려 있지 않은 상태**(차단은 운영 배포의 env 다)',
    acquiredIn: '§3 2단계(차단) ~ 7단계(해제) — 이 배포는 그 사이 **한 번도 잠기지 않는다**',
    origin: 'src/middleware.ts(스위치는 그 배포 자신의 `RECOVERY_WRITE_FREEZE` 를 읽는다)',
    reachesProduction: true,
    removedBy: '사람 — 같은 스코프에도 차단을 켜거나(§3-3), 위 포인터를 떼어 낸다',
    consequence:
      '3~5단계 사이에 이 배포로 들어온 쓰기는 **전환에서 사라지고**(유실 구간에 들어가지만 §3-7 구간 산출은 운영 차단 시각만 본다), 전환 뒤에 들어온 쓰기는 **운영 DB 에 남는다** — `FREEZE_LIMITS` 가 「같은 DB 를 쓰는 다른 배포는 각자 켜야 한다」고 적어 둔 바로 그 경로다',
  },
  {
    key: 'boot_admin_regrant',
    what: '기동마다 되살아나는 **소스에 하드코딩된 비밀번호**의 관리자 계정·조직·소속(§3-19 `recovery_admin`)',
    acquiredIn: '§3 4단계 기동 — 그리고 **그 뒤의 모든 기동**(멱등 가드다)',
    origin: 'src/instrumentation.ts → lib/bootstrap.ensureRecoveryAdmin',
    reachesProduction: true,
    removedBy: '사람 — 포인터를 떼거나 그 스코프에 `RECOVERY_BOOT_WRITES_OFF=true` 를 유지한다',
    consequence:
      '6-1단계에서 세션을 전부 폐기하고 비밀번호를 재적용해도 **그 배포가 한 번 더 뜨는 순간 계정이 돌아온다** — §3-8 표에 없고(되돌아온 것이 아니라 새로 생긴 것이다. §3-19 `not_a_restored_row`) 재적용 시각은 이미 `recorded` 다',
  },
  {
    key: 'guest_demo_seed',
    what: '화면을 한 번 열면 들어오는 **데모 데이터 한 벌**(§3-19 `guest_demo_seed`)',
    acquiredIn: '§3 4단계 이후 그 배포의 화면 접속 — 사람이 열지 않아도 봇·프리뷰 점검이 연다',
    origin: 'src/app/api/auth/guest/route.ts → lib/demoSeed.seedDemo',
    reachesProduction: true,
    removedBy: '사람 — 포인터를 떼거나 그 스코프에 `PMS_GUEST_DISABLED=true` 를 유지한다',
    consequence:
      '전환 뒤에는 **운영 조직 목록에 데모 조직이 생긴다** — `seedDemo` 는 빈 표만 채우므로 복구로 비어 버린 표일수록 더 많이 채워지고, 그 행은 복구된 행과 구분되지 않는다',
  },
];

/* ──────────────────── 드러나지 않는 이유(사각지대) ──────────────────── */

export interface PointerBlindSpot {
  key: string;
  /** 무엇이 보이지 않는가 */
  what: string;
  /** 왜 어떤 판정도 그것을 말하지 못하는가 */
  why: string;
}

export const POINTER_BLIND_SPOTS: readonly PointerBlindSpot[] = [
  {
    key: 'phase_indistinguishable',
    what: '전환 **전**(4단계 수행 중 = 정상)과 전환 **뒤**(미처분 = 운영에 쓴다)의 구분',
    why: '두 국면에서 이 배포의 env 는 **같은 값**이다(복구 브랜치를 가리키는 `DATABASE_URL`). 사건 국면을 말해 주는 표지 여섯은 **운영 스코프**에 있어 여기서는 읽히지 않는다(§3-14) — 그래서 판정은 「사고다」라고 말하지 않고 **결정할 때가 됐다**고만 말한다',
  },
  {
    key: 'other_deployment_invisible',
    what: '운영 배포에서 본 「다른 배포가 같은 DB 를 쥐고 있다」는 사실',
    why: '전환 뒤 `checks.dbIdentity` 는 **양쪽에서 같은 지문**을 내고 `match` 로 끝난다(지문은 「이 배포가 어느 DB 를 보도록 설정됐는가」까지다 — §3-4). 다른 스코프의 env 는 볼 수 없다(§3-13) — 이 판정도 **읽는 배포 자신**에 대한 것이다',
  },
  {
    key: 'reference_absent_by_default',
    what: '이 판정이 **성립하지 않는다**는 사실',
    why: '기준 지문 `RECOVERY_EXPECTED_DB` 는 §3-13 이 `crossScope: false` 로 적어 둔 키다 — 5단계가 **운영 스코프에만** 넣으므로 4단계 수행 배포에는 없는 것이 **기본 상태**다. 그러면 대조할 상대가 없어 `no_reference` 에서 멈춘다(판정 보류이고 통과가 아니다)',
  },
  {
    key: 'clear_step_is_elsewhere',
    what: '포인터를 **지우라고 지시하는 자리**',
    why: '8단계 4번이 지우는 것은 운영 스코프의 **env 표지 여섯**이고 `DATABASE_URL` 은 그 목록에 없다 — 있어서도 안 된다(운영의 그 값은 복구된 DB 를 가리켜야 한다). 지워야 하는 것은 **다른 배포의 같은 이름 키**이고, 그 배포는 8단계의 어느 줄에도 나오지 않았다',
  },
  {
    key: 'rehearsal_dangling',
    what: '리허설이 끝난 뒤 남은 **죽은 브랜치를 가리키는 포인터**',
    why: '체크리스트 마지막 항목은 복구 브랜치를 정리하라고 지시하고(§3-18) 포인터는 그 목록에 없다 — 다음 수행은 그 옛 값에서 시작한다. 브랜치가 아직 살아 있으면 기동이 깨지지도 않고 **옛 DB 의 행 수를 센다**(§3-4 가 지문 대조를 요구하는 이유다)',
  },
  {
    key: 'direct_access_unseen',
    what: '배포가 아닌 경로가 쥔 같은 연결 문자열',
    why: '복구 담당자의 로컬·터미널·DB 클라이언트에 복사된 값은 **어떤 배포의 env 에도 없다** — `FREEZE_LIMITS`·§3-13 이 적어 둔 것과 같은 한계이고, 이 판정은 그쪽을 보지 못한다(볼 수 있는 척하지 않는다)',
  },
];

/* ─────────────────────────── 판정 ─────────────────────────── */

export const POINTER_VERDICTS = [
  /** `VERCEL_ENV` 가 없어 **이 배포가 운영인지 아닌지 모른다** — 「운영이 아니다」로 올리지 않는다 */
  'scope_unknown',
  /** 이 배포는 운영이다 — 4단계 수행처가 아니고, **다른 배포의 포인터는 볼 수 없다** */
  'not_applicable',
  /** 연결 문자열을 읽지 못해 **무엇을 가리키는지 모른다** — 「없다」가 아니다 */
  'pointer_unknown',
  /** 기준 지문이 적혀 있는데 **읽을 수 없다**(연결 문자열·형식 오류) */
  'invalid_reference',
  /** 기준 지문이 이 스코프에 없다 — **대조가 성립하지 않는다**(기본 상태이고 통과가 아니다) */
  'no_reference',
  /** 이 배포가 **기준 지문이 가리키는 DB** 를 쥐고 있다 — 전환 전·후를 여기서는 가려낼 수 없다 */
  'holding',
  /** 그 DB 를 가리키지 않는다 — **다른 DB·죽은 브랜치일 수 있다**(「안전하다」는 뜻이 아니다) */
  'detached',
] as const;
export type PointerVerdict = (typeof POINTER_VERDICTS)[number];

export const ACTION_POINTER_SCOPE_UNKNOWN =
  '`VERCEL_ENV` 를 읽을 수 없어 **이 배포가 운영인지 4단계 수행처인지 판정하지 않는다** — ' +
  '「운영이 아니다」로 올리지 않는다(모르는 것과 안전한 것은 다르다). 로컬·외부 런타임에서 ' +
  '복구 브랜치를 물렸다면 그 연결 문자열의 처분은 **사람이 기억으로** 해야 한다(§3-20 `direct_access_unseen`)';

export const ACTION_POINTER_NOT_APPLICABLE =
  '이 응답은 **운영 배포**의 것이다 — 4단계를 수행한 배포의 포인터는 여기서 보이지 않는다(§3-13). ' +
  '**그 배포에서** 같은 엔드포인트를 호출해 `pointer.verdict` 를 보거나, 그 스코프의 ' +
  `\`${DB_URL_ENV}\` 를 직접 확인한다. 전환 뒤 \`checks.dbIdentity\` 는 **양쪽에서 같은 지문**을 내므로 ` +
  '운영 응답만으로는 또 한 배포가 같은 DB 를 쥐고 있다는 사실을 알 수 없다';

export const ACTION_POINTER_UNKNOWN =
  `\`${DB_URL_ENV}\` 를 읽을 수 없어 **이 배포가 무엇을 가리키는지 모른다** — 대조가 성립하지 않는다` +
  '(「가리키지 않는다」로 올리지 않는다). 값이 잘렸는지·스코프를 틀렸는지 먼저 본다';

export const ACTION_POINTER_INVALID_REFERENCE =
  `\`${EXPECTED_DB_ENV}\` 값을 읽을 수 없다 — 지문 12자리 16진수만 넣는다(**연결 문자열을 넣지 않는다** — ` +
  '넣으면 비밀번호가 env 에 한 벌 더 복제된다). 산출 명령은 §3-4. **통과가 아니다**';

export const ACTION_POINTER_NO_REFERENCE =
  `이 스코프에 기준 지문(\`${EXPECTED_DB_ENV}\`)이 없어 **이 포인터가 운영 DB 를 가리키는지 판정하지 않는다** — ` +
  '§3-13 이 적어 둔 대로 그 키는 운영 스코프에만 넣는 값이라 **없는 것이 기본 상태**다(판정 보류이고 ' +
  '통과가 아니다). 4단계·리허설을 이 배포에서 수행한다면 5단계에서 넣은 **같은 값을 이 스코프에도 ' +
  '복사**해 두면(값이 아니라 지문이다 — 시크릿이 늘지 않는다) 이 판정이 성립한다';

export const ACTION_POINTER_HOLDING =
  '이 배포는 **기준 지문이 가리키는 DB** 를 쥐고 있다 — 4단계 수행 중이라면 **정상**이고, 5단계 전환이 ' +
  '끝났다면 **운영 DB 를 쥔 또 하나의 배포**다. 이 배포의 env 로는 그 둘을 가려낼 수 없으므로 ' +
  `(§3-20 \`phase_indistinguishable\`) **처분을 한쪽으로 확정한다**: (가) 이 스코프의 \`${DB_URL_ENV}\` 를 ` +
  '되돌리고 **재배포**해 포인터를 떼거나, (나) 남기기로 하면 6절 표 비고에 「검증 배포 포인터 유지」와 ' +
  '그 스코프를 적고 `RECOVERY_BOOT_WRITES_OFF=true`·`PMS_GUEST_DISABLED=true` 를 **유지**한다(§3-19). ' +
  '확정은 **표지를 지우기 전에** 한다 — 지운 뒤에는 어느 배포가 사건에 쓰였는지 말할 근거가 없다';

export const ACTION_POINTER_DETACHED =
  '이 배포는 기준 지문의 DB 를 가리키지 않는다 — **「안전하다」는 뜻은 아니다**(다른 운영 DB 일 수도, ' +
  '정리된 **죽은 브랜치**일 수도 있다. §3-20 `rehearsal_dangling`). 4단계를 여기서 수행할 차례라면 ' +
  '§3-4 로 복구 브랜치의 지문을 산출해 `identity.fingerprint` 와 대조한 뒤 시작한다';

const ACTION: Record<PointerVerdict, string> = {
  scope_unknown: ACTION_POINTER_SCOPE_UNKNOWN,
  not_applicable: ACTION_POINTER_NOT_APPLICABLE,
  pointer_unknown: ACTION_POINTER_UNKNOWN,
  invalid_reference: ACTION_POINTER_INVALID_REFERENCE,
  no_reference: ACTION_POINTER_NO_REFERENCE,
  holding: ACTION_POINTER_HOLDING,
  detached: ACTION_POINTER_DETACHED,
};

const NOTE: Record<PointerVerdict, string> = {
  scope_unknown: '배포 역할을 모른다 — 임의로 귀속하지 않는다',
  not_applicable: '운영 배포의 응답이다 — 다른 배포의 포인터는 원리상 보이지 않는다',
  pointer_unknown: '가리키는 곳을 모른다 — 「가리키지 않는다」와 다르다',
  invalid_reference: '기준 지문이 적혀 있으나 쓸 수 없다 — 넣은 사람은 대조되는 줄 안다',
  no_reference: '대조할 상대가 없다 — **기본 상태**이고 통과가 아니다',
  holding: '기준 지문의 DB 를 쥐고 있다 — 수행 중인지 미처분인지는 이 배포가 말할 수 없다',
  detached: '그 DB 를 가리키지 않는다 — 죽은 브랜치를 가리킬 수도 있다',
};

export const CAVEAT_POINTER_CODE_DOES_NOT_DETACH =
  '**코드는 포인터를 떼지 않는다** — env 를 바꾸지도, 다른 배포에 명령하지도 않는다(쓰기 0 · 신규 env 0). ' +
  '떼는 것과 재배포는 사람이 한다';

export const CAVEAT_POINTER_SELF_SCOPE =
  '**읽는 배포 자신의 env 만 본다** — 4단계를 수행한 배포가 무엇을 쥐고 있는지는 **그 배포의 응답**으로만 ' +
  '알 수 있다(§3-13). 운영 응답에서 이 판정이 `not_applicable` 인 것은 정상이다';

export const CAVEAT_POINTER_PHASE =
  '**전환 전과 전환 뒤를 가려내지 못한다** — 두 국면에서 이 배포의 env 는 같은 값이고, 사건 표지는 ' +
  '운영 스코프에 있다(§3-14). 그래서 `holding` 은 「사고다」가 아니라 **「처분을 확정할 때다」**로 읽는다';

export const POINTER_LIMITS: readonly string[] = [
  CAVEAT_POINTER_CODE_DOES_NOT_DETACH,
  CAVEAT_POINTER_SELF_SCOPE,
  CAVEAT_POINTER_PHASE,
  '**제자리 복구**는 엔드포인트가 그대로여서 지문이 바뀌지 않는다(§3-4 `IDENTITY_LIMITS`) — 그 경로에서는 ' +
    '`holding` 과 평상시가 구분되지 않는다. pooled(`-pooler`)와 직결도 **같은 지문**이다',
  '`detached` 가 「이 배포는 아무 데도 쓰지 않는다」를 뜻하지 않는다 — 다른 DB 를 쥐고 있을 뿐이고, ' +
    '정리된 브랜치를 가리키면 **다음 4단계가 옛 값에서 시작한다**',
  '쥐고 있는 것이 **실제로 쓴 적이 있는지**는 보지 않는다 — 포인터가 꽂혀 있는지까지다(기동 쓰기는 ' +
    '§3-19 가 스위치까지만 말한다). 행 수를 세지도, 행 수 응답에서 그 몫을 빼지도 않는다',
  '배포가 아닌 경로(로컬·터미널·DB 클라이언트에 복사된 연결 문자열)는 **어떤 env 에도 없어** 보이지 않는다',
];

export interface PointerAssessment {
  verdict: PointerVerdict;
  /** 이 배포의 역할(`deploymentRole` 정본 판독) */
  role: DeploymentRole;
  /** 역할을 읽어낸 키 — 못 읽으면 null */
  roleSource: string | null;
  /** 연결 문자열을 읽어냈는가 */
  pointerKnown: boolean;
  /** 못 읽은 이유(읽었으면 null) */
  pointerReason: ConnFailure | null;
  /** 이 스코프에 기준 지문이 **쓸 수 있는 꼴로** 있는가 */
  referenceConfigured: boolean;
  /** 기준값을 못 읽은 이유 */
  referenceReason: ExpectedFailure | null;
  /** 지금 처분을 확정해야 하는가 — `holding` 만 true */
  decisionDue: boolean;
  /** 이 배포가 쥐고 있는 것(정본 키) */
  holdings: readonly string[];
  /** 그중 전환 뒤 **운영 DB 에 닿는** 것 */
  reachingProduction: readonly string[];
  /** 지금 할 일이 있는가 — 읽는 쪽이 조건식을 다시 짜면 판정이 두 곳에서 갈린다 */
  actionable: boolean;
  action: string;
  note: string;
  caveats: readonly string[];
}

/**
 * 4단계 수행 배포의 포인터 판정.
 *
 * 판정 순서: **역할을 모른다** → 운영이다 → **가리키는 곳을 모른다** → 기준값이 깨졌다 →
 * 기준값이 없다 → 쥐고 있다 / 떼어졌다.
 *
 * 순서가 뜻을 갖는다 —
 *  · 역할이 먼저인 이유: 모르는 배포를 「운영이다」로도 「스테이징이다」로도 올리지 않는다.
 *  · **연결 대상을 모르는 것이 기준값 유무보다 먼저다**(§3-4 와 같은 규율) — 모르는 상태에서
 *    기준값이 없다는 이유로 `no_reference` 를 내면 「할 일은 키를 넣는 것」으로 읽힌다.
 *  · `invalid_reference` 가 `no_reference` 보다 먼저인 이유: 「넣지 않았다」와 「넣었는데 못
 *    읽힌다」는 할 일이 다르다(넣는다 / 고쳐 적는다).
 */
export function assessVerifierPointer(input?: {
  env?: Record<string, string | undefined>;
  /** 이미 읽어 둔 식별 정보를 넘길 때(라우트에서 두 번 파싱하지 않게) */
  identity?: DbIdentity;
  holdings?: readonly VerifierHolding[];
}): PointerAssessment {
  const env = input?.env ?? {};
  const holdings = input?.holdings ?? VERIFIER_HOLDINGS;
  const reading = deploymentRole(env);
  const id = input?.identity ?? identify(env[DB_URL_ENV]);
  const expected = parseExpected(env[EXPECTED_DB_ENV]);

  const base = {
    role: reading.role,
    roleSource: reading.source,
    pointerKnown: id.known,
    pointerReason: id.reason,
    referenceConfigured: expected.ok,
    referenceReason: expected.ok ? null : expected.reason,
    holdings: holdings.map((h) => h.key),
    reachingProduction: holdings.filter((h) => h.reachesProduction).map((h) => h.key),
    // `detached` 에도 할 일이 남는다 — 죽은 브랜치를 가리킬 수 있다는 것이 할 일이다.
    actionable: true,
    caveats: POINTER_LIMITS,
  };

  const decide = (verdict: PointerVerdict): PointerAssessment => ({
    ...base,
    verdict,
    decisionDue: verdict === 'holding',
    action: ACTION[verdict],
    note: NOTE[verdict],
  });

  if (reading.role === 'unknown') return decide('scope_unknown');
  if (reading.role === 'production') return decide('not_applicable');
  if (!id.known || !id.fingerprint) return decide('pointer_unknown');
  if (!expected.ok) return decide(expected.reason === 'unset' ? 'no_reference' : 'invalid_reference');
  return decide(id.fingerprint === expected.fingerprint ? 'holding' : 'detached');
}

/** env 스냅샷으로 판정한다(라우트·명령에서 같은 경로를 쓴다) */
export function verifierPointerFromEnv(env: Record<string, string | undefined> = {}): PointerAssessment {
  return assessVerifierPointer({ env });
}

/* ─────────────────────────── 출력 ─────────────────────────── */

/** 로그 한 줄. 판정·역할·개수만 — **지문·연결 문자열은 담지 않는다** */
export function pointerLine(a: PointerAssessment): string {
  return [
    'recovery_verifier_pointer',
    `pointer=${a.verdict}`,
    `role=${a.role}`,
    `decision_due=${a.decisionDue}`,
    `holdings=${a.holdings.length}`,
  ].join(' ');
}

/** 사람이 읽는 요약(§3-20 의 1줄 명령이 출력하는 것) */
export function pointerText(a: PointerAssessment): string {
  const lines = [
    `[${a.verdict}] 배포 역할 ${a.role}(${a.roleSource ?? '판독 불가'}) · ` +
      `포인터 ${a.pointerKnown ? '읽힘' : `읽을 수 없음(${a.pointerReason})`} · ` +
      `기준 지문 ${a.referenceConfigured ? '있음' : `없음/못 읽음(${a.referenceReason})`}`,
    `· 처분 확정이 필요한가: ${a.decisionDue ? '그렇다' : '아니다(판정이 성립하지 않거나 떼어졌다)'}`,
    `· 전환 뒤 운영에 닿는 것 ${a.reachingProduction.length}/${a.holdings.length}건`,
    `· 드러나지 않는 것 ${POINTER_BLIND_SPOTS.length}건`,
  ];
  for (const h of VERIFIER_HOLDINGS) {
    lines.push(`  - ${h.key}(${h.origin}) → ${h.consequence}`);
    lines.push(`    떼는 것: ${h.removedBy}`);
  }
  lines.push(`→ ${a.action}`);
  for (const c of a.caveats) lines.push(`※ ${c}`);
  return lines.join('\n');
}

/**
 * 4단계 응답용 필터. 슈퍼관리자 전용 응답이지만 **지문·연결 문자열·env 값은 담지 않는다** —
 * 이 응답의 `identity` 가 이미 지문을 말하고 있고, 판정에 필요한 것은 판정뿐이다.
 */
export function publicPointer(a: PointerAssessment): {
  verdict: PointerVerdict;
  role: DeploymentRole;
  decisionDue: boolean;
  holdings: readonly string[];
  reachingProduction: readonly string[];
  action: string;
  caveats: readonly string[];
  runbook: string;
} {
  return {
    verdict: a.verdict,
    role: a.role,
    decisionDue: a.decisionDue,
    holdings: a.holdings,
    reachingProduction: a.reachingProduction,
    action: a.action,
    caveats: a.caveats,
    runbook: POINTER_RUNBOOK_REF,
  };
}

/** 배선 상태 요약(문서·보고용). 값은 담지 않는다 */
export function verifierPointerStatus(env: Record<string, string | undefined> = {}): {
  verdict: PointerVerdict;
  role: DeploymentRole;
  decisionDue: boolean;
  holdings: number;
  blindSpots: number;
  limits: number;
  newEnvKeys: number;
  action: string;
} {
  const a = verifierPointerFromEnv(env);
  return {
    verdict: a.verdict,
    role: a.role,
    decisionDue: a.decisionDue,
    holdings: VERIFIER_HOLDINGS.length,
    blindSpots: POINTER_BLIND_SPOTS.length,
    limits: POINTER_LIMITS.length,
    // 이 절이 만든 env 는 **0** 이다 — 재사용만 한다.
    newEnvKeys: 0,
    action: a.action,
  };
}

/* ─────────────────────────── 정적 점검 ─────────────────────────── */

/** 정본 자신의 모양 — 전환 뒤 운영에 닿는가·누가 떼는가가 사유 없이 비어 있지 않은지 */
export function auditPointerCanon(
  holdings: readonly VerifierHolding[] = VERIFIER_HOLDINGS,
  spots: readonly PointerBlindSpot[] = POINTER_BLIND_SPOTS,
): string[] {
  const problems: string[] = [];
  if (holdings.length === 0) {
    problems.push('포인터 정본이 비었다 — 4단계가 아무것도 쥐지 않게 바뀌었다면 이 절을 지워야 한다');
  }
  const seen = new Set<string>();
  for (const h of holdings) {
    if (seen.has(h.key)) problems.push(`중복 키: ${h.key}`);
    seen.add(h.key);
    if (!h.origin.trim()) problems.push(`${h.key} 에 어디서 쥐게 되는지 적혀 있지 않다`);
    if (!h.acquiredIn.trim()) problems.push(`${h.key} 에 어느 단계가 쥐게 했는지 적혀 있지 않다`);
    if (!h.consequence.trim()) problems.push(`${h.key} 에 떼지 않으면 생기는 일이 적혀 있지 않다`);
    if (!h.removedBy.trim()) problems.push(`${h.key} 에 무엇이 떼어 내는지 적혀 있지 않다`);
    if (!h.reachesProduction) {
      problems.push(`${h.key} 가 전환 뒤 운영에 닿지 않는다고 선언돼 있다 — 닿지 않는 것은 이 절의 대상이 아니다`);
    }
  }
  if (spots.length === 0) problems.push('사각지대 정본이 비었다');
  for (const s of spots) {
    if (!s.what.trim() || !s.why.trim()) problems.push(`사각지대 ${s.key} 에 설명이 없다`);
  }
  return problems;
}

/**
 * **이 모듈 원문** — 판독을 복제하지 않았는지. `VERCEL_ENV` 를 직접 읽거나 지문을 자체 계산하면
 * 판독이 두 곳에서 갈리고, 갈라진 쪽은 아무 응답도 바꾸지 않으므로 영구히 남는다.
 * `process.env` 접근이 들어오면 순수 모듈이 아니게 되어 테스트가 env 를 넣어 볼 수 없다.
 */
export function auditSelfSource(src: unknown): string[] {
  const s = String(src ?? '');
  const problems: string[] = [];
  if (!/deploymentRole\(/.test(s)) {
    problems.push('배포 역할을 deploymentRole 정본으로 읽지 않는다 — 판독이 두 곳에서 갈린다');
  }
  if (/env\.VERCEL_ENV|env\['VERCEL_ENV'\]|env\["VERCEL_ENV"\]/.test(s)) {
    problems.push('VERCEL_ENV 를 직접 읽는다 — rehearsalScope.deploymentRole 을 쓸 것');
  }
  if (!/parseExpected\(/.test(s) || !/identify\(/.test(s)) {
    problems.push('지문 판독을 dbIdentity 정본(identify·parseExpected)으로 하지 않는다');
  }
  // 패턴을 조립해 둔다 — 이 가드가 **자기 원문에** 걸리지 않게(해시 함수 이름이 여기 적혀 있다).
  if (new RegExp(['create', 'Hash', '|', 'fingerprintOf\\('].join('')).test(s)) {
    problems.push('지문을 이 모듈이 다시 계산한다 — dbIdentity 의 산출과 갈릴 수 있다');
  }
  // 접근만 잡는다 — 머리말의 「`process.env` 미접근」 서술을 위반으로 세지 않는다.
  if (/process\.env\s*[.[]/.test(s)) {
    problems.push('process.env 에 접근한다 — 순수 모듈 규율이 깨지고 스코프별 판정을 시험할 수 없다');
  }
  return problems;
}

/** 재사용하는 키가 **이미 레지스트리에 있는지** — 신규 env 0 이 이 절의 전제다 */
export function auditNoNewEnv(registryKeys: readonly string[], reused: readonly string[] = REUSED_KEYS): string[] {
  const known = new Set(registryKeys);
  const problems: string[] = [];
  if (registryKeys.length === 0) {
    problems.push('env 레지스트리를 읽을 수 없다 — ENV_VARS 의 모양이 바뀌었으면 이 가드를 함께 볼 것');
    return problems;
  }
  for (const k of reused) {
    if (!known.has(k)) problems.push(`${k} 가 레지스트리에 없다 — 이 절은 신규 env 를 만들지 않는다(재사용만 한다)`);
  }
  return problems;
}

/**
 * `app/api/admin/recovery-verify/route.ts` 원문 — 판정을 **응답에 실어 보내는지**까지 본다.
 * 판정만 하고 버리면 담당자는 전환을 끝내고 포인터를 그대로 둔다(응답은 200 이다).
 */
export function auditVerifyWiring(src: unknown): string[] {
  const s = String(src ?? '');
  const problems: string[] = [];
  if (!/from\s+['"]@\/lib\/verifierPointer['"]/.test(s)) {
    problems.push('recovery-verify 가 verifierPointer 를 import 하지 않는다');
  }
  if (!/assessVerifierPointer\(|verifierPointerFromEnv\(/.test(s)) {
    problems.push('recovery-verify 가 포인터 판정을 호출하지 않는다');
  }
  if (!/pointer\s*:\s*publicPointer\(/.test(s)) {
    problems.push('recovery-verify 응답에 `pointer: publicPointer(…)` 가 없다 — 판정만 하고 버린다');
  }
  if (!/publicPointer\(/.test(s)) {
    problems.push('recovery-verify 가 공개 필터를 거치지 않는다 — 지문·env 값이 응답에 섞일 수 있다');
  }
  if (!/switchReady/.test(s)) {
    problems.push('recovery-verify 원문을 받지 못했다 — 경로가 바뀌었으면 이 가드를 함께 볼 것');
  }
  // `switchReady` 를 내리는 게이트에 이 판정이 끼어들면 4단계 **수행 중**에 전환이 막힌다.
  if (/gateSwitchReady\([^)]*pointer/.test(s)) {
    problems.push('포인터 판정이 switchReady 게이트에 들어갔다 — 수행 중 상태가 거짓 차단이 된다');
  }
  return problems;
}

/**
 * `app/api/health/route.ts` 원문 — **새 체크가 생기지 않았는지**.
 * 4단계 수행 배포가 포인터를 쥐고 있는 것은 **수행 중의 정상 상태**다 — 체크를 만들면 그 배포가
 * 수행 중에 degraded 가 되고(§2-2), 운영 배포에서는 늘 `not_applicable` 이라 아무 말도 하지 않는다.
 */
export function auditNoNewHealthCheck(src: unknown): string[] {
  const s = String(src ?? '');
  const problems: string[] = [];
  if (/from\s+['"]@\/lib\/verifierPointer['"]/.test(s)) {
    problems.push('헬스 라우트가 verifierPointer 를 직접 import 한다 — 수행 중 상태가 상시 degraded 로 읽힌다');
  }
  if (/checks\.verifierPointer\s*=/.test(s)) {
    problems.push('checks.verifierPointer 가 새로 생겼다 — 4단계 수행 중이 degraded 가 된다');
  }
  return problems;
}

/**
 * `RUNBOOK.md` 원문 — §3-20 과 **그것을 가리키는 세 자리**가 함께 남아 있는지.
 *  · 4단계가 유도하지 않으면 포인터를 쥔 채 5단계로 넘어가고,
 *  · 5단계가 유도하지 않으면 전환으로 운영이 된 사실과 포인터가 이어지지 않고,
 *  · 8단계 4번이 유도하지 않으면 **표지를 지운 뒤**에 처분이 남는다(그때는 어느 배포가 사건에
 *    쓰였는지 말할 근거가 없다).
 */
export function auditRunbookSource(md: unknown): string[] {
  const s = String(md ?? '');
  const problems: string[] = [];

  if (!/^###\s*3-20\./m.test(s)) problems.push('§3-20(검증 배포의 포인터 처분) 절이 없다');
  if (!/pointerText\(|assessVerifierPointer\(/.test(s)) problems.push('§3-20 에 판정 산출 명령이 없다');
  for (const v of POINTER_VERDICTS) {
    if (!new RegExp(`\`${v}\``).test(s)) problems.push(`§3-20 판정 표에 ${v} 행이 없다`);
  }
  for (const spot of POINTER_BLIND_SPOTS) {
    if (!s.includes(spot.key)) problems.push(`§3-20 에 사각지대 ${spot.key} 가 없다`);
  }
  for (const h of VERIFIER_HOLDINGS) {
    if (!s.includes(h.key)) problems.push(`§3-20 표에 ${h.key} 행이 없다`);
  }

  const sec3 = s.match(/^##\s*3\.\s[\s\S]*?(?=^###\s*3-1\.)/m)?.[0] ?? '';
  if (!sec3) {
    problems.push('§3 본문을 찾지 못했다 — 문서 구조가 바뀌었으면 이 가드를 함께 볼 것');
    return problems;
  }
  const slice = (from: RegExp, to: RegExp): string => {
    const i = sec3.search(from);
    if (i < 0) return '';
    const rest = sec3.slice(i);
    const j = rest.search(to);
    return j < 0 ? rest : rest.slice(0, j);
  };
  const step4 = slice(/^4\.\s/m, /^5\.\s/m);
  const step5 = slice(/^5\.\s/m, /^6\.\s/m);
  const step8 = slice(/^8\.\s/m, /^>\s/m);
  if (!step4) problems.push('§3 4단계를 찾지 못했다');
  else if (!/3-20/.test(step4)) {
    problems.push('4단계가 §3-20 으로 유도하지 않는다 — 검증을 마친 배포가 포인터를 쥔 채 5단계로 넘어간다');
  }
  if (!step5) problems.push('§3 5단계를 찾지 못했다');
  else if (!/3-20/.test(step5)) {
    problems.push('5단계가 §3-20 으로 유도하지 않는다 — 전환으로 운영이 된 DB 를 또 한 배포가 쥐고 있다는 사실이 절차에서 빠진다');
  }
  if (!step8) problems.push('§3 8단계를 찾지 못했다');
  else if (!/3-20/.test(step8)) {
    problems.push('8단계가 §3-20 으로 유도하지 않는다 — 표지를 지운 뒤에는 어느 배포가 사건에 쓰였는지 말할 근거가 없다');
  }
  return problems;
}
