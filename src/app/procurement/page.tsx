'use client';
import { ResourceView } from '@/components/ResourceView';
export default function Page() {
  return <ResourceView title="조달" subtitle="장비·SW 조달 품목과 발주 상태를 관리합니다." endpoint="/api/procurement" projectScoped entity="procurement" statusKey="category"
    columns={[{key:'code',label:'코드'},{key:'item',label:'품목',strong:true},{key:'category',label:'분류',badge:true},{key:'qty',label:'수량'},{key:'unitPrice',label:'단가',render:(v)=> v ? Number(v).toLocaleString()+'원' : '—'},{key:'vendor',label:'업체'},{key:'status',label:'상태',badge:true}]}
    fields={[{key:'item',label:'품목명',required:true},{key:'category',label:'분류',type:'select',options:['HW','SW','네트워크','라이선스','용역'],half:true},{key:'vendor',label:'업체',half:true},{key:'qty',label:'수량',type:'number',half:true},{key:'unitPrice',label:'단가(원)',type:'number',half:true},{key:'status',label:'상태',type:'select',options:['requested','ordered','received','completed']}]} />;
}
