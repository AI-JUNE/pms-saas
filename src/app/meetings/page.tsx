'use client';
import { ResourceView } from '@/components/ResourceView';
import { CalendarView } from '@/components/views';

// 회의록의 가치는 '결정사항·후속조치'에 있는데 목록에는 전혀 드러나지 않았다.
// decisions/actionItems/attendees는 목록 API가 이미 전체 행을 돌려주므로 추가 fetch 없이 파싱만 한다(읽기 전용).
const lines = (v: any): string[] =>
  String(v || '')
    .split(/[\r\n]+/)
    .map((s) => s.replace(/^[\s\-*·•\d.)]+/, '').trim())
    .filter(Boolean);
const people = (v: any): string[] =>
  String(v || '')
    .split(/[,、·\r\n/]+/)
    .map((s) => s.trim())
    .filter(Boolean);
const isPast = (v: any) => {
  if (!v) return false;
  const t = new Date(v).getTime();
  if (isNaN(t)) return false;
  const d = new Date(v); d.setHours(23, 59, 59, 999);
  return d.getTime() < Date.now();
};
const chip = (text: string, color: string, bg: string) => (
  <span style={{ display: 'inline-block', padding: '1px 6px', borderRadius: 4, fontSize: 11, fontWeight: 700, color, background: bg, whiteSpace: 'nowrap' }}>{text}</span>
);

export default function Page() {
  return <ResourceView title="회의" subtitle="회의록과 결정사항을 기록합니다." endpoint="/api/meetings" entity="meetings" projectScoped statusKey="location"
    columns={[
      {key:'code',label:'코드'},
      {key:'title',label:'제목',strong:true},
      {key:'meetingDate',label:'일자',render:(v)=>{if(!v)return '—';const t=new Date(v).getTime();if(isNaN(t))return v;const now=Date.now();const dd=Math.ceil((t-now)/86400000);if(t<now)return v;const soon=dd<=7;if(!soon)return v;const tip=dd<=0?'오늘 회의':`D-${dd}`;return <span title={tip} style={{color:'#d98a16',fontWeight:700,cursor:'help'}}>{v} · {dd<=0?'오늘':'D-'+dd}</span>;}},
      {key:'location',label:'장소'},
      {key:'attendees',label:'참석자',render:(v)=>{
        const ps = people(v);
        if (!ps.length) return <span style={{color:'#9a9a9a'}} title="참석자 미기록">—</span>;
        const head = ps.slice(0, 3).join(' · ');
        const tip = `참석자 ${ps.length}명\n${ps.map((p, i) => `${i + 1}. ${p}`).join('\n')}`;
        return (
          <span title={tip} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'help', maxWidth: 220 }}>
            {chip(`${ps.length}명`, 'var(--brand)', 'rgba(190,85,53,.10)')}
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#6b6b6b', fontSize: 12 }}>
              {head}{ps.length > 3 ? ` 외 ${ps.length - 3}` : ''}
            </span>
          </span>
        );
      }},
      {key:'minutes',label:'결정·조치',render:(_v,row)=>{
        const dec = lines(row?.decisions);
        const act = lines(row?.actionItems);
        const agenda = lines(row?.agenda);
        const past = isPast(row?.meetingDate);
        if (!dec.length && !act.length) {
          if (past) return <span title={`회의일(${row?.meetingDate || '-'})이 지났는데 결정사항·후속조치가 기록되지 않았습니다.${agenda.length ? `\n안건 ${agenda.length}건은 등록되어 있습니다 — 회의록을 작성하세요.` : ''}`} style={{color:'#c0414f',fontWeight:700,cursor:'help'}}>⚠ 회의록 미작성</span>;
          return <span style={{color:'#9a9a9a',cursor:'help'}} title={agenda.length ? `예정 회의 — 안건 ${agenda.length}건 등록됨` : '예정 회의 — 안건 미등록'}>{agenda.length ? `안건 ${agenda.length}건` : '—'}</span>;
        }
        const tip = [
          agenda.length ? `안건 ${agenda.length}건` : '안건 미등록',
          dec.length ? `결정사항 ${dec.length}건\n${dec.slice(0, 5).map((d, i) => `  ${i + 1}. ${d}`).join('\n')}${dec.length > 5 ? `\n  … 외 ${dec.length - 5}건` : ''}` : '결정사항 없음',
          act.length ? `후속조치 ${act.length}건\n${act.slice(0, 5).map((a, i) => `  ${i + 1}. ${a}`).join('\n')}${act.length > 5 ? `\n  … 외 ${act.length - 5}건` : ''}` : '후속조치 없음',
        ].join('\n');
        return (
          <span title={tip} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, cursor: 'help' }}>
            {dec.length ? chip(`결정 ${dec.length}`, '#2f8f5b', 'rgba(47,143,91,.10)') : null}
            {act.length ? chip(`조치 ${act.length}`, '#d98a16', 'rgba(217,138,22,.12)') : null}
            {!act.length && dec.length && past ? <span style={{ color: '#9a9a9a', fontSize: 11 }}>조치 없음</span> : null}
          </span>
        );
      }},
      {key:'nextDate',label:'차기',render:(v)=>{if(!v)return '—';const t=new Date(v).getTime();if(isNaN(t))return v;const now=Date.now();const dd=Math.ceil((t-now)/86400000);const past=Math.floor((now-t)/86400000);if(t<now){const tip=past>=1?`차기 회의일 ${past}일 지남`:'차기 회의일 오늘';return <span title={tip} style={{color:'#9a9a9a',cursor:'help'}}>{v}</span>;}const soon=dd<=7;const col=soon?'#d98a16':undefined;const tip=dd<=0?'오늘 회의':`D-${dd}`;return <span title={tip} style={{color:col,fontWeight:soon?700:undefined,cursor:'help'}}>{v}{soon?` · ${dd<=0?'오늘':'D-'+dd}`:''}</span>;}},
    ]}
    altViews={[{ key: 'cal', label: '캘린더', render: (rows, openDetail) => <CalendarView rows={rows} dateKey="meetingDate" openDetail={openDetail} /> }]}
    fields={[{key:'title',label:'제목',required:true},{key:'meetingDate',label:'일자',type:'date',half:true},{key:'location',label:'장소',half:true},{key:'attendees',label:'참석자'},{key:'agenda',label:'안건',type:'textarea'},{key:'decisions',label:'결정사항',type:'textarea'},{key:'actionItems',label:'후속조치(Action Item)',type:'textarea'},{key:'nextDate',label:'차기 회의일',type:'date',half:true}]} />;
}
