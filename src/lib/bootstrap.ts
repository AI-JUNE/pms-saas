import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { users, organizations, memberships } from '@/db/schema';
import { hashPassword } from '@/lib/auth';
import { grantDefaultRoles } from '@/lib/seedRoles';

// 복구용 관리자 계정 보장(부팅 1회, 멱등). 로그인 불가 상황 대비 안전장치.
// 이미 존재하면 절대 건드리지 않는다(비밀번호 덮어쓰기 없음).
let _once: Promise<void> | null = null;
export function ensureRecoveryAdmin(): Promise<void> {
  if (_once) return _once;
  _once = (async () => {
    const email = 'admin@demo.local';
    const ex = (await db.select().from(users).where(eq(users.email, email)).limit(1))[0];
    if (ex) return;
    const [u] = await db.insert(users).values({ email, name: 'Demo Admin', passwordHash: hashPassword('admin1234') }).returning();
    let org = (await db.select().from(organizations).where(eq(organizations.slug, 'demo')).limit(1))[0];
    if (!org) { [org] = await db.insert(organizations).values({ slug: 'demo', name: 'GOWON 데모 조직' }).returning(); }
    await db.insert(memberships).values({ orgId: org.id, userId: u.id, role: 'admin', isOrgAdmin: true });
    await grantDefaultRoles(org.id);
    console.log('[bootstrap] 복구용 관리자 생성: admin@demo.local / admin1234');
  })().catch((e) => { console.error('[ensureRecoveryAdmin] 실패', e); });
  return _once;
}
