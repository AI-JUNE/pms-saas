/**
 * rehearsalOutcome.ts — 리허설이 **무엇을 통과했는가**(RUNBOOK §6·§6-5). 2026-10-21
 *
 * ── 왜 필요한가 ───────────────────────────────────────────────────────────────
 * §6-2 는 리허설이 **어느 단위를 수행했는가**(`RECOVERY_LAST_REHEARSAL_SCOPE`)를,
 * §6-4 는 그 기록이 **어디에 남아 있는가**(표 ↔ env)를 본다. 둘이 깔고 있는 문장은 하나다 —
 * 「수행했다 = 검증됐다」. 그런데 §6 표의 `검증 결과` 어휘에는 **`부분 통과`** 가 있고
 * `lib/recovery.ts` 는 그것을 `failing` 으로 판정하면서 「**실패 항목을 조치하고** 재리허설한다」고
 * 지시한다 — **그 「실패 항목」을 적는 칸이 표에도 env 에도 없었다.** 결과는 전체 한 칸이고
 * 범위는 수행 여부 한 축이라, 「무엇이 통과하지 못했는가」가 들어갈 자리가 없다.
 *
 *  (1) **두 판정이 서로 다른 말을 하는데 아무도 합쳐 보지 않았다.** 범위에 전 단위를 적고
 *      결과를 `부분 통과` 로 적으면 `checks.rehearsalCoverage` 는 `ok`(「단위 N/N 검증」)이고
 *      `checks.recovery` 는 `failing` 이다. `assessCoverage` 는 기록된 단위를 **통과 여부와
 *      무관하게** covered 로 세기 때문이다(그 모듈의 한계로 선언돼 있다). 그 `ok` 를 읽는 쪽
 *      (§2-2 `signal` · §2 월 점검 · 마켓플레이스 보안 설명)은 그것을 「절차가 검증됐다」로 읽는다.
 *
 *  (2) **그래서 재수행 대상이 산출되지 않는다.** 다음 리허설 담당자가 체크리스트 첫 항목에서
 *      받는 안내는 `addedSinceRehearsal`(리허설 **뒤에** 절차에 들어온 단위)뿐이다. 지난번에
 *      통과하지 못한 단위는 **범위에 들어 있으니 `uncovered` 도 아니고**, 그래서 어느 목록에도
 *      나타나지 않는다 — 같은 단위를 또 건너뛰어도 아무 신호가 없다.
 *
 *  (3) **한 번 덮으면 되찾을 수 없다.** 판정이 읽는 쪽은 env 한 벌이라 다음 리허설이 결과를
 *      `정상` 으로 적는 순간 미통과 사실이 사라진다(§6-4 `latestLedgerRow` 도 **최신 행**만 본다).
 *      표에는 옛 행이 남지만 그 행을 **거슬러 읽는 판정이 없었다** — 미해소 미통과가
 *      「해소됐다」와 응답에서 글자 하나 다르지 않다.
 *
 *  (4) **그 값이 §1 의 약속을 재는 자가 된다.** §1-2 `rehearsalAttainment` 는 §6 표 최신 행의
 *      `소요시간` 을 RTO 실측으로 쓰는데 **`검증 결과` 를 보지 않았다.** 절차를 끝까지 가지 않은
 *      리허설은 당연히 짧으므로, `부분 통과` 의 소요시간이 그대로 `met`(= 목표를 지켰다)이 된다 —
 *      수치를 깎지 않으면서도 약속을 지킨 것으로 기록되는, 가장 조용한 방향이다.
 *
 * 그래서 이 모듈은
 *   · 「통과」의 경계를 한 곳에 두고(`outcomeState` — **`pass` 만 통과다**. 판독 불가는
 *     통과도 미통과도 아니다),
 *   · 미통과 단위를 **기록으로 받고**(`RECOVERY_LAST_REHEARSAL_UNPASSED` + §6 표 `미통과 단위`
 *     열 — 집을 둘로 둔다. §6-4 `auditFieldHomes` 의 규율이다),
 *   · 결과 칸과 그 기록을 **대조해**(`assessOutcome` → `unattributed`·`contradicts_result`·
 *     `outside_scope`) 한쪽만 믿지 않고,
 *   · **재수행 대상을 산출하고**(`remediationUnits` = 미통과 ∪ 범위에 없는 단위 ∪ 리허설 뒤에
 *     들어온 단위 — 이것이 이 장치의 쓸모다),
 *   · 표의 **이력을 거슬러** 미해소 미통과를 뽑고(`outstandingUnits` — §6-5 저장소 명령),
 *   · RTO 실측 자격을 한 곳에서 판정하고(`attainmentEligibility` — §1-2 가 이것을 통과 게이트로
 *     쓴다. 쓰지 않게 되돌아가면 `auditAttainmentGate` 가 CI 를 실패시킨다),
 *   · 그 상태를 `/api/health` 로 드러낸다(`rehearsalOutcomeCheck` — **required: false**).
 *
 * 원칙
 * - 순수 모듈: DB·next·fs·`process.env` 미접근, **신규 조회·쓰기·DDL 0**. env 는 인자로 받는다.
 * - **중복 보고 금지.** 리허설이 없으면 `no_rehearsal`, 결과를 못 읽으면 `unreadable_result` 로
 *   **판정을 보류한다** — 미실시·판독 불가는 `checks.recovery` 가 이미 말한다. 미통과가
 *   **귀속된** 상태(`attributed`)도 degraded 로 올리지 않는다(그 실패는 `failing` 이 말한다).
 *   이 체크가 말하는 것은 **귀속 여부**다.
 * - **임의 귀속 금지.** 기록이 없으면 「전 단위를 통과했을 것」으로 올리지 않고(`unattributed` 는
 *   **판정을 못 한 것**이다), 거꾸로 어느 단위가 실패했는지 코드가 고르지도 않는다.
 * - **값을 담지 않는다** — 단위 키(소절 번호)·판정·날짜·개수뿐이다(담당·비고·소요시간 없음).
 */
import { normalizeResult, parseRehearsalDate, type RehearsalResult } from './recovery.ts';
import {
  assessCoverage,
  COVERAGE_ENV,
  LAST_REHEARSAL_ENV,
  PROCEDURE_UNITS,
  parseCoverageRecord,
  type ProcedureUnit,
} from './rehearsalCoverage.ts';
import { latestLedgerRow, type LedgerField, type LedgerRow } from './rehearsalLedger.ts';

/** 응답·문서에서 근거 절을 찾을 수 있게 한다 */
export const OUTCOME_RUNBOOK_REF = 'RUNBOOK §6 · §6-5';

/** 미통과 단위 기록 키. **평상시 미설정이 정상**이고 영구 기록이다(임시 키가 아니다) */
export const OUTCOME_ENV = 'RECOVERY_LAST_REHEARSAL_UNPASSED';

/** §6 표에서 같은 값을 적는 열 — 집을 둘로 둔다(§6-4) */
export const OUTCOME_COLUMN = '미통과 단위';

/** 결과 칸 키(§6-4 와 같은 키를 쓴다 — 여기서 새로 읽지 않는다) */
export const RESULT_ENV = 'RECOVERY_LAST_REHEARSAL_RESULT';

const UNIT_TOKEN = /^\d{1,2}-\d{1,2}$/;
const NONE_TOKEN = /^(none|없음|-{1,3})$/i;

/* ─────────────────── 「통과」의 경계(한 곳에 둔다) ─────────────────── */

/**
 * - `passed`     : 결과가 `정상` 이다 — **이것만 통과다**.
 * - `not_passed` : `부분 통과`·`실패`. 둘을 합치는 이유는 **둘 다 재수행 대상을 남긴다**는 점이
 *                  같기 때문이다(어느 쪽인지는 `checks.recovery.detail.rehearsal.lastResult` 가 말한다).
 * - `unreadable` : 결과 칸을 판독할 수 없다 — 통과도 미통과도 아니다(§6-4 `unknown_result`).
 * - `no_record`  : 결과 칸이 비어 있다(= 리허설 기록이 아직 없다).
 */
export type OutcomeState = 'passed' | 'not_passed' | 'unreadable' | 'no_record';

/** `pass` 만 통과로 본다 — 「부분」을 통과로 올리지 않는다 */
export function outcomeState(result: unknown, filled?: boolean): OutcomeState {
  const raw = typeof result === 'string' ? result.trim() : result;
  const hasValue = filled ?? (typeof raw === 'string' ? raw.length > 0 : raw !== null && raw !== undefined);
  if (!hasValue) return 'no_record';
  const r: RehearsalResult = typeof raw === 'string' ? normalizeResult(raw) : (raw as RehearsalResult);
  if (r === 'pass') return 'passed';
  if (r === 'fail' || r === 'partial') return 'not_passed';
  return 'unreadable';
}

/* ─────────────────── 귀속하지 않으면 무엇이 잘못 말하는가(정본) ─────────────────── */

export interface OutcomeMisread {
  key: string;
  /** 잘못 말하는 판정 */
  reader: string;
  /** 그 판정이 내놓는 말 */
  says: string;
  /** 왜 그렇게 되는가 */
  why: string;
}

/**
 * 미통과를 **단위로 귀속하지 않을 때** 거짓이 되는 판정들 — 전건을 적어 두고 응답에 키를 싣는다.
 * 이 목록이 이 모듈의 존재 이유이고, 문서(§6-5)가 같은 키를 적고 있는지 CI 가 본다.
 */
export const OUTCOME_MISREADS: readonly OutcomeMisread[] = [
  {
    key: 'coverage_counts_unpassed',
    reader: 'checks.rehearsalCoverage.detail.verdict',
    says: '`ok` — 「단위 N/N 검증」',
    why: '`assessCoverage` 는 범위 기록에 **적힌** 단위를 통과 여부와 무관하게 covered 로 센다. 그래서 전 단위를 적고 결과를 `부분 통과` 로 적으면 범위 판정은 ok 다',
  },
  {
    key: 'freshness_points_nowhere',
    reader: 'checks.recovery.detail.rehearsal.action',
    says: '「실패 항목을 조치하고 재리허설한다」',
    why: '그 「실패 항목」을 적는 칸이 표에도 env 에도 없었다 — 지시는 있는데 가리킬 목록이 없다',
  },
  {
    key: 'rto_from_unpassed',
    reader: 'checks.recoveryObjectives.detail.attainment.rto',
    says: '`met` — 「목표를 지켰다」',
    why: '§1-2 `rehearsalAttainment` 가 §6 표 최신 행의 `소요시간` 을 `검증 결과` 와 무관하게 실측으로 썼다. 끝까지 가지 않은 리허설은 당연히 짧다',
  },
  {
    key: 'next_scope_blind',
    reader: 'checks.rehearsalCoverage.detail.addedSinceRehearsal',
    says: '리허설 **뒤에** 들어온 단위만',
    why: '통과하지 못한 단위는 범위에 들어 있으니 `uncovered` 도 아니다 — 다음 리허설 안내에서 빠지고, 또 건너뛰어도 신호가 없다',
  },
];

/** 어긋남의 세 방향 — 어느 쪽도 오류를 내지 않는다 */
export interface OutcomeDrift {
  key: string;
  when: string;
  effect: string;
}

export const OUTCOME_DRIFTS: readonly OutcomeDrift[] = [
  {
    key: 'attribution_lost',
    when: '다음 리허설이 결과를 `정상` 으로 적는다',
    effect: 'env 는 한 벌이라 미통과 기록이 덮인다 — 표에는 옛 행이 남지만 거슬러 읽는 판정이 없으면 **미해소 미통과가 해소된 것과 같아진다**(§6-5 저장소 명령이 그 이력을 본다)',
  },
  {
    key: 'scope_without_result',
    when: '범위에는 단위를 적고 미통과 칸은 비워 둔다',
    effect: '범위 판정은 `ok`, 신선도는 `failing` — 두 판정이 다른 말을 하는데 **어느 단위인지는 어디에도 없다**(`unattributed`)',
  },
  {
    key: 'result_without_scope',
    when: '미통과 칸에 범위 밖 단위를 적는다',
    effect: '수행하지 않은 단위를 「통과하지 못했다」로 적은 것이다 — 재수행 대상은 맞아도 **범위 기록이 거짓**이 된다(`outside_scope`)',
  },
];

export const OUTCOME_LIMITS: readonly string[] = [
  '기록은 「통과하지 못했다고 **적었다**」는 뜻이다 — 어느 단위가 실제로 실패했는지는 코드가 알 수 없다',
  '단위는 **소절**이라 그 안의 체크리스트 항목 중 무엇이 걸렸는지는 말하지 않는다(§6-2 와 같은 해상도다)',
  '`attributed` 는 **근거가 갖춰졌다**는 뜻이고 「실패가 해소됐다」가 아니다 — 실패 자체는 `checks.recovery` 가 `failing` 으로 말한다(중복 보고 금지)',
  '런타임은 저장소 파일을 읽지 않는다 — 표의 **이력**(미해소 미통과)은 §6-5 저장소 명령과 CI 가 본다',
  '`ok` 는 「이번 기록이 서로 맞는다」는 뜻이고 **둘 다 틀렸을 수 있다**(§6-4 와 같은 한계다)',
  '재수행 대상은 **다음 리허설이 포함해야 할 목록**이고, 기한을 말하지 않는다(주기는 `RECOVERY_REHEARSAL_INTERVAL_DAYS` 가 정하고 임의 재시도 기한을 만들지 않는다)',
  '§3 1~8단계 본 절차는 단위로 세지 않는다 — 그 수행은 체크리스트 항목과 `검증 결과` 가 말한다',
];

/* ───────────────────────────── 미통과 기록 ───────────────────────────── */

export interface UnpassedRecord {
  /** 기록을 적은 날(YYYY-MM-DD). 없으면 null — **지어내지 않는다** */
  asOf: string | null;
  /** 통과하지 못했다고 적힌 단위 키 */
  units: string[];
  /** 「미통과 없음」을 **명시**했는가(`units=none`) */
  explicitNone: boolean;
  /** 해석하지 못한 토큰 — 숨기지 않는다 */
  invalid: string[];
}

/**
 * 미통과 기록 판독. 두 형식만 받는다 —
 *   `asOf=2026-11-02;units=3-6,3-7`
 *   `{"asOf":"2026-11-02","units":["3-6"]}`
 * 사람 이름·비고·자유 메모는 받지 않는다(공개 엔드포인트에 나가는 값이다).
 * 해석 못 한 토큰은 `invalid` 로 돌려주고 **단위로 채택하지 않는다** — 일부만 읽으면
 * 재수행 대상이 조용히 짧아진다. `units=none` 은 「미통과 없음」을 **명시**한 것이다.
 */
export function parseUnpassedRecord(raw: unknown): UnpassedRecord | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;

  const out: UnpassedRecord = { asOf: null, units: [], explicitNone: false, invalid: [] };
  const units = new Set<string>();

  const take = (key: string, value: string) => {
    const v = value.trim();
    if (key === 'asof') {
      const d = parseRehearsalDate(v);
      if (d) out.asOf = d;
      else out.invalid.push(`asOf=${v.slice(0, 20)}`);
      return;
    }
    if (key === 'units') {
      if (!v || NONE_TOKEN.test(v)) {
        out.explicitNone = true;
        return;
      }
      for (const t of v.split(/[,\s]+/).filter(Boolean)) {
        if (UNIT_TOKEN.test(t)) units.add(t);
        else if (NONE_TOKEN.test(t)) out.explicitNone = true;
        else out.invalid.push(t.slice(0, 20));
      }
      return;
    }
    out.invalid.push(`${key.slice(0, 20)}=…`);
  };

  if (s.startsWith('{') || s.startsWith('[')) {
    let obj: unknown;
    try {
      obj = JSON.parse(s);
    } catch {
      return { asOf: null, units: [], explicitNone: false, invalid: ['json'] };
    }
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
      return { asOf: null, units: [], explicitNone: false, invalid: ['json'] };
    }
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (Array.isArray(v)) take(k.toLowerCase(), v.map((x) => String(x)).join(','));
      else take(k.toLowerCase(), String(v ?? ''));
    }
  } else if (NONE_TOKEN.test(s)) {
    out.explicitNone = true;
  } else if (UNIT_TOKEN.test(s) || /^[\d\s,-]+$/.test(s)) {
    // 단위만 적은 꼴(`3-6,3-7`)도 받는다 — 표의 칸에는 그렇게 적히는 것이 자연스럽다.
    take('units', s);
  } else {
    for (const seg of s.split(/[;\n]+/).map((x) => x.trim()).filter(Boolean)) {
      const eq = seg.indexOf('=');
      if (eq <= 0) {
        out.invalid.push(seg.slice(0, 20));
        continue;
      }
      take(seg.slice(0, eq).trim().toLowerCase(), seg.slice(eq + 1));
    }
  }

  out.units = [...units].sort();
  return out;
}

/** 왕복 가능한 기록 한 줄(§6-5 명령이 출력한다). 비실존 날짜는 지어내지 않고 생략한다 */
export function unpassedLine(units: readonly string[], asOf?: string | null): string {
  const date = parseRehearsalDate(asOf ?? '');
  const list = [...new Set(units.map((u) => String(u).trim()).filter((u) => UNIT_TOKEN.test(u)))].sort();
  const parts = [date ? `asOf=${date}` : null, `units=${list.length > 0 ? list.join(',') : 'none'}`];
  return parts.filter(Boolean).join(';');
}

/* ───────────────────────────── 표의 이력 ───────────────────────────── */

export interface OutstandingUnit {
  unit: string;
  /** 미통과로 **처음 적힌** 일자 */
  since: string;
  /** 그 뒤로 미통과로 다시 적힌 횟수(처음 포함) */
  times: number;
}

export interface OutstandingSummary {
  /** 아직 해소되지 않은 미통과 단위 */
  outstanding: OutstandingUnit[];
  /** 뒤 리허설이 수행하고 미통과로 적지 않아 해소된 단위 */
  resolved: string[];
  /** 결과를 판독할 수 없는 행의 일자 — **해소로 세지 않는다** */
  unreadableRows: string[];
  /** 미통과 칸을 해석하지 못한 행의 일자 */
  invalidRows: string[];
}

/**
 * §6 표를 **거슬러 읽어** 미해소 미통과를 뽑는다(§6-5 저장소 명령).
 *
 * 해소 규칙: 뒤 행의 **범위에 들어 있고** 그 행의 미통과 목록에 **없으면** 해소다.
 * 범위에 없으면 수행하지 않은 것이므로 해소로 세지 않는다 — 그래야 「적지 않아서 사라지는」
 * 길이 생기지 않는다. 결과를 판독할 수 없는 행은 어느 쪽으로도 세지 않는다.
 */
export function outstandingUnits(rows: readonly LedgerRow[], now?: Date): OutstandingSummary {
  const today = (now ?? new Date()).toISOString().slice(0, 10);
  const open = new Map<string, OutstandingUnit>();
  const resolved = new Set<string>();
  const unreadableRows: string[] = [];
  const invalidRows: string[] = [];

  const ordered = [...rows].filter((r) => r.date <= today).sort((a, b) => (a.date < b.date ? -1 : 1));
  for (const row of ordered) {
    const state = outcomeState(row.result);
    if (state === 'unreadable') {
      unreadableRows.push(row.date);
      continue; // 판독 불가 행은 해소도 미통과도 만들지 않는다
    }
    const rec = parseUnpassedRecord(row.unpassed);
    if (rec && rec.invalid.length > 0) invalidRows.push(row.date);
    const failed = new Set(rec ? rec.units : []);
    const scope = new Set(parseCoverageRecord(row.scope)?.units ?? []);

    for (const key of [...open.keys()]) {
      if (scope.has(key) && !failed.has(key)) {
        open.delete(key);
        resolved.add(key);
      }
    }
    for (const key of failed) {
      const prev = open.get(key);
      if (prev) open.set(key, { ...prev, times: prev.times + 1 });
      else open.set(key, { unit: key, since: row.date, times: 1 });
      resolved.delete(key);
    }
  }

  return {
    outstanding: [...open.values()].sort((a, b) => (a.unit < b.unit ? -1 : 1)),
    resolved: [...resolved].sort(),
    unreadableRows,
    invalidRows,
  };
}

/* ───────────────────── RTO 실측 자격(§1-2 의 게이트) ───────────────────── */

export interface AttainmentEligibility {
  /** 이 행의 `소요시간` 을 RTO 실측으로 쓸 수 있는가 */
  eligible: boolean;
  state: OutcomeState;
  why: string;
}

/**
 * §6 표 한 행의 소요시간이 **RTO 실측 자격**이 있는지. `정상` 만 자격이 있다 —
 * 절차를 끝까지 가지 않은 리허설은 당연히 짧고, 그 수치로 `met` 을 내면 **약속을 지킨 것으로
 * 기록된다**(수치를 깎지 않으면서 그렇게 된다). 자격이 없으면 `unjudged` 로 남긴다.
 */
export function attainmentEligibility(row: { result?: unknown } | null | undefined): AttainmentEligibility {
  if (!row) return { eligible: false, state: 'no_record', why: '§6 표에 리허설 행이 없다 — 실측이 아직 없다' };
  const state = outcomeState(row.result);
  if (state === 'passed') return { eligible: true, state, why: '검증 결과가 `정상` 이다 — 절차를 끝까지 간 소요시간이다' };
  if (state === 'not_passed') {
    return {
      eligible: false,
      state,
      why: '검증 결과가 완전 통과가 아니다 — 끝까지 가지 않은 소요시간을 RTO 실측으로 쓰면 약속을 지킨 것으로 기록된다',
    };
  }
  if (state === 'unreadable') {
    return { eligible: false, state, why: '검증 결과를 판독할 수 없다 — 판독 불가는 통과가 아니다(§6-4)' };
  }
  return { eligible: false, state, why: '검증 결과 칸이 비어 있다' };
}

/* ───────────────────────────── 판정 ───────────────────────────── */

export const OUTCOME_VERDICTS = [
  'no_rehearsal',
  'unreadable_result',
  'invalid_record',
  'unknown_units',
  'unattributed',
  'contradicts_result',
  'outside_scope',
  'attributed',
  'ok',
] as const;

export type OutcomeVerdict = (typeof OUTCOME_VERDICTS)[number];

const ACTION: Record<OutcomeVerdict, string> = {
  no_rehearsal: '리허설 기록이 없어 통과 여부를 물을 대상이 없다 — 미실시는 `checks.recovery` 가 `missing` 으로 말한다(RUNBOOK §6).',
  unreadable_result:
    `검증 결과를 판독할 수 없어 통과 여부를 가릴 수 없다 — ${RESULT_ENV} 에 §6 표와 같은 값(정상/부분 통과/실패)을 적는다(§6-4).`,
  invalid_record: `${OUTCOME_ENV} 에 해석하지 못한 토큰이 있다 — §6-5 명령이 출력한 \`asOf=…;units=…\` 꼴로 다시 적는다(일부만 읽으면 재수행 대상이 짧아진다).`,
  unknown_units: `${OUTCOME_ENV} 에 절차 단위가 아닌 키가 있다 — RUNBOOK 소절 번호(예: \`3-6\`)로만 적는다.`,
  unattributed:
    `검증 결과가 완전 통과가 아닌데 **어느 단위가 통과하지 못했는지**가 없다 — ${OUTCOME_ENV} 와 §6 표 \`${OUTCOME_COLUMN}\` 열에 단위 키를 적는다(§6-5). ` +
    '적지 않으면 다음 리허설이 재수행 대상을 산출할 수 없다.',
  contradicts_result:
    `검증 결과는 \`정상\` 인데 미통과 단위가 적혀 있다 — 둘 중 하나가 틀렸다. 통과했다면 ${OUTCOME_ENV} 를 비우고, 아니면 결과를 \`부분 통과\` 로 고친다(§6-5).`,
  outside_scope:
    '미통과로 적힌 단위가 범위 기록에 없다 — 수행하지 않은 단위를 「통과하지 못했다」로 적은 것이다. 범위(§6-2)와 미통과(§6-5)를 함께 맞춘다.',
  attributed:
    '미통과 단위가 기록되어 재수행 대상이 산출됐다 — `detail.remediation` 을 다음 리허설 범위에 넣는다(실패 자체는 `checks.recovery` 가 `failing` 으로 말한다).',
  ok: '결과와 미통과 기록이 서로 맞는다 — 「둘 다 틀렸을 수 있다」는 한계는 `limits` 에 적혀 있다.',
};

const VERDICT_NOTE: Record<OutcomeVerdict, string> = {
  no_rehearsal: '판정 보류 — 평상시 상태다(중복 보고 금지)',
  unreadable_result: '판정 보류 — 판독 불가는 `checks.recovery` 가 `unknown_result` 로 말한다',
  invalid_record: '기록을 채택하지 않았다 — 「미통과 없음」으로 올리지 않는다',
  unknown_units: '정본에 없는 단위 키 — 가리킬 소절이 없다',
  unattributed: '**판정을 못 한 것**이고 통과가 아니다',
  contradicts_result: '두 기록이 반대 말을 한다',
  outside_scope: '범위 기록이 거짓이다',
  attributed: '근거가 갖춰졌다 — 「해소됐다」가 아니다',
  ok: '이번 기록이 서로 맞는다',
};

export interface OutcomeAssessment {
  verdict: OutcomeVerdict;
  envKey: string;
  state: OutcomeState;
  lastRehearsal: string | null;
  recordedAsOf: string | null;
  /** 기록된 미통과 단위(정본에 있는 것) */
  unpassed: string[];
  /** 정본에 없는 단위 키 */
  unknownUnits: string[];
  /** 해석하지 못한 토큰 */
  invalid: string[];
  /** 범위 기록에 없는 미통과 단위 */
  outsideScope: string[];
  /** 다음 리허설이 **반드시 포함해야 하는** 단위 */
  remediation: string[];
  /** §6 표 `소요시간` 을 RTO 실측으로 쓸 수 있는가(§1-2 게이트와 같은 판정) */
  durationTrusted: boolean;
  /** 「미통과 없음」을 명시했는가 */
  explicitNone: boolean;
  action: string;
  caveats: readonly string[];
}

/**
 * 재수행 대상 — 미통과 ∪ 범위에 없는 단위 ∪ 리허설 뒤에 들어온 단위.
 * **합집합으로 두는 이유**: 세 목록이 서로 다른 이유로 「아직 검증되지 않았다」를 뜻하고,
 * 어느 하나만 보면 나머지가 조용히 빠진다(그것이 이 모듈이 생긴 이유다).
 */
export function remediationUnits(args: {
  unpassed: readonly string[];
  uncovered: readonly string[];
  addedSinceRehearsal: readonly string[];
}): string[] {
  const all = new Set<string>([...args.unpassed, ...args.uncovered, ...args.addedSinceRehearsal]);
  return [...all].filter((k) => UNIT_TOKEN.test(k)).sort();
}

/**
 * 판정. env 는 **인자로** 받는다.
 *
 * 판정 순서: 판정 보류(리허설 없음 → 결과 판독 불가) → 기록 자격 → **귀속 공백** →
 * 모순 → 범위 어긋남 → 귀속됨 → ok.
 * **거짓 `ok` 를 막는 것이 기록 자격보다 뒤에 오지 않게** 한다(§6-2·§6-4 와 같은 규율).
 */
export function assessOutcome(args: {
  env: Record<string, string | undefined>;
  units?: readonly ProcedureUnit[];
  now?: Date;
}): OutcomeAssessment {
  const env = args.env;
  const units = args.units ?? PROCEDURE_UNITS;
  const today = (args.now ?? new Date()).toISOString().slice(0, 10);
  const known = new Set(units.map((u) => u.key));

  const lastRehearsal = parseRehearsalDate(env[LAST_REHEARSAL_ENV]);
  const state = outcomeState(env[RESULT_ENV]);
  const record = parseUnpassedRecord(env[OUTCOME_ENV]);
  const coverage = assessCoverage({ env, units, now: args.now });
  const scopeRecord = parseCoverageRecord(env[COVERAGE_ENV]);

  const recorded = record ? record.units : [];
  const unknownUnits = recorded.filter((k) => !known.has(k)).sort();
  const unpassed = recorded.filter((k) => known.has(k)).sort();
  const scopeUnits = new Set(scopeRecord?.units ?? []);
  // 범위 기록이 아예 없으면 「범위 밖」을 말할 수 없다 — 없는 대조를 어긋남으로 만들지 않는다.
  const outsideScope = scopeRecord ? unpassed.filter((k) => !scopeUnits.has(k)) : [];
  const remediation = remediationUnits({
    unpassed,
    uncovered: coverage.uncovered,
    addedSinceRehearsal: coverage.addedSinceRehearsal,
  });

  const shell = {
    envKey: OUTCOME_ENV,
    state,
    lastRehearsal,
    recordedAsOf: record?.asOf ?? null,
    unpassed,
    unknownUnits,
    invalid: record?.invalid ?? [],
    outsideScope,
    remediation,
    durationTrusted: state === 'passed',
    explicitNone: record?.explicitNone ?? false,
    caveats: OUTCOME_LIMITS,
  };
  const done = (verdict: OutcomeVerdict): OutcomeAssessment => ({ ...shell, verdict, action: ACTION[verdict] });

  if (!lastRehearsal) return done('no_rehearsal');
  if (state === 'unreadable' || state === 'no_record') return done('unreadable_result');
  if (record && (record.invalid.length > 0 || (record.asOf && record.asOf > today))) return done('invalid_record');
  if (unknownUnits.length > 0) return done('unknown_units');
  // 「없음」으로 적는 것은 귀속이 아니다 — 결과가 미통과면 단위가 있어야 한다.
  if (state === 'not_passed' && unpassed.length === 0) return done('unattributed');
  if (state === 'passed' && unpassed.length > 0) return done('contradicts_result');
  if (outsideScope.length > 0) return done('outside_scope');
  if (state === 'not_passed') return done('attributed');
  return done('ok');
}

/* ───────────────────────────── 출력 ───────────────────────────── */

/**
 * `/api/health` 체크. **required: false** — 기록이 어긋났다고 서비스를 내리면 복구가 자기 자신을 막는다.
 * 평상시(`no_rehearsal`)는 ok 이고, `attributed`·`unreadable_result` 도 degraded 로 올리지 않는다
 * (실패·판독 불가는 `checks.recovery` 가 이미 말한다 — **중복 보고 금지**).
 * **값을 담지 않는다** — 단위 키·판정·날짜·개수뿐이다(소요시간·담당·비고 없음).
 */
export function rehearsalOutcomeCheck(args?: {
  env?: Record<string, string | undefined>;
  now?: Date;
}): { ok: boolean; required: false; detail: Record<string, unknown> } {
  const a = assessOutcome({ env: args?.env ?? process.env, now: args?.now });
  return {
    ok: a.verdict === 'ok' || a.verdict === 'no_rehearsal' || a.verdict === 'unreadable_result' || a.verdict === 'attributed',
    required: false,
    detail: {
      verdict: a.verdict,
      unpassedEnv: a.envKey,
      resultEnv: RESULT_ENV,
      tableColumn: OUTCOME_COLUMN,
      state: a.state,
      lastRehearsal: a.lastRehearsal,
      recordedAsOf: a.recordedAsOf,
      unpassed: a.unpassed,
      unpassedCount: a.unpassed.length,
      unknownUnits: a.unknownUnits,
      invalid: a.invalid,
      outsideScope: a.outsideScope,
      remediation: a.remediation,
      remediationCount: a.remediation.length,
      durationTrusted: a.durationTrusted,
      misreads: OUTCOME_MISREADS.map((m) => m.key),
      drifts: OUTCOME_DRIFTS.map((d) => d.key),
      runbook: OUTCOME_RUNBOOK_REF,
      limits: OUTCOME_LIMITS,
      action: a.action,
      note: VERDICT_NOTE[a.verdict],
    },
  };
}

/** 사람이 읽는 요약(§6-5 명령·보고용). 수치를 지어내지 않는다 */
export function outcomeText(a: OutcomeAssessment): string[] {
  const lines = [
    `판정: ${a.verdict} (${VERDICT_NOTE[a.verdict]})`,
    `리허설=${a.lastRehearsal ?? '미실시'} · 결과=${a.state} · 기록기준일=${a.recordedAsOf ?? '없음'}`,
    `미통과 단위: ${a.unpassed.join(', ') || '-'}`,
    `재수행 대상: ${a.remediation.join(', ') || '-'}`,
    `RTO 실측 자격: ${a.durationTrusted ? '있다' : '없다'}`,
  ];
  if (a.unknownUnits.length > 0) lines.push(`정본에 없는 단위: ${a.unknownUnits.join(', ')}`);
  if (a.invalid.length > 0) lines.push(`해석하지 못한 토큰: ${a.invalid.join(', ')}`);
  if (a.outsideScope.length > 0) lines.push(`범위 기록에 없는 미통과 단위: ${a.outsideScope.join(', ')}`);
  lines.push(`해야 할 일: ${a.action}`);
  return lines;
}

/** 운영 로그 한 줄 — 판정·단위 키·개수만 담는다(소요시간·담당·비고 없음) */
export function outcomeLogLine(a: OutcomeAssessment): string {
  const parts = [
    '[rehearsalOutcome]',
    `verdict=${a.verdict}`,
    `state=${a.state}`,
    `last=${a.lastRehearsal ?? '-'}`,
    `unpassed=${a.unpassed.length}`,
    `remediation=${a.remediation.length}`,
    `rtoMeasurable=${a.durationTrusted}`,
  ];
  if (a.outsideScope.length > 0) parts.push(`outsideScope=${a.outsideScope.join('|')}`);
  return parts.join(' ');
}

/** 배선 상태 요약(문서·보고용) */
export function rehearsalOutcomeStatus(env: Record<string, string | undefined>): {
  verdict: OutcomeVerdict;
  unpassed: number;
  remediation: number;
  misreads: number;
  limits: number;
  note: string;
} {
  const a = assessOutcome({ env });
  return {
    verdict: a.verdict,
    unpassed: a.unpassed.length,
    remediation: a.remediation.length,
    misreads: OUTCOME_MISREADS.length,
    limits: OUTCOME_LIMITS.length,
    note: VERDICT_NOTE[a.verdict],
  };
}

/* ───────────────────────────── 정적 점검 ───────────────────────────── */

/** 정본 모양 — 설명 공백·중복 키를 잡는다 */
export function auditOutcomeShape(
  misreads: readonly OutcomeMisread[] = OUTCOME_MISREADS,
  drifts: readonly OutcomeDrift[] = OUTCOME_DRIFTS,
): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const m of misreads) {
    if (seen.has(m.key)) problems.push(`잘못 읽히는 판정 ${m.key} 가 정본에 두 번 있다`);
    seen.add(m.key);
    if (!m.reader.trim() || !m.says.trim() || !m.why.trim()) {
      problems.push(`${m.key} 에 판정·그 말·이유 중 빈 칸이 있다`);
    }
  }
  const keys = new Set<string>();
  for (const d of drifts) {
    if (keys.has(d.key)) problems.push(`어긋남 방향 ${d.key} 가 정본에 두 번 있다`);
    keys.add(d.key);
    if (!d.when.trim() || !d.effect.trim()) problems.push(`어긋남 방향 ${d.key} 에 빈 칸이 있다`);
  }
  if (OUTCOME_LIMITS.length === 0) problems.push('보장하지 못하는 것이 하나도 적혀 있지 않다');
  return problems;
}

/**
 * 기록 키가 레지스트리에 있고 **임시 키 목록에는 없는지**.
 * 임시 키로 넣으면 §2 키 이름 스냅샷 대조에서 빠져(평상시 미설정이 정상인 키로 취급된다)
 * 복구 때 이 귀속 기록의 유실이 드러나지 않는다 — 재수행 대상의 근거는 **영구 기록**이다.
 */
export function auditRegistrySources(
  vars: readonly { key: string }[],
  transient: readonly string[],
): string[] {
  const problems: string[] = [];
  if (!vars.some((v) => v.key === OUTCOME_ENV)) problems.push(`${OUTCOME_ENV} 가 env 레지스트리에 없다`);
  if (transient.includes(OUTCOME_ENV)) {
    problems.push(`${OUTCOME_ENV} 가 임시 키 목록에 있다 — 귀속 기록은 평상시에도 남아 있어야 하는 영구 기록이다`);
  }
  return problems;
}

/**
 * 기록의 **집이 둘인지**(§6-4 `LEDGER_FIELDS`). env 에만 있으면 Promote 롤백·시크릿 유실로
 * 사라지는데, 그때 재수행 대상은 조용히 짧아진다(판정은 `unattributed` 로 내려앉는다).
 */
export function auditLedgerHome(fields: readonly LedgerField[]): string[] {
  const f = fields.find((x) => x.envKey === OUTCOME_ENV);
  if (!f) return [`§6-4 기록 정본에 ${OUTCOME_ENV} 칸이 없다 — 표 열과 env 키의 집 선언이 빠졌다`];
  const problems: string[] = [];
  if (f.column !== OUTCOME_COLUMN) problems.push(`칸 ${f.key} 의 표 열이 \`${OUTCOME_COLUMN}\` 이 아니다(${f.column})`);
  if (f.home !== 'both') problems.push(`칸 ${f.key} 의 집이 둘이 아니다(${f.home}) — 저장소에 남지 않으면 재수행 대상이 사라진다`);
  if (!f.judgedBy || !f.judgedBy.includes('rehearsalOutcome')) {
    problems.push(`칸 ${f.key} 를 읽는 판정이 선언돼 있지 않다 — 적히지만 아무도 읽지 않는 칸이 된다`);
  }
  return problems;
}

/**
 * **§1-2 가 이 게이트를 쓰는지**(`src/lib/recoveryObjectives.ts` 원문).
 * 쓰지 않으면 `부분 통과` 리허설의 소요시간이 다시 RTO `met` 의 근거가 되는데,
 * 응답은 그대로 200 이고 수치도 깎이지 않아 **사람 눈으로는 알아챌 수 없다**.
 */
export function auditAttainmentGate(objectivesSrc: unknown): string[] {
  const s = String(objectivesSrc ?? '');
  const problems: string[] = [];
  if (!/from\s+['"]\.\/rehearsalOutcome\.ts['"]/.test(s)) {
    problems.push('lib/recoveryObjectives.ts 가 rehearsalOutcome 를 import 하지 않는다 — RTO 실측 자격 판정이 빠졌다');
  }
  if (!/attainmentEligibility\(/.test(s)) {
    problems.push('lib/recoveryObjectives.ts 가 attainmentEligibility() 를 호출하지 않는다 — 검증 결과를 보지 않는 상태로 되돌아갔다');
  }
  if (!/eligib\w*\.eligible/.test(s)) {
    problems.push('attainmentEligibility() 의 결과로 분기하지 않는다 — 판정만 하고 버리면 `부분 통과` 의 소요시간이 그대로 실측이 된다');
  }
  return problems;
}

/**
 * 판정이 **두 곳에 생기지 않았는지**(`src/lib/rehearsalCoverage.ts` 원문).
 * 범위 판정이 미통과 키를 함께 읽기 시작하면 중복 보고가 되고, 두 판정이 서로를 덮는다.
 */
export function auditCoverageSeparation(coverageSrc: unknown): string[] {
  const s = String(coverageSrc ?? '');
  const problems: string[] = [];
  if (s.includes(OUTCOME_ENV)) {
    problems.push(`lib/rehearsalCoverage.ts 가 ${OUTCOME_ENV} 를 읽는다 — 귀속 판정이 두 곳에 생겼다(중복 보고가 된다)`);
  }
  if (!/export function assessCoverage/.test(s)) {
    problems.push('lib/rehearsalCoverage.ts 에 assessCoverage 가 없다 — 이 모듈이 재수행 대상을 산출할 상대가 사라졌다');
  }
  return problems;
}

/** §6-5·표 열·env 표·체크리스트 항목이 문서에 남아 있는지 */
export function auditRunbookOutcome(src: unknown): string[] {
  const s = String(src ?? '');
  const problems: string[] = [];
  if (!/^###\s*6-5\./m.test(s)) problems.push('§6-5 절이 사라졌다 — 미통과를 단위로 귀속하는 절차의 유일한 자리다');
  if (!s.includes(OUTCOME_COLUMN)) problems.push(`§6 표에 \`${OUTCOME_COLUMN}\` 열이 없다 — 기록의 집이 env 하나로 줄었다`);
  if (!s.includes(OUTCOME_ENV)) problems.push(`RUNBOOK 에 ${OUTCOME_ENV} 가 없다 — §4-7·§6 표 설명에 등록할 것`);
  if (!/checks\.rehearsalOutcome/.test(s)) problems.push('RUNBOOK 에 checks.rehearsalOutcome 확인 지시가 없다');
  if (!/outstandingUnits|outstandingText/.test(s)) problems.push('§6-5 에 표의 이력에서 미해소 미통과를 뽑는 명령이 없다');
  for (const d of OUTCOME_DRIFTS) {
    if (!s.includes(d.key)) problems.push(`§6-5 에 어긋남 방향 ${d.key} 가 없다`);
  }
  const at = s.search(/^###\s*리허설 체크리스트/m);
  if (at < 0) {
    problems.push('§6 에 리허설 체크리스트가 없다');
  } else {
    const checklist = s.slice(at);
    if (!/6-5/.test(checklist)) problems.push('리허설 체크리스트가 §6-5 를 가리키지 않는다');
    if (!/checks\.rehearsalOutcome/.test(checklist)) {
      problems.push('리허설 체크리스트에 미통과를 단위로 귀속하는 항목이 없다');
    }
  }
  return problems;
}

/** `/api/health` 배선 — 판정만 하고 버리는 꼴과 **관측 판정 뒤로 밀린 경우**를 잡는다 */
export function auditHealthWiring(src: unknown): string[] {
  const s = String(src ?? '');
  const problems: string[] = [];
  if (!/from\s+['"]@\/lib\/rehearsalOutcome['"]/.test(s)) problems.push('rehearsalOutcome 를 import 하지 않는다');
  if (!/rehearsalOutcomeCheck\(/.test(s)) problems.push('rehearsalOutcomeCheck() 를 호출하지 않는다');
  if (!/checks\.rehearsalOutcome\s*=\s*rehearsalOutcomeCheck\(/.test(s)) {
    problems.push('rehearsalOutcomeCheck() 결과를 checks.rehearsalOutcome 에 담지 않는다 — 판정만 하고 버리면 응답에 나타나지 않는다');
  }
  const mine = s.indexOf('checks.rehearsalOutcome =');
  const observation = s.indexOf('checks.rehearsalObservation =');
  if (mine >= 0 && observation >= 0 && mine > observation) {
    problems.push('checks.rehearsalOutcome 이 checks.rehearsalObservation 뒤에 실린다 — 관측 판정은 뒤에 실리는 체크를 보지 못한다(§6-3)');
  }
  return problems;
}

/** 표 이력 요약(§6-5 저장소 명령이 출력한다) */
export function outstandingText(rows: readonly LedgerRow[], now?: Date): string[] {
  const s = outstandingUnits(rows, now);
  const latest = latestLedgerRow(rows, now);
  const elig = attainmentEligibility(latest);
  const lines = [
    `표 기록 ${rows.length}행 · 최신 ${latest?.date ?? '-'} (결과 ${elig.state})`,
    `미해소 미통과: ${s.outstanding.map((o) => `${o.unit}(${o.since}, ${o.times}회)`).join(', ') || '-'}`,
    `해소된 단위: ${s.resolved.join(', ') || '-'}`,
    `RTO 실측 자격: ${elig.eligible ? '있다' : `없다 — ${elig.why}`}`,
  ];
  if (s.unreadableRows.length > 0) lines.push(`결과 판독 불가 행: ${s.unreadableRows.join(', ')} (해소로 세지 않는다)`);
  if (s.invalidRows.length > 0) lines.push(`미통과 칸 판독 불가 행: ${s.invalidRows.join(', ')}`);
  return lines;
}
