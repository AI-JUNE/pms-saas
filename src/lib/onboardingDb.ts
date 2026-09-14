// 온보딩 DB 어댑터: 샘플 프로젝트 생성(멱등) + 온보딩 상태 조회. 순수 로직은 lib/onboarding.ts
import { and, eq, count } from 'drizzle-orm';
import { db } from '@/db';
import { projects, phases, tasks, requirements, issues, risks, memberships, organizations } from '@/db/schema';
import { SAMPLE_PROJECT_CODE, sampleProjectRows, type OnboardingState } from '@/lib/onboarding';

/** 샘플 프로젝트가 없으면 만든다. 이미 있으면 기존 id 반환(중복 생성 없음). */
export async function ensureSampleProject(orgId: number): Promise<{ projectId: number; created: boolean }> {
  const ex = (await db.select({ id: projects.id }).from(projects).where(and(eq(projects.orgId, orgId), eq(projects.code, SAMPLE_PROJECT_CODE))).limit(1))[0];
  if (ex) return { projectId: ex.id, created: false };
  const rows = sampleProjectRows(orgId);
  const [pr] = await db.insert(projects).values(rows.project).returning({ id: projects.id });
  const b = <T extends object>(o: T) => ({ orgId, projectId: pr.id, ...o });
  await db.insert(phases).values(rows.phases.map(b));
  await db.insert(tasks).values(rows.tasks.map(b));
  await db.insert(requirements).values(rows.requirements.map(b));
  await db.insert(issues).values(rows.issues.map(b));
  await db.insert(risks).values(rows.risks.map(b));
  return { projectId: pr.id, created: true };
}

export async function loadOnboardingState(orgId: number | null): Promise<OnboardingState> {
  if (!orgId) return { hasWorkspace: false, projectCount: 0, hasSampleProject: false, memberCount: 0, hasInviteCode: false };
  const [pc] = await db.select({ n: count() }).from(projects).where(eq(projects.orgId, orgId));
  const sample = (await db.select({ id: projects.id }).from(projects).where(and(eq(projects.orgId, orgId), eq(projects.code, SAMPLE_PROJECT_CODE))).limit(1))[0];
  const [mc] = await db.select({ n: count() }).from(memberships).where(eq(memberships.orgId, orgId));
  const org = (await db.select({ inviteCode: organizations.inviteCode }).from(organizations).where(eq(organizations.id, orgId)).limit(1))[0];
  return { hasWorkspace: true, projectCount: Number(pc?.n ?? 0), hasSampleProject: !!sample, memberCount: Number(mc?.n ?? 0), hasInviteCode: !!org?.inviteCode };
}
