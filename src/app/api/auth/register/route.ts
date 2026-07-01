import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { users, organizations, memberships } from '@/db/schema';
import { hashPassword, createSession } from '@/lib/auth';
import { handle, ok, ApiError, ERROR } from '@/lib/http';
import { grantDefaultRoles } from '@/lib/seedRoles';
export const dynamic = 'force-dynamic';
export async function POST(req: Request) {
  return handle(async () => {
    const { email, name, password, orgName } = await req.json();
    if (!email || !password || !name) throw new ApiError(ERROR.VALIDATION, '이메일·이름·비밀번호는 필수입니다');
    if (String(password).length < 8) throw new ApiError(ERROR.VALIDATION, '비밀번호는 8자 이상이어야 합니다');
    const exists = (await db.select().from(users).where(eq(users.email, email)).limit(1))[0];
    if (exists) throw new ApiError(ERROR.CONFLICT, '이미 가입된 이메일입니다');
    const [u] = await db.insert(users).values({ email, name, passwordHash: hashPassword(password) }).returning();
    const slug = (orgName || `${name}-org`).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '-' + u.id;
    const [org] = await db.insert(organizations).values({ slug, name: orgName || `${name}의 조직` }).returning();
    await db.insert(memberships).values({ orgId: org.id, userId: u.id, role: 'admin', isOrgAdmin: true });
    await grantDefaultRoles(org.id);
    await createSession(u.id, req.headers.get('user-agent') || undefined);
    return ok({ ok: true, user: { id: u.id, email, name }, org: { id: org.id, slug, name: org.name } }, 201);
  });
}
