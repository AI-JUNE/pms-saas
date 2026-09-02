// 구조화 로깅 + 에러 모니터링 단일 소스.
// 원칙(build now, activate on approval): 구조화 JSON 로깅은 항상 동작하지만,
// 외부 모니터링(Sentry 등) 실전송은 MONITORING_ENABLED=true + SENTRY_DSN 설정 시에만.
// 기본값 OFF. 실연동(@sentry/nextjs 설치·초기화)은 [승인 필요].

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

// [승인 필요] 실제 Sentry 연동 지점.
// 활성화 시: npm i @sentry/nextjs → sentry.server.config.ts 초기화 후
// 아래에서 Sentry.captureException(err, { extra: context }) 호출로 교체.
// 지금은 의존성 없이 로깅만 하는 무해한 스텁(빌드 안전).
function forwardToSink(_err: unknown, _context?: LogFields): void {
  // no-op until monitoring is approved & wired.
}

// ── 알림 훅 ─────────────────────────────────────────────────
// ALERT_WEBHOOK_URL 미설정이면 완전 no-op. 설정되어 있어도 MONITORING_ENABLED=true 여야 발신한다.
// [승인 필요] 실제 알림 발신 활성화.
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
