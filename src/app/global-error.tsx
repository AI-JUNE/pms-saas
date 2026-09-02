'use client';

// 루트 전역 에러 경계. 렌더 트리 최상단에서 터진 오류까지 잡는다.
// global-error는 루트 레이아웃을 대체하므로 html/body를 직접 렌더해야 한다.
import { useEffect } from 'react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // 서버로 보고. PII를 피하기 위해 pathname만 보내고 쿼리스트링은 제외한다.
    try {
      const body = JSON.stringify({
        message: String(error?.message || '').slice(0, 500),
        digest: error?.digest,
        path: typeof window !== 'undefined' ? window.location.pathname : undefined,
      });
      void fetch('/api/client-errors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: true,
      }).catch(() => { /* 보고 실패는 무시 */ });
    } catch { /* 보고 자체가 화면을 깨뜨리지 않게 한다 */ }
  }, [error]);

  return (
    <html lang="ko">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily:
            "'Pretendard', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Malgun Gothic', sans-serif",
          background: '#faf8f7',
          color: '#2b2320',
        }}
      >
        <main style={{ maxWidth: 480, padding: '40px 24px', textAlign: 'center' }}>
          <div style={{ fontSize: 13, letterSpacing: 2, color: '#be5535', marginBottom: 12 }}>
            PRISM PMS
          </div>
          <h1 style={{ fontSize: 22, fontWeight: 600, margin: '0 0 12px' }}>
            문제가 발생했습니다
          </h1>
          <p style={{ fontSize: 14, lineHeight: 1.7, color: '#6b5d57', margin: '0 0 24px' }}>
            일시적인 오류로 화면을 표시하지 못했습니다. 다시 시도해 주세요.
            문제가 계속되면 아래 오류 코드와 함께 문의해 주시기 바랍니다.
          </p>
          {error?.digest ? (
            <div
              style={{
                fontSize: 12,
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                color: '#8a7a73',
                background: '#f1ece9',
                borderRadius: 6,
                padding: '8px 12px',
                marginBottom: 24,
                wordBreak: 'break-all',
              }}
            >
              오류 코드: {error.digest}
            </div>
          ) : null}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
            <button
              onClick={() => reset()}
              style={{
                padding: '10px 20px',
                fontSize: 14,
                borderRadius: 6,
                border: 'none',
                background: '#be5535',
                color: '#fff',
                cursor: 'pointer',
              }}
            >
              다시 시도
            </button>
            <a
              href="/"
              style={{
                padding: '10px 20px',
                fontSize: 14,
                borderRadius: 6,
                border: '1px solid #ddd3ce',
                background: '#fff',
                color: '#2b2320',
                textDecoration: 'none',
              }}
            >
              홈으로
            </a>
          </div>
        </main>
      </body>
    </html>
  );
}
