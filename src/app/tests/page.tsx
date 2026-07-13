'use client';
import { ResourceView } from '@/components/ResourceView';
import { Kanban } from '@/components/views';
import { Pill } from '@/lib/ui';

// 줄 단위 파싱(글머리표 제거) — 회의록·리스크·인터페이스 화면과 동일 규칙
const lines = (v: any): string[] =>
  String(v ?? '')
    .split(/\r?\n/)
    .map((s) => s.replace(/^\s*(?:[-*·•]|\d+[.)])\s*/, '').trim())
    .filter(Boolean);

// 검증 단계 진행도(작성=0 → 완료=4). 반려는 별도 취급
const STAGE_ORDER: Record<string, number> = { draft: 0, dev: 1, pl: 2, pm: 3, done: 4 };

export default function Page() {
  return <ResourceView title="테스트" subtitle="테스트 케이스를 등록하고 개발자→PL→PM 순으로 검증합니다." endpoint="/api/tests" entity="tests" projectScoped
    emptyText="등록된 테스트 케이스가 없습니다. 요구사항(REQ)별로 케이스를 만들고 절차·기대 결과를 작성하세요."
    altViews={[
      { key: 'board', label: '검증 파이프라인', render: (rows, openDetail) => (
        <Kanban rows={rows} openDetail={openDetail} titleKey="title" columns={[
          { key: 'draft', label: '작성', color: '#94a3b8' },
          { key: 'dev', label: '개발자 검증', color: '#0e9bb8' },
          { key: 'pl', label: 'PL 검증', color: '#d98a16' },
          { key: 'pm', label: 'PM 승인', color: '#7c4dff' },
          { key: 'done', label: '완료', color: '#2f8f5b' },
        ]} />
      )},
    ]}
    columns={[
      {key:'code',label:'코드'},
      {key:'title',label:'테스트 케이스',strong:true},
      {key:'type',label:'유형'},
      // 요구사항 미연계 케이스는 RTM 커버리지 집계에서 통째로 빠지므로 목록에서 색출한다
      {key:'reqCode',label:'요구사항',render:(v)=>{
        const s = String(v ?? '').trim();
        if (!s) return <span title="연계 요구사항이 없어 RTM(요구사항 추적) 커버리지 집계에서 제외됩니다 — 요구사항 코드를 연결하세요" style={{fontSize:11.5,color:'#d98a16',fontWeight:700,cursor:'help'}}>⚠ 미연계</span>;
        return <span style={{fontSize:11.5,fontFamily:'ui-monospace,monospace'}}>{s}</span>;
      }},
      {key:'cycle',label:'차수'},
      // 테스트 케이스의 본체(절차·기대 결과)가 채워졌는지를 목록에서 바로 판단
      {key:'caseBody',label:'절차·기대',render:(_v,r)=>{
        const st = lines(r?.steps);
        const ex = lines(r?.expected);
        const stage = String(r?.status ?? 'draft');
        const verifying = (STAGE_ORDER[stage] ?? 0) >= 1; // 개발자 검증 이후
        const tip = [
          st.length ? `절차 ${st.length}단계\n` + st.slice(0, 6).map((s, i) => `${i + 1}. ${s}`).join('\n') + (st.length > 6 ? `\n… 외 ${st.length - 6}단계` : '') : '절차 미작성',
          ex.length ? `기대 결과 ${ex.length}건\n` + ex.slice(0, 3).map((s, i) => `${i + 1}. ${s}`).join('\n') + (ex.length > 3 ? `\n… 외 ${ex.length - 3}건` : '') : '기대 결과 미작성',
        ].join('\n\n');
        if (!st.length) {
          // 절차 없이 검증 단계로 올라간 케이스 = 무엇을 어떻게 확인했는지 증빙이 없는 상태(감리 지적 대상)
          if (verifying) return <span title={`검증이 진행 중인데 테스트 절차가 없습니다 — 무엇을 어떻게 확인했는지 증빙이 없습니다\n\n${tip}`} style={{fontSize:11.5,color:'#c0414f',fontWeight:700,cursor:'help'}}>⚠ 절차 미작성</span>;
          return <span title={tip} className="muted" style={{fontSize:11.5,cursor:'help'}}>미작성</span>;
        }
        return <span title={tip} style={{display:'inline-flex',alignItems:'center',gap:6,maxWidth:240,cursor:'help'}}>
          <b style={{fontSize:11,padding:'1px 6px',borderRadius:99,background:'var(--surface-2)',color:'var(--brand)',flexShrink:0}}>절차 {st.length}</b>
          {ex.length
            ? <b style={{fontSize:11,padding:'1px 6px',borderRadius:99,background:'var(--surface-2)',color:'#2f8f5b',flexShrink:0}}>기대 {ex.length}</b>
            : verifying
              ? <b style={{fontSize:11,color:'#d98a16',flexShrink:0}}>기대결과 없음</b>
              : <span className="muted" style={{fontSize:11,flexShrink:0}}>기대 —</span>}
          <span className="muted" style={{fontSize:11.5,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{st[0]}</span>
        </span>;
      }},
      {key:'assignee',label:'담당'},
      {key:'dueDate',label:'기한'},
      {key:'progress',label:'진척',render:(v)=>(<div className="row" style={{gap:8}}><div className="bar"><i style={{width:`${v||0}%`}}/></div><span className="muted" style={{fontSize:11.5}}>{v||0}%</span></div>)},
      // 결과 ↔ 검증단계 ↔ 진척의 모순(미실행 완료 · 실패 완료 · 진척 미갱신)을 목록에서 색출
      {key:'result',label:'결과',render:(v,r)=>{
        const res = String(v ?? 'na');
        const doneStage = String(r?.status ?? 'draft') === 'done';
        const prog = Number(r?.progress) || 0;
        let warn: { text: string; color: string; tip: string } | null = null;
        if (doneStage && res === 'na') warn = { text: '⚠ 미실행 완료', color: '#c0414f', tip: '검증 단계가 완료인데 실행 결과가 미실행입니다 — 실제 수행 결과(통과/실패)를 기록하세요' };
        else if (doneStage && res === 'fail') warn = { text: '⚠ 실패 완료', color: '#c0414f', tip: '실패한 테스트가 완료로 종결되어 있습니다 — 결함 조치 후 재수행하거나 이슈로 등록하세요' };
        else if (doneStage && res === 'blocked') warn = { text: '⚠ 블록 완료', color: '#c0414f', tip: '블록된 테스트가 완료로 종결되어 있습니다 — 선행 조건 해소 후 재수행하세요' };
        else if (res === 'pass' && prog < 100) warn = { text: '진척 미갱신', color: '#d98a16', tip: `통과했는데 진척률이 ${prog}%입니다 — 진척률을 100%로 갱신하세요` };
        else if (res === 'fail' && !String(r?.reporter ?? '').trim()) warn = { text: '보고자 없음', color: '#d98a16', tip: '실패 건에 보고자가 없습니다 — 결함 추적을 위해 보고자를 지정하세요' };
        return <span style={{display:'inline-flex',alignItems:'center',gap:6}}>
          <Pill v={res} />
          {warn && <b title={warn.tip} style={{fontSize:11,color:warn.color,fontWeight:700,cursor:'help',whiteSpace:'nowrap'}}>{warn.text}</b>}
        </span>;
      }},
      {key:'status',label:'검증단계',badge:true},
    ]}
    fields={[
      {key:'title',label:'테스트 케이스명',required:true},
      {key:'reqCode',label:'연계 요구사항',type:'combo',options:[],placeholder:'예: REQ-0001',hint:'요구사항 추적(RTM)에 연결됩니다 — 비우면 커버리지 집계에서 제외돼요'},
      {key:'cycle',label:'테스트 차수',type:'combo',options:['1차','2차','3차','회귀','인수','성능'],placeholder:'예: 1차',hint:'회차별로 묶어 관리합니다(그룹화 가능)'},
      {key:'type',label:'유형',type:'select',options:['단위','통합','시스템','인수','회귀','성능','보안'],half:true},
      {key:'priority',label:'우선순위',type:'select',options:['high','medium','low'],half:true},
      {key:'steps',label:'테스트 절차',type:'textarea',hint:'한 줄에 단계 하나씩 — 1. 로그인 / 2. 메뉴 진입 … (목록에 단계 수가 표시돼요)'},
      {key:'expected',label:'기대 결과',type:'textarea',hint:'한 줄에 검증 항목 하나씩 — 통과/실패 판정 기준을 구체적으로'},
      {key:'assignee',label:'담당(개발자)',type:'combo',optionsFrom:'members',half:true},
      {key:'reporter',label:'보고자',type:'combo',optionsFrom:'members',half:true},
      {key:'dueDate',label:'기한',type:'date',half:true},
      {key:'progress',label:'진척률',type:'select',numeric:true,half:true,options:[{value:'0',label:'0%'},{value:'25',label:'25%'},{value:'50',label:'50%'},{value:'75',label:'75%'},{value:'100',label:'100%'}]},
      {key:'result',label:'결과',type:'select',half:true,options:[{value:'na',label:'미실행'},{value:'pass',label:'통과'},{value:'fail',label:'실패'},{value:'blocked',label:'블록'}]},
      {key:'status',label:'검증 단계',type:'select',options:[{value:'draft',label:'작성'},{value:'dev',label:'개발자검증'},{value:'pl',label:'PL검증'},{value:'pm',label:'PM승인'},{value:'done',label:'완료'},{value:'rejected',label:'반려'}]},
    ]} />;
}
