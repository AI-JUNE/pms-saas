'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ShieldCheck } from 'lucide-react';
import { Shell } from '@/components/Shell';
const ROLES = ['admin','pmo','pm','member'];
// 역할 라벨/색상은 admin 화면 로컬로만 정의한다(전역 ui.tsx의 LABEL에는 pm='PM승인' 등 검증단계 값이 있어 역할과 충돌하므로 전역 오염 금지).
const ROLE_LABEL: Record<string,string> = { admin:'관리자', pmo:'PMO', pm:'PM', member:'멤버' };
const ROLE_BADGE: Record<string,string> = { admin:'p-purple', pmo:'p-cyan', pm:'p-blue', member:'p-gray' };
const roleLabel = (r: string) => ROLE_LABEL[r] || r;
function RolePill({ v }: { v: string }) {
  if (!v) return <span className="muted">—</span>;
  return <span className={`pill ${ROLE_BADGE[v] || 'p-gray'}`}>{roleLabel(v)}</span>;
}
export default function Page() {
  const router = useRouter();
  const [rows, setRows] = useState<any[]>([]); const [can, setCan] = useState(false);
  const [mig, setMig] = useState('');
  const [pwReset, setPwReset] = useState<{ id: number; pw: string } | null>(null);
  function load() { fetch('/api/admin/users').then((r) => r.ok ? r.json() : Promise.reject()).then((d) => setRows(Array.isArray(d) ? d : [])).catch(() => router.push('/login')); }
  useEffect(() => { fetch('/api/auth/me').then((r)=>r.json()).then((m)=>setCan(m?.org?.isOrgAdmin)); load(); }, [router]);
  async function setRole(membershipId: number, role: string) { await fetch('/api/admin/users', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ membershipId, role }) }); load(); }
  async function resetPw(membershipId: number) { if (!confirm('이 구성원의 비밀번호를 임시 비밀번호로 초기화할까요?')) return; const r = await fetch('/api/admin/users', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ membershipId, resetPassword: true }) }); if (r.ok) { const j = await r.json().catch(() => ({})); setPwReset({ id: membershipId, pw: j.tempPassword || '' }); } }
  async function toggleActive(membershipId: number, isActive: boolean) { const r = await fetch('/api/admin/users', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ membershipId, isActive }) }); if (r.ok) load(); else { const j = await r.json().catch(() => ({})); alert(j.message || '변경 실패'); } }
  async function migrate() { setMig('실행 중…'); try { const r = await fetch('/api/admin/migrate', { method: 'POST' }); const d = await r.json().catch(() => ({})); setMig(r.ok ? `완료 · ${d.applied ?? 0}개 적용됨` : (d.message || '실패')); } catch { setMig('실패'); } }
  const total = rows.length;
  const active = rows.filter((u) => u.isActive).length;
  const inactive = total - active;
  const byRole = (r: string) => rows.filter((u) => u.role === r).length;
  const activeAdmins = rows.filter((u) => u.isActive && u.role === 'admin').length;
  return (
    <Shell title="사용자·권한">
      <h2 className="h1">사용자·권한</h2><p className="h-sub">조직 구성원의 역할을 관리합니다. (읽기 &lt; 쓰기 &lt; 결재 &lt; 관리)</p>
      <div style={{ height: 16 }} />
      {total > 0 && (
        <div className="kpis" style={{ marginBottom: 16 }}>
          <div className="kpi"><div className="kpi-label">전체 구성원</div><div className="kpi-value">{total}</div><div className="kpi-sub">조직에 소속된 계정</div></div>
          <div className="kpi"><div className="kpi-label">활성</div><div className="kpi-value">{active}</div><div className="kpi-sub">로그인·권한 사용 가능</div></div>
          <div className="kpi" title="비활성 계정은 로그인·권한 대상에서 제외됩니다"><div className="kpi-label">비활성</div><div className="kpi-value" style={{ color: inactive > 0 ? 'var(--muted)' : undefined }}>{inactive}</div><div className="kpi-sub">로그인·집계 제외</div></div>
          <div className="kpi" title="활성 관리자(admin) 수 — 0이면 역할·스키마 관리가 잠깁니다"><div className="kpi-label">관리자</div><div className="kpi-value" style={{ color: activeAdmins === 0 ? '#c0392b' : undefined }}>{byRole('admin')}</div><div className="kpi-sub" style={{ color: activeAdmins === 0 ? '#c0392b' : undefined }}>{activeAdmins === 0 ? '⚠ 활성 0명' : `활성 ${activeAdmins}명`}</div></div>
          <div className="kpi"><div className="kpi-label">역할 구성</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
              {ROLES.map((r) => byRole(r) > 0 ? <span key={r} className={`pill ${ROLE_BADGE[r]}`} title={`${roleLabel(r)} ${byRole(r)}명`}>{roleLabel(r)} {byRole(r)}</span> : null)}
            </div>
          </div>
        </div>
      )}
      {total > 0 && activeAdmins === 0 && (
        <div className="card" style={{ padding: '10px 14px', marginBottom: 16, borderLeft: '3px solid #c0392b', color: '#c0392b', fontSize: 13, fontWeight: 600 }}>
          ⚠ 활성 관리자가 없습니다 — 역할 변경·스키마 업데이트 등 관리 기능이 잠길 수 있습니다. 최소 1명을 관리자(활성)로 유지하세요.
        </div>
      )}
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
      <div className="card tbl-wrap"><table className="tbl"><thead><tr><th>이름</th><th>이메일</th><th>역할</th><th>상태</th><th>가입</th>{can && <th>관리</th>}</tr></thead>
        <tbody>{rows.map((u) => (<tr key={u.membershipId}>
          <td style={{ fontWeight: 650 }}>{u.name}</td><td className="muted">{u.email}</td>
          <td>{can ? <select className="sel" value={u.role} onChange={(e) => setRole(u.membershipId, e.target.value)}>{ROLES.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}</select> : <RolePill v={u.role} />}</td>
          <td>{u.isActive ? <span className="pill p-green">활성</span> : <span className="pill p-gray">비활성</span>}</td>
          <td className="muted">{u.createdAt ? new Date(u.createdAt).toLocaleDateString('ko-KR') : '—'}</td>
          {can && <td style={{ whiteSpace: 'nowrap' }}><div className="row" style={{ gap: 6, flexWrap: 'wrap' }}><button className="btn btn-sm" onClick={() => resetPw(u.membershipId)} title="임시 비밀번호로 초기화">비번 초기화</button><button className="btn btn-sm" onClick={() => toggleActive(u.membershipId, !u.isActive)}>{u.isActive ? '비활성화' : '활성화'}</button></div>{pwReset && pwReset.id === u.membershipId && <div style={{ marginTop: 6, fontSize: 12 }}>임시 비번: <code style={{ fontWeight: 800, background: 'var(--surface-2)', padding: '2px 8px', borderRadius: 6 }}>{pwReset.pw}</code> <span className="muted">— 전달 후 변경 안내</span></div>}</td>}</tr>))}
          {rows.length === 0 && <tr><td colSpan={can ? 6 : 5}><div className="empty"><ShieldCheck /><div>구성원이 없습니다.</div></div></td></tr>}</tbody></table></div>
    </Shell>
  );
}
