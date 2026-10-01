// 환경변수 **단일 레지스트리** + 복구문서 정합성 가드 — 순수 모듈(next·DB·process.env 의존 없음).
//
// ── 왜 필요한가 ──────────────────────────────────────────────────────────────
// `RUNBOOK.md` §4 는 시크릿 복구 절차를 이렇게 약속한다:
//   "값 자체는 이 저장소에 커밋하지 않는다. 키 **목록**만 안전한 비밀 보관소에
//    스냅샷으로 유지하고, 값은 각 발급처에서 재발급한다."
// 즉 **그 목록이 복구의 전부**다. 그런데 §4 의 목록은 2026-09-05 작성 당시의 11개에서
// 멈춰 있었고, 그 뒤 법적 문서(LEGAL_*·PRIVACY_*)·파트너 채널(PARTNER_*)·리허설
// (RECOVERY_*)·요금제(ENTITLEMENTS_ENFORCE·PRICING_*)·사이트(SITE_URL 계열) 가
// 20개 넘게 늘었다. 그 상태로 복구하면 서비스는 뜨지만 **조용히 다른 서비스가 된다**:
//   · `LEGAL_DOCS_FINAL` 유실 → 확정본 약관·처리방침이 운영에서 「초안」 배너로 되돌아간다.
//   · `PRIVACY_PROCESSORS`·`PRIVACY_CROSS_BORDER` 유실 → 처리위탁·국외이전 고지가
//     「아직 고지 전」으로 되돌아간다(고지 의무 후퇴).
//   · `PARTNER_COMMISSION_RATES` 유실 → 정산이 `rate_unconfigured` 로 계산을 멈춘다.
// 어느 것도 500 을 내지 않으므로 사람이 알아채기 어렵다. 그래서 목록을 코드에 정본으로
// 두고, 테스트가 **실제 소스에서 읽는 키**와 **RUNBOOK §4 가 적어 둔 키**를 매번
// 대조한다 — 둘 중 하나가 어긋나면 CI 가 실패한다.
//
// ── 이 모듈이 하지 않는 것 ──────────────────────────────────────────────────
//  · 값을 읽지 않는다. `process.env` 를 건드리지 않으므로 어디서든 불러도 안전하다.
//  · 값을 담지 않는다. 실제 시크릿은 Vercel 환경변수에만 있다.
//  · 소스를 고치지 않는다. **판정만** 한다(appRoutes·tenantScan 과 같은 역할).

/**
 * 키의 성격.
 *  - `required` : 없으면 서비스가 동작하지 않는다.
 *  - `switch`   : 활성화 스위치. `'true'` 문자열일 때만 ON, 그 외(미설정·`1`·`yes`)는 OFF.
 *  - `secret`   : 유출되면 피해가 발생하는 값. 소스에 기본값을 두지 않는다.
 *  - `config`   : 동작을 바꾸는 설정값(시크릿 아님).
 *  - `platform` : 플랫폼(Vercel·Node)이 자동 주입한다. **사람이 복구할 대상이 아니다.**
 */
export type EnvKind = 'required' | 'switch' | 'secret' | 'config' | 'platform';

export interface EnvVar {
  key: string;
  kind: EnvKind;
  /** RUNBOOK §4 의 묶음 이름. 복구 시 함께 다루는 단위다. */
  group: string;
  /** 한 줄 설명(운영 담당자용). 값·예시 시크릿을 넣지 않는다. */
  note: string;
  /**
   * 소스에서 `process.env.KEY` 꼴로 직접 읽지 않고 **문자열 상수를 거쳐** 접근하는 키.
   * 값은 그 문자열 리터럴이 있는 파일(저장소 루트 기준 상대경로).
   * 예: `legal.ts` 의 `envVersion: 'LEGAL_TERMS_VERSION'` → `env[def.envVersion]`.
   */
  indirectIn?: string;
}

/**
 * 전 환경변수 정본. 새 env 를 읽기 시작하면 여기에 먼저 추가해야 테스트가 통과한다.
 * 순서는 RUNBOOK §4 의 서술 순서를 따른다.
 */
export const ENV_VARS: EnvVar[] = [
  // ── 필수 ──
  { key: 'DATABASE_URL', kind: 'secret', group: '필수', note: 'Neon Postgres 연결 문자열. 유일한 상태 저장소' },
  { key: 'SESSION_COOKIE', kind: 'config', group: '필수', note: '세션 쿠키 이름(미설정 시 pms_session). 바꾸면 기존 세션이 모두 무효가 된다' },

  // ── 관측 ──
  { key: 'MONITORING_ENABLED', kind: 'switch', group: '관측', note: '외부 에러 리포트 전송 스위치. SENTRY_DSN 과 둘 다 있어야 켜진다' },
  { key: 'SENTRY_DSN', kind: 'secret', group: '관측', note: '에러 리포트 수집 엔드포인트. 미설정 시 로깅은 무해하게 no-op' },
  { key: 'ALERT_WEBHOOK_URL', kind: 'secret', group: '관측', note: '치명 오류 알림 웹훅. 미설정 시 알림만 생략' },
  { key: 'LOG_LEVEL', kind: 'config', group: '관측', note: '구조화 로그 최소 레벨' },
  { key: 'APP_VERSION', kind: 'config', group: '관측', note: '/api/health 가 노출하는 버전 표기' },

  // ── 결제(기본 OFF, 활성화는 승인) ──
  { key: 'PORTONE_STORE_ID', kind: 'config', group: '결제', note: '포트원 상점 ID. 미설정 시 테스트 더미값으로 스캐폴딩 동작' },
  { key: 'PORTONE_CHANNEL_KEY', kind: 'config', group: '결제', note: '포트원 채널 키. 미설정 시 테스트 더미값' },
  { key: 'PORTONE_API_SECRET', kind: 'secret', group: '결제', note: '포트원 서버 API 시크릿. 클라이언트 노출 금지' },
  { key: 'PORTONE_WEBHOOK_SECRET', kind: 'secret', group: '결제', note: '결제 웹훅 서명 검증 키' },
  { key: 'PAYMENTS_LIVE', kind: 'switch', group: '결제', note: '실결제 경로 개방. 복구 후 반드시 OFF 확인 [활성화 승인 필요]' },
  { key: 'BILLING_APPLY_LIVE', kind: 'switch', group: '결제', note: '웹훅 결과를 DB 에 실제 반영. 복구 후 반드시 OFF 확인 [활성화 승인 필요]' },

  // ── 요금제·엔타이틀먼트 ──
  { key: 'ENTITLEMENTS_ENFORCE', kind: 'switch', group: '요금제', note: '좌석·기능 제한을 관측에서 **차단**으로 승격 [활성화 승인 필요]' },
  { key: 'PRICING_FREE_TRIAL_SEATS', kind: 'config', group: '요금제', note: '가격 페이지 무료 체험 좌석 수. 미설정 시 화면이 아무 약속도 하지 않는다' },

  // ── 법적 문서(유실 시 조용히 「초안」으로 되돌아간다) ──
  { key: 'LEGAL_DOCS_FINAL', kind: 'switch', group: '법적 문서', note: '약관·처리방침을 확정본으로 전환. OFF 면 초안 배너 노출' },
  { key: 'LEGAL_TERMS_VERSION', kind: 'config', group: '법적 문서', note: '이용약관 버전. 하나라도 무효면 draft 유지(fail-safe)', indirectIn: 'src/lib/legal.ts' },
  { key: 'LEGAL_TERMS_EFFECTIVE', kind: 'config', group: '법적 문서', note: '이용약관 시행일(YYYY-MM-DD)', indirectIn: 'src/lib/legal.ts' },
  { key: 'LEGAL_PRIVACY_VERSION', kind: 'config', group: '법적 문서', note: '개인정보 처리방침 버전', indirectIn: 'src/lib/legal.ts' },
  { key: 'LEGAL_PRIVACY_EFFECTIVE', kind: 'config', group: '법적 문서', note: '개인정보 처리방침 시행일(YYYY-MM-DD)', indirectIn: 'src/lib/legal.ts' },
  { key: 'LEGAL_CONSENT_REQUIRED', kind: 'switch', group: '법적 문서', note: '미동의 가입 거절. OFF 면 관측만 [활성화 승인 필요]' },
  { key: 'PRIVACY_PROCESSORS', kind: 'config', group: '법적 문서', note: '처리위탁 고지 목록. 유실 시 고지가 「아직 고지 전」으로 되돌아간다', indirectIn: 'src/lib/legalDisclosure.ts' },
  { key: 'PRIVACY_CROSS_BORDER', kind: 'config', group: '법적 문서', note: '국외 이전 고지(법정 6항목 전부 필요). 유실 시 고지 후퇴', indirectIn: 'src/lib/legalDisclosure.ts' },

  // ── 파트너 채널(전부 기본 OFF) ──
  { key: 'PARTNER_CHANNEL_ENABLED', kind: 'switch', group: '파트너 채널', note: '파트너(채널) 개념 활성화. OFF 면 전건 직접 계약 [활성화 승인 필요]' },
  { key: 'PARTNER_ATTRIBUTION_ENABLED', kind: 'switch', group: '파트너 채널', note: '매출 귀속 기록 활성화 [활성화 승인 필요]' },
  { key: 'PARTNER_ROLE_ENABLED', kind: 'switch', group: '파트너 채널', note: 'partner_admin 역할 활성화. OFF 면 아무 권한도 없다 [활성화 승인 필요]' },
  { key: 'PARTNER_SETTLEMENT_ENABLED', kind: 'switch', group: '파트너 채널', note: '정산 리포트 활성화 [활성화 승인 필요]' },
  { key: 'PARTNER_COMMISSION_RATES', kind: 'config', group: '파트너 채널', note: '파트너별 수수료율. 유실 시 계산을 멈추고 rate_unconfigured 로 표시한다' },
  { key: 'PARTNER_COMMISSION_ROUNDING', kind: 'config', group: '파트너 채널', note: '수수료 절사 방식(floor/round/ceil, 기본 floor)' },
  { key: 'PARTNER_COMMISSION_BASIS', kind: 'config', group: '파트너 채널', note: '수수료 기준액(net/gross, 기본 net)' },

  // ── 복구 리허설(RUNBOOK §6 과 같은 키) ──
  { key: 'RECOVERY_REHEARSAL_INTERVAL_DAYS', kind: 'config', group: '복구 리허설', note: '리허설 주기(일). 미설정 시 기한 판정 보류 — 임의 기본 주기 없음' },
  { key: 'RECOVERY_LAST_REHEARSAL', kind: 'config', group: '복구 리허설', note: '마지막 리허설 일자(YYYY-MM-DD)' },
  { key: 'RECOVERY_LAST_REHEARSAL_RESULT', kind: 'config', group: '복구 리허설', note: '마지막 리허설 결과(정상/부분 통과/실패)' },
  { key: 'RECOVERY_LAST_REHEARSAL_KIND', kind: 'config', group: '복구 리허설', note: '마지막 리허설 유형(정기/사건). 선택' },

  // ── 사이트·포털 ──
  { key: 'SITE_URL', kind: 'config', group: '사이트', note: 'canonical·robots·sitemap 의 정본 origin' },
  { key: 'NEXT_PUBLIC_SITE_URL', kind: 'config', group: '사이트', note: 'SITE_URL 대체값. 클라이언트 번들에 인라인된다' },
  { key: 'NEXT_PUBLIC_ERM_URL', kind: 'config', group: '사이트', note: '사내 제안분석(ERM) 바로가기. 미설정 시 링크를 만들지 않는다(주소를 지어내지 않는다)' },

  // ── 플랫폼 자동 주입(복구 대상 아님) ──
  { key: 'NODE_ENV', kind: 'platform', group: '플랫폼', note: 'Node 실행 모드' },
  { key: 'NEXT_RUNTIME', kind: 'platform', group: '플랫폼', note: 'Next 런타임 구분(nodejs/edge)' },
  { key: 'VERCEL_ENV', kind: 'platform', group: '플랫폼', note: '배포 환경(production/preview/development). HSTS·robots 판정에 쓴다' },
  { key: 'VERCEL_URL', kind: 'platform', group: '플랫폼', note: '배포 인스턴스 URL' },
  { key: 'VERCEL_PROJECT_PRODUCTION_URL', kind: 'platform', group: '플랫폼', note: '운영 도메인' },
  { key: 'VERCEL_GIT_COMMIT_SHA', kind: 'platform', group: '플랫폼', note: '배포 커밋 해시(/api/health 가 7자리로 노출)' },
  { key: 'VERCEL_GIT_COMMIT_REF', kind: 'platform', group: '플랫폼', note: '배포 브랜치명' },
  { key: 'VERCEL_REGION', kind: 'platform', group: '플랫폼', note: '실행 리전' },
  { key: 'GIT_COMMIT_SHA', kind: 'platform', group: '플랫폼', note: 'Vercel 외 플랫폼용 커밋 해시 대체값' },
  { key: 'COMMIT_SHA', kind: 'platform', group: '플랫폼', note: '커밋 해시 대체값' },
  { key: 'SOURCE_VERSION', kind: 'platform', group: '플랫폼', note: '커밋 해시 대체값(Heroku 계열)' },
  { key: 'GIT_BRANCH', kind: 'platform', group: '플랫폼', note: '브랜치명 대체값' },
];

/** 레지스트리 조회(정확 일치). */
export function envVar(key: unknown): EnvVar | null {
  const k = String(key ?? '').trim();
  if (!k) return null;
  return ENV_VARS.find((v) => v.key === k) ?? null;
}

/** 등록된 전체 키. */
export function envKeys(): string[] {
  return ENV_VARS.map((v) => v.key);
}

/**
 * **사람이 복구해야 하는** 키 — 플랫폼 자동 주입은 제외한다.
 * RUNBOOK §4 가 빠짐없이 적어야 하는 목록이 바로 이것이다.
 */
export function restorableVars(): EnvVar[] {
  return ENV_VARS.filter((v) => v.kind !== 'platform');
}

/** 복구 대상 키를 group 순서대로 묶는다(문서·체크리스트 생성용). */
export function restorableGroups(): Array<{ group: string; vars: EnvVar[] }> {
  const out: Array<{ group: string; vars: EnvVar[] }> = [];
  for (const v of restorableVars()) {
    const last = out.find((g) => g.group === v.group);
    if (last) last.vars.push(v);
    else out.push({ group: v.group, vars: [v] });
  }
  return out;
}

/** 활성화 스위치 키(기본 OFF 여야 하는 것들). */
export function switchKeys(): string[] {
  return ENV_VARS.filter((v) => v.kind === 'switch').map((v) => v.key);
}

/** env 키처럼 생긴 토큰인가 — 대문자·숫자에 밑줄이 **최소 1개**(GET·DB·PITR 같은 약어 제외). */
const ENV_KEY_RE = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/;
export const isEnvKeyToken = (s: unknown): boolean => ENV_KEY_RE.test(String(s ?? ''));

/**
 * 소스 본문에서 **직접 읽는** env 키를 뽑는다.
 * 지원 형태: `process.env.KEY` · `env.KEY` · `env['KEY']`.
 * 문자열 상수를 거치는 간접 접근(`env[def.envVersion]`)은 원리상 잡을 수 없다 —
 * 그쪽은 레지스트리의 `indirectIn` 으로 선언하고 테스트가 해당 파일에서 리터럴을 확인한다.
 */
export function scanEnvReads(src: unknown): string[] {
  const s = String(src ?? '');
  const out = new Set<string>();
  for (const m of s.matchAll(/\benv\.([A-Za-z_][A-Za-z0-9_]*)/g)) {
    if (isEnvKeyToken(m[1])) out.add(m[1]);
  }
  for (const m of s.matchAll(/\benv\[\s*['"]([^'"]+)['"]\s*\]/g)) {
    if (isEnvKeyToken(m[1])) out.add(m[1]);
  }
  return [...out].sort();
}

/**
 * 소스에서 찾은 키 ↔ 레지스트리 대조.
 *  - `unregistered`: 코드가 읽는데 레지스트리에 없다 → 복구 목록에서 빠질 키다.
 *  - `stale`: 레지스트리에 있는데 코드 어디에도 없다 → 지워야 할 유령 항목.
 * `indirectIn` 이 선언된 키는 직접 읽기 스캔으로 잡히지 않으므로 stale 판정에서 뺀다.
 */
export function auditEnvReads(foundKeys: readonly string[]): { unregistered: string[]; stale: string[] } {
  const found = new Set(foundKeys.map((k) => String(k)));
  const known = new Set(envKeys());
  const unregistered = [...found].filter((k) => !known.has(k)).sort();
  const stale = ENV_VARS.filter((v) => !v.indirectIn && !found.has(v.key)).map((v) => v.key).sort();
  return { unregistered, stale };
}

/**
 * RUNBOOK 본문에서 §4(환경변수·시크릿 복구) 절만 떼어낸다.
 * 절을 못 찾으면 빈 문자열 — 호출부가 "문서 구조가 바뀌었다"로 실패시킬 수 있다.
 */
export function runbookSection4(md: unknown): string {
  const s = String(md ?? '');
  const start = s.search(/^##\s*4\.\s/m);
  if (start < 0) return '';
  const rest = s.slice(start);
  const next = rest.search(/^##\s(?!\s*4\.)/m);
  return next > 0 ? rest.slice(0, next) : rest;
}

/** 문서 구간에서 백틱으로 감싼 env 키 토큰을 뽑는다(중복 제거). */
export function parseDocumentedKeys(section: unknown): string[] {
  const s = String(section ?? '');
  const out = new Set<string>();
  for (const m of s.matchAll(/`([^`]+)`/g)) {
    const t = m[1].trim();
    if (isEnvKeyToken(t)) out.add(t);
  }
  return [...out].sort();
}

/**
 * RUNBOOK §4 커버리지 점검.
 *  - `undocumented`: 복구해야 하는데 문서에 없다 → **복구 시 조용히 유실되는 설정**.
 *  - `unknownInDoc`: 문서에 있는데 코드가 쓰지 않는다 → 낡은 문구.
 * 플랫폼 자동 주입 키는 문서에 적어도 적지 않아도 되므로 양쪽에서 무시한다.
 */
export function auditDocCoverage(documentedKeys: readonly string[]): {
  undocumented: string[];
  unknownInDoc: string[];
} {
  const doc = new Set(documentedKeys.map((k) => String(k)));
  const platform = new Set(ENV_VARS.filter((v) => v.kind === 'platform').map((v) => v.key));
  const undocumented = restorableVars().filter((v) => !doc.has(v.key)).map((v) => v.key).sort();
  const known = new Set(envKeys());
  const unknownInDoc = [...doc].filter((k) => !known.has(k) && !platform.has(k)).sort();
  return { undocumented, unknownInDoc };
}

/**
 * 활성화 스위치 파싱 규율 점검.
 * 스위치는 **`=== 'true'` 비교만** 허용한다 — `Boolean(env.X)` 나 `!== 'false'` 는
 * 오설정(`0`·`off`·공백)을 ON 으로 읽어 "꺼 둔 줄 알았는데 켜져 있는" 사고를 만든다.
 * 반환: 규율을 어긴 지점(키 + 문제의 비교식 조각).
 */
export function auditSwitchParsing(src: unknown): Array<{ key: string; snippet: string }> {
  const s = String(src ?? '');
  const bad: Array<{ key: string; snippet: string }> = [];
  const keys = new Set(switchKeys());
  for (const m of s.matchAll(/\benv\.([A-Z][A-Z0-9_]*)/g)) {
    const key = m[1];
    if (!keys.has(key)) continue;
    const end = (m.index ?? 0) + m[0].length;
    const after = s.slice(end, end + 24);
    if (!/^\s*===\s*'true'/.test(after) && !/^\s*===\s*"true"/.test(after)) {
      bad.push({ key, snippet: (m[0] + after).replace(/\s+/g, ' ').trim() });
    }
  }
  return bad;
}

/**
 * `NEXT_PUBLIC_*` 은 Next 가 **클라이언트 번들에 평문으로 인라인**한다.
 * 그 접두사를 가진 시크릿은 공개 배포본에서 그대로 읽히므로 존재 자체가 사고다.
 */
export function auditPublicPrefix(): string[] {
  return ENV_VARS.filter((v) => v.key.startsWith('NEXT_PUBLIC_') && v.kind === 'secret')
    .map((v) => v.key)
    .sort();
}

/** 레지스트리 자체 무결성(키 중복·형식·설명 누락). */
export function auditRegistryShape(): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const v of ENV_VARS) {
    if (seen.has(v.key)) problems.push(`중복 키: ${v.key}`);
    seen.add(v.key);
    if (!isEnvKeyToken(v.key)) problems.push(`키 형식 위반: ${v.key}`);
    if (!v.note.trim()) problems.push(`설명 누락: ${v.key}`);
    if (!v.group.trim()) problems.push(`group 누락: ${v.key}`);
  }
  return problems;
}

/** 한눈 요약(운영 점검용). 화면에 쓰는 수치가 아니다. */
export function envRegistryStatus(): {
  total: number;
  restorable: number;
  switches: number;
  secrets: number;
  platform: number;
} {
  return {
    total: ENV_VARS.length,
    restorable: restorableVars().length,
    switches: ENV_VARS.filter((v) => v.kind === 'switch').length,
    secrets: ENV_VARS.filter((v) => v.kind === 'secret').length,
    platform: ENV_VARS.filter((v) => v.kind === 'platform').length,
  };
}
