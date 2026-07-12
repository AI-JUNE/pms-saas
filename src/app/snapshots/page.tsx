'use client';
import { ResourceView } from '@/components/ResourceView';

const BAR = (v: any) => (
  <div className="row" style={{ gap: 8 }}>
    <div className="bar" style={{ minWidth: 44 }}><i style={{ width: `${Math.min(100, v || 0)}%` }} /></div>
    <span className="muted" style={{ fontSize: 11.5 }}>{v || 0}%</span>
  </div>
);

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
    columns={[{key:'code',label:'코드'},{key:'label',label:'기준',strong:true},{key:'snapshotDate',label:'기준일'},{key:'plannedPct',label:'계획',render:BAR},{key:'actualPct',label:'실적',render:BAR},{key:'gap',label:'괴리',render:gapCell},{key:'billingPct',label:'기성률',render:(v)=>(<div className="row" style={{gap:8}}><div className="bar" style={{minWidth:44}}><i style={{width:`${Math.min(100,v||0)}%`,background:'linear-gradient(90deg,#e6915f,#be5535)'}}/></div><span style={{fontWeight:700,fontSize:11.5}}>{v||0}%</span></div>)}]}
    fields={[
      {key:'label',label:'기준(차수/마일스톤)',required:true,placeholder:'예: 3월말 기성'},
      {key:'snapshotDate',label:'기준일',type:'date',half:true},
      {key:'billingPct',label:'기성률(%)',type:'number',half:true},
      {key:'plannedPct',label:'계획 진척(%)',type:'number',half:true},
      {key:'actualPct',label:'실적 진척(%)',type:'number',half:true},
      {key:'note',label:'비고',type:'textarea'},
    ]} />;
}
