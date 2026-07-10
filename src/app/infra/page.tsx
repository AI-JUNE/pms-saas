'use client';
import { ResourceView } from '@/components/ResourceView';
export default function Page() {
  return <ResourceView title="인프라 자산" subtitle="서버·네트워크·스토리지 등 자산(CMDB)을 관리합니다." endpoint="/api/infra" projectScoped entity="infra" statusKey="category"
    columns={[{key:'code',label:'코드'},{key:'name',label:'자산명',strong:true},{key:'category',label:'분류',badge:true},{key:'model',label:'모델'},{key:'location',label:'위치'},{key:'ipAddress',label:'IP'},{key:'hostname',label:'호스트명'},{key:'os',label:'OS'},{key:'owner',label:'담당'},{key:'status',label:'상태',badge:true}]}
    fields={[{key:'name',label:'자산명',required:true},{key:'category',label:'분류',type:'select',options:['서버','네트워크','스토리지','보안','SW','DB'],half:true},{key:'model',label:'모델',half:true},{key:'location',label:'위치(사이트/랙)',half:true},{key:'ipAddress',label:'IP 주소',half:true},{key:'hostname',label:'호스트명',half:true},{key:'os',label:'OS',half:true},{key:'cpu',label:'CPU',half:true},{key:'memory',label:'메모리',half:true},{key:'rack',label:'랙 위치',half:true},{key:'serialNo',label:'시리얼번호',half:true},{key:'owner',label:'담당자',half:true},{key:'status',label:'상태',type:'select',options:['active','standby','retired'],half:true}]} />;
}
