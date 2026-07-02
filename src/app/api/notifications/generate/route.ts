import { and, eq, like } from 'drizzle-orm';
import { db } from '@/db';
import { tasks, documents, notifications } from '@/db/schema';
import { requireUser } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { handle, ok } from '@/lib/http';
export const dynamic = 'force-dynamic';

// Idempotent: regenerates the current user's auto-alerts (marked with [자동] prefix).
export async function POST() {
  return handle(async () => {
    const ctx = await requireTenant(await requireUser());
    const org = ctx.orgId, uid = ctx.user.id, me = ctx.user.name;
    const now = new Date(); const startToday = new Date(now); startToday.setHours(0, 0, 0, 0);
    const in3 = new Date(startToday.getTime() + 3 * 86400000);
    const [tk, dc] = await Promise.all([
      db.select().from(tasks).where(eq(tasks.orgId, org)),
      db.select().from(documents).where(eq(documents.orgId, org)),
    ]);
    const mine = (a?: string | null) => !me || a === me;
    const due = tk.filter((t) => t.status !== 'done' && t.endDate && new Date(t.endDate) >= startToday && new Date(t.endDate) <= in3 && mine(t.assignee));
    const overdue = tk.filter((t) => t.status !== 'done' && t.endDate && new Date(t.endDate) < startToday && mine(t.assignee));
    const pending = dc.filter((d) => d.status === 'review' && (d.approver === me || !d.approver));

    await db.delete(notifications).where(and(eq(notifications.orgId, org), eq(notifications.userId, uid), like(notifications.message, '[자동]%')));
    const rows: any[] = [];
    for (const t of overdue) rows.push({ orgId: org, userId: uid, message: `[자동] 마감 초과: ${t.code} ${t.name} (${t.endDate})`, link: '/tasks' });
    for (const t of due) rows.push({ orgId: org, userId: uid, message: `[자동] 마감 임박: ${t.code} ${t.name} (${t.endDate})`, link: '/tasks' });
    for (const d of pending) rows.push({ orgId: org, userId: uid, message: `[자동] 결재 대기: ${d.code} ${d.title}`, link: '/documents' });
    if (rows.length) await db.insert(notifications).values(rows);
    return ok({ generated: rows.length, overdue: overdue.length, due: due.length, pending: pending.length });
  });
}
