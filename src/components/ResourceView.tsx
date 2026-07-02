'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Plus, Search, X, Pencil, Trash2, Inbox, SlidersHorizontal, Download, Layers, Sheet } from 'lucide-react';
import { Shell } from './Shell';
import { Pill } from '@/lib/ui';
import { Comments } from './Comments';

export type Col = { key: string; label: string; badge?: boolean; strong?: boolean; mono?: boolean; render?: (v: any, row: any) => any };
type Opt = string | { value: string; label: string };
export type Field = { key: string; label: string; type?: 'text'|'textarea'|'number'|'date'|'select'|'combo'; options?: Opt[]; required?: boolean; half?: boolean; numeric?: boolean; hint?: string; placeholder?: string; optionsFrom?: 'members' };
export type AltView = { key: string; label: string; icon?: any; render: (rows: any[], openDetail: (r: any) => void, save: (id: number, patch: any) => Promise<void>, create: (body: any) => Promise<boolean>) => any };
type Props = { title: string; subtitle?: string; endpoint: string; projectScoped?: boolean; columns: Col[]; fields: Field[]; statusKey?: string; altViews?: AltView[]; entity?: string; rowHref?: (row: any) => string };

const GROUPABLE = ['status','priority','type','assignee','epic','level','category','role'];

export function ResourceView({ title, subtitle, endpoint, projectScoped, columns, fields, statusKey = 'status', altViews = [], entity, rowHref }: Props) {
  const router = useRouter();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [pid, setPid] = useState<number | null>(null);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('');
  const [sortK, setSortK] = useState('id');
  const [sortDir, setSortDir] = useState<1 | -1>(-1);
  const [groupBy, setGroupBy] = useState('');
  const [detail, setDetail] = useState<any>(null);
  const [memberOpts, setMemberOpts] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState<any>({});
  const [err, setErr] = useState('');
  const [mode, setMode] = useState('table');
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
    return v;
  }, [rows, q, filter, sortK, sortDir, statusKey]);

  const grouped = useMemo(() => {
    if (!groupBy) return null;
    const m = new Map<string, any[]>();
    for (const r of view) { const k = String(r[groupBy] ?? '—'); if (!m.has(k)) m.set(k, []); m.get(k)!.push(r); }
    return Array.from(m.entries());
  }, [view, groupBy]);

  function sort(k: string) { if (sortK === k) setSortDir((d) => (d === 1 ? -1 : 1)); else { setSortK(k); setSortDir(1); } }
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
    <tr onClick={() => rowHref ? router.push(rowHref(row)) : setDetail(row)}>
      {columns.map((c) => (
        <td key={c.key}>
          {c.render ? c.render(row[c.key], row)
            : c.badge ? <Pill v={row[c.key]} />
            : c.mono || c.key === 'code' ? <span className="mono">{row[c.key] || '—'}</span>
            : <span style={c.strong ? { fontWeight: 650, color: 'var(--text-1)' } : undefined}>{row[c.key] ?? '—'}</span>}
        </td>
      ))}
      <td onClick={(e) => e.stopPropagation()} style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
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
            {statuses.map((s) => <option key={String(s)} value={String(s)}>{String(s)}</option>)}
          </select>
        )}
        {groupCols.length > 0 && (
          <select className="sel" value={groupBy} onChange={(e) => setGroupBy(e.target.value)} title="그룹화">
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
        <span className="muted"><SlidersHorizontal style={{ width: 13, verticalAlign: -2 }} /> {view.length}건</span>
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

      {(mode === 'table' || loading) && <div className="card tbl-wrap">
        <table className="tbl">
          <thead><tr>
            {columns.map((c) => <th key={c.key} onClick={() => sort(c.key)}>{c.label}{sortK === c.key && <span className="arr">{sortDir === 1 ? '▲' : '▼'}</span>}</th>)}
            <th className="no-sort" style={{ width: 90 }}></th>
          </tr></thead>
          <tbody>
            {loading && Array.from({ length: 5 }).map((_, i) => (<tr key={i}>{columns.map((c) => <td key={c.key}><div className="skel" style={{ height: 14, width: '70%' }} /></td>)}<td></td></tr>))}
            {!loading && !grouped && view.map((row) => <Row key={row.id} row={row} />)}
            {!loading && grouped && grouped.map(([g, list]) => (
              <>
                <tr key={'g' + g}><td colSpan={columns.length + 1} style={{ background: 'var(--surface-3)', fontWeight: 750, fontSize: 12.5 }}><Layers style={{ width: 13, verticalAlign: -2, marginRight: 6, color: 'var(--brand)' }} />{g} <span className="muted">· {list.length}</span></td></tr>
                {list.map((row) => <Row key={row.id} row={row} />)}
              </>
            ))}
            {!loading && view.length === 0 && (<tr><td colSpan={columns.length + 1}><div className="empty"><Inbox /><div>데이터가 없습니다. “새로 만들기”로 추가하세요.</div></div></td></tr>)}
          </tbody>
        </table>
      </div>}

      {detail && (<>
        <div className="scrim" onClick={() => setDetail(null)} />
        <aside className="over" onTouchStart={onOverTouchStart} onTouchMove={onOverTouchMove} onTouchEnd={onOverTouchEnd} style={swipeY > 0 ? { transform: `translateY(${swipeY}px)`, transition: 'none' } : undefined}>
          <div className="over-grip" aria-hidden />
          <div className="over-h"><span className="mono" style={{ fontSize: 13 }}>{detail.code || `#${detail.id}`}</span><div className="sp" /><button className="iconbtn" aria-label="닫기" onClick={() => setDetail(null)}><X /></button></div>
          <div className="over-b">
            <h3 style={{ margin: '0 0 16px', fontSize: 19, fontWeight: 800, letterSpacing: '-.02em' }}>{detail.title || detail.name || detail.code}</h3>
            <dl className="dl">
              {fields.map((f) => (<div key={f.key} style={{ display: 'contents' }}><dt>{f.label}</dt><dd>{['status','priority','level','type'].includes(f.key) ? <Pill v={detail[f.key]} /> : (detail[f.key] || <span className="muted">—</span>)}</dd></div>))}
              <dt>생성</dt><dd className="muted">{detail.createdAt ? new Date(detail.createdAt).toLocaleString('ko-KR') : '—'}</dd>
            </dl>
            {(() => { const sf = fields.find((f) => f.key === 'status' && f.type === 'select'); return sf && sf.options ? (
              <div style={{ marginTop: 18 }}>
                <div className="sect" style={{ marginBottom: 8 }}>상태 변경</div>
                <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                  {sf.options.map((oo: any) => { const o = typeof oo === 'string' ? oo : oo.value; const lb = typeof oo === 'string' ? oo : oo.label; return <button key={o} className={`btn btn-sm ${detail.status === o ? 'btn-pri' : ''}`} onClick={() => quickStatus(detail, o)}>{lb}</button>; })}
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
                const srcOpts = f.optionsFrom === 'members' ? memberOpts : (f.options || []);
                const optNorm = (srcOpts as any[]).map((o: any) => (typeof o === 'string' ? { value: o, label: o } : o));
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
