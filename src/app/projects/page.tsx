'use client';
import { useEffect, useState } from 'react';
import { ResourceView } from '@/components/ResourceView';

type Stat = { total: number; done: number; doing: number; todo: number; overdue: number; progress: number };

export default function Page() {
  const [stats, setStats] = useState<Record<number, Stat>>({});
  useEffect(() => {
    // projectId 없이 호출하면 조직 전체 업무를 돌려주므로 프로젝트별로 집계한다(읽기 전용)
    fetch('/api/tasks')
      .then((r) => (r.ok ? r.json() : []))
      .then((ts: any[]) => {
        if (!Array.isArray(ts)) return;
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const m: Record<number, Stat> = {};
        const sum: Record<number, number> = {};
        for (const t of ts) {
          const k = Number(t?.projectId);
          if (!k) continue;
          const s = (m[k] ||= { total: 0, done: 0, doing: 0, todo: 0, overdue: 0, progress: 0 });
          s.total++;
          const st = String(t?.status || 'todo');
          if (st === 'done') s.done++;
          else if (st === 'doing') s.doing++;
          else s.todo++;
          if (st !== 'done' && t?.endDate) {
            const e = new Date(t.endDate); e.setHours(0, 0, 0, 0);
            if (e.getTime() < today.getTime()) s.overdue++;
          }
          sum[k] = (sum[k] || 0) + (Number(t?.progress) || 0);
        }
        for (const [k, s] of Object.entries(m)) s.progress = s.total ? Math.round((sum[Number(k)] || 0) / s.total) : 0;
        setStats(m);
      })
      .catch(() => {});
  }, []);

  const statOf = (row: any): Stat | undefined => stats[Number(row?.id)];

  return <ResourceView title="프로젝트" subtitle="조직 내 프로젝트를 관리합니다." endpoint="/api/projects" entity="projects" rowHref={(r)=>`/projects/${r.id}`}
    columns={[
      {key:'code',label:'코드'},
      {key:'name',label:'이름',strong:true},
      {key:'client',label:'고객'},
      {key:'startDate',label:'시작'},
      {key:'endDate',label:'종료'},
      {key:'tasks',label:'업무',render:(_v,row)=>{
        const s = statOf(row);
        if (!s || !s.total) return <span className="muted">—</span>;
        return <span title={`총 ${s.total}건 · 완료 ${s.done}건 · 진행 ${s.doing}건 · 대기 ${s.todo}건`} style={{fontSize:12}}>
          <b>{s.done}</b><span className="muted">/{s.total}</span>
          {s.overdue > 0 && <span title={`기한 초과 ${s.overdue}건`} style={{marginLeft:6,color:'#c0414f',fontWeight:700,fontSize:11.5}}>⚠{s.overdue}</span>}
        </span>;
      }},
      {key:'projProgress',label:'진척',render:(_v,row)=>{
        const s = statOf(row);
        if (!s || !s.total) return <span className="muted" style={{fontSize:11.5}}>업무 없음</span>;
        const pct = Math.max(0, Math.min(100, s.progress));
        const col = pct >= 80 ? '#2f8f5b' : pct >= 50 ? '#d98a16' : '#c0414f';
        return <div className="row" style={{gap:8}} title={`업무 ${s.total}건 평균 진척 ${pct}%`}>
          <div className="bar"><i style={{width:`${pct}%`,background:col}}/></div>
          <span style={{fontSize:11.5,color:col,fontWeight:700}}>{pct}%</span>
        </div>;
      }},
      {key:'budget',label:'계약금액',render:(v)=> v ? Number(v).toLocaleString()+'원' : '—'},
      {key:'status',label:'상태',badge:true},
    ]}
    fields={[{key:'name',label:'프로젝트명',required:true},{key:'client',label:'고객',half:true},{key:'orderer',label:'발주처',half:true},{key:'contractNo',label:'계약번호',half:true},{key:'budget',label:'계약금액(원)',type:'number',half:true},{key:'status',label:'상태',type:'select',options:['active','completed','archived'],half:true},{key:'startDate',label:'시작일',type:'date',half:true},{key:'endDate',label:'종료일',type:'date',half:true}]} />;
}
