/**
 * recoveryWindow.test.ts — RUNBOOK §3 3단계(복구 브랜치 생성)의 복구 시점·보존 창. 2026-10-09
 *
 * ── 왜 필요한가 ──────────────────────────────────────────────────────────────
 * 3단계는 「Neon에서 시점 T-ε 로 새 브랜치를 만든다」 한 문장이었다.
 *  (1) ε 가 정의되지 않아 눈대중으로 정했다 — 작으면 손상 트랜잭션이 복구 브랜치에 들어오는데
 *      4단계 대조는 **행 수**만 보므로 변조·부분 삭제는 「기준치 이상」을 그대로 통과한다.
 *  (2) T 가 PITR 보존 창 안인지 보는 수단이 없었다. 보존기간은 §1 에 `[확인 필요]` 로 비어 있었고
 *      §2 월 점검도 수치를 남기지 않았다 — 그래서 **쓰기 차단(2단계)까지 끝낸 뒤** 3단계에서야
 *      복구 불가를 알게 됐다.
 *  (3) 보존 창의 하한은 시간과 함께 전진한다 — 조사하는 사이에 복구 가능성이 사라질 수 있다.
 *
 * 그래서 (a) 산출·판정 자체와 (b) 배선(health 응답·RUNBOOK 문장)을 파일 수준에서 고정한다.
 * 이 테스트는 **파일만 읽는다** — 네트워크·DB 를 쓰지 않고 `process.env` 도 바꾸지 않는다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  ACTION_EPSILON_INVALID,
  ACTION_EPSILON_MISSING,
  ACTION_WINDOW_FUTURE,
  ACTION_WINDOW_INVALID_TIME,
  ACTION_WINDOW_OK,
  ACTION_WINDOW_UNKNOWN,
  CAVEAT_EPSILON_INCLUDES_DAMAGE,
  CAVEAT_NOT_PROOF_OF_CLEAN,
  CAVEAT_WINDOW_MOVES,
  CAVEAT_ZONELESS,
  EPSILON_RULES,
  PITR_RETENTION_ENV,
  WINDOW_LIMITS,
  WINDOW_VERDICTS,
  auditHealthWiring,
  auditRunbookWindow,
  hasTimezone,
  pitrWindowCheck,
  planRestorePoint,
  restorePointStatus,
  restorePointText,
  retentionHours,
  windowLogLine,
  windowStatus,
} from '../src/lib/recoveryWindow.ts';
import { ENV_VARS } from '../src/lib/envRegistry.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (...p: string[]) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

const NOW = new Date('2026-10-09T06:00:00Z');
const T = '2026-10-09T05:00:00Z'; // 1시간 전 손상

test('retentionHours: 설정값만 인정한다 — 임의 기본 보존기간이 없다', () => {
  assert.equal(retentionHours({}), null, '미설정이면 null(판정 보류)');
  assert.equal(retentionHours({ RECOVERY_PITR_RETENTION_HOURS: '168' }), 168);
  assert.equal(retentionHours({ RECOVERY_PITR_RETENTION_HOURS: ' 24 ' }), 24);
  // 형식 밖·범위 밖은 추측하지 않고 null
  for (const bad of ['', '0', '-1', '24h', '1.5', '9999999', '8761']) {
    assert.equal(retentionHours({ RECOVERY_PITR_RETENTION_HOURS: bad }), null, `거부: ${bad}`);
  }
  assert.equal(PITR_RETENTION_ENV, 'RECOVERY_PITR_RETENTION_HOURS');
});

test('planRestorePoint: ok — T-ε·유실 구간·마감을 수치로 돌려준다', () => {
  const p = planRestorePoint({ damageAt: T, epsilonMinutes: 10, now: NOW, retentionHours: 168 });
  assert.equal(p.verdict, 'ok');
  assert.equal(p.restorePoint, '2026-10-09T04:50:00.000Z'); // T - 10분
  assert.equal(p.damageAt, '2026-10-09T05:00:00.000Z');
  assert.equal(p.epsilonMinutes, 10);
  assert.equal(p.lossMinutes, 70); // now - (T-ε)
  assert.equal(p.windowStart, '2026-10-02T06:00:00.000Z'); // now - 168h
  assert.equal(p.deadline, '2026-10-16T04:50:00.000Z'); // (T-ε) + 168h
  assert.equal(p.remainingMinutes, 168 * 60 - 70);
  assert.equal(p.action, ACTION_WINDOW_OK);
  assert.equal(p.zonelessInput, false);
  // ok 여도 보장하지 못하는 것을 함께 말한다.
  assert.ok(p.caveats.includes(CAVEAT_WINDOW_MOVES));
  assert.ok(p.caveats.includes(CAVEAT_EPSILON_INCLUDES_DAMAGE));
  assert.ok(p.caveats.includes(CAVEAT_NOT_PROOF_OF_CLEAN));
});

test('planRestorePoint: expired — 창 밖이면 「만들 수 없다」로 판정하고 남은 시간을 적지 않는다', () => {
  // 보존 창 24시간, 손상은 30시간 전 → 창 밖
  const p = planRestorePoint({
    damageAt: '2026-10-08T00:00:00Z',
    epsilonMinutes: 10,
    now: NOW,
    retentionHours: 24,
  });
  assert.equal(p.verdict, 'expired');
  assert.equal(p.restorePoint, '2026-10-07T23:50:00.000Z'); // 시점 자체는 산출해 보여 준다
  assert.equal(p.remainingMinutes, null, '이미 지난 마감에 남은 시간을 적지 않는다');
  assert.ok(p.windowStart && p.deadline);
  assert.match(String(p.action), /보존 창/);
  assert.match(String(p.action), /사람이 결정/);

  // 창 경계: 하한과 같은 시점은 아직 안쪽이다
  const edge = planRestorePoint({
    damageAt: '2026-10-08T06:10:00Z',
    epsilonMinutes: 10,
    now: NOW,
    retentionHours: 24,
  });
  assert.equal(edge.restorePoint, edge.windowStart);
  assert.equal(edge.verdict, 'ok');
  assert.equal(edge.remainingMinutes, 0);
});

test('planRestorePoint: 보존 창을 모르면 「창 밖」으로 단정하지 않는다(unknown_window)', () => {
  const p = planRestorePoint({ damageAt: T, epsilonMinutes: 10, now: NOW, retentionHours: null });
  assert.equal(p.verdict, 'unknown_window');
  assert.equal(p.restorePoint, '2026-10-09T04:50:00.000Z', '시점 산출은 그대로 해 준다');
  assert.equal(p.retentionHours, null);
  assert.equal(p.windowStart, null);
  assert.equal(p.deadline, null);
  assert.equal(p.remainingMinutes, null);
  assert.equal(p.action, ACTION_WINDOW_UNKNOWN);
  assert.match(p.action, /임의 기본 보존기간을 쓰지 않는다/);
  // 범위 밖 설정값도 「모른다」로 떨어뜨린다(0 시간으로 읽어 전건 expired 를 만들지 않는다).
  assert.equal(planRestorePoint({ damageAt: T, epsilonMinutes: 10, now: NOW, retentionHours: 0 }).verdict, 'unknown_window');
  assert.equal(planRestorePoint({ damageAt: T, epsilonMinutes: 10, now: NOW, retentionHours: 1.5 }).verdict, 'unknown_window');
});

test('planRestorePoint: ε 는 기본값을 만들지 않는다 — 미지정·범위 밖은 멈춘다', () => {
  const missing = planRestorePoint({ damageAt: T, now: NOW, retentionHours: 168 });
  assert.equal(missing.verdict, 'invalid_epsilon');
  assert.equal(missing.restorePoint, null, '임의 ε 로 시점을 지어내지 않는다');
  assert.equal(missing.action, ACTION_EPSILON_MISSING);
  assert.ok(missing.caveats.includes(CAVEAT_EPSILON_INCLUDES_DAMAGE));

  for (const bad of [0, -5, 1.5, '10분', 10081, NaN]) {
    const p = planRestorePoint({ damageAt: T, epsilonMinutes: bad, now: NOW, retentionHours: 168 });
    assert.equal(p.verdict, 'invalid_epsilon', `거부: ${String(bad)}`);
    assert.equal(p.action, ACTION_EPSILON_INVALID);
  }
  // 문자열 숫자는 받아 준다(명령행 인자 경유).
  assert.equal(planRestorePoint({ damageAt: T, epsilonMinutes: '10', now: NOW, retentionHours: 168 }).epsilonMinutes, 10);
});

test('planRestorePoint: T 가 틀렸으면 창·ε 보다 먼저 멈춘다(판정 순서)', () => {
  const bad = planRestorePoint({ damageAt: '어제 밤', epsilonMinutes: 10, now: NOW, retentionHours: 168 });
  assert.equal(bad.verdict, 'invalid_time');
  assert.equal(bad.action, ACTION_WINDOW_INVALID_TIME);
  assert.equal(bad.damageAt, null, '읽지 못한 시각을 지어내지 않는다');

  // 비실존 날짜를 Date 가 굴려서 받아 주는 것을 막는다.
  assert.equal(planRestorePoint({ damageAt: '2026-02-30T00:00:00Z', epsilonMinutes: 10, now: NOW }).verdict, 'invalid_time');

  // T 가 미래 → 창 판정 이전에 future. ε 가 없어도 future 가 먼저다.
  const future = planRestorePoint({ damageAt: '2026-10-09T09:00:00Z', now: NOW, retentionHours: 168 });
  assert.equal(future.verdict, 'future');
  assert.equal(future.action, ACTION_WINDOW_FUTURE);
  assert.equal(future.restorePoint, null);

  // ε 무효는 보존 창 미설정보다 먼저다(시점이 없으면 창 판정이 의미 없다).
  assert.equal(planRestorePoint({ damageAt: T, now: NOW, retentionHours: null }).verdict, 'invalid_epsilon');

  // 현재 시각을 모르면 창의 하한도 마감도 없다 — 창 판정을 보류하고 시계를 가리킨다.
  const noClock = planRestorePoint({ damageAt: T, epsilonMinutes: 10, now: new Date('x'), retentionHours: 168 });
  assert.equal(noClock.verdict, 'unknown_window');
  assert.equal(noClock.windowStart, null);
  assert.match(String(noClock.action), /서버 시계/);
  assert.ok(noClock.caveats.includes(CAVEAT_WINDOW_MOVES));

  assert.deepEqual([...WINDOW_VERDICTS].sort(), [
    'expired', 'future', 'invalid_epsilon', 'invalid_time', 'ok', 'unknown_window',
  ]);
});

test('타임존 없는 T 는 UTC 로 읽힌다 — 그 사실을 숨기지 않는다', () => {
  assert.equal(hasTimezone('2026-10-09T05:00:00+09:00'), true);
  assert.equal(hasTimezone('2026-10-09T05:00:00Z'), true);
  assert.equal(hasTimezone('2026-10-09T05:00:00'), false);
  assert.equal(hasTimezone('2026-10-09'), false);

  const p = planRestorePoint({ damageAt: '2026-10-09T05:00:00', epsilonMinutes: 10, now: NOW, retentionHours: 168 });
  assert.equal(p.verdict, 'ok');
  assert.equal(p.zonelessInput, true);
  assert.equal(p.caveats[0], CAVEAT_ZONELESS, '경고를 맨 앞에 둔다');

  // KST 를 그대로 적으면 미래가 된다 — 제1 용의자를 함께 알린다.
  const kst = planRestorePoint({ damageAt: '2026-10-09T14:00:00', epsilonMinutes: 10, now: NOW, retentionHours: 168 });
  assert.equal(kst.verdict, 'future');
  assert.ok(kst.caveats.includes(CAVEAT_ZONELESS));
});

test('마감은 시간과 함께 당겨진다 — 조사하는 사이에 창 밖으로 밀려난다', () => {
  const args = { damageAt: '2026-10-08T07:00:00Z', epsilonMinutes: 10, retentionHours: 24 } as const;
  const early = planRestorePoint({ ...args, now: new Date('2026-10-08T08:00:00Z') });
  const later = planRestorePoint({ ...args, now: new Date('2026-10-09T05:00:00Z') });
  const tooLate = planRestorePoint({ ...args, now: new Date('2026-10-09T08:00:00Z') });

  assert.equal(early.verdict, 'ok');
  assert.equal(later.verdict, 'ok');
  assert.equal(early.deadline, later.deadline, '마감은 복구 시점에 달려 있어 그대로다');
  assert.ok(Number(later.remainingMinutes) < Number(early.remainingMinutes), '남은 시간은 줄어든다');
  assert.ok(Number(later.lossMinutes) > Number(early.lossMinutes), '유실 구간은 늘어난다');
  assert.equal(tooLate.verdict, 'expired', '같은 T 가 창 밖으로 밀려난다');
});

test('restorePointStatus: env 경유 + 사각지대·ε 규칙을 함께 내보낸다', () => {
  const s = restorePointStatus({
    damageAt: T,
    epsilonMinutes: 10,
    now: NOW,
    env: { RECOVERY_PITR_RETENTION_HOURS: '168' },
  });
  assert.equal(s.verdict, 'ok');
  assert.equal(s.retentionHours, 168);
  assert.deepEqual(s.limits, WINDOW_LIMITS);
  assert.deepEqual(s.epsilonRules, EPSILON_RULES);
  assert.ok(WINDOW_LIMITS.some((l) => l.includes('Neon 콘솔')), '정본이 콘솔이라는 사실을 적어 둔다');
  assert.ok(EPSILON_RULES.some((r) => r.includes('truncated')), '근거 없이 ε 를 정하지 말라는 규칙이 있다');

  // 미설정 env 에서는 판정 보류로 떨어진다(기본값으로 메우지 않는다).
  assert.equal(restorePointStatus({ damageAt: T, epsilonMinutes: 10, now: NOW, env: {} }).verdict, 'unknown_window');
});

test('restorePointText·windowLogLine: 수치만 담는다', () => {
  const ok = planRestorePoint({ damageAt: T, epsilonMinutes: 10, now: NOW, retentionHours: 168 });
  const text = restorePointText(ok);
  assert.match(text, /2026-10-09T04:50:00\.000Z/);
  assert.match(text, /유실/);
  assert.match(text, /마감/);

  const expired = planRestorePoint({ damageAt: '2026-10-01T00:00:00Z', epsilonMinutes: 10, now: NOW, retentionHours: 24 });
  assert.match(restorePointText(expired), /보존 창 밖/);
  // 산출 불가는 판정을 그대로 드러낸다.
  assert.match(restorePointText(planRestorePoint({ damageAt: 'x', epsilonMinutes: 1, now: NOW })), /invalid_time/);

  const line = windowLogLine(ok);
  assert.match(line, /^\[recovery-window\] verdict=ok /);
  assert.match(line, /restore_point=2026-10-09T04:50:00\.000Z/);
  assert.match(line, /retention_h=168/);
  assert.match(line, /loss_min=70/);
});

test('pitrWindowCheck: 미설정을 평상시에 드러내되 503 을 만들지 않는다', () => {
  const unset = pitrWindowCheck({ env: {} });
  assert.equal(unset.ok, false);
  assert.equal(unset.required, false, 'required:false — 미설정으로 서비스를 down 처리하지 않는다');
  assert.equal(unset.detail.retentionConfigured, false);
  assert.equal(unset.detail.retentionHours, null);
  assert.match(String(unset.detail.note), /임의 기본 보존기간/);

  const set = pitrWindowCheck({ env: { RECOVERY_PITR_RETENTION_HOURS: '168' } });
  assert.equal(set.ok, true);
  assert.equal(set.detail.retentionHours, 168);

  // 공개 엔드포인트다 — 연결 문자열·호스트·행 수가 섞여 들어가지 않는다.
  const dump = JSON.stringify(set.detail);
  assert.ok(!/postgres:\/\/|neon\.tech|password/i.test(dump));
  assert.equal(typeof pitrWindowCheck().detail.retentionConfigured, 'boolean');
  assert.equal(typeof windowStatus({}).note, 'string');
  assert.equal(windowStatus({ RECOVERY_PITR_RETENTION_HOURS: '48' }).retentionHours, 48);
});

test('모듈에 임의 기본 보존기간·기본 ε 가 숨어 있지 않다', () => {
  const src = read('src', 'lib', 'recoveryWindow.ts');
  assert.ok(!/(\?\?|\|\|)\s*(24|48|72|168|720|8760)\b/.test(src), '보존기간 기본값 폴백이 있다');
  assert.ok(!/epsilon\w*\s*(\?\?|\|\|)\s*\d/i.test(src), 'ε 기본값 폴백이 있다');
  // DB·네트워크·파일시스템 미접근(판정은 입력 해석뿐).
  assert.ok(!/from\s+['"]@?\/?db|drizzle-orm|node:fs|next\//.test(src), 'DB·fs·next 를 가져온다');
});

test('배선: /api/health 가 보존 창 체크를 응답에 실어 보낸다', () => {
  assert.deepEqual(auditHealthWiring(read('src', 'app', 'api', 'health', 'route.ts')), []);
  // import 만 하고 호출하지 않거나, 판정만 하고 버리는 꼴을 걸러낸다.
  assert.ok(auditHealthWiring("import { pitrWindowCheck } from '@/lib/recoveryWindow';").length > 0);
  assert.ok(
    auditHealthWiring(
      "import { pitrWindowCheck } from '@/lib/recoveryWindow';\nconst w = pitrWindowCheck();",
    ).length > 0,
    '판정 결과를 checks.recoveryWindow 로 내보내지 않으면 걸러야 한다',
  );
  assert.deepEqual(
    auditHealthWiring(
      "import { pitrWindowCheck } from '@/lib/recoveryWindow';\nchecks.recoveryWindow = pitrWindowCheck();",
    ),
    [],
  );
});

test('배선: RUNBOOK 3단계가 산출·판정 가능한 문장으로 남아 있다', () => {
  const runbook = read('RUNBOOK.md');
  assert.deepEqual(auditRunbookWindow(runbook), []);
  assert.ok(runbook.includes('### 3-6.'), '§3-6 절이 있다');
  assert.ok(runbook.includes('checks.recoveryWindow'), '평상시 확인 수단이 적혀 있다');
  assert.ok(runbook.includes('deadline'), '마감 개념이 절차에 있다');

  // 「T-ε 로 브랜치를 만든다」 한 문장으로 되돌아가면 실패한다.
  const stripped = runbook.replace(/### 3-6\./g, '### 3-6-removed.');
  assert.ok(auditRunbookWindow(stripped).length > 0);
  assert.ok(auditRunbookWindow('## 3. DB 복구 절차\n3. 복구 브랜치 생성\n### 3-1.').length > 0);
});

test('env 레지스트리·RUNBOOK §4 에 보존기간 키가 등록돼 있다', () => {
  const def = ENV_VARS.find((v) => v.key === PITR_RETENTION_ENV);
  assert.ok(def, '레지스트리에 등록되지 않았다 — 복구에서 조용히 유실된다');
  assert.equal(def.kind, 'config');
  assert.equal(def.group, '복구 리허설');
  assert.match(def.note, /보존/);
  // §4 목록은 복구의 전부다 — 키가 문서에도 있어야 한다(envRegistry 커버리지 점검과 같은 규율).
  assert.ok(read('RUNBOOK.md').includes(`\`${PITR_RETENTION_ENV}\``));
});
