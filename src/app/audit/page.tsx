'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Activity, Search, X } from 'lucide-react';
import { Shell } from '@/components/Shell';
import { AUDIT_ACTIONS, AUDIT_ACTION_LABEL, actionOfEvent, parseDetail, type AuditAction } from '@/lib/auditQuery';

/** 엔티티(리소스 키) → 한글 영역명. 미등록 키는 원문 그대로 노출 */
const ENT: Record<string, string> = {
  projects: '프로젝트', phases: '단계', members: '인력', requirements: '요구사항',
  tasks: '업무', issues: '이슈', risks: '리스크', tests: '테스트', testCycles: '테스트 차수',
  documents: '산출물', formDefinitions: '산출물 양식', meetings: '회의', sprints: '스프린트',
  todos: '할 일', snapshots: '기성고', interfaces: '인터페이스', infra: '인프라 자산',
  firewall: '방화벽', procurement: '조달', boards: '게시판', users: '사용자', notifications: '알림',
  attachments: '첨부', admin: '관리 기능', auth: '인증',
};
const ACT_CLS: Record<AuditAction, string> = { CREATE: 'p-green', UPDATE: 'p-amber', DELETE: 'p-red', ACCESS: 'p-blue', AUTH: 'p-purple' };
const actOf = (e: string) => { const a = actionOfEvent(e); return a ? { label: AUDIT_ACTION_LABEL[a], cls: ACT_CLS[a] } : { label: String(e || '—'), cls: 'p-gray' }; };
const entName = (e?: string) => (e ? ENT[e] || e : '—');
const nfmt = (n: number) => n.toLocaleString('ko-KR');
/** 상세 키 한글 라벨(auditAccess·crud 가 남기는 키) */
const DETAIL_LABEL: Record<string, string> = { method: '메서드', path: '경로', ip: 'IP(마스킹)', ua: '클라이언트', count: '건수', change: '변경 유형', targetUserId: '대상 사용자', target: '대상', kind: '종류', status: '상태', size: '크기', email: '이메일(마스킹)', delivered: '발송', accountMatched: '계정 일치', verdict: '판정', consent: '동의', sampleProject: '샘플 프로젝트', entryId: '입력 ID', documentId: '산출물 ID', fields: '항목 수', linkId: '관계 ID' };

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

type Filters = { actor: string; action: string; entity: string; from: string; to: string; q: string };
const EMPTY: Filters = { actor: '', action: '', entity: '', from: '', to: '', q: '' };

export default function Page() {
  const router = useRouter();
  const [rows, setRows] = useState<any[]>([]);
  const [retention, setRetention] = useState<{ days: number; decided: boolean; cutoff: string; note: string } | null>(null);
  // 결과 절단 판정(lib/incidentEvidence) — 'truncated' 면 **오래된 쪽**이 빠져 있다(RUNBOOK §3 1단계).
  const [capture, setCapture] = useState<{ verdict: string; nextCursor: number | null; action: string; caveats?: string[] } | null>(null);
  const [more, setMore] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [f, setF] = useState<Filters>(EMPTY);
  const [applied, setApplied] = useState<Filters>(EMPTY);
  const [sel, setSel] = useState<any | null>(null);
  const [actors, setActors] = useState<Record<string, string>>({});
  const drawerRef = useRef<HTMLElement | null>(null);
  const lastTrig = useRef<HTMLElement | null>(null);

  // URL 쿼리 ↔ 필터(공유 가능한 뷰 링크, 배치113 패턴)
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const init: Filters = { actor: sp.get('actor') || '', action: sp.get('action') || '', entity: sp.get('entity') || '', from: sp.get('from') || '', to: sp.get('to') || '', q: sp.get('q') || '' };
    setF(init); setApplied(init);
  }, []);

  // cursor 가 있으면 **이어 받기**(잘린 오래된 쪽) — 기존 행에 덧붙인다.
  const load = useCallback((flt: Filters, cursor?: number | null) => {
    if (cursor) setMore(true); else setLoaded(false);
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(flt)) if (v) sp.set(k, v);
    sp.set('limit', '200');
    if (cursor) sp.set('cursor', String(cursor));
    const qs = sp.toString();
    if (typeof window !== 'undefined') { const u = new URL(window.location.href); u.search = new URLSearchParams(Object.entries(flt).filter(([, v]) => v)).toString(); window.history.replaceState(null, '', u.toString()); }
    fetch('/api/audit' + (qs ? `?${qs}` : ''))
      .then((r) => { if (r.status === 401) return Promise.reject('unauth'); if (r.status === 403) return r.json().then((d) => Promise.reject(d?.message || '권한이 없습니다')); return r.ok ? r.json() : Promise.reject('error'); })
      .then((d) => {
        const list = Array.isArray(d) ? d : Array.isArray(d?.rows) ? d.rows : [];
        setRows((cur) => (cursor ? [...cur, ...list] : list));
        setRetention(d?.retention ?? null); setCapture(d?.capture ?? null);
        setProblems(Array.isArray(d?.problems) ? d.problems : []); setLoaded(true); setMore(false);
        setActors((cur) => { const n = { ...cur }; for (const r of list) if (r.userId && r.userName) n[String(r.userId)] = r.userName; return n; });
      })
      .catch((e) => { setMore(false); if (e === 'unauth') router.push('/login'); else { if (!cursor) setRows([]); setLoaded(true); setProblems([typeof e === 'string' ? e : '감사 로그를 불러오지 못했습니다']); } });
  }, [router]);
  useEffect(() => { load(applied); }, [applied, load]);

  const ents = useMemo(() => Array.from(new Set(rows.map((r) => String(r.entity || '')).filter(Boolean))).sort(), [rows]);
  const todayCount = useMemo(() => { const today = new Date().toDateString(); return rows.filter((r) => { const t = new Date(r.createdAt).getTime(); return Number.isFinite(t) && new Date(t).toDateString() === today; }).length; }, [rows]);
  const filtered = Object.values(applied).some(Boolean);
  const setK = (k: keyof Filters) => (e: any) => setF({ ...f, [k]: e.target.value });
  function apply(e?: React.FormEvent) { e?.preventDefault(); setApplied({ ...f }); }
  function reset() { setF(EMPTY); setApplied(EMPTY); }
  function openDetail(row: any, trig: HTMLElement | null) { lastTrig.current = trig; setSel(row); setTimeout(() => drawerRef.current?.focus(), 0); }
  function closeDetail() { setSel(null); const t = lastTrig.current; if (t && document.contains(t)) setTimeout(() => t.focus(), 0); }
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape' && sel) closeDetail(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); // eslint-disable-next-line
  }, [sel]);

  const detail = sel ? parseDetail(sel.detail) : null;

  return (
    <Shell title="감사 로그">
      <h2 className="h1">감사 로그</h2>
      <p className="h-sub">조직 내 변경·열람 이력입니다. 행위자·동작·영역·기간으로 검색하고, 행을 선택하면 상세를 볼 수 있습니다.</p>

      <form className="toolbar" onSubmit={apply} style={{ flexWrap: 'wrap', gap: 8 }} aria-label="감사 로그 검색 조건">
        <div className="search" style={{ minWidth: 200 }}>
          <Search style={{ width: 16, height: 16 }} />
          <input placeholder="이벤트·대상 검색…" value={f.q} onChange={setK('q')} aria-label="감사 로그 검색어" />
          {f.q && <button type="button" onClick={() => setF({ ...f, q: '' })} style={{ color: 'var(--text-3)' }} aria-label="검색어 지우기"><X style={{ width: 15 }} /></button>}
        </div>
        <select className="sel" value={f.actor} onChange={setK('actor')} aria-label="행위자 필터">
          <option value="">전체 행위자</option>
          {Object.entries(actors).sort((a, b) => a[1].localeCompare(b[1], 'ko')).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
        <select className="sel" value={f.action} onChange={setK('action')} aria-label="동작 필터">
          <option value="">전체 동작</option>
          {AUDIT_ACTIONS.map((a) => <option key={a} value={a}>{AUDIT_ACTION_LABEL[a]}</option>)}
        </select>
        <select className="sel" value={f.entity} onChange={setK('entity')} aria-label="영역 필터">
          <option value="">전체 영역</option>
          {ents.map((e) => <option key={e} value={e}>{entName(e)}</option>)}
          {f.entity && !ents.includes(f.entity) && <option value={f.entity}>{entName(f.entity)}</option>}
        </select>
        <label className="muted" style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>시작 <input className="in" type="date" value={f.from} onChange={setK('from')} aria-label="시작일" style={{ height: 32 }} /></label>
        <label className="muted" style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>종료 <input className="in" type="date" value={f.to} onChange={setK('to')} aria-label="종료일" style={{ height: 32 }} /></label>
        <button type="submit" className="btn btn-pri btn-sm">검색</button>
        {(filtered || Object.values(f).some(Boolean)) && <button type="button" className="btn btn-sm" onClick={reset}>초기화</button>}
        <div className="sp" />
        <span className="sr-only" role="status">{!loaded ? '감사 로그 목록을 불러오는 중' : `감사 로그 ${nfmt(rows.length)}건 표시${filtered ? ' (검색 조건 적용)' : ''}`}</span>
        {loaded && todayCount > 0 && <span className="muted" style={{ marginRight: 4 }} title={`오늘 발생한 이력 ${nfmt(todayCount)}건입니다.`}>오늘 <b style={{ color: 'var(--brand)' }}>{nfmt(todayCount)}</b>건</span>}
        <span className="muted" title={capture?.verdict === 'truncated' ? `표시한 ${nfmt(rows.length)}건 뒤에 더 오래된 기록이 남아 있습니다(1회 200건씩 이어 받습니다).` : `${filtered ? '검색 조건에 맞는 ' : ''}${nfmt(rows.length)}건을 모두 표시했습니다.`}>{nfmt(rows.length)}건{capture?.verdict === 'truncated' && <span style={{ color: '#be5535' }}>+</span>}</span>
      </form>
      {problems.length > 0 && <div className="muted" role="alert" style={{ fontSize: 12.5, color: '#be5535', marginBottom: 8 }}>{problems.join(' · ')}</div>}
      {loaded && capture?.verdict === 'truncated' && (
        <div className="card" role="alert" style={{ padding: '10px 12px', marginBottom: 8, borderColor: '#be5535', fontSize: 12.5, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <b style={{ color: '#be5535' }}>결과가 잘렸습니다</b>
          <span className="muted">{capture.action}</span>
          <div className="sp" />
          {capture.nextCursor != null && (
            <button type="button" className="btn btn-sm" disabled={more} onClick={() => load(applied, capture.nextCursor)}>
              {more ? '불러오는 중…' : '이전 기록 더 불러오기'}
            </button>
          )}
        </div>
      )}

      <div className="card tbl-wrap" aria-busy={!loaded}>
        <table className="tbl">
          <thead><tr><th scope="col" style={{ width: 90 }}>동작</th><th scope="col" style={{ width: 150 }}>영역</th><th scope="col">대상</th><th scope="col" style={{ width: 140 }}>행위자</th><th scope="col" style={{ width: 170 }}>시각</th></tr></thead>
          <tbody>
            {!loaded && Array.from({ length: 5 }).map((_, i) => (<tr key={`sk${i}`} aria-hidden="true"><td colSpan={5}><div className="skel" style={{ height: 18, margin: '4px 0' }} /></td></tr>))}
            {loaded && rows.map((a) => {
              const ac = actOf(a.event);
              const isSel = sel?.id === a.id;
              return (
                <tr key={a.id} tabIndex={0} role="button" aria-label={`${ac.label} · ${entName(a.entity)} ${a.entityId ? '#' + a.entityId : ''} · ${a.userName || '시스템'} · 상세 보기`} aria-expanded={isSel} className={isSel ? 'sel' : undefined} style={{ cursor: 'pointer', background: isSel ? 'var(--brand-50)' : undefined }}
                  onClick={(e) => openDetail(a, e.currentTarget)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(a, e.currentTarget); } }}>
                  <td><span className={`pill ${ac.cls}`}>{ac.label}</span></td>
                  <td style={{ fontWeight: 650 }}>{entName(a.entity)}</td>
                  <td className="mono" title={`원본 이벤트: ${a.event}`}>{a.entity ? `${a.entity}${a.entityId ? ` #${a.entityId}` : ''}` : a.event}</td>
                  <td>{a.userName || <span className="muted">시스템</span>}</td>
                  <td className="muted" title={new Date(a.createdAt).toLocaleString('ko-KR')}>{relTime(a.createdAt)}</td>
                </tr>
              );
            })}
            {loaded && rows.length === 0 && (
              <tr><td colSpan={5}><div className="empty"><Activity />
                <div>{filtered ? '조건에 맞는 이력이 없습니다. 검색 조건을 조정해 보세요.' : '변경 이력이 없습니다. 데이터를 생성·수정하면 이곳에 기록됩니다.'}</div>
              </div></td></tr>
            )}
          </tbody>
        </table>
      </div>

      {loaded && (capture?.verdict === 'empty' || capture?.verdict === 'unreadable') && (
        <p className="muted" role="status" style={{ fontSize: 12, marginTop: 10 }}>{capture.action}</p>
      )}

      {retention && (
        <p className="muted" style={{ fontSize: 12, marginTop: 10 }} title={retention.note}>
          보존 기간 <b>{nfmt(retention.days)}일</b>{retention.decided ? '' : ' (운영 확정 전 기본값 — 확정 필요)'} · 기준일 이전({retention.cutoff}) 기록은 정리 후보이며 자동 삭제는 수행하지 않습니다.
        </p>
      )}

      {sel && (<>
        <div className="scrim" onClick={closeDetail} />
        <aside ref={drawerRef} tabIndex={-1} className="over" role="dialog" aria-modal="true" aria-label="감사 로그 상세">
          <div className="over-h"><span className="mono" style={{ fontSize: 13 }}>#{sel.id}</span><div className="sp" /><button className="iconbtn" aria-label="닫기" onClick={closeDetail}><X /></button></div>
          <div className="over-b">
            <h3 style={{ margin: '0 0 14px', fontSize: 18, fontWeight: 800 }}>{actOf(sel.event).label} · {entName(sel.entity)}{sel.entityId ? ` #${sel.entityId}` : ''}</h3>
            <dl className="dl">
              <dt>이벤트</dt><dd className="mono">{sel.event}</dd>
              <dt>영역</dt><dd>{entName(sel.entity)}{sel.entity ? <span className="muted mono" style={{ marginLeft: 6, fontSize: 11.5 }}>({sel.entity})</span> : null}</dd>
              <dt>대상 ID</dt><dd>{sel.entityId || <span className="muted">—</span>}</dd>
              <dt>행위자</dt><dd>{sel.userName || <span className="muted">시스템</span>}{sel.userId ? <span className="muted" style={{ marginLeft: 6, fontSize: 11.5 }}>(#{sel.userId})</span> : null}</dd>
              <dt>시각</dt><dd>{new Date(sel.createdAt).toLocaleString('ko-KR')} <span className="muted" style={{ fontSize: 11.5 }}>({relTime(sel.createdAt)})</span></dd>
            </dl>
            <div className="sect" style={{ margin: '18px 0 8px' }}>상세</div>
            {detail ? (
              <dl className="dl">
                {Object.entries(detail).map(([k, v]) => (<div key={k} style={{ display: 'contents' }}><dt>{DETAIL_LABEL[k] || k}</dt><dd className="mono" style={{ fontSize: 12, wordBreak: 'break-all' }}>{typeof v === 'string' ? v : JSON.stringify(v)}</dd></div>))}
              </dl>
            ) : <div className="muted" style={{ fontSize: 12.5 }}>기록된 상세가 없습니다. (생성·수정·삭제 이벤트는 값 자체를 남기지 않고 대상만 기록합니다)</div>}
            <p className="muted" style={{ fontSize: 11.5, marginTop: 14 }}>개인정보·비밀값은 기록 시점에 제거·마스킹됩니다(lib/auditAccess).</p>
          </div>
        </aside>
      </>)}
    </Shell>
  );
}
