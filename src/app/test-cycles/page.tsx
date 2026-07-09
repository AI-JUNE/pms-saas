'use client';
import { ResourceView } from '@/components/ResourceView';
export default function Page() {
  return <ResourceView title="테스트 차수" subtitle="회차(1차·2차·회귀 등)별로 테스트를 묶어 계획·진행 상태를 관리합니다." endpoint="/api/test-cycles" entity="testCycles" projectScoped
    columns={[{key:'code',label:'코드'},{key:'name',label:'차수명',strong:true},{key:'goal',label:'목표'},{key:'startDate',label:'시작'},{key:'endDate',label:'종료'},{key:'status',label:'상태',badge:true}]}
    fields={[
      {key:'name',label:'차수명',required:true,placeholder:'예: 1차 통합테스트'},
      {key:'goal',label:'목표·범위',type:'textarea'},
      {key:'status',label:'상태',type:'select',half:true,options:[{value:'planned',label:'계획'},{value:'active',label:'진행'},{value:'done',label:'완료'}]},
      {key:'startDate',label:'시작일',type:'date',half:true},
      {key:'endDate',label:'종료일',type:'date',half:true},
    ]} />;
}
