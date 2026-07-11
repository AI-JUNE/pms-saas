'use client';
import { ResourceView } from '@/components/ResourceView';

// 결재 진행 미니 스텝퍼 — 상세 패널 스텝퍼(작성중→결재요청→승인)와 동일 규칙을 목록 셀에 축약 표시
const DOC_STEPS: [string, string][] = [['draft', '작성중'], ['review', '결재요청'], ['approved', '승인']];
function ApprovalTrack({ status }: { status: string }) {
  const rejected = status === 'rejected';
  const idx = rejected ? -1 : DOC_STEPS.findIndex((s) => s[0] === status);
  const cur = rejected ? '반려' : (DOC_STEPS[idx]?.[1] ?? '작성중');
  const tip = rejected ? '반려 — 재작성 필요' : `결재 진행: ${cur} (${Math.max(0, idx) + 1}/${DOC_STEPS.length})`;
  return (
    <div title={tip} style={{ display: 'flex', alignItems: 'center', gap: 3, minWidth: 64 }} aria-label={tip}>
      {DOC_STEPS.map((s, i) => {
        const done = idx >= 0 && idx >= i;
        return (
          <i key={s[0]} style={{
            display: 'block', width: 16, height: 5, borderRadius: 99,
            background: rejected ? '#c0414f' : done ? '#2f8f5b' : 'var(--border)',
            opacity: rejected && i > 0 ? 0.28 : 1,
          }} />
        );
      })}
      <span style={{ marginLeft: 4, fontSize: 11.5, fontWeight: 700, color: rejected ? '#c0414f' : idx >= DOC_STEPS.length - 1 ? '#2f8f5b' : 'var(--text-2)' }}>{cur}</span>
    </div>
  );
}

export default function Page() {
  return <ResourceView title="산출물·결재" subtitle="산출물과 결재 상태를 관리합니다." endpoint="/api/documents" entity="documents" projectScoped
    columns={[{key:'code',label:'코드'},{key:'title',label:'문서명',strong:true},{key:'type',label:'유형'},{key:'version',label:'버전'},{key:'status',label:'결재상태',badge:true},{key:'approvalTrack',label:'진행',render:(_v,r)=><ApprovalTrack status={String(r?.status ?? 'draft')} />},{key:'author',label:'작성'},{key:'approver',label:'결재자'},{key:'approvedAt',label:'결재일',render:(v)=>v?new Date(v).toLocaleDateString('ko-KR'):'—'}]}
    fields={[{key:'title',label:'문서명',required:true},{key:'type',label:'유형',type:'combo',half:true,options:['요구사항정의서','기본설계서','상세설계서','테스트계획서','테스트결과서','회의록','사용자매뉴얼','운영매뉴얼','기타']},{key:'version',label:'버전',type:'combo',half:true,options:['v1.0','v1.1','v1.2','v2.0','v3.0'],placeholder:'예: v1.0'},{key:'status',label:'결재상태',type:'select',options:[{value:'draft',label:'작성중'},{value:'review',label:'결재요청'},{value:'approved',label:'승인'},{value:'rejected',label:'반려'}],half:true},{key:'author',label:'작성자',type:'combo',optionsFrom:'members',half:true,placeholder:'인력 선택/입력'},{key:'approver',label:'결재자',type:'combo',optionsFrom:'members',half:true,placeholder:'인력 선택/입력'}]} />;
}
