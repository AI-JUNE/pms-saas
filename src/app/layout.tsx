import './globals.css';
import type { Metadata } from 'next';
import { resolveSiteUrl } from '@/lib/siteMeta';

// metadataBase 가 있어야 OG/canonical 이 절대 URL 로 생성된다(미주입 시 안전한 기본값).
const SITE_URL = resolveSiteUrl(process.env as Record<string, string | undefined>);
const IS_PROD = String(process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? '').toLowerCase() === 'production';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: 'GOWON 프로젝트 허브 — 제안부터 수행, 고객 성과까지 하나의 기준으로',
  description: '제안요청서 분석, 전략 수립, 제안서 작성, 품질 검토, 사업 수행, 고객 성과 관리를 한 허브에서. WBS와 일정표, 획득가치 성과지표, 요구사항 추적표, 전자결재를 함께 제공합니다.',
  applicationName: 'GOWON 프로젝트 허브',
  // 프리뷰/스테이징은 색인 금지. 개별 페이지 metadata 로 덮어쓸 수 있다.
  robots: IS_PROD
    ? { index: true, follow: true }
    : { index: false, follow: false, nocache: true },
  openGraph: {
    type: 'website',
    siteName: 'GOWON 프로젝트 허브',
    locale: 'ko_KR',
    url: SITE_URL,
    title: 'GOWON 프로젝트 허브 — 제안부터 수행, 고객 성과까지 하나의 기준으로',
    description: '제안요청서 분석, 전략 수립, 제안서 작성, 품질 검토, 사업 수행, 고객 성과 관리를 한 허브에서. WBS와 일정표, 획득가치 성과지표, 요구사항 추적표, 전자결재를 함께 제공합니다.',
  },
  twitter: { card: 'summary_large_image', title: 'GOWON 프로젝트 허브 — 제안부터 수행, 고객 성과까지 하나의 기준으로', description: '제안요청서 분석, 전략 수립, 제안서 작성, 품질 검토, 사업 수행, 고객 성과 관리를 한 허브에서. WBS와 일정표, 획득가치 성과지표, 요구사항 추적표, 전자결재를 함께 제공합니다.' },
};
export const viewport = { width: 'device-width', initialScale: 1, maximumScale: 5 };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (<html lang="ko"><body>{children}</body></html>);
}
