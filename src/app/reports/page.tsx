'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BarChart3, TrendingDown, Users, Gauge, Printer, Download } from 'lucide-react';
import { Shell } from '@/components/Shell';
import { Pill } from '@/lib/ui';
const cnt = (a: any[], k: string, v: string) => a.filter((x) => x[k] === v).length; // reports
// 일정 경과율(계획 진척 근사, EVM PV 개념) — /projects(배치79)와 동일 규칙 재사용
const DAY = 86400000;
const d0 = (s: any) => { if (!s) return null; const d = new Date(s); if (isNaN(d.getTime())) return null; d.setHours(0, 0, 0, 0); return d; };
const md = (d: Date) => `${d.getMonth() + 1}.${d.getDate()}`;
const elapsedOf = (start: any, end: any): { pct: number; left: number; over: number; days: number } | null => {
  const s = d0(start); const e = d0(end);
  if (!s || !e || e.getTime() < s.getTime()) return null;
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const days = Math.max(1, Math.round((e.getTime() - s.getTime()) / DAY));
  const gone = Math.round((now.getTime() - s.getTime()) / DAY);
  const pct = Math.max(0, Math.min(100, Math.round((gone / days) * 100)));
  const diff = Math.round((e.getTime() - now.getTime()) / DAY);
  return { pct, left: diff > 0 ? diff : 0, over: diff < 0 ? -diff : 0, days };
};

// --- Excel(다중 시트) 내보내기: 외부 의존성 없이 SpreadsheetML(엑셀 XML)로 워크북 생성 ---
const xmlEsc = (v: any) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function xlsSheet(name: string, headers: string[], rows: (string | number)[][]) {
  const cell = (v: any) => { const num = typeof v === 'number' && isFinite(v); return `<Cell><Data ss:Type="${num ? 'Number' : 'String'}">${xmlEsc(v)}</Data></Cell>`; };
  const head = `<Row>${headers.map((h) => `<Cell ss:StyleID="hd"><Data ss:Type="String">${xmlEsc(h)}</Data></Cell>`).join('')}</Row>`;
  const body = rows.map((r) => `<Row>${r.map(cell).join('')}</Row>`).join('');
  const safe = xmlEsc(name).replace(/[\\/?*[\]:]/g, ' ').slice(0, 31);
  return `<Worksheet ss:Name="${safe}"><Table>${head}${body}</Table></Worksheet>`;
}
function downloadWorkbook(sheets: string[]) {
  const style = `<Styles><Style ss:ID="hd"><Font ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#BE5535" ss:Pattern="Solid"/></Style></Styles>`;
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<?mso-application progid="Excel.Sheet"?>\n<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">${style}${sheets.join('')}</Workbook>`;
  const blob = new Blob(['﻿' + xml], { type: 'application/vnd.ms-excel;charset=utf-8' });
  const url = URL.createObjectURL(blob); const a = document.createElement('a');
  a.href = url; a.download = `PRISM_리포트_${new Date().toISOString().slice(0, 10)}.xls`;
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}

function shade(hex: string, amt: number) {
  const h = hex.replace('#',''); const f = h.length===3 ? h.split('').map((c)=>c+c).join('') : h; const n = parseInt(f,16);
  let r=(n>>16)&255,g=(n>>8)&255,b=n&255;
  r=Math.max(0,Math.min(255,Math.round(r*(1+amt)))); g=Math.max(0,Math.min(255,Math.round(g*(1+amt)))); b=Math.max(0,Math.min(255,Math.round(b*(1+amt))));
  return '#'+((1<<24)+(r<<16)+(g<<8)+b).toString(16).slice(1);
}
function Burndown({ tasks }: { tasks: any[] }) {
  const total = tasks.length || 1; const done = tasks.filter((t) => t.status === 'done').length;
  const pts = 12, W = 560, H = 210, pad = 36;
  const ideal: number[] = []; for (let i = 0; i < pts; i++) ideal.push(total - (total * i) / (pts - 1));
  const avg = tasks.reduce((s, t) => s + (t.progress || 0), 0) / total / 100;
  const actual: number[] = []; for (let i = 0; i < pts; i++) { const f = i / (pts - 1); actual.push(total - total * f * (0.45 + avg)); }
  const x = (i: number) => pad + (i / (pts - 1)) * (W - pad * 2);
  const y = (v: number) => H - pad - (Math.max(0, v) / total) * (H - pad * 2);
  const line = (a: number[]) => a.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
  const area = line(actual) + ` L${x(pts-1).toFixed(1)} ${(H-pad).toFixed(1)} L${x(0).toFixed(1)} ${(H-pad).toFixed(1)} Z`;
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`}>
      <defs>
        <linearGradient id="bdArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="var(--brand)" stopOpacity="0.28" /><stop offset="1" stopColor="var(--brand)" stopOpacity="0.02" /></linearGradient>
        <linearGradient id="bdLine" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#e08a5b" /><stop offset="1" stopColor="var(--brand)" /></linearGradient>
      </defs>
      {[0,0.25,0.5,0.75,1].map((g,i)=><g key={i}><line x1={pad} y1={y(total*g)} x2={W-pad} y2={y(total*g)} stroke="var(--border)" strokeDasharray={i===0?'0':'2 4'} /><text x={pad-8} y={y(total*g)+3} textAnchor="end" fontSize="9.5" fill="var(--text-4)">{Math.round(total*g)}</text></g>)}
      <path d={area} fill="url(#bdArea)" />
      <path d={line(ideal)} fill="none" stroke="var(--text-4)" strokeWidth="1.8" strokeDasharray="5 5" />
      <path className="gl" d={line(actual)} fill="none" stroke="url(#bdLine)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ filter: 'drop-shadow(0 3px 6px rgba(190,85,53,.22))' }} />
      {actual.map((v,i)=> i%2===0 ? <circle key={i} cx={x(i)} cy={y(v)} r="3.2" fill="#fff" stroke="var(--brand)" strokeWidth="2" /> : null)}
      <g transform={`translate(${pad+4}, ${pad-16})`}>
        <line x1="0" y1="0" x2="18" y2="0" stroke="var(--text-4)" strokeWidth="1.8" strokeDasharray="5 5" /><text x="23" y="3.5" fontSize="10" fill="var(--text-3)">이상선</text>
        <line x1="70" y1="0" x2="88" y2="0" stroke="var(--brand)" strokeWidth="3" strokeLinecap="round" /><text x="93" y="3.5" fontSize="10" fill="var(--text-3)">실제 잔여</text>
      </g>
      <text x={W-pad} y={pad-8} textAnchor="end" fontSize="10.5" fontWeight="700" fill="var(--text-2)">완료 {done}/{tasks.length}</text>
    </svg>
  );
}
function WeeklyTrend({ tasks }: { tasks: any[] }) {
  const total = tasks.length || 1;
  const withEnd = tasks.filter((t: any) => t.endDate);
  const doneSet = ['done', 'closed', 'resolved', 'completed', 'approved'];
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const dow = today.getDay(); // 0=일
  const thisSun = new Date(today); thisSun.setDate(today.getDate() + (dow === 0 ? 0 : 7 - dow));
  const N = 10, W = 560, H = 210, pad = 36;
  const weeks = Array.from({ length: N }, (_, i) => { const d = new Date(thisSun); d.setDate(thisSun.getDate() - (N - 1 - i) * 7); return d; });
  const ser = weeks.map((w) => {
    const we = w.getTime();
    const due = withEnd.filter((t: any) => { const e = new Date(t.endDate).getTime(); return !isNaN(e) && e <= we; }).length;
    const fin = withEnd.filter((t: any) => { const e = new Date(t.endDate).getTime(); return !isNaN(e) && e <= we && doneSet.includes(t.status); }).length;
    return { plan: Math.min(100, Math.round((due / total) * 100)), act: Math.min(100, Math.round((fin / total) * 100)) };
  });
  const x = (i: number) => pad + (i / (N - 1)) * (W - pad * 2);
  const y = (v: number) => H - pad - (v / 100) * (H - pad * 2);
  const path = (key: 'plan' | 'act') => ser.map((s, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(s[key]).toFixed(1)}`).join(' ');
  const last = ser[N - 1]; const gap = last.plan - last.act;
  const fmt = (d: Date) => `${d.getMonth() + 1}/${d.getDate()}`;
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`}>
      <defs><linearGradient id="wtLine" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#e08a5b" /><stop offset="1" stopColor="var(--brand)" /></linearGradient></defs>
      {[0, 0.25, 0.5, 0.75, 1].map((g, i) => <g key={i}><line x1={pad} y1={y(g * 100)} x2={W - pad} y2={y(g * 100)} stroke="var(--border)" strokeDasharray={i === 0 ? '0' : '2 4'} /><text x={pad - 8} y={y(g * 100) + 3} textAnchor="end" fontSize="9.5" fill="var(--text-4)">{Math.round(g * 100)}</text></g>)}
      {weeks.map((w, i) => i % 2 === 0 ? <text key={i} x={x(i)} y={H - pad + 16} textAnchor="middle" fontSize="9" fill="var(--text-4)">{fmt(w)}</text> : null)}
      <path d={path('plan')} fill="none" stroke="var(--text-4)" strokeWidth="1.8" strokeDasharray="5 5" />
      <path className="gl" d={path('act')} fill="none" stroke="url(#wtLine)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ filter: 'drop-shadow(0 3px 6px rgba(190,85,53,.22))' }} />
      {ser.map((s, i) => i % 2 === 0 ? <circle key={i} cx={x(i)} cy={y(s.act)} r="3.2" fill="#fff" stroke="var(--brand)" strokeWidth="2" /> : null)}
      <g transform={`translate(${pad + 4}, ${pad - 16})`}>
        <line x1="0" y1="0" x2="18" y2="0" stroke="var(--text-4)" strokeWidth="1.8" strokeDasharray="5 5" /><text x="23" y="3.5" fontSize="10" fill="var(--text-3)">계획(기한도래)</text>
        <line x1="92" y1="0" x2="110" y2="0" stroke="var(--brand)" strokeWidth="3" strokeLinecap="round" /><text x="115" y="3.5" fontSize="10" fill="var(--text-3)">실제 완료</text>
      </g>
      <text x={W - pad} y={pad - 8} textAnchor="end" fontSize="10.5" fontWeight="700" fill={gap > 0 ? '#c0414f' : '#2f8f5b'}>{gap > 0 ? `계획 대비 ${gap}%p 지연` : '계획 대비 정상'}</text>
    </svg>
  );
}
function Bars({ data }: { data: { label: string; value: number; color: string }[] }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (<div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>{data.map((d, i) => (
    <div key={i}><div className="row" style={{ fontSize: 12.5, marginBottom: 6 }}><span style={{ fontWeight: 600, color: 'var(--text-2)' }}>{d.label}</span>
      <span style={{ marginLeft: 'auto', fontWeight: 800, background: `${d.color}18`, color: shade(d.color, -0.15), padding: '1px 9px', borderRadius: 20, fontSize: 11.5 }}>{d.value}</span></div>
      <div className="pbar"><i className="pbar-anim" style={{ width: `${(d.value / max) * 100}%`, background: `linear-gradient(90deg, ${shade(d.color, 0.14)}, ${d.color})`, animationDelay: `${i * 110}ms` }} /></div></div>))}</div>);
}
function Stat({ icon: Icon, label, value, c, bg }: any) {
  return <div className="kpi"><div className="kpi-ic" style={{ background: bg, color: c }}><Icon style={{ width: 18 }} /></div><div className="kpi-label">{label}</div><div className="kpi-value" style={{ color: c }}>{value}</div></div>;
}

export default function Page() {
  const router = useRouter();
  const [d, setD] = useState<any>(null);
  useEffect(() => {
    fetch('/api/auth/me').then((r) => r.json()).then(async (m) => { if (!m.authenticated) { router.push('/login'); return; }
      const [issues, tasks, risks, requirements, projects, sprints, tests, snapshots, procurement] = await Promise.all(['issues','tasks','risks','requirements','projects','sprints','tests','snapshots','procurement'].map((e) => fetch('/api/' + e).then((r) => r.ok ? r.json() : [])));
      setD({ issues: issues||[], tasks: tasks||[], risks: risks||[], requirements: requirements||[], projects: projects||[], sprints: sprints||[], tests: tests||[], snapshots: snapshots||[], procurement: procurement||[] });
    });
  }, [router]);
  if (!d) return <Shell title="리포트"><div className="card card-pad" style={{ display: 'grid', gap: 12 }}>{Array.from({ length: 5 }).map((_, i) => <div key={i} className="skel" style={{ height: i === 0 ? 30 : 18, width: i === 0 ? '38%' : '100%' }} />)}</div></Shell>;
  const { issues, tasks, risks, requirements, projects, sprints, tests, snapshots, procurement } = d;
  // 프로젝트별 예산/기성/조달 재무 집계 (읽기 전용 계산 — /projects[id] 재무 카드와 동일 규칙)
  const won = (n: number) => '₩' + (Number(n) || 0).toLocaleString('ko-KR');
  const latestSnap = (pid: number) => {
    const ss = snapshots.filter((s: any) => s.projectId === pid);
    if (!ss.length) return null;
    return ss.slice().sort((a: any, b: any) => String(b.snapshotDate || '').localeCompare(String(a.snapshotDate || '')) || (b.id - a.id))[0];
  };
  const finance = projects.map((p: any) => {
    const budget = Number(p.budget) || 0;
    const snap = latestSnap(p.id);
    const billPct = snap ? Math.max(0, Math.min(100, Number(snap.billingPct) || 0)) : null;
    const billAmt = billPct != null ? Math.round(budget * billPct / 100) : 0;
    const pis = procurement.filter((x: any) => x.projectId === p.id);
    const procTotal = pis.reduce((s: number, x: any) => s + (Number(x.qty) || 0) * (Number(x.unitPrice) || 0), 0);
    const procReceived = pis.filter((x: any) => x.receiptDate).reduce((s: number, x: any) => s + (Number(x.qty) || 0) * (Number(x.unitPrice) || 0), 0);
    const procRatio = budget > 0 ? Math.round(procTotal / budget * 100) : null;
    return { p, budget, snap, billPct, billAmt, procCnt: pis.length, procTotal, procReceived, procRatio };
  }).filter((f: any) => f.budget > 0 || f.procTotal > 0 || f.snap);
  const finTot = finance.reduce((a: any, f: any) => ({ budget: a.budget + f.budget, billAmt: a.billAmt + f.billAmt, procTotal: a.procTotal + f.procTotal, procReceived: a.procReceived + f.procReceived }), { budget: 0, billAmt: 0, procTotal: 0, procReceived: 0 });
  const finBillRate = finTot.budget > 0 ? Math.round(finTot.billAmt / finTot.budget * 100) : null;
  // 테스트 실행 결과(통과율·실패)
  const tCnt = (r: string) => tests.filter((t: any) => t.result === r).length;
  const tPass = tCnt('pass'), tFail = tCnt('fail'), tBlocked = tCnt('blocked'), tNa = tests.length - tPass - tFail - tBlocked;
  const tExecuted = tPass + tFail + tBlocked;
  const tPassRate = (tPass + tFail) > 0 ? Math.round((tPass / (tPass + tFail)) * 100) : null;
  const testByProject = projects.map((p: any) => {
    const ts = tests.filter((t: any) => t.projectId === p.id);
    const pp = ts.filter((t: any) => t.result === 'pass').length, pf = ts.filter((t: any) => t.result === 'fail').length;
    const exec = ts.filter((t: any) => ['pass','fail','blocked'].includes(t.result)).length;
    return { p, total: ts.length, exec, pass: pp, fail: pf, rate: (pp + pf) > 0 ? Math.round((pp / (pp + pf)) * 100) : null };
  }).filter((r: any) => r.total > 0);
  // assignee breakdown
  const assignees = Array.from(new Set(issues.map((i: any) => i.assignee).filter(Boolean)));
  const byAssignee = assignees.map((a: any) => ({ a, total: issues.filter((i: any) => i.assignee === a).length, open: issues.filter((i: any) => i.assignee === a && i.status === 'open').length, prog: issues.filter((i: any) => i.assignee === a && i.status === 'in_progress').length, done: issues.filter((i: any) => i.assignee === a && ['resolved','closed'].includes(i.status)).length }));
  const avgProg = tasks.length ? Math.round(tasks.reduce((s: number, t: any) => s + (t.progress || 0), 0) / tasks.length) : 0;
  const velocity = sprints.map((s: any) => ({ s, pts: issues.filter((i: any) => i.sprintId === s.id).reduce((x: number, i: any) => x + (Number(i.storyPoints) || 0), 0), cnt: issues.filter((i: any) => i.sprintId === s.id).length }));
  // 프로젝트별 현황: 업무 진척·일정 경과율·일정 대비 지연(SV) — /projects 목록(배치79)과 동일 임계값(±10%p)
  const doneSet2 = ['done', 'closed', 'resolved', 'completed', 'approved'];
  const projStats = projects.map((p: any) => {
    const pts = tasks.filter((t: any) => t.projectId === p.id);
    const total = pts.length;
    const doneCnt = pts.filter((t: any) => doneSet2.includes(t.status)).length;
    const prog = total ? Math.round(pts.reduce((x: number, t: any) => x + (t.progress || 0), 0) / total) : null;
    const active = String(p.status || '') === 'active';
    const el = elapsedOf(p.startDate, p.endDate);
    const sv = el && active && prog !== null ? Math.round((prog - el.pct) * 10) / 10 : null;
    return { p, total, doneCnt, prog, active, el, sv };
  });
  const exportExcel = () => {
    const sheets = [
      xlsSheet('프로젝트', ['코드', '프로젝트', '고객', '상태', '시작일', '종료일'], projects.map((p: any) => [p.code || '', p.name || '', p.client || '', p.status || '', p.startDate || '', p.endDate || ''])),
      xlsSheet('담당자별이슈', ['담당자', '전체', '열림', '진행', '완료'], byAssignee.map((r: any) => [r.a, r.total, r.open, r.prog, r.done])),
      xlsSheet('스프린트벨로시티', ['스프린트', '상태', '이슈', '포인트'], velocity.map((v: any) => [v.s.name || '', v.s.status || '', v.cnt, v.pts])),
      xlsSheet('이슈', ['제목', '유형', '우선순위', '상태', '담당자', '기한'], issues.map((i: any) => [i.title || '', i.type || '', i.priority || '', i.status || '', i.assignee || '', i.dueDate || ''])),
      xlsSheet('리스크', ['제목', '확률', '영향', '등급', '상태', '담당'], risks.map((r: any) => [r.title || '', r.probability || '', r.impact || '', r.level || '', r.status || '', r.owner || ''])),
      xlsSheet('요구사항', ['코드', '제목', '분류', '우선순위', '상태'], requirements.map((q: any) => [q.reqCode || q.code || '', q.title || '', q.category || '', q.priority || '', q.status || ''])),
      xlsSheet('테스트실행', ['프로젝트', '전체', '실행', '통과', '실패', '통과율(%)'], testByProject.map((r: any) => [r.p.name || '', r.total, r.exec, r.pass, r.fail, r.rate ?? ''])),
      xlsSheet('예산기성', ['프로젝트', '계약금액', '기성률(%)', '기성금액', '조달총액', '조달입고액', '예산대비조달(%)'], finance.map((f: any) => [f.p.name || '', f.budget, f.billPct ?? '', f.billAmt, f.procTotal, f.procReceived, f.procRatio ?? ''])),
    ];
    downloadWorkbook(sheets);
  };
  return (
    <Shell title="리포트">
      <div className="row"><div><h2 className="h1">리포트 <BarChart3 style={{ width: 22, verticalAlign: -3, color: 'var(--brand)' }} /></h2><p className="h-sub">프로젝트 진척·품질·팀 지표를 종합 분석합니다.</p></div><div className="sp" /><button className="btn no-print" onClick={exportExcel} style={{ marginRight: 8 }}><Download style={{ width: 15 }} />엑셀 내보내기</button><button className="btn no-print" onClick={() => window.print()}><Printer style={{ width: 15 }} />인쇄 / PDF</button></div>
      <div style={{ height: 16 }} />
      <div className="kpis">
        <Stat icon={Gauge} label="평균 진척" value={avgProg + '%'} c="#2f8f5b" bg="#e9faf0" />
        <Stat icon={TrendingDown} label="열린 이슈" value={issues.filter((i:any)=>!['resolved','closed'].includes(i.status)).length} c="#d98a16" bg="#fdf3e3" />
        <Stat icon={BarChart3} label="High 리스크" value={risks.filter((r:any)=>r.level==='high').length} c="#c0414f" bg="#fdedef" />
        <Stat icon={Users} label="참여 인원" value={assignees.length} c="#be5535" bg="#fbeeea" />
      </div>
      <div style={{ height: 16 }} />
      <div className="card card-pad dash-card"><div className="sect" style={{ marginBottom: 8 }}>주간 진척 추이 <span style={{ fontSize: 11, color: 'var(--text-4)', fontWeight: 600 }}>(최근 10주 · 기한 도래 대비 완료 누적)</span></div><WeeklyTrend tasks={tasks} /></div>
      <div style={{ height: 16 }} />
      <div className="card card-pad dash-card"><div className="sect" style={{ marginBottom: 12 }}>기성고 · 진척 스냅샷 <span style={{ fontSize: 11, color: 'var(--text-4)', fontWeight: 600 }}>(기준 시점별 계획/실적/기성률)</span></div>
        {snapshots.length === 0 ? <p className="muted" style={{ fontSize: 13 }}>스냅샷이 없습니다. 기성고·스냅샷 화면에서 기준 시점을 기록하면 여기에 추이가 표시됩니다.</p> : (
          <div className="tbl-wrap"><table className="tbl"><thead><tr><th>기준</th><th>기준일</th><th>계획</th><th>실적</th><th style={{ minWidth: 150 }}>기성률</th></tr></thead>
            <tbody>{snapshots.slice(0, 12).map((s: any) => (
              <tr key={s.id}><td style={{ fontWeight: 650 }}>{s.label}</td><td className="muted">{s.snapshotDate || '\u2014'}</td><td>{s.plannedPct||0}%</td><td>{s.actualPct||0}%</td>
                <td><div className="row" style={{ gap: 8 }}><div className="pbar" style={{ flex: 1 }}><i style={{ width: `${Math.min(100, s.billingPct||0)}%`, background: 'linear-gradient(90deg,#e6915f,#be5535)' }} /></div><span style={{ fontWeight: 800, fontSize: 12, minWidth: 34, textAlign: 'right' }}>{s.billingPct||0}%</span></div></td></tr>))}
            </tbody></table></div>)}
      </div>
      {finance.length > 0 && <>
        <div style={{ height: 16 }} />
        <div className="card dash-card" style={{ overflow: 'hidden' }}>
          <div className="card-pad" style={{ paddingBottom: 0 }}><div className="sect">프로젝트별 예산 · 기성 · 조달 집계 <span style={{ fontSize: 11, color: 'var(--text-4)', fontWeight: 600 }}>(계약금액 · 최신 스냅샷 기성률 · 조달 집행)</span></div></div>
          <div className="tbl-wrap" style={{ marginTop: 8 }}><table className="tbl"><thead><tr><th>프로젝트</th><th style={{ textAlign: 'right' }}>계약금액</th><th style={{ minWidth: 150 }}>기성률</th><th style={{ textAlign: 'right' }}>기성금액</th><th style={{ textAlign: 'right' }}>조달총액</th><th style={{ minWidth: 120 }}>예산대비 조달</th></tr></thead>
            <tbody>{finance.map((f: any) => {
              const over = f.procRatio != null && f.procRatio > 100;
              return <tr key={f.p.id}>
                <td style={{ fontWeight: 650 }}>{f.p.name}</td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{f.budget > 0 ? won(f.budget) : <span className="muted">—</span>}</td>
                <td>{f.billPct == null ? <span className="muted" style={{ fontSize: 11.5 }} title="이 프로젝트에 기록된 기성고 스냅샷이 없습니다">스냅샷 없음</span> : <div className="row" style={{ gap: 8, alignItems: 'center' }} title={`최신 스냅샷 기준일 ${f.snap?.snapshotDate || '—'} · 기성률 ${f.billPct}%`}><div className="pbar" style={{ flex: 1 }}><i style={{ width: `${f.billPct}%`, background: 'linear-gradient(90deg,#e6915f,#be5535)' }} /></div><span style={{ fontWeight: 800, fontSize: 12, minWidth: 34, textAlign: 'right' }}>{f.billPct}%</span></div>}</td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{f.billPct != null && f.budget > 0 ? won(f.billAmt) : <span className="muted">—</span>}</td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{f.procTotal > 0 ? <span title={`조달 ${f.procCnt}건 · 입고액 ${won(f.procReceived)}`} style={{ cursor: 'help' }}>{won(f.procTotal)}</span> : <span className="muted">—</span>}</td>
                <td>{f.procRatio == null ? <span className="muted" style={{ fontSize: 11.5 }}>—</span> : <div className="row" style={{ gap: 8, alignItems: 'center' }} title={`계약금액 대비 조달총액 ${f.procRatio}%` + (over ? ' — 예산 초과' : '')}><div className="pbar" style={{ flex: 1 }}><i style={{ width: `${Math.min(100, f.procRatio)}%`, background: over ? '#c0414f' : '#5a7fb0' }} /></div><span style={{ fontWeight: 800, fontSize: 12, minWidth: 40, textAlign: 'right', color: over ? '#c0414f' : 'var(--text-2)' }}>{f.procRatio}%</span></div>}</td>
              </tr>;
            })}
              <tr style={{ borderTop: '2px solid var(--border)', fontWeight: 800 }}>
                <td>합계 <span className="muted" style={{ fontWeight: 600, fontSize: 11 }}>({finance.length}개)</span></td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{won(finTot.budget)}</td>
                <td>{finBillRate == null ? <span className="muted">—</span> : <span style={{ fontWeight: 800 }}>{finBillRate}%</span>}</td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{won(finTot.billAmt)}</td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{won(finTot.procTotal)}</td>
                <td className="muted" style={{ fontWeight: 600, fontSize: 11.5 }}>입고 {won(finTot.procReceived)}</td>
              </tr></tbody></table></div>
        </div>
      </>}
      <div style={{ height: 16 }} />
      <div className="g2">
        <div className="card card-pad dash-card"><div className="sect" style={{ marginBottom: 8 }}>번다운 차트</div><Burndown tasks={tasks} /></div>
        <div className="card card-pad dash-card"><div className="sect" style={{ marginBottom: 16 }}>이슈 우선순위</div>
          <Bars data={[{ label: 'Critical', value: cnt(issues,'priority','critical'), color: '#c0414f' },{ label: 'High', value: cnt(issues,'priority','high'), color: '#f2772e' },{ label: 'Medium', value: cnt(issues,'priority','medium'), color: '#d98a16' },{ label: 'Low', value: cnt(issues,'priority','low'), color: '#2f8f5b' }]} /></div>
      </div>
      <div style={{ height: 16 }} />
      <div className="g2">
        <div className="card dash-card" style={{ overflow: 'hidden' }}>
          <div className="card-pad" style={{ paddingBottom: 0 }}><div className="sect">담당자별 이슈 현황</div></div>
          <div className="tbl-wrap" style={{ marginTop: 8 }}><table className="tbl"><thead><tr><th>담당자</th><th>전체</th><th>열림</th><th>진행</th><th>완료</th></tr></thead>
            <tbody>{byAssignee.map((r: any) => <tr key={r.a}><td style={{ fontWeight: 650 }}>{r.a}</td><td>{r.total}</td><td><span className="pill p-blue">{r.open}</span></td><td><span className="pill p-amber">{r.prog}</span></td><td><span className="pill p-green">{r.done}</span></td></tr>)}
              {byAssignee.length === 0 && <tr><td colSpan={5}><div className="empty">데이터 없음</div></td></tr>}</tbody></table></div>
        </div>
        <div className="card dash-card" style={{ overflow: 'hidden' }}>
          <div className="card-pad" style={{ paddingBottom: 0 }}><div className="sect">스프린트 벨로시티</div></div>
          <div className="tbl-wrap" style={{ marginTop: 8 }}><table className="tbl"><thead><tr><th>스프린트</th><th>상태</th><th>이슈</th><th>포인트</th></tr></thead>
            <tbody>{velocity.map((v: any) => <tr key={v.s.id}><td style={{ fontWeight: 650 }}>{v.s.name}</td><td><Pill v={v.s.status} /></td><td>{v.cnt}</td><td style={{ fontWeight: 800 }}>{v.pts} pts</td></tr>)}
              {velocity.length === 0 && <tr><td colSpan={4}><div className="empty">스프린트 없음</div></td></tr>}</tbody></table></div>
        </div>
      </div>
      <div style={{ height: 16 }} />
      <div className="g2">
        <div className="card card-pad dash-card"><div className="sect" style={{ marginBottom: 16 }}>테스트 실행 결과</div>
          <div className="row" style={{ alignItems: 'baseline', gap: 10, marginBottom: 14 }}>
            <span style={{ fontSize: 34, fontWeight: 800, color: tPassRate == null ? 'var(--text-4)' : tPassRate >= 80 ? '#2f8f5b' : tPassRate >= 50 ? '#d98a16' : '#c0414f' }}>{tPassRate == null ? '—' : tPassRate + '%'}</span>
            <span style={{ fontSize: 12.5, color: 'var(--text-3)', fontWeight: 600 }}>통과율</span>
            <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-3)' }}>실행 {tExecuted}/{tests.length}</span>
          </div>
          <Bars data={[{ label: '통과', value: tPass, color: '#2f8f5b' },{ label: '실패', value: tFail, color: '#c0414f' },{ label: '블록', value: tBlocked, color: '#d98a16' },{ label: '미실행', value: tNa, color: '#8a94a6' }]} />
        </div>
        <div className="card dash-card" style={{ overflow: 'hidden' }}>
          <div className="card-pad" style={{ paddingBottom: 0 }}><div className="sect">프로젝트별 테스트 통과율</div></div>
          <div className="tbl-wrap" style={{ marginTop: 8 }}><table className="tbl"><thead><tr><th>프로젝트</th><th>실행</th><th>통과</th><th>실패</th><th>통과율</th></tr></thead>
            <tbody>{testByProject.map((r: any) => <tr key={r.p.id}><td style={{ fontWeight: 650 }}>{r.p.name}</td><td>{r.exec}/{r.total}</td><td><span className="pill p-green">{r.pass}</span></td><td><span className="pill p-red">{r.fail}</span></td><td style={{ minWidth: 140 }}>{r.rate == null ? <span style={{ color: 'var(--text-4)', fontWeight: 800 }}>—</span> : (() => { const rc = r.rate >= 80 ? '#2f8f5b' : r.rate >= 50 ? '#d98a16' : '#c0414f'; return <div className="row" style={{ gap: 8 }}><div className="pbar" style={{ flex: 1 }}><i style={{ width: `${Math.min(100, r.rate)}%`, background: rc }} /></div><span style={{ fontWeight: 800, fontSize: 12, minWidth: 34, textAlign: 'right', color: rc }}>{r.rate}%</span></div>; })()}</td></tr>)}
              {testByProject.length === 0 && <tr><td colSpan={5}><div className="empty">실행된 테스트 없음</div></td></tr>}</tbody></table></div>
        </div>
      </div>
      <div style={{ height: 16 }} />
      <div className="card dash-card" style={{ overflow: 'hidden' }}>
        <div className="card-pad" style={{ paddingBottom: 0 }}><div className="sect">프로젝트별 현황</div></div>
        <div className="tbl-wrap" style={{ marginTop: 8 }}><table className="tbl"><thead><tr><th>코드</th><th>프로젝트</th><th>고객</th><th>상태</th><th>업무</th><th style={{ minWidth: 150 }}>진척</th><th style={{ minWidth: 180 }}>기간</th></tr></thead>
          <tbody>{projStats.map(({ p, total, doneCnt, prog, active, el, sv }: any) => {
            const closed = ['completed', 'archived'].includes(String(p.status || ''));
            const left = total - doneCnt;
            const pcol = prog == null ? 'var(--text-4)' : prog >= 80 ? '#2f8f5b' : prog >= 50 ? '#d98a16' : '#c0414f';
            const behind = sv !== null && sv <= -10;
            const done = String(p.status || '') !== 'active';
            const scol = el ? (done ? '#9a9a9a' : el.over > 0 ? '#c0414f' : el.left <= 14 ? '#d98a16' : '#2f8f5b') : 'var(--text-4)';
            const dtxt = el ? (done ? `${el.days}일` : el.over > 0 ? `${el.over}일 초과` : el.left === 0 ? '오늘 마감' : `D-${el.left}`) : '';
            const s0 = d0(p.startDate); const e0 = d0(p.endDate);
            return <tr key={p.id}>
              <td className="mono">{p.code}</td>
              <td style={{ fontWeight: 650 }}>{p.name}</td>
              <td>{p.client || '—'}</td>
              <td><Pill v={p.status} /></td>
              <td>{total ? <span title={`총 ${total}건 · 완료 ${doneCnt}건 · 미완료 ${left}건`} style={{ fontSize: 12, cursor: 'help' }}><b>{doneCnt}</b><span className="muted">/{total}</span>{closed && left > 0 && <span title={`프로젝트가 종료 상태인데 미완료 업무가 ${left}건 남아 있습니다 — 완료 처리하거나 이관하세요`} style={{ marginLeft: 6, color: '#c0414f', fontWeight: 700, fontSize: 11 }}>⚠ 잔여 {left}</span>}</span> : <span className="muted" style={{ fontSize: 11.5 }} title="이 프로젝트에 등록된 업무(WBS)가 없습니다">—</span>}</td>
              <td>{prog == null ? <span className="muted" style={{ fontSize: 11.5 }}>업무 없음</span> : <div className="row" style={{ gap: 8, alignItems: 'center' }} title={`업무 ${total}건 평균 진척 ${prog}%` + (el && active ? `\n일정 경과 ${el.pct}% (계획 진척 근사)\n${sv !== null && sv < 0 ? `일정 대비 ${Math.abs(sv)}%p 지연` : sv !== null && sv > 0 ? `일정 대비 ${sv}%p 선행` : '일정대로 진행'}` : '')}><div className="pbar" style={{ flex: 1 }}><i style={{ width: `${prog}%`, background: pcol }} /></div><span style={{ fontWeight: 800, fontSize: 12, minWidth: 34, textAlign: 'right', color: pcol }}>{prog}%</span>{behind && <span style={{ fontSize: 10.5, padding: '1px 6px', borderRadius: 999, background: '#fdecee', color: '#c0414f', border: '1px solid #f3d2d7', whiteSpace: 'nowrap', fontWeight: 700 }}>지연 {Math.abs(sv)}%p</span>}</div>}</td>
              <td>{!el || !s0 || !e0 ? <span className="muted">{p.startDate || '—'} ~ {p.endDate || '—'}</span> : <div className="row" style={{ gap: 8, alignItems: 'center' }} title={`${md(s0)} ~ ${md(e0)} · 총 ${el.days}일\n일정 경과 ${el.pct}%` + (done ? '\n종료된 프로젝트 — 잔여 기간 경보 없음' : el.over > 0 ? `\n종료일이 ${el.over}일 지났는데 상태가 '진행'입니다 — 종료 처리 또는 기간 연장이 필요합니다` : `\n잔여 ${el.left}일`)}><span style={{ fontSize: 11.5, color: 'var(--text-3)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{md(s0)}~{md(e0)}</span><div className="pbar" style={{ flex: 1, minWidth: 44 }}><i style={{ width: `${el.pct}%`, background: scol }} /></div><span style={{ fontSize: 11, color: scol, fontWeight: 700, whiteSpace: 'nowrap' }}>{dtxt}{!done && el.over > 0 ? ' ⚠' : ''}</span></div>}</td>
            </tr>;
          })}
            {projects.length === 0 && <tr><td colSpan={7}><div className="empty">프로젝트 없음</div></td></tr>}</tbody></table></div>
      </div>
    </Shell>
  );
}
