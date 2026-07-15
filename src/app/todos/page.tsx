'use client';
import { ResourceView } from '@/components/ResourceView';
import { Kanban } from '@/components/views';

// 메모(note)는 폼 입력만 받고 목록에 전혀 노출되지 않았다. 목록 API가 이미 전체 행(textarea 포함)을
// 돌려주므로 추가 fetch 없이 줄 단위로 파싱만 한다(읽기 전용).
const lines = (v: any): string[] =>
  String(v || '')
    .split(/[\r\n]+/)
    .map((s) => s.replace(/^[\s\-*·•\d.)]+/, '').trim())
    .filter(Boolean);

export default function Page() {
  return <ResourceView title="내 To-Do" subtitle="개인 할 일을 기록하고 진행 상태를 관리합니다. 본인만 조회됩니다." endpoint="/api/todos" entity="todos"
    emptyText="아직 등록된 할 일이 없습니다. 하단 빠른 추가 행이나 “새로 만들기”로 추가하세요."
    altViews={[
      { key: 'board', label: '보드', render: (rows, openDetail) => (
        <Kanban rows={rows} openDetail={openDetail} titleKey="title" columns={[
          { key: 'todo', label: '할 일', color: '#94a3b8' },
          { key: 'doing', label: '진행중', color: '#d95d31' },
          { key: 'done', label: '완료', color: '#2f8f5b' },
        ]} />
      )},
    ]}
    columns={[
      {key:'code',label:'코드'},
      {key:'title',label:'할 일',strong:true},
      {key:'note',label:'메모',render:(v)=>{
        const ls = lines(v);
        if (!ls.length) return <span style={{color:'#c7c7c7'}}>—</span>;
        const tip = `메모 ${ls.length}줄\n${ls.slice(0,8).map((s,i)=>`${i+1}. ${s}`).join('\n')}${ls.length>8?`\n… 외 ${ls.length-8}줄`:''}`;
        return (
          <span title={tip} style={{display:'inline-flex',alignItems:'center',gap:6,cursor:'help',maxWidth:260}}>
            <span style={{display:'inline-block',padding:'1px 6px',borderRadius:4,fontSize:11,fontWeight:700,color:'var(--brand)',background:'rgba(190,85,53,.10)',whiteSpace:'nowrap'}}>{ls.length}줄</span>
            <span style={{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',color:'#6b6b6b',fontSize:12}}>{ls[0]}</span>
          </span>
        );
      }},
      {key:'priority',label:'우선순위',badge:true},
      {key:'dueDate',label:'기한',render:(v,row)=>{if(!v)return '—';const done=String(row.status)==='done';const t=new Date(v).getTime();if(done||isNaN(t))return v;const now=Date.now();const dd=Math.ceil((t-now)/86400000);const od=Math.floor((now-t)/86400000);const col=t<now?'#c0414f':dd<=7?'#d98a16':undefined;const tip=col?(t<now?(od>=1?`${od}일 기한 초과`:'오늘 기한'):(dd<=0?'오늘 기한':`D-${dd}`)):undefined;return <span title={tip} style={{color:col,fontWeight:col?700:undefined,cursor:tip?'help':undefined}}>{v}{col==='#c0414f'?' ⚠':''}</span>;}},
      {key:'status',label:'상태',badge:true},
    ]}
    fields={[
      {key:'title',label:'할 일',required:true,placeholder:'예: 주간보고 작성'},
      {key:'note',label:'메모',type:'textarea',hint:'한 줄에 하나씩 적으면 목록에서 줄 수·미리보기로 확인할 수 있습니다.'},
      {key:'priority',label:'우선순위',type:'select',half:true,options:[{value:'high',label:'높음'},{value:'medium',label:'보통'},{value:'low',label:'낮음'}]},
      {key:'dueDate',label:'기한',type:'date',half:true,hint:'비워두면 기한 임박·초과 강조에서 제외됩니다.'},
      {key:'status',label:'상태',type:'select',options:[{value:'todo',label:'할 일'},{value:'doing',label:'진행중'},{value:'done',label:'완료'}]},
    ]} />;
}
