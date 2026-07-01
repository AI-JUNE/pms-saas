'use client';
import { ResourceView } from '@/components/ResourceView';
export default function Page() {
  return <ResourceView title="인력" subtitle="조직 인력 명부입니다." endpoint="/api/members" entity="members" statusKey="role"
    columns={[{key:'code',label:'코드'},{key:'name',label:'이름',strong:true},{key:'company',label:'소속'},{key:'position',label:'직책'},{key:'role',label:'역할',badge:true},{key:'email',label:'이메일'},{key:'phone',label:'연락처'}]}
    fields={[{key:'name',label:'이름',required:true,half:true},{key:'role',label:'역할',type:'select',options:['PM','PMO','개발PL','개발자','인프라','DBA','QA'],half:true},{key:'company',label:'소속',half:true},{key:'position',label:'직책',half:true},{key:'email',label:'이메일',half:true},{key:'phone',label:'연락처',half:true}]} />;
}
