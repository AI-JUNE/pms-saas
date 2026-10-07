// 서버 레이아웃 — 역할 등급(lib/screenAccess) 을 서버에서 확인한다. 세션이 없으면 /login, 등급 미달이면 403 화면.
import { ScreenGate } from '@/components/ScreenGate';
export const dynamic = 'force-dynamic';
export default function Layout({ children }: { children: React.ReactNode }) {
  return <ScreenGate href="/settings/billing">{children}</ScreenGate>;
}
