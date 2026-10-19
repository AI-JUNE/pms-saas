/**
 * lossNotice.test.ts — RUNBOOK §3 8단계 2번(유실 구간 **고지**)의 수행·기록. 2026-10-19
 *
 * ── 왜 필요한가 ──────────────────────────────────────────────────────────────
 * §3 의 모든 기계적 판정이 향하는 산출물은 하나뿐이고, 그것만 이 저장소 밖으로 나간다 —
 * 「손실 구간을 반드시 이해관계자에게 고지한다」. 그런데
 *  (1) 구간의 **시작**(복구 시점 T-ε)이 어디에도 기록되지 않았다(3단계는 브랜치 **지문**만
 *      적으라고 지시했다) — 끝만 알아도 구간은 산출되지 않는다.
 *  (2) 고지를 했다는 **근거**가 없었다(6-1·6-2단계는 기록 키가 있고 7단계가 그 둘을 선행
 *      조건으로 거는데, 되돌릴 수 없는 외부 커뮤니케이션에는 둘 다 없었다).
 *  (3) 8단계 4번의 표지 삭제에 **2·3번 완료를 보는 조건이 없었다** — 지운 뒤에는 고지 없이
 *      끝낸 복구와 제대로 끝낸 복구가 평상시 응답에서 글자 하나 다르지 않다.
 *
 * 그래서 (a) 판정 자체(두 끝이 없으면 **구간을 추정하지 않고**, 고지 기록이 없으면 **삭제를
 * 막는다**)와 (b) 배선(health 응답·사건 표지·임시 키·RUNBOOK 문장)을 파일 수준에서 고정한다.
 * 이 테스트는 **파일만 읽는다** — 네트워크·DB 를 쓰지 않고 `process.env` 도 바꾸지 않는다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  ACTION_BASIS_MISSING,
  ACTION_DUE,
  ACTION_NOTICE_BEFORE_END,
  CAVEAT_CLEARED_IS_INDISTINGUISHABLE,
  CAVEAT_RECORD_IS_A_CLAIM,
  NOTICE_AT_ENV,
  NOTICE_CHANNELS,
  NOTICE_LIMITS,
  NOTICE_OBLIGATIONS,
  NOTICE_STATES,
  RESTORE_POINT_ENV,
  UNKNOWN_CELL,
  assessNotice,
  auditHealthWiring,
  auditMarkerCoverage,
  auditRunbookNotice,
  auditTransientCoverage,
  automatedChannels,
  lossNoticeCheck,
  lossNoticeStatus,
  noticeFromEnv,
  noticeLogLine,
  noticeText,
  noticedAtFromEnv,
  recordRemark,
  restorePointFromEnv,
} from '../src/lib/lossNotice.ts';
import { INCIDENT_MARKERS } from '../src/lib/healthDisclosure.ts';
import { TRANSIENT_KEYS } from '../src/lib/envPresence.ts';
import { TIME_BOUND_CHECKS } from '../src/lib/healthSignal.ts';
import { ENV_VARS } from '../src/lib/envRegistry.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (...p: string[]) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

const RP = '2026-10-19T12:55:00+09:00'; // 복구 시점 T-ε (구간의 시작)
const FROZE = '2026-10-19T13:40:00+09:00'; // 차단이 실효된 시각 (구간의 끝)
const SENT = '2026-10-19T15:10:00+09:00'; // 고지를 발신한 시각
const NOW = new Date('2026-10-19T16:00:00+09:00');

/* ─────────────────────────── 정본 ─────────────────────────── */

test('고지 의무 정본: 출처·요구·되돌릴 수 있는지가 전건 채워져 있다', () => {
  assert.ok(NOTICE_OBLIGATIONS.length >= 4);
  for (const o of NOTICE_OBLIGATIONS) {
    assert.ok(o.source.trim() && o.demands.trim(), `${o.source} 칸이 비었다`);
    assert.equal(typeof o.irreversible, 'boolean');
  }
  // 되돌릴 수 없는 의무가 **있다**는 것이 이 모듈의 존재 이유다.
  assert.ok(NOTICE_OBLIGATIONS.some((o) => o.irreversible));
});

test('발신 통로 정본: **전건 수동**이 지금의 사실이다 — 보낸 척하지 않는다', () => {
  assert.ok(NOTICE_CHANNELS.length >= 4);
  for (const c of NOTICE_CHANNELS) {
    assert.ok(c.id.trim() && c.surface.trim() && c.why.trim(), `${c.id} 칸이 비었다`);
    assert.equal(c.automated, false, `${c.id} 가 자동 발신으로 선언됐다 — 발신 배선은 승인 사항이다`);
  }
  assert.deepEqual(automatedChannels(), []);
});

test('한계 목록이 「기록은 주장일 뿐」과 「지운 뒤에는 구별되지 않는다」를 담는다', () => {
  assert.ok(NOTICE_LIMITS.includes(CAVEAT_RECORD_IS_A_CLAIM));
  assert.ok(NOTICE_LIMITS.includes(CAVEAT_CLEARED_IS_INDISTINGUISHABLE));
  assert.ok(NOTICE_LIMITS.some((l) => /발신하지 않는다/.test(l)));
});

/* ─────────────────────────── 판정 ─────────────────────────── */

test('평상시: 차단 OFF · 표지 없음 → normal, 막을 것도 없다', () => {
  const a = assessNotice({ frozen: false, now: NOW });
  assert.equal(a.state, 'normal');
  assert.deepEqual(a.blockers, []);
  assert.equal(a.canClearMarkers, true);
  assert.equal(a.noticedAt, null);
});

test('차단 중 + 두 끝 모두 기록 + 고지 미기록 → due(구간은 확정됐다)', () => {
  const a = assessNotice({ restorePoint: RP, frozenAt: FROZE, frozen: true, now: NOW });
  assert.equal(a.state, 'due');
  assert.equal(a.window.verdict, 'ok');
  assert.equal(a.window.minutes, 45);
  assert.equal(a.restorePointRecorded, true);
  assert.equal(a.freezeAtRecorded, true);
  assert.equal(a.action, ACTION_DUE);
  // **고지 기록이 없으면 표지를 지우지 못한다** — 이 절의 핵심 게이트다.
  assert.equal(a.canClearMarkers, false);
  assert.ok(a.blockers.some((b) => b.includes(NOTICE_AT_ENV)));
});

test('차단 중인데 **시작이 없다** → basis_missing (끝만 알아도 구간은 산출되지 않는다)', () => {
  const a = assessNotice({ frozenAt: FROZE, frozen: true, now: NOW });
  assert.equal(a.state, 'basis_missing');
  assert.equal(a.window.verdict, 'invalid_restore_point');
  assert.equal(a.restorePointRecorded, false);
  assert.equal(a.window.minutes, null, '구간을 추정했다');
  assert.equal(a.action, ACTION_BASIS_MISSING);
  assert.equal(a.canClearMarkers, false);
  assert.ok(a.blockers.some((b) => /확정되지 않았다/.test(b)));
});

test('차단 중인데 **끝이 없다** → basis_missing (시작만으로도 확정하지 않는다)', () => {
  const a = assessNotice({ restorePoint: RP, frozen: true, now: NOW });
  assert.equal(a.state, 'basis_missing');
  assert.equal(a.window.verdict, 'end_unrecorded');
  assert.equal(a.freezeAtRecorded, false);
  assert.equal(a.window.minutes, null);
});

test('고지 기록이 있으면 notified — 구간 수치는 §3-7 판정을 그대로 쓴다', () => {
  const a = assessNotice({ restorePoint: RP, frozenAt: FROZE, noticedAt: SENT, frozen: true, now: NOW });
  assert.equal(a.state, 'notified');
  assert.equal(a.noticedAt, new Date(SENT).toISOString());
  assert.equal(a.canClearMarkers, true);
  assert.deepEqual(a.blockers, []);
});

test('고지가 **구간의 끝보다 앞이면** notice_before_end — 기록이 있어도 통과시키지 않는다', () => {
  const a = assessNotice({
    restorePoint: RP,
    frozenAt: FROZE,
    noticedAt: '2026-10-19T13:00:00+09:00', // 차단 실효 전에 보낸 장애 공지
    frozen: true,
    now: NOW,
  });
  assert.equal(a.state, 'notice_before_end');
  assert.equal(a.action, ACTION_NOTICE_BEFORE_END);
  assert.equal(a.canClearMarkers, false);
  assert.ok(a.blockers.some((b) => /끝보다 앞/.test(b)));
});

test('판독 불가는 invalid_record — 「미기록」과 섞지 않는다(할 일이 다르다)', () => {
  for (const bad of ['어제', '2026-13-01T00:00:00Z', '2026-02-30T00:00:00Z', 'now']) {
    const a = assessNotice({ restorePoint: RP, frozenAt: FROZE, noticedAt: bad, frozen: true, now: NOW });
    assert.equal(a.state, 'invalid_record', `${bad} 를 invalid_record 로 보지 않았다`);
    assert.equal(a.noticedAt, null);
    assert.equal(a.canClearMarkers, false);
  }
});

test('차단은 풀렸는데 고지 기록이 남아 있으면 stale_record(8단계 4번에서 지운다)', () => {
  const a = assessNotice({ restorePoint: RP, frozenAt: FROZE, noticedAt: SENT, frozen: false, now: NOW });
  assert.equal(a.state, 'stale_record');
  assert.equal(a.canClearMarkers, true, '지우라는 상태인데 막았다');
});

test('차단은 풀렸는데 **고지 기록 없이** 표지만 남아 있으면 due 로 남긴다', () => {
  const a = assessNotice({ restorePoint: RP, frozenAt: FROZE, frozen: false, now: NOW });
  assert.equal(a.state, 'due');
  assert.equal(a.canClearMarkers, false, '고지 없이 지울 수 있게 뒀다');
});

test('판정 목록이 정본과 어긋나지 않는다', () => {
  const seen = new Set<string>();
  for (const input of [
    { frozen: false },
    { frozen: true, frozenAt: FROZE },
    { frozen: true, restorePoint: RP, frozenAt: FROZE },
    { frozen: true, restorePoint: RP, frozenAt: FROZE, noticedAt: SENT },
    { frozen: true, restorePoint: RP, frozenAt: FROZE, noticedAt: '2026-10-19T13:00:00+09:00' },
    { frozen: true, restorePoint: RP, frozenAt: FROZE, noticedAt: 'xx' },
    { frozen: false, restorePoint: RP, frozenAt: FROZE, noticedAt: SENT },
  ]) {
    seen.add(assessNotice({ ...input, now: NOW }).state);
  }
  for (const s of seen) assert.ok(NOTICE_STATES.includes(s as never), `${s} 가 정본에 없다`);
  assert.equal(seen.size, NOTICE_STATES.length, '도달하지 못하는 판정이 있다');
});

/* ─────────────────────────── 출력 ─────────────────────────── */

test('§6 표 비고: 구간과 고지 시각을 함께 만들고, 미확정은 수치를 적지 않는다', () => {
  const ok = recordRemark(assessNotice({ restorePoint: RP, frozenAt: FROZE, noticedAt: SENT, frozen: true, now: NOW }));
  assert.match(ok, /유실 구간 .* ~ .*\(45분\)/);
  assert.ok(ok.includes(new Date(SENT).toISOString()));

  const noSend = recordRemark(assessNotice({ restorePoint: RP, frozenAt: FROZE, frozen: true, now: NOW }));
  assert.ok(noSend.includes(UNKNOWN_CELL), '고지 미기록을 지어냈다');

  const noWindow = recordRemark(assessNotice({ frozenAt: FROZE, frozen: true, now: NOW }));
  assert.ok(noWindow.includes('미확정'));
  assert.ok(!/\d+분/.test(noWindow), '미확정 구간에 수치를 적었다');
});

test('로그 한 줄: 판정·존재 여부만 — 시각 값·구간 수치를 담지 않는다', () => {
  const line = noticeLogLine(assessNotice({ restorePoint: RP, frozenAt: FROZE, frozen: true, now: NOW }));
  assert.match(line, /^recovery_loss_notice state=due window=ok restore_point=set notified=absent clearable=false$/);
  assert.ok(!line.includes('12:55') && !line.includes('45'));
});

test('사람용 요약은 보류 이유를 함께 적는다', () => {
  const text = noticeText(assessNotice({ restorePoint: RP, frozenAt: FROZE, frozen: true, now: NOW }));
  assert.match(text, /표지 삭제 보류/);
});

/* ─────────────────────────── env 로더 ─────────────────────────── */

test('env 로더: 두 키만 인정하고 **기본값을 만들지 않는다**', () => {
  assert.deepEqual(restorePointFromEnv({}), { raw: null, at: null });
  assert.deepEqual(noticedAtFromEnv({}), { raw: null, at: null });
  assert.deepEqual(restorePointFromEnv({ RECOVERY_RESTORE_POINT: '  ' }), { raw: null, at: null });

  const bad = noticedAtFromEnv({ RECOVERY_LOSS_NOTICE_AT: '어제' });
  assert.equal(bad.raw, '어제');
  assert.equal(bad.at, null, '못 읽는 값을 기록됨으로 올렸다');

  const good = restorePointFromEnv({ RECOVERY_RESTORE_POINT: RP });
  assert.equal(good.at, new Date(RP).toISOString());
});

test('noticeFromEnv: 차단 스위치를 **느슨하게 읽지 않는다**(`true` 만 ON)', () => {
  const loose = noticeFromEnv({ RECOVERY_WRITE_FREEZE: '1', RECOVERY_RESTORE_POINT: RP }, NOW);
  assert.equal(loose.state, 'due', '1 을 ON 으로 읽었다');
  const on = noticeFromEnv(
    { RECOVERY_WRITE_FREEZE: 'true', RECOVERY_RESTORE_POINT: RP, RECOVERY_WRITE_FREEZE_AT: FROZE },
    NOW,
  );
  assert.equal(on.state, 'due');
  assert.equal(on.window.verdict, 'ok');
});

/* ─────────────────────────── health 체크 ─────────────────────────── */

test('헬스 체크: required:false 이고 **구간 수치·복구 시점 값을 담지 않는다**', () => {
  const c = lossNoticeCheck({
    env: { RECOVERY_WRITE_FREEZE: 'true', RECOVERY_RESTORE_POINT: RP, RECOVERY_WRITE_FREEZE_AT: FROZE },
    now: NOW,
  });
  assert.equal(c.required, false);
  assert.equal(c.ok, false); // due → degraded(200)
  assert.equal(c.detail.state, 'due');
  assert.equal(c.detail.windowVerdict, 'ok');
  assert.equal(c.detail.restorePointRecorded, true);
  assert.equal(c.detail.canClearMarkers, false);
  assert.deepEqual(c.detail.automatedChannels, []);

  // 응답 덤프 검사: 구간 수치(45)·복구 시점 값·차단 시각 값이 새어 나가지 않는다.
  const dump = JSON.stringify(c);
  assert.ok(!dump.includes('12:55'), '복구 시점 값이 응답에 들어 있다');
  assert.ok(!dump.includes('13:40'), '차단 시각 값이 응답에 들어 있다');
  assert.ok(!/"minutes"/.test(dump), '구간 수치가 응답에 들어 있다');
});

test('헬스 체크: 평상시와 고지 완료만 ok 다', () => {
  assert.equal(lossNoticeCheck({ env: {}, now: NOW }).ok, true);
  assert.equal(
    lossNoticeCheck({
      env: {
        RECOVERY_WRITE_FREEZE: 'true',
        RECOVERY_RESTORE_POINT: RP,
        RECOVERY_WRITE_FREEZE_AT: FROZE,
        RECOVERY_LOSS_NOTICE_AT: SENT,
      },
      now: NOW,
    }).ok,
    true,
  );
  // 고지 기록이 남은 평상시는 ok 가 아니다(다음 사건의 거짓 근거가 된다).
  assert.equal(lossNoticeCheck({ env: { RECOVERY_LOSS_NOTICE_AT: SENT }, now: NOW }).ok, false);

  const st = lossNoticeStatus({}, NOW);
  assert.equal(st.state, 'normal');
  assert.equal(st.automated, 0);
  assert.equal(st.channels, NOTICE_CHANNELS.length);
});

/* ─────────────────────────── 정적 점검 ─────────────────────────── */

test('auditHealthWiring: 판정만 하고 버리는 꼴을 잡는다', () => {
  assert.ok(auditHealthWiring('').length >= 2);
  assert.ok(
    auditHealthWiring("import {lossNoticeCheck} from '@/lib/lossNotice';\nlossNoticeCheck();").some((p) =>
      /checks\.lossNotice/.test(p),
    ),
  );
  assert.deepEqual(
    auditHealthWiring("import {lossNoticeCheck} from '@/lib/lossNotice';\nchecks.lossNotice = lossNoticeCheck();"),
    [],
  );
});

test('auditMarkerCoverage·auditTransientCoverage: 모양이 바뀌면 조용히 통과시키지 않는다', () => {
  assert.ok(auditMarkerCoverage(null)[0].includes('읽을 수 없다'));
  assert.ok(auditTransientCoverage(null)[0].includes('읽을 수 없다'));
  assert.equal(auditMarkerCoverage([{ key: RESTORE_POINT_ENV }, { key: NOTICE_AT_ENV }]).length, 0);
  assert.equal(auditMarkerCoverage([{ key: RESTORE_POINT_ENV }]).length, 1);
  assert.equal(auditTransientCoverage([RESTORE_POINT_ENV, NOTICE_AT_ENV]).length, 0);
  assert.equal(auditTransientCoverage(['OTHER']).length, 2);
});

test('auditRunbookNotice: §3-10·3단계 기록·8단계 게이트가 빠지면 잡는다', () => {
  const problems = auditRunbookNotice('');
  assert.ok(problems.some((p) => /3-10/.test(p)));
  assert.ok(problems.some((p) => p.includes(RESTORE_POINT_ENV)));
  assert.ok(problems.some((p) => p.includes(NOTICE_AT_ENV)));
});

test('auditRunbookNotice: 절은 있는데 **단계 지시가 되돌아간** 문서를 잡는다', () => {
  // 절·명령·키는 다 있고, 3단계가 「지문만」·8단계가 「표에 적는다」로 되돌아간 모양.
  const doc = [
    '## 3. DB 복구 절차',
    '1. 중단 결정',
    '3. 복구 브랜치 생성 — 지문을 적어 둔다',
    '4. 검증',
    '8. 사후 — `/api/health` 보고 6절 표에 적는다',
    '',
    '### 3-1. 빈 DB',
    '### 3-10. 유실 고지 — lossNoticeStatus({})',
    '`RECOVERY_RESTORE_POINT` · `RECOVERY_LOSS_NOTICE_AT`',
  ].join('\n');
  assert.deepEqual(auditRunbookNotice(doc), [
    `3단계가 ${RESTORE_POINT_ENV} 기록을 지시하지 않는다 — 유실 구간의 시작이 어디에도 남지 않는다`,
    `8단계가 ${NOTICE_AT_ENV} 기록을 지시하지 않는다 — 고지 수행 근거가 남지 않는다`,
    '8단계가 §3-10 으로 유도하지 않는다',
    '8단계 4번(표지 삭제)이 2·3번 완료를 선행 조건으로 걸지 않는다 — 삭제가 고지를 앞지른다',
  ]);
});

test('auditRunbookNotice: 단계 자체가 사라진 문서도 조용히 통과시키지 않는다', () => {
  const doc = [
    '## 3. DB 복구 절차',
    '',
    '### 3-1. 빈 DB',
    '### 3-10. 유실 고지 — lossNoticeStatus({})',
    '`RECOVERY_RESTORE_POINT` · `RECOVERY_LOSS_NOTICE_AT`',
  ].join('\n');
  assert.deepEqual(auditRunbookNotice(doc), ['§3 3단계를 찾지 못했다', '§3 8단계를 찾지 못했다']);
});

/* ─────────────────────── 실제 소스·문서 대조 ─────────────────────── */

test('[실제 소스] /api/health 에 checks.lossNotice 가 배선돼 있다', () => {
  assert.deepEqual(auditHealthWiring(read('src', 'app', 'api', 'health', 'route.ts')), []);
});

test('[실제 소스] 두 키가 사건 표지·임시 키 목록에 들어 있다', () => {
  assert.deepEqual(auditMarkerCoverage(INCIDENT_MARKERS), []);
  assert.deepEqual(auditTransientCoverage(TRANSIENT_KEYS), []);
});

test('[실제 소스] 이 체크가 **시한부** 정본에 올라 있다(창이 닫히면 신호가 사라진다)', () => {
  assert.ok(TIME_BOUND_CHECKS.some((t) => t.name === 'lossNotice'));
});

test('[실제 소스] 두 키가 env 레지스트리에 등록돼 있다', () => {
  for (const key of [RESTORE_POINT_ENV, NOTICE_AT_ENV]) {
    const def = ENV_VARS.find((v) => v.key === key);
    assert.ok(def, `${key} 가 레지스트리에 없다`);
    assert.equal(def?.kind, 'config');
    assert.ok(def?.note.trim());
  }
});

test('[실제 문서] RUNBOOK 이 3단계 기록·8단계 고지·§3-10·삭제 게이트를 지시한다', () => {
  assert.deepEqual(auditRunbookNotice(read('RUNBOOK.md')), []);
});

test('[실제 소스] 모듈은 DB·next·fs 를 건드리지 않고 **발신하지 않는다**', () => {
  const src = read('src', 'lib', 'lossNotice.ts');
  for (const bad of ['@/db', "from 'next", 'node:fs', 'drizzle-orm', 'fetch(', 'sendMail', 'nodemailer']) {
    assert.ok(!src.includes(bad), `순수 모듈이 ${bad} 를 쓴다`);
  }
  // env 는 명시 로더에서만 읽는다(기본 인자 2곳 + process.env 기본값).
  assert.ok(!/process\.env\.[A-Z]/.test(src), 'process.env 를 직접 읽는다');
});
