import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { organizations } from '@/db/schema';
import { requireUser } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { handle, ok, ApiError, ERROR } from '@/lib/http';
import { enforceRateLimit } from '@/lib/ratelimit';
import { PORTONE, billingStatus } from '@/lib/portone';
import { BILLING_APPLY_LIVE } from '@/lib/billingWebhook';
import { auditSecurity } from '@/lib/audit';
import { log } from '@/lib/logger';
import {
  parseAction, gateSubscriptionAction, parseCancelMode, planCancellation,
  currentPeriod, refundQuote, newBillingKeyIssueId, summarizeSubscription, fmtDate,
} from '@/lib/subscription';

export const dynamic = 'force-dynamic';

// 구독 수명주기 API (빌링키 등록·정기청구 예정·해지·환불).
// build now, activate on approval:
//  - 기본(테스트) 모드에서는 어떤 외부 결제 호출도, 어떤 DB 변경도 하지 않는다.
//    요청을 검증하고 "무엇이 일어날지"(파라미터·해지 예정일·환불 견적)만 계산해 돌려준다.
//  - 실행은 PAYMENTS_LIVE=true 且 BILLING_APPLY_LIVE=true 승격 후에만 → [승인 필요].
// ※ 이 파일은 HTTP 메서드와 dynamic 외 어떤 것도 export 하지 않는다(Vercel 빌드 규칙).
export async function POST(req: Request) {
  return handle(async () => {
    enforceRateLimit(req, { key: 'billing:manage', limit: 20, windowMs: 60_000 });
    const u = await requireUser();
    const ctx = await requireTenant(u);

    let body: Record<string, unknown> = {};
    try { body = (await req.json()) as Record<string, unknown>; } catch { /* empty body allowed */ }

    const action = parseAction(body.action);
    if (!action) throw new ApiError(ERROR.VALIDATION, '지원하지 않는 작업(action)입니다');

    const org = (await db.select({
      id: organizations.id, name: organizations.name, plan: organizations.plan, createdAt: organizations.createdAt,
    }).from(organizations).where(eq(organizations.id, ctx.orgId)).limit(1))[0];
    if (!org) throw new ApiError(ERROR.NOT_FOUND, '조직을 찾을 수 없습니다');

    const planId = String(body.planId || org.plan || 'free');
    const gate = gateSubscriptionAction({
      action, live: PORTONE.live, applyEnabled: BILLING_APPLY_LIVE, isOrgAdmin: ctx.isOrgAdmin, planId,
    });
    if (gate.mode === 'deny') {
      throw new ApiError(ERROR.FORBIDDEN, gate.reason === 'org-admin-required'
        ? '조직 관리자만 구독을 변경할 수 있습니다'
        : 'Enterprise 플랜은 수동 계약으로 진행됩니다(자동 청구 대상 아님)');
    }
    if (gate.mode === 'execute') {
      // 실행 경로는 실PG 연동과 함께 열린다. 스위치가 켜져도 코드가 없으면 안전하게 거절.
      throw new ApiError(ERROR.SERVER, '실결제 실행 연동은 아직 승인 대기 상태입니다. [승인 필요]');
    }

    const asOf = fmtDate(new Date());
    const created = org.createdAt instanceof Date ? fmtDate(org.createdAt) : String(org.createdAt ?? '').slice(0, 10);
    const anchor = /^\d{4}-\d{2}-\d{2}$/.test(created) ? created : asOf;
    const seats = Number.isInteger(body.seats) && (body.seats as number) > 0 ? (body.seats as number) : 1;
    const summary = summarizeSubscription({ planId, seats, anchorISO: anchor, asOfISO: asOf });
    const period = currentPeriod(anchor, asOf);

    let detail: Record<string, unknown>;
    if (action === 'issue_billing_key') {
      // 빌링키 발급은 PG 창에서 이뤄지고, 발급된 키는 서버만 보관한다(응답에 키 없음).
      detail = {
        issueId: newBillingKeyIssueId(ctx.orgId),
        storeId: PORTONE.storeId,
        channelKey: PORTONE.channelKey,
        customer: { id: String(u.id), email: u.email, name: u.name },
        note: '빌링키 발급 파라미터입니다. 테스트 모드에서는 실제 카드 등록·과금이 발생하지 않습니다.',
      };
    } else if (action === 'delete_billing_key') {
      detail = { note: '등록된 결제수단 해제 요청입니다. 테스트 모드에서는 저장된 값을 변경하지 않습니다.' };
    } else if (action === 'cancel') {
      const mode = parseCancelMode(body.mode);
      detail = period
        ? { cancellation: planCancellation(mode, period, asOf) }
        : { cancellation: null, note: '청구 주기를 계산할 수 없습니다(구독 시작일 확인 필요)' };
    } else if (action === 'resume') {
      detail = { note: '해지 예약 취소 요청입니다. 다음 청구일부터 정기청구가 유지됩니다.', nextChargeAt: summary.nextChargeAt };
    } else {
      // refund — 견적만 산출한다. 실제 환불 실행은 [승인 필요].
      const amount = body.amount !== undefined ? body.amount : summary.amount;
      detail = period
        ? { quote: refundQuote({ amount, period, cancelAt: asOf }) }
        : { quote: { error: 'invalid-period' } };
    }

    log.info('billing.manage.scaffold', { userId: u.id, orgId: ctx.orgId, action, mode: 'test' });
    await auditSecurity('BILLING_MANAGE_SCAFFOLD', {
      userId: u.id, orgId: ctx.orgId, entity: 'billing', entityId: action, detail: { action, planId, mode: 'test' },
    });

    return ok({
      ok: true,
      mode: 'test',
      action,
      blocked: gate.reason,
      subscription: summary,
      ...detail,
      billing: billingStatus(),
      note: '테스트 스캐폴딩 응답입니다. 실제 결제·해지·환불은 발생하지 않습니다. [승인 필요]',
    });
  }, req);
}
