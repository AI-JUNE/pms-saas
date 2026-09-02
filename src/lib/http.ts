// 'next/server.js'로 명시(확장자 포함): Node --test ESM 해석과 Next 번들 양쪽 호환.
import { NextResponse } from 'next/server.js';
import { captureError, log, newRequestId, notifyAlert } from './logger.ts';
export const ERROR = {
  VALIDATION: { status: 400, code: 'VALIDATION' }, UNAUTHORIZED: { status: 401, code: 'UNAUTHORIZED' },
  FORBIDDEN: { status: 403, code: 'FORBIDDEN' }, NOT_FOUND: { status: 404, code: 'NOT_FOUND' },
  CONFLICT: { status: 409, code: 'CONFLICT' }, TOO_MANY: { status: 429, code: 'TOO_MANY' },
  SERVER: { status: 500, code: 'SERVER' },
} as const;
type Err = (typeof ERROR)[keyof typeof ERROR];
export function sendError(err: Err, message: string, extra?: Record<string, unknown>) {
  const headers: Record<string, string> = {};
  // 429는 표준 Retry-After 헤더를 함께 반환(클라이언트 백오프 지원).
  if (err.status === 429 && extra && typeof extra.retryAfterSec === 'number') {
    headers['Retry-After'] = String(Math.max(1, Math.ceil(extra.retryAfterSec)));
  }
  return NextResponse.json({ ok: false, code: err.code, message, ...extra }, { status: err.status, headers });
}
export function ok(data: unknown = { ok: true }, status = 200) { return NextResponse.json(data, { status }); }
export class ApiError extends Error {
  // Node --test 타입스트리핑 호환을 위해 파라미터 프로퍼티 대신 명시 필드 사용(동작 동일).
  err: Err;
  extra?: Record<string, unknown>;
  constructor(err: Err, message: string, extra?: Record<string, unknown>) {
    super(message);
    this.err = err;
    this.extra = extra;
  }
}
// ── 요청 컨텍스트 ───────────────────────────────────────────
// 상관관계 ID·메서드·경로만 담는다. 쿼리스트링은 PII를 포함할 수 있어 기록하지 않는다.
export interface RequestContext {
  requestId: string;
  method?: string;
  path?: string;
}

/** Request에서 로깅용 컨텍스트를 뽑는다(순수 함수 · 테스트 대상). */
export function requestContext(req?: Request): RequestContext {
  let incoming: string | null = null;
  let method: string | undefined;
  let path: string | undefined;
  if (req) {
    try { incoming = req.headers?.get?.('x-request-id') ?? null; } catch { incoming = null; }
    method = req.method;
    // pathname만 취한다(쿼리스트링 제외).
    try { path = new URL(req.url).pathname; } catch { path = undefined; }
  }
  return { requestId: newRequestId(incoming), method, path };
}

const PG_ERROR_MAP: Record<string, [Err, string]> = {
  '23505': [ERROR.CONFLICT, '이미 존재하는 값입니다. 중복 여부를 확인하세요.'],
  '23503': [ERROR.VALIDATION, '연결된 데이터가 있어 처리할 수 없습니다.'],
  '23502': [ERROR.VALIDATION, '필수 값이 비어 있습니다.'],
  '22P02': [ERROR.VALIDATION, '입력 형식이 올바르지 않습니다.'],
  '23514': [ERROR.VALIDATION, '허용되지 않는 값입니다.'],
};

/**
 * 라우트 공통 래퍼. req를 넘기면 요청ID·소요시간·에러코드를 구조화 로깅하고
 * 응답에 x-request-id 헤더를 붙인다. req 생략 시 기존 동작과 동일(하위 호환).
 */
export async function handle(fn: () => Promise<Response>, req?: Request): Promise<Response> {
  const ctx = requestContext(req);
  const t0 = Date.now();
  let res: Response;
  let errCode: string | undefined;

  try {
    res = await fn();
  } catch (e: any) {
    if (e instanceof ApiError) {
      errCode = e.err.code;
      res = sendError(e.err, e.message, e.extra);
    } else {
      const pg = e?.code || e?.cause?.code || '';
      const mapped = PG_ERROR_MAP[pg];
      if (mapped) {
        errCode = mapped[0].code;
        res = sendError(mapped[0], mapped[1]);
      } else {
        errCode = ERROR.SERVER.code;
        captureError(e, { where: 'http.handle', requestId: ctx.requestId, method: ctx.method, path: ctx.path });
        notifyAlert('API 500', { requestId: ctx.requestId, method: ctx.method, path: ctx.path });
        res = sendError(ERROR.SERVER, '서버 오류가 발생했습니다');
      }
    }
  }

  const durMs = Date.now() - t0;
  try { res.headers.set('x-request-id', ctx.requestId); } catch { /* 불변 헤더면 생략 */ }

  if (req) {
    const fields = {
      requestId: ctx.requestId,
      method: ctx.method,
      path: ctx.path,
      status: res.status,
      durMs,
      code: errCode,
    };
    if (res.status >= 500) log.error('request', fields);
    else if (res.status >= 400) log.warn('request', fields);
    else log.info('request', fields);
  }

  return res;
}
