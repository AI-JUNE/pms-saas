/**
 * remarkSlots.ts — §6 표 **비고 칸**에 무엇이 적혀야 하는지가 정본으로 없다(RUNBOOK §3-23). 2026-10-31
 *
 * ── 왜 필요한가 ───────────────────────────────────────────────────────────────
 * §3 의 소절들은 하나씩 자라면서 **「6절 표 비고에 적는다」로 끝나는 지시를 열두 개** 쌓았다 —
 * 전환 뒤 기동 쓰기로 생긴 행(§3-19) · 「검증 배포 포인터 유지」와 그 스코프(§3-20) ·
 * 「지문 고정 유지」(§3-12) · §3-5 사본의 폐기 기한(§3-17) · 「원본 브랜치 보존」과 보관 기한(§3-18) ·
 * 7단계 해제 시각과 1단계 중단 결정 시각(§3-22) · 약속 대비 초과(§1-2) · 닿지 않은 대상이 있을 수
 * 있다는 사실(§3-16) · 꺼내지 않기로 한 사실(§3-18) · 유실 구간과 고지 발신 시각(§3-10).
 *
 * 그런데 **그 열두 개가 한 곳에 모여 있지 않다.** 8단계 4번을 수행하는 사람은 열 개의 소절을
 * 다시 읽어야 무엇을 적었어야 하는지 알 수 있고, 그중 **되읽는 파서가 있는 것은 둘**뿐이다
 * (§6-7 `parseRemarkWindow` 가 구간·고지 시각만 본다. `LEDGER_FIELDS.note.judgedBy` 가 그렇게
 * 적어 두었다). 나머지 열 개는 **적지 않아도 어떤 판정도 달라지지 않는다** — §3-18 이 그 사실을
 * 「처분을 **했는지**도 확인하지 않는다(6절 표 비고를 읽는 코드는 없다)」로 적어 두었다.
 *
 * 그래서 세 갈래로 거짓이 된다.
 *
 *  (1) **침묵이 두 뜻이다.** 세 결정(원본 브랜치·검증 배포 포인터·기준 지문)은 「한쪽으로
 *      확정한다」가 지시인데, 비고에 적으라고 하는 쪽은 **「남긴다」 한쪽뿐**이다. 그래서
 *      비고에 그 말이 없는 상태는 「떼었다」와 「확정하지 않았다」 **둘 다**를 뜻한다 —
 *      확정하지 않은 쪽이 더 흔한데도 기록은 같은 모습이다. 런타임 판정(`pointer.verdict` ·
 *      `checks.deployPin.detail.phase` · `sourceVerdict`)은 8단계 4번에서 표지를 지우면 전부
 *      평상시 값으로 돌아가므로, **확정 여부를 물을 수 있는 자리가 비고 말고는 없다.**
 *  (2) **자유 메모는 기록이 아니다.** 비고는 자유 텍스트라 사람이 라벨을 조금 다르게 적으면
 *      §6-7 이 이미 `remark_format_changed` 로 적어 둔 함정에 빠진다 — 「기록은 멀쩡히 적혀
 *      있는데 판정만 사라진다」. 열두 개 중 열 개는 애초에 되읽는 쪽이 없으니 **늘 그 상태**다.
 *  (3) **기준점이 「지워야 하는 값」이다.** 해제 시각·중단 결정 시각·폐기 기한·구간의 두 끝은
 *      전부 8단계 4번이 **지우라고 지시하는** 표지에서 온다(그 지시는 옳다 — §3-14). 지운
 *      뒤에는 비어 있는 칸을 다시 채울 수 없는데, **비어 있다는 사실을 말하는 응답이 없다.**
 *
 * 그래서 이 모듈은
 *   · 비고 칸에 들어가는 것을 **정본 목록**으로 두고(`REMARK_SLOTS` — 정본 라벨 · 지시한 소절 ·
 *     되읽는 쪽이 있는가 · 언제 되찾을 수 없게 되는가 · 빠지면 무엇이 거짓이 되는가),
 *   · 한 행의 비고를 그 라벨로만 읽고(`parseRemarkSlots` — **자유 메모에서 값을 주워 오지
 *     않는다**. 구간·고지 둘은 §6-7 파서를 **그대로 쓴다**),
 *   · 「적었는가」를 행의 **목적별로** 판정하고(`assessRemarkSlots` — 점검 행은
 *     `not_applicable`, 목적을 못 읽으면 `undecidable`),
 *   · **침묵을 통과로 덮지 않는다**(`undeclared` — 결정 슬롯은 「떼었다」도 적게 한다),
 *   · 아직 옮겨 적을 수 있는지와 영구히 잃은 것을 가르고(`captureOpen` · `lost`),
 *   · 사람이 붙여 넣을 문구를 만들어 준다(`remarkDraft` — **없는 값은 지어내지 않는다**),
 *   · 거짓이 되는 판정 5건(`REMARK_MISREADS`)과 사각지대를 함께 내보낸다.
 *
 * 원칙
 * - 순수 모듈: DB·next·fs·`process.env` 미접근(env 는 명시 인자로만). **신규 조회·쓰기·DDL 0 ·
 *   신규 런타임 체크 0 · 신규 사건 표지 0 · 신규 env 0** — 이미 적게 되어 있던 칸을 읽는다.
 * - **판독을 복제하지 않는다.** 구간·고지는 §6-7 `parseRemarkWindow`, 목적은 §6-8
 *   `purposeOfRow`, 표지는 §3-14 `readTimeline`, 시각은 `parseInstant` 를 그대로 쓴다.
 * - **중복 보고 금지.** 구간·고지의 **판정**은 §6-7 의 몫이라 이 모듈의 필수 목록에 넣지 않는다
 *   (정본에는 남기고 `requiredFor: []` 로 적는다 — 목록을 반쪽으로 두지 않으면서 두 번 세지도
 *   않는다). 이 판정은 **어떤 게이트도 닫지 않는다** — 거짓 차단을 만들지 않기 위해서다.
 * - **구분할 수 없는 것을 구분했다고 하지 않는다.** 적힌 말이 **사실인지** 코드는 모른다
 *   (「포인터 해제」라고 적어도 실제로 뗐는지 보지 못한다) — 말하는 것은 「적을 수 있는 상태인가」
 *   와 「적힌 것이 정합인가」까지다.
 */
import { parseInstant } from './incidentEvidence.ts';
import { TIMELINE_MARKERS, readTimeline } from './incidentTimeline.ts';
import { purposeOfRow, type RowPurpose } from './ledgerPurpose.ts';
import type { LedgerField, LedgerRow } from './rehearsalLedger.ts';
import { parseRemarkWindow } from './restorePointRecord.ts';

/** 응답·문서에서 근거 절을 찾을 수 있게 한다 */
export const REMARK_RUNBOOK_REF = 'RUNBOOK §3-23 · §6';

/** 이 판정이 읽는 열(§6-4 `LEDGER_FIELDS.note`) */
export const REMARK_COLUMN = '비고';

/** 값을 모른다고 **명시한** 공백. 지어내지 않았다는 기록이고 어긋남이 아니다 */
export const UNKNOWN_CELL = '[확인 필요]';

/** 정본 문구를 잇는 구분자 — §3-10 `recordRemark()` 가 쓰는 것과 같다 */
export const SLOT_SEPARATOR = ' · ';

/* ─────────────────── 비고 칸에 들어가는 것(정본) ─────────────────── */

export type RemarkSlotKey =
  | 'loss_window'
  | 'notice_at'
  | 'halt_at'
  | 'release_at'
  | 'disposal_due'
  | 'source_branch'
  | 'pointer'
  | 'pin'
  | 'boot_writes'
  | 'rto_breach'
  | 'audience_gap'
  | 'extract_waived';

/**
 * - `value`      : 시각·날짜다. 기준점 표지를 지우면 **다시 산출할 수 없다**.
 * - `decision`   : 「남긴다/뗀다」를 한쪽으로 확정한 결과다. **양쪽 모두 적게 한다** —
 *                  한쪽만 적게 하면 침묵이 「뗐다」와 「확정하지 않았다」 둘 다를 뜻한다.
 * - `conditional`: 그 일이 **있었을 때만** 적는다. 없음이 두 뜻이라 미기록으로 세지 않는다.
 */
export type RemarkSlotKind = 'value' | 'decision' | 'conditional';

export interface RemarkSlot {
  key: RemarkSlotKey;
  /** 비고 칸에 적는 **정본 라벨**. 파서가 이 말로만 찾는다 */
  label: string;
  kind: RemarkSlotKind;
  /** 이 칸을 적으라고 지시하는 소절 */
  section: string;
  /** 이 행 목적에서 **필수**다. 비어 있으면 판정의 주인이 다른 절이라는 뜻이다 */
  requiredFor: readonly RowPurpose[];
  /** 되읽는 쪽이 이미 있는가(없으면 null — **한계를 숨기지 않는다**) */
  rereadBy: string | null;
  /** 「남긴다」를 고른 경우 함께 적어야 하는 것(없으면 null) */
  keptNeeds: string | null;
  /** 언제 되찾을 수 없게 되는가 */
  lostWhen: string;
  /** 빠지면 무엇이 거짓이 되는가 */
  skipped: string;
}

export const REMARK_SLOTS: readonly RemarkSlot[] = [
  {
    key: 'loss_window',
    label: '유실 구간',
    kind: 'value',
    section: '§3-10',
    requiredFor: [],
    rereadBy: '§6-7 `parseRemarkWindow`',
    keptNeeds: null,
    lostWhen: '8단계 4번이 `RECOVERY_RESTORE_POINT`·`RECOVERY_WRITE_FREEZE_AT` 를 지우는 순간',
    skipped:
      '되돌릴 수 없는 고지에 나간 수치를 되찾을 수 없다 — §1 의 RPO 대조가 영구히 `unjudged` 다. ' +
      '**판정의 주인은 §6-7** 이라 이 모듈의 필수 목록에 넣지 않는다(두 번 세면 중복 보고다)',
  },
  {
    key: 'notice_at',
    label: '고지',
    kind: 'value',
    section: '§3-10',
    requiredFor: [],
    rereadBy: '§6-7 `parseRemarkWindow`',
    keptNeeds: null,
    lostWhen: '8단계 4번이 `RECOVERY_LOSS_NOTICE_AT` 를 지우는 순간',
    skipped:
      '「고지했는가」를 물을 대상 자체가 사라진다 — 고지 없이 끝낸 복구와 제대로 끝낸 복구가 ' +
      '평상시 응답에서 글자 하나 다르지 않다. **판정의 주인은 §6-7** 이다',
  },
  {
    key: 'halt_at',
    label: '중단 결정',
    kind: 'value',
    section: '§3-22',
    requiredFor: ['incident', 'rehearsal'],
    rereadBy: null,
    keptNeeds: null,
    lostWhen: '어떤 표지도 이 시각을 들고 있지 않다 — 적지 않으면 **그 자리에서** 사라진다',
    skipped:
      '§6 표 `소요시간`(= §1-2 가 읽는 **유일한 RTO 실측**)의 **시작**이 없어진다. 차단 실효 ' +
      '시각에서 잰 값은 조사·범위 특정·승인이 빠진 **하한**인데 숫자 모양이 같아, 그대로 적으면 ' +
      '지키지 못한 약속이 `met` 으로 굳는다(§3-22 `floor_as_measurement`)',
  },
  {
    key: 'release_at',
    label: '차단 해제',
    kind: 'value',
    section: '§3-22',
    requiredFor: ['incident', 'rehearsal'],
    rereadBy: null,
    keptNeeds: null,
    lostWhen: '해제하는 순간. 그 뒤 `frozen: false` 는 **평상시와 같은 값**이다',
    skipped:
      '§6 표 `소요시간` 의 **끝**과 §3-9 대조 구간의 끝, 그리고 「7단계를 수행했다」는 근거 ' +
      '자신이 함께 사라진다 — 해제 뒤에는 어느 응답에서도 되찾을 수 없다',
  },
  {
    key: 'disposal_due',
    label: '사본 폐기 기한',
    kind: 'value',
    section: '§3-17',
    requiredFor: ['incident', 'rehearsal'],
    rereadBy: null,
    keptNeeds: null,
    lostWhen: '8단계 4번이 `RECOVERY_EVIDENCE_PRESERVED_AT`(기한의 **유일한 기준점**)을 지우는 순간',
    skipped:
      '보관소의 사본 3종(행위자 이름·전 테넌트 메일 주소)이 **무기한 남고, 남아 있다는 사실을 ' +
      '말하는 응답이 하나도 없다** — 사본은 저장소·DB·env 밖이라 어떤 판정도 보지 못한다',
  },
  {
    key: 'source_branch',
    label: '원본 브랜치',
    kind: 'decision',
    section: '§3-18',
    requiredFor: ['incident', 'rehearsal'],
    rereadBy: null,
    keptNeeds: '보관 기한',
    skipped:
      '전 테넌트 데이터 한 벌이 **탈퇴·파기가 닿지 않는 채** 무기한 남거나, 체크리스트의 ' +
      '「브랜치 정리」를 사건에서 그대로 읽어 **유실분의 유일본을 든 쪽을 지운다**',
    lostWhen: '표지를 지운 뒤 — 꺼낼 **범위**를 말해 주는 두 값이 그 표지들이다',
  },
  {
    key: 'pointer',
    label: '검증 배포 포인터',
    kind: 'decision',
    section: '§3-20',
    requiredFor: ['incident', 'rehearsal'],
    rereadBy: null,
    keptNeeds: '그 스코프',
    skipped:
      '운영 DB 를 쥔 배포가 **둘인 채로 남는다** — 그 배포는 2단계 차단을 받은 적이 없고 ' +
      '기동마다 **소스에 하드코딩된 비밀번호**의 관리자를 되살려 6-1단계 재적용을 무효로 만든다. ' +
      '전환 뒤 `checks.dbIdentity` 는 양쪽에서 **같은 지문**을 낸다',
    lostWhen: '표지를 지운 뒤 — 어느 배포가 이번 사건에 쓰였는지 말할 근거가 그 표지들이다',
  },
  {
    key: 'pin',
    label: '기준 지문',
    kind: 'decision',
    section: '§3-12',
    requiredFor: ['incident'],
    rereadBy: null,
    keptNeeds: null,
    skipped:
      '다음 사건에서 `checks.deployPin.detail.phase` 가 사건인지 평상시인지 아무도 말할 수 없다 — ' +
      '남기기로 하면 `after_switch` 가 **평상시로 돌아오지 않고**, §5 0단계의 Promote 금지가 늘 떠 있다',
    lostWhen: '다음 사건이 시작되는 순간 — 그 뒤에는 지금 값이 어느 국면의 것인지 가릴 수 없다',
  },
  {
    key: 'boot_writes',
    label: '기동 쓰기',
    kind: 'conditional',
    section: '§3-19',
    requiredFor: [],
    rereadBy: null,
    keptNeeds: null,
    lostWhen: '리허설 브랜치를 정리하는 순간 — **같은 일이 일어나도 흔적이 남지 않는다**',
    skipped:
      '4단계 대조가 기준치에 못 미치던 테이블을 `ok` 로 올린 사실이 남지 않는다. ' +
      '멱등 가드라 지워도 다음 기동이 다시 만든다 — 그래서 **적는 것이 조치다**',
  },
  {
    key: 'rto_breach',
    label: '약속 초과',
    kind: 'conditional',
    section: '§1-2',
    requiredFor: [],
    rereadBy: null,
    keptNeeds: null,
    lostWhen: '`소요시간` 칸을 적은 뒤 — 수치만 남으면 초과였다는 사실이 설명 없이 묻힌다',
    skipped: '목표를 넘긴 복구가 수치만 남아, 다음 약속을 고칠 근거가 없다(수치를 깎지 않는다)',
  },
  {
    key: 'audience_gap',
    label: '미도달 가능',
    kind: 'conditional',
    section: '§3-16',
    requiredFor: [],
    rereadBy: null,
    keptNeeds: null,
    lostWhen: '고지를 발신하는 순간 — 고지는 되돌릴 수 없다',
    skipped:
      '`window_closed`(대상을 전부 특정할 경로가 **없다**)인 채로 나간 고지가 ' +
      '전원에게 닿은 고지와 구별되지 않는다',
  },
  {
    key: 'extract_waived',
    label: '유실분 미추출',
    kind: 'conditional',
    section: '§3-18',
    requiredFor: [],
    rereadBy: null,
    keptNeeds: null,
    lostWhen: '원본 브랜치를 지우는 순간 — 그때 고지문의 「유실」이 사실이 된다',
    skipped: '꺼내면 되찾을 수 있었던 데이터를 「유실」로 확정한 사실이 남지 않는다',
  },
];

export function remarkSlotFor(key: unknown): RemarkSlot | null {
  const k = String(key ?? '').trim();
  return REMARK_SLOTS.find((s) => s.key === k) ?? null;
}

/** 어느 목적의 행에서 필수인 슬롯 — 정본에서 도출한다(목록을 두 곳에 두지 않는다) */
export function requiredSlots(purpose: RowPurpose, slots: readonly RemarkSlot[] = REMARK_SLOTS): RemarkSlot[] {
  return slots.filter((s) => s.requiredFor.includes(purpose));
}

/* ─────────────────── 거짓이 되는 판정 ─────────────────── */

export interface RemarkMisread {
  key: string;
  /** 어떤 읽기인가 */
  judgement: string;
  /** 그 읽기가 말하는 것 */
  says: string;
  /** 왜 거짓인가 */
  why: string;
}

export const REMARK_MISREADS: readonly RemarkMisread[] = [
  {
    key: 'silence_is_release',
    judgement: '비고에 「검증 배포 포인터 유지」가 없다',
    says: '포인터를 뗐다',
    why:
      '§3-20 은 **남긴 경우에만** 적으라고 지시한다 — 그래서 침묵은 「뗐다」와 「확정하지 않았다」 ' +
      '둘 다를 뜻하고, 확정하지 않은 쪽이 더 흔하다. 표지를 지운 뒤에는 런타임 판정도 평상시 값으로 ' +
      '돌아가 **되물을 자리가 없다**',
  },
  {
    key: 'free_text_is_record',
    judgement: '비고 칸에 글이 적혀 있다',
    says: '기록이 남았다',
    why:
      '정본 라벨이 아니면 되읽는 쪽이 없다 — §6-7 이 `remark_format_changed` 로 적어 둔 바로 그 ' +
      '함정이다(「기록은 멀쩡히 적혀 있는데 판정만 사라진다」). 열두 슬롯 중 열은 애초에 되읽는 쪽이 없다',
  },
  {
    key: 'window_only_is_complete',
    judgement: '§6-7 판정이 `ok` 다',
    says: '비고 칸이 다 채워졌다',
    why:
      '§6-7 이 보는 것은 **구간과 고지 시각 둘**뿐이다(`LEDGER_FIELDS.note.judgedBy` 가 그렇게 ' +
      '적어 두었다) — 해제 시각·중단 결정 시각·폐기 기한·세 결정은 그 판정에 들어가지 않는다',
  },
  {
    key: 'cleared_is_done',
    judgement: '8단계 4번을 마쳐 표지가 전부 비었다',
    says: '마무리가 끝났다',
    why:
      '지운 것과 **옮겨 적은 것**은 별개다. 지운 뒤에 비어 있는 칸은 영구 유실이고, ' +
      '`checks.incidentClosure` 는 그 상태를 `not_applicable`(= 평상시)로 말한다',
  },
  {
    key: 'check_row_is_incomplete',
    judgement: '`점검` 행의 비고가 비어 있다',
    says: '기록을 거렀다',
    why:
      '§2 월 점검은 §3 절차를 **하나도 수행하지 않는다**(§6-8) — 적을 것이 없다. ' +
      '미기록으로 세면 매월 **거짓 차단**이 뜨고, 그러면 아무도 이 판정을 보지 않게 된다',
  },
];

export function remarkMisreadFor(key: unknown): RemarkMisread | null {
  const k = String(key ?? '').trim();
  return REMARK_MISREADS.find((m) => m.key === k) ?? null;
}

/* ─────────────────── 사각지대 ─────────────────── */

export interface RemarkBlindSpot {
  key: string;
  what: string;
  why: string;
}

export const REMARK_BLIND_SPOTS: readonly RemarkBlindSpot[] = [
  {
    key: 'claim_not_fact',
    what: '적힌 말이 **사실인지**는 보지 않는다',
    why: '「검증 배포 포인터 해제」라고 적혀 있어도 실제로 뗐는지 코드는 그 배포의 env 를 보지 못한다',
  },
  {
    key: 'row_identity_is_the_date',
    what: '그 비고가 **어느 사건**의 것인지는 행의 `일자` 하나로만 말한다',
    why: '같은 날 두 번 복구하면 두 행을 가릴 근거가 표에 없다(표지에는 시각이 있지만 지워진다 — §3-14)',
  },
  {
    key: 'not_read_at_runtime',
    what: '런타임은 이 판정을 내보내지 않는다',
    why:
      '§6 표는 저장소 문서이고 배포는 그것을 읽지 않는다 — `/api/health` 에 실으면 전 배포가 ' +
      '상시 판정 보류만 내보낸다(§2-2). 판정은 §3-23 산출 명령의 출력으로만 나간다',
  },
  {
    key: 'scope_not_joined',
    what: '리허설 **범위**(§6-2)와 합치지 않았다',
    why:
      '범위를 좁게 잡은 리허설에서는 수행하지 않은 단계의 슬롯까지 미기록으로 보인다 — ' +
      '그래서 이 판정은 **어떤 게이트도 닫지 않는다**(거짓 차단을 만들지 않는다)',
  },
  {
    key: 'one_cell_twelve_things',
    what: '한 칸에 열두 가지가 들어간다',
    why: '마크다운 표의 한 칸이라 줄바꿈을 넣을 수 없고, 길어지면 사람이 읽기를 포기한다 — 그래서 `remarkDraft` 가 문구를 만들어 준다',
  },
];

export const REMARK_LIMITS: readonly string[] = [
  '적힌 말이 사실인지 보지 않는다 — 말하는 것은 「적을 수 있는 상태인가」와 「적힌 것이 정합인가」까지다',
  '정본 라벨로만 읽는다 — 라벨을 다르게 적으면 기록은 남아도 판정은 `unparsed` 로 내려앉는다',
  '구간·고지 시각의 **판정**은 §6-7 의 몫이다 — 여기서는 적혀 있다는 사실만 센다(중복 보고 금지)',
  '조건부 슬롯의 없음은 「안 적었다」와 「적을 것이 없었다」 둘 다를 뜻한다 — 미기록으로 세지 않는다',
  '리허설 범위(§6-2)와 합치지 않았다 — 좁은 범위의 리허설에서는 미기록이 과하게 보인다',
  '이 판정은 게이트가 아니다 — 7단계 해제도, 8단계 4번의 표지 삭제도 이 판정으로 막지 않는다',
  '런타임은 §6 표를 읽지 않는다 — CI·산출 명령 시점의 판정이다',
];

/* ─────────────────── 한 칸 읽기 ─────────────────── */

/** 결정 슬롯이 어느 쪽으로 적혔는가. `unreadable` 은 두 말이 겹치거나 어느 쪽도 없는 것이다 */
export type DecisionSide = 'kept' | 'released' | 'unreadable';

export interface SlotReading {
  key: RemarkSlotKey;
  /** 정본 라벨이 그 칸에 있는가 */
  found: boolean;
  /** 값 슬롯의 시각(ISO). 판독 못 하면 null */
  at: string | null;
  /** 값을 **모른다고 명시**했다(`[확인 필요]`) — 지어내지 않았다는 기록이다 */
  declaredUnknown: boolean;
  /** 결정 슬롯의 방향 */
  side: DecisionSide | null;
  /** 「남긴다」에 함께 적어야 하는 것이 붙어 있는가 */
  keptDetail: boolean;
  /** 적혔지만 읽히지 않은 이유(**값을 담지 않는다**) */
  invalid: string | null;
}

const SEGMENT_END_RE = /[·|;\n]/;
const KEPT_RE = /유지|보존|남김|남긴|고정/;
const RELEASED_RE = /해제|삭제|지움|지웠|떼|제거|되돌/;
const PLACEHOLDER_RE = /^\[확인/;

/** 라벨 뒤 ~ 다음 구분자까지. 다른 슬롯의 말이 섞이지 않게 **자기 구간만** 본다 */
function segmentFor(text: string, label: string): { found: boolean; rest: string } {
  const re = new RegExp(label.replace(/\s+/g, '\\s*'));
  const m = re.exec(text);
  if (!m) return { found: false, rest: '' };
  const after = text.slice(m.index + m[0].length);
  const cut = after.search(SEGMENT_END_RE);
  return { found: true, rest: (cut < 0 ? after : after.slice(0, cut)).trim() };
}

function firstToken(rest: string): string {
  const t = rest.replace(/^[:=\s]+/, '').split(/\s+/)[0] ?? '';
  return t.replace(/[,.)]+$/, '');
}

function emptyReading(key: RemarkSlotKey): SlotReading {
  return { key, found: false, at: null, declaredUnknown: false, side: null, keptDetail: false, invalid: null };
}

/**
 * 비고 한 칸을 **정본 라벨로만** 읽는다.
 *
 * 구간(`loss_window`)·고지 시각(`notice_at`)은 §6-7 `parseRemarkWindow` 를 **그대로 쓴다** —
 * 같은 문구를 두 곳에서 읽으면 갈라진 쪽이 아무 응답도 바꾸지 않으므로 영구히 남는다.
 */
export function parseRemarkSlots(note: unknown, slots: readonly RemarkSlot[] = REMARK_SLOTS): SlotReading[] {
  const text = String(note ?? '').trim();
  const window = parseRemarkWindow(text);

  return slots.map((slot) => {
    const r = emptyReading(slot.key);
    if (!text) return r;

    // 구간·고지는 §6-7 이 판정의 주인이다 — 여기서는 **적혀 있는가**까지만 보고
    // 어긋남(`invalid`)은 적지 않는다(두 곳에서 같은 말을 하면 중복 보고가 된다).
    if (slot.key === 'loss_window') {
      r.found = window.found;
      r.at = window.startsAt;
      // 「유실 구간 미확정(…)」은 구간이 아니라 **미확정 사실**의 기록이다(§6-7).
      r.declaredUnknown = window.undetermined;
      return r;
    }
    if (slot.key === 'notice_at') {
      const seg = segmentFor(text, slot.label);
      r.found = seg.found;
      r.at = window.noticedAt;
      r.declaredUnknown = seg.found && PLACEHOLDER_RE.test(firstToken(seg.rest));
      return r;
    }

    const seg = segmentFor(text, slot.label);
    if (!seg.found) return r;
    r.found = true;

    if (slot.kind === 'decision') {
      const kept = KEPT_RE.test(seg.rest);
      const released = RELEASED_RE.test(seg.rest);
      if (kept && released) {
        r.side = 'unreadable';
        r.invalid = '남긴다·뗀다가 한 칸에 함께 적혀 있다';
      } else if (kept) {
        r.side = 'kept';
        const detail = seg.rest.replace(KEPT_RE, '').replace(/[()[\]\s]/g, '');
        r.keptDetail = detail.length > 0;
        if (slot.keptNeeds && !r.keptDetail) r.invalid = `남긴다를 골랐는데 함께 적을 것(${slot.keptNeeds})이 없다`;
      } else if (released) {
        r.side = 'released';
      } else {
        r.side = 'unreadable';
        r.invalid = '남긴다·뗀다 어느 쪽으로도 읽히지 않는다';
      }
      return r;
    }

    const token = firstToken(seg.rest);
    // 조건부 슬롯은 **그 일이 있었다**는 표시다 — 내용이 없는 것이 정상이고 어긋남이 아니다.
    if (slot.kind === 'conditional') {
      if (PLACEHOLDER_RE.test(token)) r.declaredUnknown = true;
      return r;
    }
    if (!token) {
      r.invalid = '라벨만 있고 내용이 없다';
      return r;
    }
    if (PLACEHOLDER_RE.test(token)) {
      r.declaredUnknown = true;
      return r;
    }
    const d = parseInstant(token);
    if (!d) r.invalid = '시각을 읽을 수 없다';
    else r.at = d.toISOString();
    return r;
  });
}

/**
 * 정본 라벨 밖의 자유 메모가 남아 있는가 — 「적었지만 되읽을 수 없다」를 가린다.
 * 라벨만 지우지 않고 **그 구간째로** 지운다(슬롯의 내용인 테이블 이름·스코프 이름을
 * 자유 메모로 세면 잘 적은 비고가 늘 경보를 낸다).
 */
export function hasFreeText(note: unknown, slots: readonly RemarkSlot[] = REMARK_SLOTS): boolean {
  let rest = String(note ?? '');
  if (!rest.trim()) return false;
  for (const s of slots) {
    const re = new RegExp(s.label.replace(/\s+/g, '\\s*'));
    const m = re.exec(rest);
    if (!m) continue;
    const after = rest.slice(m.index + m[0].length);
    const cut = after.search(SEGMENT_END_RE);
    rest = rest.slice(0, m.index) + (cut < 0 ? '' : after.slice(cut));
  }
  return /[가-힣A-Za-z]{2,}/.test(rest);
}

/* ─────────────────── 판정 ─────────────────── */

export const REMARK_VERDICTS = [
  'complete',
  'undeclared',
  'partial',
  'unparsed',
  'empty',
  'undecidable',
  'not_applicable',
] as const;
export type RemarkVerdict = (typeof REMARK_VERDICTS)[number];

export const ACTION_REMARK_COMPLETE =
  '필수 칸이 모두 적혔다. 표지를 지우기 전에 §6-7 판정(구간·고지 시각)까지 `ok` 인지 함께 본다';
export const ACTION_REMARK_UNDECLARED =
  '결정을 **한쪽으로 확정해 적는다** — 「남긴다」든 「뗀다」든 비고에 적는다. 적지 않으면 「뗐다」와 「확정하지 않았다」가 같은 모습이 되고, 표지를 지운 뒤에는 되물을 자리가 없다';
export const ACTION_REMARK_PARTIAL =
  '빠진 칸을 **지금** 옮겨 적는다(`remarkDraft()` 가 문구를 만든다). 기준점 표지를 지운 뒤에는 산출할 수 없다 — 모르면 지어내지 말고 `[확인 필요]` 로 적는다';
export const ACTION_REMARK_UNPARSED =
  '적혀 있지만 정본 라벨이 아니라 되읽히지 않는다 — `remarkDraft()` 의 문구로 다시 적는다(기록은 남아도 판정은 사라진다)';
export const ACTION_REMARK_EMPTY =
  '비고 칸이 비었다 — 열두 슬롯 중 이 행에 필수인 것을 `remarkDraft()` 로 적는다. 표지가 남아 있는 동안이 유일한 기회다';
export const ACTION_REMARK_UNDECIDABLE =
  '행의 `유형` 을 읽을 수 없어 무엇이 필수인지 정할 수 없다 — `정기`/`사건`/`점검` 중 하나로 적는다(§6-8). **판정 보류이고 통과가 아니다**';
export const ACTION_REMARK_NOT_APPLICABLE =
  '없음 — §2 월 점검 행이거나 읽을 행이 없다. 점검은 §3 절차를 하나도 수행하지 않아 적을 것이 없다(§6-8)';

export const CAVEAT_REMARK_IS_A_CLAIM =
  '적힌 말이 **사실인지**는 보지 않는다 — 「포인터 해제」라고 적혀 있어도 실제로 뗐는지 코드는 보지 못한다';
export const CAVEAT_SILENCE_IS_TWO_THINGS =
  '조건부 슬롯의 없음은 「안 적었다」와 「적을 것이 없었다」 둘 다를 뜻한다 — 미기록으로 세지 않았다';
export const CAVEAT_WINDOW_IS_ELSEWHERE =
  '구간·고지 시각의 **판정**은 §6-7 이 주인이다 — 여기서는 적혀 있다는 사실만 센다';
export const CAVEAT_NOT_A_GATE =
  '이 판정은 게이트가 아니다 — 7단계 해제도, 8단계 4번의 표지 삭제도 막지 않는다(거짓 차단을 만들지 않는다)';

export interface RemarkInput {
  /** §6 표 한 행. 없으면 `not_applicable`(런타임은 표를 읽지 않는다) */
  row?: (Pick<LedgerRow, 'note' | 'kind'> & { kindRaw?: string; date?: string }) | null;
  /** 표지 env — 「아직 옮겨 적을 수 있는가」만 본다(값은 담지 않는다) */
  markers?: Record<string, string | undefined>;
  slots?: readonly RemarkSlot[];
}

export interface RemarkAssessment {
  verdict: RemarkVerdict;
  purpose: RowPurpose;
  /** 이 행에서 필수인 슬롯 키 */
  required: RemarkSlotKey[];
  /** 정본 라벨로 읽힌 슬롯 */
  present: RemarkSlotKey[];
  /** 필수인데 없다(또는 아직 적을 수 있는데 `[확인 필요]` 로 적혔다) */
  missing: RemarkSlotKey[];
  /** 적혔지만 정합하지 않다 */
  invalid: { key: RemarkSlotKey; why: string }[];
  /** 결정 슬롯인데 한쪽으로 확정되지 않았다 */
  undeclared: RemarkSlotKey[];
  /** 없음이 두 뜻인 슬롯 — **미기록으로 세지 않는다** */
  silent: RemarkSlotKey[];
  /** 값을 모른다고 **명시한** 슬롯 */
  declaredUnknown: RemarkSlotKey[];
  /** 표지가 남아 있어 아직 옮겨 적을 수 있는가 */
  captureOpen: boolean;
  /** 표지가 지워진 뒤 비어 있는 값 슬롯 — 영구히 되찾을 수 없다 */
  lost: RemarkSlotKey[];
  /** 정본 라벨 밖의 자유 메모가 있다 */
  freeText: boolean;
  /** 되읽는 쪽이 **없는** 슬롯의 수 — 이 절이 생긴 이유다 */
  unrereadable: number;
  action: string;
  caveats: string[];
  ref: string;
}

/**
 * 한 행의 비고가 **적을 수 있는 상태인가**를 판정한다.
 *
 * 판정 순서가 보호 장치다 — 점검 행(`not_applicable`)과 목적 미판독(`undecidable`)을 **앞**에
 * 두어 거짓 차단을 만들지 않고, 그 뒤에 「비었다 → 되읽히지 않는다 → 일부 → 미확정 → 완전」으로
 * 내려간다. **침묵을 통과로 덮지 않되** 침묵이 두 뜻인 슬롯은 `silent` 로만 적는다.
 */
export function assessRemarkSlots(input?: RemarkInput): RemarkAssessment {
  const slots = input?.slots ?? REMARK_SLOTS;
  const row = input?.row ?? null;
  const markers = input?.markers ?? {};
  const captureOpen = readTimeline(markers).some((m) => m.present);
  const unrereadable = slots.filter((s) => !s.rereadBy).length;

  const base = (verdict: RemarkVerdict, purpose: RowPurpose, action: string, caveats: string[]): RemarkAssessment => ({
    verdict,
    purpose,
    required: [],
    present: [],
    missing: [],
    invalid: [],
    undeclared: [],
    silent: [],
    declaredUnknown: [],
    captureOpen,
    lost: [],
    freeText: false,
    unrereadable,
    action,
    caveats,
    ref: REMARK_RUNBOOK_REF,
  });

  if (!row) return base('not_applicable', 'absent', ACTION_REMARK_NOT_APPLICABLE, [CAVEAT_NOT_A_GATE]);

  const purpose = purposeOfRow(row);
  if (purpose === 'check') {
    return base('not_applicable', purpose, ACTION_REMARK_NOT_APPLICABLE, [CAVEAT_NOT_A_GATE]);
  }
  if (purpose === 'ambiguous' || purpose === 'unreadable' || purpose === 'absent') {
    return base('undecidable', purpose, ACTION_REMARK_UNDECIDABLE, [CAVEAT_NOT_A_GATE]);
  }

  const readings = parseRemarkSlots(row.note, slots);
  const byKey = new Map(readings.map((r) => [r.key, r]));
  const need = requiredSlots(purpose, slots);
  const needKeys = new Set(need.map((s) => s.key));

  const present: RemarkSlotKey[] = [];
  const missing: RemarkSlotKey[] = [];
  const invalid: { key: RemarkSlotKey; why: string }[] = [];
  const undeclared: RemarkSlotKey[] = [];
  const silent: RemarkSlotKey[] = [];
  const declaredUnknown: RemarkSlotKey[] = [];
  const lost: RemarkSlotKey[] = [];

  for (const slot of slots) {
    const r = byKey.get(slot.key) ?? emptyReading(slot.key);
    if (r.found) present.push(slot.key);
    if (r.declaredUnknown) declaredUnknown.push(slot.key);
    if (r.invalid) invalid.push({ key: slot.key, why: r.invalid });

    if (!needKeys.has(slot.key)) {
      if (!r.found) silent.push(slot.key);
      continue;
    }
    if (slot.kind === 'decision') {
      if (!r.found || r.side === 'unreadable') undeclared.push(slot.key);
      continue;
    }
    // 값 슬롯: 아직 적을 수 있는데 `[확인 필요]` 로 둔 것은 **미기록**이다.
    if (!r.found || (r.declaredUnknown && captureOpen)) {
      missing.push(slot.key);
      if (!captureOpen) lost.push(slot.key);
    }
  }

  const text = String(row.note ?? '').trim();
  const freeText = hasFreeText(text, slots);

  let verdict: RemarkVerdict;
  if (!text) verdict = 'empty';
  else if (present.length === 0) verdict = 'unparsed';
  else if (missing.length > 0 || invalid.length > 0) verdict = 'partial';
  else if (undeclared.length > 0) verdict = 'undeclared';
  else verdict = 'complete';

  const actions: Record<RemarkVerdict, string> = {
    complete: ACTION_REMARK_COMPLETE,
    undeclared: ACTION_REMARK_UNDECLARED,
    partial: ACTION_REMARK_PARTIAL,
    unparsed: ACTION_REMARK_UNPARSED,
    empty: ACTION_REMARK_EMPTY,
    undecidable: ACTION_REMARK_UNDECIDABLE,
    not_applicable: ACTION_REMARK_NOT_APPLICABLE,
  };

  const caveats = [CAVEAT_REMARK_IS_A_CLAIM, CAVEAT_NOT_A_GATE];
  if (silent.length > 0) caveats.push(CAVEAT_SILENCE_IS_TWO_THINGS);
  if (needKeys.size > 0) caveats.push(CAVEAT_WINDOW_IS_ELSEWHERE);

  return {
    verdict,
    purpose,
    required: [...needKeys],
    present,
    missing,
    invalid,
    undeclared,
    silent,
    declaredUnknown,
    captureOpen,
    lost,
    freeText,
    unrereadable,
    action: actions[verdict],
    caveats,
    ref: REMARK_RUNBOOK_REF,
  };
}

/** 요약 — 수치·판정만 */
export function remarkSlotsStatus(input?: RemarkInput): {
  verdict: RemarkVerdict;
  purpose: RowPurpose;
  required: number;
  missing: number;
  undeclared: number;
  slots: number;
  unrereadable: number;
  limits: number;
  note: string;
} {
  const a = assessRemarkSlots(input);
  return {
    verdict: a.verdict,
    purpose: a.purpose,
    required: a.required.length,
    missing: a.missing.length,
    undeclared: a.undeclared.length,
    slots: (input?.slots ?? REMARK_SLOTS).length,
    unrereadable: a.unrereadable,
    limits: REMARK_LIMITS.length,
    note: a.action,
  };
}

/* ─────────────────── 초안 ─────────────────── */

export interface RemarkDraftValues {
  haltAt?: string | null;
  releaseAt?: string | null;
  disposalDue?: string | null;
  /** `kept` 면 함께 적을 것(보관 기한)을 `sourceDetail` 로 넘긴다 */
  sourceBranch?: DecisionSide | null;
  sourceDetail?: string | null;
  pointer?: DecisionSide | null;
  pointerScope?: string | null;
  pin?: DecisionSide | null;
  /** 조건부 — 있었던 것만 넘긴다 */
  bootWriteTables?: readonly string[];
  rtoBreach?: boolean;
  audienceGap?: boolean;
  extractWaived?: boolean;
}

function decisionWord(side: DecisionSide | null | undefined, detail?: string | null): string | null {
  if (side === 'kept') return detail && detail.trim() ? `보존(${detail.trim()})` : '보존';
  if (side === 'released') return '삭제';
  if (side === 'unreadable') return UNKNOWN_CELL;
  return null;
}

/**
 * 비고 칸 초안. **없는 값은 지어내지 않는다** — 넘기지 않은 필수 칸은 `[확인 필요]` 로 남고,
 * 조건부 칸은 아예 빠진다(없었던 일을 적지 않는다). 구간·고지 문구는 §3-10 `recordRemark()` 가
 * 만드는 쪽이 주인이라 여기서 만들지 않는다 — **그 문구 앞에 이어 붙인다.**
 */
export function remarkDraft(values: RemarkDraftValues = {}): string {
  const parts: string[] = [];
  const at = (label: string, v?: string | null) => {
    const d = v ? parseInstant(v) : null;
    parts.push(`${label} ${d ? v : UNKNOWN_CELL}`);
  };
  at('중단 결정', values.haltAt);
  at('차단 해제', values.releaseAt);
  at('사본 폐기 기한', values.disposalDue);

  const src = decisionWord(values.sourceBranch, values.sourceDetail);
  parts.push(`원본 브랜치 ${src ?? UNKNOWN_CELL}`);
  const ptr =
    values.pointer === 'kept'
      ? values.pointerScope && values.pointerScope.trim()
        ? `유지(${values.pointerScope.trim()})`
        : '유지'
      : values.pointer === 'released'
        ? '해제'
        : null;
  parts.push(`검증 배포 포인터 ${ptr ?? UNKNOWN_CELL}`);
  parts.push(`기준 지문 ${values.pin === 'kept' ? '고정 유지' : values.pin === 'released' ? '삭제' : UNKNOWN_CELL}`);

  const tables = (values.bootWriteTables ?? []).filter((t) => String(t ?? '').trim());
  if (tables.length > 0) parts.push(`기동 쓰기 ${tables.join(',')}`);
  if (values.rtoBreach) parts.push('약속 초과');
  if (values.audienceGap) parts.push('미도달 가능');
  if (values.extractWaived) parts.push('유실분 미추출');

  return parts.join(SLOT_SEPARATOR);
}

/* ─────────────────── 출력 ─────────────────── */

/** 로그 한 줄 — 판정·개수만(시각·스코프 이름·테이블 이름 없음) */
export function remarkLine(a: RemarkAssessment): string {
  const parts = [
    `verdict=${a.verdict}`,
    `purpose=${a.purpose}`,
    `required=${a.required.length}`,
    `present=${a.present.length}`,
  ];
  if (a.missing.length > 0) parts.push(`missing=${a.missing.join(',')}`);
  if (a.undeclared.length > 0) parts.push(`undeclared=${a.undeclared.join(',')}`);
  if (a.invalid.length > 0) parts.push(`invalid=${a.invalid.length}`);
  if (a.lost.length > 0) parts.push(`lost=${a.lost.join(',')}`);
  if (a.captureOpen) parts.push('capture=open');
  if (a.freeText) parts.push('free_text=true');
  return `[remark-slots] ${parts.join(' ')}`;
}

/** 사람이 읽을 요약 — 한 문단 */
export function remarkText(a: RemarkAssessment): string {
  const parts = [`비고 칸 판정 = ${a.verdict}`, `목적 ${a.purpose}`, `필수 ${a.required.length}칸 중 ${a.present.length}칸 읽힘`];
  if (a.missing.length > 0) parts.push(`빠진 칸: ${a.missing.join(', ')}`);
  if (a.undeclared.length > 0) parts.push(`확정되지 않은 결정: ${a.undeclared.join(', ')}`);
  if (a.lost.length > 0) parts.push(`**되찾을 수 없다**: ${a.lost.join(', ')}`);
  else if (a.captureOpen) parts.push('표지가 남아 있어 아직 옮겨 적을 수 있다');
  if (a.freeText) parts.push('정본 라벨 밖의 자유 메모가 있다(되읽히지 않는다)');
  return `${parts.join('. ')}.\n→ ${a.action}`;
}

/**
 * 공개 필터 — **값을 담지 않는다.** 비고 칸에는 시각 좌표(§2-3)·배포 스코프 이름·테이블 이름이
 * 들어가므로 슬롯 **키와 판정·개수**까지만 내보낸다. 자유 메모는 애초에 담지 않는다.
 */
export function publicRemarks(a: RemarkAssessment): Record<string, unknown> {
  return {
    verdict: a.verdict,
    purpose: a.purpose,
    required: a.required.length,
    present: a.present.length,
    missing: a.missing,
    undeclared: a.undeclared,
    invalid: a.invalid.length,
    silent: a.silent.length,
    captureOpen: a.captureOpen,
    lost: a.lost,
    unrereadable: a.unrereadable,
    ref: a.ref,
  };
}

/* ─────────────────── 정적 점검 ─────────────────── */

/** 정본 자신의 모양 — 사유 없는 선언을 두지 않고, 라벨이 서로를 집어먹지 않는지 */
export function auditRemarkCanon(
  slots: readonly RemarkSlot[] = REMARK_SLOTS,
  misreads: readonly RemarkMisread[] = REMARK_MISREADS,
  blindSpots: readonly RemarkBlindSpot[] = REMARK_BLIND_SPOTS,
): string[] {
  const problems: string[] = [];
  if (slots.length === 0) return ['비고 칸 정본이 비었다 — 그러면 이 절이 지키려는 것이 없다'];

  const keys = new Set<string>();
  const labels: string[] = [];
  for (const s of slots) {
    if (!s.label.trim() || !s.section.trim() || !s.lostWhen.trim() || !s.skipped.trim()) {
      problems.push(`슬롯 ${s.key} 에 빈 칸이 있다`);
    }
    if (keys.has(s.key)) problems.push(`슬롯 키가 겹친다: ${s.key}`);
    keys.add(s.key);
    if (s.kind === 'decision' && s.requiredFor.length === 0) {
      problems.push(`결정 슬롯 ${s.key} 가 어느 목적에서도 필수가 아니다 — 침묵이 두 뜻으로 돌아간다`);
    }
    if (s.kind === 'conditional' && s.requiredFor.length > 0) {
      problems.push(`조건부 슬롯 ${s.key} 를 필수로 적었다 — 없었던 일을 미기록으로 세면 거짓 차단이다`);
    }
    if (s.requiredFor.includes('check')) {
      problems.push(`슬롯 ${s.key} 가 점검 행에서 필수다 — §2 월 점검은 §3 절차를 하나도 수행하지 않는다(§6-8)`);
    }
    labels.push(s.label);
  }

  // 라벨이 서로의 부분 문자열이면 구간 분리가 조용히 어긋난다.
  for (const a of labels) {
    for (const b of labels) {
      if (a !== b && b.includes(a)) problems.push(`라벨 「${a}」 가 「${b}」 에 집어먹힌다 — 파서가 엉뚱한 구간을 읽는다`);
    }
  }

  if (slots.filter((s) => s.kind === 'decision').length < 3) {
    problems.push('결정 슬롯이 셋보다 적다 — 원본 브랜치·검증 배포 포인터·기준 지문 셋이 「한쪽으로 확정」 대상이다');
  }
  if (!slots.some((s) => s.rereadBy)) {
    problems.push('되읽는 쪽이 있는 슬롯이 하나도 없다 — §6-7 이 사라졌으면 그쪽을 함께 볼 것');
  }
  if (!slots.some((s) => !s.rereadBy)) {
    problems.push('되읽는 쪽이 없는 슬롯이 하나도 없다 — 그러면 이 모듈이 필요하지 않다(§6-7 이 전부 본다는 뜻이다)');
  }

  const mkeys = new Set<string>();
  for (const m of misreads) {
    if (!m.judgement.trim() || !m.says.trim() || !m.why.trim()) problems.push(`거짓 판정 ${m.key} 에 빈 칸이 있다`);
    if (mkeys.has(m.key)) problems.push(`거짓 판정 키가 겹친다: ${m.key}`);
    mkeys.add(m.key);
  }
  if (!misreads.some((m) => m.key === 'silence_is_release')) {
    problems.push('`silence_is_release`(침묵을 「뗐다」로 읽는다)가 목록에서 사라졌다 — 이 절의 이유가 사라진다');
  }
  if (!misreads.some((m) => m.key === 'check_row_is_incomplete')) {
    problems.push('`check_row_is_incomplete`(점검 행을 미기록으로 읽는다)가 사라졌다 — 거짓 차단이 다시 열린다');
  }
  for (const b of blindSpots) {
    if (!b.what.trim() || !b.why.trim()) problems.push(`사각지대 ${b.key} 에 빈 칸이 있다`);
  }
  return problems;
}

/** 슬롯이 가리키는 소절이 **실제로 있는지**(없으면 지시가 사라진 것이다) */
export function auditSlotSections(runbookSrc: unknown, slots: readonly RemarkSlot[] = REMARK_SLOTS): string[] {
  const s = String(runbookSrc ?? '');
  const sections = new Set([...s.matchAll(/^#{3,4}\s*(\d{1,2}-\d{1,2})\.\s/gm)].map((m) => m[1]));
  if (sections.size === 0) return ['RUNBOOK 에서 번호 붙은 소절을 하나도 찾지 못했다 — 제목 모양이 바뀌었으면 이 가드를 함께 볼 것'];
  const problems: string[] = [];
  for (const slot of slots) {
    const key = slot.section.replace(/^§/, '').trim();
    if (!sections.has(key)) {
      problems.push(`슬롯 ${slot.key} 가 가리키는 소절 ${slot.section} 이 RUNBOOK 에 없다 — 비고에 적으라고 말하는 자리가 사라졌다`);
    }
  }
  return problems;
}

/**
 * §6-4 `LEDGER_FIELDS` 의 `비고` 칸이 **이 모듈을 읽는 판정으로 들고 있는지**.
 * 그 칸의 `judgedBy` 가 §6-7 하나로 되돌아가면 「구간·고지만 보는 상태」가 조용히 복원된다.
 */
export function auditLedgerNoteField(fields: readonly LedgerField[]): string[] {
  const problems: string[] = [];
  if (fields.length === 0) return ['§6 표 칸 목록을 읽을 수 없다 — LEDGER_FIELDS 의 모양이 바뀌었으면 이 가드를 함께 볼 것'];
  const note = fields.find((f) => f.column === REMARK_COLUMN);
  if (!note) return [`§6 표에 \`${REMARK_COLUMN}\` 칸이 없다 — 열두 슬롯이 들어갈 자리가 사라졌다`];
  if (note.home !== 'table_only') {
    problems.push('`비고` 칸의 집이 표 밖으로 늘었다 — 담당자 이름·스코프가 공개 env 로 나간다(§6 머리말)');
  }
  if (!/remarkSlots|3-23/.test(note.judgedBy ?? '')) {
    problems.push('`비고` 칸의 judgedBy 가 이 모듈을 가리키지 않는다 — 구간·고지 둘만 보는 상태로 되돌아갔다(§3-23 `window_only_is_complete`)');
  }
  return problems;
}

/** 이 모듈이 **순수한지**와 판독을 **복제하지 않았는지** */
export function auditSelfSource(src: unknown): string[] {
  const s = String(src ?? '');
  const problems: string[] = [];
  if (/process\.env\s*[.[]/.test(s)) problems.push('process.env 에 접근한다 — env 는 명시 인자로만 받는다');
  if (/from\s+['"]\.\/(db|migrate)/.test(s)) problems.push('DB 모듈을 import 한다 — 신규 조회 0 이어야 한다');
  if (/from\s+['"]next/.test(s) || /from\s+['"]node:fs['"]/.test(s)) problems.push('next·fs 를 import 한다 — 순수 모듈이 아니다');
  if (!/from\s+['"]\.\/restorePointRecord\.ts['"]/.test(s)) {
    problems.push('구간·고지 판독(`parseRemarkWindow`)을 재사용하지 않는다 — §6-7 과 문구 판독이 갈라진다');
  }
  if (!/from\s+['"]\.\/ledgerPurpose\.ts['"]/.test(s)) {
    problems.push('목적 판독(`purposeOfRow`)을 재사용하지 않는다 — 「정기 점검」이 다시 리허설로 접힌다(§6-8)');
  }
  if (!/from\s+['"]\.\/incidentTimeline\.ts['"]/.test(s)) {
    problems.push('표지 판독(`readTimeline`)을 재사용하지 않는다 — 표지 판독 규칙이 갈라진다');
  }
  if (!/from\s+['"]\.\/incidentEvidence\.ts['"]/.test(s)) {
    problems.push('시각 판독(`parseInstant`)을 재사용하지 않는다 — 엄격 파서가 갈라진다');
  }
  if (/[Dd]ate\s*\.\s*now\s*\(/.test(s)) problems.push('현재 시각을 모듈 안에서 집어온다 — 판정이 재현되지 않는다');
  // ※ 구간 문구 정규식을 이 모듈이 **다시 들고 있지 않은지**는 테스트가 본다 — 그 탐지 패턴을
  //   여기 두면 패턴 자신이 이 소스에 걸려 늘 거짓 경보가 된다(자기 자신을 잡는다).
  return problems;
}

/**
 * **신규 env 0 · 신규 사건 표지 0** — 표지가 늘면 8단계 4번에서 지울 것이 늘고, 하나만 남아도
 * 다음 사건이 그 시각을 근거로 물려받는다(§3-14). 비고는 **표의 칸**이라 env 가 필요 없다.
 */
export function auditNoNewEnv(
  src: unknown,
  allowed: readonly string[] = TIMELINE_MARKERS.map((m) => m.key),
): string[] {
  const s = String(src ?? '');
  const problems: string[] = [];
  if (/process\.env\s*[.[]/.test(s)) problems.push('process.env 에 접근한다');
  if (/\bmarkers\.[A-Z][A-Z0-9_]+/.test(s)) problems.push('표지 키를 직접 읽는다 — 판독은 readTimeline 을 쓴다');
  const known = new Set(allowed);
  for (const found of new Set(s.match(/RECOVERY_[A-Z0-9_]+/g) ?? [])) {
    if (!known.has(found)) problems.push(`새 복구용 키 ${found} 를 들고 있다 — 비고는 표의 칸이고 env 가 아니다`);
  }
  return problems;
}

/**
 * **신규 런타임 체크 0** — §6 표는 저장소 문서이고 배포는 그것을 읽지 않는다. `/api/health` 에
 * 실으면 전 배포가 상시 판정 보류만 내보낸다(§2-2).
 */
export function auditNoNewHealthCheck(healthSrc: unknown): string[] {
  const s = String(healthSrc ?? '');
  return /checks\.remarkSlots|remarkSlots:/.test(s)
    ? ['`/api/health` 에 remarkSlots 체크가 생겼다 — 런타임은 §6 표를 읽지 못해 상시 판정 보류만 내보낸다(§3-23 은 산출 명령으로만 말한다)']
    : [];
}

/** 실제 `RUNBOOK.md` 점검 — 절·정본 라벨·판정 표·유도가 남아 있는지 */
export function auditRunbookRemark(md: unknown, slots: readonly RemarkSlot[] = REMARK_SLOTS): string[] {
  const s = String(md ?? '');
  const problems: string[] = [];
  if (!/^###\s*3-23\./m.test(s)) problems.push('RUNBOOK 에 §3-23 소절이 없다 — 판정의 근거 절이 사라졌다');
  for (const v of REMARK_VERDICTS) {
    if (!s.includes(`\`${v}\``)) problems.push(`§3-23 판정 표에 \`${v}\` 가 없다`);
  }
  for (const m of REMARK_MISREADS) {
    if (!s.includes(`\`${m.key}\``)) problems.push(`§3-23 이 거짓이 되는 판정 \`${m.key}\` 를 적지 않는다`);
  }
  // 정본 라벨이 문서에 **그대로** 있어야 사람이 같은 말로 적을 수 있다(라벨이 다르면 `unparsed`).
  for (const slot of slots) {
    if (!s.includes(`\`${slot.label}\``)) {
      problems.push(`§3-23 에 정본 라벨 \`${slot.label}\` 가 없다 — 사람이 다른 말로 적으면 기록은 남아도 판정이 사라진다`);
    }
  }
  if (!/remarkDraft\(/.test(s)) problems.push('§3-23 에 산출 명령이 없다 — 판정·초안에 닿을 수단이 문서에 없다');

  // 8단계 3번(표에 적는다)이 이 절로 유도하는지. 표지를 지운 뒤에는 옮겨 적을 수 없다.
  const from = s.indexOf('8. **사후**');
  const to = s.indexOf('### 3-1.');
  const step8 = from >= 0 && to > from ? s.slice(from, to) : '';
  if (!step8) problems.push('§3 8단계 본문을 찾을 수 없다');
  else if (!step8.includes('3-23')) {
    problems.push('§3 8단계가 3-23 으로 유도하지 않는다 — 열두 칸이 어디에 모여 있는지 말하는 자리가 없어진다');
  }
  return problems;
}
