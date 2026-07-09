import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'PRISM PMS — 계획부터 정산까지, 하나의 프로젝트 관리',
  description:
    'WBS·간트·EVM 성과관리·요구사항 추적(RTM)·이슈/리스크·결재·테스트까지. 흩어진 관리도구를 한 화면으로 잇는 프로젝트 관리 SaaS.',
};

const css = `
.lp{--lp-max:1120px;color:var(--text-1);background:var(--bg);overflow-x:hidden}
.lp *{box-sizing:border-box}
.lp .wrap{max-width:var(--lp-max);margin:0 auto;padding:0 24px}
.lp section{position:relative}
.lp .eyebrow{display:inline-flex;align-items:center;gap:7px;font-size:12px;font-weight:800;letter-spacing:.02em;color:var(--brand-600);background:var(--brand-50);border:1px solid var(--brand-100);padding:6px 13px;border-radius:999px}
.lp .sec-tag{font-size:11.5px;font-weight:800;letter-spacing:.14em;color:var(--text-3);text-transform:uppercase}
.lp h2{font-size:clamp(24px,3.4vw,36px);font-weight:850;letter-spacing:-.035em;line-height:1.18;margin:12px 0 0}
.lp .lead{color:var(--text-2);font-size:clamp(14px,1.5vw,16px);line-height:1.7;margin:14px 0 0;max-width:620px}
.lp .hl{color:var(--brand)}

/* nav */
.lp-nav{position:sticky;top:0;z-index:50;background:rgba(247,245,242,.82);backdrop-filter:saturate(1.4) blur(10px);border-bottom:1px solid var(--border)}
.lp-nav .wrap{display:flex;align-items:center;height:64px;gap:16px}
.lp-brand{display:flex;align-items:center;gap:11px}
.lp-mark{width:38px;height:38px;border-radius:11px;background:linear-gradient(140deg,#be5535,#e6915f);display:flex;align-items:center;justify-content:center;box-shadow:0 4px 12px rgba(190,85,53,.3)}
.lp-brand b{font-weight:850;font-size:19px;letter-spacing:-.03em}
.lp-brand span{display:block;font-size:9px;letter-spacing:.13em;color:var(--text-3);font-weight:800;text-transform:uppercase;margin-top:2px}
.lp-nav .navlinks{display:flex;gap:4px;margin-left:18px}
.lp-nav .navlinks a{padding:8px 12px;border-radius:9px;font-size:13.5px;font-weight:650;color:var(--text-2);transition:.13s}
.lp-nav .navlinks a:hover{background:var(--surface-3);color:var(--text-1)}
.lp-nav .spacer{flex:1}
.lp-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;font-weight:750;font-size:14px;padding:10px 18px;border-radius:11px;transition:.14s;border:1px solid transparent;white-space:nowrap}
.lp-btn.pri{background:var(--brand);color:#fff;box-shadow:0 6px 18px rgba(190,85,53,.28)}
.lp-btn.pri:hover{background:var(--brand-600);transform:translateY(-1px);box-shadow:0 10px 24px rgba(190,85,53,.34)}
.lp-btn.ghost{background:#fff;color:var(--text-1);border-color:var(--border-strong);box-shadow:var(--sh-sm)}
.lp-btn.ghost:hover{background:var(--surface-2);border-color:var(--border-2)}
.lp-btn.lg{padding:13px 24px;font-size:15px}
@media(max-width:720px){.lp-nav .navlinks{display:none}}

/* hero */
.lp-hero{padding:76px 0 40px;text-align:center;position:relative}
.lp-hero::before{content:'';position:absolute;inset:0;background:
  radial-gradient(680px 300px at 50% -8%,rgba(190,85,53,.14),transparent 70%),
  radial-gradient(520px 260px at 88% 12%,rgba(124,77,255,.08),transparent 70%);pointer-events:none}
.lp-hero .wrap{position:relative}
.lp-hero h1{font-size:clamp(32px,5.6vw,60px);font-weight:880;letter-spacing:-.045em;line-height:1.08;margin:20px auto 0;max-width:820px}
.lp-hero .lead{margin:20px auto 0;text-align:center}
.lp-cta{display:flex;gap:12px;justify-content:center;flex-wrap:wrap;margin-top:30px}
.lp-chips{display:flex;gap:9px;justify-content:center;flex-wrap:wrap;margin-top:26px}
.lp-chip{display:inline-flex;align-items:center;gap:7px;background:var(--surface);border:1px solid var(--border);border-radius:999px;padding:8px 14px;font-size:12.5px;font-weight:700;color:var(--text-2);box-shadow:var(--sh-sm)}
.lp-trust{margin-top:26px;font-size:12.5px;color:var(--text-3);font-weight:600;display:flex;gap:16px;justify-content:center;flex-wrap:wrap}
.lp-trust b{color:var(--brand-600);font-weight:800}

/* mockup */
.lp-mock{margin:44px auto 0;max-width:960px;background:var(--surface);border:1px solid var(--border);border-radius:20px;box-shadow:var(--sh-lg);overflow:hidden}
.lp-mock .bar{display:flex;align-items:center;gap:8px;padding:12px 16px;border-bottom:1px solid var(--border);background:var(--surface-2)}
.lp-mock .bar i{width:11px;height:11px;border-radius:50%;background:var(--border-strong);display:block}
.lp-mock .bar i:nth-child(1){background:#e0625b}.lp-mock .bar i:nth-child(2){background:#e3ab3a}.lp-mock .bar i:nth-child(3){background:#3bb35a}
.lp-mock .bar span{margin-left:8px;font-size:11.5px;color:var(--text-3);font-weight:700}
.lp-mock .body{padding:20px;display:grid;grid-template-columns:repeat(4,1fr);gap:12px}
.mk-kpi{background:var(--surface-2);border:1px solid var(--border);border-radius:12px;padding:14px}
.mk-kpi .k{font-size:11px;color:var(--text-3);font-weight:700}
.mk-kpi .v{font-size:24px;font-weight:850;letter-spacing:-.03em;margin-top:6px}
.mk-kpi .d{font-size:10.5px;font-weight:750;margin-top:5px}
.mk-kpi .d.up{color:var(--green)}.mk-kpi .d.dn{color:var(--red)}
.lp-mock .gantt{grid-column:1/-1;background:var(--surface-2);border:1px solid var(--border);border-radius:12px;padding:16px}
.gr{display:flex;align-items:center;gap:12px;margin-top:11px}
.gr:first-child{margin-top:0}
.gr .lbl{width:118px;font-size:12px;font-weight:700;color:var(--text-2);flex-shrink:0;text-align:right}
.gr .track{flex:1;height:16px;background:var(--surface-3);border-radius:6px;position:relative}
.gr .bar2{position:absolute;top:0;height:16px;border-radius:6px;background:linear-gradient(90deg,#be5535,#e6915f)}
.gr .bar2.b2{background:linear-gradient(90deg,#7c4dff,#a98bff)}
.gr .bar2.b3{background:linear-gradient(90deg,#0e9bb8,#4bc6dd)}
.gr .bar2.b4{background:linear-gradient(90deg,#15a34a,#54c47d)}
@media(max-width:720px){.lp-mock .body{grid-template-columns:repeat(2,1fr)}.gr .lbl{width:76px}}

/* generic section spacing */
.lp-band{padding:72px 0}
.lp-band.tint{background:linear-gradient(180deg,var(--surface-2),var(--bg))}
.lp-center{text-align:center;max-width:680px;margin:0 auto}
.lp-center .lead{margin-left:auto;margin-right:auto}

/* feature grid */
.lp-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-top:40px}
.lp-card{background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:22px;box-shadow:var(--sh-sm);transition:.16s}
.lp-card:hover{transform:translateY(-3px);box-shadow:var(--sh-md);border-color:var(--brand-100)}
.lp-card .ic{width:44px;height:44px;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:22px;background:var(--brand-50);border:1px solid var(--brand-100);margin-bottom:14px}
.lp-card h3{font-size:16.5px;font-weight:800;letter-spacing:-.02em;margin:0}
.lp-card p{color:var(--text-2);font-size:13.5px;line-height:1.65;margin:8px 0 0}
@media(max-width:900px){.lp-grid{grid-template-columns:1fr 1fr}}
@media(max-width:600px){.lp-grid{grid-template-columns:1fr}}

/* workflow */
.lp-flow{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-top:40px}
.flow-step{background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:24px;box-shadow:var(--sh-sm);position:relative}
.flow-step .no{font-size:13px;font-weight:850;color:#fff;background:var(--brand);width:34px;height:34px;border-radius:10px;display:flex;align-items:center;justify-content:center;letter-spacing:-.02em}
.flow-step h3{font-size:17px;font-weight:800;margin:14px 0 0;letter-spacing:-.02em}
.flow-step p{color:var(--text-2);font-size:13.5px;line-height:1.6;margin:8px 0 0}
@media(max-width:820px){.lp-flow{grid-template-columns:1fr}}

/* stats */
.lp-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-top:40px}
.stat{background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:24px 20px;text-align:center;box-shadow:var(--sh-sm)}
.stat .n{font-size:clamp(28px,4vw,40px);font-weight:880;letter-spacing:-.04em;background:linear-gradient(120deg,#be5535,#e6915f);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;line-height:1}
.stat .l{font-size:12.5px;font-weight:700;color:var(--text-2);margin-top:10px}
.stat .s{font-size:11px;color:var(--text-3);margin-top:4px;font-weight:600}
@media(max-width:820px){.lp-stats{grid-template-columns:1fr 1fr}}

/* roles */
.lp-roles{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-top:40px}
.role{background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:20px;box-shadow:var(--sh-sm)}
.role .em{font-size:26px}
.role h4{font-size:15px;font-weight:800;margin:10px 0 0}
.role p{font-size:12.5px;color:var(--text-2);line-height:1.6;margin:6px 0 0}
@media(max-width:900px){.lp-roles{grid-template-columns:1fr 1fr}}

/* faq */
.lp-faq{max-width:760px;margin:36px auto 0}
.faq{background:var(--surface);border:1px solid var(--border);border-radius:14px;margin-top:10px;overflow:hidden;box-shadow:var(--sh-sm)}
.faq summary{list-style:none;cursor:pointer;padding:17px 20px;font-weight:750;font-size:15px;display:flex;align-items:center;justify-content:space-between;gap:12px}
.faq summary::-webkit-details-marker{display:none}
.faq summary::after{content:'+';font-size:20px;font-weight:600;color:var(--brand);transition:.2s;flex-shrink:0}
.faq[open] summary::after{transform:rotate(45deg)}
.faq .ans{padding:0 20px 18px;color:var(--text-2);font-size:13.5px;line-height:1.7}

/* final cta */
.lp-final{margin:72px auto;max-width:var(--lp-max)}
.lp-final .box{margin:0 24px;background:linear-gradient(135deg,#be5535,#8a3a23);border-radius:24px;padding:56px 32px;text-align:center;color:#fff;box-shadow:0 24px 60px rgba(138,58,35,.34);position:relative;overflow:hidden}
.lp-final .box::before{content:'';position:absolute;inset:0;background:radial-gradient(400px 200px at 80% 0%,rgba(255,255,255,.16),transparent 70%)}
.lp-final h2{color:#fff;position:relative}
.lp-final p{color:rgba(255,255,255,.9);margin:14px auto 0;max-width:520px;position:relative;font-size:15px;line-height:1.6}
.lp-final .lp-cta{margin-top:26px;position:relative}
.lp-final .lp-btn.pri{background:#fff;color:var(--brand-700)}
.lp-final .lp-btn.pri:hover{background:#fff;transform:translateY(-1px)}
.lp-final .lp-btn.ghost{background:transparent;color:#fff;border-color:rgba(255,255,255,.5)}
.lp-final .lp-btn.ghost:hover{background:rgba(255,255,255,.12)}

/* footer */
.lp-foot{border-top:1px solid var(--border);padding:44px 0 40px}
.lp-foot .wrap{display:flex;flex-wrap:wrap;gap:28px;justify-content:space-between}
.lp-foot .about{max-width:320px}
.lp-foot .about p{color:var(--text-2);font-size:13px;line-height:1.65;margin:12px 0 0}
.lp-foot .cols{display:flex;gap:52px;flex-wrap:wrap}
.lp-foot .col b{font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--text-3);font-weight:800}
.lp-foot .col a{display:block;margin-top:11px;font-size:13.5px;color:var(--text-2);font-weight:600}
.lp-foot .col a:hover{color:var(--brand-600)}
.lp-copy{border-top:1px solid var(--border);margin-top:36px;padding-top:20px;font-size:12px;color:var(--text-3);font-weight:600}
`;

const brandMark = (
  <div className="lp-mark">
    <svg width="21" height="21" viewBox="0 0 24 24" fill="none">
      <rect x="3" y="3" width="7" height="7" rx="1.8" fill="#fff" fillOpacity="0.95" />
      <rect x="14" y="3" width="7" height="7" rx="1.8" fill="#fff" fillOpacity="0.55" />
      <rect x="3" y="14" width="7" height="7" rx="1.8" fill="#fff" fillOpacity="0.55" />
      <rect x="14" y="14" width="7" height="7" rx="1.8" fill="#fff" fillOpacity="0.95" />
    </svg>
  </div>
);

const features = [
  { ic: '📁', t: '프로젝트 · 단계 관리', d: '프로젝트와 단계(Phase)를 한눈에. 진행 단계별 색상·정렬·삭제가드로 안전하게 구성합니다.' },
  { ic: '🔗', t: '요구사항 + RTM', d: '요구사항을 등록하고 업무·테스트·산출물과 추적 매트릭스(RTM)로 양방향 연결합니다.' },
  { ic: '🐞', t: '이슈 · 리스크', d: '이슈/결함과 리스크를 유형·우선순위·담당자로 관리하고, 확률×영향으로 등급을 산정합니다.' },
  { ic: '📊', t: 'WBS 공수 · EVM', d: '계층형 WBS(1·1.1)와 공수 기반 EVM(PV·EV·AC·SPI·CPI)으로 성과를 정량 측정합니다.' },
  { ic: '📅', t: '인터랙티브 간트', d: '드래그·줌·의존선·마일스톤·임계경로·베이스라인·스와이레인을 갖춘 실시간 간트 차트.' },
  { ic: '✅', t: '테스트 · 결재', d: '개발→PL→PM 테스트 파이프라인과 산출물 전자결재 경계를 감사로그와 함께 처리합니다.' },
];

const flow = [
  { n: '01', t: '계획', d: '프로젝트·단계·요구사항을 정의하고 WBS로 업무를 분해합니다. 베이스라인을 잡아 기준선을 고정합니다.' },
  { n: '02', t: '실행 · 추적', d: '간트·칸반·캘린더로 진행을 추적하고, 이슈·리스크·테스트를 실시간 관리합니다. 내 작업과 업무부하가 자동 집계됩니다.' },
  { n: '03', t: '성과 · 결재', d: 'EVM 지표(SPI·CPI)로 성과를 측정하고, 산출물을 전자결재로 확정. 주간보고·엑셀 내보내기로 마무리합니다.' },
];

const stats = [
  { n: '100~130ms', l: 'Warm 응답 속도', s: 'sin1 리전 + 핵심 인덱스' },
  { n: '15+', l: '통합 관리 도메인', s: '프로젝트~조달까지 한 곳' },
  { n: '자동', l: '무인 배포 · 마이그레이션', s: '멱등 스키마 자가정합' },
  { n: '100%', l: '반응형 · 모바일 대응', s: '하단탭바 · 44px 터치' },
];

const roles = [
  { em: '🧭', t: 'PM', d: '대시보드에서 SPI·CPI·진척·리스크를 한눈에. 자원 배분과 결재를 한 화면에서.' },
  { em: '🛠️', t: 'PL', d: '팀 업무부하와 테스트 파이프라인을 관리하고, 요구사항-업무 연결을 검증합니다.' },
  { em: '👩‍💻', t: '개발자', d: '내 작업·스프린트·이슈에 집중. 인라인 편집과 ⌘K 전역검색으로 빠르게.' },
  { em: '📈', t: '경영진', d: '프로젝트 포트폴리오와 주간 추이를 요약 리포트·엑셀로 즉시 확인합니다.' },
];

const faqs = [
  { q: 'PMS는 어떤 규모의 팀에 맞나요?', a: '멀티테넌트(조직별 격리) 구조라 소규모 팀부터 여러 조직·프로젝트를 동시에 운영하는 기업까지 대응합니다. 역할 기반 권한(RBAC)으로 조직마다 접근을 분리합니다.' },
  { q: 'JIRA·monday 같은 도구와 무엇이 다른가요?', a: '이슈 트래킹과 보드뿐 아니라 요구사항 추적(RTM), 공수 기반 EVM 성과관리, 산출물 전자결재, 조달·인프라·방화벽까지 SI/공공 프로젝트 관리에 필요한 도메인을 한 제품에 담았습니다.' },
  { q: '데이터 마이그레이션이나 스키마 변경은 어떻게 되나요?', a: '배포 시 서버가 멱등 DDL로 스키마를 자동 정합합니다. 관리자가 별도 마이그레이션 버튼을 누르지 않아도 스키마가 바뀐 배포까지 무중단으로 반영됩니다.' },
  { q: 'EVM·간트 같은 고급 기능도 바로 쓸 수 있나요?', a: '네. 공수를 입력하면 PV·EV·AC와 SPI·CPI가 자동 계산되고, 의존성·베이스라인·임계경로를 갖춘 인터랙티브 간트가 즉시 동작합니다.' },
  { q: '모바일에서도 쓸 수 있나요?', a: '전 화면이 반응형이며, 모바일은 하단 탭바·44px 터치 타깃·포커스링으로 최적화되어 있습니다. 앱 설치 없이 브라우저로 바로 사용합니다.' },
];

export default function LandingPage() {
  return (
    <div className="lp">
      <style dangerouslySetInnerHTML={{ __html: css }} />

      <nav className="lp-nav">
        <div className="wrap">
          <div className="lp-brand">
            {brandMark}
            <div>
              <b>PRISM PMS</b>
              <span>Project Management</span>
            </div>
          </div>
          <div className="navlinks">
            <a href="#features">기능</a>
            <a href="#flow">진행 방식</a>
            <a href="#roles">역할별</a>
            <a href="#faq">FAQ</a>
          </div>
          <div className="spacer" />
          <Link href="/login" className="lp-btn ghost">로그인</Link>
          <Link href="/dashboard" className="lp-btn pri">무료로 시작하기</Link>
        </div>
      </nav>

      <section className="lp-hero">
        <div className="wrap">
          <span className="eyebrow">📊 계획 · 실행 · 성과를 잇는 프로젝트 관리 SaaS</span>
          <h1>계획부터 정산까지,<br /><span className="hl">하나의 화면</span>에서 관리하세요</h1>
          <p className="lead">
            WBS·간트·EVM 성과관리·요구사항 추적(RTM)·이슈/리스크·전자결재·테스트까지.
            흩어져 있던 프로젝트 관리 도구를 PRISM PMS 하나로 잇습니다.
          </p>
          <div className="lp-cta">
            <Link href="/dashboard" className="lp-btn pri lg">데모 둘러보기 →</Link>
            <Link href="/login" className="lp-btn ghost lg">로그인</Link>
          </div>
          <div className="lp-chips">
            <span className="lp-chip">📐 WBS · 간트</span>
            <span className="lp-chip">📈 EVM 성과관리</span>
            <span className="lp-chip">🔗 요구사항 추적 RTM</span>
            <span className="lp-chip">🖊 전자결재 · 감사로그</span>
          </div>
          <div className="lp-trust">
            <span><b>Warm 100~130ms</b> 응답</span>
            <span><b>무인</b> 자동배포 · 마이그레이션</span>
            <span><b>RBAC</b> 멀티테넌트</span>
          </div>

          <div className="lp-mock">
            <div className="bar"><i /><i /><i /><span>PRISM PMS · 대시보드</span></div>
            <div className="body">
              <div className="mk-kpi"><div className="k">진행 프로젝트</div><div className="v">12</div><div className="d up">▲ 정상 9</div></div>
              <div className="mk-kpi"><div className="k">SPI (일정)</div><div className="v">1.04</div><div className="d up">▲ 계획 대비</div></div>
              <div className="mk-kpi"><div className="k">CPI (비용)</div><div className="v">0.97</div><div className="d dn">▼ 주의 2</div></div>
              <div className="mk-kpi"><div className="k">열린 이슈</div><div className="v">28</div><div className="d up">▲ 이번주 -6</div></div>
              <div className="gantt">
                <div className="gr"><div className="lbl">요구사항 정의</div><div className="track"><div className="bar2" style={{ left: '2%', width: '26%' }} /></div></div>
                <div className="gr"><div className="lbl">설계</div><div className="track"><div className="bar2 b2" style={{ left: '20%', width: '30%' }} /></div></div>
                <div className="gr"><div className="lbl">개발 · 구현</div><div className="track"><div className="bar2 b3" style={{ left: '40%', width: '38%' }} /></div></div>
                <div className="gr"><div className="lbl">테스트 · 검수</div><div className="track"><div className="bar2 b4" style={{ left: '70%', width: '26%' }} /></div></div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="lp-band" id="features">
        <div className="wrap">
          <div className="lp-center">
            <span className="sec-tag">Features</span>
            <h2>흩어진 관리 도구를,<br /><span className="hl">하나로</span></h2>
            <p className="lead">엑셀·이슈트래커·간트툴·결재 시스템을 오가지 마세요. 프로젝트 관리의 전 과정을 한 제품에서 처리합니다.</p>
          </div>
          <div className="lp-grid">
            {features.map((f) => (
              <div className="lp-card" key={f.t}>
                <div className="ic">{f.ic}</div>
                <h3>{f.t}</h3>
                <p>{f.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="lp-band tint" id="flow">
        <div className="wrap">
          <div className="lp-center">
            <span className="sec-tag">How it works</span>
            <h2>계획 · 실행 · 성과,<br /><span className="hl">끊김 없이</span></h2>
            <p className="lead">기준선을 잡고, 실시간으로 추적하고, 정량 지표로 마무리합니다. 담당자는 한 곳에서 프로젝트 전 과정을 운영합니다.</p>
          </div>
          <div className="lp-flow">
            {flow.map((s) => (
              <div className="flow-step" key={s.n}>
                <div className="no">{s.n}</div>
                <h3>{s.t}</h3>
                <p>{s.d}</p>
              </div>
            ))}
          </div>
          <div className="lp-stats">
            {stats.map((s) => (
              <div className="stat" key={s.l}>
                <div className="n">{s.n}</div>
                <div className="l">{s.l}</div>
                <div className="s">{s.s}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="lp-band" id="roles">
        <div className="wrap">
          <div className="lp-center">
            <span className="sec-tag">For every role</span>
            <h2>모든 역할이,<br /><span className="hl">각자의 화면</span>에서</h2>
            <p className="lead">PM부터 개발자, 경영진까지. 역할에 맞는 뷰와 권한으로 필요한 정보만 정확히 봅니다.</p>
          </div>
          <div className="lp-roles">
            {roles.map((r) => (
              <div className="role" key={r.t}>
                <div className="em">{r.em}</div>
                <h4>{r.t}</h4>
                <p>{r.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="lp-band tint" id="faq">
        <div className="wrap">
          <div className="lp-center">
            <span className="sec-tag">FAQ</span>
            <h2>궁금한 점,<br /><span className="hl">먼저 답해드려요</span></h2>
          </div>
          <div className="lp-faq">
            {faqs.map((f) => (
              <details className="faq" key={f.q}>
                <summary>{f.q}</summary>
                <div className="ans">{f.a}</div>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section className="lp-final">
        <div className="box">
          <h2>오늘, 프로젝트를 한 곳으로 모으세요</h2>
          <p>설치도 계약도 필요 없습니다. 데모로 지금 바로 전체 기능을 둘러보세요.</p>
          <div className="lp-cta">
            <Link href="/dashboard" className="lp-btn pri lg">무료로 시작하기 →</Link>
            <Link href="/login" className="lp-btn ghost lg">로그인</Link>
          </div>
        </div>
      </section>

      <footer className="lp-foot">
        <div className="wrap">
          <div className="about">
            <div className="lp-brand">
              {brandMark}
              <div><b>PRISM PMS</b><span>Project Management</span></div>
            </div>
            <p>계획·실행·성과를 잇는 프로젝트 관리 SaaS. WBS·간트·EVM·RTM·전자결재를 한 화면에서.</p>
          </div>
          <div className="cols">
            <div className="col">
              <b>제품</b>
              <a href="#features">기능</a>
              <a href="#flow">진행 방식</a>
              <a href="#roles">역할별 가치</a>
            </div>
            <div className="col">
              <b>바로가기</b>
              <Link href="/dashboard">대시보드</Link>
              <Link href="/login">로그인</Link>
              <a href="#faq">자주 묻는 질문</a>
            </div>
          </div>
        </div>
        <div className="wrap">
          <div className="lp-copy">© 2026 PRISM PMS · 운영 주식회사 고원 · Project Management System</div>
        </div>
      </footer>
    </div>
  );
}
