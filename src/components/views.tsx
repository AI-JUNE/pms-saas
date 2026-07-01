'use client';
import { Pill } from '@/lib/ui';

// ---- Kanban board (issues / tasks) ----
export function Kanban({ rows, openDetail, columns, titleKey = 'title' }:
  { rows: any[]; openDetail: (r: any) => void; columns: { key: string; label: string; color: string }[]; titleKey?: string }) {
  return (
    <div className="kb">
      {columns.map((col) => {
        const items = rows.filter((r) => r.status === col.key);
        return (
          <div className="kb-col" key={col.key}>
            <div className="kb-h"><span style={{ width: 9, height: 9, borderRadius: 9, background: col.color }} />{col.label}<span className="cnt">{items.length}</span></div>
            {items.map((r) => (
              <div className="kb-card" key={r.id} onClick={() => openDetail(r)}>
                <div className="mono" style={{ fontSize: 11, marginBottom: 4 }}>{r.code}</div>
                <div style={{ fontWeight: 650, fontSize: 13.5, marginBottom: 8 }}>{r[titleKey]}</div>
                <div className="row" style={{ gap: 6 }}>
                  {r.priority && <Pill v={r.priority} />}
                  {r.type && <Pill v={r.type} />}
                  {typeof r.progress === 'number' && r.progress > 0 && <span className="muted">{r.progress}%</span>}
                  <div style={{ flex: 1 }} />
                  {r.assignee && <span className="muted" style={{ fontSize: 11.5 }}>{r.assignee}</span>}
                </div>
              </div>
            ))}
            {items.length === 0 && <div className="muted" style={{ padding: 8, fontSize: 12 }}>없음</div>}
          </div>
        );
      })}
    </div>
  );
}

// ---- Risk heatmap (5x5) ----
const heatColor = (s: number) => s >= 15 ? '#e0394b' : s >= 10 ? '#f2772e' : s >= 5 ? '#e0a800' : '#15a34a';
export function RiskMatrix({ rows, openDetail }: { rows: any[]; openDetail: (r: any) => void }) {
  return (
    <div className="card card-pad" style={{ display: 'inline-block' }}>
      <div className="sect" style={{ marginBottom: 12 }}>리스크 매트릭스 (발생가능성 × 영향도)</div>
      <table className="heat">
        <tbody>
          {[5, 4, 3, 2, 1].map((impact) => (
            <tr key={impact}>
              <td className="axis">{impact === 3 ? '영향' : ''}{impact}</td>
              {[1, 2, 3, 4, 5].map((prob) => {
                const score = impact * prob;
                const here = rows.filter((r) => Number(r.impact) === impact && Number(r.probability) === prob);
                return (
                  <td key={prob} style={{ background: heatColor(score), opacity: here.length ? 1 : 0.32, cursor: here.length ? 'pointer' : 'default' }}
                    title={here.map((r) => r.code + ' ' + r.title).join('\n')}
                    onClick={() => here[0] && openDetail(here[0])}>
                    {here.length || ''}
                  </td>
                );
              })}
            </tr>
          ))}
          <tr><td className="axis"></td>{[1, 2, 3, 4, 5].map((p) => <td key={p} className="axis">{p}</td>)}</tr>
          <tr><td className="axis"></td><td className="axis" colSpan={5}>발생가능성 →</td></tr>
        </tbody>
      </table>
    </div>
  );
}

// ---- Gantt (PM-grade timeline) ----
export function Gantt({ rows, openDetail }: { rows: any[]; openDetail: (r: any) => void }) {
  const withDates = rows.filter((r) => r.startDate || r.endDate);
  if (withDates.length === 0) return <div className="card card-pad muted">시작일·마감일이 있는 작업이 없습니다. 작업에 날짜를 입력하면 간트차트가 표시됩니다.</div>;
  const times = withDates.flatMap((r) => [r.startDate, r.endDate].filter(Boolean)).map((d: string) => new Date(d).getTime());
  const DAY = 86400000;
  let min = Math.min(...times), max = Math.max(...times);
  min -= 3 * DAY; max += 3 * DAY;
  const totalDays = Math.max(1, Math.round((max - min) / DAY));
  const pxDay = totalDays > 120 ? 6 : totalDays > 60 ? 10 : 16;
  const W = totalDays * pxDay;
  const LBL = 210;
  const color = (st: string) => st === 'done' ? '#2f8f5b' : st === 'doing' ? '#be5535' : '#94a3b8';
  const x = (d: string) => ((new Date(d).getTime() - min) / DAY) * pxDay;
  // month header segments
  const months: { label: string; left: number; width: number }[] = [];
  let cur = new Date(min); cur.setDate(1); cur.setHours(0,0,0,0);
  while (cur.getTime() <= max) {
    const next = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
    const l = Math.max(0, ((cur.getTime() - min) / DAY) * pxDay);
    const r = Math.min(W, ((next.getTime() - min) / DAY) * pxDay);
    months.push({ label: `${cur.getFullYear()}.${cur.getMonth() + 1}`, left: l, width: Math.max(0, r - l) });
    cur = next;
  }
  const todayLeft = ((Date.now() - min) / DAY) * pxDay;
  const showToday = Date.now() >= min && Date.now() <= max;
  return (
    <div className="card" style={{ overflow: 'hidden' }}>
      <div className="row" style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
        <div className="sect" style={{ margin: 0 }}>간트차트 · 로드맵</div><div className="sp" />
        <span className="muted" style={{ fontSize: 11.5 }}><span style={{ color: '#94a3b8' }}>●</span> 대기 <span style={{ color: '#be5535' }}>●</span> 진행 <span style={{ color: '#2f8f5b' }}>●</span> 완료</span>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <div style={{ minWidth: LBL + W }}>
          {/* header */}
          <div style={{ display: 'flex', height: 30, borderBottom: '1px solid var(--border)', position: 'sticky', top: 0, background: 'var(--surface)' }}>
            <div style={{ width: LBL, flexShrink: 0, borderRight: '1px solid var(--border)', display: 'flex', alignItems: 'center', padding: '0 14px', fontSize: 11.5, fontWeight: 700, color: 'var(--text-3)' }}>작업</div>
            <div style={{ position: 'relative', width: W }}>
              {months.map((m, i) => <div key={i} style={{ position: 'absolute', left: m.left, width: m.width, top: 0, height: 30, borderLeft: '1px solid var(--border)', fontSize: 10.5, fontWeight: 700, color: 'var(--text-3)', display: 'flex', alignItems: 'center', paddingLeft: 6 }}>{m.label}</div>)}
            </div>
          </div>
          {/* rows */}
          {withDates.map((r) => {
            const s0 = r.startDate || r.endDate, e0 = r.endDate || r.startDate;
            const left = x(s0), width = Math.max(pxDay, x(e0) - left + pxDay);
            const prog = Math.max(0, Math.min(100, Number(r.progress) || 0));
            return (
              <div key={r.id} onClick={() => openDetail(r)} style={{ display: 'flex', height: 40, borderBottom: '1px solid var(--border)', cursor: 'pointer' }} className="gt-row">
                <div style={{ width: LBL, flexShrink: 0, borderRight: '1px solid var(--border)', padding: '0 14px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                  <div style={{ fontSize: 12.5, fontWeight: 650, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name || r.title}</div>
                  <div style={{ fontSize: 10.5, color: 'var(--text-3)' }}>{r.assignee || '—'} · {r.code}</div>
                </div>
                <div style={{ position: 'relative', width: W }}>
                  {months.map((m, i) => <div key={i} style={{ position: 'absolute', left: m.left, top: 0, bottom: 0, borderLeft: '1px solid var(--surface-3)' }} />)}
                  {showToday && <div style={{ position: 'absolute', left: todayLeft, top: 0, bottom: 0, width: 2, background: 'rgba(190,85,53,.45)' }} />}
                  <div title={`${s0} ~ ${e0} · ${prog}%`} style={{ position: 'absolute', left, width, top: 9, height: 22, borderRadius: 7, background: 'var(--surface-3)', border: `1px solid ${color(r.status)}33`, overflow: 'hidden', boxShadow: 'var(--sh-sm)' }}>
                    <div style={{ width: `${prog}%`, height: '100%', background: color(r.status), opacity: .9 }} />
                    <span style={{ position: 'absolute', left: 8, top: 0, height: '100%', display: 'flex', alignItems: 'center', fontSize: 10.5, fontWeight: 700, color: prog > 50 ? '#fff' : 'var(--text-2)' }}>{prog}%</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ---- Calendar (month) view: items placed on their date ----
import { useState as _useState } from 'react';
export function CalendarView({ rows, dateKey, openDetail }: { rows: any[]; dateKey: string; openDetail: (r: any) => void }) {
  const [cur, setCur] = _useState(() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() }; });
  const first = new Date(cur.y, cur.m, 1);
  const startDow = first.getDay();
  const days = new Date(cur.y, cur.m + 1, 0).getDate();
  const cells: (number | null)[] = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= days; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  const ymd = (d: number) => `${cur.y}-${String(cur.m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const itemsOn = (d: number) => rows.filter((r) => (r[dateKey] || '').slice(0, 10) === ymd(d));
  const today = new Date();
  const isToday = (d: number) => today.getFullYear() === cur.y && today.getMonth() === cur.m && today.getDate() === d;
  const move = (n: number) => { let m = cur.m + n, y = cur.y; if (m < 0) { m = 11; y--; } if (m > 11) { m = 0; y++; } setCur({ y, m }); };
  return (
    <div className="card card-pad">
      <div className="row" style={{ marginBottom: 12 }}>
        <div className="sect">{cur.y}년 {cur.m + 1}월</div><div className="sp" />
        <button className="btn btn-sm" onClick={() => move(-1)}>‹</button>
        <button className="btn btn-sm" onClick={() => setCur({ y: today.getFullYear(), m: today.getMonth() })}>오늘</button>
        <button className="btn btn-sm" onClick={() => move(1)}>›</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 1, background: 'var(--border)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
        {['일','월','화','수','목','금','토'].map((w) => <div key={w} style={{ background: 'var(--surface-2)', textAlign: 'center', padding: '7px 0', fontSize: 11.5, fontWeight: 700, color: 'var(--text-3)' }}>{w}</div>)}
        {cells.map((d, i) => (
          <div key={i} style={{ background: 'var(--surface)', minHeight: 92, padding: 6, opacity: d ? 1 : 0.4 }}>
            {d && <div style={{ fontSize: 11.5, fontWeight: 700, color: isToday(d) ? '#fff' : 'var(--text-2)', background: isToday(d) ? 'var(--brand)' : 'transparent', width: 20, height: 20, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{d}</div>}
            {d && itemsOn(d).slice(0, 3).map((r) => (
              <div key={r.id} onClick={() => openDetail(r)} title={r.title || r.name} style={{ marginTop: 3, fontSize: 10.5, fontWeight: 600, background: 'var(--brand-50)', color: 'var(--brand-600)', borderRadius: 5, padding: '2px 5px', cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.title || r.name}</div>
            ))}
            {d && itemsOn(d).length > 3 && <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 2 }}>+{itemsOn(d).length - 3}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}
