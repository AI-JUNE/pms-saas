'use client';
import { useEffect, useState } from 'react';
import { ResourceView } from '@/components/ResourceView';
import { LABEL } from '@/lib/ui';

function ReqAnalysis({ rows }: { rows: any[] }) {
  const count = (key: string, v: string) => rows.filter((r: any) => String(r?.[key] ?? '') === v).length;
  const Bar = ({ items, title }: any) => {
    const mx = Math.max(1, ...items.map((i: any) => i.v));
    return (
      <div><div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>{title}</div>
        {items.map((i: any) => (
          <div key={i.l} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 7 }}>
            <span style={{ width: 62, fontSize: 12, color: 'var(--text-2)' }}>{i.l}</span>
            <div className="pbar" style={{ flex: 1 }}><i style={{ width: `${(i.v / mx) * 100}%`, background: i.c }} /></div>
            <span style={{ width: 22, textAlign: 'right', fontWeight: 800, fontSize: 12.5 }}>{i.v}</span>
          </div>
        ))}
      </div>
    );
  };
  const total = rows.length;
  const approved = count('status', 'approved');
  const approvedPct = total ? Math.round((approved / total) * 100) : 0;
  return (
    <div style={{ background: 'var(--surface-1)', border: '1px solid var(--border)', borderRadius: 14, padding: '18px 20px' }}>
      <div style={{ fontWeight: 750, fontSize: 14, marginBottom: 4 }}>요구사항 분포 분석</div>
      <div className="muted" style={{ fontSize: 12, marginBottom: 14 }}>전체 {total}건 · 승인 {approved}건({approvedPct}%)</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: 24 }}>
        <Bar title="우선순위" items={[
          { l: LABEL.high, v: count('priority', 'high'), c: '#c0414f' },
          { l: LABEL.medium, v: count('priority', 'medium'), c: '#d98a16' },
          { l: LABEL.low, v: count('priority', 'low'), c: '#2f8f5b' },
        ]} />
        <Bar title="상태" items={[
          { l: LABEL.draft, v: count('status', 'draft'), c: '#8a8f98' },
          { l: LABEL.review, v: count('status', 'review'), c: '#2f6fdb' },
          { l: LABEL.approved, v: count('status', 'approved'), c: '#2f8f5b' },
          { l: LABEL.rejected, v: count('status', 'rejected'), c: '#c0414f' },
        ]} />
      </div>
    </div>
  );
}

// 요구사항 코드(code) 기준 연계 집계 — RTM(/rtm)과 동일한 매칭·커버리지 규칙
type Link = { tasks: number; tasksDone: number; issues: number; issuesOpen: number; tests: number; testsPass: number; testsFail: number };

export default function Page() {
  const [links, setLinks] = useState<Record<string, Link>>({});
  useEffect(() => {
    const p = Number(localStorage.getItem('pms.project')) || null;
    if (!p) return;
    Promise.all([
      fetch(`/api/tasks?projectId=${p}`).then((r) => (r.ok ? r.json() : [])),
      fetch(`/api/issues?projectId=${p}`).then((r) => (r.ok ? r.json() : [])),
      fetch(`/api/tests?projectId=${p}`).then((r) => (r.ok ? r.json() : [])),
    ]).then(([tk, is, ts]) => {
      const m: Record<string, Link> = {};
      const get = (c: string) => (m[c] ||= { tasks: 0, tasksDone: 0, issues: 0, issuesOpen: 0, tests: 0, testsPass: 0, testsFail: 0 });
      for (const t of Array.isArray(tk) ? tk : []) {
        const c = String(t?.reqCode || '').trim(); if (!c) continue;
        const l = get(c); l.tasks++; if (String(t?.status) === 'done') l.tasksDone++;
      }
      for (const i of Array.isArray(is) ? is : []) {
        const c = String(i?.reqCode || '').trim(); if (!c) continue;
        const l = get(c); l.issues++;
        const st = String(i?.status || '');
        if (st !== 'resolved' && st !== 'closed') l.issuesOpen++;
      }
      for (const t of Array.isArray(ts) ? ts : []) {
        const c = String(t?.reqCode || '').trim(); if (!c) continue;
        const l = get(c); l.tests++;
        if (String(t?.result) === 'pass') l.testsPass++;
        else if (String(t?.result) === 'fail') l.testsFail++;
      }
      setLinks(m);
    }).catch(() => {});
  }, []);

  const linkOf = (row: any): Link | undefined => links[String(row?.code || '').trim()];

  // RTM과 동일: 미연계 → (열린 이슈/테스트 실패)면 위험 → 업무 전부 완료 & 테스트 전부 통과면 충족 → 그 외 진행중
  const coverage = (l?: Link) => {
    if (!l || (!l.tasks && !l.issues && !l.tests)) return { t: '미연계', c: '#94a3b8' };
    if (l.testsFail > 0) return { t: '테스트 실패', c: '#c0414f' };
    if (l.issuesOpen > 0) return { t: '이슈 있음', c: '#c0414f' };
    const tasksOk = l.tasks === 0 || l.tasksDone === l.tasks;
    const testsOk = l.tests === 0 || l.testsPass === l.tests;
    if (tasksOk && testsOk) return { t: '충족', c: '#2f8f5b' };
    return { t: '진행중', c: '#be5535' };
  };

  return <ResourceView title="요구사항" subtitle="요구사항을 추적합니다." endpoint="/api/requirements" entity="requirements" projectScoped
    altViews={[{ key: 'analysis', label: '분석', render: (rows: any[]) => <ReqAnalysis rows={rows} /> }]}
    columns={[
      {key:'code',label:'코드'},
      {key:'title',label:'제목',strong:true},
      {key:'category',label:'분류'},
      {key:'priority',label:'우선순위',badge:true},
      {key:'status',label:'상태',badge:true},
      {key:'accept',label:'완료조건',render:(_v,row)=>{
        const parse=(x:any)=>String(x||'').split(/\r?\n/).map((l:string)=>l.replace(/^\s*[-*·•]\s*|^\s*\d+[.)]\s*/,'').trim()).filter(Boolean);
        const ac=parse(row?.acceptanceCriteria); const de=parse(row?.description);
        const st=String(row?.status||''); const gated=st==='review'||st==='approved';
        if(ac.length===0){
          if(gated) return <span title="결재 단계(검토·승인)에 올랐는데 완료조건(인수기준)이 비어 있습니다 — 검증 기준 없는 요구사항은 감리·검수 지적 대상입니다" style={{color:'#c0414f',fontWeight:700,fontSize:11.5,cursor:'help'}}>⚠ 완료조건 미작성</span>;
          return <span className="muted" style={{fontSize:11.5,cursor:'help'}} title={de.length?`설명 ${de.length}줄 · 완료조건 미작성`:'설명·완료조건 미작성'}>{de.length?`설명 ${de.length}줄`:'미작성'}</span>;
        }
        const tip=[`완료조건 ${ac.length}건`,...ac.slice(0,6).map((l:string,i:number)=>`${i+1}. ${l}`),de.length?`\n설명 ${de.length}줄: ${de[0]}`:''].filter(Boolean).join('\n');
        return <span style={{display:'inline-flex',alignItems:'center',gap:6,cursor:'help'}} title={tip}>
          <span style={{fontSize:10.5,fontWeight:700,background:'#e6f4ec',color:'#2f8f5b',padding:'1px 6px',borderRadius:5}}>조건 {ac.length}</span>
          {de.length>0 && <span style={{fontSize:11,color:'var(--text-2)',maxWidth:150,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{de[0]}</span>}
        </span>;
      }},
      {key:'reqLinks',label:'연계',render:(_v,row)=>{
        const l = linkOf(row);
        if (!l || (!l.tasks && !l.issues && !l.tests)) return <span className="muted" style={{fontSize:11.5}}>—</span>;
        const chip = (n: number, label: string, bg: string, fg: string, tip: string) => n > 0
          ? <span key={label} title={tip} style={{fontSize:10.5,fontWeight:700,background:bg,color:fg,padding:'1px 6px',borderRadius:5}}>{label} {n}</span>
          : null;
        return <span style={{display:'flex',flexWrap:'wrap',gap:4}}>
          {chip(l.tasks,'업무','var(--surface-3)','var(--text-2)',`연계 업무 ${l.tasks}건 · 완료 ${l.tasksDone}건`)}
          {chip(l.issues,'이슈', l.issuesOpen > 0 ? '#fdf3e7' : 'var(--surface-3)', l.issuesOpen > 0 ? '#b5730f' : 'var(--text-2)', `연계 이슈 ${l.issues}건 · 미해결 ${l.issuesOpen}건`)}
          {chip(l.tests,'테스트', l.testsFail > 0 ? '#fdedef' : l.tests > 0 && l.testsPass === l.tests ? '#e6f4ec' : 'var(--surface-3)', l.testsFail > 0 ? '#c0414f' : l.tests > 0 && l.testsPass === l.tests ? '#2f8f5b' : 'var(--text-2)', `연계 테스트 ${l.tests}건 · 통과 ${l.testsPass}건 · 실패 ${l.testsFail}건`)}
        </span>;
      }},
      {key:'coverage',label:'커버리지',render:(_v,row)=>{
        const l = linkOf(row);
        const cv = coverage(l);
        const tip = !l || (!l.tasks && !l.issues && !l.tests)
          ? '연계된 업무·이슈·테스트가 없습니다. 업무/이슈/테스트의 “연계 요구사항”에 이 요구사항 코드를 입력하면 연결됩니다.'
          : `업무 ${l.tasksDone}/${l.tasks} 완료 · 이슈 미해결 ${l.issuesOpen}건 · 테스트 ${l.testsPass}/${l.tests} 통과`;
        return <span title={tip} style={{display:'inline-flex',alignItems:'center',gap:5,fontWeight:700,fontSize:11.5,color:cv.c}}>
          <i style={{width:7,height:7,borderRadius:99,background:cv.c,display:'inline-block'}}/>{cv.t}
        </span>;
      }},
      {key:'assignee',label:'담당'},
    ]}
    fields={[{key:'title',label:'제목',required:true},{key:'description',label:'설명',type:'textarea'},{key:'category',label:'분류',type:'combo',half:true,options:['기능','비기능','성능','보안','사용성','호환성','데이터','인터페이스','기타']},{key:'assignee',label:'담당자',type:'combo',optionsFrom:'members',half:true},{key:'priority',label:'우선순위',type:'select',options:['high','medium','low'],half:true},{key:'status',label:'상태',type:'select',options:['draft','review','approved','rejected'],half:true},{key:'acceptanceCriteria',label:'인수기준(완료조건)',type:'textarea',hint:'한 줄에 완료조건 하나씩 · 검증 가능한 형태로 작성(승인 전 필수)'}]} />;
}
