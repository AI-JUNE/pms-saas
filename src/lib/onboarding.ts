// 온보딩(가입 → 워크스페이스 → 샘플 프로젝트) 순수 로직. DB·next 의존 0.
// 실제 DB 쓰기는 api/auth/register · api/onboarding 이 이 모듈의 계산 결과로 수행한다.

export const SAMPLE_PROJECT_CODE = 'PRJ-SAMPLE';

export type OnboardingState = {
  hasWorkspace: boolean;      // 조직(워크스페이스) 소속 여부
  projectCount: number;       // 조직 내 프로젝트 수
  hasSampleProject: boolean;  // 샘플 프로젝트 존재 여부
  memberCount: number;        // 조직 멤버십 수(본인 포함)
  hasInviteCode: boolean;     // 초대 코드 발급 여부
};

export type OnboardingStep = {
  key: 'account' | 'workspace' | 'project' | 'invite';
  title: string;
  desc: string;
  done: boolean;
  href: string;
};

/** 조직명 미입력 시 기본 조직명 */
export function defaultOrgName(userName: unknown): string {
  const n = String(userName ?? '').trim();
  return n ? `${n}의 조직` : '내 조직';
}

/** 조직 slug: 소문자 영숫자·하이픈 + '-' + userId (전역 유일). 한글 등 비ASCII만 있으면 'org-<id>' */
export function orgSlug(orgName: unknown, userId: number): string {
  const base = String(orgName ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `${base || 'org'}-${userId}`;
}

/** 가입 요청 옵션: 새 조직 생성 시 샘플 프로젝트 생성 여부(기본 true). 초대 합류 시에는 항상 false */
export function parseRegisterOptions(body: any): { createSample: boolean } {
  const joining = !!String(body?.inviteCode ?? '').trim();
  if (joining) return { createSample: false };
  const v = body?.createSample;
  if (v === false || v === 'false' || v === 0 || v === '0') return { createSample: false };
  return { createSample: true };
}

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => { const x = new Date(d.getTime()); x.setUTCDate(x.getUTCDate() + n); return x; };

/** 샘플 프로젝트 행 묶음. today 기준 상대 일정(과거 기록·미래 계획 섞임)으로 화면이 비어 보이지 않게 한다. */
export function sampleProjectRows(orgId: number, today: Date = new Date()) {
  const t0 = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const D = (n: number) => ymd(addDays(t0, n));
  const project = {
    orgId, code: SAMPLE_PROJECT_CODE, name: '샘플 프로젝트 — PRISM 둘러보기', client: '샘플 고객사',
    status: 'active' as const, startDate: D(-14), endDate: D(76),
  };
  const phases = [
    { code: 'PH-01', name: '착수', sortOrder: 0, status: 'done' },
    { code: 'PH-02', name: '분석/설계', sortOrder: 1, status: 'in_progress' },
    { code: 'PH-03', name: '구현', sortOrder: 2, status: 'planned' },
    { code: 'PH-04', name: '시험/이행', sortOrder: 3, status: 'planned' },
  ];
  const tasks = [
    { code: 'TSK-0001', name: '착수 보고서 작성', phase: '착수', status: 'done', progress: 100, startDate: D(-14), endDate: D(-10), plannedHours: 16, actualHours: 16 },
    { code: 'TSK-0002', name: '킥오프 회의', phase: '착수', status: 'done', progress: 100, startDate: D(-9), endDate: D(-9), plannedHours: 4, actualHours: 4 },
    { code: 'TSK-0003', name: '요구사항 정의서 작성', phase: '분석/설계', status: 'in_progress', progress: 60, startDate: D(-7), endDate: D(7), plannedHours: 40, actualHours: 24 },
    { code: 'TSK-0004', name: '화면 설계', phase: '분석/설계', status: 'todo', progress: 0, startDate: D(3), endDate: D(17), plannedHours: 40, actualHours: 0 },
    { code: 'TSK-0005', name: '핵심 기능 구현', phase: '구현', status: 'todo', progress: 0, startDate: D(18), endDate: D(52), plannedHours: 160, actualHours: 0 },
    { code: 'TSK-0006', name: '통합 테스트', phase: '시험/이행', status: 'todo', progress: 0, startDate: D(53), endDate: D(70), plannedHours: 60, actualHours: 0 },
  ];
  const requirements = [
    { code: 'REQ-0001', title: '사용자 로그인', category: '기능', priority: 'high', status: 'approved' },
    { code: 'REQ-0002', title: '진척 현황 대시보드', category: '기능', priority: 'medium', status: 'review' },
  ];
  const issues = [
    { code: 'ISS-0001', title: '요구사항 정의서 리뷰 일정 지연', type: 'task', priority: 'medium', status: 'open', dueDate: D(5) },
  ];
  const risks = [
    { code: 'RSK-0001', title: '핵심 인력 이탈', probability: 2, impact: 4, level: 'medium', status: 'identified', mitigation: '백업 인력 지정', dueDate: D(30) },
  ];
  return { project, phases, tasks, requirements, issues, risks };
}

/** 온보딩 체크리스트. 순서는 고정(계정 → 워크스페이스 → 프로젝트 → 팀원 초대) */
export function onboardingSteps(s: OnboardingState): OnboardingStep[] {
  return [
    { key: 'account', title: '계정 만들기', desc: '이메일과 비밀번호로 가입했습니다.', done: true, href: '/settings' },
    { key: 'workspace', title: '워크스페이스 만들기', desc: '조직(워크스페이스)에 소속되어 있습니다.', done: !!s.hasWorkspace, href: '/settings' },
    { key: 'project', title: '첫 프로젝트 만들기', desc: s.hasSampleProject ? '샘플 프로젝트로 화면을 둘러보세요.' : '샘플 프로젝트를 만들거나 직접 등록하세요.', done: s.projectCount > 0, href: '/projects' },
    { key: 'invite', title: '팀원 초대하기', desc: s.hasInviteCode ? '설정의 초대 코드를 팀원에게 전달하세요.' : '초대 코드를 발급해 팀원을 초대하세요.', done: s.memberCount > 1, href: '/settings' },
  ];
}

export function summarizeOnboarding(s: OnboardingState) {
  const steps = onboardingSteps(s);
  const doneCount = steps.filter((x) => x.done).length;
  const next = steps.find((x) => !x.done) ?? null;
  return { steps, doneCount, total: steps.length, completed: doneCount === steps.length, next, canCreateSample: s.hasWorkspace && !s.hasSampleProject };
}
