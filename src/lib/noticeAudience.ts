/**
 * noticeAudience.ts — 고지할 **상대**를 특정할 수 있는가(RUNBOOK §3-16·§3-10·§3-5). 2026-10-26
 *
 * ── 왜 필요한가 ───────────────────────────────────────────────────────────────
 * §3 1~8단계·§1·§2·§4·§5·§6 이 전부 향하는 산출물은 하나이고(§3-10: 「이 절차에서 **유일하게
 * 되돌릴 수 없는** 산출물」) 그 문장은 「손실 구간을 반드시 **이해관계자에게** 고지한다」다.
 * 2026-10-19 배치는 그 **시각**을(`RECOVERY_LOSS_NOTICE_AT`) 기록 대상으로 승격했고,
 * `NOTICE_LIMITS` 는 「대상 범위는 이 값으로 알 수 없다」고 한계만 적어 두었다. 한편
 * `lib/recoveryObjectives.ts` 는 「약속을 **누구에게** 했는지는 코드가 모른다 — **고지 대상
 * 판정은 §3-10 이 한다**」고 §3-10 으로 넘겨 두었는데, **§3-10 에는 그 판정이 없다.**
 * 넘긴 쪽과 받은 쪽 사이에 아무것도 없는 자리가 이 모듈이 메우는 자리다.
 *
 *  (1) **명단의 유일한 출처가 복구 대상과 같은 DB 다.** 연락처는 `users.email` 하나뿐이고
 *      (`organizations` 에는 연락처 칼럼이 **없다** — slug·name·plan·invite_code·created_at),
 *      「조직의 이해관계자」는 `memberships` 로만 이어진다. 5단계 전환은 그 세 테이블을 전부
 *      T-ε 로 되돌린다 — 즉 **고지 대상 명단 자체가 복구로 되돌아간다.**
 *
 *  (2) **가장 많이 잃은 쪽이 명단에서 빠진다.** T-ε 이후에 가입한 조직·회원은 복구된 DB 에
 *      행이 아예 없다(`created_at > T-ε`). 그들의 데이터는 **전부** 유실인데 명단에는 없고,
 *      없는 행은 셀 수 없으므로 4단계 행 수 대조도 그것을 말하지 못한다(§3-11 은 **감소**를
 *      보고 기준 스냅샷은 **합계**다 — 어느 조직이 사라졌는지는 어느 쪽도 모른다).
 *
 *  (3) **연락처가 옛 주소로 되돌아간다.** T-ε 이후 바꾼 `users.email` 은 전환으로 옛 값이
 *      되고, 그 주소로 나간 고지는 반송되거나 **이전 주소의 소유자**에게 사건 내용을 알린다 —
 *      되돌릴 수 없는 외부 발신이고 개인정보 사고다. §3-8 은 되돌아가는 **접근 수단**
 *      (세션·비밀번호·잠금·권한)을 정본화했지만 **발신 대상**은 그 표에 없다.
 *
 *  (4) **보존본으로도 메울 수 없다.** §3-5 보존본은 DB 밖에 남지만 그 안에 **연락처가 없다** —
 *      `lib/audit.ts` 는 「PII 원문 저장 금지」가 설계이고(이메일은 `maskEmail` 로 마스킹),
 *      `AUTH_REGISTER` 같은 행은 `org_id`·`user_id` 까지만 말한다. 전환 뒤 그 id 는 복구된
 *      DB 에 **없는 id** 다. 그래서 보존을 완벽히 했더라도 「누구인지」는 알고 **「어디로
 *      보낼지」는 모르는** 상태로 끝난다.
 *
 *  (5) **그래도 고지는 「수행됨」으로 보인다.** `RECOVERY_LOSS_NOTICE_AT` 는 명단 없이도 적을 수
 *      있고 그러면 `state: notified` + `canClearMarkers: true` 가 나온다 — 전원에게 고지한
 *      복구와 **닿지 않은 대상이 있는 복구가 글자 하나 다르지 않다.** 어느 검증도 실패하지 않는다
 *      (4단계는 행 수, 6단계는 테이블 존재, 7단계 게이트는 6-1·6-2 의 시각만 본다).
 *
 * 그래서 이 모듈은
 *   · 명단을 뽑을 수 있는 자리와 **연락처를 담은 곳이 하나뿐**이라는 사실을 정본으로 두고,
 *   · 복구된 DB 명단으로 고지할 때의 어긋남 세 방향을 **전건 `detectable: false`** 로 적고,
 *   · 전환 **전에** 명단을 DB 밖으로 받는 읽기 전용 조회문을 두고(§3-5 3번),
 *   · 지금이 **받을 수 있는 창인지**(차단 중) / 이미 닫혔는지를 판정하고,
 *   · 「고지했다」가 **전원에게 닿았다는 뜻이 아니라는 것**을 고지문 문구로 함께 돌려준다.
 *
 * 원칙
 * - 순수 모듈: DB·next·fs 미접근, **신규 조회·쓰기·DDL 0 · 신규 env 0 · 신규 런타임 체크 0**.
 *   조회문은 **문자열 상수**이고 이 모듈은 실행하지 않는다(§3-1 의 베이스라인 DDL 과 같은 규율).
 * - **새 표지를 만들지 않는다.** 명단 보존은 §3-5 내보내기의 세 번째 출처로 들어가므로
 *   수행 기록은 `RECOVERY_EVIDENCE_PRESERVED_AT` 하나가 그대로 쓴다(표지가 늘면 8단계 4번에서
 *   지울 것이 늘고, 하나만 남아도 다음 사건이 그것을 물려받는다 — §3-14).
 * - **발신하지 않는다 · 명단을 만들지 않는다.** 코드는 「받을 수 있는 창인가」까지만 말한다.
 * - **구분할 수 없는 것을 구분했다고 하지 않는다**: 보존 기록은 **주장**이고 그 보존본에 명단이
 *   들어 있는지 코드는 모른다(`rosterClaimed`). 「전원에게 갔는가」는 **늘 모른다**(`coversAll`).
 */
import { freezeAtFromEnv } from './incidentClosure.ts';
import { parseInstant } from './incidentEvidence.ts';
import { PRESERVED_AT_ENV, preservedAtFromEnv } from './evidencePreservation.ts';
import { WRITE_FREEZE_ENV, writeFreezeEnabled } from './writeFreeze.ts';

/** 응답·문서에서 근거 절을 찾을 수 있게 한다 */
export const AUDIENCE_RUNBOOK_REF = 'RUNBOOK §3-16·§3-10·§3-5';

/** 연락처를 담은 **유일한** 칼럼. 모양이 바뀌면 `auditContactShape` 가 CI 로 잡는다 */
export const CONTACT_COLUMN = 'users.email';

/** 명단을 이루는 테이블 — 전환이 **전부** 되돌린다 */
export const ROSTER_TABLES = ['organizations', 'memberships', 'users'] as const;

/* ─────────────────────── 명단을 뽑을 수 있는 자리 정본 ─────────────────────── */

export interface ContactSource {
  id: string;
  /** 어디에서 뽑는가 */
  where: string;
  /** 그 출처가 말해 주는 범위 */
  scope: string;
  /** **연락처(발신 주소)가 들어 있는가** */
  hasContact: boolean;
  /** 5단계 전환 뒤의 상태 */
  afterSwitch: string;
}

/**
 * 고지 대상을 뽑을 수 있는 자리 전건. `hasContact: true` 가 **하나뿐**이고 그 하나가
 * 복구 대상 DB 안에 있다 — 이것이 이 절의 모든 문제의 뿌리다.
 */
export const CONTACT_SOURCES: readonly ContactSource[] = [
  {
    id: 'restored_db',
    where: `\`${ROSTER_TABLES.join('`·`')}\`(복구된 DB) — 연락처는 \`${CONTACT_COLUMN}\` 하나뿐이다`,
    scope: '복구 시점(T-ε)에 존재했던 조직·회원',
    hasContact: true,
    afterSwitch:
      'T-ε 로 되돌아간다 — 이후 가입분이 **없고**, 바뀐 메일 주소는 **옛 값**이고, ' +
      '내린 계정(`users.is_active`)·회수한 역할이 되살아난다',
  },
  {
    id: 'preserved_audit',
    where: '§3-5 보존본 — `GET /api/audit` 로 받아 DB 밖에 둔 업무 변경 이력',
    scope: '**조직 스코프**의 업무 데이터 변경 이력(다른 조직 분은 애초에 받을 수 없다)',
    hasContact: false,
    afterSwitch: 'DB 밖이라 남는다 — 그러나 `detail` 은 PII 를 뺀 설계라 주소가 없다',
  },
  {
    id: 'preserved_security',
    where: '§3-5 보존본 — `GET /api/admin/security-events`(슈퍼관리자)',
    scope: '`entity: auth` 보안·인증 이벤트(가입 `AUTH_REGISTER` 포함 — 전 테넌트)',
    hasContact: false,
    afterSwitch:
      'DB 밖이라 남는다 — `org_id`·`user_id`·이름까지이고 **메일 주소는 마스킹·미기록**이다' +
      '(`lib/audit.ts` 의 「PII 원문 저장 금지」). 그 id 는 전환 뒤 **없는 id** 다',
  },
  {
    id: 'count_baseline',
    where: '§3-2 기준 스냅샷(`RECOVERY_DATA_BASELINE`)',
    scope: '핵심 테이블의 **합계**뿐',
    hasContact: false,
    afterSwitch: '남지만 어느 조직이 사라졌는지 말하지 않는다 — 수치는 전 테넌트 합계다',
  },
];

/** 연락처를 담은 출처 — **한 건이 지금의 사실**이고 그 한 건이 복구 대상 안에 있다 */
export function contactBearingSources(
  sources: readonly ContactSource[] = CONTACT_SOURCES,
): string[] {
  return sources.filter((s) => s.hasContact).map((s) => s.id);
}

/* ─────────────────── 복구된 DB 명단으로 고지할 때의 어긋남 ─────────────────── */

export interface AudienceDrift {
  id: string;
  /** 무엇이 어긋나는가 */
  what: string;
  /** 그 결과 고지가 어떻게 되는가 */
  effect: string;
  /** **어떤 응답·검증이라도 이것을 드러내는가** */
  detectable: boolean;
  /** 누가 알려 주는가 */
  whoReports: string;
}

/**
 * 전건 `detectable: false` 다 — 명단이 어긋난 채 나간 고지에서 **아무 응답도 달라지지 않는다.**
 * 방향이 둘이라는 점이 §3-9 와 같다: 한쪽(빠진 대상)은 당사자가 다른 일로 문의해 올 수 있고,
 * 다른 쪽(엉뚱한 수신자)은 **아무도 알려 주지 않는다.**
 */
export const AUDIENCE_DRIFTS: readonly AudienceDrift[] = [
  {
    id: 'missing_signups',
    what: 'T-ε 이후 가입한 조직·회원의 행이 복구된 DB 에 **없다**',
    effect:
      '데이터를 **전부** 잃은 쪽이 고지 대상 명단에서 빠진다 — 없는 행은 셀 수 없어 ' +
      '4단계 행 수 대조도(기준 스냅샷은 합계다) 그것을 말하지 않는다',
    detectable: false,
    whoReports:
      '당사자가 「로그인이 안 된다」로 문의할 수는 있다 — 그것은 고지가 아니고, 문의하지 않는 쪽은 끝까지 모른다',
  },
  {
    id: 'stale_contact',
    what: `T-ε 이후 바꾼 \`${CONTACT_COLUMN}\` 이 옛 주소로 되돌아간다`,
    effect:
      '고지가 반송되거나 **이전 주소의 소유자**에게 사건 내용이 간다 — 되돌릴 수 없는 발신이고, ' +
      '새 주소는 복구된 DB 에 없으므로 다시 보낼 대상도 알 수 없다',
    detectable: false,
    whoReports: '아무도 — 보낸 쪽은 보냈다고 적고, 받지 못한 쪽은 보낸 사실을 모른다',
  },
  {
    id: 'reactivated',
    what: 'T-ε 이후 내린 계정(`users.is_active`)·회수한 역할(`memberships`)이 되살아난다',
    effect:
      '더 이상 담당자가 아닌 사람이 명단에 들어 사건 내용을 받는다 — §3-8 6-1단계가 ' +
      '접근 수단을 재적용해도 **명단은 복구된 DB 에서 뽑으므로** 그대로다',
    detectable: false,
    whoReports: '아무도 — 수신 자격이 없다는 사실은 복구된 DB 안에 없다',
  },
];

/* ─────────────────── 전환 전에 받는 명단(읽기 전용 조회) ─────────────────── */

/**
 * 전환 **전에** 명단을 DB 밖으로 받는 조회문. **읽기 전용**(`select` 뿐 — 쓰기 동사 0,
 * DDL 0)이고 이 모듈은 **실행하지 않는다**(§3-1 베이스라인 DDL 과 같은 규율: 문자열만 둔다).
 *
 * 왜 이것이 필요한가: 전 테넌트 명단을 돌려주는 **애플리케이션 경로가 없다** —
 * `GET /api/admin/users` 는 `memberships.org_id = ctx.orgId` 로 **조직 스코프**이고
 * (`auditRosterScope` 가 그 사실을 CI 로 고정한다) 운영자가 그 조직의 구성원이어야 한다.
 * 그래서 남는 수단은 **복구 전 DB 에 대한 읽기 전용 접속** 한 번이다.
 *
 * ⚠️ 결과는 **개인정보(메일 주소)** 다 — 보관은 §3-5 와 같은 규율(복구 대상 DB **밖**의
 * 접근통제되는 보관소)이고, 보존 기간·폐기는 사람이 정한다. `created_at` 을 함께 받는
 * 이유는 전환 뒤에 **T-ε 이후 가입분을 가려내는** 유일한 축이기 때문이다.
 */
export const ROSTER_SNAPSHOT_SQL =
  'select o.id as org_id, o.slug, o.plan, o.created_at as org_created_at, ' +
  'u.id as user_id, u.email, u.name, u.is_active, ' +
  'm.role, m.is_org_admin, m.created_at as member_created_at ' +
  'from memberships m ' +
  'join organizations o on o.id = m.org_id ' +
  'join users u on u.id = m.user_id ' +
  'order by o.id, u.id';

/** 쓰기 동사가 섞여 들어오지 않았는지 — 복구일에 돌리는 문장이라 모듈 자신이 점검한다 */
export function auditRosterSqlReadOnly(sql: string = ROSTER_SNAPSHOT_SQL): string[] {
  const s = String(sql ?? '').toLowerCase();
  const problems: string[] = [];
  if (!s.startsWith('select ')) problems.push('조회문이 select 로 시작하지 않는다');
  for (const verb of ['insert', 'update', 'delete', 'drop', 'alter', 'create', 'truncate', 'grant']) {
    if (new RegExp(`\\b${verb}\\b`).test(s)) problems.push(`조회문에 쓰기 동사 ${verb} 가 있다 — 복구 전 DB 에 돌리는 문장이다`);
  }
  for (const t of ROSTER_TABLES) {
    if (!s.includes(t)) problems.push(`조회문이 ${t} 를 읽지 않는다 — 명단이 그만큼 비어서 나간다`);
  }
  if (!s.includes('created_at')) {
    problems.push('조회문이 created_at 을 받지 않는다 — 전환 뒤 T-ε 이후 가입분을 가려낼 축이 없다');
  }
  return problems;
}

/* ─────────────────────────── 판정 ─────────────────────────── */

export const AUDIENCE_VERDICTS = [
  /** 평상시 — 차단 OFF, 사건 표지 없음 */
  'not_applicable',
  /** 차단 중이고 명단 보존 기록이 없다 — **지금이 받을 수 있는 창이다** */
  'preservable',
  /** §3-5 보존 기록이 있다 — 그 보존본에 명단이 들어 있는지는 **주장**이다 */
  'claimed',
  /** 차단은 풀렸는데 보존 기록 없이 사건 표지가 남아 있다 — 창이 닫혔다 */
  'window_closed',
  /** 보존 시각을 읽을 수 없다 */
  'invalid_record',
] as const;
export type AudienceVerdict = (typeof AUDIENCE_VERDICTS)[number];

export const ACTION_AUDIENCE_NOT_APPLICABLE =
  `평상시 — 차단 OFF, 사건 표지 없음. 명단 보존은 복구·리허설 중 §3-5 3번에서 한다`;

export const ACTION_AUDIENCE_PRESERVABLE =
  '차단 중이고 명단 보존 기록이 없다 — **지금** `ROSTER_SNAPSHOT_SQL` 로 조직·회원 명단(연락처 포함)을 ' +
  `복구 대상 DB **밖**으로 받고, §3-5 의 다른 두 출처와 함께 마친 시각을 \`${PRESERVED_AT_ENV}\` 에 적는다. ` +
  '조회는 차단 중에도 열려 있다(차단은 쓰기만 막는다). **전환 뒤에는 이 명단을 되찾을 경로가 없다** — ' +
  '보존본에는 연락처가 없고(PII 미기록 설계) 복구된 DB 에는 그 행이 없다';

export const ACTION_AUDIENCE_CLAIMED =
  '§3-5 보존 기록이 있다 — 고지 대상은 **보존본의 명단 ∪ 복구된 DB 의 명단**으로 만든다. ' +
  '코드는 그 보존본에 명단이 들어 있는지 **확인하지 않는다**(`rosterClaimed` 는 주장이다). ' +
  '세 출처를 다 받았는지 사람이 확인하고, 아래 어긋남 세 방향을 고지문에 함께 적는다';

export const ACTION_AUDIENCE_WINDOW_CLOSED =
  '차단은 풀렸는데 명단 보존 기록이 없다 — 고지 대상을 **전부 특정할 경로가 남아 있지 않다**. ' +
  '명단을 추정해 만들지 않고, 고지문과 §6 표 비고에 **닿지 않은 대상이 있을 수 있다는 사실**을 적는다' +
  '(`disclosure`). 복구된 DB 명단으로 보내는 고지는 어긋남 세 방향을 그대로 품는다';

export const ACTION_AUDIENCE_INVALID =
  `\`${PRESERVED_AT_ENV}\` 값을 읽을 수 없다 — 타임존을 붙인 ISO 시각으로 다시 넣는다. ` +
  '판독 불가를 「보존했다」로도 「안 했다」로도 세지 않는다';

const ACTION: Record<AudienceVerdict, string> = {
  not_applicable: ACTION_AUDIENCE_NOT_APPLICABLE,
  preservable: ACTION_AUDIENCE_PRESERVABLE,
  claimed: ACTION_AUDIENCE_CLAIMED,
  window_closed: ACTION_AUDIENCE_WINDOW_CLOSED,
  invalid_record: ACTION_AUDIENCE_INVALID,
};

/**
 * 고지문에 **반드시 함께 적는** 문구. 명단이 복구된 DB 에서 나오는 한 어긋남은 판정으로
 * 가려낼 수 없으므로(전건 `detectable: false`), 고지받는 쪽이 「나는 대상인가」를 스스로
 * 확인할 수 있게 하는 것이 유일하게 남은 수단이다.
 */
export const AUDIENCE_DISCLOSURE =
  '이 고지는 복구된 데이터베이스의 조직·구성원 명단을 기준으로 발송되었습니다. ' +
  '복구 시점 이후에 가입하셨거나 연락처를 변경하신 경우 이 고지가 닿지 않을 수 있으므로, ' +
  '주변에 전달해 주시거나 문의해 주시기 바랍니다.';

export const CAVEAT_ROSTER_IS_RESTORED =
  `고지 대상 명단의 **유일한 연락처 출처**(\`${CONTACT_COLUMN}\`)가 복구 대상 DB 안에 있다 — ` +
  '명단 자체가 복구로 되돌아가고, 그 되돌아감은 어느 검증에도 걸리지 않는다';

export const CAVEAT_EVIDENCE_HAS_NO_CONTACT =
  '§3-5 보존본은 **연락처를 담지 않는다** — `lib/audit.ts` 가 PII 원문 저장을 금지하는 설계이고, ' +
  '보존본의 `user_id` 는 전환 뒤 **없는 id** 다. 보존을 완벽히 해도 「누구인지」까지이고 「어디로」가 아니다';

export const CAVEAT_CLAIM_NOT_CONTENT =
  `\`${PRESERVED_AT_ENV}\` 는 §3-5 **세 출처를 받았다는 주장**이다 — 명단이 그 안에 들어 있는지, ` +
  'DB 밖에 두었는지는 코드가 확인하지 않는다(§3-15 와 같은 한계)';

export const CAVEAT_COVERS_ALL_UNKNOWN =
  '「전원에게 갔는가」는 **늘 알 수 없다** — 발신 통로가 전건 수동이라 저장소에 수신 근거가 없고' +
  '(§3-10 `NOTICE_CHANNELS`), 빠진 대상은 정의상 명단에 없으므로 셀 수도 없다';

/** 명단이 보장하지 **못하는** 것. 판정과 함께 실려 나간다 */
export const AUDIENCE_LIMITS: readonly string[] = [
  CAVEAT_ROSTER_IS_RESTORED,
  CAVEAT_EVIDENCE_HAS_NO_CONTACT,
  CAVEAT_CLAIM_NOT_CONTENT,
  CAVEAT_COVERS_ALL_UNKNOWN,
  '전 테넌트 명단을 돌려주는 **애플리케이션 경로가 없다** — `GET /api/admin/users` 는 조직 스코프다. ' +
    '교차 테넌트 명단 조회 경로 신설은 **[승인 필요]** 사항이다(응답이 전 조직의 메일 주소다)',
  '이 판정은 **이 배포의 env 한 벌만** 본다 — 다른 스코프에 적어 둔 보존 기록은 보이지 않는다(§3-13 과 같은 한계)',
  '명단을 받아 두었다는 것이 **고지가 적절했다**는 뜻은 아니다 — 내용·시점·수신 여부는 이 판정 밖이다',
  '파트너 경유 고객사의 고지 경로는 아직 없다 — `partners`·`partner_attributions` 는 **미적용**(승인 대기)이라 ' +
    '`partner_id` 로 담당자를 찾는 경로가 코드에 없다',
];

export interface AudienceInput {
  /** 지금 쓰기 차단이 걸려 있는가 */
  frozen?: boolean;
  /** §3-5 보존 수행 기록(`RECOVERY_EVIDENCE_PRESERVED_AT`) 원문 */
  preservedAt?: unknown;
  /** 복구 시점(T-ε) 기록 — 사건 표지가 남아 있는지 보는 데만 쓴다 */
  restorePoint?: unknown;
  /** 차단 실효 시각 기록 — 같은 용도 */
  freezeAt?: unknown;
  /** 고지 발신 기록 — 같은 용도 */
  noticedAt?: unknown;
}

export interface AudienceAssessment {
  verdict: AudienceVerdict;
  /** 명단을 **지금** 받을 수 있는가(= 전환 전 DB 에 아직 있는가) */
  preservable: boolean;
  /** §3-5 보존 기록이 있는가. **내용은 확인하지 않는다** */
  rosterClaimed: boolean;
  /** 「전원에게 갔는가」 — 코드는 **늘 모른다**. 거짓 ok 를 만들지 않기 위해 상수로 둔다 */
  coversAll: 'unknown';
  /** 연락처를 담은 출처 수(**1 이 지금의 사실**이고 그 하나가 복구 대상 안에 있다) */
  contactSources: number;
  /** 복구된 DB 명단으로 고지할 때의 어긋남 — 전건 detectable: false */
  drifts: readonly AudienceDrift[];
  /** 고지문에 함께 적는 문구 */
  disclosure: string;
  /** 지금 할 일이 있는가(읽는 쪽이 조건식을 다시 짜 판정이 갈리지 않게 함께 돌려준다) */
  actionable: boolean;
  action: string;
  caveats: readonly string[];
}

function present(v: unknown): string {
  return String(v ?? '').trim();
}

/**
 * 명단 근거 판정.
 *
 * 판정 순서: **못 읽는 값이 먼저다**(판독 실패를 「없다」로 섞으면 할 일이 달라진다) →
 * 차단 중(= 창이 열려 있다)인지 → 보존 기록이 있는지 → 사건 표지가 남아 있는지.
 * 순서를 바꾸면 차단 중 미보존(`preservable` — **지금 받으면 된다**)이 `window_closed`
 * (= 「되찾을 수 없다」)로 덮여, 받을 수 있는 순간에 포기하라고 말하게 된다.
 */
export function assessAudience(input?: AudienceInput): AudienceAssessment {
  const frozen = Boolean(input?.frozen);
  const rawPreserved = present(input?.preservedAt);
  const parsedPreserved = rawPreserved ? parseInstant(rawPreserved) : null;
  const rosterClaimed = parsedPreserved !== null;
  const markers = [input?.restorePoint, input?.freezeAt, input?.noticedAt].some((v) => present(v));

  let verdict: AudienceVerdict;
  if (rawPreserved && !parsedPreserved) verdict = 'invalid_record';
  else if (rosterClaimed) verdict = 'claimed';
  else if (frozen) verdict = 'preservable';
  else if (markers) verdict = 'window_closed';
  else verdict = 'not_applicable';

  return {
    verdict,
    preservable: frozen && !rosterClaimed,
    rosterClaimed,
    coversAll: 'unknown',
    contactSources: contactBearingSources().length,
    drifts: AUDIENCE_DRIFTS,
    disclosure: AUDIENCE_DISCLOSURE,
    actionable: verdict !== 'not_applicable',
    action: ACTION[verdict],
    caveats: AUDIENCE_LIMITS,
  };
}

/** env 스냅샷으로 판정한다 — 읽는 키는 **이미 있는 네 개**이고 새 키를 만들지 않는다 */
export function audienceFromEnv(env: Record<string, string | undefined> = process.env): AudienceAssessment {
  return assessAudience({
    frozen: writeFreezeEnabled(env),
    preservedAt: preservedAtFromEnv(env).raw ?? undefined,
    freezeAt: freezeAtFromEnv(env).raw ?? undefined,
    restorePoint: env.RECOVERY_RESTORE_POINT,
    noticedAt: env.RECOVERY_LOSS_NOTICE_AT,
  });
}

/* ─────────────────────── 출력(한 칸·사람용·로그) ─────────────────────── */

/**
 * §3-10 체크가 **자기 자리에서** 받는 한 칸. 어휘를 판정과 같게 두어 두 곳에서 갈리지 않게 한다.
 */
export function audienceCell(a: AudienceAssessment): AudienceVerdict {
  return a.verdict;
}

/** 사람이 읽는 요약(§3-16 의 1줄 명령이 출력하는 것) */
export function audienceText(a: AudienceAssessment): string {
  const lines = [`[고지 대상] ${a.verdict}`, a.action];
  if (a.verdict !== 'not_applicable') {
    lines.push(`연락처를 담은 출처: ${a.contactSources}건(${contactBearingSources().join('·')})`);
    for (const d of a.drifts) lines.push(`· ${d.what} → ${d.effect}`);
    lines.push(`고지문에 함께 적는다: ${a.disclosure}`);
  }
  return lines.join('\n');
}

/** 구조화 로그 한 줄. **판정·boolean 만** — 주소·명단·행 수는 담지 않는다 */
export function audienceLogLine(a: AudienceAssessment): string {
  return [
    'recovery_notice_audience',
    `verdict=${a.verdict}`,
    `roster_claimed=${a.rosterClaimed}`,
    `preservable=${a.preservable}`,
    `covers_all=${a.coversAll}`,
    `drifts=${a.drifts.length}`,
  ].join(' ');
}

/**
 * 공개 응답용 필터. **시각·주소·명단·행 수를 담지 않는다** — 무인증 응답에서 사건 타임라인을
 * 역산할 수 있게 되는 것을 막는다(§2-3 과 같은 규율).
 */
export function publicAudience(a: AudienceAssessment): {
  verdict: AudienceVerdict;
  rosterClaimed: boolean;
  preservable: boolean;
  coversAll: 'unknown';
  drifts: number;
} {
  return {
    verdict: a.verdict,
    rosterClaimed: a.rosterClaimed,
    preservable: a.preservable,
    coversAll: a.coversAll,
    drifts: a.drifts.length,
  };
}

/** 배선 상태 요약(문서·보고용) */
export function audienceStatus(env: Record<string, string | undefined> = process.env): {
  verdict: AudienceVerdict;
  switchKey: string;
  recordKey: string;
  contactSources: number;
  drifts: number;
  limits: number;
  note: string;
} {
  const a = audienceFromEnv(env);
  return {
    verdict: a.verdict,
    switchKey: WRITE_FREEZE_ENV,
    recordKey: PRESERVED_AT_ENV,
    contactSources: a.contactSources,
    drifts: a.drifts.length,
    limits: AUDIENCE_LIMITS.length,
    note: a.action,
  };
}

/* ─────────────────────────── 정적 점검 ─────────────────────────── */

/** 정본 모양 — 빈 칸·중복·「전건 detectable」 거짓 선언을 잡는다 */
export function auditAudienceCanon(
  sources: readonly ContactSource[] = CONTACT_SOURCES,
  drifts: readonly AudienceDrift[] = AUDIENCE_DRIFTS,
): string[] {
  const problems: string[] = [];
  if (sources.length === 0) problems.push('연락처 출처 목록이 비었다');
  if (drifts.length === 0) problems.push('어긋남 목록이 비었다');
  const ids = new Set<string>();
  for (const s of sources) {
    if (!s.where.trim() || !s.scope.trim() || !s.afterSwitch.trim()) problems.push(`${s.id} 의 칸이 비었다`);
    if (ids.has(s.id)) problems.push(`출처 ${s.id} 가 중복이다`);
    ids.add(s.id);
  }
  if (sources.filter((s) => s.hasContact).length !== 1) {
    problems.push(
      '연락처를 담은 출처가 1건이 아니다 — 늘었다면 그 출처가 복구 대상 밖인지 다시 보고 ' +
        '이 절(§3-16)의 서술을 함께 고칠 것',
    );
  }
  for (const d of drifts) {
    if (!d.what.trim() || !d.effect.trim() || !d.whoReports.trim()) problems.push(`${d.id} 의 칸이 비었다`);
    if (d.detectable) {
      problems.push(
        `${d.id} 가 detectable: true 로 선언됐다 — 드러내는 응답·검증이 **실제로** 생겼다면 ` +
          '그 칸을 §3-16 표와 함께 고치고, 아니라면 거짓 선언이다',
      );
    }
  }
  return problems;
}

/**
 * `src/db/schema.ts` 원문 — 이 절의 전제(연락처 칼럼이 **하나**이고, 명단 세 테이블에
 * `created_at` 이 있다)가 그대로인지. 연락처 칼럼이 늘면 §3-16 의 명단 조회·서술이 **조용히
 * 불완전**해지고(새 주소로는 고지가 안 간다), `created_at` 이 없어지면 전환 뒤 T-ε 이후
 * 가입분을 가려낼 축이 사라진다.
 */
export function auditContactShape(src: unknown): string[] {
  const s = String(src ?? '');
  const problems: string[] = [];
  const table = (name: string): string => {
    const i = s.indexOf(`pgTable('${name}'`);
    if (i < 0) return '';
    return s.slice(i, i + 1200);
  };

  const orgs = table('organizations');
  if (!orgs) problems.push('organizations 선언을 찾을 수 없다 — 스키마 모양이 바뀌었으면 이 가드를 함께 볼 것');
  else if (/\b(email|phone|contact)\b/i.test(orgs)) {
    problems.push(
      'organizations 에 연락처 칼럼이 생겼다 — 고지 대상을 조직 단위로 받을 수 있게 된 것이므로 ' +
        '§3-16 의 「연락처는 users.email 하나뿐」 서술과 명단 조회문을 함께 고칠 것',
    );
  }

  const usr = table('users');
  if (!usr) problems.push('users 선언을 찾을 수 없다');
  else if (!/email:\s*text\('email'\)/.test(usr)) {
    problems.push(`${CONTACT_COLUMN} 이 사라졌거나 모양이 바뀌었다 — 유일한 발신 주소 출처다`);
  }

  for (const t of ROSTER_TABLES) {
    const src2 = table(t);
    if (!src2) continue;
    if (!/created_at/.test(src2)) {
      problems.push(`${t} 에 created_at 이 없다 — 전환 뒤 복구 시점 이후분을 가려낼 축이 사라진다`);
    }
  }
  return problems;
}

/**
 * `src/app/api/admin/users/route.ts` 원문 — 명단 조회가 **조직 스코프**라는 사실을 고정한다.
 * 전 테넌트 명단 경로가 생기면(승인 사항이다) §3-16 의 「경로가 없다」와 보존 수단 서술이
 * 틀린 말이 되는데, 화면·응답은 그대로 돌기 때문에 사람 눈으로는 알아챌 수 없다.
 */
export function auditRosterScope(src: unknown): string[] {
  const s = String(src ?? '');
  const problems: string[] = [];
  if (!/memberships/.test(s) || !/users/.test(s)) {
    problems.push('명단 라우트에서 memberships·users 조회를 찾을 수 없다 — 경로가 바뀌었으면 이 가드를 함께 볼 것');
    return problems;
  }
  if (!/email:\s*users\.email/.test(s)) {
    problems.push('명단 라우트가 메일 주소를 돌려주지 않는다 — §3-16 의 수단 서술을 함께 고칠 것');
  }
  if (!/eq\(memberships\.orgId,\s*ctx\.orgId\)/.test(s)) {
    problems.push(
      '명단 조회의 조직 스코프(eq(memberships.orgId, ctx.orgId))가 사라졌다 — 전 테넌트 명단이 ' +
        '열렸다면 §3-16 과 승인 상태를 함께 고칠 것',
    );
  }
  return problems;
}

/**
 * `src/lib/audit.ts` 원문 — 「보존본에 연락처가 없다」는 전제의 근거.
 * 감사 detail 에 PII 원문을 담게 바뀌면 (가) 이 절의 전제가 바뀌고 (나) 보존본이 개인정보
 * 파일이 되므로 보관 규율이 함께 달라져야 한다.
 */
export function auditEvidencePiiPolicy(src: unknown): string[] {
  const s = String(src ?? '');
  const problems: string[] = [];
  if (!/PII 원문 저장 금지/.test(s)) {
    problems.push('lib/audit.ts 에 「PII 원문 저장 금지」 규율이 없다 — 보존본에 주소가 없다는 전제가 깨졌다');
  }
  if (!/maskEmail/.test(s)) problems.push('lib/audit.ts 가 maskEmail 규율을 가리키지 않는다');
  if (!/sanitizeAccessDetail/.test(s)) problems.push('lib/audit.ts 가 sanitizeAccessDetail 를 쓰지 않는다');
  return problems;
}

/**
 * `src/lib/lossNotice.ts` 원문 — 판정을 **고지 체크의 응답에 실어 보내는지**.
 * 빠지면 복구 담당자는 「고지했다」만 보고 그것이 전원에게 닿았다는 뜻으로 읽는다.
 */
export function auditNoticeWiring(src: unknown): string[] {
  const s = String(src ?? '');
  const problems: string[] = [];
  if (!/from\s+['"]\.\/noticeAudience\.ts['"]/.test(s)) problems.push('lossNotice 가 noticeAudience 를 import 하지 않는다');
  if (!/assessAudience\(|audienceFromEnv\(/.test(s)) problems.push('lossNotice 가 명단 판정을 호출하지 않는다');
  if (!/audienceVerdict\s*:/.test(s)) problems.push('lossNotice 가 audienceVerdict 를 detail 에 담지 않는다 — 판정만 하고 버린다');
  if (!/audienceRosterClaimed\s*:/.test(s)) problems.push('lossNotice 가 audienceRosterClaimed 를 detail 에 담지 않는다');
  if (!/audienceCoversAll\s*:/.test(s)) {
    problems.push('lossNotice 가 audienceCoversAll 를 detail 에 담지 않는다 — 「전원에게 갔는가」를 모른다는 사실이 사라진다');
  }
  return problems;
}

/**
 * `app/api/health/route.ts` 원문 — **새 체크가 생기지 않았는지**.
 * 같은 국면을 `checks.lossNotice` 가 이미 보고하므로(고지가 그 체크의 주제다) 체크를 하나 더
 * 만들면 degraded 가 늘고 §6-3 인용 정본도 함께 갈라진다.
 */
export function auditNoNewHealthCheck(src: unknown): string[] {
  const s = String(src ?? '');
  const problems: string[] = [];
  if (/from\s+['"]@\/lib\/noticeAudience['"]/.test(s)) {
    problems.push('헬스 라우트가 noticeAudience 를 직접 import 한다 — 판정은 checks.lossNotice 안에서 말한다');
  }
  if (/checks\.noticeAudience\s*=/.test(s)) {
    problems.push('checks.noticeAudience 가 새로 생겼다 — degraded 가 늘고 인용 정본이 갈라진다');
  }
  return problems;
}

/**
 * `RUNBOOK.md` 원문 — §3-16 과 그것을 가리키는 자리가 함께 남아 있는지.
 * 특히 **§3-5 가 명단 내보내기를 지시하고 있는지**를 본다 — 그 지시가 빠지면 이 모듈의
 * `preservable`(= 「지금 받으면 된다」)이 **받을 방법이 적혀 있지 않은 할 일**이 된다.
 */
export function auditRunbookAudience(md: unknown): string[] {
  const s = String(md ?? '');
  const problems: string[] = [];

  if (!/^###\s*3-16\./m.test(s)) problems.push('§3-16(고지 대상 특정) 절이 없다');
  if (!/audienceStatus\(|assessAudience\(/.test(s)) problems.push('§3-16 에 명단 근거 산출 명령이 없다');
  for (const v of AUDIENCE_VERDICTS) {
    if (!new RegExp(`\`${v}\``).test(s)) problems.push(`§3-16 판정 표에 ${v} 행이 없다`);
  }
  for (const d of AUDIENCE_DRIFTS) {
    if (!s.includes(d.id)) problems.push(`§3-16 에 어긋남 ${d.id} 가 없다`);
  }
  if (!/ROSTER_SNAPSHOT_SQL/.test(s)) problems.push('문서에 명단 조회문(ROSTER_SNAPSHOT_SQL)이 없다 — 받을 방법이 적혀 있지 않다');
  if (!/audienceVerdict/.test(s)) problems.push('문서가 audienceVerdict 를 가리키지 않는다 — 담당자가 읽을 칸이 없다');

  const sec35 = s.match(/^###\s*3-5\.[\s\S]*?(?=^###\s*3-6\.)/m)?.[0] ?? '';
  if (!sec35) {
    problems.push('§3-5 절을 찾지 못했다 — 문서 구조가 바뀌었으면 이 가드를 함께 볼 것');
    return problems;
  }
  if (!/명단/.test(sec35)) {
    problems.push('§3-5 가 명단 내보내기를 지시하지 않는다 — 전환 뒤에는 연락처를 되찾을 경로가 없다');
  }
  if (!sec35.includes('3-16')) problems.push('§3-5 가 §3-16 으로 유도하지 않는다');
  return problems;
}
