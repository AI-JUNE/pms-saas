'use client';
import { ResourceView } from '@/components/ResourceView';
export default function Page() {
  return <ResourceView title="산출물·결재" subtitle="산출물과 결재 상태를 관리합니다." endpoint="/api/documents" entity="documents" projectScoped
    columns={[{key:'code',label:'코드'},{key:'title',label:'문서명',strong:true},{key:'type',label:'유형'},{key:'version',label:'버전'},{key:'status',label:'결재상태',badge:true},{key:'author',label:'작성'},{key:'approver',label:'결재자'}]}
    fields={[{key:'title',label:'문서명',required:true},{key:'type',label:'유형',half:true},{key:'version',label:'버전',half:true},{key:'status',label:'결재상태',type:'select',options:['draft','review','approved','rejected'],half:true},{key:'author',label:'작성자',half:true},{key:'approver',label:'결재자',half:true}]} />;
}
