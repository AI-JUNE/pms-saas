'use client';
import { ResourceView } from '@/components/ResourceView';
import { CalendarView } from '@/components/views';
export default function Page() {
  return <ResourceView title="회의" subtitle="회의록과 결정사항을 기록합니다." endpoint="/api/meetings" entity="meetings" projectScoped statusKey="location"
    columns={[{key:'code',label:'코드'},{key:'title',label:'제목',strong:true},{key:'meetingDate',label:'일자'},{key:'location',label:'장소'},{key:'attendees',label:'참석자'},{key:'nextDate',label:'차기'}]}
    fields={[{key:'title',label:'제목',required:true},{key:'meetingDate',label:'일자',type:'date',half:true},{key:'location',label:'장소',half:true},{key:'attendees',label:'참석자'},{key:'agenda',label:'안건',type:'textarea'},{key:'decisions',label:'결정사항',type:'textarea'},{key:'actionItems',label:'후속조치(Action Item)',type:'textarea'},{key:'nextDate',label:'차기 회의일',type:'date',half:true}]} />;
}
