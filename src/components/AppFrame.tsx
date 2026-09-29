'use client';
import { useEffect, useRef, useState } from 'react';
import { ExternalLink, Maximize2 } from 'lucide-react';
import { Shell } from './Shell';

/**
 * 제안 앱 호스트 — `public/apps/<key>/index.html` 을 iframe 으로 띄운다.
 *
 * ── 왜 iframe 인가 ──────────────────────────────────────────────────────────
 * 제안 3종은 각자 완결된 HTML 문서다(자체 <html>·<head>·전역 CSS·전역 스크립트).
 * React 트리 안으로 인라인하면 전역 CSS 가 PMS 화면을 덮어쓰고, 전역 변수명이
 * 충돌한다. 포팅하면 그 충돌을 하나씩 풀어야 하는데 세 앱 합쳐 838KB 다.
 * iframe 은 문서 경계를 그대로 살려 **코드를 한 줄도 고치지 않고** 넣는다.
 *
 * ── 왜 sandbox 를 걸지 않나 ────────────────────────────────────────────────
 * 같은 오리진에서 우리가 배포하는 우리 앱이고, 세 앱 모두 localStorage 와
 * 외부 API 호출이 필요하다. sandbox 를 걸면 그게 전부 막힌다.
 * 제3자 콘텐츠였다면 반대로 했을 것이다.
 *
 * 접근 제어는 이 라우트가 아니라 `middleware.ts` 의 세션 게이트(`/apps`)가 한다.
 * matcher 가 제외하는 것은 `_next/static`·`_next/image`·`favicon.ico` 뿐이라
 * **public 의 정적 파일 `/apps/...` 에도 미들웨어가 걸린다.** 즉 주소를 직접 알아도
 * 세션 쿠키가 없으면 /login 으로 간다 — 화면과 원본 HTML 이 같은 경계 안에 있다.
 * (이 성질에 기대고 있으므로 matcher 를 손댈 때 tests/appRoutes.test.ts 를 함께 볼 것.)
 */
export interface AppFrameProps {
  /** public/apps/<appKey>/index.html */
  appKey: string;
  title: string;
  subtitle: string;
  /** 내부망 전용 의존이 있으면 적는다(예: cx-store :3006). 없으면 생략. */
  intranetNote?: string;
}

export function AppFrame({ appKey, title, subtitle, intranetNote }: AppFrameProps) {
  const src = `/apps/${appKey}/index.html`;
  const ref = useRef<HTMLIFrameElement>(null);
  const [loaded, setLoaded] = useState(false);
  const [slow, setSlow] = useState(false);

  // 앱이 큰 편(165~467KB + 라이브러리)이라 첫 로드가 길 수 있다.
  // 아무 표시 없이 빈 화면이 오래 있으면 고장으로 보인다.
  useEffect(() => {
    if (loaded) return;
    const t = setTimeout(() => setSlow(true), 4000);
    return () => clearTimeout(t);
  }, [loaded]);

  return (
    <Shell title={title}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, height: 'calc(100vh - 150px)', minHeight: 420 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <div className="muted" style={{ fontSize: 13 }}>{subtitle}</div>
            {intranetNote && (
              <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                ※ {intranetNote}
              </div>
            )}
          </div>
          <a
            href={src}
            target="_blank"
            rel="noreferrer"
            className="btn"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}
            title="이 앱만 새 탭에서 크게 봅니다"
          >
            <Maximize2 size={14} aria-hidden /> 새 탭에서 열기 <ExternalLink size={12} aria-hidden />
          </a>
        </div>

        <div style={{ position: 'relative', flex: 1, border: '1px solid var(--line, #e6eaf2)', borderRadius: 10, overflow: 'hidden', background: '#fff' }}>
          {!loaded && (
            <div
              className="muted"
              style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', fontSize: 13, pointerEvents: 'none' }}
            >
              {slow ? '불러오는 중입니다… (앱이 커서 시간이 걸립니다)' : '불러오는 중…'}
            </div>
          )}
          <iframe
            ref={ref}
            src={src}
            title={title}
            onLoad={() => setLoaded(true)}
            style={{ width: '100%', height: '100%', border: 0, display: 'block', opacity: loaded ? 1 : 0, transition: 'opacity .15s' }}
          />
        </div>
      </div>
    </Shell>
  );
}
