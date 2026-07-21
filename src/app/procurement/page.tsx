'use client';
import { useEffect, useState } from 'react';
import { ResourceView } from '@/components/ResourceView';

const KRW = (n: number) => Number(n).toLocaleString('ko-KR') + '\uc6d0';
// 수량×단가 — 둘 중 하나라도 비어 있으면 산정 불가(null)
const amountOf = (r: any): number | null => {
  const q = Number(r?.qty), p = Number(r?.unitPrice);
  if (!r?.qty || !r?.unitPrice || !Number.isFinite(q) || !Number.isFinite(p)) return null;
  return q * p;
};
const ORDERED_UP = ['ordered', 'received', 'completed'];   // 발주 이후 단계
const RECEIVED_UP = ['received', 'completed'];             // 입고 이후 단계

export default function Page() {
  // 조달 총액 집계(금액 비중 표기용) — 페이지-로컬 보조 fetch(읽기 전용)
  const [total, setTotal] = useState(0);
  useEffect(() => {
    const p = Number(localStorage.getItem('pms.project')) || null;
    if (!p) return;
    fetch(`/api/procurement?projectId=${p}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: any[]) => {
        if (!Array.isArray(rows)) return;
        setTotal(rows.reduce((s, r) => s + (amountOf(r) ?? 0), 0));
      })
      .catch(() => {});
  }, []);

  return <ResourceView title="조달" subtitle="장비·SW 조달 품목과 발주 상태를 관리합니다." endpoint="/api/procurement" projectScoped entity="procurement" statusKey="category"
    emptyText="등록된 조달 품목이 없습니다. 장비·SW·라이선스 등 구매 품목을 등록해 발주·입고를 추적하세요."
    columns={[
      {key:'code',label:'코드'},
      {key:'item',label:'품목',strong:true},
      {key:'category',label:'분류',badge:true},
      {key:'qty',label:'수량',render:(v)=> v ? <span style={{fontVariantNumeric:'tabular-nums'}}>{Number(v).toLocaleString('ko-KR')}</span> : <span className="muted">—</span>},
      {key:'unitPrice',label:'단가',render:(v)=> v ? <span style={{fontVariantNumeric:'tabular-nums'}}>{KRW(v)}</span> : <span className="muted">—</span>},
      // 금액: 수량×단가 산출 + 프로젝트 조달 총액 대비 비중 바. 발주 이후인데 금액이 없으면 경고(예산 집계 누락)
      {key:'amount',label:'금액',render:(_v,row)=>{
        const a = amountOf(row);
        const st = String(row?.status ?? '');
        if (a === null) {
          return ORDERED_UP.includes(st)
            ? <span title="발주 이후 단계인데 수량 또는 단가가 비어 있어 금액을 산정할 수 없습니다 — 조달 예산 집계에서 빠집니다" style={{color:'#c0414f',fontWeight:700,fontSize:11.5}}>⚠ 금액 미산정</span>
            : <span className="muted" style={{fontSize:11.5}} title="수량과 단가를 모두 입력하면 금액이 자동 산출됩니다">미산정</span>;
        }
        const pct = total > 0 ? (a / total) * 100 : 0;
        const tip = `수량 ${Number(row.qty).toLocaleString('ko-KR')} × 단가 ${KRW(row.unitPrice)} = ${KRW(a)}` + (total > 0 ? `\n조달 총액 ${KRW(total)} 중 ${pct.toFixed(1)}%` : '');
        return <span title={tip} style={{display:'inline-flex',alignItems:'center',gap:6,cursor:'help'}}>
          <b style={{fontVariantNumeric:'tabular-nums'}}>{KRW(a)}</b>
          {total > 0 && <span style={{display:'inline-block',width:38,height:4,borderRadius:99,background:'rgba(148,163,184,.25)',overflow:'hidden'}}>
            <span style={{display:'block',width:`${Math.min(100, Math.max(3, pct))}%`,height:'100%',background:'var(--brand)'}} />
          </span>}
          {total > 0 && <span className="muted" style={{fontSize:11,fontVariantNumeric:'tabular-nums'}}>{pct.toFixed(0)}%</span>}
        </span>;
      }},
      {key:'vendor',label:'업체',render:(v,row)=> v
        ? <span>{v}</span>
        : (ORDERED_UP.includes(String(row?.status ?? ''))
            ? <span title="발주 이후 단계인데 업체가 비어 있습니다" style={{color:'#d98a16',fontWeight:700,fontSize:11.5}}>미지정</span>
            : <span className="muted">—</span>)},
      // 발주·입고: 발주번호·입고일과 상태의 정합성 검사 — 상태만 넣고 근거(발주번호·입고일)는 비운 행을 색출
      {key:'poNumber',label:'발주·입고',render:(v,row)=>{
        const st = String(row?.status ?? '');
        const po = String(v ?? '').trim();
        const rc = String(row?.receiptDate ?? '').trim();
        const chips: any[] = [];
        if (po) chips.push(<b key="po" title={`발주번호 ${po}`} style={{fontSize:11.5,color:'var(--brand)',background:'rgba(190,85,53,.08)',borderRadius:99,padding:'1px 7px',whiteSpace:'nowrap'}}>{po}</b>);
        if (rc) chips.push(<span key="rc" title={`입고일 ${rc}`} style={{fontSize:11.5,color:'#2f8f5b',fontWeight:700,whiteSpace:'nowrap'}}>입고 {rc}</span>);
        const warns: any[] = [];
        if (!po && ORDERED_UP.includes(st)) warns.push(<span key="w1" title="발주 이후 단계인데 발주번호(PO)가 기재되지 않았습니다 — 감리·정산 시 증빙 누락" style={{color:'#c0414f',fontWeight:700,fontSize:11.5,cursor:'help'}}>⚠ 발주번호 없음</span>);
        if (!rc && RECEIVED_UP.includes(st)) warns.push(<span key="w2" title="입고·완료 상태인데 입고일이 비어 있습니다 — 검수 일자를 기록하세요" style={{color:'#c0414f',fontWeight:700,fontSize:11.5,cursor:'help'}}>⚠ 입고일 없음</span>);
        if (rc && !RECEIVED_UP.includes(st)) warns.push(<span key="w3" title="입고일이 기록됐는데 상태가 아직 입고로 바뀌지 않았습니다 — 상태를 갱신하세요" style={{color:'#d98a16',fontWeight:700,fontSize:11.5,cursor:'help'}}>상태 미갱신</span>);
        if (!chips.length && !warns.length) return <span className="muted" style={{fontSize:11.5}} title="발주번호·입고일을 입력하면 여기에 표시됩니다">—</span>;
        return <span style={{display:'inline-flex',alignItems:'center',gap:6,flexWrap:'wrap'}}>{chips}{warns}</span>;
      }},
      {key:'deliveryDate',label:'납기',render:(v,row)=>{
        if(!v) return <span className="muted">—</span>;
        const done=RECEIVED_UP.includes(String(row.status));
        const t=new Date(v).getTime();
        if(done||isNaN(t)) return <span title={done?'입고 완료 — 납기 경고 해제':undefined} className={done?'muted':undefined}>{v}</span>;
        const now=Date.now();
        const dd=Math.ceil((t-now)/86400000);
        const od=Math.floor((now-t)/86400000);
        const col=t<now?'#c0414f':dd<=7?'#d98a16':undefined;
        const tip=col?(t<now?(od>=1?`${od}일 납기 초과`:'오늘 납기'):(dd<=0?'오늘 납기':`D-${dd}`)):undefined;
        return <span title={tip} style={{color:col,fontWeight:col?700:undefined,cursor:tip?'help':undefined}}>{v}{col==='#c0414f'?' ⚠':''}</span>;
      }},
      {key:'status',label:'상태',badge:true},
    ]}
    fields={[
      {key:'item',label:'품목명',required:true,placeholder:'예: WAS 서버(2대) / DBMS 라이선스'},
      {key:'category',label:'분류',type:'select',options:['HW','SW','네트워크','라이선스','용역'],half:true},
      {key:'vendor',label:'업체',half:true,placeholder:'공급·납품 업체명'},
      {key:'poNumber',label:'발주번호(PO)',half:true,hint:'발주 이후에는 반드시 기재 — 정산·감리 증빙'},
      {key:'qty',label:'수량',type:'number',numeric:true,half:true},
      {key:'unitPrice',label:'단가(원)',type:'number',comma:true,numeric:true,half:true,hint:'수량×단가로 금액이 자동 산출됩니다'},
      {key:'deliveryDate',label:'납기일',type:'date',half:true},
      {key:'receiptDate',label:'입고일',type:'date',half:true,hint:'입고 처리 시 상태도 ‘입고’로 함께 변경하세요'},
      {key:'status',label:'상태',type:'select',options:['requested','ordered','received','completed']},
    ]} />;
}
