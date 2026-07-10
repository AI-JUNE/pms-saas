'use client';
import { ResourceView } from '@/components/ResourceView';
export default function Page() {
  return <ResourceView title="산출물 양식" subtitle="프로젝트 산출물의 커스텀 양식(템플릿)을 정의합니다. 항목 구성을 등록해 표준화하세요." endpoint="/api/form-definitions" entity="formDefinitions" projectScoped statusKey="targetType"
    columns={[{key:'code',label:'코드'},{key:'name',label:'양식명',strong:true},{key:'targetType',label:'대상 산출물'},{key:'status',label:'상태',badge:true}]}
    fields={[
      {key:'name',label:'양식명',required:true,placeholder:'예: 단위테스트 결과서 양식'},
      {key:'targetType',label:'대상 산출물 유형',type:'combo',half:true,options:['요구사항정의서','설계서','테스트결과서','회의록','점검표','매뉴얼','기타']},
      {key:'status',label:'상태',type:'select',half:true,options:[{value:'draft',label:'작성중'},{value:'active',label:'사용'},{value:'archived',label:'보관'}]},
      {key:'fields',label:'양식 항목(줄바꿈으로 구분)',type:'textarea',placeholder:'항목1\n항목2\n항목3'},
      {key:'note',label:'설명·작성지침',type:'textarea'},
    ]} />;
}
