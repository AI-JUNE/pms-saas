/**
 * healthSignal.test.ts — 판정이 **누구에게 도달하는가**(RUNBOOK §2-2). 2026-10-17
 *
 * ── 왜 필요한가 ──────────────────────────────────────────────────────────────
 * §1~§6 의 기계적 판정은 전부 `GET /api/health` 의 `checks.*` 로 모이는데, 복구 관련 체크는
 * 전부 `required: false` 라 **`ok: true` + HTTP 200** 으로 나간다. 이 응답을 상시로 읽는 쪽
 * 셋(업타임 모니터=상태 코드 · `ok` 만 보는 감시자 · 오류 알림=예외만)은 **어느 쪽도 degraded 를
 * 보지 못한다.** 남은 통로인 사람의 §2 월 점검은 계기가 점검 자신이라 순환이고,
 * writeFreeze·incidentClosure·postRestoreSecurity·externalState 는 차단 중 수십 분만 쓸모가 있다.
 *
 * 그래서 (a) 판정 자체(degraded/필수실패 분리, 읽을 수 없는 모양은 **추측하지 않는다**),
 * (b) 값을 담지 않는 규율, (c) 배선(헤더·본문 `signal`·상태 코드 불변·CheckName 양방향 대조·§2-2)을
 * 파일 수준에서 고정한다. 이 테스트는 **파일만 읽는다** — 네트워크·DB 를 쓰지 않고
 * `process.env` 도 바꾸지 않는다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  ACTION_DEGRADED,
  ACTION_DOWN,
  ACTION_OK,
  ACTION_UNREADABLE,
  HEALTH_DEGRADED_HEADER,
  HEALTH_STATUS_HEADER,
  OBSERVERS,
  SIGNAL_LIMITS,
  SIGNAL_RUNBOOK_REF,
  TIME_BOUND_CHECKS,
  assessSignalReach,
  auditCheckWiring,
  auditHeaderWiring,
  auditRunbookSignal,
  auditTimeBoundNames,
  blindObservers,
  observerFor,
  signalHeaders,
  signalLogLine,
  signalStatus,
  signalText,
  standingObservers,
  timeBoundFor,
  withSignal,
} from '../src/lib/healthSignal.ts';
import { buildHealthBody } from '../src/lib/health.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (...p: string[]) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

const bodyWith = (checks: Record<string, unknown>) =>
  buildHealthBody({ checks: checks as never, uptimeSec: 12, now: new Date('2026-10-17T00:00:00Z') });

/* ─────────────────────────── 관측자 정본 ─────────────────────────── */

test('관측자 정본: 다섯이 전부 있고 칸이 비어 있지 않다', () => {
  assert.deepEqual(
    OBSERVERS.map((o) => o.id),
    ['status_code', 'ok_flag', 'error_alert', 'status_header', 'human_check'],
  );
  for (const o of OBSERVERS) {
    assert.ok(o.who.trim() && o.reads.trim() && o.why.trim() && o.source.trim(), `${o.id} 칸이 비었다`);
  }
  assert.equal(observerFor('status_code')!.seesDegraded, false);
  assert.equal(observerFor('없는관측자'), null);
});

test('상시 감시자 셋은 degraded 를 보지 못한다 ⬅ 이 모듈이 존재하는 이유', () => {
  // 상태 코드·ok 불리언·오류 알림 — 전부 상시인데 전부 못 본다.
  assert.deepEqual(blindObservers(), ['status_code', 'ok_flag', 'error_alert']);
  // 헤더만이 상태 코드를 바꾸지 않고 degraded 를 드러내는 상시 표면이다.
  assert.deepEqual(standingObservers(), ['status_header']);
  // 사람은 보지만 **상시가 아니다** — 계기가 §2 월 점검 자신이라 밀리면 함께 멈춘다(순환).
  const human = observerFor('human_check')!;
  assert.equal(human.seesDegraded, true);
  assert.equal(human.standing, false);
  assert.match(human.why, /순환/);
});

/* ─────────────────────────── 시한부 체크 정본 ─────────────────────────── */

test('시한부 체크 정본: 창이 닫히면 신호 자체가 사라지는 것들', () => {
  assert.deepEqual(
    TIME_BOUND_CHECKS.map((t) => t.name),
    ['writeFreeze', 'incidentClosure', 'lossNotice', 'postRestoreSecurity', 'externalState'],
  );
  for (const t of TIME_BOUND_CHECKS) {
    assert.ok(t.window.trim() && t.afterWindow.trim() && t.source.trim(), `${t.name} 칸이 비었다`);
  }
  // 창 설명은 쓰기 차단 스위치 이름을 코드에서 가져온다(문서를 베끼지 않는다).
  assert.match(TIME_BOUND_CHECKS[0].window, /RECOVERY_WRITE_FREEZE/);
  assert.equal(timeBoundFor('recovery'), null);
});

/* ─────────────────────────── 판정 ─────────────────────────── */

test('assessSignalReach: degraded 는 상태 코드에도 ok 플래그에도 나타나지 않는다', () => {
  const r = assessSignalReach(
    bodyWith({
      db: { ok: true, required: true },
      recovery: { ok: false, required: false },
      envPresence: { ok: false, required: false },
    }),
  );
  assert.equal(r.verdict, 'degraded');
  assert.equal(r.status, 'degraded');
  // 이름은 정렬해 돌려준다(응답이 요청마다 흔들리면 감시자가 조건을 걸 수 없다).
  assert.deepEqual(r.degraded, ['envPresence', 'recovery']);
  assert.deepEqual(r.failing, []);
  assert.equal(r.visibleToStatusCode, false);
  assert.equal(r.visibleToOkFlag, false);
  assert.deepEqual(r.blind, ['status_code', 'ok_flag', 'error_alert']);
  assert.ok(r.action.startsWith(ACTION_DEGRADED));
});

test('필수 체크 실패는 **503 으로 드러나므로** 사각지대가 아니다', () => {
  const r = assessSignalReach(bodyWith({ db: { ok: false, required: true }, recovery: { ok: false, required: false } }));
  assert.equal(r.verdict, 'down');
  assert.deepEqual(r.failing, ['db']);
  assert.deepEqual(r.degraded, ['recovery']);
  assert.equal(r.visibleToStatusCode, true);
  assert.equal(r.visibleToOkFlag, true);
  assert.deepEqual(r.blind, []);
  assert.equal(r.action, ACTION_DOWN);
});

test('전부 통과하면 ok 이고, 보이지 않는 관측자도 없다', () => {
  const r = assessSignalReach(bodyWith({ db: { ok: true, required: true }, recovery: { ok: true, required: false } }));
  assert.equal(r.verdict, 'ok');
  assert.deepEqual(r.degraded, []);
  assert.deepEqual(r.blind, []);
  assert.equal(r.action, ACTION_OK);
});

test('시한부 신호가 섞여 있으면 따로 세고 **지금 보지 못하면 나중에 볼 수 없다**고 말한다', () => {
  const r = assessSignalReach(
    bodyWith({
      db: { ok: true, required: true },
      writeFreeze: { ok: false, required: false },
      incidentClosure: { ok: false, required: false },
      recovery: { ok: false, required: false },
    }),
  );
  assert.deepEqual(r.timeBound, ['incidentClosure', 'writeFreeze']);
  assert.match(r.action, /창이 닫히면/);
  assert.ok(r.caveats.some((c) => /나중에 볼 수 없다/.test(c)));
});

test('읽을 수 없는 모양은 unreadable ⬅ 「degraded 가 없다」로 올리지 않는다', () => {
  for (const bad of [null, undefined, 'ok', 42, [], {}, { checks: [] }, { checks: {}, status: '정상' }]) {
    const r = assessSignalReach(bad);
    assert.equal(r.verdict, 'unreadable', `${JSON.stringify(bad)} 를 unreadable 로 보지 않았다`);
    assert.equal(r.status, null);
    assert.equal(r.action, ACTION_UNREADABLE);
  }
});

test('모양을 모르는 체크 항목은 **세지 않는다**(없는 것으로 지어내지도 않는다)', () => {
  const r = assessSignalReach(
    bodyWith({
      db: { ok: true, required: true },
      broken: { required: false }, // ok 가 없다
      alsoBroken: 'degraded', // 객체가 아니다
      recovery: { ok: false, required: false },
    }),
  );
  assert.deepEqual(r.degraded, ['recovery']);
  assert.ok(SIGNAL_LIMITS.some((l) => /세지 않는다/.test(l)), '한계에 이 사실이 적혀 있지 않다');
});

test('required 가 명시되지 않은 실패는 degraded 로 센다(503 으로 올리지 않는다)', () => {
  // required 를 생략한 체크로 서비스를 내리면 복구가 자기 자신을 막는다 — 보수적으로 degraded 다.
  const r = assessSignalReach(bodyWith({ db: { ok: true, required: true }, odd: { ok: false } }));
  assert.deepEqual(r.degraded, ['odd']);
  assert.deepEqual(r.failing, []);
});

/* ─────────────────────────── 출력 ─────────────────────────── */

test('헤더: 상태는 항상, 이름 목록은 있을 때만 — 상태 코드는 건드리지 않는다', () => {
  const okHeaders = signalHeaders(bodyWith({ db: { ok: true, required: true } }));
  assert.deepEqual(okHeaders, { [HEALTH_STATUS_HEADER]: 'ok' });

  const degradedHeaders = signalHeaders(
    bodyWith({ db: { ok: true, required: true }, recovery: { ok: false, required: false } }),
  );
  assert.equal(degradedHeaders[HEALTH_STATUS_HEADER], 'degraded');
  assert.equal(degradedHeaders[HEALTH_DEGRADED_HEADER], 'recovery');

  assert.equal(signalHeaders(null)[HEALTH_STATUS_HEADER], 'unreadable');
  // 헤더 값은 ASCII 여야 한다(비ASCII 헤더는 런타임·프록시에서 깨진다).
  for (const v of Object.values(degradedHeaders)) assert.match(v, /^[\x20-\x7e]*$/);
});

test('signalStatus·signalLogLine 은 이름·판정·개수만 담는다(값·호스트·행 수 없음)', () => {
  const body = bodyWith({
    db: { ok: true, required: true, latencyMs: 3 },
    dbIdentity: {
      ok: false,
      required: false,
      detail: { fingerprint: 'deadbeef1234', host: 'ep-secret-123.ap-southeast-1.aws.neon.tech' },
    },
  });
  const s = signalStatus(body);
  assert.equal(s.verdict, 'degraded');
  assert.deepEqual(s.degraded, ['dbIdentity']);
  assert.deepEqual(s.seenBy, ['status_header']);
  assert.deepEqual(s.headers, { status: HEALTH_STATUS_HEADER, degraded: HEALTH_DEGRADED_HEADER });
  assert.equal(s.runbook, SIGNAL_RUNBOOK_REF);

  const dump = JSON.stringify(s) + signalLogLine(body) + signalText(body).join(' ');
  for (const leaked of ['deadbeef1234', 'neon.tech', 'ep-secret', 'postgres://', 'latencyMs']) {
    assert.ok(!dump.includes(leaked), `요약에 ${leaked} 가 새어 나간다`);
  }
  assert.match(signalLogLine(body), /^health\.signal verdict=degraded degraded=1 failing=0 names=dbIdentity$/);
});

test('withSignal 은 본문을 보존하고 signal 만 덧붙인다', () => {
  const body = bodyWith({ db: { ok: true, required: true } });
  const out = withSignal(body);
  assert.equal(out.status, body.status);
  assert.equal(out.ok, body.ok);
  assert.deepEqual(out.checks, body.checks);
  assert.equal(out.signal.verdict, 'ok');
  // 한계를 응답에 함께 내보낸다 — 「알림은 코드가 보내지 않는다」를 숨기지 않는다.
  assert.ok(out.signal.limits.some((l) => /알림은 이 코드가 보내지 않는다/.test(l)));
});

/* ─────────────────────────── 정적 점검 ─────────────────────────── */

test('auditCheckWiring: 유니온에만 있고 배선되지 않은 체크를 잡는다', () => {
  const health = "export type CheckName =\n  | 'db'\n  | 'ghost';\n";
  const route = 'checks.db = { ok: true };\n';
  assert.deepEqual(auditCheckWiring(health, route), [
    'checks.ghost 가 라우트에 배선되지 않았다 — 응답에 영원히 나오지 않는다',
  ]);
  // 반대 방향(이름 어긋남)도 잡는다.
  assert.ok(auditCheckWiring("export type CheckName = 'db';", 'checks.db = 1; checks.typo = 2;').some((p) => /typo/.test(p)));
  // 유니온을 찾지 못하면 조용히 통과하지 않는다.
  assert.ok(auditCheckWiring('타입이 없다', 'checks.db = 1;').length > 0);
  assert.deepEqual(auditCheckWiring("export type CheckName = 'db';", 'checks.db = 1;'), []);
});

test('auditHeaderWiring: 판정만 하고 버리는 꼴·상태 코드 변경을 전부 잡는다', () => {
  const good = `import { signalHeaders, withSignal } from '@/lib/healthSignal';
return NextResponse.json(withSignal(body), {
  status: statusCode(body.status),
  headers: { 'Cache-Control': 'no-store', ...signalHeaders(body) },
});`;
  assert.deepEqual(auditHeaderWiring(good), []);

  // 호출만 하고 펼치지 않으면 헤더가 나가지 않는다.
  assert.ok(
    auditHeaderWiring(good.replace('...signalHeaders(body)', "'x': signalHeaders(body)")).some((p) => /펼치지/.test(p)),
  );
  // 본문에 싣지 않으면 signal 요약이 사라진다.
  assert.ok(auditHeaderWiring(good.replace('withSignal(body)', 'body')).some((p) => /withSignal/.test(p)));
  // degraded 로 503 을 내면 복구가 자기 자신을 막는다.
  assert.ok(auditHeaderWiring(good.replace('statusCode(body.status)', '503')).some((p) => /복구가 막힌다/.test(p)));
  assert.ok(auditHeaderWiring('').length >= 3);
});

test('auditRunbookSignal: §2-2 소실·헤더 이름 누락·관측자 누락을 잡는다', () => {
  assert.ok(auditRunbookSignal('## 2. 정기 점검').some((p) => /2-2/.test(p)));
  const partial = `### 2-2. 판정의 도달\n${HEALTH_STATUS_HEADER} 만 있고 degraded 는 200 이다\nstatus_code ok_flag error_alert status_header human_check`;
  assert.ok(auditRunbookSignal(partial).some((p) => p.includes(HEALTH_DEGRADED_HEADER)));
});

/* ─────────────────────── 실제 소스·문서 대조 ─────────────────────── */

test('[실제 소스] CheckName 유니온 전건이 /api/health 에 배선돼 있다', () => {
  // Checks 가 Partial 이라 배선을 빼도 타입 오류가 나지 않는다 — 그 체크는 영원히 응답에
  // 나오지 않으면서 코드·테스트·문서는 전부 통과한다. 이 저장소에서 가장 조용한 회귀다.
  assert.deepEqual(auditCheckWiring(read('src', 'lib', 'health.ts'), read('src', 'app', 'api', 'health', 'route.ts')), []);
});

test('[실제 소스] 시한부 정본의 이름이 실제 CheckName 을 가리킨다', () => {
  assert.deepEqual(auditTimeBoundNames(read('src', 'lib', 'health.ts')), []);
});

test('[실제 소스] /api/health 가 헤더·signal 을 내보내고 상태 코드는 그대로 둔다', () => {
  const route = read('src', 'app', 'api', 'health', 'route.ts');
  assert.deepEqual(auditHeaderWiring(route), []);
  // ★ route.ts 의 export 는 GET·dynamic 둘뿐이어야 한다(Vercel 빌드 실패 원인).
  const exports = [...route.matchAll(/^export\s+(?:async\s+)?(?:function\s+)?(?:const\s+)?([A-Za-z_$][\w$]*)/gm)].map(
    (m) => m[1],
  );
  assert.deepEqual(exports.sort(), ['GET', 'dynamic']);
});

test('[실제 소스] 판정 모듈이 DB·next·fs·process.env 를 건드리지 않는다', () => {
  // 주석은 그 사실을 **설명**하느라 같은 낱말을 쓴다 — 코드만 본다.
  const code = read('src', 'lib', 'healthSignal.ts')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
  for (const forbidden of ['process.env', "from 'next", 'node:fs', '@/db', 'drizzle']) {
    assert.ok(!code.includes(forbidden), `healthSignal 이 ${forbidden} 를 쓴다 — 순수 모듈이어야 한다`);
  }
  // 신규 조회·쓰기·DDL 0 — 판정은 이미 만들어진 응답 본문만 본다.
  assert.ok(!/\b(insert\s+into|update\s+\w+\s+set|delete\s+from|create\s+table|alter\s+table|select\s)\b/i.test(code));
});

test('[실제 문서] RUNBOOK §2-2 가 감시자 설정 근거를 담고 있다', () => {
  assert.deepEqual(auditRunbookSignal(read('RUNBOOK.md')), []);
});
