import crypto from 'crypto';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { users, organizations, memberships, issues } from '@/db/schema';
import { hashPassword, createSession } from '@/lib/auth';
import { handle, ok, ApiError, ERROR } from '@/lib/http';
import { grantDefaultRoles } from '@/lib/seedRoles';
import { seedDemo } from '@/lib/demoSeed';
import { enforceRateLimit, RL } from '@/lib/ratelimit';
import { auditSecurity } from '@/lib/audit';
import { log } from '@/lib/logger';
import { GUEST_EMAIL, GUEST_NAME, GUEST_PREFIX, GUEST_SESSION_DAYS, DEMO_ORG_SLUG, DEMO_ORG_NAME } from '@/lib/guestMode';
export const dynamic = 'force-dynamic';

// 둘러보기(손님) 입장 — 데모 전용 조직에 읽기 전용 손님 세션(2026-10-28 사용자 요청). 규칙은 lib/guestMode.ts.
// 데모 조직·손님 계정이 없으면 처음 한 번 만든다(조직: 초대 코드 없음 · 계정: 아무도 모르는 무작위 비밀번호 → 비밀번호 로그인 불가).

async function findDemoOrg() {
  // tenant-scan: allow(데모 조직을 slug 로 찾는 입장 단계 — 로그인 전이라 org 컨텍스트 없음, slug 는 유일)
  return (await db.select().from(organizations).where(eq(organizations.slug, DEMO_ORG_SLUG)).limit(1))[0];
}

async function ensureDemo(): Promise<{ orgId: number; userId: number }> {
  let org = await findDemoOrg();
  let created = false;
  if (!org) {
    try { [org] = await db.insert(organizations).values({ slug: DEMO_ORG_SLUG, name: DEMO_ORG_NAME, inviteCode: null }).returning(); created = true; }
    catch { org = await findDemoOrg(); } // 동시에 두 번 눌러도 하나만
    if (!org) throw new ApiError(ERROR.SERVER, '데모 조직을 준비하지 못했습니다');
    if (created) await grantDefaultRoles(org.id);
  }
  let user = (await db.select().from(users).where(eq(users.email, GUEST_EMAIL)).limit(1))[0];
  if (!user) {
    try { [user] = await db.insert(users).values({ email: GUEST_EMAIL, name: GUEST_NAME, passwordHash: hashPassword(crypto.randomBytes(48).toString('hex')) }).returning(); }
    catch { user = (await db.select().from(users).where(eq(users.email, GUEST_EMAIL)).limit(1))[0]; }
    if (!user) throw new ApiError(ERROR.SERVER, '손님 계정을 준비하지 못했습니다');
  }
  const mem = (await db.select().from(memberships).where(and(eq(memberships.orgId, org.id), eq(memberships.userId, user.id))).limit(1))[0];
  if (!mem) await db.insert(memberships).values({ orgId: org.id, userId: user.id, role: 'member', isOrgAdmin: false });
  // 처음 만들 때 + 앞선 채우기가 중간에 멈춰 이슈가 비어 있을 때(10-28 운영: issues.cycle 칸 누락으로 이슈부터 비어 있었다) — seedDemo 는 빈 표만 채운다
  const noIssues = !(await db.select({ id: issues.id }).from(issues).where(eq(issues.orgId, org.id)).limit(1))[0];
  if (created || noIssues) { try { await seedDemo(org.id, user.id); } catch (e: any) { log.warn('guest.seed_failed', { orgId: org.id, error: String(e?.message || e) }); } }
  return { orgId: org.id, userId: user.id };
}

export async function POST(req: Request) {
  return handle(async () => {
    if (process.env.PMS_GUEST_DISABLED === 'true') throw new ApiError(ERROR.FORBIDDEN, '둘러보기가 꺼져 있습니다');
    enforceRateLimit(req, RL.authGuest);
    const d = await ensureDemo();
    await createSession(d.userId, req.headers.get('user-agent') || undefined, { prefix: GUEST_PREFIX, days: GUEST_SESSION_DAYS });
    await auditSecurity('AUTH_GUEST_ENTER', { userId: d.userId, orgId: d.orgId });
    return ok({ ok: true, guest: true });
  }, req);
}
