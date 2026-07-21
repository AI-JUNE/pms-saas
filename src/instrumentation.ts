// Next.js 기동 훅: 서버 인스턴스 시작 시 스키마 자동 정합(배포마다 자동 마이그레이션).
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    try { const { ensureSchema } = await import('@/lib/migrate'); await ensureSchema(); }
    catch (e) { console.error('[instrumentation] ensureSchema 실패', e); }
    try { const { ensureRecoveryAdmin } = await import('@/lib/bootstrap'); await ensureRecoveryAdmin(); }
    catch (e) { console.error('[instrumentation] ensureRecoveryAdmin 실패', e); }
  }
}
