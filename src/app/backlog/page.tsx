'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Play, CheckCircle2, Flag, Layers } from 'lucide-react';
import { Shell } from '@/components/Shell';
import { Pill } from '@/lib/ui';

const sprintBadge = (s: string) => s === 'active' ? 'p-green' : s === 'completed' ? 'p-gray' : 'p-amber';

export default function Backlog() {
  const router = useRouter();
  const [pid, setPid] = useState<number | null>(null);
  const [sprints, setSprints] = useState<any[]>([]);
  const [issues, setIssues] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  async function load(p: number | null) {
    if (!p) { setLoading(false); return; }
    const [sp, is] = await Promise.all([
      fetch(`/api/sprints?projectId=${p}`).then((r) => r.ok ? r.json() : []),
      fetch(`/api/issues?projectId=${p}`).then((r) => r.ok ? r.json() : []),
    ]);
    setSprints(Array.isArray(sp) ? sp : []); setIssues(Array.isArray(is) ? is : []); setLoading(false);
  }
  useEffect(() => { const p = Number(localStorage.getItem('pms.project')) || null; setPid(p); load(p); }, []);

  const pts = (list: any[]) => list.reduce((s, i) => s + (Number(i.storyPoints) || 0), 0);
  async function newSprint() {
    const name = prompt('스프린트 이름', `Sprint ${sprints.length + 1}`); if (!name || !pid) return;
    await fetch('/api/sprints', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, projectId: pid, status: 'planned' }) });
    load(pid);
  }
  async function setSprintStatus(id: number, status: string) { await fetch(`/api/sprints/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) }); load(pid); }
  async function moveIssue(id: number, sprintId: number | null) { await fetch(`/api/issues/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sprintId }) }); load(pid); }
  async function setPoints(id: number, storyPoints: number) { await fetch(`/api/issues/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ storyPoints }) }); load(pid); }

  function IssueRow({ i }: { i: any }) {
    return (
      <div className="row" style={{ gap: 10, padding: '9px 12px', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
        <span className="mono" style={{ minWidth: 66 }}>{i.code}</span>
        {i.type && <Pill v={i.type} />}
        <span style={{ flex: 1, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{i.title}</span>
        {i.epic && <span className="label-chip"><Flag style={{ width: 10, marginRight: 3, verticalAlign: -1 }} />{i.epic}</span>}
        {i.priority && <Pill v={i.priority} />}
        <input className="in" style={{ width: 52, padding: '4px 6px', textAlign: 'center' }} title="스토리 포인트"
          defaultValue={i.storyPoints || 0} onBlur={(e) => setPoints(i.id, Number(e.target.value) || 0)} />
        <select className="sel" style={{ minWidth: 130 }} value={i.sprintId ?? ''} onChange={(e) => moveIssue(i.id, e.target.value ? Number(e.target.value) : null)}>
          <option value="">백로그</option>
          {sprints.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>
    );
  }

  return (
    <Shell title="백로그">
      <div className="row"><div><h2 className="h1">백로그 & 스프린트</h2><p className="h-sub">스크럼 백로그를 스프린트로 계획하고 진행하세요. (Jira 방식)</p></div><div className="sp" /><button className="btn btn-pri" onClick={newSprint}><Plus />새 스프린트</button></div>
      <div style={{ height: 16 }} />
      {!pid ? <div className="empty">상단에서 프로젝트를 먼저 선택하세요.</div>
        : loading ? <div className="empty">불러오는 중…</div> : (
        <>
          {sprints.map((s) => { const list = issues.filter((i) => i.sprintId === s.id); return (
            <div className="card" key={s.id} style={{ marginBottom: 14, overflow: 'hidden' }}>
              <div className="row" style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', gap: 10, background: 'var(--surface-2)' }}>
                <Layers style={{ width: 17, color: 'var(--brand)' }} />
                <span style={{ fontWeight: 750 }}>{s.name}</span>
                <span className={`pill ${sprintBadge(s.status)}`}>{s.status}</span>
                <span className="muted">{list.length}건 · {pts(list)} pts</span>
                {s.goal && <span className="muted" style={{ fontStyle: 'italic' }}>“{s.goal}”</span>}
                <div className="sp" />
                {s.status === 'planned' && <button className="btn btn-sm btn-pri" onClick={() => setSprintStatus(s.id, 'active')}><Play style={{ width: 13 }} />시작</button>}
                {s.status === 'active' && <button className="btn btn-sm" onClick={() => setSprintStatus(s.id, 'completed')}><CheckCircle2 style={{ width: 13 }} />완료</button>}
              </div>
              {list.length === 0 ? <div className="muted" style={{ padding: 14 }}>이 스프린트에 배정된 이슈가 없습니다. 아래 백로그에서 옮기세요.</div>
                : list.map((i) => <IssueRow key={i.id} i={i} />)}
            </div>
          ); })}
          <div className="card" style={{ overflow: 'hidden' }}>
            <div className="row" style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', gap: 10 }}>
              <span style={{ fontWeight: 750 }}>백로그</span>
              <span className="muted">{issues.filter((i) => !i.sprintId).length}건 · {pts(issues.filter((i) => !i.sprintId))} pts</span>
            </div>
            {issues.filter((i) => !i.sprintId).length === 0 ? <div className="empty"><Layers /><div>백로그가 비었습니다. 이슈 메뉴에서 이슈를 추가하세요.</div></div>
              : issues.filter((i) => !i.sprintId).map((i) => <IssueRow key={i.id} i={i} />)}
          </div>
        </>
      )}
    </Shell>
  );
}
