'use client';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Activity, Search, X } from 'lucide-react';
import { Shell } from '@/components/Shell';

/** 감사 로그 이벤트는 `RESOURCE_ACTION` 형식(lib/crud.ts) — 예: TASKS_CREATE */
const ACT: Record<string, { label: string; cls: string }> = {
  CREATE: { label: '생성', cls: 'p-green' },
  UPDATE: { label: '수정', cls: 'p-amber' },
  DELETE: { label: '삭제', cls: 'p-red' },
};
/** 엔티티(리소스 키) → 한글 영역명. 미등록 키는 원문 그대로 노출 */
const ENT: Record<string, string> = {
  projects: '프로젝트', phases: '단계', members: '인력', requirements: '요구사항',
  tasks: '업무', issues: '이슈', risks: '리스크', tests: '테스트', testCycles: '테스트 차수',
  documents: '산출물', formDefinitions: '산출물 양식', meetings: '회의', sprints: '스프린트',
  todos: '할 일', snapshots: '기성고', interfaces: '인터페이스', infra: '인프라 자산',
  firewall: '방화벽', procurement: '조달', boards: '게시판', users: '사용자', notifications: '알림',
};
const actOf = (e: string) => {
  const key = String(e || '').split('_').pop() || '';
  return ACT[key] || { label: String(e || '—'), cls: 'p-gray' };
};
const entName = (e?: string) => (e ? ENT[e] || e : '—');

/** 상대 시각(방금 전 / N분 전 / N시간 전 / N일 전) — 절대 시각은 툴팁으로 */
function relTime(iso: string) {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '—';
  const diff = Math.max(0, Date.now() - t);
  const m = Math.floor(diff / 60000);
  if (m < 1) return '방금 전';
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}일 전`;
  return new Date(iso).toLocaleDateString('ko-KR');
}

export default function Page() {
  const router = useRouter();
  const [rows, setRows] = useState<any[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [q, setQ] = useState('');
  const [act, setAct] = useState('');
  const [ent, setEnt] = useState('');

  useEffect(() => {
    fetch('/api/audit').then((r) => r.ok ? r.json() : Promise.reject())
      .then((d) => { setRows(Array.isArray(d) ? d : []); setLoaded(true); })
      .catch(() => router.push('/login'));
  }, [router]);

  /** 로그에 실제로 등장한 영역만 필터 옵션으로 노출 */
  const ents = useMemo(() => Array.from(new Set(rows.map((r) => String(r.entity || '')).filter(Boolean))).sort(), [rows]);
  const counts = useMemo(() => {
    const c: Record<string, number> = { CREATE: 0, UPDATE: 0, DELETE: 0 };
    rows.forEach((r) => { const k = String(r.event || '').split('_').pop() || ''; if (k in c) c[k] += 1; });
    return c;
  }, [rows]);

  const view = useMemo(() => rows.filter((r) => {
    if (act && !String(r.event || '').endsWith(`_${act}`)) return false;
    if (ent && String(r.entity || '') !== ent) return false;
    if (q.trim()) {
      const hay = [r.event, r.entity, entName(r.entity), actOf(r.event).label, r.userName, r.entityId].join(' ').toLowerCase();
      if (!hay.includes(q.trim().toLowerCase())) return false;
    }
    return true;
  }), [rows, q, act, ent]);

  const filtered = view.length !== rows.length;

  return (
    <Shell title="감사 로그">
      <h2 className="h1">감사 로그</h2>
      <p className="h-sub">조직 내 모든 변경 이력입니다. (최근 100건)</p>

      <div className="toolbar">
        <div className="search" style={{ minWidth: 200 }}>
          <Search style={{ width: 16, height: 16 }} />
          <input placeholder="사용자·영역·대상 검색…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="감사 로그 검색" />
          {q && <button onClick={() => setQ('')} style={{ color: 'var(--text-3)' }} aria-label="검색어 지우기"><X style={{ width: 15 }} /></button>}
        </div>
        <select className="sel" value={act} onChange={(e) => setAct(e.target.value)} aria-label="동작 필터">
          <option value="">전체 동작</option>
          <option value="CREATE">생성 ({counts.CREATE})</option>
          <option value="UPDATE">수정 ({counts.UPDATE})</option>
          <option value="DELETE">삭제 ({counts.DELETE})</option>
        </select>
        <select className="sel" value={ent} onChange={(e) => setEnt(e.target.value)} aria-label="영역 필터">
          <option value="">전체 영역</option>
          {ents.map((e) => <option key={e} value={e}>{entName(e)}</option>)}
        </select>
        <div className="sp" />
        <span className="muted" title={filtered ? `전체 ${rows.length}건 중 필터 조건에 맞는 ${view.length}건을 표시합니다.` : `최근 ${rows.length}건 — 생성 ${counts.CREATE} · 수정 ${counts.UPDATE} · 삭제 ${counts.DELETE}`}>
          {filtered ? <><b style={{ color: 'var(--brand)' }}>{view.length}</b>/{rows.length}건</> : <>{rows.length}건</>}
        </span>
      </div>

      <div className="card tbl-wrap">
        <table className="tbl">
          <thead><tr><th style={{ width: 90 }}>동작</th><th style={{ width: 150 }}>영역</th><th>대상</th><th style={{ width: 140 }}>사용자</th><th style={{ width: 170 }}>시각</th></tr></thead>
          <tbody>
            {!loaded && Array.from({ length: 5 }).map((_, i) => (
              <tr key={`sk${i}`}><td colSpan={5}><div className="skel" style={{ height: 18, margin: '4px 0' }} /></td></tr>
            ))}
            {loaded && view.map((a) => {
              const ac = actOf(a.event);
              return (
                <tr key={a.id}>
                  <td><span className={`pill ${ac.cls}`}>{ac.label}</span></td>
                  <td style={{ fontWeight: 650 }}>{entName(a.entity)}</td>
                  <td className="mono" title={`원본 이벤트: ${a.event}`}>{a.entity ? `${a.entity}${a.entityId ? ` #${a.entityId}` : ''}` : '—'}</td>
                  <td>{a.userName || '—'}</td>
                  <td className="muted" title={new Date(a.createdAt).toLocaleString('ko-KR')}>{relTime(a.createdAt)}</td>
                </tr>
              );
            })}
            {loaded && view.length === 0 && (
              <tr><td colSpan={5}><div className="empty"><Activity />
                <div>{rows.length === 0 ? '변경 이력이 없습니다. 데이터를 생성·수정하면 이곳에 기록됩니다.' : '조건에 맞는 이력이 없습니다. 검색어나 필터를 조정해 보세요.'}</div>
              </div></td></tr>
            )}
          </tbody>
        </table>
      </div>
    </Shell>
  );
}
