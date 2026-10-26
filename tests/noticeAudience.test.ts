// 고지할 **상대**를 특정할 수 있는가 테스트(RUNBOOK §3-16·§3-10·§3-5). 2026-10-26
//
// 이 파일이 지키는 것은 하나다 — **되돌릴 수 없는 산출물의 대상이 복구로 되돌아간다.**
//  (1) 연락처를 담은 출처는 `users.email` **하나**이고 그것이 복구 대상 DB 안에 있다
//  (2) 그래서 복구 시점 이후 가입분(데이터를 전부 잃은 쪽)이 명단에서 빠지고,
//      바뀐 주소는 옛 값으로 되돌아가는데 — 어느 응답·검증도 그것을 드러내지 않는다
//  (3) §3-5 보존본으로도 메울 수 없다(감사 detail 은 PII 원문 저장이 금지된 설계다)
//  (4) 그러면서도 「고지했다」는 적을 수 있어 전원에게 닿은 고지와 구별되지 않는다
//  (5) 그래서 받을 수 있는 **유일한 창**(차단 중)과 닫힌 뒤를 가려 말하고,
//      `ok`·판정 어휘·체크 수·환경변수는 **하나도 늘리지 않는다**
// 더해서 실제 스키마·감사 모듈·명단 라우트·`/api/health`·RUNBOOK 원문을 대조해
// 전제(연락처 칼럼 하나·PII 미기록·조직 스코프)가 조용히 바뀌지 않게 한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  ACTION_AUDIENCE_CLAIMED, ACTION_AUDIENCE_PRESERVABLE, ACTION_AUDIENCE_WINDOW_CLOSED,
  AUDIENCE_DISCLOSURE, AUDIENCE_DRIFTS, AUDIENCE_LIMITS, AUDIENCE_RUNBOOK_REF, AUDIENCE_VERDICTS,
  CAVEAT_COVERS_ALL_UNKNOWN, CAVEAT_EVIDENCE_HAS_NO_CONTACT, CONTACT_COLUMN, CONTACT_SOURCES,
  ROSTER_SNAPSHOT_SQL, ROSTER_TABLES,
  assessAudience, audienceCell, audienceFromEnv, audienceLogLine, audienceStatus, audienceText,
  auditAudienceCanon, auditContactShape, auditEvidencePiiPolicy, auditNoNewHealthCheck,
  auditNoticeWiring, auditRosterSqlReadOnly, auditRosterScope, auditRunbookAudience,
  contactBearingSources, publicAudience,
} from '../src/lib/noticeAudience.ts';
import { NOTICE_AT_ENV, RESTORE_POINT_ENV, lossNoticeCheck } from '../src/lib/lossNotice.ts';
import { EVIDENCE_DEPENDENTS, EVIDENCE_SOURCES, PRESERVED_AT_ENV } from '../src/lib/evidencePreservation.ts';
import { FREEZE_AT_ENV } from '../src/lib/incidentClosure.ts';
import { ENV_VARS } from '../src/lib/envRegistry.ts';
import { TRANSIENT_KEYS } from '../src/lib/envPresence.ts';
import { PROCEDURE_UNITS } from '../src/lib/rehearsalCoverage.ts';
import { parseChecklistBoxes, unitItemLoad } from '../src/lib/rehearsalChecklist.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (...rel: string[]) => fs.readFileSync(path.join(ROOT, ...rel), 'utf8');
const RUNBOOK = read('RUNBOOK.md');
const MODULE_SRC = read('src', 'lib', 'noticeAudience.ts');
const NOTICE_SRC = read('src', 'lib', 'lossNotice.ts');
const ROUTE_SRC = read('src', 'app', 'api', 'health', 'route.ts');
const SCHEMA_SRC = read('src', 'db', 'schema.ts');
const AUDIT_SRC = read('src', 'lib', 'audit.ts');
const ADMIN_USERS_SRC = read('src', 'app', 'api', 'admin', 'users', 'route.ts');

/** 한 사건의 정상 순서 — 2단계 차단 → §3-5 보존(명단 포함) → 8단계 2번 고지 */
const T_FREEZE = '2026-10-26T02:10:00+09:00';
const T_PRESERVE = '2026-10-26T02:25:00+09:00';
const T_RESTORE = '2026-10-26T01:40:00+09:00';
const T_NOTICE = '2026-10-26T06:00:00+09:00';

/** 차단 중이고 명단을 아직 받지 않은 상태 — **지금이 받을 수 있는 유일한 창**이다 */
const FROZEN: Record<string, string | undefined> = {
  RECOVERY_WRITE_FREEZE: 'true',
  [FREEZE_AT_ENV]: T_FREEZE,
  [RESTORE_POINT_ENV]: T_RESTORE,
};

/* ─────────────────────────────── 정본 ─────────────────────────────── */

test('정본: 출처·어긋남이 사유와 함께 적혀 있고 모양 점검을 통과한다', () => {
  assert.deepEqual(auditAudienceCanon(), []);
  assert.ok(CONTACT_SOURCES.length >= 4, '명단을 뽑을 수 있는 자리 목록이 줄었다');
  assert.ok(CONTACT_SOURCES.some((s) => s.id === 'restored_db'));
  assert.ok(CONTACT_SOURCES.some((s) => s.id === 'preserved_security'));
  assert.equal(AUDIENCE_RUNBOOK_REF, 'RUNBOOK §3-16·§3-10·§3-5');
  assert.equal(CONTACT_COLUMN, 'users.email');
});

test('정본: 연락처를 담은 출처가 **하나**이고 그것이 복구 대상 안에 있다', () => {
  assert.deepEqual(contactBearingSources(), ['restored_db']);
  const restored = CONTACT_SOURCES.find((s) => s.id === 'restored_db');
  assert.ok(/되돌아간다/.test(restored?.afterSwitch ?? ''), '전환이 명단을 되돌린다는 사실이 빠졌다');
  // 보존본은 DB 밖에 남지만 **주소가 없다** — 이 전제가 이 절의 핵심이다
  for (const id of ['preserved_audit', 'preserved_security', 'count_baseline']) {
    assert.equal(CONTACT_SOURCES.find((s) => s.id === id)?.hasContact, false, `${id} 가 연락처를 담았다고 선언됐다`);
  }
  // 늘어났다면 복구 대상 밖인지 다시 보고 문서를 함께 고쳐야 한다
  const two = [...CONTACT_SOURCES, { ...CONTACT_SOURCES[1], id: 'crm', hasContact: true }];
  assert.ok(auditAudienceCanon(two).some((p) => p.includes('1건이 아니다')));
});

test('정본: 어긋남은 **전건 드러나지 않는다** — 거짓 선언을 잡는다', () => {
  assert.ok(AUDIENCE_DRIFTS.length >= 3);
  for (const d of AUDIENCE_DRIFTS) assert.equal(d.detectable, false, `${d.id} 가 드러난다고 선언됐다`);
  assert.ok(AUDIENCE_DRIFTS.some((d) => d.id === 'missing_signups'));
  assert.ok(AUDIENCE_DRIFTS.some((d) => d.id === 'stale_contact'));
  assert.ok(AUDIENCE_DRIFTS.some((d) => /아무도/.test(d.whoReports)), '아무도 알려 주지 않는 방향이 빠졌다');

  const lying = AUDIENCE_DRIFTS.map((d) => ({ ...d, detectable: true }));
  assert.ok(auditAudienceCanon(CONTACT_SOURCES, lying).some((p) => p.includes('detectable')));
  const blank = AUDIENCE_DRIFTS.map((d) => ({ ...d, effect: '' }));
  assert.ok(auditAudienceCanon(CONTACT_SOURCES, blank).some((p) => p.includes('비었다')));
  assert.ok(auditAudienceCanon([], AUDIENCE_DRIFTS).some((p) => p.includes('비었다')));
});

/* ───────────────────────── 전환 전에 받는 명단 ───────────────────────── */

test('명단 조회문은 **읽기 전용**이고 세 테이블·created_at 을 받는다', () => {
  assert.deepEqual(auditRosterSqlReadOnly(), []);
  assert.ok(ROSTER_SNAPSHOT_SQL.startsWith('select '));
  for (const t of ROSTER_TABLES) assert.ok(ROSTER_SNAPSHOT_SQL.includes(t), `${t} 를 읽지 않는다`);
  assert.ok(ROSTER_SNAPSHOT_SQL.includes('u.email'), '유일한 발신 주소를 받지 않는다');

  // 쓰기 동사가 섞이면 복구 전 **운영 DB** 에 그것을 돌리게 된다
  assert.ok(auditRosterSqlReadOnly(`${ROSTER_SNAPSHOT_SQL}; delete from users`).some((p) => p.includes('delete')));
  assert.ok(auditRosterSqlReadOnly('update users set email = null').length >= 2);
  // created_at 이 빠지면 전환 뒤 복구 시점 이후 가입분을 가려낼 축이 사라진다
  assert.ok(
    auditRosterSqlReadOnly(ROSTER_SNAPSHOT_SQL.replace(/created_at/g, 'id')).some((p) => p.includes('created_at')),
  );
});

/* ─────────────────────────────── 판정 ─────────────────────────────── */

test('판정: 평상시는 할 일이 없고 차단 중 미보존은 **지금 받으라**고 말한다', () => {
  const normal = assessAudience();
  assert.deepEqual([normal.verdict, normal.actionable, normal.preservable], ['not_applicable', false, false]);

  const frozen = assessAudience({ frozen: true });
  assert.deepEqual([frozen.verdict, frozen.preservable, frozen.rosterClaimed], ['preservable', true, false]);
  assert.equal(frozen.action, ACTION_AUDIENCE_PRESERVABLE);
  assert.ok(/지금/.test(frozen.action) && /되찾을 경로가 없다/.test(frozen.action));
  assert.equal(audienceCell(frozen), 'preservable');
});

test('판정: 보존 기록은 **주장**이고 창이 닫히면 추정하지 않는다', () => {
  const claimed = assessAudience({ frozen: true, preservedAt: T_PRESERVE });
  assert.deepEqual([claimed.verdict, claimed.rosterClaimed, claimed.preservable], ['claimed', true, false]);
  assert.equal(claimed.action, ACTION_AUDIENCE_CLAIMED);
  assert.ok(/확인하지 않는다/.test(claimed.action), '보존본의 내용을 확인한 것처럼 말한다');

  // 차단은 풀렸는데 사건 표지만 남았다 — 전환 뒤라 명단을 되찾을 경로가 없다
  const closed = assessAudience({ restorePoint: T_RESTORE, noticedAt: T_NOTICE });
  assert.deepEqual([closed.verdict, closed.preservable], ['window_closed', false]);
  assert.equal(closed.action, ACTION_AUDIENCE_WINDOW_CLOSED);
  assert.ok(/추정해 만들지 않고/.test(closed.action), '명단을 추정하라고 말한다');

  // 보존 기록이 남아 있으면(8단계 4번 전) 그 사실만 말하고 삭제 재촉은 §3-15 에 맡긴다
  assert.equal(assessAudience({ preservedAt: T_PRESERVE }).verdict, 'claimed');
});

test('판정 순서: 판독 불가가 「없다」로 섞이지 않고, 받을 수 있는 창을 닫았다고 하지 않는다', () => {
  const bad = assessAudience({ frozen: true, preservedAt: '어제 밤' });
  assert.equal(bad.verdict, 'invalid_record');
  assert.equal(bad.rosterClaimed, false, '못 읽는 값을 「보존했다」로 세었다');
  assert.ok(/다시 넣는다/.test(bad.action));

  // ⬅ 순서가 뒤집히면 **받을 수 있는 순간에 포기하라**고 말하게 된다
  const frozenWithMarkers = assessAudience({ frozen: true, restorePoint: T_RESTORE, freezeAt: T_FREEZE });
  assert.equal(frozenWithMarkers.verdict, 'preservable');

  // 비실존·형식 밖 시각도 판독 불가다(KST 새벽 시각은 정상 입력이다 — §3-7 의 교훈)
  assert.equal(assessAudience({ preservedAt: '2026-02-30T00:00:00+09:00' }).verdict, 'invalid_record');
  assert.equal(assessAudience({ frozen: true, preservedAt: '2026-10-26T03:05:00+09:00' }).verdict, 'claimed');
});

test('「전원에게 갔는가」는 **늘 모른다** — 거짓 ok 를 만들지 않는다', () => {
  for (const input of [undefined, { frozen: true }, { preservedAt: T_PRESERVE }, { preservedAt: 'x' }]) {
    const a = assessAudience(input);
    assert.equal(a.coversAll, 'unknown');
    assert.equal(a.contactSources, 1);
    assert.equal(a.drifts.length, AUDIENCE_DRIFTS.length);
    assert.equal(a.disclosure, AUDIENCE_DISCLOSURE);
    assert.deepEqual([...a.caveats], [...AUDIENCE_LIMITS]);
  }
  assert.ok(AUDIENCE_LIMITS.includes(CAVEAT_EVIDENCE_HAS_NO_CONTACT));
  assert.ok(AUDIENCE_LIMITS.includes(CAVEAT_COVERS_ALL_UNKNOWN));
  assert.ok(AUDIENCE_LIMITS.some((l) => /승인 필요/.test(l)), '교차 테넌트 경로 신설이 승인 사항임을 숨겼다');
  // 고지문 문구는 받는 쪽이 스스로 확인할 수 있게 만든다 — 어긋남을 판정으로는 가려낼 수 없다
  assert.ok(/닿지 않을 수 있/.test(AUDIENCE_DISCLOSURE));
});

test('env 로더: **이미 있는 네 키만** 읽고 새 키를 만들지 않는다', () => {
  assert.equal(audienceFromEnv({}).verdict, 'not_applicable');
  assert.equal(audienceFromEnv(FROZEN).verdict, 'preservable');
  assert.equal(audienceFromEnv({ ...FROZEN, [PRESERVED_AT_ENV]: T_PRESERVE }).verdict, 'claimed');
  assert.equal(audienceFromEnv({ [NOTICE_AT_ENV]: T_NOTICE }).verdict, 'window_closed');
  // 느슨한 스위치 판독을 하지 않는다(`'1'` 은 OFF 다)
  assert.equal(audienceFromEnv({ RECOVERY_WRITE_FREEZE: '1' }).verdict, 'not_applicable');

  // 읽는 키 전건이 §4 레지스트리와 임시 키 목록에 이미 등록돼 있다(신규 env 0)
  const reads = [...MODULE_SRC.matchAll(/env\.([A-Z][A-Z0-9_]+)/g)].map((m) => m[1]);
  assert.ok(reads.length > 0, '로더가 env 를 읽지 않는다 — 산출이 성립하지 않는다');
  for (const key of new Set(reads)) {
    assert.ok(ENV_VARS.some((v) => v.key === key), `${key} 가 §4 레지스트리에 없다`);
    assert.ok(TRANSIENT_KEYS.includes(key), `${key} 가 임시 키 목록에 없다 — 평상시 거짓 missing 이 된다`);
  }
});

/* ─────────────────────────────── 출력 ─────────────────────────────── */

test('출력: 요약은 할 일·어긋남을 함께 내고 로그·공개 필터는 **값을 담지 않는다**', () => {
  const txt = audienceText(assessAudience({ frozen: true }));
  assert.ok(txt.startsWith('[고지 대상] preservable'));
  assert.ok(txt.includes('users.email'), '연락처 출처가 하나라는 사실이 빠졌다');
  assert.ok(txt.includes(AUDIENCE_DISCLOSURE), '고지문 문구를 떼고 내보냈다');
  assert.equal(audienceText(assessAudience()).includes(AUDIENCE_DISCLOSURE), false, '평상시에 고지문을 들고 나온다');

  const line = audienceLogLine(assessAudience({ frozen: true, preservedAt: T_PRESERVE }));
  assert.equal(line, 'recovery_notice_audience verdict=claimed roster_claimed=true preservable=false covers_all=unknown drifts=3');
  assert.ok(!line.includes(T_PRESERVE), '로그에 시각이 들어갔다');

  const pub = publicAudience(assessAudience({ frozen: true, preservedAt: T_PRESERVE }));
  const dump = JSON.stringify(pub);
  for (const f of ['@', T_PRESERVE, 'email', 'select']) {
    assert.ok(!dump.includes(f), `공개 응답에 ${f} 가 들어갔다`);
  }
  assert.deepEqual(Object.keys(pub).sort(), ['coversAll', 'drifts', 'preservable', 'rosterClaimed', 'verdict']);

  const s = audienceStatus(FROZEN);
  assert.deepEqual([s.verdict, s.recordKey, s.contactSources], ['preservable', PRESERVED_AT_ENV, 1]);
  assert.equal(s.limits, AUDIENCE_LIMITS.length);
});

/* ─────────────────────────────── 배선 ─────────────────────────────── */

test('lossNotice: `state`·`ok` 어휘는 그대로이고 명단 판정만 더해진다', () => {
  const due = lossNoticeCheck({ env: { ...FROZEN, [RESTORE_POINT_ENV]: T_RESTORE } });
  assert.deepEqual([due.detail.state, due.ok, due.required], ['due', false, false]);
  assert.equal(due.detail.audienceVerdict, 'preservable');
  assert.equal(due.detail.audienceRosterClaimed, false);
  assert.equal(due.detail.audiencePreservable, true);
  assert.equal(due.detail.audienceCoversAll, 'unknown');
  assert.equal(due.detail.audienceDrifts, AUDIENCE_DRIFTS.length);
  assert.ok(String(due.detail.audienceNote).includes('§3-5'), '같은 칸에서 받을 자리를 말하지 않는다');

  // ⬅ 이 장치의 핵심: 명단 없이도 「고지했다」는 그대로 `notified`·`ok` 다
  const notified = lossNoticeCheck({
    env: { ...FROZEN, [RESTORE_POINT_ENV]: T_RESTORE, [NOTICE_AT_ENV]: T_NOTICE },
  });
  assert.deepEqual([notified.detail.state, notified.ok], ['notified', true], '어휘·ok 를 바꿨다');
  assert.equal(notified.detail.audienceVerdict, 'preservable', '명단 근거가 없다는 사실이 사라졌다');

  const withRoster = lossNoticeCheck({
    env: { ...FROZEN, [PRESERVED_AT_ENV]: T_PRESERVE, [NOTICE_AT_ENV]: T_NOTICE },
  });
  assert.deepEqual([withRoster.detail.state, withRoster.ok], ['notified', true]);
  assert.equal(withRoster.detail.audienceVerdict, 'claimed');

  // 평상시에는 한 글자도 더 달라지지 않는다
  const normal = lossNoticeCheck({ env: {} });
  assert.deepEqual([normal.detail.state, normal.detail.audienceVerdict], ['normal', 'not_applicable']);
  assert.equal(normal.ok, true);
});

test('[실제 소스] lossNotice 가 판정을 **응답에 실어 보낸다**', () => {
  assert.deepEqual(auditNoticeWiring(NOTICE_SRC), []);
  assert.ok(auditNoticeWiring('export function lossNoticeCheck(){}').length >= 4, 'import 누락을 놓쳤다');
  const discarded = NOTICE_SRC.replace(/audienceCoversAll\s*:/g, 'unused:');
  assert.ok(auditNoticeWiring(discarded).some((p) => p.includes('audienceCoversAll')), '판정만 하고 버리는 꼴을 놓쳤다');
  const noCall = NOTICE_SRC.replace(/audienceFromEnv\(/g, 'somethingElse(');
  assert.ok(auditNoticeWiring(noCall).some((p) => p.includes('명단 판정')));
});

test('[실제 소스] `/api/health` 에 **새 체크가 생기지 않았다**', () => {
  assert.deepEqual(auditNoNewHealthCheck(ROUTE_SRC), []);
  assert.ok(auditNoNewHealthCheck("import { x } from '@/lib/noticeAudience';").length > 0);
  assert.ok(auditNoNewHealthCheck('checks.noticeAudience = x();').length > 0);
  assert.ok(!/checks\.noticeAudience/.test(ROUTE_SRC));
});

/* ─────────────────────── 전제(실제 원문) 대조 ─────────────────────── */

test('[실제 스키마] 연락처 칼럼이 **하나**이고 명단 세 테이블에 created_at 이 있다', () => {
  assert.deepEqual(auditContactShape(SCHEMA_SRC), []);

  // 조직 단위 연락처가 생기면 §3-16 의 서술·명단 조회가 조용히 불완전해진다
  const withOrgEmail = SCHEMA_SRC.replace(
    "plan: text('plan')",
    "email: text('email'), plan: text('plan')",
  );
  assert.ok(auditContactShape(withOrgEmail).some((p) => p.includes('organizations')));
  // 유일한 발신 주소가 사라지거나 축이 없어지면 함께 고치라고 말한다
  assert.ok(auditContactShape(SCHEMA_SRC.replace(/email: text\('email'\)/, "mail: text('mail')")).length > 0);
  const noCreated = SCHEMA_SRC.replace(/created_at/g, 'made_at');
  assert.ok(auditContactShape(noCreated).some((p) => p.includes('created_at')));
  assert.ok(auditContactShape('').length >= 2, '스키마를 못 읽은 것을 통과로 올렸다');
});

test('[실제 라우트] 명단 조회가 **조직 스코프**라는 사실을 고정한다', () => {
  assert.deepEqual(auditRosterScope(ADMIN_USERS_SRC), []);
  const opened = ADMIN_USERS_SRC.replace(/eq\(memberships\.orgId,\s*ctx\.orgId\)/g, 'undefined');
  assert.ok(auditRosterScope(opened).some((p) => p.includes('조직 스코프')), '전 테넌트 명단이 열린 것을 놓쳤다');
  const noEmail = ADMIN_USERS_SRC.replace(/email: users\.email/g, 'name2: users.name');
  assert.ok(auditRosterScope(noEmail).some((p) => p.includes('메일 주소')));
  assert.ok(auditRosterScope('').length > 0);
});

test('[실제 소스] 감사 detail 의 **PII 미기록** 규율이 그대로다', () => {
  assert.deepEqual(auditEvidencePiiPolicy(AUDIT_SRC), []);
  assert.ok(auditEvidencePiiPolicy(AUDIT_SRC.replace(/PII 원문 저장 금지/g, '자유 기록')).length > 0);
  assert.ok(auditEvidencePiiPolicy('').length >= 3, '전제가 깨진 것을 통과로 올렸다');
});

/* ─────────────────────── 정본 대조(§3-5 와 한 몸) ─────────────────────── */

test('[실제 정본] 명단이 §3-5 보존 출처·의존 단계에 등록돼 있다', () => {
  const roster = EVIDENCE_SOURCES.find((s) => /명단/.test(s.path));
  assert.ok(roster, '§3-5 보존 출처에 명단이 없다 — 받을 자리가 절차에 없다');
  assert.ok(/users\.email/.test(roster?.scope ?? ''), '무엇을 받는지가 적혀 있지 않다');
  assert.ok(/3-16/.test(roster?.afterSwitch ?? ''), '전환 뒤 상태가 §3-16 으로 이어지지 않는다');

  const dep = EVIDENCE_DEPENDENTS.find((d) => /8단계 2번/.test(d.step));
  assert.ok(dep, '보존본에 매달린 단계에 8단계 2번(고지)이 없다');
  assert.equal(dep?.failsLoudly, false, '이 의존이 시끄럽게 실패한다고 선언됐다');
  assert.ok(/notified/.test(dep?.ifMissing ?? ''), '거른 복구가 「고지했다」로 보인다는 사실이 빠졌다');
});

test('절차 단위 3-16 이 등록되고 체크리스트가 **빈 칸으로** 그것을 인용한다', () => {
  const unit = PROCEDURE_UNITS.find((u) => u.key === '3-16');
  assert.ok(unit, '§3-16 이 절차 단위 정본에 없다 — 리허설 범위에서 빠진다');
  assert.equal(unit?.cited, true);
  assert.equal(unit?.since, '2026-10-26');
  assert.ok((unit?.skipped ?? '').length > 0, '건너뛸 때 생기는 일이 적혀 있지 않다');

  const boxes = parseChecklistBoxes(RUNBOOK);
  assert.ok(boxes, '체크리스트 구간을 찾지 못했다');
  const load = unitItemLoad(boxes ?? []).find((l) => l.unit === '3-16');
  assert.ok((load?.items.length ?? 0) >= 2, '§3-16 을 인용하는 체크리스트 항목이 모자라다');
  assert.equal(load?.checked, 0, '체크된 칸이 커밋됐다(§6-9)');
});

/* ─────────────────────────────── 문서 ─────────────────────────────── */

test('RUNBOOK: §3-16 과 그것을 가리키는 §3-5 3번이 함께 남아 있다', () => {
  assert.deepEqual(auditRunbookAudience(RUNBOOK), []);

  assert.ok(auditRunbookAudience(RUNBOOK.replace(/^### 3-16\./m, '### 9-9.')).some((p) => p.includes('3-16')));
  const noCmd = RUNBOOK.replace(/audienceStatus\(/g, '보고(').replace(/assessAudience\(/g, '보고(');
  assert.ok(auditRunbookAudience(noCmd).some((p) => p.includes('산출 명령')));
  for (const v of AUDIENCE_VERDICTS) {
    const noRow = RUNBOOK.replace(new RegExp(`\`${v}\``, 'g'), '그 판정');
    assert.ok(auditRunbookAudience(noRow).some((p) => p.includes(v)), `${v} 행이 빠져도 통과했다`);
  }
  const noDrift = RUNBOOK.replace(/stale_contact/g, '옛 주소');
  assert.ok(auditRunbookAudience(noDrift).some((p) => p.includes('stale_contact')));
  const noSql = RUNBOOK.replace(/ROSTER_SNAPSHOT_SQL/g, '그 조회');
  assert.ok(auditRunbookAudience(noSql).some((p) => p.includes('받을 방법')));
  const noField = RUNBOOK.replace(/audienceVerdict/g, '그 칸');
  assert.ok(auditRunbookAudience(noField).some((p) => p.includes('audienceVerdict')));

  // §3-5 가 명단 내보내기를 잃으면 `preservable` 은 **받을 방법이 없는 할 일**이 된다
  const s35 = RUNBOOK.search(/^### 3-5\. /m);
  const s36 = RUNBOOK.search(/^### 3-6\. /m);
  const stripped = RUNBOOK.slice(0, s35)
    + RUNBOOK.slice(s35, s36).replace(/명단/g, '목록').replace(/3-16/g, '3-9')
    + RUNBOOK.slice(s36);
  const problems = auditRunbookAudience(stripped);
  assert.ok(problems.some((p) => p.includes('§3-5 가 명단')));
  assert.ok(problems.some((p) => p.includes('§3-16 으로 유도')));
  // 문서 구조를 못 읽으면 「문제 없음」으로 올리지 않는다
  assert.ok(auditRunbookAudience('').length > 0);
});

/* ─────────────────────────────── 규율 ─────────────────────────────── */

test('순수 모듈: DB·next·fs 미접근 · 신규 조회·쓰기·DDL·체크·env 0', () => {
  const body = MODULE_SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/from\s+['"](next|drizzle|node:fs|@\/db)/.test(body), '순수 모듈이 아니다');
  // `process.env` 는 **기본 인자**로만 쓴다(판정은 넘겨받은 스냅샷으로 한다)
  const envUses = [...body.matchAll(/process\.env/g)].length;
  const defaults = [...body.matchAll(/=\s*process\.env/g)].length;
  assert.equal(envUses, defaults, 'process.env 를 기본 인자 밖에서 읽는다');
  // 조회문은 문자열 상수 하나뿐이고 실행 경로가 없다
  assert.ok(!/db\.|execute\(|sql`/.test(body), '조회를 실행하는 경로가 생겼다');
  assert.deepEqual([...AUDIENCE_VERDICTS], ['not_applicable', 'preservable', 'claimed', 'window_closed', 'invalid_record']);
  // 임의 명단·임의 대상 금지: 모듈에 메일 주소·도메인 리터럴을 두지 않는다
  assert.ok(!/@[a-z0-9.-]+\.(com|net|kr)/i.test(body), '모듈에 메일 주소 리터럴이 있다');
});
