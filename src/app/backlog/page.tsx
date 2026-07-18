'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Play, CheckCircle2, Flag, Layers, ListChecks, Inbox, Rocket, Hash, AlertTriangle } from 'lucide-react';
import { Shell } from '@/components/Shell';
import { Pill, LABEL } from '@/lib/ui';

const sprintBadge = (s: string) => s === 'active' ? 'p-green' : s === 'completed' ? 'p-gray' : 'p-amber';
// 이슈 완료 판정 — 이슈 목록·칸반과 동일 기준(resolved 해결 / closed 종료)
const isDone = (s: any) => ['resolved', 'closed'].includes(String(s));

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
  // 미추정 — 미완료인데 스토리포인트가 없는(0) 이슈. 속도(velocity)·번다운·포인트 기준 진척이 왜곡되는 원인.
  const unest = (list: any[]) => list.filter((i) => !isDone(i.status) && !(Number(i.storyPoints) > 0)).length;
  const UnestChip = ({ n }: { n: number }) => n > 0
    ? <span className="pill p-amber" style={{ fontSize: 10.5 }} title={`스토리포인트가 없는 미완료 이슈 ${n}건 — 스프린트 속도·번다운·포인트 기준 진척 집계에서 빠집니다. 아래에서 포인트를 입력하세요.`}><AlertTriangle style={{ width: 10, marginRight: 3, verticalAlign: -1 }} />미추정 {n}</span>
    : null;
  async function newSprint() {
    const name = prompt('스프린트 이름', `Sprint ${sprints.length + 1}`); if (!name || !pid) return;
    await fetch('/api/sprints', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, projectId: pid, status: 'planned' }) });
    load(pid);
  }
  async function setSprintStatus(id: number, status: string) { await fetch(`/api/sprints/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) }); load(pid); }
  async function moveIssue(id: number, sprintId: number | null) { await fetch(`/api/issues/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sprintId }) }); load(pid); }
  async function setPoints(id: number, storyPoints: number) { await fetch(`/api/issues/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ storyPoints }) }); load(pid); }

  // 스프린트 진척 — 스토리포인트 기준(미입력이면 건수 기준)
  function SprintProgress({ list }: { list: any[] }) {
    if (list.length === 0) return null;
    const done = list.filter((i) => isDone(i.status));
    const tp = pts(list), dp = pts(done);
    const byPts = tp > 0;
    const pct = byPts ? Math.round((dp / tp) * 100) : Math.round((done.length / list.length) * 100);
    const col = pct >= 100 ? '#2f8f5b' : pct >= 50 ? 'var(--brand)' : '#9a9a9a';
    const tip = `총 ${list.length}건 · 완료 ${done.length}건 · 남은 ${list.length - done.length}건`
      + (byPts ? ` / 포인트 ${dp}/${tp} pts (${pct}%)` : ` / 스토리포인트 미입력 — 건수 기준 ${pct}%`);
    return (
      <div className="row" style={{ gap: 7, cursor: 'help' }} title={tip} aria-label={tip}>
        <div className="bar" style={{ minWidth: 90, width: 90 }}><i style={{ width: `${Math.min(100, pct)}%`, background: col }} /></div>
        <span style={{ fontSize: 11.5, fontWeight: 700, color: col, fontVariantNumeric: 'tabular-nums' }}>{pct}%</span>
      </div>
    );
  }

  function IssueRow({ i }: { i: any }) {
    const done = isDone(i.status);
    return (
      <div className="row" style={{ gap: 10, padding: '9px 12px', borderBottom: '1px solid var(--border)', fontSize: 13, opacity: done ? 0.62 : 1 }}>
        <span className="mono" style={{ minWidth: 66 }}>{i.code}</span>
        {i.type && <Pill v={i.type} />}
        <span style={{ flex: 1, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textDecoration: done ? 'line-through' : undefined }}>{i.title}</span>
        {i.epic && <span className="label-chip"><Flag style={{ width: 10, marginRight: 3, verticalAlign: -1 }} />{i.epic}</span>}
        {i.priority && <Pill v={i.priority} />}
        <Pill v={i.status} />
        <input className="in" title={!done && !(Number(i.storyPoints) > 0) ? '스토리 포인트 미추정 — 속도·번다운 집계에서 제외됩니다' : '스토리 포인트'}
          style={{ width: 52, padding: '4px 6px', textAlign: 'center', ...(!done && !(Number(i.storyPoints) > 0) ? { borderColor: '#d98a16', color: '#d98a16', fontWeight: 700 } : {}) }}
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
          {(() => {
            const backlogList = issues.filter((i) => !i.sprintId);
            const activeN = sprints.filter((s) => s.status === 'active').length;
            const totalUnest = unest(issues);
            return (
              <div className="kpis" style={{ marginBottom: 16 }}>
                <div className="kpi k0"><div className="kpi-ic" style={{ background: 'rgba(190,85,53,.12)' }}><ListChecks style={{ width: 18, color: 'var(--brand)' }} /></div>
                  <div className="kpi-label">전체 이슈</div><div className="kpi-value">{issues.length}</div><div className="kpi-sub">{pts(issues)} pts</div></div>
                <div className="kpi k2" title="스프린트에 배정되지 않은 대기 이슈"><div className="kpi-ic" style={{ background: 'rgba(217,138,22,.12)' }}><Inbox style={{ width: 18, color: '#d98a16' }} /></div>
                  <div className="kpi-label">백로그 대기</div><div className="kpi-value">{backlogList.length}</div><div className="kpi-sub">{pts(backlogList)} pts 미계획</div></div>
                <div className="kpi k1" title="전체 스프린트 수(진행 중 포함)"><div className="kpi-ic" style={{ background: 'rgba(47,143,91,.12)' }}><Rocket style={{ width: 18, color: '#2f8f5b' }} /></div>
                  <div className="kpi-label">스프린트</div><div className="kpi-value">{sprints.length}</div><div className="kpi-sub">진행 중 {activeN}개</div></div>
                <div className="kpi k5" title="미완료 이슈의 스토리포인트 합계"><div className="kpi-ic" style={{ background: 'rgba(14,155,184,.12)' }}><Hash style={{ width: 18, color: '#0e9bb8' }} /></div>
                  <div className="kpi-label">잔여 포인트</div><div className="kpi-value">{pts(issues.filter((i) => !isDone(i.status)))}</div><div className="kpi-sub">미완료 이슈 기준</div></div>
                <div className="kpi k3" title="스토리포인트가 없는 미완료 이슈 — 속도·번다운·포인트 진척 집계에서 빠집니다"><div className="kpi-ic" style={{ background: 'rgba(192,65,79,.12)' }}><AlertTriangle style={{ width: 18, color: '#c0414f' }} /></div>
                  <div className="kpi-label">미추정</div><div className="kpi-value" style={totalUnest > 0 ? { color: '#c0414f' } : undefined}>{totalUnest}</div><div className="kpi-sub">포인트 미입력 이슈</div></div>
              </div>
            );
          })()}
          {sprints.map((s) => { const list = issues.filter((i) => i.sprintId === s.id); return (
            <div className="card" key={s.id} style={{ marginBottom: 14, overflow: 'hidden' }}>
              <div className="row" style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', gap: 10, background: 'var(--surface-2)' }}>
                <Layers style={{ width: 17, color: 'var(--brand)' }} />
                <span style={{ fontWeight: 750 }}>{s.name}</span>
                <span className={`pill ${sprintBadge(s.status)}`}>{LABEL[String(s.status)] || s.status}</span>
                <span className="muted">{list.length}건 · {pts(list)} pts</span>
                <UnestChip n={unest(list)} />
                <SprintProgress list={list} />
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
              <UnestChip n={unest(issues.filter((i) => !i.sprintId))} />
            </div>
            {issues.filter((i) => !i.sprintId).length === 0 ? <div className="empty"><Layers /><div>백로그가 비었습니다. 이슈 메뉴에서 이슈를 추가하세요.</div></div>
              : issues.filter((i) => !i.sprintId).map((i) => <IssueRow key={i.id} i={i} />)}
          </div>
        </>
      )}
    </Shell>
  );
}
