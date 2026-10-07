'use client';
import { useEffect, useRef, useState } from 'react';
import { Paperclip, Trash2 } from 'lucide-react';
import { formatBytes, isExpired } from '@/lib/attachments';

const nfmt = (n: number) => n.toLocaleString('ko-KR');

/**
 * 첨부 목록·등록(산출물·이슈 상세). 저장소 미연동(기본)에서는 파일 본문을 올리지 않고
 * 파일명·크기·형식만 서버에 기록한다 — 그 사실을 화면에 그대로 적는다.
 */
export function Attachments({ entity, entityId }: { entity: 'issues' | 'documents'; entityId: number }) {
  const [rows, setRows] = useState<any[]>([]);
  const [storage, setStorage] = useState<{ provider: string; canStore: boolean; notice: string; maxMb?: number } | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [picked, setPicked] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [loaded, setLoaded] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  function load() {
    fetch(`/api/attachments?entity=${entity}&entityId=${entityId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { setRows(Array.isArray(d?.rows) ? d.rows : []); setStorage(d?.storage ?? null); setUnavailable(!!d?.unavailable); setLoaded(true); })
      .catch(() => setLoaded(true));
  }
  useEffect(load, [entity, entityId]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!picked) return;
    setBusy(true); setErr('');
    // 메타데이터만 전송한다 — 본문(File 내용)은 읽지도 보내지도 않는다.
    const r = await fetch('/api/attachments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ entity, entityId, filename: picked.name, size: picked.size, mime: picked.type || null }) });
    setBusy(false);
    if (r.ok) { setPicked(null); if (fileRef.current) fileRef.current.value = ''; load(); }
    else { const d = await r.json().catch(() => ({})); setErr(d.message || '첨부 기록에 실패했습니다'); }
  }
  async function remove(id: number) {
    if (!confirm('이 첨부 기록을 삭제할까요?')) return;
    const r = await fetch(`/api/attachments/${id}`, { method: 'DELETE' });
    if (r.ok) load(); else { const d = await r.json().catch(() => ({})); setErr(d.message || '삭제에 실패했습니다'); }
  }

  return (
    <div style={{ marginTop: 22 }}>
      <div className="sect" style={{ marginBottom: 8 }} title={rows.length > 0 ? `첨부 ${nfmt(rows.length)}건` : '아직 첨부가 없습니다'}>
        <Paperclip style={{ width: 14, verticalAlign: '-2px', marginRight: 4 }} aria-hidden="true" />첨부 {rows.length > 0 && `(${nfmt(rows.length)})`}
      </div>
      <span className="sr-only" role="status">{!loaded ? '첨부 목록을 불러오는 중' : `첨부 ${nfmt(rows.length)}건`}</span>
      {storage && !storage.canStore && (
        <div className="muted" style={{ fontSize: 12, marginBottom: 8, padding: '6px 10px', borderLeft: '3px solid #d98a16', background: 'var(--surface-2)', borderRadius: 6 }}>
          {storage.notice}
          {storage.maxMb ? ` 기록 가능 상한 ${nfmt(storage.maxMb)}MB.` : ''}
        </div>
      )}
      {unavailable && <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>첨부 테이블이 아직 준비되지 않았습니다. 관리자가 「스키마 업데이트」를 실행하면 사용할 수 있습니다.</div>}
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {rows.map((a) => {
          const expired = isExpired(a.expiresAt);
          return (
            <li key={a.id} className="row" style={{ gap: 8, padding: '7px 0', borderBottom: '1px solid var(--border)', alignItems: 'center' }}>
              <Paperclip style={{ width: 14, color: 'var(--text-3)' }} aria-hidden="true" />
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 600, fontSize: 13 }} title={a.filename}>{a.filename}</span>
              <span className="muted" style={{ fontSize: 11.5, whiteSpace: 'nowrap' }} title={`${a.mime || '형식 미상'} · 올린 사람 ${a.uploaderName || '—'}`}>{formatBytes(a.size)}</span>
              <span className={`pill ${a.status === 'stored' ? 'p-green' : 'p-gray'}`} title={a.status === 'stored' ? '파일 본문이 저장소에 보관되어 있습니다' : '파일명·크기만 기록된 상태입니다(본문 미보관)'}>{a.status === 'stored' ? '보관' : '메타만'}</span>
              {a.expiresAt && <span className="muted" style={{ fontSize: 11, whiteSpace: 'nowrap', color: expired ? '#c0414f' : undefined }} title={`보존 만료일 ${new Date(a.expiresAt).toLocaleDateString('ko-KR')}`}>{expired ? '만료' : `~${new Date(a.expiresAt).toLocaleDateString('ko-KR')}`}</span>}
              <button className="iconbtn" aria-label={`첨부 ${a.filename} 삭제`} title="첨부 기록 삭제" onClick={() => remove(a.id)}><Trash2 style={{ width: 14 }} aria-hidden="true" /></button>
            </li>
          );
        })}
        {loaded && rows.length === 0 && <li className="muted" style={{ padding: '8px 0', fontSize: 12.5 }}>첨부가 없습니다. 파일을 선택해 기록을 추가하세요.</li>}
      </ul>
      {err && <div className="err" role="alert" style={{ marginTop: 8 }}>{err}</div>}
      <form onSubmit={add} className="row" style={{ marginTop: 10, gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <input ref={fileRef} type="file" aria-label="첨부 파일 선택" className="in" style={{ flex: 1, minWidth: 180, height: 34, padding: '5px 8px' }} onChange={(e) => { setPicked(e.target.files?.[0] ?? null); setErr(''); }} disabled={unavailable} />
        <button className="btn btn-pri" type="submit" disabled={busy || !picked || unavailable} title={picked ? `${picked.name} (${formatBytes(picked.size)}) 기록` : '파일을 선택하면 기록할 수 있습니다'}>{busy ? '기록 중…' : storage?.canStore ? '업로드' : '메타데이터 기록'}</button>
      </form>
    </div>
  );
}
