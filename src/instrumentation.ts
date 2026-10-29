// Next.js 기동 훅: 서버 인스턴스 시작 시 스키마 자동 정합(배포마다 자동 마이그레이션).
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // 전역 에러 캡처를 가장 먼저 설치한다(이후 부팅 단계 오류도 구조화 로깅됨).
    try { const { installGlobalErrorHandlers } = await import('@/lib/logger'); installGlobalErrorHandlers(); }
    catch { /* 로거 로드 실패는 부팅을 막지 않는다 */ }
    try { const { ensureSchema } = await import('@/lib/migrate'); await ensureSchema(); }
    catch (e) { const { captureError } = await import('@/lib/logger'); captureError(e, { where: 'instrumentation.ensureSchema' }); }
    // 복구용 관리자 생성은 **쓰기**다(RUNBOOK §3-19). §3 4단계는 복구 브랜치를 스테이징에 물려
    // 기동하라고 지시하는데, 그 기동이 「읽기 전용」이라 적힌 검증보다 먼저 행을 만든다 —
    // 소스에 하드코딩된 비밀번호를 가진 계정이고, 그 브랜치는 5단계에서 운영이 된다.
    // 스위치는 `'true'` 일 때만 ON 이고 **미설정이 기존 동작**이다(평상시 한 글자도 바뀌지 않는다).
    // ※ ensureSchema 는 막지 않는다 — 막으면 스키마가 덜 맞는 DB 에서 4단계 조회가 깨진다(§3-1).
    if (process.env.RECOVERY_BOOT_WRITES_OFF === 'true') {
      console.log('[bootstrap] 기동 쓰기 생략 — RECOVERY_BOOT_WRITES_OFF (RUNBOOK §3-19)');
    } else {
      try { const { ensureRecoveryAdmin } = await import('@/lib/bootstrap'); await ensureRecoveryAdmin(); }
      catch (e) { const { captureError } = await import('@/lib/logger'); captureError(e, { where: 'instrumentation.ensureRecoveryAdmin' }); }
    }
  }
}
