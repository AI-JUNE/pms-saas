import { NextResponse } from 'next/server';
export const ERROR = {
  VALIDATION: { status: 400, code: 'VALIDATION' }, UNAUTHORIZED: { status: 401, code: 'UNAUTHORIZED' },
  FORBIDDEN: { status: 403, code: 'FORBIDDEN' }, NOT_FOUND: { status: 404, code: 'NOT_FOUND' },
  CONFLICT: { status: 409, code: 'CONFLICT' }, SERVER: { status: 500, code: 'SERVER' },
} as const;
type Err = (typeof ERROR)[keyof typeof ERROR];
export function sendError(err: Err, message: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ ok: false, code: err.code, message, ...extra }, { status: err.status });
}
export function ok(data: unknown = { ok: true }, status = 200) { return NextResponse.json(data, { status }); }
export class ApiError extends Error {
  constructor(public err: Err, message: string, public extra?: Record<string, unknown>) { super(message); }
}
export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try { return await fn(); }
  catch (e) { if (e instanceof ApiError) return sendError(e.err, e.message, e.extra); console.error(e); return sendError(ERROR.SERVER, '서버 오류가 발생했습니다'); }
}
