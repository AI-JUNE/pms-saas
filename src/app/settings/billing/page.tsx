'use client';
// 구독 관리 화면(P0-4 과금 화면) — build now, activate on approval.
// 현재 플랜·결제 스캐폴딩 상태를 보여주고, 결제 연동 테스트(실결제 없음)만 제공한다.
// 실PG 결제창·플랜 실변경·실결제는 [승인 필요] 이후에만 활성화된다.
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, CreditCard, ShieldCheck, CalendarClock, Undo2, XCircle } from 'lucide-react';
import { Shell } from '@/components/Shell';
import CheckoutButton from '@/app/pricing/CheckoutButton';

const PLAN_LABEL: Record<string, string> = { free: '무료', basic: 'Basic', pro: 'Pro', team: '팀', business: '비즈니스', enterprise: 'Enterprise' };

type PlanCard = { id: string; name: string; price: string; unit: string; note: string; desc: string; features: string[]; highlight: boolean };
type SubData = {
  org: { id: number; name: string; plan: string } | null;
  role: string; isOrgAdmin: boolean;
  plans: PlanCard[];
  billing: { live: boolean; provider: string; mode: string; note: string; configured: Record<string, boolean> };
  entitlements?: {
    plan: string; enforced: boolean;
    seats: { used: number; limit: number | null; remaining: number | null; exceeded: boolean; canAddOne: boolean };
    features: { id: string; label: string; minPlan: string; enabled: boolean }[];
  };
};

// 구독 수명주기 조작 결과(스캐폴딩). 실행되는 것은 아무것도 없고 "무엇이 일어날지"만 보여준다.
type ManageResult = {
  action: string;
  blocked?: string;
  subscription?: { planName: string; seats: number; unitPrice: number | null; amount: number | null; autoBillable: boolean; nextChargeAt: string | null };
  issueId?: string;
  cancellation?: { mode: string; effectiveAt: string; refundExpected: boolean; note: string } | null;
  quote?: { amount: number; periodDays: number; usedDays: number; remainDays: number; refund: number } | { error: string };
  nextChargeAt?: string | null;
  note?: string;
  message?: string;
};

const won = (n: number | null | undefined) => (typeof n === 'number' ? `₩${n.toLocaleString('ko-KR')}` : '—');

export default function Page() {
  const router = useRouter();
  const [d, setD] = useState<SubData | null>(null);
  const [err, setErr] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [res, setRes] = useState<ManageResult | null>(null);

  async function manage(action: string, extra: Record<string, unknown> = {}) {
    setBusy(action); setRes(null);
    try {
      const r = await fetch('/api/billing/manage', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, ...extra }),
      });
      setRes(await r.json());
    } catch {
      setRes({ action, message: '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.' });
    } finally {
      setBusy(null);
    }
  }

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

      {d.entitlements && (
        <>
          <div style={{ height: 14 }} />
          <div className="card card-pad" style={{ maxWidth: 860 }}>
            <div className="sect" style={{ marginBottom: 6 }}>플랜 이용 범위</div>
            <p className="muted" style={{ fontSize: 12.5, lineHeight: 1.6, margin: '0 0 12px' }}>
              현재 플랜에서 사용 가능한 기능과 좌석 사용량입니다.
              {d.entitlements.enforced
                ? ' 제한이 적용 중입니다.'
                : ' 현재는 안내만 표시되며 실제 기능 차단은 하지 않습니다(강제 적용은 [승인 필요]).'}
            </p>
            <div className="row" style={{ gap: 18, fontSize: 13, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
              <span className="muted">좌석</span>
              <strong>
                {d.entitlements.seats.used}
                {d.entitlements.seats.limit === null ? ' / 무제한' : ` / ${d.entitlements.seats.limit}`}
              </strong>
              {d.entitlements.seats.limit !== null && (
                <span className={`pill ${d.entitlements.seats.canAddOne ? 'p-gray' : 'p-red'} np`}>
                  {d.entitlements.seats.exceeded ? '한도 초과' : d.entitlements.seats.canAddOne ? `잔여 ${d.entitlements.seats.remaining}석` : '한도 도달'}
                </span>
              )}
            </div>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 6 }}>
              {d.entitlements.features.map((f) => (
                <li key={f.id} className="row" style={{ gap: 8, fontSize: 12.5, alignItems: 'center' }}>
                  {f.enabled
                    ? <Check size={14} aria-hidden style={{ color: 'var(--ok, #2f855a)' }} />
                    : <XCircle size={14} aria-hidden className="muted" />}
                  <span className={f.enabled ? '' : 'muted'}>{f.label}</span>
                  {!f.enabled && <span className="pill p-gray np">{PLAN_LABEL[f.minPlan] || f.minPlan} 이상</span>}
                </li>
              ))}
            </ul>
          </div>
        </>
      )}

      {d.isOrgAdmin && (
        <>
          <div style={{ height: 14 }} />
          <div className="card card-pad" style={{ maxWidth: 860 }}>
            <div className="sect" style={{ marginBottom: 6 }}>결제수단·정기청구 관리</div>
            <p className="muted" style={{ fontSize: 12.5, lineHeight: 1.6, margin: '0 0 12px' }}>
              결제수단(빌링키) 등록·해제, 구독 해지, 환불 견적을 확인합니다.
              테스트 모드에서는 <strong>실제 카드 등록·과금·해지·환불이 발생하지 않으며</strong>, 무엇이 일어날지만 계산해 보여줍니다. [승인 필요]
            </p>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <button className="btn" disabled={!!busy} onClick={() => manage('issue_billing_key', { planId: curPlan })}>
                <CreditCard size={13} style={{ verticalAlign: -2, marginRight: 5 }} />
                {busy === 'issue_billing_key' ? '요청 중…' : '결제수단 등록'}
              </button>
              <button className="btn" disabled={!!busy} onClick={() => manage('delete_billing_key')}>
                <XCircle size={13} style={{ verticalAlign: -2, marginRight: 5 }} />결제수단 해제
              </button>
              <button className="btn" disabled={!!busy} onClick={() => manage('cancel', { mode: 'period_end' })}>
                <CalendarClock size={13} style={{ verticalAlign: -2, marginRight: 5 }} />주기 종료 시 해지
              </button>
              <button className="btn" disabled={!!busy} onClick={() => manage('cancel', { mode: 'immediate' })}>
                즉시 해지(환불 동반)
              </button>
              <button className="btn" disabled={!!busy} onClick={() => manage('resume')}>
                <Undo2 size={13} style={{ verticalAlign: -2, marginRight: 5 }} />해지 예약 취소
              </button>
              <button className="btn" disabled={!!busy} onClick={() => manage('refund')}>환불 견적</button>
            </div>

            {res && (
              <div style={{ marginTop: 14, border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', padding: '12px 14px', fontSize: 12.5, lineHeight: 1.8 }}>
                {res.message && <div style={{ color: 'var(--brand-600)' }}>{res.message}</div>}
                {res.subscription && (
                  <div className="row" style={{ gap: 16, flexWrap: 'wrap' }}>
                    <span className="muted">플랜</span><strong>{res.subscription.planName}</strong>
                    <span className="muted">좌석</span><strong>{res.subscription.seats}</strong>
                    <span className="muted">월 청구액</span><strong>{res.subscription.autoBillable ? won(res.subscription.amount) : '자동청구 대상 아님'}</strong>
                    <span className="muted">다음 청구일</span><strong>{res.subscription.nextChargeAt || '—'}</strong>
                  </div>
                )}
                {res.issueId && <div><span className="muted">발급 요청 번호</span> <code>{res.issueId}</code></div>}
                {res.cancellation && (
                  <div>
                    <span className="muted">해지 방식</span> <strong>{res.cancellation.mode === 'immediate' ? '즉시' : '주기 종료 시'}</strong>{' · '}
                    <span className="muted">서비스 종료 예정일</span> <strong>{res.cancellation.effectiveAt}</strong>
                    <div className="muted">{res.cancellation.note}</div>
                  </div>
                )}
                {res.quote && ('error' in res.quote ? (
                  <div className="muted">환불 견적을 계산할 수 없습니다({res.quote.error}).</div>
                ) : (
                  <div>
                    <span className="muted">결제액</span> <strong>{won(res.quote.amount)}</strong>{' · '}
                    <span className="muted">사용</span> {res.quote.usedDays}일{' / '}
                    <span className="muted">잔여</span> {res.quote.remainDays}일{' (총 '}{res.quote.periodDays}일){' · '}
                    <span className="muted">환불 예정액</span> <strong>{won(res.quote.refund)}</strong>
                  </div>
                ))}
                {res.note && <div className="muted" style={{ marginTop: 4 }}>{res.note}</div>}
              </div>
            )}
          </div>
        </>
      )}

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
