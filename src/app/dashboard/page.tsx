'use client';
import Link from 'next/link';
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

function shade(hex: string, amt: number) {
  const h = hex.replace('#',''); const f = h.length===3 ? h.split('').map((c)=>c+c).join('') : h; const n = parseInt(f,16);
  let r=(n>>16)&255,g=(n>>8)&255,b=n&255;
  r=Math.max(0,Math.min(255,Math.round(r*(1+amt)))); g=Math.max(0,Math.min(255,Math.round(g*(1+amt)))); b=Math.max(0,Math.min(255,Math.round(b*(1+amt))));
  return '#'+((1<<24)+(r<<16)+(g<<8)+b).toString(16).slice(1);
}
function Donut({ data, mounted }: { data: { label: string; value: number; color: string }[]; mounted: boolean }) {
  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  let acc = 0; const R = 56, C = 2 * Math.PI * R;
  return (
    <div className="row donut-wrap" style={{ gap: 24, alignItems: 'center' }}>
      <svg className="donut-svg" width="150" height="150" viewBox="0 0 150 150" style={{ filter: 'drop-shadow(0 6px 14px rgba(0,0,0,.08))' }}>
        <defs>{data.map((d, i) => (<linearGradient key={i} id={`dseg${i}`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor={shade(d.color, 0.16)} /><stop offset="1" stopColor={shade(d.color, -0.12)} /></linearGradient>))}</defs>
        <circle cx="75" cy="75" r={R} fill="none" stroke="var(--surface-3)" strokeWidth="16" />
        {data.map((d, i) => { const len = (d.value / total) * C; const target = C - acc; acc += len;
          return <circle key={i} className="donut-seg" cx="75" cy="75" r={R} fill="none" stroke={`url(#dseg${i})`} strokeWidth="16"
            strokeDasharray={`${Math.max(0, len - 3)} ${C - Math.max(0, len - 3)}`} strokeDashoffset={mounted ? target : C} transform="rotate(-90 75 75)" strokeLinecap="round"
            style={{ transitionDelay: `${i * 130}ms` }} />; })}
        <text x="75" y="71" textAnchor="middle" fontSize="30" fontWeight="800" fill="var(--text-1)">{total}</text>
        <text x="75" y="89" textAnchor="middle" fontSize="10.5" fill="var(--text-3)" fontWeight="600">전체</text>
      </svg>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, flex: 1, minWidth: 0 }}>
        {data.map((d, i) => { const pv = Math.round((d.value / total) * 100); return (
          <div key={i} className="row" style={{ gap: 9, fontSize: 12.5 }}>
            <span style={{ width: 11, height: 11, borderRadius: 4, background: d.color, boxShadow: `0 0 0 3px ${d.color}22`, flexShrink: 0 }} />
            <span style={{ color: 'var(--text-2)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.label}</span>
            <span style={{ marginLeft: 'auto', fontWeight: 800 }}>{d.value}</span>
            <span className="muted" style={{ minWidth: 36, textAlign: 'right', fontSize: 11.5 }}>{pv}%</span>
          </div>); })}
      </div>
    </div>
  );
}
function Bars({ data, mounted }: { data: { label: string; value: number; color: string }[]; mounted: boolean }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (<div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>{data.map((d, i) => (
    <div key={i}><div className="row" style={{ fontSize: 12.5, marginBottom: 6 }}><span style={{ fontWeight: 600, color: 'var(--text-2)' }}>{d.label}</span>
      <span style={{ marginLeft: 'auto', fontWeight: 800, background: `${d.color}18`, color: shade(d.color, -0.15), padding: '1px 9px', borderRadius: 20, fontSize: 11.5 }}>{d.value}</span></div>
      <div className="pbar"><i style={{ width: mounted ? `${(d.value / max) * 100}%` : '0%', background: `linear-gradient(90deg, ${shade(d.color, 0.14)}, ${d.color})`, transitionDelay: `${i * 110}ms` }} /></div></div>))}</div>);
}
const cnt = (a: any[], k: string, v: string) => a.filter((x) => x[k] === v).length;

export default function Dashboard() {
  const router = useRouter();
  const [me, setMe] = useState<any>(null);
  const [mounted, setMounted] = useState(false);
  const [busy, setBusy] = useState(false);
  async function fillDemo() { setBusy(true); const r = await fetch('/api/admin/seed-demo', { method: 'POST' }); if (r.ok) location.reload(); else setBusy(false); }
  const [d, setD] = useState<any>({ projects: [], requirements: [], issues: [], risks: [], tasks: [] });
  const [mywork, setMywork] = useState<any>({ tasks: [], issues: [], risks: [] });
  const [docs, setDocs] = useState<any[]>([]);
  useEffect(() => {
    fetch('/api/auth/me').then((r) => r.json()).then(async (m) => {
      if (!m.authenticated) { router.push('/login'); return; } setMe(m);
      const a = await fetch('/api/dashboard').then((r) => r.ok ? r.json() : null);
      if (a) { setD({ projects: a.projects||[], requirements: a.requirements||[], issues: a.issues||[], risks: a.risks||[], tasks: a.tasks||[] }); setDocs(Array.isArray(a.documents) ? a.documents : []); setMywork(a.myWork || { tasks: [], issues: [] }); }
      const lg = Number(localStorage.getItem('pms.gen') || 0);
      if (Date.now() - lg > 3600000) { localStorage.setItem('pms.gen', String(Date.now())); fetch('/api/notifications/generate', { method: 'POST' }).catch(() => {}); }
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
        <div className="card card-pad dash-card" style={{ animationDelay: '300ms' }}><div className="sect" style={{ marginBottom: 16 }}>이슈 유형(트래커)</div>
          <Bars mounted={mounted} data={[{ label: '결함', value: cnt(issues,'type','bug'), color: '#c0414f' },{ label: '기능개선', value: cnt(issues,'type','improvement'), color: '#0e9bb8' },{ label: '태스크', value: cnt(issues,'type','task'), color: '#7c4dff' },{ label: '지원', value: cnt(issues,'type','support'), color: '#d98a16' },{ label: '변경요청', value: cnt(issues,'type','change'), color: '#8b5cf6' }]} /></div>
      </div>
      <div style={{ height: 16 }} />
      <div className="g2">
        <div className="card card-pad dash-card" style={{ animationDelay: '260ms' }}>
          <div className="row" style={{ marginBottom: 12 }}><div className="sect">내 작업</div><div className="sp" /><Link href="/mywork" className="muted" style={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4 }}>모두 보기 <ArrowRight style={{ width: 14 }} /></Link></div>
          {(() => {
            const myOpenTasks = (mywork.tasks || []).filter((t: any) => t.status !== 'done');
            const myOpenIssues = (mywork.issues || []).filter((i: any) => !['resolved','closed'].includes(i.status));
            const items = [...myOpenTasks.map((t: any) => ({ ...t, _t: 'task' })), ...myOpenIssues.map((i: any) => ({ ...i, _t: 'issue' }))];
            if (items.length === 0) return <p className="muted" style={{ fontSize: 13 }}>나에게 배정된 미완료 항목이 없습니다.</p>;
            return <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{items.slice(0, 6).map((it: any) => (
              <div key={it._t + it.id} onClick={() => router.push(it._t === 'task' ? '/tasks' : '/issues')} style={{ display: 'flex', alignItems: 'center', gap: 9, cursor: 'pointer' }}>
                <span className="mono" style={{ fontSize: 11, color: 'var(--text-3)', minWidth: 64 }}>{it.code}</span>
                <span style={{ flex: 1, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.name || it.title}</span>
                <Pill v={it.status} />
              </div>))}
              {items.length > 6 && <div className="muted" style={{ fontSize: 12 }}>외 {items.length - 6}건</div>}</div>;
          })()}
        </div>
        <div className="card card-pad dash-card" style={{ animationDelay: '320ms' }}>
          <div className="sect" style={{ marginBottom: 12 }}>마감 임박 · 결재 대기</div>
          {(() => {
            const now = new Date(); const t0 = new Date(now); t0.setHours(0,0,0,0); const in7 = new Date(t0.getTime() + 7 * 86400000);
            const overdue = tasks.filter((t: any) => t.status !== 'done' && t.endDate && new Date(t.endDate) < t0);
            const soon = tasks.filter((t: any) => t.status !== 'done' && t.endDate && new Date(t.endDate) >= t0 && new Date(t.endDate) <= in7);
            const pending = docs.filter((x: any) => x.status === 'review');
            const rows: any[] = [
              ...overdue.map((t: any) => ({ k: 't'+t.id, label: t.name, code: t.code, tag: '마감초과', col: '#c0414f', sub: t.endDate, href: '/tasks' })),
              ...soon.map((t: any) => ({ k: 's'+t.id, label: t.name, code: t.code, tag: 'D-'+Math.max(0, Math.round((new Date(t.endDate).getTime()-t0.getTime())/86400000)), col: '#d98a16', sub: t.endDate, href: '/tasks' })),
              ...pending.map((x: any) => ({ k: 'd'+x.id, label: x.title, code: x.code, tag: '결재대기', col: '#0e9bb8', sub: x.approver||'', href: '/documents' })),
            ];
            if (rows.length === 0) return <p className="muted" style={{ fontSize: 13 }}>마감 임박·결재 대기 항목이 없습니다.</p>;
            return <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{rows.slice(0, 7).map((r: any) => (
              <div key={r.k} onClick={() => router.push(r.href)} style={{ display: 'flex', alignItems: 'center', gap: 9, cursor: 'pointer' }}>
                <span style={{ fontSize: 10.5, fontWeight: 800, color: '#fff', background: r.col, padding: '1px 7px', borderRadius: 20, minWidth: 52, textAlign: 'center' }}>{r.tag}</span>
                <span className="mono" style={{ fontSize: 11, color: 'var(--text-3)', minWidth: 64 }}>{r.code}</span>
                <span style={{ flex: 1, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.label}</span>
                <span className="muted" style={{ fontSize: 11 }}>{r.sub}</span>
              </div>))}
              {rows.length > 7 && <div className="muted" style={{ fontSize: 12 }}>외 {rows.length - 7}건</div>}</div>;
          })()}
        </div>
      </div>
      <div style={{ height: 16 }} />
      <div className="card card-pad dash-card" style={{ animationDelay: '360ms' }}>
        <div className="row" style={{ marginBottom: 14 }}><div className="sect">최근 프로젝트</div><div className="sp" /><Link href="/projects" className="muted" style={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4 }}>전체 보기 <ArrowRight style={{ width: 14 }} /></Link></div>
        {projects.length === 0 ? <p className="muted">프로젝트가 없습니다. <Link href="/projects" style={{ color: 'var(--brand)' }}>만들기 →</Link></p>
          : <div className="tbl-wrap"><table className="tbl"><thead><tr><th>코드</th><th>이름</th><th>고객</th><th>기간</th><th>상태</th></tr></thead>
            <tbody>{projects.slice(0, 6).map((p: any) => <tr key={p.id} onClick={() => router.push('/projects')}><td className="mono">{p.code}</td><td style={{ fontWeight: 650 }}>{p.name}</td><td>{p.client || '—'}</td><td className="muted">{p.startDate || '—'} ~ {p.endDate || '—'}</td><td><Pill v={p.status} /></td></tr>)}</tbody></table></div>}
      </div>
    </Shell>
  );
}
