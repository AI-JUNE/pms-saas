// 테넌트 격리 정적 점검 — 순수 모듈(DB·next 의존 0).
// 소스 텍스트에서 drizzle 문(db.select/insert/update/delete/execute)을 추출해
// 조직 스코프(orgId) 조건이 빠진 문을 찾아낸다. 테스트(tests/tenantScan.test.ts)가
// 실제 src/app/api/**/route.ts 와 핵심 lib 를 대상으로 실행하므로, 누락이 생기면 CI가 실패한다.
//
// 규칙
// - 기본 거부: 알 수 없는 테이블은 모두 테넌트 테이블로 간주해 orgId 를 요구한다.
// - GLOBAL_TABLES(users·sessions·permissions)는 org 컬럼이 없어 검사 대상에서 제외.
// - organizations 는 orgId 컬럼이 없고 `organizations.id` 로 스코프하므로 해당 참조를 요구한다.
// - insert 의 values 가 리터럴이 아니면(변수·map) 정적으로 판단할 수 없어 'indirect' 정보로만 남긴다.
// - db.execute(원시 SQL) 은 항상 'raw' 로 보고한다 — 허용 주석으로만 통과.
// - 의도적 예외는 해당 줄 또는 바로 윗줄에 `// tenant-scan: allow(<이유>)` 를 남긴다. 이유는 필수.

export type ScanKind = 'select' | 'insert' | 'update' | 'delete' | 'execute';
export type FindingLevel = 'missing' | 'raw' | 'indirect' | 'allowed';

export interface DbStatement {
  kind: ScanKind;
  table: string | null;   // 식별하지 못하면 null
  text: string;           // 문 전체(체이닝 포함)
  line: number;           // 1-based
  index: number;          // 소스 내 시작 오프셋
}

export interface Finding {
  file: string;
  line: number;
  kind: ScanKind;
  table: string | null;
  level: FindingLevel;
  reason: string;
}

export interface ScanReport {
  files: number;
  statements: number;
  findings: Finding[];       // allowed 포함 전체
  missing: Finding[];        // 실패 조건: 길이 0 이어야 한다
  raw: Finding[];
  indirect: Finding[];
  allowed: Finding[];
}

export const GLOBAL_TABLES = new Set(['users', 'sessions', 'permissions']);
export const ORG_ROOT_TABLE = 'organizations';
export const ALLOW_RE = /\/\/\s*tenant-scan:\s*allow\((.+?)\)/;

const START_RE = /\bdb\.(select|insert|update|delete|execute)\s*\(/g;
const OPEN = new Set(['(', '[', '{']);
const CLOSE = new Set([')', ']', '}']);

/** 시작 위치부터 하나의 문(체이닝 포함)의 끝 인덱스를 찾는다. 괄호 깊이 0에서 `;` `,` 또는 체이닝이 끊긴 줄바꿈에서 멈춘다. */
export function statementEnd(src: string, start: number): number {
  let depth = 0; let i = start; let quote: string | null = null;
  while (i < src.length) {
    const ch = src[i];
    if (quote) {
      if (ch === '\\') { i += 2; continue; }
      if (ch === quote) quote = null;
      i++; continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; i++; continue; }
    if (ch === '/' && src[i + 1] === '/') { // 줄 주석: 줄 끝까지 건너뜀
      const nl = src.indexOf('\n', i); i = nl < 0 ? src.length : nl; continue;
    }
    if (OPEN.has(ch)) { depth++; i++; continue; }
    if (CLOSE.has(ch)) { if (depth === 0) return i; depth--; i++; continue; }
    if (depth === 0) {
      if (ch === ';' || ch === ',') return i;
      if (ch === '\n') {
        // 다음 유의미 문자가 `.`(체이닝)이면 계속, 아니면 종료
        let j = i + 1; while (j < src.length && (src[j] === ' ' || src[j] === '\t' || src[j] === '\r' || src[j] === '\n')) j++;
        if (src[j] !== '.') return i;
      }
    }
    i++;
  }
  return src.length;
}

/** `open` 위치의 여는 괄호에 대응하는 닫는 괄호 인덱스(문자열 인식). 못 찾으면 src.length-1. */
export function matchingClose(src: string, open: number): number {
  let depth = 0; let quote: string | null = null;
  for (let i = open; i < src.length; i++) {
    const ch = src[i];
    if (quote) { if (ch === '\\') { i++; continue; } if (ch === quote) quote = null; continue; }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue; }
    if (OPEN.has(ch)) depth++;
    else if (CLOSE.has(ch)) { depth--; if (depth === 0) return i; }
  }
  return src.length - 1;
}

function lineOf(src: string, idx: number): number { let n = 1; for (let i = 0; i < idx; i++) if (src[i] === '\n') n++; return n; }

function tableOf(kind: ScanKind, text: string): string | null {
  if (kind === 'select') { const m = text.match(/\.from\(\s*([A-Za-z_$][\w$]*)\s*\)/); return m ? m[1] : null; }
  if (kind === 'execute') return null;
  const m = text.match(/^db\.(?:insert|update|delete)\s*\(\s*([A-Za-z_$][\w$.]*)\s*\)/); return m ? m[1] : null;
}

/** 소스에서 DB 문을 모두 추출한다. */
export function extractStatements(src: string): DbStatement[] {
  const out: DbStatement[] = []; START_RE.lastIndex = 0; let m: RegExpExecArray | null;
  while ((m = START_RE.exec(src))) {
    const start = m.index; const end = statementEnd(src, start); const text = src.slice(start, end).trim();
    const kind = m[1] as ScanKind;
    out.push({ kind, table: tableOf(kind, text), text, line: lineOf(src, start), index: start });
    START_RE.lastIndex = Math.max(START_RE.lastIndex, start + m[0].length);
  }
  return out;
}

/** 해당 줄 또는 바로 윗줄의 허용 주석 이유. 없으면 null. */
export function allowReason(src: string, line: number): string | null {
  const lines = src.split('\n');
  for (const ln of [lines[line - 1], lines[line - 2]]) { const m = ln ? ln.match(ALLOW_RE) : null; if (m && m[1].trim()) return m[1].trim(); }
  return null;
}

/** insert 의 values(...) 인자가 객체·배열 리터럴인지(=정적으로 orgId 검사 가능). */
export function insertValuesLiteral(text: string): boolean {
  const m = text.match(/\.values\(\s*([\[{])/); return !!m;
}

/**
 * 문 안의 스프레드 조건(`and(...conds)`)이 같은 파일 앞쪽에서 orgId 를 담아 선언됐는지 확인한다.
 * `const conds = [eq(t.orgId, ctx.orgId)]` / `const uw: any[] = [..., eq(t.orgId, ...)]` 형태를 인식한다.
 * 스프레드가 없으면 false, 있고 모두 해소되면 true.
 */
export function spreadHasOrgId(src: string, st: DbStatement): boolean {
  const names = Array.from(st.text.matchAll(/\.\.\.([A-Za-z_$][\w$]*)/g)).map((m) => m[1]);
  if (!names.length) return false;
  const before = src.slice(0, st.index);
  return names.every((n) => {
    const re = new RegExp(`(?:const|let|var)\\s+${n}\\b[^=\\n]*=\\s*\\[`, 'g');
    let last: RegExpExecArray | null = null; let m: RegExpExecArray | null;
    while ((m = re.exec(before))) last = m;
    if (!last) return false;
    const open = before.indexOf('[', last.index + last[0].length - 1);
    const close = matchingClose(before, open);
    return /\borgId\b/.test(before.slice(open, close + 1));
  });
}

/** 한 문을 판정한다. null 이면 문제 없음. src 를 주면 스프레드 조건 선언까지 추적한다. */
export function judge(st: DbStatement, src?: string): { level: FindingLevel; reason: string } | null {
  if (st.kind === 'execute') return { level: 'raw', reason: '원시 SQL — 허용 주석으로 사유를 남겨야 합니다' };
  const t = st.table;
  if (t && GLOBAL_TABLES.has(t)) return null;
  if (t === ORG_ROOT_TABLE) {
    if (st.kind === 'insert') return null; // 조직 생성 자체는 스코프 없음
    return /organizations\.id\b/.test(st.text) ? null : { level: 'missing', reason: 'organizations 문에 organizations.id 조건이 없습니다' };
  }
  if (st.kind === 'insert') {
    if (!insertValuesLiteral(st.text)) return { level: 'indirect', reason: 'values 가 리터럴이 아니라 정적 판단 불가(호출부에서 orgId 보장 필요)' };
    return /\borgId\b/.test(st.text) ? null : { level: 'missing', reason: 'insert values 에 orgId 가 없습니다' };
  }
  // select / update / delete
  if (/\borgId\b/.test(st.text)) return null;
  if (src && spreadHasOrgId(src, st)) return null;
  return { level: 'missing', reason: `${st.kind} 문에 orgId 조건이 없습니다(table=${t ?? '?'})` };
}

export interface SourceFile { path: string; src: string }

/** 여러 파일을 점검해 리포트를 만든다. */
export function scanSources(files: SourceFile[]): ScanReport {
  const findings: Finding[] = []; let statements = 0;
  for (const f of files) {
    const sts = extractStatements(f.src); statements += sts.length;
    for (const st of sts) {
      const j = judge(st, f.src); if (!j) continue;
      const allow = allowReason(f.src, st.line);
      if (allow) { findings.push({ file: f.path, line: st.line, kind: st.kind, table: st.table, level: 'allowed', reason: allow }); continue; }
      findings.push({ file: f.path, line: st.line, kind: st.kind, table: st.table, level: j.level, reason: j.reason });
    }
  }
  const by = (l: FindingLevel) => findings.filter((x) => x.level === l);
  return { files: files.length, statements, findings, missing: by('missing'), raw: by('raw'), indirect: by('indirect'), allowed: by('allowed') };
}

/** 사람이 읽는 요약(한국어). */
export function formatReport(r: ScanReport): string {
  const line = (f: Finding) => `  - ${f.file}:${f.line} [${f.level}] ${f.kind}${f.table ? `(${f.table})` : ''} — ${f.reason}`;
  const parts = [`파일 ${r.files}개 · DB 문 ${r.statements}건 · 누락 ${r.missing.length} · 원시SQL ${r.raw.length} · 간접insert ${r.indirect.length} · 허용 ${r.allowed.length}`];
  if (r.missing.length) parts.push('누락:', ...r.missing.map(line));
  if (r.raw.length) parts.push('원시 SQL:', ...r.raw.map(line));
  return parts.join('\n');
}
