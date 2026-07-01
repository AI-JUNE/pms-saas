'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Activity } from 'lucide-react';
import { Shell } from '@/components/Shell';
const evColor = (e: string) => e.includes('CREATE') ? 'p-green' : e.includes('DELETE') ? 'p-red' : e.includes('UPDATE') ? 'p-amber' : 'p-gray';
export default function Page() {
  const router = useRouter();
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => { fetch('/api/audit').then((r) => r.ok ? r.json() : Promise.reject()).then((d) => setRows(Array.isArray(d) ? d : [])).catch(() => router.push('/login')); }, [router]);
  return (
    <Shell title="감사 로그">
      <h2 className="h1">감사 로그</h2><p className="h-sub">조직 내 모든 변경 이력입니다. (최근 100건)</p>
      <div style={{ height: 16 }} />
      <div className="card tbl-wrap"><table className="tbl"><thead><tr><th>이벤트</th><th>대상</th><th>사용자</th><th>시각</th></tr></thead>
        <tbody>{rows.map((a) => (<tr key={a.id}><td><span className={`pill ${evColor(a.event)}`}>{a.event}</span></td><td className="mono">{a.entity}{a.entityId ? ` #${a.entityId}` : ''}</td><td>{a.userName || '—'}</td><td className="muted">{new Date(a.createdAt).toLocaleString('ko-KR')}</td></tr>))}
          {rows.length === 0 && <tr><td colSpan={4}><div className="empty"><Activity /><div>기록이 없습니다.</div></div></td></tr>}</tbody></table></div>
    </Shell>
  );
}
