import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  parseRehearsalDate,
  addDays,
  normalizeKind,
  normalizeResult,
  parseDurationMin,
  parseRehearsalTable,
  auditRehearsalRows,
  latestRehearsal,
  rehearsalIntervalDays,
  rehearsalFreshness,
  rehearsalFromEnv,
  publicRehearsal,
  recoveryCheck,
  recoveryStatus,
  type RehearsalRecord,
} from '../src/lib/recovery.ts';

const NOW = new Date('2026-09-21T03:00:00Z');

function rec(over: Partial<RehearsalRecord> = {}): RehearsalRecord {
  return {
    date: '2026-09-01',
    kind: 'periodic',
    target: '2026-08-31 23:00 KST',
    durationMin: 45,
    result: 'pass',
    owner: '운영담당',
    note: '',
    ...over,
  };
}

test('parseRehearsalDate rejects bad format and non-existent dates', () => {
  assert.equal(parseRehearsalDate('2026-09-01'), '2026-09-01');
  assert.equal(parseRehearsalDate(' 2026-09-01 '), '2026-09-01');
  assert.equal(parseRehearsalDate('2026-2-3'), null, '한 자리 월·일은 거부');
  assert.equal(parseRehearsalDate('2026-02-30'), null, '비실존 날짜는 거부');
  assert.equal(parseRehearsalDate('2026-13-01'), null);
  assert.equal(parseRehearsalDate('(미실시)'), null);
  assert.equal(parseRehearsalDate(undefined), null);
  assert.equal(parseRehearsalDate(20260901), null);
});

test('addDays crosses month and year boundaries', () => {
  assert.equal(addDays('2026-01-31', 1), '2026-02-01');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(addDays('2026-09-01', 180), '2027-02-28');
});

test('normalizeKind / normalizeResult map Korean and English wording', () => {
  assert.equal(normalizeKind('정기'), 'periodic');
  assert.equal(normalizeKind('사건 대응'), 'incident');
  assert.equal(normalizeKind('장애'), 'incident');
  assert.equal(normalizeKind(''), 'unknown');
  assert.equal(normalizeKind('기타'), 'unknown');

  assert.equal(normalizeResult('정상'), 'pass');
  assert.equal(normalizeResult('전 항목 통과'), 'pass');
  assert.equal(normalizeResult('PASS'), 'pass');
  assert.equal(normalizeResult('부분 통과'), 'partial', '부분은 pass 보다 우선');
  assert.equal(normalizeResult('실패'), 'fail');
  assert.equal(normalizeResult(''), 'unknown');
  assert.equal(normalizeResult('???'), 'unknown');
});

test('parseDurationMin never guesses', () => {
  assert.equal(parseDurationMin('45분'), 45);
  assert.equal(parseDurationMin('1시간 30분'), 90);
  assert.equal(parseDurationMin('2시간'), 120);
  assert.equal(parseDurationMin('90'), 90);
  assert.equal(parseDurationMin('반나절'), null);
  assert.equal(parseDurationMin(''), null);
  assert.equal(parseDurationMin('0분'), null);
});

test('parseRehearsalTable ignores placeholder rows and headers', () => {
  const md = [
    '## 6. 복구 리허설 기록',
    '',
    '| 일자 | 유형 | 복구 대상 시점 | 소요시간 | 검증 결과 | 담당 | 비고 |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    '| (미실시) | | | | | | 최초 리허설 예정 `[확인 필요]` |',
    '',
    '본문 문장',
    '',
    '| 일자 | 유형 | 복구 대상 시점 | 소요시간 | 검증 결과 | 담당 | 비고 |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    '| 2026-09-10 | 정기 | 2026-09-09 22:00 | 1시간 10분 | 정상 | 운영담당 | 스테이징 검증 |',
    '| 2026-08-02 | 사건 | 2026-08-02 04:00 | 40분 | 부분 통과 | 운영담당 | 로그인 확인 누락 |',
  ].join('\n');
  const rows = parseRehearsalTable(md);
  assert.equal(rows.length, 2, 'placeholder 행은 기록이 아니다');
  assert.deepEqual(
    rows.map((r) => r.date),
    ['2026-08-02', '2026-09-10'],
    '일자 오름차순',
  );
  assert.equal(rows[1].durationMin, 70);
  assert.equal(rows[0].result, 'partial');
  assert.equal(rows[0].kind, 'incident');
  assert.equal(parseRehearsalTable('').length, 0);
});

test('RUNBOOK.md rehearsal table stays machine-readable and is not fabricated', () => {
  const md = readFileSync(new URL('../RUNBOOK.md', import.meta.url), 'utf8');
  const rows = parseRehearsalTable(md);
  // 사람이 실제 기록을 채우면 rows 가 늘어난다. 늘어나도 무결성은 깨지지 않아야 한다.
  assert.deepEqual(auditRehearsalRows(rows, NOW), [], `RUNBOOK 리허설 표 무결성 위반: ${JSON.stringify(rows)}`);
  assert.ok(/복구 리허설 기록/.test(md), '6절 제목이 있어야 파서가 의미를 갖는다');
  assert.ok(
    /자동화 에이전트는 이 표를 임의로 채우지 않는다/.test(md),
    '자동화가 표를 채우지 않는다는 규칙 문구를 유지한다',
  );
});

test('auditRehearsalRows flags future dates, unknown results, missing owner', () => {
  const issues = auditRehearsalRows(
    [
      rec({ date: '2027-01-01' }),
      rec({ date: '2026-09-02', result: 'unknown' }),
      rec({ date: '2026-09-03', owner: '' }),
      rec({ date: '2026-09-04' }),
    ],
    NOW,
  );
  const codes = issues.map((i) => i.code);
  assert.ok(codes.includes('FUTURE_DATE'));
  assert.ok(codes.includes('UNKNOWN_RESULT'));
  assert.ok(codes.includes('NO_OWNER'));
  assert.equal(issues.length, 3, '정상 행은 문제로 보고하지 않는다');
});

test('auditRehearsalRows reports bad date and stops on that row', () => {
  const issues = auditRehearsalRows([{ ...rec(), date: '2026-2-3' }], NOW);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].code, 'BAD_DATE');
  assert.equal(issues[0].row, 1);
});

test('latestRehearsal picks newest non-future record', () => {
  const rows = [rec({ date: '2026-09-01' }), rec({ date: '2026-09-20' }), rec({ date: '2027-05-01' })];
  assert.equal(latestRehearsal(rows, NOW)?.date, '2026-09-20');
  assert.equal(latestRehearsal([], NOW), null);
  assert.equal(latestRehearsal([rec({ date: '2027-05-01' })], NOW), null, '미래 기록만 있으면 없는 것');
});

test('rehearsalIntervalDays only trusts a valid configured value', () => {
  assert.equal(rehearsalIntervalDays({}), null, '임의 기본 주기를 만들지 않는다');
  assert.equal(rehearsalIntervalDays({ RECOVERY_REHEARSAL_INTERVAL_DAYS: '180' }), 180);
  assert.equal(rehearsalIntervalDays({ RECOVERY_REHEARSAL_INTERVAL_DAYS: ' 90 ' }), 90);
  assert.equal(rehearsalIntervalDays({ RECOVERY_REHEARSAL_INTERVAL_DAYS: '0' }), null);
  assert.equal(rehearsalIntervalDays({ RECOVERY_REHEARSAL_INTERVAL_DAYS: '99999' }), null);
  assert.equal(rehearsalIntervalDays({ RECOVERY_REHEARSAL_INTERVAL_DAYS: '반년' }), null);
});

test('rehearsalFreshness: missing when there is no record', () => {
  const f = rehearsalFreshness({ rows: [], now: NOW, intervalDays: 180 });
  assert.equal(f.status, 'missing');
  assert.equal(f.lastDate, null);
  assert.equal(f.ageDays, null);
  assert.equal(f.dueDate, null);
  assert.match(f.action, /RUNBOOK/);
});

test('rehearsalFreshness: ok, stale, failing', () => {
  const ok = rehearsalFreshness({ rows: [rec({ date: '2026-09-01' })], now: NOW, intervalDays: 180 });
  assert.equal(ok.status, 'ok');
  assert.equal(ok.ageDays, 20);
  assert.equal(ok.dueDate, '2027-02-28');

  const stale = rehearsalFreshness({ rows: [rec({ date: '2026-01-01' })], now: NOW, intervalDays: 30 });
  assert.equal(stale.status, 'stale');
  assert.equal(stale.dueDate, '2026-01-31');
  assert.match(stale.action, /기한/);

  const failing = rehearsalFreshness({ rows: [rec({ date: '2026-09-20', result: 'fail' })], now: NOW, intervalDays: 180 });
  assert.equal(failing.status, 'failing', '기한 내여도 실패면 ok 가 아니다');

  const partial = rehearsalFreshness({ rows: [rec({ date: '2026-09-20', result: 'partial' })], now: NOW, intervalDays: 180 });
  assert.equal(partial.status, 'failing');
});

test('rehearsalFreshness without interval never reports stale', () => {
  const f = rehearsalFreshness({ rows: [rec({ date: '2020-01-01' })], now: NOW, intervalDays: null });
  assert.equal(f.status, 'ok', '주기 미설정이면 기한 판정을 보류한다');
  assert.equal(f.dueDate, null);
  assert.match(f.action, /RECOVERY_REHEARSAL_INTERVAL_DAYS/);
});

test('rehearsalFromEnv treats unset snapshot as no record and carries no PII', () => {
  assert.equal(rehearsalFromEnv({}).length, 0);
  assert.equal(rehearsalFromEnv({ RECOVERY_LAST_REHEARSAL: 'yesterday' }).length, 0);
  const rows = rehearsalFromEnv({
    RECOVERY_LAST_REHEARSAL: '2026-09-15',
    RECOVERY_LAST_REHEARSAL_RESULT: '정상',
    RECOVERY_LAST_REHEARSAL_KIND: '정기',
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].result, 'pass');
  assert.equal(rows[0].kind, 'periodic');
  assert.equal(rows[0].owner, '', 'env 스냅샷에는 담당자(PII)를 담지 않는다');
  assert.equal(rows[0].note, '');
});

test('recoveryCheck is never required and degrades instead of failing the service', () => {
  const none = recoveryCheck({ env: {}, now: NOW });
  assert.equal(none.required, false, '리허설 미실시로 health 를 down 시키지 않는다');
  assert.equal(none.ok, false);
  const detail = none.detail.rehearsal as { status: string };
  assert.equal(detail.status, 'missing');

  const good = recoveryCheck({
    env: {
      RECOVERY_LAST_REHEARSAL: '2026-09-15',
      RECOVERY_LAST_REHEARSAL_RESULT: '정상',
      RECOVERY_REHEARSAL_INTERVAL_DAYS: '180',
    },
    now: NOW,
  });
  assert.equal(good.ok, true);
  assert.equal((good.detail.rehearsal as { dueDate: string }).dueDate, '2027-03-14');
});

test('publicRehearsal exposes no free-form or personal fields', () => {
  const f = rehearsalFreshness({ rows: [rec({ owner: '홍길동', note: '내부 메모' })], now: NOW, intervalDays: 180 });
  const pub = publicRehearsal(f);
  const json = JSON.stringify(pub);
  assert.ok(!json.includes('홍길동'));
  assert.ok(!json.includes('내부 메모'));
  assert.deepEqual(Object.keys(pub).sort(), [
    'action',
    'ageDays',
    'dueDate',
    'intervalDays',
    'lastDate',
    'lastResult',
    'status',
  ]);
});

test('recoveryStatus reports wiring without inventing values', () => {
  const off = recoveryStatus({});
  assert.equal(off.intervalConfigured, false);
  assert.equal(off.intervalDays, null);
  assert.equal(off.snapshotConfigured, false);
  const on = recoveryStatus({ RECOVERY_REHEARSAL_INTERVAL_DAYS: '90', RECOVERY_LAST_REHEARSAL: '2026-09-15' });
  assert.equal(on.intervalConfigured, true);
  assert.equal(on.intervalDays, 90);
  assert.equal(on.snapshotConfigured, true);
});

test('recovery module contains no hardcoded RTO/RPO style figures', () => {
  const src = readFileSync(new URL('../src/lib/recovery.ts', import.meta.url), 'utf8');
  const body = src
    .split(/\r?\n/)
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join('\n');
  assert.ok(!/\b(RTO|RPO)\s*[:=]/i.test(body), 'RTO/RPO 수치를 코드에 박지 않는다');
  assert.ok(!/intervalDays\s*[=:]\s*\d+/.test(body), '주기 기본값 리터럴 금지(설정값만 인정)');
});
