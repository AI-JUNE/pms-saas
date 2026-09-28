import type { Metadata } from 'next';
import Link from 'next/link';
import { wrap, inner, draft, h1, meta, h2, p, table, th, td, pending, toc, tocList } from '../legal-styles';
import { legalDoc, draftNotice, docMetaLine } from '@/lib/legal';
import { disclosureConfig, publicProcessors, processorNotice, transferNotice } from '@/lib/legalDisclosure';

export const metadata: Metadata = { title: '개인정보 처리방침 — PMS', description: 'PMS 개인정보 처리방침.' };

// 목차는 아래 본문 제목과 같은 배열에서 파생한다(제목만 고치면 목차가 따라온다).
const SECTIONS = [
  { id: 'items', title: '1. 수집하는 개인정보 항목' },
  { id: 'purpose', title: '2. 개인정보의 이용 목적' },
  { id: 'retention', title: '3. 보유 및 이용 기간' },
  { id: 'third-party', title: '4. 제3자 제공' },
  { id: 'processors', title: '5. 처리 위탁' },
  { id: 'cross-border', title: '6. 개인정보의 국외 이전' },
  { id: 'rights', title: '7. 정보주체의 권리' },
  { id: 'security', title: '8. 안전성 확보 조치' },
  { id: 'officer', title: '9. 개인정보 보호책임자' },
] as const;

const titleOf = (id: (typeof SECTIONS)[number]['id']) => SECTIONS.find((s) => s.id === id)!.title;

export default function PrivacyPage() {
  const doc = legalDoc('privacy');
  const notice = draftNotice(doc);
  const cfg = disclosureConfig();
  const processors = publicProcessors(cfg.processors);
  const processorPending = processorNotice(cfg);
  const transferPending = transferNotice(cfg);

  return (
    <div style={wrap}><div style={inner}>
      <Link href="/pricing" style={{ fontSize: 13, color: 'var(--brand-600)', fontWeight: 700 }}>← 요금제로</Link>
      {notice ? <div style={draft} role="note">{notice}</div> : null}
      <h1 style={h1}>개인정보 처리방침</h1>
      <div style={meta}>{docMetaLine(doc)}</div>

      <nav style={toc} aria-label="문서 목차">
        <ol style={tocList}>
          {SECTIONS.map((s) => (
            <li key={s.id}><a href={`#${s.id}`} style={{ color: 'var(--brand-600)' }}>{s.title.replace(/^\d+\.\s*/, '')}</a></li>
          ))}
        </ol>
      </nav>

      <main id="main-content" tabIndex={-1} aria-label="개인정보 처리방침 본문">
        <h2 id="items" style={h2}>{titleOf('items')}</h2>
        <p style={p}>회원가입·서비스 이용 과정에서 이메일, 이름(닉네임), 소속 조직명, 접속기록(IP·로그), 결제 시 결제대행사를 통한 결제정보를 수집합니다. 서비스 내 입력 데이터는 이용자 소유로 처리 위탁 범위에서만 취급합니다.</p>

        <h2 id="purpose" style={h2}>{titleOf('purpose')}</h2>
        <p style={p}>회원 식별·인증, 서비스 제공·운영, 요금 정산·결제, 고객지원·공지, 부정이용 방지 및 보안, 법령상 의무 이행을 위해 이용합니다.</p>

        <h2 id="retention" style={h2}>{titleOf('retention')}</h2>
        <p style={p}>원칙적으로 회원 탈퇴 시 지체 없이 파기합니다. 다만 관계 법령(전자상거래법 등)에 따라 계약·결제 기록은 5년, 접속기록은 3개월 등 법정 기간 동안 보관 후 파기합니다.</p>

        <h2 id="third-party" style={h2}>{titleOf('third-party')}</h2>
        <p style={p}>회사는 이용자의 동의 없이 개인정보를 제3자에게 제공하지 않습니다. 다만 법령에 근거가 있거나 수사기관의 적법한 요청이 있는 경우는 예외로 합니다.</p>

        <h2 id="processors" style={h2}>{titleOf('processors')}</h2>
        <p style={p}>서비스 제공을 위해 클라우드 인프라(호스팅), 결제대행(PG) 등에 개인정보 처리를 위탁할 수 있습니다. 현재 위탁 현황은 아래와 같으며, 변경 시 본 방침을 통해 알립니다.</p>
        {processorPending
          ? <p style={pending} role="note">{processorPending}</p>
          : (
            <table style={table}>
              <caption style={{ captionSide: 'bottom', fontSize: 12, color: 'var(--text-3)', textAlign: 'left', paddingTop: 6 }}>개인정보 처리 수탁자 및 위탁업무</caption>
              <thead>
                <tr><th scope="col" style={th}>수탁자</th><th scope="col" style={th}>위탁업무</th></tr>
              </thead>
              <tbody>
                {processors.map((r) => (
                  <tr key={`${r.name}:${r.purpose}`}><td style={td}>{r.name}</td><td style={td}>{r.purpose}</td></tr>
                ))}
              </tbody>
            </table>
          )}

        <h2 id="cross-border" style={h2}>{titleOf('cross-border')}</h2>
        {transferPending
          ? <p style={pending} role="note">{transferPending}</p>
          : (
            <table style={table}>
              <caption style={{ captionSide: 'bottom', fontSize: 12, color: 'var(--text-3)', textAlign: 'left', paddingTop: 6 }}>개인정보 국외 이전 현황</caption>
              <thead>
                <tr>
                  <th scope="col" style={th}>이전받는 자</th><th scope="col" style={th}>국가</th><th scope="col" style={th}>이전 항목</th>
                  <th scope="col" style={th}>이용 목적</th><th scope="col" style={th}>보유·이용 기간</th><th scope="col" style={th}>거부 방법</th>
                </tr>
              </thead>
              <tbody>
                {cfg.transfers.map((r) => (
                  <tr key={`${r.name}:${r.country}`}>
                    <td style={td}>{r.name}</td><td style={td}>{r.country}</td><td style={td}>{r.items}</td>
                    <td style={td}>{r.purpose}</td><td style={td}>{r.retention}</td><td style={td}>{r.refusal}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

        <h2 id="rights" style={h2}>{titleOf('rights')}</h2>
        <p style={p}>이용자는 자신의 개인정보에 대해 열람·정정·삭제·처리정지를 요구할 수 있으며, 회사는 지체 없이 조치합니다.</p>

        <h2 id="security" style={h2}>{titleOf('security')}</h2>
        <p style={p}>접근권한 최소화, 전송·저장 구간 암호화, 접속기록 보관·위변조 방지, 취약점 점검 등 관리적·기술적 보호조치를 시행합니다.</p>

        <h2 id="officer" style={h2}>{titleOf('officer')}</h2>
        <p style={p}>개인정보 보호책임자: 주식회사 고원 · 이메일: gowonceo@gmail.com. 개인정보 관련 문의·불만은 위 연락처로 접수할 수 있습니다.</p>
      </main>
    </div></div>
  );
}
