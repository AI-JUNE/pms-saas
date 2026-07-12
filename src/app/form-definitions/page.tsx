'use client';
import { useEffect, useState } from 'react';
import { ResourceView } from '@/components/ResourceView';

type DocStat = { total: number; approved: number; review: number; draft: number; rejected: number };

// 양식 항목(fields)은 줄바꿈 구분 텍스트로 저장 — 목록 표시용으로 파싱
const parseItems = (v: any): string[] =>
  String(v ?? '')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);

export default function Page() {
  // 대상 산출물 유형(targetType) ↔ 산출물(documents.type) 매칭 집계 — 페이지-로컬 보조 fetch(읽기 전용)
  const [docs, setDocs] = useState<Record<string, DocStat>>({});
  useEffect(() => {
    const p = Number(localStorage.getItem('pms.project')) || null;
    if (!p) return;
    fetch(`/api/documents?projectId=${p}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((ds: any[]) => {
        if (!Array.isArray(ds)) return;
        const m: Record<string, DocStat> = {};
        for (const d of ds) {
          const k = String(d?.type || '').trim();
          if (!k) continue;
          const s = (m[k] ||= { total: 0, approved: 0, review: 0, draft: 0, rejected: 0 });
          s.total++;
          const st = String(d?.status || 'draft');
          if (st === 'approved') s.approved++;
          else if (st === 'review') s.review++;
          else if (st === 'rejected') s.rejected++;
          else s.draft++;
        }
        setDocs(m);
      })
      .catch(() => {});
  }, []);

  return <ResourceView title="산출물 양식" subtitle="프로젝트 산출물의 커스텀 양식(템플릿)을 정의합니다. 항목 구성을 등록해 표준화하세요." endpoint="/api/form-definitions" entity="formDefinitions" projectScoped statusKey="targetType"
    columns={[
      {key:'code',label:'코드'},
      {key:'name',label:'양식명',strong:true},
      {key:'targetType',label:'대상 산출물'},
      // 항목 구성: 건수 + 앞 3개 미리보기(전체는 hover 툴팁). '사용' 상태인데 항목이 없으면 경고 — 표준화의 핵심 결함
      {key:'fields',label:'항목',render:(v,row)=>{
        const items = parseItems(v);
        const active = String(row?.status ?? '') === 'active';
        if (!items.length) {
          return active
            ? <span title="'사용' 상태인데 양식 항목이 정의되어 있지 않습니다 — 항목을 입력해야 표준 양식으로 쓸 수 있어요" style={{color:'#c0414f',fontWeight:700,fontSize:11.5}}>⚠ 항목 미정의</span>
            : <span className="muted" style={{fontSize:11.5}} title="양식 항목(줄바꿈으로 구분)을 입력하면 여기에 표시됩니다">미정의</span>;
        }
        const preview = items.slice(0, 3).join(' · ');
        const tip = `항목 ${items.length}개\n${items.map((s, i) => `${i + 1}. ${s}`).join('\n')}`;
        return <span title={tip} style={{display:'inline-flex',alignItems:'center',gap:6,maxWidth:280}}>
          <b style={{fontSize:11.5,color:'var(--brand)',background:'rgba(190,85,53,.08)',borderRadius:99,padding:'1px 7px',whiteSpace:'nowrap'}}>{items.length}개</b>
          <span className="muted" style={{fontSize:11.5,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{preview}{items.length > 3 ? ` 외 ${items.length - 3}` : ''}</span>
        </span>;
      }},
      // 적용 산출물: 이 양식의 대상 유형과 같은 유형(documents.type)의 산출물 건수 — 양식이 실제로 쓰이는지 확인
      {key:'docCount',label:'적용 산출물',render:(_v,row)=>{
        const k = String(row?.targetType || '').trim();
        const s = k ? docs[k] : undefined;
        if (!k) return <span className="muted" style={{fontSize:11.5}} title="대상 산출물 유형을 지정하면 해당 유형의 산출물 건수를 집계합니다">—</span>;
        if (!s || !s.total) return <span className="muted" style={{fontSize:11.5}} title={`'${k}' 유형의 산출물이 아직 없습니다 — 양식이 사용되지 않고 있어요`}>미사용</span>;
        return <span title={`'${k}' 산출물 총 ${s.total}건 · 승인 ${s.approved}건 · 결재요청 ${s.review}건 · 작성중 ${s.draft}건${s.rejected ? ` · 반려 ${s.rejected}건` : ''}`} style={{fontSize:12}}>
          <b>{s.approved}</b><span className="muted">/{s.total}건 승인</span>
          {s.rejected > 0 && <span title={`반려 ${s.rejected}건`} style={{marginLeft:6,color:'#c0414f',fontWeight:700,fontSize:11.5}}>⚠{s.rejected}</span>}
        </span>;
      }},
      {key:'status',label:'상태',badge:true},
    ]}
    fields={[
      {key:'name',label:'양식명',required:true,placeholder:'예: 단위테스트 결과서 양식'},
      {key:'targetType',label:'대상 산출물 유형',type:'combo',half:true,options:['요구사항정의서','설계서','테스트결과서','회의록','점검표','매뉴얼','기타']},
      {key:'status',label:'상태',type:'select',half:true,options:[{value:'draft',label:'작성중'},{value:'active',label:'사용'},{value:'archived',label:'보관'}]},
      {key:'fields',label:'양식 항목(줄바꿈으로 구분)',type:'textarea',placeholder:'항목1\n항목2\n항목3'},
      {key:'note',label:'설명·작성지침',type:'textarea'},
    ]} />;
}
