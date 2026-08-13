import type { MetadataRoute } from 'next';
import { buildSitemapEntries, resolveSiteUrl } from '@/lib/siteMeta';

// 공개 경로만 노출한다(테넌트 데이터·인증 뒤 화면은 절대 포함하지 않음).
export default function sitemap(): MetadataRoute.Sitemap {
  const site = resolveSiteUrl(process.env as Record<string, string | undefined>);
  return buildSitemapEntries(site);
}
