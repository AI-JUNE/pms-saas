// 대시보드 「조치 필요」 — 순수 모듈(DB·next 의존 없음). 2026-10-26 PMS 개편 P0-1.
//
// 이미 가져온 목록(업무·문서·요구사항·이슈·리스크·시험)만 보고 지금 손봐야 할 것을 묶는다.
// DB 변경 없음 — 대시보드 API 가 내려주는 행을 그대로 받는다.
//   delayed      : 종료일이 오늘보다 앞인데 완료되지 않은 업무
//   approval     : 검토(결재) 대기 문서·요구사항
//   risk         : 닫히지 않은 높은 리스크(등급 high·critical 또는 발생×영향 ≥ 15)
//   bug          : 해결되지 않은 긴급·높음 결함
//   untested     : 승인된 요구사항인데 연결된 시험이 하나도 없음
//   failedTest   : 결과가 실패·차단인 시험
//   change       : 처리 중인 변경요청(이슈 유형 change)
// 각 묶음은 건수와 앞쪽 몇 건(기본 5)만 돌려준다 — 화면은 링크로 목록 화면에 넘긴다.

export const ACTION_KINDS = ['delayed', 'approval', 'risk', 'bug', 'untested', 'failedTest', 'change'] as const;
export type ActionKind = (typeof ACTION_KINDS)[number];

export const ACTION_META: Record<ActionKind, { label: string; hint: string; href: string; tone: 'crit' | 'warn' | 'info' }> = {
  delayed: { label: '지연 업무', hint: '종료일이 지났는데 끝나지 않은 업무', href: '/tasks', tone: 'crit' },
  approval: { label: '결재 대기', hint: '검토 단계에 머문 문서·요구사항', href: '/documents', tone: 'warn' },
  risk: { label: '높은 리스크', hint: '닫히지 않은 높음 등급(발생×영향 15 이상 포함)', href: '/risks', tone: 'crit' },
  bug: { label: '긴급·높음 결함', hint: '해결되지 않은 긴급·높음 우선순위 결함', href: '/issues', tone: 'crit' },
  untested: { label: '시험 없는 요구사항', hint: '승인됐지만 연결된 시험이 없는 요구사항', href: '/requirements', tone: 'warn' },
  failedTest: { label: '실패·차단 시험', hint: '결과가 실패 또는 차단인 시험', href: '/tests', tone: 'warn' },
  change: { label: '변경요청 처리 중', hint: '아직 닫히지 않은 변경요청', href: '/issues', tone: 'info' },
};

export type ActionItem = { id: number | string; code: string | null; title: string; sub?: string };
export type ActionGroup = { kind: ActionKind; count: number; items: ActionItem[] };

type Row = Record<string, any>;
export type ActionInput = {
  tasks?: Row[]; documents?: Row[]; requirements?: Row[]; issues?: Row[]; risks?: Row[]; tests?: Row[];
};

const s = (v: unknown) => (v == null ? '' : String(v).trim());
const arr = (v: unknown): Row[] => (Array.isArray(v) ? v.filter((x) => x && typeof x === 'object') : []);
const CLOSED_ISSUE = new Set(['resolved', 'closed']);

/** 'YYYY-MM-DD' 로 맞춘다. 날짜가 아니면 ''. */
export function ymd(v: unknown): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s(v));
  return m ? `${m[1]}-${m[2]}-${m[3]}` : '';
}

/** 로컬 날짜 기준 오늘(YYYY-MM-DD). */
export function todayYmd(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

/** 두 날짜 사이 일수(b - a). 하나라도 날짜가 아니면 0. */
export function daysBetween(a: string, b: string): number {
  if (!a || !b) return 0;
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
}

export function isDelayed(t: Row, today: string): boolean {
  const end = ymd(t?.endDate);
  if (!end || end >= today) return false;
  return s(t?.status) !== 'done' && Number(t?.progress || 0) < 100;
}

export function isHighRisk(r: Row): boolean {
  if (s(r?.status) === 'closed') return false;
  const lv = s(r?.level);
  return lv === 'high' || lv === 'critical' || Number(r?.probability || 0) * Number(r?.impact || 0) >= 15;
}

export function isUrgentBug(i: Row): boolean {
  if (CLOSED_ISSUE.has(s(i?.status))) return false;
  if ((s(i?.type) || 'bug') !== 'bug') return false;
  return s(i?.priority) === 'critical' || s(i?.priority) === 'high';
}

function pack(kind: ActionKind, rows: ActionItem[], limit: number): ActionGroup {
  return { kind, count: rows.length, items: rows.slice(0, limit) };
}

/** 조치 필요 묶음. 건수가 0 인 묶음도 순서대로 모두 돌려준다(화면이 숨길지 정한다). */
export function actionNeeded(input: ActionInput, opts: { today?: string; limit?: number } = {}): ActionGroup[] {
  const today = opts.today || todayYmd();
  const limit = Math.max(1, Math.min(50, Math.floor(opts.limit ?? 5)));
  const tasks = arr(input.tasks), docs = arr(input.documents), reqs = arr(input.requirements);
  const issues = arr(input.issues), risks = arr(input.risks), tests = arr(input.tests);

  const delayed = tasks.filter((t) => isDelayed(t, today))
    .map((t) => ({ row: t, late: daysBetween(ymd(t.endDate), today) }))
    .sort((a, b) => b.late - a.late)
    .map(({ row, late }) => ({ id: row.id, code: s(row.code) || null, title: s(row.name), sub: `${late}일 지연${s(row.assignee) ? ' · ' + s(row.assignee) : ''}` }));

  const approval = [
    ...docs.filter((d) => s(d.status) === 'review').map((d) => ({ id: 'd' + d.id, code: s(d.code) || null, title: s(d.title || d.name), sub: '문서' + (s(d.approver) ? ' · 결재자 ' + s(d.approver) : '') })),
    ...reqs.filter((r) => s(r.status) === 'review').map((r) => ({ id: 'r' + r.id, code: s(r.code) || null, title: s(r.title), sub: '요구사항' })),
  ];

  const risk = risks.filter(isHighRisk)
    .sort((a, b) => Number(b.probability || 0) * Number(b.impact || 0) - Number(a.probability || 0) * Number(a.impact || 0))
    .map((r) => ({ id: r.id, code: s(r.code) || null, title: s(r.title), sub: `발생 ${Number(r.probability || 0)} × 영향 ${Number(r.impact || 0)}` }));

  const PRI: Record<string, number> = { critical: 0, high: 1 };
  const bug = issues.filter(isUrgentBug)
    .sort((a, b) => (PRI[s(a.priority)] ?? 9) - (PRI[s(b.priority)] ?? 9))
    .map((i) => ({ id: i.id, code: s(i.code) || null, title: s(i.title), sub: s(i.priority) === 'critical' ? '긴급' : '높음' }));

  const tested = new Set(tests.map((t) => s(t.reqCode)).filter(Boolean));
  const untested = reqs.filter((r) => s(r.status) === 'approved' && s(r.code) && !tested.has(s(r.code)))
    .map((r) => ({ id: r.id, code: s(r.code), title: s(r.title) }));

  const failedTest = tests.filter((t) => s(t.result) === 'fail' || s(t.result) === 'blocked')
    .map((t) => ({ id: t.id, code: s(t.code) || null, title: s(t.title), sub: s(t.result) === 'fail' ? '실패' : '차단' }));

  const change = issues.filter((i) => s(i.type) === 'change' && !CLOSED_ISSUE.has(s(i.status)))
    .map((i) => ({ id: i.id, code: s(i.code) || null, title: s(i.title) }));

  const by: Record<ActionKind, ActionItem[]> = { delayed, approval, risk, bug, untested, failedTest, change };
  return ACTION_KINDS.map((k) => pack(k, by[k], limit));
}

/** 전체 조치 건수. */
export function actionTotal(groups: ActionGroup[]): number {
  return groups.reduce((n, g) => n + g.count, 0);
}
