// 공개 사이트 메타 순수 모듈 — next/DB 의존 없음(단위테스트 가능)
// 목적: 상용 오픈 시 "공개 마케팅 페이지만 색인, 로그인 뒤 앱/ API 는 전면 색인 차단".
// 주의: 여기서 결정하는 것은 색인(robots/sitemap) 뿐이며, 접근 제어는 middleware/requireUser 가 담당한다.

/** 검색 색인을 허용하는 공개 경로(마케팅·법적고지). 이 목록에 없으면 색인 대상이 아니다. */
export const PUBLIC_PATHS = ['/', '/lp', '/pricing', '/terms', '/privacy', '/login'] as const;

/** 색인/크롤 금지 경로 접두사. 인증 뒤 앱 화면 + 모든 API + 관리자. */
export const DISALLOW_PREFIXES = [
  '/api/',
  '/admin',
  '/dashboard',
  '/projects',
  '/phases',
  '/members',
  '/requirements',
  '/rtm',
  '/issues',
  '/risks',
  '/tasks',
  '/backlog',
  '/documents',
  '/interfaces',
  '/infra',
  '/firewall',
  '/procurement',
  '/boards',
  '/meetings',
  '/notifications',
  '/settings',
  '/reports',
  '/weekly',
  '/mywork',
  '/todos',
  '/calendar',
  '/tests',
  '/test-cycles',
  '/snapshots',
  '/audit',
  '/form-definitions',
] as const;

/** sitemap 우선순위/갱신주기(공개 경로만). 목록에 없으면 기본값 사용. */
const SITEMAP_HINTS: Record<string, { priority: number; changeFrequency: 'daily' | 'weekly' | 'monthly' | 'yearly' }> = {
  '/': { priority: 1.0, changeFrequency: 'weekly' },
  '/lp': { priority: 0.9, changeFrequency: 'weekly' },
  '/pricing': { priority: 0.8, changeFrequency: 'monthly' },
  '/terms': { priority: 0.3, changeFrequency: 'yearly' },
  '/privacy': { priority: 0.3, changeFrequency: 'yearly' },
  '/login': { priority: 0.2, changeFrequency: 'yearly' },
};

const DEFAULT_SITE_URL = 'https://pms.example.com';

/** 끝 슬래시 제거 + 스킴 보정. 잘못된 값이면 null. */
function normalizeOrigin(raw: unknown): string | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  const withScheme = /^https?:\/\//i.test(s) ? s : `https://${s}`;
  try {
    const u = new URL(withScheme);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    // 호스트명은 도메인 문자만 허용(오타/깨진 env 가 그대로 canonical 로 새어나가는 것을 막는다).
    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i.test(u.hostname)) return null;
    // localhost 는 형식상 유효(개발). 색인은 buildRobotsRules 의 production 게이트가 막는다.
    return u.origin;
  } catch {
    return null;
  }
}

/**
 * 사이트 정본 URL 결정.
 * 우선순위: SITE_URL → NEXT_PUBLIC_SITE_URL → VERCEL_PROJECT_PRODUCTION_URL → VERCEL_URL → 기본값.
 * (미주입 상태에서도 빌드가 깨지지 않도록 항상 유효한 origin 을 반환한다.)
 */
export function resolveSiteUrl(env: Record<string, string | undefined> = {}): string {
  const candidates = [
    env.SITE_URL,
    env.NEXT_PUBLIC_SITE_URL,
    env.VERCEL_PROJECT_PRODUCTION_URL,
    env.VERCEL_URL,
  ];
  for (const c of candidates) {
    const o = normalizeOrigin(c);
    if (o) return o;
  }
  return DEFAULT_SITE_URL;
}

/** 해당 경로가 색인 허용 대상인지. 공개 목록에 정확히 있고 금지 접두사에 걸리지 않아야 한다. */
export function isIndexablePath(pathname: unknown): boolean {
  const p = String(pathname ?? '').trim();
  if (!p.startsWith('/')) return false;
  const clean = p.length > 1 && p.endsWith('/') ? p.slice(0, -1) : p;
  if (DISALLOW_PREFIXES.some((d) => clean === d || clean.startsWith(d + '/') || (d.endsWith('/') && clean.startsWith(d)))) return false;
  return (PUBLIC_PATHS as readonly string[]).includes(clean);
}

/** robots.txt 규칙(단일 그룹). 프리뷰/스테이징이면 전면 차단. */
export function buildRobotsRules(env: Record<string, string | undefined> = {}): {
  userAgent: string;
  allow: string[];
  disallow: string[];
} {
  const isProd = String(env.VERCEL_ENV ?? env.NODE_ENV ?? '').toLowerCase() === 'production';
  if (!isProd) return { userAgent: '*', allow: [], disallow: ['/'] };
  return {
    userAgent: '*',
    allow: [...PUBLIC_PATHS],
    disallow: [...DISALLOW_PREFIXES],
  };
}

/** sitemap 엔트리(공개 경로만, 절대 URL). */
export function buildSitemapEntries(
  siteUrl: string,
  lastModified: Date = new Date(),
): Array<{ url: string; lastModified: Date; changeFrequency: 'daily' | 'weekly' | 'monthly' | 'yearly'; priority: number }> {
  const base = normalizeOrigin(siteUrl) ?? DEFAULT_SITE_URL;
  return PUBLIC_PATHS.filter(isIndexablePath).map((p) => {
    const hint = SITEMAP_HINTS[p] ?? { priority: 0.5, changeFrequency: 'monthly' as const };
    return {
      url: p === '/' ? base + '/' : base + p,
      lastModified,
      changeFrequency: hint.changeFrequency,
      priority: hint.priority,
    };
  });
}
