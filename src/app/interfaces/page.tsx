'use client';
import { ResourceView } from '@/components/ResourceView';
export default function Page() {
  return <ResourceView title="인터페이스" subtitle="시스템 간 인터페이스를 설계·관리합니다." endpoint="/api/interfaces" projectScoped entity="interfaces"
    columns={[{key:'code',label:'코드'},{key:'name',label:'인터페이스',strong:true},{key:'srcSystem',label:'송신'},{key:'dstSystem',label:'수신'},{key:'protocol',label:'프로토콜'},{key:'format',label:'포맷'},{key:'cycle',label:'주기'},{key:'owner',label:'담당'},{key:'testStatus',label:'연동테스트',badge:true},{key:'status',label:'상태',badge:true}]}
    fields={[{key:'name',label:'인터페이스명',required:true},{key:'srcSystem',label:'송신 시스템',half:true},{key:'dstSystem',label:'수신 시스템',half:true},{key:'protocol',label:'프로토콜',type:'select',options:['REST','SOAP','FTP','MQ','DB Link','File'],half:true},{key:'format',label:'포맷',type:'select',options:['JSON','XML','CSV','Fixed','EDI'],half:true},{key:'cycle',label:'주기',type:'select',options:['실시간','배치(일)','배치(시간)','수시'],half:true},{key:'owner',label:'담당자',half:true},{key:'testStatus',label:'연동테스트',type:'select',options:['미실시','진행','완료'],half:true},{key:'spec',label:'연동 규격',type:'textarea'},{key:'status',label:'상태',type:'select',options:['draft','review','approved'],half:true}]} />;
}
