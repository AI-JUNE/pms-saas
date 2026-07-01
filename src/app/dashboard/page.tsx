'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FolderKanban, ClipboardList, Bug, ShieldAlert, ListTodo, TrendingUp, ArrowRight } from 'lucide-react';
import { Shell } from '@/components/Shell';
import { Pill } from '@/lib/ui';

function useCountUp(target: number, ms = 900) {
  const [v, setV] = useState(0);
  useEffect(() => {
    let raf = 0; const t0 = performance.now();
    const tick = (t: number) => { const p = Math.min(1, (t - t0) / ms); setV(Math.round(target * (1 - Math.pow(1 - p, 3)))); if (p < 1) raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick); return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}
function Num({ n, suffix = '' }: { n: number; suffix?: string }) { return <span className="countup">{useCountUp(n)}{suffix}</span>; }

function Donut({ data, mounted }: { data: { label: string; value: number; color: string }[]; mounted: boolean }) {
  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  let acc = 0; const R = 54, C = 2 * Math.PI * R;
  return (
    <div className="row" style={{ gap: 22 }}>
      <svg width="138" height="138" viewBox="0 0 138 138">
        <circle cx="69" cy="69" r={R} fill="none" stroke="var(--surface-3)" strokeWidth="15" />
        {data.map((d, i) => { const len = (d.value / total) * C; const target = C - acc; acc += len;
          return <circle key={i} className="donut-seg" cx="69" cy="69" r={R} fill="none" stroke={d.color} strokeWidth="15"
            strokeDasharray={`${len} ${C - len}`} strokeDashoffset={mounted ? target : C} transform="rotate(-90 69 69)" strokeLinecap="butt"
            style={{ transitionDelay: `${i * 120}ms` }} />; })}
        <text x="69" y="64" textAnchor="middle" fontSize="26" fontWeight="800" fill="var(--text-1)">{total}</text>
        <text x="69" y="82" textAnchor="middle" fontSize="10" fill="var(--text-3)">전체</text>
      </svg>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {data.map((d, i) => <div key={i} className="row" style={{ gap: 8, fontSize: 12.5 }}><span style={{ width: 10, height: 10, borderRadius: 3, background: d.color }} /><span style={{ color: 'var(--text-2)', fontWeight: 600 }}>{d.label}</span><span style={{ marginLeft: 'auto', fontWeight: 800 }}>{d.value}</span></div>)}
      </div>
    </div>
  );
}
function Bars({ data, mounted }: { data: { label: string; value: number; color: string }[]; mounted: boolean }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (<div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>{data.map((d, i) => (
    <div key={i}><div className="row" style={{ fontSize: 12.5, marginBottom: 5 }}><span style={{ fontWeight: 600, color: 'var(--text-2)' }}>{d.label}</span><span style={{ marginLeft: 'auto', fontWeight: 800 }}>{d.value}</span></div>
      <div className="bar" style={{ height: 10 }}><i className="gbar" style={{ width: mounted ? `${(d.value / max) * 100}%` : '0%', background: d.color, transitionDelay: `${i * 100}ms` }} /></div></div>))}</div>);
}
const cnt = (a: any[], k: string, v: string) => a.filter((x) => x[k] === v).length;

export default function Dashboard() {
  const router = useRouter();
  const [me, setMe] = useState<any>(null);
  const [mounted, setMounted] = useState(false);
  const [busy, setBusy] = useState(false);
  async function fillDemo() { setBusy(true); const r = await fetch('/api/admin/seed-demo', { method: 'POST' }); if (r.ok) location.reload(); else setBusy(false); }
  const [d, setD] = useState<any>({ projects: [], requirements: [], issues: [], risks: [], tasks: [] });
  useEffect(() => {
    fetch('/api/auth/me').then((r) => r.json()).then(async (m) => {
      if (!m.authenticated) { router.push('/login'); return; } setMe(m);
      const [projects, requirements, issues, risks, tasks] = await Promise.all(['projects','requirements','issues','risks','tasks'].map((e) => fetch('/api/' + e).then((r) => r.ok ? r.json() : [])));
      setD({ projects: projects||[], requirements: requirements||[], issues: issues||[], risks: risks||[], tasks: tasks||[] });
      requestAnimationFrame(() => setMounted(true));
    });
  }, [router]);
  if (!me) return <Shell title="대시보드"><div className="kpis">{Array.from({length:6}).map((_,i)=><div className="kpi" key={i}><div className="skel" style={{height:64}}/></div>)}</div></Shell>;
  const { projects, requirements, issues, risks, tasks } = d;
  const openIssues = issues.filter((x: any) => !['resolved','closed'].includes(x.status));
  const avgProg = tasks.length ? Math.round(tasks.reduce((s: number, t: any) => s + (t.progress || 0), 0) / tasks.length) : 0;
  const kpis = [
    { label: '프로젝트', n: projects.length, sub: `진행 ${cnt(projects,'status','active')}`, icon: FolderKanban, c: '#be5535', bg: '#fbeeea' },
    { label: '요구사항', n: requirements.length, sub: `승인 ${cnt(requirements,'status','approved')}`, icon: ClipboardList, c: '#0e9bb8', bg: '#e6f7fb' },
    { label: '열린 이슈', n: openIssues.length, sub: `전체 ${issues.length}`, icon: Bug, c: '#d98a16', bg: '#fdf3e3' },
    { label: '리스크', n: risks.length, sub: `High ${risks.filter((x:any)=>x.level==='high').length}`, icon: ShieldAlert, c: '#c0414f', bg: '#fdedef' },
    { label: '업무', n: tasks.length, sub: `완료 ${cnt(tasks,'status','done')}`, icon: ListTodo, c: '#7c4dff', bg: '#f1ecff' },
    { label: '평균 진척', n: avgProg, suffix: '%', sub: 'WBS', icon: TrendingUp, c: '#2f8f5b', bg: '#e9faf0' },
  ];
  return (
    <Shell title="대시보드">
      <div className="hero"><h2>안녕하세요, {me.user?.name} 님 👋</h2><p>조직 전체 현황을 한눈에 확인하세요 · {new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })}</p></div>
      {projects.length === 0 && me?.org?.isOrgAdmin && (
        <div className="card card-pad dash-card" style={{ marginTop: 14, borderColor: 'var(--brand-100)', background: 'var(--brand-50)' }}>
          <div className="row" style={{ gap: 14, flexWrap: 'wrap' }}>
            <div><div style={{ fontWeight: 800, fontSize: 15, color: 'var(--brand-700)' }}>데모 데이터로 시작하기</div>
              <p className="muted" style={{ margin: '4px 0 0' }}>샘플 프로젝트·요구사항·이슈·리스크·업무·스프린트·인프라·방화벽·조달·게시판을 한 번에 채워 모든 화면을 둘러보세요.</p></div>
            <div className="sp" />
            <button className="btn btn-pri" onClick={fillDemo} disabled={busy}>{busy ? '생성 중…' : '데모 데이터 채우기'}</button>
          </div>
        </div>
      )}
      <div style={{ height: 16 }} />
      <div className="kpis">
        {kpis.map((k, i) => { const Icon = k.icon; return (
          <div className={`kpi k${i}`} key={i} style={{ animationDelay: `${i * 70}ms` }}>
            <div className="kpi-ic" style={{ background: k.bg, color: k.c }}><Icon style={{ width: 18, height: 18 }} /></div>
            <div className="kpi-label">{k.label}</div>
            <div className="kpi-value" style={{ color: k.c }}><Num n={k.n} suffix={k.suffix} /></div>
            <div className="kpi-sub">{k.sub}</div>
          </div>
        ); })}
      </div>
      <div style={{ height: 18 }} />
      <div className="g3">
        <div className="card card-pad dash-card" style={{ animationDelay: '120ms' }}><div className="sect" style={{ marginBottom: 16 }}>이슈 상태</div>
          <Donut mounted={mounted} data={[{ label: '열림', value: cnt(issues,'status','open'), color: '#be5535' },{ label: '진행중', value: cnt(issues,'status','in_progress'), color: '#d98a16' },{ label: '해결', value: cnt(issues,'status','resolved'), color: '#2f8f5b' },{ label: '종료', value: cnt(issues,'status','closed'), color: '#94a3b8' }]} /></div>
        <div className="card card-pad dash-card" style={{ animationDelay: '180ms' }}><div className="sect" style={{ marginBottom: 16 }}>업무 진척</div>
          <Bars mounted={mounted} data={[{ label: '할 일', value: cnt(tasks,'status','todo'), color: '#94a3b8' },{ label: '진행중', value: cnt(tasks,'status','doing'), color: '#be5535' },{ label: '완료', value: cnt(tasks,'status','done'), color: '#2f8f5b' }]} /></div>
        <div className="card card-pad dash-card" style={{ animationDelay: '240ms' }}><div className="sect" style={{ marginBottom: 16 }}>리스크 등급</div>
          <Bars mounted={mounted} data={[{ label: 'High', value: cnt(risks,'level','high'), color: '#c0414f' },{ label: 'Medium', value: cnt(risks,'level','medium'), color: '#d98a16' },{ label: 'Low', value: cnt(risks,'level','low'), color: '#2f8f5b' }]} /></div>
      </div>
      <div style={{ height: 16 }} />
      <div className="card card-pad dash-card" style={{ animationDelay: '300ms' }}>
        <div className="row" style={{ marginBottom: 14 }}><div className="sect">최근 프로젝트</div><div className="sp" /><a href="/projects" className="muted" style={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4 }}>전체 보기 <ArrowRight style={{ width: 14 }} /></a></div>
        {projects.length === 0 ? <p className="muted">프로젝트가 없습니다. <a href="/projects" style={{ color: 'var(--brand)' }}>만들기 →</a></p>
          : <div className="tbl-wrap"><table className="tbl"><thead><tr><th>코드</th><th>이름</th><th>고객</th><th>기간</th><th>상태</th></tr></thead>
            <tbody>{projects.slice(0, 6).map((p: any) => <tr key={p.id} onClick={() => router.push('/projects')}><td className="mono">{p.code}</td><td style={{ fontWeight: 650 }}>{p.name}</td><td>{p.client || '—'}</td><td className="muted">{p.startDate || '—'} ~ {p.endDate || '—'}</td><td><Pill v={p.status} /></td></tr>)}</tbody></table></div>}
      </div>
    </Shell>
  );
}
