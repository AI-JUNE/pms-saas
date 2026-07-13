'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Shell } from '@/components/Shell';
import { Pill } from '@/lib/ui';
import { ListTodo, ListChecks, Bug, ShieldAlert, Inbox } from 'lucide-react';

const DAY = 86400000;
const DONE = ['done', 'resolved', 'closed'];
const d0 = (v: any) => { const t = new Date(v); if (isNaN(t.getTime())) return null; t.setHours(0, 0, 0, 0); return t; };

// 기한 셀: 다른 목록 화면(업무·이슈·테스트)과 동일한 D-day·초과 하이라이트 규칙
function dueCell(v: any, row: any) {
  if (!v) return <span className="muted">—</span>;
  const t = d0(v);
  if (!t) return <span>{v}</span>;
  if (DONE.includes(String(row?.status || ''))) return <span className="muted" title="완료된 항목 — 기한 경보 없음">{v}</span>;
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const dd = Math.round((t.getTime() - now.getTime()) / DAY);
  const col = dd < 0 ? '#c0414f' : dd <= 7 ? '#d98a16' : undefined;
  const tip = dd < 0 ? `${-dd}일 기한 초과` : dd === 0 ? '오늘 기한' : dd <= 7 ? `D-${dd}` : undefined;
  return <span title={tip} style={{ color: col, fontWeight: col ? 700 : undefined, cursor: tip ? 'help' : undefined, whiteSpace: 'nowrap' }}>
    {v}{dd < 0 ? ' ⚠' : ''}
  </span>;
}

// 지연(기한 초과) 판정 — 완료 항목 제외
const isLate = (r: any, key: string) => {
  if (DONE.includes(String(r?.status || ''))) return false;
  const t = d0(r?.[key]);
  if (!t) return false;
  const now = new Date(); now.setHours(0, 0, 0, 0);
  return t.getTime() < now.getTime();
};

// 기한 임박순 정렬 — 기한 없는 항목은 뒤로, 완료 항목은 맨 뒤로
const byDue = (key: string) => (a: any, b: any) => {
  const ad = DONE.includes(String(a?.status || '')) ? 1 : 0;
  const bd = DONE.includes(String(b?.status || '')) ? 1 : 0;
  if (ad !== bd) return ad - bd;
  const at = d0(a?.[key])?.getTime() ?? Infinity;
  const bt = d0(b?.[key])?.getTime() ?? Infinity;
  return at - bt;
};

export default function Page() {
  const router = useRouter();
  const [d, setD] = useState<any>(null);
  const [todos, setTodos] = useState<any[]>([]);
  useEffect(() => { fetch('/api/my-work').then((r) => r.ok ? r.json() : null).then(setD).catch(() => setD({ tasks: [], issues: [], risks: [] })); fetch('/api/todos').then((r) => r.ok ? r.json() : []).then((t) => setTodos(Array.isArray(t) ? t : [])).catch(() => {}); }, []);

  const Section = ({ icon: Icon, title, rows, href, cols, dueKey, empty }: any) => {
    const late = dueKey ? rows.filter((r: any) => isLate(r, dueKey)).length : 0;
    const sorted = dueKey ? [...rows].sort(byDue(dueKey)) : rows;
    return (
      <div className="card" style={{ overflow: 'hidden', marginBottom: 18 }}>
        <div className="row" style={{ padding: '13px 16px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 750, fontSize: 14 }}><Icon style={{ width: 16, color: 'var(--brand)' }} />{title}</div>
          <span className="muted" style={{ marginLeft: 8, fontSize: 12 }}>{rows.length}건</span>
          {late > 0 && (
            <span title={`기한이 지난 항목 ${late}건 — 목록 맨 위에 표시됩니다`} style={{ marginLeft: 8, fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: '#fdecee', color: '#c0414f', border: '1px solid #f3d2d7', cursor: 'help' }}>
              지연 {late}건
            </span>
          )}
        </div>
        {rows.length === 0 ? <div className="empty" style={{ padding: 24 }}><Inbox /><div>{empty || '배정된 항목이 없습니다.'}</div></div> : (
          <table className="tbl"><thead><tr>{cols.map((c: any) => <th key={c.key}>{c.label}</th>)}<th style={{ width: 90 }}>프로젝트</th></tr></thead>
            <tbody>{sorted.map((r: any) => (
              <tr key={r.id} style={{ cursor: 'pointer', opacity: DONE.includes(String(r?.status || '')) ? 0.62 : 1 }} onClick={() => router.push(href)}>
                {cols.map((c: any) => <td key={c.key}>{c.render ? c.render(r[c.key], r) : (c.badge ? <Pill v={r[c.key]} /> : (c.mono ? <span className="mono">{r[c.key] || '—'}</span> : (r[c.key] ?? '—')))}</td>)}
                <td><span className="mono" style={{ fontSize: 11.5, color: 'var(--text-3)' }}>{r.projectCode}</span></td>
              </tr>))}</tbody></table>
        )}
      </div>
    );
  };

  const openTodos = todos.filter((t: any) => t.status !== 'done');
  // 상단 요약: 기한이 지난 항목을 도메인 구분 없이 합산해 '오늘 먼저 볼 것'을 드러낸다
  const lateAll = d ? openTodos.filter((t: any) => isLate(t, 'dueDate')).length
    + (d.tasks || []).filter((t: any) => isLate(t, 'endDate')).length
    + (d.issues || []).filter((i: any) => isLate(i, 'dueDate')).length
    + (d.risks || []).filter((r: any) => isLate(r, 'dueDate')).length : 0;

  return (
    <Shell title="내 작업">
      <div className="row" style={{ marginBottom: 6 }}>
        <div>
          <h2 className="h1">내 작업</h2>
          <p className="h-sub">{d?.name ? `${d.name}님에게 배정된 업무·이슈·리스크입니다.` : '나에게 배정된 항목을 모아봅니다.'}</p>
        </div>
        {lateAll > 0 && (
          <span title="To-Do·업무·이슈·리스크 중 기한이 지난 미완료 항목 합계" style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 700, padding: '5px 11px', borderRadius: 999, background: '#fdecee', color: '#c0414f', border: '1px solid #f3d2d7', cursor: 'help', whiteSpace: 'nowrap' }}>
            ⚠ 기한 초과 {lateAll}건
          </span>
        )}
      </div>
      {!d ? <div className="card card-pad" style={{ display: 'grid', gap: 12 }}>{Array.from({ length: 5 }).map((_, i) => <div key={i} className="skel" style={{ height: i === 0 ? 26 : 18, width: i === 0 ? '30%' : '100%' }} />)}</div> : (<>
        <Section icon={ListChecks} title="내 To-Do (미완료)" rows={openTodos} href="/todos" dueKey="dueDate" empty="미완료 To-Do가 없습니다. 개인 할 일은 “내 To-Do”에서 추가하세요."
          cols={[{ key: 'title', label: '할 일' }, { key: 'priority', label: '우선순위', badge: true }, { key: 'status', label: '상태', badge: true }, { key: 'dueDate', label: '기한', render: dueCell }]} />
        <Section icon={ListTodo} title="내 업무 (WBS)" rows={d.tasks} href="/tasks" dueKey="endDate" empty="나에게 배정된 업무(WBS)가 없습니다."
          cols={[{ key: 'code', label: '코드', mono: true }, { key: 'name', label: '작업' }, { key: 'status', label: '상태', badge: true }, { key: 'endDate', label: '마감', render: dueCell }]} />
        <Section icon={Bug} title="내 이슈" rows={d.issues} href="/issues" dueKey="dueDate" empty="나에게 배정된 미해결 이슈가 없습니다."
          cols={[{ key: 'code', label: '코드', mono: true }, { key: 'title', label: '제목' }, { key: 'priority', label: '우선순위', badge: true }, { key: 'status', label: '상태', badge: true }, { key: 'dueDate', label: '기한', render: dueCell }]} />
        <Section icon={ShieldAlert} title="내 리스크" rows={d.risks} href="/risks" dueKey="dueDate" empty="내가 담당하는 리스크가 없습니다."
          cols={[{ key: 'code', label: '코드', mono: true }, { key: 'title', label: '제목' }, { key: 'level', label: '등급', badge: true }, { key: 'status', label: '상태', badge: true }, { key: 'dueDate', label: '기한', render: dueCell }]} />
      </>)}
    </Shell>
  );
}
