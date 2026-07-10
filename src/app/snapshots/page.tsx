'use client';
import { ResourceView } from '@/components/ResourceView';
export default function Page() {
  return <ResourceView title="기성고·스냅샷" subtitle="기준 시점(차수·마일스톤)별 계획/실적 진척과 기성률을 기록합니다." endpoint="/api/snapshots" entity="snapshots" projectScoped
    columns={[{key:'code',label:'코드'},{key:'label',label:'기준',strong:true},{key:'snapshotDate',label:'기준일'},{key:'plannedPct',label:'계획',render:(v)=>`${v||0}%`},{key:'actualPct',label:'실적',render:(v)=>`${v||0}%`},{key:'billingPct',label:'기성률',render:(v)=>`${v||0}%`}]}
    fields={[
      {key:'label',label:'기준(차수/마일스톤)',required:true,placeholder:'예: 3월말 기성'},
      {key:'snapshotDate',label:'기준일',type:'date',half:true},
      {key:'billingPct',label:'기성률(%)',type:'number',half:true},
      {key:'plannedPct',label:'계획 진척(%)',type:'number',half:true},
      {key:'actualPct',label:'실적 진척(%)',type:'number',half:true},
      {key:'note',label:'비고',type:'textarea'},
    ]} />;
}
