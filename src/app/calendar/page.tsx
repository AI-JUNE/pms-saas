'use client';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Shell } from '@/components/Shell';
import { ChevronLeft, ChevronRight, CalendarDays } from 'lucide-react';

type Ev = { date: string; label: string; kind: string; color: string; href: string };

// 회의는 '지남'일 뿐 기한 초과 대상이 아님 — 마감/기한 성격의 이벤트만 초과 판정
const isDeadlineKind = (k: string) => k === '업무마감' || k === '테스트기한' || k === '이슈기한';

export default function Page() {
  const router = useRouter();
  const [pid, setPid] = useState<number | null>(null);
  const [evs, setEvs] = useState<Ev[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [cur, setCur] = useState(() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() }; });
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const toggleKind = (k: string) => setHidden((prev) => { const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n; });

  useEffect(() => {
    const p = Number(localStorage.getItem('pms.project')) || null; setPid(p);
    if (!p) { setLoaded(true); return; }
    Promise.all([
      fetch(`/api/meetings?projectId=${p}`).then((r) => r.ok ? r.json() : []),
      fetch(`/api/tasks?projectId=${p}`).then((r) => r.ok ? r.json() : []),
      fetch(`/api/tests?projectId=${p}`).then((r) => r.ok ? r.json() : []),
      fetch(`/api/issues?projectId=${p}`).then((r) => r.ok ? r.json() : []),
    ]).then(([mt, tk, ts, is]) => {
      const out: Ev[] = [];
      (Array.isArray(mt) ? mt : []).forEach((x: any) => x.meetingDate && out.push({ date: x.meetingDate, label: x.title, kind: '회의', color: '#0e9bb8', href: '/meetings' }));
      (Array.isArray(tk) ? tk : []).forEach((x: any) => x.endDate && x.status !== 'done' && out.push({ date: x.endDate, label: x.name, kind: '업무마감', color: '#be5535', href: '/tasks' }));
      (Array.isArray(ts) ? ts : []).forEach((x: any) => x.dueDate && out.push({ date: x.dueDate, label: x.title, kind: '테스트기한', color: '#7c4dff', href: '/tests' }));
      (Array.isArray(is) ? is : []).forEach((x: any) => x.dueDate && !['resolved', 'closed'].includes(x.status) && out.push({ date: x.dueDate, label: x.title, kind: '이슈기한', color: '#d98a16', href: '/issues' }));
      setEvs(out); setLoaded(true);
    });
  }, []);

  const kindCount = useMemo(() => { const c: Record<string, number> = {}; for (const e of evs) c[e.kind] = (c[e.kind] || 0) + 1; return c; }, [evs]);
  const byDay = useMemo(() => { const m: Record<string, Ev[]> = {}; for (const e of evs) { if (hidden.has(e.kind)) continue; const k = e.date.slice(0, 10); (m[k] ||= []).push(e); } return m; }, [evs, hidden]);
  const first = new Date(cur.y, cur.m, 1);
  const startDow = first.getDay();
  const days = new Date(cur.y, cur.m + 1, 0).getDate();
  const cells: (number | null)[] = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= days; d++) cells.push(d);
  while (cells.length % 7) cells.push(null);
  const todayStr = new Date().toISOString().slice(0, 10);
  // 표시 중(숨김 제외)인 마감/기한 이벤트 중 오늘 이전에 걸린 미완료 건 = 기한 초과 (월 이동과 무관하게 전체 집계)
  const overdueCount = evs.filter((e) => isDeadlineKind(e.kind) && !hidden.has(e.kind) && e.date.slice(0, 10) < todayStr).length;
  const dkey = (d: number) => `${cur.y}-${String(cur.m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const move = (delta: number) => { let y = cur.y, m = cur.m + delta; if (m < 0) { m = 11; y--; } if (m > 11) { m = 0; y++; } setCur({ y, m }); };

  if (loaded && !pid) return <Shell title="캘린더"><div className="card card-pad muted">상단에서 프로젝트를 선택하면 일정이 표시됩니다.</div></Shell>;

  return (
    <Shell title="캘린더">
      <div className="row" style={{ marginBottom: 14 }}>
        <div><h2 className="h1">캘린더 <CalendarDays style={{ width: 20, verticalAlign: -3, color: 'var(--brand)' }} />
          {overdueCount > 0 && <span title={`오늘(${todayStr}) 이전에 마감·기한이 지난 미완료 업무·테스트·이슈 ${overdueCount}건 — 달력에서 빨강 ⚠ 로 표시됩니다`} style={{ marginLeft: 8, verticalAlign: 3, display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 9px', borderRadius: 20, fontSize: 12, fontWeight: 700, background: '#fdecec', color: '#c0392b', border: '1px solid #f0c4c4' }}>⚠ 기한 초과 {overdueCount}건</span>}</h2>
          <p className="h-sub">회의·업무 마감·테스트/이슈 기한을 한눈에 봅니다.</p></div>
        <div className="sp" />
        <div className="row" style={{ gap: 8 }}>
          <button className="iconbtn" aria-label="이전 달" onClick={() => move(-1)}><ChevronLeft style={{ width: 18 }} /></button>
          <div style={{ fontWeight: 800, fontSize: 15, minWidth: 92, textAlign: 'center' }}>{cur.y}.{String(cur.m + 1).padStart(2, '0')}</div>
          <button className="iconbtn" aria-label="다음 달" onClick={() => move(1)}><ChevronRight style={{ width: 18 }} /></button>
          <button className="btn btn-sm" onClick={() => { const d = new Date(); setCur({ y: d.getFullYear(), m: d.getMonth() }); }}>오늘</button>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10, fontSize: 12 }}>
        {[['회의', '#0e9bb8'], ['업무마감', '#be5535'], ['테스트기한', '#7c4dff'], ['이슈기한', '#d98a16']].map(([l, c]) => {
          const off = hidden.has(l as string);
          return (
            <button key={l} type="button" onClick={() => toggleKind(l as string)} title={off ? `${l} 표시` : `${l} 숨기기`} aria-pressed={!off}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 9px', borderRadius: 20, cursor: 'pointer', fontSize: 12, fontWeight: 600, border: '1px solid var(--border)', background: off ? 'var(--surface-2)' : `${c}12`, color: off ? 'var(--text-4)' : 'var(--text-2)', opacity: off ? 0.55 : 1, textDecoration: off ? 'line-through' : 'none', transition: 'opacity .15s, background .15s' }}>
              <span style={{ width: 9, height: 9, borderRadius: 3, background: off ? 'var(--text-4)' : c as string }} />{l}<span style={{ color: 'var(--text-4)', fontWeight: 700 }}>{kindCount[l as string] || 0}</span>
            </button>
          );
        })}
        {hidden.size > 0 && <button type="button" className="btn btn-sm" onClick={() => setHidden(new Set())} style={{ marginLeft: 2 }}>모두 표시</button>}
      </div>
      <div className="card" style={{ overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', borderBottom: '1px solid var(--border)' }}>
          {['일', '월', '화', '수', '목', '금', '토'].map((d, i) => <div key={d} style={{ padding: '8px 10px', fontSize: 12, fontWeight: 700, color: i === 0 ? '#c0414f' : i === 6 ? '#0e9bb8' : 'var(--text-3)', textAlign: 'center' }}>{d}</div>)}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)' }}>
          {cells.map((d, i) => {
            const k = d ? dkey(d) : '';
            const list = d ? (byDay[k] || []) : [];
            const isToday = k === todayStr;
            return (
              <div key={i} style={{ minHeight: 92, borderRight: (i % 7 !== 6) ? '1px solid var(--border)' : 'none', borderBottom: '1px solid var(--border)', padding: 6, background: isToday ? 'var(--brand-50)' : d ? '#fff' : 'var(--surface-2)' }}>
                {d && <div style={{ fontSize: 11.5, fontWeight: isToday ? 800 : 600, color: isToday ? 'var(--brand)' : 'var(--text-3)', marginBottom: 4 }}>{d}</div>}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  {list.slice(0, 3).map((e, j) => {
                    const od = isDeadlineKind(e.kind) && k < todayStr;
                    return (
                      <div key={j} onClick={() => router.push(e.href)} title={`${e.kind} · ${e.label}${od ? ' · ⚠ 기한 초과' : ''}`} style={{ cursor: 'pointer', fontSize: 10.5, padding: '1px 5px', borderRadius: 4, background: od ? '#fdecec' : `${e.color}1a`, color: od ? '#c0392b' : e.color, fontWeight: od ? 700 : 600, boxShadow: od ? 'inset 2px 0 0 #d64545' : 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{od ? '⚠ ' : ''}{e.label}</div>
                    );
                  })}
                  {list.length > 3 && <div className="muted" title={list.slice(3).map((e) => `${e.kind} · ${e.label}`).join('\n')} style={{ fontSize: 10, cursor: 'default' }}>+{list.length - 3}</div>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </Shell>
  );
}
