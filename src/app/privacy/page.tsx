import type { Metadata } from 'next';
import Link from 'next/link';
import { wrap, inner, draft, h1, meta, h2, p } from '../legal-styles';

export const metadata: Metadata = { title: '개인정보 처리방침 — PMS', description: 'PMS 개인정보 처리방침(초안).' };

export default function PrivacyPage() {
  return (
    <div style={wrap}><div style={inner}>
      <Link href="/pricing" style={{ fontSize: 13, color: 'var(--brand-600)', fontWeight: 700 }}>← 요금제로</Link>
      <div style={draft}>본 방침은 <b>초안</b>입니다. 실제 개인정보 수집 개시 전 법무·보안 검토와 항목 확정이 필요합니다.</div>
      <h1 style={h1}>개인정보 처리방침</h1>
      <div style={meta}>운영: 주식회사 고원 · 시행일: 2026-00-00 (초안)</div>

      <h2 style={h2}>1. 수집하는 개인정보 항목</h2>
      <p style={p}>회원가입·서비스 이용 과정에서 이메일, 이름(닉네임), 소속 조직명, 접속기록(IP·로그), 결제 시 결제대행사를 통한 결제정보를 수집합니다. 서비스 내 입력 데이터는 이용자 소유로 처리 위탁 범위에서만 취급합니다.</p>

      <h2 style={h2}>2. 개인정보의 이용 목적</h2>
      <p style={p}>회원 식별·인증, 서비스 제공·운영, 요금 정산·결제, 고객지원·공지, 부정이용 방지 및 보안, 법령상 의무 이행을 위해 이용합니다.</p>

      <h2 style={h2}>3. 보유 및 이용 기간</h2>
      <p style={p}>원칙적으로 회원 탈퇴 시 지체 없이 파기합니다. 다만 관계 법령(전자상거래법 등)에 따라 계약·결제 기록은 5년, 접속기록은 3개월 등 법정 기간 동안 보관 후 파기합니다.</p>

      <h2 style={h2}>4. 제3자 제공</h2>
      <p style={p}>회사는 이용자의 동의 없이 개인정보를 제3자에게 제공하지 않습니다. 다만 법령에 근거가 있거나 수사기관의 적법한 요청이 있는 경우는 예외로 합니다.</p>

      <h2 style={h2}>5. 처리 위탁</h2>
      <p style={p}>서비스 제공을 위해 클라우드 인프라(호스팅), 결제대행(PG) 등에 개인정보 처리를 위탁할 수 있으며, 수탁자·위탁업무를 본 방침에 고지합니다.</p>

      <h2 style={h2}>6. 정보주체의 권리</h2>
      <p style={p}>이용자는 자신의 개인정보에 대해 열람·정정·삭제·처리정지를 요구할 수 있으며, 회사는 지체 없이 조치합니다.</p>

      <h2 style={h2}>7. 안전성 확보 조치</h2>
      <p style={p}>접근권한 최소화, 전송·저장 구간 암호화, 접속기록 보관·위변조 방지, 취약점 점검 등 관리적·기술적 보호조치를 시행합니다.</p>

      <h2 style={h2}>8. 개인정보 보호책임자</h2>
      <p style={p}>개인정보 보호책임자: 주식회사 고원 · 이메일: gowonceo@gmail.com. 개인정보 관련 문의·불만은 위 연락처로 접수할 수 있습니다.</p>
    </div></div>
  );
}
