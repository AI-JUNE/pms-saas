'use client';
import { ResourceView } from '@/components/ResourceView';
export default function Page() {
  return <ResourceView title="단계" subtitle="프로젝트 단계를 정의합니다." endpoint="/api/phases" entity="phases" projectScoped
    columns={[{key:'code',label:'코드'},{key:'name',label:'단계',strong:true},{key:'sortOrder',label:'순서'},{key:'status',label:'상태',badge:true}]}
    fields={[{key:'name',label:'단계명',required:true},{key:'sortOrder',label:'순서',type:'number',half:true},{key:'status',label:'상태',type:'select',options:['planned','in_progress','done'],half:true},{key:'color',label:'색상'}]} />;
}
