/**
 * envPresence.test.ts — RUNBOOK §4(환경변수·시크릿 복구)가 **실제로 됐는지** 보는 장치. 2026-10-15
 *
 * ── 왜 필요한가 ──────────────────────────────────────────────────────────────
 * §4 머리말은 「빠진 키는 오류를 내지 않고 조용히 기본값으로 되돌아간다」고 스스로 경고하는데,
 * 목록의 정본인 `lib/envRegistry.ts` 는 설계상 `process.env` 를 보지 않는다 — 정본과 돌고 있는
 * 배포의 env 가 한 번도 대조되지 않았다. 복구일 §4-10 에서 기계적으로 확인되는 것은
 * `DATABASE_URL` 하나뿐이고, `LEGAL_DOCS_FINAL` 만 돌아온 상태는 fail-safe 로 draft 가 되어
 * 화면이 「아직 확정 전」과 구분되지 않는다.
 *
 * 그래서 (a) 판정 자체(값을 담지 않는다·임의 기준 금지·판정 순서)와 (b) 배선(health 응답·
 * env 레지스트리·RUNBOOK §2·§4 문장·규칙의 근거 모듈)을 파일 수준에서 고정한다.
 * 이 테스트는 **파일만 읽는다** — 네트워크·DB 를 쓰지 않고 `process.env` 도 바꾸지 않는다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  ACTION_RESTORE_INVALID,
  ACTION_RESTORE_NO_BASELINE,
  ACTION_RESTORE_UNDATED,
  COHERENCE_RULES,
  ENV_BASELINE_ENV,
  PRESENCE_LIMITS,
  RESTORE_VERDICTS,
  TRANSIENT_KEYS,
  assessCoherence,
  assessEnvRestore,
  auditHealthWiring,
  auditRuleShape,
  auditRuleSources,
  auditRunbookPresence,
  blankKeys,
  envBaselineFromEnv,
  envPresenceCheck,
  envPresenceStatus,
  ineffectiveSwitches,
  isSwitchOn,
  parseEnvBaseline,
  presenceByGroup,
  presenceLogLine,
  presenceOf,
  presenceRows,
  presenceText,
  snapshotKeys,
  snapshotLine,
} from '../src/lib/envPresence.ts';
import { ENV_VARS, parseDocumentedKeys, restorableVars, runbookSection4 } from '../src/lib/envRegistry.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (...p: string[]) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

const NOW = new Date('2026-10-15T00:00:00Z');

/** 값이 섞여 나가는지 보려고 **일부러 알아볼 수 있는 값**을 넣는다 */
const SECRET = 'postgres://u:p@ep-secret-1234.ap-southeast-1.aws.neon.tech/db';
const BASE_ENV: Record<string, string | undefined> = {
  DATABASE_URL: SECRET,
  SESSION_COOKIE: 'pms_session',
  SENTRY_DSN: 'https://abc@o1.ingest.sentry.io/42',
};

test('존재 상태: 공백뿐인 키를 「있다」로 세지 않는다 — 대시보드에는 있다로 보인다', () => {
  assert.equal(presenceOf({ A_B: 'x' }, 'A_B'), 'set');
  assert.equal(presenceOf({ A_B: '   ' }, 'A_B'), 'blank');
  assert.equal(presenceOf({ A_B: '' }, 'A_B'), 'blank');
  assert.equal(presenceOf({}, 'A_B'), 'absent');
  assert.equal(presenceOf({}, undefined), 'absent');

  const rows = presenceRows({ ...BASE_ENV, PRIVACY_PROCESSORS: ' ' });
  assert.equal(rows.length, restorableVars().length, '플랫폼 키가 섞였거나 빠졌다');
  assert.deepEqual(blankKeys(rows), ['PRIVACY_PROCESSORS']);
  const legal = presenceByGroup(rows).find((g) => g.group === '법적 문서');
  assert.ok(legal && legal.total > 0 && legal.set === 0, '공백 키를 set 으로 셌다');
});

test('스위치 판독은 실제 읽는 쪽과 글자 그대로 같다 — 공백·1·yes 는 OFF', () => {
  assert.equal(isSwitchOn({ S_W: 'true' }, 'S_W'), true);
  for (const bad of ['TRUE', ' true', 'true ', '1', 'yes', 'on', '', undefined]) {
    assert.equal(isSwitchOn({ S_W: bad }, 'S_W'), false, `ON 으로 읽었다: ${String(bad)}`);
  }
});

test('모듈 원문: 순수(DB·fs·next 미접근)하고 임의 기준 목록을 두지 않는다', () => {
  const src = read('src', 'lib', 'envPresence.ts');
  for (const f of ['drizzle', 'node:fs', 'next/server', '@/db']) {
    assert.equal(src.includes(f), false, `순수 모듈이 ${f} 를 끌어들였다`);
  }
  // 「이 키는 있어야 한다」를 코드가 지어내지 않는다 — 기준은 스냅샷뿐이다.
  assert.equal(/REQUIRED_KEYS|MUST_BE_SET|EXPECTED_KEYS/.test(src), false, '임의 필수 키 목록을 두었다');
  // 느슨한 스위치 판독 금지(=== 'true' 비교만).
  assert.equal(/!==\s*'false'/.test(src), false, '느슨한 스위치 판독이 들어 있다');
  assert.equal(/Boolean\(env\[/.test(src), false, '느슨한 스위치 판독이 들어 있다');
  assert.equal(src.includes("=== 'true'"), true);
});

test('묶음 정합성: OFF 는 판정 대상이 아니고, 켜졌는데 선행 값이 없으면 ineffective', () => {
  const off = assessCoherence(BASE_ENV);
  assert.equal(off.length, COHERENCE_RULES.length);
  assert.equal(off.every((r) => r.state === 'inactive'), true, 'OFF 스위치를 판정했다');
  assert.deepEqual(ineffectiveSwitches(off), []);

  // 확정 스위치만 돌아온 상태 = fail-safe 로 draft 유지. 화면으로는 「아직 확정 전」과 같다.
  const partial = assessCoherence({ ...BASE_ENV, LEGAL_DOCS_FINAL: 'true', LEGAL_TERMS_VERSION: '1.0' });
  const legal = partial.find((r) => r.when === 'LEGAL_DOCS_FINAL');
  assert.ok(legal);
  assert.equal(legal.state, 'ineffective');
  assert.deepEqual(legal.missing, ['LEGAL_TERMS_EFFECTIVE', 'LEGAL_PRIVACY_VERSION', 'LEGAL_PRIVACY_EFFECTIVE']);
  assert.match(legal.effect, /draft|초안/);

  const full = assessCoherence({
    ...BASE_ENV,
    LEGAL_DOCS_FINAL: 'true',
    LEGAL_TERMS_VERSION: '1.0',
    LEGAL_TERMS_EFFECTIVE: '2026-10-01',
    LEGAL_PRIVACY_VERSION: '1.0',
    LEGAL_PRIVACY_EFFECTIVE: '2026-10-01',
  });
  assert.equal(full.find((r) => r.when === 'LEGAL_DOCS_FINAL')?.state, 'satisfied');
});

test('묶음 정합성: 선행 스위치가 OFF 인 조합도 ineffective(공백 선행 값도 없는 것으로 본다)', () => {
  const rows = assessCoherence({
    ...BASE_ENV,
    BILLING_APPLY_LIVE: 'true', // PAYMENTS_LIVE 가 OFF → 반영되지 않는다
    PARTNER_SETTLEMENT_ENABLED: 'true',
    PARTNER_COMMISSION_RATES: '   ', // 공백뿐 → 전건 rate_unconfigured
    MONITORING_ENABLED: 'true', // SENTRY_DSN 은 있다
  });
  assert.deepEqual(ineffectiveSwitches(rows).sort(), ['BILLING_APPLY_LIVE', 'PARTNER_SETTLEMENT_ENABLED']);
  assert.deepEqual(rows.find((r) => r.when === 'BILLING_APPLY_LIVE')?.missing, ['PAYMENTS_LIVE']);
  assert.deepEqual(rows.find((r) => r.when === 'PARTNER_SETTLEMENT_ENABLED')?.missing, ['PARTNER_COMMISSION_RATES']);
  assert.equal(rows.find((r) => r.when === 'MONITORING_ENABLED')?.state, 'satisfied');
});

test('기준 스냅샷 해석: 두 형식 + 값이 섞인 입력은 키를 채택하지 않는다', () => {
  assert.equal(parseEnvBaseline('  '), null);
  assert.equal(envBaselineFromEnv({}), null);
  assert.equal(envBaselineFromEnv({ RECOVERY_ENV_BASELINE: ' x ' }), 'x');

  const line = parseEnvBaseline('asOf=2026-10-01;keys=SESSION_COOKIE,DATABASE_URL');
  assert.deepEqual(line, {
    asOf: '2026-10-01',
    keys: ['DATABASE_URL', 'SESSION_COOKIE'],
    invalid: [],
    valuesPresent: false,
  });

  const json = parseEnvBaseline('{"asOf":"2026-10-01","keys":["DATABASE_URL","SESSION_COOKIE"]}');
  assert.deepEqual(json?.keys, ['DATABASE_URL', 'SESSION_COOKIE']);
  assert.equal(json?.asOf, '2026-10-01');

  // 비실존 날짜·형식 밖은 지어내지 않는다.
  assert.equal(parseEnvBaseline('asOf=2026-02-30;keys=DATABASE_URL')?.asOf, null);
  assert.ok((parseEnvBaseline('asOf=어제;keys=DATABASE_URL')?.invalid ?? []).length > 0);

  // env 를 그대로 덤프한 입력 — 시크릿이 env 에 한 벌 더 복제되는 것을 막는다.
  const dumped = parseEnvBaseline(`{"DATABASE_URL":"${SECRET}"}`);
  assert.equal(dumped?.valuesPresent, true);
  assert.deepEqual(dumped?.keys, []);
  const inline = parseEnvBaseline(`keys=DATABASE_URL=${SECRET},SESSION_COOKIE`);
  assert.equal(inline?.valuesPresent, true);
  assert.deepEqual(inline?.keys, [], '값이 섞인 스냅샷에서 키를 채택했다');
  assert.equal(JSON.stringify(parseEnvBaseline(`DATABASE_URL=${SECRET}`)).includes('ep-secret'), false);

  // 키 꼴이 아닌 토큰은 조용히 버리지 않고 보고한다.
  assert.deepEqual(parseEnvBaseline('keys=lowercase,DATABASE_URL')?.invalid, ['lowercase']);
});

test('기준 스냅샷 해석: 읽을 수 없는 입력을 「없다」로 덮지 않고 사유를 남긴다', () => {
  // 판독 실패를 null(=미설정)로 돌리면 유실 판정이 조용히 보류된다 — 고칠 대상이 다르다.
  assert.deepEqual(parseEnvBaseline('{not json'), {
    asOf: null,
    keys: [],
    invalid: ['JSON 파싱 실패'],
    valuesPresent: false,
  });
  assert.deepEqual(parseEnvBaseline('{}')?.invalid, ['keys 배열이 없다']);
  assert.equal(parseEnvBaseline('{"keys":["DATABASE_URL",3]}')?.invalid.includes('문자열이 아닌 키'), true);
  assert.deepEqual(parseEnvBaseline('{"keys":["DATABASE_URL"],"asOf":"어제"}')?.asOf, null);

  // `asOf`·`keys` 가 아닌 떠돌이 구간도 보고한다(긴 토큰은 잘라서).
  assert.deepEqual(parseEnvBaseline('keys=DATABASE_URL;뭔가 이상한 줄')?.invalid, ['뭔가 이상한 줄']);
  const long = parseEnvBaseline(`keys=DATABASE_URL;${'x'.repeat(60)}`);
  assert.equal(long?.invalid[0].endsWith('…'), true, '긴 토큰을 그대로 담았다');
  assert.equal(long?.invalid[0].length, 41);
});

test('스냅샷 생성: 값을 담지 않고 임시 키·스냅샷 자신을 제외하며 되읽을 수 있다', () => {
  const env = {
    ...BASE_ENV,
    RECOVERY_WRITE_FREEZE: 'true',
    RECOVERY_WRITE_FREEZE_AT: '2026-10-09T03:05:00+09:00',
    DEPLOY_PINNED_COMMIT: 'abc1234',
    RECOVERY_ENV_BASELINE: 'asOf=2026-10-01;keys=DATABASE_URL',
    PRIVACY_PROCESSORS: '  ',
  };
  const keys = snapshotKeys(env);
  assert.deepEqual(keys, ['DATABASE_URL', 'SENTRY_DSN', 'SESSION_COOKIE']);
  for (const t of [...TRANSIENT_KEYS, ENV_BASELINE_ENV]) {
    assert.equal(keys.includes(t), false, `임시 키를 스냅샷에 넣었다: ${t}`);
  }

  const line = snapshotLine(env, NOW);
  assert.equal(line, 'asOf=2026-10-15;keys=DATABASE_URL,SENTRY_DSN,SESSION_COOKIE');
  assert.equal(line.includes('ep-secret'), false, '스냅샷에 값이 들어갔다');
  assert.equal(line.includes('ingest.sentry.io'), false, '스냅샷에 값이 들어갔다');
  // 왕복: 생성한 줄을 그대로 다시 읽을 수 있어야 한다(§2 가 복사·붙여넣기를 지시한다).
  const back = parseEnvBaseline(line);
  assert.deepEqual(back?.keys, keys);
  assert.equal(back?.asOf, '2026-10-15');
});

test('유실 판정: 기준이 없으면 판정하지 않는다(평상시 상태) — 임의 기준을 만들지 않는다', () => {
  const none = assessEnvRestore({ env: BASE_ENV, now: NOW });
  assert.equal(none.verdict, 'no_baseline');
  assert.equal(none.trusted, false);
  assert.deepEqual(none.missingKeys, []);
  assert.equal(none.action, ACTION_RESTORE_NO_BASELINE);
  assert.equal(RESTORE_VERDICTS.includes(none.verdict), true);

  const bad = assessEnvRestore({ env: BASE_ENV, baseline: `DATABASE_URL=${SECRET}`, now: NOW });
  assert.equal(bad.verdict, 'invalid_baseline');
  assert.equal(bad.action, ACTION_RESTORE_INVALID);
  assert.deepEqual(bad.missingKeys, [], '쓸 수 없는 기준으로 유실을 보고했다');
});

test('유실 판정: 판정 순서 — 유실이 기준치 자격(날짜)보다 먼저다', () => {
  const env = { DATABASE_URL: SECRET, LEGAL_DOCS_FINAL: 'true', PRIVACY_PROCESSORS: '  ' };
  const baseline = 'keys=DATABASE_URL,SESSION_COOKIE,LEGAL_DOCS_FINAL,PRIVACY_PROCESSORS';

  // asOf 가 없어도(= undated 자격) 유실을 덮지 않는다. 고칠 대상이 다르다.
  const r = assessEnvRestore({ env, baseline, now: NOW });
  assert.equal(r.verdict, 'missing');
  assert.deepEqual(r.missingKeys, ['SESSION_COOKIE']);
  assert.deepEqual(r.blankedKeys, ['PRIVACY_PROCESSORS'], '공백뿐인 키를 복구됐다고 셌다');
  assert.equal(r.trusted, false, 'asOf 없는 기준을 「복구 전 상태」로 신뢰했다');
  assert.match(r.action ?? '', /SESSION_COOKIE/);

  // 키가 다 있으면서 날짜가 없는 경우만 undated 다.
  const undated = assessEnvRestore({ env, baseline: 'keys=DATABASE_URL,LEGAL_DOCS_FINAL', now: NOW });
  assert.equal(undated.verdict, 'undated');
  assert.equal(undated.action, ACTION_RESTORE_UNDATED);

  // 미래 날짜는 「최근 기준」으로 세지 않는다(undated 와 같은 자격 없음 처리).
  const future = assessEnvRestore({
    env,
    baseline: 'asOf=2026-12-01;keys=DATABASE_URL,LEGAL_DOCS_FINAL',
    now: NOW,
  });
  assert.equal(future.verdict, 'undated');
  assert.equal(future.trusted, false);
});

test('유실 판정: 추가된 키·레지스트리 밖 키를 「유실」로 단정하지 않는다', () => {
  const env = { ...BASE_ENV, SITE_URL: 'https://example.test', RECOVERY_WRITE_FREEZE: 'true' };
  const r = assessEnvRestore({
    env,
    baseline: 'asOf=2026-10-01;keys=DATABASE_URL,SESSION_COOKIE,SENTRY_DSN,OLD_GONE_KEY',
    now: NOW,
  });
  assert.equal(r.verdict, 'ok', `유실로 보고했다: ${r.missingKeys.join(',')}`);
  assert.deepEqual(r.unknownKeys, ['OLD_GONE_KEY'], '코드에서 사라진 키를 유실로 단정했다');
  assert.deepEqual(r.addedKeys, ['SITE_URL'], '스냅샷 뒤 추가된 키를 집계하지 않았다');
  assert.equal(r.addedKeys.includes('RECOVERY_WRITE_FREEZE'), false, '임시 키를 추가로 보고했다');
  assert.equal(r.ageDays, 14);
  assert.equal(r.trusted, true);
  // 사건 중 켜 둔 임시 키가 기준에 있어도 평상시에 유실로 보고하지 않는다.
  const transient = assessEnvRestore({
    env: BASE_ENV,
    baseline: 'asOf=2026-10-01;keys=DATABASE_URL,SESSION_COOKIE,SENTRY_DSN,RECOVERY_WRITE_FREEZE',
    now: NOW,
  });
  assert.equal(transient.verdict, 'ok', '임시 키를 유실로 보고했다');
});

test('출력·health 체크: 값이 한 글자도 나가지 않고 required: false 다', () => {
  const env = {
    ...BASE_ENV,
    LEGAL_DOCS_FINAL: 'true',
    PORTONE_API_SECRET: 'live-secret-9999',
    RECOVERY_ENV_BASELINE: 'asOf=2026-10-01;keys=DATABASE_URL,SESSION_COOKIE,SENTRY_DSN,PRIVACY_PROCESSORS',
  };
  const check = envPresenceCheck({ env, now: NOW });
  assert.equal(check.required, false);
  assert.equal(check.ok, false, '유실·무효 스위치가 있는데 ok 를 냈다');
  assert.equal(check.detail.verdict, 'missing');
  assert.deepEqual(check.detail.ineffective, ['LEGAL_DOCS_FINAL']);
  assert.equal(String(check.detail.snapshot).includes('PORTONE_API_SECRET'), true, '스냅샷에 키 이름은 들어간다');

  const dump = JSON.stringify(check);
  for (const value of ['ep-secret', 'ingest.sentry.io', 'live-secret-9999', 'pms_session', SECRET]) {
    assert.equal(dump.includes(value), false, `공개 응답에 설정값이 나갔다: ${value}`);
  }
  assert.deepEqual(check.detail.limits, PRESENCE_LIMITS);

  // 기준 미설정은 평상시 상태 — degraded 로 만들지 않는다(§3-4 의 unset 과 같은 규율).
  const plain = envPresenceCheck({ env: BASE_ENV, now: NOW });
  assert.equal(plain.ok, true);
  assert.equal(plain.detail.verdict, 'no_baseline');

  const restore = assessEnvRestore({ env, baseline: envBaselineFromEnv(env), now: NOW });
  const coherence = assessCoherence(env);
  for (const text of [presenceText(restore, coherence), presenceLogLine(restore, coherence)]) {
    assert.equal(text.includes('ep-secret'), false);
    assert.equal(text.includes('live-secret-9999'), false);
    assert.match(text, /missing/);
  }
  assert.match(presenceLogLine(restore, coherence), /^\[env-presence\] /);

  const status = envPresenceStatus(BASE_ENV);
  assert.equal(status.baselineConfigured, false);
  assert.equal(status.rules, COHERENCE_RULES.length);
  assert.equal(status.trackedKeys, restorableVars().length);
  assert.match(status.note, /미설정/);
});

test('규칙 정본: 레지스트리에 있는 키만 쓰고 선행 조건·영향 설명이 비어 있지 않다', () => {
  assert.deepEqual(auditRuleShape(), []);
  const known = new Set(ENV_VARS.map((v) => v.key));
  assert.equal(known.has(ENV_BASELINE_ENV), true, '새 키가 레지스트리에 없다 — 복구 목록에서 빠진다');
  // 묶음 정합성 규칙이 조용히 사라지지 않게 최소 개수를 고정한다.
  assert.ok(COHERENCE_RULES.length >= 8, `규칙이 줄었다: ${COHERENCE_RULES.length}`);
});

test('[실제 소스] 규칙의 근거 모듈이 그 키를 여전히 읽는다', () => {
  const files = [...new Set(COHERENCE_RULES.flatMap((r) => r.ownerFiles))];
  const sources: Record<string, string> = {};
  for (const f of files) sources[f] = read(...f.split('/'));
  assert.deepEqual(auditRuleSources(sources), []);
  // 근거가 사라지면(키를 더 이상 읽지 않으면) CI 가 실패해야 한다.
  const broken = { ...sources, 'src/lib/legal.ts': sources['src/lib/legal.ts'].replaceAll('LEGAL_DOCS_FINAL', 'X') };
  assert.ok(auditRuleSources(broken).length > 0, '정본이 조용히 낡는 경우를 잡지 못한다');
  assert.ok(auditRuleSources({}).length > 0);
});

test('[실제 라우트] /api/health 가 판정을 응답에 실어 보낸다', () => {
  const src = read('src', 'app', 'api', 'health', 'route.ts');
  assert.deepEqual(auditHealthWiring(src), []);
  assert.ok(auditHealthWiring(src.replace(/checks\.envPresence\s*=\s*/, 'const unused = ')).length > 0);
  assert.ok(auditHealthWiring(src.replace(/envPresenceCheck\(/g, 'noop(')).length > 0);
  assert.ok(auditHealthWiring('').length > 0);
  // route.ts 는 HTTP 메서드·설정 외 export 금지(Vercel 빌드 실패 원인).
  const exports = [...src.matchAll(/^export\s+(?:async\s+function|const|function)\s+(\w+)/gm)].map((m) => m[1]);
  assert.deepEqual(exports.sort(), ['GET', 'dynamic']);
});

test('[실제 문서] RUNBOOK §4-10 이 눈 확인으로 되돌아가지 않는다', () => {
  const md = read('RUNBOOK.md');
  assert.deepEqual(auditRunbookPresence(md), []);
  assert.ok(auditRunbookPresence(md.replace(/#### 4-12\./, '#### 4-99.')).length > 0);
  assert.ok(auditRunbookPresence(md.replaceAll(ENV_BASELINE_ENV, 'X_Y')).length > 0);
  assert.ok(auditRunbookPresence('').length > 0);

  // §4 가 새 키를 적어 두는지 — 적히지 않으면 복구 시 조용히 유실되는 설정이 된다.
  const documented = parseDocumentedKeys(runbookSection4(md));
  assert.equal(documented.includes(ENV_BASELINE_ENV), true);
  // 묶음 정합성 표가 조합을 실제로 적어 두는지(담당자가 응답만 보고 뜻을 모르면 쓸모가 없다).
  for (const rule of COHERENCE_RULES) {
    assert.equal(md.includes(rule.when), true, `§4-12 표에 ${rule.when} 가 없다`);
  }
  // 리허설 체크리스트에 설정 복구 확인 항목이 남아 있다.
  assert.match(md, /checks\.envPresence\.detail\.verdict/);
});
