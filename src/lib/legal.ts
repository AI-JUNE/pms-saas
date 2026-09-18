// 법적 문서(이용약관·개인정보 처리방침) 레지스트리 — 순수 모듈(DB·next 의존 0, env 는 인자로 주입).
//
// 배경: 문안 확정은 법무·사람의 몫이다. 이 모듈이 담당하는 것은 **문안이 확정되었을 때 코드를 고치지 않고
// 반영되도록 하는 배선**이다. 즉 버전·시행일·초안/확정 상태를 한 곳에서 해석하고, 동의 요구·재동의 판정을
// 순수 함수로 제공한다.
//
// build now, activate on approval:
//  - 기본 상태는 **draft**(초안). LEGAL_DOCS_FINAL=true 이고 문서별 버전·시행일이 env 로 주어져야 'final' 이 된다.
//    → 확정본 반영은 [승인 필요]. 코드 배포 없이 env 만으로 전환된다.
//  - 가입 동의 강제는 LEGAL_CONSENT_REQUIRED=true 일 때만. 기본 OFF → 관측만 하고 가입을 막지 않는다.
//  - 동의 이력 영속화 테이블(legal_consents)은 아래 LEGAL_CONSENT_DDL **초안**으로만 둔다. lib/migrate.ts 의
//    MIGRATION_DDL 은 부팅 시 자동 실행되므로 거기에 넣지 않는다(tests/legal.test.ts 가 검사).
//    적용 전까지 동의 사실은 기존 감사로그(auditSecurity detail)에 **버전 스냅샷만** 남긴다.
//
// 이 모듈이 담당하지 않는 것: 문안 자체(각 page.tsx), 실제 법무 검토, 동의 철회 처리 화면.

export type LegalDocKey = 'terms' | 'privacy';
export type LegalStatus = 'draft' | 'final';

export interface LegalDoc {
  key: LegalDocKey;
  title: string;
  path: string;
  version: string;        // 'draft' 또는 확정 버전(예: '1.0')
  effectiveDate: string;  // 'YYYY-MM-DD', 미확정이면 ''
  status: LegalStatus;
  required: boolean;      // 가입 시 동의가 필요한 문서인가
}

export const LEGAL_DOC_KEYS: LegalDocKey[] = ['terms', 'privacy'];

const DEFS: Record<LegalDocKey, { title: string; path: string; required: boolean; envVersion: string; envEffective: string }> = {
  terms: { title: '서비스 이용약관', path: '/terms', required: true, envVersion: 'LEGAL_TERMS_VERSION', envEffective: 'LEGAL_TERMS_EFFECTIVE' },
  privacy: { title: '개인정보 처리방침', path: '/privacy', required: true, envVersion: 'LEGAL_PRIVACY_VERSION', envEffective: 'LEGAL_PRIVACY_EFFECTIVE' },
};

export const DRAFT_VERSION = 'draft';

// 동의 이력 DDL 초안 — 멱등. **MIGRATION_DDL 에 넣지 말 것**(부팅 자동 실행). 적용은 [승인 필요].
// 동의는 사실 기록이므로 갱신하지 않고 append 한다(재동의는 새 행).
export const LEGAL_CONSENT_DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS legal_consents (id serial PRIMARY KEY, user_id integer NOT NULL, org_id integer, doc_key text NOT NULL, version text NOT NULL, effective_date date, accepted_at timestamptz DEFAULT now() NOT NULL, source text DEFAULT 'register' NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS legal_consents_user_idx ON legal_consents (user_id, doc_key)`,
  `CREATE INDEX IF NOT EXISTS legal_consents_org_idx ON legal_consents (org_id)`,
];

// ── 버전·시행일 파싱 ────────────────────────────────────────────────
// 버전은 숫자.점 표기만 허용(1, 1.0, 2.1.3). 그 외는 null → 확정으로 보지 않는다.
export function parseDocVersion(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return /^\d+(\.\d+){0,2}$/.test(s) ? s : null;
}

// 시행일은 실존하는 YYYY-MM-DD 만 허용.
export function parseEffectiveDate(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return s;
}

// 확정 스위치. 기본 OFF → 모든 문서가 draft.
export function legalFinalEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.LEGAL_DOCS_FINAL === 'true';
}

// 가입 동의 강제 스위치. 기본 OFF → 미동의여도 거절하지 않는다(관측 모드).
export function consentRequired(env: Record<string, string | undefined> = process.env): boolean {
  return env.LEGAL_CONSENT_REQUIRED === 'true';
}

// 문서 1건 해석. 스위치 ON 이어도 버전·시행일이 유효하지 않으면 draft 로 남는다(fail-safe).
export function legalDoc(key: LegalDocKey, env: Record<string, string | undefined> = process.env): LegalDoc {
  const def = DEFS[key];
  const version = legalFinalEnabled(env) ? parseDocVersion(env[def.envVersion]) : null;
  const effectiveDate = legalFinalEnabled(env) ? parseEffectiveDate(env[def.envEffective]) : null;
  const final = version != null && effectiveDate != null;
  return {
    key,
    title: def.title,
    path: def.path,
    version: final ? version! : DRAFT_VERSION,
    effectiveDate: final ? effectiveDate! : '',
    status: final ? 'final' : 'draft',
    required: def.required,
  };
}

export function legalDocs(env: Record<string, string | undefined> = process.env): LegalDoc[] {
  return LEGAL_DOC_KEYS.map((k) => legalDoc(k, env));
}

// 초안 경고 배너 문구. 확정본이면 null(배너 없음) — 페이지가 문구를 하드코딩하지 않게 한다.
export function draftNotice(doc: LegalDoc): string | null {
  if (doc.status === 'final') return null;
  return doc.key === 'privacy'
    ? '본 방침은 초안입니다. 실제 개인정보 수집 개시 전 법무·보안 검토와 항목 확정이 필요합니다.'
    : '본 약관은 초안입니다. 실제 서비스 적용 전 법무 검토·확정이 필요합니다.';
}

// 문서 하단 메타 표기. 확정 전에는 임의 날짜를 쓰지 않고 '(초안)' 으로 남긴다.
export function docMetaLine(doc: LegalDoc, operator = '주식회사 고원'): string {
  const label = doc.key === 'privacy' ? '시행일' : '최종 개정';
  return doc.status === 'final'
    ? `운영: ${operator} · ${label}: ${doc.effectiveDate} · 버전 ${doc.version}`
    : `운영: ${operator} · ${label}: 확정 전 (초안)`;
}

// ── 동의 판정 ──────────────────────────────────────────────────────
export interface ConsentRecord { docKey: LegalDocKey; version: string }

// 가입 요청 body 에서 동의 입력 추출. 불리언 true 만 동의로 본다('true' 문자열·1 은 거부 — 오탐 방지).
export function parseConsentInput(body: unknown): LegalDocKey[] {
  const b = (body ?? {}) as Record<string, unknown>;
  const raw = b.agree ?? b.consents;
  const out: LegalDocKey[] = [];
  if (Array.isArray(raw)) {
    for (const k of raw) if (typeof k === 'string' && (LEGAL_DOC_KEYS as string[]).includes(k.trim())) {
      const key = k.trim() as LegalDocKey;
      if (!out.includes(key)) out.push(key);
    }
    return out;
  }
  if (raw && typeof raw === 'object') {
    for (const k of LEGAL_DOC_KEYS) if ((raw as Record<string, unknown>)[k] === true) out.push(k);
  }
  return out;
}

// 동의가 빠진 필수 문서. 확정 전(draft)에도 목록은 그대로 계산한다(강제 여부는 checkConsent 가 판단).
export function missingConsents(accepted: LegalDocKey[], env: Record<string, string | undefined> = process.env): LegalDocKey[] {
  return legalDocs(env).filter((d) => d.required && !accepted.includes(d.key)).map((d) => d.key);
}

export interface ConsentDecision {
  ok: boolean;
  enforced: boolean;
  missing: LegalDocKey[];
  snapshot: ConsentRecord[];   // 감사로그에 남길 버전 스냅샷(PII 없음)
  message?: string;
}

// 가입 시 동의 판정. 스위치 OFF 면 ok:true 이되 missing 은 그대로 보고한다(관측 모드).
export function checkConsent(body: unknown, env: Record<string, string | undefined> = process.env): ConsentDecision {
  const accepted = parseConsentInput(body);
  const docs = legalDocs(env);
  const missing = docs.filter((d) => d.required && !accepted.includes(d.key)).map((d) => d.key);
  const snapshot = docs.filter((d) => accepted.includes(d.key)).map((d) => ({ docKey: d.key, version: d.version }));
  const enforced = consentRequired(env);
  if (enforced && missing.length) {
    const names = missing.map((k) => DEFS[k].title).join('·');
    return { ok: false, enforced, missing, snapshot, message: `${names}에 동의해야 가입할 수 있습니다` };
  }
  return { ok: true, enforced, missing, snapshot };
}

// 재동의 필요 판정 — 문서가 확정본이고, 이용자가 동의한 버전이 현재 버전과 다르면 재동의.
// 초안(draft) 상태에서는 재동의를 요구하지 않는다(버전이 의미를 갖기 전이므로).
export function needsReconsent(doc: LegalDoc, accepted: ConsentRecord[]): boolean {
  if (doc.status !== 'final') return false;
  const mine = accepted.filter((c) => c.docKey === doc.key);
  if (!mine.length) return true;
  return !mine.some((c) => c.version === doc.version);
}

export function pendingReconsent(accepted: ConsentRecord[], env: Record<string, string | undefined> = process.env): LegalDocKey[] {
  return legalDocs(env).filter((d) => needsReconsent(d, accepted)).map((d) => d.key);
}

// 상태 요약(운영 점검·/health 용). 문안·PII 없음.
export function legalStatus(env: Record<string, string | undefined> = process.env): {
  final: boolean; consentEnforced: boolean; ddlDraftStatements: number;
  docs: { key: LegalDocKey; status: LegalStatus; version: string; effectiveDate: string }[];
} {
  return {
    final: legalFinalEnabled(env),
    consentEnforced: consentRequired(env),
    ddlDraftStatements: LEGAL_CONSENT_DDL.length,
    docs: legalDocs(env).map((d) => ({ key: d.key, status: d.status, version: d.version, effectiveDate: d.effectiveDate })),
  };
}
