'use client';
import { ResourceView } from '@/components/ResourceView';
import { Kanban } from '@/components/views';
export default function Page() {
  return <ResourceView title="내 To-Do" subtitle="개인 할 일을 기록하고 진행 상태를 관리합니다. 본인만 조회됩니다." endpoint="/api/todos" entity="todos"
    altViews={[
      { key: 'board', label: '보드', render: (rows, openDetail) => (
        <Kanban rows={rows} openDetail={openDetail} titleKey="title" columns={[
          { key: 'todo', label: '할 일', color: '#94a3b8' },
          { key: 'doing', label: '진행중', color: '#d95d31' },
          { key: 'done', label: '완료', color: '#2f8f5b' },
        ]} />
      )},
    ]}
    columns={[{key:'code',label:'코드'},{key:'title',label:'할 일',strong:true},{key:'priority',label:'우선순위',badge:true},{key:'dueDate',label:'기한',render:(v,row)=>{if(!v)return '—';const done=String(row.status)==='done';const t=new Date(v).getTime();if(done||isNaN(t))return v;const now=Date.now();const dd=Math.ceil((t-now)/86400000);const od=Math.floor((now-t)/86400000);const col=t<now?'#c0414f':dd<=7?'#d98a16':undefined;const tip=col?(t<now?(od>=1?`${od}일 기한 초과`:'오늘 기한'):(dd<=0?'오늘 기한':`D-${dd}`)):undefined;return <span title={tip} style={{color:col,fontWeight:col?700:undefined,cursor:tip?'help':undefined}}>{v}{col==='#c0414f'?' ⚠':''}</span>;}},{key:'status',label:'상태',badge:true}]}
    fields={[
      {key:'title',label:'할 일',required:true,placeholder:'예: 주간보고 작성'},
      {key:'note',label:'메모',type:'textarea'},
      {key:'priority',label:'우선순위',type:'select',half:true,options:['high','medium','low']},
      {key:'dueDate',label:'기한',type:'date',half:true},
      {key:'status',label:'상태',type:'select',options:[{value:'todo',label:'할 일'},{value:'doing',label:'진행중'},{value:'done',label:'완료'}]},
    ]} />;
}
