'use client';
import { useEffect, useState } from 'react';
import { ResourceView } from '@/components/ResourceView';

type Stat = { total: number; done: number; doing: number; todo: number; overdue: number; open: number; issues: number };
const empty = (): Stat => ({ total: 0, done: 0, doing: 0, todo: 0, overdue: 0, open: 0, issues: 0 });

export default function Page() {
  // projectId 없이 호출하면 조직 전체를 돌려주므로 담당자(assignee=인력 이름) 기준으로 집계한다(읽기 전용)
  const [stats, setStats] = useState<Record<string, Stat>>({});
  const [maxOpen, setMaxOpen] = useState(0);
  useEffect(() => {
    Promise.all([
      fetch('/api/tasks').then((r) => (r.ok ? r.json() : [])).catch(() => []),
      fetch('/api/issues').then((r) => (r.ok ? r.json() : [])).catch(() => []),
    ])
      .then(([ts, iss]: any[]) => {
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const m: Record<string, Stat> = {};
        if (Array.isArray(ts)) for (const t of ts) {
          const k = String(t?.assignee || '').trim();
          if (!k) continue;
          const s = (m[k] ||= empty());
          s.total++;
          const st = String(t?.status || 'todo');
          if (st === 'done') s.done++;
          else if (st === 'doing') s.doing++;
          else s.todo++;
          if (st !== 'done') {
            s.open++;
            if (t?.endDate) { const e = new Date(t.endDate); e.setHours(0, 0, 0, 0); if (e.getTime() < today.getTime()) s.overdue++; }
          }
        }
        if (Array.isArray(iss)) for (const i of iss) {
          const k = String(i?.assignee || '').trim();
          if (!k) continue;
          const st = String(i?.status || 'open');
          if (st === 'resolved' || st === 'closed') continue; // 미해결 이슈만 부하로 본다
          (m[k] ||= empty()).issues++;
        }
        setStats(m);
        setMaxOpen(Math.max(0, ...Object.values(m).map((s) => s.open)));
      })
      .catch(() => {});
  }, []);

  const statOf = (row: any): Stat | undefined => stats[String(row?.name || '').trim()];

  return <ResourceView title="인력" subtitle="조직 인력 명부입니다." endpoint="/api/members" entity="members" statusKey="role"
    columns={[
      {key:'code',label:'코드'},
      {key:'name',label:'이름',strong:true},
      {key:'company',label:'소속'},
      {key:'position',label:'직책'},
      {key:'role',label:'역할',badge:true},
      {key:'memTasks',label:'업무',render:(_v,row)=>{
        const s = statOf(row);
        if (!s || !s.total) return <span className="muted" style={{fontSize:11.5}}>—</span>;
        return <span title={`총 ${s.total}건 · 완료 ${s.done}건 · 진행 ${s.doing}건 · 대기 ${s.todo}건`} style={{fontSize:12,cursor:'help'}}>
          <b>{s.done}</b><span className="muted">/{s.total}</span>
          {s.overdue > 0 && <span title={`기한 초과 ${s.overdue}건`} style={{marginLeft:6,color:'#c0414f',fontWeight:700,fontSize:11.5}}>⚠{s.overdue}</span>}
        </span>;
      }},
      {key:'memLoad',label:'부하',render:(_v,row)=>{
        const s = statOf(row);
        if (!s || !s.open) return <span className="muted" style={{fontSize:11.5}}>여유</span>;
        // 절대 기준이 없으므로 조직 내 최다 미완료 담당자를 100%로 놓은 상대 부하로 표시
        const pct = maxOpen ? Math.max(6, Math.round((s.open / maxOpen) * 100)) : 0;
        const col = s.overdue > 0 ? '#c0414f' : s.open >= 5 ? '#d98a16' : '#2f8f5b';
        return <div className="row" style={{gap:8}} title={`미완료 업무 ${s.open}건 (진행 ${s.doing} · 대기 ${s.todo})${s.overdue ? ` · 기한 초과 ${s.overdue}건` : ''} — 조직 최다 담당자 대비 ${pct}%`}>
          <div className="bar"><i style={{width:`${pct}%`,background:col}}/></div>
          <span style={{fontSize:11.5,color:col,fontWeight:700}}>{s.open}건</span>
        </div>;
      }},
      {key:'memIssues',label:'미해결 이슈',render:(_v,row)=>{
        const s = statOf(row);
        if (!s || !s.issues) return <span className="muted" style={{fontSize:11.5}}>—</span>;
        return <span title={`담당 미해결 이슈 ${s.issues}건 (해결·종료 제외)`} style={{fontSize:11.5,fontWeight:700,color:s.issues >= 3 ? '#c0414f' : '#d98a16',cursor:'help'}}>{s.issues}건</span>;
      }},
      {key:'email',label:'이메일'},
      {key:'phone',label:'연락처'},
    ]}
    fields={[{key:'name',label:'이름',required:true,half:true},{key:'role',label:'역할',type:'select',options:['PM','PMO','개발PL','개발자','인프라','DBA','QA'],half:true},{key:'company',label:'소속',half:true},{key:'position',label:'직책',type:'combo',half:true,options:['사원','대리','과장','차장','부장','수석','책임','선임','전임','대표']},{key:'email',label:'이메일',half:true},{key:'phone',label:'연락처',half:true}]} />;
}
