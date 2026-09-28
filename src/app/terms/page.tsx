import type { Metadata } from 'next';
import Link from 'next/link';
import { wrap, inner, draft, h1, meta, h2, p, toc, tocList } from '../legal-styles';
import { legalDoc, draftNotice, docMetaLine } from '@/lib/legal';

export const metadata: Metadata = { title: '이용약관 — PMS', description: 'PMS 서비스 이용약관.' };

// 조문 제목·본문을 한 배열로 두어 목차와 본문이 어긋나지 않게 한다.
const ARTICLES = [
  { id: 'purpose', title: '제1조 (목적)', body: '본 약관은 주식회사 고원(이하 "회사")이 제공하는 프로젝트 관리 SaaS(이하 "서비스")의 이용과 관련하여 회사와 이용자 간의 권리·의무 및 책임사항을 규정함을 목적으로 합니다.' },
  { id: 'definitions', title: '제2조 (정의)', body: '"이용자"는 본 약관에 동의하고 서비스를 이용하는 개인·법인을 말하며, "유료서비스"는 요금을 지불하고 이용하는 서비스, "워크스페이스"는 조직 단위 작업공간을 의미합니다.' },
  { id: 'formation', title: '제3조 (계약의 성립)', body: '이용계약은 이용자가 약관에 동의하고 회사가 이를 승낙함으로써 성립합니다. 회사는 운영·기술상 필요 시 승낙을 유보하거나 제한할 수 있습니다.' },
  { id: 'service', title: '제4조 (서비스의 제공 및 변경)', body: '회사는 연중무휴 서비스 제공을 원칙으로 하되, 점검·장애·불가항력 시 일시 중단할 수 있으며 사전 또는 사후 고지합니다. 서비스 내용은 개선을 위해 변경될 수 있습니다.' },
  { id: 'fees', title: '제5조 (요금 및 결제)', body: '유료서비스의 요금·결제주기는 요금제 페이지에 따릅니다. 요금은 사용자 수 기준으로 부과되며, 부가가치세는 별도입니다. 결제는 회사가 정한 결제대행사를 통해 처리됩니다.' },
  { id: 'termination', title: '제6조 (해지 및 환불)', body: '이용자는 언제든지 해지할 수 있으며, 환불은 관계 법령 및 회사의 환불정책에 따릅니다. 이미 제공된 서비스 기간에 대한 요금은 환불되지 않을 수 있습니다.' },
  { id: 'duties', title: '제7조 (이용자의 의무)', body: '이용자는 계정정보를 안전하게 관리하고, 법령·약관·공서양속에 반하는 행위를 하지 않아야 합니다. 타인의 권리를 침해하거나 서비스 운영을 방해해서는 안 됩니다.' },
  { id: 'data', title: '제8조 (데이터 및 지식재산권)', body: '이용자가 입력한 데이터의 권리는 이용자에게 있으며, 회사는 서비스 제공 목적 범위에서만 이를 처리합니다. 서비스 자체의 지식재산권은 회사에 귀속됩니다.' },
  { id: 'liability', title: '제9조 (책임의 제한)', body: '회사는 불가항력, 이용자 귀책, 무료서비스로 인한 손해에 대해 관계 법령이 허용하는 범위에서 책임을 지지 않습니다.' },
  { id: 'law', title: '제10조 (준거법 및 관할)', body: '본 약관은 대한민국 법령에 따르며, 분쟁은 회사 소재지 관할 법원을 제1심 법원으로 합니다.' },
] as const;

export default function TermsPage() {
  const doc = legalDoc('terms');
  const notice = draftNotice(doc);
  return (
    <div style={wrap}><div style={inner}>
      <Link href="/pricing" style={{ fontSize: 13, color: 'var(--brand-600)', fontWeight: 700 }}>← 요금제로</Link>
      {notice ? <div style={draft} role="note">{notice}</div> : null}
      <h1 style={h1}>서비스 이용약관</h1>
      <div style={meta}>{docMetaLine(doc)}</div>

      <nav style={toc} aria-label="문서 목차">
        <ul style={{ ...tocList, listStyle: 'none', paddingLeft: 0 }}>
          {ARTICLES.map((a) => (
            <li key={a.id}><a href={`#${a.id}`} style={{ color: 'var(--brand-600)' }}>{a.title}</a></li>
          ))}
        </ul>
      </nav>

      <main id="main-content" tabIndex={-1} aria-label="서비스 이용약관 본문">
        {ARTICLES.map((a) => (
          <section key={a.id} aria-labelledby={a.id}>
            <h2 id={a.id} style={h2}>{a.title}</h2>
            <p style={p}>{a.body}</p>
          </section>
        ))}
      </main>
    </div></div>
  );
}
