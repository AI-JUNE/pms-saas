// 공용 법적 문서 스타일(초안). 실서비스 적용 전 법무 검토 필요.
export const wrap = { minHeight: '100vh', background: 'var(--bg)', color: 'var(--text-1)', fontFamily: 'var(--font)' } as const;
export const inner = { maxWidth: 820, margin: '0 auto', padding: '32px 22px 80px' } as const;
export const draft = { background: 'var(--amber-50)', border: '1px solid #f0d9a8', color: '#8a5a00', borderRadius: 12, padding: '12px 16px', fontSize: 13, fontWeight: 600, marginBottom: 24 } as const;
export const h1 = { fontSize: 26, fontWeight: 800, letterSpacing: '-.02em', margin: '4px 0 6px' } as const;
export const meta = { fontSize: 12.5, color: 'var(--text-3)', marginBottom: 20 } as const;
export const h2 = { fontSize: 15.5, fontWeight: 800, margin: '22px 0 8px', color: 'var(--text-1)' } as const;
export const p = { fontSize: 13.6, color: 'var(--text-2)', lineHeight: 1.7, margin: '0 0 8px' } as const;
// 고지 표(수탁자·국외이전) — 값은 lib/legalDisclosure.ts 에서만 온다(문구 하드코딩 금지).
export const table = { width: '100%', borderCollapse: 'collapse', fontSize: 13, margin: '6px 0 8px' } as const;
export const th = { textAlign: 'left', padding: '7px 10px', background: 'var(--surface-3)', color: 'var(--text-2)', fontWeight: 700, border: '1px solid var(--border)', whiteSpace: 'nowrap' } as const;
export const td = { padding: '7px 10px', color: 'var(--text-2)', border: '1px solid var(--border)', lineHeight: 1.6 } as const;
// 미고지 안내 — 초안 배너보다 약한 톤(정보성).
export const pending = { background: 'var(--surface-2)', border: '1px dashed var(--border-2)', color: 'var(--text-3)', borderRadius: 10, padding: '10px 13px', fontSize: 13, lineHeight: 1.65, margin: '0 0 8px' } as const;
// 목차
export const toc = { margin: '0 0 8px', padding: '12px 16px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 12 } as const;
export const tocList = { margin: 0, padding: '0 0 0 18px', fontSize: 13, lineHeight: 1.9, color: 'var(--text-2)' } as const;
