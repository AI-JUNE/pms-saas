'use client';
import { ResourceView } from '@/components/ResourceView';
import { Kanban } from '@/components/views';
export default function Page() {
  return <ResourceView title="테스트" subtitle="테스트 케이스를 등록하고 개발자→PL→PM 순으로 검증합니다." endpoint="/api/tests" entity="tests" projectScoped
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
    columns={[{key:'code',label:'코드'},{key:'title',label:'테스트 케이스',strong:true},{key:'type',label:'유형'},{key:'reqCode',label:'요구사항'},{key:'assignee',label:'담당'},{key:'result',label:'결과',badge:true},{key:'status',label:'검증단계',badge:true}]}
    fields={[
      {key:'title',label:'테스트 케이스명',required:true},
      {key:'reqCode',label:'연계 요구사항',type:'combo',options:[],placeholder:'예: REQ-0001',hint:'요구사항 추적(RTM)에 연결됩니다'},
      {key:'type',label:'유형',type:'select',options:['단위','통합','시스템','인수','회귀','성능','보안'],half:true},
      {key:'priority',label:'우선순위',type:'select',options:['high','medium','low'],half:true},
      {key:'steps',label:'테스트 절차',type:'textarea'},
      {key:'expected',label:'기대 결과',type:'textarea'},
      {key:'assignee',label:'담당(개발자)',type:'combo',optionsFrom:'members',half:true},
      {key:'result',label:'결과',type:'select',half:true,options:[{value:'na',label:'미실행'},{value:'pass',label:'통과'},{value:'fail',label:'실패'},{value:'blocked',label:'블록'}]},
      {key:'status',label:'검증 단계',type:'select',options:[{value:'draft',label:'작성'},{value:'dev',label:'개발자검증'},{value:'pl',label:'PL검증'},{value:'pm',label:'PM승인'},{value:'done',label:'완료'},{value:'rejected',label:'반려'}]},
    ]} />;
}
