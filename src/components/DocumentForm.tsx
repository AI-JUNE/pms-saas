'use client';
import { useEffect, useMemo, useState } from 'react';
import { FormFill } from './FormFill';

/**
 * 산출물 상세용 — 같은 프로젝트의 커스텀 양식(form_definitions) 중 하나를 골라 이 산출물에 매인 입력을 작성·열람한다.
 * 대상 유형(targetType)이 산출물 유형(type)과 같은 '사용' 상태 양식을 우선 고른다. 양식이 없으면 안내만 한다.
 */
export function DocumentForm({ documentId, projectId, docType }: { documentId: number; projectId?: number | null; docType?: string | null }) {
  const [defs, setDefs] = useState<any[]>([]);
  const [sel, setSel] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    const pid = projectId ?? (Number(localStorage.getItem('pms.project')) || null);
    if (!pid) { setLoaded(true); return; }
    fetch(`/api/form-definitions?projectId=${pid}`).then((r) => (r.ok ? r.json() : [])).then((d) => { setDefs(Array.isArray(d) ? d : []); setLoaded(true); }).catch(() => setLoaded(true));
  }, [projectId]);
  const ordered = useMemo(() => {
    const t = String(docType ?? '').trim();
    return [...defs].sort((a, b) => {
      const am = (String(a.targetType ?? '').trim() === t && t ? 0 : 1) + (a.status === 'active' ? 0 : 2);
      const bm = (String(b.targetType ?? '').trim() === t && t ? 0 : 1) + (b.status === 'active' ? 0 : 2);
      return am - bm || String(a.name).localeCompare(String(b.name), 'ko');
    });
  }, [defs, docType]);
  useEffect(() => { if (sel === null && ordered.length) setSel(ordered[0].id); }, [ordered, sel]);
  if (!loaded) return null;
  if (!defs.length) return (
    <div style={{ marginTop: 22 }}>
      <div className="sect" style={{ marginBottom: 6 }}>양식 입력</div>
      <div className="muted" style={{ fontSize: 12.5 }}>이 프로젝트에 정의된 산출물 양식이 없습니다. <a href="/form-definitions" style={{ color: 'var(--brand-600)', fontWeight: 700 }}>산출물 양식</a>에서 먼저 양식을 만드세요.</div>
    </div>
  );
  return (
    <div style={{ marginTop: 22 }}>
      <div className="row" style={{ alignItems: 'center', gap: 8 }}>
        <label htmlFor={`docform-sel-${documentId}`} className="sect" style={{ margin: 0 }}>적용 양식</label>
        <select id={`docform-sel-${documentId}`} className="sel" value={sel ?? ''} onChange={(e) => setSel(Number(e.target.value) || null)} aria-label="적용할 산출물 양식">
          {ordered.map((d) => <option key={d.id} value={d.id}>{d.name}{d.targetType ? ` (${d.targetType})` : ''}{d.status === 'active' ? '' : ' · 미사용'}</option>)}
        </select>
      </div>
      {sel && <FormFill key={sel} definitionId={sel} documentId={documentId} compact />}
    </div>
  );
}
