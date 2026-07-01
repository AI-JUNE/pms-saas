'use client';
import { useEffect, useState } from 'react';
import { Send } from 'lucide-react';
function fmtBody(b: string) {
  const parts = String(b).split(/(@[\w가-힣]+)/g);
  return parts.map((p, i) => p.startsWith('@') ? <span key={i} className="ment">{p}</span> : <span key={i}>{p}</span>);
}
export function Comments({ entity, entityId }: { entity: string; entityId: number }) {
  const [list, setList] = useState<any[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  function load() { fetch(`/api/comments?entity=${entity}&entityId=${entityId}`).then((r) => r.ok ? r.json() : []).then((d) => setList(Array.isArray(d) ? d : [])); }
  useEffect(load, [entity, entityId]);
  async function add(e: React.FormEvent) {
    e.preventDefault(); if (!text.trim()) return; setBusy(true);
    const r = await fetch('/api/comments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ entity, entityId, body: text }) });
    setBusy(false); if (r.ok) { setText(''); load(); }
  }
  return (
    <div style={{ marginTop: 22 }}>
      <div className="sect" style={{ marginBottom: 8 }}>댓글 {list.length > 0 && `(${list.length})`}</div>
      <div>
        {list.map((c) => (
          <div className="cmt" key={c.id}>
            <div className="av">{(c.authorName || 'U').slice(0, 1)}</div>
            <div className="bd"><div className="nm">{c.authorName}</div><div className="tx">{fmtBody(c.body)}</div><div className="mt">{new Date(c.createdAt).toLocaleString('ko-KR')}</div></div>
          </div>
        ))}
        {list.length === 0 && <div className="muted" style={{ padding: '8px 0' }}>첫 댓글을 남겨보세요. @이름 으로 멘션하면 알림이 갑니다.</div>}
      </div>
      <form onSubmit={add} className="row" style={{ marginTop: 10, alignItems: 'flex-end' }}>
        <textarea className="in" style={{ minHeight: 40 }} placeholder="댓글 입력… (@이름 멘션)" value={text} onChange={(e) => setText(e.target.value)} />
        <button className="btn btn-pri" disabled={busy}><Send style={{ width: 15 }} /></button>
      </form>
    </div>
  );
}
