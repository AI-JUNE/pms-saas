/**
 * rehearsalCoverage.ts — 리허설이 **어느 절차를 검증했는가**(RUNBOOK §6·§6-2). 2026-10-19
 *
 * ── 왜 필요한가 ───────────────────────────────────────────────────────────────
 * §1·§2·§3 1~8단계·§4·§5·§6 의 판정 17건이 전부 전제로 깔고 있는 문장은 하나다 — 「이 절차는
 * 실제로 작동한다」. 그 근거는 §6 리허설 하나뿐이고, 그것을 기계적으로 말하는 것은
 * `lib/recovery.ts` 의 `rehearsalFreshness` → `checks.recovery.detail.rehearsal.status` 다.
 * 그런데 그 판정이 보는 것은 **일자와 결과 두 칸**뿐이다(`RECOVERY_LAST_REHEARSAL` ·
 * `RECOVERY_LAST_REHEARSAL_RESULT`). 「언제 했는가」는 말하고 **「무엇을 검증했는가」는 말하지 않는다.**
 *
 *  (1) **리허설은 「그때의 절차」를 검증한다.** 이 RUNBOOK 은 §3 이 여덟 줄이던 문서에서
 *      소절 19개·체크리스트 36항목·복구 중에만 넣는 기록 키 8개로 자랐다. 그 전부가 리허설
 *      **뒤에** 들어왔다면 한 번도 수행된 적이 없는데, 신선도는 날짜만 보므로 `ok` 다 —
 *      그리고 그 `ok` 를 읽는 쪽(§2-2 `signal` · §2 월 점검 · 마켓플레이스 보안 설명)은
 *      그것을 「복구 절차가 검증됐다」로 읽는다.
 *
 *  (2) **기한 판정은 시간만 본다.** `RECOVERY_REHEARSAL_INTERVAL_DAYS`(예: 180)로 `stale` 을
 *      내는데 **절차 변경은 기한을 앞당기지 않는다** — 어제 §3 을 통째로 고쳐도 열흘 전 리허설은
 *      기한 안이라 `ok` 다. 거꾸로 절차가 한 글자도 바뀌지 않아도 기한이 지나면 `stale` 이다.
 *      두 축이 섞여 있고, 그중 **변경 축을 보는 코드가 없었다.**
 *
 *  (3) **그 변경을 만드는 쪽이 야간 자동 개발 자신이다.** 매 배치가 §3·체크리스트·기록 키를
 *      늘린다 — 그래서 **장치가 좋아질수록 리허설 근거는 낡는데**, 낡는 쪽으로는 아무 신호도
 *      생기지 않는다(가장 조용한 방향이다: `ok` 가 그대로 유지된다).
 *
 *  (4) **그 공백이 §6 표의 `정상` 과 합쳐져 거짓 보증이 된다.** 표에는 수행 범위를 적는 칸이
 *      없고(`parseRehearsalTable` 은 비고를 보지 않는다) env 에도 없다. 그래서 체크리스트
 *      36항목 중 다섯만 수행한 리허설과 전부 수행한 리허설이 **응답에서 글자 하나 다르지 않다.**
 *
 * 그래서 이 모듈은
 *   · 리허설로 수행·관측하는 **절차 단위를 정본 목록**으로 두고(`PROCEDURE_UNITS` — 소절 번호 ·
 *     절차에 들어온 날 `since` · 체크리스트가 **이름으로 인용하는가** `cited` · 거르면 조용히
 *     생기는 일 `skipped`),
 *   · 수행 범위를 **기록으로 받고**(`RECOVERY_LAST_REHEARSAL_SCOPE`, 왕복 가능한 한 줄 —
 *     §6-2 명령이 만들어 준다. **평상시 미설정이 정상**이다),
 *   · 날짜만으로도 산출되는 것을 먼저 말하고(`addedSinceRehearsal` — 리허설 **뒤에** 절차에
 *     들어온 단위. 기록이 없어도 알 수 있다),
 *   · 기록이 있으면 그것을 정본으로 대조하고(`assessCoverage` → `uncovered`),
 *   · 그 상태를 `/api/health` 로 드러내고(`rehearsalCoverageCheck` — **required: false**),
 *   · 어긋남의 세 방향(`COVERAGE_DRIFTS`)과 보장하지 **못하는** 것(`COVERAGE_LIMITS`)을 함께
 *     내보내고, **새 소절이 정본에 등록되지 않으면 CI 에서 실패시킨다**(`auditSectionCoverage`
 *     — 이것이 이 장치의 핵심이다: 다음 배치가 소절을 추가하는 순간 정본이 자라고, 그 순간
 *     기존 범위 기록이 `procedure_changed` 로 떨어진다).
 *
 * 원칙
 * - 순수 모듈: DB·next·fs 미접근, **신규 조회·쓰기·DDL 0**. 판정은 env·인자 해석만으로 한다.
 * - **중복 보고 금지.** 리허설 자체가 없으면 `no_rehearsal` 로 **판정을 보류**한다 —
 *   미실시는 `checks.recovery` 가 이미 `missing` 으로 말한다.
 * - **임의 범위 금지.** 기록이 없으면 「전 단위를 했을 것」으로 올리지 않는다(`unrecorded` =
 *   **판정을 못 한 것**이고 통과가 아니다. §4-10 의 `no_baseline` 과 같은 규율).
 * - **미검증이 기록 자격보다 먼저다** — `asOf` 없음·순서 역전으로 `procedure_changed` 를 덮지 않는다.
 * - 값을 담지 않는다 — 단위 키(소절 번호)·판정·날짜·개수뿐이다.
 */
import { createHash } from 'node:crypto';
import { ENV_VARS } from './envRegistry.ts';
import { TRANSIENT_KEYS, presenceOf } from './envPresence.ts';
import { parseRehearsalDate } from './recovery.ts';

/** 응답·문서에서 근거 절을 찾을 수 있게 한다 */
export const COVERAGE_RUNBOOK_REF = 'RUNBOOK §6 · §6-2';

/** 리허설 수행 **범위** 기록 키. 값은 단위 키 목록이고 **평상시 미설정이 정상**이다 */
export const COVERAGE_ENV = 'RECOVERY_LAST_REHEARSAL_SCOPE';

/** 리허설 일자 정본(판독은 `lib/recovery.ts` 와 같은 키를 쓴다) */
export const LAST_REHEARSAL_ENV = 'RECOVERY_LAST_REHEARSAL';

export const REVISION_LEN = 12;
const REVISION_DOMAIN = 'pms-rehearsal-procedure-v1';
const MS_DAY = 86400000;

/* ─────────────────── 리허설로 검증하는 절차 단위(정본) ─────────────────── */

export interface ProcedureUnit {
  /** RUNBOOK 소절 번호 — 그대로 단위 키다 */
  key: string;
  /** 소절 제목(문서에서 찾을 수 있게) */
  title: string;
  /** 절차에 들어온 날(YYYY-MM-DD). 리허설 일자와 비교하는 축이다 */
  since: string;
  /** 리허설 체크리스트가 이 소절을 **번호로 인용하는가** */
  cited: boolean;
  /** 이 단위를 리허설에서 거르면 조용히 생기는 일 */
  skipped: string;
}

/**
 * 단위는 **번호 붙은 소절**이다. §3 1~8단계 본 절차는 세지 않는다 —
 * 그 수행은 체크리스트 항목과 §6 표의 `검증 결과` 가 말하고, 이 판정이 말하는 것은
 * **본 절차 뒤에 덧붙은 소절들이 리허설 범위에 들어 있는가**다(`COVERAGE_LIMITS` 에 적는다).
 */
export const PROCEDURE_UNITS: readonly ProcedureUnit[] = [
  {
    key: '1-1',
    title: '첨부 본문의 복구 경계',
    since: '2026-10-16',
    cited: true,
    skipped: '첨부가 복구된다고 믿은 채 고지한다 — 복구 뒤 화면에 목록이 그대로 보여 차이가 드러나지 않는다',
  },
  {
    key: '1-2',
    title: '목표치(RTO/RPO) — 약속과 실측의 대조',
    since: '2026-10-20',
    cited: true,
    skipped: '소요시간을 재 놓고도 목표와 견주지 않아, 리허설이 「정상」인데 약속의 몇 배가 걸렸는지 아무도 모른다',
  },
  {
    key: '2-1',
    title: '점검이 밀렸는지 드러내기 — 날짜 없는 설정값의 신선도',
    since: '2026-10-13',
    cited: true,
    skipped: '보존 창 길이가 옛 플랜 기준인지 모른 채 §3-6 판정을 믿는다(창 밖 시점에 ok 가 나온다)',
  },
  {
    key: '2-2',
    title: '판정의 도달 — degraded 는 상태 코드에 나타나지 않는다',
    since: '2026-10-17',
    cited: false,
    skipped: '감시자 쪽 조건(`x-health-status`)이 걸려 있는지 확인되지 않아 전 판정이 아무에게도 닿지 않는다',
  },
  {
    key: '2-3',
    title: '공개 헬스 응답의 상세 — 복구 중에는 사건 상태를 공표한다',
    since: '2026-10-18',
    cited: true,
    skipped: '복구일에 `HEALTH_DETAIL_TOKEN` 이 없어 사건 상태가 무인증으로 나간다(그때는 넣을 겨를이 없다)',
  },
  {
    key: '3-1',
    title: '빈 DB 로 복구할 때 — migrate 만으로는 복원되지 않는다',
    since: '2026-10-03',
    cited: false,
    skipped: '빈 DB 경로를 한 번도 밟지 않아, 베이스라인 DDL 도출이 실제로 되는지 모른 채 복구일을 맞는다',
  },
  {
    key: '3-2',
    title: '기준 스냅샷 — 없으면 4단계가 눈대중이 된다',
    since: '2026-10-04',
    cited: true,
    skipped: '행 수 대조의 기준이 있는지 확인되지 않아 4단계가 `no_baseline` 에서 멈춘다',
  },
  {
    key: '3-3',
    title: '쓰기 차단(읽기전용 모드)',
    since: '2026-10-06',
    cited: false,
    skipped: '차단이 실제로 쓰기를 막는지(예외 경로 포함) 확인되지 않은 채 2단계를 믿는다',
  },
  {
    key: '3-4',
    title: '연결 대상 확인 — 전환이 반영됐는지 보는 유일한 수단',
    since: '2026-10-07',
    cited: true,
    skipped: '지문 산출을 해 본 적이 없어 복구일에 어느 DB 를 보는지 확인하지 못한다',
  },
  {
    key: '3-5',
    title: '조사 근거 보존 — 복구가 감사 이력을 되돌리기 전에',
    since: '2026-10-08',
    cited: true,
    skipped: '끝까지 받는 조회를 해 본 적이 없어, 사건 직전 기록이 잘린 채 보존되고 그 사실도 모른다',
  },
  {
    key: '3-6',
    title: '복구 시점 산출 — T-ε 과 보존 창',
    since: '2026-10-09',
    cited: true,
    skipped: 'ε 의 근거를 고르는 연습이 없어 복구일에 눈대중으로 정한다(손상을 복구로 고정한다)',
  },
  {
    key: '3-7',
    title: '유실 구간 확정 — 8단계의 고지와 §6 표 기록',
    since: '2026-10-10',
    cited: true,
    skipped: '구간을 산출해 본 적이 없어 되돌릴 수 없는 고지를 사람 기억으로 적는다',
  },
  {
    key: '3-8',
    title: '보안 상태 재적용 — 복구는 대응 조치까지 되돌린다',
    since: '2026-10-12',
    cited: true,
    skipped: '세션 폐기를 실제로 해 본 적이 없어, 되살아난 접근 수단이 통하는지 모른 채 차단을 푼다',
  },
  {
    key: '3-9',
    title: '외부 상태 대조 — 복구는 제공자 쪽을 되돌리지 못한다',
    since: '2026-10-15',
    cited: true,
    skipped: '제공자 콘솔에서 구간 목록을 받아낼 수 있는지 모른 채, 플랜이 어긋난 조직을 방치한다',
  },
  {
    key: '3-10',
    title: '유실 고지 — 이 절차에서 유일하게 되돌릴 수 없는 산출물',
    since: '2026-10-19',
    cited: true,
    skipped: '고지 근거(구간의 두 끝)를 만들어 본 적이 없어, 표지를 지운 뒤 고지 여부를 물을 대상이 없다',
  },
  {
    key: '3-11',
    title: '행 수 감소의 뜻 — 테이블마다 다르다',
    since: '2026-10-22',
    cited: true,
    skipped:
      '`short` 를 테이블 이름만 보고 「정상 삭제일 수 있다」로 넘겨, 앱이 지우지 않는 테이블(감사로그 = §3-5 조사 근거 자신)의 감소를 설명 없이 전환한다',
  },
  {
    key: '3-12',
    title: '기준 지문이 어느 국면의 기준인가 — 평상시 고정과 전환 이후의 구분',
    since: '2026-10-24',
    cited: true,
    skipped:
      '`phase: after_switch` 를 사건 신호로 믿는다 — 지문을 평상시 고정으로 남기는 운용(§3-4 가 권하는 쪽)에서는 그 값이 영구히 그대로여서, §5 0단계의 Promote 금지가 평상시에 늘 떠 있고 정작 사건 중에 아무것도 달라지지 않는다',
  },
  {
    key: '3-13',
    title: '기준치가 어느 배포의 설정인가 — 공급 스코프와 판정 스코프',
    since: '2026-10-24',
    cited: true,
    skipped:
      '기준치를 운영 스코프에만 넣어 둔 채 복구일을 맞는다 — 4단계가 `no_baseline` 에서 멈추고, 그때 가장 하기 쉬운 복구책이 §3-2 의 유일한 금기(복구일 재스냅샷)다. 사본을 두더라도 기한 키가 그 스코프에 없으면 낡음 판정이 보류돼 낡은 기준치가 그대로 `ok` 를 만든다',
  },
  {
    key: '3-14',
    title: '표지가 이번 사건의 것인가 — 귀속의 기준점과 옛 기록',
    since: '2026-10-25',
    cited: true,
    skipped:
      '표지를 지우지 않고 끝낸다 — 평상시 `stale_record` 경고는 degraded(200)라 아무도 보지 않고, 다음 사건에서 차단을 켜는 순간 `recorded` 로 뒤집혀 7단계 선행 조건이 몇 달 전 시각으로 통과한다(되살아난 세션·어긋난 플랜·미고지가 모두 「완료」로 보인다)',
  },
  {
    key: '3-15',
    title: '근거 보존을 수행했는가 — §3-5 의 수행 기록과 보존 범위',
    since: '2026-10-25',
    cited: true,
    skipped:
      '보존을 거른 채(또는 차단 전에 받은 채) 전환한다 — 어떤 검증도 실패하지 않는다. 전환 뒤에는 감사 이력이 「아무 일도 없었던 것처럼」 보이고, 6-1단계 2·3번은 대상을 추릴 출처 없이 시각만 적혀 `recorded`·`recordCorroborated: true` 로 7단계 문을 연다',
  },
  {
    key: '4-10',
    title: '복구 후 확인 순서',
    since: '2026-09-30',
    cited: true,
    skipped: '설정이 복구됐는지 눈으로만 확인하고 끝낸다(fail-safe 로 조용히 후퇴한 값은 보이지 않는다)',
  },
  {
    key: '4-12',
    title: '설정 복구 확인 — 이 절의 목록이 실제로 들어갔는지',
    since: '2026-10-15',
    cited: false,
    skipped: '§2 키 이름 스냅샷을 떠 본 적이 없어 복구일에 기준이 없다(`no_baseline` = 판정 불가)',
  },
  {
    key: '5-1',
    title: '롤백이 조용히 풀리는 두 경로 — 수단 선택과 확인',
    since: '2026-10-11',
    cited: true,
    skipped: 'AutoPush 가 롤백을 밀어내는 것을 겪어 보지 않아, 장애일에 20분짜리 롤백을 믿는다',
  },
  {
    key: '6-1',
    title: '리허설이 운영 배포에 걸리지 않게 — 선언과 확인',
    since: '2026-10-16',
    cited: true,
    skipped: '선언 없이 파괴적 단계를 돌려, 운영에 걸린 리허설이 「정상」으로 기록된다',
  },
  {
    key: '6-2',
    title: '리허설이 어느 절차를 검증했는가 — 범위 기록',
    since: '2026-10-19',
    cited: true,
    skipped: '범위를 적지 않아 다음 리허설까지 「무엇이 검증됐는가」를 아무도 알 수 없다',
  },
  {
    key: '6-3',
    title: '리허설이 무엇을 보고 판정하는가 — 인용의 대조',
    since: '2026-10-19',
    cited: true,
    skipped: '체크리스트의 인용이 가리킬 곳을 잃은 채로 리허설이 돌아, `undefined` 를 「문제 없음」으로 읽는다',
  },
  {
    key: '6-4',
    title: '리허설 기록이 어디에 남아 있는가 — 표와 env 의 대조',
    since: '2026-10-20',
    cited: true,
    skipped: '표와 env 가 다른 말을 하는 채로 두어, 복구·롤백으로 판정 쪽 기록이 사라진 것을 아무도 되찾지 않는다',
  },
  {
    key: '6-5',
    title: '리허설이 무엇을 통과했는가 — 미통과 단위의 귀속',
    since: '2026-10-21',
    cited: true,
    skipped: '「부분 통과」가 어느 단위에서 났는지 적지 않아, 범위 판정은 `ok`(전 단위 검증)인데 재수행 대상은 산출되지 않는다 — 같은 단위를 또 건너뛰어도 신호가 없다',
  },
  {
    key: '6-6',
    title: '그 기록이 연습인가 사건인가 — 유형의 구분',
    since: '2026-10-21',
    cited: true,
    skipped: '유형을 적지 않아 사건 복구가 리허설 기한을 리셋하고(정기 리허설 없이도 `ok` 가 유지된다), 리허설 중에 잰 구간이 §1 약속의 실측으로 기록된다',
  },
  {
    key: '6-7',
    title: '무엇으로 복구했는가 — 복구 대상 시점·유실 구간의 영구 기록',
    since: '2026-10-22',
    cited: true,
    skipped:
      '구간의 두 끝을 표로 옮겨 적지 않은 채 표지를 지워, 유실 구간과 고지 수치를 되찾을 수 없게 된다(§1 RPO 대조는 영구히 `unjudged` 다)',
  },
  {
    key: '6-8',
    title: '그 행이 무엇의 기록인가 — 리허설·사건·월 점검의 구분',
    since: '2026-10-23',
    cited: true,
    skipped:
      '§2 월 점검 행을 `정기` 로 적어(어휘에 `점검` 이 없으면 그렇게 된다) 리허설 기한이 매월 리셋되고, 몇 분짜리 점검 소요시간이 §1 RTO 의 `met` 근거가 된다',
  },
  {
    key: '6-9',
    title: '체크리스트의 칸 상태는 누구의 것인가 — 판본과 수행 기록',
    since: '2026-10-23',
    cited: true,
    skipped:
      '체크한 칸이 저장소 판본에 그대로 남아, 다음 리허설·**다음 사건 복구**가 그 체크를 「이미 했다」로 물려받는다(칸에는 일자·유형이 없어 어느 수행의 것인지도 말하지 못한다)',
  },
];

/**
 * 번호 소절이지만 **리허설 단위가 아닌** 것 — 환경변수 묶음 목록이다.
 * 예외를 코드 밖에 두지 않고 이유와 함께 적어 둔다(`auditSectionCoverage` 가 이 목록만 눈감아 준다).
 */
export interface NonProcedureSection {
  key: string;
  why: string;
}

export const NON_PROCEDURE_SECTIONS: readonly NonProcedureSection[] = [
  { key: '4-1', why: '필수 env 묶음 목록 — 수행할 단계가 아니다(복구 확인은 §4-10·§4-12 가 본다)' },
  { key: '4-2', why: '관측 env 묶음 목록' },
  { key: '4-3', why: '결제 env 묶음 목록(기본 OFF)' },
  { key: '4-4', why: '요금제·엔타이틀먼트 env 묶음 목록' },
  { key: '4-5', why: '법적 문서 env 묶음 목록' },
  { key: '4-6', why: '파트너 채널 env 묶음 목록(기본 OFF)' },
  { key: '4-7', why: '복구 리허설 env 묶음 목록 — 의미는 §6 표가 말한다' },
  { key: '4-8', why: '메일·첨부 저장소·감사 보존 env 묶음 목록(기본 미연동)' },
  { key: '4-9', why: '사이트·포털 env 묶음 목록' },
  { key: '4-11', why: '배포 롤백 고정 키 설명 — 수행 단위는 §5-1 이다' },
];

/** 모르는 키는 null — 지어내지 않는다 */
export function unitFor(key: unknown): ProcedureUnit | null {
  const k = String(key ?? '').trim();
  return PROCEDURE_UNITS.find((u) => u.key === k) ?? null;
}

/** 체크리스트가 이름으로 인용하지 않는 단위 — 리허설에서 **이름으로 찾을 수 없다** */
export function uncitedUnits(units: readonly ProcedureUnit[] = PROCEDURE_UNITS): string[] {
  return units.filter((u) => !u.cited).map((u) => u.key);
}

/* ───────────────────────────── 절차 개정 ───────────────────────────── */

export interface ProcedureRevision {
  /** 단위 키·들어온 날의 지문(요약 표지. 판정은 단위 목록으로 한다) */
  rev: string;
  unitCount: number;
  /** 가장 최근에 절차에 들어온 날 — 없으면 null */
  latestSince: string | null;
}

/**
 * 절차 개정 지문. 단위 **키와 `since`** 만으로 만든다 — 제목·설명 문구를 다듬어도 바뀌지 않게
 * 하되, 단위가 늘거나 날짜가 정정되면 바뀐다. 역산할 것이 없다(공개해도 되는 값이다).
 */
export function procedureRevision(units: readonly ProcedureUnit[] = PROCEDURE_UNITS): ProcedureRevision {
  const keys = [...units].map((u) => `${u.key}@${u.since}`).sort();
  const dates = units.map((u) => u.since).filter((d) => parseRehearsalDate(d)).sort();
  return {
    rev: createHash('sha256').update(`${REVISION_DOMAIN}|${keys.join(',')}`).digest('hex').slice(0, REVISION_LEN),
    unitCount: units.length,
    latestSince: dates.length ? dates[dates.length - 1] : null,
  };
}

/** 리허설 일자 **뒤에** 절차에 들어온 단위 — 범위 기록이 없어도 산출된다 */
export function addedSince(
  lastRehearsal: string | null,
  units: readonly ProcedureUnit[] = PROCEDURE_UNITS,
): string[] {
  if (!lastRehearsal) return [];
  return units.filter((u) => u.since > lastRehearsal).map((u) => u.key);
}

/* ───────────────────────────── 범위 기록 ───────────────────────────── */

export interface CoverageRecord {
  /** 범위를 적은 날(YYYY-MM-DD). 없으면 null — **지어내지 않는다** */
  asOf: string | null;
  /** 적혀 있던 개정 지문(참고용). 없으면 null */
  rev: string | null;
  /** 수행했다고 적힌 단위 키 */
  units: string[];
  /** 해석하지 못한 토큰 — 숨기지 않는다 */
  invalid: string[];
}

const UNIT_TOKEN = /^\d{1,2}-\d{1,2}$/;

/**
 * 범위 기록 판독. 두 형식만 받는다 —
 *   `asOf=2026-10-19;rev=abcdef012345;units=1-1,2-1,3-2`
 *   `{"asOf":"2026-10-19","rev":"abcdef012345","units":["1-1"]}`
 * 사람 이름·비고는 받지 않는다(공개 엔드포인트에 나가는 값이다). 해석 못 한 토큰은 `invalid` 로
 * 돌려주고 **단위로 채택하지 않는다** — 일부만 읽으면 어느 단위를 덮었는지 알 수 없다.
 */
export function parseCoverageRecord(raw: unknown): CoverageRecord | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;

  const out: CoverageRecord = { asOf: null, rev: null, units: [], invalid: [] };
  const units = new Set<string>();

  const take = (key: string, value: string) => {
    const v = value.trim();
    if (key === 'asof') {
      const d = parseRehearsalDate(v);
      if (d) out.asOf = d;
      else out.invalid.push(`asOf=${v.slice(0, 20)}`);
      return;
    }
    if (key === 'rev') {
      if (new RegExp(`^[0-9a-f]{${REVISION_LEN}}$`).test(v)) out.rev = v;
      else out.invalid.push(`rev=${v.slice(0, 20)}`);
      return;
    }
    if (key === 'units') {
      for (const t of v.split(/[,\s]+/).filter(Boolean)) {
        if (UNIT_TOKEN.test(t)) units.add(t);
        else out.invalid.push(t.slice(0, 20));
      }
      return;
    }
    out.invalid.push(`${key.slice(0, 20)}=…`);
  };

  if (s.startsWith('{') || s.startsWith('[')) {
    let obj: unknown;
    try {
      obj = JSON.parse(s);
    } catch {
      return { asOf: null, rev: null, units: [], invalid: ['json'] };
    }
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
      return { asOf: null, rev: null, units: [], invalid: ['json'] };
    }
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (Array.isArray(v)) take(k.toLowerCase(), v.map((x) => String(x)).join(','));
      else take(k.toLowerCase(), String(v ?? ''));
    }
  } else {
    for (const seg of s.split(/[;\n]+/).map((x) => x.trim()).filter(Boolean)) {
      const eq = seg.indexOf('=');
      if (eq <= 0) {
        out.invalid.push(seg.slice(0, 20));
        continue;
      }
      take(seg.slice(0, eq).trim().toLowerCase(), seg.slice(eq + 1));
    }
  }

  out.units = [...units].sort();
  return out;
}

/**
 * **지금의 전 단위**로 범위 한 줄을 만든다(§6-2 명령이 출력한다).
 *
 * 이 줄은 「전 단위를 수행했다」는 **선언**이다 — 건너뛴 단위는 손으로 지운다.
 * 그렇게 지우는 것이 이 기록의 쓸모다(지우지 않으면 §6 표의 `정상` 과 같은 값이 된다).
 * `parseCoverageRecord` 로 되읽을 수 있어야 한다(왕복 테스트가 고정한다).
 */
export function coverageLine(
  now: Date = new Date(),
  units: readonly ProcedureUnit[] = PROCEDURE_UNITS,
): string {
  const t = now.getTime();
  const asOf = Number.isNaN(t) ? null : new Date(t).toISOString().slice(0, 10);
  const r = procedureRevision(units);
  const keys = [...units].map((u) => u.key).sort();
  return `${asOf ? `asOf=${asOf};` : ''}rev=${r.rev};units=${keys.join(',')}`;
}

/* ─────────────────────────── 어긋남의 세 방향 ─────────────────────────── */

export interface CoverageDrift {
  key: string;
  when: string;
  effect: string;
  /** 누가 알아채는가 */
  noticedBy: string;
  fix: string;
}

export const COVERAGE_DRIFTS: readonly CoverageDrift[] = [
  {
    key: 'procedure_outruns_rehearsal',
    when: '절차에 소절·기록 키가 추가되는데 리허설은 주기(수개월)대로만 돈다',
    effect: '추가된 단위는 **한 번도 수행되지 않은 채** 복구일에 처음 밟힌다',
    noticedBy:
      '**아무도** — `checks.recovery` 는 일자와 결과만 보므로 `ok` 가 유지되고, 기한 판정은 시간만 보기 때문에 ' +
      '절차 변경으로 앞당겨지지 않는다(장치가 좋아질수록 근거가 낡는 방향이다)',
    fix: `리허설 때 \`${COVERAGE_ENV}\` 에 수행 범위를 적어 두면 추가된 단위가 \`uncovered\` 로 남는다(§6-2)`,
  },
  {
    key: 'scope_stamped_later',
    when: '리허설을 마친 **뒤에** 범위 한 줄을 다시 떠서 넣는다',
    effect: '그 사이에 들어온 단위까지 「수행했다」로 덮인다 — 기록이 리허설보다 넓어진다',
    noticedBy: '아무도 — 날짜가 새것이라 기한 판정에도 걸리지 않는다(`scope_after_rehearsal` 로 드러낸다)',
    fix: '범위는 **리허설 당일** 산출해 넣는다. 일자(`RECOVERY_LAST_REHEARSAL`)와 같은 날이어야 한다',
  },
  {
    key: 'unit_removed',
    when: '절차에서 소절이 사라지거나 번호가 바뀌는데 범위 기록에는 옛 키가 남는다',
    effect: '기록이 **없는 절차**를 덮고 있다고 말한다',
    noticedBy: '`unknownUnits` 로 따로 보고한다 — **유실로 단정하지 않는다**(의도적 삭제일 수 있다)',
    fix: '정본(`PROCEDURE_UNITS`)과 범위 기록을 함께 고친다. 소절 삭제는 `auditUnitSections` 가 CI 로 잡는다',
  },
];

/* ──────────────────────── 보장하지 못하는 것 ──────────────────────── */

export const CAVEAT_SCOPE_IS_A_CLAIM =
  '범위 기록은 「그 단위를 **수행했다고 적었다**」는 뜻이다 — 수행 내용·통과 여부는 검증하지 않는다(결과는 §6 표와 `RECOVERY_LAST_REHEARSAL_RESULT` 가 말한다)';

export const COVERAGE_LIMITS: readonly string[] = [
  CAVEAT_SCOPE_IS_A_CLAIM,
  '단위는 **소절**이고 그 안의 모든 체크리스트 항목이 수행됐다는 뜻은 아니다 — 한 단위가 들고 있는 항목 수는 §6-9 `unitItemLoad` 가 세고, 그중 몇을 했는지는 어느 기록도 말하지 않는다',
  '§3 **1~8단계 본 절차**는 단위로 세지 않는다 — 이 판정이 말하는 것은 그 뒤에 덧붙은 소절들이 범위에 들어 있는가다',
  '체크리스트가 번호로 인용하지 않는 단위(`uncited`)는 리허설에서 **이름으로 찾을 수 없다** — 수행 여부를 사람이 판단해야 한다',
  '`since` 는 사람이 적은 날짜다 — 소절이 **존재하는지**만 CI 가 대조하고, 그 날짜가 맞는지는 코드가 알 수 없다',
  '`rev` 는 요약 표지일 뿐이다 — 판정은 **단위 목록**으로 하고, 제목 수정·날짜 정정으로도 `rev` 는 바뀐다',
  '§4 환경변수 묶음(§4-1~4-9·4-11)은 단위가 아니다 — 리허설로 수행할 대상이 아니기 때문이고, 그 예외는 `NON_PROCEDURE_SECTIONS` 에 이유와 함께 적어 둔다',
  '이 배포의 env 만 본다 — 다른 배포에서 수행한 리허설은 여기서 보이지 않는다',
];

/* ───────────────────────────── 판정 ───────────────────────────── */

export const COVERAGE_VERDICTS = [
  'no_rehearsal',
  'unrecorded',
  'invalid_record',
  'procedure_changed',
  'undated',
  'scope_after_rehearsal',
  'ok',
] as const;
export type CoverageVerdict = (typeof COVERAGE_VERDICTS)[number];

export const ACTION_NO_REHEARSAL =
  '리허설 기록이 없다 — 범위 판정은 보류한다(미실시는 `checks.recovery` 가 말한다). 1회 수행하고 §6 표·일자·**범위**를 함께 적는다(§6-2)';
export const ACTION_UNRECORDED =
  `리허설 일자는 있는데 **무엇을 검증했는지 기록이 없다** — 통과가 아니라 **판정을 못 한 것**이다. ` +
  `다음 리허설에서 §6-2 명령으로 범위 한 줄을 산출해 \`${COVERAGE_ENV}\` 에 넣는다(건너뛴 단위는 지운다)`;
export const ACTION_INVALID_RECORD =
  `\`${COVERAGE_ENV}\` 를 읽을 수 없다 — §6-2 명령 출력 형식(\`asOf=…;rev=…;units=1-1,2-1\`)으로 다시 적는다. 사람 이름·비고는 넣지 않는다`;
export const ACTION_PROCEDURE_CHANGED =
  '마지막 리허설 범위에 **없는 절차 단위**가 있다 — 그 단위는 복구일에 처음 밟는다. 해당 소절만 따로 리허설하고 범위를 갱신한다(§6-2)';
export const ACTION_UNDATED =
  `\`${COVERAGE_ENV}\` 에 \`asOf\` 가 없다 — **언제 기준 범위인지** 알 수 없다. 리허설 당일 날짜를 함께 적는다`;
export const ACTION_SCOPE_AFTER_REHEARSAL =
  '범위를 적은 날이 리허설 일자보다 **뒤**다 — 그 사이에 들어온 단위까지 수행했다고 덮일 수 있다. 리허설 당일 산출한 범위로 다시 적는다(§6-2)';
export const ACTION_OK = '마지막 리허설이 현재 절차 단위를 모두 덮고 있다 — 다음 리허설에서도 범위를 함께 갱신한다';

export interface CoverageAssessment {
  verdict: CoverageVerdict;
  /** 기록 키(값은 담지 않는다) */
  env: string;
  /** 리허설 일자(없으면 null) */
  lastRehearsal: string | null;
  /** 범위를 적은 날(없으면 null) */
  recordedAsOf: string | null;
  /** 적혀 있던 개정 지문(참고용) */
  recordedRev: string | null;
  /** 지금의 개정 지문 */
  currentRev: string;
  revMatches: boolean;
  unitCount: number;
  coveredCount: number;
  /** 범위에 없는 단위 키 — 기록이 있을 때만 산출된다 */
  uncovered: string[];
  /** 리허설 **뒤에** 절차에 들어온 단위 키 — 기록이 없어도 산출된다 */
  addedSinceRehearsal: string[];
  /** 정본에 없는 키가 기록에 있다 — 유실로 단정하지 않는다 */
  unknownUnits: string[];
  /** 판독하지 못한 토큰 */
  invalid: string[];
  /** 가장 최근에 절차에 들어온 날 */
  latestSince: string | null;
  /** 리허설 일자와 그 날 사이의 일수(둘 다 있고 절차가 더 새로울 때만) */
  behindDays: number | null;
  action: string;
  caveats: readonly string[];
}

function dayIndex(iso: string): number {
  return Math.floor(new Date(`${iso}T00:00:00Z`).getTime() / MS_DAY);
}

function isoOf(now: Date): string | null {
  const t = now.getTime();
  return Number.isNaN(t) ? null : new Date(t).toISOString().slice(0, 10);
}

/**
 * 범위 판정.
 *
 * 판정 순서 — **리허설 자체가 없으면 보류**(중복 보고 금지) → 기록 없음 → 판독 불가 →
 * **미검증 단위**(실제로 수행되지 않은 것이 기록 자격보다 먼저다) → 날짜 없음 → 순서 역전.
 */
export function assessCoverage(args?: {
  env?: Record<string, string | undefined>;
  units?: readonly ProcedureUnit[];
  now?: Date;
}): CoverageAssessment {
  const env = args?.env ?? process.env;
  const units = args?.units ?? PROCEDURE_UNITS;
  const today = isoOf(args?.now ?? new Date());
  const rev = procedureRevision(units);
  const lastRehearsal = parseRehearsalDate(env[LAST_REHEARSAL_ENV]);
  const record = parseCoverageRecord(env[COVERAGE_ENV]);
  const added = addedSince(lastRehearsal, units);

  const known = new Set(units.map((u) => u.key));
  const recorded = record ? record.units : [];
  const unknownUnits = recorded.filter((k) => !known.has(k)).sort();
  const covered = recorded.filter((k) => known.has(k));
  const uncovered = record ? units.filter((u) => !covered.includes(u.key)).map((u) => u.key) : [];

  const behindDays =
    lastRehearsal && rev.latestSince && rev.latestSince > lastRehearsal
      ? Math.max(0, dayIndex(rev.latestSince) - dayIndex(lastRehearsal))
      : null;

  const base = {
    env: COVERAGE_ENV,
    lastRehearsal,
    recordedAsOf: record?.asOf ?? null,
    recordedRev: record?.rev ?? null,
    currentRev: rev.rev,
    revMatches: Boolean(record?.rev && record.rev === rev.rev),
    unitCount: units.length,
    coveredCount: covered.length,
    uncovered,
    addedSinceRehearsal: added,
    unknownUnits,
    invalid: record?.invalid ?? [],
    latestSince: rev.latestSince,
    behindDays,
    caveats: COVERAGE_LIMITS,
  };

  // 리허설이 없으면 범위를 물을 대상이 없다 — `checks.recovery` 가 이미 `missing` 으로 말한다.
  if (!lastRehearsal) return { ...base, verdict: 'no_rehearsal', action: ACTION_NO_REHEARSAL };
  if (!record) return { ...base, verdict: 'unrecorded', action: ACTION_UNRECORDED };
  // 판독 못 한 토큰이 있거나 단위를 하나도 못 읽었거나, **미래 일자**로 적혀 있으면 채택하지
  // 않는다 — 미래 날짜는 수행 기록이 아니다(§6 표 무결성 점검과 같은 규율).
  if (record.invalid.length > 0 || covered.length === 0 || (record.asOf && today && record.asOf > today)) {
    return { ...base, verdict: 'invalid_record', action: ACTION_INVALID_RECORD };
  }
  // 실제로 수행되지 않은 단위가 기록 자격 문제보다 먼저다(고칠 대상이 다르다).
  if (uncovered.length > 0) return { ...base, verdict: 'procedure_changed', action: ACTION_PROCEDURE_CHANGED };
  if (!record.asOf) return { ...base, verdict: 'undated', action: ACTION_UNDATED };
  if (record.asOf > lastRehearsal) {
    return { ...base, verdict: 'scope_after_rehearsal', action: ACTION_SCOPE_AFTER_REHEARSAL };
  }
  return { ...base, verdict: 'ok', action: ACTION_OK };
}

/* ───────────────────────── 출력(사람·로그) ───────────────────────── */

export interface CoveragePlan {
  coverage: CoverageAssessment;
  units: readonly ProcedureUnit[];
  drifts: readonly CoverageDrift[];
  limits: readonly string[];
  runbook: string;
}

export function coveragePlanFor(args?: {
  env?: Record<string, string | undefined>;
  units?: readonly ProcedureUnit[];
  now?: Date;
}): CoveragePlan {
  return {
    coverage: assessCoverage(args),
    units: args?.units ?? PROCEDURE_UNITS,
    drifts: COVERAGE_DRIFTS,
    limits: COVERAGE_LIMITS,
    runbook: COVERAGE_RUNBOOK_REF,
  };
}

/** 사람이 읽는 요약(§6-2 의 1줄 명령이 출력하는 것) */
export function coverageText(plan: CoveragePlan): string {
  const c = plan.coverage;
  const lines = [
    `[${c.verdict}] 리허설=${c.lastRehearsal ?? '미실시'} · 범위기준일=${c.recordedAsOf ?? '없음'} · ` +
      `단위 ${c.coveredCount}/${c.unitCount} · 개정=${c.currentRev}${c.recordedRev ? `(기록 ${c.recordedRev})` : ''}`,
    `→ ${c.action}`,
    c.uncovered.length ? `· 범위에 없는 단위: ${c.uncovered.join(', ')}` : '· 범위에 없는 단위 없음',
    c.addedSinceRehearsal.length
      ? `· 리허설 뒤에 들어온 단위: ${c.addedSinceRehearsal.join(', ')}${c.behindDays !== null ? ` (최근 변경까지 ${c.behindDays}일)` : ''}`
      : '· 리허설 뒤에 들어온 단위 없음',
    c.unknownUnits.length ? `· 정본에 없는 키: ${c.unknownUnits.join(', ')}` : '· 정본에 없는 키 없음',
  ];
  const uncited = uncitedUnits(plan.units);
  if (uncited.length) lines.push(`· 체크리스트가 번호로 인용하지 않는 단위: ${uncited.join(', ')}`);
  for (const u of plan.units) lines.push(`· ${u.key}(${u.since}) ${u.title} — 거르면: ${u.skipped}`);
  for (const d of plan.drifts) lines.push(`· ${d.key}: ${d.effect} / 알아채는 쪽: ${d.noticedBy}`);
  for (const l of plan.limits) lines.push(`※ ${l}`);
  return lines.join('\n');
}

/** 로그 한 줄. 판정·단위 키·개수뿐 — 사람 이름·비고는 담지 않는다 */
export function coverageLogLine(plan: CoveragePlan): string {
  const c = plan.coverage;
  return [
    '[rehearsalCoverage]',
    `verdict=${c.verdict}`,
    `last=${c.lastRehearsal ?? '-'}`,
    `asOf=${c.recordedAsOf ?? '-'}`,
    `covered=${c.coveredCount}/${c.unitCount}`,
    `uncovered=${c.uncovered.length ? c.uncovered.join('|') : '-'}`,
    `added=${c.addedSinceRehearsal.length ? c.addedSinceRehearsal.join('|') : '-'}`,
    `rev=${c.currentRev}`,
  ].join(' ');
}

/* ───────────────────────── /api/health 체크 ───────────────────────── */

const VERDICT_NOTE: Record<CoverageVerdict, string> = {
  no_rehearsal: '리허설 기록이 없어 범위 판정을 보류한다 — 미실시는 `checks.recovery` 가 말한다(중복 보고 금지)',
  unrecorded:
    '리허설 일자는 있는데 **수행 범위가 기록되지 않았다** — 통과가 아니라 판정 불가다(절차는 그 뒤에도 바뀐다)',
  invalid_record: '범위 기록을 읽을 수 없다 — 일부만 읽으면 어느 단위를 덮었는지 알 수 없으므로 채택하지 않는다',
  procedure_changed:
    '마지막 리허설 범위에 **없는 절차 단위가 있다** — 그 단위는 복구일에 처음 밟는다(기한 판정으로는 드러나지 않는다)',
  undated: '범위 기록이 **언제 기준인지** 알 수 없다 — 그 뒤의 절차 변경을 덮고 있는지 말할 수 없다',
  scope_after_rehearsal:
    '범위를 적은 날이 리허설보다 **뒤**다 — 수행하지 않은 단위가 덮였을 수 있다(날짜가 새것이라 기한에도 걸리지 않는다)',
  ok: '마지막 리허설이 현재 절차 단위를 모두 덮고 있다',
};

/**
 * 리허설이 **어느 절차를 검증했는가**를 공개 헬스체크에 드러낸다.
 *
 * `checks.recovery` 는 일자·결과만 보므로 절차가 리허설보다 앞서 나가도 `ok` 를 유지한다 —
 * 그 축을 여기서 분리해 본다. **required: false** 라 어느 경우에도 503 이 되지 않는다
 * (리허설 범위로 서비스를 내리면 복구 자신이 막힌다). 리허설 기록이 아예 없으면
 * `no_rehearsal` 로 **ok** 를 돌려준다 — 미실시는 `checks.recovery` 가 이미 degraded 로 말한다.
 * 담은 것은 단위 키(소절 번호)·판정·날짜·개수뿐이다 — 담당자·비고·설정값은 담지 않는다.
 */
export function rehearsalCoverageCheck(args?: {
  env?: Record<string, string | undefined>;
  now?: Date;
}): { ok: boolean; required: false; detail: Record<string, unknown> } {
  const c = assessCoverage(args);
  return {
    ok: c.verdict === 'ok' || c.verdict === 'no_rehearsal',
    required: false,
    detail: {
      verdict: c.verdict,
      scopeEnv: COVERAGE_ENV,
      lastRehearsal: c.lastRehearsal,
      recordedAsOf: c.recordedAsOf,
      currentRev: c.currentRev,
      recordedRev: c.recordedRev,
      revMatches: c.revMatches,
      unitCount: c.unitCount,
      coveredCount: c.coveredCount,
      uncovered: c.uncovered,
      addedSinceRehearsal: c.addedSinceRehearsal,
      unknownUnits: c.unknownUnits,
      uncited: uncitedUnits(),
      latestSince: c.latestSince,
      behindDays: c.behindDays,
      drifts: COVERAGE_DRIFTS.map((d) => d.key),
      action: c.action,
      runbook: COVERAGE_RUNBOOK_REF,
      limits: COVERAGE_LIMITS,
      note: VERDICT_NOTE[c.verdict],
    },
  };
}

/** 배선 상태 요약(문서·보고용) */
export function rehearsalCoverageStatus(env: Record<string, string | undefined> = process.env): {
  verdict: CoverageVerdict;
  units: number;
  uncovered: number;
  uncited: number;
  rev: string;
  note: string;
} {
  const c = assessCoverage({ env });
  return {
    verdict: c.verdict,
    units: c.unitCount,
    uncovered: c.uncovered.length,
    uncited: uncitedUnits().length,
    rev: c.currentRev,
    note: VERDICT_NOTE[c.verdict],
  };
}

/* ───────────────────────────── 정적 점검 ───────────────────────────── */

/** RUNBOOK 에서 번호 붙은 소절 키를 뽑는다(`### 3-5.` · `#### 4-10.`). 못 찾으면 빈 배열 */
export function runbookSectionKeys(src: unknown): string[] {
  const s = String(src ?? '');
  return [...s.matchAll(/^#{3,4}\s*(\d{1,2}-\d{1,2})\.\s/gm)].map((m) => m[1]);
}

/**
 * 정본 단위가 **실제 소절로 존재하는지**. 소절이 사라지거나 번호가 바뀌면 범위 기록이
 * 없는 절차를 덮고 있다고 말하게 되는데, 응답은 그대로 돈다.
 */
export function auditUnitSections(runbookSrc: unknown, units: readonly ProcedureUnit[] = PROCEDURE_UNITS): string[] {
  const keys = new Set(runbookSectionKeys(runbookSrc));
  const problems: string[] = [];
  if (keys.size === 0) return ['RUNBOOK 에서 번호 붙은 소절을 하나도 찾지 못했다 — 제목 모양이 바뀌었으면 이 가드를 함께 볼 것'];
  for (const u of units) {
    if (!keys.has(u.key)) problems.push(`단위 ${u.key} 에 해당하는 소절이 RUNBOOK 에 없다 — 범위 기록이 가리킬 곳을 잃었다`);
    if (!parseRehearsalDate(u.since)) problems.push(`단위 ${u.key} 의 since 가 YYYY-MM-DD 가 아니다: ${u.since}`);
    if (!u.title.trim() || !u.skipped.trim()) problems.push(`단위 ${u.key} 의 제목·거른 결과 설명이 비었다`);
  }
  return problems;
}

/**
 * **반대 방향** — RUNBOOK 의 번호 소절이 전부 정본에 등록돼 있는지.
 *
 * 이것이 이 장치의 핵심이다: 다음 배치가 소절을 추가하면 CI 가 정본 등록을 요구하고,
 * 등록되는 순간 기존 범위 기록이 `procedure_changed` 로 떨어진다(= 「그 단위는 아직 리허설되지
 * 않았다」). 등록하지 않으면 **절차는 자라는데 범위 판정은 그대로 `ok`** 가 되는데, 응답은
 * 그대로 200 이라 사람 눈으로는 알아챌 수 없다.
 */
export function auditSectionCoverage(
  runbookSrc: unknown,
  units: readonly ProcedureUnit[] = PROCEDURE_UNITS,
  exempt: readonly NonProcedureSection[] = NON_PROCEDURE_SECTIONS,
): string[] {
  const declared = new Set(units.map((u) => u.key));
  const skipped = new Set(exempt.map((e) => e.key));
  const problems: string[] = [];
  for (const e of exempt) {
    if (!e.why.trim()) problems.push(`예외 소절 ${e.key} 에 이유가 없다`);
    if (declared.has(e.key)) problems.push(`소절 ${e.key} 가 단위와 예외에 **둘 다** 있다`);
  }
  for (const key of new Set(runbookSectionKeys(runbookSrc))) {
    if (declared.has(key) || skipped.has(key)) continue;
    problems.push(
      `RUNBOOK 소절 ${key} 가 정본에 없다 — 리허설 단위로 등록하거나 NON_PROCEDURE_SECTIONS 에 이유와 함께 적을 것` +
        '(등록하지 않으면 절차는 자라는데 범위 판정은 그대로 ok 가 된다)',
    );
  }
  return problems;
}

/**
 * 각 단위의 `cited` 선언이 **실제 체크리스트와 맞는지**.
 *
 * 인용 탐지는 소절 번호를 숫자 경계로 찾고, 「§3 6-1단계」처럼 **단계**를 가리키는 표기는
 * 소절 인용으로 세지 않는다(그렇게 세면 §6-1 이 늘 인용된 것으로 보인다).
 */
export function auditChecklistCitations(runbookSrc: unknown, units: readonly ProcedureUnit[] = PROCEDURE_UNITS): string[] {
  const s = String(runbookSrc ?? '');
  const at = s.search(/^###\s*리허설 체크리스트/m);
  if (at < 0) return ['RUNBOOK 에서 리허설 체크리스트를 찾을 수 없다'];
  const checklist = s.slice(at);
  const problems: string[] = [];
  for (const u of units) {
    const cited = new RegExp(`(?<!\\d)${u.key.replace('-', '\\-')}(?!\\d|단계)`).test(checklist);
    if (cited !== u.cited) {
      problems.push(
        cited
          ? `단위 ${u.key} 는 체크리스트가 인용하는데 정본에 cited: false 로 적혀 있다`
          : `단위 ${u.key} 를 체크리스트가 인용하지 않는데 정본에 cited: true 로 적혀 있다 — 리허설에서 이름으로 찾을 수 없다`,
      );
    }
  }
  return problems;
}

/**
 * 리허설 일자의 **정본 위치**가 그대로인지(`lib/recovery.ts`).
 * 그 키가 다른 모듈로 옮겨 가면 이 판정은 일자를 못 읽어 `no_rehearsal`(= 판정 보류)을
 * 영구히 내면서 조용해진다 — 응답은 그대로 돈다.
 */
export function auditFreshnessSource(recoverySrc: unknown): string[] {
  const s = String(recoverySrc ?? '');
  const problems: string[] = [];
  if (!s.includes(LAST_REHEARSAL_ENV)) {
    problems.push(`lib/recovery.ts 가 ${LAST_REHEARSAL_ENV} 를 더 이상 읽지 않는다 — 범위 판정의 날짜 축이 사라졌다`);
  }
  if (!/rehearsalFreshness/.test(s)) problems.push('lib/recovery.ts 에 rehearsalFreshness 가 없다 — 이 모듈이 분리한 축의 상대가 사라졌다');
  // 신선도가 범위를 함께 보기 시작했다면 이 모듈과 중복된다 — 그때는 둘을 합칠 것.
  if (s.includes(COVERAGE_ENV)) {
    problems.push(`lib/recovery.ts 가 ${COVERAGE_ENV} 를 읽는다 — 범위 판정이 두 곳에 생겼다(중복 보고가 된다)`);
  }
  return problems;
}

/**
 * 기록 키가 레지스트리에 있고 **임시 키 목록에는 없는지**.
 * 임시 키로 넣으면 §2 키 이름 스냅샷 대조에서 빠져(평상시 미설정이 정상인 키로 취급된다)
 * 복구 때 이 기록이 유실된 사실이 드러나지 않는다 — 리허설 근거는 **영구 기록**이다.
 */
export function auditRegistrySources(
  vars: readonly { key: string }[] = ENV_VARS,
  transient: readonly string[] = TRANSIENT_KEYS,
): string[] {
  const known = new Set(vars.map((v) => v.key));
  const problems: string[] = [];
  for (const key of [COVERAGE_ENV, LAST_REHEARSAL_ENV]) {
    if (!known.has(key)) problems.push(`${key} 가 레지스트리에 없다`);
  }
  if (transient.includes(COVERAGE_ENV)) {
    problems.push(`${COVERAGE_ENV} 가 임시 키 목록에 있다 — 리허설 근거는 평상시에도 남아 있어야 하는 영구 기록이다`);
  }
  return problems;
}

/** 공백만 들어 있는 기록을 「있다」로 보지 않는지 — 대시보드에는 넣어 둔 것으로 보인다 */
export function recordPresence(env: Record<string, string | undefined> = process.env): 'set' | 'blank' | 'absent' {
  return presenceOf(env, COVERAGE_ENV);
}

/**
 * 실제 `RUNBOOK.md` 점검 — §6 가 **범위를 기록하는 절차**로 남아 있는지.
 * §6-2·범위 키·체크리스트의 범위 항목이 사라지면 CI 를 실패시킨다.
 */
export function auditRunbookCoverage(src: unknown): string[] {
  const s = String(src ?? '');
  const problems: string[] = [];
  if (!/^###\s*6-2\./m.test(s)) problems.push('§6-2 절이 사라졌다 — 리허설 범위를 적는 절차의 유일한 자리다');
  if (!s.includes(COVERAGE_ENV)) problems.push(`RUNBOOK 에 범위 기록 키 ${COVERAGE_ENV} 가 없다`);
  if (!/checks\.rehearsalCoverage/.test(s)) problems.push('RUNBOOK 에 checks.rehearsalCoverage 확인 지시가 없다');
  if (!/procedure_changed/.test(s)) problems.push('§6-2 에 procedure_changed 판정이 없다 — 절차가 앞서 나간 상태를 적어 둔 자리다');
  for (const d of COVERAGE_DRIFTS) {
    if (!s.includes(d.key)) problems.push(`§6-2 에 어긋남 방향 ${d.key} 가 없다`);
  }
  const at = s.search(/^###\s*리허설 체크리스트/m);
  if (at < 0) {
    problems.push('§6 에 리허설 체크리스트가 없다');
  } else {
    const checklist = s.slice(at);
    if (!new RegExp(`${COVERAGE_ENV}[^\\n]*`).test(checklist)) {
      problems.push('리허설 체크리스트에 범위를 적는 항목이 없다');
    }
    if (!/6-2/.test(checklist)) problems.push('리허설 체크리스트가 §6-2 를 가리키지 않는다');
  }
  return problems;
}

/**
 * `app/api/health/route.ts` 원문 점검 — 판정이 **응답에 실려 있는지**까지 본다.
 * 빠지면 절차가 리허설보다 앞서 나간 사실을 알려 줄 장치가 사라지는데, 응답은 그대로 돈다.
 */
export function auditHealthWiring(src: unknown): string[] {
  const s = String(src ?? '');
  const problems: string[] = [];
  if (!/from\s+['"]@\/lib\/rehearsalCoverage['"]/.test(s)) problems.push('rehearsalCoverage 를 import 하지 않는다');
  if (!/rehearsalCoverageCheck\(/.test(s)) problems.push('rehearsalCoverageCheck() 를 호출하지 않는다');
  if (!/checks\.rehearsalCoverage\s*=\s*rehearsalCoverageCheck\(/.test(s)) {
    problems.push('판정 결과를 checks.rehearsalCoverage 에 싣지 않는다(판정만 하고 버리는 꼴)');
  }
  return problems;
}
