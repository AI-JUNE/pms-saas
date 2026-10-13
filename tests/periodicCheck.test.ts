/**
 * periodicCheck.test.ts — RUNBOOK §2 정기 점검의 이행 추적과 날짜 없는 설정값의 신선도. 2026-10-13
 *
 * ── 왜 필요한가 ──────────────────────────────────────────────────────────────
 * §3 1~8단계·§5 를 모두 기계화한 뒤 보면, 그 판정들이 대조하는 기준값은 전부 §2 월 점검
 * 한 곳에서만 공급되는데 §2 자체에는 아무 장치가 없었다. 공급되는 값 중 자기 날짜를 품는
 * 것은 `RECOVERY_DATA_BASELINE` 하나뿐이고, `RECOVERY_PITR_RETENTION_HOURS`·
 * `RECOVERY_EXPECTED_DB` 는 한 번 넣으면 영구히 신뢰된다 — 플랜을 내린 뒤 점검이 밀리면
 * §3-6 이 **창 밖 시점에 `ok`** 를 내고, 담당자는 쓰기 차단(503)을 건 뒤 3단계에서야
 * 복구 불가를 안다.
 *
 * 그래서 (a) 판정 자체(모름 ≠ 낡음, 미설정 ≠ 낡음, 임의 주기 금지)와 (b) 배선(health 응답·
 * env 레지스트리·RUNBOOK §2 문장)을 파일 수준에서 고정한다. 이 테스트는 **파일만 읽는다** —
 * 네트워크·DB 를 쓰지 않고 `process.env` 도 바꾸지 않는다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  ACTION_CHECK_ABSENT,
  ACTION_CHECK_FUTURE,
  ACTION_CHECK_INVALID,
  ACTION_CHECK_NO_INTERVAL,
  CHECK_INTERVAL_ENV,
  CHECK_VERDICTS,
  LAST_CHECK_ENV,
  MONTHLY_STEPS,
  PERIODIC_LIMITS,
  UNDATED_SETTINGS,
  assessMonthlyCheck,
  assessSettingFreshness,
  auditHealthWiring,
  auditOwnerSources,
  auditRunbookPeriodic,
  checkIntervalDays,
  lastCheckFromEnv,
  periodicCheckHealth,
  periodicCheckLine,
  periodicCheckStatus,
  periodicCheckText,
  untrustedSettings,
} from '../src/lib/periodicCheck.ts';
import { ENV_VARS, parseDocumentedKeys, runbookSection4 } from '../src/lib/envRegistry.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (...p: string[]) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

const NOW = new Date('2026-10-13T00:00:00Z');
const INTERVAL = 35;

test('주기 로더: 설정값만 인정하고 임의 기본 주기를 만들지 않는다', () => {
  assert.equal(checkIntervalDays({}), null, '미설정에 기본 주기를 넣었다');
  assert.equal(checkIntervalDays({ RECOVERY_CHECK_INTERVAL_DAYS: ' 35 ' }), 35);
  for (const bad of ['', '0', '-1', '35일', '3.5', 'thirty', '99999']) {
    assert.equal(checkIntervalDays({ RECOVERY_CHECK_INTERVAL_DAYS: bad }), null, `받아들였다: ${bad}`);
  }
  assert.equal(lastCheckFromEnv({}), null);
  assert.equal(lastCheckFromEnv({ RECOVERY_LAST_CHECK: ' 2026-09-30 ' }), '2026-09-30');
});

test('모듈 원문에 주기 폴백 리터럴이 없다 — 「월 1회」를 코드가 들고 오지 않는다', () => {
  const src = read('src', 'lib', 'periodicCheck.ts');
  // `?? 30` · `|| 31` 꼴의 기본 주기 주입을 금지한다(범위 가드 숫자는 비교 연산자로만 쓴다).
  assert.equal(/(?:\?\?|\|\|)\s*\d/.test(src), false, '수치 폴백이 들어 있다');
  for (const n of ['30', '31', '28']) {
    assert.equal(src.includes(`= ${n}`), false, `기본 주기 리터럴(${n})을 두었다`);
  }
  assert.equal(/process\.env/.test(src), true, 'env 로더는 process.env 기본값을 쓴다');
  // DB·파일시스템·네트워크 미접근.
  for (const f of ['drizzle', 'node:fs', 'next/server']) {
    assert.equal(src.includes(f), false, `순수 모듈이 ${f} 를 끌어들였다`);
  }
});

test('판정 순서: 없음·판독불가·미래를 섞지 않는다(고칠 대상이 다르다)', () => {
  const absent = assessMonthlyCheck({ lastCheck: '  ', now: NOW, intervalDays: INTERVAL });
  assert.equal(absent.verdict, 'absent');
  assert.equal(absent.trusted, false);
  assert.equal(absent.action, ACTION_CHECK_ABSENT);

  const invalid = assessMonthlyCheck({ lastCheck: '2026-02-30', now: NOW, intervalDays: INTERVAL });
  assert.equal(invalid.verdict, 'invalid_date', '비실존 날짜를 받아들였다');
  assert.equal(invalid.lastDate, null, '못 읽은 값을 점검 일자로 담았다');
  assert.equal(invalid.action, ACTION_CHECK_INVALID);
  assert.notEqual(invalid.verdict, absent.verdict, '판독 불가를 「없다」로 덮었다');

  const future = assessMonthlyCheck({ lastCheck: '2026-10-20', now: NOW, intervalDays: INTERVAL });
  assert.equal(future.verdict, 'future');
  assert.equal(future.trusted, false, '미래 일자를 「최근 확인」으로 올렸다');
  assert.equal(future.action, ACTION_CHECK_FUTURE);
  assert.equal(future.ageDays, null, '미래 일자에서 경과일수를 지어냈다');
});

test('기한 판정: 주기 미설정은 「밀렸다」가 아니라 「기한을 모른다」', () => {
  const unjudged = assessMonthlyCheck({ lastCheck: '2025-01-01', now: NOW, intervalDays: null });
  assert.equal(unjudged.verdict, 'unjudged');
  assert.equal(unjudged.dueDate, null);
  assert.equal(unjudged.trusted, true, '기한 미설정이 기존 판정을 끌어내렸다');
  assert.equal(unjudged.action, ACTION_CHECK_NO_INTERVAL);
  assert.ok(unjudged.ageDays !== null && unjudged.ageDays > 0, '경과일수는 주기 없이도 산출된다');

  // 현재 시각을 못 읽으면 나이를 지어내지 않고 판정을 보류한다(기존 판정을 끌어내리지 않는다).
  const noClock = assessMonthlyCheck({ lastCheck: '2026-09-30', now: new Date(NaN), intervalDays: INTERVAL });
  assert.equal(noClock.verdict, 'unjudged');
  assert.equal(noClock.ageDays, null);
  assert.equal(noClock.lastDate, '2026-09-30', '읽은 점검 일자는 그대로 보고한다');
  assert.ok(/시계/.test(String(noClock.action)));

  const ok = assessMonthlyCheck({ lastCheck: '2026-09-30', now: NOW, intervalDays: INTERVAL });
  assert.equal(ok.verdict, 'ok');
  assert.equal(ok.ageDays, 13);
  assert.equal(ok.dueDate, '2026-11-04');
  assert.equal(ok.trusted, true);

  const overdue = assessMonthlyCheck({ lastCheck: '2026-04-01', now: NOW, intervalDays: INTERVAL });
  assert.equal(overdue.verdict, 'overdue');
  assert.equal(overdue.trusted, false);
  assert.equal(overdue.dueDate, '2026-05-06');
  assert.ok(/195일/.test(String(overdue.action)), '경과일수를 조치 문구에 담지 않았다');
  // 기한 경계일 자체는 아직 넘긴 것이 아니다.
  assert.equal(
    assessMonthlyCheck({ lastCheck: '2026-09-08', now: NOW, intervalDays: INTERVAL }).verdict,
    'ok',
    '기한일 당일을 overdue 로 판정했다',
  );
});

test('확인되지 않은 구간을 수치로 적는다 — 그 사이의 플랜 변경이 반영되지 않았다는 사실', () => {
  const overdue = assessMonthlyCheck({ lastCheck: '2026-04-01', now: NOW, intervalDays: INTERVAL });
  assert.ok(overdue.unconfirmedWindow?.includes('2026-04-01'));
  assert.ok(overdue.unconfirmedWindow?.includes('195일'));
  assert.ok(/플랜|보존 설정|엔드포인트/.test(String(overdue.unconfirmedWindow)));
  // 판정 불가 상태에서는 구간을 지어내지 않는다.
  assert.equal(assessMonthlyCheck({ lastCheck: '', now: NOW }).unconfirmedWindow, null);
  assert.equal(CHECK_VERDICTS.length, 6);
});

test('날짜 없는 설정값: 미설정과 낡음을 섞지 않는다', () => {
  const overdue = assessMonthlyCheck({ lastCheck: '2026-04-01', now: NOW, intervalDays: INTERVAL });

  // 값이 없으면 신선도 문제가 아니다 — 각 체크가 이미 미설정을 드러낸다.
  const none = assessSettingFreshness({ check: overdue, env: {} });
  assert.deepEqual(none.map((r) => r.trust), ['not_set', 'not_set']);
  assert.deepEqual(untrustedSettings(none), [], '미설정을 낡음으로 중복 보고했다');

  const env = { RECOVERY_PITR_RETENTION_HOURS: '720', RECOVERY_EXPECTED_DB: 'a1b2c3d4e5f6' };
  const stale = assessSettingFreshness({ check: overdue, env });
  assert.deepEqual(stale.map((r) => r.trust), ['stale', 'stale']);
  assert.deepEqual(untrustedSettings(stale), ['RECOVERY_PITR_RETENTION_HOURS', 'RECOVERY_EXPECTED_DB']);
  assert.equal(stale[0].confirmedAt, '2026-04-01');

  const ok = assessMonthlyCheck({ lastCheck: '2026-09-30', now: NOW, intervalDays: INTERVAL });
  assert.deepEqual(
    assessSettingFreshness({ check: ok, env }).map((r) => r.trust),
    ['confirmed', 'confirmed'],
  );
  // 점검 일자가 없거나 읽히지 않으면 「확인 시점을 모른다」이지 「낡았다」가 아니다.
  const unknown = assessSettingFreshness({ check: assessMonthlyCheck({ lastCheck: '', now: NOW }), env });
  assert.deepEqual(unknown.map((r) => r.trust), ['unconfirmed', 'unconfirmed']);
  assert.equal(unknown[0].confirmedAt, null);
  // 주기 미설정은 낡음 판정을 하지 않는다.
  const noInterval = assessMonthlyCheck({ lastCheck: '2025-01-01', now: NOW, intervalDays: null });
  assert.deepEqual(
    assessSettingFreshness({ check: noInterval, env }).map((r) => r.trust),
    ['unjudged', 'unjudged'],
  );
  // 낡음 여부와 무관하게 「그 판정이 어떻게 틀리는가」를 항상 함께 말한다.
  for (const row of [...stale, ...none]) assert.ok(row.risk.length > 20, `risk 설명이 비었다: ${row.key}`);
});

test('§2 절차 정본: 공급되는 키와 날짜 유무를 적어 둔다', () => {
  assert.equal(MONTHLY_STEPS.length, 7, '§2 단계 수가 문서와 어긋났다');
  assert.deepEqual(
    MONTHLY_STEPS.map((s) => s.step),
    [1, 2, 3, 4, 5, 6, 7],
    '단계 번호가 문서 순서와 어긋났다',
  );
  const supplied = MONTHLY_STEPS.filter((s) => s.supplies);
  // 날짜를 품지 않는 공급 키 = UNDATED_SETTINGS 정본과 정확히 일치해야 한다.
  assert.deepEqual(
    supplied.filter((s) => !s.dated).map((s) => s.supplies),
    UNDATED_SETTINGS.map((s) => s.key),
    '날짜 없는 설정값 정본이 §2 단계 정본과 어긋났다',
  );
  // 자기 날짜를 품는 값은 중복 판정하지 않는다.
  assert.equal(
    UNDATED_SETTINGS.some((s) => s.key === 'RECOVERY_DATA_BASELINE'),
    false,
    'asOf 를 품는 스냅샷을 날짜 없는 설정값으로 중복 판정한다',
  );
  for (const s of MONTHLY_STEPS) assert.ok(s.ifSkipped.length > 20, `${s.step}번: 거르면 생기는 일이 비었다`);
});

test('소유 모듈 대조: 키가 옮겨 가면 정본을 함께 고치도록 실패시킨다', () => {
  const sources: Record<string, string> = {};
  for (const s of UNDATED_SETTINGS) sources[s.ownerFile] = read(...s.ownerFile.split('/'));
  assert.deepEqual(auditOwnerSources(sources), [], '정본이 가리키는 모듈이 그 키를 읽지 않는다');
  // 원문을 받지 못한 경우·키가 사라진 경우를 모두 문제로 본다.
  assert.equal(auditOwnerSources({}).length, UNDATED_SETTINGS.length);
  const broken = { ...sources, [UNDATED_SETTINGS[0].ownerFile]: '// 키를 더 이상 읽지 않는다' };
  assert.equal(auditOwnerSources(broken).length, 1);
});

test('/api/health 체크: 판정만 담고 설정값을 담지 않는다(required: false)', () => {
  const env = {
    RECOVERY_LAST_CHECK: '2026-04-01',
    RECOVERY_CHECK_INTERVAL_DAYS: String(INTERVAL),
    RECOVERY_PITR_RETENTION_HOURS: '720',
    RECOVERY_EXPECTED_DB: 'a1b2c3d4e5f6',
  };
  const c = periodicCheckHealth({ env, now: NOW });
  assert.equal(c.required, false, '점검 지연으로 503 을 만들 수 있다');
  assert.equal(c.ok, false, 'overdue 를 ok 로 보고했다');
  assert.equal(c.detail.verdict, 'overdue');
  assert.deepEqual(c.detail.untrusted, ['RECOVERY_PITR_RETENTION_HOURS', 'RECOVERY_EXPECTED_DB']);
  assert.deepEqual(c.detail.limits, PERIODIC_LIMITS);

  // 공개 엔드포인트 — 설정 **값**이 응답에 섞이지 않아야 한다.
  const body = JSON.stringify(c);
  assert.equal(body.includes('720'), false, '보존 시간 설정값이 응답에 들어갔다');
  assert.equal(body.includes('a1b2c3d4e5f6'), false, '지문 설정값이 응답에 들어갔다');
  assert.ok(body.includes(LAST_CHECK_ENV) && body.includes(CHECK_INTERVAL_ENV), '키 이름은 안내한다');

  // 미설정·주기 미설정은 degraded 를 만들지 않는 것과 만드는 것이 갈린다.
  assert.equal(periodicCheckHealth({ env: {}, now: NOW }).ok, false, 'absent 를 ok 로 보고했다');
  assert.equal(
    periodicCheckHealth({ env: { RECOVERY_LAST_CHECK: '2025-01-01' }, now: NOW }).ok,
    true,
    '주기 미설정(unjudged)으로 degraded 를 만들었다',
  );
});

test('출력: 사람용 요약·로그 한 줄에 판정과 키 이름만 담는다', () => {
  const check = assessMonthlyCheck({ lastCheck: '2026-04-01', now: NOW, intervalDays: INTERVAL });
  const rows = assessSettingFreshness({
    check,
    env: { RECOVERY_PITR_RETENTION_HOURS: '720', RECOVERY_EXPECTED_DB: 'a1b2c3d4e5f6' },
  });
  const text = periodicCheckText(check, rows);
  assert.ok(text.includes('overdue') && text.includes('2026-04-01') && text.includes('195일'));
  assert.equal(text.includes('720'), false, '요약에 설정값이 섞였다');

  const line = periodicCheckLine(check, rows);
  assert.ok(line.startsWith('[periodic-check] '));
  assert.ok(line.includes('verdict=overdue') && line.includes('age_days=195') && line.includes('interval_days=35'));
  assert.ok(line.includes('untrusted=RECOVERY_PITR_RETENTION_HOURS,RECOVERY_EXPECTED_DB'));
  assert.equal(line.includes('720'), false, '로그에 설정값이 섞였다');

  const status = periodicCheckStatus({});
  assert.deepEqual(
    { c: status.intervalConfigured, l: status.lastCheckConfigured, d: status.intervalDays },
    { c: false, l: false, d: null },
  );
  assert.ok(/임의 기본 주기 없음/.test(status.note));
});

test('한계를 숨기지 않는다 — 점검 일자는 「적었다」는 뜻이고 DB 판정이 아니다', () => {
  const joined = PERIODIC_LIMITS.join('\n');
  assert.ok(PERIODIC_LIMITS.length >= 5);
  assert.ok(/적었다/.test(joined), '점검 일자가 주장이라는 사실이 빠졌다');
  assert.ok(/Neon 콘솔/.test(joined), '보존 창의 정본이 콘솔이라는 사실이 빠졌다');
  assert.ok(/switchReady/.test(joined), '기준값 자격과 DB 상태를 구분하는 문장이 빠졌다');
  // 신선도 판정이 복구 전환 게이트를 건드리지 않는다(판정 순서 규율).
  const src = read('src', 'lib', 'periodicCheck.ts');
  assert.equal(/gateSwitchReady|switchReady\s*=/.test(src), false, '점검 신선도로 전환 게이트를 내렸다');
});

test('배선: /api/health 가 판정을 응답에 실어 보낸다', () => {
  const route = read('src', 'app', 'api', 'health', 'route.ts');
  assert.deepEqual(auditHealthWiring(route), []);
  // 판정만 하고 버리는 꼴·import 누락을 각각 잡는다.
  assert.equal(auditHealthWiring('periodicCheckHealth();').length >= 2, true);
  assert.equal(auditHealthWiring('').length, 3);
  // ★ route.ts 는 HTTP 메서드·Next 설정 외 export 금지(Vercel 빌드 실패 원인).
  const exports = [...route.matchAll(/^export\s+(?:async\s+)?(?:function\s+)?(?:const\s+)?(\w+)/gm)].map((m) => m[1]);
  assert.deepEqual(exports.sort(), ['GET', 'dynamic']);
});

test('배선: 신규 env 2건이 레지스트리·RUNBOOK §4 에 등록돼 있다', () => {
  const keys = ENV_VARS.map((v) => v.key);
  for (const k of [LAST_CHECK_ENV, CHECK_INTERVAL_ENV]) {
    assert.ok(keys.includes(k), `${k} 가 env 레지스트리에 없다 — 복구 목록에서 빠진다`);
  }
  const documented = parseDocumentedKeys(runbookSection4(read('RUNBOOK.md')));
  for (const k of [LAST_CHECK_ENV, CHECK_INTERVAL_ENV]) {
    assert.ok(documented.includes(k), `${k} 가 RUNBOOK §4 에 없다 — 복구 시 조용히 유실된다`);
  }
});

test('배선: RUNBOOK §2 가 이행이 추적되는 절차로 남아 있다', () => {
  const md = read('RUNBOOK.md');
  assert.deepEqual(auditRunbookPeriodic(md), []);
  // 「확인한다」 6줄 버전으로 되돌아가면(§2-1·점검 일자 단계 소실) 실패한다.
  assert.ok(auditRunbookPeriodic('## 2. 정기 점검\n1. 확인한다\n## 3. DB 복구 절차\n').length >= 4);
  assert.ok(auditRunbookPeriodic('').length >= 4);
  // §2 가 1·4번 공급 키와 2-1 을 가리키는지(담당자가 신선도 절차에 닿는 경로).
  const sec2 = md.slice(md.search(/^##\s*2\.\s/m), md.search(/^##\s*3\.\s/m));
  assert.ok(sec2.includes('checks.periodicCheck'));
  assert.ok(sec2.includes('쓰기 차단'), '밀린 점검이 어떤 사고로 이어지는지가 §2 에 없다');
});
