'use client';
import { useEffect, useState } from 'react';
import { ResourceView } from '@/components/ResourceView';

const norm = (v: any) => String(v ?? '').trim().toLowerCase();
// IPv4 형식(간이) — CMDB 입력 오류(오타·CIDR 혼입) 색출용
const isIPv4 = (s: string) => /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.test(s) && s.split('.').every((n) => Number(n) <= 255);

export default function Page() {
  // 동일 프로젝트 내 IP·호스트명 중복 탐지 — 페이지-로컬 보조 fetch(읽기 전용)
  const [dupIp, setDupIp] = useState<Record<string, string[]>>({});
  const [dupHost, setDupHost] = useState<Record<string, string[]>>({});
  useEffect(() => {
    const p = Number(localStorage.getItem('pms.project')) || null;
    if (!p) return;
    fetch(`/api/infra?projectId=${p}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: any[]) => {
        if (!Array.isArray(rows)) return;
        const ip: Record<string, string[]> = {}, hn: Record<string, string[]> = {};
        for (const r of rows) {
          if (norm(r?.status) === 'retired') continue; // 폐기 자산은 중복 판정에서 제외
          const label = String(r?.name || r?.code || ('#' + r?.id));
          const a = norm(r?.ipAddress); if (a) (ip[a] ||= []).push(label);
          const h = norm(r?.hostname); if (h) (hn[h] ||= []).push(label);
        }
        setDupIp(Object.fromEntries(Object.entries(ip).filter(([, v]) => v.length > 1)));
        setDupHost(Object.fromEntries(Object.entries(hn).filter(([, v]) => v.length > 1)));
      })
      .catch(() => {});
  }, []);

  return <ResourceView title="인프라 자산" subtitle="서버·네트워크·스토리지 등 자산(CMDB)을 관리합니다." endpoint="/api/infra" projectScoped entity="infra" statusKey="category"
    emptyText="등록된 인프라 자산이 없습니다. 서버·네트워크·스토리지 등 자산을 등록해 CMDB를 구성하세요."
    columns={[
      {key:'code',label:'코드'},
      {key:'name',label:'자산명',strong:true},
      {key:'category',label:'분류',badge:true},
      {key:'model',label:'모델',render:(v)=> v || <span className="muted">—</span>},
      // 위치: 사이트/랙을 한 셀에 합쳐 물리 배치를 한눈에
      {key:'location',label:'위치·랙',render:(v,row)=>{
        const loc = String(v ?? '').trim(), rack = String(row?.rack ?? '').trim();
        if (!loc && !rack) return <span className="muted" style={{fontSize:11.5}} title="사이트·랙 위치를 입력하면 표시됩니다">미지정</span>;
        return <span title={`위치 ${loc || '미지정'}${rack ? ` · 랙 ${rack}` : ' · 랙 미지정'}`} style={{cursor:'help'}}>
          {loc || <span className="muted">—</span>}
          {rack && <span style={{marginLeft:6,fontSize:11.5,color:'var(--brand)',background:'rgba(190,85,53,.08)',borderRadius:99,padding:'1px 7px',whiteSpace:'nowrap'}}>{rack}</span>}
        </span>;
      }},
      // IP: 중복 등록(같은 IP를 쓰는 다른 자산) · 형식 오류 경고 — CMDB 신뢰도의 핵심
      {key:'ipAddress',label:'IP',render:(v,row)=>{
        const ip = String(v ?? '').trim();
        const retired = norm(row?.status) === 'retired';
        if (!ip) return <span className="muted" style={{fontSize:11.5}} title="IP 주소가 등록되지 않았습니다">—</span>;
        const peers = (dupIp[norm(ip)] || []).filter((n) => n !== String(row?.name || ''));
        const bad = !isIPv4(ip);
        const dup = !retired && peers.length > 0;
        return <span style={{display:'inline-flex',alignItems:'center',gap:6}}>
          <span style={{fontVariantNumeric:'tabular-nums',color:dup?'#c0414f':undefined,fontWeight:dup?700:undefined,opacity:retired?0.55:1}}>{ip}</span>
          {dup && <span title={`같은 IP를 쓰는 자산이 있습니다 — ${peers.join(', ')} (IP 충돌 가능)`} style={{color:'#c0414f',fontWeight:700,fontSize:11.5,cursor:'help'}}>⚠ 중복</span>}
          {!dup && bad && <span title="IPv4 형식이 아닙니다 — 오타·대역(CIDR) 혼입 여부를 확인하세요" style={{color:'#d98a16',fontWeight:700,fontSize:11.5,cursor:'help'}}>형식 확인</span>}
        </span>;
      }},
      {key:'hostname',label:'호스트명',render:(v,row)=>{
        const h = String(v ?? '').trim();
        if (!h) return <span className="muted">—</span>;
        const retired = norm(row?.status) === 'retired';
        const peers = (dupHost[norm(h)] || []).filter((n) => n !== String(row?.name || ''));
        const dup = !retired && peers.length > 0;
        return <span title={dup ? `같은 호스트명을 쓰는 자산이 있습니다 — ${peers.join(', ')}` : undefined} style={{color:dup?'#c0414f':undefined,fontWeight:dup?700:undefined,cursor:dup?'help':undefined,opacity:retired?0.55:1}}>{h}{dup ? ' ⚠' : ''}</span>;
      }},
      // 사양: OS·CPU·메모리를 한 셀로 압축(전체는 툴팁)
      {key:'os',label:'사양',render:(v,row)=>{
        const os = String(v ?? '').trim(), cpu = String(row?.cpu ?? '').trim(), mem = String(row?.memory ?? '').trim();
        if (!os && !cpu && !mem) return <span className="muted" style={{fontSize:11.5}} title="OS·CPU·메모리를 입력하면 표시됩니다">미기재</span>;
        const parts = [os && `OS ${os}`, cpu && `CPU ${cpu}`, mem && `MEM ${mem}`].filter(Boolean) as string[];
        return <span title={parts.join('\n')} style={{display:'inline-block',maxWidth:200,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',cursor:'help',fontSize:12}}>
          {os || <span className="muted">—</span>}
          {(cpu || mem) && <span className="muted" style={{fontSize:11.5}}>{` · ${[cpu, mem].filter(Boolean).join(' / ')}`}</span>}
        </span>;
      }},
      {key:'owner',label:'담당',render:(v,row)=> v || (norm(row?.status) === 'retired'
        ? <span className="muted">—</span>
        : <span title="운영 자산에 담당자가 지정되지 않았습니다" style={{color:'#d98a16',fontWeight:700,fontSize:11.5,cursor:'help'}}>미지정</span>)},
      {key:'status',label:'상태',badge:true},
    ]}
    fields={[
      {key:'name',label:'자산명',required:true,placeholder:'예: WAS-01 / L4 스위치'},
      {key:'category',label:'분류',type:'select',options:['서버','네트워크','스토리지','보안','SW','DB'],half:true},
      {key:'model',label:'모델',half:true},
      {key:'location',label:'위치(사이트)',half:true,placeholder:'예: 본사 IDC 2층'},
      {key:'rack',label:'랙 위치',half:true,placeholder:'예: R-12 / U20'},
      {key:'ipAddress',label:'IP 주소',half:true,hint:'IPv4 형식(예: 10.0.1.21) — 중복 등록 시 목록에서 경고합니다'},
      {key:'hostname',label:'호스트명',half:true},
      {key:'os',label:'OS',half:true,placeholder:'예: RHEL 8.6'},
      {key:'cpu',label:'CPU',half:true,placeholder:'예: 16 vCore'},
      {key:'memory',label:'메모리',half:true,placeholder:'예: 64GB'},
      {key:'serialNo',label:'시리얼번호',half:true},
      {key:'owner',label:'담당자',type:'combo',optionsFrom:'members',half:true},
      {key:'status',label:'상태',type:'select',options:['active','standby','retired'],half:true},
    ]} />;
}
