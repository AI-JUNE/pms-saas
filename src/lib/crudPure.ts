// 순수 CRUD 로직 모듈 — DB/Next 의존 없음. crud.ts의 핵심 규칙을 분리해 node --test로 단위 검증.
// 동작은 기존 crud.ts 인라인 로직과 100% 동일해야 한다(회귀 방지용 테스트: tests/crudPure.test.ts).
export type ApproveOn = { field: string; values: string[] };
export type JournalChange = { field: string; from: any; to: any };

// POST(생성) 입력값 구성: undefined·빈문자열은 제외, null·0·false는 유지(기존 동작 보존)
export function pickInsertFields(fields: string[], body: Record<string, any>): Record<string, any> {
  const values: Record<string, any> = {};
  for (const f of fields) if (body[f] !== undefined && body[f] !== '') values[f] = body[f];
  return values;
}

// 필수값 검증: 누락(undefined 또는 빈문자열) 필드 목록 반환 — 호출측에서 ApiError(VALIDATION) 변환
export function missingRequired(required: string[] | undefined, values: Record<string, any>): string[] {
  const miss: string[] = [];
  for (const r of required ?? []) if (values[r] === undefined || values[r] === '') miss.push(r);
  return miss;
}

// PATCH(수정) 입력값 구성: undefined·null·빈문자열 모두 제외(기존 동작 보존 — null로 값 비우기는 비허용)
export function pickPatchFields(fields: string[], body: Record<string, any>): Record<string, any> {
  const patch: Record<string, any> = {};
  for (const f of fields) if (body[f] !== undefined && body[f] !== null && body[f] !== '') patch[f] = body[f];
  return patch;
}

// 결재 경계: approveOn 필드가 확정값(values)으로 바뀌는 요청이면 approve 권한 추가 요구
export function needsApprove(approveOn: ApproveOn | undefined, body: Record<string, any>): boolean {
  return !!approveOn && approveOn.values.includes(body[approveOn.field]);
}

// 이슈 이력 diff: patch에 실제 포함된 필드 중 문자열화 값이 달라진 것만 기록(null↔'' 는 동일 취급)
export function computeJournalChanges(
  fields: string[], patch: Record<string, any>, before: Record<string, any>, after: Record<string, any>
): JournalChange[] {
  const changes: JournalChange[] = [];
  for (const f of fields) {
    if (patch[f] !== undefined && String(before[f] ?? '') !== String(after[f] ?? '')) {
      changes.push({ field: f, from: before[f] ?? null, to: after[f] ?? null });
    }
  }
  return changes;
}

// 리스크 노출도: 발생확률×영향(기본 3×3), 15↑ high · 8↑ medium · 그 외 low
export const RISK_TRANSFORM = (v: any) => {
  const p = Number(v.probability) || 3, i = Number(v.impact) || 3; const s = p * i;
  return { probability: p, impact: i, level: s >= 15 ? 'high' : s >= 8 ? 'medium' : 'low' };
};

// 산출물 상태 전이: approved → 승인일 기록, rejected/draft/review → 승인일 해제, 그 외 무변경
export const DOCUMENTS_TRANSFORM = (v: any) => {
  if (v.status === 'approved') return { approvedAt: new Date() };
  if (v.status === 'rejected' || v.status === 'draft' || v.status === 'review') return { approvedAt: null };
  return {};
};
