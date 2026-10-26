import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { documents, firewallRequests } from '@/db/schema';
import { requireUser } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { handle, ok } from '@/lib/http';
import { myApprovals } from '@/lib/shellPrefs';
export const dynamic = 'force-dynamic';

// 내 결재 대기(읽기 전용) — 화면 틀의 메뉴 배지용. 조직 범위 + 결재자 = 나.
export async function GET() {
  return handle(async () => {
    const ctx = await requireTenant(await requireUser());
    const org = ctx.orgId, me = ctx.user.name;
    const [dc, fw] = await Promise.all([
      db.select({ id: documents.id, code: documents.code, title: documents.title, status: documents.status, approver: documents.approver })
        .from(documents).where(and(eq(documents.orgId, org), eq(documents.status, 'review'))),
      db.select({ id: firewallRequests.id, code: firewallRequests.code, title: firewallRequests.title, status: firewallRequests.status, approver: firewallRequests.approver })
        .from(firewallRequests).where(and(eq(firewallRequests.orgId, org), eq(firewallRequests.status, 'requested'))),
    ]);
    const items = myApprovals(me, dc, fw);
    return ok({ count: items.length, items: items.slice(0, 10) });
  });
}
