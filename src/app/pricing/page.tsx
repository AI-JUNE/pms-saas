import type { Metadata } from 'next';
import Link from 'next/link';
import { PLANS, PAYMENTS_LIVE } from '@/lib/billing';

export const metadata: Metadata = {
  title: '요금제 — PMS',
  description: '팀 규모에 맞춘 3단계 요금제. 5인까지 무료로 시작하고, 성과관리(EVM)·RTM·전자결재·테스트까지 하나로.',
};

export default function PricingPage() {
  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--text-1)', fontFamily: 'var(--font)' }}>
      {/* 상단 바 */}
      <header style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '16px 22px', borderBottom: '1px solid var(--border)', background: 'var(--surface)', position: 'sticky', top: 0, zIndex: 20 }}>
        <Link href="/" style={{ fontWeight: 800, fontSize: 18, letterSpacing: '-.03em', color: 'var(--text-1)' }}>PMS</Link>
        <span style={{ fontSize: 9.5, color: 'var(--text-3)', letterSpacing: '.12em', fontWeight: 700, textTransform: 'uppercase' }}>Project Management</span>
        <div style={{ flex: 1 }} />
        <Link href="/login?manual=1" style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text-2)', padding: '8px 14px' }}>로그인</Link>
        <Link href="/dashboard" style={{ fontSize: 13.5, fontWeight: 700, color: '#fff', background: 'var(--brand)', padding: '9px 16px', borderRadius: 'var(--r-sm)' }}>데모 둘러보기</Link>
      </header>

      {/* 히어로 */}
      <section style={{ maxWidth: 1080, margin: '0 auto', padding: '64px 22px 8px', textAlign: 'center' }}>
        <div style={{ display: 'inline-block', fontSize: 12, fontWeight: 800, letterSpacing: '.06em', color: 'var(--brand-600)', background: 'var(--brand-50)', padding: '6px 13px', borderRadius: 999, textTransform: 'uppercase' }}>Pricing</div>
        <h1 style={{ fontSize: 'clamp(30px,4.4vw,46px)', fontWeight: 800, letterSpacing: '-.03em', lineHeight: 1.18, margin: '16px 0 12px' }}>
          팀 규모에 맞춰, <span style={{ color: 'var(--brand)' }}>쉽고 간편하게</span>
        </h1>
        <p style={{ fontSize: 16.5, color: 'var(--text-2)', maxWidth: 560, margin: '0 auto', lineHeight: 1.6 }}>
          5인까지 무료로 시작하세요. 계획·WBS부터 성과관리(EVM)·전자결재·테스트까지 하나의 플랫폼에서.
        </p>
        <div style={{ fontSize: 12.5, color: 'var(--text-3)', marginTop: 14 }}>연간 결제 기준 · 부가세 별도 · 월간 결제는 약 20% 높음</div>
        {!PAYMENTS_LIVE && (<div style={{ display: 'inline-block', marginTop: 12, fontSize: 12, fontWeight: 700, color: 'var(--amber)', background: 'var(--amber-50)', border: '1px solid #f0d9a8', padding: '6px 12px', borderRadius: 999 }}>결제 준비 중 · 지금은 무료 데모로 이용하세요</div>)}
      </section>

      {/* 요금제 3단계 */}
      <section style={{ maxWidth: 1080, margin: '0 auto', padding: '28px 22px 24px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 20, alignItems: 'stretch' }}>
        {PLANS.map((t) => (
          <div
            key={t.name}
            style={{
              position: 'relative', display: 'flex', flexDirection: 'column',
              background: 'var(--surface)', borderRadius: 'var(--r-lg)', padding: '26px 24px',
              border: t.highlight ? '2px solid var(--brand)' : '1px solid var(--border)',
              boxShadow: t.highlight ? 'var(--sh-md)' : 'var(--sh-sm)',
            }}
          >
            {t.highlight && (
              <div style={{ position: 'absolute', top: -12, left: 24, fontSize: 11, fontWeight: 800, color: '#fff', background: 'var(--brand)', padding: '4px 11px', borderRadius: 999 }}>{t.note}</div>
            )}
            <div style={{ fontSize: 18, fontWeight: 800 }}>{t.name}</div>
            {!t.highlight && <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 3 }}>{t.note}</div>}
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, margin: '14px 0 4px' }}>
              <span style={{ fontSize: 34, fontWeight: 800, letterSpacing: '-.03em' }}>{t.price}</span>
              {t.unit && <span style={{ fontSize: 13, color: 'var(--text-3)', fontWeight: 600 }}>{t.unit}</span>}
            </div>
            <p style={{ fontSize: 13.5, color: 'var(--text-2)', lineHeight: 1.55, margin: '6px 0 16px', minHeight: 40 }}>{t.desc}</p>
            <Link
              href={t.href}
              style={{
                display: 'block', textAlign: 'center', fontSize: 14, fontWeight: 700, padding: '12px', borderRadius: 'var(--r-sm)',
                color: t.highlight ? '#fff' : 'var(--brand-600)',
                background: t.highlight ? 'var(--brand)' : 'var(--brand-50)',
                marginBottom: 18,
              }}
            >
              {t.cta}
            </Link>
            <ul style={{ listStyle: 'none', display: 'grid', gap: 9, margin: 0, padding: 0 }}>
              {t.features.map((f) => (
                <li key={f} style={{ display: 'flex', gap: 9, fontSize: 13.3, color: 'var(--text-2)', lineHeight: 1.5 }}>
                  <span style={{ color: 'var(--brand)', fontWeight: 800, flex: 'none' }}>✓</span>
                  <span>{f}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>

      {/* 안내 */}
      <section style={{ maxWidth: 760, margin: '0 auto', padding: '18px 22px 72px' }}>
        <div style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--r)', padding: '18px 20px', fontSize: 13, color: 'var(--text-2)', lineHeight: 1.6 }}>
          <b style={{ color: 'var(--text-1)' }}>도입 안내</b> · 연간 약정 시 할인, 공공기관은 디지털서비스 전문계약(수의계약)·나라장터 조달로 도입 가능합니다.
          결제·플랜 세부는 도입 문의로 안내드리며, 지금은 <b>무료 데모</b>로 전체 기능을 바로 체험하실 수 있습니다.
          <div style={{ marginTop: 10, fontSize: 12.5 }}><Link href="/terms" style={{ color: 'var(--brand-600)', fontWeight: 700 }}>이용약관</Link> · <Link href="/privacy" style={{ color: 'var(--brand-600)', fontWeight: 700 }}>개인정보 처리방침</Link></div>
        </div>
      </section>
    </div>
  );
}
