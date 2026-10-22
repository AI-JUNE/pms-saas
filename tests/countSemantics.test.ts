// 행 수 감소의 **뜻**(RUNBOOK §3 4단계·§3-11) 테스트.
//
// 4단계 대조는 테이블 전체를 한 규칙으로 봤다 — 「적으면 확인 필요, 정상 삭제로도 줄어든다」.
// 그 말이 맞는 것은 사용자가 지울 수 있는 테이블뿐이고 `audit_log` 에서는 거짓이다(앱이 지우지
// 않는다 — 그리고 §3-5 가 보존하라고 한 조사 근거 자신이다). `attachments` 는 세지도 않았다.
//
// 이 파일은 순수 로직만 보는 게 아니라 **실제 저장소 파일을 매번 대조**한다.
//  - `src` 트리 전체에 감사로그 삭제 구문이 없는지(생기면 confirmed_loss 가 거짓이 된다)
//  - `lib/configs.ts` 에 CRUD 자원이 남아 있는지(빠지면 「정상 삭제」 선언이 낡는다)
//  - `lib/recoveryVerify.ts` 가 이 판정을 응답에 싣는지(판정만 하고 버리는 꼴 포함)
//  - `RUNBOOK.md` §3-11 과 §1-1 이 서로 맞는지
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  COUNT_MISREADS, COUNT_RUNBOOK_REF, SEMANTICS_LIMITS, SHRINK_NOTES, TABLE_SEMANTICS,
  auditAppendOnlyClaim, auditCrudDeletePaths, auditRunbookSemantics, auditSemanticsCoverage,
  auditVerifyWiring, bodyOutsideCaveats, classifyShortfalls, countSemanticsStatus,
  mutabilityOf, semanticsFor, semanticsLogLine, semanticsText, shrinkMeaning, shrinkNote, shrinkRows,
} from '../src/lib/countSemantics.ts';
import {
  ACTION_DATA_SHORT, ACTION_DATA_UNEXPLAINED_SHORT, CORE_TABLES,
  parseCountBaseline, verifyRowCounts,
} from '../src/lib/recoveryVerify.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/**
 * `src` 아래 .ts/.tsx 전부. `src/src/` 는 옛 사본 트리라 제외한다
 * (파일 삭제가 야간 금지 규칙에 걸려 아직 치우지 못했다 — envRegistry.test.ts 와 같은 규율).
 */
function sourceText(): string {
  const base = path.join(ROOT, 'src');
  const parts: string[] = [];
  const walk = (dir: string, depth: number) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) {
        if (depth === 0 && e.name === 'src') continue;
        walk(path.join(dir, e.name), depth + 1);
      } else if (/\.tsx?$/.test(e.name)) {
        parts.push(fs.readFileSync(path.join(dir, e.name), 'utf8'));
      }
    }
  };
  walk(base, 0);
  return parts.join('\n');
}

/* ─────────────────────────── 정본 ─────────────────────────── */

test('정본: 전 테이블에 근거가 붙어 있고, 삭제 경로 선언이 서로 어긋나지 않는다', () => {
  assert.ok(TABLE_SEMANTICS.length >= 13, `정본이 너무 작다(${TABLE_SEMANTICS.length})`);
  assert.equal(new Set(TABLE_SEMANTICS.map((s) => s.table)).size, TABLE_SEMANTICS.length, '중복이 있다');
  for (const s of TABLE_SEMANTICS) {
    assert.match(s.table, /^[a-z_][a-z0-9_]*$/, `${s.table}: 식별자 규칙 위반`);
    assert.ok(s.model.trim().length > 0, `${s.table}: drizzle 선언 이름이 없다`);
    assert.ok(s.evidence.trim().length > 10, `${s.table}: 근거가 비었다 — 분류를 지어낸 꼴이다`);
    // 삭제 경로가 「없다」면 none, 있으면 그 모양을 적는다(둘이 어긋나면 가드가 엉뚱한 곳을 본다).
    if (s.deleteVia === 'none') assert.equal(s.deletePath, null, `${s.table}: 경로 없음인데 경로가 적혀 있다`);
    else assert.ok(s.deletePath && s.deletePath.trim().length > 0, `${s.table}: 삭제 경로가 비었다`);
    assert.notEqual(s.mutability, 'unknown', `${s.table}: 정본에 unknown 을 적어 두지 않는다`);
  }
  // append_only·operator_only 는 앱 안의 삭제 경로가 없는 것이 그 선언의 뜻이다.
  for (const s of TABLE_SEMANTICS) {
    if (s.mutability === 'append_only' || s.mutability === 'operator_only') {
      assert.equal(s.deleteVia, 'none', `${s.table}: 삭제 경로가 있는데 ${s.mutability} 로 적혀 있다`);
    }
  }
  assert.equal(semanticsFor('AUDIT_LOG')?.mutability, 'append_only', '대소문자·공백을 정규화한다');
  assert.equal(semanticsFor('없는테이블'), null);
  assert.equal(semanticsFor(null), null);
});

test('모르는 테이블은 unknown — 「확인 필요」로 올리지 않는다', () => {
  assert.equal(mutabilityOf('없는테이블'), 'unknown');
  assert.equal(shrinkMeaning('없는테이블'), 'unknown');
  assert.equal(shrinkMeaning(undefined), 'unknown');
  assert.match(SHRINK_NOTES.unknown.meaning, /통과가 아니다/);
  // 추측으로 needs_check 를 내면 설명되지 않는 감소가 「정상일 수 있다」로 읽힌다.
  assert.notEqual(shrinkMeaning('sessions'), 'needs_check');
});

test('감소의 뜻: append_only 는 확정, 앱 밖은 out_of_band, 사용자 삭제만 확인 필요', () => {
  assert.equal(shrinkMeaning('audit_log'), 'confirmed_loss');
  assert.equal(shrinkMeaning('users'), 'out_of_band');
  assert.equal(shrinkMeaning('organizations'), 'out_of_band');
  assert.equal(shrinkMeaning('memberships'), 'out_of_band');
  assert.equal(shrinkMeaning('issues'), 'needs_check');
  assert.equal(shrinkMeaning('attachments'), 'needs_check');
  // 「정상 삭제로도 줄어든다」는 설명은 needs_check 에만 붙는다.
  assert.match(SHRINK_NOTES.needs_check.meaning, /유실 확정이 아니라/);
  assert.match(SHRINK_NOTES.confirmed_loss.meaning, /설명되지 않는다/);
  assert.doesNotMatch(SHRINK_NOTES.confirmed_loss.meaning, /확인 필요/);
  assert.match(SHRINK_NOTES.confirmed_loss.action, /§3-5/);
  assert.match(shrinkNote('audit_log'), /^audit_log: /);
  assert.match(shrinkNote(''), /^\(이름 없음\): /);
});

test('classifyShortfalls: 설명되지 않는 감소분을 합집합으로 모은다', () => {
  const c = classifyShortfalls(['issues', { table: 'audit_log' }, 'users', '없는테이블', 'issues', '  ']);
  assert.deepEqual(c.confirmedLoss, ['audit_log']);
  assert.deepEqual(c.outOfBand, ['users']);
  assert.deepEqual(c.needsCheck, ['issues']);
  assert.deepEqual(c.unknown, ['없는테이블']);
  // 하나만 보면 나머지가 「확인 필요」에 섞인다 — 그래서 합집합이다.
  assert.deepEqual(c.unexplained, ['audit_log', 'users', '없는테이블'].sort());
  assert.equal(c.rows.length, 4, '중복·공백은 세지 않는다');

  const clean = classifyShortfalls(['issues', 'tasks']);
  assert.deepEqual(clean.unexplained, [], '사용자가 지울 수 있는 테이블만 줄었으면 설명 가능 범위다');
  assert.deepEqual(classifyShortfalls([]).rows, []);
  assert.deepEqual(shrinkRows(['Audit_Log']).map((r) => r.table), ['audit_log']);
});

test('행이 돌아와도 복구되지 않는 것을 같은 자리에서 알린다(첨부 본문)', () => {
  const c = bodyOutsideCaveats(['attachments', 'issues']);
  assert.equal(c.length, 1);
  assert.match(c[0], /본문은 돌아오지 않는다|본문은 \*\*돌아오지 않는다/);
  assert.match(c[0], /목록/);
  assert.deepEqual(bodyOutsideCaveats(['issues']), [], '대조에 들어오지 않은 테이블의 주의는 달지 않는다');
});

test('로그·요약에는 테이블 이름과 개수만 — 행 수를 담지 않는다', () => {
  const line = semanticsLogLine(classifyShortfalls(['audit_log', 'issues', 'users']));
  assert.match(line, /confirmed_loss=audit_log/);
  assert.match(line, /out_of_band=users/);
  assert.match(line, /needs_check=issues/);
  assert.doesNotMatch(line, /\d+건|rows=\d/, '행 수가 섞여 들어갔다');
  const quiet = semanticsLogLine(classifyShortfalls([]));
  assert.equal(quiet, '[countSemantics] shrunk=0');

  const text = semanticsText();
  assert.match(text, new RegExp(COUNT_RUNBOOK_REF.replace(/[|\\{}()[\]^$+*?.]/g, '\\$&')));
  for (const s of TABLE_SEMANTICS) assert.ok(text.includes(s.table), `${s.table} 가 요약에 없다`);
  for (const m of COUNT_MISREADS) assert.ok(text.includes(m.says), `${m.key} 의 거짓 문장이 요약에 없다`);

  const st = countSemanticsStatus();
  assert.deepEqual(st.appendOnly, ['audit_log']);
  assert.deepEqual(st.operatorOnly, ['users', 'organizations', 'memberships']);
  assert.equal(st.tables, TABLE_SEMANTICS.length);
  assert.equal(st.limits, SEMANTICS_LIMITS.length);
});

test('한계: 세기 시작한 날 생기는 새 오해를 함께 내보낸다', () => {
  assert.ok(SEMANTICS_LIMITS.length >= 7, '한계 목록이 짧다');
  assert.ok(SEMANTICS_LIMITS.some((l) => /복구된다」는 뜻이 아니다/.test(l)), '첨부 ok 의 오해가 없다');
  assert.ok(SEMANTICS_LIMITS.some((l) => /변조/.test(l)), '행 수가 같은 변조는 걸리지 않는다는 사실이 없다');
  assert.ok(SEMANTICS_LIMITS.some((l) => /uncovered/.test(l)), '덮이지 않은 테이블은 판정에 들어오지도 않는다');
  assert.ok(COUNT_MISREADS.length >= 4);
  for (const m of COUNT_MISREADS) {
    assert.ok(m.says.trim() && m.why.trim(), `${m.key}: 그 말·왜가 비었다`);
  }
});

/* ─────────────────────── 정적 점검 ─────────────────────── */

test('auditSemanticsCoverage: 양방향으로 어긋나는 목록을 잡는다', () => {
  assert.deepEqual(auditSemanticsCoverage(CORE_TABLES), [], JSON.stringify(auditSemanticsCoverage(CORE_TABLES)));
  assert.match(auditSemanticsCoverage([...CORE_TABLES, 'sessions'])[0], /sessions/);
  const dropped = auditSemanticsCoverage(CORE_TABLES.filter((t) => t !== 'attachments'));
  assert.ok(dropped.some((p) => /attachments/.test(p)), '첨부가 빠진 사실을 잡지 못했다');
  assert.ok(auditSemanticsCoverage([]).length === 1);
});

test('auditAppendOnlyClaim: 감사로그 삭제 구문이 생기면 잡는다(두 모양)', () => {
  assert.deepEqual(auditAppendOnlyClaim('await db.insert(auditLog).values(v);'), []);
  assert.equal(auditAppendOnlyClaim('await db.delete(auditLog).where(x);').length, 1);
  assert.equal(auditAppendOnlyClaim('sql`delete from "audit_log" where id < 1`').length, 1);
  assert.equal(auditAppendOnlyClaim('DELETE FROM audit_log').length, 1);
  assert.match(auditAppendOnlyClaim('db.delete(auditLog)')[0], /confirmed_loss/);
  // 다른 테이블의 삭제는 이 가드의 대상이 아니다(사용자가 지울 수 있는 테이블이다).
  assert.deepEqual(auditAppendOnlyClaim('db.delete(attachments).where(x)'), []);
});

test('[실제 소스] 감사로그는 지워지지 않는다 — append_only 선언의 근거', () => {
  const src = sourceText();
  assert.ok(src.length > 10000, '소스 스캔이 빗나갔다');
  assert.deepEqual(auditAppendOnlyClaim(src), [], '감사로그 삭제 경로가 생겼다 — §3-11 을 함께 고칠 것');
  // 그 테이블이 실제로 기록되고 있다는 사실(가드가 죽은 테이블을 지키고 있지 않은지)
  assert.match(src, /insert\(auditLog\)/);
});

test('[실제 소스] CRUD 자원 선언이 살아 있다 — 「정상 삭제」 선언의 근거', () => {
  assert.deepEqual(auditCrudDeletePaths(read('src/lib/configs.ts')), []);
  assert.equal(auditCrudDeletePaths('table: projects').length > 0, true, '빠진 자원을 잡지 못했다');
  assert.match(auditCrudDeletePaths('아무 내용도 없다')[0], /자원 선언을 찾지 못했다/);
});

test('[실제 소스] 4단계 응답이 이 판정을 싣는다(판정만 하고 버리지 않는다)', () => {
  assert.deepEqual(auditVerifyWiring(read('src/lib/recoveryVerify.ts')), []);
  assert.ok(auditVerifyWiring('// 아무 배선도 없다').length >= 4);
  assert.match(
    auditVerifyWiring("import x from './countSemantics.ts';\nclassifyShortfalls(a);\nattachments\n3-11")[0],
    /설명되지 않는 감소분/,
  );
});

test('[실제 문서] RUNBOOK §3-11 이 살아 있고 §1-1 이 되돌아가지 않았다', () => {
  const rb = read('RUNBOOK.md');
  assert.deepEqual(auditRunbookSemantics(rb), [], JSON.stringify(auditRunbookSemantics(rb)));
  assert.ok(auditRunbookSemantics('# 빈 문서').length >= 2);
  assert.match(auditRunbookSemantics('### 3-11. x\ndata.unexplained\naudit_shrink_as_normal')[0], /operator_shrink_as_normal|attachments_/);
  // 4단계 지시가 이 판정을 가리킨다(테이블 이름만 보고 넘기지 않게)
  assert.match(rb, /data\.unexplained/);
  // §1-1 이 옛 문장으로 되돌아가면 잡는다 — 담당자는 그 절을 근거로 복구 범위를 고지한다
  const reverted = auditRunbookSemantics(`${rb}\n핵심 테이블 12개에 \`attachments\` 가 없어서`);
  assert.equal(reverted.length, 1);
  assert.match(reverted[0], /되돌아갔다/);
});

/* ─────────────────── 4단계 판정과의 결합 ─────────────────── */

const baselineAll = (n: number) => parseCountBaseline(`asOf=2026-10-01,${CORE_TABLES.map((t) => `${t}=${n}`).join(',')}`);
const fill = (n: number, over: Record<string, number> = {}) =>
  ({ ...Object.fromEntries(CORE_TABLES.map((t) => [t, n])), ...over });

test('verifyRowCounts: 설명되지 않는 감소분이면 다음에 할 일이 달라진다', () => {
  const baseline = baselineAll(10);
  const normal = verifyRowCounts({ counts: fill(10, { issues: 4 }), present: [...CORE_TABLES], baseline });
  assert.equal(normal.verdict, 'short');
  assert.equal(normal.action, ACTION_DATA_SHORT);
  assert.deepEqual(normal.unexplained, []);
  assert.equal(normal.shrink.find((s) => s.table === 'issues')?.severity, 'needs_check');

  const evidence = verifyRowCounts({ counts: fill(10, { audit_log: 9 }), present: [...CORE_TABLES], baseline });
  assert.equal(evidence.verdict, 'short', '판정 어휘를 늘리지 않는다 — 달라지는 것은 할 일이다');
  assert.equal(evidence.action, ACTION_DATA_UNEXPLAINED_SHORT);
  assert.deepEqual(evidence.unexplained, ['audit_log']);
  assert.equal(evidence.shrink.find((s) => s.table === 'audit_log')?.severity, 'confirmed_loss');
  assert.match(evidence.action ?? '', /§3-11/);

  // caveat 가 한 문장으로 되돌아가지 않는다(audit_log 에서 거짓이 되는 그 문장이다)
  assert.match(evidence.caveat, /테이블마다 다르다/);
  assert.match(evidence.caveat, /RPO/);
});

test('verifyRowCounts: 첨부가 대조에 들어오고, 행 수가 말하지 못하는 것을 함께 낸다', () => {
  assert.ok(CORE_TABLES.includes('attachments'), '§1-1 의 사각지대가 돌아왔다');
  const v = verifyRowCounts({ counts: fill(3), present: [...CORE_TABLES], baseline: baselineAll(3) });
  assert.equal(v.verdict, 'ok');
  assert.equal(v.rows.find((r) => r.table === 'attachments')?.state, 'ok');
  assert.equal(v.rowCaveats.length, 1);
  assert.match(v.rowCaveats[0], /attachments/);

  // 첨부를 덮지 않은 옛 스냅샷은 ok 로 올라가지 않는다(대조하지 않았다는 사실이다)
  const old = parseCountBaseline(
    `asOf=2026-10-01,${CORE_TABLES.filter((t) => t !== 'attachments').map((t) => `${t}=3`).join(',')}`,
  );
  const stale = verifyRowCounts({ counts: fill(3), present: [...CORE_TABLES], baseline: old });
  assert.equal(stale.verdict, 'no_baseline');
  assert.deepEqual(stale.uncovered, ['attachments']);

  // 조회 실패(unverified)에서도 이 주의는 그대로 나온다 — 담당자가 보는 응답이 같아야 한다
  const unverified = verifyRowCounts({ counts: null, present: [...CORE_TABLES], baseline: null });
  assert.deepEqual(unverified.shrink, []);
  assert.deepEqual(unverified.unexplained, []);
  assert.equal(unverified.rowCaveats.length, 1);
});
