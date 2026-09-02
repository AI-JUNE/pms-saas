// Next.js 기동 훅: 서버 인스턴스 시작 시 스키마 자동 정합(배포마다 자동 마이그레이션).
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // 전역 에러 캡처를 가장 먼저 설치한다(이후 부팅 단계 오류도 구조화 로깅됨).
    try { const { installGlobalErrorHandlers } = await import('@/lib/logger'); installGlobalErrorHandlers(); }
    catch { /* 로거 로드 실패는 부팅을 막지 않는다 */ }
    try { const { ensureSchema } = await import('@/lib/migrate'); await ensureSchema(); }
    catch (e) { const { captureError } = await import('@/lib/logger'); captureError(e, { where: 'instrumentation.ensureSchema' }); }
    try { const { ensureRecoveryAdmin } = await import('@/lib/bootstrap'); await ensureRecoveryAdmin(); }
    catch (e) { const { captureError } = await import('@/lib/logger'); captureError(e, { where: 'instrumentation.ensureRecoveryAdmin' }); }
  }
}
