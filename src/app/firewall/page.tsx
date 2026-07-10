'use client';
import { ResourceView } from '@/components/ResourceView';
export default function Page() {
  return <ResourceView title="방화벽 신청" subtitle="방화벽 오픈 신청과 승인 상태를 관리합니다." endpoint="/api/firewall" projectScoped entity="firewall"
    columns={[{key:'code',label:'코드'},{key:'title',label:'제목',strong:true},{key:'srcIp',label:'출발지'},{key:'dstIp',label:'목적지'},{key:'port',label:'포트'},{key:'protocol',label:'프로토콜'},{key:'expireDate',label:'만료'},{key:'status',label:'상태',badge:true}]}
    fields={[{key:'title',label:'제목',required:true},{key:'srcIp',label:'출발지 IP',half:true},{key:'dstIp',label:'목적지 IP',half:true},{key:'port',label:'포트',half:true},{key:'protocol',label:'프로토콜',type:'select',options:['TCP','UDP','ICMP'],half:true},{key:'reason',label:'사유',type:'textarea'},{key:'approver',label:'승인자',half:true},{key:'expireDate',label:'만료일',type:'date',half:true},{key:'status',label:'상태',type:'select',options:['requested','approved','rejected','completed']}]} />;
}
