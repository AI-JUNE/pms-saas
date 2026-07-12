'use client';
import { useEffect, useState } from 'react';
import { ResourceView } from '@/components/ResourceView';

const norm = (v: any) => String(v ?? '').trim().toLowerCase();
const CLOSED = ['rejected', 'completed'];           // 만료 경고 제외(회수 완료·반려)
const OPENED = ['approved', 'completed'];           // 승인 이후 — 사유·승인자 증빙 필수

// IPv4 / CIDR 간이 검증 — 오타·표기 오류 색출용
const isIPv4 = (s: string) => /^(\d{1,3}\.){3}\d{1,3}$/.test(s) && s.split('.').every((n) => Number(n) <= 255);
const isCidr = (s: string) => {
  const [ip, m] = s.split('/');
  return s.includes('/') && isIPv4(ip) && /^\d{1,2}$/.test(m || '') && Number(m) <= 32;
};
// 전체 대역(any) — 방화벽 보안심사 지적 1순위
const isAny = (s: string) => ['any', '*', '0.0.0.0', '0.0.0.0/0', 'all', '전체'].includes(norm(s));
// 포트: 단일(443) · 범위(8000-8100) · 목록(80,443)
const portParts = (s: string) => String(s || '').split(/[,\s]+/).map((x) => x.trim()).filter(Boolean);
const isAnyPort = (s: string) => isAny(s) || /^1\s*-\s*65535$/.test(String(s || '').trim());
const badPort = (s: string) =>
  portParts(s).some((p) => {
    const m = p.match(/^(\d+)\s*-\s*(\d+)$/);
    if (m) return !(Number(m[1]) >= 1 && Number(m[2]) <= 65535 && Number(m[1]) <= Number(m[2]));
    return !/^\d+$/.test(p) || Number(p) < 1 || Number(p) > 65535;
  });
// 허용 포트 개수(광범위 오픈 판단용)
const portWidth = (s: string) =>
  portParts(s).reduce((acc, p) => {
    const m = p.match(/^(\d+)\s*-\s*(\d+)$/);
    return acc + (m ? Math.max(0, Number(m[2]) - Number(m[1]) + 1) : 1);
  }, 0);
const lines = (v: any) =>
  String(v ?? '').split(/\r?\n/).map((s) => s.replace(/^\s*(?:[-*·•]|\d+[.)])\s*/, '').trim()).filter(Boolean);

const RED = '#c0414f', ORANGE = '#d98a16', GREEN = '#2f8f5b';

export default function Page() {
  // 동일 프로젝트 내 '동일 정책(출발지·목적지·포트·프로토콜)' 중복 신청 탐지 — 페이지-로컬 보조 fetch(읽기 전용)
  const [dup, setDup] = useState<Record<string, string[]>>({});
  useEffect(() => {
    const p = Number(localStorage.getItem('pms.project')) || null;
    if (!p) return;
    fetch(`/api/firewall?projectId=${p}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: any[]) => {
        if (!Array.isArray(rows)) return;
        const m: Record<string, string[]> = {};
        for (const r of rows) {
          if (norm(r?.status) === 'rejected') continue; // 반려 신청은 중복 판정 제외
          const k = [norm(r?.srcIp), norm(r?.dstIp), norm(r?.port), norm(r?.protocol)].join('|');
          if (k === '|||') continue;
          (m[k] ||= []).push(String(r?.title || r?.code || '#' + r?.id));
        }
        setDup(Object.fromEntries(Object.entries(m).filter(([, v]) => v.length > 1)));
      })
      .catch(() => {});
  }, []);
  const dupOf = (row: any) => dup[[norm(row?.srcIp), norm(row?.dstIp), norm(row?.port), norm(row?.protocol)].join('|')];

  return <ResourceView title="방화벽 신청" subtitle="방화벽 오픈 신청과 승인 상태를 관리합니다." endpoint="/api/firewall" projectScoped entity="firewall"
    emptyText="등록된 방화벽 신청이 없습니다. 출발지·목적지·포트를 지정해 오픈 신청을 등록하세요."
    columns={[
      {key:'code',label:'코드'},
      {key:'title',label:'제목',strong:true,render:(v,row)=>{
        const d = dupOf(row);
        return <span className="row" style={{gap:6}}>
          <span>{v}</span>
          {d && d.length > 1 && <span title={`동일한 정책(출발지·목적지·포트·프로토콜)의 신청이 ${d.length}건 있습니다 — ${d.join(' · ')}\n중복 신청이면 하나로 정리하세요.`} style={{color:RED,fontWeight:700,fontSize:11,cursor:'help'}}>⚠ 중복</span>}
        </span>;
      }},
      // 출발지 → 목적지: 두 IP를 한 셀로 합치고 형식·전체대역(any) 검증
      {key:'srcIp',label:'출발지 → 목적지',render:(v,row)=>{
        const s = String(v ?? '').trim(), d = String(row?.dstIp ?? '').trim();
        if (!s && !d) return <span className="muted">—</span>;
        const cell = (ip: string, who: string) => {
          if (!ip) return <span title={`${who} IP가 비어 있습니다`} style={{color:ORANGE,fontSize:11.5,cursor:'help'}}>미지정</span>;
          const any = isAny(ip);
          const bad = !any && !isIPv4(ip) && !isCidr(ip);
          const col = any ? RED : bad ? ORANGE : undefined;
          const tip = any ? `${who}가 전체 대역(any)입니다 — 필요한 대역으로 좁히세요`
            : bad ? `${who} IP 형식을 확인하세요 (예: 10.0.1.20 또는 10.0.1.0/24)` : undefined;
          return <span title={tip} style={{color:col,fontWeight:col?700:undefined,cursor:tip?'help':undefined,fontFamily:'ui-monospace,monospace',fontSize:11.5}}>{ip}{any?' ⚠':''}</span>;
        };
        return <span className="row" style={{gap:5,whiteSpace:'nowrap'}}>{cell(s,'출발지')}<span className="muted">→</span>{cell(d,'목적지')}</span>;
      }},
      // 포트·프로토콜: 형식 검증 + 광범위 오픈 경고
      {key:'port',label:'포트·프로토콜',render:(v,row)=>{
        const p = String(v ?? '').trim(), proto = String(row?.protocol ?? '').trim();
        const opened = OPENED.includes(norm(row?.status));
        if (!p) return <span className="row" style={{gap:6}}>
          <span className={opened?undefined:'muted'} title={opened?'승인된 신청인데 포트가 비어 있습니다 — 허용 범위가 불명확합니다':'포트를 입력하세요'} style={{color:opened?RED:undefined,fontWeight:opened?700:undefined,fontSize:11.5,cursor:'help'}}>{opened?'⚠ 포트 미지정':'미지정'}</span>
          {proto && <span className="muted" style={{fontSize:11}}>{proto}</span>}
        </span>;
        const any = isAnyPort(p), bad = !any && badPort(p), wide = !any && !bad && portWidth(p) > 100;
        const col = any ? RED : bad ? ORANGE : wide ? ORANGE : undefined;
        const tip = any ? '전체 포트(1-65535) 허용입니다 — 필요한 포트만 지정하세요'
          : bad ? '포트 형식을 확인하세요 (예: 443 · 8000-8100 · 80,443)'
          : wide ? `허용 포트 ${portWidth(p).toLocaleString()}개 — 범위가 넓습니다. 꼭 필요한 범위인지 확인하세요`
          : `허용 포트 ${portWidth(p)}개${proto?` · ${proto}`:''}`;
        return <span className="row" style={{gap:6,whiteSpace:'nowrap'}} title={tip}>
          <span style={{color:col,fontWeight:col?700:undefined,fontFamily:'ui-monospace,monospace',fontSize:11.5,cursor:'help'}}>{p}{any?' ⚠':''}</span>
          {proto && <span style={{fontSize:10.5,padding:'1px 5px',borderRadius:4,background:'rgba(190,85,53,.10)',color:'var(--brand)',fontWeight:600}}>{proto}</span>}
        </span>;
      }},
      // 사유·승인자: 승인 이후인데 증빙이 비면 경고(보안심사·감리 지적 대상)
      {key:'reason',label:'사유·승인',render:(v,row)=>{
        const ls = lines(v), approver = String(row?.approver ?? '').trim();
        const opened = OPENED.includes(norm(row?.status));
        return <span style={{display:'inline-flex',flexDirection:'column',gap:2,maxWidth:240}}>
          {ls.length === 0
            ? <span className={opened?undefined:'muted'} title={opened?'승인된 신청인데 오픈 사유가 없습니다 — 보안심사·감리 지적 대상입니다':'오픈 사유를 작성하세요'} style={{color:opened?RED:undefined,fontWeight:opened?700:undefined,fontSize:11.5,cursor:'help'}}>{opened?'⚠ 사유 미작성':'사유 미작성'}</span>
            : <span title={ls.map((l,i)=>`${i+1}. ${l}`).slice(0,6).join('\n')} style={{fontSize:11.5,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',cursor:'help'}}>{ls[0]}{ls.length>1?` 외 ${ls.length-1}`:''}</span>}
          {approver
            ? <span title={`승인자 ${approver}`} style={{fontSize:10.5,color:GREEN,fontWeight:600}}>승인 {approver}</span>
            : opened
              ? <span title="승인·완료 상태인데 승인자가 기록되지 않았습니다 — 결재 이력을 남기세요" style={{fontSize:10.5,color:ORANGE,fontWeight:700,cursor:'help'}}>승인자 없음</span>
              : null}
        </span>;
      }},
      // 만료: 기존 D-day 규칙 + '승인된 채 만료 경과 = 회수 필요' 진단
      {key:'expireDate',label:'만료',render:(v,row)=>{
        const st = norm(row?.status);
        if (!v) return OPENED.includes(st)
          ? <span title="승인된 정책인데 만료일이 없습니다 — 영구 오픈은 회수 시점을 관리할 수 없습니다" style={{color:ORANGE,fontWeight:700,fontSize:11.5,cursor:'help'}}>기한 없음</span>
          : <span className="muted">—</span>;
        const t = new Date(v).getTime();
        if (CLOSED.includes(st) || isNaN(t)) return <span className="muted">{v}</span>;
        const now = Date.now();
        const dd = Math.ceil((t - now) / 86400000), od = Math.floor((now - t) / 86400000);
        const over = t < now;
        const col = over ? RED : dd <= 7 ? ORANGE : undefined;
        const base = over ? (od >= 1 ? `${od}일 만료 초과` : '오늘 만료') : (dd <= 0 ? '오늘 만료' : `D-${dd}`);
        const revoke = over && st === 'approved'; // 만료됐는데 아직 열려 있는 정책
        const tip = revoke ? `${base} — 만료된 정책이 승인 상태로 남아 있습니다. 회수(완료 처리)하세요` : base;
        return <span className="row" style={{gap:5,whiteSpace:'nowrap'}}>
          <span title={col?tip:undefined} style={{color:col,fontWeight:col?700:undefined,cursor:col?'help':undefined}}>{v}{over?' ⚠':''}</span>
          {revoke && <span title={tip} style={{fontSize:10.5,color:RED,fontWeight:700,cursor:'help'}}>회수 필요</span>}
        </span>;
      }},
      {key:'status',label:'상태',badge:true},
    ]}
    fields={[
      {key:'title',label:'제목',required:true,placeholder:'예: 운영 WAS → DB 3306 오픈'},
      {key:'srcIp',label:'출발지 IP',half:true,placeholder:'10.0.1.20 또는 10.0.1.0/24',hint:'단일 IP 또는 CIDR. any(전체 대역)는 보안심사 지적 대상입니다'},
      {key:'dstIp',label:'목적지 IP',half:true,placeholder:'10.0.2.30 또는 10.0.2.0/24'},
      {key:'port',label:'포트',half:true,placeholder:'443 · 8000-8100 · 80,443',hint:'단일·범위·목록 입력 가능 — 꼭 필요한 포트만 지정하세요'},
      {key:'protocol',label:'프로토콜',type:'select',options:['TCP','UDP','ICMP'],half:true},
      {key:'reason',label:'사유',type:'textarea',hint:'한 줄에 사유 하나씩 — 업무 목적·대상 시스템·기간 근거 (승인 시 필수 증빙)'},
      {key:'approver',label:'승인자',half:true,type:'combo',optionsFrom:'members',placeholder:'선택하거나 직접 입력'},
      {key:'expireDate',label:'만료일',type:'date',half:true,hint:'만료일이 지난 승인 정책은 목록에 "회수 필요"로 표시됩니다'},
      {key:'status',label:'상태',type:'select',options:['requested','approved','rejected','completed']},
    ]} />;
}
