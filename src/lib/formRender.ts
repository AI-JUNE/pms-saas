// 커스텀 산출물 양식(form_definitions) — 필드 정의 파서·검증·빌더 조작 순수 모듈(DB·next·React 의존 없음).
//
// `form_definitions.fields` 컬럼은 지금까지 **줄바꿈 구분 텍스트**(한 줄 = 항목명)로만 쓰였다.
// 동적 폼은 타입·필수·선택지가 필요하므로 **JSON 배열** 형식을 추가한다. 두 형식을 모두 읽는다:
//   · JSON  : [{"key":"reviewer","label":"검토자","type":"text","required":true}, …]
//   · lines : "검토자\n검토일\n결과"  → 전부 text 필드(key 는 f1·f2·…)
// 저장은 항상 JSON 으로 한다(빌더가 쓴 뒤로는 lines 로 되돌아가지 않는다). 모르는 타입·깨진 JSON 은
// 추측하지 않고 problems 로 보고한다.

export const FIELD_TYPES = ['text', 'number', 'date', 'select', 'textarea', 'checkbox'] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export const FIELD_TYPE_LABEL: Record<FieldType, string> = {
  text: '한 줄 텍스트', number: '숫자', date: '날짜', select: '선택', textarea: '여러 줄 텍스트', checkbox: '체크',
};

export interface FormFieldDef {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  /** select 전용 선택지. */
  options?: string[];
  placeholder?: string;
  hint?: string;
  /** number 전용 범위. */
  min?: number;
  max?: number;
}

export interface FieldError { field: string; code: string; message: string }

export const MAX_FIELDS = 60;
export const MAX_LABEL_LEN = 80;
export const MAX_TEXT_LEN = 2000;
export const MAX_TEXTAREA_LEN = 20000;
export const MAX_OPTIONS = 50;

const KEY_RE = /^[a-z][a-z0-9_]{0,39}$/;

export function isFieldType(v: unknown): v is FieldType {
  return (FIELD_TYPES as readonly string[]).includes(String(v ?? ''));
}

/** 라벨 → key 후보(영문·숫자·밑줄만). 한글만 있으면 f{n} 로. */
export function keyFor(label: unknown, idx: number): string {
  const s = String(label ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^[0-9]/, '');
  if (!s || !KEY_RE.test(s)) return `f${idx + 1}`;
  return s.slice(0, 40);
}

/** 정의 1건 정규화. 쓸 수 없는 입력이면 null + problem. */
export function normalizeDef(raw: unknown, idx: number, used: Set<string>): { def: FormFieldDef | null; problem: string | null } {
  if (!raw || typeof raw !== 'object') return { def: null, problem: `${idx + 1}번 항목: 객체가 아닙니다` };
  const o = raw as Record<string, unknown>;
  const label = String(o.label ?? '').trim();
  if (!label) return { def: null, problem: `${idx + 1}번 항목: 라벨이 비었습니다` };
  if (label.length > MAX_LABEL_LEN) return { def: null, problem: `${idx + 1}번 항목: 라벨이 ${MAX_LABEL_LEN}자를 넘습니다` };
  const typeRaw = o.type == null || o.type === '' ? 'text' : String(o.type);
  if (!isFieldType(typeRaw)) return { def: null, problem: `${idx + 1}번 항목(${label}): 모르는 타입 '${typeRaw}'` };
  let key = String(o.key ?? '').trim();
  if (!key || !KEY_RE.test(key)) key = keyFor(label, idx);
  let base = key; let n = 2;
  while (used.has(key)) key = `${base}_${n++}`;
  used.add(key);
  const def: FormFieldDef = { key, label, type: typeRaw };
  if (o.required === true) def.required = true;
  if (typeof o.placeholder === 'string' && o.placeholder.trim()) def.placeholder = o.placeholder.trim().slice(0, 120);
  if (typeof o.hint === 'string' && o.hint.trim()) def.hint = o.hint.trim().slice(0, 240);
  if (def.type === 'select') {
    const opts = Array.isArray(o.options) ? o.options : typeof o.options === 'string' ? o.options.split(/[\n,]/) : [];
    const clean = Array.from(new Set(opts.map((x) => String(x ?? '').trim()).filter(Boolean))).slice(0, MAX_OPTIONS);
    if (!clean.length) return { def: null, problem: `${idx + 1}번 항목(${label}): 선택 타입인데 선택지가 없습니다` };
    def.options = clean;
  }
  if (def.type === 'number') {
    const mn = Number(o.min); const mx = Number(o.max);
    if (o.min != null && o.min !== '' && Number.isFinite(mn)) def.min = mn;
    if (o.max != null && o.max !== '' && Number.isFinite(mx)) def.max = mx;
    if (def.min != null && def.max != null && def.min > def.max) return { def: null, problem: `${idx + 1}번 항목(${label}): 최소값이 최대값보다 큽니다` };
  }
  return { def, problem: null };
}

export interface ParsedDefs { defs: FormFieldDef[]; format: 'json' | 'lines' | 'empty'; problems: string[] }

/** fields 컬럼 원문 → 정의 목록. JSON 배열이면 json, 아니면 줄바꿈 텍스트로 본다. */
export function parseFieldDefs(raw: unknown): ParsedDefs {
  const s = String(raw ?? '').trim();
  if (!s) return { defs: [], format: 'empty', problems: [] };
  const used = new Set<string>();
  if (s.startsWith('[')) {
    let arr: unknown;
    try { arr = JSON.parse(s); } catch { return { defs: [], format: 'json', problems: ['JSON 을 해석할 수 없습니다'] }; }
    if (!Array.isArray(arr)) return { defs: [], format: 'json', problems: ['JSON 최상위가 배열이 아닙니다'] };
    const defs: FormFieldDef[] = []; const problems: string[] = [];
    arr.slice(0, MAX_FIELDS).forEach((x, i) => { const r = normalizeDef(x, i, used); if (r.def) defs.push(r.def); if (r.problem) problems.push(r.problem); });
    if (arr.length > MAX_FIELDS) problems.push(`항목이 ${MAX_FIELDS}개를 넘어 뒤는 무시했습니다`);
    return { defs, format: 'json', problems };
  }
  const lines = s.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, MAX_FIELDS);
  const defs = lines.map((label, i) => { const r = normalizeDef({ label, type: 'text' }, i, used); return r.def; }).filter((d): d is FormFieldDef => !!d);
  return { defs, format: 'lines', problems: [] };
}

/** 저장용 JSON(항상 배열, 들여쓰기 없음). */
export function serializeFieldDefs(defs: readonly FormFieldDef[]): string {
  return JSON.stringify(defs.map((d) => {
    const o: Record<string, unknown> = { key: d.key, label: d.label, type: d.type };
    if (d.required) o.required = true;
    if (d.options?.length) o.options = d.options;
    if (d.placeholder) o.placeholder = d.placeholder;
    if (d.hint) o.hint = d.hint;
    if (d.min != null) o.min = d.min;
    if (d.max != null) o.max = d.max;
    return o;
  }));
}

// ── 빌더 조작(불변) ───────────────────────────────────────────────────────────

export function addField(defs: readonly FormFieldDef[], partial: Partial<FormFieldDef> & { label: string }): { defs: FormFieldDef[]; problem: string | null } {
  if (defs.length >= MAX_FIELDS) return { defs: [...defs], problem: `항목은 최대 ${MAX_FIELDS}개까지입니다` };
  const used = new Set(defs.map((d) => d.key));
  const r = normalizeDef(partial, defs.length, used);
  if (!r.def) return { defs: [...defs], problem: r.problem };
  return { defs: [...defs, r.def], problem: null };
}

export function removeField(defs: readonly FormFieldDef[], key: string): FormFieldDef[] {
  return defs.filter((d) => d.key !== key);
}

/** 위(-1)/아래(+1)로 한 칸. 끝이면 그대로. */
export function moveField(defs: readonly FormFieldDef[], key: string, delta: -1 | 1): FormFieldDef[] {
  const i = defs.findIndex((d) => d.key === key);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= defs.length) return [...defs];
  const out = [...defs];
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}

export function updateField(defs: readonly FormFieldDef[], key: string, patch: Partial<FormFieldDef>): { defs: FormFieldDef[]; problem: string | null } {
  const i = defs.findIndex((d) => d.key === key);
  if (i < 0) return { defs: [...defs], problem: '항목을 찾을 수 없습니다' };
  const used = new Set(defs.filter((d) => d.key !== key).map((d) => d.key));
  const r = normalizeDef({ ...defs[i], ...patch, key }, i, used);
  if (!r.def) return { defs: [...defs], problem: r.problem };
  const out = [...defs]; out[i] = r.def;
  return { defs: out, problem: null };
}

// ── 값 검증·정규화 ─────────────────────────────────────────────────────────────

export type FormValues = Record<string, string | number | boolean | null>;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function realDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** 빈 값 판정(체크박스 false 는 비어 있지 않다 — 필수 체크는 true 를 요구한다). */
function isEmpty(v: unknown): boolean {
  return v == null || (typeof v === 'string' && v.trim() === '');
}

export function emptyValues(defs: readonly FormFieldDef[]): FormValues {
  const out: FormValues = {};
  for (const d of defs) out[d.key] = d.type === 'checkbox' ? false : '';
  return out;
}

/** 정의대로 값을 정규화하고 검증한다. 정의에 없는 키는 버린다(스키마 밖 데이터를 저장하지 않는다). */
export function validateFormValues(defs: readonly FormFieldDef[], input: Record<string, unknown> | null | undefined): { ok: boolean; values: FormValues; errors: FieldError[] } {
  const errors: FieldError[] = [];
  const values: FormValues = {};
  const src = input ?? {};
  for (const d of defs) {
    const raw = src[d.key];
    const err = (code: string, message: string) => errors.push({ field: d.key, code, message: `${d.label}: ${message}` });
    switch (d.type) {
      case 'checkbox': {
        const b = raw === true || raw === 'true' || raw === 1 || raw === '1' || raw === 'on';
        values[d.key] = b;
        if (d.required && !b) err('REQUIRED', '확인(체크)이 필요합니다');
        break;
      }
      case 'number': {
        if (isEmpty(raw)) { values[d.key] = null; if (d.required) err('REQUIRED', '필수 항목입니다'); break; }
        const n = typeof raw === 'number' ? raw : Number(String(raw).replace(/,/g, '').trim());
        if (!Number.isFinite(n)) { values[d.key] = null; err('TYPE', '숫자여야 합니다'); break; }
        if (d.min != null && n < d.min) err('RANGE', `${d.min} 이상이어야 합니다`);
        if (d.max != null && n > d.max) err('RANGE', `${d.max} 이하여야 합니다`);
        values[d.key] = n;
        break;
      }
      case 'date': {
        const s = isEmpty(raw) ? '' : String(raw).trim();
        values[d.key] = s || null;
        if (!s) { if (d.required) err('REQUIRED', '필수 항목입니다'); break; }
        if (!realDate(s)) err('FORMAT', 'YYYY-MM-DD 형식의 실제 날짜여야 합니다');
        break;
      }
      case 'select': {
        const s = isEmpty(raw) ? '' : String(raw).trim();
        values[d.key] = s || null;
        if (!s) { if (d.required) err('REQUIRED', '선택이 필요합니다'); break; }
        if (!(d.options ?? []).includes(s)) err('OPTION', '선택지에 없는 값입니다');
        break;
      }
      case 'textarea':
      case 'text':
      default: {
        const s = isEmpty(raw) ? '' : String(raw);
        const trimmed = d.type === 'textarea' ? s.replace(/\s+$/, '') : s.trim();
        values[d.key] = trimmed || null;
        if (!trimmed) { if (d.required) err('REQUIRED', '필수 항목입니다'); break; }
        const max = d.type === 'textarea' ? MAX_TEXTAREA_LEN : MAX_TEXT_LEN;
        if (trimmed.length > max) err('LENGTH', `${max.toLocaleString('ko-KR')}자를 넘을 수 없습니다`);
        break;
      }
    }
  }
  return { ok: errors.length === 0, values, errors };
}

/** 저장된 값 JSON → 객체(깨졌으면 빈 객체). */
export function parseFormValues(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object') return raw as Record<string, unknown>;
  const s = String(raw ?? '').trim();
  if (!s) return {};
  try { const v = JSON.parse(s); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch { return {}; }
}

/** 값 1개를 화면용 문자열로. */
export function displayValue(def: FormFieldDef, v: unknown): string {
  if (def.type === 'checkbox') return v === true || v === 'true' ? '예' : '아니요';
  if (v == null || v === '') return '—';
  if (def.type === 'number' && Number.isFinite(Number(v))) return Number(v).toLocaleString('ko-KR');
  return String(v);
}

/** 입력 1건 한 줄 요약(앞 3개 항목). */
export function summarizeEntry(defs: readonly FormFieldDef[], values: Record<string, unknown>, limit = 3): string {
  const parts: string[] = [];
  for (const d of defs) {
    const v = values[d.key];
    if (d.type !== 'checkbox' && (v == null || v === '')) continue;
    parts.push(`${d.label}: ${displayValue(d, v)}`);
    if (parts.length >= limit) break;
  }
  return parts.join(' · ');
}

/** 한눈 요약(운영 점검용). */
export function formRenderStatus(): { types: number; maxFields: number } {
  return { types: FIELD_TYPES.length, maxFields: MAX_FIELDS };
}
