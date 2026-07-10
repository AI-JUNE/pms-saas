'use client';
import { ResourceView } from '@/components/ResourceView';
import { Kanban, CalendarView } from '@/components/views';
export default function Page() {
  return <ResourceView title="이슈·결함" subtitle="이슈와 결함을 관리합니다." endpoint="/api/issues" projectScoped entity="issues"
    altViews={[{ key: 'board', label: '보드', render: (rows, openDetail) => (
      <Kanban rows={rows} openDetail={openDetail} columns={[
        { key: 'open', label: '열림', color: '#3b5bfd' },
        { key: 'in_progress', label: '진행중', color: '#e08600' },
        { key: 'resolved', label: '해결', color: '#15a34a' },
        { key: 'closed', label: '종료', color: '#94a3b8' },
      ]} />
    )},{ key: 'cal', label: '캘린더', render: (rows, openDetail) => <CalendarView rows={rows} dateKey="dueDate" openDetail={openDetail} /> }]}
    columns={[{key:'code',label:'코드'},{key:'title',label:'제목',strong:true},{key:'type',label:'유형',badge:true},{key:'priority',label:'우선순위',badge:true},{key:'status',label:'상태',badge:true},{key:'epic',label:'에픽'},{key:'storyPoints',label:'SP'},{key:'spentHours',label:'공수(h)'},{key:'labels',label:'라벨',render:(v)=> v ? String(v).split(',').map((l,i)=>(<span className="label-chip" key={i}>{l.trim()}</span>)) : <span className="muted">—</span>},{key:'assignee',label:'담당'}]}
    fields={[{key:'title',label:'제목',required:true},{key:'description',label:'설명',type:'textarea'},{key:'type',label:'유형(트래커)',type:'select',options:[{value:'bug',label:'결함'},{value:'task',label:'태스크'},{value:'improvement',label:'기능개선'},{value:'support',label:'지원'},{value:'change',label:'변경요청'}],half:true},{key:'priority',label:'우선순위',type:'select',options:['critical','high','medium','low'],half:true},{key:'status',label:'상태',type:'select',options:['open','in_progress','resolved','closed'],half:true},{key:'assignee',label:'담당자',type:'combo',optionsFrom:'members',half:true,placeholder:'인력 선택/입력'},{key:'dueDate',label:'기한',type:'date',half:true},{key:'storyPoints',label:'스토리포인트',type:'number',half:true},{key:'estimateHours',label:'예상공수(h)',type:'number',half:true},{key:'spentHours',label:'실제공수(h)',type:'number',half:true},{key:'epic',label:'에픽',half:true},{key:'labels',label:'라벨(쉼표구분)',half:true},{key:'reqCode',label:'연계 요구사항',type:'combo',options:[],placeholder:'예: REQ-0001',hint:'요구사항 코드를 입력하면 추적(RTM)에 연결됩니다'}]} />;
}
