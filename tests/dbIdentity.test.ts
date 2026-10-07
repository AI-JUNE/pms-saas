/**
 * dbIdentity.test.ts — RUNBOOK §3 5단계(전환) 반영 확인. 2026-10-07
 *
 * ── 왜 필요한가 ──────────────────────────────────────────────────────────────
 * 5단계는 「운영 `DATABASE_URL` 을 복구 브랜치로 교체하고 재배포한다」는 한 문장이고,
 * 그 교체가 **반영됐는지** 보는 수단이 없었다. 반영되지 않아도(재배포 누락·스코프 실수)
 * `checks.db` 는 `select 1` 이라 ok, 6단계 `schema.verdict` 는 손상된 DB 에도 테이블이 다
 * 있으므로 ok 가 나온다 — **복구는 「성공」으로 끝나고 복구된 데이터는 아무도 쓰지 않는다.**
 *
 * 그래서 (1) 지문 판정 자체와 (2) 배선(health·4단계 라우트·DB 클라이언트가 읽는 키)을
 * 파일 수준에서 고정한다. 특히 DB 클라이언트가 다른 연결 키로 옮겨 가면 지문은 엉뚱한
 * DB 를 가리키면서 계속 `match` 를 내므로, 그 회귀를 CI 에서 잡는다.
 *
 * 이 테스트는 **파일만 읽는다** — 네트워크·DB 를 쓰지 않고 process.env 도 바꾸지 않는다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  ACTION_IDENTITY_MISMATCH,
  DB_URL_ENV,
  EXPECTED_DB_ENV,
  FINGERPRINT_LEN,
  IDENTITY_LIMITS,
  auditClientSource,
  auditHealthWiring,
  auditVerifyWiring,
  canonicalTarget,
  compareIdentity,
  dbFingerprint,
  dbIdentityCheck,
  dbIdentityStatus,
  expectedFromEnv,
  gateSwitchReady,
  identityFromEnv,
  hostShape,
  identify,
  identityLogLine,
  identityReport,
  maskHost,
  parseConnection,
  parseExpected,
  publicIdentity,
} from '../src/lib/dbIdentity.ts';
import { ENV_VARS } from '../src/lib/envRegistry.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (...p: string[]) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

// 실제 비밀번호가 아닌 명백한 더미. 지문 계산에는 호스트·DB 만 쓰인다.
const PROD = 'postgresql://owner:dummy-pw@ep-prod-branch-11112222.ap-southeast-1.aws.neon.tech/neondb?sslmode=require';
const RECOVERED = 'postgresql://owner:dummy-pw@ep-restore-br-33334444.ap-southeast-1.aws.neon.tech/neondb?sslmode=require';

// ── 연결 문자열 파싱 ────────────────────────────────────────────────────────

test('parseConnection: 식별 정보만 뽑고 비밀번호·사용자명은 결과에 담지 않는다', () => {
  const p = parseConnection(PROD);
  assert.equal(p.ok, true);
  if (!p.ok) return;
  assert.equal(p.target.host, 'ep-prod-branch-11112222.ap-southeast-1.aws.neon.tech');
  assert.equal(p.target.database, 'neondb');
  assert.equal(p.target.hasPassword, true);
  assert.equal(p.target.port, null);
  // 결과 객체 어디에도 비밀번호·사용자명이 없다(직렬화해서 확인 — 로그·응답에 섞여도 안 된다).
  const dump = JSON.stringify(p.target);
  assert.ok(!dump.includes('dummy-pw'), '비밀번호가 파싱 결과에 남는다');
  assert.ok(!dump.includes('owner'), '사용자명이 파싱 결과에 남는다');
});

test('parseConnection: 모르는 꼴은 추측하지 않고 이유를 돌려준다', () => {
  const cases: Array<[unknown, string]> = [
    ['', 'unset'],
    ['   ', 'unset'],
    [undefined, 'unset'],
    [null, 'unset'],
    ['ep-x.aws.neon.tech/neondb', 'not_a_url'],
    ['mysql://u:p@h/db', 'unsupported_scheme'],
    ['https://example.com/db', 'unsupported_scheme'],
    ['postgres:///neondb', 'no_host'],
  ];
  for (const [input, reason] of cases) {
    const p = parseConnection(input);
    assert.equal(p.ok, false, String(input));
    if (!p.ok) assert.equal(p.reason, reason, String(input));
  }
});

test('parseConnection: 비밀번호에 @ 나 / 가 섞여도 호스트를 잘못 읽지 않는다', () => {
  const p = parseConnection('postgres://u:p@ss/w@rd@db.internal:5433/app');
  assert.equal(p.ok, true);
  if (!p.ok) return;
  assert.equal(p.target.host, 'db.internal');
  assert.equal(p.target.port, 5433);
  assert.equal(p.target.database, 'app');
  // 포트가 숫자가 아니면 지어내지 않는다.
  const bad = parseConnection('postgres://u:p@db.internal:port/app');
  assert.equal(bad.ok && bad.target.port, null);
});

test('parseConnection: IPv6·비표준 호스트도 읽고, 모양이 아니면 no_host 로 둔다', () => {
  const p = parseConnection('postgres://u:p@[2001:db8::1]:5432/app');
  assert.equal(p.ok, true);
  if (!p.ok) return;
  assert.equal(p.target.host, '2001:db8::1');
  assert.equal(p.target.port, 5432);
  // 포트 없는 IPv6.
  const noPort = parseConnection('postgres://u:p@[::1]/app');
  assert.equal(noPort.ok && noPort.target.port, null);
  // 자체 호스팅은 호스트:포트가 지문에 들어간다(Neon 과 달리 포트가 대상을 가른다).
  const own = parseConnection('postgres://u:p@db.internal:5433/app');
  assert.equal(own.ok && canonicalTarget(own.target), 'db.internal:5433|app');
  assert.notEqual(
    dbFingerprint('postgres://u:p@db.internal:5433/app'),
    dbFingerprint('postgres://u:p@db.internal:5544/app'),
  );
  // 호스트 모양이 아니면 추측하지 않는다(거짓 match 를 만들지 않는다).
  for (const bad of ['postgres://u:p@-bad-/app', 'postgres://u:p@[zz::1]/app', 'postgres://u:p@ /app']) {
    const r = parseConnection(bad);
    assert.equal(r.ok, false, bad);
    if (!r.ok) assert.equal(r.reason, 'no_host', bad);
  }
});

test('*FromEnv: 실제 배포가 읽는 키에서 값을 가져온다', () => {
  const fp = dbFingerprint(RECOVERED)!;
  assert.equal(identityFromEnv({ DATABASE_URL: RECOVERED }).fingerprint, fp);
  assert.equal(identityFromEnv({}).known, false);
  assert.deepEqual(expectedFromEnv({ RECOVERY_EXPECTED_DB: fp }), { ok: true, fingerprint: fp });
  assert.deepEqual(expectedFromEnv({}), { ok: false, reason: 'unset' });
});

// ── 호스트 모양 ─────────────────────────────────────────────────────────────

test('hostShape: Neon 엔드포인트를 읽고, Neon 이 아니면 추측하지 않는다', () => {
  const s = hostShape('ep-restore-br-33334444.ap-southeast-1.aws.neon.tech');
  assert.deepEqual(s, {
    provider: 'neon',
    endpointId: 'ep-restore-br-33334444',
    pooled: false,
    region: 'ap-southeast-1',
  });
  assert.equal(hostShape('ep-restore-br-33334444-pooler.ap-southeast-1.aws.neon.tech').pooled, true);
  // neon.tech 가 아니면 provider unknown, 엔드포인트를 만들어 내지 않는다.
  const own = hostShape('db.internal');
  assert.equal(own.provider, 'unknown');
  assert.equal(own.endpointId, null);
  assert.equal(own.region, null);
  // neon.tech 이지만 모양이 다르면 엔드포인트만 null 로 둔다.
  assert.equal(hostShape('weird.ap-southeast-1.aws.neon.tech').endpointId, null);
});

// ── 지문 ────────────────────────────────────────────────────────────────────

test('dbFingerprint: 다른 브랜치는 다른 지문, pooled·직결은 같은 지문', () => {
  const prod = dbFingerprint(PROD);
  const rec = dbFingerprint(RECOVERED);
  assert.ok(prod && new RegExp(`^[0-9a-f]{${FINGERPRINT_LEN}}$`).test(prod), prod ?? 'null');
  assert.notEqual(prod, rec, '운영과 복구 브랜치가 같은 지문이면 전환 확인이 불가능하다');
  // 같은 입력은 항상 같은 지문(사람이 눈으로 비교한다).
  assert.equal(dbFingerprint(PROD), prod);
  // pooled 경유는 같은 브랜치 — 의도적으로 같은 지문이다.
  const pooled = dbFingerprint(RECOVERED.replace('33334444.', '33334444-pooler.'));
  assert.equal(pooled, rec, 'pooled 경유가 다른 DB 로 오인된다');
  // 쿼리스트링(sslmode)·자격증명은 지문에 영향을 주지 않는다.
  assert.equal(dbFingerprint(RECOVERED.replace('?sslmode=require', '')), rec);
  assert.equal(dbFingerprint(RECOVERED.replace('owner:dummy-pw', 'other:other-pw')), rec);
  // DB 이름이 다르면 다른 지문이다.
  assert.notEqual(dbFingerprint(RECOVERED.replace('/neondb', '/otherdb')), rec);
  assert.equal(dbFingerprint('not-a-url'), null);
});

test('canonicalTarget·maskHost: 지문 대상에도 자격증명이 들어가지 않는다', () => {
  const p = parseConnection(PROD);
  assert.equal(p.ok, true);
  if (!p.ok) return;
  const canon = canonicalTarget(p.target);
  assert.ok(!canon.includes('dummy-pw') && !canon.includes('owner'), canon);
  assert.equal(canon, 'ep-prod-branch-11112222|neondb');
  // 마스킹된 호스트는 전체를 적지 않지만 도메인으로 방향을 잡을 수 있다.
  const masked = maskHost('ep-prod-branch-11112222.ap-southeast-1.aws.neon.tech');
  assert.ok(masked && masked.includes('…'), masked ?? 'null');
  assert.ok(masked && !masked.includes('prod-branch-1111'), masked ?? 'null');
  assert.ok(masked && masked.endsWith('.ap-southeast-1.aws.neon.tech'));
  assert.equal(maskHost(''), null);
  assert.equal(maskHost('short.io'), 'short.io');
});

test('identify·publicIdentity: 공개 응답에 호스트·DB 이름·자격증명을 담지 않는다', () => {
  const id = identify(PROD);
  assert.equal(id.known, true);
  assert.equal(id.provider, 'neon');
  assert.equal(id.database, 'neondb');
  const pub = JSON.stringify(publicIdentity(id));
  for (const leak of ['neondb', 'ep-prod', 'dummy-pw', 'owner', 'neon.tech']) {
    assert.ok(!pub.includes(leak), `공개 식별 정보에 ${leak} 가 들어 있다: ${pub}`);
  }
  // 못 읽은 경우에도 모양이 유지되고 known: false 로 남는다.
  const un = identify('nope');
  assert.equal(un.known, false);
  assert.equal(un.fingerprint, null);
  assert.equal(un.reason, 'not_a_url');
});

// ── 기준 지문 ───────────────────────────────────────────────────────────────

test('parseExpected: 연결 문자열은 비교하지 않고 거절한다(비밀번호 재복제 방지)', () => {
  const fp = dbFingerprint(RECOVERED)!;
  assert.deepEqual(parseExpected(` ${fp.toUpperCase()} `), { ok: true, fingerprint: fp });
  assert.deepEqual(parseExpected(''), { ok: false, reason: 'unset' });
  assert.deepEqual(parseExpected(undefined), { ok: false, reason: 'unset' });
  assert.deepEqual(parseExpected(RECOVERED), { ok: false, reason: 'connection_string' });
  assert.deepEqual(parseExpected('owner@host'), { ok: false, reason: 'connection_string' });
  for (const bad of ['zzzzzzzzzzzz', 'abc', `${fp}00`, 'ep-restore-br']) {
    assert.deepEqual(parseExpected(bad), { ok: false, reason: 'malformed' }, bad);
  }
});

// ── 판정 ────────────────────────────────────────────────────────────────────

test('compareIdentity: 교체가 반영되지 않은 배포를 mismatch 로 드러낸다', () => {
  const expected = dbFingerprint(RECOVERED)!;

  // 전환 반영됨 — 복구 브랜치를 본다.
  const good = compareIdentity({ url: RECOVERED, expected });
  assert.equal(good.verdict, 'match');
  assert.equal(good.ok, true);
  assert.equal(good.trusted, true);
  assert.equal(good.blocksSwitch, false);

  // 재배포 누락·스코프 실수 — 아직 운영(손상) DB 를 본다. 이것이 이 모듈의 존재 이유다.
  const bad = compareIdentity({ url: PROD, expected });
  assert.equal(bad.verdict, 'mismatch');
  assert.equal(bad.ok, false);
  assert.equal(bad.trusted, false);
  assert.equal(bad.blocksSwitch, true);
  assert.equal(bad.action, ACTION_IDENTITY_MISMATCH);
  assert.match(bad.action, /재배포/, '재배포 누락을 안내하지 않는다');
});

test('compareIdentity: 모르는 상태를 「일치」로 올리지 않는다', () => {
  const expected = dbFingerprint(RECOVERED)!;

  // 기준값 미설정 = 평상시 상태 → ok 지만 trusted 는 아니다(확인된 바 없다).
  const unset = compareIdentity({ url: PROD, expected: '' });
  assert.equal(unset.verdict, 'unset');
  assert.equal(unset.ok, true);
  assert.equal(unset.trusted, false);
  assert.equal(unset.blocksSwitch, false, '임의 기준으로 전환을 막지 않는다');

  // 사람이 잘못 넣은 값은 비교하지 않는다.
  const invalid = compareIdentity({ url: PROD, expected: RECOVERED });
  assert.equal(invalid.verdict, 'invalid_expected');
  assert.equal(invalid.ok, false);
  assert.equal(invalid.expected, null, '못 읽은 기준값을 응답에 되돌려 주지 않는다');
  assert.equal(invalid.expectedReason, 'connection_string');

  // 연결 대상을 모르면 기준값 유무보다 그것이 먼저다(「문제 없음」으로 읽히면 안 된다).
  const unknown = compareIdentity({ url: '', expected: '' });
  assert.equal(unknown.verdict, 'unknown_actual');
  assert.equal(unknown.ok, false);
  assert.equal(unknown.trusted, false);
  const unknown2 = compareIdentity({ url: 'garbage', expected });
  assert.equal(unknown2.verdict, 'unknown_actual');
  assert.equal(unknown2.blocksSwitch, false, '읽지 못한 것을 불일치로 단정하지 않는다');
});

test('identityLogLine: 판정·지문만 남기고 연결 문자열을 남기지 않는다', () => {
  const line = identityLogLine(compareIdentity({ url: PROD, expected: dbFingerprint(RECOVERED)! }));
  assert.match(line, /^db_identity=mismatch /);
  for (const leak of ['dummy-pw', 'owner', 'neon.tech', 'neondb']) {
    assert.ok(!line.includes(leak), `로그에 ${leak} 가 남는다: ${line}`);
  }
});

test('identityLogLine·dbIdentityStatus: 판정별 꼬리표를 남긴다', () => {
  const pooled = compareIdentity({ url: RECOVERED.replace('33334444.', '33334444-pooler.'), expected: '' });
  assert.match(identityLogLine(pooled), /pooled=1/);
  assert.match(identityLogLine(compareIdentity({ url: 'nope', expected: '' })), /actual_reason=not_a_url/);
  assert.match(identityLogLine(compareIdentity({ url: PROD, expected: 'zz' })), /expected_reason=malformed/);
  // 일치 로그에는 기준값을 되풀이하지 않는다(불일치일 때만 붙인다).
  const fp = dbFingerprint(PROD)!;
  assert.ok(!identityLogLine(compareIdentity({ url: PROD, expected: fp })).includes('expected='));
  // 요약은 불일치면 할 일을 그대로 전달한다(자체 문구를 지어내지 않는다).
  const st = dbIdentityStatus({ DATABASE_URL: PROD, RECOVERY_EXPECTED_DB: dbFingerprint(RECOVERED)! });
  assert.equal(st.verdict, 'mismatch');
  assert.equal(st.note, ACTION_IDENTITY_MISMATCH);
  assert.equal(st.limits, IDENTITY_LIMITS.length);
  // 인자 없이 불러도(실제 배포 경로) 모양이 유지된다 — 값은 환경에 따라 다르므로 보지 않는다.
  assert.equal(typeof dbIdentityCheck().detail.verdict, 'string');
  assert.equal(typeof dbIdentityStatus().verdict, 'string');
});

// ── 사각지대 고지 ───────────────────────────────────────────────────────────

test('IDENTITY_LIMITS: 지문이 보장하지 못하는 것을 숨기지 않는다', () => {
  assert.ok(IDENTITY_LIMITS.length >= 5);
  const all = IDENTITY_LIMITS.join('\n');
  // 가장 위험한 착각들이 명시돼 있어야 한다.
  assert.match(all, /제자리 복구/, '제자리 복구는 지문이 바뀌지 않는다는 한계가 빠졌다');
  assert.match(all, /pooled/);
  assert.match(all, /데이터가 옳은지/);
  const check = dbIdentityCheck({ env: { DATABASE_URL: PROD, RECOVERY_EXPECTED_DB: dbFingerprint(RECOVERED)! } });
  assert.equal(check.ok, false);
  assert.equal(check.required, false, '불일치로 503 을 만들면 안 된다(degraded 로만 드러낸다)');
  assert.deepEqual(check.detail.limits, IDENTITY_LIMITS);
  // 공개 체크에 호스트·DB 이름·자격증명이 섞이지 않는다.
  const dump = JSON.stringify(check.detail);
  for (const leak of ['dummy-pw', 'owner', 'ep-prod', 'neondb']) {
    assert.ok(!dump.includes(leak), `헬스 응답에 ${leak} 가 들어 있다`);
  }
});

test('dbIdentityCheck: 평상시(기준 지문 미설정)에는 degraded 로 만들지 않는다', () => {
  const normal = dbIdentityCheck({ env: { DATABASE_URL: PROD } });
  assert.equal(normal.ok, true);
  assert.equal(normal.detail.verdict, 'unset');
  assert.equal(normal.detail.trusted, false);
  assert.equal(normal.detail.expectedSet, false);
  assert.equal(normal.detail.expectedKey, EXPECTED_DB_ENV);
  assert.deepEqual(normal.detail.limits, [], '평상시 응답을 한계 목록으로 채우지 않는다');
  const st = dbIdentityStatus({ DATABASE_URL: PROD });
  assert.equal(st.verdict, 'unset');
  assert.equal(st.trusted, false);
});

// ── 4단계 게이트 ────────────────────────────────────────────────────────────

test('gateSwitchReady: 다른 DB 를 세고 있으면 전환 가능 판정을 내린다', () => {
  const expected = dbFingerprint(RECOVERED)!;
  const base = { switchReady: true, action: '전환 가능', schema: { verdict: 'ok' } };

  // 스테이징이 운영(손상) DB 를 보고 있던 경우 — 행 수가 기준치를 넘어도 판정 대상이 다르다.
  const wrongId = identify(PROD);
  const blocked = gateSwitchReady(base, wrongId, compareIdentity({ identity: wrongId, expected }));
  assert.equal(blocked.switchReady, false);
  assert.equal(blocked.action, ACTION_IDENTITY_MISMATCH);
  assert.equal(blocked.identity.verdict, 'mismatch');
  assert.equal(blocked.identity.hostMasked !== null, true, '담당자가 어느 DB 인지 볼 수 있어야 한다');

  // 기준값이 없으면 기존 판정을 끌어내리지 않는다(임의 기준 금지).
  const id = identify(RECOVERED);
  const unset = gateSwitchReady(base, id, compareIdentity({ identity: id, expected: '' }));
  assert.equal(unset.switchReady, true);
  assert.equal(unset.action, '전환 가능');
  assert.equal(unset.identity.verdict, 'unset');

  // 원래 false 였던 판정을 지문이 true 로 올리지는 않는다.
  const notReady = gateSwitchReady({ switchReady: false, action: '행 수 부족' }, id, compareIdentity({ identity: id, expected }));
  assert.equal(notReady.switchReady, false);
  assert.equal(notReady.action, '행 수 부족');

  // 관리 응답에는 마스킹된 호스트·DB 이름까지 들어가되 자격증명은 없다.
  const rep = JSON.stringify(identityReport(id, compareIdentity({ identity: id, expected })));
  assert.ok(!rep.includes('dummy-pw') && !rep.includes('owner'), rep);
});

// ── 배선(원문 점검) ─────────────────────────────────────────────────────────

test('auditClientSource: DB 클라이언트가 다른 연결 키로 옮겨 가면 잡는다', () => {
  // 실제 파일 — 지문이 **실제 연결 대상**을 가리키는지의 근거다.
  assert.deepEqual(auditClientSource(read('src', 'db', 'index.ts')), []);
  // 다른 키로 바뀌면(지문이 엉뚱한 DB 를 가리키며 계속 match 를 낸다) 반드시 걸려야 한다.
  assert.ok(auditClientSource('const sql = neon(process.env.POSTGRES_URL!);').length > 0);
  assert.ok(auditClientSource(`const sql = neon(process.env.${DB_URL_ENV}! || process.env.PGURL!);`).length > 0);
  assert.ok(auditClientSource('').length > 0);
});

test('auditHealthWiring·auditVerifyWiring: 실제 라우트가 판정을 물고 있다', () => {
  assert.deepEqual(auditHealthWiring(read('src', 'app', 'api', 'health', 'route.ts')), []);
  assert.deepEqual(auditVerifyWiring(read('src', 'app', 'api', 'admin', 'recovery-verify', 'route.ts')), []);

  // 빠뜨리는 꼴을 실제로 잡는지 — 가드가 가드 역할을 하는지 확인한다.
  assert.ok(auditHealthWiring('checks.db = {};').length > 0);
  assert.ok(auditHealthWiring("import { dbIdentityCheck } from '@/lib/dbIdentity';").length > 0);
  // 게이트를 호출하고도 원본 결과를 응답하면(= switchReady 가 그대로 올라간다) 걸린다.
  const sneaky = `
    import { gateSwitchReady } from '@/lib/dbIdentity';
    const gated = gateSwitchReady(result, id, d);
    return ok(result);
  `;
  assert.ok(auditVerifyWiring(sneaky).some((p) => p.includes('ok()')), auditVerifyWiring(sneaky).join('|'));
  // 결과를 변수에 받지 않으면 응답에 실렸는지 확인할 수 없다 — 그것도 문제로 본다.
  const inline = "import { gateSwitchReady } from '@/lib/dbIdentity';\nreturn ok(gateSwitchReady(r, i, d));";
  assert.ok(auditVerifyWiring(inline).some((p) => p.includes('변수에 받지 않는다')));
  assert.ok(auditVerifyWiring('return ok(result);').length >= 2);
});

test('env 레지스트리·RUNBOOK 에 기준 지문 키가 등록돼 있다', () => {
  const def = ENV_VARS.find((v) => v.key === EXPECTED_DB_ENV);
  assert.ok(def, `${EXPECTED_DB_ENV} 가 env 레지스트리에 없다`);
  assert.equal(def?.kind, 'config');
  // RUNBOOK 에 산출 명령과 §3-4 절, 5단계 확인 문구가 남아 있어야 절차가 성립한다.
  const runbook = read('RUNBOOK.md');
  assert.match(runbook, /### 3-4\./);
  assert.match(runbook, /dbFingerprint/, '지문 산출 명령이 RUNBOOK 에 없다');
  assert.ok(runbook.includes(EXPECTED_DB_ENV));
  assert.ok(runbook.includes('checks.dbIdentity'), '5단계 확인 수단이 RUNBOOK 에 적혀 있지 않다');
  // 복구 브랜치 연결문자열을 명령행에 직접 붙여넣도록 안내하면 셸 히스토리에 비밀번호가 남는다.
  assert.match(runbook, /환경변수로 넘겨/, '지문 산출 명령의 비밀번호 취급 주의가 빠졌다');
});
