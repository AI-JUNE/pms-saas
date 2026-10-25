/**
 * evidencePreservation.ts — 조사 근거를 **보존했는가**(RUNBOOK §3-15·§3-5). 2026-10-25
 *
 * ── 왜 필요한가 ───────────────────────────────────────────────────────────────
 * §3 절차에서 **되돌릴 수 없는 일**은 둘이다. 하나는 8단계 2번의 대외 고지(§3-10 이
 * 「유일하게 되돌릴 수 없는 산출물」이라 적어 두었다), 다른 하나는 **5단계 전환으로
 * 사라지는 감사 이력**이다. `audit_log` 는 복구 대상과 같은 DB·같은 브랜치에 있어
 * `created_at > T-ε` 기록이 전부 없어지고, `recoveryVerify.CORE_TABLE_ROLES` 는 이
 * 테이블을 「사후 조사·법적 보존 대상이라 **재생성이 불가능하다**」고 스스로 선언해 두었다.
 * 그래서 §3 1단계는 「**3단계로 넘어가기 전에** 아래 3-5 의 보존을 먼저 한다」고 지시한다.
 *
 * 그런데 **그 보존을 했는지는 어디에도 남지 않았다.**
 *
 *  (1) **표지가 없는 유일한 단계였다.** §3 은 복구 중에만 들어 있는 시각 기록 5개를 단계마다
 *      하나씩 남기고(2·3·6-1·6-2·8단계 2번) §3-14 가 그 다섯을 귀속까지 본다. 그런데 그중
 *      어느 것도 §3-5 를 가리키지 않는다 — **되돌릴 수 없는 두 일 중 한쪽에만** 수행 근거가
 *      있었다. 전환 뒤에는 보존했는지 묻는 수단도, 물어서 알아낼 사실도 남지 않는다.
 *
 *  (2) **그 보존본을 유일한 출처로 삼는 뒷단계가 「수행됨」으로 보인다.** 6-1단계 2번은
 *      「대상은 **§3-5 보존본의** 보안 이벤트에서 추린다」고 적혀 있다. 보존을 거르면 전환 뒤
 *      그 목록을 만들 방법이 없는데, `RECOVERY_SECURITY_REAPPLIED_AT` 는 그래도 적을 수 있고
 *      그러면 `state: recorded` + §3-14 의 `recordCorroborated: true` 가 나온다 —
 *      **할 수 없었던 단계가 「이번 사건에 수행됐다」로 보고되고** 7단계 문이 열린다.
 *
 *  (3) **「끝까지 받았는가」도 응답 한 번뿐이었다.** §3-5 3번은 `capture.verdict` 가
 *      `truncated` 인 채로 전환하지 말라고 하는데(잘려 나가는 쪽이 바로 「T 직전」이다),
 *      그 판정은 조회 응답에만 있다. 전환 뒤에는 **끝까지 받았는지 물을 자리가 없다.**
 *
 *  (4) **보존을 차단 전에 받으면 구간의 끝부분이 빠진다.** 1단계는 「3단계 전에」까지만
 *      말하므로 2단계 차단 **전에** 내보내도 절차를 지킨 것이 된다. 그러면 받은 시각부터
 *      차단까지 들어온 쓰기의 감사 행이 보존본에 없고, 그 구간은 §3-7 유실 구간의 **끝부분** —
 *      즉 「무엇이 사라졌는가」를 말해 줄 기록이 **사라지는 쪽에만** 남는다. 조회(GET)는
 *      차단 중에도 열려 있으므로(`writeFreeze` 는 쓰기만 막는다) 차단 **뒤에** 받으면 된다.
 *
 * 그래서 이 모듈은 §3-5 에 **표지 하나**를 주고(여섯 번째 시각 기록), 그 표지를 §3-14 의
 * 앵커(2단계 차단 실효 시각)에 견주어 귀속·보존 범위를 판정한 뒤, 이미 있는 두 체크가
 * 자기 자리에서 함께 말하게 한다.
 *
 * 원칙
 * - 순수 모듈: DB·next·fs 미접근, 신규 조회·쓰기·DDL 0, **신규 `/api/health` 체크 0**.
 *   같은 국면을 `checks.incidentClosure`·`checks.postRestoreSecurity` 가 이미 보고한다.
 * - **판정 어휘와 `ok` 를 바꾸지 않는다.** 두 체크의 `state`·`ok` 는 그대로다 — 달라지는 것은
 *   **다음에 할 일**이다. 보존은 사람이 하고 코드가 대신할 수 없으므로, 미기록으로 `ok` 를
 *   내리면 복구일에 거짓 차단이 된다.
 * - **주장과 사실을 구분한다.** 이 표지는 사람이 적은 **주장**이고, 보존본의 존재·완전성·
 *   보관 위치를 코드가 확인한 것이 아니다 — `PRESERVATION_LIMITS` 로 함께 내보낸다.
 * - 보관 위치·티켓 번호·행위자는 **담지 않는다**(공개 응답에 나가고, 보관소는 접근통제 대상이다).
 */
import { EVIDENCE_TABLE, parseInstant } from './incidentEvidence.ts';
import { ANCHOR_ENV, assessTimeline, markerCorroboration, type CorroborationBasis } from './incidentTimeline.ts';
import { writeFreezeEnabled } from './writeFreeze.ts';

/** 응답·문서에서 근거 절을 찾을 수 있게 한다 */
export const PRESERVATION_RUNBOOK_REF = 'RUNBOOK §3-15·§3-5';

/**
 * §3-5 보존을 **마친** 시각(타임존 붙인 ISO). §3-14 의 여섯 번째 시각 기록이고
 * 8단계 4번이 지우라고 지시하는 표지에 함께 들어간다.
 */
export const PRESERVED_AT_ENV = 'RECOVERY_EVIDENCE_PRESERVED_AT';

/* ─────────────────────────── 사라지는 근거의 출처 ─────────────────────────── */

export interface EvidenceSource {
  /** 받는 경로 */
  path: string;
  /** 그 경로가 보는 범위 */
  scope: string;
  /** 끝까지 받았는지 보는 칸 */
  completeness: string;
  /** 5단계 전환 뒤의 상태 */
  afterSwitch: string;
}

/**
 * 전환이 되돌리는 **조사 근거**의 출처 전건. 둘 다 같은 DB·같은 브랜치에 있다 —
 * 그래서 보존은 「DB 밖으로 내보내기」여야 하고, 같은 DB 안의 테이블·메모로 옮겨 적으면
 * 함께 사라진다(그 사실을 코드는 확인할 수 없다 — `PRESERVATION_LIMITS` 참조).
 */
export const EVIDENCE_SOURCES: readonly EvidenceSource[] = [
  {
    path: 'GET /api/audit?from=…&to=…&limit=…&cursor=…',
    scope: `조직 스코프의 업무 데이터 변경 이력(\`${EVIDENCE_TABLE}\`)`,
    completeness: '`capture.verdict` 가 `complete` · `capture.nextCursor` 가 null',
    afterSwitch: '복구 시점 이후의 행이 없어진다 — 비어 있는 것이 아니라 **「아무 일도 없었던 것처럼」** 보인다',
  },
  {
    path: 'GET /api/admin/security-events?…&cursor=…',
    scope: '보안·인증 이벤트(슈퍼관리자 전용)',
    completeness: '응답 `nextCursor` 가 null',
    afterSwitch: '6-1단계 2·3번이 대상을 추릴 **유일한 출처**가 사라진다',
  },
];

/* ──────────────────── 보존본이 없으면 할 수 없게 되는 일 ──────────────────── */

export interface EvidenceDependent {
  /** 그 일을 지시하는 자리 */
  step: string;
  /** 보존본에서 가져오는 것 */
  needs: string;
  /** 보존을 거른 채 전환했을 때 생기는 일 */
  ifMissing: string;
  /** 그때 **어떤 검증이라도 실패하는가** */
  failsLoudly: boolean;
}

/**
 * 전건 `failsLoudly: false` 다 — 보존을 거른 복구에서 **아무 응답도 달라지지 않는다**.
 * 4단계는 행 수만 세고(§3-11), 6단계 스키마는 `ok` 이고, 6-1·6-2단계의 시각은 그래도 적을 수 있다.
 */
export const EVIDENCE_DEPENDENTS: readonly EvidenceDependent[] = [
  {
    step: '§3 6-1단계 2번(대응 중 바꾼 비밀번호 재적용)',
    needs: '「대상은 §3-5 보존본의 보안 이벤트에서 추린다」 — 대상 계정 목록',
    ifMissing:
      '목록을 만들 방법이 없는데 `RECOVERY_SECURITY_REAPPLIED_AT` 는 적을 수 있다 — ' +
      '`state: recorded` + `recordCorroborated: true` 가 나오고, **할 수 없었던 단계가 수행된 것으로** 7단계 문을 연다',
    failsLoudly: false,
  },
  {
    step: '§3 6-1단계 3번(복구 시점 이후 발급된 재설정 토큰 무효화)',
    needs: '그 구간에 발급된 토큰의 발급 이력',
    ifMissing: '`used_at` 이 지워져 되살아난 링크 중 **어느 것이 그 구간의 것인지** 가릴 수 없다',
    failsLoudly: false,
  },
  {
    step: '§3 4단계·§3-11(행 수 감소의 뜻)',
    needs: '감소분을 설명하는 삭제 이력',
    ifMissing:
      '「감소분을 감사로그로 설명할 수 있을 때만 전환한다」가 **설명할 근거 없이** 통과한다 — ' +
      '정상 삭제와 손상이 같은 `short` 로 보인다',
    failsLoudly: false,
  },
  {
    step: '§3 8단계 3번·§6 표(사건·조치 기록)',
    needs: '원인 작업·대응 이력',
    ifMissing: '§6 표의 사건 기록을 **사람 기억으로** 적게 되고, 그 표가 다음 복구의 유일한 선례다',
    failsLoudly: false,
  },
  {
    step: '§3 1단계(손상 범위 재특정)',
    needs: '손상을 일으킨 작업의 기록',
    ifMissing: '전환 뒤 재조사가 불가능해진다 — 같은 원인이 다시 일어났는지 비교할 대상이 없다',
    failsLoudly: false,
  },
];

/* ─────────────────────────── 판정 ─────────────────────────── */

/**
 * 어휘를 `incidentClosure.CLOSURE_STATES`·`postRestoreSecurity.REAPPLY_STATES` 와 **같게** 둔다 —
 * 담당자가 보는 칸이 같은 자리(`checks.*.detail`)라서, 여기서만 다른 낱말을 쓰면 같은 모양의
 * 상태가 두 어휘로 갈린다.
 */
export const PRESERVATION_STATES = ['normal', 'pending', 'recorded', 'invalid_record', 'stale_record'] as const;
export type PreservationState = (typeof PRESERVATION_STATES)[number];

const STATE_NOTE: Record<PreservationState, string> = {
  normal: `평상시 — 차단 OFF, 보존 기록 없음. ${PRESERVED_AT_ENV} 는 복구 중에만 들어 있는 값이다`,
  pending:
    `쓰기 차단 중인데 ${PRESERVED_AT_ENV} 가 비어 있다 — **3단계(브랜치 생성)로 넘어가기 전에** ` +
    '§3-5 의 내보내기를 끝내고 이 시각을 적는다. 5단계 전환 뒤에는 그 이력이 없어지고, ' +
    '보존했는지 **물을 자리조차 남지 않는다**',
  recorded:
    '차단 중이고 보존을 마친 시각이 기록돼 있다 — 6-1단계 2·3번이 대상을 추릴 출처가 있다는 뜻이다' +
    '(보존본의 완전성은 이 값이 보장하지 않는다)',
  invalid_record: `${PRESERVED_AT_ENV} 값을 읽을 수 없다 — 타임존을 붙인 ISO 시각으로 다시 넣는다`,
  stale_record:
    `차단은 OFF 인데 ${PRESERVED_AT_ENV} 가 남아 있다 — 사건 기록(§3 8단계)을 마쳤으면 지운다. ` +
    '남겨 두면 다음 사건에서 **옛 시각이 「보존했다」는 근거**로 쓰인다(§3-14)',
};

/** 보존본이 유실 구간의 **끝까지** 덮는가 */
export const COVERAGE_VERDICTS = ['ok', 'uncovered', 'unknown'] as const;
export type CoverageVerdict = (typeof COVERAGE_VERDICTS)[number];

export interface CoverageAssessment {
  verdict: CoverageVerdict;
  /** 보존본이 덮지 못한 구간(분). `uncovered` 일 때만 수치이고 그 밖에는 null — 지어내지 않는다 */
  minutes: number | null;
  text: string;
}

const COVERAGE_NOTE: Record<CoverageVerdict, string> = {
  ok: '보존이 차단 **뒤에** 끝났다 — 유실 구간의 끝까지 덮는다(끝까지 받았는지는 `capture.verdict` 의 몫이다)',
  uncovered:
    '보존 시각이 차단 **앞**이다 — 이번 보존을 차단 전에 받았다면 그 뒤 차단까지 들어온 쓰기의 감사 행이 ' +
    '보존본에 없고, 그 구간은 유실 구간의 **끝부분**이라 전환과 함께 사라진다(조회는 차단 중에도 열려 ' +
    '있으니 **다시 받는다**). 값이 지난 사건의 표지라면 그 수치는 구간이 아니라 **사건 사이의 간격**이다',
  unknown: '두 시각 중 하나를 읽을 수 없어 범위를 말하지 않는다 — 「덮었다」로 올리지 않는다',
};

/**
 * 보존 시각과 앵커(차단 실효 시각)의 차이.
 *
 * ※ 이 수치는 **두 시각의 차이**일 뿐이다 — 보존 기록이 지난 사건의 값이면(`carried_over`)
 *   구간이 아니라 **사건 사이의 간격**이다. 그래서 귀속(`basis`)과 **함께** 읽어야 한다.
 */
export function coverageGap(preservedAt: unknown, anchorAt: unknown): CoverageAssessment {
  const p = parseInstant(preservedAt);
  const a = parseInstant(anchorAt);
  if (!p || !a) return { verdict: 'unknown', minutes: null, text: COVERAGE_NOTE.unknown };
  const diffMin = Math.round((a.getTime() - p.getTime()) / 60000);
  if (diffMin <= 0) return { verdict: 'ok', minutes: null, text: COVERAGE_NOTE.ok };
  return { verdict: 'uncovered', minutes: diffMin, text: COVERAGE_NOTE.uncovered };
}

export const ACTION_PRESERVE_NORMAL =
  `평상시 상태다 — ${PRESERVED_AT_ENV} 는 복구·리허설 중에만 넣고 8단계 4번에서 지운다`;
export const ACTION_PRESERVE_PENDING =
  '§3-5 의 내보내기를 **지금** 끝내고(차단 중에도 조회는 열려 있다) 마친 시각을 ' +
  `${PRESERVED_AT_ENV} 에 적는다 — 3단계로 넘어가면 보존 대상이 줄고, 5단계 전환 뒤에는 되찾을 수 없다`;
export const ACTION_PRESERVE_RECORDED =
  '보존 기록이 있다 — 6-1단계 2·3번의 대상 목록을 그 보존본에서 추린다. ' +
  '`capture.verdict` 가 `complete` 였는지는 이 값이 말해 주지 않는다';
export const ACTION_PRESERVE_INVALID =
  `${PRESERVED_AT_ENV} 를 타임존 붙인 ISO 시각으로 다시 적는다 — 판독 불가를 「없다」로도 「있다」로도 세지 않는다`;
export const ACTION_PRESERVE_STALE =
  `${PRESERVED_AT_ENV} 를 지운다(§3 8단계 4번) — 남겨 두면 다음 사건에서 **보존하지 않은 복구가 ` +
  '「보존했다」로** 보이고, 그 경고는 차단을 켜는 순간 사라진다(§3-14)';
/**
 * 차단보다 **앞선** 보존 시각 하나에 두 가지 사실이 겹쳐 있다 — 지난 사건의 표지가 남은 것이거나,
 * 이번 보존을 **차단 전에** 받은 것이다(타임존 누락도 같은 모습이다). **코드는 구분할 수 없다.**
 * 그래서 할 일을 하나로 적는다 — 두 경우 모두 「차단 뒤로 다시 받고, 시각을 다시 적는다」로 끝난다.
 */
export const ACTION_PRESERVE_BEFORE_ANCHOR =
  '보존 기록이 **이번 차단보다 앞선** 값이다 — 지난 복구의 표지이거나, 보존을 차단 **전에** 받은 것이거나, ' +
  '타임존을 붙이지 않고 적은 값이다(코드는 셋을 구분하지 못한다). 어느 쪽이든 **차단 뒤로 다시 받아** ' +
  '보존본을 잇고 시각을 다시 적는다 — 빠진 구간이 바로 「무엇이 사라졌는가」를 말해 줄 기록이다. ' +
  '6-1단계 2번의 대상 목록을 이 값으로 「있다」고 보지 않는다';
export const ACTION_PRESERVE_UNANCHORED =
  `보존 기록은 있는데 앵커(\`${ANCHOR_ENV}\`)가 없어 **어느 사건의 보존인지 말할 수 없다** — ` +
  '차단 중이면 지금 차단 실효 시각을 적는다(§3 2단계. 해제 뒤에는 알 수 없다)';

export const CAVEAT_CLAIM_NOT_PROOF =
  '이 표지는 사람이 적은 **주장**이다 — 보존본의 존재·완전성·보관 위치를 코드가 확인한 것이 아니다';
export const CAVEAT_TRUNCATION_UNKNOWN =
  '`capture.verdict` 가 `truncated` 였는지는 이 값으로 알 수 없다 — 잘린 쪽이 바로 「T 직전」이다(§3-5 3번)';
export const CAVEAT_OUTSIDE_DB_UNKNOWN =
  '**DB 밖**에 두었는지도 알 수 없다 — 같은 DB 안의 표·메모로 옮겨 적으면 전환과 함께 사라지는데 표지는 `recorded` 다';
export const CAVEAT_CROSS_TENANT_BLIND =
  '`/api/audit` 는 조직 스코프라 **다른 조직의 업무 데이터 변경 이력**은 애초에 받을 수 없다(§3-5 의 한계) — ' +
  '이 표지는 「받을 수 있는 범위를 받았다」까지만 말한다';

export const PRESERVATION_LIMITS: readonly string[] = [
  CAVEAT_CLAIM_NOT_PROOF,
  CAVEAT_TRUNCATION_UNKNOWN,
  CAVEAT_OUTSIDE_DB_UNKNOWN,
  CAVEAT_CROSS_TENANT_BLIND,
  '차단보다 **앞선** 보존 시각은 「지난 사건의 표지」·「차단 전에 받은 보존」·「타임존 누락」이 같은 모습이다 — ' +
    '`uncoveredMinutes` 는 둘째일 때만 구간이다',
  `앵커(\`${ANCHOR_ENV}\`)가 없으면 귀속을 말할 수 없다 — 그 자신은 대조 상대가 없다(§3-14 와 같은 한계)`,
  '이 배포의 env 한 벌만 본다 — 다른 스코프에 적어 둔 값은 보이지 않는다(§3-13 과 같은 한계)',
  '`recorded` 는 **보존했다는 기록이 있다**까지이고, 그 보존본으로 6-1단계를 실제로 수행했다는 뜻은 아니다',
];

export interface PreservationAssessment {
  state: PreservationState;
  /** 이 배포가 차단 중인가 */
  frozen: boolean;
  /** 값이 판독 가능하게 들어 있는가 */
  recorded: boolean;
  /** 판독한 보존 시각(ISO). 못 읽으면 null */
  preservedAt: string | null;
  /** 앵커(2단계 차단 실효 시각). 미설정·판독 실패면 null */
  anchorAt: string | null;
  /** 「이 시각이 **이번 사건**의 기록이라고 말할 수 있는가」 — 보존을 했다는 뜻이 아니다 */
  corroborated: boolean;
  basis: CorroborationBasis;
  coverage: CoverageAssessment;
  /** 보존본이 없으면 수행할 수 없게 되는 단계 수 */
  dependentCount: number;
  action: string;
  /**
   * **지금 할 일이 있는가.** 이 값을 두는 이유는 읽는 쪽(두 체크의 `note`)이 「평상시·정상」을
   * 조건식으로 다시 짜면 판정이 두 곳에서 갈리기 때문이다 — 갈린 쪽은 아무 응답도 바꾸지 않아
   * 영구히 남는다.
   */
  actionable: boolean;
  caveats: readonly string[];
}

/**
 * 보존 수행 기록의 판정.
 *
 * 판정 순서: `state`(값이 읽히는가 · 차단 중인가)를 먼저 정하고, **그 뒤에** 다음에 할 일을 고른다.
 * 할 일은 `state` 보다 **귀속·범위가 먼저**다 —
 * 옛 값(`carried_over`)은 「기록이 있다」가 아니라 「지우거나 다시 적는다」이고,
 * 차단 앞에 끝낸 보존(`uncovered`)은 「있다」가 아니라 「이어 받는다」이기 때문이다.
 * 순서를 바꾸면 두 경우가 모두 `ACTION_PRESERVE_RECORDED`(= 「출처가 있다」)로 덮인다.
 */
export function assessPreservation(input?: { env?: Record<string, string | undefined> }): PreservationAssessment {
  const env = input?.env ?? {};
  const frozen = writeFreezeEnabled(env);
  const { raw, at } = preservedAtFromEnv(env);

  let state: PreservationState;
  if (raw && !at) state = 'invalid_record';
  else if (frozen) state = at ? 'recorded' : 'pending';
  else state = at ? 'stale_record' : 'normal';

  const timeline = assessTimeline({ env });
  const corr = markerCorroboration(PRESERVED_AT_ENV, timeline);
  const coverage = coverageGap(at, timeline.anchorAt);

  // 판정 순서: 못 읽는 값 → 비어 있음(차단 중) → **평상시에 남은 값**(그때 할 일은 「지운다」이고
  // 귀속·범위를 묻는 일이 아니다) → 차단보다 앞선 값 → 기준점 없음 → 기록됨.
  // 순서를 바꾸면 (가) 지난 사건의 표지만 남은 평상시가 `unanchored`(= 「지금 적어라」)로 뒤집히고,
  // (나) 차단 전에 받은 보존이 `recorded`(= 「출처가 있다」)로 덮인다.
  let action: string;
  if (state === 'invalid_record') action = ACTION_PRESERVE_INVALID;
  else if (state === 'pending') action = ACTION_PRESERVE_PENDING;
  else if (state === 'stale_record') action = ACTION_PRESERVE_STALE;
  else if (corr.basis === 'carried_over') action = ACTION_PRESERVE_BEFORE_ANCHOR;
  else if (corr.basis === 'unanchored') action = ACTION_PRESERVE_UNANCHORED;
  else if (state === 'recorded') action = ACTION_PRESERVE_RECORDED;
  else action = ACTION_PRESERVE_NORMAL;

  return {
    state,
    frozen,
    recorded: at !== null,
    preservedAt: at,
    anchorAt: timeline.anchorAt,
    corroborated: corr.corroborated,
    basis: corr.basis,
    coverage,
    dependentCount: EVIDENCE_DEPENDENTS.length,
    action,
    actionable: action !== ACTION_PRESERVE_NORMAL && action !== ACTION_PRESERVE_RECORDED,
    caveats: PRESERVATION_LIMITS,
  };
}

/**
 * 기록된 보존 시각. `RECOVERY_EVIDENCE_PRESERVED_AT` 만 인정하고 **기본값을 만들지 않는다**.
 * 형식 밖·비실존 시각은 null — 못 읽는 값을 「기록됨」으로 올리지 않는다.
 */
export function preservedAtFromEnv(env: Record<string, string | undefined> = {}): {
  raw: string | null;
  at: string | null;
} {
  const raw = (env.RECOVERY_EVIDENCE_PRESERVED_AT ?? '').trim();
  if (!raw) return { raw: null, at: null };
  const d = parseInstant(raw);
  return { raw, at: d ? d.toISOString() : null };
}

/* ───────────── 체크가 자기 자리에서 말하는 칸 ───────────── */

/**
 * 6-1단계가 **대상 목록을 가져올 출처가 있는가**. `checks.postRestoreSecurity.detail` 이
 * 이 값을 함께 말한다 — 그 체크의 `recorded` 는 「시각을 적었다」까지이고,
 * 적을 수 있었다는 사실이 **추릴 수 있었다**는 뜻은 아니다.
 *
 * - `available`   : 이번 사건의 보존 기록이 있다(완전성은 보장하지 않는다)
 * - `unrecorded`  : 차단 중인데 보존 기록이 없다 — 대상 목록의 출처가 기록되지 않았다
 * - `carried_over`: 옛 사건의 보존 기록이다 — 이번 사건의 출처로 쓸 수 없다
 * - `unreadable`  : 들어 있으나 읽을 수 없다
 * - `not_applicable`: 평상시(차단 OFF·미기록) — 물을 일이 없다
 */
export const EVIDENCE_AVAILABILITIES = [
  'available',
  'unrecorded',
  'carried_over',
  'unreadable',
  'not_applicable',
] as const;
export type EvidenceAvailability = (typeof EVIDENCE_AVAILABILITIES)[number];

const AVAILABILITY_NOTE: Record<EvidenceAvailability, string> = {
  available: '§3-5 보존 기록이 있다 — 6-1단계 2·3번의 대상을 그 보존본에서 추린다',
  unrecorded:
    '§3-5 보존 기록이 없다 — 6-1단계 2·3번이 **대상을 추릴 출처 없이** 「완료」로 적힐 수 있다. ' +
    `전환 전이면 지금 내보내고 ${PRESERVED_AT_ENV} 에 적는다(§3-15)`,
  carried_over:
    `${PRESERVED_AT_ENV} 가 이번 차단보다 앞선 값이다 — 이번 사건의 출처로 쓸 수 없다(§3-14)`,
  unreadable: `${PRESERVED_AT_ENV} 를 읽을 수 없다 — 출처가 있는지 판정하지 않는다`,
  not_applicable: '평상시 — 보존 기록을 물을 국면이 아니다',
};

export interface EvidenceAvailabilityResult {
  availability: EvidenceAvailability;
  note: string;
}

/** 위 판정에서 **출처 유무**만 뽑는다(시각은 담지 않는다) */
export function evidenceAvailability(a: PreservationAssessment): EvidenceAvailabilityResult {
  // 6-1단계는 **차단 중에만** 하는 일이다(7단계 해제가 그 뒤다) — 그래서 차단이 걸려 있지 않으면
  // 묻지 않는다. 평상시에 남은 표지(`stale_record`)를 `available` 로 돌려주면 「출처가 있다」가
  // 사건과 무관하게 떠 있게 되고, 그 상태의 할 일(「지운다」)은 §3-15 쪽이 이미 말한다.
  let availability: EvidenceAvailability;
  if (a.state === 'invalid_record') availability = 'unreadable';
  else if (!a.frozen) availability = 'not_applicable';
  else if (a.basis === 'carried_over') availability = 'carried_over';
  else if (a.state === 'pending') availability = 'unrecorded';
  else if (a.recorded) availability = 'available';
  else availability = 'not_applicable';
  return { availability, note: AVAILABILITY_NOTE[availability] };
}

/* ─────────────────────────── 출력 ─────────────────────────── */

/** 로그 한 줄. 판정·개수만 — **시각은 담지 않는다** */
export function preservationLine(a: PreservationAssessment): string {
  const parts = [
    `evidence=${a.state}`,
    `corroborated=${a.corroborated}`,
    `basis=${a.basis}`,
    `coverage=${a.coverage.verdict}`,
    `frozen=${a.frozen}`,
  ];
  if (a.coverage.minutes !== null) parts.push(`uncoveredMin=${a.coverage.minutes}`);
  return `[evidence] ${parts.join(' ')}`;
}

/** 사람이 읽는 요약(§3-15 의 1줄 명령이 출력하는 것) */
export function preservationText(a: PreservationAssessment): string {
  const lines = [
    `[${a.state}] 보존 기록 ${a.preservedAt ?? '(미설정)'} · 앵커 ${a.anchorAt ?? '(미설정)'} · 귀속 ${a.basis}`,
    `· 보존 범위: ${a.coverage.verdict}${a.coverage.minutes === null ? '' : `(덮지 못한 구간 ${a.coverage.minutes}분)`} — ${a.coverage.text}`,
    `· 보존본 없이는 수행할 수 없는 단계 ${a.dependentCount}건(전건 **조용히** 통과한다)`,
    `→ ${a.action}`,
  ];
  for (const c of a.caveats) lines.push(`※ ${c}`);
  return lines.join('\n');
}

/**
 * 공개 응답용 필터 — **새로 시각을 노출하지 않는다**. 보관 위치·티켓 번호는 애초에 담지 않는다.
 */
export function publicPreservation(a: PreservationAssessment): {
  state: PreservationState;
  recorded: boolean;
  corroborated: boolean;
  basis: CorroborationBasis;
  coverage: CoverageVerdict;
  uncoveredMinutes: number | null;
  dependentCount: number;
  runbook: string;
} {
  return {
    state: a.state,
    recorded: a.recorded,
    corroborated: a.corroborated,
    basis: a.basis,
    coverage: a.coverage.verdict,
    uncoveredMinutes: a.coverage.minutes,
    dependentCount: a.dependentCount,
    runbook: PRESERVATION_RUNBOOK_REF,
  };
}

/** 배선 상태 요약(문서·보고용) */
export function preservationStatus(env: Record<string, string | undefined> = {}): {
  state: PreservationState;
  recordKey: string;
  sources: number;
  dependents: number;
  limits: number;
  action: string;
} {
  const a = assessPreservation({ env });
  return {
    state: a.state,
    recordKey: PRESERVED_AT_ENV,
    sources: EVIDENCE_SOURCES.length,
    dependents: EVIDENCE_DEPENDENTS.length,
    limits: PRESERVATION_LIMITS.length,
    action: a.action,
  };
}

/* ─────────────────────────── 정적 점검 ─────────────────────────── */

/** 정본 자신의 모양 — 출처·의존 단계가 설명 없이 비어 있지 않은지 */
export function auditPreservationCanon(
  sources: readonly EvidenceSource[] = EVIDENCE_SOURCES,
  dependents: readonly EvidenceDependent[] = EVIDENCE_DEPENDENTS,
): string[] {
  const problems: string[] = [];
  if (sources.length === 0) problems.push('근거 출처 정본이 비었다 — 무엇을 보존해야 하는지 적을 자리가 사라졌다');
  for (const s of sources) {
    if (!s.completeness.trim()) problems.push(`${s.path} 에 「끝까지 받았는지」 보는 칸이 적혀 있지 않다`);
    if (!s.afterSwitch.trim()) problems.push(`${s.path} 에 전환 뒤의 상태가 적혀 있지 않다`);
  }
  if (dependents.length === 0) problems.push('의존 단계 정본이 비었다');
  for (const d of dependents) {
    if (!d.needs.trim()) problems.push(`${d.step} 이 보존본에서 가져오는 것이 적혀 있지 않다`);
    if (!d.ifMissing.trim()) problems.push(`${d.step} 의 미보존 결과가 적혀 있지 않다`);
    if (d.failsLoudly) {
      problems.push(
        `${d.step} 이 failsLoudly: true 로 선언돼 있다 — 실패하는 검증이 있다면 이 모듈이 아니라 그 검증을 가리켜야 한다`,
      );
    }
  }
  return problems;
}

/** 표지 정본(`healthDisclosure.INCIDENT_MARKERS`)에 들어 있는지 — 순환을 피해 목록을 **받는다** */
export function auditMarkerCoverage(markers: unknown): string[] {
  const rows = Array.isArray(markers) ? markers : [];
  if (rows.length === 0) return ['사건 표지 목록을 읽을 수 없다 — INCIDENT_MARKERS 의 모양이 바뀌었으면 이 가드를 함께 볼 것'];
  const row = rows.find((m) => String((m as { key?: unknown })?.key ?? m ?? '') === PRESERVED_AT_ENV) as
    | { kind?: unknown }
    | undefined;
  if (!row) {
    return [`${PRESERVED_AT_ENV} 가 사건 표지에 없다 — 복구 중 무인증 응답에서 가려지지 않는다(§2-3)`];
  }
  return String(row.kind ?? '') === 'record'
    ? []
    : [`${PRESERVED_AT_ENV} 의 판독 방식이 record 가 아니다 — 시각 기록인데 스위치로 읽으면 귀속을 말할 수 없다`];
}

/** 임시 키 정본(`envPresence.TRANSIENT_KEYS`)에 들어 있는지 */
export function auditTransientCoverage(keys: unknown): string[] {
  const list = Array.isArray(keys) ? keys.map((k) => String(k)) : [];
  if (list.length === 0) return ['임시 키 목록을 읽을 수 없다 — TRANSIENT_KEYS 의 모양이 바뀌었으면 이 가드를 함께 볼 것'];
  return list.includes(PRESERVED_AT_ENV)
    ? []
    : [`${PRESERVED_AT_ENV} 가 임시 키 목록에 없다 — 평상시에 거짓 missing 으로, 8단계 4번 삭제가 「설정 유실」로 보고된다`];
}

/**
 * 시각 기록 정본(`incidentTimeline.TIMELINE_MARKERS`)에 **앵커 뒤 기록**으로 들어 있는지.
 * 빠지면 이 표지만 귀속 대조에서 벗어나 옛 값이 영구히 「기록됨」으로 남고,
 * 8단계 4번의 전건 삭제 점검에서도 빠진다.
 */
export function auditTimelineCoverage(markers: unknown): string[] {
  const rows = Array.isArray(markers) ? markers : [];
  if (rows.length === 0) return ['시각 기록 정본을 읽을 수 없다 — TIMELINE_MARKERS 의 모양이 바뀌었으면 이 가드를 함께 볼 것'];
  const row = rows.find((m) => String((m as { key?: unknown })?.key ?? m ?? '') === PRESERVED_AT_ENV) as
    | { relation?: unknown; detectable?: unknown }
    | undefined;
  if (!row) return [`${PRESERVED_AT_ENV} 가 시각 기록 정본에 없다 — 귀속 대조와 8단계 4번 점검에서 빠진다`];
  const problems: string[] = [];
  if (String(row.relation ?? '') !== 'after_anchor') {
    problems.push(
      `${PRESERVED_AT_ENV} 가 after_anchor 로 선언되지 않았다 — 보존은 차단 **뒤에** 하는 일이고, ` +
        '그 관계가 깨지면 옛 값을 가려낼 수 없다',
    );
  }
  if (row.detectable !== true) {
    problems.push(`${PRESERVED_AT_ENV} 가 detectable: true 가 아니다 — 앵커와 대조해 옛 값임을 말할 수 있는 키다`);
  }
  return problems;
}

/** `src/lib/incidentClosure.ts` 원문 — 판정을 **응답에 실어 보내는지**까지 본다 */
export function auditClosureWiring(src: unknown): string[] {
  const s = String(src ?? '');
  const problems: string[] = [];
  if (!/from\s+['"]\.\/evidencePreservation\.ts['"]/.test(s)) {
    problems.push('incidentClosure 가 evidencePreservation 을 import 하지 않는다');
  }
  if (!/assessPreservation\(/.test(s)) problems.push('incidentClosure 가 assessPreservation() 을 호출하지 않는다');
  if (!/evidenceState\s*:/.test(s)) problems.push('incidentClosure 가 evidenceState 를 detail 에 담지 않는다 — 판정만 하고 버린다');
  if (!/evidenceCorroborated\s*:/.test(s)) problems.push('incidentClosure 가 evidenceCorroborated 를 detail 에 담지 않는다');
  if (!/evidenceCoverage\s*:/.test(s)) problems.push('incidentClosure 가 evidenceCoverage 를 detail 에 담지 않는다');
  return problems;
}

/** `src/lib/postRestoreSecurity.ts` 원문 — 6-1단계가 **출처 유무**를 함께 말하는지 */
export function auditSecurityWiring(src: unknown): string[] {
  const s = String(src ?? '');
  const problems: string[] = [];
  if (!/from\s+['"]\.\/evidencePreservation\.ts['"]/.test(s)) {
    problems.push('postRestoreSecurity 가 evidencePreservation 을 import 하지 않는다');
  }
  if (!/evidenceAvailability\(/.test(s)) problems.push('postRestoreSecurity 가 evidenceAvailability() 를 호출하지 않는다');
  if (!/evidenceAvailable\s*:/.test(s)) {
    problems.push('postRestoreSecurity 가 evidenceAvailable 을 detail 에 담지 않는다 — 6-1단계 2번의 출처가 응답에 없다');
  }
  return problems;
}

/**
 * `app/api/health/route.ts` 원문 — **새 체크가 생기지 않았는지**.
 * 같은 국면을 `checks.incidentClosure`·`checks.postRestoreSecurity` 가 이미 보고하므로
 * 체크를 하나 더 만들면 degraded 가 늘고 §6-3 인용 정본도 함께 갈라진다.
 */
export function auditNoNewHealthCheck(src: unknown): string[] {
  const s = String(src ?? '');
  const problems: string[] = [];
  if (/from\s+['"]@\/lib\/evidencePreservation['"]/.test(s)) {
    problems.push('헬스 라우트가 evidencePreservation 을 직접 import 한다 — 판정은 기존 체크 안에서 말한다');
  }
  if (/checks\.evidencePreservation\s*=/.test(s)) {
    problems.push('checks.evidencePreservation 이 새로 생겼다 — degraded 가 늘고 인용 정본이 갈라진다');
  }
  return problems;
}

/**
 * `RUNBOOK.md` 원문 — §3-15 와 그것을 가리키는 단계가 함께 남아 있는지.
 * 특히 **1단계가 보존을 차단 뒤로 못박고 있는지**를 본다 — 「3단계 전에」까지만 남으면
 * 차단 전 내보내기가 절차를 지킨 것이 되고, 그러면 구간의 끝부분이 영구히 사라진다.
 */
export function auditRunbookPreservation(md: unknown): string[] {
  const s = String(md ?? '');
  const problems: string[] = [];

  if (!/^###\s*3-15\./m.test(s)) problems.push('§3-15(근거 보존의 수행 기록) 절이 없다');
  if (!/assessPreservation\(|preservationText\(/.test(s)) problems.push('§3-15 에 보존 판정 산출 명령이 없다');
  if (!s.includes(PRESERVED_AT_ENV)) problems.push(`${PRESERVED_AT_ENV} 가 문서에 없다 — 복구 시 조용히 유실된다`);
  for (const v of PRESERVATION_STATES) {
    if (!new RegExp(`\`${v}\``).test(s)) problems.push(`§3-15 판정 표에 ${v} 행이 없다`);
  }
  for (const v of COVERAGE_VERDICTS) {
    if (!new RegExp(`\`${v}\``).test(s)) problems.push(`§3-15 에 보존 범위 판정 ${v} 가 없다`);
  }
  if (!/evidenceAvailable/.test(s)) {
    problems.push('문서가 evidenceAvailable 을 가리키지 않는다 — 6-1단계 담당자가 출처 유무를 읽을 자리가 없다');
  }

  const sec3 = s.match(/^##\s*3\.\s[\s\S]*?(?=^###\s*3-1\.)/m)?.[0] ?? '';
  if (!sec3) {
    problems.push('§3 본문을 찾지 못했다 — 문서 구조가 바뀌었으면 이 가드를 함께 볼 것');
    return problems;
  }
  const i1 = sec3.search(/^1\.\s/m);
  const step1 = i1 < 0 ? '' : sec3.slice(i1).split(/^2\.\s/m)[0];
  if (!step1) problems.push('§3 1단계를 찾지 못했다');
  else if (!/3-15/.test(step1)) {
    problems.push('1단계가 §3-15 로 유도하지 않는다 — 보존 수행을 기록할 자리를 담당자가 모른다');
  }

  const i2 = sec3.search(/^2\.\s/m);
  const step2 = i2 < 0 ? '' : sec3.slice(i2).split(/^3\.\s/m)[0];
  if (!step2) problems.push('§3 2단계를 찾지 못했다');
  else if (!step2.includes(PRESERVED_AT_ENV)) {
    problems.push(
      `2단계가 ${PRESERVED_AT_ENV} 를 다루지 않는다 — 보존을 차단 **뒤에** 한다는 순서가 사라지면 ` +
        '구간의 끝부분이 보존본에서 빠진다',
    );
  }
  return problems;
}
