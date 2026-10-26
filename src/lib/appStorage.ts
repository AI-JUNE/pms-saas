// 제안 앱 브라우저 저장 삭제 (2026-10-21, 외부 오픈 관문 S-1)
//
// 왜: 포털의 제안 앱(3003·3004·3005 사본)은 결과·고객사 자료를 사용자 브라우저(localStorage)에만 둔다.
//   공용 PC 에서 로그아웃해도 남는다. 포털과 같은 오리진이라 포털 화면에서 지울 수 있다.
// 기본 로그아웃은 지우지 않는다 — 3005 는 브라우저가 유일한 저장소라(10-07 결정) 지우면 복구할 길이 없다.
//   그래서 사용자 메뉴에 "로그아웃 + 이 PC 의 앱 데이터 삭제" 를 따로 둔다.
//
// 키 목록은 tests/appStorage.test.ts 가 public/apps/*/index.html 에서 실제로 쓰는 키와 대조한다
//   (앱이 키를 새로 쓰기 시작하면 테스트가 알려 준다).

/** 앱별 저장 키(정확히 일치) */
export const APP_STORAGE_KEYS: Record<string, string[]> = {
  quality: ['qualibid', 'qualibid_results_v1'],
  strategy: ['ecs_results_v1', 'ecs_prov'],
  performance: ['cx_library_v1', 'cx_ai_cfg', 'cx_pdf_tbl_cache_v1', 'cx_img_tbl_cache_v1', 'cx_iv_struct_cache_v1', 'cx_client_store', 'cx_clients', 'ecs_cx_visit_v4'],
  shared: ['llmAuditLog'],
};

/** 앱이 키 이름을 만들어 쓰는 경우(고객사별 캐시 등)를 위한 접두사 */
export const APP_STORAGE_PREFIXES = ['qualibid', 'ecs_', 'cx_', 'epa_', 'llmConsentSkip:']; // epa_ = 3007 제안작성 — 10-24 포털에서 분리(별도 외부 사이트)됐지만, 그 전에 포털에서 쓴 브라우저 데이터가 남을 수 있어 삭제 대상에 둔다

export function isAppStorageKey(key: string): boolean {
  return Object.values(APP_STORAGE_KEYS).some((ks) => ks.includes(key)) || APP_STORAGE_PREFIXES.some((p) => key.startsWith(p));
}

type StorageLike = { readonly length: number; key(i: number): string | null; removeItem(k: string): void };

/** 저장소에서 앱 키만 지우고 지운 키 이름을 돌려준다. 포털 자체 키는 건드리지 않는다. */
export function clearAppStorage(store: StorageLike): string[] {
  const keys: string[] = [];
  for (let i = 0; i < store.length; i++) {
    const k = store.key(i);
    if (k != null && isAppStorageKey(k)) keys.push(k);
  }
  for (const k of keys) store.removeItem(k);
  return keys;
}
