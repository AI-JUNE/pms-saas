/**
 * assetCoverage.ts — §1 「보호 대상」 표가 **실제 저장 위치와 맞는가**(RUNBOOK §1·§1-1). 2026-10-16
 *
 * ── 왜 필요한가 ───────────────────────────────────────────────────────────────
 * §3 1~8단계·§5·§2·§4 는 모두 기계적으로 수행·확인할 수 있게 됐다. 그 전부가 **전제로 삼는** 것은
 * §1 표 한 장이다 — 「무엇이 어디에 있고, 누가 백업하며, 그래서 복구로 무엇이 돌아오는가」. 다섯 줄
 * 중 넷(DB·소스코드·배포·시크릿)은 §3·§5·§4-12 가 각각 기계화했는데, **표 자체는 한 번도 코드와
 * 대조되지 않았고** 남은 한 줄은 지금 사실이 아니다.
 *
 *  (1) **표가 코드와 다르다.** 「업로드 파일 | (현재 DB 저장) | DB 백업에 포함」이라고 적혀 있지만
 *      `lib/attachments.ts` 의 어떤 어댑터도 `canStore: true` 가 아니다 — 본문은 **어디에도 올라가지
 *      않고**(`status=metadata_only`) DB 에 남는 것은 파일명·크기·형식·만료일뿐이다. 업로드 화면은
 *      그 사실을 안내하지만(`Attachments.tsx` 의 notice) **복구 문서는 안내하지 않는다.** 복구
 *      담당자는 이 표 한 줄을 근거로 「첨부는 DB 백업에 포함되니 돌아온다」고 판단하고 고객에게도
 *      그렇게 고지한다. 복구 뒤 화면에는 첨부 목록이 그대로 보이므로 차이가 드러나지도 않는다.
 *
 *  (2) **그 목록조차 §3 4단계가 세지 않는다.** 핵심 테이블 12개(`CORE_TABLE_ROLES`)에 `attachments`
 *      가 없다 — 첨부 메타 행이 통째로 비어도 행 수 대조는 `ok` 이고 6단계는 테이블 존재만 본다.
 *      첨부는 `documents`·`issues` 에 달리는데 그 **부모만** 세고 있다.
 *
 *  (3) **외부 스토리지를 켜는 순간 표가 거짓이 된다.** `attachments` 테이블에는 이미 `provider`·
 *      `storage_key` 칼럼이 있다 — `STORAGE_PROVIDER` 에 값이 들어가고 어댑터가 배선되면 본문은
 *      **Neon PITR 경계 밖**으로 나가고, 시점 복구는 **참조(행)만** T-ε 로 되돌린다:
 *        · 복구 시점 **이후 업로드분** → 행은 사라지고 제공자에 **객체만 남는다**(과금이 계속되고,
 *          삭제 요청을 이행한 기록까지 되돌아가 개인정보가 근거 없이 존속한다. 아무도 신고하지 않는다),
 *        · 복구 시점 **이후 삭제분** → 행이 되살아나는데 객체는 제공자에서 이미 지워져 **다운로드가
 *          깨진다**(이쪽만 사용자가 신고한다).
 *      §3-9 `EXTERNAL_SYSTEMS` 는 결제·웹훅·메일 세 가지뿐이라 저장소를 보지 않는다. 그리고 §1 표의
 *      비고는 「외부 스토리지 도입 시 이 표를 갱신할 것」이라고 **사람에게 숙제를 남겨 두었을 뿐**
 *      이다 — 켜는 것은 환경변수 한 줄이고 CI 는 통과한다.
 *
 * 그래서 이 모듈은
 *   · 보호 대상을 **정본 목록**으로 두고(`PROTECTED_ASSETS` — 실제 저장 위치·백업 주체·복구 경로·
 *     기계적 확인 수단·왜 조용한가),
 *   · 첨부 본문이 **복구 경계 안인지**를 `lib/attachments.ts` 의 어댑터에서 직접 읽어 판정하고
 *     (`attachmentCoverage` — 코드가 바뀌면 판정이 함께 바뀐다. 문서를 베끼지 않는다),
 *   · 복구가 만들어 내는 어긋남의 **두 방향**을 적고(`COVERAGE_DRIFTS`),
 *   · 그 상태를 `/api/health` 로 평상시에 드러내고(`assetCoverageCheck`),
 *   · 어댑터·스키마·§1 표가 서로 어긋나면 **CI 에서 실패시킨다**(`auditAttachmentSource` 등 —
 *     저장소를 켜는 변경이 문서 갱신 없이 들어오는 것을 막는 장치가 이것이다),
 *   · 이 판정이 보장하지 **못하는** 것을 `ASSET_LIMITS` 로 함께 내보낸다.
 *
 * 원칙
 * - 순수 모듈: DB·next·fs 미접근, **신규 조회·쓰기·DDL 0 · 신규 env 0**. env 는 어댑터에만 넘긴다.
 * - **임의 백업 주체를 지어내지 않는다** — 백업하는 주체가 없으면 「없다」고 적는다.
 * - **새 거짓 ok 를 만들지 않는다**: 본문이 없다는 사실을 `ok` 로 돌려주는 것은 「문서와 코드가
 *   같다」는 뜻이지 「첨부가 복구된다」는 뜻이 아니다.
 */
import { createStorageAdapter, type StorageAdapter, type StorageKind } from './attachments.ts';
import { CORE_TABLE_ROLES } from './recoveryVerify.ts';
import { EXTERNAL_SYSTEMS } from './externalReconcile.ts';

/** 응답·문서에서 근거 절을 찾을 수 있게 한다 */
export const ASSET_RUNBOOK_REF = 'RUNBOOK §1·§1-1';

/** 첨부 메타데이터가 들어 있는 테이블 — 본문이 아니라 **참조**가 여기 있다 */
export const ATTACHMENT_TABLE = 'attachments';
/** 외부 객체를 가리키는 칼럼. 본문이 DB 밖으로 나가면 이 값만 남는다 */
export const ATTACHMENT_KEY_COLUMN = 'storage_key';

/* ──────────────────────── 보호 대상(정본) ──────────────────────── */

export interface ProtectedAsset {
  key: string;
  /** §1 표의 자산 이름 */
  asset: string;
  /** **실제** 저장 위치(문서가 아니라 코드 기준) */
  store: string;
  /** 백업하는 주체 — 없으면 「없다」고 적는다 */
  backupBy: string;
  /** 복구 경로(절 번호) */
  restorePath: string;
  /** 기계적으로 확인하는 수단(`/api/health` 체크 이름). 없으면 null */
  mechanism: string | null;
  /** 이 칸이 틀렸을 때 왜 조용한가 */
  silent: string;
}

export const PROTECTED_ASSETS: readonly ProtectedAsset[] = [
  {
    key: 'app_db',
    asset: '애플리케이션 DB',
    store: 'Neon Postgres(`DATABASE_URL`) — 유일한 상태 저장소',
    backupBy: 'Neon 자동 백업 + PITR(보존 창은 `RECOVERY_PITR_RETENTION_HOURS`)',
    restorePath: '§3 전체',
    mechanism: 'checks.db · checks.recoveryWindow · checks.dbIdentity',
    silent: '복구 자체는 눈에 보이는 절차라 조용하지 않다 — 조용한 쪽은 **무엇이 이 안에 없는가**다',
  },
  {
    key: 'source',
    asset: '소스코드',
    store: 'Git 원격 저장소(로컬·원격 이중화)',
    backupBy: 'Git(분산) + AutoPush',
    restorePath: '§5',
    mechanism: 'checks.deployPin(롤백이 유지되는지)',
    silent: 'AutoPush 가 미커밋 변경까지 자동 커밋하므로 롤백은 주기 안에 저절로 풀린다(§5-1)',
  },
  {
    key: 'deploy',
    asset: '배포 산출물',
    store: 'Vercel 빌드 이력',
    backupBy: 'Vercel(이전 배포로 Promote 가능)',
    restorePath: '§5',
    mechanism: 'checks.deployPin',
    silent: 'Promote 된 옛 배포는 **그 시점의 환경변수 스냅샷**으로 돈다 — 복구 중에 쓰면 전부 되돌아간다(§5-1)',
  },
  {
    key: 'secrets',
    asset: '환경변수·시크릿',
    store: 'Vercel 환경변수(값은 저장소에 커밋하지 않는다)',
    backupBy: '**자동 백업 없음** — 키 목록만 보관소에 스냅샷으로 둔다(§4)',
    restorePath: '§4 · §4-10 · §4-12',
    mechanism: 'checks.envPresence',
    silent: '빠진 키는 오류를 내지 않고 **조용히 기본값으로 되돌아간다**(§4 머리말)',
  },
  {
    key: 'uploads',
    asset: '업로드 파일(첨부)',
    store:
      `\`${ATTACHMENT_TABLE}\` 테이블의 **메타데이터뿐** — 파일명·크기·형식·만료일(\`status=metadata_only\`). ` +
      '`lib/attachments.ts` 의 어떤 어댑터도 `canStore: true` 가 아니라 **본문은 어디에도 보관되지 않는다**',
    backupBy: '해당 없음 — 보관하는 본문이 없다. 메타 행만 DB 백업에 포함된다',
    restorePath: '§1-1(외부 스토리지를 켜면 §3 경계 밖으로 나간다)',
    mechanism: 'checks.assetCoverage',
    silent:
      `§3 4단계 핵심 테이블 ${CORE_TABLE_ROLES.length}개에 \`${ATTACHMENT_TABLE}\` 이 **없다** — 메타 행이 통째로 ` +
      '비어도 행 수 대조는 `ok` 이고, 복구 뒤 화면에는 첨부 목록이 그대로 보여 차이가 드러나지 않는다',
  },
];

/** 모르는 키는 null — 지어내지 않는다 */
export function assetFor(key: unknown): ProtectedAsset | null {
  const k = String(key ?? '').trim();
  return PROTECTED_ASSETS.find((a) => a.key === k) ?? null;
}

/* ──────────────────── 복구가 만드는 어긋남의 두 방향 ──────────────────── */

export interface CoverageDrift {
  key: string;
  /** 언제 생기는가 */
  when: string;
  /** 이쪽(DB)에 남는 것 */
  dbSide: string;
  /** 저쪽(제공자)에 남는 것 */
  storeSide: string;
  /** 누가 알아채는가 */
  noticedBy: string;
  fix: string;
}

export const COVERAGE_DRIFTS: readonly CoverageDrift[] = [
  {
    key: 'orphan_object',
    when: '복구 시점 **이후에 업로드**된 첨부(외부 스토리지를 켠 경우)',
    dbSide: '참조 행이 사라진다 — 애플리케이션에서 보이지 않는다',
    storeSide: '객체는 그대로 남는다 — 저장 비용이 계속 들고, 삭제 이행 기록까지 되돌아가 **개인정보가 근거 없이 존속**한다',
    noticedBy: '**아무도 알려 주지 않는다** — 화면에서 사라진 것은 정상으로 보인다',
    fix: '제공자 객체 목록과 `' + ATTACHMENT_TABLE + '.' + ATTACHMENT_KEY_COLUMN + '` 를 대조해 고아 객체를 가려낸다(삭제는 사람 판단)',
  },
  {
    key: 'dangling_reference',
    when: '복구 시점 **이후에 삭제**된 첨부(외부 스토리지를 켠 경우)',
    dbSide: '참조 행이 되살아난다 — 목록에 다시 보인다',
    storeSide: '객체는 이미 지워졌다 — 내려받으면 실패한다',
    noticedBy: '사용자가 다운로드 실패로 신고한다(이쪽만 드러난다)',
    fix: '되살아난 행의 객체 존재를 확인하고, 없으면 그 사실을 사용자에게 고지한다',
  },
  {
    key: 'metadata_without_body',
    when: '지금(저장소 미연동) — 복구 여부와 무관하게 **항상**',
    dbSide: '파일명·크기·형식만 있는 행',
    storeSide: '없다 — 본문은 처음부터 보관되지 않았다',
    noticedBy: '업로드 화면은 안내하지만 **§1 표는 「DB 백업에 포함」이라고 적혀 있었다**',
    fix: '§1 표를 사실대로 두고(본문 미보관), 첨부 복구를 고객 고지에 포함하지 않는다',
  },
];

/* ──────────────────────────── 판정 ──────────────────────────── */

export const COVERAGE_VERDICTS = ['metadata_only', 'unsupported', 'unprotected'] as const;
export type CoverageVerdict = (typeof COVERAGE_VERDICTS)[number];

export const ACTION_METADATA_ONLY =
  '첨부 **본문은 보관되지 않는다**. 복구 고지·§1 표에 「파일이 복구된다」를 넣지 않는다(돌아오는 것은 목록이다)';
export const ACTION_UNSUPPORTED =
  '`STORAGE_PROVIDER` 에 배선되지 않은 값이 들어 있다 — 본문은 여전히 저장되지 않는데 설정만 켜진 모습이다. ' +
  '값을 지워 미연동을 분명히 하거나, 어댑터를 배선하면서 §1 표·§1-1 을 함께 고친다 [활성화 승인 필요]';
export const ACTION_UNPROTECTED =
  '첨부 본문이 **Neon PITR 경계 밖**에 있다 — §3 시점 복구는 참조 행만 되돌린다. 백업 주체를 §1 표에 적고, ' +
  '§3 에 「제공자 객체 목록과 `' + ATTACHMENT_TABLE + '` 대조」 단계를 넣는다(§1-1 의 두 방향)';

export interface AttachmentCoverage {
  verdict: CoverageVerdict;
  provider: StorageKind;
  /** 본문을 실제로 보관할 수 있는가 — 어댑터에서 직접 읽는다 */
  canStore: boolean;
  /** 본문이 어디에 있는가(사람이 읽는 한 줄) */
  bodyLocation: string;
  /** 본문이 §3 시점 복구의 경계 안인가 */
  inRestoreScope: boolean;
  table: string;
  /** §3 4단계가 이 테이블을 세는가 — **false 가 현재 상태**다 */
  countedInCoreTables: boolean;
  action: string;
  caveats: readonly string[];
}

/**
 * 첨부 본문이 복구 경계 안인지 판정한다.
 *
 * 판정의 근거는 **문서가 아니라 어댑터**다 — `createStorageAdapter` 가 `canStore: true` 를 돌려주게
 * 되는 순간(=저장소를 배선하는 순간) 판정이 `unprotected` 로 바뀌고, `auditAttachmentSource` 가
 * CI 에서 §1 표를 함께 고치라고 실패시킨다. 어댑터를 인자로 받을 수 있게 둔 것은 그 상태를
 * **배선 전에도 시험할 수 있게** 하기 위해서다(기본값은 실제 어댑터다).
 */
export function attachmentCoverage(
  env: Record<string, string | undefined> | null | undefined,
  adapter: StorageAdapter = createStorageAdapter(env),
): AttachmentCoverage {
  const countedInCoreTables = CORE_TABLE_ROLES.some((r) => r.table === ATTACHMENT_TABLE);
  const base = {
    provider: adapter.kind,
    canStore: adapter.canStore,
    table: ATTACHMENT_TABLE,
    countedInCoreTables,
    caveats: ASSET_LIMITS,
  };
  if (adapter.canStore) {
    return {
      ...base,
      verdict: 'unprotected',
      bodyLocation: `외부 저장소(\`${adapter.kind}\`) — DB 밖이라 PITR 로 되돌아가지 않는다`,
      inRestoreScope: false,
      action: ACTION_UNPROTECTED,
    };
  }
  if (adapter.kind !== 'none') {
    return {
      ...base,
      verdict: 'unsupported',
      bodyLocation: '없다 — 지원하지 않는 provider 라 본문을 올리지 않는다(설정만 켜진 모습이다)',
      inRestoreScope: false,
      action: ACTION_UNSUPPORTED,
    };
  }
  return {
    ...base,
    verdict: 'metadata_only',
    bodyLocation: '없다 — 본문은 어디에도 보관되지 않는다(메타데이터만 DB 에 있다)',
    inRestoreScope: false,
    action: ACTION_METADATA_ONLY,
  };
}

/* ──────────────────────── 보장하지 못하는 것 ──────────────────────── */

export const ASSET_LIMITS: readonly string[] = [
  '이 판정은 **본문이 어디에 있는가**까지만 말한다 — 메타 행이 복구됐는지는 §3 4단계가, 행이 가리키는 객체가 실재하는지는 아무도 보지 않는다',
  '`metadata_only` 는 「문서와 코드가 같다」는 뜻이지 **「첨부가 복구된다」는 뜻이 아니다** — 돌아오는 것은 목록이다',
  '이 배포의 설정만 본다 — 같은 DB 를 쓰는 다른 배포가 저장소를 켜 두었으면 여기서는 보이지 않는다',
  `§3 4단계 핵심 테이블에 \`${ATTACHMENT_TABLE}\` 이 없어, 첨부 **메타 행**의 유실은 행 수 대조로도 드러나지 않는다`,
  '§1 표의 나머지 네 줄(DB·소스코드·배포·시크릿)은 각 절의 체크가 보고, 이 체크는 다섯 번째 줄만 본다',
];

/* ───────────────────────── 출력(사람·로그) ───────────────────────── */

export interface CoveragePlan {
  coverage: AttachmentCoverage;
  assets: readonly ProtectedAsset[];
  drifts: readonly CoverageDrift[];
  limits: readonly string[];
  runbook: string;
}

export function coveragePlanFor(env?: Record<string, string | undefined> | null, adapter?: StorageAdapter): CoveragePlan {
  return {
    coverage: attachmentCoverage(env ?? process.env, adapter ?? createStorageAdapter(env ?? process.env)),
    assets: PROTECTED_ASSETS,
    drifts: COVERAGE_DRIFTS,
    limits: ASSET_LIMITS,
    runbook: ASSET_RUNBOOK_REF,
  };
}

/** 사람이 읽는 요약(§1-1 의 1줄 명령이 출력하는 것) */
export function coverageText(plan: CoveragePlan): string {
  const c = plan.coverage;
  const lines = [`[${c.verdict}] 첨부 본문: ${c.bodyLocation}`, `→ ${c.action}`];
  for (const a of plan.assets) lines.push(`· ${a.asset} — ${a.store} / 백업: ${a.backupBy} (${a.mechanism ?? '기계적 확인 없음'})`);
  for (const d of plan.drifts) lines.push(`· ${d.key}: DB=${d.dbSide} / 저장소=${d.storeSide} → ${d.fix}`);
  for (const l of plan.limits) lines.push(`※ ${l}`);
  return lines.join('\n');
}

/** 로그 한 줄. 판정·개수만 — 파일명·업로더·키는 담지 않는다 */
export function coverageLogLine(plan: CoveragePlan): string {
  const c = plan.coverage;
  return [
    '[assetCoverage]',
    `verdict=${c.verdict}`,
    `provider=${c.provider}`,
    `canStore=${c.canStore}`,
    `inRestoreScope=${c.inRestoreScope}`,
    `counted=${c.countedInCoreTables}`,
    `assets=${plan.assets.length}`,
  ].join(' ');
}

/* ───────────────────────── /api/health 체크 ───────────────────────── */

const VERDICT_NOTE: Record<CoverageVerdict, string> = {
  metadata_only:
    '첨부는 메타데이터 전용 — 본문이 없으므로 복구 경계 밖으로 나간 것도 없다. §1 표가 이 사실대로 적혀 있는지가 이 체크의 대상이다',
  unsupported:
    '`STORAGE_PROVIDER` 에 배선되지 않은 값이 들어 있다 — 본문은 저장되지 않는데 설정은 켜진 모습이라 「저장되고 있다」고 믿기 쉽다',
  unprotected:
    '첨부 본문이 DB 밖에 있는데 §1 표에 백업 주체가 없다 — 시점 복구는 참조 행만 되돌린다(고아 객체·깨진 참조. §1-1)',
};

/**
 * §1 보호 대상 표의 다섯 번째 줄(업로드 파일)이 **실제 저장 위치와 맞는지** 공개 헬스체크에 드러낸다.
 *
 * `ok` 의 뜻: 「본문의 위치가 문서와 같고, 복구 경계가 설명된 상태인가」다 — **첨부가 복구된다는
 * 뜻이 아니다**(`ASSET_LIMITS` 참조). **required: false** 이므로 어느 경우에도 503 이 되지 않는다
 * (저장소 설정으로 서비스를 내리면 복구 자신이 막힌다). 파일명·업로더·저장 키는 담지 않는다.
 */
export function assetCoverageCheck(args?: {
  env?: Record<string, string | undefined>;
  adapter?: StorageAdapter;
}): { ok: boolean; required: false; detail: Record<string, unknown> } {
  const env = args?.env ?? process.env;
  const c = attachmentCoverage(env, args?.adapter ?? createStorageAdapter(env));
  return {
    ok: c.verdict === 'metadata_only',
    required: false,
    detail: {
      verdict: c.verdict,
      provider: c.provider,
      canStore: c.canStore,
      bodyLocation: c.bodyLocation,
      inRestoreScope: c.inRestoreScope,
      table: c.table,
      /** §3 4단계가 이 테이블을 세는가 — false 가 현재 상태이고, 그 사실을 숨기지 않는다 */
      countedInCoreTables: c.countedInCoreTables,
      assets: PROTECTED_ASSETS.map((a) => ({ key: a.key, asset: a.asset, backupBy: a.backupBy, mechanism: a.mechanism })),
      drifts: COVERAGE_DRIFTS.map((d) => d.key),
      /** 복구가 되돌리지 못하는 외부 상태 목록(§3-9)에 저장소가 들어 있는가 */
      storageInExternalSystems: EXTERNAL_SYSTEMS.some((s) => /저장소|스토리지/.test(s.system)),
      action: c.action,
      runbook: ASSET_RUNBOOK_REF,
      limits: ASSET_LIMITS,
      note: VERDICT_NOTE[c.verdict],
    },
  };
}

/** 배선 상태 요약(문서·보고용) */
export function assetCoverageStatus(env: Record<string, string | undefined> = process.env): {
  verdict: CoverageVerdict;
  assets: number;
  drifts: number;
  limits: number;
  note: string;
} {
  const c = attachmentCoverage(env);
  return {
    verdict: c.verdict,
    assets: PROTECTED_ASSETS.length,
    drifts: COVERAGE_DRIFTS.length,
    limits: ASSET_LIMITS.length,
    note: VERDICT_NOTE[c.verdict],
  };
}

/* ───────────────────────────── 정적 점검 ───────────────────────────── */

/**
 * `lib/attachments.ts` 원문 대조 — **이 모듈의 존재 이유**인 장치다.
 * 어댑터가 본문을 보관하게 되는 순간 §1 표의 「백업 주체: 해당 없음」과 §1-1 의 「지금은 발생하지
 * 않는다」가 거짓이 되는데, 화면도 응답도 그대로 돌기 때문에 사람 눈으로는 알아챌 수 없다.
 */
export function auditAttachmentSource(src: unknown): string[] {
  const s = String(src ?? '');
  const problems: string[] = [];
  if (!/canStore:\s*false/.test(s)) {
    problems.push(
      '`createStorageAdapter` 가 더 이상 `canStore: false` 가 아니다 — 첨부 본문이 DB 밖으로 나간다. ' +
        'RUNBOOK §1 표(백업 주체)·§1-1 과 §3 의 대조 단계를 함께 고칠 것',
    );
  }
  if (!/metadata_only/.test(s)) problems.push('`metadata_only` 상태값이 사라졌다 — §1-1 의 설명이 낡았다');
  if (!/STORAGE_PROVIDER/.test(s)) problems.push('`STORAGE_PROVIDER` 리터럴이 없다 — 저장소 스위치가 옮겨 갔다');
  return problems;
}

/**
 * `db/schema.ts` 원문 대조 — 본문 참조가 들어 있는 칼럼의 **이름**이 바뀌면 §1-1 의 대조 지시가 낡는다.
 */
export function auditSchemaSource(src: unknown): string[] {
  const s = String(src ?? '');
  const problems: string[] = [];
  if (!new RegExp(`${ATTACHMENT_TABLE}\\s*=\\s*pgTable\\(`).test(s)) {
    problems.push(`\`${ATTACHMENT_TABLE}\` 테이블 선언이 없다 — 첨부 메타데이터의 위치가 바뀌었다`);
  }
  if (!new RegExp(`'${ATTACHMENT_KEY_COLUMN}'`).test(s)) {
    problems.push(`\`${ATTACHMENT_KEY_COLUMN}\` 칼럼이 없다 — §1-1 의 「객체 목록과 대조」 지시가 가리킬 곳이 사라졌다`);
  }
  return problems;
}

/**
 * §3 4단계가 첨부 테이블을 **세지 않는** 사각지대가 그대로인지 확인한다.
 * 핵심 테이블에 들어가면 위 `silent` 설명과 `ASSET_LIMITS` 가 낡으므로 함께 고쳐야 한다.
 */
export function auditCoreTableBlindSpot(roles: readonly { table: string }[] = CORE_TABLE_ROLES): string[] {
  const counted = roles.some((r) => r.table === ATTACHMENT_TABLE);
  if (!counted) return [];
  return [
    `§3 4단계 핵심 테이블에 ${ATTACHMENT_TABLE} 이 들어갔다 — 「행 수로도 드러나지 않는다」는 설명의 ` +
      '전제가 바뀌었으니 PROTECTED_ASSETS 의 silent 와 ASSET_LIMITS 를 함께 고칠 것',
  ];
}

/** RUNBOOK 에서 §1 절만 잘라낸다(§2 전까지). 못 찾으면 빈 문자열 — 지어내지 않는다 */
export function runbookSection1(src: unknown): string {
  const s = String(src ?? '');
  const start = s.search(/^##\s*1\.\s/m);
  if (start < 0) return '';
  const rest = s.slice(start);
  const end = rest.search(/^##\s*2\.\s/m);
  return end < 0 ? rest : rest.slice(0, end);
}

/**
 * `RUNBOOK.md` 원문 점검 — §1 표가 **거짓 문구로 되돌아가지 않았는지**와 §1-1 이 살아 있는지 본다.
 * 표는 사람이 읽는 유일한 「무엇이 보호되는가」이고, 그 한 줄이 복구 고지의 근거가 된다.
 */
export function auditRunbookAssets(src: unknown): string[] {
  const s = String(src ?? '');
  const sec1 = runbookSection1(s);
  const problems: string[] = [];
  if (!sec1) return ['RUNBOOK 에서 §1 절을 찾을 수 없다'];
  const row = sec1.split('\n').find((l) => /^\|\s*업로드 파일/.test(l));
  if (!row) {
    problems.push('§1 표에 업로드 파일 줄이 없다 — 보호 대상에서 통째로 빠졌다');
  } else {
    // 「본문이 DB 에 있다」로 되돌아간 모습. 메타 행만 포함된다는 **한정된** 표현과 구분한다.
    if (/DB 저장/.test(row) || /\|\s*DB 백업에 포함\s*\|/.test(row)) {
      problems.push(
        '§1 표가 「업로드 파일 … DB 백업에 포함」으로 되돌아갔다 — 본문은 보관되지 않는다(lib/attachments.ts canStore: false)',
      );
    }
    if (!/메타데이터/.test(row)) problems.push('§1 표의 업로드 파일 줄이 **본문 미보관**이라는 사실을 적지 않는다');
  }
  if (!/metadata_only/.test(sec1)) problems.push('§1 에 첨부가 메타데이터 전용이라는 사실이 없다');
  if (!/1-1/.test(sec1)) problems.push('§1 에서 1-1(복구 경계) 로 가는 길이 끊겼다');
  if (!/checks\.assetCoverage/.test(s)) problems.push('RUNBOOK 어디에도 checks.assetCoverage 확인 지시가 없다');
  if (!/^###\s*1-1\./m.test(s)) problems.push('§1-1 절이 사라졌다 — 외부 스토리지를 켠 뒤의 두 방향을 적어 둔 유일한 자리다');
  for (const d of COVERAGE_DRIFTS) {
    if (!s.includes(d.key)) problems.push(`§1-1 에 어긋남 방향 ${d.key} 가 없다`);
  }
  return problems;
}

/**
 * `app/api/health/route.ts` 원문 점검 — 판정이 **응답에 실려 있는지**까지 본다.
 * 빠지면 §1 표와 코드가 어긋난 사실을 평상시에 알려 줄 장치가 사라지는데, 응답은 그대로 돈다.
 */
export function auditHealthWiring(src: unknown): string[] {
  const s = String(src ?? '');
  const problems: string[] = [];
  if (!/from\s+['"]@\/lib\/assetCoverage['"]/.test(s)) problems.push('assetCoverage 를 import 하지 않는다');
  if (!/assetCoverageCheck\(/.test(s)) problems.push('assetCoverageCheck() 를 호출하지 않는다');
  if (!/checks\.assetCoverage\s*=\s*assetCoverageCheck\(/.test(s)) {
    problems.push('판정 결과를 checks.assetCoverage 에 싣지 않는다(판정만 하고 버리는 꼴)');
  }
  return problems;
}
