import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  extractStatements, statementEnd, judge, allowReason, insertValuesLiteral, spreadHasOrgId, scanSources, formatReport,
} from '../src/lib/tenantScan.ts';

const stmt = (src: string) => extractStatements(src)[0];

test('statementEnd stops at ; , closing bracket, or non-chained newline', () => {
  assert.equal('db.select().from(a).where(x);'.slice(0, statementEnd('db.select().from(a).where(x);', 0)), 'db.select().from(a).where(x)');
  const multi = 'db.select()\n      .from(a)\n      .where(eq(a.orgId, 1))\n    const y = 1;';
  assert.equal(multi.slice(0, statementEnd(multi, 0)).trim(), 'db.select()\n      .from(a)\n      .where(eq(a.orgId, 1))');
  const inArray = 'Promise.all([db.select().from(a), db.select().from(b)])';
  const s = extractStatements(inArray); assert.equal(s.length, 2); assert.equal(s[0].text, 'db.select().from(a)'); assert.equal(s[1].text, 'db.select().from(b)');
  // 문자열 안의 괄호·세미콜론은 무시
  const q = "db.execute(sql`select ';' from x`);"; assert.equal(extractStatements(q)[0].text, "db.execute(sql`select ';' from x`)");
});

test('extractStatements identifies kind, table and line', () => {
  const src = "const a = 1;\nawait db.insert(tasks).values({ orgId: 1 });\nawait db.update(issues).set({}).where(eq(issues.id, 1));\nconst r = await db.select().from(risks).where(eq(risks.orgId, 2));\nawait db.delete(todos).where(eq(todos.id, 3));";
  const s = extractStatements(src);
  assert.deepEqual(s.map((x) => [x.kind, x.table, x.line]), [['insert', 'tasks', 2], ['update', 'issues', 3], ['select', 'risks', 4], ['delete', 'todos', 5]]);
});

test('judge: tenant tables require orgId; global tables skipped; organizations needs organizations.id', () => {
  assert.equal(judge(stmt('db.select().from(tasks).where(eq(tasks.orgId, o))')), null);
  assert.equal(judge(stmt('db.select().from(tasks).where(eq(tasks.id, 1))'))?.level, 'missing');
  assert.equal(judge(stmt('db.update(tasks).set({}).where(eq(tasks.id, 1))'))?.level, 'missing');
  assert.equal(judge(stmt('db.delete(tasks).where(and(eq(tasks.id, 1), eq(tasks.orgId, o)))')), null);
  assert.equal(judge(stmt('db.select().from(unknownTable).where(eq(unknownTable.id, 1))'))?.level, 'missing', '미지 테이블은 기본 거부');
  assert.equal(judge(stmt('db.select().from(users).where(eq(users.id, 1))')), null);
  assert.equal(judge(stmt('db.delete(sessions).where(eq(sessions.token, t))')), null);
  assert.equal(judge(stmt('db.select().from(organizations).where(eq(organizations.id, ctx.orgId))')), null);
  assert.equal(judge(stmt('db.select().from(organizations).where(eq(organizations.slug, s))'))?.level, 'missing');
  assert.equal(judge(stmt('db.insert(organizations).values({ slug, name })')), null);
});

test('judge: insert literal needs orgId; indirect values reported as indirect; execute is raw', () => {
  assert.equal(judge(stmt('db.insert(tasks).values({ orgId: ctx.orgId, name })')), null);
  assert.equal(judge(stmt('db.insert(tasks).values({ name })'))?.level, 'missing');
  assert.equal(judge(stmt('db.insert(tasks).values([{ orgId: 1 }])')), null);
  assert.equal(judge(stmt('db.insert(tasks).values(rows)'))?.level, 'indirect');
  assert.equal(judge(stmt('db.insert(tasks).values(rows.map(b))'))?.level, 'indirect');
  assert.equal(insertValuesLiteral('db.insert(a).values({'), true);
  assert.equal(insertValuesLiteral('db.insert(a).values(x)'), false);
  assert.equal(judge(stmt('db.execute(sql`select 1`)'))?.level, 'raw');
});

test('spread conditions resolve to their declaration', () => {
  const ok = 'const conds = [eq(t.orgId, ctx.orgId)];\nif (x) conds.push(eq(t.projectId, 1));\nconst rows = await db.select().from(t).where(and(...conds));';
  const s = extractStatements(ok)[0];
  assert.equal(spreadHasOrgId(ok, s), true); assert.equal(judge(s, ok), null);
  const bad = 'const conds = [eq(t.projectId, 1)];\nconst rows = await db.select().from(t).where(and(...conds));';
  const b = extractStatements(bad)[0];
  assert.equal(spreadHasOrgId(bad, b), false); assert.equal(judge(b, bad)?.level, 'missing');
  const typed = 'const uw: any[] = [eq(t.id, 1), eq(t.orgId, ctx.orgId)]; const upd: any = await db.update(t).set(p).where(and(...uw)).returning();';
  assert.equal(judge(extractStatements(typed)[0], typed), null);
  // 선언이 문 뒤에 있으면 인정하지 않는다
  const after = 'const rows = await db.select().from(t).where(and(...conds));\nconst conds = [eq(t.orgId, 1)];';
  assert.equal(judge(extractStatements(after)[0], after)?.level, 'missing');
});

test('allow comment on same line or line above, reason required', () => {
  const same = 'await db.execute(sql`select 1`); // tenant-scan: allow(핑)';
  assert.equal(allowReason(same, 1), '핑');
  const above = '// tenant-scan: allow(사용자 기준 조회)\nconst r = await db.select().from(memberships).where(eq(memberships.userId, u));';
  assert.equal(allowReason(above, 2), '사용자 기준 조회');
  assert.equal(allowReason('// tenant-scan: allow()\nx', 2), null, '이유 없는 허용은 무효');
  assert.equal(allowReason('// tenant-scan: allow(멀리)\n\n\nx', 4), null, '두 줄 넘게 떨어지면 무효');
  const r = scanSources([{ path: 'a.ts', src: above }]);
  assert.equal(r.missing.length, 0); assert.equal(r.allowed.length, 1); assert.equal(r.allowed[0].reason, '사용자 기준 조회');
});

test('scanSources aggregates levels and formatReport lists missing', () => {
  const src = 'db.select().from(tasks).where(eq(tasks.id, 1));\ndb.insert(tasks).values(rows);\ndb.execute(sql`x`);\ndb.select().from(tasks).where(eq(tasks.orgId, 1));';
  const r = scanSources([{ path: 'x.ts', src }]);
  assert.equal(r.statements, 4); assert.equal(r.missing.length, 1); assert.equal(r.indirect.length, 1); assert.equal(r.raw.length, 1);
  const txt = formatReport(r);
  assert.match(txt, /누락 1/); assert.match(txt, /x\.ts:1 \[missing\] select\(tasks\)/); assert.match(txt, /원시SQL 1/);
});

// ---- 실제 소스 점검: 모든 API 라우트 + DB 를 만지는 핵심 lib. 누락·미허용 원시 SQL 이 생기면 실패한다. ----
const SRC = path.join(process.cwd(), 'src');
function walkRoutes(d: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walkRoutes(p, out); else if (e.name === 'route.ts') out.push(p);
  }
  return out;
}
const LIB_FILES = ['crud.ts', 'onboardingDb.ts', 'rbac.ts', 'tenant.ts', 'audit.ts', 'codegen.ts'];

test('real sources: every API route and tenant-touching lib scopes DB statements by orgId', () => {
  const files = [...walkRoutes(path.join(SRC, 'app', 'api')), ...LIB_FILES.map((f) => path.join(SRC, 'lib', f))]
    .filter((p) => fs.existsSync(p))
    .map((p) => ({ path: path.relative(SRC, p).replace(/\\/g, '/'), src: fs.readFileSync(p, 'utf8') }));
  assert.ok(files.length >= 70, `점검 대상이 너무 적음: ${files.length}`);
  const r = scanSources(files);
  assert.ok(r.statements >= 90, `추출된 DB 문이 너무 적음: ${r.statements}`);
  assert.deepEqual(r.missing, [], '\n' + formatReport(r));
  assert.deepEqual(r.raw, [], '허용 주석 없는 원시 SQL:\n' + formatReport(r));
  // 허용 예외는 소수(사용자 기준 멤버십 조회·초대코드·헬스체크·counters)로 묶여 있어야 한다 — 늘어나면 검토
  assert.ok(r.allowed.length <= 8, `허용 예외가 늘었습니다(${r.allowed.length}):\n` + r.allowed.map((f) => `${f.file}:${f.line} ${f.reason}`).join('\n'));
});
