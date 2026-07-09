'use client';
import { useState, useEffect, useRef } from 'react';
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

// ---- Modern Gantt (zoom / weekends / dependencies / milestones / progress-drag) ----
export function Gantt({ rows, openDetail, save, create }: { rows: any[]; openDetail: (r: any) => void; save?: (id: number, patch: any) => Promise<void>; create?: (body: any) => Promise<boolean> }) {
  const DAY = 86400000;
  const fmt = (ms: number) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const todayMid = (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); })();
  const [drag, setDrag] = useState<any>(null);
  const [preview, setPreview] = useState<Record<number, { s: number; e: number }>>({});
  const [progPrev, setProgPrev] = useState<Record<number, number>>({});
  const [nsel, setNsel] = useState<any>(null);
  const [zoom, setZoom] = useState<'day' | 'week' | 'month'>('week');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [grouped, setGrouped] = useState(true);
  const [link, setLink] = useState<any>(null);
  const previewRef = useRef(preview); previewRef.current = preview;
  const progRef = useRef(progPrev); progRef.current = progPrev;
  const dragRef = useRef(drag); dragRef.current = drag;
  const nselRef = useRef(nsel); nselRef.current = nsel;
  const linkRef = useRef(link); linkRef.current = link;
  const linkTargetRef = useRef<any>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  const eff = (t: any) => {
    const pv = preview[t.id];
    if (pv) return { s: pv.s, e: pv.e, planned: true };
    const s = t.startDate ? new Date(t.startDate).getTime() : null;
    const e = t.endDate ? new Date(t.endDate).getTime() : null;
    if (s && e) return { s, e, planned: true };
    if (s && !e) return { s, e: s + 2 * DAY, planned: true };
    if (!s && e) return { s: e - 2 * DAY, e, planned: true };
    return { s: todayMid, e: todayMid + 2 * DAY, planned: false };
  };
  const progOf = (t: any) => progPrev[t.id] ?? Math.max(0, Math.min(100, Number(t.progress) || 0));

  const rangeMs = rows.flatMap((r) => {
    const s = r.startDate ? new Date(r.startDate).getTime() : todayMid;
    const e = r.endDate ? new Date(r.endDate).getTime() : (r.startDate ? new Date(r.startDate).getTime() + 2 * DAY : todayMid + 2 * DAY);
    return [s, e];
  }).concat([todayMid]);
  let min = rows.length ? Math.min(...rangeMs) : todayMid, max = rows.length ? Math.max(...rangeMs) : todayMid + 30 * DAY;
  min -= 5 * DAY; max += 5 * DAY;
  const totalDays = Math.max(14, Math.round((max - min) / DAY));
  const pxDay = zoom === 'day' ? 26 : zoom === 'week' ? 11 : 4.6;
  const W = totalDays * pxDay;
  const LBL = 220, rowH = 40;
  const color = (st: string) => st === 'done' ? '#2f8f5b' : st === 'doing' ? '#be5535' : '#94a3b8';
  const xOf = (ms: number) => ((ms - min) / DAY) * pxDay;

  useEffect(() => {
    if (!drag) return;
    function onMove(ev: MouseEvent) {
      const d = dragRef.current; if (!d) return;
      if (d.mode === 'p') { const np = Math.max(0, Math.min(100, Math.round((d.p0 + ((ev.clientX - d.startX) / d.barW) * 100) / 5) * 5)); setProgPrev((p) => ({ ...p, [d.id]: np })); return; }
      const dd = Math.round((ev.clientX - d.startX) / pxDay);
      let s = d.s0, e = d.e0;
      if (d.mode === 'move') { s += dd * DAY; e += dd * DAY; }
      else if (d.mode === 'l') { s = Math.min(d.e0 - DAY, d.s0 + dd * DAY); }
      else if (d.mode === 'r') { e = Math.max(d.s0 + DAY, d.e0 + dd * DAY); }
      setPreview((p) => ({ ...p, [d.id]: { s, e } }));
    }
    async function onUp(ev: MouseEvent) {
      const d = dragRef.current; setDrag(null);
      if (!d) return;
      if (d.mode === 'p') { const np = progRef.current[d.id]; if (np != null && save) await save(d.id, { progress: np }); setProgPrev({}); return; }
      let pv = previewRef.current[d.id];
      if (!pv) { const dd = Math.round((ev.clientX - d.startX) / pxDay); if (dd !== 0) { let s = d.s0, e = d.e0; if (d.mode === 'move') { s += dd * DAY; e += dd * DAY; } else if (d.mode === 'l') { s = Math.min(d.e0 - DAY, d.s0 + dd * DAY); } else if (d.mode === 'r') { e = Math.max(d.s0 + DAY, d.e0 + dd * DAY); } pv = { s, e }; } }
      if (pv && save) await save(d.id, { startDate: fmt(pv.s), endDate: fmt(pv.e) });
      setPreview({});
    }
    window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    // eslint-disable-next-line
  }, [drag, pxDay]);

  useEffect(() => {
    if (!nsel) return;
    function mv(ev: MouseEvent) { const n = nselRef.current; if (!n) return; setNsel({ ...n, x1: ev.clientX }); }
    async function up(ev: MouseEvent) {
      const n = nselRef.current; setNsel(null);
      if (!n || !create) return;
      const a = Math.min(n.x0, ev.clientX) - n.baseLeft, b = Math.max(n.x0, ev.clientX) - n.baseLeft;
      if (b - a < 6) return;
      const di0 = Math.round(a / pxDay), di1 = Math.max(di0 + 1, Math.round(b / pxDay));
      const s = min + di0 * DAY, e = min + di1 * DAY;
      const name = window.prompt('새 작업 이름을 입력하세요');
      if (name && name.trim()) await create({ name: name.trim(), status: 'todo', startDate: fmt(s), endDate: fmt(e) });
    }
    window.addEventListener('mousemove', mv); window.addEventListener('mouseup', up);
    return () => { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); };
    // eslint-disable-next-line
  }, [nsel, pxDay, min]);

  useEffect(() => {
    if (!link) return;
    function mv(ev: MouseEvent) { const l = linkRef.current; if (!l) return; setLink({ ...l, x1: ev.clientX - l.baseLeft, y1: ev.clientY - l.baseTop }); }
    async function up() {
      const l = linkRef.current; const tgt = linkTargetRef.current; setLink(null); linkTargetRef.current = null;
      if (!l || !save || !tgt) return;
      if (tgt.id === l.fromId || tgt.code === l.fromCode) return;
      await save(tgt.id, { predecessor: l.fromCode });
    }
    window.addEventListener('mousemove', mv); window.addEventListener('mouseup', up);
    return () => { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); };
    // eslint-disable-next-line
  }, [link]);

  function startDrag(e: React.MouseEvent, t: any, mode: 'move' | 'l' | 'r' | 'p', barW?: number) {
    if (!save) return; e.stopPropagation(); e.preventDefault();
    const x = eff(t);
    setDrag({ id: t.id, mode, startX: e.clientX, s0: x.s, e0: x.e, p0: progOf(t), barW: barW || 1 });
  }
  function startCreate(e: React.MouseEvent) {
    if (!create) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setNsel({ baseLeft: rect.left, x0: e.clientX, x1: e.clientX });
  }
  function startLink(e: React.MouseEvent, t: any) {
    if (!save) return; e.stopPropagation(); e.preventDefault();
    const rect = bodyRef.current?.getBoundingClientRect();
    const g = geo[t.code];
    const x0 = g ? g.right : 0, y0 = g ? g.mid : 0;
    linkTargetRef.current = null;
    setLink({ fromId: t.id, fromCode: t.code, baseLeft: (rect?.left || 0) + LBL, baseTop: rect?.top || 0, x0, y0, x1: x0, y1: y0 });
  }

  if (rows.length === 0) return <div className="card card-pad muted">작업이 없습니다. “새로 만들기”로 작업을 추가하거나, 하단 타임라인 행을 드래그해 작업을 그려 계획하세요.</div>;

  const months: { label: string; left: number; width: number }[] = [];
  let cur = new Date(min); cur.setDate(1); cur.setHours(0, 0, 0, 0);
  while (cur.getTime() <= max) {
    const next = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
    const l = Math.max(0, xOf(cur.getTime())); const r = Math.min(W, xOf(next.getTime()));
    months.push({ label: `${cur.getFullYear()}.${cur.getMonth() + 1}`, left: l, width: Math.max(0, r - l) });
    cur = next;
  }
  const weekends: number[] = [];
  if (pxDay >= 6) { let c = new Date(min); c.setHours(0, 0, 0, 0); while (c.getTime() <= max) { const dow = c.getDay(); if (dow === 0 || dow === 6) weekends.push(xOf(c.getTime())); c = new Date(c.getTime() + DAY); } }
  const todayLeft = xOf(todayMid);

  // ---- swimlane grouping by phase (단계별 스윔레인 + 접기/펼치기) ----
  const groupKey = (r: any) => ((r.phase || '').trim() || '__none');
  const groupOrder: string[] = [];
  const groups: Record<string, any[]> = {};
  rows.forEach((r) => { const g = groupKey(r); if (!groups[g]) { groups[g] = []; groupOrder.push(g); } groups[g].push(r); });
  const useGroups = grouped && groupOrder.length > 1 && groupOrder.some((g) => g !== '__none');
  const gColor = (g: string) => { if (g === '__none') return '#94a3b8'; let h = 0; for (let i = 0; i < g.length; i++) h = (h * 31 + g.charCodeAt(i)) % 360; return `hsl(${h},52%,52%)`; };
  const gLabel = (g: string) => (g === '__none' ? '단계 미지정' : g);
  type DispRow = { kind: 'group'; key: string; y: number } | { kind: 'task'; r: any; y: number };
  const disp: DispRow[] = [];
  let yAcc = 0;
  if (useGroups) {
    groupOrder.forEach((g) => {
      disp.push({ kind: 'group', key: g, y: yAcc }); yAcc += rowH;
      if (!collapsed[g]) groups[g].forEach((r) => { disp.push({ kind: 'task', r, y: yAcc }); yAcc += rowH; });
    });
  } else {
    rows.forEach((r) => { disp.push({ kind: 'task', r, y: yAcc }); yAcc += rowH; });
  }
  const bodyH = Math.max(rowH, yAcc);
  // geometry for dependency arrows (visible tasks only)
  const geo: Record<string, { left: number; right: number; mid: number }> = {};
  disp.forEach((d) => { if (d.kind === 'task') { const x = eff(d.r); geo[d.r.code] = { left: xOf(x.s), right: xOf(x.e), mid: d.y + rowH / 2 }; } });
  // CPM
  const byCode: Record<string, any> = {}; rows.forEach((r) => { byCode[r.code] = r; });
  const durOf = (r: any) => { const x = eff(r); return Math.max(1, Math.round((x.e - x.s) / DAY)); };
  const predsOf = (r: any) => (r.predecessor && byCode[r.predecessor] && byCode[r.predecessor] !== r) ? [byCode[r.predecessor]] : [];
  const succOf: Record<string, any[]> = {};
  rows.forEach((r) => predsOf(r).forEach((p) => { (succOf[p.code] ||= []).push(r); }));
  const ES: Record<string, number> = {}, EF: Record<string, number> = {};
  const calcEF = (r: any, seen: Set<string>): number => {
    if (EF[r.code] != null) return EF[r.code];
    if (seen.has(r.code)) return 0; seen.add(r.code);
    const ps = predsOf(r); const es = ps.length ? Math.max(...ps.map((p) => calcEF(p, seen))) : 0;
    seen.delete(r.code); ES[r.code] = es; EF[r.code] = es + durOf(r); return EF[r.code];
  };
  rows.forEach((r) => calcEF(r, new Set()));
  const projEnd = rows.length ? Math.max(...rows.map((r) => EF[r.code] ?? 0)) : 0;
  const LS: Record<string, number> = {}, LF: Record<string, number> = {};
  const calcLS = (r: any, seen: Set<string>): number => {
    if (LS[r.code] != null) return LS[r.code];
    if (seen.has(r.code)) return projEnd - durOf(r); seen.add(r.code);
    const ss = succOf[r.code] || []; const lf = ss.length ? Math.min(...ss.map((s) => calcLS(s, seen))) : projEnd;
    seen.delete(r.code); LF[r.code] = lf; LS[r.code] = lf - durOf(r); return LS[r.code];
  };
  rows.forEach((r) => calcLS(r, new Set()));
  const slackOf = (code: string) => (LS[code] ?? 0) - (ES[code] ?? 0);
  const critical = new Set<string>();
  rows.forEach((r) => { if (predsOf(r).length || (succOf[r.code] || []).length) { if (Math.abs(slackOf(r.code)) < 0.5) critical.add(r.code); } });
  if (critical.size <= 1) critical.clear();
  const critOverdue = rows.filter((r) => critical.has(r.code) && r.status !== 'done' && eff(r).planned && eff(r).e < todayMid).length;
  const arrows: { x1: number; y1: number; x2: number; y2: number; crit: boolean }[] = [];
  rows.forEach((r) => { if (r.predecessor && geo[r.predecessor] && geo[r.code]) { const p = geo[r.predecessor], t = geo[r.code]; arrows.push({ x1: p.right, y1: p.mid, x2: t.left, y2: t.mid, crit: critical.has(r.code) && critical.has(r.predecessor) }); } });

  const Zb = ({ z, l }: { z: any; l: string }) => <button className={`btn btn-sm ${zoom === z ? 'btn-pri' : ''}`} onClick={() => setZoom(z)} style={{ padding: '3px 10px' }}>{l}</button>;

  return (
    <div className="card" style={{ overflow: 'hidden' }}>
      <div className="row" style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', gap: 8, flexWrap: 'wrap' }}>
        <div className="sect" style={{ margin: 0 }}>간트차트 · 일정 계획</div>
        <div style={{ display: 'flex', gap: 4, marginLeft: 8 }}><Zb z="day" l="일" /><Zb z="week" l="주" /><Zb z="month" l="월" /></div>
        {groupOrder.length > 1 && <button className={`btn btn-sm ${grouped ? 'btn-pri' : ''}`} onClick={() => setGrouped((g) => !g)} style={{ padding: '3px 10px' }} title="단계(phase)별로 작업을 묶어 스윔레인으로 표시하고 접기/펼치기">단계 묶기</button>}
        {critical.size > 1 && (<span title="선행관계 기반 임계경로(여유 0일) 작업 수" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, fontWeight: 700, color: '#c0414f', background: '#fdedef', border: '1px solid #f3c7cd', borderRadius: 20, padding: '2px 10px' }}><span style={{ width: 8, height: 8, borderRadius: 8, background: '#c0414f' }} />주경로 {critical.size}개{critOverdue > 0 ? ` · 지연 ${critOverdue}` : ''}</span>)}
        <div className="sp" />
        <span className="muted" style={{ fontSize: 11 }}>막대=이동 · 양끝=기간 · 아래손잡이=진척 · <span style={{ color: 'var(--brand)', fontWeight: 700 }}>우측●=선행연결</span> · 하단행=새 작업 · 자동저장 · <span style={{ color: '#c0414f', fontWeight: 700 }}>▭ 주경로</span> · <span style={{ color: 'var(--text-3)', fontWeight: 700 }}>▬ 기준선(계획)</span></span>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <div style={{ minWidth: LBL + W, userSelect: (drag || nsel) ? 'none' : 'auto' }}>
          <div style={{ display: 'flex', height: 30, borderBottom: '1px solid var(--border)', position: 'sticky', top: 0, background: 'var(--surface)', zIndex: 3 }}>
            <div style={{ width: LBL, flexShrink: 0, borderRight: '1px solid var(--border)', display: 'flex', alignItems: 'center', padding: '0 14px', fontSize: 11.5, fontWeight: 700, color: 'var(--text-3)' }}>작업 (WBS)</div>
            <div style={{ position: 'relative', width: W }}>
              {months.map((m, i) => <div key={i} style={{ position: 'absolute', left: m.left, width: m.width, top: 0, height: 30, borderLeft: '1px solid var(--border)', fontSize: 10.5, fontWeight: 700, color: 'var(--text-3)', display: 'flex', alignItems: 'center', paddingLeft: 6 }}>{m.label}</div>)}
            </div>
          </div>
          <div ref={bodyRef} style={{ position: 'relative' }}>
            <div style={{ position: 'absolute', left: LBL, top: 0, width: W, height: bodyH, pointerEvents: 'none' }}>
              {weekends.map((x, i) => <div key={'w' + i} style={{ position: 'absolute', left: x, width: pxDay, top: 0, height: bodyH, background: 'rgba(30,20,10,.035)' }} />)}
              {months.map((m, i) => <div key={'g' + i} style={{ position: 'absolute', left: m.left, top: 0, height: bodyH, borderLeft: '1px solid var(--surface-3)' }} />)}
              {todayMid >= min && todayMid <= max && <div style={{ position: 'absolute', left: todayLeft, top: 0, height: bodyH, width: 2, background: 'rgba(190,85,53,.5)' }} />}
            </div>
            {disp.map((d) => {
              if (d.kind === 'group') {
                const gr = groups[d.key];
                const spans = gr.map(eff);
                const gs = Math.min(...spans.map((z) => z.s)), ge = Math.max(...spans.map((z) => z.e));
                const gLeft = xOf(gs), gW = Math.max(pxDay, xOf(ge) - xOf(gs));
                const isCol = !!collapsed[d.key];
                return (
                  <div key={'g_' + d.key} style={{ display: 'flex', height: rowH, borderBottom: '1px solid var(--border)', background: 'var(--surface-2)' }} className="gt-grp">
                    <div onClick={() => setCollapsed((c) => ({ ...c, [d.key]: !c[d.key] }))} title={isCol ? '펼치기' : '접기'} style={{ width: LBL, flexShrink: 0, borderRight: '1px solid var(--border)', padding: '0 12px', display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer', fontWeight: 750, fontSize: 12.5 }}>
                      <span style={{ display: 'inline-block', width: 12, textAlign: 'center', transition: 'transform .15s', transform: isCol ? 'rotate(-90deg)' : 'none', color: 'var(--text-3)' }}>▾</span>
                      <span style={{ width: 9, height: 9, borderRadius: 9, background: gColor(d.key), flexShrink: 0 }} />
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{gLabel(d.key)}</span>
                      <span className="muted" style={{ fontWeight: 600, fontSize: 11 }}>{gr.length}</span>
                    </div>
                    <div style={{ position: 'relative', width: W }}>
                      <div title={`${fmt(gs)} ~ ${fmt(ge)}`} style={{ position: 'absolute', left: gLeft, width: gW, top: rowH / 2 - 4, height: 8, borderRadius: 6, background: gColor(d.key), opacity: 0.28 }} />
                    </div>
                  </div>
                );
              }
              const r = d.r;
              const x = eff(r);
              const isMs = Math.abs(x.e - x.s) < DAY * 0.6;
              const left = xOf(x.s), width = Math.max(pxDay, xOf(x.e) - xOf(x.s));
              const prog = progOf(r);
              const isDragging = drag && drag.id === r.id;
              const overdue = x.planned && r.status !== 'done' && x.e < todayMid;
              const isCrit = critical.size > 1 && critical.has(r.code);
              const initial = (r.assignee || '').trim().charAt(0);
              const bs = r.baselineStart ? new Date(r.baselineStart).getTime() : null;
              const be = r.baselineEnd ? new Date(r.baselineEnd).getTime() : null;
              const hasBase = bs != null && be != null && be >= bs;
              const bLeft = hasBase ? xOf(bs as number) : 0, bWidth = hasBase ? Math.max(pxDay, xOf(be as number) - xOf(bs as number)) : 0;
              const slipDays = hasBase ? Math.round((x.e - (be as number)) / DAY) : 0;
              return (
                <div key={r.id} style={{ display: 'flex', height: rowH, borderBottom: '1px solid var(--border)' }} className="gt-row">
                  <div onClick={() => openDetail(r)} style={{ width: LBL, flexShrink: 0, borderRight: '1px solid var(--border)', padding: '0 14px', display: 'flex', flexDirection: 'column', justifyContent: 'center', cursor: 'pointer' }}>
                    <div style={{ fontSize: 12.5, fontWeight: 650, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name || r.title}{r.predecessor && <span className="muted" style={{ fontWeight: 500, fontSize: 10.5 }}> ← {r.predecessor}</span>}</div>
                    <div style={{ fontSize: 10.5, color: 'var(--text-3)' }}>{r.assignee || '—'} · {r.code}</div>
                  </div>
                  <div style={{ position: 'relative', width: W }}>
                    {hasBase && <div title={`기준선(계획) ${fmt(bs as number)} ~ ${fmt(be as number)} · ${slipDays > 0 ? `${slipDays}일 지연` : slipDays < 0 ? `${-slipDays}일 단축` : '계획대로'}`} style={{ position: 'absolute', left: bLeft, width: bWidth, top: rowH / 2 + 9, height: 4, borderRadius: 3, background: slipDays > 0 ? '#c0414f' : 'var(--text-4)', opacity: slipDays > 0 ? 0.5 : 0.38 }} />}
                    {isMs ? (
                      <div onMouseDown={(e) => startDrag(e, r, 'move')} onMouseEnter={() => { if (linkRef.current) linkTargetRef.current = r; }} onMouseLeave={() => { if (linkTargetRef.current === r) linkTargetRef.current = null; }} title={`마일스톤 · ${fmt(x.s)}`} style={{ position: 'absolute', left: left - 9, top: rowH / 2 - 9, width: 18, height: 18, background: color(r.status), transform: 'rotate(45deg)', borderRadius: 3, cursor: save ? 'grab' : 'pointer', boxShadow: 'var(--sh-sm)' }} />
                    ) : (
                      <div onMouseDown={(e) => startDrag(e, r, 'move')} onMouseEnter={() => { if (linkRef.current) linkTargetRef.current = r; }} onMouseLeave={() => { if (linkTargetRef.current === r) linkTargetRef.current = null; }} title={`${fmt(x.s)} ~ ${fmt(x.e)} · ${prog}%${isCrit ? ' · 주경로' : ''}${x.planned ? '' : ' · 드래그하여 계획'}`}
                        style={{ position: 'absolute', left, width, top: 9, height: 22, borderRadius: 7, background: x.planned ? 'var(--surface-3)' : 'transparent', border: `1.5px ${x.planned ? 'solid' : 'dashed'} ${overdue ? '#c0414f' : color(r.status) + (x.planned ? '55' : '99')}`, overflow: 'visible', boxShadow: isCrit ? '0 0 0 2px #c0414f66, var(--sh-sm)' : (isDragging ? 'var(--sh-md)' : 'var(--sh-sm)'), cursor: save ? 'grab' : 'pointer', opacity: x.planned ? 1 : .75, transition: isDragging ? 'none' : 'box-shadow .15s' }}>
                        <div style={{ width: `${prog}%`, height: '100%', background: color(r.status), opacity: .9, borderRadius: 6 }} />
                        <span style={{ position: 'absolute', left: 8, top: 0, height: '100%', display: 'flex', alignItems: 'center', fontSize: 10.5, fontWeight: 700, color: prog > 50 ? '#fff' : 'var(--text-2)', pointerEvents: 'none' }}>{x.planned ? `${prog}%` : '계획'}</span>
                        {initial && <span style={{ position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)', width: 15, height: 15, borderRadius: 9, background: '#fff', color: color(r.status), fontSize: 8.5, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', border: `1px solid ${color(r.status)}`, pointerEvents: 'none' }}>{initial}</span>}
                        {save && <>
                          <span onMouseDown={(e) => startDrag(e, r, 'l')} style={{ position: 'absolute', left: -1, top: 0, height: '100%', width: 9, cursor: 'ew-resize' }} />
                          <span onMouseDown={(e) => startDrag(e, r, 'r')} style={{ position: 'absolute', right: -1, top: 0, height: '100%', width: 9, cursor: 'ew-resize' }} />
                          <span onMouseDown={(e) => startDrag(e, r, 'p', width)} title="진척 조정" style={{ position: 'absolute', left: `calc(${prog}% - 5px)`, bottom: -5, width: 10, height: 10, borderRadius: 10, background: '#fff', border: `2px solid ${color(r.status)}`, cursor: 'ew-resize', boxShadow: 'var(--sh-sm)' }} />
                          <span onMouseDown={(e) => startLink(e, r)} title="드래그해 다른 작업 위에 놓으면 선행(의존) 관계로 연결됩니다" style={{ position: 'absolute', right: -15, top: '50%', transform: 'translateY(-50%)', width: 11, height: 11, borderRadius: 11, background: 'var(--brand)', border: '2px solid #fff', cursor: 'crosshair', boxShadow: 'var(--sh-sm)', opacity: link ? 0.35 : 0.85 }} />
                        </>}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
            <svg style={{ position: 'absolute', left: LBL, top: 0, width: W, height: bodyH, pointerEvents: 'none', overflow: 'visible' }}>
              <defs><marker id="gtar" markerWidth="7" markerHeight="7" refX="5" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 Z" fill="var(--text-4)" /></marker><marker id="gtarC" markerWidth="7" markerHeight="7" refX="5" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 Z" fill="#c0414f" /></marker></defs>
              {arrows.map((a, i) => { return <path key={i} d={`M ${a.x1} ${a.y1} C ${a.x1 + 16} ${a.y1}, ${a.x2 - 16} ${a.y2}, ${a.x2} ${a.y2}`} fill="none" stroke={a.crit ? '#c0414f' : 'var(--text-4)'} strokeWidth={a.crit ? 1.9 : 1.3} markerEnd={a.crit ? 'url(#gtarC)' : 'url(#gtar)'} opacity={a.crit ? 0.95 : 0.75} />; })}
              {link && <path d={`M ${link.x0} ${link.y0} C ${link.x0 + 16} ${link.y0}, ${link.x1 - 16} ${link.y1}, ${link.x1} ${link.y1}`} fill="none" stroke="var(--brand)" strokeWidth={2} strokeDasharray="4 3" markerEnd="url(#gtar)" opacity={0.9} />}
            </svg>
          </div>
          {create && (
            <div style={{ display: 'flex', height: 38, borderTop: '2px dashed var(--border)', background: 'var(--surface-2)' }}>
              <div style={{ width: LBL, flexShrink: 0, borderRight: '1px solid var(--border)', display: 'flex', alignItems: 'center', padding: '0 14px', fontSize: 12, fontWeight: 700, color: 'var(--brand)' }}>+ 새 작업 (드래그)</div>
              <div onMouseDown={startCreate} style={{ position: 'relative', width: W, cursor: 'crosshair' }}>
                {nsel && (() => { const l = Math.min(nsel.x0, nsel.x1) - nsel.baseLeft; const w = Math.abs(nsel.x1 - nsel.x0); return <div style={{ position: 'absolute', left: l, width: w, top: 8, height: 22, borderRadius: 7, background: 'var(--brand-50)', border: '1.5px solid var(--brand)' }} />; })()}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function CalendarView({ rows, dateKey, openDetail }: { rows: any[]; dateKey: string; openDetail: (r: any) => void }) {
  const [cur, setCur] = useState(() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() }; });
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
  const monthPrefix = `${cur.y}-${String(cur.m + 1).padStart(2, '0')}`;
  const monthCount = rows.filter((r) => (r[dateKey] || '').slice(0, 7) === monthPrefix).length;
  const dowColor = (i: number) => i === 0 ? '#c0414f' : i === 6 ? '#3b6fb0' : 'var(--text-3)';
  return (
    <div className="card card-pad">
      <div className="row" style={{ marginBottom: 12 }}>
        <div className="sect">{cur.y}년 {cur.m + 1}월</div>
        {monthCount > 0 && <span className="muted" style={{ fontSize: 11.5, fontWeight: 600, marginLeft: 8 }} title="이번 달 표시 일정 건수">이번 달 {monthCount}건</span>}
        <div className="sp" />
        <button className="btn btn-sm" onClick={() => move(-1)}>‹</button>
        <button className="btn btn-sm" onClick={() => setCur({ y: today.getFullYear(), m: today.getMonth() })}>오늘</button>
        <button className="btn btn-sm" onClick={() => move(1)}>›</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 1, background: 'var(--border)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
        {['일','월','화','수','목','금','토'].map((w, i) => <div key={w} style={{ background: 'var(--surface-2)', textAlign: 'center', padding: '7px 0', fontSize: 11.5, fontWeight: 700, color: dowColor(i) }}>{w}</div>)}
        {cells.map((d, i) => (
          <div key={i} style={{ background: (i % 7 === 0 || i % 7 === 6) ? 'var(--surface-2)' : 'var(--surface)', minHeight: 92, padding: 6, opacity: d ? 1 : 0.4 }}>
            {d && <div style={{ fontSize: 11.5, fontWeight: 700, color: isToday(d) ? '#fff' : (i % 7 === 0 || i % 7 === 6) ? dowColor(i % 7) : 'var(--text-2)', background: isToday(d) ? 'var(--brand)' : 'transparent', width: 20, height: 20, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{d}</div>}
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
