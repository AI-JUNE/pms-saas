'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Shell } from '@/components/Shell';
import { Pill } from '@/lib/ui';
import { ArrowLeft, ListTodo, Bug, ShieldAlert, ClipboardList, FileCheck2, Layers3, TrendingUp, Wallet } from 'lucide-react';

const won = (n: number) => '₩' + Number(n || 0).toLocaleString();

export default function Page({ params }: { params: { id: string } }) {
  const router = useRouter();
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    // align global project selector to this project
    try { localStorage.setItem('pms.project', String(params.id)); } catch {}
    fetch(`/api/project-summary?projectId=${params.id}`).then((r) => r.ok ? r.json() : Promise.reject(r)).then(setD).catch(() => setErr('프로젝트를 불러오지 못했습니다'));
  }, [params.id]);

  const p = d?.project;
  const pct = d?.tasks?.avgProgress ?? 0;

  // 헤더 일정 진단 — 종료일 기준 D-day/초과·경과율(읽기 전용, /projects 목록·리포트와 동일 규칙)
  const sched = (() => {
    if (!p?.endDate) return null;
    const end = new Date(p.endDate); if (isNaN(+end)) return null;
    end.setHours(0, 0, 0, 0);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const DAY = 86400000;
    const dleft = Math.round((+end - +today) / DAY);
    const active = String(p.status || '') === 'active';
    let elapsed: number | null = null;
    if (p.startDate) { const start = new Date(p.startDate); if (!isNaN(+start)) { start.setHours(0, 0, 0, 0); const span = +end - +start; if (span > 0) elapsed = Math.max(0, Math.min(100, Math.round(((+today - +start) / span) * 100))); } }
    return { dleft, active, elapsed };
  })();

  const Metric = ({ icon: Icon, label, value, sub, href }: any) => (
    <Link href={href} style={{ textDecoration: 'none' }}>
      <div style={{ background: 'var(--surface-1)', border: '1px solid var(--border)', borderRadius: 14, padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 6, transition: 'box-shadow .15s, transform .15s' }}
        onMouseEnter={(e) => { (e.currentTarget as any).style.boxShadow = 'var(--sh-md)'; (e.currentTarget as any).style.transform = 'translateY(-2px)'; }}
        onMouseLeave={(e) => { (e.currentTarget as any).style.boxShadow = 'none'; (e.currentTarget as any).style.transform = 'none'; }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, color: 'var(--text-3)', fontSize: 12.5, fontWeight: 700 }}><Icon style={{ width: 15, color: 'var(--brand)' }} />{label}</div>
        <div style={{ fontSize: 26, fontWeight: 800, color: 'var(--text-1)', letterSpacing: '-.02em' }}>{value}</div>
        {sub && <div style={{ fontSize: 11.5, color: 'var(--text-4)' }}>{sub}</div>}
      </div>
    </Link>
  );

  return (
    <Shell title={p ? `${p.code} · ${p.name}` : '프로젝트'}>
      <button className="btn btn-ghost btn-sm" onClick={() => router.push('/projects')} style={{ marginBottom: 14 }}><ArrowLeft style={{ width: 15 }} />프로젝트 목록</button>
      {err && <div className="err">{err}</div>}
      {!d && !err && <div className="card card-pad" style={{ display: 'grid', gap: 12 }}>{Array.from({ length: 5 }).map((_, i) => <div key={i} className="skel" style={{ height: i === 0 ? 26 : 18, width: i === 0 ? '34%' : '100%' }} />)}</div>}
      {p && (
        <>
          <div style={{ background: 'linear-gradient(135deg, var(--brand), var(--brand-2, #d97757))', borderRadius: 18, padding: '22px 26px', color: '#fff', marginBottom: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span className="mono" style={{ fontSize: 13, opacity: .85 }}>{p.code}</span>
              <Pill v={p.status} />
            </div>
            <h1 style={{ margin: '8px 0 4px', fontSize: 26, fontWeight: 800, letterSpacing: '-.02em' }}>{p.name}</h1>
            <div style={{ fontSize: 13.5, opacity: .9 }}>{p.client || '고객 미지정'} · {p.startDate || '—'} ~ {p.endDate || '—'}
              {sched && (() => {
                const { dleft, active, elapsed } = sched;
                const tip = `종료 ${p.endDate}${elapsed != null ? ` · 일정 경과 ${elapsed}%` : ''} · ${dleft < 0 ? `${-dleft}일 초과` : dleft === 0 ? '오늘 마감' : `잔여 ${dleft}일 (D-${dleft})`}`;
                let text: string, bg: string, col: string;
                if (dleft < 0 && active) { text = `⚠ ${-dleft}일 초과`; bg = 'rgba(255,255,255,.95)'; col = '#c0414f'; }
                else if (!active) { text = dleft < 0 ? '종료' : dleft === 0 ? '오늘 마감' : `D-${dleft}`; bg = 'rgba(255,255,255,.16)'; col = '#fff'; }
                else if (dleft <= 14) { text = dleft === 0 ? '오늘 마감' : `D-${dleft}`; bg = 'rgba(255,255,255,.95)'; col = '#c9741f'; }
                else { text = `D-${dleft}`; bg = 'rgba(255,255,255,.16)'; col = '#fff'; }
                return <span title={tip} style={{ marginLeft: 8, fontSize: 11.5, fontWeight: 700, padding: '1px 8px', borderRadius: 99, background: bg, color: col, verticalAlign: 1, whiteSpace: 'nowrap' }}>{text}</span>;
              })()}
            </div>
            <div style={{ marginTop: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, fontWeight: 700, marginBottom: 5 }}><span>전체 진척률</span><span>{pct}%</span></div>
              <div style={{ height: 9, background: 'rgba(255,255,255,.28)', borderRadius: 6, overflow: 'hidden' }}>
                <div style={{ width: `${pct}%`, height: '100%', background: '#fff', borderRadius: 6, transition: 'width .6s ease' }} />
              </div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 22 }}>
            <Metric icon={Layers3} label="단계" value={`${d.phases.done}/${d.phases.total}`} sub="완료 / 전체" href="/phases" />
            <Metric icon={ListTodo} label="업무(WBS)" value={`${d.tasks.done}/${d.tasks.total}`} sub={`진행 ${d.tasks.doing} · 평균 ${d.tasks.avgProgress}%`} href="/tasks" />
            <Metric icon={Bug} label="이슈" value={d.issues.open} sub={`전체 ${d.issues.total}건`} href="/issues" />
            <Metric icon={ShieldAlert} label="리스크(High)" value={d.risks.high} sub={`전체 ${d.risks.total}건`} href="/risks" />
            <Metric icon={ClipboardList} label="요구사항" value={`${d.requirements.approved}/${d.requirements.total}`} sub="승인 / 전체" href="/requirements" />
            <Metric icon={FileCheck2} label="산출물" value={`${d.documents.approved}/${d.documents.total}`} sub="승인 / 전체" href="/documents" />
          </div>

          {d.finance && (d.finance.contract > 0 || d.finance.procTotal > 0 || d.finance.billingPct != null) && (
            <div style={{ background: 'var(--surface-1)', border: '1px solid var(--border)', borderRadius: 14, padding: '16px 20px', marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontWeight: 750, fontSize: 14, marginBottom: 12 }}><Wallet style={{ width: 16, color: 'var(--brand)' }} />재무 요약</div>
              <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                <div><div className="muted" style={{ fontSize: 12 }}>계약금액</div><div style={{ fontSize: 22, fontWeight: 800 }}>{d.finance.contract > 0 ? won(d.finance.contract) : '—'}</div></div>
                <div>
                  <div className="muted" style={{ fontSize: 12 }}>기성률{d.finance.snapDate ? ` (${d.finance.snapDate} 기준)` : ''}</div>
                  {(() => { const v = d.finance.billingPct; const c = v == null ? 'var(--text-3)' : v >= 90 ? '#2f8f5b' : v >= 50 ? '#d98a16' : 'var(--text-1)'; return <div style={{ fontSize: 22, fontWeight: 800, color: c }}>{v == null ? '—' : v + '%'}</div>; })()}
                  {d.finance.billingAmount != null && <div style={{ fontSize: 11.5, color: 'var(--text-4)' }}>기성금액 {won(d.finance.billingAmount)}</div>}
                </div>
                <div>
                  <div className="muted" style={{ fontSize: 12 }}>조달총액{d.finance.procCount > 0 ? ` (${d.finance.procCount}건)` : ''}</div>
                  <div style={{ fontSize: 22, fontWeight: 800 }}>{d.finance.procTotal > 0 ? won(d.finance.procTotal) : '—'}</div>
                  {d.finance.procRatio != null && <div style={{ fontSize: 11.5, color: d.finance.procRatio > 100 ? '#c0414f' : 'var(--text-4)' }}>예산 대비 {d.finance.procRatio}%{d.finance.procReceived > 0 ? ` · 입고 ${won(d.finance.procReceived)}` : ''}</div>}
                </div>
              </div>
              {d.finance.contract > 0 && d.finance.billingPct != null && (
                <div style={{ marginTop: 14 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, color: 'var(--text-4)', marginBottom: 5 }}><span>기성 진행</span><span>{d.finance.billingPct}% / 100%</span></div>
                  <div style={{ height: 8, background: 'var(--surface-3)', borderRadius: 6, overflow: 'hidden' }}><div style={{ width: `${Math.max(0, Math.min(100, d.finance.billingPct))}%`, height: '100%', background: 'var(--brand)', borderRadius: 6, transition: 'width .6s ease' }} /></div>
                </div>
              )}
            </div>
          )}
          {d.schedule && (
            <div style={{ background: 'var(--surface-1)', border: '1px solid var(--border)', borderRadius: 14, padding: '16px 20px', marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontWeight: 750, fontSize: 14, marginBottom: 12 }}><TrendingUp style={{ width: 16, color: 'var(--brand)' }} />일정 성과 (SPI)</div>
              <div style={{ display: 'flex', gap: 26, flexWrap: 'wrap', alignItems: 'center' }}>
                <div><div className="muted" style={{ fontSize: 12 }}>계획 진척</div><div style={{ fontSize: 22, fontWeight: 800 }}>{d.schedule.plannedPct}%</div></div>
                <div><div className="muted" style={{ fontSize: 12 }}>실제 진척</div><div style={{ fontSize: 22, fontWeight: 800 }}>{d.schedule.actualPct}%</div></div>
                <div><div className="muted" style={{ fontSize: 12 }}>SPI</div>{(() => { const v = d.schedule.spi; const c = v == null ? 'var(--text-3)' : v >= 1 ? '#2f8f5b' : v >= 0.8 ? '#d98a16' : '#c0414f'; const t = v == null ? '' : v >= 1 ? '일정 준수/선행' : v >= 0.8 ? '경미 지연' : '지연 위험'; return <div style={{ fontSize: 22, fontWeight: 800, color: c }}>{v == null ? '—' : v}<span style={{ fontSize: 12, fontWeight: 700, marginLeft: 6 }}>{t}</span></div>; })()}</div>
              </div>
            </div>
          )}
          {d.evm && (
            <div style={{ background: 'var(--surface-1)', border: '1px solid var(--border)', borderRadius: 14, padding: '16px 20px', marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontWeight: 750, fontSize: 14, marginBottom: 6 }}><TrendingUp style={{ width: 16, color: 'var(--brand)' }} />획득가치 (EVM)</div>
              <div className="muted" style={{ fontSize: 11.5, marginBottom: 12 }}>단위: {d.evm.unit} · BAC {d.evm.bac}{d.evm.unit === '작업' ? ' · AC·CPI는 업무에 공수(계획/실적) 입력 시 표시' : ''}</div>
              <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                <div><div className="muted" style={{ fontSize: 12 }}>PV (계획가치)</div><div style={{ fontSize: 20, fontWeight: 800 }}>{d.evm.pv}</div></div>
                <div><div className="muted" style={{ fontSize: 12 }}>EV (획득가치)</div><div style={{ fontSize: 20, fontWeight: 800 }}>{d.evm.ev}</div></div>
                <div><div className="muted" style={{ fontSize: 12 }}>AC (실제원가)</div><div style={{ fontSize: 20, fontWeight: 800, color: d.evm.ac == null ? 'var(--text-3)' : 'var(--text-1)' }}>{d.evm.ac == null ? '—' : d.evm.ac}</div></div>
                <div><div className="muted" style={{ fontSize: 12 }}>SV (일정차이)</div>{(() => { const v = d.evm.sv; const c = v >= 0 ? '#2f8f5b' : '#c0414f'; return <div style={{ fontSize: 20, fontWeight: 800, color: c }}>{v > 0 ? '+' : ''}{v}</div>; })()}</div>
                <div><div className="muted" style={{ fontSize: 12 }}>SPI</div>{(() => { const v = d.evm.spi; const c = v == null ? 'var(--text-3)' : v >= 1 ? '#2f8f5b' : v >= 0.8 ? '#d98a16' : '#c0414f'; return <div style={{ fontSize: 20, fontWeight: 800, color: c }}>{v == null ? '—' : v}</div>; })()}</div>
                <div><div className="muted" style={{ fontSize: 12 }}>CPI</div>{(() => { const v = d.evm.cpi; const c = v == null ? 'var(--text-3)' : v >= 1 ? '#2f8f5b' : v >= 0.8 ? '#d98a16' : '#c0414f'; return <div style={{ fontSize: 20, fontWeight: 800, color: c }}>{v == null ? '—' : v}</div>; })()}</div>
              </div>
            </div>
          )}
          {d.tests && d.tests.total > 0 && (
            <div style={{ background: 'var(--surface-1)', border: '1px solid var(--border)', borderRadius: 14, padding: '16px 20px', marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontWeight: 750, fontSize: 14, marginBottom: 12 }}><ClipboardList style={{ width: 16, color: 'var(--brand)' }} />테스트 실행 리포트</div>
              <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
                <div><div className="muted" style={{ fontSize: 12 }}>통과율</div>{(() => { const v = d.tests.passRate; const c = v == null ? 'var(--text-3)' : v >= 90 ? '#2f8f5b' : v >= 70 ? '#d98a16' : '#c0414f'; return <div style={{ fontSize: 22, fontWeight: 800, color: c }}>{v == null ? '—' : v + '%'}</div>; })()}</div>
                <div><div className="muted" style={{ fontSize: 12 }}>실행/전체</div><div style={{ fontSize: 22, fontWeight: 800 }}>{d.tests.executed}/{d.tests.total}</div></div>
                <div><div className="muted" style={{ fontSize: 12 }}>통과</div><div style={{ fontSize: 22, fontWeight: 800, color: '#2f8f5b' }}>{d.tests.pass}</div></div>
                <div><div className="muted" style={{ fontSize: 12 }}>실패</div><div style={{ fontSize: 22, fontWeight: 800, color: '#c0414f' }}>{d.tests.fail}</div></div>
                <div><div className="muted" style={{ fontSize: 12 }}>블록</div><div style={{ fontSize: 22, fontWeight: 800, color: '#d98a16' }}>{d.tests.blocked}</div></div>
              </div>
              {(() => { const t = d.tests; const tot = Math.max(1, t.pass + t.fail + t.blocked + t.na); const seg = (n: number, c: string) => n > 0 ? <div key={c} style={{ width: `${(n / tot) * 100}%`, background: c }} /> : null; return <div style={{ display: 'flex', height: 10, width: '100%', borderRadius: 6, overflow: 'hidden', background: 'var(--surface-3)' }}>{seg(t.pass, '#2f8f5b')}{seg(t.fail, '#c0414f')}{seg(t.blocked, '#d98a16')}{seg(t.na, '#cbd5e1')}</div>; })()}
              <div className="muted" style={{ fontSize: 11.5, marginTop: 8 }}>검증 단계 — 개발 {d.tests.byStatus.dev} · PL {d.tests.byStatus.pl} · PM {d.tests.byStatus.pm} · 완료 {d.tests.byStatus.done} · 작성중 {d.tests.byStatus.draft}</div>
            </div>
          )}
          {d.issues?.byPriority && (
            <div style={{ background: 'var(--surface-1)', border: '1px solid var(--border)', borderRadius: 14, padding: '18px 20px', marginBottom: 16 }}>
              <div style={{ fontWeight: 750, fontSize: 14, marginBottom: 14 }}>이슈 · 리스크 분포</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: 24 }}>
                {(() => {
                  const Bar = ({ items, title }: any) => { const mx = Math.max(1, ...items.map((i: any) => i.v)); return (
                    <div><div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>{title}</div>
                      {items.map((i: any) => (<div key={i.l} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 7 }}>
                        <span style={{ width: 62, fontSize: 12, color: 'var(--text-2)' }}>{i.l}</span>
                        <div className="pbar" style={{ flex: 1 }}><i style={{ width: `${(i.v / mx) * 100}%`, background: i.c }} /></div>
                        <span style={{ width: 22, textAlign: 'right', fontWeight: 800, fontSize: 12.5 }}>{i.v}</span>
                      </div>))}
                    </div>); };
                  const bp = d.issues.byPriority, bl = d.risks.byLevel || { high: 0, medium: 0, low: 0 };
                  return <>
                    <Bar title="이슈 우선순위" items={[{ l: 'Critical', v: bp.critical, c: '#c0414f' }, { l: 'High', v: bp.high, c: '#f2772e' }, { l: 'Medium', v: bp.medium, c: '#d98a16' }, { l: 'Low', v: bp.low, c: '#2f8f5b' }]} />
                    <Bar title="리스크 등급" items={[{ l: 'High', v: bl.high, c: '#c0414f' }, { l: 'Medium', v: bl.medium, c: '#d98a16' }, { l: 'Low', v: bl.low, c: '#2f8f5b' }]} />
                  </>;
                })()}
              </div>
            </div>
          )}
          <div style={{ background: 'var(--surface-1)', border: '1px solid var(--border)', borderRadius: 14, padding: '18px 20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontWeight: 750, fontSize: 14, marginBottom: 14 }}><TrendingUp style={{ width: 16, color: 'var(--brand)' }} />단계 진행 현황</div>
            {d.phases.list.length === 0 ? <div className="muted">등록된 단계가 없습니다.</div> : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {d.phases.list.map((ph: any) => (
                  <div key={ph.id} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span className="mono" style={{ fontSize: 12, color: 'var(--text-3)', minWidth: 58 }}>{ph.code}</span>
                    <span style={{ flex: 1, fontWeight: 600 }}>{ph.name}</span>
                    <Pill v={ph.status} />
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </Shell>
  );
}
