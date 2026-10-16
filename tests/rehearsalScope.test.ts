/**
 * rehearsalScope.test.ts — 리허설이 **어느 배포에 걸리는가**(RUNBOOK §6·§6-1). 2026-10-16
 *
 * ── 왜 필요한가 ──────────────────────────────────────────────────────────────
 * §6 머리말의 「리허설은 운영 DB가 아닌 복구 브랜치에서 수행한다」는 사람에게 하는 말 한 줄이었고
 * 확인하는 코드가 없었다. 체크리스트의 파괴적 단계는 전부 **환경변수 변경 + 응답 확인**이라,
 * 스코프를 틀려 운영 배포에 걸려도 **체크리스트가 요구하는 바로 그 응답**이 나온다 —
 * 저장 503·강제 로그아웃·버려질 DB 로의 쓰기가 전부 「통과」로 보이고 §6 표에는 `정상` 으로 적힌다.
 *
 * 그래서 (a) 판정 자체(선언 유효성 → 운영 여부 → 역할 미상, 선언 없으면 **판정 보류**),
 * (b) 값을 담지 않는 규율, (c) 배선(health 응답·레지스트리·임시 키·§6 머리말·§6-1·체크리스트)을
 * 파일 수준에서 고정한다. 이 테스트는 **파일만 읽는다** — 네트워크·DB 를 쓰지 않고
 * `process.env` 도 바꾸지 않는다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  ACTION_PRODUCTION_REHEARSAL,
  DESTRUCTIVE_STEPS,
  REHEARSAL_ACTIVE_ENV,
  REHEARSAL_LIMITS,
  REHEARSAL_RUNBOOK_REF,
  REHEARSAL_SAFEGUARDS,
  ROLE_ENV_KEYS,
  SCOPE_DRIFTS,
  SCOPE_VERDICTS,
  activeDestructiveKeys,
  assessRehearsalScope,
  auditBuildInfoSource,
  auditHealthWiring,
  auditRunbookRehearsal,
  auditStepSources,
  auditSwitchDiscipline,
  declarationOf,
  deploymentRole,
  isSafeTarget,
  rehearsalPlanFor,
  rehearsalScopeCheck,
  rehearsalScopeLogLine,
  rehearsalScopeStatus,
  rehearsalScopeText,
  runbookSection6,
  stepFor,
} from '../src/lib/rehearsalScope.ts';
import { ENV_VARS } from '../src/lib/envRegistry.ts';
import { TRANSIENT_KEYS } from '../src/lib/envPresence.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (...p: string[]) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

/* ─────────────────────────── 정본 목록 ─────────────────────────── */

test('파괴적 단계 정본: 여섯 가지가 전부 있고 운영 영향·사각지대가 비어 있지 않다', () => {
  assert.deepEqual(
    DESTRUCTIVE_STEPS.map((s) => s.key),
    ['write_freeze', 'database_url', 'expected_db', 'session_purge', 'baseline_overwrite', 'promote_rollback'],
  );
  for (const s of DESTRUCTIVE_STEPS) {
    assert.ok(s.step.trim() && s.act.trim(), `${s.key} 의 단계·행위가 비었다`);
    assert.ok(s.onTarget.trim() && s.onProduction.trim() && s.whyQuiet.trim(), `${s.key} 의 설명이 비었다`);
  }
  // env 에 흔적을 남기지 않는 단계(쓰기·Promote)는 envKey 가 null 이고, 그 사실을 숨기지 않는다.
  assert.equal(stepFor('session_purge')!.envKey, null);
  assert.equal(stepFor('promote_rollback')!.envKey, null);
  assert.equal(stepFor('write_freeze')!.envKey, 'RECOVERY_WRITE_FREEZE');
  assert.equal(stepFor('없는단계'), null);
});

test('어긋남은 세 방향이고, 운영에 걸린 리허설은 **아무도 사고로 기록하지 않는다**', () => {
  assert.deepEqual(
    SCOPE_DRIFTS.map((d) => d.key),
    ['rehearsal_hits_production', 'incident_mistaken_for_rehearsal', 'declaration_left_on'],
  );
  const hit = SCOPE_DRIFTS.find((d) => d.key === 'rehearsal_hits_production')!;
  assert.match(hit.noticedBy, /아무도/);
  for (const d of SCOPE_DRIFTS) assert.ok(d.when.trim() && d.effect.trim() && d.fix.trim(), `${d.key} 칸이 비었다`);
  assert.ok(REHEARSAL_SAFEGUARDS.length >= 5);
  assert.ok(REHEARSAL_SAFEGUARDS.some((g) => g.includes(REHEARSAL_ACTIVE_ENV)));
});

/* ─────────────────────────── 배포 역할 ─────────────────────────── */

test('deploymentRole: VERCEL_ENV 만이 운영을 구분하고, 모르면 unknown 으로 남긴다', () => {
  assert.deepEqual(deploymentRole({ VERCEL_ENV: 'production' }), { role: 'production', source: 'VERCEL_ENV' });
  assert.deepEqual(deploymentRole({ VERCEL_ENV: 'Preview' }), { role: 'preview', source: 'VERCEL_ENV' });
  assert.deepEqual(deploymentRole({ VERCEL_ENV: 'development' }), { role: 'development', source: 'VERCEL_ENV' });
  // 모르는 값은 추측하지 않는다.
  assert.equal(deploymentRole({ VERCEL_ENV: 'staging' }).role, 'unknown');
  assert.equal(deploymentRole({}).role, 'unknown');
  assert.equal(deploymentRole({ VERCEL_ENV: '  ' }).role, 'unknown');
});

test('NODE_ENV=production 을 운영으로 단정하지 않는다 ⬅ Vercel 은 프리뷰도 production 이다', () => {
  // 이것을 운영으로 읽으면 리허설용 배포가 영구히 production_rehearsal 이 되어 장치가 쓸모를 잃는다.
  assert.equal(deploymentRole({ NODE_ENV: 'production' }).role, 'unknown');
  assert.equal(deploymentRole({ NODE_ENV: 'development' }).role, 'development');
  assert.equal(deploymentRole({ NODE_ENV: 'test' }).role, 'development');
  // VERCEL_ENV 가 있으면 NODE_ENV 는 보지 않는다.
  assert.equal(deploymentRole({ VERCEL_ENV: 'preview', NODE_ENV: 'production' }).role, 'preview');
});

test('isSafeTarget: unknown 은 **안전하지 않다**(모르는 것과 안전한 것은 다르다)', () => {
  assert.equal(isSafeTarget('preview'), true);
  assert.equal(isSafeTarget('development'), true);
  assert.equal(isSafeTarget('production'), false);
  assert.equal(isSafeTarget('unknown'), false);
});

/* ─────────────────────────── 선언 판독 ─────────────────────────── */

test("declarationOf: 'true' 만 ON 이고 느슨한 값은 malformed 로 드러낸다", () => {
  assert.equal(declarationOf({}), 'off');
  assert.equal(declarationOf({ RECOVERY_REHEARSAL_ACTIVE: 'true' }), 'on');
  // 1·yes·TRUE 는 OFF 로 읽히는데 대시보드에는 「넣어 두었다」로 보인다 — 조용히 보호가 없다.
  for (const v of ['1', 'yes', 'TRUE', 'on']) {
    assert.equal(declarationOf({ RECOVERY_REHEARSAL_ACTIVE: v }), 'malformed', `${v} 를 malformed 로 보지 않았다`);
  }
  // 공백뿐인 값도 같다(읽는 쪽은 미설정과 똑같이 동작한다).
  assert.equal(declarationOf({ RECOVERY_REHEARSAL_ACTIVE: '   ' }), 'malformed');
});

test('activeDestructiveKeys: 평상시에도 있는 DATABASE_URL 은 세지 않고, 차단은 ON 일 때만 센다', () => {
  assert.deepEqual(activeDestructiveKeys({ DATABASE_URL: 'postgres://u:p@h/db' }), []);
  assert.deepEqual(activeDestructiveKeys({ RECOVERY_WRITE_FREEZE: 'false' }), []);
  assert.deepEqual(activeDestructiveKeys({ RECOVERY_WRITE_FREEZE: 'true' }), ['RECOVERY_WRITE_FREEZE']);
  assert.deepEqual(
    activeDestructiveKeys({ RECOVERY_EXPECTED_DB: 'a1b2c3d4e5f6', RECOVERY_DATA_BASELINE: 'asOf=2026-10-01,users=1' }),
    ['RECOVERY_EXPECTED_DB', 'RECOVERY_DATA_BASELINE'],
  );
});

/* ─────────────────────────── 판정 ─────────────────────────── */

test('assessRehearsalScope: 평상시·리허설·운영 선언·역할 미상을 가른다', () => {
  assert.equal(assessRehearsalScope({}).verdict, 'normal');
  assert.equal(assessRehearsalScope({ VERCEL_ENV: 'preview', RECOVERY_REHEARSAL_ACTIVE: 'true' }).verdict, 'rehearsal');

  const prod = assessRehearsalScope({
    VERCEL_ENV: 'production',
    RECOVERY_REHEARSAL_ACTIVE: 'true',
    RECOVERY_WRITE_FREEZE: 'true',
  });
  assert.equal(prod.verdict, 'production_rehearsal');
  assert.equal(prod.safeTarget, false);
  assert.deepEqual([...prod.activeKeys], ['RECOVERY_WRITE_FREEZE']);
  assert.equal(prod.action, ACTION_PRODUCTION_REHEARSAL);
  // 먼저 차단을 풀라고 말한다 — 저장이 막힌 쪽이 급하다.
  assert.match(prod.action, /차단을 풀어/);

  // 역할을 모르면 rehearsal 로 올리지 않는다.
  const unknown = assessRehearsalScope({ RECOVERY_REHEARSAL_ACTIVE: 'true' });
  assert.equal(unknown.verdict, 'unknown_role');
  assert.equal(unknown.roleSource, null);
  assert.match(unknown.action, /단정하지 말고/);
});

test('판정 순서: 선언 유효성이 먼저고, 선언이 없으면 **판정을 보류**한다', () => {
  // malformed 는 운영 여부보다 먼저다 — 고칠 대상이 다르다(선언이 아예 꺼져 있다).
  const bad = assessRehearsalScope({ VERCEL_ENV: 'production', RECOVERY_REHEARSAL_ACTIVE: '1' });
  assert.equal(bad.verdict, 'invalid_declaration');
  assert.equal(bad.declared, false);

  // 파괴적 설정이 켜져 있는데 선언이 없다 = 실제 사건 대응일 수 있다 → 사고로 단정하지 않는다.
  const incident = assessRehearsalScope({ VERCEL_ENV: 'production', RECOVERY_WRITE_FREEZE: 'true' });
  assert.equal(incident.verdict, 'undeclared_activity');
  assert.match(incident.action, /실제 사건 대응이라면 정상/);
  assert.equal(SCOPE_VERDICTS.includes(incident.verdict), true);
});

/* ─────────────────────── /api/health 체크 ─────────────────────── */

test('rehearsalScopeCheck: 리허설 중은 degraded 로 드러내고 503 은 만들지 않는다', () => {
  const normal = rehearsalScopeCheck({ env: {} });
  assert.equal(normal.ok, true);
  assert.equal(normal.required, false);
  assert.equal(normal.detail.verdict, 'normal');

  // 리허설 선언은 평상시가 아니다 — 지우지 않으면 이 상태가 남아 잊히지 않는다.
  const reh = rehearsalScopeCheck({ env: { VERCEL_ENV: 'preview', RECOVERY_REHEARSAL_ACTIVE: 'true' } });
  assert.equal(reh.ok, false);
  assert.equal(reh.required, false);

  const prod = rehearsalScopeCheck({ env: { VERCEL_ENV: 'production', RECOVERY_REHEARSAL_ACTIVE: 'true' } });
  assert.equal(prod.ok, false);
  assert.equal(prod.detail.verdict, 'production_rehearsal');

  // 선언 없는 차단은 사건 대응과 구분되지 않으므로 중복 보고하지 않는다(checks.writeFreeze 가 본다).
  const incident = rehearsalScopeCheck({ env: { RECOVERY_WRITE_FREEZE: 'true' } });
  assert.equal(incident.ok, true);
  assert.equal(incident.detail.verdict, 'undeclared_activity');

  assert.equal(prod.detail.runbook, REHEARSAL_RUNBOOK_REF);
  assert.deepEqual(prod.detail.limits, REHEARSAL_LIMITS);
});

test('응답·로그에 **설정값을 담지 않는다** — 판정·역할·키 이름뿐이다', () => {
  const env = {
    VERCEL_ENV: 'production',
    RECOVERY_REHEARSAL_ACTIVE: 'true',
    RECOVERY_WRITE_FREEZE: 'true',
    RECOVERY_EXPECTED_DB: 'deadbeef1234',
    DATABASE_URL: 'postgres://user:pw@ep-secret-123.ap-southeast-1.aws.neon.tech/neondb',
    SESSION_SECRET: 'super-secret-value',
  };
  const dump = JSON.stringify(rehearsalScopeCheck({ env }));
  for (const leak of ['postgres://', 'ep-secret-123', 'super-secret-value', 'deadbeef1234', 'pw@']) {
    assert.equal(dump.includes(leak), false, `응답에 값이 들어갔다: ${leak}`);
  }
  // 키 이름은 담는다(그것이 할 일을 가리킨다).
  assert.ok(dump.includes('RECOVERY_WRITE_FREEZE'));
  assert.ok(dump.includes(REHEARSAL_ACTIVE_ENV));

  const line = rehearsalScopeLogLine(rehearsalPlanFor(env));
  assert.match(line, /^\[rehearsalScope\] verdict=production_rehearsal role=production/);
  for (const leak of ['ep-secret-123', 'super-secret-value', 'deadbeef1234']) {
    assert.equal(line.includes(leak), false, `로그에 값이 들어갔다: ${leak}`);
  }
});

test('사람용 요약·요약 상태: 수치를 지어내지 않고 목록을 그대로 비춘다', () => {
  const plan = rehearsalPlanFor({ VERCEL_ENV: 'preview', RECOVERY_REHEARSAL_ACTIVE: 'true' });
  const text = rehearsalScopeText(plan);
  assert.match(text, /^\[rehearsal\] 배포 역할=preview\(VERCEL_ENV\)/);
  assert.match(text, /파괴적 설정 없음/);
  for (const s of DESTRUCTIVE_STEPS) assert.ok(text.includes(s.key), `요약에 ${s.key} 가 없다`);
  for (const d of SCOPE_DRIFTS) assert.ok(text.includes(d.key), `요약에 ${d.key} 가 없다`);

  const st = rehearsalScopeStatus({});
  assert.equal(st.verdict, 'normal');
  assert.equal(st.role, 'unknown');
  assert.equal(st.steps, DESTRUCTIVE_STEPS.length);
  assert.equal(st.drifts, SCOPE_DRIFTS.length);
  assert.equal(st.limits, REHEARSAL_LIMITS.length);
  assert.ok(st.note.trim());
});

test('한계를 숨기지 않는다 ⬅ 선언은 「적었다」는 뜻이고 DB 가 어디인지는 말하지 않는다', () => {
  const joined = REHEARSAL_LIMITS.join('\n');
  assert.match(joined, /dbIdentity/);
  assert.match(joined, /선언하지 않으면/);
  assert.match(joined, /이 배포의 env 만/);
  assert.match(joined, /막지는 못한다/);
});

/* ─────────────────────────── 정적 점검 ─────────────────────────── */

test('auditStepSources: 레지스트리 누락·임시 키 누락을 잡는다', () => {
  const problems = auditStepSources([{ key: 'RECOVERY_WRITE_FREEZE' }], []);
  assert.ok(problems.some((p) => p.includes('레지스트리에 없다')));
  assert.ok(problems.some((p) => p.includes('임시 키 목록에 없다')));
  // 실제 레지스트리·임시 키와는 어긋나지 않아야 한다.
  assert.deepEqual(auditStepSources(ENV_VARS, TRANSIENT_KEYS), []);
});

test('auditSwitchDiscipline: 느슨한 스위치 판독을 잡고, 자기 원문은 통과한다', () => {
  const loose = auditSwitchDiscipline(`const on = Boolean(env.${REHEARSAL_ACTIVE_ENV});`);
  assert.ok(loose.some((p) => p.includes('isSwitchOn')));
  assert.ok(loose.some((p) => p.includes('Boolean()')));
  assert.ok(auditSwitchDiscipline(`isSwitchOn(env, k); const y = env.X !== 'false';`).some((p) => /느슨한 부정 비교/.test(p)));
  assert.deepEqual(auditSwitchDiscipline(read('src', 'lib', 'rehearsalScope.ts')), []);
});

test('auditBuildInfoSource·auditHealthWiring: 근거 키와 배선을 원문으로 고정한다', () => {
  assert.ok(auditBuildInfoSource('').length >= ROLE_ENV_KEYS.length);
  assert.deepEqual(auditBuildInfoSource(read('src', 'lib', 'health.ts')), []);

  // 판정만 하고 버리는 꼴도 잡는다.
  const dropped = auditHealthWiring(`import { rehearsalScopeCheck } from '@/lib/rehearsalScope';\nrehearsalScopeCheck();`);
  assert.ok(dropped.some((p) => p.includes('checks.rehearsalScope')));
  assert.ok(auditHealthWiring('').length >= 3);
});

test('auditRunbookRehearsal: §6 가 한 줄 버전으로 되돌아가면 잡는다', () => {
  assert.deepEqual(auditRunbookRehearsal('## 6. 복구 리허설 기록\n\n아무것도 없다\n'), [
    '§6 머리말에서 「운영 DB가 아닌 복구 브랜치」 전제가 사라졌다',
    `§6 에 선언 키 ${REHEARSAL_ACTIVE_ENV} 가 없다`,
    '§6-1 절이 사라졌다 — 리허설이 운영에 걸리는 경로를 적어 둔 유일한 자리다',
    '§6 에 checks.rehearsalScope 확인 지시가 없다',
    '§6-1 에 운영 배포 선언(production_rehearsal) 판정이 없다',
    ...DESTRUCTIVE_STEPS.map((s) => `§6-1 에 파괴적 단계 ${s.key} 가 없다`),
    ...SCOPE_DRIFTS.map((d) => `§6-1 에 어긋남 방향 ${d.key} 가 없다`),
    '§6 에 리허설 체크리스트가 없다',
  ]);
  assert.deepEqual(auditRunbookRehearsal(''), ['RUNBOOK 에서 §6 절을 찾을 수 없다']);
  assert.equal(runbookSection6('## 5. 배포 롤백\n내용\n'), '');
});

test('auditRunbookRehearsal: 체크리스트에서 **선언을 지우는 항목**이 빠지면 잡는다', () => {
  // 남겨 두면 다음 사건의 degraded 가 「리허설 중」으로 읽힌다 — 그래서 해제 항목까지 고정한다.
  const weakened = read('RUNBOOK.md').replace(
    `\`${REHEARSAL_ACTIVE_ENV}\` 를 지웠다`,
    `\`${REHEARSAL_ACTIVE_ENV}\` 를 그대로 두었다`,
  );
  assert.deepEqual(auditRunbookRehearsal(weakened), ['리허설 체크리스트에 선언을 **지웠다**는 항목이 없다']);
});

/* ──────────────────── 실제 소스·문서 대조 ──────────────────── */

test('[실제 소스] /api/health 가 리허설 범위를 노출한다 ⬅ 스코프 혼동의 유일한 확인 수단', () => {
  const src = read('src', 'app', 'api', 'health', 'route.ts');
  assert.deepEqual(auditHealthWiring(src), []);
  // route.ts 는 HTTP 메서드·설정 외 export 를 두지 않는다(Vercel 빌드 실패 원인).
  const exports = [...src.matchAll(/^export\s+(?:async\s+function|const)\s+([A-Za-z_]\w*)/gm)].map((m) => m[1]);
  assert.deepEqual(exports.sort(), ['GET', 'dynamic']);
});

test('[실제 소스] 판정은 env 해석뿐이다 — DB·next·fs·신규 조회·DDL 0', () => {
  const src = read('src', 'lib', 'rehearsalScope.ts');
  for (const banned of ['@/db', "from './db", 'drizzle-orm', 'next/server', "'node:fs'", 'createElement']) {
    assert.equal(src.includes(banned), false, `순수 모듈이 ${banned} 를 끌어왔다`);
  }
  for (const ddl of ['CREATE TABLE', 'ALTER TABLE', 'insert into', 'update ', 'delete from']) {
    assert.equal(src.toLowerCase().includes(ddl.toLowerCase()), false, `원문에 쓰기/DDL 문구가 있다: ${ddl}`);
  }
});

test('[실제 소스] 선언 키가 레지스트리·임시 키 목록에 등록돼 있다', () => {
  const def = ENV_VARS.find((v) => v.key === REHEARSAL_ACTIVE_ENV);
  assert.ok(def, '선언 키가 레지스트리에 없다 — envRegistry 테스트가 유령 키로 잡는다');
  assert.equal(def!.kind, 'switch');
  // 문자열 상수 경유 접근이라 직접 읽기 스캔에 걸리지 않는다 — 그 한계를 indirectIn 으로 선언한다.
  assert.equal(def!.indirectIn, 'src/lib/rehearsalScope.ts');
  assert.ok(read('src', 'lib', 'rehearsalScope.ts').includes(`'${REHEARSAL_ACTIVE_ENV}'`));
  assert.equal(TRANSIENT_KEYS.includes(REHEARSAL_ACTIVE_ENV), true, '평상시 미설정이 유실로 중복 보고된다');
});

test('[실제 문서] RUNBOOK §6 가 선언·판정·해제를 적고 있다', () => {
  const md = read('RUNBOOK.md');
  assert.deepEqual(auditRunbookRehearsal(md), []);
  const sec = runbookSection6(md);
  // 표를 자동으로 채우지 않는다는 약속은 그대로 둔다(lib/recovery.ts 가 함께 검사한다).
  assert.match(sec, /자동화 에이전트는 이 표를 임의로 채우지 않는다/);
  // §4 에도 선언 키가 적혀 있어야 복구 시 조용히 유실되지 않는다(envRegistry 문서 대조).
  assert.ok(md.includes(`\`${REHEARSAL_ACTIVE_ENV}\``));
});
