import { and, eq, or, inArray, desc } from 'drizzle-orm';
import { db } from '@/db';
import { issues, issueLinks } from '@/db/schema';
import { requireUser } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { handle, ok, ApiError, ERROR } from '@/lib/http';
import { audit } from '@/lib/audit';
import { validateLink, isDuplicateLink, normalizeIssueCode, describeLink } from '@/lib/issueLinks';
export const dynamic = 'force-dynamic';

// 이슈 관계(차단함·연관·중복) — issue_links 테이블. 양방향으로 읽고, 상대 이슈의 코드·제목·상태를 함께 돌려준다.
// 테이블이 아직 없는 배포에서는 조회가 빈 목록(unavailable:true)으로 떨어진다 — 조용히 성공하지 않는다.

async function loadIssue(orgId: number, id: number) {
  return (await db.select().from(issues).where(and(eq(issues.id, id), eq(issues.orgId, orgId))).limit(1))[0];
}

export async function GET(_req: Request, c: { params: { id: string } }) {
  return handle(async () => {
    const ctx = await requireTenant(await requireUser());
    const issueId = Number(c.params.id);
    if (!Number.isInteger(issueId) || issueId <= 0) throw new ApiError(ERROR.VALIDATION, '이슈가 올바르지 않습니다');
    let links: any[] = [];
    try {
      links = await db.select().from(issueLinks)
        .where(and(eq(issueLinks.orgId, ctx.orgId), or(eq(issueLinks.srcIssueId, issueId), eq(issueLinks.dstIssueId, issueId))))
        .orderBy(desc(issueLinks.id));
    } catch (e: any) {
      console.error('[issue-links] 조회 실패(테이블 미생성?)', String(e?.message || e));
      return ok({ links: [], unavailable: true });
    }
    const otherIds = Array.from(new Set(links.map((l) => describeLink(l, issueId).otherId)));
    const others = otherIds.length
      ? await db.select({ id: issues.id, code: issues.code, title: issues.title, status: issues.status }).from(issues).where(and(eq(issues.orgId, ctx.orgId), inArray(issues.id, otherIds)))
      : [];
    const byId = new Map(others.map((o) => [o.id, o]));
    return ok({
      links: links.map((l) => { const d = describeLink(l, issueId); const o = byId.get(d.otherId); return { ...l, otherId: d.otherId, direction: d.direction, label: d.label, other: o ?? null }; }),
    });
  });
}

export async function POST(req: Request, c: { params: { id: string } }) {
  return handle(async () => {
    const ctx = await requireTenant(await requireUser());
    await requirePermission(ctx, 'issue', 'write');
    const issueId = Number(c.params.id);
    const src = await loadIssue(ctx.orgId, issueId);
    if (!src) throw new ApiError(ERROR.NOT_FOUND, '이슈를 찾을 수 없습니다');
    const body = await req.json();
    // 대상: id 또는 같은 프로젝트 안의 코드(ISS-0002). 코드는 프로젝트별로 매겨지므로 프로젝트 안에서만 찾는다.
    let dstId = Number(body?.targetId);
    if (!dstId) {
      const code = normalizeIssueCode(body?.targetCode);
      if (!code) throw new ApiError(ERROR.VALIDATION, '대상 이슈 코드를 입력하세요');
      const dst = (await db.select({ id: issues.id }).from(issues).where(and(eq(issues.orgId, ctx.orgId), eq(issues.projectId, src.projectId), eq(issues.code, code))).limit(1))[0];
      if (!dst) throw new ApiError(ERROR.NOT_FOUND, `같은 프로젝트에서 ${code} 이슈를 찾을 수 없습니다`);
      dstId = dst.id;
    } else {
      const dst = await loadIssue(ctx.orgId, dstId);
      if (!dst) throw new ApiError(ERROR.NOT_FOUND, '대상 이슈를 찾을 수 없습니다');
    }
    const v = validateLink({ srcIssueId: issueId, dstIssueId: dstId, kind: body?.kind });
    if (!v.ok) throw new ApiError(ERROR.VALIDATION, v.errors.map((e) => e.message).join(' · '), { fields: v.errors });
    const existing = await db.select().from(issueLinks)
      .where(and(eq(issueLinks.orgId, ctx.orgId), or(eq(issueLinks.srcIssueId, issueId), eq(issueLinks.dstIssueId, issueId))));
    if (isDuplicateLink(existing, v.value)) throw new ApiError(ERROR.CONFLICT, '이미 같은 관계가 등록되어 있습니다');
    const [row] = await db.insert(issueLinks).values({ orgId: ctx.orgId, srcIssueId: v.value.srcIssueId, dstIssueId: v.value.dstIssueId, kind: v.value.kind, createdBy: ctx.user.id }).returning();
    await audit(ctx, 'ISSUE_LINK_CREATE', { entity: 'issues', entityId: issueId, detail: { kind: v.value.kind, target: v.value.dstIssueId } });
    return ok(row, 201);
  });
}

export async function DELETE(req: Request, c: { params: { id: string } }) {
  return handle(async () => {
    const ctx = await requireTenant(await requireUser());
    await requirePermission(ctx, 'issue', 'write');
    const issueId = Number(c.params.id);
    const linkId = Number(new URL(req.url).searchParams.get('linkId'));
    if (!Number.isInteger(linkId) || linkId <= 0) throw new ApiError(ERROR.VALIDATION, 'linkId 가 필요합니다');
    const res: any[] = await db.delete(issueLinks)
      .where(and(eq(issueLinks.id, linkId), eq(issueLinks.orgId, ctx.orgId), or(eq(issueLinks.srcIssueId, issueId), eq(issueLinks.dstIssueId, issueId))))
      .returning();
    if (!res[0]) throw new ApiError(ERROR.NOT_FOUND, '관계를 찾을 수 없습니다');
    await audit(ctx, 'ISSUE_LINK_DELETE', { entity: 'issues', entityId: issueId, detail: { linkId } });
    return ok();
  });
}
