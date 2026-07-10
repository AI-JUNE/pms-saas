'use client';
import { ResourceView } from '@/components/ResourceView';
import { LABEL } from '@/lib/ui';

function ReqAnalysis({ rows }: { rows: any[] }) {
  const count = (key: string, v: string) => rows.filter((r: any) => String(r?.[key] ?? '') === v).length;
  const Bar = ({ items, title }: any) => {
    const mx = Math.max(1, ...items.map((i: any) => i.v));
    return (
      <div><div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>{title}</div>
        {items.map((i: any) => (
          <div key={i.l} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 7 }}>
            <span style={{ width: 62, fontSize: 12, color: 'var(--text-2)' }}>{i.l}</span>
            <div className="pbar" style={{ flex: 1 }}><i style={{ width: `${(i.v / mx) * 100}%`, background: i.c }} /></div>
            <span style={{ width: 22, textAlign: 'right', fontWeight: 800, fontSize: 12.5 }}>{i.v}</span>
          </div>
        ))}
      </div>
    );
  };
  const total = rows.length;
  const approved = count('status', 'approved');
  const approvedPct = total ? Math.round((approved / total) * 100) : 0;
  return (
    <div style={{ background: 'var(--surface-1)', border: '1px solid var(--border)', borderRadius: 14, padding: '18px 20px' }}>
      <div style={{ fontWeight: 750, fontSize: 14, marginBottom: 4 }}>요구사항 분포 분석</div>
      <div className="muted" style={{ fontSize: 12, marginBottom: 14 }}>전체 {total}건 · 승인 {approved}건({approvedPct}%)</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: 24 }}>
        <Bar title="우선순위" items={[
          { l: LABEL.high, v: count('priority', 'high'), c: '#c0414f' },
          { l: LABEL.medium, v: count('priority', 'medium'), c: '#d98a16' },
          { l: LABEL.low, v: count('priority', 'low'), c: '#2f8f5b' },
        ]} />
        <Bar title="상태" items={[
          { l: LABEL.draft, v: count('status', 'draft'), c: '#8a8f98' },
          { l: LABEL.review, v: count('status', 'review'), c: '#2f6fdb' },
          { l: LABEL.approved, v: count('status', 'approved'), c: '#2f8f5b' },
          { l: LABEL.rejected, v: count('status', 'rejected'), c: '#c0414f' },
        ]} />
      </div>
    </div>
  );
}

export default function Page() {
  return <ResourceView title="요구사항" subtitle="요구사항을 추적합니다." endpoint="/api/requirements" entity="requirements" projectScoped
    altViews={[{ key: 'analysis', label: '분석', render: (rows: any[]) => <ReqAnalysis rows={rows} /> }]}
    columns={[{key:'code',label:'코드'},{key:'title',label:'제목',strong:true},{key:'category',label:'분류'},{key:'priority',label:'우선순위',badge:true},{key:'status',label:'상태',badge:true},{key:'assignee',label:'담당'}]}
    fields={[{key:'title',label:'제목',required:true},{key:'description',label:'설명',type:'textarea'},{key:'category',label:'분류',type:'combo',half:true,options:['기능','비기능','성능','보안','사용성','호환성','데이터','인터페이스','기타']},{key:'assignee',label:'담당자',half:true},{key:'priority',label:'우선순위',type:'select',options:['high','medium','low'],half:true},{key:'status',label:'상태',type:'select',options:['draft','review','approved','rejected'],half:true},{key:'acceptanceCriteria',label:'인수기준(완료조건)',type:'textarea'}]} />;
}
