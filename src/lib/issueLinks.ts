// 이슈 관계(연결) — 순수 모듈(DB·next 의존 없음). ROADMAP ⑦ 79 「관계(이슈 연결)」.
//
// 종류 3개만 받는다(폐쇄 목록). 방향이 있는 것은 blocks 하나다:
//   blocks     : A 가 B 를 차단한다(A 해결 전 B 진행 불가) — 방향 있음
//   relates    : 연관 — 무방향
//   duplicates : A 는 B 의 중복 — 저장은 방향(src=중복 쪽)이지만 중복 판정은 양방향
// 기존 `issues.related`(쉼표 코드 텍스트)는 그대로 둔다 — 자유 입력 메모였고 이 테이블이 정본이 된다.

export const LINK_KINDS = ['blocks', 'relates', 'duplicates'] as const;
export type LinkKind = (typeof LINK_KINDS)[number];

export const LINK_LABEL: Record<LinkKind, string> = { blocks: '차단함', relates: '연관', duplicates: '중복' };
/** 반대편에서 볼 때의 라벨. */
export const LINK_INVERSE_LABEL: Record<LinkKind, string> = { blocks: '차단됨', relates: '연관', duplicates: '원본' };
export const LINK_HINT: Record<LinkKind, string> = {
  blocks: '이 이슈가 해결되기 전에는 대상 이슈를 진행할 수 없습니다',
  relates: '서로 참고할 연관 이슈입니다',
  duplicates: '이 이슈는 대상 이슈의 중복입니다',
};

export function isDirectional(kind: LinkKind): boolean {
  return kind === 'blocks';
}

export function parseLinkKind(v: unknown): LinkKind | null {
  const s = String(v ?? '').trim().toLowerCase();
  return (LINK_KINDS as readonly string[]).includes(s) ? (s as LinkKind) : null;
}

export interface IssueLinkLike { id?: number; srcIssueId: number; dstIssueId: number; kind: string }
export interface FieldError { field: string; code: string; message: string }

/** 입력 검증 — 자기 참조·미지 종류·잘못된 id. */
export function validateLink(input: { srcIssueId: unknown; dstIssueId: unknown; kind: unknown }): { ok: true; value: { srcIssueId: number; dstIssueId: number; kind: LinkKind } } | { ok: false; errors: FieldError[] } {
  const errors: FieldError[] = [];
  const src = Number(input.srcIssueId);
  const dst = Number(input.dstIssueId);
  const kind = parseLinkKind(input.kind);
  if (!Number.isInteger(src) || src <= 0) errors.push({ field: 'srcIssueId', code: 'INVALID', message: '원본 이슈가 올바르지 않습니다' });
  if (!Number.isInteger(dst) || dst <= 0) errors.push({ field: 'dstIssueId', code: 'INVALID', message: '대상 이슈를 선택하세요' });
  if (!kind) errors.push({ field: 'kind', code: 'INVALID', message: '관계 종류는 차단함·연관·중복 중 하나여야 합니다' });
  if (Number.isInteger(src) && Number.isInteger(dst) && src === dst) errors.push({ field: 'dstIssueId', code: 'SELF', message: '자기 자신과는 연결할 수 없습니다' });
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { srcIssueId: src, dstIssueId: dst, kind: kind as LinkKind } };
}

/** 같은 관계가 이미 있는가. 무방향 종류는 양방향으로 본다. */
export function isDuplicateLink(existing: readonly IssueLinkLike[], cand: { srcIssueId: number; dstIssueId: number; kind: LinkKind }): boolean {
  return existing.some((e) => {
    if (e.kind !== cand.kind) return false;
    if (e.srcIssueId === cand.srcIssueId && e.dstIssueId === cand.dstIssueId) return true;
    if (!isDirectional(cand.kind) && e.srcIssueId === cand.dstIssueId && e.dstIssueId === cand.srcIssueId) return true;
    return false;
  });
}

/** 이 이슈 입장에서 본 관계 — 상대 이슈 id·라벨·방향. */
export function describeLink(link: IssueLinkLike, perspectiveIssueId: number): { otherId: number; kind: LinkKind | null; label: string; direction: 'out' | 'in' } {
  const kind = parseLinkKind(link.kind);
  const out = link.srcIssueId === perspectiveIssueId;
  const otherId = out ? link.dstIssueId : link.srcIssueId;
  const label = kind ? (out ? LINK_LABEL[kind] : LINK_INVERSE_LABEL[kind]) : String(link.kind);
  return { otherId, kind, label, direction: out ? 'out' : 'in' };
}

/** 종류별 건수(표시용). */
export function linkCounts(links: readonly IssueLinkLike[]): Record<LinkKind, number> & { total: number } {
  const c: Record<LinkKind, number> & { total: number } = { blocks: 0, relates: 0, duplicates: 0, total: 0 };
  for (const l of links) {
    const k = parseLinkKind(l.kind);
    if (!k) continue;
    c[k] += 1;
    c.total += 1;
  }
  return c;
}

/** 이 이슈를 차단하는 미해결 이슈가 있는가(상태 목록은 호출부가 넘긴다). */
export function blockedBy(links: readonly IssueLinkLike[], issueId: number, statusOf: (id: number) => string | undefined, doneStatuses: readonly string[] = ['resolved', 'closed']): number[] {
  return links
    .filter((l) => l.kind === 'blocks' && l.dstIssueId === issueId)
    .map((l) => l.srcIssueId)
    .filter((id) => !doneStatuses.includes(String(statusOf(id) ?? '')));
}

/** 코드 입력 정규화(`iss-0002` → `ISS-0002`). 빈 값은 ''. */
export function normalizeIssueCode(v: unknown): string {
  return String(v ?? '').trim().toUpperCase();
}
