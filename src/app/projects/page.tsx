'use client';
import { ResourceView } from '@/components/ResourceView';
export default function Page() {
  return <ResourceView title="프로젝트" subtitle="조직 내 프로젝트를 관리합니다." endpoint="/api/projects" entity="projects" rowHref={(r)=>`/projects/${r.id}`}
    columns={[{key:'code',label:'코드'},{key:'name',label:'이름',strong:true},{key:'client',label:'고객'},{key:'startDate',label:'시작'},{key:'endDate',label:'종료'},{key:'budget',label:'계약금액',render:(v)=> v ? Number(v).toLocaleString()+'원' : '—'},{key:'status',label:'상태',badge:true}]}
    fields={[{key:'name',label:'프로젝트명',required:true},{key:'client',label:'고객',half:true},{key:'orderer',label:'발주처',half:true},{key:'contractNo',label:'계약번호',half:true},{key:'budget',label:'계약금액(원)',type:'number',half:true},{key:'status',label:'상태',type:'select',options:['active','completed','archived'],half:true},{key:'startDate',label:'시작일',type:'date',half:true},{key:'endDate',label:'종료일',type:'date',half:true}]} />;
}
