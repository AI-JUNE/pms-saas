'use client';
import { ResourceView } from '@/components/ResourceView';
import { Kanban, Gantt, CalendarView } from '@/components/views';
export default function Page() {
  return <ResourceView title="업무 (WBS)" subtitle="작업을 분해하고 진척을 관리합니다." endpoint="/api/tasks" projectScoped entity="tasks"
    altViews={[
      { key: 'board', label: '보드', render: (rows, openDetail) => (
        <Kanban rows={rows} openDetail={openDetail} titleKey="name" columns={[
          { key: 'todo', label: '할 일', color: '#94a3b8' },
          { key: 'doing', label: '진행중', color: '#be5535' },
          { key: 'done', label: '완료', color: '#15a34a' },
        ]} />
      )},
      { key: 'gantt', label: '타임라인', render: (rows, openDetail) => <Gantt rows={rows} openDetail={openDetail} /> },
      { key: 'cal', label: '캘린더', render: (rows, openDetail) => <CalendarView rows={rows} dateKey="endDate" openDetail={openDetail} /> },
    ]}
    columns={[{key:'code',label:'코드'},{key:'name',label:'작업',strong:true},{key:'phase',label:'단계'},{key:'assignee',label:'담당'},{key:'status',label:'상태',badge:true},{key:'progress',label:'진척',render:(v)=>(<div className="row" style={{gap:8}}><div className="bar"><i style={{width:`${v||0}%`}}/></div><span className="muted" style={{fontSize:11.5}}>{v||0}%</span></div>)},{key:'endDate',label:'마감'}]}
    fields={[{key:'name',label:'작업명',required:true},{key:'phase',label:'단계',half:true},{key:'assignee',label:'담당자',half:true},{key:'status',label:'상태',type:'select',options:['todo','doing','done'],half:true},{key:'progress',label:'진척률(%)',type:'number',half:true},{key:'startDate',label:'시작일',type:'date',half:true},{key:'endDate',label:'마감일',type:'date',half:true}]} />;
}
