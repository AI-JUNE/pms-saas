import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SAMPLE_PROJECT_CODE, defaultOrgName, orgSlug, parseRegisterOptions, sampleProjectRows, onboardingSteps, summarizeOnboarding,
} from '../src/lib/onboarding.ts';

test('defaultOrgName falls back safely', () => {
  assert.equal(defaultOrgName('홍길동'), '홍길동의 조직');
  assert.equal(defaultOrgName('  '), '내 조직');
  assert.equal(defaultOrgName(undefined), '내 조직');
});

test('orgSlug is lowercase-ascii, unique by user id, korean-only name → org-<id>', () => {
  assert.equal(orgSlug('My Company!', 7), 'my-company-7');
  assert.equal(orgSlug('--Acme--', 3), 'acme-3');
  assert.equal(orgSlug('고원', 12), 'org-12');
  assert.equal(orgSlug(null, 1), 'org-1');
  assert.match(orgSlug('Any Name', 99), /^[a-z0-9-]+$/);
});

test('parseRegisterOptions: default true, explicit false variants, joining always false', () => {
  assert.equal(parseRegisterOptions({}).createSample, true);
  assert.equal(parseRegisterOptions({ createSample: true }).createSample, true);
  for (const v of [false, 'false', 0, '0']) assert.equal(parseRegisterOptions({ createSample: v }).createSample, false, String(v));
  assert.equal(parseRegisterOptions({ inviteCode: 'ABCD1234', createSample: true }).createSample, false);
  assert.equal(parseRegisterOptions(null).createSample, true);
});

test('sampleProjectRows: org scoped, fixed code, relative dates, consistent phases', () => {
  const today = new Date('2026-09-14T15:00:00+09:00');
  const r = sampleProjectRows(42, today);
  assert.equal(r.project.orgId, 42);
  assert.equal(r.project.code, SAMPLE_PROJECT_CODE);
  assert.equal(r.project.startDate, '2026-08-31');
  assert.equal(r.project.endDate, '2026-11-29');
  assert.equal(r.phases.length, 4);
  const phaseNames = new Set(r.phases.map((p) => p.name));
  for (const t of r.tasks) assert.ok(phaseNames.has(t.phase), `task phase ${t.phase}`);
  for (const t of r.tasks) assert.ok(t.startDate <= t.endDate, t.code);
  for (const t of r.tasks) assert.ok(t.progress >= 0 && t.progress <= 100);
  // 완료 업무는 과거, 미착수 업무는 미래 → 화면이 비어 보이지 않음
  assert.ok(r.tasks.filter((t) => t.status === 'done').every((t) => t.endDate < '2026-09-14'));
  assert.ok(r.tasks.filter((t) => t.status === 'todo').every((t) => t.startDate >= '2026-09-14'));
  // 코드 중복 없음
  for (const arr of [r.tasks, r.requirements, r.issues, r.risks, r.phases] as any[]) {
    const codes = arr.map((x: any) => x.code); assert.equal(new Set(codes).size, codes.length);
  }
  // 행에는 orgId/projectId 가 없다(어댑터가 붙임) — 다른 조직으로 새는 값이 섞이지 않음
  for (const x of [...r.tasks, ...r.requirements, ...r.issues, ...r.risks, ...r.phases] as any[]) { assert.equal('orgId' in x, false); assert.equal('projectId' in x, false); }
});

test('sampleProjectRows: no timezone drift near midnight', () => {
  const a = sampleProjectRows(1, new Date('2026-01-31T23:59:59Z'));
  assert.equal(a.project.startDate, '2026-01-17');
  const b = sampleProjectRows(1, new Date('2026-03-01T00:00:00Z'));
  assert.equal(b.project.startDate, '2026-02-15');
});

test('onboardingSteps order and done flags', () => {
  const s = onboardingSteps({ hasWorkspace: true, projectCount: 0, hasSampleProject: false, memberCount: 1, hasInviteCode: true });
  assert.deepEqual(s.map((x) => x.key), ['account', 'workspace', 'project', 'invite']);
  assert.deepEqual(s.map((x) => x.done), [true, true, false, false]);
  const t = onboardingSteps({ hasWorkspace: true, projectCount: 1, hasSampleProject: true, memberCount: 2, hasInviteCode: true });
  assert.ok(t.every((x) => x.done));
});

test('summarizeOnboarding: next step, completion, sample eligibility', () => {
  const s1 = summarizeOnboarding({ hasWorkspace: false, projectCount: 0, hasSampleProject: false, memberCount: 0, hasInviteCode: false });
  assert.equal(s1.doneCount, 1); assert.equal(s1.next?.key, 'workspace'); assert.equal(s1.completed, false); assert.equal(s1.canCreateSample, false);
  const s2 = summarizeOnboarding({ hasWorkspace: true, projectCount: 0, hasSampleProject: false, memberCount: 1, hasInviteCode: true });
  assert.equal(s2.next?.key, 'project'); assert.equal(s2.canCreateSample, true);
  const s3 = summarizeOnboarding({ hasWorkspace: true, projectCount: 3, hasSampleProject: true, memberCount: 5, hasInviteCode: true });
  assert.equal(s3.completed, true); assert.equal(s3.next, null); assert.equal(s3.canCreateSample, false);
  const s4 = summarizeOnboarding({ hasWorkspace: true, projectCount: 2, hasSampleProject: false, memberCount: 1, hasInviteCode: true });
  assert.equal(s4.next?.key, 'invite'); assert.equal(s4.canCreateSample, true);
});
