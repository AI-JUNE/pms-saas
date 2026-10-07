// 서버 컴포넌트 — 관리 화면 레이아웃에서 세션·역할을 **서버에서** 확인한다(lib/screenAccess 정책).
// 'use client' 를 붙이지 않는다: 세션 쿠키·멤버십 조회는 서버에서만 가능하다.
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { screenDecision, type ScreenDecision } from '@/lib/screenAccess';
import { Forbidden } from './Forbidden';

export async function ScreenGate({ href, children }: { href: string; children: React.ReactNode }) {
  let user: Awaited<ReturnType<typeof getCurrentUser>> = null;
  try {
    user = await getCurrentUser();
  } catch (e) {
    // 세션 조회 자체가 실패(DB 장애 등)하면 여기서 화면을 막지 않는다 — 데이터는 API 가 같은 정책으로 403 을 내고,
    // Shell 이 /api/auth/me 로 클라이언트 리다이렉트를 수행한다. 장애를 권한 오류로 둔갑시키지 않는다.
    console.error('[ScreenGate] 세션 조회 실패', String((e as any)?.message || e));
    return <>{children}</>;
  }
  if (!user) redirect('/login');
  let tenant: Awaited<ReturnType<typeof requireTenant>> | null = null;
  try { tenant = await requireTenant(user); } catch { tenant = null; }
  const d: ScreenDecision = screenDecision(
    { role: tenant?.role ?? null, isOrgAdmin: tenant?.isOrgAdmin ?? false, isSuperadmin: user.isSuperadmin },
    href,
  );
  if (!d.allowed) return <Forbidden decision={d} />;
  return <>{children}</>;
}
