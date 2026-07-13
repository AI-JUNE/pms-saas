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

const DAY = 86400000;

export default function Page() {
  return <ResourceView title="산출물·결재" subtitle="산출물과 결재 상태를 관리합니다." endpoint="/api/documents" entity="documents" projectScoped
    emptyText="등록된 산출물이 없습니다. 문서를 등록하고 결재요청 → 승인 순으로 진행하세요."
    columns={[
      {key:'code',label:'코드'},
      {key:'title',label:'문서명',strong:true},
      // 유형 미지정 산출물은 표준 양식(form_definitions) 매칭·유형별 집계에서 분류되지 않는다
      {key:'type',label:'유형',render:(v)=>{
        const s = String(v ?? '').trim();
        if (!s) return <span title="산출물 유형이 지정되지 않아 표준 양식 매칭·유형별 집계에서 제외됩니다" style={{fontSize:11.5,color:'#d98a16',fontWeight:700,cursor:'help'}}>미지정</span>;
        return <span style={{fontSize:12}}>{s}</span>;
      }},
      {key:'version',label:'버전'},
      {key:'status',label:'결재상태',badge:true},
      {key:'approvalTrack',label:'진행',render:(_v,r)=><ApprovalTrack status={String(r?.status ?? 'draft')} />},
      {key:'author',label:'작성',render:(v,r)=>{
        const s = String(v ?? '').trim();
        if (s) return <span style={{fontSize:12}}>{s}</span>;
        const st = String(r?.status ?? 'draft');
        // 결재 라인에 올라간 문서에 작성자가 없으면 책임 소재가 불명확해진다
        if (st === 'review' || st === 'approved') return <span title="결재가 진행된 산출물에 작성자가 없습니다 — 작성자를 지정하세요" style={{fontSize:11.5,color:'#d98a16',fontWeight:700,cursor:'help'}}>미지정</span>;
        return <span className="muted">—</span>;
      }},
      {key:'approver',label:'결재자',render:(v,r)=>{
        const s = String(v ?? '').trim();
        const st = String(r?.status ?? 'draft');
        // 승인·반려는 결재자가 반드시 남아야 하는 증빙(감리·검수 지적 항목)
        if (!s && (st === 'approved' || st === 'rejected')) return <span title={`${st === 'approved' ? '승인' : '반려'}된 산출물에 결재자가 없습니다 — 결재 이력 증빙이 누락된 상태입니다`} style={{fontSize:11.5,color:'#c0414f',fontWeight:700,cursor:'help'}}>⚠ 결재자 없음</span>;
        if (!s) return <span className="muted">—</span>;
        return <span style={{fontSize:12}}>{s}</span>;
      }},
      // 결재일 + 결재 대기 체류일(결재요청 상태로 오래 묶여 있는 문서 색출)
      {key:'approvedAt',label:'결재일',render:(v,r)=>{
        const st = String(r?.status ?? 'draft');
        if (v) {
          const d = new Date(v);
          if (!Number.isNaN(d.getTime())) return <span title={`결재 처리: ${d.toLocaleString('ko-KR')}`} style={{fontSize:12,cursor:'help'}}>{d.toLocaleDateString('ko-KR')}</span>;
        }
        if (st === 'approved') return <span title="승인 상태인데 결재일이 없습니다 — 언제 승인됐는지 추적할 수 없습니다" style={{fontSize:11.5,color:'#c0414f',fontWeight:700,cursor:'help'}}>⚠ 결재일 없음</span>;
        if (st === 'review') {
          // 등록일(createdAt) 기준 대기 일수 — 결재요청 시각을 따로 저장하지 않으므로 근사치임을 툴팁에 명시
          const c = r?.createdAt ? new Date(r.createdAt) : null;
          const days = c && !Number.isNaN(c.getTime()) ? Math.floor((Date.now() - c.getTime()) / DAY) : null;
          if (days !== null && days >= 7) {
            const col = days >= 14 ? '#c0414f' : '#d98a16';
            return <span title={`결재요청 상태로 ${days}일째입니다 (등록일 ${c!.toLocaleDateString('ko-KR')} 기준 근사치) — 결재자에게 처리를 요청하세요`} style={{fontSize:11.5,color:col,fontWeight:700,cursor:'help'}}>{days >= 14 ? '⚠ ' : ''}대기 {days}일</span>;
          }
          return <span className="muted" style={{fontSize:11.5}}>결재 대기</span>;
        }
        return <span className="muted">—</span>;
      }},
    ]}
    fields={[{key:'title',label:'문서명',required:true},{key:'type',label:'유형',type:'combo',half:true,options:['요구사항정의서','기본설계서','상세설계서','테스트계획서','테스트결과서','회의록','사용자매뉴얼','운영매뉴얼','기타'],hint:'표준 양식 매칭에 쓰이니 가급적 지정하세요'},{key:'version',label:'버전',type:'combo',half:true,options:['v1.0','v1.1','v1.2','v2.0','v3.0'],placeholder:'예: v1.0'},{key:'status',label:'결재상태',type:'select',options:[{value:'draft',label:'작성중'},{value:'review',label:'결재요청'},{value:'approved',label:'승인'},{value:'rejected',label:'반려'}],half:true},{key:'author',label:'작성자',type:'combo',optionsFrom:'members',half:true,placeholder:'인력 선택/입력'},{key:'approver',label:'결재자',type:'combo',optionsFrom:'members',half:true,placeholder:'인력 선택/입력',hint:'승인·반려 시 결재 증빙으로 남습니다'}]} />;
}
