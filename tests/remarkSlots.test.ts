// **비고 칸에 무엇이 적혀야 하는지가 정본으로 없다**(RUNBOOK §3-23 · §3 8단계 · §6 · §6-7 · §6-8). 2026-10-31
//
// 이 파일이 지키는 것은 둘이다.
//  (1) **침묵을 통과로 덮지 않는다** — 세 결정(원본 브랜치·검증 배포 포인터·기준 지문)은
//      「남긴다」 쪽만 적으라는 지시여서, 비고에 그 말이 없는 상태가 「뗐다」와 「확정하지
//      않았다」 **둘 다**를 뜻했다. 그래서 `undeclared` 를 통과로 올리지 않는다.
//  (2) **거짓 차단을 만들지 않는다** — §2 월 점검 행은 §3 절차를 하나도 수행하지 않으므로
//      적을 것이 없고(`not_applicable`), 목적을 못 읽으면 보류(`undecidable`)다. 조건부 넷의
//      없음은 두 뜻이라 미기록으로 세지 않는다. 어떤 게이트도 이 판정으로 닫지 않는다.
// 더해서 실제 §6-4 칸 정본·헬스 라우트·절차 단위 정본·이 모듈과 RUNBOOK 원문을 대조해
// 문서와 코드가 함께 낡지 않게 한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  ACTION_REMARK_COMPLETE, ACTION_REMARK_EMPTY, ACTION_REMARK_NOT_APPLICABLE,
  ACTION_REMARK_PARTIAL, ACTION_REMARK_UNDECIDABLE, ACTION_REMARK_UNDECLARED,
  ACTION_REMARK_UNPARSED, CAVEAT_NOT_A_GATE, CAVEAT_REMARK_IS_A_CLAIM,
  CAVEAT_SILENCE_IS_TWO_THINGS, REMARK_BLIND_SPOTS, REMARK_COLUMN, REMARK_LIMITS,
  REMARK_MISREADS, REMARK_RUNBOOK_REF, REMARK_SLOTS, REMARK_VERDICTS, SLOT_SEPARATOR,
  UNKNOWN_CELL,
  assessRemarkSlots, auditLedgerNoteField, auditNoNewEnv, auditNoNewHealthCheck,
  auditRemarkCanon, auditRunbookRemark, auditSelfSource, auditSlotSections, hasFreeText,
  parseRemarkSlots, publicRemarks, remarkDraft, remarkLine, remarkMisreadFor, remarkSlotFor,
  remarkSlotsStatus, remarkText, requiredSlots,
} from '../src/lib/remarkSlots.ts';
import { LEDGER_FIELDS, parseLedgerTable } from '../src/lib/rehearsalLedger.ts';
import { auditLedgerHomes, parseRemarkWindow } from '../src/lib/restorePointRecord.ts';
import { PROCEDURE_UNITS } from '../src/lib/rehearsalCoverage.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (...rel: string[]) => fs.readFileSync(path.join(ROOT, ...rel), 'utf8');
const RUNBOOK = read('RUNBOOK.md');
const SELF_SRC = read('src', 'lib', 'remarkSlots.ts');
const HEALTH_SRC = read('src', 'app', 'api', 'health', 'route.ts');

/** 사건 하루 — 중단 결정 12:05 → 차단 12:30 → 해제 15:40 (KST) */
const HALT = '2026-10-30T12:05:00+09:00';
const FROZE = '2026-10-30T12:30:00+09:00';
const RELEASE = '2026-10-30T15:40:00+09:00';
const DISPOSAL = '2026-11-29';

/** 표지가 남아 있는 상태 = 아직 옮겨 적을 수 있다 */
const MARKERS_OPEN = { RECOVERY_WRITE_FREEZE_AT: FROZE };
/** 8단계 4번을 마친 뒤 = 평상시와 같은 모습 */
const MARKERS_CLEARED: Record<string, string | undefined> = {};

const row = (note: string, kindRaw = '사건') => ({ note, kind: 'incident' as const, kindRaw, date: '2026-10-30' });
const rehearsalRow = (note: string) => ({ note, kind: 'periodic' as const, kindRaw: '정기', date: '2026-10-30' });

/** 사건 행에 필수인 여섯 칸을 모두 적은 비고 */
const FULL = remarkDraft({
  haltAt: HALT,
  releaseAt: RELEASE,
  disposalDue: DISPOSAL,
  sourceBranch: 'kept',
  sourceDetail: '기한 2026-11-29',
  pointer: 'released',
  pin: 'released',
});

/* ─────────────────────────────── 정본 ─────────────────────────────── */

test('정본: 비고 칸에 들어가는 열두 가지에 종류·지시한 절·되찾을 수 없는 때가 적혀 있다', () => {
  assert.deepEqual(auditRemarkCanon(), []);
  assert.equal(REMARK_SLOTS.length, 12);
  assert.deepEqual(REMARK_SLOTS.map((s) => s.key), [
    'loss_window', 'notice_at', 'halt_at', 'release_at', 'disposal_due',
    'source_branch', 'pointer', 'pin', 'boot_writes', 'rto_breach', 'audience_gap', 'extract_waived',
  ]);
  // ⬅ 이 절이 생긴 이유 — 되읽는 쪽이 있는 것은 §6-7 의 **둘**뿐이고 열은 없다
  assert.deepEqual(REMARK_SLOTS.filter((s) => s.rereadBy).map((s) => s.key), ['loss_window', 'notice_at']);
  assert.equal(REMARK_SLOTS.filter((s) => !s.rereadBy).length, 10);
  assert.equal(REMARK_SLOTS.filter((s) => s.kind === 'decision').length, 3);
  assert.equal(remarkSlotFor('pointer')?.keptNeeds, '그 스코프');
  assert.equal(remarkSlotFor('없는 칸'), null);
});

test('정본: 결정 슬롯을 필수에서 빼거나 조건부를 필수로 올리면 CI 에서 걸린다', () => {
  assert.ok(auditRemarkCanon([]).length > 0);
  const silentDecision = REMARK_SLOTS.map((s) => (s.kind === 'decision' ? { ...s, requiredFor: [] } : s));
  assert.ok(auditRemarkCanon(silentDecision).some((p) => p.includes('침묵이 두 뜻')));
  const forcedConditional = REMARK_SLOTS.map((s) =>
    s.kind === 'conditional' ? { ...s, requiredFor: ['incident' as const] } : s,
  );
  assert.ok(auditRemarkCanon(forcedConditional).some((p) => p.includes('거짓 차단')));
  const onCheckRow = [{ ...REMARK_SLOTS[2], requiredFor: ['check' as const] }, ...REMARK_SLOTS.slice(3)];
  assert.ok(auditRemarkCanon(onCheckRow).some((p) => p.includes('점검')));
  const blank = [{ ...REMARK_SLOTS[2], lostWhen: ' ' }, ...REMARK_SLOTS.slice(3)];
  assert.ok(auditRemarkCanon(blank).some((p) => p.includes('빈 칸')));
});

test('정본: 라벨이 서로를 집어먹으면 CI 에서 걸린다 ⬅ 파서가 엉뚱한 구간을 읽는다', () => {
  // `지문` 은 `기준 지문` 의 부분 문자열이다 — 파서가 그 구간을 먼저 집어 버린다
  const eaten = [...REMARK_SLOTS.slice(0, 2), { ...REMARK_SLOTS[2], label: '지문' }, ...REMARK_SLOTS.slice(3)];
  assert.ok(auditRemarkCanon(eaten).some((p) => p.includes('집어먹')));
  // 실제 정본은 어느 라벨도 다른 라벨의 부분 문자열이 아니다
  for (const a of REMARK_SLOTS) {
    for (const b of REMARK_SLOTS) {
      if (a.key !== b.key) assert.ok(!b.label.includes(a.label), `${a.label} ⊂ ${b.label}`);
    }
  }
});

test('정본: 거짓이 되는 판정 다섯과 사각지대가 사유와 함께 있다', () => {
  assert.equal(REMARK_MISREADS.length, 5);
  assert.deepEqual(REMARK_MISREADS.map((m) => m.key), [
    'silence_is_release', 'free_text_is_record', 'window_only_is_complete', 'cleared_is_done', 'check_row_is_incomplete',
  ]);
  assert.ok(remarkMisreadFor('silence_is_release')?.why.includes('남긴 경우에만'));
  assert.equal(remarkMisreadFor('없는 판정'), null);
  const dropped = REMARK_MISREADS.filter((m) => m.key !== 'silence_is_release');
  assert.ok(auditRemarkCanon(REMARK_SLOTS, dropped).some((p) => p.includes('silence_is_release')));
  const noFalseBlock = REMARK_MISREADS.filter((m) => m.key !== 'check_row_is_incomplete');
  assert.ok(auditRemarkCanon(REMARK_SLOTS, noFalseBlock).some((p) => p.includes('거짓 차단')));
  assert.ok(REMARK_BLIND_SPOTS.length >= 5);
  assert.ok(REMARK_LIMITS.length >= 5);
});

test('필수 칸은 행의 **목적별로** 다르다 — 점검 행은 하나도 없다', () => {
  assert.deepEqual(requiredSlots('incident').map((s) => s.key), [
    'halt_at', 'release_at', 'disposal_due', 'source_branch', 'pointer', 'pin',
  ]);
  // 전환까지 가지 않은 리허설이 많아 `기준 지문` 은 빼 두었다(거짓 차단을 만들지 않는다)
  assert.deepEqual(requiredSlots('rehearsal').map((s) => s.key), [
    'halt_at', 'release_at', 'disposal_due', 'source_branch', 'pointer',
  ]);
  assert.deepEqual(requiredSlots('check'), []);
  // 구간·고지는 §6-7 이 판정의 주인이라 어느 목적에서도 필수가 아니다(중복 보고 금지)
  for (const key of ['loss_window', 'notice_at'] as const) {
    assert.deepEqual(remarkSlotFor(key)?.requiredFor, []);
  }
});

/* ─────────────────────────── 한 칸 읽기 ─────────────────────────── */

test('구간·고지는 §6-7 판독을 **그대로** 쓴다 ⬅ 같은 문구를 두 곳에서 읽으면 갈라진다', () => {
  const note = `유실 구간 2026-10-30T03:00:00.000Z ~ 2026-10-30T03:30:00.000Z(30분) · 고지 2026-10-30T07:10:00+09:00`;
  const w = parseRemarkWindow(note);
  const readings = parseRemarkSlots(note);
  const window = readings.find((r) => r.key === 'loss_window');
  const notice = readings.find((r) => r.key === 'notice_at');
  assert.equal(window?.found, true);
  assert.equal(window?.at, w.startsAt);
  assert.equal(notice?.at, w.noticedAt);
  // 어긋남은 §6-7 이 말한다 — 여기서 다시 적지 않는다
  assert.equal(window?.invalid, null);
  assert.equal(notice?.invalid, null);
});

test('값 슬롯: 정본 라벨 뒤의 시각만 읽고, 타임존 없는·비실존 시각은 받지 않는다', () => {
  const ok = parseRemarkSlots(`중단 결정 ${HALT} · 차단 해제 ${RELEASE} · 사본 폐기 기한 ${DISPOSAL}`);
  assert.equal(ok.find((r) => r.key === 'halt_at')?.at, new Date(HALT).toISOString());
  assert.equal(ok.find((r) => r.key === 'release_at')?.at, new Date(RELEASE).toISOString());
  assert.equal(ok.find((r) => r.key === 'disposal_due')?.at, new Date(`${DISPOSAL}T00:00:00Z`).toISOString());

  const bad = parseRemarkSlots('중단 결정 어제 낮 · 차단 해제 2026-02-30T10:00:00+09:00 · 사본 폐기 기한');
  assert.equal(bad.find((r) => r.key === 'halt_at')?.invalid, '시각을 읽을 수 없다');
  assert.equal(bad.find((r) => r.key === 'release_at')?.invalid, '시각을 읽을 수 없다');
  assert.equal(bad.find((r) => r.key === 'disposal_due')?.invalid, '라벨만 있고 내용이 없다');
  // 판독 실패 이유에 **값을 담지 않는다**(공개 응답에 함께 나간다)
  for (const r of bad) assert.ok(!(r.invalid ?? '').includes('2026'));
});

test('`[확인 필요]` 는 **명시된 공백**이다 — 어긋남이 아니다', () => {
  const r = parseRemarkSlots(`중단 결정 ${UNKNOWN_CELL} · 차단 해제 ${RELEASE}`);
  const halt = r.find((x) => x.key === 'halt_at');
  assert.equal(halt?.declaredUnknown, true);
  assert.equal(halt?.invalid, null);
  assert.equal(halt?.at, null, '모르는 값을 지어내지 않는다');
});

test('결정 슬롯: 남긴다·뗀다를 가리고, 한 칸에 둘이 있으면 어느 쪽도 고르지 않는다', () => {
  const kept = parseRemarkSlots('원본 브랜치 보존(기한 2026-11-29) · 검증 배포 포인터 유지(Preview) · 기준 지문 고정 유지');
  assert.equal(kept.find((r) => r.key === 'source_branch')?.side, 'kept');
  assert.equal(kept.find((r) => r.key === 'pointer')?.side, 'kept');
  assert.equal(kept.find((r) => r.key === 'pin')?.side, 'kept');
  for (const r of kept) assert.equal(r.invalid, null);

  const released = parseRemarkSlots('원본 브랜치 삭제 · 검증 배포 포인터 해제 · 기준 지문 삭제');
  assert.equal(released.find((r) => r.key === 'source_branch')?.side, 'released');
  assert.equal(released.find((r) => r.key === 'pointer')?.side, 'released');

  const both = parseRemarkSlots('검증 배포 포인터 유지 뒤 해제');
  assert.equal(both.find((r) => r.key === 'pointer')?.side, 'unreadable');
  const neither = parseRemarkSlots('검증 배포 포인터 Preview');
  assert.equal(neither.find((r) => r.key === 'pointer')?.side, 'unreadable');
});

test('「남긴다」를 골랐으면 함께 적을 것이 있어야 한다 ⬅ 스코프 없는 「유지」는 처분이 아니다', () => {
  const thin = parseRemarkSlots('원본 브랜치 보존 · 검증 배포 포인터 유지');
  assert.ok(thin.find((r) => r.key === 'source_branch')?.invalid?.includes('보관 기한'));
  assert.ok(thin.find((r) => r.key === 'pointer')?.invalid?.includes('그 스코프'));
  // `기준 지문` 은 함께 적을 것이 없다(§3-12 가 요구하지 않는다) — 그래서 어긋남이 아니다
  assert.equal(parseRemarkSlots('기준 지문 고정 유지').find((r) => r.key === 'pin')?.invalid, null);
});

test('자유 메모에서 값을 주워 오지 않고, 옆 칸의 말이 섞이지 않는다', () => {
  const r = parseRemarkSlots('담당자 교대 2026-10-30T20:00:00+09:00 에 인계 · 원본 브랜치 삭제');
  assert.equal(r.find((x) => x.key === 'halt_at')?.found, false, '라벨 없는 시각을 중단 결정으로 읽지 않는다');
  assert.equal(r.find((x) => x.key === 'release_at')?.found, false);
  // 「원본 브랜치 삭제」의 `삭제` 가 앞 칸으로 번지지 않는다(구분자까지만 본다)
  assert.equal(r.find((x) => x.key === 'source_branch')?.side, 'released');
  assert.equal(hasFreeText('담당자 교대에 인계 · 원본 브랜치 삭제'), true);
  assert.equal(hasFreeText(FULL), false, '잘 적은 비고가 자유 메모로 세어지면 늘 경보가 된다');
  assert.equal(hasFreeText(''), false);
});

/* ─────────────────────────────── 판정 ─────────────────────────────── */

test('점검 행은 `not_applicable` ⬅ §2 월 점검은 §3 절차를 하나도 수행하지 않는다', () => {
  const a = assessRemarkSlots({ row: { note: '', kind: 'unknown', kindRaw: '점검', date: '2026-10-30' } });
  assert.equal(a.verdict, 'not_applicable');
  assert.equal(a.purpose, 'check');
  assert.equal(a.action, ACTION_REMARK_NOT_APPLICABLE);
  assert.deepEqual(a.missing, [], '매월 거짓 차단이 뜨면 아무도 이 판정을 보지 않게 된다');
});

test('목적을 읽을 수 없으면 `undecidable` — **보류이고 통과가 아니다**', () => {
  for (const kindRaw of ['정기 점검', '복구', '']) {
    const a = assessRemarkSlots({ row: { note: '', kind: 'unknown', kindRaw, date: '2026-10-30' } });
    assert.equal(a.verdict, 'undecidable', kindRaw);
    assert.equal(a.action, ACTION_REMARK_UNDECIDABLE);
    assert.notEqual(a.verdict, 'complete');
  }
  // 행이 없으면 평상시다 — 런타임은 §6 표를 읽지 않는다
  assert.equal(assessRemarkSlots().verdict, 'not_applicable');
  assert.equal(assessRemarkSlots({ row: null }).purpose, 'absent');
});

test('빈 칸은 `empty`, 적혀 있는데 정본 라벨이 아니면 `unparsed`', () => {
  const empty = assessRemarkSlots({ row: row(''), markers: MARKERS_OPEN });
  assert.equal(empty.verdict, 'empty');
  assert.equal(empty.action, ACTION_REMARK_EMPTY);
  assert.equal(empty.missing.length, 3, '값 셋이 빠졌다');

  const prose = assessRemarkSlots({ row: row('포인터는 정리했고 브랜치는 나중에 보기로 했다'), markers: MARKERS_OPEN });
  assert.equal(prose.verdict, 'unparsed');
  assert.equal(prose.action, ACTION_REMARK_UNPARSED);
  assert.equal(prose.freeText, true, '기록은 남아도 판정은 사라진다(`free_text_is_record`)');
});

test('값이 빠지면 `partial`, 값만 다 적히고 결정이 비면 `undeclared`', () => {
  const partial = assessRemarkSlots({ row: row(`차단 해제 ${RELEASE} · 원본 브랜치 삭제`), markers: MARKERS_OPEN });
  assert.equal(partial.verdict, 'partial');
  assert.deepEqual(partial.missing, ['halt_at', 'disposal_due']);
  assert.equal(partial.action, ACTION_REMARK_PARTIAL);

  const values = remarkDraft({ haltAt: HALT, releaseAt: RELEASE, disposalDue: DISPOSAL }).split(SLOT_SEPARATOR)
    .filter((p) => !/원본 브랜치|검증 배포 포인터|기준 지문/.test(p)).join(SLOT_SEPARATOR);
  const undeclared = assessRemarkSlots({ row: row(values), markers: MARKERS_OPEN });
  assert.equal(undeclared.verdict, 'undeclared');
  assert.deepEqual(undeclared.undeclared, ['source_branch', 'pointer', 'pin']);
  assert.equal(undeclared.action, ACTION_REMARK_UNDECLARED);
  assert.notEqual(undeclared.verdict, 'complete', '침묵을 통과로 덮지 않는다(`silence_is_release`)');
});

test('필수 전건이 정본 라벨로 적히면 `complete`', () => {
  const a = assessRemarkSlots({ row: row(FULL), markers: MARKERS_OPEN });
  assert.equal(a.verdict, 'complete');
  assert.equal(a.action, ACTION_REMARK_COMPLETE);
  assert.deepEqual(a.missing, []);
  assert.deepEqual(a.undeclared, []);
  assert.deepEqual(a.invalid, []);
  assert.equal(a.required.length, 6);
  // 구간·고지는 여기서 세지 않는다 — 없음이 `silent` 로만 적힌다(§6-7 이 주인이다)
  assert.ok(a.silent.includes('loss_window'));
  assert.ok(a.silent.includes('notice_at'));
  assert.ok(a.caveats.includes(CAVEAT_SILENCE_IS_TWO_THINGS));
  assert.ok(a.caveats.includes(CAVEAT_REMARK_IS_A_CLAIM));
  assert.ok(a.caveats.includes(CAVEAT_NOT_A_GATE));
});

test('조건부 넷의 없음은 **미기록이 아니다** — 있었던 것만 적는다', () => {
  const a = assessRemarkSlots({ row: row(FULL), markers: MARKERS_OPEN });
  for (const key of ['boot_writes', 'rto_breach', 'audience_gap', 'extract_waived']) {
    assert.ok(a.silent.includes(key as never), `${key} 가 silent 에 없다`);
    assert.ok(!a.missing.includes(key as never), `${key} 를 미기록으로 셌다`);
  }
  const withBoot = assessRemarkSlots({ row: row(`${FULL} · 기동 쓰기 users,organizations · 약속 초과`), markers: MARKERS_OPEN });
  assert.equal(withBoot.verdict, 'complete');
  assert.ok(withBoot.present.includes('boot_writes'));
  assert.ok(withBoot.present.includes('rto_breach'));
  assert.equal(withBoot.freeText, false, '테이블 이름은 슬롯의 내용이고 자유 메모가 아니다');
});

test('표지가 남아 있는 동안이 유일한 기회다 — 지운 뒤 빈 값 칸은 `lost`', () => {
  const open = assessRemarkSlots({ row: row(''), markers: MARKERS_OPEN });
  assert.equal(open.captureOpen, true);
  assert.deepEqual(open.lost, [], '아직 옮겨 적을 수 있다');

  const cleared = assessRemarkSlots({ row: row(''), markers: MARKERS_CLEARED });
  assert.equal(cleared.captureOpen, false);
  assert.deepEqual(cleared.lost, ['halt_at', 'release_at', 'disposal_due']);
  // `cleared_is_done` — 지운 것과 **옮겨 적은 것**은 별개다
  assert.equal(cleared.verdict, 'empty');
});

test('아직 적을 수 있는데 `[확인 필요]` 로 둔 것은 **미기록**이다', () => {
  const note = remarkDraft({ releaseAt: RELEASE, disposalDue: DISPOSAL, sourceBranch: 'released', pointer: 'released', pin: 'released' });
  const open = assessRemarkSlots({ row: row(note), markers: MARKERS_OPEN });
  assert.deepEqual(open.missing, ['halt_at'], '표지가 있는 동안에는 찾아서 적는다');
  assert.ok(open.declaredUnknown.includes('halt_at'));
  // 되찾을 수 없게 된 뒤에는 명시된 공백이 **올바른 기록**이다
  const closed = assessRemarkSlots({ row: row(note), markers: MARKERS_CLEARED });
  assert.deepEqual(closed.missing, []);
  assert.equal(closed.verdict, 'complete');
});

test('정기 리허설 행은 `기준 지문` 을 요구하지 않는다 ⬅ 전환까지 가지 않는 수행이 많다', () => {
  const note = remarkDraft({
    haltAt: HALT, releaseAt: RELEASE, disposalDue: DISPOSAL,
    sourceBranch: 'released', pointer: 'released',
  }).split(SLOT_SEPARATOR).filter((p) => !p.startsWith('기준 지문')).join(SLOT_SEPARATOR);
  const a = assessRemarkSlots({ row: rehearsalRow(note), markers: MARKERS_OPEN });
  assert.equal(a.purpose, 'rehearsal');
  assert.equal(a.verdict, 'complete');
  assert.equal(a.required.length, 5);
  assert.ok(a.silent.includes('pin'));
});

/* ─────────────────────────────── 출력 ─────────────────────────────── */

test('초안: 없는 값은 지어내지 않고, 없었던 일은 적지 않는다', () => {
  const draft = remarkDraft();
  assert.equal(draft.split(SLOT_SEPARATOR).length, 6, '필수 여섯 칸만 나온다');
  assert.equal((draft.match(/\[확인/g) ?? []).length, 6);
  assert.ok(!draft.includes('기동 쓰기'));
  assert.ok(!draft.includes('약속 초과'));
  // 왕복 — 초안 문구를 그대로 적으면 `complete` 가 된다
  const back = assessRemarkSlots({ row: row(FULL), markers: MARKERS_OPEN });
  assert.equal(back.verdict, 'complete');
  // 구간·고지 문구(§3-10)를 뒤에 이어 붙여도 판정이 깨지지 않는다
  const joined = `${FULL}${SLOT_SEPARATOR}유실 구간 2026-10-30T03:00:00.000Z ~ 2026-10-30T03:30:00.000Z(30분) · 고지 ${UNKNOWN_CELL}`;
  const both = assessRemarkSlots({ row: row(joined), markers: MARKERS_OPEN });
  assert.equal(both.verdict, 'complete');
  assert.ok(both.present.includes('loss_window'));
});

test('출력: 로그·공개 모양에 **값을 담지 않는다**(시각 좌표·스코프 이름·테이블 이름)', () => {
  const a = assessRemarkSlots({
    row: row(`${FULL} · 기동 쓰기 users,organizations`),
    markers: MARKERS_OPEN,
  });
  const line = remarkLine(a);
  const pub = JSON.stringify(publicRemarks(a));
  for (const leak of [HALT, RELEASE, DISPOSAL, '2026-10-30', 'users', 'organizations', 'Preview']) {
    assert.ok(!line.includes(leak), `로그에 ${leak} 가 들어갔다`);
    assert.ok(!pub.includes(leak), `공개 모양에 ${leak} 가 들어갔다`);
  }
  assert.ok(line.startsWith('[remark-slots] '));
  assert.ok(line.includes('capture=open'));
  assert.equal(publicRemarks(a).ref, REMARK_RUNBOOK_REF);
  assert.ok(remarkText(a).includes('→ '));
  assert.ok(remarkText(assessRemarkSlots({ row: row(''), markers: MARKERS_CLEARED })).includes('되찾을 수 없다'));
});

test('요약: 상태·개수만 말하고 수치를 지어내지 않는다', () => {
  const s = remarkSlotsStatus({ row: row(FULL), markers: MARKERS_OPEN });
  assert.equal(s.verdict, 'complete');
  assert.equal(s.purpose, 'incident');
  assert.equal(s.required, 6);
  assert.equal(s.missing, 0);
  assert.equal(s.slots, 12);
  assert.equal(s.unrereadable, 10);
  assert.equal(s.limits, REMARK_LIMITS.length);
  assert.ok(REMARK_VERDICTS.includes(s.verdict));
});

/* ─────────────────────── 실제 소스·문서 대조 ─────────────────────── */

test('[실제 소스] 순수 모듈이고 판독을 **복제하지 않는다**', () => {
  assert.deepEqual(auditSelfSource(SELF_SRC), []);
  // 구간 문구 정규식을 이 모듈이 다시 들고 있지 않다 — 탐지 패턴은 **여기** 둔다(모듈에 두면 자기 자신을 잡는다)
  assert.ok(!/const\s+\w*WINDOW\w*_RE/.test(SELF_SRC), '§6-7 의 구간 정규식이 복제됐다');
  assert.ok(!/\/[^\n/]*유실[^\n/]*\//.test(SELF_SRC), '구간 문구를 정규식으로 다시 읽는다');
  // 끊어 보면 전부 걸린다
  assert.ok(auditSelfSource('process.env.X').some((p) => p.includes('process.env')));
  assert.ok(auditSelfSource('').some((p) => p.includes('parseRemarkWindow')));
  assert.ok(auditSelfSource('').some((p) => p.includes('purposeOfRow')));
  assert.ok(auditSelfSource('').some((p) => p.includes('readTimeline')));
  assert.ok(auditSelfSource(`${SELF_SRC}\nconst t = Date.now()`).some((p) => p.includes('현재 시각')));
});

test('[실제 소스] 신규 env 0 · 신규 런타임 체크 0', () => {
  // 들고 있는 `RECOVERY_*` 는 **이미 있는 표지**뿐이다(설명으로만 등장한다)
  assert.deepEqual(auditNoNewEnv(SELF_SRC), [], '비고는 표의 칸이고 env 가 아니다');
  assert.ok(auditNoNewEnv('const x = markers.RECOVERY_WRITE_FREEZE_AT', ['RECOVERY_WRITE_FREEZE_AT']).length > 0);
  assert.ok(auditNoNewEnv('const k = "RECOVERY_REMARK_SLOTS_AT"').some((p) => p.includes('RECOVERY_REMARK_SLOTS_AT')));
  assert.deepEqual(auditNoNewHealthCheck(HEALTH_SRC), []);
  assert.ok(auditNoNewHealthCheck('checks.remarkSlots = x').length > 0);
});

test('[실제 정본] §6-4 `비고` 칸이 이 모듈을 **읽는 판정으로** 들고 있다', () => {
  assert.deepEqual(auditLedgerNoteField(LEDGER_FIELDS), []);
  // §6-7 쪽 선언도 그대로다 — 둘 중 하나만 남으면 그 칸의 판정이 반쪽이 된다
  assert.deepEqual(auditLedgerHomes(LEDGER_FIELDS), []);
  const note = LEDGER_FIELDS.find((f) => f.column === REMARK_COLUMN);
  assert.equal(note?.home, 'table_only');
  assert.ok(/restorePointRecord/.test(note?.judgedBy ?? ''));
  assert.ok(/remarkSlots/.test(note?.judgedBy ?? ''));
  // 되돌아가면 잡힌다
  const back = LEDGER_FIELDS.map((f) => (f.column === REMARK_COLUMN ? { ...f, judgedBy: 'lib/restorePointRecord.ts' } : f));
  assert.ok(auditLedgerNoteField(back).some((p) => p.includes('window_only_is_complete')));
  assert.ok(auditLedgerNoteField([]).length > 0);
});

test('[실제 정본] 절차 단위 3-23 이 등록돼 있다 ⬅ 등록하지 않으면 범위 판정이 그대로 ok 다', () => {
  const unit = PROCEDURE_UNITS.find((u) => u.key === '3-23');
  assert.ok(unit, '3-23 이 절차 단위 정본에 없다');
  assert.equal(unit?.cited, true);
  assert.equal(unit?.since, '2026-10-31');
  assert.ok((unit?.skipped ?? '').includes('침묵'));
});

test('[실제 문서] RUNBOOK §3-23 이 정본 라벨·판정 표·거짓 판정을 그대로 들고 있다', () => {
  assert.deepEqual(auditRunbookRemark(RUNBOOK), []);
  assert.deepEqual(auditSlotSections(RUNBOOK), []);
  // 라벨이 문서에서 사라지면 사람이 다른 말로 적게 되고, 그러면 기록이 남아도 판정이 사라진다
  const renamed = RUNBOOK.split('`차단 해제`').join('해제 시각');
  assert.ok(auditRunbookRemark(renamed).some((p) => p.includes('차단 해제')));
  assert.ok(auditRunbookRemark('### 3-23. x').some((p) => p.includes('undeclared')));
  assert.ok(auditRunbookRemark('').some((p) => p.includes('§3-23 소절이 없다')));
  assert.ok(auditSlotSections('').length > 0);
  const moved = REMARK_SLOTS.map((s) => (s.key === 'pointer' ? { ...s, section: '§9-9' } : s));
  assert.ok(auditSlotSections(RUNBOOK, moved).some((p) => p.includes('§9-9')));
});

test('가드가 **끊어진 쪽**을 전부 잡는다 — 되읽는 쪽·결정 수·칸의 집·8단계 유도', () => {
  // 「남긴다」에 스코프가 붙는 쪽과 안 붙는 쪽
  assert.ok(remarkDraft({ pointer: 'kept', pointerScope: 'Preview' }).includes('검증 배포 포인터 유지(Preview)'));
  assert.ok(remarkDraft({ pointer: 'kept' }).includes('검증 배포 포인터 유지 '));
  assert.ok(remarkDraft({ sourceBranch: 'unreadable' }).includes(`원본 브랜치 ${UNKNOWN_CELL}`));

  // 결정 슬롯이 셋보다 적어지면(= 「한쪽으로 확정」 대상이 줄면) 잡는다
  const twoDecisions = REMARK_SLOTS.filter((s) => s.key !== 'pin');
  assert.ok(auditRemarkCanon(twoDecisions).some((p) => p.includes('결정 슬롯이 셋보다 적다')));
  // 전부 되읽히면 이 모듈이 필요하지 않다 — 그 사실을 적어 둔다
  const allReread = REMARK_SLOTS.map((s) => ({ ...s, rereadBy: '§6-7' }));
  assert.ok(auditRemarkCanon(allReread).some((p) => p.includes('필요하지 않다')));
  const noneReread = REMARK_SLOTS.map((s) => ({ ...s, rereadBy: null }));
  assert.ok(auditRemarkCanon(noneReread).some((p) => p.includes('§6-7 이 사라졌으면')));

  // 비고 칸의 집이 env 로 늘면 담당자 이름·스코프가 공개 응답으로 나간다
  const homed = LEDGER_FIELDS.map((f) => (f.column === REMARK_COLUMN ? { ...f, home: 'both' as const } : f));
  assert.ok(auditLedgerNoteField(homed).some((p) => p.includes('표 밖으로')));
  assert.ok(auditLedgerNoteField(LEDGER_FIELDS.filter((f) => f.column !== REMARK_COLUMN)).some((p) => p.includes('칸이 없다')));

  // §3 8단계가 이 절로 유도하지 않으면 열두 칸이 어디 모여 있는지 말하는 자리가 없어진다
  const from = RUNBOOK.indexOf('8. **사후**');
  const to = RUNBOOK.indexOf('### 3-1.');
  const cut = RUNBOOK.slice(0, from) + RUNBOOK.slice(from, to).split('3-23').join('3-99') + RUNBOOK.slice(to);
  assert.ok(auditRunbookRemark(cut).some((p) => p.includes('8단계가 3-23 으로 유도하지 않는다')));
  assert.ok(auditRunbookRemark('### 3-23. x').some((p) => p.includes('8단계 본문을 찾을 수 없다')));
});

test('[실제 문서] §3 8단계와 리허설 체크리스트가 이 절로 유도한다', () => {
  const from = RUNBOOK.indexOf('8. **사후**');
  const to = RUNBOOK.indexOf('### 3-1.');
  assert.ok(from >= 0 && to > from);
  const step8 = RUNBOOK.slice(from, to);
  assert.ok(step8.includes('3-23'), '8단계가 3-23 으로 유도하지 않는다');
  // 표지를 지우는 4번보다 **앞에서** 말해야 한다 — 지운 뒤에는 옮겨 적을 수 없다
  assert.ok(step8.indexOf('3-23') < step8.indexOf('를 **지운다.**'), '표지 삭제 뒤에 알면 늦다');

  const at = RUNBOOK.search(/^###\s*리허설 체크리스트/m);
  assert.ok(at >= 0);
  const checklist = RUNBOOK.slice(at);
  assert.ok(/(?<!\d)3-23(?!\d|단계)/.test(checklist), '체크리스트가 3-23 을 인용하지 않는다');
  assert.ok(checklist.includes('`lost` 가 비어 있다'), '지운 뒤 확인 항목이 없다');
});
