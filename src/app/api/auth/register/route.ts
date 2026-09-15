import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { users, organizations, memberships } from '@/db/schema';
import { hashPassword, createSession } from '@/lib/auth';
import { handle, ok, ApiError, ERROR } from '@/lib/http';
import { grantDefaultRoles } from '@/lib/seedRoles';
import { enforceRateLimit, RL } from '@/lib/ratelimit';
import { auditSecurity } from '@/lib/audit';
import { defaultOrgName, orgSlug, parseRegisterOptions } from '@/lib/onboarding';
import { ensureSampleProject } from '@/lib/onboardingDb';
import { log } from '@/lib/logger';
export const dynamic = 'force-dynamic';
const genCode = () => (Math.random().toString(36).slice(2, 10) + '00000000').slice(0, 8).toUpperCase();
export async function POST(req: Request) {
  return handle(async () => {
    enforceRateLimit(req, RL.authRegister);
    const bodyOpts = await req.json();
    const { email, name, password, orgName, inviteCode } = bodyOpts;
    if (!email || !password || !name) throw new ApiError(ERROR.VALIDATION, '이메일·이름·비밀번호는 필수입니다');
    if (String(password).length < 8) throw new ApiError(ERROR.VALIDATION, '비밀번호는 8자 이상이어야 합니다');
    const exists = (await db.select().from(users).where(eq(users.email, email)).limit(1))[0];
    if (exists) throw new ApiError(ERROR.CONFLICT, '이미 가입된 이메일입니다');
    const code = String(inviteCode || '').trim().toUpperCase();
    if (code) {
      // 초대 코드로 기존 조직에 팀원으로 합류
      // tenant-scan: allow(초대 코드로 조직을 찾는 단계 — 가입 시점이라 org 컨텍스트 없음, 코드는 유일)
      const org = (await db.select().from(organizations).where(eq(organizations.inviteCode, code)).limit(1))[0];
      if (!org) throw new ApiError(ERROR.VALIDATION, '초대 코드가 올바르지 않습니다');
      const [u] = await db.insert(users).values({ email, name, passwordHash: hashPassword(password) }).returning();
      await db.insert(memberships).values({ orgId: org.id, userId: u.id, role: 'member', isOrgAdmin: false });
      await createSession(u.id, req.headers.get('user-agent') || undefined);
      await auditSecurity('AUTH_REGISTER_JOIN', { userId: u.id, orgId: org.id });
      return ok({ ok: true, joined: true, user: { id: u.id, email, name }, org: { id: org.id, name: org.name } }, 201);
    }
    // 새 조직 생성(첫 계정 = 관리자) + 초대 코드 발급
    const [u] = await db.insert(users).values({ email, name, passwordHash: hashPassword(password) }).returning();
    const slug = orgSlug(orgName || `${name}-org`, u.id);
    const [org] = await db.insert(organizations).values({ slug, name: String(orgName || '').trim() || defaultOrgName(name), inviteCode: genCode() }).returning();
    await db.insert(memberships).values({ orgId: org.id, userId: u.id, role: 'admin', isOrgAdmin: true });
    await grantDefaultRoles(org.id);
    // 온보딩: 샘플 프로젝트(기본 생성, createSample:false 로 생략 가능). 실패해도 가입은 성공시킨다
    let sampleProjectId: number | null = null;
    if (parseRegisterOptions(bodyOpts).createSample) {
      try { sampleProjectId = (await ensureSampleProject(org.id)).projectId; } catch { log.warn('onboarding.sample_failed', { orgId: org.id }); }
    }
    await createSession(u.id, req.headers.get('user-agent') || undefined);
    await auditSecurity('AUTH_REGISTER', { userId: u.id, orgId: org.id, detail: { sampleProject: sampleProjectId != null } });
    return ok({ ok: true, user: { id: u.id, email, name }, org: { id: org.id, slug, name: org.name }, sampleProjectId }, 201);
  });
}
