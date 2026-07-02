'use client';
import { useEffect, useState } from 'react';
import { Shell } from '@/components/Shell';
import { Pill } from '@/lib/ui';
import { Network, CheckCircle2, CircleDashed, AlertTriangle } from 'lucide-react';

export default function Page() {
  const [pid, setPid] = useState<number | null>(null);
  const [reqs, setReqs] = useState<any[]>([]);
  const [tasks, setTasks] = useState<any[]>([]);
  const [issues, setIssues] = useState<any[]>([]);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    const p = Number(localStorage.getItem('pms.project')) || null; setPid(p);
    if (!p) { setLoaded(true); return; }
    Promise.all([
      fetch(`/api/requirements?projectId=${p}`).then((r) => r.ok ? r.json() : []),
      fetch(`/api/tasks?projectId=${p}`).then((r) => r.ok ? r.json() : []),
      fetch(`/api/issues?projectId=${p}`).then((r) => r.ok ? r.json() : []),
    ]).then(([rq, tk, is]) => { setReqs(Array.isArray(rq) ? rq : []); setTasks(Array.isArray(tk) ? tk : []); setIssues(Array.isArray(is) ? is : []); setLoaded(true); });
  }, []);

  const rows = reqs.map((rq) => {
    const lt = tasks.filter((t) => t.reqCode && t.reqCode === rq.code);
    const li = issues.filter((i) => i.reqCode && i.reqCode === rq.code);
    const openIss = li.filter((i) => i.status !== 'resolved' && i.status !== 'closed');
    let cov: string, col: string, Icon: any;
    if (lt.length === 0 && li.length === 0) { cov = '미연계'; col = '#94a3b8'; Icon = CircleDashed; }
    else if (openIss.length > 0) { cov = '이슈 있음'; col = '#c0414f'; Icon = AlertTriangle; }
    else if (lt.length > 0 && lt.every((t) => t.status === 'done')) { cov = '충족'; col = '#2f8f5b'; Icon = CheckCircle2; }
    else { cov = '진행중'; col = '#be5535'; Icon = CircleDashed; }
    return { rq, lt, li, cov, col, Icon };
  });
  const covered = rows.filter((r) => r.cov === '충족').length;
  const covPct = reqs.length ? Math.round((covered / reqs.length) * 100) : 0;

  if (loaded && !pid) return <Shell title="요구사항 추적"><div className="card card-pad muted">상단에서 프로젝트를 선택하면 추적 매트릭스가 표시됩니다.</div></Shell>;

  return (
    <Shell title="요구사항 추적(RTM)">
      <div className="row" style={{ marginBottom: 14 }}>
        <div><h2 className="h1">요구사항 추적 매트릭스 <Network style={{ width: 20, verticalAlign: -3, color: 'var(--brand)' }} /></h2>
          <p className="h-sub">요구사항이 업무·이슈로 얼마나 이행되는지 추적합니다. 업무/이슈의 “연계 요구사항”에 요구사항 코드를 입력하면 연결됩니다.</p></div>
        <div className="sp" />
        <div style={{ textAlign: 'right' }}><div className="muted" style={{ fontSize: 12 }}>충족률</div><div style={{ fontSize: 24, fontWeight: 800, color: 'var(--brand)' }}>{covPct}%</div></div>
      </div>
      <div className="card" style={{ overflow: 'hidden' }}>
        <table className="tbl">
          <thead><tr><th>요구사항</th><th>우선순위</th><th>연계 업무</th><th>연계 이슈</th><th>커버리지</th></tr></thead>
          <tbody>
            {!loaded && <tr><td colSpan={5}><div className="muted" style={{ padding: 16 }}>불러오는 중…</div></td></tr>}
            {loaded && rows.length === 0 && <tr><td colSpan={5}><div className="empty" style={{ padding: 24 }}>요구사항이 없습니다.</div></td></tr>}
            {rows.map(({ rq, lt, li, cov, col, Icon }) => (
              <tr key={rq.id}>
                <td><div style={{ display: 'flex', flexDirection: 'column' }}><span style={{ fontWeight: 650 }}>{rq.title}</span><span className="mono" style={{ fontSize: 11, color: 'var(--text-3)' }}>{rq.code}</span></div></td>
                <td><Pill v={rq.priority} /></td>
                <td>{lt.length === 0 ? <span className="muted">—</span> : <span style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>{lt.map((t) => <span key={t.id} title={t.name} className="mono" style={{ fontSize: 10.5, background: t.status === 'done' ? '#e6f4ec' : 'var(--surface-3)', color: t.status === 'done' ? '#2f8f5b' : 'var(--text-2)', padding: '1px 6px', borderRadius: 5 }}>{t.code}</span>)}</span>}</td>
                <td>{li.length === 0 ? <span className="muted">—</span> : <span style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>{li.map((i) => <span key={i.id} title={i.title} className="mono" style={{ fontSize: 10.5, background: '#fdf3e7', color: '#b5730f', padding: '1px 6px', borderRadius: 5 }}>{i.code}</span>)}</span>}</td>
                <td><span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontWeight: 700, fontSize: 12, color: col }}><Icon style={{ width: 14 }} />{cov}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Shell>
  );
}
