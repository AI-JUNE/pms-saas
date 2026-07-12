'use client';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCheck, Bell, Search, X } from 'lucide-react';
import { Shell } from '@/components/Shell';

type Kind = 'overdue' | 'due' | 'approval' | 'etc';
const KIND: Record<Kind, { label: string; cls: string; tip: string }> = {
  overdue:  { label: '마감 초과', cls: 'p-red',   tip: '기한이 지난 업무입니다 — 즉시 조치가 필요합니다.' },
  due:      { label: '마감 임박', cls: 'p-amber', tip: '3일 이내 마감 예정인 업무입니다.' },
  approval: { label: '결재 대기', cls: 'p-blue',  tip: '내 결재를 기다리는 산출물입니다.' },
  etc:      { label: '일반',      cls: 'p-gray',  tip: '일반 알림입니다.' },
};

// "[자동] 마감 초과: TSK-01 설계 (2026-07-10)" -> 유형/본문 분리
function parse(msg: string) {
  const raw = String(msg || '');
  const auto = raw.startsWith('[자동]');
  const body = auto ? raw.slice(4).trim() : raw;
  let kind: Kind = 'etc';
  if (body.startsWith('마감 초과')) kind = 'overdue';
  else if (body.startsWith('마감 임박')) kind = 'due';
  else if (body.startsWith('결재 대기')) kind = 'approval';
  const text = kind === 'etc' ? body : body.replace(/^[^:]*:\s*/, '');
  return { auto, kind, text: text || body };
}

// 상대 시각 (배치71 감사 로그와 동일 규칙)
function relTime(iso: string) {
  const t = new Date(iso).getTime();
  if (isNaN(t)) return '—';
  const d = Date.now() - t;
  if (d < 60000) return '방금 전';
  if (d < 3600000) return `${Math.floor(d / 60000)}분 전`;
  if (d < 86400000) return `${Math.floor(d / 3600000)}시간 전`;
  if (d < 30 * 86400000) return `${Math.floor(d / 86400000)}일 전`;
  return new Date(iso).toLocaleDateString('ko-KR');
}

export default function Page() {
  const router = useRouter();
  const [rows, setRows] = useState<any[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('');
  const [unreadOnly, setUnreadOnly] = useState(false);

  function load() {
    fetch('/api/notifications').then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => { setRows(Array.isArray(d) ? d : []); setLoaded(true); })
      .catch(() => router.push('/login'));
  }
  useEffect(load, [router]);

  async function markAll() { await fetch('/api/notifications', { method: 'POST' }); load(); }

  const unread = rows.filter((n) => !n.isRead).length;
  const counts = useMemo(() => {
    const c: Record<string, number> = { overdue: 0, due: 0, approval: 0, etc: 0 };
    for (const n of rows) c[parse(n.message).kind]++;
    return c;
  }, [rows]);

  const view = useMemo(() => rows.filter((n) => {
    const p = parse(n.message);
    if (unreadOnly && n.isRead) return false;
    if (kind && p.kind !== kind) return false;
    if (q) {
      const s = q.toLowerCase();
      if (!(`${n.message} ${KIND[p.kind].label} ${n.link || ''}`.toLowerCase().includes(s))) return false;
    }
    return true;
  }), [rows, q, kind, unreadOnly]);

  const filtered = view.length !== rows.length;
  // 내부 경로(/로 시작)만 이동 허용 — 외부 링크는 무시
  const go = (link?: string) => { if (link && link.startsWith('/')) router.push(link); };

  return (
    <Shell title="알림">
      <div className="row">
        <div>
          <h2 className="h1">알림</h2>
          <p className="h-sub">
            내게 온 알림입니다. (최근 50건)
            {unread > 0 && <> · <b style={{ color: 'var(--brand)' }}>{unread}건 읽지 않음</b></>}
          </p>
        </div>
        <div className="sp" />
        <button className="btn" onClick={markAll} disabled={unread === 0} title={unread === 0 ? '읽지 않은 알림이 없습니다.' : `읽지 않은 ${unread}건을 모두 읽음 처리합니다.`}>
          <CheckCheck style={{ width: 16 }} />모두 읽음
        </button>
      </div>
      <div style={{ height: 16 }} />

      <div className="toolbar">
        <div className="search" style={{ minWidth: 200 }}>
          <Search style={{ width: 16, height: 16 }} />
          <input placeholder="알림 내용 검색…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="알림 검색" />
          {q && <button onClick={() => setQ('')} style={{ color: 'var(--text-3)' }} aria-label="검색어 지우기"><X style={{ width: 15 }} /></button>}
        </div>
        <select className="sel" value={kind} onChange={(e) => setKind(e.target.value)} aria-label="알림 유형 필터">
          <option value="">전체 유형</option>
          <option value="overdue">마감 초과 ({counts.overdue})</option>
          <option value="due">마감 임박 ({counts.due})</option>
          <option value="approval">결재 대기 ({counts.approval})</option>
          <option value="etc">일반 ({counts.etc})</option>
        </select>
        <button
          className={`btn btn-sm ${unreadOnly ? 'btn-pri' : ''}`}
          onClick={() => setUnreadOnly((v) => !v)}
          aria-pressed={unreadOnly}
          title="읽지 않은 알림만 표시합니다."
        >
          안 읽음만{unread > 0 ? ` (${unread})` : ''}
        </button>
        <div className="sp" />
        <span className="muted" title={filtered ? `전체 ${rows.length}건 중 조건에 맞는 ${view.length}건을 표시합니다.` : `마감 초과 ${counts.overdue} · 마감 임박 ${counts.due} · 결재 대기 ${counts.approval} · 일반 ${counts.etc}`}>
          {filtered ? <><b style={{ color: 'var(--brand)' }}>{view.length}</b>/{rows.length}건</> : <>{rows.length}건</>}
        </span>
      </div>

      <div className="card tbl-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th className="no-sort" style={{ width: 100 }}>유형</th>
              <th className="no-sort">내용</th>
              <th className="no-sort" style={{ width: 110 }}>상태</th>
              <th className="no-sort" style={{ width: 130 }}>시각</th>
            </tr>
          </thead>
          <tbody>
            {!loaded && Array.from({ length: 4 }).map((_, i) => (
              <tr key={`sk${i}`}><td colSpan={4}><div className="skel" style={{ height: 18, margin: '4px 0' }} /></td></tr>
            ))}
            {loaded && view.map((n) => {
              const p = parse(n.message);
              const k = KIND[p.kind];
              const linkable = typeof n.link === 'string' && n.link.startsWith('/');
              return (
                <tr
                  key={n.id}
                  onClick={() => go(n.link)}
                  onKeyDown={(e) => { if (linkable && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); go(n.link); } }}
                  tabIndex={linkable ? 0 : -1}
                  style={{ cursor: linkable ? 'pointer' : 'default' }}
                  title={linkable ? `클릭하면 ${n.link} 화면으로 이동합니다.` : undefined}
                >
                  <td><span className={`pill ${k.cls}`} title={k.tip}>{k.label}</span></td>
                  <td style={{ fontWeight: n.isRead ? 500 : 700, opacity: n.isRead ? 0.72 : 1 }}>
                    {p.text}
                    {p.auto && <span className="muted" style={{ marginLeft: 7, fontSize: 11, fontWeight: 600 }} title="시스템이 자동으로 생성한 알림입니다.">자동</span>}
                  </td>
                  <td>{n.isRead ? <span className="pill p-gray">읽음</span> : <span className="pill p-blue">새 알림</span>}</td>
                  <td className="muted" title={n.createdAt ? new Date(n.createdAt).toLocaleString('ko-KR') : undefined} style={{ cursor: 'help' }}>{relTime(n.createdAt)}</td>
                </tr>
              );
            })}
            {loaded && view.length === 0 && (
              <tr><td colSpan={4}>
                <div className="empty">
                  <Bell />
                  <div>{rows.length === 0
                    ? '알림이 없습니다. 마감이 임박하거나 결재가 대기하면 자동으로 알려드립니다.'
                    : '조건에 맞는 알림이 없습니다. 검색어·유형 필터를 조정해 보세요.'}</div>
                </div>
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </Shell>
  );
}
