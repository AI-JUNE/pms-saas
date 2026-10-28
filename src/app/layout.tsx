import './globals.css';
import type { Metadata } from 'next';
import { resolveSiteUrl } from '@/lib/siteMeta';

// metadataBase 가 있어야 OG/canonical 이 절대 URL 로 생성된다(미주입 시 안전한 기본값).
const SITE_URL = resolveSiteUrl(process.env as Record<string, string | undefined>);
const IS_PROD = String(process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? '').toLowerCase() === 'production';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: 'GOWON 프로젝트 허브 — 프로젝트 관리·제안 업무 통합',
  description: 'Modern multi-tenant project management.',
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
    title: 'GOWON 프로젝트 허브 — 프로젝트 관리·제안 업무 통합',
    description: '프로젝트·요구사항·이슈·산출물·결재를 한 곳에서. 멀티테넌트 프로젝트 관리 시스템.',
  },
  twitter: { card: 'summary_large_image', title: 'GOWON 프로젝트 허브 — 프로젝트 관리·제안 업무 통합', description: '프로젝트 관리와 제안 업무를 한곳에서.' },
};
export const viewport = { width: 'device-width', initialScale: 1, maximumScale: 5 };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (<html lang="ko"><body>{children}</body></html>);
}
