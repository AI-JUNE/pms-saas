'use client';
import { useEffect, useState } from 'react';
import { Link2, Trash2 } from 'lucide-react';
import { LINK_KINDS, LINK_LABEL, LINK_HINT, describeLink, type LinkKind } from '@/lib/issueLinks';
import { LABEL } from '@/lib/ui';

const nfmt = (n: number) => n.toLocaleString('ko-KR');
const KIND_COLOR: Record<LinkKind, string> = { blocks: 'p-red', relates: 'p-blue', duplicates: 'p-amber' };

/** 이슈 관계(차단함·연관·중복) — 상세 패널 섹션. 대상은 같은 프로젝트의 이슈 코드로 고른다. */
export function IssueLinks({ issueId, projectId }: { issueId: number; projectId?: number | null }) {
  const [links, setLinks] = useState<any[]>([]);
  const [unavailable, setUnavailable] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [kind, setKind] = useState<LinkKind>('relates');
  const [code, setCode] = useState('');
  const [cands, setCands] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  function load() {
    fetch(`/api/issues/${issueId}/links`).then((r) => (r.ok ? r.json() : null))
      .then((d) => { setLinks(Array.isArray(d?.links) ? d.links : []); setUnavailable(!!d?.unavailable); setLoaded(true); })
      .catch(() => setLoaded(true));
  }
  useEffect(load, [issueId]);
  useEffect(() => {
    const pid = projectId ?? (Number(localStorage.getItem('pms.project')) || null);
    if (!pid) return;
    fetch(`/api/issues?projectId=${pid}`).then((r) => (r.ok ? r.json() : [])).then((d) => setCands(Array.isArray(d) ? d.filter((i: any) => i.id !== issueId) : [])).catch(() => {});
  }, [issueId, projectId]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim()) return;
    setBusy(true); setErr('');
    const r = await fetch(`/api/issues/${issueId}/links`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ targetCode: code.trim(), kind }) });
    setBusy(false);
    if (r.ok) { setCode(''); load(); } else { const d = await r.json().catch(() => ({})); setErr(d.message || '관계를 등록할 수 없습니다'); }
  }
  async function remove(linkId: number) {
    if (!confirm('이 관계를 삭제할까요?')) return;
    const r = await fetch(`/api/issues/${issueId}/links?linkId=${linkId}`, { method: 'DELETE' });
    if (r.ok) load(); else { const d = await r.json().catch(() => ({})); setErr(d.message || '삭제에 실패했습니다'); }
  }

  const blockers = links.filter((l) => l.kind === 'blocks' && l.direction === 'in' && !['resolved', 'closed'].includes(String(l.other?.status ?? '')));

  return (
    <div style={{ marginTop: 22 }}>
      <div className="sect" style={{ marginBottom: 8 }} title={links.length > 0 ? `관계 ${nfmt(links.length)}건` : '아직 연결된 이슈가 없습니다'}>
        <Link2 style={{ width: 14, verticalAlign: '-2px', marginRight: 4 }} aria-hidden="true" />관계 이슈 {links.length > 0 && `(${nfmt(links.length)})`}
      </div>
      <span className="sr-only" role="status">{!loaded ? '관계 이슈를 불러오는 중' : `관계 이슈 ${nfmt(links.length)}건${blockers.length ? ` · 미해결 차단 ${nfmt(blockers.length)}건` : ''}`}</span>
      {blockers.length > 0 && (
        <div role="alert" style={{ fontSize: 12.5, color: '#c0414f', fontWeight: 700, marginBottom: 8, padding: '6px 10px', borderLeft: '3px solid #c0414f', background: 'var(--surface-2)', borderRadius: 6 }}>
          미해결 이슈 {nfmt(blockers.length)}건이 이 이슈를 차단하고 있습니다: {blockers.map((b) => b.other?.code || `#${b.otherId}`).join(', ')}
        </div>
      )}
      {unavailable && <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>관계 테이블이 아직 준비되지 않았습니다. 관리자가 「스키마 업데이트」를 실행하면 사용할 수 있습니다.</div>}
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {links.map((l) => {
          const d = describeLink(l, issueId);
          const o = l.other;
          return (
            <li key={l.id} className="row" style={{ gap: 8, padding: '7px 0', borderBottom: '1px solid var(--border)', alignItems: 'center' }}>
              <span className={`pill ${d.kind ? KIND_COLOR[d.kind] : 'p-gray'}`} title={d.kind ? LINK_HINT[d.kind] : undefined}>{d.label}</span>
              {o ? (
                <a href={`/issues?q=${encodeURIComponent(String(o.code || o.id))}`} style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--brand-600)', fontWeight: 600, textDecoration: 'underline', textUnderlineOffset: 2 }} title={`${o.code || ''} ${o.title || ''} — 이슈 목록에서 찾기`}>
                  <span className="mono" style={{ fontSize: 12, marginRight: 6 }}>{o.code || `#${o.id}`}</span>{o.title}
                </a>
              ) : <span className="muted" style={{ flex: 1 }}>#{d.otherId} (삭제됨 또는 접근 불가)</span>}
              {o?.status && <span className="pill p-gray" style={{ fontSize: 10.5 }}>{LABEL[o.status] || o.status}</span>}
              <button className="iconbtn" aria-label={`관계 ${d.label} ${o?.code || d.otherId} 삭제`} title="관계 삭제" onClick={() => remove(l.id)}><Trash2 style={{ width: 14 }} aria-hidden="true" /></button>
            </li>
          );
        })}
        {loaded && links.length === 0 && !unavailable && <li className="muted" style={{ padding: '8px 0', fontSize: 12.5 }}>연결된 이슈가 없습니다. 아래에서 관계 종류와 이슈 코드를 골라 연결하세요.</li>}
      </ul>
      {err && <div className="err" role="alert" style={{ marginTop: 8 }}>{err}</div>}
      <form onSubmit={add} className="row" style={{ marginTop: 10, gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <select className="sel" aria-label="관계 종류" value={kind} onChange={(e) => setKind(e.target.value as LinkKind)} title={LINK_HINT[kind]}>
          {LINK_KINDS.map((k) => <option key={k} value={k}>{LINK_LABEL[k]}</option>)}
        </select>
        <input className="in" list={`issue-link-cands-${issueId}`} aria-label="대상 이슈 코드" placeholder="예: ISS-0002" value={code} onChange={(e) => { setCode(e.target.value); setErr(''); }} style={{ flex: 1, minWidth: 140, height: 34 }} disabled={unavailable} />
        <datalist id={`issue-link-cands-${issueId}`}>{cands.map((c) => <option key={c.id} value={c.code || ''}>{c.title}</option>)}</datalist>
        <button className="btn btn-pri" type="submit" disabled={busy || !code.trim() || unavailable}>{busy ? '연결 중…' : '연결'}</button>
      </form>
    </div>
  );
}
