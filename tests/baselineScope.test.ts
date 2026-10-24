// 기준치가 **어느 배포의 설정인가** 테스트(RUNBOOK §3-13).
//
// 이 파일이 지키는 것은 하나다 — **기준치는 한 벌이 아니다.**
//  (1) §2 월 점검은 운영 스코프에 넣고 §3 4단계는 스테이징 스코프에서 읽는다 → 두 벌이다
//  (2) 판정하는 배포에 기한 키가 없으면 낡음 판정이 보류되고(`trusted: true`) 낡은 사본이 ok 를 만든다
//  (3) 기준치가 없을 때 해야 하는 일은 「다시 뜨기」(§3-2 의 유일한 금기)가 아니라 「복사」다
//  (4) 그러면서도 `switchReady` 를 내리지 않는다 — 막으면 복구일에 거짓 차단이 된다
// 더해서 실제 모듈·라우트·`/api/health`·RUNBOOK 원문을 대조해 배선과 문서가 함께 낡지 않도록 한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  ACTION_SCOPE_JUDGING_ABSENT, ACTION_SCOPE_JUDGING_OK, ACTION_SCOPE_OTHER,
  ACTION_SCOPE_SUPPLYING, ACTION_SCOPE_UNKNOWN,
  BASELINE_SCOPE_REF, CAVEAT_SCOPE_COPY_UNDATED, CAVEAT_SCOPE_FRESHNESS_ELSEWHERE,
  CAVEAT_SCOPE_NO_GATE, CAVEAT_SCOPE_OTHER_SCOPES_INVISIBLE,
  DATA_BASELINE_ENV, SCOPE_DRIFTS, SCOPE_LIMITS, SCOPE_MISREADS, SUPPLY_ROUTES,
  actionScopeJudgingUnjudged, assessBaselineScope, auditNoNewHealthCheck, auditRoleReader,
  auditRunbookScope, auditScopeRegistry, auditVerifyWiring, baselineScopeFromEnv,
  baselineScopeLine, baselineScopeStatus, baselineScopeText, crossScopeKeys,
  publicBaselineScope, supplyRouteFor, type SupplyRoute,
} from '../src/lib/baselineScope.ts';
import { BASELINE_MAX_AGE_ENV } from '../src/lib/recoveryBaseline.ts';
import { ENV_VARS } from '../src/lib/envRegistry.ts';
import { deploymentRole } from '../src/lib/rehearsalScope.ts';
import { PROCEDURE_UNITS } from '../src/lib/rehearsalCoverage.ts';
import { parseChecklistBoxes, unitItemLoad } from '../src/lib/rehearsalChecklist.ts';
import { recoveryVerification, recoveryVerifyLogLine, verifyRowCounts } from '../src/lib/recoveryVerify.ts';
import { verifySchema } from '../src/lib/schemaVerify.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const RUNBOOK = read('RUNBOOK.md');

const judging = (over: Partial<Parameters<typeof assessBaselineScope>[0]> = {}) =>
  assessBaselineScope({
    role: 'preview', basis: 'VERCEL_ENV',
    baselineConfigured: true, maxAgeConfigured: true, ageStatus: 'ok', ...over,
  });

/* ───────────────────────────── 공급·판정 정본 ───────────────────────────── */

test('SUPPLY_ROUTES: 공급처와 판정처가 전건 적혀 있고, 갈리는 키에는 생기는 일이 붙어 있다', () => {
  assert.deepEqual(auditScopeRegistry(), [], '정본이 깨졌다');
  // 갈리는 키는 기준 스냅샷과 그 갱신 기한 **한 벌**이다 — 하나만 복사하면 나머지가 판정을 보류시킨다
  assert.deepEqual(crossScopeKeys(), [DATA_BASELINE_ENV, BASELINE_MAX_AGE_ENV]);
  for (const r of SUPPLY_ROUTES) {
    assert.ok(r.whenSplit.trim().length > 20, `${r.key}: whenSplit 가 한 줄도 안 된다`);
    if (r.crossScope) {
      assert.equal(r.suppliedScope, 'production');
      assert.equal(r.judgedScope, 'preview', `${r.key}: 판정처가 스테이징이 아니다`);
    }
  }
  assert.equal(supplyRouteFor(DATA_BASELINE_ENV)?.crossScope, true);
  assert.equal(supplyRouteFor('RECOVERY_EXPECTED_DB')?.crossScope, false, '지문은 같은 스코프에서 넣고 본다');
  assert.equal(supplyRouteFor('없는키'), null);
  assert.equal(supplyRouteFor(null), null);
});

test('SUPPLY_ROUTES: 등록된 키가 실제 env 레지스트리에 있다 ⬅ 유령 키를 양방향으로 막는다', () => {
  const known = new Set(ENV_VARS.map((v) => v.key));
  for (const r of SUPPLY_ROUTES) assert.ok(known.has(r.key), `${r.key} 가 envRegistry 에 없다`);
  // 반대로 레지스트리의 기준값 키가 이 정본에서 빠지면 그 키의 스코프는 아무도 말하지 않는다.
  const mine = new Set(SUPPLY_ROUTES.map((r) => r.key));
  for (const k of [DATA_BASELINE_ENV, BASELINE_MAX_AGE_ENV, 'RECOVERY_ENV_BASELINE']) {
    assert.ok(mine.has(k), `${k} 가 공급·판정 정본에서 빠졌다`);
  }
});

test('auditScopeRegistry: 유령 키·중복·빈 설명·모순 선언을 각각 잡는다', () => {
  const row = (over: Partial<SupplyRoute> = {}): SupplyRoute => ({
    key: DATA_BASELINE_ENV, suppliedIn: '§2', suppliedScope: 'production',
    judgedIn: '§3 4단계', judgedScope: 'preview', seenIn: '§2 5번',
    crossScope: true, whenSplit: '두 벌이 갈린다 — 어느 쪽도 오류를 내지 않는다', ...over,
  });
  assert.deepEqual(auditScopeRegistry([row()]), []);
  assert.ok(auditScopeRegistry([row({ key: 'RECOVERY_NOT_A_KEY' })]).some((p) => p.includes('유령 키')));
  assert.ok(auditScopeRegistry([row(), row()]).some((p) => p.includes('중복 등록')));
  assert.ok(auditScopeRegistry([row({ whenSplit: '  ' })]).some((p) => p.includes('whenSplit')));
  assert.ok(auditScopeRegistry([row({ seenIn: '' })]).some((p) => p.includes('seenIn')));
  // 선언과 스코프가 어긋나면 표가 거짓이 된다 — 양방향으로 잡는다.
  assert.ok(auditScopeRegistry([row({ judgedScope: 'production' })])
    .some((p) => p.includes('crossScope 인데')));
  assert.ok(auditScopeRegistry([row({ crossScope: false })])
    .some((p) => p.includes('crossScope 가 false')));
  assert.ok(auditScopeRegistry([row({ crossScope: false, judgedScope: 'production' })])
    .some((p) => p.includes('갈리는 키가 하나도 없다')));
  assert.equal(new Set(ENV_VARS.map((v) => v.key)).has('RECOVERY_NOT_A_KEY'), false);
});

/* ───────────────────────────── 판정 ───────────────────────────── */

test('assessBaselineScope: 역할을 모르면 멈춘다 ⬅ 「운영이 아니다」로 올리지 않는다', () => {
  const a = assessBaselineScope({
    role: 'unknown', basis: null, baselineConfigured: true, maxAgeConfigured: true,
  });
  assert.equal(a.verdict, 'scope_unknown');
  assert.equal(a.corroborated, false);
  assert.equal(a.usedOnRecoveryDay, false, '어느 벌인지 모르면 「복구일 벌」이라고도 하지 않는다');
  assert.equal(a.basis, null);
  assert.equal(a.action, ACTION_SCOPE_UNKNOWN);
  assert.ok(a.caveats.includes(CAVEAT_SCOPE_NO_GATE));
});

test('assessBaselineScope: 운영에서 판정하면 supplying — 복구일이 읽는 벌이 아니라고 적는다', () => {
  const a = assessBaselineScope({
    role: 'production', basis: 'VERCEL_ENV',
    baselineConfigured: true, maxAgeConfigured: true, ageStatus: 'ok',
  });
  assert.equal(a.verdict, 'supplying');
  assert.equal(a.corroborated, true, '§2 5번이 같은 벌의 신선도를 매월 본다');
  assert.equal(a.usedOnRecoveryDay, false);
  assert.equal(a.action, ACTION_SCOPE_SUPPLYING);
  assert.match(a.action ?? '', /같은 값/, '복사하라는 말이 빠지면 두 벌이 갈린 채로 남는다');
  assert.ok(a.caveats.includes(CAVEAT_SCOPE_FRESHNESS_ELSEWHERE));
});

test('assessBaselineScope: 스테이징의 기준치가 없으면 「복사」로 안내한다 ⬅ 다시 뜨면 기준치가 영구히 망가진다', () => {
  const a = judging({ baselineConfigured: false, maxAgeConfigured: false, ageStatus: 'absent' });
  assert.equal(a.verdict, 'judging');
  assert.equal(a.usedOnRecoveryDay, true);
  assert.equal(a.action, ACTION_SCOPE_JUDGING_ABSENT);
  assert.match(a.action ?? '', /복사/);
  assert.match(a.action ?? '', /다시 뜨지 말/, '§3-2 의 유일한 금기가 빠지면 가장 하기 쉬운 행동이 그것이다');
  assert.match(a.action ?? '', /드러나지도 않는다/, '재스냅샷이 운영 health 에 안 보인다는 사실까지 적는다');
});

test('assessBaselineScope: 판정 스코프에 기한 키가 없으면 낡음 보호가 작동하지 않는다고 적는다', () => {
  const a = judging({ maxAgeConfigured: false, ageStatus: 'unjudged' });
  assert.equal(a.ageJudgedHere, false);
  assert.equal(a.action, actionScopeJudgingUnjudged(BASELINE_MAX_AGE_ENV));
  assert.match(a.action ?? '', /낡았는지 보지 않았다/, '`trusted: true` 의 뜻을 바로잡는 문장이다');
  assert.match(a.action ?? '', new RegExp(BASELINE_MAX_AGE_ENV));
});

test('assessBaselineScope: 기한 키가 있어도 판정이 보류됐으면 같은 안내를 낸다', () => {
  // 형식 밖 값이 들어가 `baselineMaxAgeDays` 가 null 을 돌려준 경우 — 들어 있다는 것만으로
  // 판정이 성립하지 않는다(「넣어 두었다」와 「판정됐다」는 다르다).
  const a = judging({ maxAgeConfigured: true, ageStatus: 'unjudged' });
  assert.equal(a.action, actionScopeJudgingUnjudged(BASELINE_MAX_AGE_ENV));
  assert.equal(a.ageJudgedHere, true, 'ageJudgedHere 는 키 존재만 말한다 — 판정 성립은 ageStatus 가 말한다');
});

test('assessBaselineScope: 스테이징의 벌은 어떤 경우에도 corroborated 가 아니다', () => {
  for (const over of [
    {}, { ageStatus: 'stale' as const }, { baselineConfigured: false }, { maxAgeConfigured: false },
  ]) {
    const a = judging(over);
    assert.equal(a.verdict, 'judging', JSON.stringify(over));
    assert.equal(a.corroborated, false, '§2 가 갱신하지 않는 사본이다');
    assert.ok(a.caveats.includes(CAVEAT_SCOPE_COPY_UNDATED), '복사 시점을 모른다는 사실을 함께 낸다');
  }
  assert.equal(judging().action, ACTION_SCOPE_JUDGING_OK);
});

test('assessBaselineScope: 로컬·개발은 공급처도 판정처도 아니다', () => {
  const a = assessBaselineScope({
    role: 'development', basis: 'NODE_ENV', baselineConfigured: true, maxAgeConfigured: true,
  });
  assert.equal(a.verdict, 'other');
  assert.equal(a.corroborated, false);
  assert.equal(a.usedOnRecoveryDay, false);
  assert.equal(a.action, ACTION_SCOPE_OTHER);
  assert.ok(a.caveats.includes(CAVEAT_SCOPE_OTHER_SCOPES_INVISIBLE));
});

test('판정은 값을 담지 않는다 ⬅ 스냅샷 수치·지문이 응답에 섞이면 공개 경로로 샌다', () => {
  const dumped = JSON.stringify([
    judging(), assessBaselineScope({ role: 'production', baselineConfigured: true, maxAgeConfigured: true }),
    publicBaselineScope(judging()),
  ]);
  for (const f of ['users=', 'asOf=', 'organizations=', 'postgres://']) {
    assert.ok(!dumped.includes(f), `${f} 가 판정에 들어 있다`);
  }
  assert.ok(!/\d{6,}/.test(dumped), '행 수로 보일 수 있는 큰 수가 들어 있다');
});

/* ───────────────────────────── env 판독 ───────────────────────────── */

test('baselineScopeFromEnv: 역할 판독을 복제하지 않는다 ⬅ deploymentRole 정본과 같은 답을 낸다', () => {
  for (const env of [
    { VERCEL_ENV: 'production' }, { VERCEL_ENV: 'preview' }, { VERCEL_ENV: 'development' },
    { VERCEL_ENV: '' }, {}, { NODE_ENV: 'production' }, { NODE_ENV: 'development' },
    { VERCEL_ENV: 'Preview' }, { VERCEL_ENV: 'prod' },
  ]) {
    const expected = deploymentRole(env);
    const a = baselineScopeFromEnv(env);
    assert.equal(a.role, expected.role, JSON.stringify(env));
    assert.equal(a.basis, expected.source, JSON.stringify(env));
  }
  // Vercel 에서는 프리뷰 배포도 NODE_ENV=production 이다 — 그것으로 운영이라고 단정하지 않는다.
  assert.equal(baselineScopeFromEnv({ NODE_ENV: 'production' }).verdict, 'scope_unknown');
});

test('baselineScopeFromEnv: 존재 여부만 본다 — 공백은 「넣어 두었다」로 세지 않는다', () => {
  const blank = baselineScopeFromEnv({
    VERCEL_ENV: 'preview', [DATA_BASELINE_ENV]: '   ', [BASELINE_MAX_AGE_ENV]: '',
  });
  assert.equal(blank.action, ACTION_SCOPE_JUDGING_ABSENT, '공백은 미설정이다');
  assert.equal(blank.ageJudgedHere, false);
  const set = baselineScopeFromEnv({
    VERCEL_ENV: 'preview', [DATA_BASELINE_ENV]: 'asOf=2026-10-01,users=12', [BASELINE_MAX_AGE_ENV]: '35',
  }, 'ok');
  assert.equal(set.action, ACTION_SCOPE_JUDGING_OK);
  assert.equal(set.ageJudgedHere, true);
});

test('출력 3종: 스코프 이름·판정·불리언만 — 값은 담지 않는다', () => {
  const line = baselineScopeLine(judging());
  assert.match(line, /baseline_scope=judging/);
  assert.match(line, /role=preview/);
  assert.match(line, /baseline_corroborated=false/);
  assert.match(line, /recovery_day_copy=true/);
  assert.ok(!baselineScopeLine(assessBaselineScope({
    role: 'production', baselineConfigured: true, maxAgeConfigured: true,
  })).includes('recovery_day_copy'), '공급처에서는 복구일 벌 표시가 붙지 않는다');

  for (const role of ['production', 'preview', 'development', 'unknown'] as const) {
    const a = assessBaselineScope({ role, baselineConfigured: true, maxAgeConfigured: true });
    assert.ok(baselineScopeText(a).length > 10, `${role}: 한 줄 설명이 없다`);
  }
  const pub = publicBaselineScope(judging());
  assert.deepEqual(Object.keys(pub).sort(),
    ['action', 'ageJudgedHere', 'corroborated', 'role', 'usedOnRecoveryDay', 'verdict']);
  const st = baselineScopeStatus({ VERCEL_ENV: 'preview' });
  assert.equal(st.role, 'preview');
  assert.equal(st.splitKeys, 2);
  assert.equal(BASELINE_SCOPE_REF, 'RUNBOOK §3-13 · §3-2 · §2 3번');
});

/* ───────────────────────────── 거짓이 되는 판정·한계 ───────────────────────────── */

test('SCOPE_MISREADS·SCOPE_DRIFTS·SCOPE_LIMITS: 전건 사유가 붙어 있다', () => {
  assert.ok(SCOPE_MISREADS.length >= 6);
  for (const m of SCOPE_MISREADS) {
    assert.ok(m.claim.trim() && m.why.trim().length > 15, `사유 없는 오독: ${m.claim}`);
  }
  assert.equal(SCOPE_DRIFTS.length, 3, '갈리는 방향은 세 가지다(운영만·스테이징만·값이 다름)');
  for (const d of SCOPE_DRIFTS) assert.ok(d.effect.trim().length > 15);
  assert.ok(SCOPE_LIMITS.length >= 7);
  assert.ok(SCOPE_LIMITS.some((l) => l.includes('다른 스코프의 env')), '가장 큰 한계가 빠졌다');
  assert.ok(SCOPE_LIMITS.some((l) => l.includes('switchReady')), '막지 않는다는 사실을 적는다');
});

/* ───────────────────────────── 복구 검증 배선 ───────────────────────────── */

const emptySchema = () => verifySchema({ expected: ['users'], present: ['users'], statements: [] });
const okData = () => verifyRowCounts({
  counts: { users: 12 }, present: ['users'], tables: ['users'],
  baseline: { asOf: '2026-10-01', counts: { users: 10 }, invalid: [] },
  now: new Date('2026-10-05T00:00:00Z'), maxAgeDays: 35,
});

test('recoveryVerification: 스코프를 넘기면 응답에 담기고 **switchReady 를 바꾸지 않는다**', () => {
  const data = okData();
  const without = recoveryVerification(emptySchema(), data);
  const with_ = recoveryVerification(emptySchema(), data, judging({
    baselineConfigured: false, maxAgeConfigured: false, ageStatus: 'absent',
  }));
  assert.equal(with_.switchReady, without.switchReady, '스코프가 전환을 막으면 복구일에 거짓 차단이 된다');
  assert.equal(with_.action, without.action, '다음에 할 일은 스코프 판정이 따로 말한다');
  assert.equal(with_.baselineScope?.verdict, 'judging');
  assert.ok(with_.caveat.includes(CAVEAT_SCOPE_NO_GATE), '막지 않는다는 사실을 caveat 로 함께 낸다');
});

test('recoveryVerification: 스코프를 넘기지 않으면 null 이고 기존 응답이 그대로다', () => {
  const v = recoveryVerification(emptySchema(), okData());
  assert.equal(v.baselineScope, null, '판정하지 않은 것을 「문제 없음」으로 올리지 않는다');
  assert.ok(!v.caveat.includes(CAVEAT_SCOPE_NO_GATE));
});

test('recoveryVerifyLogLine: 운영에서 뜬 응답과 스테이징에서 뜬 응답이 로그에서 구분된다', () => {
  const data = okData();
  const prod = recoveryVerifyLogLine(recoveryVerification(emptySchema(), data, assessBaselineScope({
    role: 'production', baselineConfigured: true, maxAgeConfigured: true, ageStatus: 'ok',
  })));
  const stage = recoveryVerifyLogLine(recoveryVerification(emptySchema(), data, judging()));
  assert.match(prod, /baseline_scope=supplying/);
  assert.match(stage, /baseline_scope=judging/);
  assert.notEqual(prod, stage, '두 응답이 로그에서 글자 하나 다르지 않으면 구분한 적이 없다');
  assert.ok(!recoveryVerifyLogLine(recoveryVerification(emptySchema(), data)).includes('baseline_scope'));
});

/* ───────────────────────────── 실제 소스·문서 대조 ───────────────────────────── */

test('[실제 소스] baselineScope.ts 가 역할 판독을 복제하지 않고 순수하게 남아 있다', () => {
  const src = read('src/lib/baselineScope.ts');
  assert.deepEqual(auditRoleReader(src), [], '역할 판독이 갈라지면 아무 응답도 바꾸지 않으면서 영구히 남는다');
  for (const forbidden of ['@/db', "from './db", 'next/server', 'node:fs', 'drizzle']) {
    assert.ok(!src.includes(forbidden), `순수 모듈이 ${forbidden} 를 끌어온다`);
  }
  for (const verb of ['insert ', 'update ', 'delete ', 'CREATE TABLE', 'ALTER TABLE']) {
    assert.ok(!src.toUpperCase().includes(verb.toUpperCase()), `쓰기·DDL(${verb})이 들어 있다`);
  }
});

test('auditRoleReader: VERCEL_ENV 직접 읽기·process.env 접근을 잡는다', () => {
  assert.ok(auditRoleReader('const v = env.VERCEL_ENV; deploymentRole(e)').length >= 1);
  assert.ok(auditRoleReader("const v = env['VERCEL_ENV']; deploymentRole(e)").length >= 1);
  assert.ok(auditRoleReader('deploymentRole(process.env)').some((p) => p.includes('process.env')));
  assert.ok(auditRoleReader('const r = roleOf(env)').some((p) => p.includes('deploymentRole')));
});

test('[실제 소스] 복구 검증 라우트가 스코프 판정을 응답·로그·감사에 담는다', () => {
  const src = read('src/app/api/admin/recovery-verify/route.ts');
  assert.deepEqual(auditVerifyWiring(src), [], '판정만 하고 버리는 꼴이면 아무것도 달라지지 않는다');
  // 신규 조회·쓰기·DDL 0 — db 접근은 기존 두 건(테이블 목록·행 수)뿐이다.
  assert.equal((src.match(/db\.execute\(/g) ?? []).length, 2);
  for (const verb of ['CREATE TABLE', 'ALTER TABLE', '.insert(', '.update(', '.delete(']) {
    assert.ok(!src.includes(verb), `복구 검증에 ${verb} 가 들어갔다`);
  }
  // route.ts 는 HTTP 메서드·설정 외 export 를 두지 않는다(Vercel 빌드가 실패한다).
  assert.deepEqual((src.match(/^export\s+(?:async\s+)?(?:function|const)\s+(\w+)/gm) ?? [])
    .map((m) => m.split(/\s+/).pop()), ['dynamic', 'GET']);
});

test('auditVerifyWiring: 배선 누락 네 가지를 각각 잡는다', () => {
  assert.ok(auditVerifyWiring('').length >= 4);
  const noPass = 'baselineScopeFromEnv(e); baselineScopeLine(s); const d = { baselineScope: 1 };';
  assert.ok(auditVerifyWiring(noPass).some((p) => p.includes('recoveryVerification')));
  const noLog = 'baselineScopeFromEnv(e); recoveryVerification(a, b, baselineScope); x={baselineScope: 1}';
  assert.ok(auditVerifyWiring(noLog).some((p) => p.includes('로그')));
});

test('[실제 소스] /api/health 에 새 체크가 생기지 않았다 ⬅ 같은 국면을 두 번 보고하지 않는다', () => {
  const src = read('src/app/api/health/route.ts');
  assert.deepEqual(auditNoNewHealthCheck(src), []);
  assert.ok(src.includes('checks.recovery = recoveryReadinessCheck()'), '기존 배선이 사라졌다');
  assert.ok(!src.includes('baselineScope'), '공개 응답의 모양을 바꾸지 않는다(degraded 도 늘지 않는다)');
  assert.ok(auditNoNewHealthCheck('checks.baselineScope = x()').length === 1);
});

test('[실제 문서] RUNBOOK §3-13 이 판정 표·갈리는 키를 들고 있다', () => {
  assert.deepEqual(auditRunbookScope(RUNBOOK), []);
  assert.ok(auditRunbookScope('### 3-13. x').length >= 1, '절만 있고 판정 표가 없으면 잡는다');
  assert.ok(auditRunbookScope(RUNBOOK.replace('### 3-13.', '### 3-99.')).some((p) => p.includes('3-13')));
});

test('[실제 문서] §2·§3 4단계·§3-2 가 스코프가 갈린다는 사실을 적고 있다', () => {
  const s2 = RUNBOOK.slice(RUNBOOK.indexOf('## 2. 정기 점검'), RUNBOOK.indexOf('### 2-1.'));
  assert.ok(/어느 스코프에 넣는지/.test(s2), '§2 3번이 스코프를 적지 않으면 두 벌이 갈린 채로 운영된다');
  assert.ok(s2.includes('3-13'));
  assert.ok(/이 배포\(운영\) 스코프의 벌/.test(s2), '§2 5번이 「이 벌」이라고 말하지 않으면 매월 다른 값을 본다');

  const step4 = RUNBOOK.slice(RUNBOOK.indexOf('4. **검증**'), RUNBOOK.indexOf('5. **전환**'));
  assert.ok(step4.includes('data.baselineScope.verdict'), '4단계가 어느 벌을 읽었는지 보지 않는다');
  assert.ok(/다시 뜨기.*복사|복사/.test(step4), '「다시 뜨지 않고 복사」가 빠졌다');

  const s32 = RUNBOOK.slice(RUNBOOK.indexOf('### 3-2.'), RUNBOOK.indexOf('### 3-3.'));
  assert.ok(/한 벌이 아니다/.test(s32), '§3-2 가 기준치를 한 벌로 말하면 위 세 판정이 거짓이 된다');
  assert.ok(s32.includes('unjudged'), '`stale` 보호가 꺼지는 경로를 §3-2 가 적지 않는다');
});

test('[실제 문서] 체크리스트가 §3-13 을 인용하고, 그 칸은 **열려 있다**', () => {
  assert.ok(PROCEDURE_UNITS.some((u) => u.key === '3-13' && u.cited), '절차 단위 3-13 이 등록되지 않았다');
  const boxes = parseChecklistBoxes(RUNBOOK);
  assert.ok(boxes && boxes.length > 0, '체크리스트 구간을 찾지 못했다');
  const load = unitItemLoad(boxes!).find((u) => u.unit === '3-13');
  assert.ok(load && load.items.length >= 2, '3-13 을 인용하는 항목이 2개 미만이다');
  assert.equal(load!.checked, 0, '체크된 칸을 커밋하면 다음 수행이 그 체크를 물려받는다(§6-9)');
  for (const b of boxes!) {
    if (b.units.includes('3-13')) assert.equal(b.state, 'open', `항목 ${b.index} 의 칸이 열려 있지 않다`);
  }
});
