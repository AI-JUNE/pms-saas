'use client';

// 404 화면. 지금까지는 이 파일이 없어서 오타·만료 링크로 들어온 방문자가
// Next.js 기본 영문 404("This page could not be found.")를 봤다 — 한국어 상용 제품에서 그대로 두면 안 되는 구멍.
// 레지스트리(lib/appRoutes)에서 비슷한 화면만 추천하고, 근거가 없으면 기본 진입점만 보여준다(없는 화면을 지어내지 않는다).
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { displayPath, entryScreens, suggestScreens } from '@/lib/appRoutes';

export default function NotFound() {
  const pathname = usePathname();
  const shown = displayPath(pathname);
  const suggestions = suggestScreens(pathname);
  const links = suggestions.length ? suggestions : entryScreens();

  return (
    <>
      <a href="#main-content" className="skip-link">본문으로 건너뛰기</a>
      <main
        id="main-content"
        tabIndex={-1}
        style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 20px' }}
      >
        <div className="card card-pad" style={{ maxWidth: 520, width: '100%', textAlign: 'center' }}>
          <div style={{ fontSize: 12.5, letterSpacing: 2, fontWeight: 700, color: 'var(--brand)' }}>404</div>
          <h1 style={{ fontSize: 21, fontWeight: 700, margin: '10px 0 8px' }}>화면을 찾을 수 없습니다</h1>
          <p className="muted" style={{ lineHeight: 1.7, margin: '0 0 6px' }}>
            요청하신 주소에 해당하는 화면이 없습니다. 주소가 바뀌었거나 링크가 만료됐을 수 있습니다.
          </p>
          {shown ? (
            <p
              style={{
                fontSize: 12.5,
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                color: 'var(--text-3)',
                background: 'var(--surface-2)',
                border: '1px solid var(--border)',
                borderRadius: 6,
                padding: '7px 10px',
                margin: '0 0 18px',
                wordBreak: 'break-all',
              }}
            >
              {shown}
            </p>
          ) : (
            <div style={{ height: 12 }} />
          )}

          <h2 style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-2)', margin: '0 0 10px' }}>
            {suggestions.length ? '혹시 이 화면을 찾으셨나요?' : '이동할 수 있는 화면'}
          </h2>
          <nav aria-label={suggestions.length ? '추천 화면' : '주요 화면'}>
            <ul style={{ listStyle: 'none', margin: '0 0 18px', padding: 0, display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
              {links.map((s) => (
                <li key={s.href}>
                  <Link href={s.href} className="btn btn-sm">{s.label}</Link>
                </li>
              ))}
            </ul>
          </nav>

          <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
            <Link href="/dashboard" className="btn btn-pri">대시보드로</Link>
            <Link href="/" className="btn">홈으로</Link>
          </div>
        </div>
      </main>
    </>
  );
}
