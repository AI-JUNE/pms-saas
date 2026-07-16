'use client';
import { useEffect, useMemo, useState } from 'react';
import { Shell } from '@/components/Shell';
import { Gauge, ListTodo, Bug, CheckCircle2, Search, Users, Flame, Coffee } from 'lucide-react';

type Row = { name: string; taskOpen: number; taskDone: number; issueOpen: number };

export default function Page() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [q, setQ] = useState('');
  useEffect(() => { fetch('/api/workload').then((r) => r.ok ? r.json() : []).then((d) => setRows(Array.isArray(d) ? d : [])); }, []);

  const all = rows || [];
  const max = Math.max(1, ...all.map((r) => r.taskOpen + r.issueOpen));
  // 조직 전체 기준 요약(검색 필터와 무관하게 전체를 집계)
  const summary = useMemo(() => {
    const loads = all.map((r) => r.taskOpen + r.issueOpen);
    const over = loads.filter((l) => l > 0 && l >= max * 0.7).length;
    const idle = loads.filter((l) => l === 0).length;
    const avg = all.length ? Math.round((loads.reduce((a, b) => a + b, 0) / all.length) * 10) / 10 : 0;
    return { total: all.length, over, idle, avg };
  }, [all, max]);

  const kw = q.trim().toLowerCase();
  const shown = useMemo(() => kw ? all.filter((r) => r.name.toLowerCase().includes(kw)) : all, [all, kw]);
  const filtering = kw.length > 0;

  return (
    <Shell title="업무 부하">
      <div className="row" style={{ marginBottom: 14 }}>
        <div><h2 className="h1">담당자별 업무 부하 <Gauge style={{ width: 20, verticalAlign: -3, color: 'var(--brand)' }} /></h2>
          <p className="h-sub">인력별 진행중 업무와 미결 이슈를 합산해 부하를 한눈에 봅니다.</p></div>
      </div>

      <div className="kpis" style={{ marginBottom: 16 }}>
        <div className="kpi k0"><div className="kpi-ic" style={{ background: 'rgba(190,85,53,.12)' }}><Users style={{ width: 18, color: 'var(--brand)' }} /></div>
          <div className="kpi-label">집계 인원</div><div className="kpi-value">{rows ? summary.total : '–'}</div><div className="kpi-sub">배정 이력이 있는 담당자</div></div>
        <div className="kpi k3" title="부하(진행 업무+미결 이슈)가 최다 담당자의 70% 이상인 인원"><div className="kpi-ic" style={{ background: 'rgba(192,65,79,.12)' }}><Flame style={{ width: 18, color: '#c0414f' }} /></div>
          <div className="kpi-label">과부하</div><div className="kpi-value">{rows ? summary.over : '–'}</div><div className="kpi-sub">최다 대비 70%↑ 부하</div></div>
        <div className="kpi k1" title="진행중 업무·미결 이슈가 없는 담당자"><div className="kpi-ic" style={{ background: 'rgba(47,143,91,.12)' }}><Coffee style={{ width: 18, color: '#2f8f5b' }} /></div>
          <div className="kpi-label">여유</div><div className="kpi-value">{rows ? summary.idle : '–'}</div><div className="kpi-sub">미결 부하 0건</div></div>
        <div className="kpi k2" title="1인당 평균 부하(진행 업무+미결 이슈)"><div className="kpi-ic" style={{ background: 'rgba(217,138,22,.12)' }}><Gauge style={{ width: 18, color: '#d98a16' }} /></div>
          <div className="kpi-label">평균 부하</div><div className="kpi-value">{rows ? summary.avg : '–'}</div><div className="kpi-sub">1인당 미결 건수</div></div>
      </div>

      <div className="toolbar">
        <div className="search"><Search style={{ width: 15 }} /><input placeholder="담당자 이름 검색" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        {rows && (
          <span className="muted" style={{ fontSize: 12.5 }}
            title={filtering ? `전체 ${all.length}명 중 '${q.trim()}' 검색 결과 ${shown.length}명` : `집계 대상 ${all.length}명`}>
            {filtering ? <><b style={{ color: 'var(--brand)' }}>{shown.length}</b>/{all.length}명</> : <>{all.length}명</>}
          </span>
        )}
      </div>

      <div className="card" style={{ overflow: 'hidden' }}>
        <table className="tbl">
          <thead><tr><th>담당자</th><th style={{ width: 90 }}>진행 업무</th><th style={{ width: 90 }}>미결 이슈</th><th style={{ width: 110 }}>완료</th><th>부하</th></tr></thead>
          <tbody>
            {!rows && Array.from({ length: 4 }).map((_, i) => <tr key={`sk${i}`}><td colSpan={5}><div className="skel" style={{ height: 18, margin: '4px 0' }} /></td></tr>)}
            {rows && all.length === 0 && <tr><td colSpan={5}><div className="empty" style={{ padding: 24 }}>인력·배정 데이터가 없습니다.</div></td></tr>}
            {rows && all.length > 0 && shown.length === 0 && <tr><td colSpan={5}><div className="empty" style={{ padding: 24 }}>'{q.trim()}'에 해당하는 담당자가 없습니다.</div></td></tr>}
            {rows && shown.map((r) => {
              const load = r.taskOpen + r.issueOpen;
              const pct = Math.round((load / max) * 100);
              const col = load >= max * 0.7 ? '#c0414f' : load >= max * 0.4 ? '#d98a16' : '#2f8f5b';
              const taskTotal = r.taskOpen + r.taskDone;
              const donePct = taskTotal ? Math.round((r.taskDone / taskTotal) * 100) : 0;
              const tag = load === 0 ? '여유' : (load === max ? '최다' : '');
              const tagCol = load === 0 ? '#2f8f5b' : '#c0414f';
              return (
              <tr key={r.name}>
                <td style={{ fontWeight: 650 }}>{r.name}</td>
                <td><span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><ListTodo style={{ width: 13, color: 'var(--text-3)' }} />{r.taskOpen}</span></td>
                <td><span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><Bug style={{ width: 13, color: 'var(--text-3)' }} />{r.issueOpen}</span></td>
                <td className="muted" title={taskTotal ? `업무 ${taskTotal}건 중 ${r.taskDone}건 완료 (${donePct}%)` : '배정된 업무 없음'}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><CheckCircle2 style={{ width: 13, color: '#2f8f5b' }} />{r.taskDone}
                    {taskTotal > 0 && <span style={{ fontSize: 11, color: 'var(--text-3)' }}>({donePct}%)</span>}</span></td>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}
                    title={`진행 업무 ${r.taskOpen} · 미결 이슈 ${r.issueOpen} · 완료 ${r.taskDone} — 부하 ${load}건`}>
                    <div className="pbar" style={{ flex: 1, maxWidth: 220 }}><i style={{ width: `${pct}%`, background: `linear-gradient(90deg, ${col}cc, ${col})` }} /></div>
                    <span style={{ fontWeight: 800, fontSize: 12.5, minWidth: 20 }}>{load}</span>
                    {tag && <span style={{ fontSize: 10.5, fontWeight: 700, color: tagCol }}>{tag}</span>}
                  </div>
                </td>
              </tr>); })}
          </tbody>
        </table>
      </div>
    </Shell>
  );
}
