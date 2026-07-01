'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCheck, Bell } from 'lucide-react';
import { Shell } from '@/components/Shell';
export default function Page() {
  const router = useRouter();
  const [rows, setRows] = useState<any[]>([]);
  function load() { fetch('/api/notifications').then((r) => r.ok ? r.json() : Promise.reject()).then(setRows).catch(() => router.push('/login')); }
  useEffect(load, [router]);
  async function markAll() { await fetch('/api/notifications', { method: 'POST' }); load(); }
  return (
    <Shell title="알림">
      <div className="row"><div><h2 className="h1">알림</h2><p className="h-sub">내게 온 알림입니다.</p></div><div className="sp" /><button className="btn" onClick={markAll}><CheckCheck style={{ width: 16 }} />모두 읽음</button></div>
      <div style={{ height: 16 }} />
      <div className="card tbl-wrap"><table className="tbl"><thead><tr><th>내용</th><th style={{ width: 110 }}>상태</th><th style={{ width: 180 }}>시각</th></tr></thead>
        <tbody>{rows.map((n) => <tr key={n.id}><td style={{ fontWeight: n.isRead ? 500 : 700 }}>{n.message}</td><td>{n.isRead ? <span className="pill p-gray">읽음</span> : <span className="pill p-blue">새 알림</span>}</td><td className="muted">{new Date(n.createdAt).toLocaleString('ko-KR')}</td></tr>)}
          {rows.length === 0 && <tr><td colSpan={3}><div className="empty"><Bell /><div>알림이 없습니다.</div></div></td></tr>}</tbody></table></div>
    </Shell>
  );
}
