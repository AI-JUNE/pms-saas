'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Shell } from '@/components/Shell';
import { Pill } from '@/lib/ui';
import { ArrowLeft, ListTodo, Bug, ShieldAlert, ClipboardList, FileCheck2, Layers3, TrendingUp } from 'lucide-react';

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
      {!d && !err && <div className="muted" style={{ padding: 20 }}>불러오는 중…</div>}
      {p && (
        <>
          <div style={{ background: 'linear-gradient(135deg, var(--brand), var(--brand-2, #d97757))', borderRadius: 18, padding: '22px 26px', color: '#fff', marginBottom: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span className="mono" style={{ fontSize: 13, opacity: .85 }}>{p.code}</span>
              <Pill v={p.status} />
            </div>
            <h1 style={{ margin: '8px 0 4px', fontSize: 26, fontWeight: 800, letterSpacing: '-.02em' }}>{p.name}</h1>
            <div style={{ fontSize: 13.5, opacity: .9 }}>{p.client || '고객 미지정'} · {p.startDate || '—'} ~ {p.endDate || '—'}</div>
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
