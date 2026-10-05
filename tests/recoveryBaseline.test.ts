// 기준 스냅샷 신선도 테스트.
//
// 이 파일이 지키는 것은 하나다 — **기준치를 믿을 수 없으면 ok 가 나오지 않는다.**
//  (1) 낡은 스냅샷(stale) / 날짜 없는 스냅샷(undated) / 미래 일자(future)
//  (2) 핵심 테이블을 덜 덮은 스냅샷 — 덮이지 않은 테이블이 0건이어도 ok 가 아니다
//  (3) 복구일에 응답의 snapshot 을 기준치로 덮어쓰는 사고를 문구로 막는다
// 더해서 실제 라우트 원문·RUNBOOK 을 대조해 배선과 문서가 함께 낡지 않도록 한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  ACTION_BASELINE_ABSENT, ACTION_BASELINE_CLOCK, ACTION_BASELINE_FUTURE,
  ACTION_BASELINE_NO_MAX_AGE, ACTION_BASELINE_UNDATED,
  BASELINE_MAX_AGE_ENV, SNAPSHOT_ADOPT_FORBIDDEN, SNAPSHOT_ADOPT_NORMAL_ONLY,
  actionBaselineStale, assessBaselineAge, baselineAgeLine, baselineAgeStatus,
  baselineMaxAgeDays, snapshotAdoption,
} from '../src/lib/recoveryBaseline.ts';
import {
  CORE_TABLES, baselineStamp, parseCountBaseline,
  recoveryReadinessCheck, recoveryVerification, recoveryVerifyLogLine, verifyRowCounts,
} from '../src/lib/recoveryVerify.ts';
import { verifySchema } from '../src/lib/schemaVerify.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const NOW = new Date('2026-10-05T09:00:00Z');
const ALL = [...CORE_TABLES];
const fill = (n: number, over: Record<string, number> = {}) =>
  ({ ...Object.fromEntries(ALL.map((t) => [t, n])), ...over });
/** 전 테이블을 n 으로 덮는 기준 스냅샷 문자열 */
const fullBaseline = (n: number, asOf?: string) =>
  [...(asOf ? [`asOf=${asOf}`] : []), ...ALL.map((t) => `${t}=${n}`)].join(',');

/* ───────────────────────────── 기한 로더 ───────────────────────────── */

test('baselineMaxAgeDays: 설정값만 인정하고 임의 기본 주기를 만들지 않는다', () => {
  assert.equal(baselineMaxAgeDays({}), null, '미설정이면 null — 「월 1회」를 코드가 들고 오지 않는다');
  assert.equal(baselineMaxAgeDays({ RECOVERY_BASELINE_MAX_AGE_DAYS: '' }), null);
  assert.equal(baselineMaxAgeDays({ RECOVERY_BASELINE_MAX_AGE_DAYS: '  35 ' }), 35);
  assert.equal(baselineMaxAgeDays({ RECOVERY_BASELINE_MAX_AGE_DAYS: '1' }), 1);
  assert.equal(baselineMaxAgeDays({ RECOVERY_BASELINE_MAX_AGE_DAYS: '3650' }), 3650);
  // 범위·형식 밖은 "대충 비슷한 값"으로 바꾸지 않고 판정 보류로 돌린다
  assert.equal(baselineMaxAgeDays({ RECOVERY_BASELINE_MAX_AGE_DAYS: '0' }), null);
  assert.equal(baselineMaxAgeDays({ RECOVERY_BASELINE_MAX_AGE_DAYS: '3651' }), null);
  assert.equal(baselineMaxAgeDays({ RECOVERY_BASELINE_MAX_AGE_DAYS: '30일' }), null);
  assert.equal(baselineMaxAgeDays({ RECOVERY_BASELINE_MAX_AGE_DAYS: '-5' }), null);
  assert.equal(baselineMaxAgeDays({ RECOVERY_BASELINE_MAX_AGE_DAYS: '1.5' }), null);

  const off = baselineAgeStatus({});
  assert.equal(off.maxAgeConfigured, false);
  assert.equal(off.maxAgeDays, null);
  assert.match(off.note, /임의 기본 주기 없음/);
  const on = baselineAgeStatus({ RECOVERY_BASELINE_MAX_AGE_DAYS: '35' });
  assert.equal(on.maxAgeConfigured, true);
  assert.match(on.note, /35일/);
  assert.equal(BASELINE_MAX_AGE_ENV, 'RECOVERY_BASELINE_MAX_AGE_DAYS');
});

/* ───────────────────────────── 신선도 판정 ───────────────────────────── */

test('assessBaselineAge: 스냅샷이 없으면 absent — 비어 있는 스냅샷도 같다', () => {
  for (const stamp of [null, { asOf: '2026-10-01', tables: 0 }, { asOf: '2026-10-01', tables: -3 }]) {
    const a = assessBaselineAge({ stamp, now: NOW, maxAgeDays: 35 });
    assert.equal(a.status, 'absent', JSON.stringify(stamp));
    assert.equal(a.trusted, false);
    assert.equal(a.ageDays, null);
    assert.equal(a.blindWindow, null);
    assert.equal(a.action, ACTION_BASELINE_ABSENT);
  }
});

test('assessBaselineAge: 기준일이 없으면 undated — 수치만으로는 「손상 전」인지 알 수 없다', () => {
  for (const asOf of [null, '', '2026-13-01', '2026-02-30', '26-10-01', 'yesterday']) {
    const a = assessBaselineAge({ stamp: { asOf, tables: 12 }, now: NOW, maxAgeDays: 35 });
    assert.equal(a.status, 'undated', String(asOf));
    assert.equal(a.trusted, false);
    assert.equal(a.asOf, null, '판독하지 못한 날짜를 지어내지 않는다');
  }
  assert.match(ACTION_BASELINE_UNDATED, /asOf=YYYY-MM-DD/);
  assert.match(ACTION_BASELINE_UNDATED, /자기 자신과 비교/, '복구일 금기를 함께 알려야 한다');
});

test('assessBaselineAge: 미래 일자는 future — 오타·시계 오차를 기록으로 쓰지 않는다', () => {
  const a = assessBaselineAge({ stamp: { asOf: '2026-10-06', tables: 12 }, now: NOW, maxAgeDays: 35 });
  assert.equal(a.status, 'future');
  assert.equal(a.trusted, false);
  assert.equal(a.asOf, '2026-10-06');
  assert.equal(a.action, ACTION_BASELINE_FUTURE);
});

test('assessBaselineAge: 기한을 넘기면 stale, 안이면 ok — 경계 하루를 정확히 가린다', () => {
  // asOf + 35일 = 2026-10-05 = 오늘 → 아직 기한 안(> 비교)
  const edge = assessBaselineAge({ stamp: { asOf: '2026-08-31', tables: 12 }, now: NOW, maxAgeDays: 35 });
  assert.equal(edge.status, 'ok');
  assert.equal(edge.trusted, true);
  assert.equal(edge.ageDays, 35);
  assert.equal(edge.dueDate, '2026-10-05');
  assert.match(edge.action!, /다음 스냅샷 갱신 기한: 2026-10-05/);

  const over = assessBaselineAge({ stamp: { asOf: '2026-08-30', tables: 12 }, now: NOW, maxAgeDays: 35 });
  assert.equal(over.status, 'stale');
  assert.equal(over.trusted, false);
  assert.equal(over.ageDays, 36);
  assert.equal(over.dueDate, '2026-10-04');
  assert.equal(over.action, actionBaselineStale('2026-10-04', 36));
  assert.match(over.action!, /자기 자신과 비교/);
  assert.match(over.action!, /36일/);

  // 같은 날 뜬 스냅샷
  const today = assessBaselineAge({ stamp: { asOf: '2026-10-05', tables: 12 }, now: NOW, maxAgeDays: 35 });
  assert.equal(today.ageDays, 0);
  assert.equal(today.status, 'ok');
});

test('assessBaselineAge: 기한 미설정은 unjudged — 「낡았다」로 단정하지도, 끌어내리지도 않는다', () => {
  for (const maxAgeDays of [null, undefined, 0, 4000, 1.5 as number]) {
    const a = assessBaselineAge({ stamp: { asOf: '2020-01-01', tables: 12 }, now: NOW, maxAgeDays });
    assert.equal(a.status, 'unjudged', String(maxAgeDays));
    assert.equal(a.trusted, true, '기한을 모르는 것이 기준치를 무효로 만들지는 않는다');
    assert.equal(a.dueDate, null);
    assert.equal(a.maxAgeDays, null);
    // 그래도 경과 일수와 사각 구간은 사실대로 돌려준다
    assert.ok((a.ageDays ?? 0) > 2000, String(a.ageDays));
  }
  const a = assessBaselineAge({ stamp: { asOf: '2026-09-01', tables: 12 }, now: NOW });
  assert.equal(a.action, ACTION_BASELINE_NO_MAX_AGE);
  assert.match(a.action!, /RECOVERY_BASELINE_MAX_AGE_DAYS/);
});

test('assessBaselineAge: blindWindow 가 RPO 사각 구간을 수치로 말한다', () => {
  const a = assessBaselineAge({ stamp: { asOf: '2026-09-25', tables: 12 }, now: NOW, maxAgeDays: 35 });
  assert.equal(a.ageDays, 10);
  assert.match(a.blindWindow!, /2026-09-25 이후/);
  assert.match(a.blindWindow!, /2026-10-05 현재\(10일\)/);
  assert.match(a.blindWindow!, /RPO/);
});

test('assessBaselineAge: 시계를 읽을 수 없으면 던지지 않고 판정을 보류한다', () => {
  const a = assessBaselineAge({ stamp: { asOf: '2026-09-01', tables: 12 }, now: new Date('그런날 없음'), maxAgeDays: 35 });
  assert.equal(a.status, 'unjudged');
  assert.equal(a.ageDays, null);
  assert.equal(a.action, ACTION_BASELINE_CLOCK);
});

test('baselineAgeLine: 날짜·일수만 남기고 행 수는 담지 않는다', () => {
  const line = baselineAgeLine(assessBaselineAge({
    stamp: { asOf: '2026-08-01', tables: 12 }, now: NOW, maxAgeDays: 35,
  }));
  assert.match(line, /baseline=stale/);
  assert.match(line, /baseline_as_of=2026-08-01/);
  assert.match(line, /baseline_age_days=65/);
  assert.match(line, /baseline_max_age=35/);

  const bare = baselineAgeLine(assessBaselineAge({ stamp: null, now: NOW }));
  assert.equal(bare, 'baseline=absent', '모르는 값을 0 으로 채우지 않는다');
});

/* ───────────────────────────── verifyRowCounts 연동 ───────────────────────────── */

test('[회귀] 낡은 기준 스냅샷은 유실된 DB 를 통과시키지 못한다', () => {
  // 2026-04-01 기준 스냅샷(각 테이블 5건) + 지금은 각 테이블 6건만 남은 DB.
  // 수치는 「기준치 이상」이지만 반년 묵은 기준치라 복원 여부를 말해 주지 못한다.
  const baseline = parseCountBaseline(fullBaseline(5, '2026-04-01'));
  const stale = verifyRowCounts({
    counts: fill(6), present: ALL, baseline, now: NOW, maxAgeDays: 35,
  });
  assert.equal(stale.verdict, 'stale');
  assert.equal(stale.ok, false, '이 한 줄이 운영 DATABASE_URL 교체를 막는다');
  assert.equal(stale.age.status, 'stale');
  assert.match(stale.action!, /갱신 기한/);

  // 기한을 설정하지 않았다면 낡음 판정을 하지 않는다(임의 주기를 만들지 않는 대가)
  const unjudged = verifyRowCounts({ counts: fill(6), present: ALL, baseline, now: NOW });
  assert.equal(unjudged.verdict, 'ok');
  assert.equal(unjudged.age.status, 'unjudged');
  assert.ok((unjudged.age.ageDays ?? 0) > 180, '낡은 것은 사실대로 수치로 드러낸다');

  // 스키마가 멀쩡해도 전환 불가 — switchReady 는 둘 다 ok 일 때만 true
  const v = recoveryVerification(verifySchema({ expected: ['users'], present: ['users'] }), stale);
  assert.equal(v.switchReady, false);
  assert.match(v.action, /갱신 기한/);
});

test('[회귀] 기준일 없는 스냅샷은 ok 로 올라가지 않는다(undated)', () => {
  const v = verifyRowCounts({
    counts: fill(6), present: ALL, baseline: parseCountBaseline(fullBaseline(5)), now: NOW, maxAgeDays: 35,
  });
  assert.equal(v.verdict, 'undated');
  assert.equal(v.ok, false);
  assert.equal(v.age.status, 'undated');

  // 미래 일자도 같은 판정으로 모인다(사유는 action 이 구분해 준다)
  const future = verifyRowCounts({
    counts: fill(6), present: ALL, baseline: parseCountBaseline(fullBaseline(5, '2026-12-01')), now: NOW, maxAgeDays: 35,
  });
  assert.equal(future.verdict, 'undated');
  assert.equal(future.age.status, 'future');
  assert.equal(future.action, ACTION_BASELINE_FUTURE);
});

test('[회귀] 기준 스냅샷이 덜 덮은 테이블은 0건이어도 미판정이다', () => {
  // users 만 기준치가 있고 나머지 11개는 전부 0건 — 예전에는 이것이 ok 였다
  // (empty 는 전건 0일 때만 걸리고, 0건은 미판정에서 빠져 있었다).
  const v = verifyRowCounts({
    counts: fill(0, { users: 5 }), present: ALL,
    baseline: parseCountBaseline('asOf=2026-10-01,users=1'), now: NOW, maxAgeDays: 35,
  });
  assert.equal(v.verdict, 'no_baseline');
  assert.equal(v.ok, false, '11개 테이블이 비어 있는데 전환 가능으로 나오면 안 된다');
  assert.deepEqual(v.uncovered, ALL.filter((t) => t !== 'users').sort(), '어느 테이블이 안 덮였는지 알려준다');
  assert.equal(v.rows.filter((r) => r.state === 'unjudged').length, 11);
  assert.match(v.action!, /uncovered/);

  // 전건을 덮으면 uncovered 가 비고 정상 판정으로 돌아온다
  const full = verifyRowCounts({
    counts: fill(3), present: ALL, baseline: parseCountBaseline(fullBaseline(1, '2026-10-01')),
    now: NOW, maxAgeDays: 35,
  });
  assert.deepEqual(full.uncovered, []);
  assert.equal(full.verdict, 'ok');
  assert.equal(full.age.status, 'ok');
});

test('기준치 문제가 더 심각한 판정을 덮지 않는다', () => {
  // 낡고 날짜 없는 기준치라도, DB 쪽 이상이 있으면 그쪽이 먼저 보고된다
  const old = parseCountBaseline(fullBaseline(5, '2026-01-01'));
  const args = { present: ALL, baseline: old, now: NOW, maxAgeDays: 35 } as const;
  assert.equal(verifyRowCounts({ ...args, counts: fill(0) }).verdict, 'empty');
  assert.equal(verifyRowCounts({ ...args, counts: fill(1) }).verdict, 'short');
  assert.equal(verifyRowCounts({ ...args, counts: null }).verdict, 'unverified');
  assert.equal(
    verifyRowCounts({ ...args, counts: fill(6, { issues: undefined as any }), present: ALL.filter((t) => t !== 'issues') }).verdict,
    'incomplete',
  );
  // 그래도 신선도는 늘 함께 실려 나간다 — 조치할 때 같이 보도록
  assert.equal(verifyRowCounts({ ...args, counts: fill(0) }).age.status, 'stale');
});

/* ───────────────────────────── 스냅샷 채택 안전장치 ───────────────────────────── */

test('snapshotAdoption: 복구일에 기준치를 덮어쓰는 사고를 문구로 막는다', () => {
  for (const bad of ['empty', 'incomplete', 'short', 'unverified']) {
    const a = snapshotAdoption(bad);
    assert.equal(a.adopt, 'forbidden', bad);
    assert.equal(a.note, SNAPSHOT_ADOPT_FORBIDDEN);
  }
  // 엔드포인트는 자기가 월 점검 중인지 복구 중인지 모른다 — 단정하지 않고 조건을 말한다
  for (const other of ['ok', 'no_baseline', 'stale', 'undated', '', null, undefined]) {
    const a = snapshotAdoption(other);
    assert.equal(a.adopt, 'normal_operation_only', String(other));
    assert.equal(a.note, SNAPSHOT_ADOPT_NORMAL_ONLY);
  }
  assert.match(SNAPSHOT_ADOPT_NORMAL_ONLY, /정상 운영 중/);
  assert.match(SNAPSHOT_ADOPT_NORMAL_ONLY, /자기 자신과 비교/);

  // 판정 결과에 그대로 붙어 나간다
  const empty = verifyRowCounts({
    counts: fill(0), present: ALL, baseline: parseCountBaseline(fullBaseline(1, '2026-10-01')),
    now: NOW, maxAgeDays: 35,
  });
  assert.equal(empty.snapshotUse.adopt, 'forbidden');
  assert.ok(empty.snapshot, '수치 자체는 여전히 돌려준다 — 쓰지 말라는 조건만 붙인다');
});

test('recoveryVerifyLogLine: 신선도·미덮임을 로그에 남기고 행 내용은 담지 않는다', () => {
  const line = recoveryVerifyLogLine(recoveryVerification(
    verifySchema({ expected: ['users'], present: ['users'] }),
    verifyRowCounts({
      counts: fill(6), present: ALL, baseline: parseCountBaseline('asOf=2026-01-01,users=1'),
      now: NOW, maxAgeDays: 35,
    }),
  ));
  assert.match(line, /data=no_baseline/);
  assert.match(line, /baseline=stale/);
  assert.match(line, /baseline_age_days=277/);
  assert.match(line, /uncovered=/);
  assert.ok(!/select|password|postgres:/i.test(line), line);
});

/* ───────────────────────────── /api/health 배선 ───────────────────────────── */

test('recoveryReadinessCheck: 스냅샷이 밀린 것을 health 가 드러낸다 — 단 down 은 아니다', () => {
  const env = {
    RECOVERY_REHEARSAL_INTERVAL_DAYS: '180',
    RECOVERY_LAST_REHEARSAL: '2026-09-20',
    RECOVERY_LAST_REHEARSAL_RESULT: '정상',
  };
  // 리허설은 정상인데 스냅샷이 없다 → ok:false(degraded), required 는 끝까지 false
  const noBase = recoveryReadinessCheck({ env, now: NOW });
  assert.equal(noBase.required, false, '복구 점검으로 503 을 만들지 않는다');
  assert.equal(noBase.ok, false);
  assert.equal((noBase.detail.baseline as any).status, 'absent');
  assert.ok(noBase.detail.rehearsal, '리허설 판정도 함께 유지된다');

  const stale = recoveryReadinessCheck({
    env: { ...env, RECOVERY_DATA_BASELINE: fullBaseline(5, '2026-01-01'), RECOVERY_BASELINE_MAX_AGE_DAYS: '35' },
    now: NOW,
  });
  assert.equal(stale.ok, false);
  assert.equal((stale.detail.baseline as any).status, 'stale');
  assert.equal((stale.detail.baseline as any).tables, ALL.length);

  const good = recoveryReadinessCheck({
    env: { ...env, RECOVERY_DATA_BASELINE: fullBaseline(5, '2026-09-28'), RECOVERY_BASELINE_MAX_AGE_DAYS: '35' },
    now: NOW,
  });
  assert.equal(good.ok, true);
  assert.equal((good.detail.baseline as any).status, 'ok');

  // 공개 엔드포인트다 — 행 수는 한 건도 나가지 않는다(기준일·일수·테이블 수뿐)
  const body = JSON.stringify(good.detail);
  assert.ok(!/"counts"/.test(body), body);
  assert.ok(!/\b1234567\b/.test(JSON.stringify(recoveryReadinessCheck({
    env: { ...env, RECOVERY_DATA_BASELINE: 'asOf=2026-09-28,users=1234567' }, now: NOW,
  }).detail)), '스냅샷의 행 수가 공개 응답에 새어 나왔다');
});

test('baselineStamp: 행 수를 넘기지 않고 테이블 수만 넘긴다', () => {
  assert.equal(baselineStamp(null), null);
  const s = baselineStamp(parseCountBaseline('asOf=2026-10-01,users=42,projects=7'));
  assert.deepEqual(s, { asOf: '2026-10-01', tables: 2 });
  assert.ok(!JSON.stringify(s).includes('42'), '행 수가 신선도 판정에 섞여 들어갔다');
});

/* ───────────────────────────── 실제 배선·문서 대조 ───────────────────────────── */

test('[실제 소스] 라우트가 갱신 기한을 넘겨 호출한다 — 안 넘기면 낡음 판정이 조용히 꺼진다', () => {
  const src = read('src/app/api/admin/recovery-verify/route.ts');
  assert.match(src, /baselineMaxAgeDays\(\)/, 'maxAgeDays 배선이 빠지면 stale 판정이 영구히 보류된다');
  assert.match(src, /maxAgeDays:/);
  // 이 배선이 들어와도 읽기 전용·권한·export 규율은 그대로여야 한다
  assert.equal((src.match(/db\.execute\(/g) || []).length, 2, 'db 접근 건수가 바뀌었다');
  assert.ok(!/db\.(insert|update|delete)\b/.test(src), '쓰기 호출이 들어왔다');
  const exports = [...src.matchAll(/^export\s+(?:async\s+)?(?:function\s+(\w+)|const\s+(\w+))/gm)]
    .map((m) => m[1] || m[2]).sort();
  assert.deepEqual(exports, ['GET', 'dynamic'], 'route.ts 는 HTTP 메서드·설정 외 export 금지');
});

test('[실제 소스] /api/health 가 스냅샷 신선도까지 보는 체크를 쓴다', () => {
  const src = read('src/app/api/health/route.ts');
  assert.match(src, /recoveryReadinessCheck\(\)/, '리허설만 보는 체크로 되돌아가면 §2 갱신 누락이 다시 묻힌다');
  assert.ok(!/\brecoveryCheck\(/.test(src), '리허설 단독 체크가 남아 있다');
});

test('[실제 소스] recoveryBaseline 은 DB·행 수에 손대지 않는 순수 모듈이다', () => {
  const src = read('src/lib/recoveryBaseline.ts');
  assert.ok(!/from '\.\/(db|crud|migrate)/.test(src), 'DB 의존이 들어왔다');
  assert.ok(!/\bcount\(/.test(src), '행 수를 세는 코드가 들어왔다');
  assert.ok(!/select |insert |update |delete /i.test(src), 'SQL 이 들어왔다');
  // 임의 주기 리터럴(30·31·365 같은 기본값)을 코드가 들고 있지 않은지
  assert.ok(!/maxAgeDays\s*=\s*\d/.test(src), '기본 주기를 하드코딩했다');
  assert.ok(!/\?\?\s*(30|31|35|90|180|365)\b/.test(src), '기본 주기 대체값을 하드코딩했다');
});

test('[실제 문서] RUNBOOK 이 새 판정과 복구일 금기를 적어 두었다', () => {
  const md = read('RUNBOOK.md');
  assert.match(md, /RECOVERY_BASELINE_MAX_AGE_DAYS/, '§4 에 없는 키는 복구 시 조용히 유실된다');
  for (const token of ['`stale`', '`undated`', 'data.uncovered', 'snapshotUse', 'blindWindow']) {
    assert.ok(md.includes(token), `RUNBOOK 에 ${token} 설명이 없다`);
  }
  // 복구일에 스냅샷을 다시 뜨지 말라는 경고가 §3 4단계와 §3-2 양쪽에 있어야 한다
  assert.ok(md.split('자기 자신과 비교').length - 1 >= 2, '복구일 금기 경고가 한 곳에만 있다');
  assert.match(md, /checks\.recovery\.detail\.baseline/, '월 점검에 health 확인 단계가 없다');
  // 기한 수치를 문서가 확정한 것처럼 적지 않는다(사람이 정할 값)
  assert.match(md, /RECOVERY_BASELINE_MAX_AGE_DAYS[^|]*\[확인 필요\]/s);
});
