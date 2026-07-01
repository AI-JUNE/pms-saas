'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ShieldCheck } from 'lucide-react';
import { Shell } from '@/components/Shell';
import { Pill } from '@/lib/ui';
const ROLES = ['admin','pmo','pm','member'];
export default function Page() {
  const router = useRouter();
  const [rows, setRows] = useState<any[]>([]); const [can, setCan] = useState(false);
  function load() { fetch('/api/admin/users').then((r) => r.ok ? r.json() : Promise.reject()).then((d) => setRows(Array.isArray(d) ? d : [])).catch(() => router.push('/login')); }
  useEffect(() => { fetch('/api/auth/me').then((r)=>r.json()).then((m)=>setCan(m?.org?.isOrgAdmin)); load(); }, [router]);
  async function setRole(membershipId: number, role: string) { await fetch('/api/admin/users', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ membershipId, role }) }); load(); }
  return (
    <Shell title="사용자·권한">
      <h2 className="h1">사용자·권한</h2><p className="h-sub">조직 구성원의 역할을 관리합니다. (읽기 &lt; 쓰기 &lt; 결재 &lt; 관리)</p>
      <div style={{ height: 16 }} />
      <div className="card tbl-wrap"><table className="tbl"><thead><tr><th>이름</th><th>이메일</th><th>역할</th><th>상태</th><th>가입</th></tr></thead>
        <tbody>{rows.map((u) => (<tr key={u.membershipId}>
          <td style={{ fontWeight: 650 }}>{u.name}</td><td className="muted">{u.email}</td>
          <td>{can ? <select className="sel" value={u.role} onChange={(e) => setRole(u.membershipId, e.target.value)}>{ROLES.map((r) => <option key={r} value={r}>{r}</option>)}</select> : <Pill v={u.role} />}</td>
          <td>{u.isActive ? <span className="pill p-green">활성</span> : <span className="pill p-gray">비활성</span>}</td>
          <td className="muted">{u.createdAt ? new Date(u.createdAt).toLocaleDateString('ko-KR') : '—'}</td></tr>))}
          {rows.length === 0 && <tr><td colSpan={5}><div className="empty"><ShieldCheck /><div>구성원이 없습니다.</div></div></td></tr>}</tbody></table></div>
    </Shell>
  );
}
