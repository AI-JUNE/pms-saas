// 파일 첨부(산출물·이슈) — 저장소 어댑터·검증 순수 모듈(DB·next 의존 없음, process.env 는 인자로만).
//
// ── 원칙(build now, activate on approval) ───────────────────────────────────
//  · 실제 파일 저장소(S3·Vercel Blob 등)는 `STORAGE_PROVIDER` 로만 켠다. **미설정 = 메타데이터 전용**:
//    파일명·크기·형식·만료일만 기록하고 **본문은 어디에도 올리지 않는다**. 화면은 그 사실을 숨기지 않는다.
//  · 지원하지 않는 provider 값은 저장한 척하지 않는다 — 'unsupported' 로 돌려 메타데이터 전용과 구분한다.
//  · 검증은 서버에서 다시 한다(클라이언트가 보낸 size·mime 은 신뢰하지 않지만, 메타데이터 전용 모드에서는
//    그것이 기록의 전부이므로 형식·상한만 강제한다).
//  · 보존: 기록은 `ATTACHMENT_RETENTION_DAYS` 뒤 만료일을 갖는다. **삭제 작업은 없다** — 만료일은 표시·점검용이며
//    실제 정리는 운영 결정 뒤 별도 작업 [확인 필요].

export const STORAGE_PROVIDER_ENV = 'STORAGE_PROVIDER';
export const ATTACHMENT_MAX_MB_ENV = 'ATTACHMENT_MAX_MB';
export const ATTACHMENT_RETENTION_ENV = 'ATTACHMENT_RETENTION_DAYS';

export const DEFAULT_MAX_MB = 20;
export const MIN_MAX_MB = 1;
export const MAX_MAX_MB = 500;
export const DEFAULT_RETENTION_DAYS = 365;
export const MAX_FILENAME_LEN = 180;

/** 첨부를 달 수 있는 엔티티(ResourceView entity 키). */
export const ATTACHABLE_ENTITIES = ['issues', 'documents'] as const;
export type AttachableEntity = (typeof ATTACHABLE_ENTITIES)[number];

/** 허용 확장자(소문자). 실행 파일·스크립트는 받지 않는다. */
export const ALLOWED_EXTENSIONS = [
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'hwp', 'hwpx',
  'txt', 'md', 'csv', 'json', 'xml',
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg',
  'zip', '7z',
] as const;

export const BLOCKED_EXTENSIONS = ['exe', 'bat', 'cmd', 'com', 'msi', 'sh', 'ps1', 'js', 'vbs', 'scr', 'dll', 'jar'] as const;

export type StorageKind = 'none' | 'unsupported';
export type AttachmentStatus = 'metadata_only' | 'stored';

export interface StorageAdapter {
  kind: StorageKind;
  /** 파일 본문을 실제로 보관할 수 있는가. 지금은 어떤 어댑터도 true 가 아니다. */
  canStore: boolean;
  /** 기록 상태값 — 메타데이터 전용이면 metadata_only. */
  status: AttachmentStatus;
  /** 화면 안내 문구(한국어, 격식). */
  notice: string;
}

type EnvLike = Record<string, string | undefined>;

/** `STORAGE_PROVIDER` 해석. 미설정·공백·'none' → 메타데이터 전용. 그 외 값은 배선된 구현이 없어 unsupported. */
export function storageProviderKind(env: EnvLike | null | undefined): StorageKind {
  const v = String(env?.[STORAGE_PROVIDER_ENV] ?? '').trim().toLowerCase();
  if (!v || v === 'none') return 'none';
  return 'unsupported';
}

export const METADATA_ONLY_NOTICE = '파일 저장소가 연동되지 않아 파일 본문은 업로드되지 않습니다. 파일명·크기·형식만 기록됩니다.';
export const UNSUPPORTED_NOTICE = '설정된 저장소 제공자를 지원하지 않습니다. 파일 본문은 저장되지 않으며 메타데이터만 기록됩니다.';

export function createStorageAdapter(env: EnvLike | null | undefined): StorageAdapter {
  const kind = storageProviderKind(env);
  return {
    kind,
    canStore: false,
    status: 'metadata_only',
    notice: kind === 'none' ? METADATA_ONLY_NOTICE : UNSUPPORTED_NOTICE,
  };
}

/** 상한(MB). env 가 정수이고 범위 안이면 그 값, 아니면 기본 20MB. */
export function maxAttachmentMb(env: EnvLike | null | undefined): number {
  const raw = String(env?.[ATTACHMENT_MAX_MB_ENV] ?? '').trim();
  if (!/^\d+$/.test(raw)) return DEFAULT_MAX_MB;
  const n = Number(raw);
  if (n < MIN_MAX_MB || n > MAX_MAX_MB) return DEFAULT_MAX_MB;
  return n;
}

/** 보존 일수. env 가 양의 정수면 그 값, 아니면 기본 365일(운영 확정 전 임시값 — 화면에 '기본값' 으로 표기). */
export function attachmentRetentionDays(env: EnvLike | null | undefined): { days: number; source: 'env' | 'default' } {
  const raw = String(env?.[ATTACHMENT_RETENTION_ENV] ?? '').trim();
  if (/^\d+$/.test(raw) && Number(raw) >= 1 && Number(raw) <= 3650) return { days: Number(raw), source: 'env' };
  return { days: DEFAULT_RETENTION_DAYS, source: 'default' };
}

export function attachmentExpiry(now: Date, days: number): Date {
  return new Date(now.getTime() + days * 86_400_000);
}

/** 경로·제어문자 제거, 길이 제한. 비어 버리면 ''. */
export function sanitizeFilename(raw: unknown): string {
  let s = String(raw ?? '').replace(/[\\/]/g, '/').split('/').pop() ?? '';
  s = s.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (s.length > MAX_FILENAME_LEN) {
    const ext = extensionOf(s);
    const keep = MAX_FILENAME_LEN - (ext ? ext.length + 1 : 0) - 1;
    s = s.slice(0, Math.max(1, keep)) + '…' + (ext ? '.' + ext : '');
  }
  return s;
}

export function extensionOf(name: unknown): string {
  const s = String(name ?? '');
  const i = s.lastIndexOf('.');
  if (i <= 0 || i === s.length - 1) return '';
  return s.slice(i + 1).toLowerCase();
}

export function isAttachableEntity(v: unknown): v is AttachableEntity {
  return (ATTACHABLE_ENTITIES as readonly string[]).includes(String(v ?? ''));
}

export interface AttachmentInput { entity: unknown; entityId: unknown; filename: unknown; size: unknown; mime?: unknown }
export interface FieldError { field: string; code: string; message: string }
export interface ValidatedAttachment { entity: AttachableEntity; entityId: number; filename: string; size: number; mime: string | null; ext: string }

/** 입력 검증. 통과하면 정규화된 값, 아니면 필드별 오류(lib/validate.ts 의 fields[] 모양과 같다). */
export function validateAttachmentInput(input: AttachmentInput, opts: { maxBytes: number }): { ok: true; value: ValidatedAttachment } | { ok: false; errors: FieldError[] } {
  const errors: FieldError[] = [];
  const entity = String(input.entity ?? '');
  if (!isAttachableEntity(entity)) errors.push({ field: 'entity', code: 'INVALID', message: '첨부를 지원하지 않는 대상입니다' });
  const entityId = Number(input.entityId);
  if (!Number.isInteger(entityId) || entityId <= 0) errors.push({ field: 'entityId', code: 'INVALID', message: '대상 식별자가 올바르지 않습니다' });
  const filename = sanitizeFilename(input.filename);
  const ext = extensionOf(filename);
  if (!filename) errors.push({ field: 'filename', code: 'REQUIRED', message: '파일명이 필요합니다' });
  else if (!ext) errors.push({ field: 'filename', code: 'INVALID', message: '확장자가 없는 파일은 첨부할 수 없습니다' });
  else if ((BLOCKED_EXTENSIONS as readonly string[]).includes(ext)) errors.push({ field: 'filename', code: 'BLOCKED_TYPE', message: `실행 파일(.${ext})은 첨부할 수 없습니다` });
  else if (!(ALLOWED_EXTENSIONS as readonly string[]).includes(ext)) errors.push({ field: 'filename', code: 'INVALID_TYPE', message: `허용되지 않는 형식(.${ext})입니다` });
  const size = Number(input.size);
  if (!Number.isFinite(size) || size < 0 || !Number.isInteger(size)) errors.push({ field: 'size', code: 'INVALID', message: '파일 크기가 올바르지 않습니다' });
  else if (size === 0) errors.push({ field: 'size', code: 'EMPTY', message: '빈 파일은 첨부할 수 없습니다' });
  else if (size > opts.maxBytes) errors.push({ field: 'size', code: 'TOO_LARGE', message: `파일 크기 상한(${formatBytes(opts.maxBytes)})을 초과했습니다` });
  let mime: string | null = null;
  if (input.mime != null && String(input.mime).trim()) {
    const m = String(input.mime).trim().toLowerCase();
    if (!/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(m) || m.length > 120) errors.push({ field: 'mime', code: 'INVALID', message: '파일 형식(MIME) 표기가 올바르지 않습니다' });
    else mime = m;
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { entity: entity as AttachableEntity, entityId, filename, size, mime, ext } };
}

/** 사람이 읽는 크기. */
export function formatBytes(n: unknown): string {
  const v = Number(n);
  if (!Number.isFinite(v) || v < 0) return '—';
  if (v < 1024) return `${v} B`;
  if (v < 1024 * 1024) return `${(v / 1024).toFixed(1)} KB`;
  if (v < 1024 * 1024 * 1024) return `${(v / (1024 * 1024)).toFixed(1)} MB`;
  return `${(v / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/** 만료 판정(표시용). */
export function isExpired(expiresAt: Date | string | null | undefined, now: Date = new Date()): boolean {
  if (!expiresAt) return false;
  const t = new Date(expiresAt).getTime();
  return Number.isFinite(t) && t <= now.getTime();
}

/** 한눈 요약(운영 점검용). 화면에 쓰는 수치가 아니다. */
export function attachmentsStatus(env: EnvLike | null | undefined): { provider: StorageKind; canStore: boolean; maxMb: number; retentionDays: number; retentionSource: 'env' | 'default' } {
  const r = attachmentRetentionDays(env);
  return { provider: storageProviderKind(env), canStore: false, maxMb: maxAttachmentMb(env), retentionDays: r.days, retentionSource: r.source };
}
