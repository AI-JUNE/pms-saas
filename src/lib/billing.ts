// 구독 결제 단일 소스. 실결제는 PAYMENTS_LIVE=true 승인 후에만 활성.
export const PAYMENTS_LIVE = process.env.PAYMENTS_LIVE === 'true';

export type PlanId = 'basic' | 'pro' | 'enterprise';

export interface Plan {
  id: PlanId;
  name: string;
  price: string;
  unit?: string;
  note: string;
  desc: string;
  features: string[];
  cta: string;
  href: string;
  highlight?: boolean;
}

export const PLANS: Plan[] = [
  {
    id: 'basic',
    name: 'Basic',
    price: '₩9,900',
    unit: '/ 사용자 · 월',
    note: '소규모 팀 시작용',
    desc: '프로젝트·WBS·이슈/리스크·간트 기본으로 팀 협업을 시작하세요.',
    features: ['프로젝트·단계·WBS', '이슈/결함·리스크', '기본 간트·칸반·캘린더', '멤버·권한(RBAC)', '5인까지 무료 체험'],
    cta: '무료로 시작',
    href: '/dashboard',
  },
  {
    id: 'pro',
    name: 'Pro',
    price: '₩16,900',
    unit: '/ 사용자 · 월',
    note: '가장 많이 선택',
    desc: '성과관리(EVM)·요구사항 추적·전자결재·테스트까지 실무 전부.',
    features: [
      'Basic 전체 포함',
      'EVM 성과관리(SPI·CPI·PV·EV·AC)',
      '요구사항 추적(RTM)·산출물 전자결재',
      '테스트 관리·실행 리포트',
      '인터랙티브 간트(베이스라인·임계경로·의존성)',
      '대시보드 집계·주간보고·⌘K 전역검색',
    ],
    cta: '무료로 시작',
    href: '/dashboard',
    highlight: true,
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    price: '견적',
    note: '기관·대기업·공공',
    desc: '보안·규정·전용 인프라가 필요한 조직을 위한 맞춤 도입.',
    features: [
      'Pro 전체 포함',
      'SSO·상세 감사로그·데이터 접근 통제',
      '전용 DB·전용 리전·온프레미스 옵션',
      '전담 지원·SLA·교육',
      '공공 조달(GS인증·CSAP) 대응',
    ],
    cta: '도입 문의',
    href: '/login?manual=1',
  },
];
