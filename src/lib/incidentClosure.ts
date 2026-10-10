/**
 * incidentClosure.ts — RUNBOOK §3 **8단계(사후)** 를 산출·확정 가능하게 만든다. 2026-10-10
 *
 * ── 왜 필요한가 ───────────────────────────────────────────────────────────────
 * §3 의 1·2·3·4·5·6·7단계는 모두 기계적으로 수행·확인할 수 있게 됐다. 마지막 8단계는
 * 「`GET /api/health` 확인, 6절에 사건·조치·소요시간 기록」 한 줄이고, §3 말미는 그보다
 * 무거운 의무를 적어 두었다 — **「손실 구간을 반드시 이해관계자에게 고지한다.
 * 2단계 차단을 언제 걸었는지가 그 구간의 끝이다.」** 그런데
 *
 *  (1) **그 「끝」이 어디에도 남지 않는다.** 쓰기 차단은 `RECOVERY_WRITE_FREEZE` 불리언
 *      하나이고 `/api/health` 는 현재 `frozen`(true/false)만 말한다 — **언제 걸렸는지**는
 *      기록되지 않는다. 더 나쁜 것은 7단계가 그 스위치를 **지우라고** 지시한다는 점이다.
 *      해제한 뒤에는 「차단이 걸려 있었다」는 사실조차 응답에 남지 않으므로, 8단계에서
 *      고지 구간의 끝을 **사람 기억으로** 적게 된다. 사건 대응은 보통 밤이고 여러 명이
 *      교대로 붙으며, 유실 고지는 한번 잘못 적으면 되돌릴 수 없는 외부 커뮤니케이션이다.
 *
 *  (2) **유일하게 있는 수치가 고지 수치가 아니다.** §3-6 의 `lossMinutes` 는
 *      `now - restorePoint` — 즉 **그 명령을 실행한 순간까지**다. 그런데 §3 1단계는 그
 *      산출을 **2단계(쓰기 차단)보다 먼저** 하라고 지시한다(보존 창 마감 때문에 순서를
 *      그렇게 뒤집어 두었다). 그래서 담당자가 실제로 손에 든 수치는 조사·근거 보존(§3-5)·
 *      승인에 쓴 시간이 **빠진** 값이고, 그 사이의 쓰기는 전부 유실 대상인데도 고지에서
 *      누락된다. 반대로 3단계 이후에 산출하면 차단 이후 구간까지 세어 과대 표기가 된다.
 *      어느 쪽도 오류를 내지 않고, 수치가 재현되지도 않는다(실행 시각에 따라 달라진다).
 *
 *  (3) **§6 표의 「소요시간」도 근거가 없다.** `lib/recovery.ts` 의 `parseDurationMin` 은
 *      그 칸을 **읽을** 수 있지만, 그 값을 **만드는** 경로가 코드에 없었다.
 *
 * 그래서 이 모듈은
 *   · 유실 구간의 끝(= 차단 실효 시각)을 **기록 대상으로 승격**하고(`RECOVERY_WRITE_FREEZE_AT`),
 *     차단이 켜져 있는 동안 — **아직 기록할 수 있는 동안** — 미기록을 `/api/health` 로 드러내고,
 *   · 구간을 확정해 고지 문구를 만들고(`assessLossWindow`), 확정할 수 없으면 **수치를 지어내지
 *     않고** `end_unrecorded` 로 남기고,
 *   · §6 표에 붙일 한 줄 초안을 만들되(`incidentRecordDraft`) **표를 채우지는 않는다**,
 *   · 구간이 보장하지 **못하는** 것을 `CLOSURE_LIMITS` 로 함께 내보낸다.
 *
 * 원칙
 * - 순수 모듈: DB·next·fs 미접근, **신규 조회·쓰기·DDL 0**. env 는 명시 로더에서만 읽는다.
 * - **임의 수치 금지**: 끝 시각이 없으면 구간을 추정하지 않는다(기본 지연·평균 대응시간 같은
 *   폴백을 만들지 않는다). 참고용 경과시간은 `elapsedMinutes` 로 **따로** 둔다.
 * - **새 거짓 ok 를 만들지 않는다**: 구간을 확정했다는 것이 「이만큼만 유실됐다」는 뜻이 아니다.
 */
import { parseInstant } from './incidentEvidence.ts';
import { FREEZE_LIMITS, WRITE_FREEZE_ENV, writeFreezeEnabled } from './writeFreeze.ts';

const MS_MIN = 60_000;

/** 차단 **실효** 시각을 적어 두는 키. 유실 구간의 끝이고, 사후에는 복원할 수 없는 값이다 */
export const FREEZE_AT_ENV = 'RECOVERY_WRITE_FREEZE_AT';

/** 응답·문서에서 근거 문서를 찾을 수 있게 한다 */
export const CLOSURE_RUNBOOK_REF = 'RUNBOOK §3 8단계(사후)·§3-7';

/* ─────────────────────────── 유실 구간 판정 ─────────────────────────── */

export const LOSS_VERDICTS = [
  'ok',
  'end_unrecorded',
  'invalid_restore_point',
  'invalid_end',
  'end_before_restore',
  'future_end',
] as const;
export type LossVerdict = (typeof LOSS_VERDICTS)[number];

/** 구간의 끝을 무엇으로 잡았는가. 차단 시각이 정본이고, 전환 시각은 차단을 걸지 않았을 때의 대체다 */
export type LossEndKind = 'freeze' | 'switch';

export const ACTION_LOSS_OK =
  '유실 구간이 확정됐다 — 아래 notice 를 이해관계자 고지에 쓰고, 같은 수치를 §6 표 비고에 남긴다. ' +
  '구간에 어떤 데이터가 있었는지는 §3-5 로 보존한 감사 기록과 대조해야 알 수 있다(구간은 시간만 말한다)';

export const ACTION_LOSS_END_UNRECORDED =
  `유실 구간의 **끝**이 기록되지 않았다 — 구간을 추정하지 않는다. 차단을 켤 때 \`${FREEZE_AT_ENV}\` 에 ` +
  '차단 실효 시각을 넣어 두는 것이 정규 경로다(§3 2단계). 이미 해제했다면 차단 당시의 배포 로그·' +
  '`/api/health` 응답 보관본·§3-5 보존본에서 「마지막으로 받아들인 쓰기」 시각을 찾아 그 값을 쓴다. ' +
  '끝을 끝내 특정할 수 없으면 **구간을 단정하지 말고** 그 사실을 고지에 적는다';

export const ACTION_LOSS_INVALID_RESTORE_POINT =
  '복구 시점(T-ε)을 읽을 수 없다 — 실제로 Neon 에서 브랜치를 만든 시점을 `2026-10-09T13:05:00+09:00` 처럼 ' +
  '**타임존을 붙인 ISO 시각**으로 적는다(§3-6 의 `restorePoint`). 제자리 복구 등 다른 수단을 썼다면 ' +
  '산출값이 아니라 **실제 적용한 시점**을 쓴다';

export const ACTION_LOSS_INVALID_END =
  '구간의 끝 시각을 읽을 수 없다 — 타임존을 붙인 ISO 시각으로 적는다. 읽을 수 없는 값으로 구간을 세지 않는다';

export const ACTION_LOSS_END_BEFORE_RESTORE =
  '구간의 끝이 복구 시점보다 **앞이다** — 손상 시각 T 는 차단보다 앞이고 복구 시점은 T-ε 이므로 정상적으로는 일어나지 않는다. ' +
  '두 값을 다시 확인한다(타임존 누락이 제1 용의자다). 음수 구간을 0 으로 바꿔 「유실 없음」으로 적지 않는다';

export const ACTION_LOSS_FUTURE_END =
  '구간의 끝이 현재보다 미래다 — 오타이거나 타임존을 잘못 붙였다(KST 를 UTC 로 적으면 9시간 미래가 된다)';

export const CAVEAT_END_IS_EFFECTIVE_TIME =
  `\`${FREEZE_AT_ENV}\` 에는 환경변수를 **저장한** 시각이 아니라 차단이 **실효된** 시각을 적는다 — ` +
  `Vercel 환경변수는 재배포 전까지 반영되지 않으므로, \`GET /api/health\` 의 ` +
  '`checks.writeFreeze.detail.frozen` 이 `true` 로 바뀐 것을 확인한 시각이 정본이다. ' +
  '저장 시각을 적으면 그 사이에 받아들인 쓰기가 구간 밖으로 빠진다';

export const CAVEAT_NOT_THE_PLAN_NUMBER =
  '§3-6 의 `lossMinutes` 를 고지 수치로 쓰지 않는다 — 그 값은 **산출한 순간까지**다. ' +
  '1단계에서 산출하면(절차가 그렇게 지시한다) 조사·근거 보존·승인에 쓴 시간이 빠져 실제보다 작고, ' +
  '3단계 이후에 산출하면 차단 이후까지 세어 크다. 고지는 이 구간으로 한다';

export const CAVEAT_WINDOW_IS_TIME_ONLY =
  '구간은 **시간 범위**다 — 그 안에 몇 건의 어떤 데이터가 있었는지는 말하지 않는다. ' +
  '건수·대상은 §3-5 로 보존한 감사 기록과 대조해야 하고, 보존본이 없으면 전환으로 사라져 사후 재구성이 불가능하다';

export const CAVEAT_END_IS_SWITCH =
  '차단 시각이 없어 **전환 시각**을 구간의 끝으로 썼다 — 2단계 차단을 걸지 않았다면 전환 직전까지의 쓰기가 ' +
  '유실 대상이므로 이것이 맞는 끝이다. 그러나 차단을 걸었는데도 그 시각을 모르는 경우라면 ' +
  '이 구간은 **과대 표기**다(차단 이후에는 애초에 쓰기를 받지 않았다)';

/** 확정한 구간이 보장하지 **못하는** 것. 응답·RUNBOOK 에 그대로 실어 보낸다 */
export const CLOSURE_LIMITS: readonly string[] = [
  '구간은 「언제부터 언제까지의 쓰기가 되돌려졌는가」만 말한다 — 유실 **건수·대상**은 보존한 감사 기록(§3-5)과 대조해야 한다',
  `차단이 막지 못한 경로의 쓰기는 구간의 끝 **이후에도** 들어왔을 수 있다 — 그만큼 구간 밖 유실이 있다(${FREEZE_LIMITS.length}건의 사각지대는 \`freezeLimits\` 참고)`,
  '차단을 켠 순간 이미 처리 중이던 요청은 끝까지 진행된다 — 경계가 그 초에 정확히 끊기지는 않는다',
  '복구 시점은 **실제로 브랜치를 만든 시점**이어야 한다 — §3-6 산출값과 다를 수 있고(제자리 복구·창 밖이라 더 이른 시점을 썼을 때), 그때는 구간이 더 넓다',
  '이 수치는 한 사건의 실측이고 **RPO 약속이 아니다** — §1 의 RTO/RPO 는 여전히 `[확인 필요]` 이며 이 값으로 대신하지 않는다',
  '기준 스냅샷 대조(§3 4단계)의 `blindWindow` 와는 다른 구간이다 — 그쪽은 「스냅샷 이후」, 이쪽은 「복구 시점 이후」다',
];

export interface LossWindowInput {
  /** 실제로 복구한 시점(T-ε). §3-6 의 `restorePoint` 또는 실제 적용 시점 */
  restorePoint: unknown;
  /** 쓰기 차단이 **실효된** 시각(`RECOVERY_WRITE_FREEZE_AT`). 구간의 끝 정본 */
  frozenAt?: unknown;
  /** 차단을 걸지 않았을 때의 대체 끝 — 운영 `DATABASE_URL` 을 교체한 시각(§3 5단계) */
  switchedAt?: unknown;
  now?: Date;
}

export interface LossWindow {
  verdict: LossVerdict;
  /** 구간 시작(= 복구 시점, ISO). 판독 실패면 null — 지어내지 않는다 */
  startsAt: string | null;
  /** 구간 끝(ISO). 확정 못 했으면 null */
  endsAt: string | null;
  endKind: LossEndKind | null;
  /** 확정 구간(분). **`ok` 일 때만 값이 있다** */
  minutes: number | null;
  hours: number | null;
  /** 참고용 — 복구 시점부터 현재까지(확정치가 아니다. 고지에 쓰지 않는다) */
  elapsedMinutes: number | null;
  /** 이해관계자 고지에 그대로 쓸 문구 */
  notice: string;
  action: string;
  caveats: string[];
}

function fmtRange(startsAt: string, endsAt: string, minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const dur = h > 0 ? `약 ${h}시간 ${m}분` : `약 ${m}분`;
  return `${startsAt} ~ ${endsAt}(${dur}, ${minutes}분)`;
}

/**
 * 유실 구간 확정. **끝 시각이 없으면 구간을 추정하지 않는다.**
 *
 * 판정 순서: 시작(복구 시점)을 못 읽으면 끝을 봐도 의미가 없고(`invalid_restore_point`),
 * 끝이 아예 없는 것과 못 읽는 것은 할 일이 다르다(`end_unrecorded`/`invalid_end`).
 * 끝이 시작보다 앞이면 **0 으로 깎아 「유실 없음」으로 만들지 않는다**(`end_before_restore`).
 */
export function assessLossWindow(input: LossWindowInput): LossWindow {
  const nowMs = (input?.now ?? new Date()).getTime();
  const rp = parseInstant(input?.restorePoint);
  const baseCaveats = [CAVEAT_NOT_THE_PLAN_NUMBER, CAVEAT_WINDOW_IS_TIME_ONLY, CAVEAT_END_IS_EFFECTIVE_TIME];

  const shell = {
    startsAt: rp ? rp.toISOString() : null,
    endsAt: null,
    endKind: null,
    minutes: null,
    hours: null,
    elapsedMinutes:
      rp && !Number.isNaN(nowMs) && nowMs >= rp.getTime() ? Math.ceil((nowMs - rp.getTime()) / MS_MIN) : null,
  } as const;

  if (!rp) {
    return {
      ...shell,
      verdict: 'invalid_restore_point',
      notice: '유실 구간을 확정하지 못했습니다 — 복구 시점을 읽을 수 없어 수치를 적지 않습니다.',
      action: ACTION_LOSS_INVALID_RESTORE_POINT,
      caveats: baseCaveats,
    };
  }

  const rawFreeze = String(input?.frozenAt ?? '').trim();
  const rawSwitch = String(input?.switchedAt ?? '').trim();
  const rawEnd = rawFreeze || rawSwitch;
  const endKind: LossEndKind | null = rawFreeze ? 'freeze' : rawSwitch ? 'switch' : null;

  if (!rawEnd || endKind === null) {
    return {
      ...shell,
      verdict: 'end_unrecorded',
      notice:
        `유실 구간을 확정하지 못했습니다 — 시작(복구 시점 ${shell.startsAt})은 알지만 **끝(쓰기 차단 실효 시각)이 ` +
        '기록되지 않았습니다.** 끝을 특정하기 전까지 구간을 수치로 고지하지 않습니다.',
      action: ACTION_LOSS_END_UNRECORDED,
      caveats: baseCaveats,
    };
  }

  const end = parseInstant(rawEnd);
  if (!end) {
    return {
      ...shell,
      verdict: 'invalid_end',
      endKind,
      notice: '유실 구간을 확정하지 못했습니다 — 구간의 끝 시각을 읽을 수 없어 수치를 적지 않습니다.',
      action: ACTION_LOSS_INVALID_END,
      caveats: baseCaveats,
    };
  }

  const endsAt = end.toISOString();
  if (end.getTime() < rp.getTime()) {
    return {
      ...shell,
      verdict: 'end_before_restore',
      endsAt,
      endKind,
      notice: `유실 구간을 확정하지 못했습니다 — 구간의 끝(${endsAt})이 복구 시점(${shell.startsAt})보다 앞입니다.`,
      action: ACTION_LOSS_END_BEFORE_RESTORE,
      caveats: baseCaveats,
    };
  }
  if (!Number.isNaN(nowMs) && end.getTime() > nowMs) {
    return {
      ...shell,
      verdict: 'future_end',
      endsAt,
      endKind,
      notice: `유실 구간을 확정하지 못했습니다 — 구간의 끝(${endsAt})이 현재보다 미래입니다.`,
      action: ACTION_LOSS_FUTURE_END,
      caveats: baseCaveats,
    };
  }

  const minutes = Math.ceil((end.getTime() - rp.getTime()) / MS_MIN);
  const caveats = endKind === 'switch' ? [CAVEAT_END_IS_SWITCH, ...baseCaveats] : baseCaveats;
  const endLabel = endKind === 'freeze' ? '쓰기 차단 실효' : '운영 DB 전환';
  return {
    ...shell,
    verdict: 'ok',
    startsAt: shell.startsAt,
    endsAt,
    endKind,
    minutes,
    hours: Math.ceil(minutes / 60),
    notice:
      `유실 구간: ${fmtRange(shell.startsAt as string, endsAt, minutes)}. ` +
      `이 구간에 저장된 데이터는 복구 시점으로 되돌리면서 유실되었습니다. 구간의 끝은 ${endLabel} 시각이며, ` +
      '그 이후의 저장 요청은 애초에 받아들이지 않았습니다. 구간 안의 실제 건수·대상은 보존한 감사 기록과 대조해 안내합니다.',
    action: ACTION_LOSS_OK,
    caveats,
  };
}

/** 응답·명령 출력용 — 판정 + 사각지대 목록(차단이 막지 못한 경로까지 함께 보낸다) */
export function lossWindowStatus(input: LossWindowInput): LossWindow & {
  limits: readonly string[];
  freezeLimits: readonly string[];
  runbook: string;
} {
  return { ...assessLossWindow(input), limits: CLOSURE_LIMITS, freezeLimits: FREEZE_LIMITS, runbook: CLOSURE_RUNBOOK_REF };
}

/** 사람이 읽는 요약(§3-7 의 1줄 명령이 출력하는 것) */
export function closureText(loss: LossWindow & { limits?: readonly string[] }): string {
  const lines = [`[${loss.verdict}] ${loss.notice}`, `→ ${loss.action}`];
  for (const c of loss.caveats) lines.push(`※ ${c}`);
  for (const l of loss.limits ?? []) lines.push(`· ${l}`);
  return lines.join('\n');
}

/** 로그 한 줄. 시각·수치·판정만 — 행 내용·담당자·PII 없음 */
export function closureLogLine(loss: LossWindow): string {
  const parts = [`loss=${loss.verdict}`, `start=${loss.startsAt ?? '?'}`, `end=${loss.endsAt ?? '?'}`];
  if (loss.endKind) parts.push(`endKind=${loss.endKind}`);
  if (loss.minutes !== null) parts.push(`min=${loss.minutes}`);
  return `[closure] ${parts.join(' ')}`;
}

/* ─────────────────────────── 소요시간(§6 표) ─────────────────────────── */

export type DurationVerdict = 'ok' | 'invalid_start' | 'invalid_end' | 'negative';

export interface IncidentDuration {
  verdict: DurationVerdict;
  minutes: number | null;
  startedAt: string | null;
  endedAt: string | null;
  /** §6 표 「소요시간」 칸에 그대로 넣는 표기. 판정 불가면 placeholder */
  cell: string;
  note: string;
}

/** 표의 빈칸을 추측으로 채우지 않는다는 표시 — `lib/recovery.ts` 가 기록으로 세지 않는 토큰 */
export const UNKNOWN_CELL = '[확인 필요]';

/**
 * 사건 대응 소요시간. 시작은 **1단계 중단 결정**, 끝은 **7단계 쓰기 차단 해제**(= 저장이 다시
 * 받아들여진 시각)로 잡는다. 둘 중 하나라도 못 읽으면 **추정하지 않고** placeholder 를 돌려준다.
 */
export function assessDuration(input: { startedAt: unknown; endedAt: unknown }): IncidentDuration {
  const s = parseInstant(input?.startedAt);
  const e = parseInstant(input?.endedAt);
  if (!s) {
    return {
      verdict: 'invalid_start', minutes: null, startedAt: null, endedAt: e ? e.toISOString() : null, cell: UNKNOWN_CELL,
      note: '시작 시각(1단계 중단 결정)을 읽을 수 없어 소요시간을 계산하지 않습니다.',
    };
  }
  if (!e) {
    return {
      verdict: 'invalid_end', minutes: null, startedAt: s.toISOString(), endedAt: null, cell: UNKNOWN_CELL,
      note: '끝 시각(7단계 쓰기 차단 해제)을 읽을 수 없어 소요시간을 계산하지 않습니다.',
    };
  }
  const minutes = Math.ceil((e.getTime() - s.getTime()) / MS_MIN);
  if (minutes < 0) {
    return {
      verdict: 'negative', minutes: null, startedAt: s.toISOString(), endedAt: e.toISOString(), cell: UNKNOWN_CELL,
      note: '끝 시각이 시작보다 앞입니다 — 두 값을 다시 확인하세요(타임존 누락이 제1 용의자입니다).',
    };
  }
  return {
    verdict: 'ok', minutes, startedAt: s.toISOString(), endedAt: e.toISOString(), cell: `${minutes}분`,
    note: '중단 결정(1단계)부터 쓰기 차단 해제(7단계)까지입니다 — 고지한 유실 구간과는 다른 수치입니다.',
  };
}

/* ─────────────────────────── §6 표 한 줄 초안 ─────────────────────────── */

export const DRAFT_NOTE =
  '이 줄은 **초안**이다 — 자동화는 §6 표를 채우지 않는다. 사람이 값을 확인한 뒤 붙여 넣는다. ' +
  `모르는 칸은 비우거나 ${UNKNOWN_CELL} 로 남긴다(지어내지 않는다)`;

export interface IncidentRecordInput extends LossWindowInput {
  /** 기록 일자(YYYY-MM-DD). 못 읽으면 placeholder */
  date?: unknown;
  /** 유형 — §6 표는 `정기`/`사건` 두 값을 쓴다 */
  kind?: unknown;
  /** 1단계 중단 결정 시각 */
  startedAt?: unknown;
  /** 7단계 차단 해제 시각 */
  endedAt?: unknown;
}

export interface IncidentRecordDraft {
  /** §6 표 문법 그대로의 한 줄(`| 일자 | 유형 | 복구 대상 시점 | 소요시간 | 검증 결과 | 담당 | 비고 |`) */
  row: string;
  /** 사람이 채워야 하는 칸 */
  missing: string[];
  loss: LossWindow;
  duration: IncidentDuration;
  note: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const KINDS: readonly string[] = ['정기', '사건'];

/**
 * §6 표에 붙일 초안 한 줄. **표를 고치지 않는다** — 문자열만 돌려준다.
 * 검증 결과·담당은 사람 판단·사람 정보라서 **항상** placeholder 다(담당자 이름을 코드가 만들지 않는다).
 */
export function incidentRecordDraft(input: IncidentRecordInput): IncidentRecordDraft {
  const loss = assessLossWindow(input);
  const duration = assessDuration({ startedAt: input?.startedAt, endedAt: input?.endedAt });
  const missing: string[] = [];

  const rawDate = String(input?.date ?? '').trim();
  const date = DATE_RE.test(rawDate) && parseInstant(rawDate) ? rawDate : UNKNOWN_CELL;
  if (date === UNKNOWN_CELL) missing.push('일자');

  const rawKind = String(input?.kind ?? '').trim();
  const kind = KINDS.includes(rawKind) ? rawKind : UNKNOWN_CELL;
  if (kind === UNKNOWN_CELL) missing.push('유형(정기/사건)');

  const point = loss.startsAt ?? UNKNOWN_CELL;
  if (point === UNKNOWN_CELL) missing.push('복구 대상 시점');
  if (duration.verdict !== 'ok') missing.push('소요시간');

  // 검증 결과·담당은 사람 몫 — 자동으로 「정상」을 적으면 리허설 신선도 판정이 거짓 ok 가 된다.
  missing.push('검증 결과', '담당');

  const remark =
    loss.verdict === 'ok'
      ? `유실 구간 ${loss.startsAt} ~ ${loss.endsAt}(${loss.minutes}분, 고지 완료 여부 확인)`
      : `유실 구간 미확정(${loss.verdict}) — ${UNKNOWN_CELL}`;
  if (loss.verdict !== 'ok') missing.push('비고(유실 구간)');

  return {
    row: `| ${date} | ${kind} | ${point} | ${duration.cell} | ${UNKNOWN_CELL} | ${UNKNOWN_CELL} | ${remark} |`,
    missing,
    loss,
    duration,
    note: DRAFT_NOTE,
  };
}

/* ─────────────────────────── env 로더 ─────────────────────────── */

/**
 * 기록된 차단 실효 시각. `RECOVERY_WRITE_FREEZE_AT` 만 인정하고 **기본값을 만들지 않는다**.
 * 형식 밖·비실존 시각은 null — 못 읽는 값을 「기록됨」으로 올리지 않는다.
 */
export function freezeAtFromEnv(env: Record<string, string | undefined> = process.env): {
  raw: string | null;
  at: string | null;
} {
  const raw = (env.RECOVERY_WRITE_FREEZE_AT ?? '').trim();
  if (!raw) return { raw: null, at: null };
  const d = parseInstant(raw);
  return { raw, at: d ? d.toISOString() : null };
}

/* ─────────────────────────── /api/health 체크 ─────────────────────────── */

export const CLOSURE_STATES = ['normal', 'recorded', 'frozen_unrecorded', 'invalid_record', 'stale_record'] as const;
export type ClosureState = (typeof CLOSURE_STATES)[number];

const STATE_NOTE: Record<ClosureState, string> = {
  normal: `평상시 — 차단 OFF, 차단 시각 미기록. ${FREEZE_AT_ENV} 는 복구 중에만 들어 있는 값이다`,
  recorded: '차단 중이고 차단 실효 시각이 기록돼 있다 — 사후에 유실 구간의 끝을 확정할 수 있다(§3-7)',
  frozen_unrecorded:
    `차단 중인데 ${FREEZE_AT_ENV} 가 비어 있다 — **지금** 넣지 않으면 해제 후에는 유실 구간의 끝을 확정할 수 없고, ` +
    '§3 말미가 요구하는 고지를 사람 기억으로 적게 된다',
  invalid_record: `${FREEZE_AT_ENV} 값을 읽을 수 없다 — 타임존을 붙인 ISO 시각으로 다시 넣는다`,
  stale_record:
    `차단은 OFF 인데 ${FREEZE_AT_ENV} 가 남아 있다 — 사건 기록(§3 8단계)을 마쳤으면 지운다. ` +
    '남겨 두면 **다음 사건의 구간 끝**으로 옛 시각이 쓰인다',
};

/**
 * 유실 구간을 확정할 수 있는 상태인지 공개 헬스체크에 드러낸다.
 *
 * 이 체크의 쓸모는 **시점**에 있다 — 차단이 걸려 있는 동안(= 아직 기록할 수 있는 동안) 미기록을
 * 알려 준다. 7단계 해제 뒤에는 그 시각을 아는 사람이 아무도 없다.
 *
 * `ok` 의 뜻: 「끝을 확정할 수 있는 상태인가」다(차단 자체의 상태는 `checks.writeFreeze` 가 말한다).
 * **required: false** 이므로 어느 경우에도 503 이 되지 않는다. 시각·상태만 담고 행 수·담당자는 담지 않는다.
 */
export function closureCheck(args?: {
  env?: Record<string, string | undefined>;
}): { ok: boolean; required: false; detail: Record<string, unknown> } {
  const env = args?.env ?? process.env;
  const frozen = writeFreezeEnabled(env);
  const { raw, at } = freezeAtFromEnv(env);

  let state: ClosureState;
  if (raw && !at) state = 'invalid_record';
  else if (frozen) state = at ? 'recorded' : 'frozen_unrecorded';
  else state = at ? 'stale_record' : 'normal';

  return {
    ok: state === 'normal' || state === 'recorded',
    required: false,
    detail: {
      state,
      frozen,
      recorded: Boolean(at),
      frozenAt: at,
      switchKey: WRITE_FREEZE_ENV,
      recordKey: FREEZE_AT_ENV,
      runbook: CLOSURE_RUNBOOK_REF,
      note: STATE_NOTE[state],
    },
  };
}

/** 배선 상태 요약(문서·보고용) */
export function incidentClosureStatus(env: Record<string, string | undefined> = process.env): {
  state: ClosureState;
  recordKey: string;
  limits: number;
  note: string;
} {
  const c = closureCheck({ env });
  const state = c.detail.state as ClosureState;
  return { state, recordKey: FREEZE_AT_ENV, limits: CLOSURE_LIMITS.length, note: STATE_NOTE[state] };
}

/* ─────────────────────────── 배선 정적 점검 ─────────────────────────── */

/**
 * `app/api/health/route.ts` 원문 점검 — 판정이 **응답에 실려 있는지**까지 본다.
 * 이 체크가 빠지면 차단 중 미기록을 알려 줄 유일한 장치가 사라지는데, 응답은 그대로 돌기 때문에
 * 사람 눈으로는 알아챌 수 없는 회귀다.
 */
export function auditHealthWiring(src: unknown): string[] {
  const s = String(src ?? '');
  const problems: string[] = [];
  if (!/from\s+['"]@\/lib\/incidentClosure['"]/.test(s)) problems.push('incidentClosure 를 import 하지 않는다');
  if (!/closureCheck\(/.test(s)) problems.push('closureCheck() 를 호출하지 않는다');
  else if (!/checks\.incidentClosure\s*=\s*closureCheck\(/.test(s)) {
    problems.push('판정 결과를 checks.incidentClosure 로 내보내지 않는다 — 판정만 하고 버린다');
  }
  return problems;
}

/**
 * `RUNBOOK.md` 원문 점검 — 8단계가 다시 「health 확인하고 6절에 기록」 한 줄로 되돌아가지 않도록
 * 고정한다. 문서가 되돌아가면 이 모듈은 아무도 호출하지 않는 코드가 된다.
 */
export function auditRunbookClosure(md: unknown): string[] {
  const s = String(md ?? '');
  const problems: string[] = [];

  if (!/^###\s*3-7\./m.test(s)) problems.push('§3-7(유실 구간 확정) 절이 없다');
  if (!/lossWindowStatus\(|assessLossWindow\(/.test(s)) problems.push('§3-7 에 유실 구간 산출 명령이 없다');
  if (!new RegExp(FREEZE_AT_ENV).test(s)) problems.push(`${FREEZE_AT_ENV} 가 문서에 없다 — 복구 시 조용히 유실된다`);

  const sec3 = s.match(/^##\s*3\.\s[\s\S]*?(?=^###\s*3-1\.)/m)?.[0] ?? '';
  if (!sec3) {
    problems.push('§3 본문을 찾지 못했다 — 문서 구조가 바뀌었으면 이 가드를 함께 볼 것');
    return problems;
  }
  // 8단계는 §3 의 마지막 번호 항목이다 — 뒤따르는 인용(`>`)까지 가기 전에 자른다.
  // (`$` 는 `m` 플래그에서 **줄 끝**이라 종료 조건으로 쓰면 첫 줄만 잡힌다.)
  const i8 = sec3.search(/^8\.\s/m);
  const step8 = i8 < 0 ? '' : sec3.slice(i8).split(/\n>/)[0];
  if (!step8) problems.push('§3 8단계를 찾지 못했다');
  else {
    if (!/유실 구간/.test(step8)) problems.push('8단계가 유실 구간 확정을 지시하지 않는다');
    if (!/3-7/.test(step8)) problems.push('8단계가 §3-7 로 유도하지 않는다');
    if (!new RegExp(FREEZE_AT_ENV).test(step8)) problems.push(`8단계가 ${FREEZE_AT_ENV} 정리를 지시하지 않는다`);
  }
  const step2 = sec3.match(/^2\.\s[\s\S]*?(?=^3\.\s)/m)?.[0] ?? '';
  if (!step2) problems.push('§3 2단계를 찾지 못했다');
  else if (!new RegExp(FREEZE_AT_ENV).test(step2)) {
    problems.push(`2단계가 ${FREEZE_AT_ENV} 기록을 함께 지시하지 않는다 — 그때가 기록할 수 있는 유일한 시점이다`);
  }
  return problems;
}
