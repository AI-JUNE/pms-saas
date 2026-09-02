// 클라이언트 전역 에러 수집 엔드포인트.
// global-error.tsx가 브라우저에서 터진 오류를 여기로 보고한다.
// 주의: Next.js route 파일은 HTTP 메서드와 설정(dynamic/runtime) 외 export 금지.
import { ok, handle } from '@/lib/http';
import { enforceRateLimit } from '@/lib/ratelimit';
import { log, notifyAlert } from '@/lib/logger';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  return handle(async () => {
    // 공개 엔드포인트이므로 IP 기준 한도를 건다(로그 폭주·남용 방지).
    enforceRateLimit(req, { key: 'client-errors', limit: 30, windowMs: 60_000 });

    let payload: unknown = null;
    try { payload = await req.json(); } catch { payload = null; }
    const p = (payload ?? {}) as Record<string, unknown>;

    // 허용 필드만 취하고 길이를 제한한다. 나머지는 버린다(PII 유입 차단).
    const str = (v: unknown, max: number) =>
      typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined;

    const fields = {
      source: 'client',
      message: str(p.message, 500) ?? 'unknown client error',
      digest: str(p.digest, 64),
      // 클라이언트가 보낸 path도 pathname만 신뢰한다.
      path: str(p.path, 200)?.split('?')[0],
    };

    log.error('client error', fields);
    notifyAlert('클라이언트 오류', fields);

    // 보고 성공 여부를 클라이언트가 신경 쓸 필요는 없다. 항상 202.
    return ok({ ok: true }, 202);
  }, req);
}
