// 'next/server.js'로 명시(확장자 포함): Node --test ESM 해석과 Next 번들 양쪽 호환.
import { NextResponse } from 'next/server.js';
import { captureError } from './logger.ts';
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
export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try { return await fn(); }
  catch (e: any) {
    if (e instanceof ApiError) return sendError(e.err, e.message, e.extra);
    const code = e?.code || e?.cause?.code || '';
    const map: Record<string, [Err, string]> = {
      '23505': [ERROR.CONFLICT, '이미 존재하는 값입니다. 중복 여부를 확인하세요.'],
      '23503': [ERROR.VALIDATION, '연결된 데이터가 있어 처리할 수 없습니다.'],
      '23502': [ERROR.VALIDATION, '필수 값이 비어 있습니다.'],
      '22P02': [ERROR.VALIDATION, '입력 형식이 올바르지 않습니다.'],
      '23514': [ERROR.VALIDATION, '허용되지 않는 값입니다.'],
    };
    if (map[code]) return sendError(map[code][0], map[code][1]);
    captureError(e, { where: 'http.handle' });
    return sendError(ERROR.SERVER, '서버 오류가 발생했습니다');
  }
}
