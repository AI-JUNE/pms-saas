import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { organizations } from '@/db/schema';
import { requireUser } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { handle, ok } from '@/lib/http';
import { PLANS } from '@/lib/billing';
import { billingStatus } from '@/lib/portone';

export const dynamic = 'force-dynamic';

// 구독 상태 조회(읽기 전용) — build now, activate on approval.
// 조직의 현재 플랜과 결제 스캐폴딩 상태만 반환한다. 어떤 변경도 수행하지 않으며,
// 플랜 변경·실결제는 체크아웃/웹훅(실PG 연동 [승인 필요]) 경로에서만 다룬다.
export async function GET() {
  return handle(async () => {
    const ctx = await requireTenant(await requireUser());
    const org = (await db.select({
      id: organizations.id,
      name: organizations.name,
      plan: organizations.plan,
      createdAt: organizations.createdAt,
    }).from(organizations).where(eq(organizations.id, ctx.orgId)).limit(1))[0];

    return ok({
      org: org ?? null,
      role: ctx.role,
      isOrgAdmin: ctx.isOrgAdmin,
      // 공개 가능 필드만(시크릿 없음).
      plans: PLANS.map((p) => ({
        id: p.id, name: p.name, price: p.price, unit: p.unit ?? '',
        note: p.note, desc: p.desc, features: p.features, highlight: !!p.highlight,
      })),
      billing: billingStatus(),
    });
  });
}
