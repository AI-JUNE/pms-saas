// 개인정보 처리방침의 **고지 의무 항목** 레지스트리 — 순수 모듈(DB·next 의존 0, env 는 인자로 주입).
//
// 배경(실제 결함): 처리방침 §5 는 「수탁자·위탁업무를 본 방침에 고지합니다」라고 **약속**하면서
// 정작 수탁자 목록을 싣지 않았고, 국외 이전(해외 클라우드) 고지 항목은 아예 없었다.
// 개인정보 보호법은 처리위탁 시 수탁자·위탁업무를, 국외 이전 시 이전받는 자·국가·항목·목적·
// 보유기간·거부 방법을 **공개**하도록 요구한다. 약속만 하고 비어 있는 상태는 그 자체로 하자다.
//
// 이 모듈이 하는 일: 고지 내용을 **env 로만** 받아 구조화하고, 페이지가 그것을 렌더하도록 배선한다.
// 이 모듈이 하지 않는 일: 수탁자·국가·보유기간을 **추측하거나 기본값으로 심는 것**.
//   → 호스팅·DB·PG 업체명을 코드에 박지 않는다(사실 확인과 계약 확인은 사람 몫).
//     tests/legalDisclosure.test.ts 가 이 모듈 원문에 업체명 리터럴이 없음을 매번 검사한다.
//
// build now, activate on approval:
//   미설정이면 페이지는 목록을 지어내지 않고, **아직 고지된 내용이 없다**고 밝힌 뒤
//   `auditDisclosure()` 가 `promised_not_disclosed` 로 결함을 드러낸다. [승인·사실확인 필요]

// ── 타입 ───────────────────────────────────────────────────────────
/** 처리위탁 1건. contact 는 공개 노출 시 제거한다(담당자 PII 방지). */
export interface Processor {
  name: string;      // 수탁자
  purpose: string;   // 위탁업무 내용
  contact?: string;  // 내부 참조용(공개 제외)
}

/** 국외 이전 1건. 보호법이 요구하는 6개 항목을 모두 갖춰야 유효로 본다. */
export interface CrossBorderTransfer {
  name: string;      // 이전받는 자
  country: string;   // 이전되는 국가
  items: string;     // 이전 항목
  purpose: string;   // 이용 목적
  retention: string; // 보유·이용 기간
  refusal: string;   // 거부 방법·절차
}

export type DisclosureIssueCode =
  | 'promised_not_disclosed' // 고지하겠다고 써 놓고 목록이 비어 있음
  | 'incomplete_row'         // 필수 항목 누락 행
  | 'duplicate_row'          // 같은 대상 중복
  | 'parse_error';           // env 형식 오류

export interface DisclosureIssue {
  code: DisclosureIssueCode;
  section: 'processors' | 'transfers';
  message: string;
}

export const PROCESSOR_ENV = 'PRIVACY_PROCESSORS';
export const TRANSFER_ENV = 'PRIVACY_CROSS_BORDER';

/** 국외 이전 고지의 필수 항목. 하나라도 비면 그 행은 버린다(부분 고지는 오히려 오해를 만든다). */
export const TRANSFER_FIELDS: (keyof CrossBorderTransfer)[] = [
  'name', 'country', 'items', 'purpose', 'retention', 'refusal',
];

// ── 파싱 ───────────────────────────────────────────────────────────
const clean = (v: unknown): string => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '');

/** 과도하게 긴 입력은 자른다(레이아웃 파괴·로그 오염 방지). */
const MAX_LEN = 200;
const field = (v: unknown): string => clean(v).slice(0, MAX_LEN);

function parseJsonArray(raw: string): unknown[] | null {
  if (!raw.startsWith('[')) return null;
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

/**
 * 처리위탁 목록 파싱. 두 형식을 받는다(settlement.ts 의 요율 로더와 같은 관례):
 *   1) JSON: `[{"name":"...","purpose":"...","contact":"..."}]`
 *   2) 축약: `수탁자|위탁업무;수탁자|위탁업무`
 * 이름·업무 중 하나라도 비면 incomplete_row 로 보고하고 목록에서 제외한다.
 */
export function parseProcessors(raw: unknown): { rows: Processor[]; issues: DisclosureIssue[] } {
  const issues: DisclosureIssue[] = [];
  const rows: Processor[] = [];
  const s = clean(raw);
  if (!s) return { rows, issues };

  const push = (name: string, purpose: string, contact: string, at: number) => {
    if (!name || !purpose) {
      issues.push({ code: 'incomplete_row', section: 'processors', message: `처리위탁 ${at}번 행: 수탁자·위탁업무가 모두 필요하다` });
      return;
    }
    if (rows.some((r) => r.name === name && r.purpose === purpose)) {
      issues.push({ code: 'duplicate_row', section: 'processors', message: `처리위탁 중복: ${name}` });
      return;
    }
    rows.push(contact ? { name, purpose, contact } : { name, purpose });
  };

  const arr = parseJsonArray(s);
  if (arr) {
    arr.forEach((r, i) => {
      const o = (r && typeof r === 'object' ? r : {}) as Record<string, unknown>;
      push(field(o.name), field(o.purpose), field(o.contact), i + 1);
    });
    return { rows, issues };
  }
  if (s.startsWith('[') || s.startsWith('{')) {
    issues.push({ code: 'parse_error', section: 'processors', message: `${PROCESSOR_ENV}: JSON 배열로 읽을 수 없다` });
    return { rows, issues };
  }

  s.split(';').map((x) => x.trim()).filter(Boolean).forEach((part, i) => {
    const [name, purpose, contact] = part.split('|').map((x) => field(x));
    push(name ?? '', purpose ?? '', contact ?? '', i + 1);
  });
  return { rows, issues };
}

/**
 * 국외 이전 목록 파싱. JSON 객체 배열만 받는다(항목이 6개라 축약 표기는 오기 위험이 크다).
 * 필수 6항목 중 하나라도 비면 incomplete_row 로 보고하고 **싣지 않는다**.
 */
export function parseTransfers(raw: unknown): { rows: CrossBorderTransfer[]; issues: DisclosureIssue[] } {
  const issues: DisclosureIssue[] = [];
  const rows: CrossBorderTransfer[] = [];
  const s = clean(raw);
  if (!s) return { rows, issues };

  const arr = parseJsonArray(s);
  if (!arr) {
    issues.push({ code: 'parse_error', section: 'transfers', message: `${TRANSFER_ENV}: JSON 배열로 읽을 수 없다` });
    return { rows, issues };
  }

  arr.forEach((r, i) => {
    const o = (r && typeof r === 'object' ? r : {}) as Record<string, unknown>;
    const row = {} as CrossBorderTransfer;
    const missing: string[] = [];
    for (const k of TRANSFER_FIELDS) {
      const v = field(o[k]);
      if (!v) missing.push(k);
      row[k] = v;
    }
    if (missing.length) {
      issues.push({ code: 'incomplete_row', section: 'transfers', message: `국외이전 ${i + 1}번 행: 누락 항목(${missing.join(', ')}) — 부분 고지는 싣지 않는다` });
      return;
    }
    if (rows.some((x) => x.name === row.name && x.country === row.country)) {
      issues.push({ code: 'duplicate_row', section: 'transfers', message: `국외이전 중복: ${row.name}` });
      return;
    }
    rows.push(row);
  });
  return { rows, issues };
}

// ── 설정 로드 ──────────────────────────────────────────────────────
export interface DisclosureConfig {
  processors: Processor[];
  transfers: CrossBorderTransfer[];
  issues: DisclosureIssue[];
}

export function disclosureConfig(env: Record<string, string | undefined> = process.env): DisclosureConfig {
  const p = parseProcessors(env[PROCESSOR_ENV]);
  const t = parseTransfers(env[TRANSFER_ENV]);
  return { processors: p.rows, transfers: t.rows, issues: [...p.issues, ...t.issues] };
}

/** 공개용 — 내부 담당자 연락처를 제거한다. */
export function publicProcessor(r: Processor): { name: string; purpose: string } {
  return { name: r.name, purpose: r.purpose };
}

export function publicProcessors(rows: Processor[]): { name: string; purpose: string }[] {
  return rows.map(publicProcessor);
}

// ── 페이지 문구 파생 ───────────────────────────────────────────────
// 페이지가 '없음'·'해당 없음' 을 하드코딩하지 않도록, 미고지 상태 문구도 여기서 만든다.
// 핵심: 미고지일 때 **"위탁하지 않는다"고 말하지 않는다**(사실이 아닐 수 있다). "아직 고지 전"이라고만 한다.

export const PENDING_PROCESSORS =
  '수탁자·위탁업무 목록은 아직 고지 전입니다. 확정 전까지 본 방침은 위탁 현황을 공개하지 않은 상태이며, 실제 개인정보 수집 개시 전 확정·게시가 필요합니다.';

export const PENDING_TRANSFERS =
  '국외 이전 현황은 아직 고지 전입니다. 이전받는 자·국가·항목·목적·보유기간·거부 방법을 확정하여 게시하기 전에는 개인정보를 국외로 이전하지 않습니다.';

/** 처리위탁 절 본문. 목록이 있으면 null(표로 렌더), 없으면 미고지 안내 문구. */
export function processorNotice(cfg: Pick<DisclosureConfig, 'processors'>): string | null {
  return cfg.processors.length ? null : PENDING_PROCESSORS;
}

export function transferNotice(cfg: Pick<DisclosureConfig, 'transfers'>): string | null {
  return cfg.transfers.length ? null : PENDING_TRANSFERS;
}

// ── 무결성 점검 ────────────────────────────────────────────────────
/**
 * 「고지하겠다」는 약속과 실제 고지 내용을 대조한다.
 * promisesDisclosure=true(페이지가 고지를 약속함)인데 목록이 비면 promised_not_disclosed.
 */
export function auditDisclosure(
  cfg: DisclosureConfig,
  opts: { promisesProcessors?: boolean; promisesTransfers?: boolean } = {},
): { ok: boolean; issues: DisclosureIssue[] } {
  const issues = [...cfg.issues];
  if (opts.promisesProcessors && cfg.processors.length === 0) {
    issues.push({ code: 'promised_not_disclosed', section: 'processors', message: `처리방침이 수탁자 고지를 약속하지만 ${PROCESSOR_ENV} 가 비어 있다` });
  }
  if (opts.promisesTransfers && cfg.transfers.length === 0) {
    issues.push({ code: 'promised_not_disclosed', section: 'transfers', message: `처리방침이 국외이전 고지를 약속하지만 ${TRANSFER_ENV} 가 비어 있다` });
  }
  return { ok: issues.length === 0, issues };
}

/** 운영 점검용 요약(민감정보 제외). */
export function disclosureStatus(env: Record<string, string | undefined> = process.env): {
  processors: number; transfers: number; issues: number; disclosed: boolean;
} {
  const cfg = disclosureConfig(env);
  return {
    processors: cfg.processors.length,
    transfers: cfg.transfers.length,
    issues: cfg.issues.length,
    disclosed: cfg.processors.length > 0,
  };
}
