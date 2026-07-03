'use client';
import { useEffect, useState } from 'react';
import { Shell } from '@/components/Shell';
import { Gauge, ListTodo, Bug, CheckCircle2 } from 'lucide-react';

export default function Page() {
  const [rows, setRows] = useState<any[] | null>(null);
  useEffect(() => { fetch('/api/workload').then((r) => r.ok ? r.json() : []).then((d) => setRows(Array.isArray(d) ? d : [])); }, []);
  const max = Math.max(1, ...(rows || []).map((r) => r.taskOpen + r.issueOpen));
  return (
    <Shell title="업무 부하">
      <div className="row" style={{ marginBottom: 14 }}>
        <div><h2 className="h1">담당자별 업무 부하 <Gauge style={{ width: 20, verticalAlign: -3, color: 'var(--brand)' }} /></h2>
          <p className="h-sub">인력별 진행중 업무와 미결 이슈를 합산해 부하를 한눈에 봅니다.</p></div>
      </div>
      <div className="card" style={{ overflow: 'hidden' }}>
        <table className="tbl">
          <thead><tr><th>담당자</th><th style={{ width: 90 }}>진행 업무</th><th style={{ width: 90 }}>미결 이슈</th><th style={{ width: 80 }}>완료</th><th>부하</th></tr></thead>
          <tbody>
            {!rows && Array.from({ length: 4 }).map((_, i) => <tr key={`sk${i}`}><td colSpan={5}><div className="skel" style={{ height: 18, margin: '4px 0' }} /></td></tr>)}
            {rows && rows.length === 0 && <tr><td colSpan={5}><div className="empty" style={{ padding: 24 }}>인력·배정 데이터가 없습니다.</div></td></tr>}
            {rows && rows.map((r) => { const load = r.taskOpen + r.issueOpen; const pct = Math.round((load / max) * 100); const col = load >= max * 0.7 ? '#c0414f' : load >= max * 0.4 ? '#d98a16' : '#2f8f5b'; return (
              <tr key={r.name}>
                <td style={{ fontWeight: 650 }}>{r.name}</td>
                <td><span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><ListTodo style={{ width: 13, color: 'var(--text-3)' }} />{r.taskOpen}</span></td>
                <td><span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><Bug style={{ width: 13, color: 'var(--text-3)' }} />{r.issueOpen}</span></td>
                <td className="muted"><span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><CheckCircle2 style={{ width: 13, color: '#2f8f5b' }} />{r.taskDone}</span></td>
                <td><div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><div className="pbar" style={{ flex: 1, maxWidth: 220 }}><i style={{ width: `${pct}%`, background: `linear-gradient(90deg, ${col}cc, ${col})` }} /></div><span style={{ fontWeight: 800, fontSize: 12.5, minWidth: 20 }}>{load}</span></div></td>
              </tr>); })}
          </tbody>
        </table>
      </div>
    </Shell>
  );
}
