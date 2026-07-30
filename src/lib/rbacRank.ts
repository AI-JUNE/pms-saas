// RBAC 랭크 판정 — 순수 모듈(DB 의존 없음). rbac.ts의 DB 조회 결과에 적용되는 결정 로직.
export const ACTION_RANK: Record<string, number> = { read: 1, write: 2, approve: 3, admin: 4 };

/** 부여된 액션 목록이 요구 액션을 충족하는지. 알 수 없는 요구 액션은 fail-closed(항상 false). */
export function actionSatisfies(granted: readonly string[], needed: string): boolean {
  const need = ACTION_RANK[needed] ?? 99;
  return granted.some((a) => (ACTION_RANK[a] ?? 0) >= need);
}
