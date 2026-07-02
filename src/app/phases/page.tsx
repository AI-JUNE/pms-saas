'use client';
import { ResourceView } from '@/components/ResourceView';
export default function Page() {
  return <ResourceView title="단계" subtitle="프로젝트 단계를 정의합니다." endpoint="/api/phases" entity="phases" projectScoped
    columns={[{key:'code',label:'코드'},{key:'name',label:'단계',strong:true},{key:'status',label:'상태',badge:true}]}
    fields={[{key:'name',label:'단계명',required:true,type:'combo',options:['착수','요구사항 분석','분석/설계','설계','구현/개발','단위 테스트','통합 테스트','시스템 테스트','이행/전개','안정화','검수','운영/유지보수','완료'],placeholder:'선택하거나 직접 입력',hint:'표준 단계에서 고르거나 직접 입력할 수 있어요'},{key:'status',label:'상태',type:'select',options:['planned','in_progress','done'],half:true},{key:'color',label:'색상',type:'select',half:true,options:['파랑','초록','주황','빨강','보라','회색']}]} />;
}
