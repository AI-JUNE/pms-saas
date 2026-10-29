// **검증을 수행한 배포가 전환 뒤에도 같은 DB 를 쥐고 있다**(RUNBOOK §3-20 · §3 4·5·8단계). 2026-10-29
//
// 이 파일이 지키는 것은 하나다 — **4단계가 물려 둔 연결 문자열을 떼라고 말하는 자리가 있다.**
//  (1) 5단계는 그 브랜치를 **운영으로 승격**시키는데 그 배포는 값을 그대로 쥐고 있고,
//      2단계 차단은 운영 스코프의 env 라 그 배포는 **한 번도 잠기지 않는다**
//  (2) 기동마다 **소스에 하드코딩된 비밀번호**의 관리자가 되살아나 6-1단계 재적용을 무효로 만든다
//  (3) 전환 뒤 `checks.dbIdentity` 는 **양쪽에서 같은 지문**을 내므로 어느 응답도 그것을 말하지 않고,
//      사건 표지는 운영 스코프에 있어 그 배포는 전환 전·후를 **가려낼 수 없다**
//  (4) 그래서 판정은 「사고다」가 아니라 **「처분을 확정할 때다」**로만 말하고, `switchReady` 도
//      `/api/health` 도 건드리지 않는다(쥐고 있는 상태가 수행 중의 **정상**이다)
// 더해서 실제 4단계 라우트·헬스 라우트·절차 단위 정본·env 레지스트리·이 모듈과 RUNBOOK 원문을
// 대조해 문서와 코드가 함께 낡지 않게 한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  ACTION_POINTER_DETACHED, ACTION_POINTER_HOLDING, ACTION_POINTER_INVALID_REFERENCE,
  ACTION_POINTER_NOT_APPLICABLE, ACTION_POINTER_NO_REFERENCE, ACTION_POINTER_SCOPE_UNKNOWN,
  ACTION_POINTER_UNKNOWN, CAVEAT_POINTER_CODE_DOES_NOT_DETACH, CAVEAT_POINTER_PHASE,
  CAVEAT_POINTER_SELF_SCOPE, POINTER_BLIND_SPOTS, POINTER_LIMITS, POINTER_RUNBOOK_REF,
  POINTER_VERDICTS, REUSED_KEYS, VERIFIER_HOLDINGS,
  assessVerifierPointer, auditNoNewEnv, auditNoNewHealthCheck, auditPointerCanon,
  auditRunbookSource, auditSelfSource, auditVerifyWiring, pointerLine, pointerText,
  publicPointer, verifierPointerFromEnv, verifierPointerStatus,
} from '../src/lib/verifierPointer.ts';
import { dbFingerprint } from '../src/lib/dbIdentity.ts';
import { ENV_VARS } from '../src/lib/envRegistry.ts';
import { INCIDENT_MARKERS } from '../src/lib/healthDisclosure.ts';
import { TRANSIENT_KEYS } from '../src/lib/envPresence.ts';
import { PROCEDURE_UNITS } from '../src/lib/rehearsalCoverage.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (...rel: string[]) => fs.readFileSync(path.join(ROOT, ...rel), 'utf8');
const RUNBOOK = read('RUNBOOK.md');
const SELF_SRC = read('src', 'lib', 'verifierPointer.ts');
const VERIFY_SRC = read('src', 'app', 'api', 'admin', 'recovery-verify', 'route.ts');
const HEALTH_SRC = read('src', 'app', 'api', 'health', 'route.ts');

/** 복구 브랜치(전환으로 운영이 되는 쪽)와 전혀 다른 브랜치 */
const RECOVERED = 'postgres://u:p@ep-recovered-123.ap-southeast-1.aws.neon.tech/pms';
const OTHER = 'postgres://u:p@ep-other-999.ap-southeast-1.aws.neon.tech/pms';
const RECOVERED_FP = dbFingerprint(RECOVERED) as string;

/** 4단계를 수행한(= 운영이 아닌) 배포의 스냅샷 */
const verifier = (over: Record<string, string | undefined> = {}) => ({
  VERCEL_ENV: 'preview',
  DATABASE_URL: RECOVERED,
  ...over,
});

/* ─────────────────────────────── 정본 ─────────────────────────────── */

test('정본: 남는 것 넷이 어디에·무엇이 닿는지·누가 떼는지와 함께 적혀 있다', () => {
  assert.deepEqual(auditPointerCanon(), []);
  assert.equal(VERIFIER_HOLDINGS.length, 4, '남는 것의 수가 바뀌었다 — §3-20 표를 함께 볼 것');
  assert.deepEqual(
    VERIFIER_HOLDINGS.map((h) => h.key),
    ['db_pointer', 'unfrozen_writes', 'boot_admin_regrant', 'guest_demo_seed'],
  );
  // ⬅ 이 절의 전제: 전건 **전환 뒤 운영 DB 에 닿는다**
  assert.ok(VERIFIER_HOLDINGS.every((h) => h.reachesProduction));
  // ⬅ 그리고 전건 **사람이 떼야 한다** — 코드는 다른 배포의 env 를 고치지 못한다
  assert.ok(VERIFIER_HOLDINGS.every((h) => h.removedBy.includes('사람')));
});

test('정본: 닿지 않는다고 선언된 항목·설명이 빈 항목은 CI 에서 걸린다', () => {
  assert.ok(auditPointerCanon([]).length > 0);
  assert.ok(auditPointerCanon(VERIFIER_HOLDINGS.map((h) => ({ ...h, reachesProduction: false }))).length > 0);
  assert.ok(auditPointerCanon(VERIFIER_HOLDINGS.map((h) => ({ ...h, removedBy: ' ' }))).length > 0);
  assert.ok(auditPointerCanon(VERIFIER_HOLDINGS.map((h) => ({ ...h, consequence: '' }))).length > 0);
  assert.ok(auditPointerCanon(VERIFIER_HOLDINGS.map((h) => ({ ...h, origin: '' }))).length > 0);
  assert.ok(auditPointerCanon(VERIFIER_HOLDINGS.map((h) => ({ ...h, acquiredIn: '' }))).length > 0);
  assert.ok(auditPointerCanon([...VERIFIER_HOLDINGS, VERIFIER_HOLDINGS[0]]).length > 0, '중복 키');
  assert.ok(auditPointerCanon(VERIFIER_HOLDINGS, []).length > 0, '사각지대가 비면 안 된다');
  assert.ok(auditPointerCanon(VERIFIER_HOLDINGS, [{ key: 'x', what: '', why: '' }]).length > 0);
});

test('정본: 사각지대 여섯에 **왜 어떤 판정도 말하지 못하는가**가 들어 있다', () => {
  assert.equal(POINTER_BLIND_SPOTS.length, 6);
  assert.deepEqual(POINTER_BLIND_SPOTS.map((s) => s.key), [
    'phase_indistinguishable', 'other_deployment_invisible', 'reference_absent_by_default',
    'clear_step_is_elsewhere', 'rehearsal_dangling', 'direct_access_unseen',
  ]);
  // 전환 전·후를 가려낼 수 없다는 사실이 이 장치의 한계이자 설계 근거다
  assert.match(POINTER_BLIND_SPOTS[0].why, /같은 값/);
});

/* ─────────────────────────────── 판정 ─────────────────────────────── */

test('holding: 기준 지문의 DB 를 쥐고 있다 — 전환 전·후를 가려내지 않고 **결정을 요구한다**', () => {
  const a = assessVerifierPointer({ env: verifier({ RECOVERY_EXPECTED_DB: RECOVERED_FP }) });
  assert.equal(a.verdict, 'holding');
  assert.equal(a.role, 'preview');
  assert.equal(a.roleSource, 'VERCEL_ENV');
  assert.equal(a.decisionDue, true);
  assert.equal(a.action, ACTION_POINTER_HOLDING);
  // 「사고다」라고 말하지 않는다 — 수행 중이면 그것이 정상이다
  assert.match(a.action, /한쪽으로 확정/);
  assert.deepEqual(a.reachingProduction, VERIFIER_HOLDINGS.map((h) => h.key));
});

test('holding: 대문자·공백이 섞인 기준 지문도 같은 값으로 읽는다(판독은 dbIdentity 정본)', () => {
  const a = assessVerifierPointer({
    env: verifier({ RECOVERY_EXPECTED_DB: `  ${RECOVERED_FP.toUpperCase()} ` }),
  });
  assert.equal(a.verdict, 'holding');
  assert.equal(a.referenceConfigured, true);
  assert.equal(a.referenceReason, null);
});

test('detached: 가리키지 않는다 — **「안전하다」가 아니다**(죽은 브랜치일 수 있다)', () => {
  const a = assessVerifierPointer({ env: verifier({ DATABASE_URL: OTHER, RECOVERY_EXPECTED_DB: RECOVERED_FP }) });
  assert.equal(a.verdict, 'detached');
  assert.equal(a.decisionDue, false);
  assert.equal(a.action, ACTION_POINTER_DETACHED);
  assert.match(a.action, /죽은 브랜치/);
  // 할 일이 없는 판정은 없다 — 떼어졌어도 다음 4단계의 시작값을 확인해야 한다
  assert.equal(a.actionable, true);
});

test('no_reference: 기준 지문이 이 스코프에 없다 = **대조가 성립하지 않는다**(통과가 아니다)', () => {
  const a = assessVerifierPointer({ env: verifier() });
  assert.equal(a.verdict, 'no_reference');
  assert.equal(a.referenceConfigured, false);
  assert.equal(a.referenceReason, 'unset');
  assert.equal(a.decisionDue, false);
  assert.equal(a.action, ACTION_POINTER_NO_REFERENCE);
  // 기본 상태라는 사실을 함께 말한다 — 「넣지 않아 사고다」가 아니다
  assert.match(a.action, /기본 상태/);
  // 공백만 든 값도 미설정과 같게 읽는다
  assert.equal(assessVerifierPointer({ env: verifier({ RECOVERY_EXPECTED_DB: '   ' }) }).verdict, 'no_reference');
});

test('invalid_reference: 넣었는데 못 읽히는 쪽을 **따로** 말한다 — 할 일이 다르다', () => {
  const bad = assessVerifierPointer({ env: verifier({ RECOVERY_EXPECTED_DB: 'nope' }) });
  assert.equal(bad.verdict, 'invalid_reference');
  assert.equal(bad.referenceReason, 'malformed');
  assert.equal(bad.action, ACTION_POINTER_INVALID_REFERENCE);
  // 연결 문자열을 기준값으로 넣는 것은 시크릿 복제다 — 거절된다
  const conn = assessVerifierPointer({ env: verifier({ RECOVERY_EXPECTED_DB: RECOVERED }) });
  assert.equal(conn.verdict, 'invalid_reference');
  assert.equal(conn.referenceReason, 'connection_string');
  assert.equal(conn.decisionDue, false);
});

test('pointer_unknown: **가리키는 곳을 모른다** ≠ 가리키지 않는다 — 기준값 유무보다 먼저다', () => {
  const a = assessVerifierPointer({ env: { VERCEL_ENV: 'preview', RECOVERY_EXPECTED_DB: RECOVERED_FP } });
  assert.equal(a.verdict, 'pointer_unknown');
  assert.equal(a.pointerKnown, false);
  assert.equal(a.pointerReason, 'unset');
  assert.equal(a.action, ACTION_POINTER_UNKNOWN);
  // 기준값도 함께 없을 때에도 `no_reference` 로 내려가지 않는다(할 일이 「키를 넣는 것」으로 읽힌다)
  assert.equal(assessVerifierPointer({ env: { VERCEL_ENV: 'preview' } }).verdict, 'pointer_unknown');
  // 호스트 모양이 아닌 값도 「모른다」다 — 지어내지 않는다
  const nohost = assessVerifierPointer({ env: verifier({ DATABASE_URL: 'postgres://u:p@/pms' }) });
  assert.equal(nohost.verdict, 'pointer_unknown');
});

test('not_applicable: 운영 배포의 응답은 **다른 배포의 포인터를 보지 못한다**(§3-13)', () => {
  const a = assessVerifierPointer({
    env: { VERCEL_ENV: 'production', DATABASE_URL: RECOVERED, RECOVERY_EXPECTED_DB: RECOVERED_FP },
  });
  assert.equal(a.verdict, 'not_applicable');
  assert.equal(a.decisionDue, false);
  assert.equal(a.action, ACTION_POINTER_NOT_APPLICABLE);
  // 운영에서 같은 지문이 나오는 것은 **정상**이다 — 그래서 holding 으로 올리지 않는다
  assert.match(a.action, /같은 지문/);
});

test('scope_unknown: 역할을 모르면 「운영이 아니다」로도 올리지 않는다 — 임의 귀속 금지', () => {
  const a = assessVerifierPointer({ env: { DATABASE_URL: RECOVERED, RECOVERY_EXPECTED_DB: RECOVERED_FP } });
  assert.equal(a.verdict, 'scope_unknown');
  assert.equal(a.role, 'unknown');
  assert.equal(a.roleSource, null);
  assert.equal(a.action, ACTION_POINTER_SCOPE_UNKNOWN);
  // 인자 없이 불러도 터지지 않고 같은 자리에서 멈춘다
  assert.equal(assessVerifierPointer().verdict, 'scope_unknown');
  assert.equal(verifierPointerFromEnv().verdict, 'scope_unknown');
});

test('로컬 개발(development)도 판정 대상이다 — 같은 연결 문자열을 쥔 런타임이다', () => {
  const a = assessVerifierPointer({
    env: { NODE_ENV: 'development', DATABASE_URL: RECOVERED, RECOVERY_EXPECTED_DB: RECOVERED_FP },
  });
  assert.equal(a.role, 'development');
  assert.equal(a.roleSource, 'NODE_ENV');
  assert.equal(a.verdict, 'holding');
});

test('판정 순서: 역할 → 운영 → 포인터 → 깨진 기준값 → 없는 기준값 → 쥠/떼어짐', () => {
  // 역할을 모르면 포인터·기준값이 깨져 있어도 그 앞에서 멈춘다
  assert.equal(assessVerifierPointer({ env: { RECOVERY_EXPECTED_DB: 'nope' } }).verdict, 'scope_unknown');
  // 운영이면 포인터를 못 읽어도 not_applicable 이다(그 판정은 이 배포의 일이 아니다)
  assert.equal(assessVerifierPointer({ env: { VERCEL_ENV: 'production' } }).verdict, 'not_applicable');
  // 포인터를 못 읽으면 기준값이 깨져 있어도 pointer_unknown 이 먼저다
  assert.equal(
    assessVerifierPointer({ env: { VERCEL_ENV: 'preview', RECOVERY_EXPECTED_DB: 'nope' } }).verdict,
    'pointer_unknown',
  );
  // 전건이 POINTER_VERDICTS 안에 있다
  const seen = new Set(POINTER_VERDICTS);
  for (const env of [
    {}, { VERCEL_ENV: 'production' }, { VERCEL_ENV: 'preview' },
    verifier(), verifier({ RECOVERY_EXPECTED_DB: 'nope' }),
    verifier({ RECOVERY_EXPECTED_DB: RECOVERED_FP }),
    verifier({ DATABASE_URL: OTHER, RECOVERY_EXPECTED_DB: RECOVERED_FP }),
  ]) {
    assert.ok(seen.has(assessVerifierPointer({ env }).verdict));
  }
});

test('정본을 넘겨도 판정은 그대로다 — 쥐고 있는 목록은 판정의 입력이 아니다', () => {
  const a = assessVerifierPointer({
    env: verifier({ RECOVERY_EXPECTED_DB: RECOVERED_FP }),
    holdings: [VERIFIER_HOLDINGS[0]],
  });
  assert.equal(a.verdict, 'holding');
  assert.deepEqual(a.holdings, ['db_pointer']);
});

/* ─────────────────────────────── 출력 ─────────────────────────────── */

test('출력: 지문·연결 문자열·env 값이 어디에도 담기지 않는다', () => {
  const a = assessVerifierPointer({ env: verifier({ RECOVERY_EXPECTED_DB: RECOVERED_FP }) });
  const line = pointerLine(a);
  const textOut = pointerText(a);
  const pub = JSON.stringify(publicPointer(a));
  for (const out of [line, textOut, pub]) {
    assert.ok(!out.includes(RECOVERED_FP), '지문이 출력에 들어갔다');
    assert.ok(!out.includes('neon.tech'), '호스트가 출력에 들어갔다');
    assert.ok(!out.includes('u:p@'), '자격증명이 출력에 들어갔다');
  }
  assert.match(line, /pointer=holding/);
  assert.match(line, /decision_due=true/);
  assert.match(textOut, /처분 확정이 필요한가: 그렇다/);
  // 남는 것 넷과 떼는 방법이 사람이 읽는 출력에 함께 나온다
  for (const h of VERIFIER_HOLDINGS) assert.ok(textOut.includes(h.key));
  assert.ok(textOut.includes('떼는 것:'));
  // 보장하지 못하는 것이 함께 실려 나간다
  for (const c of POINTER_LIMITS) assert.ok(textOut.includes(c));
});

test('출력: 판정이 성립하지 않을 때도 **왜** 성립하지 않는지 적는다', () => {
  const t = pointerText(assessVerifierPointer({ env: { VERCEL_ENV: 'preview' } }));
  assert.match(t, /읽을 수 없음\(unset\)/);
  assert.match(t, /기준 지문 없음\/못 읽음/);
  assert.match(t, /아니다\(판정이 성립하지 않거나 떼어졌다\)/);
  const u = pointerText(assessVerifierPointer({ env: {} }));
  assert.match(u, /판독 불가/);
});

test('공개 필터: 판정·역할·목록·할 일·한계·근거 절만 — 지문 필드가 아예 없다', () => {
  const pub = publicPointer(assessVerifierPointer({ env: verifier({ RECOVERY_EXPECTED_DB: RECOVERED_FP }) }));
  assert.deepEqual(Object.keys(pub).sort(), [
    'action', 'caveats', 'decisionDue', 'holdings', 'reachingProduction', 'role', 'runbook', 'verdict',
  ]);
  assert.equal(pub.runbook, POINTER_RUNBOOK_REF);
  assert.equal(pub.caveats, POINTER_LIMITS);
  assert.ok(POINTER_LIMITS.includes(CAVEAT_POINTER_CODE_DOES_NOT_DETACH));
  assert.ok(POINTER_LIMITS.includes(CAVEAT_POINTER_SELF_SCOPE));
  assert.ok(POINTER_LIMITS.includes(CAVEAT_POINTER_PHASE));
});

test('요약: 신규 env 가 **0** 이라는 사실을 요약이 들고 있다', () => {
  const s = verifierPointerStatus(verifier({ RECOVERY_EXPECTED_DB: RECOVERED_FP }));
  assert.equal(s.verdict, 'holding');
  assert.equal(s.role, 'preview');
  assert.equal(s.decisionDue, true);
  assert.equal(s.holdings, VERIFIER_HOLDINGS.length);
  assert.equal(s.blindSpots, POINTER_BLIND_SPOTS.length);
  assert.equal(s.limits, POINTER_LIMITS.length);
  assert.equal(s.newEnvKeys, 0);
  assert.equal(verifierPointerStatus().verdict, 'scope_unknown');
});

/* ───────────────────────── 재사용·표지 규율 ───────────────────────── */

test('신규 env 0: 재사용하는 세 키가 전부 레지스트리에 있고 **새 키를 만들지 않았다**', () => {
  const keys = ENV_VARS.map((v) => v.key);
  assert.deepEqual(auditNoNewEnv(keys), []);
  assert.deepEqual([...REUSED_KEYS].sort(), ['DATABASE_URL', 'RECOVERY_EXPECTED_DB', 'VERCEL_ENV']);
  assert.ok(auditNoNewEnv([]).length > 0, '레지스트리를 못 읽으면 그 사실을 말한다');
  assert.ok(auditNoNewEnv(keys, ['RECOVERY_POINTER_SOMETHING']).length > 0, '새 키는 CI 에서 걸린다');
  // 사건 표지도 임시 키도 늘지 않았다 — 늘면 8단계 4번에서 지울 것이 늘고 하나만 남아도 물려받는다
  const marked = new Set<string>([...INCIDENT_MARKERS.map((m) => m.key), ...TRANSIENT_KEYS]);
  assert.ok(!marked.has('RECOVERY_VERIFIER_POINTER'));
  assert.ok(!SELF_SRC.includes('INCIDENT_MARKERS'), '이 절은 표지를 만들지 않는다');
});

test('절차 단위 3-20 이 리허설 정본에 등록돼 있다 ⬅ 등록하지 않으면 범위 판정이 그대로 ok 가 된다', () => {
  const unit = PROCEDURE_UNITS.find((u) => u.key === '3-20');
  assert.ok(unit, '§3-20 이 절차 단위로 등록되지 않았다');
  assert.equal(unit!.cited, true);
  assert.ok(unit!.skipped.includes('포인터'));
});

/* ───────────────────────── 실제 원문 대조 ───────────────────────── */

test('이 모듈 원문: 역할·지문 판독을 **복제하지 않고** process.env 에 닿지 않는다', () => {
  assert.deepEqual(auditSelfSource(SELF_SRC), []);
  assert.ok(auditSelfSource('').length > 0);
  assert.ok(auditSelfSource("const r = env.VERCEL_ENV; deploymentRole(); identify(); parseExpected();").length > 0);
  assert.ok(auditSelfSource('deploymentRole(); identify(); parseExpected(); process.env.X').length > 0);
  assert.ok(auditSelfSource('deploymentRole(); identify(); parseExpected(); fingerprintOf(x)').length > 0);
  assert.ok(auditSelfSource('deploymentRole(); identify();').length > 0, 'parseExpected 누락');
});

test('4단계 라우트 원문: 판정을 **응답에 실어** 보내고 게이트에는 끼어들지 않는다', () => {
  assert.deepEqual(auditVerifyWiring(VERIFY_SRC), []);
  // 판정만 하고 버리는 꼴
  assert.ok(auditVerifyWiring(VERIFY_SRC.replace(/pointer: publicPointer\(pointer\)/, '')).length > 0);
  // 공개 필터를 거치지 않으면 지문·env 값이 섞일 수 있다
  assert.ok(auditVerifyWiring(VERIFY_SRC.replace(/publicPointer\(/g, 'rawPointer(')).length > 0);
  // 호출 자체가 빠진 경우
  assert.ok(auditVerifyWiring(VERIFY_SRC.replace(/assessVerifierPointer\(/g, 'noop(')).length > 0);
  assert.ok(auditVerifyWiring(VERIFY_SRC.replace(/@\/lib\/verifierPointer/g, '@/lib/other')).length > 0);
  // **수행 중을 거짓 차단으로 만드는 배선**은 CI 에서 막는다
  assert.ok(
    auditVerifyWiring(`${VERIFY_SRC}\nconst g = gateSwitchReady(result, pointer, idDecision);`).length > 0,
  );
  assert.ok(auditVerifyWiring('').length > 0);
});

test('헬스 라우트 원문: **새 체크를 만들지 않았다** ⬅ 수행 중인 배포가 상시 degraded 가 된다', () => {
  assert.deepEqual(auditNoNewHealthCheck(HEALTH_SRC), []);
  assert.ok(auditNoNewHealthCheck("import { x } from '@/lib/verifierPointer';").length > 0);
  assert.ok(auditNoNewHealthCheck('checks.verifierPointer = foo();').length > 0);
  // 4단계 라우트에서만 나간다 — 운영 배포에서는 늘 not_applicable 이라 할 말이 없다
  assert.ok(!HEALTH_SRC.includes('verifierPointer'));
});

test('RUNBOOK 원문: §3-20 과 **그것을 가리키는 4·5·8단계**가 함께 남아 있다', () => {
  assert.deepEqual(auditRunbookSource(RUNBOOK), []);
  assert.ok(auditRunbookSource('').length > 0);
  // 절이 사라지면
  assert.ok(auditRunbookSource(RUNBOOK.replace(/^### 3-20\./m, '### 3-99.')).length > 0);
  // 산출 명령이 사라지면 담당자가 판정을 뜰 수 없다
  assert.ok(
    auditRunbookSource(
      RUNBOOK.replace(/pointerText\(/g, 'x(').replace(/assessVerifierPointer\(/g, 'y('),
    ).length > 0,
  );
  // 판정 표에서 한 행이 빠지면 응답의 뜻을 읽을 자리가 없다
  assert.ok(auditRunbookSource(RUNBOOK.replace(/`no_reference`/g, '`n/a`')).length > 0);
  // 사각지대·표 행이 빠지면
  assert.ok(auditRunbookSource(RUNBOOK.replace(/rehearsal_dangling/g, 'x')).length > 0);
  assert.ok(auditRunbookSource(RUNBOOK.replace(/boot_admin_regrant/g, 'x')).length > 0);
});

test('RUNBOOK 원문: 세 단계 중 하나라도 유도를 잃으면 CI 가 실패한다', () => {
  const sec3 = RUNBOOK.match(/^## 3\. [\s\S]*?(?=^### 3-1\.)/m)![0];
  const steps = {
    4: sec3.slice(sec3.search(/^4\.\s/m)).split(/^5\.\s/m)[0],
    5: sec3.slice(sec3.search(/^5\.\s/m)).split(/^6\.\s/m)[0],
    8: sec3.slice(sec3.search(/^8\.\s/m)).split(/^>\s/m)[0],
  };
  for (const [step, body] of Object.entries(steps)) {
    assert.ok(body.includes('3-20'), `${step}단계가 §3-20 으로 유도하지 않는다`);
    // 그 단계에서 유도만 지워도 걸린다(절은 그대로 남아 있다)
    assert.ok(
      auditRunbookSource(RUNBOOK.replace(body, body.replace(/3-20/g, '3-19'))).length > 0,
      `${step}단계 유도가 사라졌는데 CI 가 통과한다`,
    );
  }
});

test('RUNBOOK 원문: 체크리스트가 **지우기 전에** 포인터를 처분하라고 지시한다', () => {
  const at = RUNBOOK.search(/^### 리허설 체크리스트/m);
  const checklist = RUNBOOK.slice(at);
  assert.ok(checklist.includes('3-20'), '체크리스트가 §3-20 을 인용하지 않는다');
  assert.ok(/pointer\.verdict/.test(checklist));
  // 표지를 지우는 항목들보다 **앞에** 나와야 한다 — 지운 뒤에는 근거가 없다
  const iPointer = checklist.indexOf('포인터의 처분을 확정');
  const iClear = checklist.indexOf('`RECOVERY_RESTORE_POINT` 를 지웠다');
  assert.ok(iPointer > 0 && iClear > iPointer, '처분 확정이 표지 삭제보다 뒤에 있다');
  // 그리고 마지막 「브랜치 정리」보다 앞이다(죽은 브랜치를 가리킨 값이 다음 수행의 시작값이 된다)
  // ※ 같은 문구가 §3-17 항목에서 먼저 인용되므로 **마지막** 자리로 찾는다
  assert.ok(checklist.lastIndexOf('리허설 브랜치 정리') > iPointer);
  // §6-9: 저장소 파일의 칸은 전부 비어 있다
  assert.ok(!/^- \[x\]/m.test(checklist), '체크리스트 칸이 체크된 채 커밋됐다');
});
