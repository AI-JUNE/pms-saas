'use client';
import { useEffect, useState } from 'react';
import { ResourceView } from '@/components/ResourceView';

type Stat = { total: number; pass: number; fail: number; blocked: number; na: number; rate: number | null };

const lines = (v: any): string[] =>
  String(v || '')
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*(?:[-*·•]|\d+[.)])\s*/, '').trim())
    .filter(Boolean);
const md = (v: any) => {
  const s = String(v || '');
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${Number(m[2])}.${Number(m[3])}` : s;
};

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
    emptyText="등록된 테스트 차수가 없습니다. 1차·2차·회귀 등 회차를 만들고 테스트의 '차수' 필드로 묶어주세요."
    columns={[
      {key:'code',label:'코드'},
      {key:'name',label:'차수명',strong:true},
      {key:'cycGoal',label:'목표·범위',render:(_v,row)=>{
        const ls = lines(row?.goal);
        const status = String(row?.status || 'planned');
        if (!ls.length) {
          if (status !== 'planned') return <span title="진행·완료된 차수인데 목표·범위가 비어 있습니다 — 무엇을 어디까지 검증했는지 증빙이 없습니다" style={{color:'#c0414f',fontWeight:700,fontSize:11.5,cursor:'help'}}>⚠ 범위 미작성</span>;
          return <span className="muted" style={{fontSize:11.5}}>미작성</span>;
        }
        const tip = ls.slice(0,8).map((l,i)=>`${i+1}. ${l}`).join('\n') + (ls.length>8?`\n… 외 ${ls.length-8}줄`:'');
        return <div className="row" title={tip} style={{gap:6,cursor:'help',maxWidth:240,whiteSpace:'nowrap'}}>
          <span className="label-chip" style={{color:'#be5535',fontSize:11}}>{ls.length}줄</span>
          <span className="muted" style={{fontSize:11.5,overflow:'hidden',textOverflow:'ellipsis'}}>{ls[0]}</span>
        </div>;
      }},
      {key:'cycPeriod',label:'기간',render:(_v,row)=>{
        const s0 = String(row?.startDate || '').trim();
        const e0 = String(row?.endDate || '').trim();
        const status = String(row?.status || 'planned');
        if (!s0 && !e0) return <span title="기간이 없으면 지연 판정·일정 집계에서 제외됩니다" style={{color:status==='planned'?undefined:'#d98a16',fontSize:11.5,cursor:'help'}} className={status==='planned'?'muted':undefined}>기간 미설정</span>;
        const st = s0 ? new Date(s0).getTime() : NaN;
        const en = e0 ? new Date(e0).getTime() : NaN;
        const now = Date.now();
        const done = status === 'done';
        // 경과율: 시작~종료 구간에서 오늘의 위치(계획 진척 근사)
        let pct: number | null = null;
        if (!isNaN(st) && !isNaN(en) && en > st) pct = Math.max(0, Math.min(100, Math.round(((now - st) / (en - st)) * 100)));
        const over = !done && !isNaN(en) && en < now;
        const od = over ? Math.floor((now - en) / 86400000) : 0;
        const dd = !done && !isNaN(en) && en >= now ? Math.ceil((en - now) / 86400000) : null;
        const col = done ? '#94a3b8' : over ? '#c0414f' : dd != null && dd <= 7 ? '#d98a16' : '#2f8f5b';
        const tip = [
          s0 ? `시작 ${s0}` : '시작일 미설정',
          e0 ? `종료 ${e0}` : '종료일 미설정',
          pct != null ? `일정 경과 ${pct}%` : null,
          done ? '완료된 차수' : over ? `종료일 ${od >= 1 ? `${od}일 ` : ''}경과 — 차수를 완료 처리하거나 기간을 연장하세요` : dd != null ? (dd <= 0 ? '오늘 종료' : `D-${dd}`) : null,
        ].filter(Boolean).join(' · ');
        return <div className="row" title={tip} style={{gap:8,cursor:'help',whiteSpace:'nowrap',opacity:done?0.7:1}}>
          <span style={{fontSize:11.5,fontVariantNumeric:'tabular-nums'}}>{md(s0) || '—'}<span className="muted">~</span>{md(e0) || '—'}</span>
          {pct != null && <div className="bar" style={{width:40,minWidth:40}}><i style={{width:`${pct}%`,background:col}}/></div>}
          {!done && over && <span style={{color:'#c0414f',fontWeight:700,fontSize:11}}>{od >= 1 ? `${od}일 초과 ⚠` : '오늘 종료'}</span>}
          {!done && !over && dd != null && dd <= 7 && <span style={{color:'#d98a16',fontWeight:700,fontSize:11}}>{dd <= 0 ? '오늘 종료' : `D-${dd}`}</span>}
        </div>;
      }},
      {key:'cases',label:'케이스',render:(_v,row)=>{
        const s = statOf(row);
        const status = String(row?.status || 'planned');
        if (!s || !s.total) {
          if (status !== 'planned') return <span title="진행·완료된 차수인데 이 차수에 묶인 테스트 케이스가 없습니다 — 테스트 화면의 '차수' 필드를 이 차수명으로 지정하세요" style={{color:'#c0414f',fontWeight:700,fontSize:11.5,cursor:'help'}}>⚠ 케이스 없음</span>;
          return <span className="muted" title="아직 이 차수에 묶인 테스트가 없습니다">—</span>;
        }
        const ran = s.pass + s.fail + s.blocked;
        const leftOver = status === 'done' && s.na > 0;
        return <span title={`총 ${s.total}건 · 실행 ${ran}건 · 미실행 ${s.na}건${leftOver ? ' — 완료된 차수인데 미실행 케이스가 남아 있습니다' : ''}`} style={{fontSize:12,cursor:'help',whiteSpace:'nowrap'}}>
          <b>{ran}</b><span className="muted">/{s.total}</span>
          {leftOver && <span style={{marginLeft:6,color:'#c0414f',fontWeight:700,fontSize:11.5}}>⚠ 미실행 {s.na}</span>}
        </span>;
      }},
      {key:'passRate',label:'통과율',render:(_v,row)=>{
        const s = statOf(row);
        const status = String(row?.status || 'planned');
        if (!s || s.rate === null) {
          if (s && s.total && status !== 'planned') return <span title={`케이스 ${s.total}건이 모두 미실행입니다 — 차수는 ${status === 'done' ? '완료' : '진행'} 상태입니다`} style={{color:'#c0414f',fontWeight:700,fontSize:11.5,cursor:'help'}}>⚠ 미실행</span>;
          return <span className="muted" style={{fontSize:11.5}}>미실행</span>;
        }
        const pct = Math.min(100, s.rate);
        const col = pct >= 80 ? '#2f8f5b' : pct >= 50 ? '#d98a16' : '#c0414f';
        return <div className="row" style={{gap:8,cursor:'help',whiteSpace:'nowrap'}} title={`통과 ${s.pass} · 실패 ${s.fail} · 블록 ${s.blocked} · 미실행 ${s.na} — 통과율은 실행된 ${s.pass + s.fail + s.blocked}건 기준`}>
          <div className="bar"><i style={{width:`${pct}%`,background:col}}/></div>
          <span style={{fontSize:11.5,color:col,fontWeight:700,fontVariantNumeric:'tabular-nums'}}>{pct}%</span>
          {s.fail > 0 && <span title={`실패 ${s.fail}건 — 결함 조치 후 재실행이 필요합니다`} style={{color:'#c0414f',fontWeight:700,fontSize:11}}>⚠{s.fail}</span>}
          {s.blocked > 0 && <span title={`블록 ${s.blocked}건 — 선행 조건 미충족으로 실행되지 못한 케이스`} style={{color:'#d98a16',fontWeight:700,fontSize:11}}>■{s.blocked}</span>}
        </div>;
      }},
      {key:'status',label:'상태',badge:true},
    ]}
    fields={[
      {key:'name',label:'차수명',required:true,placeholder:'예: 1차 통합테스트',hint:'테스트 화면의 \'차수\' 필드에 같은 이름을 넣으면 이 차수로 묶입니다'},
      {key:'goal',label:'목표·범위',type:'textarea',hint:'한 줄에 항목 하나씩 — 검증 대상 기능·제외 범위·합격 기준 등'},
      {key:'status',label:'상태',type:'select',half:true,options:[{value:'planned',label:'계획'},{value:'active',label:'진행'},{value:'done',label:'완료'}]},
      {key:'startDate',label:'시작일',type:'date',half:true},
      {key:'endDate',label:'종료일',type:'date',half:true,hint:'종료일이 지났는데 진행 상태면 목록에 초과일수가 표시됩니다'},
    ]} />;
}
