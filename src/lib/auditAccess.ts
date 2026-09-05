// 관리 기능 "접근 이력" 감사 유틸 — 순수 모듈(DB·next 의존 없음, 단위테스트 가능)
//
// 원칙
// - 쓰기(변경)뿐 아니라 관리 화면·API의 **열람**도 이력에 남긴다.
// - detail에는 PII 원문을 절대 넣지 않는다(이메일·이름·전화·비밀번호·토큰 키는 제거).
// - 이벤트명은 경로/메서드에서 기계적으로 파생해 사람이 필터링하기 쉬운 형태로 안정화한다.

export const ADMIN_AUDIT_ENTITY = 'admin';

/** 감사 대상 관리 경로인지 판정 */
export function isAdminPath(path: string): boolean {
  const p = normalizePath(path);
  return p.startsWith('/api/admin/') || p === '/api/admin' || p === '/api/audit';
}

/** 경로에서 쿼리·트레일링 슬래시 제거, 숫자 세그먼트는 :id로 일반화 */
export function normalizePath(path: string): string {
  let p = String(path ?? '').trim();
  const q = p.indexOf('?');
  if (q >= 0) p = p.slice(0, q);
  const h = p.indexOf('#');
  if (h >= 0) p = p.slice(0, h);
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  return p
    .split('/')
    .map((seg) => (seg !== '' && /^\d+$/.test(seg) ? ':id' : seg))
    .join('/');
}

const METHOD_SUFFIX: Record<string, string> = {
  GET: 'view',
  HEAD: 'view',
  POST: 'run',
  PUT: 'update',
  PATCH: 'update',
  DELETE: 'delete',
};

/**
 * 경로+메서드 → 이벤트명.
 * 예) GET /api/admin/users → admin.users.view / PATCH → admin.users.update
 *     POST /api/admin/migrate → admin.migrate.run / GET /api/audit → admin.audit.view
 */
export function adminAccessEvent(path: string, method: string): string {
  const p = normalizePath(path);
  const suffix = METHOD_SUFFIX[String(method ?? '').toUpperCase()] ?? 'access';
  const segs = p.split('/').filter(Boolean); // ['api','admin','users']
  let name: string;
  if (segs[0] === 'api' && segs[1] === 'admin') name = segs.slice(2).filter((s) => s !== ':id').join('.');
  else if (segs[0] === 'api') name = segs.slice(1).filter((s) => s !== ':id').join('.');
  else name = segs.filter((s) => s !== ':id').join('.');
  name = name || 'access';
  return `admin.${name}.${suffix}`;
}

// PII 또는 비밀값이 담길 수 있는 키 — 값 자체를 버린다(마스킹된 문자열도 남기지 않음).
const DROP_KEY = /(email|mail|name|phone|mobile|tel|password|passwd|pwd|token|secret|key|authorization|cookie|address|ssn|rrn|birth|card)/i;
const MAX_STR = 120;

/** detail 객체에서 PII/비밀 키를 제거하고 값 길이를 제한한다(1단계 깊이). */
export function sanitizeAccessDetail(detail: unknown): Record<string, unknown> {
  if (detail == null || typeof detail !== 'object' || Array.isArray(detail)) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(detail as Record<string, unknown>)) {
    if (DROP_KEY.test(k)) continue;
    if (v == null) continue;
    if (typeof v === 'string') out[k] = v.length > MAX_STR ? v.slice(0, MAX_STR) + '…' : v;
    else if (typeof v === 'number' || typeof v === 'boolean') out[k] = v;
    else if (Array.isArray(v)) out[k] = v.length; // 원소는 남기지 않고 개수만
    else out[k] = '[object]';
  }
  return out;
}

/** 관리자 변경 요청 본문 → 변경 "유형"만 도출(값은 남기지 않음) */
export function adminChangeKind(body: unknown): string {
  if (body == null || typeof body !== 'object') return 'unknown';
  const b = body as Record<string, unknown>;
  if (b.resetPassword) return 'password_reset';
  if (typeof b.isActive === 'boolean') return b.isActive ? 'activate' : 'deactivate';
  if (b.role) return 'role_change';
  return 'unknown';
}

/**
 * 접속지 힌트 — 마지막 옥텟(IPv4)/마지막 그룹(IPv6)을 가려 개인 식별성을 낮춘다.
 * 정확한 IP는 감사 목적상 불필요하며, 저장하지 않는다.
 */
export function coarseIp(forwardedFor: string | null | undefined): string {
  const raw = String(forwardedFor ?? '').split(',')[0].trim();
  if (!raw) return '';
  if (raw.includes('.')) {
    const parts = raw.split('.');
    if (parts.length === 4 && parts.every((p) => /^\d{1,3}$/.test(p))) return `${parts[0]}.${parts[1]}.${parts[2]}.x`;
    return '';
  }
  if (raw.includes(':')) {
    const parts = raw.split(':');
    return parts.slice(0, Math.max(1, parts.length - 1)).join(':') + ':x';
  }
  return '';
}

/** Request에서 감사에 남길 안전한 메타만 추출 */
export function accessMeta(req?: { url?: string; method?: string; headers?: { get(name: string): string | null } }): Record<string, unknown> {
  const meta: Record<string, unknown> = {};
  const h = req?.headers;
  if (h) {
    const ip = coarseIp(h.get('x-forwarded-for'));
    if (ip) meta.ip = ip;
    const rid = h.get('x-request-id');
    if (rid) meta.requestId = rid.slice(0, 64);
    const ua = h.get('user-agent');
    if (ua) meta.ua = ua.slice(0, MAX_STR);
  }
  return meta;
}
