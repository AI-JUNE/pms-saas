'use client';
import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Trash2, Wrench } from 'lucide-react';
import { FIELD_TYPES, FIELD_TYPE_LABEL, parseFieldDefs, serializeFieldDefs, addField, removeField, moveField, updateField, MAX_FIELDS, type FieldType, type FormFieldDef } from '@/lib/formRender';

const nfmt = (n: number) => n.toLocaleString('ko-KR');

/**
 * 양식 빌더 — 항목 추가·삭제·순서 변경·타입/필수/선택지 편집. 저장은 `PATCH /api/form-definitions/:id` 의 fields 를 JSON 으로 바꾼다.
 * 기존 줄바꿈 텍스트 정의는 전부 text 항목으로 읽어 들여 그대로 편집할 수 있다(저장 시 JSON 으로 승격).
 */
export function FormBuilder({ definitionId, fieldsRaw, onSaved }: { definitionId: number; fieldsRaw: unknown; onSaved?: (fieldsJson: string) => void }) {
  const [defs, setDefs] = useState<FormFieldDef[]>([]);
  const [format, setFormat] = useState<'json' | 'lines' | 'empty'>('empty');
  const [problems, setProblems] = useState<string[]>([]);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [draft, setDraft] = useState<{ label: string; type: FieldType; required: boolean; options: string }>({ label: '', type: 'text', required: false, options: '' });

  useEffect(() => {
    const p = parseFieldDefs(fieldsRaw);
    setDefs(p.defs); setFormat(p.format); setProblems(p.problems); setDirty(false); setErr('');
  }, [fieldsRaw, definitionId]);

  function apply(r: { defs: FormFieldDef[]; problem: string | null }) {
    if (r.problem) { setErr(r.problem); return; }
    setDefs(r.defs); setDirty(true); setErr('');
  }
  function add(e: React.FormEvent) {
    e.preventDefault();
    const r = addField(defs, { label: draft.label, type: draft.type, required: draft.required, options: draft.type === 'select' ? draft.options.split(/[\n,]/).map((s) => s.trim()).filter(Boolean) : undefined });
    if (!r.problem) setDraft({ label: '', type: 'text', required: false, options: '' });
    apply(r);
  }
  async function save() {
    setBusy(true); setErr('');
    const json = serializeFieldDefs(defs);
    const r = await fetch(`/api/form-definitions/${definitionId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fields: json }) });
    setBusy(false);
    if (r.ok) { setDirty(false); setFormat('json'); onSaved?.(json); }
    else { const d = await r.json().catch(() => ({})); setErr(d.message || '저장에 실패했습니다'); }
  }

  return (
    <div style={{ marginTop: 22 }}>
      <div className="row" style={{ alignItems: 'center', marginBottom: 8 }}>
        <div className="sect" style={{ margin: 0 }} title={`항목 ${nfmt(defs.length)}개 (최대 ${nfmt(MAX_FIELDS)}개)`}>
          <Wrench style={{ width: 14, verticalAlign: '-2px', marginRight: 4 }} aria-hidden="true" />양식 빌더 {defs.length > 0 && `(${nfmt(defs.length)})`}
        </div>
        <div className="sp" />
        {format === 'lines' && <span className="muted" style={{ fontSize: 11.5, marginRight: 8 }} title="줄바꿈 텍스트로 저장된 옛 정의입니다. 저장하면 타입·필수 정보를 담은 JSON 으로 바뀝니다">텍스트 정의(변환 예정)</span>}
        <button type="button" className="btn btn-pri btn-sm" disabled={!dirty || busy} onClick={save} title={dirty ? '변경된 항목 구성을 저장합니다' : '변경 사항이 없습니다'}>{busy ? '저장 중…' : '구성 저장'}</button>
      </div>
      <span className="sr-only" role="status">{`양식 항목 ${nfmt(defs.length)}개${dirty ? ' · 저장되지 않은 변경 있음' : ''}`}</span>
      {problems.length > 0 && <div className="muted" role="alert" style={{ fontSize: 12, color: '#d98a16', marginBottom: 8 }}>읽지 못한 항목: {problems.join(' / ')}</div>}
      {err && <div className="err" role="alert" style={{ marginBottom: 8 }}>{err}</div>}

      <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {defs.map((d, i) => {
          const base = `fb-${definitionId}-${d.key}`;
          return (
            <li key={d.key} className="card" style={{ padding: '8px 10px', marginBottom: 6, display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: 8, alignItems: 'center' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <button type="button" className="iconbtn" aria-label={`${d.label} 위로`} disabled={i === 0} onClick={() => apply({ defs: moveField(defs, d.key, -1), problem: null })}><ArrowUp style={{ width: 13 }} aria-hidden="true" /></button>
                <button type="button" className="iconbtn" aria-label={`${d.label} 아래로`} disabled={i === defs.length - 1} onClick={() => apply({ defs: moveField(defs, d.key, 1), problem: null })}><ArrowDown style={{ width: 13 }} aria-hidden="true" /></button>
              </div>
              <div className="grid2" style={{ gap: 6 }}>
                <div className="field" style={{ margin: 0 }}>
                  <label htmlFor={`${base}-label`} style={{ fontSize: 11 }}>항목명 <span className="muted mono" style={{ fontWeight: 400 }}>({d.key})</span></label>
                  <input id={`${base}-label`} className="in" style={{ height: 30 }} value={d.label} onChange={(e) => apply(updateField(defs, d.key, { label: e.target.value }))} />
                </div>
                <div className="field" style={{ margin: 0 }}>
                  <label htmlFor={`${base}-type`} style={{ fontSize: 11 }}>타입</label>
                  <select id={`${base}-type`} className="in" style={{ height: 30 }} value={d.type} onChange={(e) => { const t = e.target.value as FieldType; apply(updateField(defs, d.key, { type: t, options: t === 'select' ? (d.options?.length ? d.options : ['선택1']) : undefined })); }}>
                    {FIELD_TYPES.map((t) => <option key={t} value={t}>{FIELD_TYPE_LABEL[t]}</option>)}
                  </select>
                </div>
                {d.type === 'select' && (
                  <div className="field" style={{ margin: 0, gridColumn: '1 / -1' }}>
                    <label htmlFor={`${base}-opts`} style={{ fontSize: 11 }}>선택지(쉼표 구분)</label>
                    <input id={`${base}-opts`} className="in" style={{ height: 30 }} defaultValue={(d.options ?? []).join(', ')} onBlur={(e) => apply(updateField(defs, d.key, { options: e.target.value.split(/[\n,]/).map((s) => s.trim()).filter(Boolean) }))} />
                  </div>
                )}
                {d.type === 'number' && (
                  <div className="row" style={{ gridColumn: '1 / -1', gap: 6 }}>
                    <label htmlFor={`${base}-min`} className="muted" style={{ fontSize: 11 }}>최소</label>
                    <input id={`${base}-min`} className="in" type="number" style={{ height: 30, width: 90 }} defaultValue={d.min ?? ''} onBlur={(e) => apply(updateField(defs, d.key, { min: e.target.value === '' ? undefined : Number(e.target.value) }))} />
                    <label htmlFor={`${base}-max`} className="muted" style={{ fontSize: 11 }}>최대</label>
                    <input id={`${base}-max`} className="in" type="number" style={{ height: 30, width: 90 }} defaultValue={d.max ?? ''} onBlur={(e) => apply(updateField(defs, d.key, { max: e.target.value === '' ? undefined : Number(e.target.value) }))} />
                  </div>
                )}
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 500, gridColumn: '1 / -1' }}>
                  <input type="checkbox" checked={!!d.required} onChange={(e) => apply(updateField(defs, d.key, { required: e.target.checked }))} /> 필수 항목
                </label>
              </div>
              <button type="button" className="iconbtn" aria-label={`${d.label} 삭제`} title="항목 삭제" onClick={() => apply({ defs: removeField(defs, d.key), problem: null })}><Trash2 style={{ width: 14 }} aria-hidden="true" /></button>
            </li>
          );
        })}
      </ol>
      {defs.length === 0 && <div className="muted" style={{ fontSize: 12.5, padding: '6px 0' }}>항목이 없습니다. 아래에서 첫 항목을 추가하세요.</div>}

      <form onSubmit={add} className="row" style={{ marginTop: 8, gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <input className="in" aria-label="새 항목명" placeholder="새 항목명 (예: 검토자)" value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} style={{ flex: 1, minWidth: 140, height: 32 }} />
        <select className="sel" aria-label="새 항목 타입" value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value as FieldType })}>
          {FIELD_TYPES.map((t) => <option key={t} value={t}>{FIELD_TYPE_LABEL[t]}</option>)}
        </select>
        {draft.type === 'select' && <input className="in" aria-label="새 항목 선택지(쉼표 구분)" placeholder="선택지1, 선택지2" value={draft.options} onChange={(e) => setDraft({ ...draft, options: e.target.value })} style={{ flex: 1, minWidth: 140, height: 32 }} />}
        <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}><input type="checkbox" checked={draft.required} onChange={(e) => setDraft({ ...draft, required: e.target.checked })} /> 필수</label>
        <button className="btn btn-sm" type="submit" disabled={!draft.label.trim() || defs.length >= MAX_FIELDS}><Plus style={{ width: 14 }} aria-hidden="true" />항목 추가</button>
      </form>
    </div>
  );
}
