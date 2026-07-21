// 공용 법적 문서 스타일(초안). 실서비스 적용 전 법무 검토 필요.
export const wrap = { minHeight: '100vh', background: 'var(--bg)', color: 'var(--text-1)', fontFamily: 'var(--font)' } as const;
export const inner = { maxWidth: 820, margin: '0 auto', padding: '32px 22px 80px' } as const;
export const draft = { background: 'var(--amber-50)', border: '1px solid #f0d9a8', color: '#8a5a00', borderRadius: 12, padding: '12px 16px', fontSize: 13, fontWeight: 600, marginBottom: 24 } as const;
export const h1 = { fontSize: 26, fontWeight: 800, letterSpacing: '-.02em', margin: '4px 0 6px' } as const;
export const meta = { fontSize: 12.5, color: 'var(--text-3)', marginBottom: 20 } as const;
export const h2 = { fontSize: 15.5, fontWeight: 800, margin: '22px 0 8px', color: 'var(--text-1)' } as const;
export const p = { fontSize: 13.6, color: 'var(--text-2)', lineHeight: 1.7, margin: '0 0 8px' } as const;
