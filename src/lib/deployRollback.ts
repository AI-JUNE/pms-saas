/**
 * deployRollback.ts — RUNBOOK **§5 배포 롤백**을 수행·확인 가능하게 만든다. 2026-10-11
 *
 * ── 왜 필요한가 ───────────────────────────────────────────────────────────────
 * §3(DB 복구)의 1~8단계는 모두 기계적으로 수행·확인할 수 있게 됐다. 그런데 **코드 회귀**를
 * 되돌리는 §5 는 세 줄로 남아 있었다 —
 *   1. Vercel 배포 목록에서 직전 정상 배포를 Promote(롤백).
 *   2. `/api/health` 의 `commit` 이 롤백 대상과 일치하는지 확인.
 *   3. 원인 커밋을 수정 후 재배포. AutoPush(20분 주기)가 자동 반영한다.
 * 이 절차에는 이 배포 환경에서 **반드시 터지는** 구멍이 둘 있다.
 *
 *  (1) **롤백이 20분 안에 저절로 풀린다.** 이 저장소의 배포 경로는
 *      「Windows AutoPush(20분 주기) → git push → Vercel 자동 배포(main)」다
 *      (`docs/OPERATIONS.md`·RUNBOOK §1). Promote 는 **운영 alias 만** 옛 배포로 옮기고
 *      `main` 은 그대로 회귀 커밋에 머물러 있으므로, 다음 push 가 들어오는 순간 Vercel 이
 *      main HEAD 로 **새 Production 배포**를 만들고 옛 배포는 서비스에서 빠진다. AutoPush 는
 *      **미커밋 변경까지 자동 커밋**하므로 사람이 아무것도 하지 않아도 그 push 는 일어난다.
 *      즉 1단계 롤백은 **최대 20분짜리**이고, 2단계에서 `commit` 을 눈으로 확인한 직후
 *      조용히 회귀 커밋으로 돌아간다 — 오류도, 알림도 없다. 담당자는 「롤백했다」고 보고하고
 *      장애는 되살아난다.
 *
 *  (2) **「DB를 건드리지 말고 배포만 되돌린다」가 성립하지 않는다.** §5 머리말의 약속인데,
 *      Promote 되는 옛 배포는 **그 배포가 만들어질 때의 환경변수 스냅샷**으로 돈다
 *      (RUNBOOK §3 5단계가 이미 적어 둔 사실 — 「Vercel 환경변수는 재배포 전까지 기존 배포에
 *      반영되지 않는다」의 뒷면이다). 그래서 §3 복구 중·직후에 §5 를 쓰면
 *        · 5단계에서 복구 브랜치로 **교체한 `DATABASE_URL` 이 그 배포에는 없다** →
 *          운영이 **다시 손상된 DB** 를 보게 된다. 복구가 조용히 무효화된다.
 *        · 2단계 **쓰기 차단(`RECOVERY_WRITE_FREEZE`)이 그 배포에는 없다** →
 *          차단 중인 줄 알고 3~5단계를 진행하는데 운영은 쓰기를 계속 받는다.
 *        · 기준 지문(`RECOVERY_EXPECTED_DB`)·차단 시각(`RECOVERY_WRITE_FREEZE_AT`)도 함께 사라져
 *          `checks.dbIdentity` 는 `unset`(= degraded 도 아니다), `checks.incidentClosure` 는
 *          `normal` 로 보인다 — **확인 장치 전체가 「평상시」로 되돌아간다.**
 *      어느 것도 500 을 내지 않는다.
 *
 * 그래서 이 모듈은
 *   · 롤백 대상 커밋을 **기록 대상으로 승격**하고(`DEPLOY_PINNED_COMMIT`), 그 커밋이 아닌
 *     배포가 서비스를 받는 순간 `/api/health` 로 `drifted` 를 드러내고(= 롤백이 풀렸다),
 *   · 롤백이 **되돌려 버리는 설정**을 현재 env 로 판정해 열거하고(`assessRollbackRisk`),
 *   · Promote 와 `git revert` 재배포의 차이를 선행 조건으로 적고(`ROLLBACK_PRECONDITIONS`),
 *   · 커밋이 같다는 것이 보장하지 **못하는** 것을 `ROLLBACK_LIMITS` 로 함께 내보낸다.
 *
 * 원칙
 * - 순수 모듈: DB·next·fs 미접근, **신규 조회·쓰기·DDL 0**. env 는 명시 로더에서만 읽는다.
 * - **추측 금지**: 커밋을 읽을 수 없으면 `unknown_actual`(= 「다르다」가 아니라 「모른다」).
 *   pin 값이 커밋 모양이 아니면 그것을 커밋으로 쓰지 않는다(`invalid_pin`).
 * - **새 거짓 ok 를 만들지 않는다**: `held` 는 「그 커밋이 서비스되고 있다」까지만 말한다.
 */
import { EXPECTED_DB_ENV, DB_URL_ENV } from './dbIdentity.ts';
import { buildInfo } from './health.ts';
import { FREEZE_AT_ENV } from './incidentClosure.ts';
import { WRITE_FREEZE_ENV, writeFreezeEnabled } from './writeFreeze.ts';

/** 롤백 대상 커밋을 적어 두는 키. 평상시 **미설정이 정상**이다 */
export const PIN_ENV = 'DEPLOY_PINNED_COMMIT';

/** 응답·문서에서 근거 문서를 찾을 수 있게 한다 */
export const ROLLBACK_RUNBOOK_REF = 'RUNBOOK §5 배포 롤백·§5-1';

/** AutoPush 주기(분). 롤백이 유지되는 **상한**이다 — 문서(§1·docs/OPERATIONS.md)와 같은 수치 */
export const AUTOPUSH_INTERVAL_MIN = 20;

/* ─────────────────────────── 커밋 참조 ─────────────────────────── */

const COMMIT_RE = /^[0-9a-f]{7,40}$/;

/**
 * 커밋 참조 정규화. 7~40자리 16진수만 인정하고 그 밖은 null — `HEAD`·태그·브랜치명·
 * 6자리 이하 축약은 **커밋으로 쓰지 않는다**(비교가 조용히 어긋나는 쪽이 더 위험하다).
 */
export function parseCommitRef(v: unknown): string | null {
  const t = String(v ?? '').trim().toLowerCase();
  if (!t) return null;
  return COMMIT_RE.test(t) ? t : null;
}

/**
 * 같은 커밋인가. `/api/health` 는 7자리로 노출하고 사람은 콘솔에서 전체 해시를 복사하므로
 * **짧은 쪽이 긴 쪽의 접두사**일 때 같다고 본다. 둘 중 하나라도 읽히지 않으면 false 가 아니라
 * 판정을 하지 않는다(호출부가 `unknown_actual` 로 처리한다).
 */
export function sameCommit(a: unknown, b: unknown): boolean {
  const x = parseCommitRef(a);
  const y = parseCommitRef(b);
  if (!x || !y) return false;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return long.startsWith(short);
}

/* ─────────────────────────── 롤백 고정 판정 ─────────────────────────── */

export const PIN_VERDICTS = ['off', 'held', 'drifted', 'invalid_pin', 'unknown_actual'] as const;
export type PinVerdict = (typeof PIN_VERDICTS)[number];

export const ACTION_PIN_OFF =
  `롤백 고정이 설정돼 있지 않다 — 평상시 상태다. 코드 회귀로 배포를 되돌릴 때 롤백 대상 커밋을 ` +
  `\`${PIN_ENV}\` 에 넣으면, 그 커밋이 아닌 배포가 서비스를 받는 순간 이 체크가 \`drifted\` 로 알려 준다`;

export const ACTION_PIN_HELD =
  '고정한 커밋이 서비스되고 있다 — 롤백이 유지되는 중이다. **원인 커밋을 수정해 배포한 뒤에는 ' +
  `\`${PIN_ENV}\` 를 지운다**(남겨 두면 정상 배포가 전부 \`drifted\` 로 보인다)`;

export const ACTION_PIN_DRIFTED =
  '고정한 커밋이 아닌 배포가 서비스되고 있다 — 읽을 수 있는 뜻이 둘이다. ' +
  `(가) **롤백이 풀렸다**: Promote 는 운영 alias 만 옮기고 \`main\` 은 그대로이므로, AutoPush(${AUTOPUSH_INTERVAL_MIN}분 주기)가 ` +
  'push 하는 순간 Vercel 이 main HEAD 로 새 Production 배포를 만들어 옛 배포를 밀어낸다 — 장애가 되살아난 상태다. ' +
  `(나) 수정 배포를 이미 마쳤는데 \`${PIN_ENV}\` 를 지우지 않았다. 먼저 \`commit\` 이 어느 커밋인지 보고 둘을 구분한다`;

export const ACTION_PIN_INVALID = `\`${PIN_ENV}\` 값을 커밋으로 읽을 수 없다 — 7~40자리 16진수만 넣는다(\`HEAD\`·태그·브랜치명은 받지 않는다). 대조를 하지 않는다`;

export const ACTION_PIN_UNKNOWN_ACTUAL =
  '현재 배포 커밋을 읽을 수 없어 대조가 성립하지 않는다 — 「다르다」로 올리지 않는다. ' +
  '커밋 해시는 플랫폼이 주입한다(`VERCEL_GIT_COMMIT_SHA`). 로컬·다른 플랫폼에서는 비어 있는 것이 정상이다';

/** 커밋이 같다는 것이 보장하지 **못하는** 것. 응답·RUNBOOK 에 그대로 실어 보낸다 */
export const ROLLBACK_LIMITS: readonly string[] = [
  '커밋 대조는 「어느 코드가 서비스되고 있는가」까지만 말한다 — 그 커밋이 **정상**이라는 뜻이 아니다(고정한 커밋 자체가 회귀를 품고 있을 수 있다)',
  '**환경변수는 커밋으로 알 수 없다** — 같은 커밋을 다시 배포해도 env 는 그 배포 시점의 값이 들어간다. `held` 는 설정이 그대로라는 보장이 아니다',
  'Promote(Instant Rollback)로 되돌린 **옛 배포 자신은 이 고정을 보지 못한다** — 그 배포의 env 스냅샷에 고정 키가 없기 때문이다. 그래서 롤백이 유지되는 동안 판정은 `off` 이고, 새 배포가 올라와 고정을 보는 순간 `drifted` 가 된다(그것이 알림이다)',
  '이 판정은 **이 배포 자신**만 말한다 — Preview 배포·다른 alias 가 함께 떠 있는 경우는 보지 않는다',
  '7자리 접두사 비교다 — 서로 다른 커밋이 같은 7자리 접두사를 가지면 구분하지 못한다(드물지만 0 은 아니다)',
  `롤백은 \`main\` 을 고치지 않는다 — 원인 커밋이 \`main\` 에 남아 있는 동안 AutoPush 는 계속 그 코드를 배포하려 한다(${AUTOPUSH_INTERVAL_MIN}분 주기)`,
];

export interface DeployPin {
  verdict: PinVerdict;
  /** 정규화된 고정 커밋. 읽지 못했으면 null — 지어내지 않는다 */
  pinned: string | null;
  /** 현재 배포 커밋(플랫폼 주입값, 7자리). 모르면 null */
  actual: string | null;
  action: string;
  note: string;
}

/**
 * 롤백 고정 대조. 판정 순서가 할 일을 바꾼다 —
 * 고정이 없으면 대조할 것이 없고(`off`), 고정 값을 읽을 수 없으면 현재 커밋을 봐도 의미가 없고
 * (`invalid_pin`), 현재 커밋을 모르는 것은 「다르다」가 아니다(`unknown_actual`).
 */
export function assessDeployPin(input: { pinned?: unknown; actual?: unknown }): DeployPin {
  const rawPin = String(input?.pinned ?? '').trim();
  const actual = parseCommitRef(input?.actual);

  if (!rawPin) {
    return {
      verdict: 'off',
      pinned: null,
      actual,
      action: ACTION_PIN_OFF,
      note: `고정 미설정 — 평상시 상태다(Promote 로 롤백 중인 옛 배포에서도 같은 값이 나온다. ${ROLLBACK_LIMITS.length}건의 한계 참고)`,
    };
  }

  const pinned = parseCommitRef(rawPin);
  if (!pinned) {
    return { verdict: 'invalid_pin', pinned: null, actual, action: ACTION_PIN_INVALID, note: '고정 값이 커밋 모양이 아니다' };
  }
  if (!actual) {
    return {
      verdict: 'unknown_actual',
      pinned,
      actual: null,
      action: ACTION_PIN_UNKNOWN_ACTUAL,
      note: '현재 배포 커밋을 모른다 — 대조 자체가 성립하지 않는다',
    };
  }
  if (sameCommit(pinned, actual)) {
    return { verdict: 'held', pinned, actual, action: ACTION_PIN_HELD, note: '고정한 커밋이 서비스되고 있다' };
  }
  return {
    verdict: 'drifted',
    pinned,
    actual,
    action: ACTION_PIN_DRIFTED,
    note: `고정(${pinned.slice(0, 7)}) 과 현재 배포(${actual}) 가 다르다`,
  };
}

/* ─────────────────────── 롤백이 되돌려 버리는 설정 ─────────────────────── */

export const ROLLBACK_PHASES = ['normal', 'frozen', 'after_switch'] as const;
export type RollbackPhase = (typeof ROLLBACK_PHASES)[number];

/**
 * 지금이 §3 복구 중인가. 쓰기 차단이 걸려 있으면 2~7단계 진행 중이고(가장 위험하다),
 * 차단은 풀렸는데 기준 지문이 남아 있으면 5단계 전환 이후다. 둘 다 없으면 평상시다.
 * **env 해석만** 한다 — 조회 0.
 */
export function rollbackPhase(env: Record<string, string | undefined> = process.env): RollbackPhase {
  if (writeFreezeEnabled(env)) return 'frozen';
  if (String(env[EXPECTED_DB_ENV] ?? '').trim()) return 'after_switch';
  return 'normal';
}

export const CAVEAT_ENV_SNAPSHOT =
  '롤백 대상 배포는 **그 배포가 만들어질 때의 환경변수 스냅샷**으로 돈다 — 그 뒤에 추가·변경한 env 는 ' +
  '그 배포에 없다(§3 5단계가 적어 둔 「환경변수는 재배포 전까지 반영되지 않는다」의 뒷면이다). ' +
  '아래 목록은 **지금 효력 중인 복구 관련 키**뿐이고 전부가 아니다 — 롤백 대상이 빌드된 이후의 모든 변경이 함께 되돌아간다';

export const CAVEAT_ROLLBACK_LOSES_RECOVERY =
  `복구 중 롤백은 \`${DB_URL_ENV}\` 교체(§3 5단계)를 함께 되돌린다 — 운영이 **다시 손상된 DB** 를 보게 되고, ` +
  '`checks.dbIdentity` 는 기준 지문도 함께 사라져 `unset`(degraded 조차 아니다)으로 보인다. ' +
  '복구를 되돌려야 한다면 배포가 아니라 **`DATABASE_URL` 을 직접 되돌리고 재배포**한다';

export const CAVEAT_ROLLBACK_LOSES_FREEZE =
  `복구 중 롤백은 \`${WRITE_FREEZE_ENV}\` 를 함께 되돌린다 — 차단한 줄 알고 3~5단계를 진행하는 동안 ` +
  `운영은 쓰기를 계속 받고, 그 쓰기는 전환에서 **조용히 사라진다**. \`${FREEZE_AT_ENV}\` 도 함께 사라져 ` +
  '유실 구간의 끝을 확정할 수 없게 된다(§3-7)';

export interface RollbackRisk {
  phase: RollbackPhase;
  /** 「코드만 되돌린다」(§5 머리말의 약속)가 지금 성립하는가 */
  codeOnly: boolean;
  /** 롤백 대상 배포에 **없을** 설정 키(이름만 — 값은 담지 않는다) */
  atRisk: string[];
  action: string;
  caveats: string[];
}

export const ACTION_RISK_NORMAL =
  '평상시다 — 코드 회귀라면 §5 절차로 되돌린다. 선행 조건(AutoPush 정지·롤백 고정 기록)을 먼저 본다';

export const ACTION_RISK_FROZEN =
  '**지금 배포를 되돌리지 않는다** — §3 복구 중(쓰기 차단 ON)이고, 롤백은 차단과 DB 교체를 함께 되돌린다. ' +
  '코드 회귀가 복구를 막고 있다면 롤백(Promote) 대신 `git revert` 로 **새 배포**를 만든다 — 그러면 현재 env 가 그대로 유지된다';

export const ACTION_RISK_AFTER_SWITCH =
  '§3 5단계 전환 이후다(기준 지문이 설정돼 있다) — Promote 로 되돌리면 복구 브랜치 연결이 함께 되돌아간다. ' +
  '`git revert` 재배포를 쓰고, 되돌린 뒤 `checks.dbIdentity.detail.verdict` 가 여전히 `match` 인지 확인한다';

/**
 * 지금 배포를 되돌리면 **무엇이 함께 되돌아가는가**. env 이름만 열거하고 값은 담지 않는다.
 * 목록이 비어 있어도 「되돌아갈 것이 없다」는 뜻은 아니다 — `CAVEAT_ENV_SNAPSHOT` 을 함께 낸다.
 */
export function assessRollbackRisk(env: Record<string, string | undefined> = process.env): RollbackRisk {
  const phase = rollbackPhase(env);
  const atRisk: string[] = [];
  const caveats: string[] = [CAVEAT_ENV_SNAPSHOT];

  if (phase === 'frozen') {
    atRisk.push(WRITE_FREEZE_ENV);
    if (String(env[FREEZE_AT_ENV] ?? '').trim()) atRisk.push(FREEZE_AT_ENV);
    caveats.push(CAVEAT_ROLLBACK_LOSES_FREEZE);
  }
  if (String(env[EXPECTED_DB_ENV] ?? '').trim()) atRisk.push(EXPECTED_DB_ENV);
  if (phase !== 'normal') {
    atRisk.push(DB_URL_ENV);
    caveats.push(CAVEAT_ROLLBACK_LOSES_RECOVERY);
  }

  return {
    phase,
    codeOnly: phase === 'normal',
    atRisk,
    action: phase === 'frozen' ? ACTION_RISK_FROZEN : phase === 'after_switch' ? ACTION_RISK_AFTER_SWITCH : ACTION_RISK_NORMAL,
    caveats,
  };
}

/* ─────────────────────────── 선행 조건·수단 비교 ─────────────────────────── */

/** 1단계(Promote)보다 **먼저** 해야 하는 것. 순서가 뒤집히면 롤백이 20분 안에 풀린다 */
export const ROLLBACK_PRECONDITIONS: readonly string[] = [
  `**AutoPush 를 먼저 멈춘다.** 이 저장소의 배포 경로는 「Windows AutoPush(${AUTOPUSH_INTERVAL_MIN}분 주기) → git push → Vercel 자동 배포(main)」다. ` +
    'Promote 는 운영 alias 만 옮기고 `main` 은 회귀 커밋에 그대로 있으므로, 다음 push 에서 새 Production 배포가 만들어지며 롤백이 밀려난다. ' +
    'AutoPush 는 **미커밋 변경까지 자동 커밋**하므로 사람이 아무것도 하지 않아도 그 push 는 일어난다',
  `롤백 대상 커밋(전체 해시)을 \`${PIN_ENV}\` 에 적는다 — 롤백이 풀리면 \`/api/health\` 의 \`checks.deployPin\` 이 \`drifted\` 로 알려 준다. ` +
    '다만 Promote 된 **옛 배포 자신은** 이 값을 보지 못한다(env 스냅샷) — 알림은 새 배포가 올라온 뒤에 나온다',
  `§3 복구 중(\`${WRITE_FREEZE_ENV}\` ON)이거나 전환 이후(\`${EXPECTED_DB_ENV}\` 설정)라면 **Promote 를 쓰지 않는다** — 그 설정이 함께 되돌아간다`,
  '되돌린 뒤 `/api/health` 의 `commit` 을 한 번 보는 것으로 끝내지 않는다 — 그 값은 **그 순간**만 말한다. 고정을 적어 두고 체크가 알려 주게 한다',
];

/** 두 수단의 차이. 긴급도만 보고 Promote 를 고르면 위 (1)·(2) 를 함께 고르는 것이 된다 */
export const ROLLBACK_METHODS: readonly { method: string; speed: string; survivesAutoPush: boolean; keepsEnv: boolean; note: string }[] = [
  {
    method: 'Promote(Instant Rollback) — 기존 옛 배포를 운영 alias 로',
    speed: '즉시(빌드 없음)',
    survivesAutoPush: false,
    keepsEnv: false,
    note: '`main` 을 고치지 않으므로 다음 push 에 밀려난다. 옛 배포의 **env 스냅샷**으로 돌아 그 뒤의 설정 변경이 전부 빠진다',
  },
  {
    method: '`git revert` 후 재배포 — main HEAD 를 고친다',
    speed: '빌드 1회',
    survivesAutoPush: true,
    keepsEnv: true,
    note: 'AutoPush 와 싸우지 않고, 새 배포이므로 **현재 env** 를 받는다. §3 복구 중에는 이 수단만 쓴다',
  },
];

/* ─────────────────────────── env 로더 ─────────────────────────── */

/**
 * 고정 커밋. `DEPLOY_PINNED_COMMIT` 만 인정하고 **기본값을 만들지 않는다**.
 * 커밋 모양이 아니면 `ref: null` 로 두고 원문을 `raw` 로 남긴다(판정이 `invalid_pin` 이 된다).
 */
export function pinFromEnv(env: Record<string, string | undefined> = process.env): { raw: string | null; ref: string | null } {
  const raw = (env.DEPLOY_PINNED_COMMIT ?? '').trim();
  if (!raw) return { raw: null, ref: null };
  return { raw, ref: parseCommitRef(raw) };
}

/** 응답·명령 출력용 — 판정 + 되돌아가는 설정 + 한계 */
export function deployRollbackStatus(env: Record<string, string | undefined> = process.env): DeployPin & {
  risk: RollbackRisk;
  limits: readonly string[];
  preconditions: readonly string[];
  runbook: string;
} {
  const { raw } = pinFromEnv(env);
  const pin = assessDeployPin({ pinned: raw, actual: buildInfo(env).commit });
  return {
    ...pin,
    risk: assessRollbackRisk(env),
    limits: ROLLBACK_LIMITS,
    preconditions: ROLLBACK_PRECONDITIONS,
    runbook: ROLLBACK_RUNBOOK_REF,
  };
}

/** 사람이 읽는 요약(§5-1 의 1줄 명령이 출력하는 것) */
export function rollbackText(s: ReturnType<typeof deployRollbackStatus>): string {
  const lines = [
    `[${s.verdict}] pinned=${s.pinned ?? '(미설정)'} actual=${s.actual ?? '(모름)'} phase=${s.risk.phase}`,
    `→ ${s.action}`,
    `→ ${s.risk.action}`,
  ];
  if (s.risk.atRisk.length > 0) lines.push(`※ 롤백하면 함께 되돌아가는 설정: ${s.risk.atRisk.join(' · ')}`);
  for (const c of s.risk.caveats) lines.push(`※ ${c}`);
  for (const l of s.limits) lines.push(`· ${l}`);
  return lines.join('\n');
}

/** 로그 한 줄. 커밋 접두사·판정만 — 설정값·PII 없음 */
export function pinLogLine(pin: DeployPin, phase?: RollbackPhase): string {
  const parts = [`pin=${pin.verdict}`, `pinned=${pin.pinned ? pin.pinned.slice(0, 7) : '-'}`, `actual=${pin.actual ?? '-'}`];
  if (phase) parts.push(`phase=${phase}`);
  return `[rollback] ${parts.join(' ')}`;
}

/* ─────────────────────────── /api/health 체크 ─────────────────────────── */

const VERDICT_NOTE: Record<PinVerdict, string> = {
  off: `롤백 고정 미설정 — 평상시 상태다. \`${PIN_ENV}\` 는 코드 회귀를 되돌리는 동안에만 들어 있는 값이다`,
  held: '고정한 커밋이 서비스되고 있다 — 롤백 유지 중. 수정 배포 후에는 고정을 지운다',
  drifted: `고정한 커밋이 아닌 배포가 서비스되고 있다 — **롤백이 풀렸거나**(AutoPush 가 main HEAD 를 배포했다) 수정 배포 후 고정을 지우지 않았다`,
  invalid_pin: `\`${PIN_ENV}\` 를 커밋으로 읽을 수 없다 — 7~40자리 16진수만 넣는다`,
  unknown_actual: '현재 배포 커밋을 읽을 수 없어 대조하지 않았다 — 「다르다」가 아니라 「모른다」다',
};

/**
 * 롤백이 유지되고 있는지 공개 헬스체크에 드러낸다.
 *
 * 이 체크의 쓸모는 **지속성**에 있다 — §5 2단계의 눈 확인은 그 순간만 말하는데, 이 배포 환경에서
 * 롤백은 AutoPush 주기 안에 저절로 풀린다. 고정을 적어 두면 풀린 사실이 응답에 남는다.
 *
 * **required: false** 이므로 어느 경우에도 503 이 되지 않는다(롤백 상태 자체는 장애가 아니다).
 * 커밋 접두사·env 키 이름·판정만 담고 설정값은 담지 않는다.
 */
export function deployPinCheck(args?: {
  env?: Record<string, string | undefined>;
}): { ok: boolean; required: false; detail: Record<string, unknown> } {
  const env = args?.env ?? process.env;
  const { raw } = pinFromEnv(env);
  const pin = assessDeployPin({ pinned: raw, actual: buildInfo(env).commit });
  const risk = assessRollbackRisk(env);

  return {
    ok: pin.verdict === 'off' || pin.verdict === 'held',
    required: false,
    detail: {
      verdict: pin.verdict,
      pinned: pin.pinned,
      actual: pin.actual,
      phase: risk.phase,
      codeOnly: risk.codeOnly,
      atRisk: risk.atRisk,
      pinKey: PIN_ENV,
      autoPushIntervalMin: AUTOPUSH_INTERVAL_MIN,
      runbook: ROLLBACK_RUNBOOK_REF,
      note: VERDICT_NOTE[pin.verdict],
    },
  };
}

/** 배선 상태 요약(문서·보고용) */
export function deployRollbackStatusLine(env: Record<string, string | undefined> = process.env): {
  verdict: PinVerdict;
  phase: RollbackPhase;
  pinKey: string;
  limits: number;
  note: string;
} {
  const { raw } = pinFromEnv(env);
  const pin = assessDeployPin({ pinned: raw, actual: buildInfo(env).commit });
  return {
    verdict: pin.verdict,
    phase: rollbackPhase(env),
    pinKey: PIN_ENV,
    limits: ROLLBACK_LIMITS.length,
    note: VERDICT_NOTE[pin.verdict],
  };
}

/* ─────────────────────────── 배선 정적 점검 ─────────────────────────── */

/**
 * `app/api/health/route.ts` 원문 점검 — 판정이 **응답에 실려 있는지**까지 본다.
 * 이 체크가 빠지면 롤백이 풀린 사실을 알려 줄 유일한 장치가 사라지는데, 응답은 그대로 돌기 때문에
 * 사람 눈으로는 알아챌 수 없는 회귀다.
 */
export function auditHealthWiring(src: unknown): string[] {
  const s = String(src ?? '');
  const problems: string[] = [];
  if (!/from\s+['"]@\/lib\/deployRollback['"]/.test(s)) problems.push('deployRollback 을 import 하지 않는다');
  if (!/deployPinCheck\(/.test(s)) problems.push('deployPinCheck() 를 호출하지 않는다');
  else if (!/checks\.deployPin\s*=\s*deployPinCheck\(/.test(s)) {
    problems.push('판정 결과를 checks.deployPin 으로 내보내지 않는다 — 판정만 하고 버린다');
  }
  return problems;
}

/**
 * `RUNBOOK.md` 원문 점검 — §5 가 다시 「Promote 하고 commit 확인하고 끝」 세 줄로 되돌아가지
 * 않도록 고정한다. 문서가 되돌아가면 이 모듈은 아무도 호출하지 않는 코드가 된다.
 */
export function auditRunbookRollback(md: unknown): string[] {
  const s = String(md ?? '');
  const problems: string[] = [];

  if (!/^###\s*5-1\./m.test(s)) problems.push('§5-1(롤백 고정·수단 선택) 절이 없다');
  if (!/deployRollbackStatus\(|assessDeployPin\(/.test(s)) problems.push('§5-1 에 롤백 고정 산출 명령이 없다');
  if (!new RegExp(PIN_ENV).test(s)) problems.push(`${PIN_ENV} 가 문서에 없다 — 복구 시 조용히 유실된다`);

  const start = s.search(/^##\s*5\.\s/m);
  if (start < 0) {
    problems.push('§5 본문을 찾지 못했다 — 문서 구조가 바뀌었으면 이 가드를 함께 볼 것');
    return problems;
  }
  const rest = s.slice(start);
  const next = rest.search(/^##\s(?!\s*5\.)/m);
  const sec5 = next > 0 ? rest.slice(0, next) : rest;

  if (!/AutoPush/.test(sec5)) problems.push('§5 가 AutoPush 와의 충돌을 적지 않는다 — 롤백이 주기 안에 풀린다');
  if (!/revert/.test(sec5)) problems.push('§5 가 `git revert` 재배포 수단을 적지 않는다');
  if (!/환경변수|env/.test(sec5)) problems.push('§5 가 환경변수 스냅샷 문제를 적지 않는다 — 「DB를 건드리지 않는다」가 성립하지 않는 경로다');
  if (!new RegExp(WRITE_FREEZE_ENV).test(sec5)) {
    problems.push(`§5 가 복구 중(${WRITE_FREEZE_ENV} ON) 롤백 금지를 적지 않는다`);
  }
  if (!/checks\.deployPin/.test(sec5)) problems.push('§5 가 확인 수단(checks.deployPin)을 적지 않는다');
  return problems;
}
