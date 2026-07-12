'use client';
import { useEffect, useState } from 'react';
import { Shell } from '@/components/Shell';
import { Pill } from '@/lib/ui';
import { Printer, CheckCircle2, Clock, AlertTriangle, Bug, ShieldAlert, CalendarRange } from 'lucide-react';

function weekRange() {
  const now = new Date(); const day = (now.getDay() + 6) % 7; // Mon=0
  const mon = new Date(now); mon.setDate(now.getDate() - day); mon.setHours(0, 0, 0, 0);
  const sun = new Date(mon); sun.setDate(mon.getDate() + 6); sun.setHours(23, 59, 59, 999);
  const nMon = new Date(mon); nMon.setDate(mon.getDate() + 7);
  const nSun = new Date(sun); nSun.setDate(sun.getDate() + 7);
  return { mon, sun, nMon, nSun };
}
const ymd = (d: Date) => `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
const md = (d: Date) => `${d.getMonth() + 1}.${String(d.getDate()).padStart(2, '0')}`;

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

  const { mon, sun, nMon, nSun } = weekRange();
  // 기간 판정: 날짜 문자열이 [from, to] 구간에 드는지 — 주간보고의 '이번 주'/'다음 주' 스코프
  const within = (s: string | undefined, from: Date, to: Date) => {
    if (!s) return false;
    const t = new Date(s).getTime();
    if (Number.isNaN(t)) return false;
    return t >= from.getTime() && t <= to.getTime();
  };
  const inWeek = (s?: string) => within(s, mon, sun);
  const inNextWeek = (s?: string) => within(s, nMon, nSun);

  const isDone = (t: any) => t.status === 'done';
  const doneAll = tasks.filter(isDone);
  // '이번 주 완료' = 마감일(없으면 최종 수정일)이 이번 주에 드는 완료 업무.
  // 종전에는 전체 완료 업무가 그대로 노출돼 주간보고가 사실상 누적보고가 되던 결함을 바로잡음.
  const doneWeek = doneAll.filter((t) => inWeek(t.endDate) || (!t.endDate && inWeek(t.updatedAt)));
  const doing = tasks.filter((t) => t.status === 'doing');
  // '다음 주 예정' = 미완료·비진행 업무 중 시작일 또는 마감일이 다음 주에 걸리는 것
  const nextWeek = tasks.filter((t) => !isDone(t) && t.status !== 'doing' && (inNextWeek(t.endDate) || inNextWeek(t.startDate)));
  const overdue = tasks.filter((t) => !isDone(t) && t.endDate && new Date(t.endDate).getTime() < Date.now());
  const openIssues = issues.filter((i) => i.status !== 'resolved' && i.status !== 'closed');
  const weekIssues = openIssues.filter((i) => inWeek(i.createdAt));
  const highRisks = risks.filter((r) => r.level === 'high');
  const pct = sum?.tasks?.avgProgress ?? 0;

  if (!pid) return <Shell title="주간보고"><div className="card card-pad muted">상단에서 프로젝트를 선택하면 주간보고가 생성됩니다.</div></Shell>;

  const Block = ({ icon: Icon, title, color, items, note, empty, render }: any) => (
    <div className="card" style={{ overflow: 'hidden', marginBottom: 16 }}>
      <div className="row" style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 750, fontSize: 13.5 }}><Icon style={{ width: 15, color }} />{title}</div>
        <span className="muted" style={{ marginLeft: 8, fontSize: 12 }}>{items.length}건</span>
        <div className="sp" />
        {note && <span className="muted" style={{ fontSize: 11.5 }}>{note}</span>}
      </div>
      <div style={{ padding: items.length ? '6px 8px' : 16 }}>
        {items.length === 0 ? <div className="muted" style={{ fontSize: 13 }}>{empty || '해당 항목 없음'}</div> :
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
          <div title={`이번 주(${ymd(mon)} ~ ${ymd(sun)}) 마감 기준 완료 ${doneWeek.length}건`}><div style={{ fontSize: 12, opacity: .85 }}>이번 주 완료</div><div style={{ fontSize: 26, fontWeight: 800 }}>{doneWeek.length}</div></div>
          <div title={`전체 업무 ${tasks.length}건 중 누적 완료 ${doneAll.length}건`}><div style={{ fontSize: 12, opacity: .85 }}>누적 완료</div><div style={{ fontSize: 26, fontWeight: 800 }}>{doneAll.length}<span style={{ fontSize: 15, opacity: .8 }}>/{tasks.length}</span></div></div>
          <div><div style={{ fontSize: 12, opacity: .85 }}>진행중</div><div style={{ fontSize: 26, fontWeight: 800 }}>{doing.length}</div></div>
          <div title={overdue.length ? `마감이 지난 미완료 업무 ${overdue.length}건` : '지연 업무 없음'}><div style={{ fontSize: 12, opacity: .85 }}>지연 업무</div><div style={{ fontSize: 26, fontWeight: 800, color: overdue.length ? '#ffe08a' : undefined }}>{overdue.length}</div></div>
          <div title={weekIssues.length ? `미결 이슈 ${openIssues.length}건 (이번 주 신규 ${weekIssues.length}건)` : `미결 이슈 ${openIssues.length}건`}><div style={{ fontSize: 12, opacity: .85 }}>미결 이슈</div><div style={{ fontSize: 26, fontWeight: 800 }}>{openIssues.length}</div></div>
          <div><div style={{ fontSize: 12, opacity: .85 }}>High 리스크</div><div style={{ fontSize: 26, fontWeight: 800 }}>{highRisks.length}</div></div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
        <div>
          <Block icon={CheckCircle2} title="이번 주 완료" color="#2f8f5b" items={doneWeek}
            note={`${md(mon)} ~ ${md(sun)} · 누적 ${doneAll.length}건`}
            empty="이번 주 마감·완료된 업무가 없습니다. (누적 완료는 상단 KPI 참조)"
            render={(r: any) => (<><span className="mono" style={{ fontSize: 11.5, color: 'var(--text-3)', minWidth: 66 }}>{r.code}</span><span style={{ flex: 1, fontSize: 13 }}>{r.name}</span><span className="muted" style={{ fontSize: 11 }}>{r.endDate || ''}</span><span className="muted" style={{ fontSize: 11.5 }}>{r.assignee || ''}</span></>)} />
          <Block icon={Clock} title="진행중" color="#be5535" items={doing} empty="진행중인 업무가 없습니다."
            render={(r: any) => (<><span className="mono" style={{ fontSize: 11.5, color: 'var(--text-3)', minWidth: 66 }}>{r.code}</span><span style={{ flex: 1, fontSize: 13 }}>{r.name}</span><span style={{ fontSize: 11.5, fontWeight: 700 }}>{r.progress || 0}%</span><span className="muted" style={{ fontSize: 11 }}>{r.endDate || ''}</span></>)} />
          <Block icon={CalendarRange} title="다음 주 예정" color="#0e9bb8" items={nextWeek}
            note={`${md(nMon)} ~ ${md(nSun)}`}
            empty="다음 주에 시작·마감되는 업무가 없습니다."
            render={(r: any) => (<><span className="mono" style={{ fontSize: 11.5, color: 'var(--text-3)', minWidth: 66 }}>{r.code}</span><span style={{ flex: 1, fontSize: 13 }}>{r.name}</span><span className="muted" style={{ fontSize: 11 }}>{r.startDate || ''}{r.endDate ? ` ~ ${r.endDate}` : ''}</span><span className="muted" style={{ fontSize: 11.5 }}>{r.assignee || ''}</span></>)} />
        </div>
        <div>
          <Block icon={AlertTriangle} title="지연 업무 (마감 초과)" color="#c0414f" items={overdue} empty="지연된 업무가 없습니다."
            render={(r: any) => (<><span className="mono" style={{ fontSize: 11.5, color: 'var(--text-3)', minWidth: 66 }}>{r.code}</span><span style={{ flex: 1, fontSize: 13 }}>{r.name}</span><span style={{ fontSize: 11, color: '#c0414f', fontWeight: 700 }}>{r.endDate}</span></>)} />
          <Block icon={Bug} title="미결 이슈" color="#d98a16" items={openIssues}
            note={weekIssues.length ? `이번 주 신규 ${weekIssues.length}건` : undefined}
            empty="미결 이슈가 없습니다."
            render={(r: any) => (<><span className="mono" style={{ fontSize: 11.5, color: 'var(--text-3)', minWidth: 66 }}>{r.code}</span><span style={{ flex: 1, fontSize: 13 }}>{r.title}</span>{inWeek(r.createdAt) && <span className="pill p-blue" style={{ fontSize: 10.5 }} title="이번 주 등록된 이슈">신규</span>}<Pill v={r.priority} /></>)} />
          <Block icon={ShieldAlert} title="주요 리스크 (High)" color="#c0414f" items={highRisks} empty="High 등급 리스크가 없습니다."
            render={(r: any) => (<><span className="mono" style={{ fontSize: 11.5, color: 'var(--text-3)', minWidth: 66 }}>{r.code}</span><span style={{ flex: 1, fontSize: 13 }}>{r.title}</span><span className="muted" style={{ fontSize: 11.5 }}>{r.owner || ''}</span></>)} />
        </div>
      </div>
    </Shell>
  );
}
