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
  const [testsArr, setTestsArr] = useState<any[]>([]);
  const [loaded, setLoaded] = useState(false);
  // 커버리지 상태별 필터(요약 칩 클릭) — 클라이언트 표시 전용
  const [filter, setFilter] = useState<'all' | 'covered' | 'progress' | 'problem' | 'unlinked'>('all');
  useEffect(() => {
    const p = Number(localStorage.getItem('pms.project')) || null; setPid(p);
    if (!p) { setLoaded(true); return; }
    Promise.all([
      fetch(`/api/requirements?projectId=${p}`).then((r) => r.ok ? r.json() : []),
      fetch(`/api/tasks?projectId=${p}`).then((r) => r.ok ? r.json() : []),
      fetch(`/api/issues?projectId=${p}`).then((r) => r.ok ? r.json() : []),
      fetch(`/api/tests?projectId=${p}`).then((r) => r.ok ? r.json() : []),
    ]).then(([rq, tk, is, ts]) => { setReqs(Array.isArray(rq) ? rq : []); setTasks(Array.isArray(tk) ? tk : []); setIssues(Array.isArray(is) ? is : []); setTestsArr(Array.isArray(ts) ? ts : []); setLoaded(true); });
  }, []);

  const rows = reqs.map((rq) => {
    const lt = tasks.filter((t) => t.reqCode && t.reqCode === rq.code);
    const li = issues.filter((i) => i.reqCode && i.reqCode === rq.code);
    const ltest = testsArr.filter((t) => t.reqCode && t.reqCode === rq.code);
    const openIss = li.filter((i) => i.status !== 'resolved' && i.status !== 'closed');
    const testFail = ltest.some((t) => t.result === 'fail');
    const anyLink = lt.length || li.length || ltest.length;
    let cov: string, col: string, Icon: any, bucket: 'covered' | 'progress' | 'problem' | 'unlinked';
    if (!anyLink) { cov = '미연계'; col = '#94a3b8'; Icon = CircleDashed; bucket = 'unlinked'; }
    else if (openIss.length > 0 || testFail) { cov = testFail ? '테스트 실패' : '이슈 있음'; col = '#c0414f'; Icon = AlertTriangle; bucket = 'problem'; }
    else if ((lt.length === 0 || lt.every((t) => t.status === 'done')) && (ltest.length === 0 || ltest.every((t) => t.result === 'pass'))) { cov = '충족'; col = '#2f8f5b'; Icon = CheckCircle2; bucket = 'covered'; }
    else { cov = '진행중'; col = '#be5535'; Icon = CircleDashed; bucket = 'progress'; }
    return { rq, lt, li, ltest, cov, col, Icon, bucket };
  });
  const covered = rows.filter((r) => r.bucket === 'covered').length;
  const covPct = reqs.length ? Math.round((covered / reqs.length) * 100) : 0;

  // 커버리지 상태 분포 — 요약 칩 겸 필터. '문제'는 이슈 있음+테스트 실패를 합산해 즉시 대응 대상을 부각
  const dist = {
    covered,
    progress: rows.filter((r) => r.bucket === 'progress').length,
    problem: rows.filter((r) => r.bucket === 'problem').length,
    unlinked: rows.filter((r) => r.bucket === 'unlinked').length,
  };
  const CHIPS: { key: 'all' | 'covered' | 'progress' | 'problem' | 'unlinked'; label: string; n: number; color: string; tip: string }[] = [
    { key: 'all', label: '전체', n: rows.length, color: 'var(--text-2)', tip: '모든 요구사항 표시' },
    { key: 'covered', label: '충족', n: dist.covered, color: '#2f8f5b', tip: '연계 업무·테스트가 모두 완료/통과되고 미해결 이슈가 없는 요구사항' },
    { key: 'progress', label: '진행중', n: dist.progress, color: '#be5535', tip: '연계는 있으나 아직 완료·통과되지 않은 요구사항' },
    { key: 'problem', label: '이슈·실패', n: dist.problem, color: '#c0414f', tip: '미해결 이슈가 있거나 연계 테스트가 실패한 요구사항 — 즉시 대응 대상' },
    { key: 'unlinked', label: '미연계', n: dist.unlinked, color: '#94a3b8', tip: '연계된 업무·이슈·테스트가 하나도 없는 요구사항 — 추적 사각지대' },
  ];
  const visibleRows = filter === 'all' ? rows : rows.filter((r) => r.bucket === filter);

  if (loaded && !pid) return <Shell title="요구사항 추적"><div className="card card-pad muted">상단에서 프로젝트를 선택하면 추적 매트릭스가 표시됩니다.</div></Shell>;

  return (
    <Shell title="요구사항 추적(RTM)">
      <div className="row" style={{ marginBottom: 14 }}>
        <div><h2 className="h1">요구사항 추적 매트릭스 <Network style={{ width: 20, verticalAlign: -3, color: 'var(--brand)' }} /></h2>
          <p className="h-sub">요구사항이 업무·이슈로 얼마나 이행되는지 추적합니다. 업무/이슈의 “연계 요구사항”에 요구사항 코드를 입력하면 연결됩니다.</p></div>
        <div className="sp" />
        <div style={{ textAlign: 'right' }}><div className="muted" style={{ fontSize: 12 }}>충족률</div><div style={{ fontSize: 24, fontWeight: 800, color: 'var(--brand)' }}>{covPct}%</div></div>
      </div>
      {loaded && rows.length > 0 && (
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 12 }} role="group" aria-label="커버리지 상태 필터">
          {CHIPS.map((c) => {
            const on = filter === c.key;
            return (
              <button key={c.key} type="button" title={`${c.tip}${c.key !== 'all' && rows.length ? ` — 전체의 ${Math.round((c.n / rows.length) * 100)}%` : ''}\n(클릭하면 해당 상태만 필터)`}
                onClick={() => setFilter((f) => (f === c.key ? 'all' : c.key))}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 11px', borderRadius: 999, cursor: 'pointer',
                  border: `1px solid ${on ? c.color : 'var(--border)'}`, background: on ? c.color : 'var(--surface-2)',
                  color: on ? '#fff' : c.color, fontWeight: 700, fontSize: 12, transition: 'all .12s' }}>
                <span>{c.label}</span>
                <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 800, padding: '0 6px', borderRadius: 999,
                  background: on ? 'rgba(255,255,255,.22)' : 'var(--surface-3)', color: on ? '#fff' : c.color }}>{c.n}</span>
              </button>
            );
          })}
          {filter !== 'all' && <span className="muted" style={{ fontSize: 12 }}>· {visibleRows.length}건 표시 (전체 {rows.length}건)</span>}
        </div>
      )}
      <div className="card" style={{ overflow: 'hidden' }}>
        <table className="tbl">
          <thead><tr><th>요구사항</th><th>우선순위</th><th>연계 업무</th><th>연계 이슈</th><th>연계 테스트</th><th>커버리지</th></tr></thead>
          <tbody>
            {!loaded && Array.from({ length: 4 }).map((_, i) => <tr key={`sk${i}`}><td colSpan={6}><div className="skel" style={{ height: 18, margin: '4px 0' }} /></td></tr>)}
            {loaded && rows.length === 0 && <tr><td colSpan={6}><div className="empty" style={{ padding: 24 }}>요구사항이 없습니다.</div></td></tr>}
            {loaded && rows.length > 0 && visibleRows.length === 0 && <tr><td colSpan={6}><div className="empty" style={{ padding: 24 }}>선택한 상태의 요구사항이 없습니다.</div></td></tr>}
            {visibleRows.map(({ rq, lt, li, ltest, cov, col, Icon }) => (
              <tr key={rq.id}>
                <td><div style={{ display: 'flex', flexDirection: 'column' }}><span style={{ fontWeight: 650 }}>{rq.title}</span><span className="mono" style={{ fontSize: 11, color: 'var(--text-3)' }}>{rq.code}</span></div></td>
                <td><Pill v={rq.priority} /></td>
                <td>{lt.length === 0 ? <span className="muted">—</span> : <span style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>{lt.map((t) => <span key={t.id} title={t.name} className="mono" style={{ fontSize: 10.5, background: t.status === 'done' ? '#e6f4ec' : 'var(--surface-3)', color: t.status === 'done' ? '#2f8f5b' : 'var(--text-2)', padding: '1px 6px', borderRadius: 5 }}>{t.code}</span>)}</span>}</td>
                <td>{li.length === 0 ? <span className="muted">—</span> : <span style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>{li.map((i) => <span key={i.id} title={i.title} className="mono" style={{ fontSize: 10.5, background: '#fdf3e7', color: '#b5730f', padding: '1px 6px', borderRadius: 5 }}>{i.code}</span>)}</span>}</td>
                <td>{ltest.length === 0 ? <span className="muted">—</span> : <span style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>{ltest.map((t: any) => { const c = t.result === 'pass' ? { bg: '#e6f4ec', fg: '#2f8f5b' } : t.result === 'fail' ? { bg: '#fdedef', fg: '#c0414f' } : { bg: 'var(--surface-3)', fg: 'var(--text-2)' }; return <span key={t.id} title={`${t.title} · ${t.result}`} className="mono" style={{ fontSize: 10.5, background: c.bg, color: c.fg, padding: '1px 6px', borderRadius: 5 }}>{t.code}</span>; })}</span>}</td>
                <td><span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontWeight: 700, fontSize: 12, color: col }}><Icon style={{ width: 14 }} />{cov}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Shell>
  );
}
