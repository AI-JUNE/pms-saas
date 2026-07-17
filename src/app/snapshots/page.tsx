'use client';
import { ResourceView } from '@/components/ResourceView';

const BAR = (v: any) => (
  <div className="row" style={{ gap: 8 }}>
    <div className="bar" style={{ minWidth: 44 }}><i style={{ width: `${Math.min(100, v || 0)}%` }} /></div>
    <span className="muted" style={{ fontSize: 11.5 }}>{v || 0}%</span>
  </div>
);

// 비고(note)를 줄 단위로 파싱해 미리보기 + 툴팁 (boards·interfaces와 동일 패턴)
function noteLines(v: any): string[] {
  return String(v || '').split(/\r?\n/).map((s) => s.replace(/^\s*[-*·•]\s*/, '').trim()).filter(Boolean);
}
function noteCell(v: any) {
  const ls = noteLines(v);
  if (!ls.length) return <span className="muted" style={{ fontSize: 12 }} title="비고가 비어 있습니다 — 괴리·기성 판단 근거를 적어두면 검수·감리 대응에 도움이 됩니다.">—</span>;
  const head = ls[0].length > 24 ? `${ls[0].slice(0, 24)}…` : ls[0];
  const tip = ls.slice(0, 8).map((s, i) => `${i + 1}. ${s}`).join('\n') + (ls.length > 8 ? `\n… 외 ${ls.length - 8}줄` : '');
  return (
    <span title={tip} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'help', maxWidth: 260 }}>
      {ls.length > 1 && <span style={{ fontSize: 10.5, fontWeight: 700, padding: '1px 6px', borderRadius: 999, background: 'rgba(190,85,53,.12)', color: 'var(--brand)', whiteSpace: 'nowrap' }}>{ls.length}줄</span>}
      <span className="muted" style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{head}</span>
    </span>
  );
}

// 기준일: 없으면 명시적으로 '미지정' 표기 (스냅샷은 기준 시점이 없으면 의미가 없음)
function dateCell(v: any) {
  if (!v) return <span className="muted" title="기준일이 지정되지 않았습니다 — 어느 시점의 진척·기성인지 알 수 없습니다.">미지정</span>;
  const t = new Date(v).getTime();
  if (isNaN(t)) return v;
  return <span style={{ whiteSpace: 'nowrap' }}>{new Date(v).toLocaleDateString('ko-KR')}</span>;
}

// 진척 괴리(실적-계획) + 기성 적정성(기성률-실적) 진단
function gapCell(_v: any, r: any) {
  const planned = Number(r?.plannedPct ?? 0);
  const actual = Number(r?.actualPct ?? 0);
  const billing = Number(r?.billingPct ?? 0);
  const hasPlan = r?.plannedPct != null && r?.plannedPct !== '';
  const hasActual = r?.actualPct != null && r?.actualPct !== '';
  if (!hasPlan || !hasActual) return <span className="muted" title="계획·실적 진척을 모두 입력하면 괴리를 진단합니다">—</span>;

  const sv = Math.round((actual - planned) * 10) / 10; // %p
  const color = sv <= -10 ? '#c0414f' : sv < 0 ? '#d98a16' : '#2f8f5b';
  const label = sv > 0 ? `+${sv}%p` : `${sv}%p`;
  const svText = sv < 0 ? `계획보다 ${Math.abs(sv)}%p 지연` : sv > 0 ? `계획보다 ${sv}%p 선행` : '계획대로 진행';

  // 기성 적정성: 기성률이 실적 진척을 크게 앞서면 과다청구, 크게 뒤지면 청구 누락 소지
  const bg = Math.round((billing - actual) * 10) / 10;
  const hasBilling = r?.billingPct != null && r?.billingPct !== '';
  let warn = '';
  if (hasBilling) {
    if (bg >= 10) warn = `기성률이 실적보다 ${bg}%p 앞섬 — 과다청구 검토`;
    else if (bg <= -10) warn = `기성률이 실적보다 ${Math.abs(bg)}%p 뒤짐 — 청구 누락 검토`;
  }
  const tip = `계획 ${planned}% · 실적 ${actual}%\n${svText}` + (warn ? `\n${warn}` : hasBilling ? `\n기성률 ${billing}% — 실적과 정합(±10%p 이내)` : '');

  return (
    <div className="row" style={{ gap: 6, alignItems: 'center' }} title={tip}>
      <span style={{ color, fontWeight: 700, fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>{label}</span>
      {sv <= -10 && <span style={{ color: '#c0414f', fontSize: 11 }}>⚠</span>}
      {!!warn && (
        <span style={{ fontSize: 10.5, padding: '1px 6px', borderRadius: 999, background: '#fbeee6', color: '#be5535', border: '1px solid #eed7c6', whiteSpace: 'nowrap' }}>
          {bg >= 10 ? '기성 과다' : '기성 과소'}
        </span>
      )}
    </div>
  );
}

export default function Page() {
  return <ResourceView title="기성고·스냅샷" subtitle="기준 시점(차수·마일스톤)별 계획/실적 진척과 기성률을 기록합니다." endpoint="/api/snapshots" entity="snapshots" projectScoped
    emptyText="등록된 스냅샷이 없습니다. “새로 만들기”로 기준 시점별 계획/실적 진척과 기성률을 기록하세요."
    columns={[{key:'code',label:'코드'},{key:'label',label:'기준',strong:true},{key:'snapshotDate',label:'기준일',render:dateCell},{key:'plannedPct',label:'계획',render:BAR},{key:'actualPct',label:'실적',render:BAR},{key:'gap',label:'괴리',render:gapCell},{key:'billingPct',label:'기성률',render:(v)=>(<div className="row" style={{gap:8}}><div className="bar" style={{minWidth:44}}><i style={{width:`${Math.min(100,v||0)}%`,background:'linear-gradient(90deg,#e6915f,#be5535)'}}/></div><span style={{fontWeight:700,fontSize:11.5}}>{v||0}%</span></div>)},{key:'note',label:'비고',render:noteCell}]}
    fields={[
      {key:'label',label:'기준(차수/마일스톤)',required:true,placeholder:'예: 3월말 기성'},
      {key:'snapshotDate',label:'기준일',type:'date',half:true},
      {key:'billingPct',label:'기성률(%)',type:'number',half:true},
      {key:'plannedPct',label:'계획 진척(%)',type:'number',half:true},
      {key:'actualPct',label:'실적 진척(%)',type:'number',half:true},
      {key:'note',label:'비고',type:'textarea',hint:'한 줄에 항목 하나씩 — 괴리·기성 판단 근거, 마일스톤 메모 등. 목록에서 미리보기·툴팁으로 확인됩니다.'},
    ]} />;
}