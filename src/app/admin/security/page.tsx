'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ShieldAlert } from 'lucide-react';
import { Shell } from '@/components/Shell';

// 보안 이벤트 열람(슈퍼관리자 전용) — 로그인/로그아웃/가입/결제 스캐폴딩 등 orgId=0 sentinel 이벤트.
const EVENTS = ['', 'AUTH_LOGIN', 'AUTH_LOGIN_FAIL', 'AUTH_LOGOUT', 'AUTH_REGISTER', 'AUTH_REGISTER_JOIN', 'BILLING_CHECKOUT_SCAFFOLD'];
const EVENT_LABEL: Record<string, string> = {
  AUTH_LOGIN: '로그인', AUTH_LOGIN_FAIL: '로그인 실패', AUTH_LOGOUT: '로그아웃',
  AUTH_REGISTER: '가입(조직 생성)', AUTH_REGISTER_JOIN: '가입(초대 합류)', BILLING_CHECKOUT_SCAFFOLD: '결제 스캐폴딩',
};
const EVENT_BADGE: Record<string, string> = {
  AUTH_LOGIN: 'p-green', AUTH_LOGIN_FAIL: 'p-red', AUTH_LOGOUT: 'p-gray',
  AUTH_REGISTER: 'p-blue', AUTH_REGISTER_JOIN: 'p-cyan', BILLING_CHECKOUT_SCAFFOLD: 'p-purple',
};
const nfmt = (n: number) => n.toLocaleString('ko-KR');
function EventPill({ v }: { v: string }) {
  return <span className={`pill ${EVENT_BADGE[v] || 'p-gray'}`}>{EVENT_LABEL[v] || v}</span>;
}
function fmtDetail(d: string | null) {
  if (!d) return '—';
  try { const o = JSON.parse(d); return Object.entries(o).map(([k, v]) => `${k}=${v}`).join(' · '); } catch { return d; }
}
export default function Page() {
  const router = useRouter();
  const [rows, setRows] = useState<any[]>([]);
  const [event, setEvent] = useState('');
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  async function load(cursor?: number | null) {
    setLoading(true); setErr('');
    const qs = new URLSearchParams(); if (event) qs.set('event', event); if (cursor) qs.set('cursor', String(cursor));
    try {
      const r = await fetch(`/api/admin/security-events?${qs}`);
      if (r.status === 401) { router.push('/login'); return; }
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(d.message || '조회 실패'); return; }
      setRows((prev) => cursor ? [...prev, ...(d.rows || [])] : (d.rows || []));
      setNextCursor(d.nextCursor ?? null);
    } catch { setErr('조회 실패'); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, [event]); // eslint-disable-line react-hooks/exhaustive-deps
  const fails = rows.filter((r) => r.event === 'AUTH_LOGIN_FAIL').length;
  return (
    <Shell title="보안 이벤트">
      <h2 className="h1">보안 이벤트</h2>
      <p className="h-sub">로그인·가입·결제 스캐폴딩 등 인증 관련 이벤트입니다. (슈퍼관리자 전용 · 이메일은 마스킹 저장)</p>
      <div style={{ height: 16 }} />
      {err && (
        <div className="card" style={{ padding: '10px 14px', marginBottom: 16, borderLeft: '3px solid #c0392b', color: '#c0392b', fontSize: 13, fontWeight: 600 }}>{err}</div>
      )}
      <div className="card" style={{ padding: 14, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ fontWeight: 650 }}>이벤트 필터</div>
        <select className="sel" value={event} onChange={(e) => setEvent(e.target.value)}>
          {EVENTS.map((e) => <option key={e} value={e}>{e ? (EVENT_LABEL[e] || e) : '전체'}</option>)}
        </select>
        {rows.length > 0 && <span className="muted" style={{ fontSize: 12.5, cursor: 'help' }} title={`현재까지 불러온 이벤트 ${nfmt(rows.length)}건${nextCursor ? ' — 더 보기로 이전 이벤트를 추가로 불러올 수 있습니다' : ' (전부 불러옴)'}${fails > 0 ? `\n이 중 로그인 실패 ${nfmt(fails)}건` : ''}`}>표시 {nfmt(rows.length)}건{fails > 0 ? ` · 로그인 실패 ${nfmt(fails)}건` : ''}</span>}
      </div>
      <div className="card tbl-wrap"><table className="tbl">
        <thead><tr><th>시각</th><th>이벤트</th><th>사용자</th><th>대상</th><th>상세</th></tr></thead>
        <tbody>
          {rows.map((r) => (<tr key={r.id}>
            <td className="muted" style={{ whiteSpace: 'nowrap' }}>{r.createdAt ? new Date(r.createdAt).toLocaleString('ko-KR') : '—'}</td>
            <td><EventPill v={r.event} /></td>
            <td style={{ fontWeight: 650 }}>{r.userName || <span className="muted">—</span>}</td>
            <td className="muted">{r.entity || '—'}{r.entityId ? ` #${r.entityId}` : ''}</td>
            <td className="muted" style={{ fontSize: 12.5 }}>{fmtDetail(r.detail)}</td>
          </tr>))}
          {rows.length === 0 && !loading && <tr><td colSpan={5}><div className="empty"><ShieldAlert /><div>보안 이벤트가 없습니다.</div></div></td></tr>}
        </tbody>
      </table></div>
      {nextCursor && (
        <div style={{ marginTop: 12, textAlign: 'center' }}>
          <button className="btn" disabled={loading} onClick={() => load(nextCursor)}>{loading ? '불러오는 중…' : '더 보기'}</button>
        </div>
      )}
    </Shell>
  );
}
