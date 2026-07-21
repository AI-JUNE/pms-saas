import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: '요금제 — PMS',
  description: '팀 규모에 맞춘 3단계 요금제. 5인까지 무료로 시작하고, 성과관리(EVM)·RTM·전자결재·테스트까지 하나로.',
};

type Tier = {
  name: string;
  price: string;
  unit?: string;
  note: string;
  desc: string;
  features: string[];
  cta: string;
  href: string;
  highlight?: boolean;
};

const TIERS: Tier[] = [
  {
    name: 'Basic',
    price: '₩9,900',
    unit: '/ 사용자 · 월',
    note: '소규모 팀 시작용',
    desc: '프로젝트·WBS·이슈/리스크·간트 기본으로 팀 협업을 시작하세요.',
    features: ['프로젝트·단계·WBS', '이슈/결함·리스크', '기본 간트·칸반·캘린더', '멤버·권한(RBAC)', '5인까지 무료 체험'],
    cta: '무료로 시작',
    href: '/dashboard',
  },
  {
    name: 'Pro',
    price: '₩16,900',
    unit: '/ 사용자 · 월',
    note: '가장 많이 선택',
    desc: '성과관리(EVM)·요구사항 추적·전자결재·테스트까지 실무 전부.',
    features: [
      'Basic 전체 포함',
      'EVM 성과관리(SPI·CPI·PV·EV·AC)',
      '요구사항 추적(RTM)·산출물 전자결재',
      '테스트 관리·실행 리포트',
      '인터랙티브 간트(베이스라인·임계경로·의존성)',
      '대시보드 집계·주간보고·⌘K 전역검색',
    ],
    cta: '무료로 시작',
    href: '/dashboard',
    highlight: true,
  },
  {
    name: 'Enterprise',
    price: '견적',
    note: '기관·대기업·공공',
    desc: '보안·규정·전용 인프라가 필요한 조직을 위한 맞춤 도입.',
    features: [
      'Pro 전체 포함',
      'SSO·상세 감사로그·데이터 접근 통제',
      '전용 DB·전용 리전·온프레미스 옵션',
      '전담 지원·SLA·교육',
      '공공 조달(GS인증·CSAP) 대응',
    ],
    cta: '도입 문의',
    href: '/login?manual=1',
  },
];

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
      </section>

      {/* 요금제 3단계 */}
      <section style={{ maxWidth: 1080, margin: '0 auto', padding: '28px 22px 24px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 20, alignItems: 'stretch' }}>
        {TIERS.map((t) => (
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
        </div>
      </section>
    </div>
  );
}
