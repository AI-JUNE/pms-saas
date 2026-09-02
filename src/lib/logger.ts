// 구조화 로깅 + 에러 모니터링 단일 소스.
// 원칙(build now, activate on approval): 구조화 JSON 로깅은 항상 동작하지만,
// 외부 모니터링(Sentry) 실전송은 MONITORING_ENABLED=true + SENTRY_DSN 설정 시에만.
// 실연동 코드는 2026-09-02 승인되어 결선 완료(Envelope HTTP API 직접 전송).
// 환경변수 미설정이면 여전히 완전 no-op이므로 기본 동작은 OFF 그대로다.

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function threshold(): number {
  const v = (process.env.LOG_LEVEL || 'info').toLowerCase() as LogLevel;
  return ORDER[v] ?? ORDER.info;
}

export const MONITORING_ENABLED =
  process.env.MONITORING_ENABLED === 'true' && !!process.env.SENTRY_DSN;

export interface LogFields {
  [k: string]: unknown;
}

// ── PII 미기록 ───────────────────────────────────────────────
// 로그 필드 이름이 아래 목록에 걸리면 값을 남기지 않고 '[redacted]'로 대체한다.
// 개인정보·자격증명이 로그 싱크(콘솔·외부 모니터링)로 흘러가는 것을 원천 차단한다.
const PII_KEYS = [
  'password', 'passwd', 'pw', 'passwordhash', 'token', 'accesstoken', 'refreshtoken',
  'authorization', 'cookie', 'session', 'secret', 'apikey', 'billingkey', 'cardnumber',
  'card', 'cvc', 'email', 'phone', 'mobile', 'ssn', 'residentnumber', 'address', 'name',
];

/** 필드 이름 기준으로 PII 후보를 마스킹한다(순수 함수 · 테스트 대상). */
export function redact(fields?: LogFields): LogFields | undefined {
  if (!fields) return undefined;
  const out: LogFields = {};
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined) continue;
    const norm = k.toLowerCase().replace(/[^a-z]/g, '');
    out[k] = PII_KEYS.includes(norm) ? '[redacted]' : v;
  }
  return out;
}

/** 요청 상관관계 ID. 이미 들어온 값이 있으면 그대로 쓰고, 없으면 새로 만든다. */
export function newRequestId(incoming?: string | null): string {
  const v = (incoming || '').trim();
  // 외부 입력을 그대로 신뢰하지 않는다: 길이·문자 제한을 통과한 값만 재사용.
  if (v && v.length <= 64 && /^[A-Za-z0-9._-]+$/.test(v)) return v;
  const rand = Math.random().toString(36).slice(2, 10);
  return `${Date.now().toString(36)}-${rand}`;
}

/** 한 줄 JSON 로그 라인을 만든다(순수 함수 · 테스트 대상). */
export function formatLine(level: LogLevel, msg: string, fields?: LogFields): string {
  const base: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    msg,
  };
  if (fields) for (const [k, v] of Object.entries(fields)) if (v !== undefined) base[k] = v;
  return JSON.stringify(base);
}

function emit(level: LogLevel, msg: string, fields?: LogFields): void {
  if (ORDER[level] < threshold()) return;
  const line = formatLine(level, msg, redact(fields));
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export const log = {
  debug: (msg: string, fields?: LogFields) => emit('debug', msg, fields),
  info: (msg: string, fields?: LogFields) => emit('info', msg, fields),
  warn: (msg: string, fields?: LogFields) => emit('warn', msg, fields),
  error: (msg: string, fields?: LogFields) => emit('error', msg, fields),
};

/** 에러를 구조화 로깅하고, 모니터링이 켜져 있으면 외부 싱크로 포워딩한다. */
export function captureError(err: unknown, context?: LogFields): void {
  const e = err as any;
  log.error(e?.message || 'unknown error', {
    ...context,
    name: e?.name,
    code: e?.code ?? e?.cause?.code,
    stack: typeof e?.stack === 'string' ? e.stack.split('\n').slice(0, 8).join('\n') : undefined,
  });
  if (MONITORING_ENABLED) forwardToSink(err, context);
}

// ── Sentry 전송 ─────────────────────────────────────────────
// @sentry/nextjs SDK 대신 Sentry Envelope HTTP API로 직접 전송한다.
// 이유: 신규 의존성 0 → Vercel 빌드 리스크 0, edge/node 런타임 모두에서 fetch만으로 동작.
// 트레이드오프: 자동 브레드크럼·퍼포먼스·소스맵 스택 복원은 없다(수동 captureError 전송 전용).
// SDK로 승격하려면 `npm i @sentry/nextjs` 후 sentry.*.config.ts를 추가하고 아래를
// Sentry.captureException으로 교체하면 된다. 현재 구조는 그 교체를 방해하지 않는다.

export interface SentryTarget {
  envelopeUrl: string;
  publicKey: string;
  projectId: string;
}

/** DSN(https://<key>@<host>/<projectId>)을 전송 대상으로 파싱한다(순수 함수 · 테스트 대상). */
export function parseDsn(dsn?: string | null): SentryTarget | null {
  if (!dsn) return null;
  try {
    const u = new URL(dsn);
    const publicKey = u.username;
    const projectId = u.pathname.replace(/^\/+/, '');
    if (!publicKey || !projectId || !/^\d+$/.test(projectId)) return null;
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    return {
      publicKey,
      projectId,
      envelopeUrl: `${u.protocol}//${u.host}/api/${projectId}/envelope/`,
    };
  } catch {
    return null;
  }
}

function eventId(): string {
  const c = (globalThis as any).crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID().replace(/-/g, '');
  let s = '';
  while (s.length < 32) s += Math.random().toString(16).slice(2);
  return s.slice(0, 32);
}

/** Sentry envelope 본문(개행 구분 JSON 3줄)을 만든다(순수 함수 · 테스트 대상). */
export function buildEnvelope(err: unknown, context?: LogFields, id = eventId()): string {
  const e = err as any;
  const header = JSON.stringify({ event_id: id, sent_at: new Date().toISOString() });
  const itemHeader = JSON.stringify({ type: 'event' });
  const event = {
    event_id: id,
    timestamp: Date.now() / 1000,
    platform: 'node',
    level: 'error',
    logger: 'prism-pms',
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV || 'development',
    release: process.env.APP_VERSION || process.env.VERCEL_GIT_COMMIT_SHA,
    exception: {
      values: [{
        type: String(e?.name || 'Error'),
        value: String(e?.message || 'unknown error').slice(0, 1000),
      }],
    },
    // 컨텍스트는 PII 마스킹을 거친 값만 싣는다.
    extra: redact(context) ?? {},
  };
  return `${header}\n${itemHeader}\n${JSON.stringify(event)}`;
}

function forwardToSink(err: unknown, context?: LogFields): void {
  const target = parseDsn(process.env.SENTRY_DSN);
  if (!target) return; // DSN이 없거나 형식이 틀리면 조용히 no-op
  try {
    void fetch(target.envelopeUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-sentry-envelope',
        'X-Sentry-Auth': `Sentry sentry_version=7, sentry_key=${target.publicKey}, sentry_client=prism-pms/1.0`,
      },
      body: buildEnvelope(err, context),
    }).catch(() => { /* 전송 실패가 요청 흐름을 깨지 않는다 */ });
  } catch { /* fetch 미지원 런타임에서도 안전 */ }
}

// ── 알림 훅 ─────────────────────────────────────────────────
// ALERT_WEBHOOK_URL 미설정이면 완전 no-op. 설정되어 있어도 MONITORING_ENABLED=true 여야 발신한다.
// 발신 코드는 2026-09-02 승인·결선 완료. 환경변수 설정은 운영자가 직접 한다.
export const ALERTS_ENABLED = MONITORING_ENABLED && !!process.env.ALERT_WEBHOOK_URL;

/** 치명 오류를 운영 채널로 알린다. 실패해도 요청 흐름을 절대 깨지 않는다. */
export function notifyAlert(title: string, context?: LogFields): void {
  if (!ALERTS_ENABLED) return;
  const url = process.env.ALERT_WEBHOOK_URL as string;
  // PII를 제거한 뒤 전송. await 하지 않아 응답 지연을 만들지 않는다.
  const payload = JSON.stringify({ text: `[PRISM PMS] ${title}`, fields: redact(context) ?? {} });
  try {
    void fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
    }).catch(() => { /* 알림 실패는 무시 */ });
  } catch { /* fetch 자체가 없는 런타임에서도 안전 */ }
}

// ── 전역(프로세스) 에러 캡처 ──────────────────────────────────
// 라우트 핸들러 밖에서 터진 예외까지 잡아 구조화 로깅한다. 중복 등록 방지.
let globalHandlersInstalled = false;

export function installGlobalErrorHandlers(): void {
  if (globalHandlersInstalled) return;
  const p = (globalThis as any).process;
  if (!p || typeof p.on !== 'function') return;
  globalHandlersInstalled = true;

  p.on('unhandledRejection', (reason: unknown) => {
    captureError(reason, { where: 'process.unhandledRejection' });
    notifyAlert('unhandledRejection', { where: 'process.unhandledRejection' });
  });
  // uncaughtException은 로깅만 하고 프로세스를 죽이지 않는다(플랫폼 재시작에 맡기지 않음).
  p.on('uncaughtException', (err: unknown) => {
    captureError(err, { where: 'process.uncaughtException' });
    notifyAlert('uncaughtException', { where: 'process.uncaughtException' });
  });
}
