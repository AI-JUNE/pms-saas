'use client';
// 공통 가져오기 마법사 — 파일(.xlsx·.csv·.tsv·내보낸 엑셀) 또는 붙여넣기 → 열 짝짓기 → 검사 미리보기 → 한 건씩 등록.
// 등록은 화면의 기존 만들기 API(POST)를 그대로 쓴다(권한·검증·감사 기록도 그대로). 2026-10-26 PMS 개편 P0-2.
import { useMemo, useRef, useState } from 'react';
import { X, Upload } from 'lucide-react';
import {
  parseDelimited, parseHtmlTable, readXlsx, autoMap, buildRows, guessHeaderRow, importable,
  type ImportField, type Table,
} from '@/lib/importWizard';

const MAX_BYTES = 10 * 1024 * 1024;

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('deflate-raw');
  const out = new Response(new Blob([data as BlobPart]).stream().pipeThrough(ds));
  return new Uint8Array(await out.arrayBuffer());
}

async function readFile(file: File): Promise<Table> {
  if (file.size > MAX_BYTES) throw new Error('10MB 보다 큰 파일은 나눠서 올려 주세요');
  const buf = new Uint8Array(await file.arrayBuffer());
  if (buf[0] === 0x50 && buf[1] === 0x4b) return readXlsx(buf, inflateRaw); // ZIP = .xlsx
  let text = new TextDecoder('utf-8').decode(buf);
  if (text.includes('�')) { try { text = new TextDecoder('euc-kr').decode(buf); } catch { /* 그대로 */ } }
  return /<table[\s>]/i.test(text) ? parseHtmlTable(text) : parseDelimited(text);
}

type Props = {
  title: string; endpoint: string; fields: ImportField[];
  projectId: number | null; projectScoped?: boolean;
  onClose: () => void; onDone: () => void;
};

export function ImportWizard({ title, endpoint, fields, projectId, projectScoped, onClose, onDone }: Props) {
  const [table, setTable] = useState<Table | null>(null);
  const [src, setSrc] = useState('');
  const [paste, setPaste] = useState('');
  const [err, setErr] = useState('');
  const [hdr, setHdr] = useState(0);
  const [map, setMap] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ ok: number; fail: { row: number; msg: string }[] } | null>(null);
  const [prog, setProg] = useState(0);
  const stop = useRef(false);
  const fs = importable(fields);

  function acceptTable(t: Table, label: string) {
    if (!t.length) { setErr('읽을 내용이 없습니다'); return; }
    const h = guessHeaderRow(t, fields);
    setTable(t); setSrc(label); setHdr(h); setMap(autoMap(t[h] || [], fields)); setErr(''); setDone(null);
  }
  async function onFile(f: File | undefined) {
    if (!f) return; setErr('');
    try { acceptTable(await readFile(f), f.name); } catch (e: any) { setErr(e?.message || '파일을 읽지 못했습니다'); }
  }
  function onPaste() { acceptTable(parseDelimited(paste), '붙여넣기'); }
  function pickHeader(h: number) { if (!table) return; setHdr(h); setMap(autoMap(table[h] || [], fields)); }

  const result = useMemo(() => (table ? buildRows(table, map, fields, { headerRow: hdr }) : null), [table, map, hdr, fields]);
  const headers = table ? table[hdr] || [] : [];
  const width = table ? Math.max(headers.length, ...table.slice(hdr + 1, hdr + 6).map((r) => r.length)) : 0;

  async function run() {
    if (!result || !result.bodies.length) return;
    if (projectScoped && !projectId) { setErr('먼저 상단에서 프로젝트를 선택하세요'); return; }
    setBusy(true); setProg(0); stop.current = false;
    const fail: { row: number; msg: string }[] = []; let ok = 0;
    for (let i = 0; i < result.bodies.length; i++) {
      if (stop.current) { fail.push({ row: result.rowNos[i], msg: '중단해서 보내지 않음' }); continue; }
      const body = projectScoped ? { ...result.bodies[i], projectId } : result.bodies[i];
      try {
        const r = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        if (r.ok) ok++; else { const d = await r.json().catch(() => ({})); fail.push({ row: result.rowNos[i], msg: d.message || `등록 실패(${r.status})` }); }
      } catch { fail.push({ row: result.rowNos[i], msg: '네트워크 오류' }); }
      setProg(i + 1);
    }
    setBusy(false); setDone({ ok, fail });
    if (ok) onDone();
  }

  return (
    <div className="mscrim" onClick={() => !busy && onClose()}>
      <div className="modal imp-modal" role="dialog" aria-modal="true" aria-labelledby="impHead" onClick={(e) => e.stopPropagation()}>
        <div className="modal-h"><h3 id="impHead" style={{ margin: 0 }}>{title} 가져오기</h3><div className="sp" />
          <button className="iconbtn" onClick={onClose} disabled={busy} aria-label="닫기"><X style={{ width: 18 }} /></button></div>
        <div className="modal-b">
          {!table && (
            <div className="imp-step">
              <p className="muted" style={{ marginTop: 0 }}>엑셀(.xlsx)·CSV·이 화면에서 내보낸 엑셀 파일을 고르거나, 엑셀에서 복사한 표를 붙여 넣으세요. 첫 줄(또는 머리글 줄)의 열 이름으로 항목을 자동으로 짝짓습니다.</p>
              <label className="imp-drop">
                <Upload style={{ width: 22 }} /><span><b>파일 고르기</b> · .xlsx .csv .tsv .xls(내보낸 파일) · 10MB, 1,000행까지</span>
                <input type="file" accept=".xlsx,.csv,.tsv,.txt,.xls" onChange={(e) => onFile(e.target.files?.[0])} />
              </label>
              <div className="field" style={{ marginTop: 12 }}>
                <label htmlFor="impPaste">또는 붙여넣기</label>
                <textarea id="impPaste" className="in" rows={6} placeholder={'제목\t담당자\t마감일\n로그인 오류\t김PM\t2026-10-30'} value={paste} onChange={(e) => setPaste(e.target.value)} />
              </div>
              <button className="btn btn-pri" onClick={onPaste} disabled={!paste.trim()}>붙여 넣은 표 읽기</button>
            </div>
          )}
          {table && !done && result && (
            <div className="imp-step">
              <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                <span className="muted">{src} · {table.length}줄</span>
                <label style={{ fontSize: 13 }}>머리글 줄 <select className="in" style={{ width: 'auto', display: 'inline-block' }} value={hdr} onChange={(e) => pickHeader(Number(e.target.value))}>
                  {table.slice(0, 10).map((r, i) => <option key={i} value={i}>{i + 1}줄 · {r.filter(Boolean).slice(0, 3).join(', ').slice(0, 30)}</option>)}
                </select></label>
                <div className="sp" />
                <button className="btn btn-ghost" onClick={() => { setTable(null); setPaste(''); }}>다른 파일</button>
              </div>
              <div className="imp-wrap">
                <table className="tbl imp-tbl">
                  <thead>
                    <tr>{Array.from({ length: width }).map((_, ci) => (
                      <th key={ci} className="no-sort">
                        <div style={{ fontWeight: 800, textTransform: 'none', letterSpacing: 0, color: 'var(--text-2)' }}>{headers[ci] || `(${ci + 1}열)`}</div>
                        <select className="in" aria-label={`${headers[ci] || ci + 1 + '열'} 을 넣을 항목`} value={map[ci] || ''} onChange={(e) => { const n = map.slice(); while (n.length < width) n.push(''); for (let j = 0; j < n.length; j++) if (j !== ci && n[j] === e.target.value && e.target.value) n[j] = ''; n[ci] = e.target.value; setMap(n); }}>
                          <option value="">— 가져오지 않음</option>
                          {fs.map((f) => <option key={f.key} value={f.key}>{f.label}{f.required ? ' *' : ''}</option>)}
                        </select>
                      </th>))}</tr>
                  </thead>
                  <tbody>{table.slice(hdr + 1, hdr + 6).map((r, ri) => <tr key={ri}>{Array.from({ length: width }).map((_, ci) => <td key={ci} style={{ opacity: map[ci] ? 1 : 0.45 }}>{r[ci] || ''}</td>)}</tr>)}</tbody>
                </table>
              </div>
              <div className="imp-sum">
                <b>{result.bodies.length.toLocaleString('ko-KR')}건 등록 가능</b>
                {result.problems.length > 0 && <span className="imp-bad"> · 확인 필요 {result.problems.length.toLocaleString('ko-KR')}건(이 행들은 빼고 등록)</span>}
                {result.skippedEmpty > 0 && <span className="muted"> · 빈 줄 {result.skippedEmpty}개 건너뜀</span>}
              </div>
              {result.problems.length > 0 && (
                <ul className="imp-list">{result.problems.slice(0, 50).map((p, i) => <li key={i}>{p.row ? `${p.row}행 · ` : ''}{p.field && <b>{p.field}</b>} {p.msg}</li>)}
                  {result.problems.length > 50 && <li className="muted">외 {result.problems.length - 50}건</li>}</ul>
              )}
              {busy && <div className="imp-prog" role="progressbar" aria-valuemin={0} aria-valuemax={result.bodies.length} aria-valuenow={prog}><i style={{ width: `${(prog / Math.max(1, result.bodies.length)) * 100}%` }} /><span>{prog} / {result.bodies.length}</span></div>}
            </div>
          )}
          {done && (
            <div className="imp-step">
              <p style={{ fontSize: 15, marginTop: 0 }}><b>{done.ok.toLocaleString('ko-KR')}건 등록했습니다.</b>{done.fail.length > 0 && <span className="imp-bad"> {done.fail.length}건은 등록하지 못했습니다.</span>}</p>
              {done.fail.length > 0 && <ul className="imp-list">{done.fail.slice(0, 50).map((f, i) => <li key={i}>{f.row}행 · {f.msg}</li>)}</ul>}
            </div>
          )}
          {err && <div className="imp-bad" role="alert" style={{ marginTop: 10 }}>{err}</div>}
        </div>
        <div className="modal-f"><div className="sp" />
          {busy ? <button className="btn" onClick={() => { stop.current = true; }}>중단</button>
            : done ? <button className="btn btn-pri" onClick={onClose}>닫기</button>
            : <><button className="btn btn-ghost" onClick={onClose}>취소</button>
                <button className="btn btn-pri" disabled={!result || !result.bodies.length} onClick={run}>{result ? `${result.bodies.length.toLocaleString('ko-KR')}건 등록` : '등록'}</button></>}
        </div>
      </div>
    </div>
  );
}
