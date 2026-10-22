/**
 * assetCoverage.test.ts — §1 보호 대상 표가 **실제 저장 위치와 맞는가**(RUNBOOK §1·§1-1). 2026-10-16
 *
 * ── 왜 필요한가 ──────────────────────────────────────────────────────────────
 * §3·§4·§5 의 기계적 판정은 전부 §1 표 한 장을 전제로 삼는데, 그 표만은 코드와 대조된 적이 없었다.
 * 「업로드 파일 = DB 저장 = DB 백업에 포함」은 사실이 아니다 — 어떤 어댑터도 `canStore: true` 가
 * 아니라 본문은 어디에도 보관되지 않고, 복구로 돌아오는 것은 **목록**이다. 외부 스토리지를 켜면
 * 본문이 PITR 경계 밖으로 나가 고아 객체·깨진 참조가 생기는데, 그 전환은 환경변수 한 줄이다.
 *
 * 그래서 (a) 판정 자체(미연동·미지원·경계 밖 세 상태와 그 뜻), (b) 배선(health 응답·§1 표·§1-1),
 * (c) **어댑터·스키마의 모양**이 바뀌면 문서를 함께 고치도록 파일 수준에서 고정한다.
 * 이 테스트는 **파일만 읽는다** — 네트워크·DB 를 쓰지 않고 `process.env` 도 바꾸지 않는다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  ACTION_METADATA_ONLY,
  ASSET_LIMITS,
  ASSET_RUNBOOK_REF,
  ATTACHMENT_KEY_COLUMN,
  ATTACHMENT_TABLE,
  COVERAGE_DRIFTS,
  COVERAGE_VERDICTS,
  PROTECTED_ASSETS,
  assetCoverageCheck,
  assetCoverageStatus,
  assetFor,
  attachmentCoverage,
  auditAttachmentSource,
  auditCoreTableBlindSpot,
  auditHealthWiring,
  auditRunbookAssets,
  auditSchemaSource,
  coverageLogLine,
  coveragePlanFor,
  coverageText,
  runbookSection1,
} from '../src/lib/assetCoverage.ts';
import { createStorageAdapter } from '../src/lib/attachments.ts';
import { CORE_TABLE_ROLES } from '../src/lib/recoveryVerify.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (...p: string[]) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

/** 본문을 실제로 보관하게 된 미래의 어댑터 — 지금 코드에는 없지만 그 상태를 시험할 수 있어야 한다 */
const storedAdapter = { ...createStorageAdapter({}), kind: 'unsupported' as const, canStore: true, status: 'stored' as const };

/* ─────────────────────────── 정본 목록 ─────────────────────────── */

test('보호 대상 정본: §1 표 다섯 줄이 전부 있고 빈 칸이 없다', () => {
  assert.equal(PROTECTED_ASSETS.length, 5);
  const keys = PROTECTED_ASSETS.map((a) => a.key);
  assert.deepEqual(keys, ['app_db', 'source', 'deploy', 'secrets', 'uploads']);
  for (const a of PROTECTED_ASSETS) {
    assert.ok(a.asset.trim() && a.store.trim() && a.backupBy.trim(), `${a.key} 칸이 비었다`);
    assert.ok(a.restorePath.trim() && a.silent.trim(), `${a.key} 의 복구 경로·사각지대가 비었다`);
  }
  // 업로드 파일 줄은 **백업 주체가 없다**고 적는다 — 지어내지 않는다.
  const uploads = assetFor('uploads');
  assert.ok(uploads);
  assert.match(uploads!.backupBy, /해당 없음/);
  assert.match(uploads!.store, /메타데이터뿐/);
  assert.equal(assetFor('files'), null);
});

test('어긋남은 세 방향이고, 고아 객체는 **아무도 신고하지 않는다**', () => {
  assert.equal(COVERAGE_DRIFTS.length, 3);
  const orphan = COVERAGE_DRIFTS.find((d) => d.key === 'orphan_object');
  const dangling = COVERAGE_DRIFTS.find((d) => d.key === 'dangling_reference');
  assert.ok(orphan && dangling);
  assert.match(orphan!.noticedBy, /아무도/);
  assert.match(orphan!.storeSide, /개인정보/, '삭제 이행이 되돌아간다는 사실이 빠졌다');
  assert.match(dangling!.noticedBy, /사용자/);
  assert.ok(COVERAGE_DRIFTS.every((d) => d.when.trim() && d.fix.trim()));
});

/* ─────────────────────────── 판정 ─────────────────────────── */

test('미연동(평상시): metadata_only — 본문이 없고 복구 경계 안도 아니다', () => {
  const c = attachmentCoverage({});
  assert.equal(c.verdict, 'metadata_only');
  assert.equal(c.provider, 'none');
  assert.equal(c.canStore, false);
  assert.equal(c.inRestoreScope, false);
  assert.equal(c.table, ATTACHMENT_TABLE);
  assert.equal(c.action, ACTION_METADATA_ONLY);
  // 「복구된다」로 올리지 않는다 — 돌아오는 것은 목록이다.
  assert.match(c.action, /목록/);
  assert.match(c.bodyLocation, /어디에도 보관되지 않는다/);
  assert.equal(attachmentCoverage(null).verdict, 'metadata_only');
  assert.equal(attachmentCoverage({ STORAGE_PROVIDER: '  ' }).verdict, 'metadata_only');
  assert.equal(attachmentCoverage({ STORAGE_PROVIDER: 'none' }).verdict, 'metadata_only');
});

test('값만 들어간 provider: unsupported — 저장되지 않는데 **설정만 켜진 모습**이다', () => {
  const c = attachmentCoverage({ STORAGE_PROVIDER: 's3' });
  assert.equal(c.verdict, 'unsupported');
  assert.equal(c.canStore, false);
  assert.equal(c.inRestoreScope, false);
  assert.match(c.action, /활성화 승인 필요/);
  assert.match(c.bodyLocation, /설정만 켜진/);
});

test('본문을 보관하게 되면: unprotected — 경계 밖이라고 말하고 대조 단계를 지시한다', () => {
  const c = attachmentCoverage({ STORAGE_PROVIDER: 's3' }, storedAdapter);
  assert.equal(c.verdict, 'unprotected');
  assert.equal(c.canStore, true);
  assert.equal(c.inRestoreScope, false, 'DB 밖은 PITR 로 되돌아가지 않는다');
  assert.match(c.action, new RegExp(ATTACHMENT_TABLE));
  assert.match(c.action, /PITR 경계 밖/);
  assert.deepEqual([...COVERAGE_VERDICTS], ['metadata_only', 'unsupported', 'unprotected']);
});

test('4단계가 첨부 테이블을 **세고 있는지**를 숨기지 않는다(2026-10-22 §3-11)', () => {
  assert.equal(CORE_TABLE_ROLES.some((r) => r.table === ATTACHMENT_TABLE), true);
  assert.equal(attachmentCoverage({}).countedInCoreTables, true);
  assert.deepEqual(auditCoreTableBlindSpot(), []);
  // 다시 빠지면 CI 가 실패한다 — 응답·화면은 그대로 돌기 때문에 사람 눈으로는 알아챌 수 없는 회귀다.
  const dropped = auditCoreTableBlindSpot(CORE_TABLE_ROLES.filter((r) => r.table !== ATTACHMENT_TABLE));
  assert.equal(dropped.length, 1);
  assert.match(dropped[0], /사각지대가 돌아왔다/);
  // 세기 시작했으므로 「행 수 ok 는 목록에 대한 말이다」가 한계 목록에 남아 있어야 한다.
  const silentOk = auditCoreTableBlindSpot(CORE_TABLE_ROLES, ['관계없는 한계']);
  assert.equal(silentOk.length, 1);
  assert.match(silentOk[0], /목록.*에 대한 판정/);
  assert.ok(ASSET_LIMITS.some((l) => l.includes(ATTACHMENT_TABLE)), '한계 목록에 첨부 테이블 설명이 없다');
  // metadata_only 가 「복구된다」는 뜻이 아니라는 사실도 한계로 내보낸다.
  assert.ok(ASSET_LIMITS.some((l) => /복구된다」는 뜻이 아니다/.test(l)));
});

/* ─────────────────────────── health 체크 ─────────────────────────── */

test('health 체크: 미연동만 ok 이고 required:false — 어느 경우에도 503 이 아니다', () => {
  const normal = assetCoverageCheck({ env: {} });
  assert.equal(normal.ok, true);
  assert.equal(normal.required, false);
  assert.equal(normal.detail.verdict, 'metadata_only');
  assert.equal(normal.detail.runbook, ASSET_RUNBOOK_REF);
  assert.equal((normal.detail.assets as unknown[]).length, 5);

  const unsupported = assetCoverageCheck({ env: { STORAGE_PROVIDER: 's3' } });
  assert.equal(unsupported.ok, false);
  assert.equal(unsupported.required, false);

  const unprotected = assetCoverageCheck({ env: { STORAGE_PROVIDER: 's3' }, adapter: storedAdapter });
  assert.equal(unprotected.ok, false);
  assert.equal(unprotected.detail.verdict, 'unprotected');
  assert.match(String(unprotected.detail.note), /참조 행만/);

  // §3-9 외부 상태 목록에 저장소가 없다는 사실을 응답에 그대로 담는다(한계를 숨기지 않는다).
  assert.equal(normal.detail.storageInExternalSystems, false);
});

test('공개 응답에 파일명·업로더·저장 키 **값**을 담지 않는다', () => {
  const dump = JSON.stringify(
    assetCoverageCheck({
      env: { STORAGE_PROVIDER: 'bucket-prod-secret', DATABASE_URL: 'postgres://u:p@h/db', SENTRY_DSN: 'https://dsn' },
    }),
  );
  for (const leak of ['bucket-prod-secret', 'postgres://', 'https://dsn', 'uploader', 'uploaded_by']) {
    assert.equal(dump.includes(leak), false, `응답에 ${leak} 가 들어 있다`);
  }
  // 칼럼·테이블 **이름**은 대조 지시에 필요하므로 담는다(값이 아니다).
  assert.ok(dump.includes(ATTACHMENT_TABLE));
});

test('요약·로그·사람용 출력: 판정과 한계를 함께 내고 값은 넣지 않는다', () => {
  const plan = coveragePlanFor({ STORAGE_PROVIDER: 'bucket-prod-secret' });
  const text = coverageText(plan);
  assert.match(text, /\[unsupported\]/);
  assert.ok(plan.limits.every((l) => text.includes(l)));
  assert.equal(text.includes('bucket-prod-secret'), false);

  const line = coverageLogLine(plan);
  assert.match(line, /^\[assetCoverage\] verdict=unsupported provider=unsupported canStore=false/);
  assert.match(line, /assets=5/);

  const s = assetCoverageStatus({});
  assert.equal(s.verdict, 'metadata_only');
  assert.equal(s.assets, 5);
  assert.equal(s.drifts, 3);
  assert.equal(s.limits, ASSET_LIMITS.length);
});

/* ─────────────────────────── 정적 점검 ─────────────────────────── */

test('어댑터 원문: canStore 가 true 로 바뀌면 CI 가 문서를 함께 고치라고 실패한다', () => {
  assert.deepEqual(auditAttachmentSource(read('src', 'lib', 'attachments.ts')), []);
  const stored = read('src', 'lib', 'attachments.ts').replaceAll('canStore: false', 'canStore: true');
  const problems = auditAttachmentSource(stored);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /§1 표/);
  // 상태값·스위치가 옮겨 가는 것도 잡는다.
  assert.ok(auditAttachmentSource('const a = 1; canStore: false').length >= 1);
});

test('스키마 원문: 첨부 테이블과 본문 참조 칼럼의 이름을 고정한다', () => {
  assert.deepEqual(auditSchemaSource(read('src', 'db', 'schema.ts')), []);
  assert.equal(auditSchemaSource('').length, 2);
  assert.match(auditSchemaSource(`export const ${ATTACHMENT_TABLE} = pgTable('x', {})`)[0], new RegExp(ATTACHMENT_KEY_COLUMN));
});

test('health 배선: 판정만 하고 버리는 꼴까지 잡는다', () => {
  assert.deepEqual(auditHealthWiring(read('src', 'app', 'api', 'health', 'route.ts')), []);
  assert.equal(auditHealthWiring('').length, 3);
  const dropped = `import { assetCoverageCheck } from '@/lib/assetCoverage';\nassetCoverageCheck();`;
  assert.deepEqual(auditHealthWiring(dropped), ['판정 결과를 checks.assetCoverage 에 싣지 않는다(판정만 하고 버리는 꼴)']);
});

test('RUNBOOK: §1 표가 「DB 백업에 포함」으로 되돌아가거나 §1-1 이 사라지면 실패', () => {
  const src = read('RUNBOOK.md');
  assert.deepEqual(auditRunbookAssets(src), []);

  const regressed = src.replace(
    /\| 업로드 파일\(첨부\)[^\n]*\n/,
    '| 업로드 파일 | (현재 DB 저장) | DB 백업에 포함 | 외부 스토리지 도입 시 이 표를 갱신할 것 |\n',
  );
  assert.ok(auditRunbookAssets(regressed).some((p) => /DB 백업에 포함/.test(p)));

  const noSection = src.replace(/^### 1-1\./m, '### 1-9.');
  assert.ok(auditRunbookAssets(noSection).some((p) => /1-1 절이 사라졌다/.test(p)));

  // 줄 자체가 빠진 경우 — 「보호 대상이 아니다」로 조용히 바뀌는 쪽이 더 나쁘다.
  const noRow = src.replace(/^\| 업로드 파일\(첨부\)[^\n]*\n/m, '');
  assert.ok(auditRunbookAssets(noRow).some((p) => /업로드 파일 줄이 없다/.test(p)));

  assert.deepEqual(auditRunbookAssets(''), ['RUNBOOK 에서 §1 절을 찾을 수 없다']);
});

test('§1 절 자르기: §2 를 물고 오지 않고, 못 찾으면 빈 문자열', () => {
  const sec = runbookSection1(read('RUNBOOK.md'));
  assert.ok(sec.startsWith('## 1. '));
  assert.equal(sec.includes('## 2. 정기 점검'), false);
  assert.ok(sec.includes('metadata_only'));
  assert.equal(runbookSection1('# 제목만 있다'), '');
  assert.ok(runbookSection1('## 1. 끝까지\n본문').endsWith('본문'));
});

test('순수 모듈: DB·next·fs 를 쓰지 않고 신규 env 를 만들지 않는다', () => {
  const src = read('src', 'lib', 'assetCoverage.ts');
  for (const bad of ["from 'next", "from '@/db", "from 'drizzle", "from 'node:fs"]) {
    assert.equal(src.includes(bad), false, `${bad} 를 import 한다`);
  }
  assert.equal(/\bsql`/.test(src), false, '쿼리를 만든다');
  // env 는 기본 인자에서만 받는다 — 새 키를 직접 읽지 않는다(STORAGE_PROVIDER 는 어댑터가 읽는다).
  assert.equal(/process\.env\.[A-Z]/.test(src), false, 'env 키를 직접 읽는다');
  assert.equal(/ASSET_[A-Z_]*=\s*\d/.test(src), false, '임의 수치를 둔다');
});
