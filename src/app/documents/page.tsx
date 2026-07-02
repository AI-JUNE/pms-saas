'use client';
import { ResourceView } from '@/components/ResourceView';
export default function Page() {
  return <ResourceView title="산출물·결재" subtitle="산출물과 결재 상태를 관리합니다." endpoint="/api/documents" entity="documents" projectScoped
    columns={[{key:'code',label:'코드'},{key:'title',label:'문서명',strong:true},{key:'type',label:'유형'},{key:'version',label:'버전'},{key:'status',label:'결재상태',badge:true},{key:'author',label:'작성'},{key:'approver',label:'결재자'},{key:'approvedAt',label:'결재일',render:(v)=>v?new Date(v).toLocaleDateString('ko-KR'):'—'}]}
    fields={[{key:'title',label:'문서명',required:true},{key:'type',label:'유형',type:'combo',half:true,options:['요구사항정의서','기본설계서','상세설계서','테스트계획서','테스트결과서','회의록','사용자매뉴얼','운영매뉴얼','기타']},{key:'version',label:'버전',type:'combo',half:true,options:['v1.0','v1.1','v1.2','v2.0','v3.0'],placeholder:'예: v1.0'},{key:'status',label:'결재상태',type:'select',options:[{value:'draft',label:'작성중'},{value:'review',label:'결재요청'},{value:'approved',label:'승인'},{value:'rejected',label:'반려'}],half:true},{key:'author',label:'작성자',type:'combo',optionsFrom:'members',half:true,placeholder:'인력 선택/입력'},{key:'approver',label:'결재자',type:'combo',optionsFrom:'members',half:true,placeholder:'인력 선택/입력'}]} />;
}
