'use client';
// 구독 관리 화면(P0-4 과금 화면) — build now, activate on approval.
// 현재 플랜·결제 스캐폴딩 상태를 보여주고, 결제 연동 테스트(실결제 없음)만 제공한다.
// 실PG 결제창·플랜 실변경·실결제는 [승인 필요] 이후에만 활성화된다.
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, CreditCard, ShieldCheck } from 'lucide-react';
import { Shell } from '@/components/Shell';
import CheckoutButton from '@/app/pricing/CheckoutButton';

const PLAN_LABEL: Record<string, string> = { free: '무료', basic: 'Basic', pro: 'Pro', team: '팀', business: '비즈니스', enterprise: 'Enterprise' };

type PlanCard = { id: string; name: string; price: string; unit: string; note: string; desc: string; features: string[]; highlight: boolean };
type SubData = {
  org: { id: number; name: string; plan: string } | null;
  role: string; isOrgAdmin: boolean;
  plans: PlanCard[];
  billing: { live: boolean; provider: string; mode: string; note: string; configured: Record<string, boolean> };
};

export default function Page() {
  const router = useRouter();
  const [d, setD] = useState<SubData | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    fetch('/api/billing/subscription')
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then(setD)
      .catch((s) => (s === 401 ? router.push('/login') : setErr(true)));
  }, [router]);

  if (err) return <Shell title="구독 관리"><div className="empty">구독 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.</div></Shell>;
  if (!d) return <Shell title="구독 관리"><div className="empty">불러오는 중…</div></Shell>;

  const curPlan = d.org?.plan || 'free';
  const configuredCount = Object.values(d.billing?.configured || {}).filter(Boolean).length;

  return (
    <Shell title="구독 관리">
      <h2 className="h1">구독 관리</h2>
      <p className="h-sub">조직의 요금제와 결제 상태를 관리합니다.</p>
      <div style={{ height: 18 }} />

      <div className="card card-pad" style={{ maxWidth: 860 }}>
        <div className="sect" style={{ marginBottom: 14 }}>현재 구독</div>
        <div className="row" style={{ gap: 18, fontSize: 13, flexWrap: 'wrap', alignItems: 'center' }}>
          <span className="muted">조직</span><strong>{d.org?.name || '—'}</strong>
          <span className="muted">현재 플랜</span>
          <span className="pill p-blue np" title={`플랜: ${curPlan}`}>{PLAN_LABEL[curPlan] || curPlan}</span>
          <span className="muted">결제 모드</span>
          <span className={`pill ${d.billing?.live ? 'p-purple' : 'p-gray'} np`} title={d.billing?.note || ''}>
            {d.billing?.live ? '라이브' : '테스트(스캐폴딩)'}
          </span>
        </div>
        <p className="muted" style={{ margin: '12px 0 0', fontSize: 12.5, lineHeight: 1.6 }}>
          <ShieldCheck size={13} style={{ verticalAlign: -2, marginRight: 4 }} />
          현재 실결제는 비활성 상태입니다. 요금제 선택 시 결제 파라미터 발급 흐름만 검증되며 실제 과금은 발생하지 않습니다.
          실PG 결제창 연동·플랜 실변경은 [승인 필요] 이후 활성화됩니다.
        </p>
        {d.isOrgAdmin && (
          <p className="muted" style={{ margin: '6px 0 0', fontSize: 12 }}>
            <CreditCard size={13} style={{ verticalAlign: -2, marginRight: 4 }} />
            결제 채널 설정: {configuredCount}/4 구성됨 (storeId·channelKey·apiSecret·webhookSecret — 환경변수)
          </p>
        )}
      </div>

      <div style={{ height: 14 }} />
      <div className="row" style={{ gap: 14, alignItems: 'stretch', flexWrap: 'wrap' }}>
        {d.plans.map((p) => {
          const isCur = p.id === curPlan;
          return (
            <div key={p.id} className="card card-pad" style={{ flex: '1 1 240px', maxWidth: 300, border: p.highlight ? '1.5px solid var(--brand-600)' : undefined }}>
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
                <div className="sect">{p.name}</div>
                {isCur && <span className="pill p-blue np">현재 플랜</span>}
                {!isCur && p.highlight && <span className="pill p-purple np">추천</span>}
              </div>
              <div style={{ margin: '10px 0 2px', fontSize: 22, fontWeight: 800 }}>
                {p.price}<span className="muted" style={{ fontSize: 12.5, fontWeight: 500 }}> {p.unit}</span>
              </div>
              <p className="muted" style={{ fontSize: 12.5, lineHeight: 1.55, margin: '4px 0 12px' }}>{p.desc}</p>
              <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 14px', fontSize: 12.5, lineHeight: 1.9 }}>
                {p.features.map((f) => (
                  <li key={f}><Check size={13} style={{ verticalAlign: -2, marginRight: 6, color: 'var(--brand-600)' }} />{f}</li>
                ))}
              </ul>
              {isCur ? (
                <div className="muted" style={{ fontSize: 12, padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', textAlign: 'center' }}>
                  사용 중인 플랜입니다
                </div>
              ) : p.id === 'enterprise' ? (
                <div className="muted" style={{ fontSize: 12, padding: '8px 10px', border: '1px dashed var(--border)', borderRadius: 'var(--r-sm)', textAlign: 'center' }}>
                  도입 문의로 진행됩니다
                </div>
              ) : (
                <CheckoutButton planId={p.id} planName={p.name} />
              )}
            </div>
          );
        })}
      </div>

      <p className="muted" style={{ marginTop: 14, fontSize: 12, lineHeight: 1.6, maxWidth: 860 }}>
        결제는 포트원(PortOne) 연동 스캐폴딩으로 준비되어 있으며 현재 테스트 모드로만 동작합니다.
        플랜 변경 반영(웹훅)·환불·영수증은 실PG 연동 승인 후 제공됩니다.
      </p>
    </Shell>
  );
}
