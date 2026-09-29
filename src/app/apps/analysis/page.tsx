'use client';
import { ExternalLink, Server, ArrowUpRight } from 'lucide-react';
import { Shell } from '@/components/Shell';

/**
 * 제안분석(ERM) — 포털 안의 자리만 먼저 만든다. 2026-09-29
 *
 * ── 왜 iframe 이 아닌가 ────────────────────────────────────────────────────
 * 다른 세 앱(품질·전략·성과)은 정적 HTML 이라 public/ 에 넣고 iframe 으로 띄웠다.
 * 제안분석은 **Node 백엔드가 딸린 앱**이다 — 업로드·분석 작업 큐·LLM 호출·
 * jobs.json 저장이 전부 서버 쪽에 있다. 파일만 복사해서는 동작하지 않는다.
 * 포털로 들이려면 API 를 Next route 로 옮기고 jobs.json 을 Postgres 로 옮겨야 한다.
 * 그건 2단계다. 그때까지 이 화면이 **자리를 지키고 경로를 알려 준다** —
 * 메뉴에서 사라져 있으면 "포털에 없는 서비스"가 되어 버린다.
 *
 * ── 왜 주소를 소스에 안 박나 ──────────────────────────────────────────────
 * 이 저장소는 Vercel 로도 나간다. 사내 IP 를 번들에 넣으면 공개 배포본에서
 * 내부 망 구성이 그대로 읽힌다. 그래서 NEXT_PUBLIC_ERM_URL 로만 받고,
 * 값이 없으면 링크를 만들지 않는다(주소를 지어내지 않는다).
 */
const ERM_URL = process.env.NEXT_PUBLIC_ERM_URL || '';

export default function Page() {
  return (
    <Shell title="제안분석">
      <div style={{ maxWidth: 720, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div className="muted" style={{ fontSize: 13 }}>
          RFP 원문을 읽어 요구사항·배점기준·리스크를 뽑고, 제안 초안과 예상 질의를 만듭니다.
        </div>

        <div
          style={{
            border: '1px solid var(--line, #e6eaf2)',
            borderRadius: 12,
            padding: 20,
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
            background: 'var(--panel2, #fafbfe)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700 }}>
            <Server size={16} aria-hidden /> 사내 서버에서 동작합니다
          </div>

          <div className="muted" style={{ fontSize: 13, lineHeight: 1.7 }}>
            제안분석은 파일 업로드·분석 작업·LLM 호출을 서버에서 처리하는 앱이라,
            다른 세 앱처럼 화면만 옮겨 올 수 없습니다. 지금은 사내 서버에서 그대로 쓰시고,
            포털 안으로 들이는 작업(API 이관 · 저장소 통합)은 다음 단계에서 진행합니다.
          </div>

          {ERM_URL ? (
            <a
              href={ERM_URL}
              target="_blank"
              rel="noreferrer"
              className="btn"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, alignSelf: 'flex-start' }}
            >
              <ArrowUpRight size={15} aria-hidden /> 제안분석 열기 <ExternalLink size={12} aria-hidden />
            </a>
          ) : (
            <div
              className="muted"
              style={{ fontSize: 12.5, border: '1px dashed var(--line, #e6eaf2)', borderRadius: 8, padding: '10px 12px' }}
            >
              주소가 설정되지 않았습니다. 환경변수 <code>NEXT_PUBLIC_ERM_URL</code> 에
              사내 제안분석 주소를 넣으면 이 자리에 바로가기가 생깁니다.
            </div>
          )}
        </div>
      </div>
    </Shell>
  );
}
