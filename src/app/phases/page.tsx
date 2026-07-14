'use client';
import { useEffect, useState } from 'react';
import { ResourceView } from '@/components/ResourceView';

type Stat = { total: number; done: number; doing: number; todo: number; overdue: number; progress: number };

export default function Page() {
  const [stats, setStats] = useState<Record<string, Stat>>({});
  useEffect(() => {
    const p = Number(localStorage.getItem('pms.project')) || null;
    if (!p) return;
    fetch(`/api/tasks?projectId=${p}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((ts: any[]) => {
        if (!Array.isArray(ts)) return;
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const m: Record<string, Stat> = {};
        const sum: Record<string, number> = {};
        for (const t of ts) {
          const k = String(t?.phase || '').trim();
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
        for (const [k, s] of Object.entries(m)) s.progress = s.total ? Math.round((sum[k] || 0) / s.total) : 0;
        setStats(m);
      })
      .catch(() => {});
  }, []);

  // 업무(tasks)의 '단계'(phase)는 단계명 문자열로 저장되므로 단계명(name) 우선, 없으면 코드(code)로 매칭
  const statOf = (row: any): Stat | undefined => stats[String(row?.name || '').trim()] || stats[String(row?.code || '').trim()];

  return <ResourceView title="단계" subtitle="프로젝트 단계를 정의합니다." endpoint="/api/phases" entity="phases" projectScoped
    emptyText="등록된 단계가 없습니다. 단계를 정의하면 업무(WBS)의 '단계' 필드로 묶여 간트 스와이레인·단계별 진척이 집계됩니다."
    columns={[
      {key:'code',label:'코드'},
      {key:'name',label:'단계',strong:true},
      {key:'tasks',label:'업무',render:(_v,row)=>{
        const s = statOf(row);
        const st = String(row?.status || 'planned');
        // 단계에 업무가 하나도 안 묶인 경우: 업무의 '단계' 필드 값이 단계명과 정확히 일치해야 매칭된다
        if (!s || !s.total) {
          if (st === 'planned') return <span className="muted" title="아직 이 단계로 지정된 업무가 없습니다(계획 단계)">—</span>;
          return <span title={`상태가 ‘${st === 'done' ? '완료' : '진행'}’인데 이 단계로 묶인 업무가 0건입니다 — 업무의 ‘단계’ 필드에 단계명 “${String(row?.name || '')}”을 그대로 넣어야 매칭됩니다`} style={{color:'#c0414f',fontWeight:700,fontSize:11.5,cursor:'help'}}>⚠ 업무 없음</span>;
        }
        const rest = s.total - s.done;
        return <span title={`총 ${s.total}건 · 완료 ${s.done}건 · 진행 ${s.doing}건 · 대기 ${s.todo}건`} style={{fontSize:12,cursor:'help',whiteSpace:'nowrap'}}>
          <b>{s.done}</b><span className="muted">/{s.total}</span>
          {st === 'done' && rest > 0 && <span title={`단계는 완료인데 미완료 업무가 ${rest}건 남아 있습니다 (진행 ${s.doing} · 대기 ${s.todo}) — 종료 처리만 하고 하위 업무를 정리하지 않은 상태입니다`} style={{marginLeft:6,color:'#c0414f',fontWeight:700,fontSize:11}}>⚠ 잔여 {rest}</span>}
          {st !== 'done' && s.overdue > 0 && <span title={`기한 초과 ${s.overdue}건`} style={{marginLeft:6,color:'#c0414f',fontWeight:700,fontSize:11.5}}>⚠{s.overdue}</span>}
        </span>;
      }},
      {key:'phaseProgress',label:'진척',render:(_v,row)=>{
        const s = statOf(row);
        const st = String(row?.status || 'planned');
        if (!s || !s.total) return <span className="muted" style={{fontSize:11.5}}>업무 없음</span>;
        const pct = Math.max(0, Math.min(100, s.progress));
        const col = pct >= 80 ? '#2f8f5b' : pct >= 50 ? '#d98a16' : '#c0414f';
        // 단계 상태 ↔ 하위 업무 진척 모순
        const warnDone = st === 'done' && pct < 100;
        const warnPlan = st === 'planned' && (s.doing > 0 || s.done > 0);
        const tip = `업무 ${s.total}건 평균 진척 ${pct}%`
          + (warnDone ? ` — 단계는 완료인데 평균 진척이 100% 미만입니다(업무 진척률 갱신 필요)` : '')
          + (warnPlan ? ` — 단계는 ‘계획’인데 이미 착수·완료된 업무가 있습니다(단계 상태를 ‘진행’으로 바꾸세요)` : '');
        return <div className="row" style={{gap:8,whiteSpace:'nowrap',cursor:'help'}} title={tip}>
          <div className="bar"><i style={{width:`${pct}%`,background:col}}/></div>
          <span style={{fontSize:11.5,color:col,fontWeight:700}}>{pct}%</span>
          {warnDone && <span style={{color:'#c0414f',fontWeight:700,fontSize:11}}>⚠ 진척 미갱신</span>}
          {warnPlan && <span style={{color:'#d98a16',fontWeight:700,fontSize:11}}>착수됨</span>}
        </div>;
      }},
      {key:'status',label:'상태',badge:true},
    ]}
    fields={[{key:'name',label:'단계명',required:true,type:'combo',options:['착수','요구사항 분석','분석/설계','설계','구현/개발','단위 테스트','통합 테스트','시스템 테스트','이행/전개','안정화','검수','운영/유지보수','완료'],placeholder:'선택하거나 직접 입력',hint:'업무(WBS)의 ‘단계’ 필드에 여기 단계명을 그대로 넣어야 묶입니다'},{key:'status',label:'상태',type:'select',half:true,options:[{value:'planned',label:'계획'},{value:'in_progress',label:'진행'},{value:'done',label:'완료'}]},{key:'color',label:'색상',type:'select',half:true,options:['파랑','초록','주황','빨강','보라','회색']}]} />;
}
