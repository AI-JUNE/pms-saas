/**
 * dbIdentity.ts — RUNBOOK §3 **5단계(전환)** 가 실제로 일어났는지 확인할 수 있게 만든다. 2026-10-07
 *
 * ── 왜 필요한가 ───────────────────────────────────────────────────────────────
 * 배치176~180이 §3 의 2·4·6단계를 기계화했다. 그 사이에 끼인 **5단계**는 여전히
 * 「4단계가 `switchReady: true` 일 때만 운영 `DATABASE_URL` 을 복구 브랜치로 교체하고
 * 재배포한다」는 한 문장이고, **그 교체가 반영됐는지 확인하는 수단이 어디에도 없었다.**
 *
 * 어떻게 조용히 실패하는가(전부 사람이 실제로 저지르는 종류다):
 *   · Vercel 환경변수는 **재배포 전까지 기존 배포에 반영되지 않는다.** 값을 바꿔 저장한
 *     뒤 재배포를 거르면 운영은 그대로 **손상된 DB** 를 본다.
 *   · 환경변수를 Preview·Development 스코프에만 넣고 Production 을 빼먹는 실수,
 *     붙여넣기가 잘려 옛 값이 남는 실수도 같은 결과를 만든다.
 *   · 그런데 뒤따르는 확인은 전부 **통과한다**:
 *       `GET /api/health` 의 `checks.db` 는 `select 1` 이라 어느 DB 든 ok,
 *       6단계 `POST /api/admin/migrate` 의 `schema.verdict` 는 손상된 운영 DB 에도
 *       테이블이 다 있으므로 `ok`,
 *       7단계에서 쓰기 차단을 풀면 서비스가 정상으로 보인다.
 *   · 결과: **복구는 「성공」으로 끝나고 복구된 데이터는 어디에도 쓰이지 않는다.**
 *     그 뒤 쓰기는 손상된 DB 에 쌓이고 복구 브랜치는 뒤처져, 두 번째 복구 기회까지 잃는다.
 *   · 4단계에도 같은 구멍이 있다 — 스테이징 `DATABASE_URL` 에 **운영 연결문자열**을
 *     잘못 넣으면 손상된 운영 DB 의 행 수를 세고 `ok` 를 낸다(대조 대상이 바뀐 것을
 *     아무도 모른다).
 *
 * 이 모듈이 메우는 방식:
 *   · 연결 문자열에서 **자격증명을 뺀 식별 정보**만 뽑아(`parseConnection`) 안정된 짧은
 *     지문을 만든다(`dbFingerprint`). 지문은 「이 배포가 어느 DB 를 보도록 설정됐는가」다.
 *   · 복구 담당자가 3단계에서 뜬 복구 브랜치의 지문을 `RECOVERY_EXPECTED_DB` 에 적어 두면
 *     `compareIdentity` 가 **match / mismatch** 를 기계적으로 판정한다. 교체가 반영되지
 *     않은 배포는 `mismatch` 로 드러난다.
 *   · `/api/health` 의 `checks.dbIdentity`(`dbIdentityCheck`)와 4단계 응답
 *     (`gateSwitchReady`)에 같은 판정을 싣는다 — `mismatch` 면 **전환 가능 판정을 내린다**.
 *
 * 원칙
 * - 순수 모듈: DB·DDL·파일시스템 미접근. 신규 조회 0 — 판정은 env 값 해석만으로 한다
 *   (`src/db/index.ts` 가 쓰는 것과 **같은 키**를 읽으므로 그 프로세스의 실제 연결 대상이다).
 * - **비밀값을 담지 않는다**: 비밀번호·사용자명은 파싱 결과에서 아예 버리고, 호스트는
 *   마스킹해서만 내보낸다. 공개 `/api/health` 에는 지문·provider·pooled·region 뿐이다.
 * - fail-safe: 읽을 수 없으면 `match` 로 올리지 않는다(`unknown_actual`·`invalid_expected`).
 *   기준값 미설정(`unset`)은 평상시 상태이므로 degraded 로 만들지 않되 `trusted: false` 다.
 * - **새 거짓 ok 를 만들지 않는다**: 지문이 보장하지 **못하는** 것을 `IDENTITY_LIMITS` 로
 *   응답·RUNBOOK 에 함께 내보낸다(제자리 복구는 지문이 바뀌지 않는다 등).
 */

import { createHash } from 'node:crypto';

/** 연결 대상을 읽어 오는 키. `src/db/index.ts` 가 쓰는 키와 같아야 의미가 있다(아래 `auditClientSource`) */
export const DB_URL_ENV = 'DATABASE_URL';

/** 기준 지문. 복구 중에만 사람이 넣는다(평상시 미설정이 정상) */
export const EXPECTED_DB_ENV = 'RECOVERY_EXPECTED_DB';

/** 지문 길이(16진 문자 수). 짧게 쓰되 눈으로 비교할 수 있는 길이 */
export const FINGERPRINT_LEN = 12;

/** 지문 해시의 도메인 구분자 — 다른 용도의 해시와 섞이지 않게 한다 */
const FINGERPRINT_DOMAIN = 'pms-db-identity-v1';

export const IDENTITY_RUNBOOK_REF = 'RUNBOOK §3 5단계(전환)·§3-4(연결 대상 확인)';

/* ───────────────────────────── 연결 문자열 파싱 ───────────────────────────── */

/** 지원 스킴. 모르는 스킴은 추측하지 않는다 */
const SCHEMES: readonly string[] = ['postgres', 'postgresql'];

export type ConnFailure = 'unset' | 'not_a_url' | 'unsupported_scheme' | 'no_host';

/**
 * 연결 문자열에서 **식별에 필요한 것만** 뽑은 결과.
 * 사용자명·비밀번호는 담지 않는다 — 판정에 쓰이지 않고 유출 표면만 넓힌다.
 */
export interface ConnTarget {
  scheme: string;
  /** 소문자 호스트 */
  host: string;
  port: number | null;
  database: string | null;
  /** 비밀번호가 **있었는지**만. 값은 버린다 */
  hasPassword: boolean;
}

export type ConnParse =
  | { ok: true; target: ConnTarget }
  | { ok: false; reason: ConnFailure };

/**
 * 연결 문자열 파싱. `new URL` 을 쓰지 않는다 — 비밀번호에 `@`·`/` 가 들어간 실제
 * 문자열에서 구현체별 차이가 나고, 파서가 비밀번호를 객체에 들고 있게 되기 때문이다.
 * 여기서는 비밀번호 구간을 **읽는 즉시 버린다**.
 */
export function parseConnection(raw: unknown): ConnParse {
  const s = String(raw ?? '').trim();
  if (!s) return { ok: false, reason: 'unset' };

  const m = s.match(/^([a-zA-Z][a-zA-Z0-9+.\-]*):\/\/(.*)$/);
  if (!m) return { ok: false, reason: 'not_a_url' };

  const scheme = m[1].toLowerCase();
  if (!SCHEMES.includes(scheme)) return { ok: false, reason: 'unsupported_scheme' };

  // 쿼리스트링(sslmode 등)은 연결 **대상**이 아니므로 버린다.
  const body = m[2].split('?')[0].split('#')[0];

  // userinfo 는 **마지막 '@'** 로 가른다 — 실제 비밀번호에는 인코딩되지 않은 `@`·`/`
  // 가 들어 있기 곤란해도 들어오는 일이 있고, 그때 호스트를 잘못 읽으면 지문이 바뀐다.
  // (그 대신 DB 이름에 `@` 가 들어간 경우는 읽을 수 없다 — 호스트 모양을 검사해 걸러낸다.)
  const at = body.lastIndexOf('@');
  const afterAt = at >= 0 ? body.slice(at + 1) : body;
  const userinfo = at >= 0 ? body.slice(0, at) : '';
  const slash = afterAt.indexOf('/');
  const hostport = slash >= 0 ? afterAt.slice(0, slash) : afterAt;
  const pathPart = slash >= 0 ? afterAt.slice(slash + 1) : '';
  const colon = userinfo.indexOf(':');
  const hasPassword = colon >= 0 && userinfo.slice(colon + 1).length > 0;

  let host = hostport;
  let port: number | null = null;
  const v6 = hostport.match(/^\[([^\]]+)\](?::(\d+))?$/);
  if (v6) {
    host = v6[1];
    port = v6[2] ? Number(v6[2]) : null;
  } else {
    const pc = hostport.lastIndexOf(':');
    if (pc >= 0) {
      const tail = hostport.slice(pc + 1);
      host = hostport.slice(0, pc);
      // 포트가 숫자가 아니면 **추측하지 않는다** — null 로 두고 호스트만 쓴다.
      port = /^\d+$/.test(tail) ? Number(tail) : null;
    }
  }
  if (port !== null && (port < 1 || port > 65535)) port = null;

  host = host.trim().toLowerCase().replace(/\.$/, '');
  // 호스트 모양이 아니면 **지어내지 않는다**(모르는 꼴을 지문으로 굳히면 거짓 match 가 된다).
  if (!host || !(v6 ? /^[0-9a-f:.]+$/.test(host) : /^[a-z0-9][a-z0-9.\-_]*$/.test(host))) {
    return { ok: false, reason: 'no_host' };
  }

  const database = pathPart.split('/')[0].trim() || null;

  return { ok: true, target: { scheme, host, port, database, hasPassword } };
}

/* ───────────────────────────── 호스트 모양 ───────────────────────────── */

export interface HostShape {
  provider: 'neon' | 'unknown';
  /** Neon 컴퓨트 엔드포인트 id(`-pooler` 제거). 모양을 모르면 null — 지어내지 않는다 */
  endpointId: string | null;
  /** 커넥션 풀러(pgbouncer) 경유인가. **같은 브랜치이므로 지문은 같다** */
  pooled: boolean;
  region: string | null;
}

/**
 * 호스트에서 Neon 브랜치 식별자를 읽는다. `neon.tech` 가 아니면 `unknown` 으로 두고
 * 엔드포인트를 **추측하지 않는다**(자체 호스팅·프록시 경유를 Neon 으로 오인하지 않는다).
 */
export function hostShape(host: unknown): HostShape {
  const h = String(host ?? '').trim().toLowerCase();
  if (!h.endsWith('.neon.tech')) {
    return { provider: 'unknown', endpointId: null, pooled: false, region: null };
  }
  const labels = h.split('.');
  const first = labels[0] ?? '';
  const pooled = first.endsWith('-pooler');
  const bare = pooled ? first.slice(0, -'-pooler'.length) : first;
  const endpointId = /^ep-[a-z0-9-]+$/.test(bare) ? bare : null;
  // ep-xxx.<region>.<platform>.neon.tech → labels[1] 이 리전이다. 모양이 다르면 null.
  const region = labels.length >= 5 ? labels[1] : null;
  return { provider: 'neon', endpointId, pooled, region };
}

/**
 * 지문 대상 문자열. **풀러 접미사를 떼고** 만든다 — 직결과 pooled 는 같은 브랜치이므로
 * 같은 지문이어야 한다(그 사실은 `pooled` 로 따로 알린다).
 */
export function canonicalTarget(target: ConnTarget): string {
  const shape = hostShape(target.host);
  const hostKey = shape.endpointId
    ?? (shape.pooled ? target.host.replace('-pooler', '') : target.host);
  const portKey = shape.provider === 'neon' || target.port === null ? '' : `:${target.port}`;
  return `${hostKey}${portKey}|${target.database ?? ''}`;
}

/* ───────────────────────────── 지문 ───────────────────────────── */

/** 정규화된 대상 문자열의 지문. 역산 불가(비밀번호·사용자명은 애초에 들어가지 않는다) */
export function fingerprintOf(canonical: string): string {
  return createHash('sha256')
    .update(`${FINGERPRINT_DOMAIN}|${canonical}`)
    .digest('hex')
    .slice(0, FINGERPRINT_LEN);
}

/** 호스트 마스킹 — 사람이 「다른 DB 로 바뀌었다」를 눈으로 알아보되 전체를 적지 않는다 */
export function maskHost(host: unknown): string | null {
  const h = String(host ?? '').trim().toLowerCase();
  if (!h) return null;
  const dot = h.indexOf('.');
  const head = dot > 0 ? h.slice(0, dot) : h;
  const tail = dot > 0 ? h.slice(dot) : '';
  if (head.length <= 8) return `${head}${tail}`;
  return `${head.slice(0, 5)}…${head.slice(-4)}${tail}`;
}

export interface DbIdentity {
  /** 연결 문자열을 읽어냈는가 */
  known: boolean;
  /** 못 읽은 이유(읽었으면 null) */
  reason: ConnFailure | null;
  fingerprint: string | null;
  provider: 'neon' | 'unknown' | null;
  pooled: boolean | null;
  region: string | null;
  /** 마스킹된 호스트. **관리 응답 전용** */
  hostMasked: string | null;
  /** DB 이름. **관리 응답 전용**(시크릿은 아니지만 공개 엔드포인트에 둘 이유가 없다) */
  database: string | null;
  /** 비밀번호가 들어 있었는지 — 없으면 연결 문자열이 잘렸을 가능성을 알린다 */
  hasPassword: boolean | null;
}

const UNKNOWN_IDENTITY = (reason: ConnFailure): DbIdentity => ({
  known: false,
  reason,
  fingerprint: null,
  provider: null,
  pooled: null,
  region: null,
  hostMasked: null,
  database: null,
  hasPassword: null,
});

/** 연결 문자열 → 식별 정보. 비밀값은 결과에 담기지 않는다 */
export function identify(raw: unknown): DbIdentity {
  const parsed = parseConnection(raw);
  if (!parsed.ok) return UNKNOWN_IDENTITY(parsed.reason);
  const t = parsed.target;
  const shape = hostShape(t.host);
  return {
    known: true,
    reason: null,
    fingerprint: fingerprintOf(canonicalTarget(t)),
    provider: shape.provider,
    pooled: shape.pooled,
    region: shape.region,
    hostMasked: maskHost(t.host),
    database: t.database,
    hasPassword: t.hasPassword,
  };
}

/** 운영 배포가 실제로 쓰는 키에서 식별 정보를 읽는다 */
export function identityFromEnv(env: Record<string, string | undefined> = process.env): DbIdentity {
  return identify(env.DATABASE_URL);
}

/** 지문만 뽑는 단축 함수(RUNBOOK §3-4 의 한 줄 명령이 쓴다) */
export function dbFingerprint(raw: unknown): string | null {
  return identify(raw).fingerprint;
}

/* ───────────────────────────── 기준 지문 ───────────────────────────── */

export type ExpectedFailure = 'unset' | 'connection_string' | 'malformed';

export type ExpectedParse =
  | { ok: true; fingerprint: string }
  | { ok: false; reason: ExpectedFailure };

/**
 * 기준 지문 해석. **연결 문자열을 받지 않는다** — 받아 주면 비밀번호가 담긴 값이
 * 환경변수에 한 벌 더 복제되고, 유출 표면이 늘어난다. 그런 값은 `connection_string`
 * 으로 거절하고 RUNBOOK 의 지문 산출 명령으로 유도한다.
 */
export function parseExpected(raw: unknown): ExpectedParse {
  const s = String(raw ?? '').trim();
  if (!s) return { ok: false, reason: 'unset' };
  if (s.includes('://') || s.includes('@')) return { ok: false, reason: 'connection_string' };
  const v = s.toLowerCase();
  if (!new RegExp(`^[0-9a-f]{${FINGERPRINT_LEN}}$`).test(v)) return { ok: false, reason: 'malformed' };
  return { ok: true, fingerprint: v };
}

export function expectedFromEnv(env: Record<string, string | undefined> = process.env): ExpectedParse {
  return parseExpected(env.RECOVERY_EXPECTED_DB);
}

/* ───────────────────────────── 판정 ───────────────────────────── */

export type IdentityVerdict = 'match' | 'mismatch' | 'unset' | 'invalid_expected' | 'unknown_actual';

export const ACTION_IDENTITY_MATCH =
  '연결 대상이 기준 지문과 일치한다 — 전환이 이 배포에 반영되어 있다';
export const ACTION_IDENTITY_MISMATCH =
  `이 배포는 기준 지문과 **다른 DB** 를 보고 있다. ${EXPECTED_DB_ENV} 와 ${DB_URL_ENV} 를 같은 스코프(Production)에 넣었는지, **저장 후 재배포했는지** 확인한다. 환경변수 변경은 재배포 전까지 기존 배포에 반영되지 않는다 — ${IDENTITY_RUNBOOK_REF}`;
export const ACTION_IDENTITY_UNSET =
  `기준 지문 미설정(평상시 상태). 복구 중이라면 §3 3단계에서 뜬 복구 브랜치의 지문을 ${EXPECTED_DB_ENV} 에 넣어 5단계 전환 반영을 기계적으로 확인한다`;
export const ACTION_IDENTITY_INVALID = `${EXPECTED_DB_ENV} 값을 읽을 수 없다 — 지문 ${FINGERPRINT_LEN}자리 16진수만 넣는다(연결 문자열을 넣지 않는다). 산출 명령은 RUNBOOK §3-4`;
export const ACTION_IDENTITY_UNKNOWN_ACTUAL = `${DB_URL_ENV} 를 읽을 수 없어 연결 대상을 모른다 — 대조 자체가 성립하지 않는다(「일치」로 올리지 않는다)`;

/**
 * 지문이 보장하지 **못하는** 것. 「지문이 맞았다 = 복구 성공」이라는 착각이 바로 이
 * 모듈이 메우려는 종류의 구멍이므로 응답·문서에 함께 싣는다.
 */
export const IDENTITY_LIMITS: readonly string[] = [
  '지문은 「이 배포가 어느 DB 를 보도록 설정됐는가」까지만 말한다 — 그 DB 의 데이터가 옳은지는 §3 4단계(행 수 대조)가 본다',
  'Neon 에서 운영 브랜치를 **제자리 복구**하면 엔드포인트가 그대로여서 지문이 바뀌지 않는다 — 그 경로는 지문으로 확인할 수 없다',
  'pooled(`-pooler`) 와 직결은 같은 브랜치이므로 **같은 지문**이다(의도된 동작이며 pooled 로 따로 알린다)',
  '컴퓨트 재생성·엔드포인트 변경으로 호스트가 바뀌면 같은 데이터인데도 mismatch 가 난다 — 기준 지문을 다시 산출한다',
  '이 값은 **이 배포 자신의** 설정만 말한다(프리뷰·스테이징·로컬은 각자 다르다)',
  `${EXPECTED_DB_ENV} 는 사람이 넣는 값이다 — 전환과 함께 갱신하지 않으면 옛 기준으로 mismatch 가 난다`,
];

export interface PublicIdentity {
  fingerprint: string | null;
  provider: 'neon' | 'unknown' | null;
  pooled: boolean | null;
  region: string | null;
}

/** 공개 `/api/health` 에 내보낼 최소 정보 — 호스트·DB 이름은 담지 않는다 */
export function publicIdentity(id: DbIdentity): PublicIdentity {
  return { fingerprint: id.fingerprint, provider: id.provider, pooled: id.pooled, region: id.region };
}

export interface IdentityDecision {
  verdict: IdentityVerdict;
  /** 헬스체크 ok. `unset` 은 평상시 상태이므로 degraded 로 만들지 않는다 */
  ok: boolean;
  /** 「의도한 DB 임이 기계적으로 확인됐다」 — `match` 만 true */
  trusted: boolean;
  /** 전환 가능 판정(`switchReady`)을 내려야 하는가 — `mismatch` 만 true */
  blocksSwitch: boolean;
  actual: PublicIdentity;
  /** 읽어낸 기준 지문(없거나 못 읽으면 null) */
  expected: string | null;
  /** 기준값을 못 읽은 이유 */
  expectedReason: ExpectedFailure | null;
  /** 연결 문자열을 못 읽은 이유 */
  actualReason: ConnFailure | null;
  action: string;
  limits: readonly string[];
}

/**
 * 연결 대상 ↔ 기준 지문 대조.
 *
 * 판정 순서가 의미를 갖는다 — **연결 대상을 모르는 것**이 가장 먼저다.
 * 모르는 상태에서 기준값이 없다는 이유로 `unset`(=평상시)을 내면 「문제 없음」으로 읽힌다.
 */
export function compareIdentity(args: {
  url?: unknown;
  expected?: unknown;
  /** 이미 읽어 둔 식별 정보를 넘길 때(라우트에서 두 번 파싱하지 않게) */
  identity?: DbIdentity;
}): IdentityDecision {
  const actual = args.identity ?? identify(args.url);
  const exp = parseExpected(args.expected);
  const base = {
    actual: publicIdentity(actual),
    actualReason: actual.reason,
    limits: IDENTITY_LIMITS,
  };

  if (!actual.known || !actual.fingerprint) {
    return {
      ...base,
      verdict: 'unknown_actual',
      ok: false,
      trusted: false,
      blocksSwitch: false,
      expected: exp.ok ? exp.fingerprint : null,
      expectedReason: exp.ok ? null : exp.reason,
      action: ACTION_IDENTITY_UNKNOWN_ACTUAL,
    };
  }

  if (!exp.ok) {
    const unset = exp.reason === 'unset';
    return {
      ...base,
      verdict: unset ? 'unset' : 'invalid_expected',
      // 미설정은 평상시 상태(degraded 로 만들지 않는다). 잘못 넣은 값은 사람이 고쳐야 한다.
      ok: unset,
      trusted: false,
      blocksSwitch: false,
      expected: null,
      expectedReason: exp.reason,
      action: unset ? ACTION_IDENTITY_UNSET : ACTION_IDENTITY_INVALID,
    };
  }

  const match = exp.fingerprint === actual.fingerprint;
  return {
    ...base,
    verdict: match ? 'match' : 'mismatch',
    ok: match,
    trusted: match,
    blocksSwitch: !match,
    expected: exp.fingerprint,
    expectedReason: null,
    action: match ? ACTION_IDENTITY_MATCH : ACTION_IDENTITY_MISMATCH,
  };
}

/** 로그 한 줄. 지문·판정만 — 연결 문자열·사용자명·비밀번호는 담지 않는다 */
export function identityLogLine(d: IdentityDecision): string {
  const parts = [
    `db_identity=${d.verdict}`,
    `fp=${d.actual.fingerprint ?? '?'}`,
    `provider=${d.actual.provider ?? '?'}`,
  ];
  if (d.actual.pooled) parts.push('pooled=1');
  if (d.expected && d.verdict === 'mismatch') parts.push(`expected=${d.expected}`);
  if (d.actualReason) parts.push(`actual_reason=${d.actualReason}`);
  if (d.expectedReason && d.verdict === 'invalid_expected') parts.push(`expected_reason=${d.expectedReason}`);
  return parts.join(' ');
}

/* ───────────────────────────── /api/health 체크 ───────────────────────────── */

/**
 * 연결 대상을 공개 헬스체크에 드러낸다 — 5단계 전환이 **이 배포에 반영됐는지**를
 * 확인할 수 있는 유일한 수단이다.
 *
 * 공개 응답이므로 지문·provider·pooled·region 만 담는다(호스트·DB 이름·자격증명 제외).
 * **required: false** — 기준 지문 불일치는 degraded(200)로만 드러낸다. 복구 중의 운영
 * 판단을 503 으로 대신하지 않는다(기준값을 잘못 넣은 것만으로 서비스가 내려가면 안 된다).
 */
export function dbIdentityCheck(args?: {
  env?: Record<string, string | undefined>;
}): { ok: boolean; required: false; detail: Record<string, unknown> } {
  const env = args?.env ?? process.env;
  const d = compareIdentity({ url: env.DATABASE_URL, expected: env.RECOVERY_EXPECTED_DB });
  return {
    ok: d.ok,
    required: false,
    detail: {
      verdict: d.verdict,
      trusted: d.trusted,
      fingerprint: d.actual.fingerprint,
      provider: d.actual.provider,
      pooled: d.actual.pooled,
      region: d.actual.region,
      expectedKey: EXPECTED_DB_ENV,
      expectedSet: d.expected !== null,
      action: d.action,
      limits: d.verdict === 'match' || d.verdict === 'mismatch' ? IDENTITY_LIMITS : [],
    },
  };
}

/* ───────────────────────────── 4단계 게이트 ───────────────────────────── */

export interface IdentityReport extends PublicIdentity {
  verdict: IdentityVerdict;
  trusted: boolean;
  hostMasked: string | null;
  database: string | null;
  expectedKey: string;
  expectedSet: boolean;
  action: string;
  limits: readonly string[];
}

/** 관리자(슈퍼관리자) 응답용 — 마스킹된 호스트·DB 이름까지 포함한다 */
export function identityReport(id: DbIdentity, d: IdentityDecision): IdentityReport {
  return {
    ...publicIdentity(id),
    verdict: d.verdict,
    trusted: d.trusted,
    hostMasked: id.hostMasked,
    database: id.database,
    expectedKey: EXPECTED_DB_ENV,
    expectedSet: d.expected !== null,
    action: d.action,
    limits: IDENTITY_LIMITS,
  };
}

/**
 * 복구 검증 결과(§3 4단계)에 연결 대상 판정을 더한다.
 *
 * 왜 `switchReady` 를 내리는가: 4단계는 「스테이징에 **복구 브랜치**를 넣고 센다」는
 * 전제 위에 서 있다. 그 전제가 깨져 손상된 운영 DB 를 세고 있으면 행 수가 아무리
 * 기준치를 넘어도 그 판정은 **다른 DB 에 대한 판정**이다. 그래서 `mismatch` 일 때만
 * 내리고(`blocksSwitch`), 기준값 미설정(`unset`)은 기존 판정을 끌어내리지 않는다 —
 * 임의 기준으로 통과를 막지 않는다는 이 시리즈의 규칙과 같다.
 */
export function gateSwitchReady<T extends { switchReady: boolean; action: string }>(
  result: T,
  id: DbIdentity,
  d: IdentityDecision,
): T & { identity: IdentityReport } {
  const blocked = d.blocksSwitch;
  return {
    ...result,
    switchReady: result.switchReady && !blocked,
    action: blocked ? ACTION_IDENTITY_MISMATCH : result.action,
    identity: identityReport(id, d),
  };
}

/* ───────────────────────────── 정적 점검 ───────────────────────────── */

/**
 * DB 클라이언트가 **여전히 같은 키**를 읽는지 점검한다(`src/db/index.ts` 원문).
 * 클라이언트가 다른 키(`POSTGRES_URL` 등)로 옮겨 가면 지문은 **엉뚱한 DB** 를
 * 가리키면서 계속 `match` 를 낸다 — 가장 위험한 조용한 회귀다.
 */
export function auditClientSource(src: unknown): string[] {
  const s = String(src ?? '');
  const problems: string[] = [];
  if (!new RegExp(`process\\.env\\.${DB_URL_ENV}\\b`).test(s)) {
    problems.push(`DB 클라이언트가 process.env.${DB_URL_ENV} 를 읽지 않는다 — 지문이 실제 연결 대상과 달라진다`);
  }
  const others = s.match(/process\.env\.([A-Z0-9_]*(?:DATABASE|POSTGRES|PG)[A-Z0-9_]*)/g) ?? [];
  for (const o of others) {
    const key = o.replace('process.env.', '');
    if (key !== DB_URL_ENV) problems.push(`DB 클라이언트가 다른 연결 키(${key})도 읽는다 — 지문 대상이 모호해진다`);
  }
  return problems;
}

/** `/api/health` 가 체크를 실제로 물고 있는지(원문 점검) */
export function auditHealthWiring(src: unknown): string[] {
  const s = String(src ?? '');
  const problems: string[] = [];
  if (!/from\s+['"][^'"]*dbIdentity['"]/.test(s)) problems.push('dbIdentity 모듈을 import 하지 않는다');
  if (!/checks\.dbIdentity\s*=/.test(s)) problems.push('checks.dbIdentity 를 채우지 않는다 — 5단계 확인 수단이 사라진다');
  if (!/dbIdentityCheck\(/.test(s)) problems.push('dbIdentityCheck() 를 호출하지 않는다');
  return problems;
}

/**
 * `/api/admin/recovery-verify` 가 게이트를 통과한 결과를 응답하는지 점검한다.
 * 게이트를 호출하고도 **원본 결과를** 돌려주면 `switchReady` 가 그대로 올라간다.
 */
export function auditVerifyWiring(src: unknown): string[] {
  const s = String(src ?? '');
  const problems: string[] = [];
  if (!/from\s+['"][^'"]*dbIdentity['"]/.test(s)) problems.push('dbIdentity 모듈을 import 하지 않는다');
  if (!/gateSwitchReady\(/.test(s)) problems.push('gateSwitchReady() 를 호출하지 않는다 — 다른 DB 를 세고도 전환 가능이 된다');
  const gated = s.match(/const\s+([A-Za-z_$][\w$]*)\s*=\s*gateSwitchReady\(/);
  if (!gated) {
    problems.push('gateSwitchReady() 결과를 변수에 받지 않는다 — 응답에 실렸는지 확인할 수 없다');
  } else {
    const returned = new RegExp(`ok\\(\\s*${gated[1]}\\b`).test(s);
    if (!returned) problems.push(`게이트 결과(${gated[1]})를 ok() 로 응답하지 않는다 — 원본 switchReady 가 그대로 나간다`);
  }
  return problems;
}

/** 배선 상태 요약(문서·보고용). 값·지문을 담지 않는다 */
export function dbIdentityStatus(env: Record<string, string | undefined> = process.env): {
  verdict: IdentityVerdict;
  trusted: boolean;
  expectedKey: string;
  limits: number;
  note: string;
} {
  const d = compareIdentity({ url: env.DATABASE_URL, expected: env.RECOVERY_EXPECTED_DB });
  return {
    verdict: d.verdict,
    trusted: d.trusted,
    expectedKey: EXPECTED_DB_ENV,
    limits: IDENTITY_LIMITS.length,
    note:
      d.verdict === 'unset'
        ? '기준 지문 미설정(평상시) — 복구 전환 시에만 사람이 넣는다'
        : d.action,
  };
}
