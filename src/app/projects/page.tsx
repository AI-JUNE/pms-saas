'use client';
import { useEffect, useState } from 'react';
import { ResourceView } from '@/components/ResourceView';

type Stat = { total: number; done: number; doing: number; todo: number; overdue: number; progress: number };

const DAY = 86400000;
const d0 = (v: any) => { const t = new Date(v); if (isNaN(t.getTime())) return null; t.setHours(0, 0, 0, 0); return t; };
const fmt = (v: any) => { const t = d0(v); return t ? `${t.getMonth() + 1}.${t.getDate()}` : '—'; };

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

  // 일정 경과율: 시작~종료 구간에서 오늘이 어디쯤인지(= 계획 진척의 근사치, EVM의 PV 개념)
  const elapsed = (row: any): { pct: number; left: number; over: number; days: number } | null => {
    const s = d0(row?.startDate); const e = d0(row?.endDate);
    if (!s || !e || e.getTime() < s.getTime()) return null;
    const now = new Date(); now.setHours(0, 0, 0, 0);
    const days = Math.max(1, Math.round((e.getTime() - s.getTime()) / DAY));
    const gone = Math.round((now.getTime() - s.getTime()) / DAY);
    const pct = Math.max(0, Math.min(100, Math.round((gone / days) * 100)));
    const diff = Math.round((e.getTime() - now.getTime()) / DAY);
    return { pct, left: diff > 0 ? diff : 0, over: diff < 0 ? -diff : 0, days };
  };

  return <ResourceView title="프로젝트" subtitle="조직 내 프로젝트를 관리합니다." endpoint="/api/projects" entity="projects" rowHref={(r)=>`/projects/${r.id}`}
    emptyText="아직 등록된 프로젝트가 없습니다. “새로 만들기”로 첫 프로젝트를 추가하세요."
    columns={[
      {key:'code',label:'코드'},
      {key:'name',label:'이름',strong:true},
      {key:'client',label:'고객',render:(v,row)=>{
        const active = String(row?.status || '') === 'active';
        if (!v) return <span title={active ? '고객사가 지정되지 않았습니다 — 계약·보고 문서의 수신처가 비게 됩니다' : undefined} style={{fontSize:11.5,color:active?'#d98a16':undefined}} className={active?undefined:'muted'}>미지정</span>;
        return <span>{v}</span>;
      }},
      {key:'period',label:'기간',render:(_v,row)=>{
        const el = elapsed(row);
        const s = d0(row?.startDate); const e = d0(row?.endDate);
        if (!s || !e) return <span className="muted" style={{fontSize:11.5}} title="시작일·종료일을 모두 입력하면 일정 경과율과 잔여 기간을 계산합니다">기간 미설정</span>;
        if (!el) return <span className="muted" style={{fontSize:11.5}}>{fmt(s)} ~ {fmt(e)}</span>;
        const done = String(row?.status || '') !== 'active';
        // 종료(완료·보관) 프로젝트는 잔여 기간 경보를 내지 않는다
        const col = done ? '#9a9a9a' : el.over > 0 ? '#c0414f' : el.left <= 14 ? '#d98a16' : '#2f8f5b';
        const dtxt = done ? `${el.days}일` : el.over > 0 ? `${el.over}일 초과` : el.left === 0 ? '오늘 마감' : `D-${el.left}`;
        const tip = `${fmt(s)} ~ ${fmt(e)} · 총 ${el.days}일\n일정 경과 ${el.pct}%` + (done ? '\n종료된 프로젝트 — 잔여 기간 경보 없음' : el.over > 0 ? `\n종료일이 ${el.over}일 지났는데 상태가 '진행'입니다 — 종료 처리 또는 기간 연장이 필요합니다` : `\n잔여 ${el.left}일`);
        return <div className="row" style={{gap:8,alignItems:'center'}} title={tip}>
          <span style={{fontSize:11.5,color:'var(--text-3)',whiteSpace:'nowrap',fontVariantNumeric:'tabular-nums'}}>{fmt(s)}~{fmt(e)}</span>
          <div className="bar" style={{minWidth:44}}><i style={{width:`${el.pct}%`,background:col}}/></div>
          <span style={{fontSize:11,color:col,fontWeight:700,whiteSpace:'nowrap'}}>{dtxt}{!done && el.over > 0 ? ' ⚠' : ''}</span>
        </div>;
      }},
      {key:'tasks',label:'업무',render:(_v,row)=>{
        const s = statOf(row);
        const closed = ['completed','archived'].includes(String(row?.status || ''));
        if (!s || !s.total) return <span className="muted" style={{fontSize:11.5}} title="이 프로젝트에 등록된 업무(WBS)가 없습니다">—</span>;
        const left = s.total - s.done;
        return <span title={`총 ${s.total}건 · 완료 ${s.done}건 · 진행 ${s.doing}건 · 대기 ${s.todo}건`} style={{fontSize:12,cursor:'help'}}>
          <b>{s.done}</b><span className="muted">/{s.total}</span>
          {s.overdue > 0 && !closed && <span title={`기한 초과 ${s.overdue}건`} style={{marginLeft:6,color:'#c0414f',fontWeight:700,fontSize:11.5}}>⚠{s.overdue}</span>}
          {closed && left > 0 && <span title={`프로젝트가 종료 상태인데 미완료 업무가 ${left}건 남아 있습니다 — 업무를 완료 처리하거나 이관하세요`} style={{marginLeft:6,color:'#c0414f',fontWeight:700,fontSize:11}}>⚠ 잔여 {left}</span>}
        </span>;
      }},
      {key:'projProgress',label:'진척',render:(_v,row)=>{
        const s = statOf(row);
        if (!s || !s.total) return <span className="muted" style={{fontSize:11.5}}>업무 없음</span>;
        const pct = Math.max(0, Math.min(100, s.progress));
        const col = pct >= 80 ? '#2f8f5b' : pct >= 50 ? '#d98a16' : '#c0414f';
        // 일정 경과율(계획 근사)과 실적 진척의 괴리 — 스냅샷(기성고) 화면의 SV 규칙과 동일한 임계값(±10%p)
        const el = elapsed(row);
        const active = String(row?.status || '') === 'active';
        const sv = el && active ? Math.round((pct - el.pct) * 10) / 10 : null;
        const behind = sv !== null && sv <= -10;
        const tip = `업무 ${s.total}건 평균 진척 ${pct}%` + (el && active ? `\n일정 경과 ${el.pct}% (계획 진척 근사)\n${sv !== null && sv < 0 ? `일정 대비 ${Math.abs(sv)}%p 지연` : sv !== null && sv > 0 ? `일정 대비 ${sv}%p 선행` : '일정대로 진행'}` : '');
        return <div className="row" style={{gap:8,alignItems:'center'}} title={tip}>
          <div className="bar"><i style={{width:`${pct}%`,background:col}}/></div>
          <span style={{fontSize:11.5,color:col,fontWeight:700,fontVariantNumeric:'tabular-nums'}}>{pct}%</span>
          {behind && <span style={{fontSize:10.5,padding:'1px 6px',borderRadius:999,background:'#fdecee',color:'#c0414f',border:'1px solid #f3d2d7',whiteSpace:'nowrap',fontWeight:700}}>지연 {Math.abs(sv as number)}%p</span>}
        </div>;
      }},
      {key:'budget',label:'계약금액',render:(v,row)=>{
        const n = Number(v);
        const active = String(row?.status || '') === 'active';
        if (!v || !Number.isFinite(n) || n <= 0) return <span title={active ? '계약금액이 없어 기성·정산 집계에서 제외됩니다' : undefined} style={{fontSize:11.5,color:active?'#d98a16':undefined}} className={active?undefined:'muted'}>{active ? '⚠ 미입력' : '—'}</span>;
        const eok = n >= 100000000 ? `${Math.round((n / 100000000) * 10) / 10}억원` : n >= 10000 ? `${Math.round(n / 10000).toLocaleString()}만원` : `${n.toLocaleString()}원`;
        return <span title={`${n.toLocaleString()}원`} style={{fontVariantNumeric:'tabular-nums',cursor:'help',whiteSpace:'nowrap'}}>{eok}</span>;
      }},
      {key:'status',label:'상태',badge:true},
    ]}
    fields={[{key:'name',label:'프로젝트명',required:true},{key:'client',label:'고객',half:true,hint:'계약·보고 문서의 수신처로 쓰입니다'},{key:'orderer',label:'발주처',half:true},{key:'contractNo',label:'계약번호',half:true},{key:'budget',label:'계약금액(원)',type:'number',comma:true,half:true,numeric:true,placeholder:'예: 850000000',hint:'원 단위로 입력 — 기성·정산 집계의 분모가 됩니다'},{key:'status',label:'상태',type:'select',options:[{value:'active',label:'진행'},{value:'completed',label:'완료'},{value:'archived',label:'보관'}],half:true},{key:'startDate',label:'시작일',type:'date',half:true,hint:'시작·종료일이 있어야 일정 경과율(계획 진척)을 계산합니다'},{key:'endDate',label:'종료일',type:'date',half:true}]} />;
}
