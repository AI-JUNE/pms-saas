// 화면(URL) 단위 역할 접근 정책 — 순수 모듈(DB·next·process.env 의존 없음).
//
// ── 왜 필요한가 ──────────────────────────────────────────────────────────────
// 기존 RBAC(lib/rbac.ts) 는 **리소스:액션**(issue:write 등) 단위로 API 쓰기·결재를 막는다.
// 그런데 화면·메뉴는 역할을 보지 않았다 — 일반 멤버도 사이드바에서 「사용자·권한」을 눌러
// 조직 구성원 **전원의 이메일**을 볼 수 있었고(/api/admin/users GET 은 멤버십만 확인),
// 「감사 로그」·「요금제·결제」도 같았다. 쓰기는 isOrgAdmin 으로 막혀 있었으니 *읽기*만 열린 상태.
// 이 모듈은 그 읽기 경계를 **화면 경로 → 최소 등급** 표 하나로 정하고, 세 곳이 같은 표를 쓴다:
//   1) Shell 사이드바·사용자 메뉴 — 등급 미달 항목을 숨긴다(filterNav)
//   2) 서버 레이아웃(ScreenGate) — 주소를 직접 쳐도 403 화면(screenDecision)
//   3) 해당 화면이 부르는 API — assertScreenAccess 로 403 응답(UI 를 우회해도 데이터는 안 나간다)
//
// ── 설계 원칙 ───────────────────────────────────────────────────────────────
//  · **기본 허용**: 표에 없는 화면은 'member' 등급(로그인한 누구나). 업무 화면을 막아
//    사용자를 잠그는 사고(ROADMAP ④ 메모 「읽기 게이트는 사용자 잠금 위험」)를 피한다.
//  · **관리 화면만 fail-closed**: 표에 있는 화면은 역할을 모르면(미지 역할·조직 없음) 거부.
//  · 슈퍼관리자·조직관리자(isOrgAdmin)는 항상 'admin' 등급. 역할 문자열은 보조 신호다.
//  · partner_admin 은 고객사 화면 어디에도 등급을 받지 않는다(partnerRbac 가 별도 관리).

export type AccessLevel = 'member' | 'lead' | 'admin';

/** 등급 순위 — 숫자가 클수록 넓다. */
export const LEVEL_RANK: Record<AccessLevel, number> = { member: 1, lead: 2, admin: 3 };

/** 등급 한국어 라벨(403 화면 문구용). */
export const LEVEL_LABEL: Record<AccessLevel, string> = { member: '구성원', lead: 'PM·PMO 이상', admin: '관리자' };

/** memberships.role 문자열 → 등급. 표에 없는 역할은 member(최소)로 본다. */
export const ROLE_LEVEL: Record<string, AccessLevel> = {
  member: 'member',
  pm: 'lead',
  pmo: 'lead',
  admin: 'admin',
};

/**
 * 화면 경로 → 최소 등급. **여기 없는 화면은 member.**
 * 하위 경로는 가장 긴 접두사를 따른다(`/admin/security` 가 없으면 `/admin` 을 쓴다).
 */
export const SCREEN_POLICY: Record<string, AccessLevel> = {
  '/admin': 'admin',              // 구성원 전원의 이메일·역할·활성 상태
  '/admin/security': 'admin',     // 보안 이벤트(API 는 슈퍼관리자로 한 번 더 막는다)
  '/audit': 'lead',               // 조직 전체 변경 이력 — PM·PMO 는 봐야 한다
  '/settings/billing': 'admin',   // 요금제·결제·좌석
};

export const DEFAULT_LEVEL: AccessLevel = 'member';

/** 접근 판정에 필요한 최소 정보. `/api/auth/me` 응답의 user·org 에서 바로 만들 수 있다. */
export interface Principal {
  role?: string | null;
  isOrgAdmin?: boolean | null;
  isSuperadmin?: boolean | null;
}

export interface ScreenDecision {
  allowed: boolean;
  href: string;
  /** 화면이 요구하는 등급. */
  required: AccessLevel;
  /** 주체가 가진 등급. 조직 정보가 없으면 null. */
  have: AccessLevel | null;
  reason: 'ok' | 'insufficient_role' | 'no_org' | 'partner_role';
}

/** 쿼리·해시·끝 슬래시를 떼고 비교 가능한 경로로(appRoutes.normalizePath 와 같은 규칙, 의존 없이 복제). */
export function normalizeHref(raw: unknown): string {
  let s = String(raw ?? '').trim();
  if (!s.startsWith('/')) return '';
  const cut = s.search(/[?#]/);
  if (cut >= 0) s = s.slice(0, cut);
  while (s.length > 1 && s.endsWith('/')) s = s.slice(0, -1);
  return s;
}

/** 주체의 등급. 슈퍼관리자·조직관리자는 admin, 그 외는 역할 표, 모르면 member. 파트너 역할은 null. */
export function principalLevel(p: Principal | null | undefined): AccessLevel | null {
  if (!p) return null;
  if (p.isSuperadmin === true) return 'admin';
  const role = String(p.role ?? '').trim();
  if (role === 'partner_admin') return null;
  if (p.isOrgAdmin === true) return 'admin';
  return ROLE_LEVEL[role] ?? DEFAULT_LEVEL;
}

/** 화면이 요구하는 등급 — 가장 긴 일치 접두사. 표에 없으면 member. */
export function requiredLevel(href: unknown): AccessLevel {
  const p = normalizeHref(href);
  if (!p) return DEFAULT_LEVEL;
  let best: string | null = null;
  for (const key of Object.keys(SCREEN_POLICY)) {
    if (p === key || p.startsWith(key + '/')) {
      if (!best || key.length > best.length) best = key;
    }
  }
  return best ? SCREEN_POLICY[best] : DEFAULT_LEVEL;
}

/** 등급 비교. */
export function levelSatisfies(have: AccessLevel | null, need: AccessLevel): boolean {
  if (!have) return false;
  return LEVEL_RANK[have] >= LEVEL_RANK[need];
}

/** 접근 판정(사유 포함). */
export function screenDecision(p: Principal | null | undefined, href: unknown): ScreenDecision {
  const h = normalizeHref(href);
  const required = requiredLevel(h);
  const have = principalLevel(p);
  if (p && String(p.role ?? '') === 'partner_admin' && p.isSuperadmin !== true) {
    return { allowed: false, href: h, required, have: null, reason: 'partner_role' };
  }
  if (have === null) {
    // 조직 정보가 없다 — 관리 화면은 거부, 일반 화면은 허용(온보딩 중 사용자를 잠그지 않는다).
    return required === DEFAULT_LEVEL
      ? { allowed: true, href: h, required, have, reason: 'ok' }
      : { allowed: false, href: h, required, have, reason: 'no_org' };
  }
  const allowed = levelSatisfies(have, required);
  return { allowed, href: h, required, have, reason: allowed ? 'ok' : 'insufficient_role' };
}

export function canAccessScreen(p: Principal | null | undefined, href: unknown): boolean {
  return screenDecision(p, href).allowed;
}

/** 메뉴 항목 중 주체가 열 수 있는 것만. 주체를 모르면(로딩 전) 관리 화면을 숨긴다. */
export function filterNav<T extends { href: string }>(items: readonly T[], p: Principal | null | undefined): T[] {
  return items.filter((it) => canAccessScreen(p, it.href));
}

/** 403 화면·API 메시지(한국어, 격식). */
export function forbiddenMessage(d: ScreenDecision): string {
  if (d.reason === 'partner_role') return '파트너 담당자 계정은 고객사 화면에 접근할 수 없습니다.';
  if (d.reason === 'no_org') return '소속 조직 정보가 없어 이 화면을 열 수 없습니다.';
  return `이 화면은 ${LEVEL_LABEL[d.required]} 권한이 필요합니다. 현재 권한은 ${d.have ? LEVEL_LABEL[d.have] : '미확인'}입니다.`;
}

/** 라우트 핸들러용 — 거부면 ApiError(403) 대신 쓸 수 있는 표준 오류 객체를 만든다(http.ts 의존 없이). */
export function screenAccessError(d: ScreenDecision): { status: 403; code: 'FORBIDDEN'; message: string } | null {
  if (d.allowed) return null;
  return { status: 403, code: 'FORBIDDEN', message: forbiddenMessage(d) };
}

/**
 * 정책 표 무결성 — 표의 경로가 전부 실존 화면(레지스트리)인지. 오타 난 키는 아무것도 막지 않는다.
 * 호출부(테스트)가 appRoutes.APP_SCREENS 의 href 목록을 넘긴다.
 */
export function auditScreenPolicy(knownHrefs: readonly string[]): { unknownTargets: string[]; adminScreens: string[] } {
  const known = new Set(knownHrefs.map((h) => normalizeHref(h)));
  const unknownTargets = Object.keys(SCREEN_POLICY).filter((k) => !known.has(k)).sort();
  const adminScreens = Object.entries(SCREEN_POLICY).filter(([, v]) => v === 'admin').map(([k]) => k).sort();
  return { unknownTargets, adminScreens };
}

/** 역할 × 화면 매트릭스(운영 점검·테스트용). */
export function accessMatrix(roles: readonly string[] = Object.keys(ROLE_LEVEL)): Record<string, Record<string, boolean>> {
  const out: Record<string, Record<string, boolean>> = {};
  for (const r of roles) {
    out[r] = {};
    for (const href of Object.keys(SCREEN_POLICY)) out[r][href] = canAccessScreen({ role: r, isOrgAdmin: r === 'admin' }, href);
  }
  return out;
}

/** 한눈 요약(운영 점검용). 화면에 쓰는 수치가 아니다. */
export function screenAccessStatus(): { policies: number; adminOnly: number; leadOnly: number; defaultLevel: AccessLevel } {
  const vals = Object.values(SCREEN_POLICY);
  return {
    policies: vals.length,
    adminOnly: vals.filter((v) => v === 'admin').length,
    leadOnly: vals.filter((v) => v === 'lead').length,
    defaultLevel: DEFAULT_LEVEL,
  };
}
