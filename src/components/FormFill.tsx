'use client';
import { useEffect, useState } from 'react';
import { FileText } from 'lucide-react';
import { emptyValues, validateFormValues, parseFormValues, displayValue, summarizeEntry, type FormFieldDef, type FormValues } from '@/lib/formRender';

const nfmt = (n: number) => n.toLocaleString('ko-KR');

/**
 * 커스텀 양식 동적 폼 — 정의(text·number·date·select·textarea·checkbox)대로 입력을 그리고, 클라이언트에서 1차 검증 뒤
 * `/api/form-definitions/:id/entries` 에 저장한다(서버가 같은 규칙으로 재검증). documentId 를 주면 그 산출물에 매인 입력만 다룬다.
 */
export function FormFill({ definitionId, documentId, compact }: { definitionId: number; documentId?: number | null; compact?: boolean }) {
  const [defs, setDefs] = useState<FormFieldDef[]>([]);
  const [problems, setProblems] = useState<string[]>([]);
  const [rows, setRows] = useState<any[]>([]);
  const [unavailable, setUnavailable] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [values, setValues] = useState<FormValues>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState(!compact);

  function load() {
    const q = documentId ? `?documentId=${documentId}` : '';
    fetch(`/api/form-definitions/${definitionId}/entries${q}`).then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const ds: FormFieldDef[] = Array.isArray(d?.defs) ? d.defs : [];
        setDefs(ds); setProblems(Array.isArray(d?.problems) ? d.problems : []); setRows(Array.isArray(d?.rows) ? d.rows : []);
        setUnavailable(!!d?.unavailable); setValues(emptyValues(ds)); setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }
  useEffect(load, [definitionId, documentId]);

  function set(key: string, v: string | number | boolean) {
    setValues((cur) => ({ ...cur, [key]: v }));
    setErrors((cur) => { const n = { ...cur }; delete n[key]; return n; });
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const r = validateFormValues(defs, values as Record<string, unknown>);
    if (!r.ok) { setErrors(Object.fromEntries(r.errors.map((x) => [x.field, x.message]))); setErr('입력값을 확인해 주세요'); return; }
    setBusy(true); setErr('');
    const res = await fetch(`/api/form-definitions/${definitionId}/entries`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ values: r.values, documentId: documentId ?? null }) });
    setBusy(false);
    if (res.ok) { setValues(emptyValues(defs)); setErrors({}); load(); }
    else { const d = await res.json().catch(() => ({})); setErr(d.message || '저장에 실패했습니다'); if (Array.isArray(d.fields)) setErrors(Object.fromEntries(d.fields.map((x: any) => [x.field, x.message]))); }
  }

  const idOf = (k: string) => `ffill-${definitionId}-${k}`;

  return (
    <div style={{ marginTop: 22 }}>
      <div className="row" style={{ alignItems: 'center', marginBottom: 8 }}>
        <div className="sect" style={{ margin: 0 }} title={rows.length > 0 ? `입력 ${nfmt(rows.length)}건` : '아직 입력된 내용이 없습니다'}>
          <FileText style={{ width: 14, verticalAlign: '-2px', marginRight: 4 }} aria-hidden="true" />양식 입력 {rows.length > 0 && `(${nfmt(rows.length)})`}
        </div>
        <div className="sp" />
        {compact && <button type="button" className="btn btn-sm" aria-expanded={open} onClick={() => setOpen((v) => !v)}>{open ? '접기' : '입력하기'}</button>}
      </div>
      <span className="sr-only" role="status">{!loaded ? '양식을 불러오는 중' : `양식 항목 ${nfmt(defs.length)}개 · 입력 ${nfmt(rows.length)}건`}</span>
      {problems.length > 0 && <div className="muted" role="alert" style={{ fontSize: 12, color: '#d98a16', marginBottom: 8 }}>양식 정의 중 읽지 못한 항목이 있습니다: {problems.join(' / ')}</div>}
      {unavailable && <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>양식 입력 테이블이 아직 준비되지 않았습니다. 관리자가 「스키마 업데이트」를 실행하면 사용할 수 있습니다.</div>}
      {loaded && defs.length === 0 && <div className="muted" style={{ fontSize: 12.5, padding: '6px 0' }}>이 양식에는 정의된 항목이 없습니다. 「양식 빌더」에서 항목을 추가하세요.</div>}

      {open && defs.length > 0 && (
        <form onSubmit={save} className="card" style={{ padding: 14, marginBottom: 12 }}>
          {err && <div className="err" role="alert" style={{ marginBottom: 10 }}>{err}</div>}
          <div className="grid2">
            {defs.map((d) => {
              const id = idOf(d.key);
              const v = values[d.key];
              const e = errors[d.key];
              const wide = d.type === 'textarea';
              const common = { id, 'aria-required': d.required ? true : undefined, 'aria-invalid': e ? true : undefined, 'aria-describedby': e ? `${id}-err` : d.hint ? `${id}-hint` : undefined, className: 'in' } as const;
              let input: React.ReactNode;
              if (d.type === 'textarea') input = <textarea {...common} value={String(v ?? '')} placeholder={d.placeholder} onChange={(ev) => set(d.key, ev.target.value)} />;
              else if (d.type === 'select') input = <select {...common} value={String(v ?? '')} onChange={(ev) => set(d.key, ev.target.value)}><option value="">선택</option>{(d.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}</select>;
              else if (d.type === 'checkbox') input = <label htmlFor={id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 400, fontSize: 13, minHeight: 34 }}><input {...common} className="" type="checkbox" checked={v === true} onChange={(ev) => set(d.key, ev.target.checked)} /><span>{d.hint || '확인했습니다'}</span></label>;
              else if (d.type === 'number') input = <input {...common} type="number" inputMode="decimal" min={d.min} max={d.max} value={v === null || v === undefined ? '' : String(v)} placeholder={d.placeholder} onChange={(ev) => set(d.key, ev.target.value)} />;
              else if (d.type === 'date') input = <input {...common} type="date" value={String(v ?? '')} onChange={(ev) => set(d.key, ev.target.value)} />;
              else input = <input {...common} type="text" value={String(v ?? '')} placeholder={d.placeholder} onChange={(ev) => set(d.key, ev.target.value)} />; // 기본 타입 'text'
              return (
                <div className="field" key={d.key} style={{ gridColumn: wide ? '1 / -1' : 'auto' }}>
                  <label htmlFor={id}>{d.label}{d.required && ' *'}</label>
                  {input}
                  {d.hint && d.type !== 'checkbox' && <span id={`${id}-hint`} style={{ fontSize: 11, color: 'var(--text-4)', marginTop: 5, display: 'block' }}>{d.hint}</span>}
                  {e && <span id={`${id}-err`} role="alert" style={{ fontSize: 11.5, color: '#c0414f', marginTop: 4, display: 'block', fontWeight: 600 }}>{e}</span>}
                </div>
              );
            })}
          </div>
          <div className="row" style={{ marginTop: 10 }}><div className="sp" /><button className="btn btn-pri" type="submit" disabled={busy || unavailable}>{busy ? '저장 중…' : '입력 저장'}</button></div>
        </form>
      )}

      {rows.length > 0 && (
        <div>
          {rows.map((r) => {
            const vals = parseFormValues(r.data);
            return (
              <details key={r.id} className="cmt" style={{ display: 'block' }}>
                <summary style={{ cursor: 'pointer', fontSize: 12.5, display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{ fontWeight: 700 }}>{r.authorName}</span>
                  <span className="muted" style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{summarizeEntry(defs, vals) || '(내용 없음)'}</span>
                  <span className="muted" style={{ fontSize: 11.5, whiteSpace: 'nowrap' }}>{new Date(r.createdAt).toLocaleString('ko-KR')}</span>
                </summary>
                <dl className="dl" style={{ marginTop: 8 }}>
                  {defs.map((d) => <div key={d.key} style={{ display: 'contents' }}><dt>{d.label}</dt><dd>{displayValue(d, vals[d.key])}</dd></div>)}
                </dl>
              </details>
            );
          })}
        </div>
      )}
    </div>
  );
}
