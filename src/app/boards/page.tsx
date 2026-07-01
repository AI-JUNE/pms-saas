'use client';
import { ResourceView } from '@/components/ResourceView';
export default function Page() {
  return <ResourceView title="게시판" subtitle="공지·자료·Q&A를 공유합니다." endpoint="/api/boards" entity="boards" statusKey="category"
    columns={[{key:'code',label:'번호'},{key:'category',label:'분류',badge:true},{key:'title',label:'제목',strong:true},{key:'author',label:'작성자'},{key:'createdAt',label:'작성일',render:(v)=> v ? new Date(v).toLocaleDateString('ko-KR') : '—'}]}
    fields={[{key:'title',label:'제목',required:true},{key:'category',label:'분류',type:'select',options:['공지','자료','Q&A','일반'],half:true},{key:'author',label:'작성자',half:true},{key:'content',label:'내용',type:'textarea'}]} />;
}
