'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Shell } from '@/components/Shell';
import { Pill } from '@/lib/ui';
import { ListTodo, Bug, ShieldAlert, Inbox } from 'lucide-react';

export default function Page() {
  const router = useRouter();
  const [d, setD] = useState<any>(null);
  useEffect(() => { fetch('/api/my-work').then((r) => r.ok ? r.json() : null).then(setD).catch(() => setD({ tasks: [], issues: [], risks: [] })); }, []);

  const Section = ({ icon: Icon, title, rows, href, cols }: any) => (
    <div className="card" style={{ overflow: 'hidden', marginBottom: 18 }}>
      <div className="row" style={{ padding: '13px 16px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 750, fontSize: 14 }}><Icon style={{ width: 16, color: 'var(--brand)' }} />{title}</div>
        <span className="muted" style={{ marginLeft: 8, fontSize: 12 }}>{rows.length}건</span>
      </div>
      {rows.length === 0 ? <div className="empty" style={{ padding: 24 }}><Inbox /><div>배정된 항목이 없습니다.</div></div> : (
        <table className="tbl"><thead><tr>{cols.map((c: any) => <th key={c.key}>{c.label}</th>)}<th style={{ width: 90 }}>프로젝트</th></tr></thead>
          <tbody>{rows.map((r: any) => (
            <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => router.push(href)}>
              {cols.map((c: any) => <td key={c.key}>{c.badge ? <Pill v={r[c.key]} /> : (c.mono ? <span className="mono">{r[c.key] || '—'}</span> : (r[c.key] ?? '—'))}</td>)}
              <td><span className="mono" style={{ fontSize: 11.5, color: 'var(--text-3)' }}>{r.projectCode}</span></td>
            </tr>))}</tbody></table>
      )}
    </div>
  );

  return (
    <Shell title="내 작업">
      <div className="row" style={{ marginBottom: 6 }}><div><h2 className="h1">내 작업</h2><p className="h-sub">{d?.name ? `${d.name}님에게 배정된 업무·이슈·리스크입니다.` : '나에게 배정된 항목을 모아봅니다.'}</p></div></div>
      {!d ? <div className="muted" style={{ padding: 20 }}>불러오는 중…</div> : (<>
        <Section icon={ListTodo} title="내 업무 (WBS)" rows={d.tasks} href="/tasks" cols={[{ key: 'code', label: '코드', mono: true }, { key: 'name', label: '작업' }, { key: 'status', label: '상태', badge: true }, { key: 'endDate', label: '마감' }]} />
        <Section icon={Bug} title="내 이슈" rows={d.issues} href="/issues" cols={[{ key: 'code', label: '코드', mono: true }, { key: 'title', label: '제목' }, { key: 'priority', label: '우선순위', badge: true }, { key: 'status', label: '상태', badge: true }]} />
        <Section icon={ShieldAlert} title="내 리스크" rows={d.risks} href="/risks" cols={[{ key: 'code', label: '코드', mono: true }, { key: 'title', label: '제목' }, { key: 'level', label: '등급', badge: true }, { key: 'status', label: '상태', badge: true }]} />
      </>)}
    </Shell>
  );
}
