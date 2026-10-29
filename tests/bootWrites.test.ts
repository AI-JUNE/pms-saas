// 「읽기 전용」이라 적힌 **4단계 검증이 검증 대상을 바꾼다**(RUNBOOK §3-19·§3 4단계). 2026-10-29
//
// 이 파일이 지키는 것은 하나다 — **4단계의 「읽기 전용」은 엔드포인트에 대해서만 참이다.**
//  (1) 그 엔드포인트에 닿으려면 **기동**해야 하고, 기동은 소스에 하드코딩된 비밀번호를 가진
//      관리자 계정을, 화면을 한 번 열면 둘러보기가 데모 데이터 한 벌을 복구 브랜치에 만든다
//  (2) 그 행은 **바로 다음에 대조하는 핵심 테이블**에 더해져 기준치에 못 미치던 테이블을 올린다
//  (3) 멱등 가드라 지워도 다음 기동이 다시 만들고, 그 브랜치는 5단계에서 **운영이 된다**
//  (4) 그러면서도 §3-8 표에도 없고(되돌아온 것이 아니라 새로 생긴 것이다) 리허설에서는
//      브랜치가 정리되므로 **흔적조차 남지 않는다**
//  (5) 그래서 스위치 하나를 만들되 **기본값은 기존 동작**이고, `switchReady` 도 `/api/health` 도
//      건드리지 않는다(스위치가 없다는 이유로 전환을 막으면 복구일에 거짓 차단이 된다)
// 더해서 실제 기동 훅·쓰기 원문·4단계 라우트·헬스 라우트·RUNBOOK 원문을 대조해 문서와 코드가
// 함께 낡지 않게 한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  ACTION_BOOT_INVALID, ACTION_BOOT_PARTIAL, ACTION_BOOT_SUPPRESSED, ACTION_BOOT_UNSUPPRESSED,
  BOOT_BLIND_SPOTS, BOOT_LIMITS, BOOT_RUNBOOK_REF, BOOT_SUPPRESS_ENV, BOOT_VERDICTS, BOOT_WRITES,
  CAVEAT_BOOT_NOT_A_ROLLBACK, CAVEAT_BOOT_RESIDUAL, CAVEAT_BOOT_SELF_SCOPE, GUEST_DISABLE_ENV,
  assessBootWrites, auditBootCanon, auditInstrumentationSource, auditNoNewHealthCheck,
  auditNotAMarker, auditRunbookSource, auditVerifyWiring, auditWriteSources, bootWritesFromEnv,
  bootWritesLine, bootWritesStatus, bootWritesText, coreTablesOf, publicBootWrites,
} from '../src/lib/bootWrites.ts';
import { ENV_VARS } from '../src/lib/envRegistry.ts';
import { TRANSIENT_KEYS } from '../src/lib/envPresence.ts';
import { INCIDENT_MARKERS } from '../src/lib/healthDisclosure.ts';
import { CORE_TABLES } from '../src/lib/recoveryVerify.ts';
import { PROCEDURE_UNITS } from '../src/lib/rehearsalCoverage.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (...rel: string[]) => fs.readFileSync(path.join(ROOT, ...rel), 'utf8');
const RUNBOOK = read('RUNBOOK.md');
const INSTRUMENTATION_SRC = read('src', 'instrumentation.ts');
const BOOTSTRAP_SRC = read('src', 'lib', 'bootstrap.ts');
const GUEST_SRC = read('src', 'app', 'api', 'auth', 'guest', 'route.ts');
const VERIFY_SRC = read('src', 'app', 'api', 'admin', 'recovery-verify', 'route.ts');
const HEALTH_SRC = read('src', 'app', 'api', 'health', 'route.ts');

const ALL_ON: Record<string, string | undefined> = {
  [BOOT_SUPPRESS_ENV]: 'true',
  [GUEST_DISABLE_ENV]: 'true',
};

/* ─────────────────────────────── 정본 ─────────────────────────────── */

test('정본: 기동·검증 쓰기 다섯이 어디서·무엇을·무슨 결과와 함께 적혀 있다', () => {
  assert.deepEqual(auditBootCanon(), []);
  assert.equal(BOOT_WRITES.length, 5, '기동 쓰기의 수가 바뀌었다 — §3-19 를 함께 볼 것');
  assert.deepEqual(
    BOOT_WRITES.map((w) => w.key),
    ['schema_ddl', 'recovery_admin', 'default_roles', 'guest_demo_seed', 'verify_access_record'],
  );
  // ⬅ 이 절의 전제: 전건 **전환으로 운영이 되는 DB 에 남는다**
  assert.ok(BOOT_WRITES.every((w) => w.persists));
});

test('정본: 막을 수 있는 것과 **애초에 막을 수 없는 것**이 둘 다 있다 ⬅ 전건 차단을 「깨끗하다」로 읽지 않게', () => {
  const stoppable = BOOT_WRITES.filter((w) => w.suppressedBy);
  const unstoppable = BOOT_WRITES.filter((w) => !w.suppressedBy);
  assert.ok(stoppable.length > 0 && unstoppable.length > 0);
  assert.deepEqual(unstoppable.map((w) => w.key), ['schema_ddl', 'verify_access_record']);
  // 스키마 DDL 을 막으면 스키마가 덜 맞는 DB 에서 4단계 조회가 깨진다(§3-1) — 막지 않기로 한 것도 같은 줄에 적는다
  assert.ok(BOOT_WRITES.find((w) => w.key === 'schema_ddl')!.suppressedBy === null);
  // 막을 수 있는 쓰기가 하나도 없다고 선언되면 스위치를 만든 이유가 사라진다
  assert.ok(auditBootCanon(BOOT_WRITES.map((w) => ({ ...w, suppressedBy: null }))).length > 0);
  assert.ok(auditBootCanon(BOOT_WRITES.map((w) => ({ ...w, suppressedBy: BOOT_SUPPRESS_ENV }))).length > 0);
  assert.ok(auditBootCanon(BOOT_WRITES.map((w) => ({ ...w, persists: false }))).length > 0);
  assert.ok(auditBootCanon(BOOT_WRITES, []).length > 0);
});

test('coreTablesOf: 4단계가 **세는** 테이블만 추린다 ⬅ 권한 표는 대조에 흔적을 남기지 않는다', () => {
  const admin = BOOT_WRITES.find((w) => w.key === 'recovery_admin')!;
  assert.deepEqual(coreTablesOf(admin), ['users', 'organizations', 'memberships']);
  const roles = BOOT_WRITES.find((w) => w.key === 'default_roles')!;
  assert.deepEqual(coreTablesOf(roles), [], 'permissions·role_permissions 는 핵심 테이블이 아니다');
  // 정본이 실제 핵심 테이블 목록과 갈리지 않는지 — 이름이 바뀌면 판정이 늘 빈 목록을 낸다
  const named = new Set(BOOT_WRITES.flatMap((w) => w.tables));
  for (const t of ['users', 'organizations', 'memberships', 'audit_log']) {
    assert.ok(named.has(t) && CORE_TABLES.includes(t), `${t} 가 정본·핵심 테이블 양쪽에 있어야 한다`);
  }
});

/* ─────────────────────────────── 판정 ─────────────────────────────── */

test('판정: 아무것도 넣지 않은 배포가 **기본값**이고, 그때 기동·입장 쓰기는 전부 열려 있다', () => {
  const a = bootWritesFromEnv({});
  assert.equal(a.verdict, 'unsuppressed');
  assert.equal(a.openWrites.length, BOOT_WRITES.length);
  assert.equal(a.action, ACTION_BOOT_UNSUPPRESSED);
  // 4단계가 바로 다음에 세는 테이블이 그대로 섞인다
  for (const t of ['users', 'organizations', 'memberships', 'issues', 'projects', 'tasks', 'audit_log']) {
    assert.ok(a.openCoreTables.includes(t), `${t} 가 대조에 섞인다는 사실이 빠졌다`);
  }
});

test('판정: 두 스위치를 모두 켜면 suppressed ⬅ **그래도 남는 것**을 같이 말한다', () => {
  const a = bootWritesFromEnv(ALL_ON);
  assert.equal(a.verdict, 'suppressed');
  assert.deepEqual(a.suppressibleOpen, []);
  assert.equal(a.action, ACTION_BOOT_SUPPRESSED);
  // 막지 못하는 쓰기는 그대로 남고, 그중 `audit_log` 는 4단계가 세는 표다
  assert.deepEqual(a.openWrites, ['schema_ddl', 'verify_access_record']);
  assert.deepEqual(a.unstoppableCoreTables, ['audit_log']);
  assert.deepEqual(a.openCoreTables, ['audit_log']);
  // 할 일이 없어지지 않는다 — 「전건 차단 = 대조 대상이 깨끗하다」로 읽히면 안 된다
  assert.equal(a.actionable, true);
});

test('판정: 하나만 켜면 partially_suppressed ⬅ 열려 있는 쪽이 닿는 테이블을 말한다', () => {
  const onlyBoot = bootWritesFromEnv({ [BOOT_SUPPRESS_ENV]: 'true' });
  assert.equal(onlyBoot.verdict, 'partially_suppressed');
  assert.deepEqual(onlyBoot.suppressibleOpen, ['guest_demo_seed']);
  assert.equal(onlyBoot.action, ACTION_BOOT_PARTIAL);
  // 둘러보기가 열려 있으면 데모 데이터가 들어오는 표가 전부 대조에 섞인다
  for (const t of ['projects', 'issues', 'tasks', 'requirements', 'risks', 'documents']) {
    assert.ok(onlyBoot.openCoreTables.includes(t));
  }
  const onlyGuest = bootWritesFromEnv({ [GUEST_DISABLE_ENV]: 'true' });
  assert.equal(onlyGuest.verdict, 'partially_suppressed');
  assert.deepEqual(onlyGuest.suppressibleOpen, ['recovery_admin', 'default_roles']);
  assert.ok(!onlyGuest.openCoreTables.includes('projects'));
});

test('판정: 스위치는 `true` 문자열만 ON — 느슨한 값은 **invalid_switch** 로 따로 말한다', () => {
  // `1`·`yes`·`TRUE`·공백은 OFF 로 읽히는데 넣은 사람은 켠 줄 안다. 가장 조용한 오설정이다.
  for (const raw of ['1', 'yes', 'TRUE', 'True', 'on', ' ']) {
    const a = bootWritesFromEnv({ [BOOT_SUPPRESS_ENV]: raw, [GUEST_DISABLE_ENV]: 'true' });
    assert.equal(a.verdict, 'invalid_switch', `${JSON.stringify(raw)} 가 통과했다`);
    assert.equal(a.action, ACTION_BOOT_INVALID);
    // ON 으로 읽히지 않으므로 그 쓰기는 **실제로 열려 있다**
    assert.ok(a.openWrites.includes('recovery_admin'));
  }
  // 키가 아예 없으면 느슨한 것이 아니라 기본값이다 — 할 일이 다르다(넣는다 / 고쳐 적는다)
  assert.equal(bootWritesFromEnv({}).verdict, 'unsuppressed');
  assert.equal(bootWritesFromEnv({ [BOOT_SUPPRESS_ENV]: 'false' }).verdict, 'invalid_switch');
});

test('판정: 느슨한 스위치가 **차단 판정을 덮지 않는다** ⬅ 판정 순서', () => {
  // 둘 다 켰는데 하나가 느슨하면 `suppressed` 로 보이면 안 된다 — 그쪽 쓰기는 열려 있다.
  const a = bootWritesFromEnv({ [BOOT_SUPPRESS_ENV]: 'true', [GUEST_DISABLE_ENV]: '1' });
  assert.equal(a.verdict, 'invalid_switch');
  assert.ok(a.openWrites.includes('guest_demo_seed'));
  const sw = a.switches.find((s) => s.key === GUEST_DISABLE_ENV)!;
  assert.deepEqual(sw, { key: GUEST_DISABLE_ENV, on: false, loose: true });
});

test('판정: 정본을 바꿔 넣어도 같은 경로로 판정한다(수치를 모듈 안에 숨기지 않는다)', () => {
  const only = [BOOT_WRITES[1]];
  assert.equal(assessBootWrites({ env: {}, writes: only }).verdict, 'unsuppressed');
  assert.equal(assessBootWrites({ env: ALL_ON, writes: only }).verdict, 'suppressed');
  assert.deepEqual(assessBootWrites({ env: ALL_ON, writes: only }).unstoppable, []);
  assert.equal(assessBootWrites().verdict, 'unsuppressed', '인자 없이도 기본값으로 판정한다');
});

/* ─────────────────────────────── 출력 ─────────────────────────────── */

test('출력: 로그 한 줄에 **env 값도 행 수도 담기지 않는다**', () => {
  const line = bootWritesLine(bootWritesFromEnv({ [BOOT_SUPPRESS_ENV]: 'true' }));
  assert.match(line, /^recovery_boot_writes boot=partially_suppressed open=\d+\/5 core=\d+$/);
  assert.ok(!line.includes('true'));
});

test('출력: 사람이 읽는 요약에 전 항목·사각지대·한계가 함께 나온다', () => {
  const txt = bootWritesText(bootWritesFromEnv({}));
  for (const w of BOOT_WRITES) assert.ok(txt.includes(w.key), `${w.key} 가 요약에서 빠졌다`);
  assert.ok(txt.includes('[열림]'));
  assert.ok(txt.includes(String(BOOT_BLIND_SPOTS.length)));
  for (const c of BOOT_LIMITS) assert.ok(txt.includes(c), '한계가 요약에서 빠졌다');
  assert.ok(bootWritesText(bootWritesFromEnv(ALL_ON)).includes('[막힘]'));
});

test('공개 필터: 판정·테이블 이름·할 일만 — 스위치 상태와 env 값은 나가지 않는다', () => {
  const p = publicBootWrites(bootWritesFromEnv({ [BOOT_SUPPRESS_ENV]: 'true' }));
  assert.equal(p.verdict, 'partially_suppressed');
  assert.equal(p.runbook, BOOT_RUNBOOK_REF);
  assert.deepEqual(p.caveats, BOOT_LIMITS);
  assert.ok(!('switches' in p), '스위치 상태가 응답에 섞였다');
  assert.ok(!JSON.stringify(p).includes('"on"'));
});

test('요약: 상태만 말하고 수치를 지어내지 않는다', () => {
  const s = bootWritesStatus(ALL_ON);
  assert.equal(s.verdict, 'suppressed');
  assert.equal(s.writes, BOOT_WRITES.length);
  assert.equal(s.openWrites, 2);
  assert.equal(s.blindSpots, BOOT_BLIND_SPOTS.length);
  assert.equal(s.limits, BOOT_LIMITS.length);
  assert.equal(s.action, ACTION_BOOT_SUPPRESSED);
});

test('한계: 보장하지 못하는 것을 판정과 함께 내보낸다', () => {
  const a = bootWritesFromEnv(ALL_ON);
  assert.ok(a.caveats.includes(CAVEAT_BOOT_NOT_A_ROLLBACK), '막는 것 ≠ 되돌리는 것');
  assert.ok(a.caveats.includes(CAVEAT_BOOT_SELF_SCOPE), '읽는 배포 자신의 env 만 본다');
  assert.ok(a.caveats.includes(CAVEAT_BOOT_RESIDUAL), '전건 차단이 「깨끗하다」를 뜻하지 않는다');
  assert.ok(BOOT_LIMITS.length >= 6);
});

/* ───────────────────────── 실제 소스 대조 ───────────────────────── */

test('[실제 소스] src/instrumentation.ts 가 스위치를 **분기로** 물고 있다', () => {
  assert.deepEqual(auditInstrumentationSource(INSTRUMENTATION_SRC), []);
  // 기본값은 기존 동작이다 — 스위치가 없으면 복구용 관리자는 그대로 만들어진다
  assert.match(INSTRUMENTATION_SRC, /RECOVERY_BOOT_WRITES_OFF === 'true'/);
  assert.match(INSTRUMENTATION_SRC, /else\s*\{[\s\S]*ensureRecoveryAdmin/);
});

test('auditInstrumentationSource: 배선이 풀린 네 모양을 전부 잡는다', () => {
  // (가) 스위치를 아예 읽지 않는다
  assert.ok(auditInstrumentationSource('await ensureSchema(); await ensureRecoveryAdmin();').length > 0);
  // (나) 느슨하게 읽는다 — 오설정이 ON 으로 읽혀 복구용 계정이 사라진다
  const loose = `await ensureSchema(); if (process.env.${BOOT_SUPPRESS_ENV} !== 'false') {} await ensureRecoveryAdmin();`;
  assert.ok(auditInstrumentationSource(loose).some((p) => p.includes('느슨한')));
  // (다) 스위치가 ensureSchema 까지 덮는다 — 4단계 조회가 unverified 로만 끝난다(§3-1)
  const tooWide = `if (process.env.${BOOT_SUPPRESS_ENV} === 'true') {} await ensureSchema(); await ensureRecoveryAdmin();`;
  assert.ok(auditInstrumentationSource(tooWide).some((p) => p.includes('ensureSchema 앞')));
  // (라) 판정만 하고 분기하지 않는다
  const tooLate = `await ensureSchema(); await ensureRecoveryAdmin(); const x = process.env.${BOOT_SUPPRESS_ENV} === 'true';`;
  assert.ok(auditInstrumentationSource(tooLate).some((p) => p.includes('분기하지 않는')));
  // (마) 기동 훅에서 호출 자체가 사라지면 정본이 낡은 것이다 — 조용히 통과하지 않는다
  const noAdmin = `await ensureSchema(); if (process.env.${BOOT_SUPPRESS_ENV} === 'true') {}`;
  assert.ok(auditInstrumentationSource(noAdmin).some((p) => p.includes('recovery_admin')));
  const noSchema = `if (process.env.${BOOT_SUPPRESS_ENV} === 'true') {} else { await ensureRecoveryAdmin(); }`;
  assert.ok(auditInstrumentationSource(noSchema).some((p) => p.includes('schema_ddl')));
  assert.ok(auditInstrumentationSource('').length > 0);
});

test('[실제 소스] 정본이 「쓴다」고 적어 둔 것이 **아직 쓰기다**', () => {
  assert.deepEqual(auditWriteSources(BOOTSTRAP_SRC, GUEST_SRC), []);
  // 쓰기가 사라졌거나 막는 스위치가 풀리면 이 절이 낡은 것이다 — 양쪽 다 잡는다
  assert.ok(auditWriteSources('export function ensureRecoveryAdmin() {}', GUEST_SRC).length > 0);
  assert.ok(auditWriteSources(BOOTSTRAP_SRC, 'export async function POST() { await seedDemo(1, 2); }').length > 0);
  assert.ok(auditWriteSources(BOOTSTRAP_SRC, GUEST_SRC.replace(/seedDemo\(/g, 'noop(')).length > 0);
});

test('[실제 소스] 4단계 라우트가 판정을 **응답에 실어 보낸다** ⬅ 판정만 하고 버리면 행 수를 그대로 읽는다', () => {
  assert.deepEqual(auditVerifyWiring(VERIFY_SRC), []);
  assert.match(VERIFY_SRC, /bootWrites: publicBootWrites\(boot\)/);
  // switchReady 를 내리지 않는다 — 스위치가 없다는 이유로 전환을 막으면 복구일에 거짓 차단이 된다
  assert.ok(!/switchReady\s*:\s*(false|boot)/.test(VERIFY_SRC));
  // 음성 검사: import 만 하고 응답에 담지 않는 꼴
  const dropped = VERIFY_SRC.replace(/bootWrites: publicBootWrites\(boot\)/, '');
  assert.ok(auditVerifyWiring(dropped).length > 0);
  assert.ok(auditVerifyWiring('export async function GET() {}').length > 0);
});

test('[실제 소스] /api/health 에 **새 체크가 생기지 않았다** ⬅ 기동 쓰기는 평상시 정상 동작이다', () => {
  assert.deepEqual(auditNoNewHealthCheck(HEALTH_SRC), []);
  assert.ok(auditNoNewHealthCheck("import x from '@/lib/bootWrites';").length > 0);
  assert.ok(auditNoNewHealthCheck('checks.bootWrites = c;').length > 0);
});

/* ───────────────────── 정본끼리의 대조(키의 자리) ───────────────────── */

test('키의 자리: 레지스트리·임시 키에는 있고 **사건 표지에는 없다**', () => {
  assert.deepEqual(auditNotAMarker(INCIDENT_MARKERS, TRANSIENT_KEYS), []);
  const reg = ENV_VARS.find((v) => v.key === BOOT_SUPPRESS_ENV);
  assert.ok(reg, '레지스트리에 없으면 복구에서 조용히 유실된다(§4-12)');
  assert.equal(reg!.kind, 'switch');
  assert.ok(reg!.note.includes('3-19'));
  // 사건 표지로 등록되면 8단계 4번에서 지울 대상이 늘고 **지우는 자리도 틀린다**(스테이징 설정이다)
  assert.ok(auditNotAMarker([...INCIDENT_MARKERS, { key: BOOT_SUPPRESS_ENV }], TRANSIENT_KEYS).length > 0);
  // 임시 키에서 빠지면 평상시 미설정이 거짓 missing 으로 보고된다
  assert.ok(auditNotAMarker(INCIDENT_MARKERS, TRANSIENT_KEYS.filter((k) => k !== BOOT_SUPPRESS_ENV)).length > 0);
  assert.ok(auditNotAMarker([], TRANSIENT_KEYS).length > 0);
});

test('절차 단위: 3-19 가 리허설 정본에 등록되고 체크리스트가 **이름으로 인용한다**', () => {
  const unit = PROCEDURE_UNITS.find((u) => u.key === '3-19');
  assert.ok(unit, '등록하지 않으면 절차는 자라는데 범위 판정은 그대로 ok 가 된다');
  assert.equal(unit!.cited, true);
  assert.ok(unit!.skipped.includes('쓴다'));
});

/* ─────────────────────────── 실제 문서 대조 ─────────────────────────── */

test('[실제 문서] RUNBOOK 에 §3-19 와 판정 표·사각지대·산출 명령이 있고 4단계가 그리로 유도한다', () => {
  assert.deepEqual(auditRunbookSource(RUNBOOK), []);
  for (const v of BOOT_VERDICTS) assert.ok(RUNBOOK.includes(`\`${v}\``));
  for (const s of BOOT_BLIND_SPOTS) assert.ok(RUNBOOK.includes(s.key));
  assert.ok(RUNBOOK.includes(GUEST_DISABLE_ENV), '막는 수단 하나가 문서에서 빠졌다');
  // 음성 검사: 절이 사라지거나 4단계가 유도하지 않으면 잡는다
  assert.ok(auditRunbookSource(RUNBOOK.replace(/^### 3-19\./m, '### 3-19x.')).length > 0);
  assert.ok(auditRunbookSource('## 3. x\n4. 검증\n5. 전환\n### 3-1. x').length > 0);
  // 4단계가 §3-19 를 가리키지 않으면 「읽기 전용」이라는 문장만 남는다
  // ※ 4단계는 그 뒤 §3-20(검증 배포가 쥔 포인터)에서도 이 절을 인용하므로 **그 단계 안의
  //    인용 전건**을 지워 본다 — 한 군데만 지우면 음성 검사가 조용히 무력해진다
  const sec3Src = RUNBOOK.match(/^## 3\. [\s\S]*?(?=^### 3-1\.)/m)![0];
  const step4Src = sec3Src.slice(sec3Src.search(/^4\.\s/m)).split(/^5\.\s/m)[0];
  const unlinked = RUNBOOK.replace(step4Src, step4Src.replace(/3-19/g, '3-9'));
  assert.ok(auditRunbookSource(unlinked).some((p) => p.includes('4단계')), '4단계 유도 누락을 놓쳤다');
  // §3 본문 자체를 못 찾으면 **거기서 멈춘다** — 못 찾은 것을 「통과」로 세지 않는다
  const noSec3 = auditRunbookSource('### 3-19. x\n```\nassessBootWrites(\n```\n');
  assert.ok(noSec3.some((p) => p.includes('§3 본문')));
  assert.ok(!noSec3.some((p) => p.includes('4단계를 찾지')), '본문을 못 찾았으면 뒤 판정은 하지 않는다');
  // 4단계 줄이 없으면 그 사실만 보고한다
  assert.ok(auditRunbookSource('## 3. x\n9. 끝\n### 3-1. x').some((p) => p.includes('4단계를 찾지')));
});

test('[실제 문서] §4 가 새 스위치를 **키 목록으로** 들고 있다 ⬅ 적지 않으면 복구에서 유실된다', () => {
  const sec4 = RUNBOOK.slice(RUNBOOK.search(/^## 4\. /m), RUNBOOK.search(/^## 5\. /m));
  assert.ok(sec4.includes(`\`${BOOT_SUPPRESS_ENV}\``), '§4 키 목록에 없다');
  assert.ok(sec4.includes('미설정'), '평상시 미설정이 정상이라는 규율이 빠졌다');
});
