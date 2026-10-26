// 앱 화면 경로 **단일 레지스트리** + 경로 정합성 가드 — 순수 모듈(next·DB·env 의존 없음).
//
// 왜 필요한가: 화면 경로 목록이 지금 세 곳에 흩어져 있다.
//   1) src/components/Shell.tsx   NAV               — 사이드바/모바일탭 메뉴
//   2) src/middleware.ts          P                 — 세션 쿠키가 없을 때 /login 으로 보낼 접두사
//   3) src/lib/siteMeta.ts        DISALLOW_PREFIXES — 검색 색인 차단 접두사
// 화면을 새로 만들면서 어느 하나를 빠뜨려도 지금은 아무도 알려주지 않는다.
// (메뉴에만 있고 파일이 없으면 깨진 링크, 색인 차단에서 빠지면 앱 화면이 검색에 노출된다.)
// 이 레지스트리를 정본으로 두고 tests/appRoutes.test.ts 가 **실제 파일 3종 + 페이지 파일 목록**을
// 매번 읽어 대조한다 — 새 드리프트가 생기면 CI 가 실패한다.
//
// 이 모듈은 **판정만** 한다. middleware·Shell·siteMeta 를 대신 고치지 않는다.

/** 화면 한 개. label 은 사용자에게 보이는 한국어 명칭(메뉴 문구와 같은 말). */
export interface AppScreen {
  href: string;
  label: string;
  /** 경로·라벨만으로 안 잡히는 검색 보조어(오타 추천에 쓴다). */
  aliases?: string[];
  /** 'session' = 로그인 뒤 화면, 'public' = 비로그인 공개 페이지. */
  access: 'session' | 'public';
}

/**
 * 로그인 뒤 앱 화면. 실제 page.tsx 파일과 1:1 이어야 한다(동적 세그먼트 `[id]` 제외).
 * 순서는 Shell.tsx NAV 의 그룹 순서를 따른다.
 */
export const APP_SCREENS: AppScreen[] = [
  { href: '/dashboard', label: '대시보드', access: 'session' },
  { href: '/mywork', label: '내 작업', access: 'session' },
  { href: '/todos', label: '내 To-Do', aliases: ['todo', '할일'], access: 'session' },
  { href: '/projects', label: '프로젝트', access: 'session' },
  { href: '/phases', label: '단계', aliases: ['phase'], access: 'session' },
  { href: '/reports', label: '리포트', aliases: ['report', '보고서'], access: 'session' },
  { href: '/weekly', label: '주간보고', access: 'session' },
  { href: '/snapshots', label: '기성고·스냅샷', aliases: ['snapshot'], access: 'session' },
  { href: '/tasks', label: '업무 (WBS)', aliases: ['task', 'wbs'], access: 'session' },
  { href: '/backlog', label: '백로그', access: 'session' },
  { href: '/boards', label: '보드', aliases: ['board', '칸반'], access: 'session' },
  { href: '/requirements', label: '요구사항', aliases: ['requirement'], access: 'session' },
  { href: '/rtm', label: '요구사항 추적(RTM)', access: 'session' },
  { href: '/documents', label: '산출물·결재', aliases: ['document', '문서'], access: 'session' },
  { href: '/form-definitions', label: '산출물 양식', aliases: ['form'], access: 'session' },
  { href: '/issues', label: '이슈·결함', aliases: ['issue', 'bug'], access: 'session' },
  { href: '/tests', label: '테스트', aliases: ['test'], access: 'session' },
  { href: '/test-cycles', label: '테스트 차수', aliases: ['cycle'], access: 'session' },
  { href: '/risks', label: '리스크', aliases: ['risk'], access: 'session' },
  { href: '/meetings', label: '회의', aliases: ['meeting'], access: 'session' },
  { href: '/calendar', label: '캘린더', aliases: ['일정'], access: 'session' },
  { href: '/interfaces', label: '인터페이스', aliases: ['interface'], access: 'session' },
  { href: '/infra', label: '인프라 자산', aliases: ['server'], access: 'session' },
  { href: '/firewall', label: '방화벽', access: 'session' },
  { href: '/procurement', label: '조달', access: 'session' },
  { href: '/members', label: '인력', aliases: ['member', '멤버'], access: 'session' },
  { href: '/workload', label: '업무 부하', aliases: ['load', '리소스'], access: 'session' },
  { href: '/notifications', label: '알림', aliases: ['notification'], access: 'session' },
  // 제안 앱 — public/apps/<key>/index.html 을 AppFrame 이 iframe 으로 띄운다.
  // 페이지 파일은 src/app/apps/<key>/page.tsx 로 1:1 존재한다(동적 세그먼트 아님).
  { href: '/apps/analysis', label: '제안분석', aliases: ['erm', 'analysis', 'rfp', '분석'], access: 'session' },
  { href: '/apps/quality', label: '제안 품질관리', aliases: ['eqm', 'quality', '품질'], access: 'session' },
  { href: '/apps/strategy', label: '제안 전략도출', aliases: ['esm', 'strategy', '전략'], access: 'session' },
  { href: '/apps/performance', label: '고객 성과관리', aliases: ['epm', 'performance', '성과'], access: 'session' },
  { href: '/admin', label: '사용자·권한', aliases: ['admin', '관리자'], access: 'session' },
  { href: '/admin/security', label: '보안 이벤트', aliases: ['security'], access: 'session' },
  { href: '/audit', label: '감사 로그', aliases: ['audit'], access: 'session' },
  { href: '/settings', label: '설정', aliases: ['setting'], access: 'session' },
  { href: '/settings/billing', label: '요금제·결제', aliases: ['billing'], access: 'session' },
];

/** 로그인 없이 볼 수 있는 공개 페이지. siteMeta.PUBLIC_PATHS 와 같아야 한다(테스트가 대조). */
export const PUBLIC_SCREENS: AppScreen[] = [
  { href: '/', label: '홈', access: 'public' },
  { href: '/lp', label: '서비스 소개', access: 'public' },
  { href: '/pricing', label: '요금제', aliases: ['plan', '가격'], access: 'public' },
  { href: '/login', label: '로그인', aliases: ['login', 'signin', '가입'], access: 'public' },
  { href: '/reset-password', label: '비밀번호 재설정', aliases: ['reset', 'password', '비밀번호'], access: 'public' },
  { href: '/terms', label: '이용약관', access: 'public' },
  { href: '/privacy', label: '개인정보 처리방침', access: 'public' },
];

/**
 * 세션 게이트(middleware P)에 아직 들어 있지 않은 화면 — **알려진 미결 사항**.
 * 2026-10-07(배치181, 주간 수동) 누락 16개를 전부 middleware P 에 편입해 **비었다**. 비어 있어야 정상이다 —
 * 새 화면을 만들며 P 에 안 넣으면 테스트가 바로 실패하므로, 임시로 여기에 적어 CI 를 통과시키지 말고 P 에 넣어라.
 * (middleware 는 세션 경계라 야간 자동 개발이 건드리지 않는다 — 주간 수동.)
 */
export const UNGATED_SCREENS_KNOWN: readonly string[] = [] as const;

/** 404 화면에서 추천거리가 없을 때 보여줄 안전한 진입점. */
export const ENTRY_HREFS: readonly string[] = ['/dashboard', '/projects', '/mywork', '/login'] as const;

/** 전체 화면(앱 + 공개). */
export function allScreens(): AppScreen[] {
  return [...APP_SCREENS, ...PUBLIC_SCREENS];
}

/** 쿼리·해시·끝 슬래시를 떼고 비교 가능한 경로로. 경로가 아니면 ''. */
export function normalizePath(raw: unknown): string {
  let s = String(raw ?? '').trim();
  if (!s.startsWith('/')) return '';
  const cut = s.search(/[?#]/);
  if (cut >= 0) s = s.slice(0, cut);
  while (s.length > 1 && s.endsWith('/')) s = s.slice(0, -1);
  return s;
}

/** 화면 조회(정확 일치). */
export function findScreen(href: unknown): AppScreen | null {
  const p = normalizePath(href);
  if (!p) return null;
  return allScreens().find((s) => s.href === p) ?? null;
}

/** 등록된 화면(또는 그 하위 경로)인가. `/projects/12` 처럼 동적 상세도 true. */
export function isKnownScreen(path: unknown): boolean {
  const p = normalizePath(path);
  if (!p) return false;
  return allScreens().some((s) => s.href === p || (s.href !== '/' && p.startsWith(s.href + '/')));
}

/** 화면에 보여줄 안전한 경로 문자열. 지나치게 길면 잘라 준다(쿼리·해시 제거). */
export function displayPath(raw: unknown, max = 64): string {
  const p = normalizePath(raw);
  if (!p) return '';
  return p.length > max ? p.slice(0, max) + '…' : p;
}

/** 레벤슈타인 거리(cap 을 넘으면 cap+1 로 끊는다 — 비교용이라 정확한 큰 값은 필요 없다). */
export function editDistance(a: string, b: string, cap = 3): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      cur.push(v);
      if (v < best) best = v;
    }
    if (best > cap) return cap + 1;
    prev = cur;
  }
  const d = prev[b.length];
  return d > cap ? cap + 1 : d;
}

/** 경로를 비교용 토큰으로. `/test-cycles` → ['test','cycles'] */
function tokensOf(path: string): string[] {
  return path
    .split(/[/\-_.]/)
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
}

function screenTokens(s: AppScreen): string[] {
  return [...tokensOf(s.href), ...(s.aliases ?? []).map((a) => a.toLowerCase()), s.label.toLowerCase()];
}

/**
 * 못 찾은 경로에 가까운 화면 추천(404 화면용).
 * 정확 일치 > 부분 포함 > 오타(편집거리 1~2) 순. 근거가 없으면 **아무것도 추천하지 않는다**.
 */
export function suggestScreens(path: unknown, limit = 4): AppScreen[] {
  const p = normalizePath(path);
  if (!p || p === '/') return [];
  const want = tokensOf(p);
  if (!want.length) return [];
  const scored: Array<{ s: AppScreen; score: number }> = [];
  for (const s of allScreens()) {
    const have = screenTokens(s);
    let score = 0;
    for (const w of want) {
      for (const h of have) {
        if (w === h) { score = Math.max(score, 3); continue; }
        if (w.length >= 3 && (h.includes(w) || w.includes(h))) { score = Math.max(score, 2); continue; }
        if (w.length >= 4 && editDistance(w, h, 2) <= 2) score = Math.max(score, 1);
      }
    }
    if (score > 0) scored.push({ s, score });
  }
  scored.sort((a, b) => (b.score - a.score) || a.s.href.localeCompare(b.s.href));
  return scored.slice(0, Math.max(0, limit)).map((x) => x.s);
}

/** 추천이 없을 때 쓰는 기본 진입점 목록. */
export function entryScreens(): AppScreen[] {
  const all = allScreens();
  return ENTRY_HREFS.map((h) => all.find((s) => s.href === h)).filter((s): s is AppScreen => !!s);
}

// ── 정합성 가드 ────────────────────────────────────────────────────────────

/** middleware.ts 소스에서 세션 게이트 접두사 배열(`const P = [...]`)을 읽어낸다. */
export function parseGatedPrefixes(src: unknown): string[] {
  const s = String(src ?? '');
  const m = /const\s+P\s*=\s*\[([\s\S]*?)\]/.exec(s);
  if (!m) return [];
  return Array.from(m[1].matchAll(/['"`]([^'"`]*)['"`]/g))
    .map((x) => x[1])
    .filter((x) => x.startsWith('/'));
}

/** Shell.tsx 소스에서 메뉴 href 목록을 읽어낸다(중복 제거). */
export function parseNavHrefs(src: unknown): string[] {
  const s = String(src ?? '');
  const out: string[] = [];
  for (const m of s.matchAll(/href:\s*['"]([^'"]+)['"]/g)) {
    const h = normalizePath(m[1]);
    if (h && !out.includes(h)) out.push(h);
  }
  return out;
}

/**
 * 세션 게이트 적용 여부. **middleware 와 같은 규칙(느슨한 startsWith)** 으로 판정한다 —
 * 여기서 더 엄격하게 보면 실제 동작과 어긋난 보고를 하게 된다.
 */
export function isGatedBy(href: string, prefixes: readonly string[]): boolean {
  return prefixes.some((p) => p && href.startsWith(p));
}

/** 세션 게이트 점검: 앱 화면 중 게이트에 안 걸리는 것. */
export function auditSessionGate(prefixes: readonly string[]): { gated: string[]; ungated: string[] } {
  const gated: string[] = [];
  const ungated: string[] = [];
  for (const s of APP_SCREENS) (isGatedBy(s.href, prefixes) ? gated : ungated).push(s.href);
  return { gated, ungated };
}

/** 메뉴 점검: 메뉴에만 있고 등록되지 않은 링크(dead) / 등록됐지만 메뉴에 없는 화면(unlisted). */
export function auditNavTargets(navHrefs: readonly string[]): { dead: string[]; unlisted: string[] } {
  const known = new Set(allScreens().map((s) => s.href));
  const nav = new Set(navHrefs.map((h) => normalizePath(h)).filter(Boolean));
  const dead = [...nav].filter((h) => !known.has(h)).sort();
  const unlisted = APP_SCREENS.filter((s) => !nav.has(s.href)).map((s) => s.href).sort();
  return { dead, unlisted };
}

/** 색인 차단 점검: 앱 화면 중 siteMeta.DISALLOW_PREFIXES 에 안 걸리는 것(검색 노출 위험). */
export function auditIndexBlock(disallowPrefixes: readonly string[]): string[] {
  return APP_SCREENS
    .filter((s) => !disallowPrefixes.some((d) => s.href === d || s.href.startsWith(d.endsWith('/') ? d : d + '/')))
    .map((s) => s.href)
    .sort();
}

/** 파일 점검: 실제 page.tsx 에서 뽑은 경로와 레지스트리를 대조. */
export function auditPageFiles(hrefsFromFiles: readonly string[]): { unregistered: string[]; stale: string[] } {
  const files = new Set(hrefsFromFiles.map((h) => normalizePath(h)).filter(Boolean));
  const known = new Set(allScreens().map((s) => s.href));
  const unregistered = [...files].filter((h) => !known.has(h)).sort();
  const stale = [...known].filter((h) => !files.has(h)).sort();
  return { unregistered, stale };
}

/** 한눈 요약(운영 점검용). 화면에 쓰는 수치가 아니다. */
export function appRoutesStatus(): {
  screens: number;
  publicScreens: number;
  knownUngated: number;
} {
  return {
    screens: APP_SCREENS.length,
    publicScreens: PUBLIC_SCREENS.length,
    knownUngated: UNGATED_SCREENS_KNOWN.length,
  };
}
