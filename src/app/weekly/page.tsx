'use client';
import { useEffect, useState } from 'react';
import { Shell } from '@/components/Shell';
import { Pill } from '@/lib/ui';
import { Printer, CheckCircle2, Clock, AlertTriangle, Bug, ShieldAlert, CalendarRange } from 'lucide-react';

function weekRange() {
  const now = new Date(); const day = (now.getDay() + 6) % 7; // Mon=0
  const mon = new Date(now); mon.setDate(now.getDate() - day); mon.setHours(0, 0, 0, 0);
  const sun = new Date(mon); sun.setDate(mon.getDate() + 6); sun.setHours(23, 59, 59, 999);
  return { mon, sun };
}
const ymd = (d: Date) => `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;

export default function Page() {
  const [pid, setPid] = useState<number | null>(null);
  const [proj, setProj] = useState<any>(null);
  const [sum, setSum] = useState<any>(null);
  const [tasks, setTasks] = useState<any[]>([]);
  const [issues, setIssues] = useState<any[]>([]);
  const [risks, setRisks] = useState<any[]>([]);
  useEffect(() => {
    const p = Number(localStorage.getItem('pms.project')) || null; setPid(p);
    if (!p) return;
    fetch(`/api/project-summary?projectId=${p}`).then((r) => r.ok ? r.json() : null).then((d) => { setSum(d); setProj(d?.project); });
    fetch(`/api/tasks?projectId=${p}`).then((r) => r.ok ? r.json() : []).then((d) => setTasks(Array.isArray(d) ? d : []));
    fetch(`/api/issues?projectId=${p}`).then((r) => r.ok ? r.json() : []).then((d) => setIssues(Array.isArray(d) ? d : []));
    fetch(`/api/risks?projectId=${p}`).then((r) => r.ok ? r.json() : []).then((d) => setRisks(Array.isArray(d) ? d : []));
  }, []);

  const { mon, sun } = weekRange();
  const today = new Date(); today.setHours(23, 59, 59, 999);
  const inWeek = (s?: string) => { if (!s) return false; const t = new Date(s).getTime(); return t >= mon.getTime() && t <= sun.getTime(); };
  const done = tasks.filter((t) => t.status === 'done');
  const doing = tasks.filter((t) => t.status === 'doing');
  const upcoming = tasks.filter((t) => t.status !== 'done' && t.endDate && new Date(t.endDate).getTime() >= today.getTime());
  const overdue = tasks.filter((t) => t.status !== 'done' && t.endDate && new Date(t.endDate).getTime() < Date.now());
  const openIssues = issues.filter((i) => i.status !== 'resolved' && i.status !== 'closed');
  const highRisks = risks.filter((r) => r.level === 'high');
  const pct = sum?.tasks?.avgProgress ?? 0;

  if (!pid) return <Shell title="주간보고"><div className="card card-pad muted">상단에서 프로젝트를 선택하면 주간보고가 생성됩니다.</div></Shell>;

  const Block = ({ icon: Icon, title, color, items, render }: any) => (
    <div className="card" style={{ overflow: 'hidden', marginBottom: 16 }}>
      <div className="row" style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 750, fontSize: 13.5 }}><Icon style={{ width: 15, color }} />{title}</div>
        <span className="muted" style={{ marginLeft: 8, fontSize: 12 }}>{items.length}건</span>
      </div>
      <div style={{ padding: items.length ? '6px 8px' : 16 }}>
        {items.length === 0 ? <div className="muted" style={{ fontSize: 13 }}>해당 항목 없음</div> :
          items.map((r: any, i: number) => <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 8px', borderBottom: i < items.length - 1 ? '1px solid var(--surface-2)' : 'none' }}>{render(r)}</div>)}
      </div>
    </div>
  );

  return (
    <Shell title="주간보고">
      <div className="row" style={{ marginBottom: 14 }}>
        <div><h2 className="h1">주간 업무보고</h2><p className="h-sub">{proj ? `${proj.code} · ${proj.name}` : ''} · {ymd(mon)} ~ {ymd(sun)}</p></div>
        <div className="sp" /><button className="btn no-print" onClick={() => window.print()}><Printer style={{ width: 15 }} />인쇄 / PDF</button>
      </div>

      <div style={{ background: 'linear-gradient(135deg, var(--brand), #d97757)', borderRadius: 16, padding: '18px 22px', color: '#fff', marginBottom: 18 }}>
        <div style={{ display: 'flex', gap: 26, flexWrap: 'wrap' }}>
          <div><div style={{ fontSize: 12, opacity: .85 }}>전체 진척률</div><div style={{ fontSize: 26, fontWeight: 800 }}>{pct}%</div></div>
          <div><div style={{ fontSize: 12, opacity: .85 }}>완료 업무</div><div style={{ fontSize: 26, fontWeight: 800 }}>{done.length}<span style={{ fontSize: 15, opacity: .8 }}>/{tasks.length}</span></div></div>
          <div><div style={{ fontSize: 12, opacity: .85 }}>진행중</div><div style={{ fontSize: 26, fontWeight: 800 }}>{doing.length}</div></div>
          <div><div style={{ fontSize: 12, opacity: .85 }}>미결 이슈</div><div style={{ fontSize: 26, fontWeight: 800 }}>{openIssues.length}</div></div>
          <div><div style={{ fontSize: 12, opacity: .85 }}>High 리스크</div><div style={{ fontSize: 26, fontWeight: 800 }}>{highRisks.length}</div></div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
        <div>
          <Block icon={CheckCircle2} title="이번 주 완료" color="#2f8f5b" items={done} render={(r: any) => (<><span className="mono" style={{ fontSize: 11.5, color: 'var(--text-3)', minWidth: 66 }}>{r.code}</span><span style={{ flex: 1, fontSize: 13 }}>{r.name}</span><span className="muted" style={{ fontSize: 11.5 }}>{r.assignee || ''}</span></>)} />
          <Block icon={Clock} title="진행중 / 다음 주 예정" color="#be5535" items={[...doing, ...upcoming.filter((u) => u.status !== 'doing')]} render={(r: any) => (<><span className="mono" style={{ fontSize: 11.5, color: 'var(--text-3)', minWidth: 66 }}>{r.code}</span><span style={{ flex: 1, fontSize: 13 }}>{r.name}</span><span style={{ fontSize: 11.5, fontWeight: 700 }}>{r.progress || 0}%</span><span className="muted" style={{ fontSize: 11 }}>{r.endDate || ''}</span></>)} />
        </div>
        <div>
          <Block icon={AlertTriangle} title="지연 업무 (마감 초과)" color="#c0414f" items={overdue} render={(r: any) => (<><span className="mono" style={{ fontSize: 11.5, color: 'var(--text-3)', minWidth: 66 }}>{r.code}</span><span style={{ flex: 1, fontSize: 13 }}>{r.name}</span><span style={{ fontSize: 11, color: '#c0414f', fontWeight: 700 }}>{r.endDate}</span></>)} />
          <Block icon={Bug} title="미결 이슈" color="#d98a16" items={openIssues} render={(r: any) => (<><span className="mono" style={{ fontSize: 11.5, color: 'var(--text-3)', minWidth: 66 }}>{r.code}</span><span style={{ flex: 1, fontSize: 13 }}>{r.title}</span><Pill v={r.priority} /></>)} />
          <Block icon={ShieldAlert} title="주요 리스크 (High)" color="#c0414f" items={highRisks} render={(r: any) => (<><span className="mono" style={{ fontSize: 11.5, color: 'var(--text-3)', minWidth: 66 }}>{r.code}</span><span style={{ flex: 1, fontSize: 13 }}>{r.title}</span><span className="muted" style={{ fontSize: 11.5 }}>{r.owner || ''}</span></>)} />
        </div>
      </div>
    </Shell>
  );
}
