'use client';
import { ResourceView } from '@/components/ResourceView';
import { RiskMatrix } from '@/components/views';
export default function Page() {
  return <ResourceView title="리스크" subtitle="리스크를 식별·평가합니다. 등급은 발생가능성×영향도로 자동 산정됩니다." endpoint="/api/risks" entity="risks" projectScoped
    altViews={[{ key: 'matrix', label: '매트릭스', render: (rows, openDetail) => <RiskMatrix rows={rows} openDetail={openDetail} /> }]}
    columns={[{key:'code',label:'코드'},{key:'title',label:'제목',strong:true},{key:'probability',label:'발생'},{key:'impact',label:'영향'},{key:'level',label:'등급',badge:true},{key:'status',label:'상태',badge:true},{key:'owner',label:'담당'}]}
    fields={[{key:'title',label:'제목',required:true},{key:'description',label:'설명',type:'textarea'},{key:'probability',label:'발생가능성(1-5)',type:'number',half:true},{key:'impact',label:'영향도(1-5)',type:'number',half:true},{key:'status',label:'상태',type:'select',options:['identified','mitigating','closed'],half:true},{key:'owner',label:'담당자',type:'combo',optionsFrom:'members',half:true,placeholder:'인력 선택/입력'}]} />;
}
