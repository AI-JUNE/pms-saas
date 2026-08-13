import type { MetadataRoute } from 'next';
import { buildRobotsRules, resolveSiteUrl } from '@/lib/siteMeta';

// 색인 정책: 공개 마케팅/법적고지 페이지만 허용, 인증 뒤 앱 화면과 모든 API 는 차단.
// production 이 아닌 환경(프리뷰/스테이징)은 전면 차단한다.
export default function robots(): MetadataRoute.Robots {
  const site = resolveSiteUrl(process.env as Record<string, string | undefined>);
  const rules = buildRobotsRules(process.env as Record<string, string | undefined>);
  return {
    rules: [{ userAgent: rules.userAgent, allow: rules.allow, disallow: rules.disallow }],
    sitemap: `${site}/sitemap.xml`,
    host: site,
  };
}
