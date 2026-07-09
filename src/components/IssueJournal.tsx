'use client';
import { useEffect, useState } from 'react';
import { Eye, EyeOff, History } from 'lucide-react';

const FIELD_LABEL: Record<string, string> = {
  title: '제목', description: '설명', type: '유형', priority: '우선순위', status: '상태',
  assignee: '담당자', dueDate: '기한', labels: '라벨', storyPoints: 'SP', sprintId: '스프린트',
  epic: '에픽', reqCode: '연계 요구사항',
};
function val(v: any) { return v === null || v === undefined || v === '' ? '—' : String(v); }

export function IssueJournal({ issueId }: { issueId: number }) {
  const [journal, setJournal] = useState<any[]>([]);
  const [watchers, setWatchers] = useState<any[]>([]);
  const [watching, setWatching] = useState(false);
  const [busy, setBusy] = useState(false);

  function load() {
    fetch(`/api/issues/${issueId}/journal`).then((r) => r.ok ? r.json() : []).then((d) => setJournal(Array.isArray(d) ? d : []));
    fetch(`/api/issues/${issueId}/watchers`).then((r) => r.ok ? r.json() : { watchers: [], watching: false }).then((d) => { setWatchers(d.watchers || []); setWatching(!!d.watching); });
  }
  useEffect(load, [issueId]);

  async function toggleWatch() {
    setBusy(true);
    const r = await fetch(`/api/issues/${issueId}/watchers`, { method: 'POST' });
    setBusy(false);
    if (r.ok) load();
  }

  return (
    <div style={{ marginTop: 22 }}>
      <div className="row" style={{ alignItems: 'center', marginBottom: 8 }}>
        <div className="sect" style={{ margin: 0 }}><History style={{ width: 14, verticalAlign: '-2px', marginRight: 4 }} />변경 이력 {journal.length > 0 && `(${journal.length})`}</div>
        <div className="sp" />
        <button className={`btn btn-sm ${watching ? 'btn-pri' : ''}`} disabled={busy} onClick={toggleWatch} title="이 이슈의 변경을 관심 등록">
          {watching ? <EyeOff style={{ width: 14 }} /> : <Eye style={{ width: 14 }} />}
          {watching ? '관심 해제' : '관심'}{watchers.length > 0 && ` ${watchers.length}`}
        </button>
      </div>
      {watchers.length > 0 && (
        <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>워처: {watchers.map((w) => w.userName).join(', ')}</div>
      )}
      <div>
        {journal.map((j) => {
          let changes: any[] = [];
          try { changes = JSON.parse(j.changes || '[]'); } catch { changes = []; }
          return (
            <div className="cmt" key={j.id}>
              <div className="av">{(j.authorName || 'U').slice(0, 1)}</div>
              <div className="bd">
                <div className="nm">{j.authorName}</div>
                <div className="tx">
                  {changes.length === 0 ? <span className="muted">변경 없음</span> : changes.map((ch, i) => (
                    <div key={i} style={{ fontSize: 12.5 }}>
                      <b>{FIELD_LABEL[ch.field] || ch.field}</b>: <span className="muted" style={{ textDecoration: 'line-through' }}>{val(ch.from)}</span> → <span style={{ fontWeight: 700 }}>{val(ch.to)}</span>
                    </div>
                  ))}
                </div>
                <div className="mt">{new Date(j.createdAt).toLocaleString('ko-KR')}</div>
              </div>
            </div>
          );
        })}
        {journal.length === 0 && <div className="muted" style={{ padding: '8px 0' }}>아직 변경 이력이 없습니다. 이슈를 수정하면 여기에 기록됩니다.</div>}
      </div>
    </div>
  );
}
