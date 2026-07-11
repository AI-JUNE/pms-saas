'use client';
import { useEffect, useState } from 'react';
import { ResourceView } from '@/components/ResourceView';

type Stat = { total: number; pass: number; fail: number; blocked: number; na: number; rate: number | null };

export default function Page() {
  const [stats, setStats] = useState<Record<string, Stat>>({});
  useEffect(() => {
    const p = Number(localStorage.getItem('pms.project')) || null;
    if (!p) return;
    fetch(`/api/tests?projectId=${p}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((ts: any[]) => {
        if (!Array.isArray(ts)) return;
        const m: Record<string, Stat> = {};
        for (const t of ts) {
          const k = String(t?.cycle || '').trim();
          if (!k) continue;
          const s = (m[k] ||= { total: 0, pass: 0, fail: 0, blocked: 0, na: 0, rate: null });
          s.total++;
          const r = String(t?.result || 'na');
          if (r === 'pass') s.pass++;
          else if (r === 'fail') s.fail++;
          else if (r === 'blocked') s.blocked++;
          else s.na++;
        }
        for (const s of Object.values(m)) {
          const ran = s.pass + s.fail + s.blocked;
          s.rate = ran ? Math.round((s.pass / ran) * 100) : null;
        }
        setStats(m);
      })
      .catch(() => {});
  }, []);

  // 테스트의 '차수'(cycle)는 자유 문자열(콤보)이라 차수명(name) 우선, 없으면 코드(code)로 매칭
  const statOf = (row: any): Stat | undefined => stats[String(row?.name || '').trim()] || stats[String(row?.code || '').trim()];

  return <ResourceView title="테스트 차수" subtitle="회차(1차·2차·회귀 등)별로 테스트를 묶어 계획·진행 상태를 관리합니다." endpoint="/api/test-cycles" entity="testCycles" projectScoped
    columns={[
      {key:'code',label:'코드'},
      {key:'name',label:'차수명',strong:true},
      {key:'goal',label:'목표'},
      {key:'startDate',label:'시작'},
      {key:'endDate',label:'종료'},
      {key:'cases',label:'케이스',render:(_v,row)=>{
        const s = statOf(row);
        if (!s || !s.total) return <span className="muted">—</span>;
        const done = s.pass + s.fail + s.blocked;
        return <span title={`총 ${s.total}건 · 실행 ${done}건 · 미실행 ${s.na}건`} style={{fontSize:12}}>
          <b>{done}</b><span className="muted">/{s.total}</span>
        </span>;
      }},
      {key:'passRate',label:'통과율',render:(_v,row)=>{
        const s = statOf(row);
        if (!s || s.rate === null) return <span className="muted" style={{fontSize:11.5}}>미실행</span>;
        const pct = Math.min(100, s.rate);
        const col = pct >= 80 ? '#2f8f5b' : pct >= 50 ? '#d98a16' : '#c0414f';
        return <div className="row" style={{gap:8}} title={`통과 ${s.pass} · 실패 ${s.fail} · 블록 ${s.blocked}`}>
          <div className="bar"><i style={{width:`${pct}%`,background:col}}/></div>
          <span style={{fontSize:11.5,color:col,fontWeight:700}}>{pct}%</span>
        </div>;
      }},
      {key:'status',label:'상태',badge:true},
    ]}
    fields={[
      {key:'name',label:'차수명',required:true,placeholder:'예: 1차 통합테스트'},
      {key:'goal',label:'목표·범위',type:'textarea'},
      {key:'status',label:'상태',type:'select',half:true,options:[{value:'planned',label:'계획'},{value:'active',label:'진행'},{value:'done',label:'완료'}]},
      {key:'startDate',label:'시작일',type:'date',half:true},
      {key:'endDate',label:'종료일',type:'date',half:true},
    ]} />;
}
