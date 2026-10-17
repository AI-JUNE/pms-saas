/**
 * healthDisclosure.test.ts — 공개 `/api/health` 가 **복구 중 사건 상태를 공표한다**(RUNBOOK §2-3). 2026-10-18
 *
 * ── 왜 필요한가 ──────────────────────────────────────────────────────────────
 * 체크 16건은 각자 「값은 담지 않는다 — 키 이름·판정만」을 지켰고 그 점검은 전부 통과했다.
 * 그런데 그 판정들이 모이는 라우트는 **인증이 없다.** 복구 중에는 무인증 응답이
 * 차단 여부(`writeFreeze.frozen`)·차단 중에도 쓰기가 통하는 경로(`exempt`)·보안 재적용 미완
 * (`postRestoreSecurity: pending` = 되돌아온 세션·비밀번호가 **아직 통한다**)·차단을 건 시각·
 * 빠진 설정 키 이름을 실시간으로 말한다 — §3-8 이 줄이려던 구간의 시작과 끝을 바깥에 알려 준다.
 *
 * 그래서 (가) 가리는 조건(**사건 표지 + 토큰 있음 + 토큰 미제시**)이 정확한지, (나) 토큰이
 * 없으면 **가리지 않는다**(복구를 막지 않는다)는 규율, (다) 가려도 상태 코드·`status`·
 * `x-health-status` 는 남는다는 규율(§2-2 를 죽이지 않는다), (라) 배선(라우트 분기·헤더 필터·
 * 공개 허용 목록·§2-3·env 레지스트리)을 파일 수준에서 고정한다.
 * 이 테스트는 **파일만 읽는다** — 네트워크·DB 를 쓰지 않고 `process.env` 도 바꾸지 않는다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  ACTION_EXPOSED,
  DETAIL_TOKEN_ENV,
  DETAIL_TOKEN_HEADER,
  DISCLOSURES,
  DISCLOSURE_LIMITS,
  INCIDENT_MARKERS,
  PUBLIC_DETAIL_CHECKS,
  TOKEN_MIN_LENGTH,
  activeMarkers,
  auditRouteGating,
  auditRunbookDisclosure,
  auditVisibilityCoverage,
  disclosureCheck,
  disclosureFor,
  disclosureGate,
  disclosureLogLine,
  disclosureStatus,
  disclosureText,
  markerFor,
  publicHealthView,
  publicSignalHeaders,
  safeEqual,
  tokenState,
  visibilityOf,
} from '../src/lib/healthDisclosure.ts';
import { buildHealthBody } from '../src/lib/health.ts';
import { withSignal } from '../src/lib/healthSignal.ts';
import { ENV_VARS } from '../src/lib/envRegistry.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (...p: string[]) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

const TOKEN = 'x'.repeat(TOKEN_MIN_LENGTH);

/** 복구 중 응답(실제 체크들이 내는 모양과 같은 꼴) */
const recoveryBody = () =>
  withSignal(
    buildHealthBody({
      checks: {
        db: { ok: true, required: true, latencyMs: 7 },
        billing: { ok: true, required: false, detail: { provider: 'portone', mode: 'test' } },
        writeFreeze: { ok: false, required: false, detail: { frozen: true, exempt: ['/api/auth/login'] } },
        postRestoreSecurity: { ok: false, required: false, detail: { state: 'pending', frozen: true } },
        incidentClosure: { ok: true, required: false, detail: { state: 'recorded', frozenAt: '2026-10-18T01:00:00+09:00' } },
      } as never,
      uptimeSec: 30,
      now: new Date('2026-10-18T00:00:00Z'),
      env: {},
    }),
  );

/* ─────────────────────────── 노출 정본 ─────────────────────────── */

test('노출 정본: 칸이 비어 있지 않고 **왜 걸리지 않았는지**까지 적혀 있다', () => {
  assert.ok(DISCLOSURES.length >= 7);
  for (const d of DISCLOSURES) {
    assert.ok(d.check.trim() && d.learns.trim() && d.enables.trim() && d.whyUnnoticed.trim(), `${d.check} 칸이 비었다`);
    assert.ok(d.fields.length > 0, `${d.check} 노출 칸 목록이 비었다`);
  }
  // 가장 날카로운 둘은 반드시 들어 있다.
  assert.ok(disclosureFor('postRestoreSecurity')!.enables.includes('다시 통하는'));
  assert.ok(disclosureFor('writeFreeze')!.learns.includes('쓰기가 통하는'));
  assert.equal(disclosureFor('없는체크'), null);
});

test('공개 허용 목록은 **사건과 무관한 것만** — 허용 밖은 전부 가린다(새 체크 포함)', () => {
  assert.deepEqual([...PUBLIC_DETAIL_CHECKS], ['db', 'billing']);
  assert.equal(visibilityOf('db'), 'public');
  assert.equal(visibilityOf('writeFreeze'), 'operator');
  // 알림 배선 여부는 「지금 아무도 보고 있지 않다」를 말한다 — 공개로 두지 않는다.
  assert.equal(visibilityOf('monitoring'), 'operator');
  // 나중에 추가될 체크는 적지 않으면 가려진다(보수적인 쪽으로 실패한다).
  assert.equal(visibilityOf('나중에생길체크'), 'operator');
  assert.equal(visibilityOf(undefined), 'operator');
});

/* ─────────────────────────── 사건 표지 ─────────────────────────── */

test('사건 표지: 스위치는 `true` 만 ON ⬅ 느슨하게 읽으면 실제 동작과 어긋난다', () => {
  assert.deepEqual(activeMarkers({}), []);
  assert.deepEqual(activeMarkers({ RECOVERY_WRITE_FREEZE: 'true' }), ['RECOVERY_WRITE_FREEZE']);
  // `1` 은 차단이 걸리지 않는다 — 공개될 사건 상태도 없다.
  assert.deepEqual(activeMarkers({ RECOVERY_WRITE_FREEZE: '1' }), []);
  // 기록 키는 값이 있으면 표지. 공백뿐이면 읽는 쪽이 미설정과 같게 동작하므로 표지가 아니다.
  assert.deepEqual(activeMarkers({ RECOVERY_WRITE_FREEZE_AT: '2026-10-18T01:00:00+09:00' }), [
    'RECOVERY_WRITE_FREEZE_AT',
  ]);
  assert.deepEqual(activeMarkers({ RECOVERY_WRITE_FREEZE_AT: '   ' }), []);
  assert.ok(markerFor('RECOVERY_REHEARSAL_ACTIVE'));
  assert.equal(markerFor('DATABASE_URL'), null);
  for (const m of INCIDENT_MARKERS) assert.ok(m.means.trim(), `${m.key} 사유가 비었다`);
});

/* ─────────────────────────── 판정 ─────────────────────────── */

test('판정 넷: 표지와 토큰의 조합만 본다', () => {
  assert.equal(disclosureGate({ env: {} }).verdict, 'normal');
  assert.equal(disclosureGate({ env: { HEALTH_DETAIL_TOKEN: TOKEN } }).verdict, 'ready');
  const gated = disclosureGate({ env: { RECOVERY_WRITE_FREEZE: 'true', HEALTH_DETAIL_TOKEN: TOKEN } });
  assert.equal(gated.verdict, 'gated');
  assert.equal(gated.withhold, true);
  const exposed = disclosureGate({ env: { RECOVERY_WRITE_FREEZE: 'true' } });
  assert.equal(exposed.verdict, 'exposed');
  // 평상시(normal)에는 가릴 것이 없다 — 응답을 바꾸지 않는다.
  assert.equal(disclosureGate({ env: {} }).withhold, false);
});

test('토큰이 없으면 **가리지 않는다** ⬅ 복구 담당자의 유일한 확인 수단을 막지 않는다', () => {
  const g = disclosureGate({ env: { RECOVERY_WRITE_FREEZE: 'true' } });
  assert.equal(g.withhold, false);
  assert.equal(g.verdict, 'exposed');
  assert.ok(/공표/.test(g.action));
  // 막지 않는 대신 degraded 로 드러낸다.
  assert.equal(disclosureCheck({ env: { RECOVERY_WRITE_FREEZE: 'true' } }).ok, false);
  assert.equal(disclosureCheck({ env: { RECOVERY_WRITE_FREEZE: 'true' } }).required, false);
});

test('토큰을 제시한 요청만 전체를 본다 — 틀린 토큰·빈 토큰은 공개 취급', () => {
  const env = { RECOVERY_WRITE_FREEZE: 'true', HEALTH_DETAIL_TOKEN: TOKEN };
  assert.equal(disclosureGate({ env, token: TOKEN }).audience, 'operator');
  assert.equal(disclosureGate({ env, token: TOKEN }).withhold, false);
  assert.equal(disclosureGate({ env, token: `${TOKEN}y` }).audience, 'public');
  assert.equal(disclosureGate({ env, token: '' }).audience, 'public');
  assert.equal(disclosureGate({ env, token: null }).withhold, true);
  // 토큰이 설정돼 있지 않으면 아무 값으로도 운영자가 되지 않는다.
  assert.equal(disclosureGate({ env: { RECOVERY_WRITE_FREEZE: 'true' }, token: 'anything' }).audience, 'public');
});

test('토큰 값은 어디에도 돌려주지 않는다 — 존재·길이 등급만', () => {
  assert.deepEqual(tokenState({}), { configured: false, weak: false });
  assert.deepEqual(tokenState({ HEALTH_DETAIL_TOKEN: '   ' }), { configured: false, weak: false });
  assert.deepEqual(tokenState({ HEALTH_DETAIL_TOKEN: 'short' }), { configured: true, weak: true });
  assert.deepEqual(tokenState({ HEALTH_DETAIL_TOKEN: TOKEN }), { configured: true, weak: false });
  // 짧은 토큰은 「가린 척」이다 — degraded 로 드러내되 막지는 않는다.
  const weak = disclosureCheck({ env: { HEALTH_DETAIL_TOKEN: 'short' } });
  assert.equal(weak.ok, false);
  assert.equal(disclosureGate({ env: { RECOVERY_WRITE_FREEZE: 'true', HEALTH_DETAIL_TOKEN: 'short' } }).withhold, true);
  const dump = JSON.stringify([disclosureStatus({ HEALTH_DETAIL_TOKEN: TOKEN }), weak, disclosureLogLine({ HEALTH_DETAIL_TOKEN: TOKEN })]);
  assert.ok(!dump.includes(TOKEN), '토큰 값이 출력에 섞였다');
});

test('safeEqual: 길이가 달라도 비교하고, 비문자열·빈 값은 참이 되지 않는다', () => {
  assert.equal(safeEqual('abc', 'abc'), true);
  assert.equal(safeEqual('abc', 'abd'), false);
  assert.equal(safeEqual('abc', 'abcabc'), false);
  assert.equal(safeEqual('', ''), false);
  assert.equal(safeEqual(undefined, undefined), false);
  assert.equal(safeEqual(123 as unknown, 123 as unknown), false);
});

/* ─────────────────────────── 공개 응답 조립 ─────────────────────────── */

test('가리지 않을 때는 본문을 **손대지 않는다** ⬅ 평상시 응답은 한 글자도 바뀌지 않는다', () => {
  const body = recoveryBody();
  assert.equal(publicHealthView(body, { gated: false }), body as unknown);
});

test('가릴 때: 사건 상태를 말하는 체크는 **이름조차** 남지 않는다', () => {
  const view = publicHealthView(recoveryBody(), { gated: true });
  const dump = JSON.stringify(view);
  for (const name of ['writeFreeze', 'postRestoreSecurity', 'incidentClosure', 'frozenAt', 'pending', '/api/auth/login']) {
    assert.ok(!dump.includes(name), `${name} 이(가) 공개 응답에 남았다`);
  }
  assert.deepEqual(Object.keys(view.checks as Record<string, unknown>), ['db', 'billing']);
  const w = view.withheld as Record<string, unknown>;
  assert.equal(w.checks, 3);
  assert.equal(w.notOk, 2);
  assert.equal(w.tokenHeader, DETAIL_TOKEN_HEADER);
  assert.ok(String(w.how).includes(DETAIL_TOKEN_ENV));
});

test('가려도 「무언가 이상하다」는 남긴다 ⬅ §2-2 의 도달 경로를 죽이지 않는다', () => {
  const full = recoveryBody();
  const view = publicHealthView(full, { gated: true });
  assert.equal(view.status, 'degraded');
  assert.equal(view.ok, true);
  assert.equal(view.uptimeSec, full.uptimeSec);
  const signal = view.signal as Record<string, unknown>;
  assert.equal(signal.verdict, 'degraded');
  assert.equal(signal.degradedCount, 2);
  assert.equal(signal.withheld, true);
  // 개수만 남고 이름 배열은 사라진다.
  assert.equal(signal.degraded, undefined);
});

test('읽을 수 없는 본문은 통째로 가린다(fail-closed)', () => {
  for (const bad of [null, undefined, 'text', 42, []]) {
    const view = publicHealthView(bad, { gated: true });
    assert.equal(view.status, 'unreadable');
    assert.ok(view.withheld);
  }
  // 체크 모양을 읽을 수 없으면 「정상」으로 세지 않는다.
  const view = publicHealthView({ checks: { writeFreeze: 'broken' } }, { gated: true });
  assert.equal((view.withheld as Record<string, unknown>).unreadable, 1);
});

test('헤더: 체크 이름 목록만 지우고 `x-health-status` 는 남긴다', () => {
  const headers = { 'Cache-Control': 'no-store', 'x-health-status': 'degraded', 'x-health-degraded': 'writeFreeze,postRestoreSecurity' };
  const gated = publicSignalHeaders(headers, { gated: true });
  assert.equal(gated['x-health-status'], 'degraded');
  assert.equal(gated['Cache-Control'], 'no-store');
  assert.equal('x-health-degraded' in gated, false);
  // 가리지 않을 때는 그대로(원본을 변형하지 않는다).
  assert.deepEqual(publicSignalHeaders(headers, { gated: false }), headers);
  assert.equal(headers['x-health-degraded'], 'writeFreeze,postRestoreSecurity');
});

/* ─────────────────────────── 출력 ─────────────────────────── */

test('출력: 상태·사각지대를 함께 내보내고 수치를 지어내지 않는다', () => {
  const s = disclosureStatus({ RECOVERY_WRITE_FREEZE: 'true' });
  assert.equal(s.verdict, 'exposed');
  assert.equal(s.action, ACTION_EXPOSED);
  assert.ok(s.limits.length >= 6);
  assert.ok(DISCLOSURE_LIMITS.some((l) => /이미 나간 응답/.test(l)), '되돌릴 수 없다는 한계가 빠졌다');
  assert.ok(DISCLOSURE_LIMITS.some((l) => /상태 코드/.test(l)));
  assert.equal(disclosureCheck({ env: {} }).ok, true);
  assert.ok(disclosureText({ RECOVERY_WRITE_FREEZE: 'true' }).some((l) => /RECOVERY_WRITE_FREEZE/.test(l)));
  assert.match(disclosureLogLine({}), /^health\.disclosure verdict=normal markers=0 token=absent$/);
});

/* ─────────────────────────── 정적 점검(CI) ─────────────────────────── */

test('auditVisibilityCoverage: 이름이 어긋나거나 위험한 체크가 공개 목록에 오르면 잡는다', () => {
  assert.deepEqual(auditVisibilityCoverage("export type CheckName = 'db';"), [
    ...PUBLIC_DETAIL_CHECKS.filter((n) => n !== 'db').map((n) => `공개 허용 목록의 ${n} 이(가) CheckName 에 없다 — 가리킬 곳을 잃었다`),
    ...DISCLOSURES.filter((d) => d.check !== 'db').map((d) => `노출 정본의 ${d.check} 이(가) CheckName 에 없다 — 표가 설명할 대상을 잃었다`),
  ]);
  assert.ok(auditVisibilityCoverage('type Other = 1;').some((p) => /CheckName/.test(p)));
});

test('[실제 소스] CheckName 유니온이 공개 허용 목록·노출 정본과 맞물려 있다', () => {
  assert.deepEqual(auditVisibilityCoverage(read('src', 'lib', 'health.ts')), []);
});

test('auditRouteGating: 판정만 하고 분기하지 않거나 질의 문자열로 토큰을 받으면 잡는다', () => {
  const problems = auditRouteGating('export async function GET() { return NextResponse.json(withSignal(body)); }');
  assert.ok(problems.some((p) => /healthDisclosure/.test(p)));
  assert.ok(problems.some((p) => /disclosureGate/.test(p)));
  assert.ok(problems.some((p) => /publicHealthView/.test(p)));
  assert.ok(problems.some((p) => /withhold/.test(p)));
  assert.ok(problems.some((p) => /checks\.disclosure/.test(p)));

  const queryToken = `from '@/lib/healthDisclosure'; disclosureGate({ token: u.searchParams.get('token') }); gate.withhold; publicHealthView(x); publicSignalHeaders(h); checks.disclosure = disclosureCheck(); NextResponse.json(publicHealthView(y))`;
  assert.ok(
    auditRouteGating(queryToken).some((p) => /질의 문자열/.test(p)),
    '질의 문자열 토큰을 잡지 못했다',
  );

  // 가장 조용한 회귀: 가린 본문을 **만들고 버리는** 경우(응답은 그대로 전체가 나간다).
  const discarded = `from '@/lib/healthDisclosure'; const g = disclosureGate({ token: req.headers.get(DETAIL_TOKEN_HEADER) }); if (g.withhold) { publicHealthView(full, { gated: true }); } publicSignalHeaders(h, { gated: true }); checks.disclosure = disclosureCheck(); return NextResponse.json(withSignal(body));`;
  assert.deepEqual(auditRouteGating(discarded), [
    'publicHealthView() 결과를 응답 본문으로 내보내지 않는다(판정만 하고 버리는 꼴)',
  ]);
});

test('publicSignalHeaders: 모양을 읽을 수 없는 입력에도 토큰·이름을 만들어 내지 않는다', () => {
  assert.deepEqual(publicSignalHeaders(null as never, { gated: true }), {});
  assert.deepEqual(publicSignalHeaders('x' as never, { gated: false }), {});
});

test('[실제 소스] /api/health 가 게이트를 **적용**한다 ⬅ 응답은 그대로 200 이라 눈으로는 알 수 없다', () => {
  const src = read('src', 'app', 'api', 'health', 'route.ts');
  assert.deepEqual(auditRouteGating(src), []);
  // route.ts 는 HTTP 메서드·Next 설정 외 export 금지(Vercel 빌드 실패 원인) — 2개 유지.
  assert.equal([...src.matchAll(/^export /gm)].length, 2);
  // 가린 쪽도 상태 코드는 그대로다(degraded 로 503 을 내면 복구가 자기 자신을 막는다).
  assert.equal([...src.matchAll(/status:\s*statusCode\(/g)].length, 2);
});

test('[실제 소스] 게이트는 DB·DDL 을 건드리지 않는다(판정은 env 해석뿐)', () => {
  const src = read('src', 'lib', 'healthDisclosure.ts');
  for (const bad of ['db.execute', 'drizzle', 'CREATE TABLE', 'ALTER TABLE', "from 'next", 'node:fs']) {
    assert.ok(!src.includes(bad), `${bad} 이(가) 들어 있다`);
  }
  // 토큰 값을 로그·요약에 넣는 변경을 막는다.
  assert.ok(!/console\./.test(src));
});

test('[실제 문서] RUNBOOK §2-3 이 토큰·헤더·판정·사건 표지를 적고 있다', () => {
  assert.deepEqual(auditRunbookDisclosure(read('RUNBOOK.md')), []);
  const problems = auditRunbookDisclosure('## 2. 정기 점검');
  assert.ok(problems.some((p) => /2-3/.test(p)));
  assert.ok(problems.some((p) => new RegExp(DETAIL_TOKEN_ENV).test(p)));
  assert.ok(problems.some((p) => /평상시/.test(p)));
});

test('[실제 레지스트리] 신규 env 1건이 정본에 시크릿으로 등록돼 있다', () => {
  const def = ENV_VARS.find((v) => v.key === DETAIL_TOKEN_ENV);
  assert.ok(def, `${DETAIL_TOKEN_ENV} 가 레지스트리에 없다 — 복구 목록에서 빠진다`);
  assert.equal(def!.kind, 'secret');
  assert.ok(/평상시 미설정/.test(def!.note));
  // 키 이름 자체가 NEXT_PUBLIC_ 이면 클라이언트 번들에 평문으로 인라인된다.
  assert.ok(!DETAIL_TOKEN_ENV.startsWith('NEXT_PUBLIC_'));
});
