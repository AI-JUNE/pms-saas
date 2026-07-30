import { handle, ok } from '@/lib/http';
import { PLANS } from '@/lib/billing';
import { billingStatus } from '@/lib/portone';

export const dynamic = 'force-dynamic';

// 공개 요금제/결제상태 조회. 인증 불필요(랜딩·마켓플레이스에서 사용).
export async function GET() {
  return handle(async () => {
    return ok({ ok: true, plans: PLANS, billing: billingStatus() });
  });
}
