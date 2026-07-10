'use client';
import { ResourceView } from '@/components/ResourceView';
import { CalendarView } from '@/components/views';
export default function Page() {
  return <ResourceView title="회의" subtitle="회의록과 결정사항을 기록합니다." endpoint="/api/meetings" entity="meetings" projectScoped statusKey="location"
    columns={[{key:'code',label:'코드'},{key:'title',label:'제목',strong:true},{key:'meetingDate',label:'일자'},{key:'location',label:'장소'},{key:'attendees',label:'참석자'},{key:'nextDate',label:'차기',render:(v)=>{if(!v)return '—';const t=new Date(v).getTime();if(isNaN(t))return v;const now=Date.now();const dd=Math.ceil((t-now)/86400000);const past=Math.floor((now-t)/86400000);if(t<now){const tip=past>=1?`차기 회의일 ${past}일 지남`:'차기 회의일 오늘';return <span title={tip} style={{color:'#9a9a9a',cursor:'help'}}>{v}</span>;}const soon=dd<=7;const col=soon?'#d98a16':undefined;const tip=dd<=0?'오늘 회의':`D-${dd}`;return <span title={tip} style={{color:col,fontWeight:soon?700:undefined,cursor:'help'}}>{v}{soon?` · ${dd<=0?'오늘':'D-'+dd}`:''}</span>;}}]}
    fields={[{key:'title',label:'제목',required:true},{key:'meetingDate',label:'일자',type:'date',half:true},{key:'location',label:'장소',half:true},{key:'attendees',label:'참석자'},{key:'agenda',label:'안건',type:'textarea'},{key:'decisions',label:'결정사항',type:'textarea'},{key:'actionItems',label:'후속조치(Action Item)',type:'textarea'},{key:'nextDate',label:'차기 회의일',type:'date',half:true}]} />;
}
