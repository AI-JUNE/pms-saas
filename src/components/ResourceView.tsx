'use client';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Plus, Search, X, Pencil, Trash2, Inbox, SlidersHorizontal, Download, Sheet, ChevronUp, ChevronDown } from 'lucide-react';
import { Shell } from './Shell';
import { Pill, LABEL } from '@/lib/ui';
import { Comments } from './Comments';

export type Col = { key: string; label: string; badge?: boolean; strong?: boolean; mono?: boolean; render?: (v: any, row: any) => any };
type Opt = string | { value: string; label: string };
const STATUS_COLOR: Record<string, string> = {
  done: '#2f8f5b', approved: '#2f8f5b', resolved: '#2f8f5b', completed: '#2f8f5b', pass: '#2f8f5b', low: '#2f8f5b',
  closed: '#94a3b8', draft: '#94a3b8', planned: '#94a3b8', todo: '#94a3b8', na: '#94a3b8',
  open: '#0e9bb8', in_progress: '#0e9bb8', review: '#0e9bb8', dev: '#0e9bb8',
  doing: '#be5535', requested: '#be5535',
  identified: '#d98a16', mitigating: '#d98a16', medium: '#d98a16', pl: '#d98a16', ordered: '#d98a16',
  high: '#c0414f', critical: '#c0414f', rejected: '#c0414f', fail: '#c0414f', blocked: '#c0414f',
  pm: '#7c4dff',
};
export type Field = { key: string; label: string; type?: 'text'|'textarea'|'number'|'date'|'select'|'combo'; options?: Opt[]; required?: boolean; half?: boolean; numeric?: boolean; hint?: string; placeholder?: string; optionsFrom?: 'members' | 'tasks' };
export type AltView = { key: string; label: string; icon?: any; render: (rows: any[], openDetail: (r: any) => void, save: (id: number, patch: any) => Promise<void>, create: (body: any) => Promise<boolean>) => any };
type Props = { title: string; subtitle?: string; endpoint: string; projectScoped?: boolean; columns: Col[]; fields: Field[]; statusKey?: string; altViews?: AltView[]; entity?: string; rowHref?: (row: any) => string; emptyText?: string; treeKey?: string };

const GROUPABLE = ['status','priority','type','assignee','epic','level','category','role'];
// 문자열 옵션은 목록 배지와 동일하게 LABEL(한글)로 표시하되 value는 원본 코드를 유지
const normOpt = (o: any) => (typeof o === 'string' ? { value: o, label: LABEL[o] || o } : o);

export function ResourceView({ title, subtitle, endpoint, projectScoped, columns, fields, statusKey = 'status', altViews = [], entity, rowHref, emptyText, treeKey }: Props) {
  const router = useRouter();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [pid, setPid] = useState<number | null>(null);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('');
  const [sortK, setSortK] = useState('id');
  const [sortDir, setSortDir] = useState<1 | -1>(-1);
  const [groupBy, setGroupBy] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggleGroup = (g: string) => setCollapsed((p) => { const n = new Set(p); n.has(g) ? n.delete(g) : n.add(g); return n; });
  const [detail, setDetail] = useState<any>(null);
  const [memberOpts, setMemberOpts] = useState<string[]>([]);
  const taskOpts = useMemo<Opt[]>(() => rows.map((r: any) => ({ value: String(r.id), label: (r.code ? `[${r.code}] ` : '') + (r.name || r.title || ('#' + r.id)) })), [rows]);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [editCell, setEditCell] = useState<{ id: number; key: string } | null>(null);
  const [quickText, setQuickText] = useState('');
  const primaryField = (fields.find((f) => f.required)?.key) || fields[0]?.key;
  const toggleSel = (id: number) => setSel((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState<any>({});
  const [err, setErr] = useState('');
  const [mode, setMode] = useState('table');
  const [density, setDensity] = useState<'comfort' | 'compact'>('comfort');
  useEffect(() => { const d = localStorage.getItem('pms.density'); if (d === 'compact' || d === 'comfort') setDensity(d); }, []);
  function toggleDensity() { setDensity((d) => { const n = d === 'compact' ? 'comfort' : 'compact'; localStorage.setItem('pms.density', n); return n; }); }
  const [hiddenCols, setHiddenCols] = useState<Set<string>>(new Set());
  const [colMenu, setColMenu] = useState(false);
  const [fullTag, setFullTag] = useState(false);
  useEffect(() => {
    try {
      const hc = localStorage.getItem('pms.cols.' + title);
      if (hc) setHiddenCols(new Set(JSON.parse(hc)));
      setFullTag(localStorage.getItem('pms.fulltag') === '1');
      const g = localStorage.getItem('pms.group.' + title);
      if (g !== null) setGroupBy(g);
      const s = localStorage.getItem('pms.sort.' + title);
      if (s) { const [sk, sd] = JSON.parse(s); if (sk) { setSortK(sk); setSortDir(sd === 1 ? 1 : -1); } }
    } catch {}
  }, [title]);
  function toggleCol(k: string) { setHiddenCols((p) => { const n = new Set(p); n.has(k) ? n.delete(k) : n.add(k); try { localStorage.setItem('pms.cols.' + title, JSON.stringify(Array.from(n))); } catch {} return n; }); }
  function toggleFullTag() { setFullTag((v) => { const n = !v; try { localStorage.setItem('pms.fulltag', n ? '1' : '0'); } catch {} return n; }); }
  const visibleColumns = useMemo(() => columns.filter((c) => !hiddenCols.has(c.key)), [columns, hiddenCols]);
  const swipeRef = useRef<{ y0: number; active: boolean }>({ y0: 0, active: false });
  const [swipeY, setSwipeY] = useState(0);
  useEffect(() => { setSwipeY(0); }, [detail]);
  function onOverTouchStart(e: React.TouchEvent) {
    const body = (e.currentTarget as HTMLElement).querySelector('.over-b') as HTMLElement | null;
    swipeRef.current = { y0: e.touches[0].clientY, active: !body || body.scrollTop <= 0 };
  }
  function onOverTouchMove(e: React.TouchEvent) {
    if (!swipeRef.current.active) return;
    const dy = e.touches[0].clientY - swipeRef.current.y0;
    setSwipeY(dy > 0 ? dy : 0);
  }
  function onOverTouchEnd() {
    if (swipeRef.current.active && swipeY > 90) setDetail(null);
    else setSwipeY(0);
    swipeRef.current.active = false;
  }

  async function load(p: number | null) {
    setLoading(true);
    const url = projectScoped && p ? `${endpoint}?projectId=${p}` : endpoint;
    const r = await fetch(url);
    if (r.status === 401) { router.push('/login'); return; }
    const d = await r.json(); setRows(Array.isArray(d) ? d : []); setLoading(false);
  }
  useEffect(() => { const p = projectScoped ? (Number(localStorage.getItem('pms.project')) || null) : null; setPid(p); load(p); /* eslint-disable-next-line */ }, []);
  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); setDetail(null); } };
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, []);
  useEffect(() => {
    if (fields.some((f) => f.optionsFrom === 'members')) {
      fetch('/api/members').then((r) => r.ok ? r.json() : []).then((d) => setMemberOpts((Array.isArray(d) ? d : []).map((m: any) => m.name).filter(Boolean)));
    }
    // eslint-disable-next-line
  }, []);

  const statuses = useMemo(() => Array.from(new Set(rows.map((r) => r[statusKey]).filter(Boolean))), [rows, statusKey]);
  const groupCols = useMemo(() => columns.filter((c) => GROUPABLE.includes(c.key)).map((c) => c.key), [columns]);
  const view = useMemo(() => {
    let v = rows;
    if (q) { const s = q.toLowerCase(); v = v.filter((r) => Object.values(r).some((x) => String(x ?? '').toLowerCase().includes(s))); }
    if (filter) v = v.filter((r) => r[statusKey] === filter);
    v = [...v].sort((a, b) => { const x = a[sortK], y = b[sortK]; if (x === y) return 0; return (x > y ? 1 : -1) * sortDir; });
    if (treeKey && !q && !filter) {
      const byId = new Map<any, any>(v.map((r) => [r.id, r]));
      const kids = new Map<any, any[]>(); const roots: any[] = [];
      for (const r of v) { const pid = r[treeKey]; if (pid && byId.has(pid)) { (kids.get(pid) || kids.set(pid, []).get(pid))!.push(r); } else roots.push(r); }
      const out: any[] = [];
      const walk = (node: any, depth: number, prefix: string) => { out.push({ ...node, __depth: depth, __wbs: prefix }); (kids.get(node.id) || []).forEach((c, i) => walk(c, depth + 1, prefix + '.' + (i + 1))); };
      roots.forEach((r, i) => walk(r, 0, String(i + 1)));
      return out;
    }
    return v;
  }, [rows, q, filter, sortK, sortDir, statusKey, treeKey]);

  const grouped = useMemo(() => {
    if (!groupBy) return null;
    const m = new Map<string, any[]>();
    for (const r of view) { const k = String(r[groupBy] ?? '—'); if (!m.has(k)) m.set(k, []); m.get(k)!.push(r); }
    return Array.from(m.entries());
  }, [view, groupBy]);

  function sort(k: string) { const nd: 1 | -1 = sortK === k ? (sortDir === 1 ? -1 : 1) : 1; setSortK(k); setSortDir(nd); try { localStorage.setItem('pms.sort.' + title, JSON.stringify([k, nd])); } catch {} }
  function openNew() { const f: any = {}; fields.forEach((x) => (f[x.key] = '')); setForm(f); setEditing(null); setErr(''); setOpen(true); }
  function openEdit(row: any) { const f: any = {}; fields.forEach((x) => (f[x.key] = row[x.key] ?? '')); setForm(f); setEditing(row); setErr(''); setOpen(true); }
  async function save(e: React.FormEvent) {
    e.preventDefault(); setErr('');
    const _ds = fields.filter((f) => f.type === 'date');
    const _sf = _ds.find((f) => /start|시작/i.test(f.key));
    const _ef = _ds.find((f) => /end|due|마감|종료|기한/i.test(f.key));
    if (_sf && _ef && form[_sf.key] && form[_ef.key] && form[_sf.key] > form[_ef.key]) { setErr('시작일이 마감일보다 늦을 수 없습니다.'); return; }
    const body: any = {};
    for (const f of fields) {
      const v = form[f.key];
      if (v === undefined || v === '') continue;            // empty -> use default/null
      body[f.key] = (f.type === 'number' || f.numeric) ? Number(v) : v;    // number fields as real numbers
    }
    if (projectScoped) { if (!pid) { setErr('먼저 상단에서 프로젝트를 선택하세요'); return; } body.projectId = pid; }
    const url = editing ? `${endpoint}/${editing.id}` : endpoint;
    const res = await fetch(url, { method: editing ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (res.ok) { setOpen(false); setDetail(null); load(pid); } else { const d = await res.json().catch(() => ({})); setErr(d.message || '저장 실패'); }
  }
  async function remove(row: any) {
    if (!confirm(`삭제하시겠습니까?\n${row.code || ''} ${row.title || row.name || ''}`)) return;
    const res = await fetch(`${endpoint}/${row.id}`, { method: 'DELETE' });
    if (res.ok) { setDetail(null); load(pid); }
  }
  async function quickStatus(row: any, status: string) {
    const res = await fetch(`${endpoint}/${row.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) });
    if (res.ok) { setDetail({ ...row, status }); load(pid); }
  }
  async function quickPatch(id: number, patch: any) {
    const res = await fetch(`${endpoint}/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
    if (res.ok) load(pid);
  }
  async function bulkStatus(status: string) {
    await Promise.all(Array.from(sel).map((id) => fetch(`${endpoint}/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) })));
    setSel(new Set()); load(pid);
  }
  async function bulkDelete() {
    if (!confirm(`${sel.size}건을 삭제하시겠습니까?`)) return;
    await Promise.all(Array.from(sel).map((id) => fetch(`${endpoint}/${id}`, { method: 'DELETE' })));
    setSel(new Set()); load(pid);
  }
  async function quickCreate(body: any) {
    const b: any = { ...body }; if (projectScoped) { if (!pid) return false; b.projectId = pid; }
    const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
    if (res.ok) load(pid);
    return res.ok;
  }
  function exportCsv() {
    const cols = columns.map((c) => c.key);
    const head = columns.map((c) => '"' + c.label + '"').join(',');
    const body = view.map((r) => cols.map((k) => '"' + String(r[k] ?? '').replace(/"/g, '""') + '"').join(',')).join('\n');
    const csv = '﻿' + head + '\n' + body;
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `${title}_${new Date().toISOString().slice(0,10)}.csv`; a.click();
  }

  function exportXlsx() {
    const esc = (v: string) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const head = '<tr>' + columns.map((c) => `<th style="background:#be5535;color:#fff;font-weight:bold;border:1px solid #d9c3b8;padding:7px 10px;text-align:left">${esc(c.label)}</th>`).join('') + '</tr>';
    const rows = view.map((r) => '<tr>' + columns.map((c) => `<td style="border:1px solid #e6ddd6;padding:6px 10px">${esc(String(r[c.key] ?? ''))}</td>`).join('') + '</tr>').join('');
    const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8"><!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet><x:Name>${title}</x:Name><x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions></x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]--></head><body><table style="border-collapse:collapse;font-family:sans-serif;font-size:13px">${head}${rows}</table></body></html>`;
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['\ufeff' + html], { type: 'application/vnd.ms-excel' }));
    a.download = `${title}_${new Date().toISOString().slice(0, 10)}.xls`; a.click();
  }

  const Row = ({ row }: { row: any }) => (
    <tr onClick={() => rowHref ? router.push(rowHref(row)) : setDetail(row)} style={{ boxShadow: `inset 3px 0 0 ${STATUS_COLOR[String(row[statusKey])] || 'transparent'}` }}>
      <td onClick={(e) => e.stopPropagation()} style={{ width: 34, textAlign: 'center' }}><input type="checkbox" checked={sel.has(row.id)} onChange={() => toggleSel(row.id)} /></td>
      {visibleColumns.map((c) => (
        <td key={c.key} style={c.badge && fullTag ? { background: (STATUS_COLOR[String(row[c.key])] || '#94a3b8') + '1f' } : undefined}>
          {c.render ? c.render(row[c.key], row)
            : c.badge ? (() => {
                const fld = fields.find((f) => f.key === c.key && f.type === 'select');
                if (fld && editCell && editCell.id === row.id && editCell.key === c.key) {
                  const opts = (fld.options || []).map(normOpt);
                  return <select autoFocus className="sel" style={{ padding: '2px 6px', fontSize: 12 }} defaultValue={String(row[c.key] ?? '')} onClick={(e) => e.stopPropagation()} onChange={(e) => { quickPatch(row.id, { [c.key]: e.target.value }); setEditCell(null); }} onBlur={() => setEditCell(null)}>{opts.map((o: any) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>;
                }
                return <span onClick={(e) => { if (fld) { e.stopPropagation(); setEditCell({ id: row.id, key: c.key }); } }} style={{ cursor: fld ? 'pointer' : 'default' }} title={fld ? '클릭하여 변경' : undefined}><Pill v={row[c.key]} /></span>;
              })()
            : c.mono || c.key === 'code' ? <span className="mono">{row[c.key] || '—'}</span>
            : /due|end/i.test(c.key) && row[c.key] ? (() => {
                const done = ['done', 'closed', 'resolved', 'completed', 'approved'].includes(String(row.status));
                const t = new Date(row[c.key]).getTime(); const now = Date.now(); const dd = Math.ceil((t - now) / 86400000);
                const col = done || isNaN(t) ? undefined : t < now ? '#c0414f' : dd <= 7 ? '#d98a16' : undefined;
                const od = Math.floor((now - t) / 86400000);
                const tip = col ? (t < now ? (od >= 1 ? `${od}일 초과` : '오늘 마감 초과') : (dd <= 0 ? '오늘 마감' : `D-${dd}`)) : undefined;
                return <span title={tip} style={{ color: col, fontWeight: col ? 700 : undefined, cursor: tip ? 'help' : undefined }}>{row[c.key]}{col === '#c0414f' ? ' ⚠' : ''}</span>;
              })()
            : <span style={c.strong ? { fontWeight: 650, color: 'var(--text-1)' } : undefined}>{c.strong && row.__wbs != null && <span className="muted" style={{ marginRight: 6, paddingLeft: (row.__depth || 0) * 16, fontVariantNumeric: 'tabular-nums' }}>{row.__wbs}</span>}{row[c.key] ?? '—'}</span>}
        </td>
      ))}
      <td className="row-act" onClick={(e) => e.stopPropagation()} style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
        <button className="btn btn-ghost btn-sm" aria-label="수정" title="수정" onClick={() => openEdit(row)}><Pencil style={{ width: 14 }} /></button>
        <button className="btn btn-danger btn-sm" aria-label="삭제" title="삭제" onClick={() => remove(row)}><Trash2 style={{ width: 14 }} /></button>
      </td>
    </tr>
  );

  return (
    <Shell title={title}>
      <div className="row">
        <div><h2 className="h1">{title}</h2>{subtitle && <p className="h-sub">{subtitle}</p>}</div>
        <div className="sp" />
        <button className="btn btn-pri" onClick={openNew} disabled={Boolean(projectScoped) && !pid}><Plus />새로 만들기</button>
      </div>

      <div className="toolbar">
        <div className="search" style={{ minWidth: 200 }}>
          <Search style={{ width: 16, height: 16 }} />
          <input placeholder="검색…" value={q} onChange={(e) => setQ(e.target.value)} />
          {q && <button onClick={() => setQ('')} style={{ color: 'var(--text-3)' }}><X style={{ width: 15 }} /></button>}
        </div>
        {statuses.length > 0 && (
          <select className="sel" value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="">전체 상태</option>
            {statuses.map((s) => <option key={String(s)} value={String(s)}>{LABEL[String(s)] || String(s)}</option>)}
          </select>
        )}
        {groupCols.length > 0 && (
          <select className="sel" value={groupBy} onChange={(e) => { setGroupBy(e.target.value); try { localStorage.setItem('pms.group.' + title, e.target.value); } catch {} }} title="그룹화">
            <option value="">그룹화 없음</option>
            {groupCols.map((k) => <option key={k} value={k}>그룹: {columns.find((c) => c.key === k)?.label}</option>)}
          </select>
        )}
        {altViews.length > 0 && (
          <div className="seg">
            <button className={mode === 'table' ? 'on' : ''} onClick={() => setMode('table')}>표</button>
            {altViews.map((v) => <button key={v.key} className={mode === v.key ? 'on' : ''} onClick={() => setMode(v.key)}>{v.label}</button>)}
          </div>
        )}
        <div className="sp" />
        <button className="btn btn-sm" onClick={exportCsv} title="CSV 내보내기"><Download style={{ width: 14 }} />CSV</button>
        <button className="btn btn-sm" onClick={exportXlsx} title="Excel 내보내기"><Sheet style={{ width: 14 }} />Excel</button>
        <button className="btn btn-sm" onClick={toggleDensity} title="행 밀도 전환" aria-label="행 밀도 전환">{density === 'compact' ? '편안하게' : '컴팩트'}</button>
        <button className="btn btn-sm" onClick={toggleFullTag} title="풀셀 컬러 태그" aria-label="풀셀 컬러 태그" style={fullTag ? { background: 'var(--brand-50)', borderColor: 'var(--brand-100)', color: 'var(--brand-700)' } : undefined}>컬러셀</button>
        <div style={{ position: 'relative' }}>
          <button className="btn btn-sm" onClick={() => setColMenu((v) => !v)} title="컬럼 표시/숨김" aria-label="컬럼 표시/숨김"><SlidersHorizontal style={{ width: 14 }} />컬럼</button>
          {colMenu && (<>
            <div onClick={() => setColMenu(false)} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
            <div className="card" style={{ position: 'absolute', right: 0, top: '110%', zIndex: 50, minWidth: 170, padding: 8, boxShadow: 'var(--sh-md)' }}>
              <div className="muted" style={{ fontSize: 11, padding: '2px 6px 6px' }}>표시할 컬럼</div>
              {columns.map((c) => (<label key={c.key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 6px', fontSize: 13, cursor: 'pointer' }}><input type="checkbox" checked={!hiddenCols.has(c.key)} onChange={() => toggleCol(c.key)} />{c.label}</label>))}
            </div>
          </>)}
        </div>
        <span className="muted" title={(q || filter) ? `전체 ${rows.length}건 중 ${view.length}건 표시` : undefined}><SlidersHorizontal style={{ width: 13, verticalAlign: -2 }} /> {(q || filter) && view.length !== rows.length ? `${view.length}/${rows.length}건` : `${view.length}건`}</span>
        {(q || filter) && <button className="btn btn-sm btn-ghost" onClick={() => { setQ(''); setFilter(''); }} title="검색·상태 필터 초기화" aria-label="검색·상태 필터 초기화"><X style={{ width: 13 }} />초기화</button>}
      </div>

      {projectScoped && !pid && !loading && (
        <div className="card card-pad" style={{ marginBottom: 6, background: 'var(--brand-50)', borderColor: 'var(--brand-100)' }}>
          <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
            <div><div style={{ fontWeight: 750, color: 'var(--brand-700)' }}>프로젝트가 없습니다</div>
              <p className="muted" style={{ margin: '3px 0 0' }}>이 화면은 프로젝트 단위로 동작합니다. 먼저 프로젝트를 만들거나, 설정에서 데모 데이터를 채우세요.</p></div>
            <div className="sp" />
            <Link href="/projects" className="btn">프로젝트 만들기</Link>
            <Link href="/settings" className="btn btn-pri">데모 데이터 채우기</Link>
          </div>
        </div>
      )}
      {mode !== 'table' && !loading && <div style={{ marginBottom: 6 }}>{altViews.find((v) => v.key === mode)?.render(view, setDetail, quickPatch, quickCreate)}</div>}

      {sel.size > 0 && (() => {
        const sf = fields.find((f) => f.key === statusKey && f.type === 'select');
        const opts = (sf?.options || []).map(normOpt);
        return (<div className="card" style={{ padding: '8px 12px', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', background: 'var(--brand-50)', border: '1px solid var(--brand-100)' }}>
          <b style={{ fontSize: 13 }}>{sel.size}건 선택</b>
          {opts.length > 0 && <span className="muted" style={{ fontSize: 12 }}>상태 →</span>}
          {opts.map((o: any) => <button key={o.value} className="btn btn-sm" onClick={() => bulkStatus(o.value)}>{o.label}</button>)}
          <button className="btn btn-sm btn-danger" onClick={bulkDelete}>삭제</button>
          <div className="sp" /><button className="btn btn-sm btn-ghost" onClick={() => setSel(new Set())}>선택 해제</button>
        </div>);
      })()}
      {(mode === 'table' || loading) && <div className={`card tbl-wrap${density === 'compact' ? ' compact' : ''}`}>
        <table className="tbl">
          <thead><tr>
            <th style={{ width: 34, textAlign: 'center' }}><input type="checkbox" aria-label="전체 선택" checked={view.length > 0 && view.every((r) => sel.has(r.id))} onChange={(e) => setSel(e.target.checked ? new Set(view.map((r) => r.id)) : new Set())} /></th>
            {visibleColumns.map((c) => <th key={c.key} onClick={() => sort(c.key)}>{c.label}{sortK === c.key && <span className="arr">{sortDir === 1 ? '▲' : '▼'}</span>}</th>)}
            <th className="no-sort" style={{ width: 90 }}></th>
          </tr></thead>
          <tbody>
            {loading && Array.from({ length: 5 }).map((_, i) => (<tr key={i}><td></td>{visibleColumns.map((c) => <td key={c.key}><div className="skel" style={{ height: 14, width: '70%' }} /></td>)}<td></td></tr>))}
            {!loading && !grouped && view.map((row) => <Row key={row.id} row={row} />)}
            {!loading && grouped && grouped.map(([g, list]) => (
              <Fragment key={'g' + g}>
                <tr onClick={() => toggleGroup(g)} style={{ cursor: 'pointer' }}><td colSpan={visibleColumns.length + 2} style={{ background: 'var(--surface-3)', fontWeight: 750, fontSize: 12.5, boxShadow: `inset 4px 0 0 ${STATUS_COLOR[g] || 'var(--brand)'}` }}><span style={{ display: 'inline-block', width: 14, transform: collapsed.has(g) ? 'none' : 'rotate(90deg)', color: 'var(--muted)' }}>▸</span>{g} <span className="muted">· {list.length}</span>{(() => {
                  const DONE = ['done', 'closed', 'resolved', 'completed', 'approved', 'pass'];
                  if (!list.some((r: any) => r[statusKey])) return null;
                  const dc = list.filter((r: any) => DONE.includes(String(r[statusKey]))).length;
                  const pct = list.length ? Math.round((dc / list.length) * 100) : 0;
                  return <span className="muted" style={{ marginLeft: 10, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }} title={`완료 ${dc} / 전체 ${list.length} (${pct}%)`}><span style={{ display: 'inline-block', width: 56, height: 5, borderRadius: 3, background: 'var(--border)', verticalAlign: 'middle', overflow: 'hidden', marginRight: 6 }}><span style={{ display: 'block', width: pct + '%', height: '100%', background: '#2f8f5b' }} /></span>{pct}%</span>;
                })()}</td></tr>
                {!collapsed.has(g) && list.map((row) => <Row key={row.id} row={row} />)}
              </Fragment>
            ))}
            {!loading && view.length === 0 && (<tr><td colSpan={visibleColumns.length + 2}><div className="empty"><Inbox /><div>{emptyText || (q || filter ? `조건에 맞는 ${title} 항목이 없습니다.` : `아직 등록된 ${title} 항목이 없습니다. “새로 만들기”로 추가하세요.`)}</div></div></td></tr>)}
            {!loading && primaryField && (
              <tr><td colSpan={visibleColumns.length + 2} style={{ padding: '6px 12px', background: 'var(--surface-2)' }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{ color: 'var(--brand)', fontWeight: 800 }}>+</span>
                  <input className="in" style={{ maxWidth: 300, height: 30 }} placeholder={(Boolean(projectScoped) && !pid) ? '먼저 프로젝트를 선택하세요' : '여기에 입력 후 Enter로 빠른 추가'} value={quickText} onChange={(e) => setQuickText(e.target.value)} disabled={Boolean(projectScoped) && !pid} onKeyDown={async (e) => { if (e.key === 'Enter' && quickText.trim()) { const okc = await quickCreate({ [primaryField]: quickText.trim() }); if (okc !== false) setQuickText(''); } }} />
                </div>
              </td></tr>
            )}
          </tbody>
        </table>
      </div>}

      {detail && (<>
        <div className="scrim" onClick={() => setDetail(null)} />
        <aside className="over" onTouchStart={onOverTouchStart} onTouchMove={onOverTouchMove} onTouchEnd={onOverTouchEnd} style={swipeY > 0 ? { transform: `translateY(${swipeY}px)`, transition: 'none' } : undefined}>
          <div className="over-grip" aria-hidden />
          <div className="over-h"><span className="mono" style={{ fontSize: 13 }}>{detail.code || `#${detail.id}`}</span><div className="sp" />{(() => { const i = view.findIndex((r) => r.id === detail.id); if (i < 0 || view.length < 2) return null; return (<><span className="muted" style={{ fontSize: 11.5, marginRight: 4, fontVariantNumeric: 'tabular-nums' }} title="현재 목록에서의 위치">{i + 1}/{view.length}</span><button className="iconbtn" aria-label="이전 항목" title="이전 항목" disabled={i <= 0} style={i <= 0 ? { opacity: .4, cursor: 'default' } : undefined} onClick={() => i > 0 && setDetail(view[i - 1])}><ChevronUp /></button><button className="iconbtn" aria-label="다음 항목" title="다음 항목" disabled={i >= view.length - 1} style={i >= view.length - 1 ? { opacity: .4, cursor: 'default' } : undefined} onClick={() => i < view.length - 1 && setDetail(view[i + 1])}><ChevronDown /></button></>); })()}<button className="iconbtn" aria-label="닫기" onClick={() => setDetail(null)}><X /></button></div>
          <div className="over-b">
            <h3 style={{ margin: '0 0 16px', fontSize: 19, fontWeight: 800, letterSpacing: '-.02em' }}>{detail.title || detail.name || detail.code}</h3>
            <dl className="dl">
              {fields.map((f) => {
                const isDue = f.type === 'date' && /due|end|마감|기한|종료/i.test(f.key) && detail[f.key];
                let dueCol: string | undefined, dueTip: string | undefined;
                if (isDue) {
                  const done = ['done', 'closed', 'resolved', 'completed', 'approved'].includes(String(detail.status));
                  const t = new Date(detail[f.key]).getTime(); const now = Date.now(); const dd = Math.ceil((t - now) / 86400000); const od = Math.floor((now - t) / 86400000);
                  if (!done && !isNaN(t)) { dueCol = t < now ? '#c0414f' : dd <= 7 ? '#d98a16' : undefined; if (dueCol) dueTip = t < now ? (od >= 1 ? `${od}일 초과` : '오늘 마감 초과') : (dd <= 0 ? '오늘 마감' : `D-${dd}`); }
                }
                return (<div key={f.key} style={{ display: 'contents' }}><dt>{f.label}</dt><dd>{['status','priority','level','type'].includes(f.key) ? <Pill v={detail[f.key]} /> : detail[f.key] ? (dueCol ? <span style={{ color: dueCol, fontWeight: 700 }}>{detail[f.key]} <span style={{ fontSize: 11 }}>({dueTip})</span></span> : detail[f.key]) : <span className="muted">—</span>}</dd></div>);
              })}
              {(() => {
                const fieldKeys = new Set(fields.map((f) => f.key));
                const who = (!fieldKeys.has('author') && detail.author) || (!fieldKeys.has('owner') && detail.owner) || (!fieldKeys.has('approver') && detail.approver) || (!fieldKeys.has('assignee') && detail.assignee);
                return who ? (<><dt>작성자</dt><dd className="muted">{who}</dd></>) : null;
              })()}
              <dt>생성 일시</dt><dd className="muted">{detail.createdAt ? new Date(detail.createdAt).toLocaleString('ko-KR') : '—'}</dd>
            </dl>
            {entity === 'documents' && (() => {
              const steps: [string, string][] = [['draft', '작성중'], ['review', '결재요청'], ['approved', '승인']];
              const idx = detail.status === 'rejected' ? -1 : steps.findIndex((st) => st[0] === detail.status);
              return (<div style={{ marginTop: 16 }}>
                <div className="sect" style={{ marginBottom: 10 }}>결재 진행</div>
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  {steps.map((st, i) => { const done = idx >= 0 && idx >= i; return (
                    <div key={st[0]} style={{ display: 'flex', alignItems: 'center', flex: i < steps.length - 1 ? 1 : '0 0 auto' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                        <span style={{ width: 26, height: 26, borderRadius: 20, background: done ? '#2f8f5b' : 'var(--surface-3)', color: done ? '#fff' : 'var(--text-3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800 }}>{i + 1}</span>
                        <span style={{ fontSize: 11, color: done ? 'var(--text-1)' : 'var(--text-3)', fontWeight: done ? 700 : 500 }}>{st[1]}</span>
                      </div>
                      {i < steps.length - 1 && <div style={{ flex: 1, height: 2, background: idx > i ? '#2f8f5b' : 'var(--border)', margin: '0 6px 16px' }} />}
                    </div>); })}
                </div>
                {detail.status === 'rejected' && <div style={{ color: '#c0414f', marginTop: 8, fontWeight: 700, fontSize: 12.5 }}>반려됨</div>}
                {detail.approvedAt && <div className="muted" style={{ marginTop: 6, fontSize: 12 }}>승인일 {new Date(detail.approvedAt).toLocaleDateString('ko-KR')}</div>}
              </div>); })()}
            {(() => { const sf = fields.find((f) => f.key === 'status' && f.type === 'select'); return sf && sf.options ? (
              <div style={{ marginTop: 18 }}>
                <div className="sect" style={{ marginBottom: 8 }}>상태 변경</div>
                <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                  {sf.options.map((oo: any) => { const o = typeof oo === 'string' ? oo : oo.value; const lb = typeof oo === 'string' ? (LABEL[oo] || oo) : oo.label; return <button key={o} className={`btn btn-sm ${detail.status === o ? 'btn-pri' : ''}`} onClick={() => quickStatus(detail, o)}>{lb}</button>; })}
                </div>
              </div>
            ) : null; })()}
            {entity && <Comments entity={entity} entityId={detail.id} />}
          </div>
          <div className="over-f"><button className="btn btn-danger" onClick={() => remove(detail)}><Trash2 />삭제</button><div className="sp" /><button className="btn btn-pri" onClick={() => openEdit(detail)}><Pencil />수정</button></div>
        </aside>
      </>)}

      {open && (
        <div className="mscrim" onClick={() => setOpen(false)}>
          <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={save}>
            <div className="modal-h"><h3 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>{editing ? '수정' : '새로 만들기'}</h3><div className="sp" /><button type="button" className="iconbtn" aria-label="닫기" onClick={() => setOpen(false)}><X /></button></div>
            {err && <div className="err">{err}</div>}
            <div className="modal-b"><div className="grid2">
              {fields.map((f) => {
                const srcOpts = f.optionsFrom === 'members' ? memberOpts : f.optionsFrom === 'tasks' ? taskOpts.filter((o: any) => o.value !== String(editing?.id)) : (f.options || []);
                const optNorm = (srcOpts as any[]).map(normOpt);
                const dlId = 'dl-' + f.key;
                return (
                <div className="field" key={f.key} style={{ gridColumn: f.half ? 'auto' : '1 / -1' }}>
                  <label>{f.label}{f.required && ' *'}</label>
                  {f.type === 'textarea' ? <textarea className="in" value={form[f.key] ?? ''} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} />
                    : f.type === 'select' ? <select className="in" value={form[f.key] ?? ''} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}><option value="">선택</option>{optNorm.map((o: any) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
                    : f.type === 'combo' ? <><input className="in" list={dlId} placeholder={f.placeholder || '선택하거나 직접 입력'} value={form[f.key] ?? ''} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} /><datalist id={dlId}>{optNorm.map((o: any) => <option key={o.value} value={o.value}>{o.label}</option>)}</datalist></>
                    : <input className="in" type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'} placeholder={f.placeholder || ''} value={form[f.key] ?? ''} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} />}
                  {f.hint && <span style={{ fontSize: 11, color: 'var(--text-4)', marginTop: 3, display: 'block' }}>{f.hint}</span>}
                </div>
                );
              })}
            </div></div>
            <div className="modal-f"><div className="sp" /><button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>취소</button><button type="submit" className="btn btn-pri">저장</button></div>
          </form>
        </div>
      )}
    </Shell>
  );
}
// prism-pms: monday UX (column toggle + full-cell color tag)
