// 헬스체크 순수 로직 단일 소스.
// 라우트(route.ts)에는 HTTP 메서드만 두고, 조립·판정 로직은 전부 여기 둔다(테스트 대상).
// 공개 엔드포인트이므로 민감정보(연결 문자열·자격증명·키·내부 호스트)는 절대 노출하지 않는다.

export type CheckName = 'db' | 'billing' | 'monitoring';

export interface CheckResult {
  ok: boolean;
  /** 판정에 반영할지 여부. false면 실패해도 degraded까지만 내려간다. */
  required: boolean;
  latencyMs?: number | null;
  error?: string;
  detail?: Record<string, unknown>;
}

export type Checks = Partial<Record<CheckName, CheckResult>>;

export type HealthStatus = 'ok' | 'degraded' | 'down';

export interface BuildInfo {
  version: string;
  commit: string | null;
  branch: string | null;
  env: string;
  region: string | null;
}

/** 민감정보 제거: 연결 문자열·자격증명·긴 토큰을 지우고 길이를 제한한다. */
export function sanitizeError(raw: unknown, max = 160): string {
  let s = raw instanceof Error ? raw.message : typeof raw === 'string' ? raw : '오류';
  // postgres://user:pass@host/db 형태 통째로 제거
  s = s.replace(/[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^\s'"]+/g, '[redacted-url]');
  // user:pass@host 형태
  s = s.replace(/[^\s:/@]+:[^\s:/@]+@[^\s'"]+/g, '[redacted-credential]');
  // 20자 이상 연속 토큰(키·해시로 추정)
  s = s.replace(/\b[A-Za-z0-9_-]{32,}\b/g, '[redacted-token]');
  s = s.replace(/\s+/g, ' ').trim();
  if (!s) s = '오류';
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/** 커밋 해시는 앞 7자리만 노출한다(전체 해시도 민감정보는 아니나 짧게 유지). */
export function shortCommit(sha: string | null | undefined): string | null {
  if (!sha) return null;
  const t = String(sha).trim();
  if (!t) return null;
  return t.slice(0, 7);
}

/** 배포 메타. 값이 없으면 null로 두고 추측하지 않는다. */
export function buildInfo(env: Record<string, string | undefined> = process.env): BuildInfo {
  return {
    version: env.APP_VERSION || '0.12.0',
    commit: shortCommit(
      env.VERCEL_GIT_COMMIT_SHA || env.GIT_COMMIT_SHA || env.COMMIT_SHA || env.SOURCE_VERSION || null,
    ),
    branch: env.VERCEL_GIT_COMMIT_REF || env.GIT_BRANCH || null,
    env: env.VERCEL_ENV || env.NODE_ENV || 'development',
    region: env.VERCEL_REGION || null,
  };
}

/**
 * 전체 상태 판정.
 * - required 체크가 하나라도 실패 → 'down'(503)
 * - optional 체크만 실패 → 'degraded'(200, 서비스는 가능)
 * - 전부 통과 → 'ok'(200)
 */
export function summarize(checks: Checks): HealthStatus {
  const values = Object.values(checks).filter(Boolean) as CheckResult[];
  if (values.some((c) => c.required && !c.ok)) return 'down';
  if (values.some((c) => !c.ok)) return 'degraded';
  return 'ok';
}

export function statusCode(status: HealthStatus): number {
  return status === 'down' ? 503 : 200;
}

export interface HealthBody {
  ok: boolean;
  status: HealthStatus;
  service: string;
  version: string;
  commit: string | null;
  branch: string | null;
  env: string;
  region: string | null;
  time: string;
  uptimeSec: number;
  checks: Checks;
}

export function buildHealthBody(args: {
  checks: Checks;
  uptimeSec: number;
  now?: Date;
  env?: Record<string, string | undefined>;
  service?: string;
}): HealthBody {
  const info = buildInfo(args.env);
  const status = summarize(args.checks);
  return {
    ok: status !== 'down',
    status,
    service: args.service || 'prism-pms',
    version: info.version,
    commit: info.commit,
    branch: info.branch,
    env: info.env,
    region: info.region,
    time: (args.now || new Date()).toISOString(),
    uptimeSec: Math.max(0, Math.round(args.uptimeSec)),
    checks: args.checks,
  };
}
