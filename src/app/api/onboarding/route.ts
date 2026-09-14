import { requireUser } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { handle, ok, ApiError, ERROR } from '@/lib/http';
import { summarizeOnboarding } from '@/lib/onboarding';
import { ensureSampleProject, loadOnboardingState } from '@/lib/onboardingDb';
import { auditSecurity } from '@/lib/audit';
export const dynamic = 'force-dynamic';

/** GET: 온보딩 체크리스트(계정·워크스페이스·프로젝트·초대) 진행 상태 */
export async function GET(req: Request) {
  return handle(async () => {
    const user = await requireUser();
    let orgId: number | null = null;
    try { orgId = (await requireTenant(user)).orgId; } catch { orgId = null; }
    const state = await loadOnboardingState(orgId);
    return ok({ ok: true, ...summarizeOnboarding(state) });
  }, req);
}

/** POST {action:'sample'}: 샘플 프로젝트 생성(멱등). 조직 관리자 전용 */
export async function POST(req: Request) {
  return handle(async () => {
    const ctx = await requireTenant(await requireUser());
    const body = await req.json().catch(() => ({}));
    if (body?.action !== 'sample') throw new ApiError(ERROR.VALIDATION, '지원하지 않는 action 입니다');
    if (!ctx.isOrgAdmin && !ctx.user.isSuperadmin) throw new ApiError(ERROR.FORBIDDEN, '조직 관리자만 실행할 수 있습니다');
    const r = await ensureSampleProject(ctx.orgId);
    if (r.created) await auditSecurity('ONBOARDING_SAMPLE_PROJECT', { userId: ctx.user.id, orgId: ctx.orgId });
    return ok({ ok: true, ...r });
  }, req);
}
