import 'dotenv/config';
import { db } from './index';
import { users, organizations, memberships } from './schema';
import { hashPassword } from '../lib/auth';
import { grantDefaultRoles } from '../lib/seedRoles';
import { seedDemo } from '../lib/demoSeed';
import { eq } from 'drizzle-orm';
async function main() {
  const email = 'admin@demo.local';
  let u = (await db.select().from(users).where(eq(users.email, email)).limit(1))[0];
  if (!u) [u] = await db.insert(users).values({ email, name: 'Demo Admin', passwordHash: hashPassword('admin1234') }).returning();
  let org = (await db.select().from(organizations).where(eq(organizations.slug, 'demo')).limit(1))[0];
  if (!org) { [org] = await db.insert(organizations).values({ slug: 'demo', name: 'GOWON 데모 조직' }).returning();
    await db.insert(memberships).values({ orgId: org.id, userId: u.id, role: 'admin', isOrgAdmin: true }); }
  await grantDefaultRoles(org.id);
  await seedDemo(org.id, u.id);
  console.log('seeded/ensured demo data. Login: admin@demo.local / admin1234');
}
main().catch((e) => { console.error(e); process.exit(1); });
