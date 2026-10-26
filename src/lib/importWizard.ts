// 공통 가져오기 마법사 — 순수 모듈(DB·next·DOM 의존 없음). 2026-10-26 PMS 개편 P0-2.
//
// 엑셀(.xlsx)·CSV·TSV·붙여넣기·이 앱이 내보낸 엑셀(HTML 표)을 표(문자열 2차원 배열)로 읽고,
// 머리글을 화면의 입력 항목(Field)에 자동으로 짝지은 뒤, 항목 규칙(필수·선택지·숫자·날짜)으로 검사한다.
// 등록은 화면이 기존 만들기 API(POST)로 한 건씩 보낸다 — 이 모듈은 서버·DB 를 모른다.
// .xlsx 는 외부 라이브러리 없이 읽는다: ZIP 중앙 목록 → 압축 해제(주입한 inflateRaw) → 시트 XML.

export type ImportField = {
  key: string; label: string; type?: string; required?: boolean; numeric?: boolean;
  options?: (string | { value: string; label: string })[]; optionsFrom?: string;
};
export type Table = string[][];
export type Problem = { row: number; field: string; msg: string };
export type BuildResult = { bodies: Record<string, any>[]; rowNos: number[]; problems: Problem[]; skippedEmpty: number };

export const MAX_ROWS = 1000;

/* ---------------- 표 읽기 ---------------- */

/** 구분자 추정 — 첫 줄에서 탭·쉼표·세미콜론 중 많은 것. */
export function detectDelimiter(text: string): string {
  const first = String(text || '').split(/\r?\n/, 1)[0] || '';
  const n = (c: string) => first.split(c).length - 1;
  const cand = [['\t', n('\t')], [',', n(',')], [';', n(';')]] as [string, number][];
  cand.sort((a, b) => b[1] - a[1]);
  return cand[0][1] > 0 ? cand[0][0] : ',';
}

/** CSV/TSV 읽기 — 큰따옴표 묶음·묶음 안 줄바꿈·"" 이스케이프 지원. */
export function parseDelimited(text: string, delim?: string): Table {
  const s = String(text || '').replace(/^﻿/, '');
  const d = delim || detectDelimiter(s);
  const out: Table = []; let row: string[] = []; let cell = ''; let q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
      continue;
    }
    if (c === '"' && cell === '') { q = true; continue; }
    if (c === d) { row.push(cell); cell = ''; continue; }
    if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(cell); out.push(row); row = []; cell = ''; continue;
    }
    cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); out.push(row); }
  return trimTable(out);
}

const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
export function decodeXml(v: string): string {
  return String(v || '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') { const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ''; }
    return ENT[e.toLowerCase()] ?? m;
  });
}

/** 이 앱이 내보낸 엑셀(HTML 표) 읽기. */
export function parseHtmlTable(html: string): Table {
  const out: Table = [];
  const rows = String(html || '').match(/<tr[\s\S]*?<\/tr>/gi) || [];
  for (const r of rows) {
    const cells = r.match(/<t[hd][^>]*>[\s\S]*?<\/t[hd]>/gi) || [];
    out.push(cells.map((c) => decodeXml(c.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')).trim()));
  }
  return trimTable(out);
}

/** 'B12' → 열 번호(0부터). */
export function colIndex(ref: string): number {
  const m = /^([A-Z]+)/i.exec(ref || ''); if (!m) return -1;
  let n = 0; for (const ch of m[1].toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function attr(tag: string, name: string): string {
  const m = new RegExp('\\s' + name + '="([^"]*)"').exec(tag); return m ? m[1] : '';
}

/** sharedStrings.xml → 문자열 목록(서식 조각 <r><t> 는 이어 붙인다). */
export function parseSharedStrings(xml: string): string[] {
  const out: string[] = [];
  for (const si of String(xml || '').match(/<si>[\s\S]*?<\/si>|<si\/>/g) || []) {
    const ts = si.replace(/<rPh[\s\S]*?<\/rPh>/g, '').match(/<t(?:\s[^>]*)?>[\s\S]*?<\/t>/g) || [];
    out.push(decodeXml(ts.map((t) => t.replace(/^<t[^>]*>|<\/t>$/g, '')).join('')));
  }
  return out;
}

/** 시트 XML → 표. */
export function parseSheetXml(xml: string, shared: string[]): Table {
  const out: Table = [];
  for (const rowXml of String(xml || '').match(/<row[\s>][\s\S]*?<\/row>/g) || []) {
    const rIdx = Number(attr(rowXml.slice(0, rowXml.indexOf('>') + 1), 'r')) - 1;
    const row: string[] = [];
    for (const cm of rowXml.match(/<c[\s>][^>]*?(?:\/>|>[\s\S]*?<\/c>)/g) || []) {
      const open = cm.slice(0, cm.indexOf('>') + 1);
      const t = attr(open, 't'); let ci = colIndex(attr(open, 'r')); if (ci < 0) ci = row.length;
      let v = '';
      if (t === 'inlineStr') v = decodeXml(((cm.match(/<t(?:\s[^>]*)?>[\s\S]*?<\/t>/g) || []).map((x) => x.replace(/^<t[^>]*>|<\/t>$/g, ''))).join(''));
      else {
        const vm = /<v>([\s\S]*?)<\/v>/.exec(cm); const raw = vm ? decodeXml(vm[1]) : '';
        if (t === 's') v = shared[Number(raw)] ?? '';
        else if (t === 'b') v = raw === '1' ? 'TRUE' : raw === '0' ? 'FALSE' : raw;
        else v = raw;
      }
      while (row.length < ci) row.push('');
      row[ci] = v;
    }
    const at = Number.isFinite(rIdx) && rIdx >= 0 ? rIdx : out.length;
    while (out.length < at) out.push([]);
    out[at] = row;
  }
  return trimTable(out);
}

export type InflateRaw = (data: Uint8Array) => Promise<Uint8Array>;

/** ZIP 에서 이름→내용(압축 해제된 바이트). 필요한 이름만 푼다. */
export async function unzipEntries(buf: ArrayBuffer | Uint8Array, want: (name: string) => boolean, inflateRaw: InflateRaw): Promise<Map<string, Uint8Array>> {
  const u = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const dv = new DataView(u.buffer, u.byteOffset, u.byteLength);
  let eocd = -1;
  for (let i = u.length - 22; i >= Math.max(0, u.length - 22 - 65535); i--) { if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; } }
  if (eocd < 0) throw new Error('엑셀(.xlsx) 파일이 아닙니다');
  const count = dv.getUint16(eocd + 10, true); let p = dv.getUint32(eocd + 16, true);
  const out = new Map<string, Uint8Array>(); const dec = new TextDecoder();
  for (let k = 0; k < count && p + 46 <= u.length; k++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
    const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
    const loc = dv.getUint32(p + 42, true);
    const name = dec.decode(u.subarray(p + 46, p + 46 + nlen));
    p += 46 + nlen + xlen + clen;
    if (!want(name)) continue;
    if (dv.getUint32(loc, true) !== 0x04034b50) continue;
    const start = loc + 30 + dv.getUint16(loc + 26, true) + dv.getUint16(loc + 28, true);
    const data = u.subarray(start, start + csize);
    if (method === 0) out.set(name, data);
    else if (method === 8) out.set(name, await inflateRaw(data));
  }
  return out;
}

/** .xlsx → 첫 시트 표. */
export async function readXlsx(buf: ArrayBuffer | Uint8Array, inflateRaw: InflateRaw): Promise<Table> {
  const files = await unzipEntries(buf, (n) => /^xl\/(workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|worksheets\/[^/]+\.xml)$/.test(n), inflateRaw);
  const txt = (n: string) => { const b = files.get(n); return b ? new TextDecoder().decode(b) : ''; };
  let sheet = '';
  const first = /<sheet\s[^>]*>/.exec(txt('xl/workbook.xml'));
  const rid = first ? attr(first[0], 'r:id') : '';
  if (rid) {
    const rel = (txt('xl/_rels/workbook.xml.rels').match(/<Relationship\s[^>]*>/g) || []).find((r) => attr(r, 'Id') === rid);
    const target = rel ? attr(rel, 'Target').replace(/^\/?xl\//, '').replace(/^\//, '') : '';
    if (target) sheet = 'xl/' + target;
  }
  if (!files.has(sheet)) sheet = files.has('xl/worksheets/sheet1.xml') ? 'xl/worksheets/sheet1.xml' : Array.from(files.keys()).find((n) => n.startsWith('xl/worksheets/')) || '';
  if (!sheet) throw new Error('시트를 찾지 못했습니다');
  return parseSheetXml(txt(sheet), parseSharedStrings(txt('xl/sharedStrings.xml')));
}

function trimTable(t: Table): Table {
  const rows = t.map((r) => r.map((c) => String(c ?? '').trim()));
  while (rows.length && rows[rows.length - 1].every((c) => !c)) rows.pop();
  return rows;
}

/* ---------------- 머리글 짝짓기 ---------------- */

const norm = (v: string) => String(v || '').toLowerCase().replace(/\(.*?\)|\[.*?\]/g, '').replace(/[\s*_\-·.:/]/g, '');
const SYN: Record<string, string[]> = {
  title: ['제목', '이름', '명칭', '건명', 'title', 'subject'],
  name: ['작업', '작업명', '업무', '업무명', '이름', 'name', 'task'],
  description: ['설명', '내용', '상세', '비고', 'description', 'detail'],
  assignee: ['담당', '담당자', '처리자', 'assignee', 'owner'],
  owner: ['담당', '담당자', '책임자', 'owner'],
  status: ['상태', '진행상태', 'status'],
  priority: ['우선순위', '중요도', 'priority'],
  code: ['코드', '번호', 'id', 'no', 'code'],
  startDate: ['시작', '시작일', '착수일', 'start', 'startdate'],
  endDate: ['종료', '종료일', '마감', '마감일', '완료예정일', 'end', 'enddate', 'due'],
  dueDate: ['마감', '마감일', '기한', '목표일', '완료예정일', 'due', 'duedate'],
  progress: ['진척', '진척률', '진행률', 'progress'],
  reqCode: ['요구사항', '요구사항코드', '요구사항id', 'req', 'reqcode'],
  category: ['분류', '구분', 'category'],
  type: ['유형', '종류', 'type'],
};

/** 짝지을 수 있는 항목(다른 행 id 를 가리키는 선택은 제외). */
export function importable(fields: ImportField[]): ImportField[] {
  return (fields || []).filter((f) => f && f.key && f.optionsFrom !== 'tasks');
}

/** 머리글 → 항목 key(없으면 ''). 같은 항목에 두 열이 붙지 않게 먼저 붙은 열이 이긴다. */
export function autoMap(headers: string[], fields: ImportField[]): string[] {
  const fs = importable(fields); const used = new Set<string>();
  return (headers || []).map((h) => {
    const n = norm(h); if (!n) return '';
    const hit = fs.find((f) => !used.has(f.key) && (norm(f.label) === n || norm(f.key) === n))
      || fs.find((f) => !used.has(f.key) && (SYN[f.key] || []).some((x) => norm(x) === n));
    if (!hit) return '';
    used.add(hit.key); return hit.key;
  });
}

/* ---------------- 값 검사·변환 ---------------- */

const optPairs = (f: ImportField) => (f.options || []).map((o) => (typeof o === 'string' ? { value: o, label: o } : o));

/** 엑셀 날짜 일련번호(1900 체계) → YYYY-MM-DD. */
export function excelSerialToYmd(n: number): string {
  const d = new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 86400000);
  return d.toISOString().slice(0, 10);
}

export function normDate(v: string): string | null {
  const s = String(v || '').trim(); if (!s) return '';
  let m = /^(\d{4})[-./년\s]+(\d{1,2})[-./월\s]+(\d{1,2})\s*일?(?:[ T].*)?$/.exec(s) || /^(\d{4})(\d{2})(\d{2})$/.exec(s);
  if (m) {
    const y = +m[1], mo = +m[2], d = +m[3];
    const dt = new Date(Date.UTC(y, mo - 1, d));
    if (dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d) return `${m[1]}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    return null;
  }
  if (/^\d{5}(\.\d+)?$/.test(s)) { const n = Number(s); if (n >= 20000 && n <= 80000) return excelSerialToYmd(n); }
  return null;
}

/** 한 칸 변환. 실패면 { error }. 빈 값은 { value: '' }. */
export function coerce(f: ImportField, raw: string): { value: any } | { error: string } {
  const s = String(raw ?? '').trim();
  if (!s) return f.required ? { error: '필수 값이 비었습니다' } : { value: '' };
  if (f.type === 'select' && f.options && f.options.length) {
    const ps = optPairs(f); const low = s.toLowerCase();
    const hit = ps.find((p) => p.value.toLowerCase() === low) || ps.find((p) => p.label.toLowerCase() === low)
      || ps.find((p) => p.label.toLowerCase().replace(/\s|%/g, '') === low.replace(/\s|%/g, ''));
    if (!hit) return { error: `선택지에 없는 값 "${s.slice(0, 20)}" (가능: ${ps.slice(0, 6).map((p) => p.label).join(', ')}${ps.length > 6 ? ' …' : ''})` };
    return { value: f.numeric ? Number(hit.value) : hit.value };
  }
  if (f.type === 'number' || f.numeric) {
    const n = Number(s.replace(/[,\s%원h]/g, ''));
    if (!Number.isFinite(n)) return { error: `숫자가 아닙니다 "${s.slice(0, 20)}"` };
    return { value: n };
  }
  if (f.type === 'date') {
    const d = normDate(s);
    if (d === null) return { error: `날짜 형식이 아닙니다 "${s.slice(0, 20)}" (예: 2026-10-26)` };
    return { value: d };
  }
  return { value: s.slice(0, 5000) };
}

/** 표 + 짝짓기 → 등록할 본문들. headerRow 다음 줄부터, 빈 줄은 건너뛴다. 문제가 있는 행은 본문에서 뺀다. */
export function buildRows(table: Table, mapping: string[], fields: ImportField[], opts: { headerRow?: number } = {}): BuildResult {
  const h = Math.max(0, opts.headerRow ?? 0);
  const fs = new Map(importable(fields).map((f) => [f.key, f]));
  const bodies: Record<string, any>[] = []; const rowNos: number[] = []; const problems: Problem[] = []; let skippedEmpty = 0;
  const mappedKeys = new Set(mapping.filter(Boolean));
  for (const f of fs.values()) if (f.required && !mappedKeys.has(f.key)) problems.push({ row: 0, field: f.label, msg: '필수 항목에 짝지은 열이 없습니다' });
  if (problems.length) return { bodies, rowNos, problems, skippedEmpty };
  const data = table.slice(h + 1);
  for (let i = 0; i < data.length; i++) {
    const r = data[i]; const rowNo = h + i + 2; // 엑셀 행 번호(1부터, 머리글 포함)
    if (!r || r.every((c) => !String(c || '').trim())) { skippedEmpty++; continue; }
    if (bodies.length + problems.length >= MAX_ROWS) { problems.push({ row: rowNo, field: '', msg: `한 번에 ${MAX_ROWS}행까지 가져옵니다 — 나머지는 나눠서 올려 주세요` }); break; }
    const body: Record<string, any> = {}; let bad = false;
    mapping.forEach((k, ci) => {
      if (!k) return; const f = fs.get(k); if (!f) return;
      const c = coerce(f, r[ci] ?? '');
      if ('error' in c) { problems.push({ row: rowNo, field: f.label, msg: c.error }); bad = true; }
      else if (c.value !== '') body[k] = c.value;
    });
    for (const f of fs.values()) if (f.required && !mappedKeys.has(f.key)) bad = true;
    if (!bad) { bodies.push(body); rowNos.push(rowNo); }
  }
  return { bodies, rowNos, problems, skippedEmpty };
}

/** 머리글 줄 추정 — 앞쪽 10줄 중 짝지어지는 칸이 가장 많은 줄. */
export function guessHeaderRow(table: Table, fields: ImportField[]): number {
  let best = 0, score = -1;
  for (let i = 0; i < Math.min(10, table.length); i++) {
    const n = autoMap(table[i], fields).filter(Boolean).length;
    if (n > score) { score = n; best = i; }
  }
  return best;
}
