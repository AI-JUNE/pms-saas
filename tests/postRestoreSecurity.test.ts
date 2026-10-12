/**
 * postRestoreSecurity.test.ts — 복구가 되돌리는 **보안 상태**의 재적용(RUNBOOK §3 6-1단계·§3-8). 2026-10-12
 *
 * ── 왜 필요한가 ──────────────────────────────────────────────────────────────
 * §3 의 1~8단계는 업무 데이터의 유실만 다룬다. 그런데 시점 복구는 사건 대응 조치까지 되돌린다 —
 * 끊은 세션(`sessions` 행 삭제)·바꾼 비밀번호(`users.password_hash`)·잠근 계정(`is_active`)·
 * 회수한 권한(`memberships`)이 전부 T-ε 상태로 돌아온다. 되돌아온 행은 4단계 대조에서 「기준치
 * 이상」이고 6단계 스키마도 `ok` 라 **어떤 검증도 실패하지 않는다** — 복구는 성공으로 끝나고
 * 사건의 접근 수단이 되살아난 채 7단계에서 문이 열린다.
 *
 * 그래서 (a) 판정 자체(복구 시점을 못 읽으면 **「만료됐다」로 올리지 않는다**)와 (b) 배선(health 응답·
 * RUNBOOK 6-1단계·7단계 선행 조건), 그리고 (c) **실제 폐기·변경 경로의 모양**을 파일 수준에서 고정한다.
 * 이 테스트는 **파일만 읽는다** — 네트워크·DB 를 쓰지 않고 `process.env` 도 바꾸지 않는다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  ACTION_CARRYOVER_EXPIRED,
  ACTION_CARRYOVER_INVALID_RESTORE_POINT,
  ACTION_CARRYOVER_OK,
  CARRYOVER_VERDICTS,
  REAPPLY_STATES,
  REAPPLY_STEPS,
  SECURITY_LIMITS,
  SECURITY_REAPPLIED_ENV,
  SECURITY_REVERTS,
  SESSION_TTL_DAYS,
  SESSION_TTL_SOURCE,
  assessSessionCarryover,
  auditHealthWiring,
  auditRevocationShapes,
  auditRunbookSecurity,
  auditSessionTtl,
  postRestoreSecurityStatus,
  reappliedAtFromEnv,
  reapplyPlanFor,
  reapplyText,
  revertFor,
  revertedTables,
  securityLogLine,
  securityReapplyCheck,
} from '../src/lib/postRestoreSecurity.ts';
import { ENV_VARS } from '../src/lib/envRegistry.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (...p: string[]) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

const NOW = new Date('2026-10-12T14:00:00+09:00');
const RP = '2026-10-12T12:55:00+09:00'; // 복구 시점 T-ε

test('되살아난 세션: 상한은 복구 시점 + 세션 수명이고 「최대」로만 말한다', () => {
  const c = assessSessionCarryover({ restorePoint: RP, now: NOW });
  assert.equal(c.verdict, 'ok');
  assert.equal(c.restorePoint, '2026-10-12T03:55:00.000Z');
  assert.equal(c.ttlDays, SESSION_TTL_DAYS);
  assert.equal(c.latestExpiry, new Date(Date.parse(RP) + SESSION_TTL_DAYS * 86_400_000).toISOString());
  assert.equal(c.expired, false);
  assert.ok((c.remainingHours ?? 0) > 0);
  assert.equal(c.action, ACTION_CARRYOVER_OK);
  assert.match(c.notice, /최대/);
  // 상한이라는 사실·쿠키가 정본이 아니라는 사실·세션만의 문제가 아니라는 사실을 함께 낸다.
  assert.equal(c.caveats.length, 3);
});

test('복구 시점을 못 읽으면 추정하지 않는다 — 「만료됐다」로 올리지 않는다', () => {
  for (const bad of ['', '어제', '2026-02-30T00:00:00+09:00', null, undefined, 12345]) {
    const c = assessSessionCarryover({ restorePoint: bad, now: NOW });
    assert.equal(c.verdict, 'invalid_restore_point');
    assert.equal(c.latestExpiry, null);
    assert.equal(c.remainingHours, null);
    assert.equal(c.expired, false, '못 읽는 값을 「만료」로 올리면 폐기 단계를 건너뛰게 된다');
    assert.equal(c.action, ACTION_CARRYOVER_INVALID_RESTORE_POINT);
  }
});

test('세션 수명을 모르면 unknown_ttl — 임의 수명을 지어내지 않는다', () => {
  for (const bad of [0, -1, 'abc', NaN, 100000]) {
    const c = assessSessionCarryover({ restorePoint: RP, ttlDays: bad, now: NOW });
    assert.equal(c.verdict, 'unknown_ttl');
    assert.equal(c.ttlDays, null);
    assert.equal(c.latestExpiry, null);
  }
  assert.deepEqual([...CARRYOVER_VERDICTS].sort(), ['invalid_restore_point', 'ok', 'unknown_ttl']);
});

test('상한이 지났어도 세션 외의 되돌아감은 그대로라고 말한다', () => {
  const later = new Date(Date.parse(RP) + (SESSION_TTL_DAYS + 1) * 86_400_000);
  const c = assessSessionCarryover({ restorePoint: RP, now: later });
  assert.equal(c.verdict, 'ok');
  assert.equal(c.expired, true);
  assert.equal(c.remainingHours, 0, '음수 시간을 내보내지 않는다');
  assert.equal(c.action, ACTION_CARRYOVER_EXPIRED);
  assert.match(c.notice, /비밀번호|권한/);
});

test('되돌아가는 보안 상태 목록: 다섯 가지를 전부 설명과 함께 들고 있다', () => {
  const keys = SECURITY_REVERTS.map((r) => r.key);
  assert.deepEqual(keys, [
    'session_revocation',
    'password_change',
    'reset_token_use',
    'account_deactivation',
    'role_change',
  ]);
  for (const r of SECURITY_REVERTS) {
    assert.ok(r.table, `${r.key}: 테이블이 없다`);
    assert.ok(r.undone.length > 5 && r.effect.length > 20, `${r.key}: 설명이 비었다`);
    assert.ok(r.reapply.length > 10, `${r.key}: 재적용 방법이 없다`);
    assert.ok(r.silent.length > 10, `${r.key}: 왜 검증에 안 걸리는지가 없다`);
  }
  assert.equal(revertFor('session_revocation')?.table, 'sessions');
  assert.equal(revertFor('없는키'), null, '모르는 키를 지어내지 않는다');
  assert.deepEqual(revertedTables(), ['memberships', 'password_reset_tokens', 'sessions', 'users']);
});

test('재적용 절차: 기록(5)이 마지막이고 세션 폐기(1)가 처음이다', () => {
  assert.equal(REAPPLY_STEPS.length, 5);
  assert.deepEqual(REAPPLY_STEPS.map((s) => s.n), [1, 2, 3, 4, 5]);
  assert.match(REAPPLY_STEPS[0].what, /세션/);
  assert.match(REAPPLY_STEPS[4].what, new RegExp(SECURITY_REAPPLIED_ENV));
  assert.match(REAPPLY_STEPS[4].what, /7단계/, '기록 뒤에 해제라는 순서를 절차가 말해야 한다');
  for (const s of REAPPLY_STEPS) assert.ok(s.why.length > 10 && s.evidence.length > 5);
});

test('산출 결과는 사각지대를 함께 낸다 — 「되돌아온 것만 다룬다」가 들어 있다', () => {
  const plan = reapplyPlanFor({ restorePoint: RP, now: NOW });
  assert.equal(plan.limits, SECURITY_LIMITS);
  assert.ok(SECURITY_LIMITS.length >= 6);
  assert.ok(SECURITY_LIMITS.some((l) => /사라지지 않고 그대로 남는다/.test(l)), '복구로 사라지지 않는 쪽을 말해야 한다');
  assert.ok(SECURITY_LIMITS.some((l) => /토큰만/.test(l)), '전원 재로그인의 한계를 말해야 한다');
  assert.ok(plan.exemptPaths.includes('/api/auth/logout'), '차단 중에도 열린 경로를 함께 낸다');
  const text = reapplyText(plan);
  assert.match(text, /\[ok\]/);
  assert.match(text, /sessions/);
  assert.match(text, /password_hash/);
  const log = securityLogLine(plan);
  assert.match(log, /^\[postRestoreSecurity\] carryover=ok /);
  assert.ok(!/@|비밀번호가|token=/.test(log), '로그에 계정·토큰 정보를 담지 않는다');
});

test('env 로더: 못 읽는 값을 「기록됨」으로 올리지 않는다', () => {
  assert.deepEqual(reappliedAtFromEnv({}), { raw: null, at: null });
  assert.deepEqual(reappliedAtFromEnv({ RECOVERY_SECURITY_REAPPLIED_AT: '   ' }), { raw: null, at: null });
  const bad = reappliedAtFromEnv({ RECOVERY_SECURITY_REAPPLIED_AT: '어제 밤' });
  assert.equal(bad.at, null);
  assert.equal(bad.raw, '어제 밤');
  const good = reappliedAtFromEnv({ RECOVERY_SECURITY_REAPPLIED_AT: RP });
  assert.equal(good.at, '2026-10-12T03:55:00.000Z');
});

test('health 체크: 차단 중 미기록이 pending, 해제 후 잔존이 stale_record', () => {
  const normal = securityReapplyCheck({ env: {} });
  assert.equal(normal.detail.state, 'normal');
  assert.equal(normal.ok, true);
  assert.equal(normal.required, false);

  const pending = securityReapplyCheck({ env: { RECOVERY_WRITE_FREEZE: 'true' } });
  assert.equal(pending.detail.state, 'pending');
  assert.equal(pending.ok, false, '해제 전에 알려 주는 것이 이 체크의 쓸모다');

  const recorded = securityReapplyCheck({
    env: { RECOVERY_WRITE_FREEZE: 'true', RECOVERY_SECURITY_REAPPLIED_AT: RP },
  });
  assert.equal(recorded.detail.state, 'recorded');
  assert.equal(recorded.ok, true);

  const stale = securityReapplyCheck({ env: { RECOVERY_SECURITY_REAPPLIED_AT: RP } });
  assert.equal(stale.detail.state, 'stale_record');
  assert.equal(stale.ok, false);

  const invalid = securityReapplyCheck({ env: { RECOVERY_SECURITY_REAPPLIED_AT: '어제' } });
  assert.equal(invalid.detail.state, 'invalid_record');

  // 느슨한 스위치 판독 금지 — '1'·'yes' 는 차단 ON 이 아니다(writeFreeze 와 같은 규율).
  assert.equal(securityReapplyCheck({ env: { RECOVERY_WRITE_FREEZE: '1' } }).detail.state, 'normal');

  assert.deepEqual([...REAPPLY_STATES], ['normal', 'pending', 'recorded', 'invalid_record', 'stale_record']);
  assert.equal(postRestoreSecurityStatus({}).state, 'normal');
  assert.equal(postRestoreSecurityStatus({}).reverts, SECURITY_REVERTS.length);
});

test('공개 응답에 계정·토큰·행 수를 담지 않는다', () => {
  const d = securityReapplyCheck({ env: { RECOVERY_WRITE_FREEZE: 'true' } }).detail;
  const json = JSON.stringify(d);
  assert.ok(!/@/.test(json), '이메일 같은 PII 가 들어가면 안 된다');
  assert.equal(d.revertCount, SECURITY_REVERTS.length, '내용이 아니라 개수만 담는다');
  assert.equal(d.recordKey, SECURITY_REAPPLIED_ENV);
  assert.ok(typeof d.note === 'string' && (d.note as string).length > 20);
  // 복구 단계(phase)는 env 해석 결과일 뿐 행 정보가 아니다.
  assert.equal(d.phase, 'frozen');
});

test('세션 수명은 실제 auth.ts 와 매번 대조한다', () => {
  const src = read('src', SESSION_TTL_SOURCE.replace(/^src\//, '').split('/').join(path.sep));
  assert.deepEqual(auditSessionTtl(src), [], `${SESSION_TTL_SOURCE} 의 SESSION_DAYS 와 어긋난다`);
  assert.equal(auditSessionTtl('const SESSION_DAYS = 30;').length, 1);
  assert.equal(auditSessionTtl('세션 수명이 어디에도 없다').length, 1);
});

test('세션 폐기·비밀번호 변경 경로의 모양을 실제 원문으로 고정한다', () => {
  const problems = auditRevocationShapes({
    auth: read('src', 'lib', 'auth.ts'),
    profile: read('src', 'app', 'api', 'profile', 'route.ts'),
    adminUsers: read('src', 'app', 'api', 'admin', 'users', 'route.ts'),
    resetConfirm: read('src', 'app', 'api', 'auth', 'password-reset', 'confirm', 'route.ts'),
  });
  assert.deepEqual(problems, [], problems.join(' / '));
  // 폐기 방식이 바뀌면(soft delete 등) 목록·절차를 함께 고쳐야 한다 — 그것을 잡는 가드다.
  assert.equal(auditRevocationShapes({}).length, 5);
});

test('health 라우트 배선: 판정만 하고 버리는 꼴까지 잡는다', () => {
  const src = read('src', 'app', 'api', 'health', 'route.ts');
  assert.deepEqual(auditHealthWiring(src), []);
  assert.equal(auditHealthWiring('').length, 2);
  assert.equal(
    auditHealthWiring("import { securityReapplyCheck } from '@/lib/postRestoreSecurity';\nsecurityReapplyCheck();").length,
    1,
    '호출만 하고 응답에 담지 않으면 잡아야 한다',
  );
  // route.ts 는 HTTP 메서드·설정 외 export 금지(Vercel 빌드 실패 원인).
  const exports = [...src.matchAll(/^export\s+(?:const|async function|function)\s+(\w+)/gm)].map((m) => m[1]);
  assert.deepEqual(exports.sort(), ['GET', 'dynamic']);
});

test('RUNBOOK: 6-1단계와 7단계 선행 조건이 문서에 살아 있다', () => {
  const md = read('RUNBOOK.md');
  assert.deepEqual(auditRunbookSecurity(md), [], auditRunbookSecurity(md).join(' / '));
  // 6-1단계가 사라지거나 7단계가 그 완료를 요구하지 않으면 실패해야 한다.
  assert.ok(auditRunbookSecurity(md.replace(/^6-1\./m, '   ')).length > 0, '6-1단계가 사라지면 잡아야 한다');
  assert.ok(
    auditRunbookSecurity(md.replace(/\*\*6-1단계 재적용을 마친 뒤에만\*\*/, '뒤에')).length > 0,
    '7단계가 6-1 완료를 선행 조건으로 걸지 않으면 잡아야 한다',
  );
  assert.ok(auditRunbookSecurity('').length > 0);
  // 리허설 체크리스트에도 재적용이 들어 있어야 한다(표만 있고 점검 항목이 없으면 하지 않게 된다).
  assert.match(md, /- \[ \] \*\*해제 전에\*\* 보안 상태를 재적용했다/);
});

test('새 env 는 레지스트리·RUNBOOK §4 에 함께 등록돼 있다', () => {
  const def = ENV_VARS.find((v) => v.key === SECURITY_REAPPLIED_ENV);
  assert.ok(def, '복구 목록(envRegistry)에 없으면 복구 후 조용히 사라진다');
  assert.equal(def?.group, '복구 리허설');
  assert.match(read('RUNBOOK.md'), new RegExp('`' + SECURITY_REAPPLIED_ENV + '`'));
});

test('모듈에 임의 수치·자격증명 리터럴이 없다', () => {
  const src = read('src', 'lib', 'postRestoreSecurity.ts');
  // 세션 수명 외에 「기본 며칠」 같은 폴백을 두지 않는다.
  const dayLiterals = [...src.matchAll(/ttlDays\s*[=:]\s*(\d+)/g)].map((m) => m[1]);
  assert.deepEqual(dayLiterals, [], '수명 폴백 리터럴을 두지 않는다 — 정본은 auth.ts 다');
  assert.ok(!/process\.env\.[A-Z_]+\s*\|\|/.test(src), 'env 기본값을 만들지 않는다');
  assert.ok(!/password\s*=\s*['"]/.test(src), '비밀값 리터럴 금지');
});
