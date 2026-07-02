import { db } from '@/db';
import { projects, phases, members, requirements, issues, risks, tasks, documents, meetings, sprints, interfaces, infraAssets, firewallRequests, procurementItems, boards, tests, notifications } from '@/db/schema';
import { eq, and } from 'drizzle-orm';

// Populates an org with rich demo data. Idempotent per (project, table): fills only empty combos.
export async function seedDemo(O: number, userId: number) {
  const seedOrg = async (tbl: any, rows: any[]) => { const ex = (await db.select().from(tbl).where(eq(tbl.orgId, O)).limit(1))[0]; if (!ex && rows.length) await db.insert(tbl).values(rows); };
  const seedPT = async (tbl: any, pid: number, rows: any[]) => { const ex = (await db.select().from(tbl).where(and(eq(tbl.orgId, O), eq(tbl.projectId, pid))).limit(1))[0]; if (!ex && rows.length) await db.insert(tbl).values(rows); };

  // ensure the two demo projects exist
  const ensureProject = async (code: string, name: string, client: string, sd: string, ed: string) => {
    let pr = (await db.select().from(projects).where(and(eq(projects.orgId, O), eq(projects.code, code))).limit(1))[0];
    if (!pr) [pr] = await db.insert(projects).values({ orgId: O, code, name, client, status: 'active', startDate: sd, endDate: ed }).returning();
    return pr;
  };
  await ensureProject('PRJ-0001', '차세대 시스템 구축', '데모 고객사', '2026-03-01', '2026-12-31');
  await ensureProject('PRJ-0002', '데이터 플랫폼 고도화', 'B금융', '2026-05-01', '2026-11-30');

  // org-scoped
  await seedOrg(members, [
    { orgId: O, code: 'MEM-0001', name: '홍길동', company: 'GOWON', position: 'PM', role: 'PM', email: 'hong@gowon.co.kr', phone: '010-1000-0001' },
    { orgId: O, code: 'MEM-0002', name: '김개발', company: 'GOWON', position: '개발PL', role: '개발PL', email: 'kim@gowon.co.kr', phone: '010-1000-0002' },
    { orgId: O, code: 'MEM-0003', name: '이엔지', company: 'GOWON', position: '엔지니어', role: '개발자', email: 'lee@gowon.co.kr', phone: '010-1000-0003' },
    { orgId: O, code: 'MEM-0004', name: '박DBA', company: 'GOWON', position: 'DBA', role: 'DBA', email: 'park@gowon.co.kr', phone: '010-1000-0004' },
    { orgId: O, code: 'MEM-0005', name: '최QA', company: 'GOWON', position: 'QA', role: 'QA', email: 'choi@gowon.co.kr', phone: '010-1000-0005' },
  ]);
  await seedOrg(boards, [
    { orgId: O, code: 'BRD-0001', title: '[공지] 킥오프 일정 안내', category: '공지', author: '홍길동', content: '착수 회의 진행 예정입니다.' },
    { orgId: O, code: 'BRD-0002', title: '개발 환경 세팅 가이드', category: '자료', author: '김개발', content: 'Node 22 + Postgres 로 세팅하세요.' },
    { orgId: O, code: 'BRD-0003', title: 'DB 접속이 안 됩니다', category: 'Q&A', author: '이엔지', content: '방화벽 오픈 신청 확인 부탁드립니다.' },
  ]);
  await seedOrg(notifications, [
    { orgId: O, userId, message: 'ISS-0003(권한 체크 누락)이 긴급으로 등록되었습니다', link: '/issues' },
    { orgId: O, userId, message: 'Sprint 1 이 시작되었습니다', link: '/backlog', isRead: true },
  ]);

  // per-project child data (fills every project that lacks it)
  const allProjects = await db.select().from(projects).where(eq(projects.orgId, O));
  for (const pr of allProjects) {
    const pid = pr.id;
    let sp = (await db.select().from(sprints).where(and(eq(sprints.orgId, O), eq(sprints.projectId, pid))).limit(1))[0];
    if (!sp) {
      [sp] = await db.insert(sprints).values({ orgId: O, projectId: pid, code: 'SPR-0001', name: 'Sprint 1', goal: '핵심 기능', status: 'active', startDate: '2026-06-01', endDate: '2026-06-14' }).returning();
      await db.insert(sprints).values({ orgId: O, projectId: pid, code: 'SPR-0002', name: 'Sprint 2', goal: '리포트·연동', status: 'planned', startDate: '2026-06-15', endDate: '2026-06-28' });
    }
    const S = sp.id;
    const b = (o: any) => ({ orgId: O, projectId: pid, ...o });
    await seedPT(phases, pid, [
      b({ code: 'PH-01', name: '착수', sortOrder: 0, status: 'done' }),
      b({ code: 'PH-02', name: '분석/설계', sortOrder: 1, status: 'in_progress' }),
      b({ code: 'PH-03', name: '구현', sortOrder: 2, status: 'planned' }),
      b({ code: 'PH-04', name: '시험/이행', sortOrder: 3, status: 'planned' }),
    ]);
    await seedPT(requirements, pid, [
      b({ code: 'REQ-0001', title: '로그인 SSO 연동', category: '보안', priority: 'high', status: 'approved', assignee: '김개발' }),
      b({ code: 'REQ-0002', title: '대시보드 통계', category: '기능', priority: 'medium', status: 'review', assignee: '이엔지' }),
      b({ code: 'REQ-0003', title: '권한 관리(RBAC)', category: '보안', priority: 'high', status: 'approved', assignee: '홍길동' }),
      b({ code: 'REQ-0004', title: '엑셀 내보내기', category: '기능', priority: 'low', status: 'draft', assignee: '최QA' }),
    ]);
    await seedPT(issues, pid, [
      b({ code: 'ISS-0001', title: '목록 정렬 오류', type: 'bug', priority: 'medium', status: 'open', assignee: '김개발', dueDate: '2026-06-20', storyPoints: 3, sprintId: S, epic: '품질', labels: '버그,정렬' }),
      b({ code: 'ISS-0002', title: '리포트 속도 개선', type: 'improvement', priority: 'high', status: 'in_progress', assignee: '이엔지', dueDate: '2026-06-25', storyPoints: 5, sprintId: S, epic: '성능' }),
      b({ code: 'ISS-0003', title: '권한 체크 누락', type: 'bug', priority: 'critical', status: 'open', assignee: '홍길동', dueDate: '2026-06-18', storyPoints: 8, sprintId: S, epic: '보안', labels: '보안' }),
      b({ code: 'ISS-0004', title: '모바일 레이아웃', type: 'task', priority: 'medium', status: 'resolved', assignee: '이엔지', storyPoints: 3, epic: 'UX' }),
      b({ code: 'ISS-0005', title: '알림 이메일 발송', type: 'task', priority: 'low', status: 'open', assignee: '박DBA', storyPoints: 2, epic: '기능' }),
    ]);
    await seedPT(risks, pid, [
      b({ code: 'RSK-0001', title: '일정 지연 위험', probability: 4, impact: 4, level: 'high', status: 'identified', owner: '홍길동' }),
      b({ code: 'RSK-0002', title: '인력 이탈', probability: 2, impact: 4, level: 'medium', status: 'mitigating', owner: '홍길동' }),
      b({ code: 'RSK-0003', title: '외부 연동 불안정', probability: 3, impact: 5, level: 'high', status: 'identified', owner: '이엔지' }),
      b({ code: 'RSK-0004', title: '요구사항 변경', probability: 3, impact: 2, level: 'medium', status: 'mitigating', owner: '홍길동' }),
    ]);
    await seedPT(tasks, pid, [
      b({ code: 'WBS-01', name: '요구사항 정의서 작성', phase: '분석/설계', assignee: '김개발', status: 'done', progress: 100, startDate: '2026-03-05', endDate: '2026-03-20' }),
      b({ code: 'WBS-02', name: '아키텍처 설계', phase: '분석/설계', assignee: '이엔지', status: 'doing', progress: 60, startDate: '2026-03-21', endDate: '2026-04-15' }),
      b({ code: 'WBS-03', name: 'DB 스키마 설계', phase: '구현', assignee: '박DBA', status: 'todo', progress: 0, startDate: '2026-04-16', endDate: '2026-05-10', predecessor: 'WBS-02' }),
      b({ code: 'WBS-04', name: '핵심 모듈 개발', phase: '구현', assignee: '김개발', status: 'todo', progress: 0, startDate: '2026-05-11', endDate: '2026-07-30', predecessor: 'WBS-03' }),
      b({ code: 'WBS-05', name: '통합 테스트', phase: '시험/이행', assignee: '최QA', status: 'todo', progress: 0, startDate: '2026-08-01', endDate: '2026-09-15', predecessor: 'WBS-04' }),
    ]);
    await seedPT(documents, pid, [
      b({ code: 'DOC-0001', title: '요구사항 정의서', type: '요구사항정의서', version: 'v1.0', status: 'approved', author: '김개발', approver: '홍길동' }),
      b({ code: 'DOC-0002', title: '아키텍처 설계서', type: '기본설계서', version: 'v0.9', status: 'review', author: '이엔지', approver: '홍길동' }),
      b({ code: 'DOC-0003', title: '테스트 계획서', type: '테스트계획서', version: 'v0.5', status: 'draft', author: '최QA', approver: '홍길동' }),
    ]);
    await seedPT(tests, pid, [
      b({ code: 'TC-0001', reqCode: 'REQ-0001', title: '로그인 인증 정상 흐름', type: '단위', priority: 'high', steps: '1) 로그인 화면 진입\n2) 유효 계정 입력\n3) 로그인 클릭', expected: '대시보드로 이동', assignee: '이엔지', status: 'done', result: 'pass' }),
      b({ code: 'TC-0002', reqCode: 'REQ-0001', title: '로그인 실패 처리', type: '단위', priority: 'medium', steps: '잘못된 비밀번호 입력', expected: '오류 메시지 표시', assignee: '이엔지', status: 'pl', result: 'pass' }),
      b({ code: 'TC-0003', reqCode: 'REQ-0002', title: '대시보드 집계 정확성', type: '통합', priority: 'high', steps: '데이터 입력 후 대시보드 확인', expected: '카드 수치 일치', assignee: '김개발', status: 'dev', result: 'na' }),
      b({ code: 'TC-0004', reqCode: 'REQ-0002', title: '리포트 PDF 출력', type: '시스템', priority: 'medium', steps: '리포트 > 인쇄/PDF', expected: 'PDF 정상 생성', assignee: '홍길동', status: 'draft', result: 'na' }),
      b({ code: 'TC-0005', reqCode: 'REQ-0003', title: '권한별 접근 제어', type: '보안', priority: 'high', steps: 'read 권한으로 쓰기 시도', expected: '403 차단', assignee: '이엔지', status: 'pm', result: 'fail' }),
    ]);
    await seedPT(meetings, pid, [
      b({ code: 'MTG-0001', title: '착수 회의', meetingDate: '2026-03-05', location: '본사 3층', attendees: '홍길동, 김개발, 이엔지', agenda: '범위·일정 확정', decisions: '4단계 일정 승인' }),
      b({ code: 'MTG-0002', title: '설계 리뷰', meetingDate: '2026-04-10', location: '온라인', attendees: '전체', agenda: '아키텍처 검토', decisions: 'MSA 채택' }),
    ]);
    await seedPT(interfaces, pid, [
      b({ code: 'IF-0001', name: '회원정보 연동', srcSystem: '차세대', dstSystem: 'CRM', protocol: 'REST', format: 'JSON', cycle: '실시간', status: 'approved' }),
      b({ code: 'IF-0002', name: '정산 배치', srcSystem: '차세대', dstSystem: '회계', protocol: 'FTP', format: 'CSV', cycle: '배치(일)', status: 'review' }),
    ]);
    await seedPT(infraAssets, pid, [
      b({ code: 'AST-0001', name: 'WEB-01', category: '서버', model: 'HP DL380', location: 'IDC-A / Rack1', ipAddress: '10.0.1.11', owner: '이엔지', status: 'active' }),
      b({ code: 'AST-0002', name: 'DB-01', category: 'DB', model: 'Oracle Exadata', location: 'IDC-A / Rack2', ipAddress: '10.0.1.21', owner: '박DBA', status: 'active' }),
      b({ code: 'AST-0003', name: 'FW-01', category: '보안', model: 'Fortigate', location: 'IDC-A / Rack1', ipAddress: '10.0.1.1', owner: '홍길동', status: 'active' }),
    ]);
    await seedPT(firewallRequests, pid, [
      b({ code: 'FW-0001', title: 'WEB→DB 오픈', srcIp: '10.0.1.11', dstIp: '10.0.1.21', port: '1521', protocol: 'TCP', reason: 'DB 접속', status: 'approved' }),
      b({ code: 'FW-0002', title: '외부 API 오픈', srcIp: '10.0.1.11', dstIp: '203.0.113.5', port: '443', protocol: 'TCP', reason: '결제 연동', status: 'requested' }),
    ]);
    await seedPT(procurementItems, pid, [
      b({ code: 'PO-0001', item: 'WAS 라이선스', category: '라이선스', qty: 4, unitPrice: 5000000, vendor: 'Redhat', status: 'ordered' }),
      b({ code: 'PO-0002', item: '스위치', category: '네트워크', qty: 2, unitPrice: 3200000, vendor: 'Cisco', status: 'received' }),
    ]);
  }
}
