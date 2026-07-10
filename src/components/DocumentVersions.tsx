'use client';
import { useEffect, useState } from 'react';
import { History } from 'lucide-react';

const STATUS_LABEL: Record<string, string> = { draft: '작성중', review: '결재요청', approved: '승인', rejected: '반려' };

export function DocumentVersions({ documentId }: { documentId: number }) {
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => {
    fetch(`/api/documents/${documentId}/versions`).then((r) => r.ok ? r.json() : []).then((d) => setRows(Array.isArray(d) ? d : []));
  }, [documentId]);
  return (
    <div style={{ marginTop: 22 }}>
      <div className="sect" style={{ marginBottom: 8 }}><History style={{ width: 14, verticalAlign: '-2px', marginRight: 4 }} />버전 이력 {rows.length > 0 && `(${rows.length})`}</div>
      <div>
        {rows.map((v) => (
          <div className="cmt" key={v.id}>
            <div className="av">{String(v.version || 'v').replace(/^v/i, '').slice(0, 3) || 'v'}</div>
            <div className="bd">
              <div className="nm">{v.version || '—'} <span className="muted" style={{ fontWeight: 500 }}>· {STATUS_LABEL[v.status] || v.status || ''}</span></div>
              <div className="tx" style={{ fontSize: 12.5 }}>{v.note || ''}{v.author ? ` · ${v.author}` : ''}</div>
              <div className="mt">{v.createdAt ? new Date(v.createdAt).toLocaleString('ko-KR') : ''}</div>
            </div>
          </div>
        ))}
        {rows.length === 0 && <div className="muted" style={{ padding: '8px 0' }}>버전 이력이 없습니다. 버전을 변경하면 여기에 기록됩니다.</div>}
      </div>
    </div>
  );
}
