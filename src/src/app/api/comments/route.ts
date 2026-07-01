import { and, eq, asc, inArray } from 'drizzle-orm';
import { db } from '@/db';
import { comments, members, notifications } from '@/db/schema';
import { requireUser } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { handle, ok, ApiError, ERROR } from '@/lib/http';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  return handle(async () => {
    const ctx = await requireTenant(await requireUser());
    const u = new URL(req.url); const entity = u.searchParams.get('entity'); const entityId = Number(u.searchParams.get('entityId'));
    if (!entity || !entityId) throw new ApiError(ERROR.VALIDATION, 'entity/entityId 필요');
    const rows = await db.select().from(comments)
      .where(and(eq(comments.orgId, ctx.orgId), eq(comments.entity, entity), eq(comments.entityId, entityId)))
      .orderBy(asc(comments.id));
    return ok(rows);
  });
}
export async function POST(req: Request) {
  return handle(async () => {
    const ctx = await requireTenant(await requireUser());
    const { entity, entityId, body } = await req.json();
    if (!entity || !entityId || !body) throw new ApiError(ERROR.VALIDATION, '내용을 입력하세요');
    const [c] = await db.insert(comments).values({
      orgId: ctx.orgId, entity, entityId: Number(entityId), userId: ctx.user.id, authorName: ctx.user.name, body,
    }).returning();
    // @mention -> notification (match member names)
    const mentions = Array.from(new Set((String(body).match(/@([\w가-힣]+)/g) || []).map((m) => m.slice(1))));
    if (mentions.length) {
      const mem = await db.select().from(members).where(and(eq(members.orgId, ctx.orgId), inArray(members.name, mentions)));
      for (const m of mem) {
        await db.insert(notifications).values({ orgId: ctx.orgId, userId: ctx.user.id,
          message: `${ctx.user.name}님이 ${entity} #${entityId}에서 @${m.name}님을 멘션했습니다`, link: `/${entity}` });
      }
    }
    return ok(c, 201);
  });
}
