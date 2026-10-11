/**
 * deployRollback.test.ts — RUNBOOK §5 배포 롤백의 지속성·수단 선택. 2026-10-11
 *
 * ── 왜 필요한가 ──────────────────────────────────────────────────────────────
 * §3(DB 복구) 1~8단계는 모두 기계화됐는데 §5 는 세 줄이었다("Promote → `commit` 확인 →
 * 수정 후 재배포"). 이 배포 환경에서 그 절차에는 오류를 내지 않는 구멍이 둘 있다.
 *  (1) 배포 경로가 「AutoPush(20분) → push → Vercel 자동 배포(main)」이고 Promote 는 `main` 을
 *      고치지 않으므로, 롤백은 **주기 안에 저절로 풀린다** — `commit` 눈 확인 직후 회귀 커밋으로
 *      돌아가고 아무 알림이 없다.
 *  (2) Promote 되는 옛 배포는 **그 배포 시점의 env 스냅샷**으로 돈다 — §3 복구 중에 쓰면
 *      교체한 `DATABASE_URL`·쓰기 차단이 함께 되돌아가 「DB를 건드리지 않는다」가 깨지는데,
 *      확인 장치 전체가 「평상시」로 보인다.
 *
 * 그래서 (a) 판정 자체(모르면 「다르다」로 올리지 않는다)와 (b) 배선(health 응답·RUNBOOK §5 문장)을
 * 파일 수준에서 고정한다. 이 테스트는 **파일만 읽는다** — 네트워크·DB 를 쓰지 않고 `process.env` 도
 * 바꾸지 않는다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  ACTION_PIN_DRIFTED,
  AUTOPUSH_INTERVAL_MIN,
  CAVEAT_ENV_SNAPSHOT,
  CAVEAT_ROLLBACK_LOSES_FREEZE,
  CAVEAT_ROLLBACK_LOSES_RECOVERY,
  PIN_ENV,
  PIN_VERDICTS,
  ROLLBACK_LIMITS,
  ROLLBACK_METHODS,
  ROLLBACK_PHASES,
  ROLLBACK_PRECONDITIONS,
  assessDeployPin,
  assessRollbackRisk,
  auditHealthWiring,
  auditRunbookRollback,
  deployPinCheck,
  deployRollbackStatus,
  deployRollbackStatusLine,
  parseCommitRef,
  pinFromEnv,
  pinLogLine,
  rollbackPhase,
  rollbackText,
  sameCommit,
} from '../src/lib/deployRollback.ts';
import { ENV_VARS, parseDocumentedKeys, runbookSection4 } from '../src/lib/envRegistry.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (...p: string[]) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

const FULL = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678'; // 롤백 대상(전체 해시)
const SHORT = 'a1b2c3d'; // /api/health 가 노출하는 7자리
const OTHER = 'ffee001'; // 다른 커밋

test('커밋 참조: 7~40자리 16진수만 인정하고 그 밖은 커밋으로 쓰지 않는다', () => {
  assert.equal(parseCommitRef(FULL), FULL);
  assert.equal(parseCommitRef(`  ${SHORT.toUpperCase()}  `), SHORT, '대문자·공백을 정규화한다');
  for (const bad of ['HEAD', 'main', 'v1.2.3', 'a1b2c3', `${FULL}0`, 'zzzzzzz', '', null, undefined, 123]) {
    assert.equal(parseCommitRef(bad), null, `커밋으로 받아들였다: ${String(bad)}`);
  }
});

test('같은 커밋 판정: 짧은 쪽이 긴 쪽의 접두사일 때만 같다', () => {
  assert.equal(sameCommit(FULL, SHORT), true);
  assert.equal(sameCommit(SHORT, FULL), true, '비교는 방향에 의존하지 않는다');
  assert.equal(sameCommit(FULL, FULL), true);
  assert.equal(sameCommit(FULL, OTHER), false);
  // 읽을 수 없는 값으로 「같다」를 만들지 않는다(호출부가 unknown_actual 로 처리한다).
  assert.equal(sameCommit(FULL, 'HEAD'), false);
  assert.equal(sameCommit(null, null), false);
});

test('고정 대조: 판정 순서가 할 일을 바꾼다(모름 ≠ 다름)', () => {
  const off = assessDeployPin({ pinned: '', actual: SHORT });
  assert.equal(off.verdict, 'off');
  assert.equal(off.pinned, null);

  // 고정 값을 읽을 수 없으면 현재 커밋을 봐도 의미가 없다.
  assert.equal(assessDeployPin({ pinned: 'HEAD', actual: SHORT }).verdict, 'invalid_pin');
  assert.equal(assessDeployPin({ pinned: 'HEAD', actual: SHORT }).pinned, null, '못 읽은 값을 고정으로 담았다');

  // 현재 커밋을 모르는 것은 「다르다」가 아니다.
  const unknown = assessDeployPin({ pinned: FULL, actual: null });
  assert.equal(unknown.verdict, 'unknown_actual');
  assert.equal(unknown.actual, null);
  assert.ok(!/다르다/.test(unknown.note), '모름을 다름으로 서술했다');

  const held = assessDeployPin({ pinned: FULL, actual: SHORT });
  assert.equal(held.verdict, 'held');
  assert.equal(held.pinned, FULL);
  assert.equal(held.actual, SHORT);

  const drifted = assessDeployPin({ pinned: FULL, actual: OTHER });
  assert.equal(drifted.verdict, 'drifted');
  for (const v of [off, held, drifted, unknown]) assert.ok(PIN_VERDICTS.includes(v.verdict));
});

test('drifted 의 두 해석을 모두 적는다 — 롤백 풀림 / 고정 미삭제', () => {
  assert.match(ACTION_PIN_DRIFTED, /AutoPush/);
  assert.match(ACTION_PIN_DRIFTED, new RegExp(String(AUTOPUSH_INTERVAL_MIN)));
  assert.match(ACTION_PIN_DRIFTED, new RegExp(PIN_ENV));
  assert.match(ACTION_PIN_DRIFTED, /구분/, '둘을 구분하는 방법을 적지 않았다');
  // 고정한 쪽이 held 일 때도 「지워야 한다」를 말해 둔다(남으면 영구 drifted 가 된다).
  assert.match(assessDeployPin({ pinned: FULL, actual: SHORT }).action, /지운다/);
});

test('복구 단계 판정: 스위치는 true 문자열만, 전환 이후는 기준 지문으로 본다', () => {
  assert.equal(rollbackPhase({}), 'normal');
  assert.equal(rollbackPhase({ RECOVERY_WRITE_FREEZE: 'true' }), 'frozen');
  assert.equal(rollbackPhase({ RECOVERY_WRITE_FREEZE: '1' }), 'normal', '느슨한 스위치 판독');
  assert.equal(rollbackPhase({ RECOVERY_EXPECTED_DB: 'abc123abc123' }), 'after_switch');
  assert.equal(rollbackPhase({ RECOVERY_EXPECTED_DB: '   ' }), 'normal');
  // 차단 중이면 전환 이후보다 먼저다(더 위험한 쪽을 택한다).
  assert.equal(rollbackPhase({ RECOVERY_WRITE_FREEZE: 'true', RECOVERY_EXPECTED_DB: 'abc123abc123' }), 'frozen');
  for (const p of ROLLBACK_PHASES) assert.equal(typeof p, 'string');
});

test('롤백이 되돌려 버리는 설정을 열거한다 — 「코드만 되돌린다」가 깨지는 지점', () => {
  const normal = assessRollbackRisk({});
  assert.equal(normal.phase, 'normal');
  assert.equal(normal.codeOnly, true);
  assert.deepEqual(normal.atRisk, []);
  // 목록이 비어도 「되돌아갈 것이 없다」는 뜻이 아니다 — 스냅샷 경고는 항상 붙는다.
  assert.ok(normal.caveats.includes(CAVEAT_ENV_SNAPSHOT));

  const frozen = assessRollbackRisk({ RECOVERY_WRITE_FREEZE: 'true', RECOVERY_WRITE_FREEZE_AT: '2026-10-11T01:00:00+09:00' });
  assert.equal(frozen.codeOnly, false);
  assert.deepEqual(frozen.atRisk, ['RECOVERY_WRITE_FREEZE', 'RECOVERY_WRITE_FREEZE_AT', 'DATABASE_URL']);
  assert.ok(frozen.caveats.includes(CAVEAT_ROLLBACK_LOSES_FREEZE));
  assert.ok(frozen.caveats.includes(CAVEAT_ROLLBACK_LOSES_RECOVERY));
  assert.match(frozen.action, /Promote/);
  assert.match(frozen.action, /revert/);

  const after = assessRollbackRisk({ RECOVERY_EXPECTED_DB: 'abc123abc123' });
  assert.equal(after.codeOnly, false);
  assert.deepEqual(after.atRisk, ['RECOVERY_EXPECTED_DB', 'DATABASE_URL']);

  // 키 **이름**만 담는다 — 연결 문자열·지문 값이 섞여 나가지 않는다.
  const dump = JSON.stringify([normal, frozen, after]);
  assert.ok(!/postgres:\/\/|neon\.tech|abc123abc123|2026-10-11T01/.test(dump));
});

test('env 로더: 설정값만 인정하고 기본값을 만들지 않는다', () => {
  assert.deepEqual(pinFromEnv({}), { raw: null, ref: null });
  assert.deepEqual(pinFromEnv({ DEPLOY_PINNED_COMMIT: `  ${FULL} ` }), { raw: FULL, ref: FULL });
  // 못 읽는 값을 「고정됨」으로 올리지 않고, 원문은 남겨 invalid_pin 으로 드러낸다.
  assert.deepEqual(pinFromEnv({ DEPLOY_PINNED_COMMIT: 'HEAD~1' }), { raw: 'HEAD~1', ref: null });
});

test('/api/health 체크: 롤백이 풀린 사실을 드러내고 503 은 만들지 않는다', () => {
  const off = deployPinCheck({ env: { VERCEL_GIT_COMMIT_SHA: FULL } });
  assert.equal(off.ok, true);
  assert.equal(off.required, false, 'required:false — 어느 경우에도 503 이 되지 않는다');
  assert.equal(off.detail.verdict, 'off');
  assert.equal(off.detail.phase, 'normal');
  assert.match(String(off.detail.note), /평상시/);

  const held = deployPinCheck({ env: { VERCEL_GIT_COMMIT_SHA: FULL, DEPLOY_PINNED_COMMIT: FULL } });
  assert.equal(held.detail.verdict, 'held');
  assert.equal(held.ok, true);

  // 롤백이 AutoPush 에 밀려 풀린 상태 — 이것이 알림이다.
  const drifted = deployPinCheck({ env: { VERCEL_GIT_COMMIT_SHA: OTHER + '0000000', DEPLOY_PINNED_COMMIT: FULL } });
  assert.equal(drifted.detail.verdict, 'drifted');
  assert.equal(drifted.ok, false, '롤백이 풀린 것이 degraded 로 드러나지 않는다');

  const invalid = deployPinCheck({ env: { VERCEL_GIT_COMMIT_SHA: FULL, DEPLOY_PINNED_COMMIT: 'HEAD' } });
  assert.equal(invalid.detail.verdict, 'invalid_pin');
  assert.equal(invalid.ok, false);

  const unknown = deployPinCheck({ env: { DEPLOY_PINNED_COMMIT: FULL } });
  assert.equal(unknown.detail.verdict, 'unknown_actual');
  assert.equal(unknown.ok, false);

  // 복구 중에는 되돌아갈 설정을 함께 알려 준다.
  const frozen = deployPinCheck({ env: { RECOVERY_WRITE_FREEZE: 'true', VERCEL_GIT_COMMIT_SHA: FULL } });
  assert.equal(frozen.detail.phase, 'frozen');
  assert.equal(frozen.detail.codeOnly, false);
  assert.deepEqual(frozen.detail.atRisk, ['RECOVERY_WRITE_FREEZE', 'DATABASE_URL']);

  // 공개 엔드포인트다 — 연결 문자열·설정값이 섞여 들어가지 않는다.
  const dump = JSON.stringify([off, held, drifted, invalid, unknown, frozen].map((c) => c.detail));
  assert.ok(!/postgres:\/\/|neon\.tech|password|secret/i.test(dump));
  assert.equal(String(off.detail.pinKey), PIN_ENV);

  assert.equal(deployRollbackStatusLine({}).verdict, 'off');
  assert.equal(deployRollbackStatusLine({}).pinKey, PIN_ENV);
});

test('수단 비교가 거꾸로 적히지 않게 고정한다 — Promote 는 둘 다 못 견딘다', () => {
  assert.equal(ROLLBACK_METHODS.length, 2);
  const promote = ROLLBACK_METHODS.find((m) => /Promote/.test(m.method));
  const revert = ROLLBACK_METHODS.find((m) => /revert/.test(m.method));
  assert.ok(promote && revert);
  assert.equal(promote.survivesAutoPush, false, 'Promote 는 main 을 고치지 않는다');
  assert.equal(promote.keepsEnv, false, 'Promote 는 그 배포의 env 스냅샷으로 돈다');
  assert.equal(revert.survivesAutoPush, true);
  assert.equal(revert.keepsEnv, true);
});

test('선행 조건·사각지대를 함께 내보낸다 — 한계를 숨기지 않는다', () => {
  const pre = ROLLBACK_PRECONDITIONS.join('\n');
  assert.match(pre, /AutoPush/);
  assert.match(pre, new RegExp(PIN_ENV));
  assert.match(pre, /RECOVERY_WRITE_FREEZE/);
  assert.ok(ROLLBACK_PRECONDITIONS.length >= 4);

  const lim = ROLLBACK_LIMITS.join('\n');
  assert.match(lim, /환경변수는 커밋으로 알 수 없다/);
  assert.match(lim, /Promote/, 'Promote 된 옛 배포가 고정을 보지 못하는 한계를 적지 않았다');
  assert.match(lim, /접두사/);
  assert.ok(ROLLBACK_LIMITS.length >= 5);
});

test('출력: 사람용 요약과 로그 한 줄은 판정·접두사만 담는다', () => {
  const st = deployRollbackStatus({ VERCEL_GIT_COMMIT_SHA: OTHER + '0000000', DEPLOY_PINNED_COMMIT: FULL });
  assert.equal(st.verdict, 'drifted');
  assert.equal(st.limits, ROLLBACK_LIMITS);
  const text = rollbackText(st);
  assert.match(text, /\[drifted\]/);
  assert.match(text, /phase=normal/);
  assert.ok(text.split('\n').length > ROLLBACK_LIMITS.length);

  const line = pinLogLine(assessDeployPin({ pinned: FULL, actual: SHORT }), 'frozen');
  assert.equal(line, `[rollback] pin=held pinned=${SHORT} actual=${SHORT} phase=frozen`);
  assert.ok(!line.includes(FULL), '전체 해시를 로그에 남겼다');
});

test('[실제 소스] /api/health 가 롤백 고정 판정을 응답에 담는다', () => {
  const src = read('src', 'app', 'api', 'health', 'route.ts');
  assert.deepEqual(auditHealthWiring(src), []);
  // 판정만 하고 버리는 꼴·import 누락을 전부 잡는다.
  assert.ok(auditHealthWiring(src.replace(/checks\.deployPin\s*=\s*/, 'const unused = ')).length > 0);
  assert.ok(auditHealthWiring(src.replace(/deployPinCheck\(/g, 'noop(')).length > 0);
  assert.ok(auditHealthWiring('').length > 0);
  // route.ts 는 HTTP 메서드·설정 외 export 금지(Vercel 빌드 실패 원인).
  const exports = [...src.matchAll(/^export\s+(?:async\s+function|const|function)\s+(\w+)/gm)].map((m) => m[1]);
  assert.deepEqual(exports.sort(), ['GET', 'dynamic']);
});

test('[실제 문서] RUNBOOK §5 가 세 줄로 되돌아가지 않는다', () => {
  const md = read('RUNBOOK.md');
  assert.deepEqual(auditRunbookRollback(md), []);

  // 되돌아간 문서(작성 당시의 세 줄)는 전부 잡힌다.
  const regressed = [
    '## 5. 배포 롤백 (코드 문제일 때)',
    '',
    '1. Vercel 배포 목록에서 직전 정상 배포를 Promote(롤백).',
    '2. `GET /api/health` 의 `commit` 이 롤백 대상과 일치하는지 확인.',
    '',
    '## 6. 복구 리허설 기록',
  ].join('\n');
  const problems = auditRunbookRollback(regressed);
  assert.ok(problems.length >= 5);
  assert.ok(problems.some((p) => /5-1/.test(p)));
  assert.ok(problems.some((p) => /AutoPush/.test(p)));
  assert.ok(problems.some((p) => new RegExp(PIN_ENV).test(p)));
  // §5 자체가 사라지면 구조 변경으로 보고한다(조용히 통과하지 않는다).
  assert.ok(auditRunbookRollback('# 빈 문서').length > 0);
});

test('[레지스트리] 고정 키가 정본과 RUNBOOK §4 양쪽에 있다', () => {
  const def = ENV_VARS.find((v) => v.key === PIN_ENV);
  assert.ok(def, `${PIN_ENV} 가 env 레지스트리에 없다 — 복구 목록에서 빠진다`);
  assert.equal(def.kind, 'config');
  assert.match(def.note, /§5|롤백/);
  const documented = parseDocumentedKeys(runbookSection4(read('RUNBOOK.md')));
  assert.ok(documented.includes(PIN_ENV), 'RUNBOOK §4 에 키가 없다');
});

test('모듈에 임의 기본값이 숨어 있지 않다(DB·fs·next 미접근, 쓰기·DDL 0)', () => {
  const src = read('src', 'lib', 'deployRollback.ts');
  assert.ok(!/(pinned|actual|commit)\s*(\?\?|\|\|)\s*['"][0-9a-f]{7}/i.test(src), '커밋 기본값 폴백이 있다');
  assert.ok(!/from\s+['"]@?\/?db|drizzle-orm|node:fs|next\//.test(src), 'DB·fs·next 를 가져온다');
  assert.ok(!/\b(insert into|update\s+\w+\s+set|delete from|create table|alter table)\b/i.test(src), '쓰기·DDL 이 섞여 있다');
  // 커밋 해시 리터럴을 모듈에 박아 두지 않는다(특정 배포를 기본 정상으로 삼으면 거짓 held 가 된다).
  assert.ok(!/['"][0-9a-f]{7,40}['"]/.test(src), '커밋 해시 리터럴이 있다');
});
