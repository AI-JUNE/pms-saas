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
  const line = formatLine(level, msg, fields);
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
