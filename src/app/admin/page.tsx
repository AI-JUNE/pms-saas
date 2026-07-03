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
  const [mig, setMig] = useState('');
  function load() { fetch('/api/admin/users').then((r) => r.ok ? r.json() : Promise.reject()).then((d) => setRows(Array.isArray(d) ? d : [])).catch(() => router.push('/login')); }
  useEffect(() => { fetch('/api/auth/me').then((r)=>r.json()).then((m)=>setCan(m?.org?.isOrgAdmin)); load(); }, [router]);
  async function setRole(membershipId: number, role: string) { await fetch('/api/admin/users', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ membershipId, role }) }); load(); }
  async function migrate() { setMig('실행 중…'); try { const r = await fetch('/api/admin/migrate', { method: 'POST' }); const d = await r.json().catch(() => ({})); setMig(r.ok ? `완료 · ${d.applied ?? 0}개 적용됨` : (d.message || '실패')); } catch { setMig('실패'); } }
  return (
    <Shell title="사용자·권한">
      <h2 className="h1">사용자·권한</h2><p className="h-sub">조직 구성원의 역할을 관리합니다. (읽기 &lt; 쓰기 &lt; 결재 &lt; 관리)</p>
      <div style={{ height: 16 }} />
      {can && (
        <div className="card" style={{ padding: 14, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ fontWeight: 650 }}>DB 스키마 업데이트</div>
            <div className="muted" style={{ fontSize: 12.5 }}>새 배포에 새 컬럼/테이블이 있을 때 한 번 실행하세요. 반복 실행해도 안전합니다.</div>
          </div>
          {mig && <span className="muted" style={{ fontSize: 12.5 }}>{mig}</span>}
          <button className="btn btn-pri" onClick={migrate}>스키마 업데이트 실행</button>
        </div>
      )}
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
