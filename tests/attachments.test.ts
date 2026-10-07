/**
 * attachments.test.ts — 파일 첨부(산출물·이슈) 메타데이터 전용 어댑터·검증. 2026-10-07 (주간 수동, ROADMAP ⑩ 29)
 *
 * 기본 OFF 원칙: STORAGE_PROVIDER 미설정이면 파일 본문은 어디에도 올라가지 않고 메타데이터만 기록된다.
 * 화면·응답이 그 사실을 숨기지 않는지도 함께 고정한다. 파일만 읽는다 — 네트워크·DB 미사용.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  ATTACHABLE_ENTITIES, ALLOWED_EXTENSIONS, BLOCKED_EXTENSIONS, DEFAULT_MAX_MB, DEFAULT_RETENTION_DAYS, METADATA_ONLY_NOTICE,
  storageProviderKind, createStorageAdapter, maxAttachmentMb, attachmentRetentionDays, attachmentExpiry,
  sanitizeFilename, extensionOf, isAttachableEntity, validateAttachmentInput, formatBytes, isExpired, attachmentsStatus,
} from '../src/lib/attachments.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (...p: string[]) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const MB = 1024 * 1024;

test("storageProviderKind: 미설정·'none' 은 메타데이터 전용, 그 외는 unsupported(저장한 척하지 않는다)", () => {
  assert.equal(storageProviderKind({}), 'none');
  assert.equal(storageProviderKind({ STORAGE_PROVIDER: ' NONE ' }), 'none');
  assert.equal(storageProviderKind({ STORAGE_PROVIDER: 's3' }), 'unsupported');
  assert.equal(storageProviderKind({ STORAGE_PROVIDER: 'vercel-blob' }), 'unsupported');
  const a = createStorageAdapter({});
  assert.equal(a.canStore, false); assert.equal(a.status, 'metadata_only'); assert.equal(a.notice, METADATA_ONLY_NOTICE);
  const b = createStorageAdapter({ STORAGE_PROVIDER: 's3' });
  assert.equal(b.canStore, false, '배선 없는 provider 가 저장 가능으로 보이면 사용자가 파일을 잃는다');
  assert.match(b.notice, /지원하지 않습니다/);
});

test('maxAttachmentMb / attachmentRetentionDays: 범위 밖·비정수는 기본값', () => {
  assert.equal(maxAttachmentMb({}), DEFAULT_MAX_MB);
  assert.equal(maxAttachmentMb({ ATTACHMENT_MAX_MB: '50' }), 50);
  assert.equal(maxAttachmentMb({ ATTACHMENT_MAX_MB: '0' }), DEFAULT_MAX_MB);
  assert.equal(maxAttachmentMb({ ATTACHMENT_MAX_MB: '9999' }), DEFAULT_MAX_MB);
  assert.deepEqual(attachmentRetentionDays({}), { days: DEFAULT_RETENTION_DAYS, source: 'default' });
  assert.deepEqual(attachmentRetentionDays({ ATTACHMENT_RETENTION_DAYS: '90' }), { days: 90, source: 'env' });
  assert.deepEqual(attachmentRetentionDays({ ATTACHMENT_RETENTION_DAYS: '-1' }), { days: DEFAULT_RETENTION_DAYS, source: 'default' });
  const now = new Date('2026-10-07T00:00:00Z');
  assert.equal(attachmentExpiry(now, 90).toISOString().slice(0, 10), '2027-01-05');
  assert.equal(isExpired(attachmentExpiry(now, 1), now), false);
  assert.equal(isExpired(now, now), true);
  assert.equal(isExpired(null, now), false);
});

test('sanitizeFilename / extensionOf: 경로·제어문자 제거, 길이 제한, 확장자 소문자', () => {
  assert.equal(sanitizeFilename('C:\\Users\\me\\보고서.PDF'), '보고서.PDF');
  assert.equal(sanitizeFilename('../../etc/passwd'), 'passwd');
  assert.equal(sanitizeFilename('a\u0000b.txt'), 'ab.txt');
  assert.equal(sanitizeFilename('   '), '');
  const long = sanitizeFilename('x'.repeat(300) + '.docx');
  assert.ok(long.length <= 182 && long.endsWith('.docx'));
  assert.equal(extensionOf('보고서.PDF'), 'pdf');
  assert.equal(extensionOf('noext'), '');
  assert.equal(extensionOf('.hidden'), '');
  assert.equal(extensionOf('trailing.'), '');
});

test('validateAttachmentInput: 대상·파일명·형식·크기·MIME', () => {
  const okv = validateAttachmentInput({ entity: 'issues', entityId: '12', filename: '재현절차.png', size: 1024, mime: 'image/PNG' }, { maxBytes: 20 * MB });
  assert.equal(okv.ok, true);
  if (okv.ok) { assert.equal(okv.value.entityId, 12); assert.equal(okv.value.ext, 'png'); assert.equal(okv.value.mime, 'image/png'); }
  const bad = validateAttachmentInput({ entity: 'tasks', entityId: 0, filename: 'x', size: -1, mime: 'bad' }, { maxBytes: MB });
  assert.equal(bad.ok, false);
  if (!bad.ok) {
    const codes = Object.fromEntries(bad.errors.map((e) => [e.field, e.code]));
    assert.equal(codes.entity, 'INVALID'); assert.equal(codes.entityId, 'INVALID'); assert.equal(codes.filename, 'INVALID'); assert.equal(codes.size, 'INVALID'); assert.equal(codes.mime, 'INVALID');
  }
  const exe = validateAttachmentInput({ entity: 'documents', entityId: 1, filename: 'setup.EXE', size: 10 }, { maxBytes: MB });
  assert.equal(exe.ok, false); if (!exe.ok) assert.equal(exe.errors[0].code, 'BLOCKED_TYPE');
  const odd = validateAttachmentInput({ entity: 'documents', entityId: 1, filename: 'model.blend', size: 10 }, { maxBytes: MB });
  assert.equal(odd.ok, false); if (!odd.ok) assert.equal(odd.errors[0].code, 'INVALID_TYPE');
  const big = validateAttachmentInput({ entity: 'documents', entityId: 1, filename: 'a.pdf', size: MB + 1 }, { maxBytes: MB });
  assert.equal(big.ok, false); if (!big.ok) assert.equal(big.errors[0].code, 'TOO_LARGE');
  const empty = validateAttachmentInput({ entity: 'documents', entityId: 1, filename: 'a.pdf', size: 0 }, { maxBytes: MB });
  assert.equal(empty.ok, false); if (!empty.ok) assert.equal(empty.errors[0].code, 'EMPTY');
  const noMime = validateAttachmentInput({ entity: 'documents', entityId: 1, filename: 'a.pdf', size: 5 }, { maxBytes: MB });
  assert.equal(noMime.ok, true); if (noMime.ok) assert.equal(noMime.value.mime, null);
});

test('허용·차단 목록이 겹치지 않고, 첨부 대상은 이슈·산출물 둘뿐', () => {
  for (const b of BLOCKED_EXTENSIONS) assert.ok(!(ALLOWED_EXTENSIONS as readonly string[]).includes(b), b);
  assert.deepEqual([...ATTACHABLE_ENTITIES], ['issues', 'documents']);
  assert.equal(isAttachableEntity('issues'), true); assert.equal(isAttachableEntity('tasks'), false);
  assert.equal(formatBytes(512), '512 B'); assert.equal(formatBytes(1536), '1.5 KB'); assert.equal(formatBytes(3 * MB), '3.0 MB'); assert.equal(formatBytes(-1), '—');
  assert.deepEqual(attachmentsStatus({}), { provider: 'none', canStore: false, maxMb: 20, retentionDays: 365, retentionSource: 'default' });
});

// ── 실제 소스 배선 ────────────────────────────────────────────────────────────

test('[실제 소스] 첨부 라우트: 검증·조직 스코프·어댑터 상태 기록·route export 규율', () => {
  const list = read('src', 'app', 'api', 'attachments', 'route.ts');
  assert.ok(list.includes('validateAttachmentInput('), '서버 검증 누락');
  assert.ok(list.includes('createStorageAdapter(process.env'), '어댑터가 env 를 보지 않는다');
  assert.ok(list.includes('requirePermission('), '쓰기 권한(RBAC) 검사 누락');
  assert.ok(!/formData\(\)|arrayBuffer\(\)/.test(list), '메타데이터 전용인데 파일 본문을 받는다');
  let ex = Array.from(list.matchAll(/^export\s+(?:async\s+)?(?:function|const)\s+(\w+)/gm)).map((m) => m[1]).sort();
  assert.deepEqual(ex, ['GET', 'POST', 'dynamic']);
  const item = read('src', 'app', 'api', 'attachments', '[id]', 'route.ts');
  ex = Array.from(item.matchAll(/^export\s+(?:async\s+)?(?:function|const)\s+(\w+)/gm)).map((m) => m[1]).sort();
  assert.deepEqual(ex, ['DELETE', 'dynamic']);
  const schema = read('src', 'db', 'schema.ts');
  assert.ok(schema.includes("pgTable('attachments'"), 'drizzle 선언 누락');
  assert.ok(/CREATE TABLE IF NOT EXISTS attachments/.test(read('src', 'lib', 'migrate.ts')), '멱등 DDL 누락');
  const comp = read('src', 'components', 'Attachments.tsx');
  assert.ok(comp.includes('notice') || comp.includes('메타데이터'), '화면이 메타데이터 전용 사실을 알리지 않는다');
  const rv = read('src', 'components', 'ResourceView.tsx');
  assert.ok(rv.includes('<Attachments '), 'ResourceView 상세에 첨부 섹션이 없다');
  const env = read('src', 'lib', 'envRegistry.ts');
  for (const k of ['STORAGE_PROVIDER', 'ATTACHMENT_MAX_MB', 'ATTACHMENT_RETENTION_DAYS']) assert.ok(env.includes(`key: '${k}'`), `env 레지스트리 누락: ${k}`);
});
