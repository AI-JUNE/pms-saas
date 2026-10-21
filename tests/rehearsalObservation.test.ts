/**
 * rehearsalObservation.test.ts — 리허설이 **무엇을 보고 판정하는가**(RUNBOOK §6·§6-3). 2026-10-19
 *
 * ── 왜 필요한가 ──────────────────────────────────────────────────────────────
 * 체크리스트 36항목의 거의 전부는 「무엇을 한 뒤 `checks.<이름>.detail.<칸>` 이 `<값>` 인지
 * 확인했다」 꼴이고, 그 인용이 이 절차의 **유일한 실행 표면**이다. 그런데 인용이 가리키는 곳이
 * 실제로 있는지 아무도 대조하지 않았다 — 이름이 바뀌면 담당자가 받는 것은 오류가 아니라
 * `undefined` 이고, 그것은 「문제 없음」과 글자 하나 다르지 않다. 포괄 항목 「전 항목 정상」은
 * 복구 관련 체크가 **의도적으로** degraded 를 내므로 **어떤 리허설에서도 통과할 수 없었다.**
 *
 * 그래서 (a) 판정 자체(보류 → 배선 누락 → 미인용 → ok)와 degraded 의 분류, (b) 값을 담지 않는
 * 규율, (c) **실제 RUNBOOK 체크리스트 ↔ 실제 응답 모양 ↔ 실제 어휘 선언 원문**의 삼각 대조와
 * `CheckName` ↔ 정본 양방향 대조를 파일 수준에서 고정한다.
 * 이 테스트는 **파일만 읽는다** — 네트워크·DB 를 쓰지 않고 `process.env` 도 바꾸지 않는다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  ACTION_OBS_MISSING,
  ACTION_OBS_UNREADABLE,
  CHECK_OBSERVATIONS,
  OBSERVATION_DRIFTS,
  OBSERVATION_LIMITS,
  OBSERVATION_RUNBOOK_REF,
  OBSERVATION_VERDICTS,
  SELF_CHECK,
  assessObservation,
  auditBlanketItems,
  auditCitationTargets,
  auditCitationValues,
  auditCitedDeclarations,
  auditHealthWiring,
  auditRegistryShape,
  auditRunbookObservation,
  checkNamesFrom,
  checklistSection,
  classifyDegraded,
  detailPaths,
  extractCitations,
  observationFor,
  observationLogLine,
  observationPhase,
  observationStatus,
  observationText,
  observedChecks,
  parseChecklistItems,
  parseVocabulary,
  readChecks,
  rehearsalObservationCheck,
  resolveCitation,
  responseShape,
  uncitedChecks,
} from '../src/lib/rehearsalObservation.ts';
import { assetCoverageCheck } from '../src/lib/assetCoverage.ts';
import { dbIdentityCheck } from '../src/lib/dbIdentity.ts';
import { deployPinCheck } from '../src/lib/deployRollback.ts';
import { envPresenceCheck } from '../src/lib/envPresence.ts';
import { externalStateCheck } from '../src/lib/externalReconcile.ts';
import { disclosureCheck } from '../src/lib/healthDisclosure.ts';
import { closureCheck } from '../src/lib/incidentClosure.ts';
import { lossNoticeCheck } from '../src/lib/lossNotice.ts';
import { periodicCheckHealth } from '../src/lib/periodicCheck.ts';
import { securityReapplyCheck } from '../src/lib/postRestoreSecurity.ts';
import { recoveryObjectivesCheck } from '../src/lib/recoveryObjectives.ts';
import { recoveryReadinessCheck } from '../src/lib/recoveryVerify.ts';
import { pitrWindowCheck } from '../src/lib/recoveryWindow.ts';
import { rehearsalCoverageCheck } from '../src/lib/rehearsalCoverage.ts';
import { rehearsalLedgerCheck } from '../src/lib/rehearsalLedger.ts';
import { rehearsalKindCheck } from '../src/lib/rehearsalKind.ts';
import { rehearsalOutcomeCheck } from '../src/lib/rehearsalOutcome.ts';
import { rehearsalScopeCheck } from '../src/lib/rehearsalScope.ts';
import { writeFreezeCheck } from '../src/lib/writeFreeze.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (...p: string[]) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const resolveVocab = (file: string) => {
  try {
    return read(...file.split('/'));
  } catch {
    return null;
  }
};

const RUNBOOK = read('RUNBOOK.md');
const HEALTH_SRC = read('src', 'lib', 'health.ts');
const ROUTE_SRC = read('src', 'app', 'api', 'health', 'route.ts');

/** 평상시 배포(연결 문자열만 있고 복구용 env 는 비어 있다) */
const ENV_NORMAL: Record<string, string | undefined> = {
  DATABASE_URL: 'postgresql://u:p@ep-cool-sun-123456-pooler.ap-southeast-1.aws.neon.tech/pms',
};

/** 리허설 중(선언 + 차단 ON, Preview 스코프) */
const ENV_REHEARSAL: Record<string, string | undefined> = {
  ...ENV_NORMAL,
  VERCEL_ENV: 'preview',
  RECOVERY_REHEARSAL_ACTIVE: 'true',
  RECOVERY_WRITE_FREEZE: 'true',
};

/** 실제 체크 함수로 응답의 `checks` 를 조립한다(라우트와 같은 순서·같은 입력) */
function buildChecks(env: Record<string, string | undefined>): Record<string, unknown> {
  return {
    db: { ok: true, required: true, latencyMs: 3 },
    billing: { ok: true, required: false, detail: { provider: 'portone', mode: 'test' } },
    monitoring: { ok: true, required: false, detail: { enabled: false } },
    recovery: recoveryReadinessCheck({ env }),
    recoveryWindow: pitrWindowCheck({ env }),
    recoveryObjectives: recoveryObjectivesCheck({ env }),
    periodicCheck: periodicCheckHealth({ env }),
    envPresence: envPresenceCheck({ env }),
    writeFreeze: writeFreezeCheck({ env }),
    dbIdentity: dbIdentityCheck({ env }),
    incidentClosure: closureCheck({ env }),
    lossNotice: lossNoticeCheck({ env }),
    postRestoreSecurity: securityReapplyCheck({ env }),
    externalState: externalStateCheck({ env }),
    assetCoverage: assetCoverageCheck({ env }),
    rehearsalScope: rehearsalScopeCheck({ env }),
    rehearsalCoverage: rehearsalCoverageCheck({ env }),
    rehearsalLedger: rehearsalLedgerCheck({ env }),
    rehearsalOutcome: rehearsalOutcomeCheck({ env }),
    rehearsalKind: rehearsalKindCheck({ env }),
    deployPin: deployPinCheck({ env }),
    disclosure: disclosureCheck({ env }),
  };
}

const NORMAL_CHECKS = buildChecks(ENV_NORMAL);
const REHEARSAL_CHECKS = buildChecks(ENV_REHEARSAL);
const SHAPE = responseShape({ ...NORMAL_CHECKS, [SELF_CHECK]: rehearsalObservationCheck({ checks: NORMAL_CHECKS }) });

/* ─────────────────────────────── 정본 ─────────────────────────────── */

test('정본: 체크마다 자리·사유·거른 결과가 한 번씩 적혀 있다', () => {
  const keys = CHECK_OBSERVATIONS.map((o) => o.check);
  assert.equal(new Set(keys).size, keys.length, '체크 이름이 중복됐다');
  assert.ok(keys.includes(SELF_CHECK), '자기 자신도 정본에 있어야 한다');
  for (const o of CHECK_OBSERVATIONS) {
    assert.ok(o.why.trim().length > 10, `${o.check} 의 사유가 비었다`);
    assert.ok(o.silent.trim().length > 10, `${o.check} 의 거른 결과 설명이 비었다`);
    if (o.role === 'observe') assert.ok(o.field, `${o.check} 에 판정 칸이 없다`);
    else assert.equal(o.field, null, `${o.check} 은 리허설 대상이 아닌데 판정 칸이 있다`);
  }
  assert.ok(observedChecks().length >= 16, '관측 대상이 줄었다 — 체크가 늘면 정본도 자라야 한다');
  assert.equal(observationFor('없는체크'), null, '모르는 이름에 값을 지어낸다');
});

test('[실제 소스] CheckName 전건이 정본에 있고 정본에 유령이 없다 ⬅ 이 장치의 핵심', () => {
  assert.deepEqual(auditRegistryShape(HEALTH_SRC), []);
  const declared = checkNamesFrom(HEALTH_SRC);
  assert.ok(declared.includes(SELF_CHECK), `CheckName 에 ${SELF_CHECK} 가 없다`);
  for (const name of declared) assert.ok(observationFor(name), `체크 ${name} 이 정본에 없다`);
});

test('auditRegistryShape: 등록 없이 추가된 체크와 유령 정본을 둘 다 잡는다', () => {
  const added = HEALTH_SRC.replace("  | 'disclosure';", "  | 'disclosure'\n  | 'brandNew';");
  assert.ok(
    auditRegistryShape(added).some((p) => p.includes('brandNew') && p.includes('관측 정본에 없다')),
    '등록되지 않은 체크를 잡지 못한다',
  );
  const ghost = auditRegistryShape(HEALTH_SRC, [
    { check: 'ghost', role: 'observe', field: 'verdict', vocab: null, cited: false, degradedWhen: [], why: '왜 보는지 적는다', silent: '조용히 생기는 일을 적는다' },
  ]);
  assert.ok(ghost.some((p) => p.includes('ghost') && p.includes('CheckName 에 없다')));
  assert.ok(auditRegistryShape('export type Other = 1;')[0].includes('CheckName'), '유니온을 못 찾으면 그 사실을 말한다');

  // 자리 선언이 서로 어긋나는 정본도 잡는다(설명 공란·대상 아닌데 인용·칸 없는 어휘).
  const malformed = auditRegistryShape(HEALTH_SRC, [
    { check: 'db', role: 'not_rehearsed', field: 'verdict', vocab: { file: 'x.ts', decl: 'Y' }, cited: true, degradedWhen: [], why: '  ', silent: '' },
    { check: 'billing', role: 'observe', field: null, vocab: null, cited: false, degradedWhen: [], why: '왜 보는지', silent: '조용한 결과' },
    { check: 'monitoring', role: 'observe', field: null, vocab: { file: 'x.ts', decl: 'Y' }, cited: false, degradedWhen: [], why: '왜 보는지', silent: '조용한 결과' },
  ]);
  assert.ok(malformed.some((p) => p.includes('리허설 대상이 아닌데')));
  assert.ok(malformed.some((p) => p.includes('사유·거른 결과 설명이 비었다')));
  assert.ok(malformed.some((p) => p.includes('판정 칸이 없다')));
  assert.ok(malformed.some((p) => p.includes('판정 칸 없이 어휘 정본만')));

  const withoutSelf = HEALTH_SRC.replace(`  | '${SELF_CHECK}'\n`, '');
  assert.ok(
    auditRegistryShape(withoutSelf).some((p) => p.includes('응답에 실리지 않는다')),
    '자기 자신이 CheckName 에서 빠진 것을 통과시킨다',
  );
});

/* ───────────────────────────── 응답 모양 ───────────────────────────── */

test('detailPaths: 중첩 칸까지 뽑고 배열·null 은 잎으로 둔다(칸은 존재한다)', () => {
  const paths = detailPaths({ verdict: 'ok', rehearsal: { status: 'missing', rows: [] }, limits: null });
  assert.ok(paths.includes('verdict'));
  assert.ok(paths.includes('rehearsal'));
  assert.ok(paths.includes('rehearsal.status'));
  assert.ok(paths.includes('rehearsal.rows'), '배열 칸이 빠졌다');
  assert.ok(paths.includes('limits'), 'null 칸이 빠졌다');
  assert.deepEqual(detailPaths('문자열'), [], '객체가 아니면 칸이 없다');
  assert.ok(!detailPaths({ a: { b: { c: { d: 1 } } } }).includes('a.b.c.d'), '깊이 제한이 없다');
});

test('resolveCitation: 없는 체크·없는 칸을 가리고, 읽을 수 없으면 통과시키지 않는다', () => {
  assert.equal(resolveCitation(SHAPE, 'writeFreeze', 'frozen'), 'ok');
  assert.equal(resolveCitation(SHAPE, 'writeFreeze', 'frozzen'), 'unknown_field');
  assert.equal(resolveCitation(SHAPE, 'writeFreezer', 'frozen'), 'unknown_check');
  assert.equal(resolveCitation(SHAPE, 'recovery', 'rehearsal.status'), 'ok', '중첩 인용을 못 읽는다');
  assert.equal(resolveCitation(responseShape('깨진 응답'), 'writeFreeze', 'frozen'), 'unknown_check');
});

/* ─────────────────────────── 체크리스트 인용 ─────────────────────────── */

test('parseChecklistItems: 이어진 줄을 합치고 구간 밖은 세지 않는다', () => {
  const doc = [
    '### 리허설 체크리스트',
    '',
    '- [ ] 첫 항목 — `checks.writeFreeze.detail.frozen` 이',
    '      `true`',
    '- [ ] 둘째 항목',
    '',
    '## 7. 다른 절',
    '- [ ] 체크리스트 밖 항목',
  ].join('\n');
  const items = parseChecklistItems(doc);
  assert.equal(items.length, 2, '구간 밖 항목을 세었다');
  assert.ok(items[0].text.includes('`true`'), '이어진 줄을 합치지 않는다');
  assert.equal(checklistSection('제목 없는 문서'), null, '없으면 null — 「항목이 없다」로 단정하지 않는다');
  assert.deepEqual(parseChecklistItems('제목 없는 문서'), []);
});

test('extractCitations: 축약 `detail.X` 는 같은 항목의 앞선 체크를 물려받고, 기대값은 바로 뒤 하나만 본다', () => {
  const doc = [
    '### 리허설 체크리스트',
    '- [ ] `checks.periodicCheck.detail.verdict` 가 `ok` 이고 `detail.untrusted` 가 비어 있다(`overdue` 면 다르다)',
    '- [ ] `checks.deployPin` 을 이름만 스친다',
    '- [ ] `checks.lossNotice.detail.state` 가 `GET /api/health` 뒤에 온다',
  ].join('\n');
  const c = extractCitations(doc);
  assert.deepEqual(
    c.slice(0, 2).map((x) => [x.check, x.field, x.expected]),
    [
      ['periodicCheck', 'verdict', 'ok'],
      // 축약 인용도 앞선 체크를 물려받는다. 기대값은 **각 인용 바로 뒤 하나**만 본다 —
      // 판정 칸이 아닌 칸의 값은 auditCitationValues 가 어휘로 대조하지 않는다(한계로 적어 둔다).
      ['periodicCheck', 'untrusted', 'overdue'],
    ],
  );
  assert.deepEqual(auditCitationValues(doc, resolveVocab, SHAPE), [], '판정 칸이 아닌 칸의 값을 어휘로 대조했다');
  assert.deepEqual([c[2].check, c[2].field], ['deployPin', ''], '이름만 스친 인용도 자리는 남긴다');
  assert.deepEqual(readChecks(doc), ['periodicCheck', 'lossNotice'], '칸까지 읽는 체크만 세어야 한다');
  assert.equal(c[3].expected, null, '식별자 모양이 아닌 토큰을 기대값으로 세었다');
});

/* ───────────────────────────── 값 어휘 ───────────────────────────── */

test('parseVocabulary: const 배열·type 유니온 둘 다 읽고 주석은 건너뛴다', () => {
  const src = [
    '/** 설명 */',
    "export const SOME_STATES = [",
    '  /** 평상시 */',
    "  'normal',",
    "  'frozen_unrecorded',",
    '] as const;',
    "export type OtherVerdict = 'match' | 'mismatch' | 'unset';",
  ].join('\n');
  assert.deepEqual(parseVocabulary(src, 'SOME_STATES'), ['normal', 'frozen_unrecorded']);
  assert.deepEqual(parseVocabulary(src, 'OtherVerdict'), ['match', 'mismatch', 'unset']);
  assert.deepEqual(parseVocabulary(src, 'Missing'), [], '없는 선언에 어휘를 지어낸다');
  assert.deepEqual(parseVocabulary(src, ''), []);
});

test('[실제 소스] 어휘 정본 위치가 전건 실제로 읽힌다 ⬅ 복사해 두지 않는 이유', () => {
  for (const o of CHECK_OBSERVATIONS) {
    if (!o.vocab) continue;
    const src = resolveVocab(o.vocab.file);
    assert.ok(src, `${o.vocab.file} 을 읽을 수 없다`);
    const vocab = parseVocabulary(src, o.vocab.decl);
    assert.ok(vocab.length > 0, `${o.vocab.file} 의 ${o.vocab.decl} 에서 어휘를 못 뽑았다`);
  }
  assert.deepEqual(parseVocabulary(read('src', 'lib', 'rehearsalObservation.ts'), 'OBSERVATION_VERDICTS'), [
    ...OBSERVATION_VERDICTS,
  ]);
});

/* ───────────────── 실제 문서 ↔ 실제 응답 ↔ 실제 어휘 삼각 대조 ───────────────── */

test('[실제 문서] 체크리스트 인용 전건이 실제 응답에서 가리킬 곳이 있다', () => {
  assert.deepEqual(auditCitationTargets(RUNBOOK, SHAPE), []);
  const cites = extractCitations(RUNBOOK);
  assert.ok(cites.length >= 20, `인용이 ${cites.length}건이다 — 체크리스트가 인용을 잃었는지 본다`);
});

test('auditCitationTargets: 없는 칸·없는 체크를 가리키는 인용을 잡는다', () => {
  const renamed = RUNBOOK.replace(/checks\.writeFreeze\.detail\.frozen/g, 'checks.writeFreeze.detail.isFrozen');
  assert.ok(
    auditCitationTargets(renamed, SHAPE).some((p) => p.includes('isFrozen') && p.includes('undefined')),
    '칸 이름이 바뀐 인용을 잡지 못한다',
  );
  const gone = RUNBOOK.replace(/checks\.lossNotice\./g, 'checks.lossNotify.');
  assert.ok(auditCitationTargets(gone, SHAPE).some((p) => p.includes('lossNotify')));
  assert.ok(
    auditCitationTargets(RUNBOOK, responseShape(null))[0].includes('올리지 않는다'),
    '응답을 못 읽으면 「문제 없음」으로 올린다',
  );
});

test('[실제 문서] 체크리스트의 기대값 전건이 실제 어휘 선언에 있다', () => {
  assert.deepEqual(auditCitationValues(RUNBOOK, resolveVocab, SHAPE), []);
});

test('auditCitationValues: 어휘에 없는 기대값을 잡고, 상세 칸 이름은 기대값으로 오인하지 않는다', () => {
  const doc = [
    '### 리허설 체크리스트',
    '- [ ] `checks.rehearsalScope.detail.verdict` 가 `dress_rehearsal` 이다',
  ].join('\n');
  const problems = auditCitationValues(doc, resolveVocab, SHAPE);
  assert.equal(problems.length, 1);
  assert.ok(problems[0].includes('dress_rehearsal') && problems[0].includes('통과할 수 없다'));

  // `uncovered` 는 판정값이 아니라 같은 체크의 **상세 칸 이름**이다 — 거짓 실패를 내지 않는다.
  const fieldAsValue = [
    '### 리허설 체크리스트',
    '- [ ] `checks.rehearsalCoverage.detail.verdict` 가 `uncovered` 라고 적혀 있다',
  ].join('\n');
  assert.deepEqual(auditCitationValues(fieldAsValue, resolveVocab, SHAPE), []);

  const lost = auditCitationValues(
    ['### 리허설 체크리스트', '- [ ] `checks.rehearsalScope.detail.verdict` 가 `normal` 이다'].join('\n'),
    () => null,
    SHAPE,
  );
  assert.ok(lost[0].includes('읽을 수 없다'), '어휘 정본이 사라진 것을 통과시킨다');
});

test('[실제 문서] cited 선언이 실제 체크리스트와 맞고, 관측 대상이 전건 인용된다', () => {
  assert.deepEqual(auditCitedDeclarations(RUNBOOK), []);
  assert.deepEqual(uncitedChecks(), [], '리허설이 한 번도 읽지 않는 체크가 남아 있다');
  const dropped = RUNBOOK.replace(/checks\.disclosure\.detail\.verdict/g, '그 응답');
  assert.ok(
    auditCitedDeclarations(dropped).some((p) => p.includes('disclosure') && p.includes('읽히지 않는다')),
    '인용이 빠진 것을 잡지 못한다',
  );
});

test('[실제 문서] 포괄 항목이 없다 ⬅ 「전 항목 정상」은 통과할 수 없는 항목이었다', () => {
  assert.deepEqual(auditBlanketItems(RUNBOOK), []);
  // 되돌아간 모습을 그대로 재현한다 — 이것이 2026-10-19 전까지 체크리스트에 있던 항목이다.
  const blanket = ['### 리허설 체크리스트', '- [ ] `GET /api/health` 전 항목 정상'].join('\n');
  const problems = auditBlanketItems(blanket);
  assert.equal(problems.length, 1, '포괄 문구로 되돌아간 항목을 잡지 못한다');
  assert.ok(problems[0].includes('통과할 수 없고'));
  assert.ok(auditBlanketItems('제목 없는 문서')[0].includes('찾을 수 없다'));
});

/* ─────────────────────────── degraded 의 분류 ─────────────────────────── */

test('observationPhase: 선언이 있으면 리허설, 없이 차단이면 사건, 그 밖은 평상시다', () => {
  assert.equal(observationPhase(NORMAL_CHECKS), 'normal');
  assert.equal(observationPhase(REHEARSAL_CHECKS), 'rehearsal');
  assert.equal(
    observationPhase({ writeFreeze: { ok: false, detail: { frozen: true } } }),
    'incident',
  );
  assert.equal(observationPhase('깨진 응답'), 'normal');
});

test('[실제 응답] 평상시 degraded 는 전건 설명돼 있다 ⬅ 「전 항목 정상」이 불가능했던 이유', () => {
  const split = classifyDegraded(NORMAL_CHECKS);
  assert.deepEqual(split.unexpected, [], '설명되지 않은 degraded 가 평상시에 있다');
  for (const name of ['recovery', 'recoveryWindow', 'recoveryObjectives', 'periodicCheck']) {
    assert.ok(split.expected.includes(name), `${name} 가 평상시 degraded 목록에서 빠졌다 — 사람 몫 설정이 비어 있는 상태다`);
  }
});

test('[실제 응답] 리허설 중 degraded 도 전건 설명돼 있다(차단·선언·미기록·미고지)', () => {
  const split = classifyDegraded(REHEARSAL_CHECKS);
  assert.deepEqual(split.unexpected, [], '설명되지 않은 degraded 가 리허설 중에 있다');
  assert.ok(split.expected.includes('writeFreeze'), '차단 ON 이 degraded 로 들어와야 한다');
  assert.ok(split.expected.includes('rehearsalScope'), '리허설 선언이 degraded 로 들어와야 한다');
  assert.ok(split.expected.length >= 5, `리허설 중 degraded 가 ${split.expected.length}건뿐이다`);
});

test('classifyDegraded: 모르는 체크의 degraded 를 「설명됐다」로 올리지 않는다(fail-closed)', () => {
  const split = classifyDegraded({ mystery: { ok: false, required: false }, writeFreeze: { ok: true } });
  assert.deepEqual(split.unexpected, ['mystery']);
  assert.deepEqual(split.expected, []);
  const wrongPhase = classifyDegraded({ writeFreeze: { ok: false, detail: { frozen: false } } }, 'normal');
  assert.deepEqual(wrongPhase.unexpected, ['writeFreeze'], '평상시의 차단 degraded 를 설명된 것으로 올렸다');
});

/* ───────────────────────────── 판정·출력 ───────────────────────────── */

test('assessObservation: 판정 순서는 unreadable → missing_check → uncited → ok 다', () => {
  assert.equal(assessObservation({ checks: NORMAL_CHECKS }).verdict, 'ok');
  assert.equal(assessObservation({ checks: '깨진 응답' }).verdict, 'unreadable');
  assert.equal(assessObservation({ checks: '깨진 응답' }).action, ACTION_OBS_UNREADABLE);

  const { writeFreeze: _dropped, ...withoutFreeze } = NORMAL_CHECKS;
  const missing = assessObservation({ checks: withoutFreeze });
  assert.equal(missing.verdict, 'missing_check');
  assert.deepEqual(missing.missing, ['writeFreeze']);
  assert.equal(missing.action, ACTION_OBS_MISSING);

  assert.deepEqual(assessObservation({ checks: NORMAL_CHECKS }).missing, [], '자기 자신을 missing 으로 세었다');
  assert.deepEqual(
    assessObservation({ checks: { ...NORMAL_CHECKS, surprise: { ok: true, required: false } } }).unregistered,
    ['surprise'],
  );
});

test('rehearsalObservationCheck: 설명되지 않은 degraded 로 ok 를 내리지 않는다(중복 보고 금지)', () => {
  const noisy = { ...NORMAL_CHECKS, assetCoverage: { ok: false, required: false, detail: { verdict: 'unprotected' } } };
  const c = rehearsalObservationCheck({ checks: noisy });
  assert.equal(c.ok, true, 'degraded 를 중복으로 보고해 스스로도 degraded 가 됐다');
  assert.deepEqual(c.detail.unexpectedDegraded, ['assetCoverage'], '목록으로는 드러내야 한다');
  assert.equal(c.required, false, '복구 판정이 서비스를 내리면 복구 자신이 막힌다');
  assert.equal(c.detail.verdict, 'ok');
  assert.equal(c.detail.runbook, OBSERVATION_RUNBOOK_REF);
  assert.deepEqual(c.detail.limits, OBSERVATION_LIMITS);
});

test('응답·로그에 값을 담지 않는다 — 체크 이름·판정·개수뿐이다', () => {
  const dump = JSON.stringify(rehearsalObservationCheck({ checks: REHEARSAL_CHECKS }));
  assert.ok(!dump.includes('neon.tech'), '호스트가 응답에 들어갔다');
  assert.ok(!dump.includes('postgresql://'), '연결 문자열이 응답에 들어갔다');
  assert.ok(!/\d{4}-\d{2}-\d{2}T/.test(dump), '시각 값이 응답에 들어갔다');
  assert.ok(!dump.includes('"minutes"'), '구간 수치가 응답에 들어갔다');

  const line = observationLogLine(REHEARSAL_CHECKS);
  assert.ok(line.startsWith('[rehearsalObservation] verdict=ok phase=rehearsal'));
  assert.ok(!line.includes('neon.tech') && !line.includes('postgresql'));

  const text = observationText(NORMAL_CHECKS);
  assert.ok(text.some((l) => l.startsWith('판정: ok')));
  assert.ok(text.some((l) => l.includes('설명된 degraded')), '설명된 degraded 를 숨기지 않는다');
  const status = observationStatus(NORMAL_CHECKS);
  assert.equal(status.uncited, 0);
  assert.equal(status.drifts, OBSERVATION_DRIFTS.length);
  assert.equal(status.limits, OBSERVATION_LIMITS.length);
});

test('한계를 숨기지 않는다 ⬅ 「설명된 degraded 는 여전히 degraded」를 응답에 함께 내보낸다', () => {
  const joined = OBSERVATION_LIMITS.join(' ');
  assert.ok(joined.includes('읽을 수 있다'), '인용 존재의 한계가 빠졌다');
  assert.ok(joined.includes('여전히 degraded'), 'degraded 를 지우지 않는다는 말이 빠졌다');
  assert.ok(joined.includes('CI 시점'), '런타임이 선언을 말한다는 사실이 빠졌다');
  assert.ok(OBSERVATION_LIMITS.length >= 6);
  assert.equal(OBSERVATION_DRIFTS.length, 3);
  for (const d of OBSERVATION_DRIFTS) assert.ok(d.how.trim().length > 20, `${d.key} 의 설명이 비었다`);
});

/* ───────────────────────────── 배선 ───────────────────────────── */

test('[실제 소스] /api/health 가 이 판정을 **마지막에** 싣는다', () => {
  assert.deepEqual(auditHealthWiring(ROUTE_SRC), []);
  assert.ok(/checks\.rehearsalObservation\s*=\s*rehearsalObservationCheck\(\{\s*checks\s*\}\)/.test(ROUTE_SRC));
  // route.ts 에는 HTTP 메서드·설정 외 export 를 두지 않는다(Vercel 빌드 실패 원인).
  const exports = [...ROUTE_SRC.matchAll(/^export\s+(?:async\s+)?(?:function\s+)?(?:const\s+)?(\w+)/gm)].map((m) => m[1]);
  assert.deepEqual(exports.sort(), ['GET', 'dynamic']);
});

test('auditHealthWiring: 배선 누락·버리는 판정·뒤에 실리는 체크를 잡는다', () => {
  assert.ok(auditHealthWiring('').length >= 3, '빈 소스를 통과시킨다');
  const discarded = ROUTE_SRC.replace(
    'checks.rehearsalObservation = rehearsalObservationCheck({ checks });',
    'rehearsalObservationCheck({ checks });',
  );
  assert.ok(auditHealthWiring(discarded).some((p) => p.includes('판정만 하고 버리는 꼴')));

  const later = ROUTE_SRC.replace(
    'checks.rehearsalObservation = rehearsalObservationCheck({ checks });',
    'checks.rehearsalObservation = rehearsalObservationCheck({ checks });\n  checks.disclosure = disclosureCheck();',
  );
  assert.ok(
    auditHealthWiring(later).some((p) => p.includes('disclosure') && p.includes('뒤에')),
    '뒤에 실리는 체크를 잡지 못한다 — 그 체크는 판정에서 조용히 빠진다',
  );

  const otherInput = ROUTE_SRC.replace('rehearsalObservationCheck({ checks })', 'rehearsalObservationCheck({ checks: {} })');
  assert.ok(auditHealthWiring(otherInput).some((p) => p.includes('실제 응답의 checks')));
});

test('[실제 문서] RUNBOOK 에 §6-3·확인 명령·어긋남 키가 남아 있다', () => {
  assert.deepEqual(auditRunbookObservation(RUNBOOK), []);
  assert.ok(/### 6-3\./.test(RUNBOOK));
  assert.ok(RUNBOOK.includes('checks.rehearsalObservation.detail'), '체크리스트가 이 판정을 읽지 않는다');
  assert.ok(auditRunbookObservation('내용 없음').some((p) => p.includes('6-3')));
});
