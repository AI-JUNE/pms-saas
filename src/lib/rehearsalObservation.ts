/**
 * rehearsalObservation.ts — 리허설이 **무엇을 보고 판정하는가**(RUNBOOK §6·§6-3). 2026-10-19
 *
 * ── 왜 필요한가 ───────────────────────────────────────────────────────────────
 * 앞 배치가 「리허설이 **어느 절차**를 검증했는가」(§6-2 `rehearsalCoverage`)를 소절 단위로
 * 쪼갰다. 그 단위 안에서 사람이 실제로 **수행하는 것**은 리허설 체크리스트 36항목이고,
 * 그 항목의 거의 전부는 같은 모양이다 — 「무엇을 한 뒤 `checks.<이름>.detail.<칸>` 이
 * `<값>` 인지 확인했다」. 즉 **이 절차의 유일한 실행 표면은 체크리스트의 인용이다.**
 *
 *  (1) **그 인용이 가리키는 곳이 실제로 있는지 아무도 대조하지 않았다.** 인용은 Markdown
 *      안의 평범한 문자열이고, 체크 이름·상세 칸·판정값은 전부 이 저장소의 코드가 정한다.
 *      그리고 그 코드를 매일 고치는 쪽이 **이 야간 자동 개발 자신**이다. 칸 이름이나 판정값이
 *      바뀌면 담당자가 받는 것은 오류가 아니라 **`undefined`** 인데, `undefined` 는 「문제
 *      없음」과 글자 하나 다르지 않다 — 그 항목은 조용히 통과로 기록되고, §6 표에는 `정상`
 *      이 남는다. 어떤 테스트도, 어떤 응답도 그 어긋남을 말하지 않는다.
 *
 *  (2) **달성할 수 없는 항목이 하나 있었다** — 「`GET /api/health` 전 항목 정상」. 이 응답의
 *      복구 관련 체크는 **의도적으로** `ok: false` 를 낸다: 평상시에도 `recovery`(리허설
 *      미실시)·`recoveryWindow`(보존기간 `[확인 필요]`)·`periodicCheck`(월 점검 미기록)가
 *      그렇고, 리허설 중에는 `writeFreeze`(차단 ON)·`rehearsalScope`(선언 ON)·
 *      `postRestoreSecurity`/`externalState`(해제 전 미기록)·`lossNotice`(리허설은 고지하지
 *      않는다)가 더해진다. 그래서 이 항목은 **어떤 리허설에서도 통과할 수 없고**, 담당자는
 *      체크하고 넘어가게 된다 — 체크리스트에서 유일한 포괄 항목이므로 그렇게 묻히는 것은
 *      이 항목 하나가 아니라 **아무도 따로 보지 않는 모든 체크의 실패**다.
 *
 *  (3) **읽히지 않는 장치가 쌓인다.** 체크는 18개인데 체크리스트가 칸을 인용하는 것은 11개
 *      뿐이었다. 남은 것 중 `disclosure`(§2-3 가림)는 **복구 중에만** 작동하고, 리허설은
 *      사건 표지를 실제로 넣어 보는 **유일한 기회**인데 그 가림이 걸리는지 한 번도 확인된
 *      적이 없다. `deployPin`·`recoveryWindow`·`recovery` 도 같다. 장치는 매 배치 늘어나고
 *      체크리스트는 손으로 자라므로, 어긋남은 **자동으로 벌어지는 쪽**으로만 움직인다.
 *
 * 그래서 이 모듈은
 *   · 체크 18개 전건을 **관측 정본**으로 두고(`CHECK_OBSERVATIONS` — 판정 칸 · 값 어휘의
 *     **정본 위치** · 체크리스트가 그 칸을 읽는가 `cited` · **의도적으로 degraded 가 되는 때**
 *     `degradedWhen` · 읽지 않으면 조용히 생기는 일 `silent`),
 *   · 실제 체크리스트에서 인용을 뽑아(`extractCitations`) **실제 응답 모양**과 대조하고
 *     (`auditCitationTargets` — 없는 체크·없는 칸), 기대값을 **실제 어휘 선언 원문**과
 *     대조하고(`auditCitationValues`·`parseVocabulary` — 값 이름이 바뀌면 CI 실패),
 *   · 포괄 문구가 구체 인용을 대신하는 항목을 막고(`auditBlanketItems`),
 *   · **반대 방향으로** 새 체크가 체크리스트 없이 늘어나는 것을 막고(`auditRegistryShape` —
 *     `CheckName` 전건이 정본에 있어야 하고, 관측 대상은 인용돼 있어야 한다),
 *   · degraded 를 **설명된 것과 설명되지 않은 것**으로 가른다(`classifyDegraded` →
 *     `unexpectedDegraded`) — 「전 항목 정상」을 수행 가능한 한 줄로 바꾸는 자리다,
 *   · 그 상태를 `/api/health` 로 드러낸다(`rehearsalObservationCheck` — **required: false**).
 *
 * 원칙
 * - 순수 모듈: DB·next·fs·`process.env` 미접근, **신규 조회·쓰기·DDL·신규 env 0**.
 *   판정은 **넘겨받은 응답과 원문 인자**만 본다.
 * - **중복 보고 금지.** 설명되지 않은 degraded 를 **목록으로만** 내보내고 `ok` 를 끌어내리지
 *   않는다 — 그 체크가 이미 스스로 degraded 로 말하고 있다(§2-2 가 도달까지 맡는다).
 * - **임의 어휘 금지.** 값 어휘를 여기에 복사해 두지 않고 **정본 위치만** 가리킨다
 *   (복사해 두면 이름이 바뀌어도 둘 다 옛 이름이라 영원히 맞는다).
 * - **설명된 degraded 는 degraded 다.** `degradedWhen` 은 사유를 적는 자리이고 판정을
 *   지우는 자리가 아니다(`OBSERVATION_LIMITS`).
 */

/** 응답·문서에서 근거 절을 찾을 수 있게 한다 */
export const OBSERVATION_RUNBOOK_REF = 'RUNBOOK §6 · §6-3';

/** 이 판정이 자기 자신을 세지 않게 한다 — 판정 시점에는 아직 응답에 실리지 않았다 */
export const SELF_CHECK = 'rehearsalObservation';

/** 응답 상세에서 인용 가능한 최대 깊이(`detail.rehearsal.status` 까지) */
export const MAX_DETAIL_DEPTH = 3;

/* ──────────────────────── 관측 정본(체크 18 + 자기 자신) ──────────────────────── */

/** 체크가 리허설에서 어떤 자리인가 */
export type ObservationRole = 'observe' | 'not_rehearsed';

/** 의도적으로 `ok: false` 가 되는 국면 */
export type ObservationPhase = 'normal' | 'rehearsal' | 'incident';

export interface VocabSource {
  /** 저장소 기준 경로 — 테스트가 이 파일을 읽어 어휘를 뽑는다 */
  file: string;
  /** 어휘 선언 이름(`export const …_VERDICTS` 또는 `export type …`) */
  decl: string;
}

export interface CheckObservation {
  /** `lib/health.ts` 의 `CheckName` */
  check: string;
  role: ObservationRole;
  /** `detail` 아래의 **판정 칸**(dot-path). 판정 칸이 없으면 null */
  field: string | null;
  /** 판정값 어휘의 **정본 위치**. boolean·수치 칸은 null — 어휘로 셀 수 없다 */
  vocab: VocabSource | null;
  /** 체크리스트가 이 체크의 상세 칸을 **인용하는가**(선언 — CI 가 실제 문서와 대조한다) */
  cited: boolean;
  /** 의도적으로 `ok: false` 가 되는 국면. 사유를 적는 자리이고 degraded 를 지우지 않는다 */
  degradedWhen: readonly ObservationPhase[];
  /** 왜 리허설이 이 칸을 읽어야 하는가 / 왜 리허설 대상이 아닌가 */
  why: string;
  /** 읽지 않으면 조용히 생기는 일 */
  silent: string;
}

/**
 * 체크 전건을 적는다 — **빠뜨리면 CI 가 실패한다**(`auditRegistryShape`).
 * 그것이 이 장치의 핵심이다: 다음 배치가 체크를 추가하면 정본 등록을 요구하고, 등록하는
 * 순간 `cited: false` 가 되어 **「리허설이 아직 그 장치를 본 적 없다」**가 응답에 남는다.
 */
export const CHECK_OBSERVATIONS: readonly CheckObservation[] = [
  {
    check: 'db',
    role: 'not_rehearsed',
    field: null,
    vocab: null,
    cited: false,
    degradedWhen: [],
    why: '연결 핑(`select 1`)이라 **어느 DB 든** ok 다 — 리허설이 확인할 것은 연결 대상(`dbIdentity`)과 행 수(§3 4단계)이고, 기동 자체는 체크리스트가 「로그인·프로젝트 조회 정상」으로 사람 눈으로 본다',
    silent: '해당 없음 — 이 체크로는 복구에 대해 알 수 있는 것이 없다',
  },
  {
    check: 'billing',
    role: 'not_rehearsed',
    field: null,
    vocab: null,
    cited: false,
    degradedWhen: [],
    why: '결제 제공자 **설정 완비 여부**만 본다. 복구가 되돌리는 것은 제공자 쪽이 아니라 반영 결과이고 그것은 `externalState` 가 본다',
    silent: '해당 없음 — 설정 유실은 `envPresence` 가 본다',
  },
  {
    check: 'monitoring',
    role: 'not_rehearsed',
    field: null,
    vocab: null,
    cited: false,
    degradedWhen: [],
    why: '모니터링 배선 **boolean** 뿐이라 늘 ok 다. 배선 키가 복구에서 빠지는 경우는 `envPresence` 가 본다',
    silent: '해당 없음 — 키 유실은 `envPresence`, 도달은 §2-2 가 본다',
  },
  {
    check: 'recovery',
    role: 'observe',
    field: 'rehearsal.status',
    vocab: { file: 'src/lib/recovery.ts', decl: 'RehearsalHealth' },
    cited: true,
    degradedWhen: ['normal', 'rehearsal', 'incident'],
    why: '리허설을 마치고 §6 표·env 를 적은 뒤 **그 기록이 실제로 판정에 닿았는지**를 보는 유일한 칸이다. 주기 미설정이면 기한 판정이 보류되므로 「적었는데 아무것도 바뀌지 않는」 상태가 생긴다',
    silent: '기록을 적어도 판정이 `missing` 에 머문 것을 다음 리허설까지 아무도 모른다 — 그 사이 §2 점검·마켓플레이스 보안 설명은 「검증됐다」를 읽는다',
  },
  {
    check: 'recoveryWindow',
    role: 'observe',
    field: 'retentionConfigured',
    vocab: null,
    cited: true,
    degradedWhen: ['normal', 'rehearsal', 'incident'],
    why: '§3-6 산출은 보존 창 길이가 **설정돼 있을 때만** 판정한다. 미설정이면 복구일 3단계에서야 복구 불가가 드러나는데, 그때는 2단계 차단으로 서비스가 이미 멈춘 뒤다',
    silent: '리허설이 보존 창 없이 돌아가고(`unknown_window` 는 「창 밖」이 아니라 「모른다」다) 그 공백이 복구일까지 남는다',
  },
  {
    check: 'recoveryObjectives',
    role: 'observe',
    field: 'verdict',
    vocab: { file: 'src/lib/recoveryObjectives.ts', decl: 'OBJECTIVE_VERDICTS' },
    cited: true,
    degradedWhen: ['normal', 'rehearsal', 'incident'],
    why: '이 절차가 지키기로 한 **수치**(§1 RTO·RPO)가 적혀 있는지 보는 유일한 칸이다(§1-2). 비어 있으면 소요시간·유실 구간이 약속을 넘겼는지 판정되지 않는다',
    silent: '리허설을 몇 번 해도 「목표 안에 끝났는가」가 계산되지 않고, 되돌릴 수 없는 고지에 구간만 적힌다 — 넘긴 복구와 지킨 복구가 기록에서 구별되지 않는다',
  },
  {
    check: 'periodicCheck',
    role: 'observe',
    field: 'verdict',
    vocab: { file: 'src/lib/periodicCheck.ts', decl: 'CHECK_VERDICTS' },
    cited: true,
    degradedWhen: ['normal', 'rehearsal', 'incident'],
    why: '위 보존 창 수치는 **날짜 없는 설정값**이라 플랜을 바꾸면 조용히 옛 값이 된다 — 월 점검 일자가 그 신선도의 유일한 축이다(§2-1)',
    silent: '옛 플랜 기준으로 계산한 창 안 시점에 `ok` 와 `deadline` 이 나온다',
  },
  {
    check: 'envPresence',
    role: 'observe',
    field: 'verdict',
    vocab: { file: 'src/lib/envPresence.ts', decl: 'RESTORE_VERDICTS' },
    cited: true,
    degradedWhen: [],
    why: '§4 머리말의 「빠진 키는 오류를 내지 않고 조용히 기본값으로 되돌아간다」를 기계적으로 보는 칸이다(§4-12)',
    silent: '복구 뒤 스위치가 꺼진 채로 돌아 약관이 「초안」으로, 정산이 중단 상태로 남는다',
  },
  {
    check: 'writeFreeze',
    role: 'observe',
    field: 'frozen',
    vocab: null,
    cited: true,
    degradedWhen: ['rehearsal', 'incident'],
    why: '§3 2단계를 **수행·확인 가능하게 하는** 유일한 칸이다(§3-3)',
    silent: '차단한 줄 알고 3~5단계를 진행해, 그 사이 들어온 쓰기가 전환에서 사라진다',
  },
  {
    check: 'dbIdentity',
    role: 'observe',
    field: 'verdict',
    vocab: { file: 'src/lib/dbIdentity.ts', decl: 'IdentityVerdict' },
    cited: true,
    degradedWhen: [],
    why: '§3 5단계 전환이 **이 배포에 반영됐는지** 보는 유일한 수단이다(§3-4). `checks.db` 는 어느 DB 든 ok 다',
    silent: '복구된 데이터를 아무도 쓰지 않는 채 복구가 「성공」으로 끝난다',
  },
  {
    check: 'incidentClosure',
    role: 'observe',
    field: 'state',
    vocab: { file: 'src/lib/incidentClosure.ts', decl: 'CLOSURE_STATES' },
    cited: true,
    degradedWhen: ['incident', 'rehearsal'],
    why: '유실 구간의 **끝**은 차단이 걸려 있는 동안에만 기록할 수 있다(§3-7). 7단계는 그 스위치를 지우라고 지시한다',
    silent: '해제 뒤에는 구간의 끝을 확정할 수 없어 되돌릴 수 없는 고지를 사람 기억으로 적는다',
  },
  {
    check: 'lossNotice',
    role: 'observe',
    field: 'state',
    vocab: { file: 'src/lib/lossNotice.ts', decl: 'NOTICE_STATES' },
    cited: true,
    degradedWhen: ['incident', 'rehearsal'],
    why: '이 절차에서 **유일하게 되돌릴 수 없는 산출물**(유실 고지)의 근거와 삭제 게이트다(§3-10). 리허설에서는 실제로 고지하지 않으므로 `due` 가 뜨는 것까지가 점검 대상이다',
    silent: '표지를 지운 뒤에는 고지 없이 끝낸 복구와 제대로 끝낸 복구가 구별되지 않는다',
  },
  {
    check: 'postRestoreSecurity',
    role: 'observe',
    field: 'state',
    vocab: { file: 'src/lib/postRestoreSecurity.ts', decl: 'REAPPLY_STATES' },
    cited: true,
    degradedWhen: ['incident', 'rehearsal'],
    why: '복구는 **대응 조치까지** 되돌린다 — 세션·비밀번호·잠금·권한을 해제 전에 재적용했는지 보는 칸이다(§3-8)',
    silent: '사건의 접근 수단이 되살아난 채로 차단을 풀고, 행 수 대조는 그것을 「기준치 이상」으로 통과시킨다',
  },
  {
    check: 'externalState',
    role: 'observe',
    field: 'state',
    vocab: { file: 'src/lib/externalReconcile.ts', decl: 'RECONCILE_STATES' },
    cited: true,
    degradedWhen: ['incident', 'rehearsal'],
    why: '복구가 **되돌리지 못하는 제공자 쪽**과 대조했는지 보는 칸이다(§3-9)',
    silent: '돈을 낸 조직의 플랜이 내려가고 해지한 조직의 유료 플랜이 되살아난 채 해제된다',
  },
  {
    check: 'assetCoverage',
    role: 'observe',
    field: 'verdict',
    vocab: { file: 'src/lib/assetCoverage.ts', decl: 'COVERAGE_VERDICTS' },
    cited: true,
    degradedWhen: [],
    why: '§1 보호 대상 표가 **실제 저장 위치와 맞는지** 보는 칸이다(§1-1). 첨부 본문은 어디에도 보관되지 않는다',
    silent: '「파일이 복구된다」를 고지에 넣는다 — 복구 뒤 화면에 목록이 그대로 보여 차이가 드러나지 않는다',
  },
  {
    check: 'rehearsalScope',
    role: 'observe',
    field: 'verdict',
    vocab: { file: 'src/lib/rehearsalScope.ts', decl: 'SCOPE_VERDICTS' },
    cited: true,
    degradedWhen: ['rehearsal'],
    why: '파괴적 단계가 **어느 배포에 걸려 있는가**를 보는 칸이다(§6-1). 스코프를 틀렸을 때 나오는 응답이 체크리스트가 요구하는 그 응답이다',
    silent: '리허설이 운영 장애를 내도 체크리스트는 전부 통과하고 §6 표에는 `정상` 이 남는다',
  },
  {
    check: 'rehearsalCoverage',
    role: 'observe',
    field: 'verdict',
    vocab: { file: 'src/lib/rehearsalCoverage.ts', decl: 'COVERAGE_VERDICTS' },
    cited: true,
    degradedWhen: ['normal', 'rehearsal', 'incident'],
    why: '리허설이 **어느 절차 단위**를 검증했는지 보는 칸이다(§6-2). 절차가 리허설보다 앞서 있는 것이 평상시 상태다',
    silent: '36항목 중 다섯만 수행한 리허설과 전부 수행한 리허설이 응답에서 구별되지 않는다',
  },
  {
    check: 'rehearsalLedger',
    role: 'observe',
    field: 'verdict',
    vocab: { file: 'src/lib/rehearsalLedger.ts', decl: 'LEDGER_VERDICTS' },
    cited: true,
    degradedWhen: [],
    why: '위 두 판정(신선도·범위)의 입력인 env 기록이 **저장소의 §6 표와 같은 말을 하는지** 보는 칸이다(§6-4). 판정이 읽는 쪽은 복구·롤백으로 사라지는 쪽이고, 결과를 판독하지 못하면 `ok` 가 됐다',
    silent: '기록이 env 에서만 사라지면 신선도는 `missing`·범위는 `unrecorded`(판정 보류)로 내려앉고, 저장소에 남은 리허설을 아무도 되찾지 않는다',
  },
  {
    check: 'rehearsalOutcome',
    role: 'observe',
    field: 'verdict',
    vocab: { file: 'src/lib/rehearsalOutcome.ts', decl: 'OUTCOME_VERDICTS' },
    cited: true,
    degradedWhen: [],
    why: '`검증 결과` 가 `부분 통과`·`실패` 일 때 **어느 단위가 통과하지 못했는지**를 보는 칸이다(§6-5). 범위 판정은 적힌 단위를 통과 여부와 무관하게 covered 로 세므로 `ok` 를 내고, 신선도의 「실패 항목을 조치하라」는 가리킬 목록이 없었다',
    silent: '미통과가 어느 단위인지 남지 않아 다음 리허설의 재수행 대상에서 빠지고, `부분 통과` 의 소요시간이 §1-2 의 RTO 실측으로 쓰여 `met` 이 된다',
  },
  {
    check: 'rehearsalKind',
    role: 'observe',
    field: 'verdict',
    vocab: { file: 'src/lib/rehearsalKind.ts', decl: 'KIND_VERDICTS' },
    cited: true,
    degradedWhen: ['rehearsal'],
    why: '그 기록이 **연습인가 사건인가**를 보는 칸이다(§6-6). §6 표 `유형` 열과 env 는 2026-09-21 부터 적혀 있었는데 읽는 판정이 없어, 사건 복구가 리허설 기한을 리셋하고 리허설 중의 구간이 §1 약속의 실측이 됐다',
    silent: '정기 리허설을 한 번도 하지 않아도 사건마다 `checks.recovery` 가 `ok` 로 돌아오고, 연습으로 잰 구간이 `attainment.rpo` 의 `met`·`exceeded` 로 기록된다',
  },
  {
    check: 'restorePointRecord',
    role: 'observe',
    field: 'verdict',
    vocab: { file: 'src/lib/restorePointRecord.ts', decl: 'RECORD_VERDICTS' },
    cited: true,
    degradedWhen: ['rehearsal', 'incident'],
    why: '유실 구간의 두 끝이 **영구 기록으로 옮겨졌는지** 보는 칸이다(§6-7). 그 두 끝은 복구 뒤 지우는 임시 키에만 있었고, 표의 `복구 대상 시점`·`비고` 는 §6-4 가 `judgedBy: null` 로 적어 둔 칸이었다',
    silent: '표지를 지우는 순간 구간이 사라져 §1 RPO 대조가 영구히 `unjudged` 가 되고, 고지한 수치가 무엇이었는지도 남지 않는다 — 표에는 행이 그대로 있어 아무도 알아채지 못한다',
  },
  {
    check: 'ledgerPurpose',
    role: 'observe',
    field: 'verdict',
    vocab: { file: 'src/lib/ledgerPurpose.ts', decl: 'PURPOSE_VERDICTS' },
    cited: true,
    degradedWhen: [],
    why: '§6 표의 행이 **무엇의 기록인가**를 보는 칸이다(§6-8). 같은 표에 §2 월 점검 행도 들어오는데 `유형` 어휘에는 그것을 적을 값이 없었고, `normalizeKind` 는 부분 문자열 `정기` 로 판정해 「정기 점검」을 리허설 행으로 세었다',
    silent: '리허설을 한 번도 하지 않아도 월 점검이 기한을 매월 리셋하고, 몇 분짜리 점검 소요시간이 §1 RTO 의 `met` 근거가 된다',
  },
  {
    check: 'deployPin',
    role: 'observe',
    field: 'verdict',
    vocab: { file: 'src/lib/deployRollback.ts', decl: 'PIN_VERDICTS' },
    cited: true,
    degradedWhen: [],
    why: '롤백(Promote)은 **최대 20분짜리**다 — AutoPush 가 main 을 밀어 올리면 조용히 풀린다(§5-1). 리허설이 Promote 를 쓰지 않았는지도 이 칸으로 본다',
    silent: '리허설·복구 중에 옛 배포의 env 스냅샷으로 돌아가 차단·DB 교체·기준 지문이 함께 되돌아간다',
  },
  {
    check: 'disclosure',
    role: 'observe',
    field: 'verdict',
    vocab: { file: 'src/lib/healthDisclosure.ts', decl: 'DisclosureVerdict' },
    cited: true,
    degradedWhen: ['incident', 'rehearsal'],
    why: '사건 표지가 들어 있는 동안 **무인증 응답이 무엇을 공표하는가**를 보는 칸이다(§2-3). 리허설은 그 표지를 실제로 넣어 보는 유일한 기회다',
    silent: '복구일에 `HEALTH_DETAIL_TOKEN` 이 없어 차단 시각·보안 재적용 미완이 무인증으로 나간다 — 그때는 넣을 겨를이 없다',
  },
  {
    check: SELF_CHECK,
    role: 'observe',
    field: 'verdict',
    vocab: { file: 'src/lib/rehearsalObservation.ts', decl: 'OBSERVATION_VERDICTS' },
    cited: true,
    degradedWhen: [],
    why: '체크리스트의 인용이 **가리킬 곳을 잃지 않았는지**와 설명되지 않은 degraded 가 있는지 보는 칸이다(§6-3)',
    silent: '인용이 어긋난 채로 리허설이 돌아 `undefined` 를 「문제 없음」으로 읽는다',
  },
];

export const OBSERVATION_VERDICTS = ['ok', 'uncited', 'missing_check', 'unreadable'] as const;
export type ObservationVerdict = (typeof OBSERVATION_VERDICTS)[number];

export const ACTION_OBS_OK =
  '체크 전건이 응답에 있고, 관측 대상 전건을 체크리스트가 칸으로 인용한다. 「설명된 degraded」는 그대로 degraded 다 — 각 체크의 `action` 을 본다';
export const ACTION_OBS_UNCITED =
  '리허설이 **한 번도 읽지 않는** 체크가 있다 — 그 장치는 복구일에 처음 읽히게 된다. 체크리스트에 그 칸을 읽는 항목을 넣고 정본의 `cited` 를 맞춘다(§6-3)';
export const ACTION_OBS_MISSING =
  '관측 정본이 가리키는 체크가 **응답에 없다** — 배선이 빠졌거나 이름이 바뀌었다. 체크리스트의 그 항목은 `undefined` 를 받으면서 「문제 없음」으로 읽힌다(§6-3)';
export const ACTION_OBS_UNREADABLE =
  '응답의 `checks` 를 읽을 수 없어 판정하지 않는다 — 「문제 없음」으로 올리지 않는다. 응답 조립(`buildHealthBody`)이 바뀌었으면 이 판정을 함께 본다';

const ACTION: Record<ObservationVerdict, string> = {
  ok: ACTION_OBS_OK,
  uncited: ACTION_OBS_UNCITED,
  missing_check: ACTION_OBS_MISSING,
  unreadable: ACTION_OBS_UNREADABLE,
};

/** 어긋남이 생기는 세 방향 — 전부 **응답은 200 이라** 사람 눈으로는 알아챌 수 없다 */
export const OBSERVATION_DRIFTS: readonly { key: string; how: string }[] = [
  {
    key: 'renamed_target',
    how: '코드가 판정 칸·판정값 이름을 바꾸는데 체크리스트는 옛 이름을 가리킨다 — 담당자가 받는 것은 오류가 아니라 `undefined` 이고, 그것은 「문제 없음」과 구별되지 않는다',
  },
  {
    key: 'unobserved_device',
    how: '체크는 매 배치 늘고 체크리스트는 손으로 자란다 — 등록만 되고 인용되지 않은 장치는 복구일에 처음 읽힌다',
  },
  {
    key: 'blanket_item',
    how: '「전 항목 정상」 류의 포괄 문구가 구체 인용을 대신한다 — 의도된 degraded 때문에 **달성 불가능한 항목**이 되고, 그 항목이 덮는 것은 아무도 따로 보지 않는 모든 체크의 실패다',
  },
];

/** 보장하지 **못하는** 것 — 응답·RUNBOOK 에 함께 내보낸다 */
export const OBSERVATION_LIMITS: readonly string[] = [
  '인용이 가리키는 칸이 있다는 것은 **「읽을 수 있다」까지만** 뜻한다 — 담당자가 실제로 읽었는지는 §6-2 범위 기록이 말한다',
  '값 어휘 대조는 **인용 바로 뒤의 기대값 하나**만 본다 — 괄호 안 참고값·필드 이름·어긋남 키는 세지 않는다',
  'boolean·수치 칸은 어휘가 없어 **값 대조를 하지 않는다**(칸의 존재만 본다)',
  '`unexpectedDegraded` 가 비어 있다 ≠ 정상 — **설명된 degraded 는 여전히 degraded 다**(각 체크가 스스로 말한다. 이 목록은 그것을 지우지 않는다)',
  '이 판정은 **응답 모양**만 본다 — 그 칸의 값이 사실인지는 각 체크가 말한다',
  `자기 자신(\`${SELF_CHECK}\`)은 판정 시점에 아직 응답에 실리지 않아 \`missing\` 으로 세지 않는다`,
  '체크리스트 인용 대조는 **CI 시점**(실제 RUNBOOK 원문)에만 돈다 — 런타임 응답은 정본의 `cited` 선언을 그대로 말한다',
];

/* ───────────────────────────── 정본 조회 ───────────────────────────── */

/** 모르는 이름은 null — 지어내지 않는다 */
export function observationFor(check: unknown): CheckObservation | null {
  const k = String(check ?? '').trim();
  return CHECK_OBSERVATIONS.find((o) => o.check === k) ?? null;
}

/** 리허설이 읽어야 하는 체크 */
export function observedChecks(obs: readonly CheckObservation[] = CHECK_OBSERVATIONS): string[] {
  return obs.filter((o) => o.role === 'observe').map((o) => o.check);
}

/** 관측 대상인데 체크리스트가 칸으로 **읽지 않는** 체크 */
export function uncitedChecks(obs: readonly CheckObservation[] = CHECK_OBSERVATIONS): string[] {
  return obs.filter((o) => o.role === 'observe' && !o.cited).map((o) => o.check);
}

/* ───────────────────────────── 응답 모양 ───────────────────────────── */

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * 값 하나에서 인용 가능한 dot-path 를 뽑는다. 배열·null 은 **잎**이다(칸은 존재한다).
 * 깊이를 제한하는 이유: 체크리스트가 인용하는 것은 `detail.<칸>`·`detail.<칸>.<칸>` 까지다.
 */
export function detailPaths(value: unknown, prefix = '', depth = MAX_DETAIL_DEPTH): string[] {
  if (!isPlainObject(value) || depth <= 0) return prefix ? [prefix] : [];
  const out: string[] = [];
  for (const [k, v] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${k}` : k;
    out.push(path);
    if (isPlainObject(v) && depth > 1) out.push(...detailPaths(v, path, depth - 1));
  }
  return out;
}

export interface ResponseShape {
  /** 응답에 실제로 있는 체크 이름 */
  names: string[];
  /** 체크별 `detail` 아래 dot-path 목록 */
  paths: Record<string, string[]>;
  /** `checks` 를 객체로 읽을 수 있었는가 — 못 읽으면 판정하지 않는다 */
  readable: boolean;
}

/** 넘겨받은 `checks` 에서 인용 대조용 모양을 만든다(값은 담지 않는다) */
export function responseShape(checks: unknown): ResponseShape {
  if (!isPlainObject(checks)) return { names: [], paths: {}, readable: false };
  const names: string[] = [];
  const paths: Record<string, string[]> = {};
  for (const [name, result] of Object.entries(checks)) {
    names.push(name);
    const detail = isPlainObject(result) ? result.detail : undefined;
    paths[name] = detailPaths(detail);
  }
  return { names, paths, readable: true };
}

export type CitationVerdict = 'ok' | 'unknown_check' | 'unknown_field';

/** 인용 하나가 응답에서 **가리킬 곳이 있는지** */
export function resolveCitation(shape: ResponseShape, check: unknown, field: unknown): CitationVerdict {
  const c = String(check ?? '').trim();
  const f = String(field ?? '').trim();
  if (!shape.readable || !shape.names.includes(c)) return 'unknown_check';
  if (!f) return 'ok';
  return (shape.paths[c] ?? []).includes(f) ? 'ok' : 'unknown_field';
}

/* ───────────────────────── 체크리스트 인용 추출 ───────────────────────── */

export interface ChecklistItem {
  /** 1부터 세는 항목 번호(사람이 센 순서) */
  index: number;
  /** 항목 전문(이어진 줄을 합친다) */
  text: string;
}

const CHECKLIST_HEADING = /^###\s*리허설 체크리스트\s*$/m;

/** 체크리스트 구간만 잘라낸다. 못 찾으면 null — 「항목이 없다」로 단정하지 않는다 */
export function checklistSection(runbookSrc: unknown): string | null {
  const s = String(runbookSrc ?? '');
  const m = CHECKLIST_HEADING.exec(s);
  if (!m) return null;
  const rest = s.slice(m.index + m[0].length);
  const next = rest.search(/^#{1,4}\s/m);
  return next < 0 ? rest : rest.slice(0, next);
}

/** `- [ ]` 항목을 이어진 줄까지 합쳐 뽑는다 */
export function parseChecklistItems(runbookSrc: unknown): ChecklistItem[] {
  const section = checklistSection(runbookSrc);
  if (section === null) return [];
  const items: ChecklistItem[] = [];
  for (const line of section.split(/\r?\n/)) {
    const started = /^\s*-\s*\[[ xX]\]\s*(.*)$/.exec(line);
    if (started) {
      items.push({ index: items.length + 1, text: started[1].trim() });
      continue;
    }
    if (items.length > 0 && /^\s+\S/.test(line)) {
      const last = items[items.length - 1];
      last.text = `${last.text} ${line.trim()}`;
    }
  }
  return items;
}

export interface Citation {
  /** 항목 번호 */
  item: number;
  check: string;
  /** `detail` 아래 dot-path. `checks.X` 만 쓴 경우는 빈 문자열 */
  field: string;
  /** 인용 **바로 뒤**에 적힌 기대값(없으면 null) */
  expected: string | null;
}

// 긴 꼴을 먼저 — `checks.X.detail.Y` → `checks.X` → `detail.Y`(앞선 체크를 물려받는다)
const CITATION_RE =
  /checks\.([A-Za-z_$][\w$]*)\.detail((?:\.[A-Za-z_$][\w$]*)+)|checks\.([A-Za-z_$][\w$]*)|\bdetail((?:\.[A-Za-z_$][\w$]*)+)/g;

const VALUE_TOKEN = /^[a-z][a-z0-9_]*$/;

/** 인용 바로 뒤의 첫 백틱 토큰(식별자 모양)만 기대값으로 본다 */
function expectedAfter(text: string, from: number): string | null {
  // 인용 자신을 닫는 백틱을 먼저 지난다(`…detail.verdict` **`** 가 `ok` 이다).
  const tail = text.slice(from, from + 40).replace(/^`/, '');
  const m = /`([^`]+)`/.exec(tail);
  if (!m) return null;
  const token = m[1].trim();
  return VALUE_TOKEN.test(token) ? token : null;
}

/** 체크리스트의 인용 전건. `detail.X` 축약은 **같은 항목의 앞선 체크**를 물려받는다 */
export function extractCitations(runbookSrc: unknown): Citation[] {
  const out: Citation[] = [];
  for (const item of parseChecklistItems(runbookSrc)) {
    let current = '';
    for (const m of item.text.matchAll(CITATION_RE)) {
      const [whole, longCheck, longField, bareCheck, shortField] = m;
      let check = '';
      let field = '';
      if (longCheck) {
        check = longCheck;
        field = longField.replace(/^\./, '');
      } else if (bareCheck) {
        check = bareCheck;
      } else {
        check = current;
        field = shortField.replace(/^\./, '');
      }
      if (!check) continue;
      current = check;
      out.push({
        item: item.index,
        check,
        field,
        expected: expectedAfter(item.text, (m.index ?? 0) + whole.length),
      });
    }
  }
  return out;
}

/** 체크리스트가 **칸까지 읽는** 체크 목록(이름만 스친 것은 세지 않는다) */
export function readChecks(runbookSrc: unknown): string[] {
  const seen = new Set<string>();
  for (const c of extractCitations(runbookSrc)) if (c.field) seen.add(c.check);
  return [...seen];
}

/* ───────────────────────── 값 어휘(정본 위치에서) ───────────────────────── */

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 선언을 찾기 전에 주석을 지운다 — 어휘 사이에 설명이 끼어 있다 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[ \t]*\/\/.*$/gm, ' ');
}

/**
 * **정본 위치의 원문**에서 값 어휘를 뽑는다(`export const …= [...] as const` · `export type … = 'a' | 'b';`).
 * 어휘를 이 모듈에 복사해 두지 않는 이유: 복사해 두면 이름이 바뀌어도 둘 다 옛 이름이라 영원히 맞는다.
 */
export function parseVocabulary(src: unknown, decl: unknown): string[] {
  const s = stripComments(String(src ?? ''));
  const name = String(decl ?? '').trim();
  if (!name) return [];
  const constRe = new RegExp(`export\\s+const\\s+${escapeRe(name)}\\s*(?::[^=]*)?=\\s*\\[([\\s\\S]*?)\\]\\s*as\\s+const`);
  const typeRe = new RegExp(`export\\s+type\\s+${escapeRe(name)}\\s*=([\\s\\S]*?);`);
  const body = constRe.exec(s)?.[1] ?? typeRe.exec(s)?.[1];
  if (body === undefined) return [];
  return [...body.matchAll(/'([^']*)'/g)].map((m) => m[1]).filter((v) => v.length > 0);
}

/* ─────────────────────────── degraded 의 분류 ─────────────────────────── */

const pick = (checks: Record<string, unknown>, name: string, path: string): unknown => {
  const result = checks[name];
  if (!isPlainObject(result)) return undefined;
  let cur: unknown = result.detail;
  for (const seg of path.split('.')) {
    if (!isPlainObject(cur)) return undefined;
    cur = cur[seg];
  }
  return cur;
};

/**
 * 응답만 보고 국면을 정한다(env 를 읽지 않는다).
 * 리허설 선언이 있으면 리허설, 없이 차단이 걸려 있으면 사건, 그 밖은 평상시다.
 */
export function observationPhase(checks: unknown): ObservationPhase {
  if (!isPlainObject(checks)) return 'normal';
  const scope = pick(checks, 'rehearsalScope', 'verdict');
  if (scope === 'rehearsal' || scope === 'production_rehearsal') return 'rehearsal';
  if (pick(checks, 'writeFreeze', 'frozen') === true) return 'incident';
  return 'normal';
}

export interface DegradedSplit {
  phase: ObservationPhase;
  /** 정본이 **이 국면에 예정된 degraded** 로 적어 둔 체크 */
  expected: string[];
  /** 정본이 설명하지 않는 degraded — 「전 항목 정상」을 수행 가능하게 만드는 목록이다 */
  unexpected: string[];
}

/**
 * `ok: false` 인 체크를 **설명된 것과 설명되지 않은 것**으로 가른다.
 * 모르는 체크의 degraded 는 **설명된 쪽으로 올리지 않는다**(fail-closed).
 */
export function classifyDegraded(checks: unknown, phase?: ObservationPhase): DegradedSplit {
  const at = phase ?? observationPhase(checks);
  const split: DegradedSplit = { phase: at, expected: [], unexpected: [] };
  if (!isPlainObject(checks)) return split;
  for (const [name, result] of Object.entries(checks)) {
    if (!isPlainObject(result) || result.ok !== false) continue;
    const obs = observationFor(name);
    if (obs && obs.degradedWhen.includes(at)) split.expected.push(name);
    else split.unexpected.push(name);
  }
  return split;
}

/* ───────────────────────────── 판정 ───────────────────────────── */

export interface ObservationAssessment {
  verdict: ObservationVerdict;
  phase: ObservationPhase;
  /** 관측 대상 수 */
  observed: number;
  /** 관측 대상인데 체크리스트가 읽지 않는 체크(정본 선언) */
  uncited: string[];
  /** 정본이 가리키는데 응답에 없는 체크 */
  missing: string[];
  /** 정본에 없는 응답 체크 — 등록되지 않은 장치다 */
  unregistered: string[];
  expectedDegraded: string[];
  unexpectedDegraded: string[];
  action: string;
  caveats: readonly string[];
}

/** 넘겨받은 `checks` 만 본다 — env·DB·문서를 읽지 않는다 */
export function assessObservation(args: { checks: unknown }): ObservationAssessment {
  const shape = responseShape(args.checks);
  const uncited = uncitedChecks();
  const shell = {
    observed: observedChecks().length,
    uncited,
    caveats: OBSERVATION_LIMITS,
  };

  if (!shape.readable) {
    return {
      ...shell,
      verdict: 'unreadable',
      phase: 'normal',
      missing: [],
      unregistered: [],
      expectedDegraded: [],
      unexpectedDegraded: [],
      action: ACTION_OBS_UNREADABLE,
    };
  }

  const missing = CHECK_OBSERVATIONS.filter(
    (o) => o.role === 'observe' && o.check !== SELF_CHECK && !shape.names.includes(o.check),
  ).map((o) => o.check);
  const unregistered = shape.names.filter((n) => !observationFor(n));
  const split = classifyDegraded(args.checks);

  const verdict: ObservationVerdict = missing.length > 0 ? 'missing_check' : uncited.length > 0 ? 'uncited' : 'ok';

  return {
    ...shell,
    verdict,
    phase: split.phase,
    missing,
    unregistered,
    expectedDegraded: split.expected,
    unexpectedDegraded: split.unexpected,
    action: ACTION[verdict],
  };
}

/* ───────────────────────────── 출력 ───────────────────────────── */

/**
 * `/api/health` 체크. **required: false** — 인용이 어긋났다고 서비스를 내리면 복구가 자기 자신을 막는다.
 * 설명되지 않은 degraded 는 **목록으로만** 내보낸다(그 체크가 이미 스스로 말한다 — 중복 보고 금지).
 */
export function rehearsalObservationCheck(args: { checks: unknown }): {
  ok: boolean;
  required: false;
  detail: Record<string, unknown>;
} {
  const a = assessObservation(args);
  return {
    ok: a.verdict === 'ok',
    required: false,
    detail: {
      verdict: a.verdict,
      phase: a.phase,
      observed: a.observed,
      uncited: a.uncited,
      missing: a.missing,
      unregistered: a.unregistered,
      expectedDegraded: a.expectedDegraded,
      unexpectedDegraded: a.unexpectedDegraded,
      drifts: OBSERVATION_DRIFTS.map((d) => d.key),
      runbook: OBSERVATION_RUNBOOK_REF,
      limits: OBSERVATION_LIMITS,
      action: a.action,
    },
  };
}

/** 사람이 읽는 요약(보고·문서용). 수치를 지어내지 않는다 */
export function observationText(checks: unknown): string[] {
  const a = assessObservation({ checks });
  const lines = [`판정: ${a.verdict} (국면 ${a.phase})`, `관측 대상: ${a.observed}건`];
  if (a.uncited.length > 0) lines.push(`체크리스트가 읽지 않는 체크: ${a.uncited.join(', ')}`);
  if (a.missing.length > 0) lines.push(`응답에 없는 체크: ${a.missing.join(', ')}`);
  if (a.unregistered.length > 0) lines.push(`정본에 없는 체크: ${a.unregistered.join(', ')}`);
  if (a.expectedDegraded.length > 0) lines.push(`설명된 degraded: ${a.expectedDegraded.join(', ')}`);
  if (a.unexpectedDegraded.length > 0) lines.push(`설명되지 않은 degraded: ${a.unexpectedDegraded.join(', ')}`);
  lines.push(`해야 할 일: ${a.action}`);
  return lines;
}

/** 운영 로그 한 줄 — 판정·체크 이름·개수만 담는다(설정값·행 수 없음) */
export function observationLogLine(checks: unknown): string {
  const a = assessObservation({ checks });
  const parts = [
    '[rehearsalObservation]',
    `verdict=${a.verdict}`,
    `phase=${a.phase}`,
    `observed=${a.observed}`,
    `uncited=${a.uncited.length}`,
    `missing=${a.missing.length}`,
    `unexpectedDegraded=${a.unexpectedDegraded.length}`,
  ];
  if (a.unexpectedDegraded.length > 0) parts.push(`checks=${a.unexpectedDegraded.join('|')}`);
  return parts.join(' ');
}

/** 배선 상태 요약(문서·보고용) */
export function observationStatus(checks: unknown): {
  verdict: ObservationVerdict;
  observed: number;
  uncited: number;
  drifts: number;
  limits: number;
  action: string;
} {
  const a = assessObservation({ checks });
  return {
    verdict: a.verdict,
    observed: a.observed,
    uncited: a.uncited.length,
    drifts: OBSERVATION_DRIFTS.length,
    limits: OBSERVATION_LIMITS.length,
    action: a.action,
  };
}

/* ───────────────────────────── 정적 점검 ───────────────────────────── */

/** `lib/health.ts` 의 `CheckName` 유니온을 원문에서 뽑는다. 못 찾으면 빈 배열 */
export function checkNamesFrom(healthSrc: unknown): string[] {
  const union = /export\s+type\s+CheckName\s*=([\s\S]*?);/.exec(String(healthSrc ?? ''));
  if (!union) return [];
  return [...union[1].matchAll(/'([A-Za-z_$][\w$]*)'/g)].map((m) => m[1]);
}

/**
 * **반대 방향** — `CheckName` 전건이 정본에 등록돼 있는지, 정본에 유령이 없는지.
 *
 * 이것이 이 장치의 핵심이다: 다음 배치가 체크를 추가하면 CI 가 등록을 요구하고, 등록하는
 * 순간 `cited: false` 가 되어 「리허설이 아직 그 장치를 본 적 없다」가 응답에 남는다.
 * 등록하지 않으면 **장치는 늘어나는데 관측 판정은 그대로 `ok`** 가 되는데, 응답은 200 이다.
 */
export function auditRegistryShape(
  healthSrc: unknown,
  obs: readonly CheckObservation[] = CHECK_OBSERVATIONS,
): string[] {
  const declared = checkNamesFrom(healthSrc);
  if (declared.length === 0) {
    return ['lib/health.ts 에서 CheckName 유니온을 찾지 못했다 — 타입 모양이 바뀌었으면 이 가드를 함께 볼 것'];
  }
  const problems: string[] = [];
  const known = new Set(obs.map((o) => o.check));
  for (const name of declared) {
    if (!known.has(name)) {
      problems.push(
        `체크 ${name} 이(가) 관측 정본에 없다 — CHECK_OBSERVATIONS 에 등록할 것` +
          '(등록하지 않으면 장치는 늘어나는데 관측 판정은 그대로 ok 가 된다)',
      );
    }
  }
  for (const o of obs) {
    if (o.check !== SELF_CHECK && !declared.includes(o.check)) {
      problems.push(`관측 정본의 ${o.check} 이(가) CheckName 에 없다 — 가리킬 곳을 잃었다`);
    }
    if (!o.why.trim() || !o.silent.trim()) problems.push(`체크 ${o.check} 의 사유·거른 결과 설명이 비었다`);
    if (o.role === 'observe' && !o.field) problems.push(`관측 대상 ${o.check} 에 판정 칸이 없다`);
    if (o.role === 'not_rehearsed' && (o.field || o.cited)) {
      problems.push(`${o.check} 은 리허설 대상이 아닌데 판정 칸·인용이 선언돼 있다`);
    }
    if (o.vocab && !o.field) problems.push(`${o.check} 에 판정 칸 없이 어휘 정본만 선언돼 있다`);
  }
  if (!declared.includes(SELF_CHECK)) {
    problems.push(`${SELF_CHECK} 이(가) CheckName 에 없다 — 이 판정 자체가 응답에 실리지 않는다`);
  }
  return problems;
}

/**
 * 각 체크의 `cited` 선언이 **실제 체크리스트와 맞는지**.
 * 선언만 `true` 로 두면 「읽고 있다」는 거짓 근거가 되고, 거꾸로면 응답이 거짓 `uncited` 를 낸다.
 */
export function auditCitedDeclarations(
  runbookSrc: unknown,
  obs: readonly CheckObservation[] = CHECK_OBSERVATIONS,
): string[] {
  if (checklistSection(runbookSrc) === null) return ['RUNBOOK 에서 리허설 체크리스트를 찾을 수 없다'];
  const read = new Set(readChecks(runbookSrc));
  const problems: string[] = [];
  for (const o of obs) {
    const cited = read.has(o.check);
    if (cited === o.cited) continue;
    problems.push(
      cited
        ? `체크 ${o.check} 는 체크리스트가 칸으로 읽는데 정본에 cited: false 로 적혀 있다`
        : `체크 ${o.check} 를 체크리스트가 칸으로 읽지 않는데 정본에 cited: true 로 적혀 있다 — 리허설에서 한 번도 읽히지 않는다`,
    );
  }
  return problems;
}

/**
 * 체크리스트의 인용이 **실제 응답에서 가리킬 곳이 있는지**.
 * 어긋나면 담당자는 `undefined` 를 받는데, 그것은 「문제 없음」과 구별되지 않는다.
 */
export function auditCitationTargets(runbookSrc: unknown, shape: ResponseShape): string[] {
  if (checklistSection(runbookSrc) === null) return ['RUNBOOK 에서 리허설 체크리스트를 찾을 수 없다'];
  if (!shape.readable) return ['응답 모양을 읽을 수 없어 인용을 대조하지 않는다 — 「문제 없음」으로 올리지 않는다'];
  const problems: string[] = [];
  for (const c of extractCitations(runbookSrc)) {
    if (c.check === SELF_CHECK && !shape.names.includes(SELF_CHECK)) continue;
    const verdict = resolveCitation(shape, c.check, c.field);
    if (verdict === 'unknown_check') {
      problems.push(`체크리스트 ${c.item}번이 없는 체크 checks.${c.check} 를 가리킨다 — 담당자는 undefined 를 받는다`);
    } else if (verdict === 'unknown_field') {
      problems.push(
        `체크리스트 ${c.item}번이 없는 칸 checks.${c.check}.detail.${c.field} 를 가리킨다 — 담당자는 undefined 를 받고 「문제 없음」으로 읽는다`,
      );
    }
  }
  return problems;
}

/**
 * 체크리스트가 **판정 칸에 기대하는 값**이 어휘에 있는지.
 * `resolve(file)` 는 정본 위치의 원문을 돌려준다(이 모듈은 파일을 읽지 않는다).
 */
export function auditCitationValues(
  runbookSrc: unknown,
  resolve: (file: string) => string | null,
  shape?: ResponseShape,
  obs: readonly CheckObservation[] = CHECK_OBSERVATIONS,
): string[] {
  if (checklistSection(runbookSrc) === null) return ['RUNBOOK 에서 리허설 체크리스트를 찾을 수 없다'];
  const problems: string[] = [];
  const cache = new Map<string, string[]>();

  for (const c of extractCitations(runbookSrc)) {
    const o = obs.find((x) => x.check === c.check);
    if (!o || !o.vocab || !o.field || c.field !== o.field || !c.expected) continue;
    // 같은 체크의 **다른 상세 칸 이름**을 기대값으로 오인하지 않는다
    if (shape?.readable && (shape.paths[c.check] ?? []).includes(c.expected)) continue;

    const key = `${o.vocab.file}#${o.vocab.decl}`;
    let vocab = cache.get(key);
    if (!vocab) {
      const src = resolve(o.vocab.file);
      vocab = src === null ? [] : parseVocabulary(src, o.vocab.decl);
      cache.set(key, vocab);
    }
    if (vocab.length === 0) {
      problems.push(`${c.check} 의 값 어휘 정본(${o.vocab.file} 의 ${o.vocab.decl})을 읽을 수 없다 — 선언이 사라졌거나 모양이 바뀌었다`);
      continue;
    }
    if (!vocab.includes(c.expected)) {
      problems.push(
        `체크리스트 ${c.item}번이 기대하는 값 \`${c.expected}\` 이(가) ${o.vocab.decl} 에 없다 — ` +
          '그 항목은 **어떤 리허설에서도 통과할 수 없다**',
      );
    }
  }
  return problems;
}

/**
 * **포괄 항목** 금지 — 「`/api/health` 전 항목 정상」 류는 의도된 degraded 때문에 달성할 수 없고,
 * 그 항목이 덮는 것은 아무도 따로 보지 않는 모든 체크의 실패다.
 */
export function auditBlanketItems(runbookSrc: unknown): string[] {
  if (checklistSection(runbookSrc) === null) return ['RUNBOOK 에서 리허설 체크리스트를 찾을 수 없다'];
  const problems: string[] = [];
  for (const item of parseChecklistItems(runbookSrc)) {
    const blanket = /전\s*항목|모든 (체크|항목)|전부 정상|전건 정상/.test(item.text);
    if (!blanket) continue;
    const anchored = /detail\./.test(item.text);
    if (!anchored) {
      problems.push(
        `체크리스트 ${item.index}번이 구체 인용 없이 포괄 문구로 확인을 요구한다 — ` +
          '복구 관련 체크는 의도적으로 degraded 를 내므로 통과할 수 없고, 그 항목이 다른 체크의 실패를 덮는다(§6-3)',
      );
    }
  }
  return problems;
}

/** §6-3 과 체크리스트 항목이 문서에 남아 있는지 */
export function auditRunbookObservation(src: unknown): string[] {
  const s = String(src ?? '');
  const problems: string[] = [];
  if (!/^###\s*6-3\./m.test(s)) problems.push('§6-3 절이 사라졌다 — 체크리스트 인용을 코드와 대조하는 근거 자리다');
  if (!new RegExp(`checks\\.${SELF_CHECK}`).test(s)) problems.push(`RUNBOOK 에 checks.${SELF_CHECK} 확인 지시가 없다`);
  if (!/unexpectedDegraded/.test(s)) {
    problems.push('RUNBOOK 에 unexpectedDegraded 가 없다 — 「전 항목 정상」을 대신하는 유일한 수행 가능 문구다');
  }
  for (const d of OBSERVATION_DRIFTS) {
    if (!s.includes(d.key)) problems.push(`§6-3 에 어긋남 ${d.key} 가 없다`);
  }
  return problems;
}

/** `/api/health` 배선 — 판정만 하고 버리는 꼴도 잡는다 */
export function auditHealthWiring(src: unknown): string[] {
  const s = String(src ?? '');
  const problems: string[] = [];
  if (!/from\s+['"]@\/lib\/rehearsalObservation['"]/.test(s)) problems.push('rehearsalObservation 을 import 하지 않는다');
  if (!/rehearsalObservationCheck\(/.test(s)) problems.push('rehearsalObservationCheck() 를 호출하지 않는다');
  const assigned = new RegExp(`checks\\.${SELF_CHECK}\\s*=\\s*rehearsalObservationCheck\\(`).test(s);
  if (!assigned) problems.push(`판정 결과를 checks.${SELF_CHECK} 에 싣지 않는다(판정만 하고 버리는 꼴)`);
  if (!/rehearsalObservationCheck\(\s*\{\s*checks\s*\}\s*\)/.test(s)) {
    problems.push('실제 응답의 checks 를 넘기지 않는다 — 다른 입력으로 판정하면 응답과 다른 것을 말한다');
  }
  // 자기 자신을 마지막에 싣지 않으면 뒤따르는 체크를 보지 못한다(조용히 좁아진다).
  const at = s.search(new RegExp(`checks\\.${SELF_CHECK}\\s*=`));
  if (at >= 0) {
    const tail = s.slice(at + 1);
    const later = [...tail.matchAll(/checks\.([A-Za-z_$][\w$]*)\s*=/g)].map((m) => m[1]);
    for (const name of later) {
      problems.push(`checks.${name} 이(가) ${SELF_CHECK} **뒤에** 실린다 — 그 체크는 판정에서 빠진다`);
    }
  }
  return problems;
}
