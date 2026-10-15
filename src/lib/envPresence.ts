/**
 * envPresence.ts — RUNBOOK **§4(환경변수·시크릿 복구)가 실제로 됐는지** 판정한다. 2026-10-15
 *
 * ── 왜 필요한가 ───────────────────────────────────────────────────────────────
 * §4 의 머리말은 스스로 이렇게 경고한다:
 *   「⚠️ **이 목록이 복구의 전부다.** 빠진 키는 복구 후에도 오류를 내지 않고 **조용히 기본값으로
 *     되돌아간다** — 서비스는 뜨지만 확정본 약관이 「초안」으로, 고지된 수탁자가 「고지 전」으로,
 *     정산이 계산 중단 상태로 돌아간다.」
 * 2026-09-30 배치는 그 **목록**을 고쳤다(`lib/envRegistry.ts` 37키 정본 + 문서 대조 CI). 그런데
 * 고친 것은 「무엇을 복구해야 하는가」뿐이고 **「복구가 됐는가」를 보는 장치는 없었다**:
 *
 *  (1) `lib/envRegistry.ts` 는 설계상 `process.env` 를 건드리지 않는다(소스·문서끼리 대조하는
 *      CI 시점 점검이다). 그래서 **정본 37키와 실제로 돌고 있는 배포의 env 가 한 번도 대조되지
 *      않았다** — 레지스트리는 완전한데 배포에 절반만 들어가 있어도 CI 는 통과한다.
 *  (2) 담당자가 복구일에 보는 §4-10 「복구 후 확인 순서」 5단계 중 기계적으로 확인되는 것은
 *      `DATABASE_URL` 하나뿐이다(1번 `checks.db`). 2번은 Vercel 대시보드 **눈 확인**, 3번은
 *      `/terms`·`/privacy` **눈 확인**, 4번은 「계약 상태에 맞게」다.
 *  (3) 그 눈 확인이 **원리상 구분하지 못하는 상태**가 있다. `lib/legal.ts` 는 fail-safe 라
 *      `LEGAL_DOCS_FINAL=true` 여도 버전·시행일 중 하나만 유실되면 조용히 draft 로 남는다 —
 *      화면은 「초안」 배너를 띄우고, 그 모습은 **「아직 확정 전」과 똑같다.** 더 나쁜 쪽은 아무
 *      흔적도 남지 않는 키들이다: `LEGAL_CONSENT_REQUIRED` 유실 → 가입 동의 강제가 관측 모드로
 *      내려가고(가입은 그대로 성공한다), `ENTITLEMENTS_ENFORCE` 유실 → 좌석·기능 제한이 차단에서
 *      관측으로 내려간다. **화면도 응답도 복구 전과 똑같다.**
 *  (4) 그래서 §2 월 점검 4번은 「환경변수 스냅샷이 최신인지 확인(4절)」이라고 지시하고,
 *      `lib/periodicCheck.ts` 는 그것을 거른 결과를 「**시크릿 키 목록 누락은 복구일에만
 *      드러난다**」고 적어 두었다 — 그 스냅샷은 보관소에 있는 **사람의 목록**이고, 코드가 보는
 *      쪽에는 대조할 상대가 없었다.
 *
 * 이 모듈은 값을 보지 않고 **키의 존재만** 두 방향으로 대조해 그 구멍을 닫는다.
 *
 *  (가) **기준 없이 판정할 수 있는 것** — 스위치는 켜졌는데 그 스위치가 필요로 하는 값이 없는
 *       상태(`ineffective`)다. 이것은 복구와 무관하게도 사고이고(켠 줄 알았는데 아무 일도 하지
 *       않는다), 유실된 키가 **묶음의 일부**일 때 가장 자주 생긴다.
 *  (나) **기준이 있어야 판정되는 것** — 평상시에 설정돼 있던 키가 지금 없다는 사실. 어느 키가
 *       「있어야 하는가」는 계약·승인 상태에 따라 다르므로 **코드가 정하지 않는다.** §2 월 점검에서
 *       떠 둔 **키 이름 스냅샷**(`RECOVERY_ENV_BASELINE`)만 기준으로 인정한다(행 수 기준
 *       스냅샷 §3-2 와 같은 규율).
 *
 * 원칙
 * - **값을 담지 않는다.** 판정에 쓰는 것은 「있다/비었다/없다」 3상태뿐이고, 출력에는 키 이름·
 *   판정·날짜·개수만 넣는다(공개 `/api/health` 에 나가고, 기준 스냅샷은 env 에 들어간다 —
 *   값을 담으면 시크릿이 한 벌 더 복제된다. `parseEnvBaseline` 이 값이 섞인 스냅샷을 거절한다).
 * - **임의 기준 금지.** 기준 스냅샷이 없으면 `no_baseline` 으로 남기고 「이 키는 있어야 한다」를
 *   코드가 지어내지 않는다. 미설정이 평상시 상태인 키가 대부분이다.
 * - **스위치 판독은 실제 읽는 쪽과 똑같이** 한다 — `=== 'true'` 뿐이다(공백·`1`·`yes` 는 OFF).
 *   여기서만 느슨하게 읽으면 판정이 실제 동작과 어긋난다.
 * - **중복 보고 금지.** 복구·롤백용 임시 키(평상시 미설정이 정상)는 각 체크가 이미 따로 보므로
 *   스냅샷과 유실 판정에서 제외한다(`TRANSIENT_KEYS`).
 * - 판정은 입력 해석뿐 — DB·네트워크·파일시스템 미접근, 신규 조회·쓰기·DDL 0.
 */

import { parseRehearsalDate } from './recovery.ts';
import { ENV_VARS, isEnvKeyToken, restorableVars, type EnvVar } from './envRegistry.ts';

/** 키 이름 기준 스냅샷 설정 키(§2 월 점검에서 떠 둔다). **값은 담지 않는다** */
export const ENV_BASELINE_ENV = 'RECOVERY_ENV_BASELINE';

const MS_DAY = 86400000;

/**
 * 복구·롤백 중에만 넣어 두는 임시 키 — **평상시 미설정이 정상**이다.
 * 스냅샷에 섞이면 (가) 사건 중에 뜬 스냅샷이 평상시에도 이 키를 요구해 거짓 `missing` 이 되고,
 * (나) 해제 후 사라진 것을 「유실」로 보고한다. 각 키는 전용 체크가 이미 따로 본다.
 */
export const TRANSIENT_KEYS: readonly string[] = [
  'RECOVERY_WRITE_FREEZE', // checks.writeFreeze
  'RECOVERY_WRITE_FREEZE_AT', // checks.incidentClosure
  'RECOVERY_SECURITY_REAPPLIED_AT', // checks.postRestoreSecurity
  'DEPLOY_PINNED_COMMIT', // checks.deployPin
];

/* ───────────────────────────── 존재 상태 ───────────────────────────── */

/**
 * - `set`    : 값이 있다(내용은 보지 않는다).
 * - `blank`  : 키는 있는데 공백뿐이다 — **대시보드에는 「있다」로 보이지만** 읽는 쪽은 미설정과
 *              똑같이 동작한다(`PRIVACY_PROCESSORS=' '` → 고지가 「고지 전」으로 남는다).
 * - `absent` : 키가 없다.
 */
export type PresenceState = 'set' | 'blank' | 'absent';

export interface PresenceRow {
  key: string;
  kind: EnvVar['kind'];
  group: string;
  state: PresenceState;
}

/** 키 1건의 존재 상태. **값을 돌려주지 않는다** */
export function presenceOf(env: Record<string, string | undefined>, key: unknown): PresenceState {
  const raw = env[String(key ?? '')];
  if (raw === undefined || raw === null) return 'absent';
  return String(raw).trim() === '' ? 'blank' : 'set';
}

/** 스위치 ON 판독. 실제 읽는 쪽(`env.X === 'true'`)과 **글자 그대로 같게** 본다 */
export function isSwitchOn(env: Record<string, string | undefined>, key: unknown): boolean {
  return env[String(key ?? '')] === 'true';
}

/** 사람이 복구해야 하는 키(플랫폼 자동 주입 제외)의 존재 상태 — 값 없음 */
export function presenceRows(env: Record<string, string | undefined> = process.env): PresenceRow[] {
  return restorableVars().map((v) => ({
    key: v.key,
    kind: v.kind,
    group: v.group,
    state: presenceOf(env, v.key),
  }));
}

/** 묶음별 설정 개수 요약(문서·보고용). 키 이름과 개수만 */
export function presenceByGroup(rows: readonly PresenceRow[]): Array<{ group: string; set: number; total: number; missing: string[] }> {
  const out: Array<{ group: string; set: number; total: number; missing: string[] }> = [];
  for (const r of rows) {
    let g = out.find((x) => x.group === r.group);
    if (!g) {
      g = { group: r.group, set: 0, total: 0, missing: [] };
      out.push(g);
    }
    g.total += 1;
    if (r.state === 'set') g.set += 1;
    else g.missing.push(r.key);
  }
  return out;
}

/** 키는 있는데 공백뿐인 키들 — 「있다」로 세지 않는다 */
export function blankKeys(rows: readonly PresenceRow[]): string[] {
  return rows.filter((r) => r.state === 'blank').map((r) => r.key).sort();
}

/* ───────────────────────── (가) 묶음 정합성 — 기준 없이 판정 ───────────────────────── */

export interface CoherenceRule {
  /** 켜진 스위치(또는 설정된 값) */
  when: string;
  /** 함께 **값이 있어야** 하는 키 */
  needsSet: readonly string[];
  /** 함께 **ON 이어야** 하는 스위치 */
  needsOn: readonly string[];
  /** 조건이 깨졌을 때 조용히 생기는 일 — 어느 쪽도 오류를 내지 않는다 */
  effect: string;
  /**
   * 이 판정의 근거가 되는 모듈(저장소 루트 기준). 키가 옮겨 가거나 선행 조건이 코드에서
   * 빠지면 정본을 함께 고치도록 고정한다 — 규칙의 키는 **이 파일들 중 어딘가에** 있어야 한다
   * (스위치를 정의하는 파일과 그것을 읽는 파일이 다른 경우가 있다).
   */
  ownerFiles: readonly string[];
}

/**
 * **스위치가 켜졌는데 그 스위치가 필요로 하는 값이 없는** 조합 정본.
 * 전부 실제 소스의 동작에서 가져왔고(각 `ownerFile` 이 그 키를 읽는지 테스트가 매번 대조한다),
 * 기준 스냅샷 없이도 판정된다 — 유실이 **묶음의 일부**일 때 가장 먼저 걸리는 그물이다.
 */
export const COHERENCE_RULES: readonly CoherenceRule[] = [
  {
    when: 'LEGAL_DOCS_FINAL',
    needsSet: ['LEGAL_TERMS_VERSION', 'LEGAL_TERMS_EFFECTIVE', 'LEGAL_PRIVACY_VERSION', 'LEGAL_PRIVACY_EFFECTIVE'],
    needsOn: [],
    effect:
      '확정 스위치는 켜졌지만 `legalDoc()` 이 fail-safe 로 **draft 로 남는다** — 화면은 「초안」 배너를 ' +
      '그대로 띄우고, 그 모습은 **「아직 확정 전」과 구분되지 않는다**(§4-10 의 눈 확인이 통과한다)',
    ownerFiles: ['src/lib/legal.ts'],
  },
  {
    when: 'LEGAL_CONSENT_REQUIRED',
    needsSet: [],
    needsOn: ['LEGAL_DOCS_FINAL'],
    effect:
      '가입 동의를 **초안 문서에 대해** 강제한다 — 감사로그에 남는 동의 버전 스냅샷이 `draft` 가 되어 ' +
      '「무엇에 동의했는가」를 사후에 특정할 수 없다',
    ownerFiles: ['src/lib/legal.ts'],
  },
  {
    when: 'MONITORING_ENABLED',
    needsSet: ['SENTRY_DSN'],
    needsOn: [],
    effect:
      '전역 에러 캡처가 **전송 없이 no-op** 으로 돌아간다(`MONITORING_ENABLED` 는 DSN 과 둘 다 있어야 ON). ' +
      '`ALERT_WEBHOOK_URL` 이 남아 있어도 알림은 이 플래그를 거치므로 **함께 멈춘다**',
    ownerFiles: ['src/lib/logger.ts'],
  },
  {
    when: 'PAYMENTS_LIVE',
    needsSet: ['PORTONE_STORE_ID', 'PORTONE_CHANNEL_KEY', 'PORTONE_API_SECRET', 'PORTONE_WEBHOOK_SECRET'],
    needsOn: [],
    effect:
      '실결제 경로가 **테스트 더미 설정으로 열린다**. `checks.billing` 이 상점ID·채널키·API시크릿 3개는 ' +
      '이미 보지만 **웹훅 서명 키는 보지 않는다** — 그 키가 없으면 웹훅 검증이 설정되지 않은 채 열린다',
    ownerFiles: ['src/lib/portone.ts', 'src/lib/billing.ts'],
  },
  {
    when: 'BILLING_APPLY_LIVE',
    needsSet: [],
    needsOn: ['PAYMENTS_LIVE'],
    effect:
      '웹훅 결과가 **DB 에 반영되지 않는다**(둘 다 ON 이어야 반영된다) — 반영되는 줄 알고 결제 상태를 ' +
      '믿게 되는데 응답은 scaffold 로 200 을 낸다',
    ownerFiles: ['src/lib/billingWebhook.ts', 'src/lib/billing.ts'],
  },
  {
    when: 'PARTNER_ATTRIBUTION_ENABLED',
    needsSet: [],
    needsOn: ['PARTNER_CHANNEL_ENABLED'],
    effect:
      '`resolvePartnerId` 가 항상 null 이라 매출 귀속 기록이 **전건 직접 계약**으로 남는다 — 정산 분쟁을 ' +
      '예방하려고 켠 기록이 근거가 되지 못한다',
    ownerFiles: ['src/lib/partnerAttribution.ts', 'src/lib/partner.ts'],
  },
  {
    when: 'PARTNER_ROLE_ENABLED',
    needsSet: [],
    needsOn: ['PARTNER_CHANNEL_ENABLED'],
    effect:
      '파트너 가시 범위가 매출 귀속 기록에서 파생되는데 그 기록이 직접 계약으로만 남아 **보이는 고객사가 ' +
      '없다** — 권한을 준 줄 알고 담당자에게 안내하게 된다',
    ownerFiles: ['src/lib/partnerRbac.ts', 'src/lib/partner.ts'],
  },
  {
    when: 'PARTNER_SETTLEMENT_ENABLED',
    needsSet: ['PARTNER_COMMISSION_RATES'],
    needsOn: [],
    effect:
      '정산 리포트가 전건 `rate_unconfigured` 로 **계산을 멈춘다**(임의 기본 요율을 쓰지 않는다) — ' +
      '요율 키가 유실되면 리포트는 열리는데 금액이 비어 있다',
    ownerFiles: ['src/lib/settlement.ts'],
  },
];

/**
 * - `inactive`    : 스위치가 OFF 다 — 판정 대상이 아니다.
 * - `satisfied`   : 필요한 값이 모두 있다.
 * - `ineffective` : 켜졌는데 **아무 일도 하지 않는다**(또는 의도와 다르게 동작한다).
 */
export type CoherenceState = 'inactive' | 'satisfied' | 'ineffective';

export interface CoherenceFinding {
  when: string;
  state: CoherenceState;
  /** 값이 없는(또는 OFF 인) 선행 키. `ineffective` 일 때만 채운다 */
  missing: string[];
  effect: string;
}

/** 묶음 정합성 판정. **기준 스냅샷 없이** 돌아간다 */
export function assessCoherence(env: Record<string, string | undefined> = process.env): CoherenceFinding[] {
  return COHERENCE_RULES.map((rule) => {
    if (!isSwitchOn(env, rule.when)) {
      return { when: rule.when, state: 'inactive' as CoherenceState, missing: [], effect: rule.effect };
    }
    const missing = [
      ...rule.needsSet.filter((k) => presenceOf(env, k) !== 'set'),
      ...rule.needsOn.filter((k) => !isSwitchOn(env, k)),
    ];
    return {
      when: rule.when,
      state: (missing.length ? 'ineffective' : 'satisfied') as CoherenceState,
      missing,
      effect: rule.effect,
    };
  });
}

/** 켜졌는데 동작하지 않는 스위치 이름만(응답·로그용) */
export function ineffectiveSwitches(rows: readonly CoherenceFinding[]): string[] {
  return rows.filter((r) => r.state === 'ineffective').map((r) => r.when);
}

/* ───────────────────────── (나) 기준 스냅샷 — 키 이름만 ───────────────────────── */

export interface EnvBaseline {
  /** 스냅샷을 뜬 날(YYYY-MM-DD). 판독 불가·미설정이면 null — 지어내지 않는다 */
  asOf: string | null;
  /** 그때 **값이 있던** 키 이름(정렬·중복 제거) */
  keys: string[];
  /** 해석하지 못한 토큰 — 조용히 버리지 않고 보고한다 */
  invalid: string[];
  /** 값이 섞여 들어왔는가. **섞인 스냅샷은 키를 채택하지 않는다** */
  valuesPresent: boolean;
}

/** 원문에서 스냅샷을 읽는다(미설정이면 null). 판정은 `assessEnvRestore` 가 한다 */
export function envBaselineFromEnv(env: Record<string, string | undefined> = process.env): string | null {
  const raw = (env.RECOVERY_ENV_BASELINE ?? '').trim();
  return raw ? raw : null;
}

function pushKey(into: Set<string>, invalid: string[], token: string): void {
  const t = token.trim();
  if (!t) return;
  if (isEnvKeyToken(t)) into.add(t);
  else invalid.push(t.length > 40 ? `${t.slice(0, 40)}…` : t);
}

/**
 * 스냅샷 해석. 두 형식을 받는다.
 *   · JSON  : `{"asOf":"2026-10-15","keys":["DATABASE_URL","SESSION_COOKIE"]}`
 *   · 한 줄 : `asOf=2026-10-15;keys=DATABASE_URL,SESSION_COOKIE`
 * **값이 섞인 입력은 키를 채택하지 않는다**(`valuesPresent`) — 받아 주면 복구 기준이라는 이름으로
 * 시크릿이 env 에 한 벌 더 복제된다(§3-4 가 연결 문자열을 거절하는 것과 같은 규율).
 */
export function parseEnvBaseline(raw: unknown): EnvBaseline | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;

  const keys = new Set<string>();
  const invalid: string[] = [];
  let asOf: string | null = null;
  let valuesPresent = false;

  if (s.startsWith('{')) {
    let obj: unknown;
    try {
      obj = JSON.parse(s);
    } catch {
      return { asOf: null, keys: [], invalid: ['JSON 파싱 실패'], valuesPresent: false };
    }
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
      return { asOf: null, keys: [], invalid: ['JSON 객체가 아니다'], valuesPresent: false };
    }
    const rec = obj as Record<string, unknown>;
    if (!Array.isArray(rec.keys)) {
      // `{"DATABASE_URL":"postgres://…"}` 처럼 **env 를 그대로 덤프한** 입력이다.
      return { asOf: null, keys: [], invalid: ['keys 배열이 없다'], valuesPresent: true };
    }
    if (typeof rec.asOf === 'string') asOf = parseRehearsalDate(rec.asOf);
    for (const k of rec.keys) {
      if (typeof k === 'string') pushKey(keys, invalid, k);
      else invalid.push('문자열이 아닌 키');
    }
  } else {
    for (const part of s.split(/[;\n]+/)) {
      const seg = part.trim();
      if (!seg) continue;
      const eq = seg.indexOf('=');
      const name = (eq < 0 ? seg : seg.slice(0, eq)).trim().toLowerCase();
      const body = eq < 0 ? '' : seg.slice(eq + 1).trim();
      if (name === 'asof') {
        asOf = parseRehearsalDate(body);
        if (body && asOf === null) invalid.push(`asOf 판독 불가: ${body.slice(0, 20)}`);
        continue;
      }
      if (name === 'keys') {
        for (const tok of body.split(/[,|\s]+/)) {
          if (tok.includes('=')) {
            valuesPresent = true;
            continue;
          }
          pushKey(keys, invalid, tok);
        }
        continue;
      }
      // `KEY=value` 꼴이 그대로 들어온 경우 — 값이 섞였다.
      if (eq > 0 && isEnvKeyToken(seg.slice(0, eq).trim())) valuesPresent = true;
      else invalid.push(seg.length > 40 ? `${seg.slice(0, 40)}…` : seg);
    }
  }

  return {
    asOf,
    keys: valuesPresent ? [] : [...keys].sort(),
    invalid,
    valuesPresent,
  };
}

/**
 * **지금** 값이 있는 복구 대상 키 이름으로 스냅샷 한 줄을 만든다(§2 월 점검에서 복사해 넣는다).
 * 값은 담지 않고, 임시 키(`TRANSIENT_KEYS`)와 스냅샷 자신은 제외한다.
 * `parseEnvBaseline` 로 되읽을 수 있는 형식이어야 한다(왕복 테스트가 고정한다).
 */
export function snapshotLine(env: Record<string, string | undefined> = process.env, now: Date = new Date()): string {
  const keys = snapshotKeys(env);
  const t = now.getTime();
  const asOf = Number.isNaN(t) ? null : new Date(t).toISOString().slice(0, 10);
  const head = asOf ? `asOf=${asOf};` : '';
  return `${head}keys=${keys.join(',')}`;
}

/** 스냅샷·대조 대상이 되는 키 — 값이 있는 복구 대상에서 임시 키와 스냅샷 자신을 뺀다 */
export function snapshotKeys(env: Record<string, string | undefined> = process.env): string[] {
  const transient = new Set<string>([...TRANSIENT_KEYS, ENV_BASELINE_ENV]);
  return presenceRows(env)
    .filter((r) => r.state === 'set' && !transient.has(r.key))
    .map((r) => r.key)
    .sort();
}

/* ───────────────────────────── 판정 ───────────────────────────── */

/**
 * - `no_baseline`      : 기준 스냅샷이 없다 — **평상시 상태**다. 유실을 판정하지 않는다.
 * - `invalid_baseline` : 적혀 있으나 쓸 수 없다(값이 섞였다·키를 하나도 못 읽었다).
 * - `missing`          : 기준에 있던 키가 지금 **없거나 공백**이다 → 복구에서 빠진 설정 후보.
 * - `undated`          : 키는 모두 있으나 스냅샷이 **언제 기준인지** 알 수 없다.
 * - `ok`              : 기준의 키가 모두 값으로 있다.
 */
export const RESTORE_VERDICTS = ['no_baseline', 'invalid_baseline', 'missing', 'undated', 'ok'] as const;
export type RestoreVerdict = (typeof RESTORE_VERDICTS)[number];

export interface RestoreAssessment {
  verdict: RestoreVerdict;
  /** 기준에 있었는데 지금 **없는** 키 */
  missingKeys: string[];
  /** 기준에 있었는데 지금 **공백뿐인** 키 — 대시보드에는 「있다」로 보인다 */
  blankedKeys: string[];
  /** 기준 뒤에 새로 들어온 키(참고용). **유실이 아니다** */
  addedKeys: string[];
  /** 기준에 있는데 레지스트리가 모르는 키 — 낡은 기준이다. 「유실」로 단정하지 않는다 */
  unknownKeys: string[];
  asOf: string | null;
  ageDays: number | null;
  /** 이 기준을 「복구 전 상태」로 써도 되는가(날짜·형식 자격) */
  trusted: boolean;
  action: string | null;
  caveats: readonly string[];
}

export const ACTION_RESTORE_NO_BASELINE =
  `키 이름 기준 스냅샷(\`${ENV_BASELINE_ENV}\`)이 없어 **유실된 설정을 판정하지 않는다** — ` +
  '§2 월 점검에서 `GET /api/health` 의 `checks.envPresence.detail.snapshot` 을 그대로 복사해 넣을 것. ' +
  '어느 키가 「있어야 하는가」는 계약·승인 상태에 따라 다르므로 코드가 지어내지 않는다(§4-12)';

export const ACTION_RESTORE_INVALID =
  `\`${ENV_BASELINE_ENV}\` 를 읽을 수 없다 — 키 **이름만** 담긴 \`asOf=YYYY-MM-DD;keys=A,B\` 형식으로 ` +
  '다시 적을 것. **값이 섞인 스냅샷은 채택하지 않는다**(복구 기준이라는 이름으로 시크릿이 한 벌 더 복제된다)';

export function actionRestoreMissing(missing: readonly string[], blanked: readonly string[]): string {
  const parts: string[] = [];
  if (missing.length) parts.push(`없는 키 ${missing.length}건: ${missing.join(', ')}`);
  if (blanked.length) parts.push(`공백뿐인 키 ${blanked.length}건: ${blanked.join(', ')}`);
  return (
    `평상시에 설정돼 있던 키가 지금 없다 — ${parts.join(' / ')}. §4 묶음 설명에서 **유실되면 무엇이 ` +
    '되돌아가는지**를 확인하고 발급처에서 재발급·재입력할 것. 어느 키도 오류를 내지 않으므로 화면으로는 알 수 없다'
  );
}

export const ACTION_RESTORE_UNDATED =
  `\`${ENV_BASELINE_ENV}\` 에 \`asOf\` 가 없어 **언제 기준인지** 알 수 없다 — 키 목록은 그대로 대조하되 ` +
  '「복구 전 상태」로 단정하지 않는다. §2 월 점검에서 날짜를 함께 적을 것';

export function actionRestoreOk(count: number, asOf: string): string {
  return `${asOf} 기준 ${count}개 키가 모두 값으로 있다. 기준 갱신은 §2 월 점검에서 한다`;
}

export const CAVEAT_PRESENCE_NOT_VALUE =
  '이 판정은 **키가 있는지**까지만 말한다 — 값이 맞는지(옛 시크릿·다른 환경의 값·오타)는 보지 않는다. ' +
  '값이 틀린 쪽은 대부분 오류를 내므로 이 체크의 대상이 아니다';

export const CAVEAT_BASELINE_IS_A_LIST =
  '기준 스냅샷은 **그때 값이 있던 키 목록**일 뿐이다 — 그때 설정이 옳았다는 뜻이 아니고, ' +
  '스냅샷 이후 의도적으로 추가·삭제한 키는 `addedKeys`/`missingKeys` 로 똑같이 보인다';

export const CAVEAT_THIS_DEPLOYMENT_ONLY =
  '이 배포의 env 만 본다 — Vercel 스코프(Production/Preview)를 틀린 입력이나 다른 배포의 설정은 알 수 없다';

/** 존재 대조가 보장하지 **못하는** 것 — 응답·RUNBOOK 에 그대로 실어 보낸다 */
export const PRESENCE_LIMITS: readonly string[] = [
  CAVEAT_PRESENCE_NOT_VALUE,
  CAVEAT_BASELINE_IS_A_LIST,
  CAVEAT_THIS_DEPLOYMENT_ONLY,
  '복구·롤백용 임시 키(`RECOVERY_WRITE_FREEZE`·`RECOVERY_WRITE_FREEZE_AT`·' +
    '`RECOVERY_SECURITY_REAPPLIED_AT`·`DEPLOY_PINNED_COMMIT`)는 **평상시 미설정이 정상**이라 ' +
    '스냅샷·유실 판정에서 빠진다 — 그쪽은 각 전용 체크가 본다',
  '묶음 정합성은 **열거된 조합만** 본다(`COHERENCE_RULES`) — 선행 조건이 없는 스위치의 유실은 ' +
    '기준 스냅샷이 있어야 드러난다',
];

function dayIndex(iso: string): number {
  return Math.floor(new Date(`${iso}T00:00:00Z`).getTime() / MS_DAY);
}

/**
 * 기준 스냅샷 ↔ 현재 존재 상태 대조.
 * 판정 순서: **유실이 기준치 자격보다 먼저다** — 날짜가 없다는 사실로 `missing` 을 덮지 않는다
 * (고칠 대상이 다르다. 유실은 지금 복구해야 하고, 날짜는 다음 점검에서 채운다).
 */
export function assessEnvRestore(args: {
  env?: Record<string, string | undefined>;
  baseline?: unknown;
  now?: Date;
}): RestoreAssessment {
  const env = args.env ?? process.env;
  const shell = {
    missingKeys: [] as string[],
    blankedKeys: [] as string[],
    addedKeys: [] as string[],
    unknownKeys: [] as string[],
    asOf: null as string | null,
    ageDays: null as number | null,
    caveats: PRESENCE_LIMITS,
  };

  const parsed = parseEnvBaseline(args.baseline);
  if (!parsed) {
    return { ...shell, verdict: 'no_baseline', trusted: false, action: ACTION_RESTORE_NO_BASELINE };
  }
  if (parsed.valuesPresent || parsed.keys.length === 0) {
    return {
      ...shell,
      verdict: 'invalid_baseline',
      asOf: parsed.asOf,
      trusted: false,
      action: ACTION_RESTORE_INVALID,
    };
  }

  const known = new Set(ENV_VARS.map((v) => v.key));
  const transient = new Set<string>([...TRANSIENT_KEYS, ENV_BASELINE_ENV]);
  const unknownKeys = parsed.keys.filter((k) => !known.has(k)).sort();
  const compare = parsed.keys.filter((k) => known.has(k) && !transient.has(k));

  const missingKeys: string[] = [];
  const blankedKeys: string[] = [];
  for (const k of compare) {
    const state = presenceOf(env, k);
    if (state === 'absent') missingKeys.push(k);
    else if (state === 'blank') blankedKeys.push(k);
  }

  const baseSet = new Set(parsed.keys);
  const addedKeys = snapshotKeys(env).filter((k) => !baseSet.has(k));

  const asOf = parsed.asOf;
  const today = args.now ? new Date(args.now.getTime()) : new Date();
  const todayIso = Number.isNaN(today.getTime()) ? null : today.toISOString().slice(0, 10);
  const ageDays = asOf && todayIso ? dayIndex(todayIso) - dayIndex(asOf) : null;
  const dated = asOf !== null && ageDays !== null && ageDays >= 0;

  const common = {
    ...shell,
    missingKeys: missingKeys.sort(),
    blankedKeys: blankedKeys.sort(),
    addedKeys: addedKeys.sort(),
    unknownKeys,
    asOf,
    ageDays,
  };

  if (missingKeys.length || blankedKeys.length) {
    return {
      ...common,
      verdict: 'missing',
      trusted: dated,
      action: actionRestoreMissing(common.missingKeys, common.blankedKeys),
    };
  }
  if (!dated) {
    return { ...common, verdict: 'undated', trusted: false, action: ACTION_RESTORE_UNDATED };
  }
  return { ...common, verdict: 'ok', trusted: true, action: actionRestoreOk(compare.length, asOf as string) };
}

/* ───────────────────────────── 출력 ───────────────────────────── */

/** 사람이 읽을 요약. 키 이름·개수·날짜만(값 없음) */
export function presenceText(restore: RestoreAssessment, coherence: readonly CoherenceFinding[]): string {
  const parts = [`§4 설정 복구: ${restore.verdict}`];
  if (restore.asOf) parts.push(`기준 ${restore.asOf}`);
  if (restore.ageDays !== null) parts.push(`${restore.ageDays}일 경과`);
  if (restore.missingKeys.length) parts.push(`없는 키 ${restore.missingKeys.join(', ')}`);
  if (restore.blankedKeys.length) parts.push(`공백 키 ${restore.blankedKeys.join(', ')}`);
  const bad = ineffectiveSwitches(coherence);
  if (bad.length) parts.push(`켜졌는데 동작하지 않는 스위치: ${bad.join(', ')}`);
  const text = `${parts.join(' · ')}.`;
  return restore.action ? `${text}\n→ ${restore.action}` : text;
}

/** 로그 한 줄. 판정·개수·키 이름만 */
export function presenceLogLine(restore: RestoreAssessment, coherence: readonly CoherenceFinding[]): string {
  const parts = [`verdict=${restore.verdict}`];
  if (restore.asOf) parts.push(`as_of=${restore.asOf}`);
  if (restore.ageDays !== null) parts.push(`age_days=${restore.ageDays}`);
  if (restore.missingKeys.length) parts.push(`missing=${restore.missingKeys.join(',')}`);
  if (restore.blankedKeys.length) parts.push(`blank=${restore.blankedKeys.join(',')}`);
  const bad = ineffectiveSwitches(coherence);
  if (bad.length) parts.push(`ineffective=${bad.join(',')}`);
  return `[env-presence] ${parts.join(' ')}`;
}

/* ───────────────────────────── /api/health 체크 ───────────────────────────── */

/**
 * §4 복구가 됐는지를 **평상시에도** 드러낸다. 두 판정을 합치지만 성질은 다르다 —
 * 묶음 정합성은 기준 없이 지금 상태만으로 판정되고, 유실 판정은 §2 스냅샷이 있어야 돌아간다.
 *
 * **required: false** — 어느 경우에도 503 을 만들지 않는다(설정 유실로 서비스를 내리면
 * 복구 자신이 막힌다. §3-3 이 차단을 degraded 로만 드러내는 것과 같은 규율).
 * 공개 엔드포인트이므로 **값은 담지 않는다** — 키 이름·판정·날짜·개수뿐이다.
 */
export function envPresenceCheck(args?: {
  env?: Record<string, string | undefined>;
  now?: Date;
}): { ok: boolean; required: false; detail: Record<string, unknown> } {
  const env = args?.env ?? process.env;
  const rows = presenceRows(env);
  const coherence = assessCoherence(env);
  const restore = assessEnvRestore({ env, baseline: envBaselineFromEnv(env), now: args?.now });
  const ineffective = ineffectiveSwitches(coherence);

  return {
    // `no_baseline` 은 **평상시 상태**라 degraded 로 만들지 않는다(§3-4 의 `unset` 과 같은 규율).
    ok: restore.verdict !== 'missing' && restore.verdict !== 'invalid_baseline' && ineffective.length === 0,
    required: false,
    detail: {
      verdict: restore.verdict,
      asOf: restore.asOf,
      ageDays: restore.ageDays,
      trusted: restore.trusted,
      missingKeys: restore.missingKeys,
      blankedKeys: restore.blankedKeys,
      addedKeys: restore.addedKeys,
      unknownKeys: restore.unknownKeys,
      ineffective,
      coherence: coherence.filter((c) => c.state === 'ineffective'),
      blank: blankKeys(rows),
      groups: presenceByGroup(rows).map((g) => ({ group: g.group, set: g.set, total: g.total })),
      configKeys: { baseline: ENV_BASELINE_ENV },
      snapshot: snapshotLine(env, args?.now ?? new Date()),
      action: restore.action,
      limits: PRESENCE_LIMITS,
    },
  };
}

/** 설정 상태 요약(문서·보고용). 값은 담지 않는다 */
export function envPresenceStatus(env: Record<string, string | undefined> = process.env): {
  baselineConfigured: boolean;
  trackedKeys: number;
  setKeys: number;
  rules: number;
  note: string;
} {
  const rows = presenceRows(env);
  return {
    baselineConfigured: envBaselineFromEnv(env) !== null,
    trackedKeys: rows.length,
    setKeys: rows.filter((r) => r.state === 'set').length,
    rules: COHERENCE_RULES.length,
    note:
      envBaselineFromEnv(env) === null
        ? `${ENV_BASELINE_ENV} 미설정 — 유실 판정을 하지 않는다(어느 키가 있어야 하는지 코드가 정하지 않는다)`
        : '기준 스냅샷의 키가 지금도 값으로 있는지 대조한다(값은 보지 않는다)',
  };
}

/* ───────────────────────────── 배선 정적 점검 ───────────────────────────── */

/** `/api/health` 가 이 판정을 **응답에 실어** 보내는지 원문으로 고정한다 */
export function auditHealthWiring(src: unknown): string[] {
  const s = String(src ?? '');
  const problems: string[] = [];
  if (!/from\s+['"]@\/lib\/envPresence['"]/.test(s)) problems.push('envPresence 를 import 하지 않는다');
  if (!/envPresenceCheck\(/.test(s))
    problems.push('envPresenceCheck() 를 호출하지 않는다 — §4 복구 누락이 평상시에 드러나지 않는다');
  if (!/checks\.envPresence\s*=\s*envPresenceCheck\(/.test(s))
    problems.push('판정을 checks.envPresence 로 내보내지 않는다(판정만 하고 버리는 꼴)');
  return problems;
}

/**
 * 묶음 정합성 규칙의 **근거 모듈이 그 키를 여전히 읽는지** 원문으로 대조한다.
 * 키가 옮겨 가거나 선행 조건이 코드에서 빠지면 이 정본이 조용히 낡는다(= 있지도 않은 조건을
 * 요구하거나, 깨진 조합을 `satisfied` 로 넘긴다) — 그러면 CI 를 실패시킨다.
 */
export function auditRuleSources(sources: Record<string, string | undefined>): string[] {
  const problems: string[] = [];
  for (const rule of COHERENCE_RULES) {
    const got = rule.ownerFiles.filter((f) => typeof sources[f] === 'string');
    for (const f of rule.ownerFiles) {
      if (!got.includes(f)) problems.push(`${f} 원문을 받지 못했다(${rule.when} 규칙의 근거)`);
    }
    if (!got.length) continue;
    const joined = got.map((f) => sources[f] as string).join('\n');
    for (const key of [rule.when, ...rule.needsSet, ...rule.needsOn]) {
      if (!joined.includes(key)) {
        problems.push(`${rule.ownerFiles.join('·')} 가 ${key} 를 더 이상 읽지 않는다 — 정본을 고칠 것`);
      }
    }
  }
  return problems;
}

/** 규칙·임시 키 정본이 레지스트리와 어긋나지 않는지(유령 키 방지) */
export function auditRuleShape(): string[] {
  const known = new Set(ENV_VARS.map((v) => v.key));
  const problems: string[] = [];
  for (const k of TRANSIENT_KEYS) {
    if (!known.has(k)) problems.push(`임시 키 ${k} 가 레지스트리에 없다`);
  }
  for (const rule of COHERENCE_RULES) {
    for (const key of [rule.when, ...rule.needsSet, ...rule.needsOn]) {
      if (!known.has(key)) problems.push(`규칙 ${rule.when} 의 ${key} 가 레지스트리에 없다`);
    }
    if (!rule.needsSet.length && !rule.needsOn.length) problems.push(`규칙 ${rule.when} 에 선행 조건이 없다`);
    if (!rule.effect.trim()) problems.push(`규칙 ${rule.when} 에 영향 설명이 없다`);
  }
  return problems;
}

/**
 * 실제 `RUNBOOK.md` 점검 — §4 가 **확인되는 절차**로 남아 있는지.
 * §4-10 이 눈 확인 5줄로 되돌아가거나 §4-12·스냅샷 키가 사라지면 CI 를 실패시킨다.
 */
export function auditRunbookPresence(src: unknown): string[] {
  const s = String(src ?? '');
  const problems: string[] = [];
  if (!s.includes(ENV_BASELINE_ENV)) problems.push(`기준 스냅샷 키(${ENV_BASELINE_ENV})가 문서에 없다`);
  if (!/####\s*4-12\./.test(s)) problems.push('§4-12(설정 복구 확인) 절이 없다');
  if (!s.includes('checks.envPresence')) problems.push('평상시 확인 수단(checks.envPresence)이 적혀 있지 않다');

  const start = s.search(/^####\s*4-10\./m);
  const end = s.search(/^####\s*4-11\./m);
  const sec = start >= 0 && end > start ? s.slice(start, end) : '';
  if (!sec) {
    problems.push('§4-10 본문을 찾을 수 없다');
    return problems;
  }
  if (!sec.includes('checks.envPresence')) problems.push('§4-10 확인 순서가 기계적 확인 수단을 가리키지 않는다');
  if (!sec.includes('4-12')) problems.push('§4-10 이 4-12 를 가리키지 않는다 — 담당자가 절차에 닿지 못한다');

  const start2 = s.search(/^##\s*2\.\s/m);
  const end2 = s.search(/^##\s*3\.\s/m);
  const sec2 = start2 >= 0 && end2 > start2 ? s.slice(start2, end2) : '';
  if (!sec2) problems.push('§2 본문을 찾을 수 없다');
  else if (!sec2.includes(ENV_BASELINE_ENV)) problems.push('§2 월 점검에 기준 스냅샷 갱신 단계가 없다');
  return problems;
}
