/**
 * identityPhase.ts — 기준 지문이 **어느 국면의 기준인가**(RUNBOOK §3-12). 2026-10-24
 *
 * ── 왜 필요한가 ───────────────────────────────────────────────────────────────
 * §3 5단계 「전환」은 `RECOVERY_EXPECTED_DB`(연결 대상 지문)로 확인하게 되어 있고(§3-4),
 * §5 0단계는 그 값이 들어 있으면 **Promote 를 쓰지 말라**고 지시한다. 그 지시의 근거가
 * `deployRollback.rollbackPhase()` 다 — **지문이 들어 있으면 `after_switch`**(= §3 5단계
 * 전환 이후)로 판정한다. 그런데 **같은 값이 평상시에도 들어 있어도 된다**:
 *
 *   · §3-4 마지막 줄: 「복구가 끝난 뒤 `RECOVERY_EXPECTED_DB` 는 **지워도 되고 남겨도 된다.**
 *     남겨 두면 이후 누군가 `DATABASE_URL` 을 바꿨을 때 `mismatch` 로 드러난다(연결 대상 고정).」
 *   · §2 월 점검 4번: 「`RECOVERY_EXPECTED_DB` 를 **남겨 두었다면** `checks.dbIdentity` 가
 *     `match` 인지 함께 본다」 — 평상시에 설정돼 있는 것을 **전제로 매월 확인**하라는 지시다.
 *   · `lib/periodicCheck.ts` `UNDATED_SETTINGS` 도 이 키의 **신선도**를 §2 점검 일자로 추적한다 —
 *     평상시에 남아 있지 않으면 추적할 대상이 없는 항목이다.
 *
 * 즉 **같은 한 값에 세 정본이 서로 다른 뜻을 부여**하고 있었고(평상시 미설정 / 평상시 고정 /
 * 사건 국면), 그 값에는 **언제·왜 들어갔는지가 적히지 않는다** — 12자리 16진수 하나뿐이다.
 * 그래서:
 *
 *  (1) **국면이 평상시로 돌아오지 않는다.** §3 8단계 4번은 지울 표지를 5개 열거하는데
 *      (`RECOVERY_WRITE_FREEZE_AT`·`RECOVERY_RESTORE_POINT`·`RECOVERY_LOSS_NOTICE_AT`·
 *      `RECOVERY_SECURITY_REAPPLIED_AT`·`RECOVERY_EXTERNAL_RECONCILED_AT`) **지문은 그 목록에
 *      없다.** 연결 대상 고정으로 남겨 두는 운용(§3-4 가 권하는 쪽)에서는 `phase` 가 영구히
 *      `after_switch` 이고 `codeOnly` 가 영구히 `false` 다 — §5 0단계의 「Promote 금지」가 평상시에
 *      늘 떠 있어, **정작 사건 중에 아무것도 달라지지 않는다.** §5 5단계가 `DEPLOY_PINNED_COMMIT`
 *      에 대해 「남겨 두면 다음 사건에서 이 체크를 아무도 믿지 않게 된다」고 적어 둔 바로 그
 *      고장인데, 이 키에는 그 삭제 단계가 **어디에도 없다.**
 *  (2) **평상시에 거짓 문장이 나간다.** `assessRollbackRisk` 는 지문이 있으면 `atRisk` 에
 *      `DATABASE_URL` 을 넣고 `CAVEAT_ROLLBACK_LOSES_RECOVERY`(「운영이 **다시 손상된 DB** 를
 *      보게 된다」)를 함께 낸다. 평상시에는 되돌아갈 교체가 없으므로 그 문장은 거짓이고,
 *      `checks.deployPin.detail` 은 공개 응답이다.
 *  (3) **반대쪽도 거짓이다.** §3-4 판정 표는 `unset` 을 「기준 지문 미설정(**평상시 상태**)」이라고
 *      적는데, §2 4번을 수행하는 배포에서 평상시 상태는 `match` 다 — 같은 문서가 평상시를 두
 *      가지로 적어 두었다.
 *
 * 그래서 이 모듈은 **한쪽 운용을 고르지 않는다**(처분 확정은 사람 몫이다). 하는 일은
 *   · 그 세 정본이 이 키에 부여한 뜻을 정본으로 적고(`PHASE_CLAIMS`·`PHASE_CONFLICTS`),
 *   · 지금 들어 있는 지문이 **평상시 고정인지 사건 국면인지 구분할 수 있는가**를 판정하고
 *     (`assessIdentityPhase` → `indistinguishable`),
 *   · 구분할 수 없을 때 **Promote 를 열어 주지 않는다**(판정 어휘 `phase` 는 그대로 두고,
 *     달라지는 것은 **다음에 할 일**이다 — 표지를 한 번도 적지 않은 복구도 표지가 0 이므로
 *     「표지가 없으니 평상시다」로 내려 주면 복구를 조용히 무효화하는 Promote 를 허용한다),
 *   · 그 판정이 거짓으로 읽히는 길을 `PHASE_MISREADS`·`PHASE_LIMITS` 로 함께 내보낸다.
 *
 * 원칙
 * - 순수 모듈: DB·next·fs·`process.env` 미접근. **신규 env 0 · 신규 조회·쓰기·DDL 0 ·
 *   신규 런타임 체크 0** — 이미 들어 있는 env 키의 **이름**만 본다(지문 값은 담지 않는다).
 * - **임의 귀속 금지**: 사건 표지가 0 이면 「평상시다」가 아니라 **「구분할 수 없다」**다.
 * - `deployRollback.ts` 를 import 하지 않는다(그쪽이 이 모듈을 쓴다 — 순환을 만들지 않는다).
 *   사건 표지 정본은 `healthDisclosure.INCIDENT_MARKERS` 와 **테스트가 양방향 대조**한다.
 */
import { EXPECTED_DB_ENV, parseExpected } from './dbIdentity.ts';
import { WRITE_FREEZE_ENV, writeFreezeEnabled } from './writeFreeze.ts';

/** 근거 문서 */
export const PHASE_RUNBOOK_REF = 'RUNBOOK §3-12 기준 지문의 국면(§2 4번·§3-4·§5 0단계와 함께 본다)';

/* ───────────────────────── 사건 표지 정본(이 모듈의 몫) ───────────────────────── */

/**
 * 「지금 §3 사건(또는 §6 리허설) 국면이다」를 **지문과 따로** 말해 주는 env 키.
 *
 * `healthDisclosure.INCIDENT_MARKERS` 의 부분집합이고, 양방향 대조는 테스트가 한다
 * (런타임에 그 모듈을 import 하면 `postRestoreSecurity → deployRollback → 이 모듈` 로
 * 순환이 생긴다 — 정본을 한 벌 더 두는 대신 **어긋나면 CI 가 실패**하게 한다).
 *
 * 지문 키 자신은 **여기에 들어가지 않는다** — 들어가면 §2 4번이 권하는 평상시 고정이
 * §2-3 에서 「사건 중」으로 공표되고, 무인증 응답이 평상시에 사건을 알리게 된다.
 */
export interface PhaseMarker {
  key: string;
  /** `switch` 는 `'true'` 만 ON(실제 읽는 쪽과 똑같이), `record` 는 값이 있으면 표지 */
  kind: 'switch' | 'record';
  /** 이 표지가 들어 있다는 것이 뜻하는 국면 */
  means: string;
  /** §3 8단계 4번이 **지우라고 지시하는가** — 사건이 끝나면 사라지는 표지인가 */
  clearedAtStep8: boolean;
}

export const PHASE_MARKERS: readonly PhaseMarker[] = [
  {
    key: WRITE_FREEZE_ENV,
    kind: 'switch',
    means: '쓰기 차단이 걸려 있다 — §3 2~7단계 진행 중이다',
    clearedAtStep8: false, // 7단계에서 해제한다(8단계가 아니다)
  },
  {
    key: 'RECOVERY_WRITE_FREEZE_AT',
    kind: 'record',
    means: '차단을 건 시각이 적혀 있다 — 사건 타임라인이 열려 있다(§3-7)',
    clearedAtStep8: true,
  },
  {
    key: 'RECOVERY_RESTORE_POINT',
    kind: 'record',
    means: '복구 시점(T-ε)이 적혀 있다 — 유실 구간의 시작이다(§3-10)',
    clearedAtStep8: true,
  },
  {
    key: 'RECOVERY_LOSS_NOTICE_AT',
    kind: 'record',
    means: '유실 고지를 발신한 시각이 적혀 있다(§3 8단계 2번)',
    clearedAtStep8: true,
  },
  {
    key: 'RECOVERY_SECURITY_REAPPLIED_AT',
    kind: 'record',
    means: '보안 상태 재적용 시각이 적혀 있다(§3 6-1단계)',
    clearedAtStep8: true,
  },
  {
    key: 'RECOVERY_EXTERNAL_RECONCILED_AT',
    kind: 'record',
    means: '외부 상태 대조 시각이 적혀 있다(§3 6-2단계)',
    clearedAtStep8: true,
  },
  {
    key: 'RECOVERY_REHEARSAL_ACTIVE',
    kind: 'switch',
    means: '이 배포가 §6-1 리허설 대상으로 선언돼 있다 — 연습 국면이다',
    clearedAtStep8: false, // 리허설 종료 시 사람이 지운다(§6-1)
  },
];

/** 지금 들어 있는 표지의 **키 이름**(값은 담지 않는다) */
export function activePhaseMarkers(env: Record<string, string | undefined>): string[] {
  const out: string[] = [];
  for (const m of PHASE_MARKERS) {
    const on =
      m.kind === 'switch'
        ? m.key === WRITE_FREEZE_ENV
          ? writeFreezeEnabled(env)
          : String(env[m.key] ?? '').trim() === 'true'
        : String(env[m.key] ?? '').trim() !== '';
    if (on) out.push(m.key);
  }
  return out;
}

export function phaseMarkerFor(key: unknown): PhaseMarker | null {
  const k = String(key ?? '');
  return PHASE_MARKERS.find((m) => m.key === k) ?? null;
}

/* ───────────────────────── 세 정본이 하는 말 ───────────────────────── */

export interface PhaseClaim {
  /** 그 말이 적혀 있는 자리(저장소 루트 기준 파일 또는 RUNBOOK 절) */
  source: string;
  says: string;
  /** 「지문이 설정돼 있다」가 그 정본에서 뜻하는 것 */
  whenSet: string;
  /** 「미설정」이 그 정본에서 뜻하는 것 */
  whenUnset: string;
}

/**
 * 이 키에 뜻을 부여하는 자리 전부. **서로 양립하지 않는다**는 사실이 이 표의 내용이다 —
 * 어느 하나가 틀렸다고 단정하지 않고, 사람이 처분을 확정할 때까지 그대로 적어 둔다.
 */
export const PHASE_CLAIMS: readonly PhaseClaim[] = [
  {
    source: 'RUNBOOK §3-4 마지막 줄',
    says: '복구가 끝난 뒤 지문은 **지워도 되고 남겨도 된다**. 남겨 두면 연결 대상이 고정된다',
    whenSet: '평상시 고정일 수도, 전환 직후일 수도 있다(둘을 구분하는 말이 없다)',
    whenUnset: '평상시 상태다(판정 표의 `unset` 행)',
  },
  {
    source: 'RUNBOOK §2 월 점검 4번',
    says: '지문을 **남겨 두었다면** `checks.dbIdentity` 가 `match` 인지 **매월** 함께 본다',
    whenSet: '평상시다 — 매월 확인하는 연결 대상 고정값이다',
    whenUnset: '확인할 대상이 없다 — 이 점검 단계가 아무것도 말하지 않는다',
  },
  {
    source: 'src/lib/periodicCheck.ts UNDATED_SETTINGS',
    says: '자기 날짜를 품지 않는 설정값이라 신선도를 §2 점검 일자로 추적한다',
    whenSet: '평상시다 — 추적할 값이 있다',
    whenUnset: '추적 대상이 없다(판정은 그대로 돈다)',
  },
  {
    source: 'src/lib/deployRollback.ts rollbackPhase()',
    says: '지문이 들어 있으면 **§3 5단계 전환 이후**(`after_switch`)로 판정한다',
    whenSet: '사건 국면이다 — §5 0단계가 Promote 를 금지하고 `codeOnly` 가 false 가 된다',
    whenUnset: '평상시다(`normal`)',
  },
  {
    source: 'RUNBOOK §3 8단계 4번',
    says: '사건 표지 5개를 지우라고 열거한다 — **지문은 그 목록에 없다**',
    whenSet: '사건이 끝나도 남는다 — 국면이 평상시로 돌아오는 단계가 절차에 없다',
    whenUnset: '해당 없음(지우는 지시가 애초에 없다)',
  },
  {
    source: 'src/lib/envRegistry.ts RECOVERY_EXPECTED_DB',
    says: '복구 목록에 등록된 `config` 키다 — 유실 시 전환 반영을 기계적으로 확인할 수 없다',
    whenSet: '전환 확인에 쓰인다',
    whenUnset: '확인 수단이 없다',
  },
];

export interface PhaseConflict {
  key: string;
  between: readonly [string, string];
  /** 두 말이 함께 참일 수 없는 이유 */
  why: string;
  /** 그래서 **무엇이 조용히 틀리는가** */
  effect: string;
}

export const PHASE_CONFLICTS: readonly PhaseConflict[] = [
  {
    key: 'normal_pin_reads_as_incident',
    between: ['RUNBOOK §2 4번 · §3-4(평상시에 남겨도 된다)', 'rollbackPhase()(설정 = 전환 이후)'],
    why: '평상시에 남겨 두는 값을 사건 국면의 단독 근거로 쓰고 있다 — 그 값에는 일자도 사유도 없다',
    effect:
      '`phase` 가 영구히 `after_switch` 로 굳어 §5 0단계의 Promote 금지가 평상시에 늘 떠 있다 — ' +
      '정작 사건 중에 응답이 달라지지 않아 그 경고를 아무도 읽지 않게 된다',
  },
  {
    key: 'no_clear_step',
    between: ['RUNBOOK §3 8단계 4번(표지를 지운다)', 'rollbackPhase()(지문이 국면을 만든다)'],
    why: '국면을 만드는 값이 국면을 끝내는 단계의 목록에 없다',
    effect: '지우는 운용을 택해도 **지우는 시점이 절차에 없어** 담당자마다 달라진다(§5 5단계에는 그 단계가 있다)',
  },
  {
    key: 'two_normals',
    between: ['RUNBOOK §3-4 판정 표(`unset` = 평상시 상태)', 'RUNBOOK §2 4번(평상시에 `match` 를 본다)'],
    why: '같은 문서가 평상시 상태를 `unset` 과 `match` 둘로 적어 두었다',
    effect: '어느 쪽이 평상시인지 모르는 채로 §2 4번을 거르면, 거른 사실이 어느 판정에도 나타나지 않는다',
  },
];

export function conflictFor(key: unknown): PhaseConflict | null {
  const k = String(key ?? '');
  return PHASE_CONFLICTS.find((c) => c.key === k) ?? null;
}

/* ───────────────────────── 거짓이 되는 판정 ───────────────────────── */

export interface PhaseMisread {
  reads: string;
  as: string;
  butWhen: string;
  instead: string;
}

export const PHASE_MISREADS: readonly PhaseMisread[] = [
  {
    reads: '`checks.deployPin.detail.phase: after_switch`',
    as: '지금 §3 복구 중(전환 이후)이다',
    butWhen: '지문을 연결 대상 고정으로 남겨 둔 평상시 배포(§3-4 가 권하는 운용)',
    instead: '`phaseCorroborated` 가 false 면 **구분되지 않은 상태**다 — 사건 표지(§3-12)를 함께 본다',
  },
  {
    reads: '`codeOnly: false`',
    as: '지금 배포를 되돌리면 DB 설정이 함께 되돌아간다',
    butWhen: '평상시 고정뿐일 때 — 되돌아갈 `DATABASE_URL` 교체가 애초에 없다',
    instead: '표지가 0 이면 「되돌아갈 교체가 있는지 모른다」다 — 그래도 Promote 는 열지 않는다',
  },
  {
    reads: '`atRisk` 에 들어 있는 `DATABASE_URL`',
    as: '롤백하면 운영이 다시 손상된 DB 를 본다',
    butWhen: '평상시 — 손상된 DB 도, 교체 이력도 없다',
    instead: '그 문장(`CAVEAT_ROLLBACK_LOSES_RECOVERY`)은 사건 국면에서만 참이다',
  },
  {
    reads: '`phase` 가 `normal` 로 돌아오는 것',
    as: '사건이 끝났다',
    butWhen: '지문을 남기는 운용 — **영원히 돌아오지 않는다**(8단계 4번에 그 키가 없다)',
    instead: '사건 종료는 §3-10 `canClearMarkers`·표지 5개의 소멸이 말한다 — 지문은 말하지 않는다',
  },
  {
    reads: '`checks.dbIdentity.detail.verdict: unset`',
    as: '평상시 상태다(§3-4 판정 표)',
    butWhen: '§2 4번을 수행하는 배포 — 평상시 상태는 `match` 이고 `unset` 은 **고정을 잃은 것**이다',
    instead: '어느 쪽이 평상시인지는 **처분을 확정한 뒤에만** 말할 수 있다(사람 몫)',
  },
  {
    reads: '사건 표지가 0 인 것',
    as: '사건이 아니다',
    butWhen: '§3 2·3단계 기록을 한 번도 적지 않은 복구 — 표지는 0 인데 전환은 끝났다',
    instead: '`indistinguishable` 은 **판정하지 않았다**는 뜻이다 — Promote 를 열어 주지 않는다',
  },
];

export function misreadFor(reads: unknown): PhaseMisread | null {
  const r = String(reads ?? '');
  return PHASE_MISREADS.find((m) => m.reads === r) ?? null;
}

/* ───────────────────────────── 판정 ───────────────────────────── */

/**
 * - `absent`            : 지문 미설정. 국면 판정의 근거가 없다(§2 4번의 확인 대상도 없다).
 * - `incident`          : 지문이 있고 **사건 표지가 따로 있다** — 국면은 그 표지가 말한다.
 * - `unreadable`        : 지문이 있으나 읽을 수 없다(연결 문자열·형식 밖). 고정으로도 사건으로도 세지 않는다.
 * - `indistinguishable` : 지문만 있다 — **평상시 고정과 전환 이후를 구분할 수 없다**.
 */
export const PHASE_VERDICTS = ['absent', 'incident', 'unreadable', 'indistinguishable'] as const;
export type PhaseVerdict = (typeof PHASE_VERDICTS)[number];

/** 국면 판정이 **무엇에 근거하는가** */
export const PHASE_BASES = ['none', 'markers', 'fingerprint_only', 'unreadable_value'] as const;
export type PhaseBasis = (typeof PHASE_BASES)[number];

export const ACTION_PHASE_ABSENT =
  `지문이 들어 있지 않다 — §3-4 판정 표가 「평상시」라 부르는 상태다. 다만 §2 월 점검 4번의 ` +
  '`match` 확인은 **수행해도 아무것도 말하지 않는다**(확인할 대상이 없다). 연결 대상 고정을 쓰려면 ' +
  `§3-4 의 산출 명령으로 지문을 넣고, 쓰지 않기로 했다면 §2 4번에서 그 줄을 지운다`;

export const ACTION_PHASE_INCIDENT =
  '사건·연습 국면이다(지문과 따로 표지가 들어 있다) — §5 Promote 를 쓰지 않고 `git revert` 재배포만 쓴다. ' +
  '§3 8단계 4번에서 표지를 지우기 전에 `checks.lossNotice.detail.canClearMarkers` 를 먼저 본다';

export const ACTION_PHASE_UNREADABLE =
  `\`${EXPECTED_DB_ENV}\` 를 지문으로 읽을 수 없다 — 12자리 16진수만 넣는다(연결 문자열은 거절된다). ` +
  '국면도 전환 확인도 이 값으로는 하지 못한다 — §3-4 의 산출 명령으로 다시 넣는다';

export const ACTION_PHASE_INDISTINGUISHABLE =
  '지문만 들어 있고 사건 표지는 하나도 없다 — **평상시 고정(§3-4·§2 4번)인지 §3 5단계 전환 이후인지 ' +
  '이 값만으로는 구분할 수 없다**(지문에는 일자도 사유도 없다). 그래서 §5 0단계의 Promote 금지는 ' +
  '**그대로 닫아 둔다** — 표지를 적지 않은 복구도 이 상태로 보인다. 지금이 평상시인지 확인하려면 ' +
  '`checks.dbIdentity.detail.verdict` 가 `match` 인지와 §6 표의 마지막 사건 행을 보고, ' +
  '사건이 끝난 것이면 §3 8단계 4번에서 **처분(지운다/남긴다)을 확정**한다 — 그 확정은 사람 몫이다';

export const CAVEAT_NO_TIMESTAMP =
  `\`${EXPECTED_DB_ENV}\` 에는 **언제·왜 들어갔는지가 없다** — 12자리 16진수 하나뿐이다. ` +
  '이 판정은 그 값과 다른 env 표지의 **이름**만 보고, 들어간 경위를 추측하지 않는다(신규 env 를 만들지 않았다)';

export const CAVEAT_MARKERS_ARE_NOT_PROOF =
  '사건 표지가 0 이라는 것이 「사건이 아니다」는 뜻은 아니다 — §3 2·3단계 기록을 거른 복구도 0 이다. ' +
  '반대로 표지가 남아 있는 것이 「복구 중」이라는 뜻도 아니다(8단계 4번을 거른 과거 사건의 잔류일 수 있다 — ' +
  '그쪽은 `stale_record` 가 말한다)';

export const PHASE_LIMITS: readonly string[] = [
  CAVEAT_NO_TIMESTAMP,
  CAVEAT_MARKERS_ARE_NOT_PROOF,
  '이 판정은 **국면**만 말한다 — 그 지문이 올바른 DB 를 가리키는지는 `checks.dbIdentity` 가 보고, 그 DB 의 데이터가 옳은지는 §3 4단계가 본다',
  '처분(평상시에 남긴다 / 8단계에서 지운다)을 **코드가 고르지 않는다** — 한쪽으로 확정하는 것은 사람 몫이고, 확정 전까지 `indistinguishable` 이 평상시 상태다',
  '이 배포 자신의 env 만 본다 — 다른 배포·다른 스코프(Preview)의 지문은 보이지 않는다',
  '`incident` 는 「표지가 있다」까지만 말한다 — 어느 단계까지 왔는지는 각 표지의 체크(`writeFreeze`·`incidentClosure`·`lossNotice`·`postRestoreSecurity`·`externalState`)가 말한다',
  '지문 키는 **사건 표지에 넣지 않았다** — 넣으면 §2 4번이 권하는 평상시 고정이 §2-3 무인증 응답에서 「사건 중」으로 공표된다',
];

export interface IdentityPhase {
  verdict: PhaseVerdict;
  /** 지문 키에 값이 들어 있는가(값은 담지 않는다) */
  present: boolean;
  /** 들어 있는 값을 지문으로 읽을 수 있는가 */
  readable: boolean;
  /** 지금 들어 있는 사건 표지의 **키 이름** */
  markers: string[];
  /** 국면 판정이 지문 **밖의** 근거를 가지고 있는가 */
  corroborated: boolean;
  basis: PhaseBasis;
  action: string;
  caveats: readonly string[];
  key: string;
  runbook: string;
}

/**
 * 지금 들어 있는 기준 지문이 **어느 국면의 기준인가**. env 해석만 한다 — 조회 0.
 *
 * `markerKeys` 를 넘기면 그 키들만 표지로 센다(테스트·다른 정본과의 대조용).
 * 기본값은 이 모듈의 정본이고, `healthDisclosure.INCIDENT_MARKERS` 와의 일치는 CI 가 본다.
 */
export function assessIdentityPhase(args: {
  env: Record<string, string | undefined>;
  markerKeys?: readonly string[];
}): IdentityPhase {
  const env = args.env ?? {};
  const raw = String(env[EXPECTED_DB_ENV] ?? '').trim();
  const present = raw !== '';
  const readable = present && parseExpected(raw).ok;

  const all = activePhaseMarkers(env);
  const markers = args.markerKeys ? all.filter((k) => args.markerKeys!.includes(k)) : all;

  let verdict: PhaseVerdict;
  let basis: PhaseBasis;
  if (!present) {
    verdict = 'absent';
    basis = markers.length > 0 ? 'markers' : 'none';
  } else if (markers.length > 0) {
    // 표지가 있으면 국면은 그 표지가 말한다 — 더 위험한 쪽(사건)을 택한다.
    verdict = 'incident';
    basis = 'markers';
  } else if (!readable) {
    verdict = 'unreadable';
    basis = 'unreadable_value';
  } else {
    verdict = 'indistinguishable';
    basis = 'fingerprint_only';
  }

  const action =
    verdict === 'absent'
      ? ACTION_PHASE_ABSENT
      : verdict === 'incident'
        ? ACTION_PHASE_INCIDENT
        : verdict === 'unreadable'
          ? ACTION_PHASE_UNREADABLE
          : ACTION_PHASE_INDISTINGUISHABLE;

  return {
    verdict,
    present,
    readable,
    markers,
    // 지문이 없으면 국면을 지문으로 주장하지 않으므로 「근거가 어긋날 일」이 없다.
    corroborated: !present || markers.length > 0,
    basis,
    action,
    caveats: PHASE_LIMITS,
    key: EXPECTED_DB_ENV,
    runbook: PHASE_RUNBOOK_REF,
  };
}

/* ───────────────────────────── 출력 ───────────────────────────── */

/** 로그 한 줄 — 판정·표지 **개수**만. 지문 값·호스트·연결 문자열은 담지 않는다 */
export function identityPhaseLine(a: IdentityPhase): string {
  return [
    '[identityPhase]',
    `verdict=${a.verdict}`,
    `present=${a.present}`,
    `readable=${a.readable}`,
    `corroborated=${a.corroborated}`,
    `markers=${a.markers.length}`,
    `basis=${a.basis}`,
  ].join(' ');
}

/** 사람이 읽는 요약(§3-12 의 1줄 명령이 출력하는 것) */
export function identityPhaseText(a: IdentityPhase): string {
  const lines = [
    `[${a.verdict}] ${a.key}=${a.present ? (a.readable ? '(설정됨)' : '(읽을 수 없음)') : '(미설정)'} ` +
      `표지=${a.markers.length} 근거=${a.basis}`,
    `→ ${a.action}`,
  ];
  if (a.markers.length > 0) lines.push(`※ 지금 들어 있는 사건 표지: ${a.markers.join(' · ')}`);
  for (const c of PHASE_CONFLICTS) lines.push(`※ [${c.key}] ${c.why} → ${c.effect}`);
  for (const l of a.caveats) lines.push(`· ${l}`);
  return lines.join('\n');
}

/** 공개 응답용 — 판정·키 이름·표지 **개수**만(지문 값·표지 값 없음) */
export function publicIdentityPhase(a: IdentityPhase): {
  verdict: PhaseVerdict;
  present: boolean;
  readable: boolean;
  corroborated: boolean;
  markerCount: number;
  basis: PhaseBasis;
  key: string;
} {
  return {
    verdict: a.verdict,
    present: a.present,
    readable: a.readable,
    corroborated: a.corroborated,
    markerCount: a.markers.length,
    basis: a.basis,
    key: a.key,
  };
}

/** 문서·보고용 요약 */
export function identityPhaseStatus(env: Record<string, string | undefined>): {
  verdict: PhaseVerdict;
  corroborated: boolean;
  conflicts: number;
  misreads: number;
  limits: number;
} {
  const a = assessIdentityPhase({ env });
  return {
    verdict: a.verdict,
    corroborated: a.corroborated,
    conflicts: PHASE_CONFLICTS.length,
    misreads: PHASE_MISREADS.length,
    limits: PHASE_LIMITS.length,
  };
}

/* ───────────────────────────── 정적 점검 ───────────────────────────── */

/**
 * 사건 표지 정본 대조 — `healthDisclosure.INCIDENT_MARKERS` 와 **양방향**으로 본다.
 * 이 모듈의 목록이 그쪽의 부분집합이어야 하고, **지문 키는 어느 쪽에도 표지로 들어가지 않는다**.
 */
export function auditMarkerCanon(markers: unknown): string[] {
  const rows = Array.isArray(markers) ? markers : [];
  if (rows.length === 0) return ['사건 표지 정본을 읽을 수 없다 — INCIDENT_MARKERS 의 모양이 바뀌었으면 이 가드를 함께 볼 것'];
  const keys = rows.map((m) => String((m as { key?: unknown })?.key ?? m ?? ''));
  const problems: string[] = [];

  for (const m of PHASE_MARKERS) {
    const row = rows.find((r) => String((r as { key?: unknown })?.key ?? r ?? '') === m.key) as
      | { kind?: unknown }
      | undefined;
    if (!row) {
      problems.push(`${m.key} 가 사건 표지 정본(INCIDENT_MARKERS)에 없다 — 두 정본이 어긋났다`);
      continue;
    }
    // 판독 방식이 갈리면 표지 수가 달라진다 — 느슨하게 읽는 쪽이 평상시를 사건으로 센다.
    if (String(row.kind ?? '') !== m.kind) {
      problems.push(`${m.key} 의 판독 방식이 어긋난다(이쪽 ${m.kind} / 정본 ${String(row.kind ?? '?')})`);
    }
  }
  if (keys.includes(EXPECTED_DB_ENV)) {
    problems.push(
      `${EXPECTED_DB_ENV} 가 사건 표지로 들어갔다 — 평상시 고정(§2 4번·§3-4)이 무인증 응답에서 「사건 중」으로 공표된다`,
    );
  }
  if (PHASE_MARKERS.some((m) => m.key === EXPECTED_DB_ENV)) {
    problems.push(`${EXPECTED_DB_ENV} 는 이 모듈의 표지 정본에도 들어가지 않는다 — 자기 자신을 근거로 쓰게 된다`);
  }
  return problems;
}

/**
 * `src/lib/deployRollback.ts` 원문 점검 — `after_switch` 를 **지문 단독**으로 내면서
 * 구분되지 않았다는 사실을 함께 내보내지 않으면 실패. 이 배선이 빠지면 응답은 그대로 200 이고
 * `phase` 값도 그대로라 사람 눈으로는 알아챌 수 없는 회귀다.
 */
export function auditRollbackBasis(src: unknown): string[] {
  const s = String(src ?? '');
  const problems: string[] = [];
  if (!/from\s+['"]\.\/identityPhase\.ts['"]/.test(s)) problems.push('identityPhase 를 import 하지 않는다');
  if (!/assessIdentityPhase\(/.test(s)) problems.push('assessIdentityPhase() 를 호출하지 않는다');
  if (!/phaseCorroborated/.test(s)) {
    problems.push('구분 여부(phaseCorroborated)를 내보내지 않는다 — 판정만 하고 버린다');
  }
  if (!/phaseBasis/.test(s)) problems.push('국면 판정의 근거(phaseBasis)를 내보내지 않는다');
  // 「구분되지 않은 상태에서 Promote 를 열어 준다」로 되돌아가면 복구가 조용히 무효화된다.
  if (/'after_switch'\s*&&\s*!?ip\.corroborated\s*\?\s*ACTION_RISK_NORMAL/.test(s)) {
    problems.push('구분되지 않은 국면에서 평상시 조치를 낸다 — Promote 를 열어 주면 복구가 무효화된다');
  }
  return problems;
}

/**
 * `src/lib/envRegistry.ts` 정본 점검 — 이 키의 설명이 「미설정이 평상시」 **단정**으로
 * 되돌아가면 실패한다(§3-4 는 남겨도 된다고 하고 §2 4번은 남아 있는 것을 전제한다).
 */
export function auditRegistryNote(defs: unknown): string[] {
  const rows = Array.isArray(defs) ? defs : [];
  const def = rows.find((d) => String((d as { key?: unknown })?.key ?? '') === EXPECTED_DB_ENV) as
    | { note?: unknown }
    | undefined;
  if (!def) return [`${EXPECTED_DB_ENV} 가 env 레지스트리에 없다 — 복구 목록에서 조용히 빠진다`];
  const note = String(def.note ?? '');
  const problems: string[] = [];
  if (!/§3-12|국면|평상시 고정/.test(note)) {
    problems.push(`${EXPECTED_DB_ENV} 설명이 국면 구분(§3-12)을 적지 않는다 — 평상시 고정과 사건 국면이 같은 값이다`);
  }
  if (/미설정이 평상시(?!.*(고정|남))/.test(note)) {
    problems.push(`${EXPECTED_DB_ENV} 설명이 「미설정이 평상시」로 단정한다 — §2 4번·§3-4 와 어긋난다`);
  }
  return problems;
}

/**
 * `src/lib/periodicCheck.ts` 정본 점검 — §2 4번이 이 키를 계속 다루는지. 그 단계가 사라지면
 * 평상시 고정을 아무도 확인하지 않게 되고, 그때 `indistinguishable` 은 영구 상태가 된다.
 */
export function auditPeriodicStep(steps: unknown): string[] {
  const rows = Array.isArray(steps) ? steps : [];
  const hit = rows.find((s) => String((s as { supplies?: unknown })?.supplies ?? '') === EXPECTED_DB_ENV);
  if (!hit) return [`§2 월 점검 정본에 ${EXPECTED_DB_ENV} 를 다루는 단계가 없다 — 평상시 고정의 확인 지점이 사라진다`];
  return [];
}

/**
 * `RUNBOOK.md` 원문 점검 — §3 8단계 4번이 이 키의 **처분을 적는지**.
 * 「지운다」든 「남긴다」든 **어느 쪽이든 적혀 있어야 한다** — 적혀 있지 않은 것이 이 고장의 원인이다.
 */
export function auditClearStepCoverage(md: unknown): string[] {
  const s = String(md ?? '');
  const start = s.search(/^##\s*3\.\s/m);
  if (start < 0) return ['§3 본문을 찾지 못했다 — 문서 구조가 바뀌었으면 이 가드를 함께 볼 것'];
  const rest = s.slice(start);
  const next = rest.search(/^###\s*3-1\./m);
  const body = next > 0 ? rest.slice(0, next) : rest;

  const problems: string[] = [];
  const step8 = body.slice(body.search(/^8\.\s/m));
  if (!step8 || body.search(/^8\.\s/m) < 0) {
    problems.push('§3 8단계를 찾지 못했다 — 표지 삭제 단계가 사라졌으면 이 가드를 함께 볼 것');
    return problems;
  }
  if (!new RegExp(EXPECTED_DB_ENV).test(step8)) {
    problems.push(`§3 8단계가 ${EXPECTED_DB_ENV} 의 처분을 적지 않는다 — 국면이 평상시로 돌아오는 단계가 절차에 없다`);
  }
  if (!/3-12/.test(step8)) problems.push('§3 8단계가 §3-12 를 가리키지 않는다 — 처분 판단의 근거를 찾을 수 없다');
  return problems;
}

/** `RUNBOOK.md` §3-12 절 점검 — 절이 사라지면 이 모듈은 아무도 호출하지 않는 코드가 된다 */
export function auditRunbookPhaseSection(md: unknown): string[] {
  const s = String(md ?? '');
  const problems: string[] = [];
  if (!/^###\s*3-12\./m.test(s)) {
    problems.push('§3-12(기준 지문의 국면) 절이 없다');
    return problems;
  }
  const start = s.search(/^###\s*3-12\./m);
  const rest = s.slice(start);
  const next = rest.search(/^###?\s(?!\s*3-12\.)/m);
  const sec = next > 0 ? rest.slice(0, next) : rest;

  if (!/assessIdentityPhase\(|identityPhaseText\(/.test(sec)) problems.push('§3-12 에 판정 산출 명령이 없다');
  // 「절 안에 그 낱말이 있다」가 아니라 **판정 표의 행**을 본다 — 본문에서 언급만 하고
  // 표에서 빠지면 담당자는 그 판정을 만났을 때 할 일을 찾을 수 없다.
  for (const v of PHASE_VERDICTS) {
    if (!new RegExp(`\\|\\s*\`${v}\`\\s*\\|`).test(sec)) problems.push(`§3-12 판정 표에 \`${v}\` 행이 없다`);
  }
  for (const c of PHASE_CONFLICTS) {
    if (!new RegExp(c.key).test(sec)) problems.push(`§3-12 에 어긋남 \`${c.key}\` 이 없다`);
  }
  if (!/구분할 수 없/.test(sec)) problems.push('§3-12 가 「구분할 수 없다」는 사실을 적지 않는다');
  if (!/사람/.test(sec)) problems.push('§3-12 가 처분 확정이 사람 몫이라는 사실을 적지 않는다');
  return problems;
}

/** 이 모듈이 런타임 체크를 만들지 않았다는 사실 고정 — 중복 보고를 늘리지 않는다 */
export function auditNoNewHealthCheck(src: unknown): string[] {
  const s = String(src ?? '');
  if (/checks\.identityPhase/.test(s)) {
    return [
      'checks.identityPhase 가 생겼다 — 이 판정은 `checks.deployPin.detail` 안에서 말한다(같은 국면을 두 번 보고하지 않는다)',
    ];
  }
  return [];
}
