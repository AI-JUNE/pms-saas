'use client';
import { ResourceView } from '@/components/ResourceView';
export default function Page() {
  return <ResourceView title="요구사항" subtitle="요구사항을 추적합니다." endpoint="/api/requirements" entity="requirements" projectScoped
    columns={[{key:'code',label:'코드'},{key:'title',label:'제목',strong:true},{key:'category',label:'분류'},{key:'priority',label:'우선순위',badge:true},{key:'status',label:'상태',badge:true},{key:'assignee',label:'담당'}]}
    fields={[{key:'title',label:'제목',required:true},{key:'description',label:'설명',type:'textarea'},{key:'category',label:'분류',half:true},{key:'assignee',label:'담당자',half:true},{key:'priority',label:'우선순위',type:'select',options:['high','medium','low'],half:true},{key:'status',label:'상태',type:'select',options:['draft','review','approved','rejected'],half:true}]} />;
}
