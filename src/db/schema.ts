import { pgTable, serial, integer, bigint, text, boolean, timestamp, uniqueIndex, index, primaryKey } from 'drizzle-orm/pg-core';
export const users = pgTable('users', {
  id: serial('id').primaryKey(), email: text('email').notNull(), name: text('name').notNull(),
  passwordHash: text('password_hash').notNull(), isActive: boolean('is_active').default(true).notNull(),
  isSuperadmin: boolean('is_superadmin').default(false).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({ emailIdx: uniqueIndex('users_email_idx').on(t.email) }));
export const sessions = pgTable('sessions', {
  token: text('token').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  activeOrgId: integer('active_org_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(), userAgent: text('user_agent'),
}, (t) => ({ userIdx: index('sessions_user_idx').on(t.userId), tokenIdx: index('sessions_token_idx').on(t.token) }));
export const organizations = pgTable('organizations', {
  id: serial('id').primaryKey(), slug: text('slug').notNull(), name: text('name').notNull(),
  plan: text('plan').default('free').notNull(), inviteCode: text('invite_code'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({ slugIdx: uniqueIndex('orgs_slug_idx').on(t.slug) }));
export const memberships = pgTable('memberships', {
  id: serial('id').primaryKey(),
  orgId: integer('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: text('role').notNull().default('member'), isOrgAdmin: boolean('is_org_admin').default(false).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({ uniq: uniqueIndex('memberships_org_user_idx').on(t.orgId, t.userId) }));
export const permissions = pgTable('permissions', {
  id: serial('id').primaryKey(), resource: text('resource').notNull(), action: text('action').notNull(), label: text('label'),
}, (t) => ({ uniq: uniqueIndex('perm_res_act_idx').on(t.resource, t.action) }));
export const rolePermissions = pgTable('role_permissions', {
  orgId: integer('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  role: text('role').notNull(),
  permissionId: integer('permission_id').notNull().references(() => permissions.id, { onDelete: 'cascade' }),
}, (t) => ({ pk: primaryKey({ columns: [t.orgId, t.role, t.permissionId] }) }));
export const counters = pgTable('counters', {
  orgId: integer('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  scope: text('scope').notNull(), value: integer('value').default(0).notNull(),
}, (t) => ({ pk: primaryKey({ columns: [t.orgId, t.scope] }) }));
export const auditLog = pgTable('audit_log', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  orgId: integer('org_id').notNull(), userId: integer('user_id'), event: text('event').notNull(),
  entity: text('entity'), entityId: text('entity_id'), detail: text('detail'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({ orgIdx: index('audit_org_idx').on(t.orgId, t.createdAt) }));
export const projects = pgTable('projects', {
  id: serial('id').primaryKey(),
  orgId: integer('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  code: text('code'), name: text('name').notNull(), client: text('client'), orderer: text('orderer'), contractNo: text('contract_no'), budget: integer('budget').default(0).notNull(),
  startDate: text('start_date'), endDate: text('end_date'), pmUserId: integer('pm_user_id'),
  status: text('status').default('active').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({ orgIdx: index('projects_org_idx').on(t.orgId), codeIdx: uniqueIndex('projects_org_code_idx').on(t.orgId, t.code) }));
export const phases = pgTable('phases', {
  id: serial('id').primaryKey(), orgId: integer('org_id').notNull(),
  projectId: integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  code: text('code'), name: text('name').notNull(), sortOrder: integer('sort_order').default(0).notNull(),
  color: text('color'), status: text('status').default('planned').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({ projIdx: index('phases_project_idx').on(t.projectId) }));
export const members = pgTable('members', {
  id: serial('id').primaryKey(),
  orgId: integer('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  code: text('code'), name: text('name').notNull(), company: text('company'), position: text('position'),
  role: text('role'), email: text('email'), phone: text('phone'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({ orgIdx: index('members_org_idx').on(t.orgId) }));
export const requirements = pgTable('requirements', {
  id: serial('id').primaryKey(), orgId: integer('org_id').notNull(),
  projectId: integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  code: text('code'), title: text('title').notNull(), description: text('description'), category: text('category'),
  priority: text('priority').default('medium').notNull(), status: text('status').default('draft').notNull(), assignee: text('assignee'), acceptanceCriteria: text('acceptance_criteria'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({ projIdx: index('req_project_idx').on(t.orgId, t.projectId) }));
export const issues = pgTable('issues', {
  id: serial('id').primaryKey(), orgId: integer('org_id').notNull(),
  projectId: integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  code: text('code'), reqCode: text('req_code'), cycle: text('cycle'), title: text('title').notNull(), description: text('description'),
  type: text('type').default('bug').notNull(), priority: text('priority').default('medium').notNull(),
  status: text('status').default('open').notNull(), assignee: text('assignee'), dueDate: text('due_date'), labels: text('labels'),
  storyPoints: integer('story_points').default(0).notNull(), sprintId: integer('sprint_id'), epic: text('epic'), related: text('related'),
  estimateHours: integer('estimate_hours').default(0).notNull(), spentHours: integer('spent_hours').default(0).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({ projIdx: index('issues_project_idx').on(t.orgId, t.projectId), asgIdx: index('issues_assignee_idx').on(t.orgId, t.assignee) }));
export const tests = pgTable('tests', {
  id: serial('id').primaryKey(), orgId: integer('org_id').notNull(),
  projectId: integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  code: text('code'), reqCode: text('req_code'), cycle: text('cycle'), title: text('title').notNull(),
  type: text('type').default('단위').notNull(), priority: text('priority').default('medium').notNull(),
  steps: text('steps'), expected: text('expected'), assignee: text('assignee'),
  status: text('status').default('draft').notNull(), result: text('result').default('na').notNull(),
  reporter: text('reporter'), dueDate: text('due_date'), progress: integer('progress').default(0).notNull(),
  executedAt: timestamp('executed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({ i: index('tests_project_idx').on(t.orgId, t.projectId) }));
export const risks = pgTable('risks', {
  id: serial('id').primaryKey(), orgId: integer('org_id').notNull(),
  projectId: integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  code: text('code'), title: text('title').notNull(), description: text('description'),
  probability: integer('probability').default(3).notNull(), impact: integer('impact').default(3).notNull(),
  level: text('level').default('medium').notNull(), status: text('status').default('identified').notNull(), owner: text('owner'), mitigation: text('mitigation'), contingency: text('contingency'), dueDate: text('due_date'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({ projIdx: index('risks_project_idx').on(t.orgId, t.projectId), ownIdx: index('risks_owner_idx').on(t.orgId, t.owner) }));
export const tasks = pgTable('tasks', {
  id: serial('id').primaryKey(), orgId: integer('org_id').notNull(),
  projectId: integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  code: text('code'), reqCode: text('req_code'), predecessor: text('predecessor'), parentId: integer('parent_id'), name: text('name').notNull(), phase: text('phase'), assignee: text('assignee'),
  status: text('status').default('todo').notNull(), startDate: text('start_date'), endDate: text('end_date'),
  progress: integer('progress').default(0).notNull(),
  plannedHours: integer('planned_hours').default(0).notNull(), actualHours: integer('actual_hours').default(0).notNull(),
  baselineStart: text('baseline_start'), baselineEnd: text('baseline_end'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({ projIdx: index('tasks_project_idx').on(t.orgId, t.projectId), asgIdx: index('tasks_assignee_idx').on(t.orgId, t.assignee) }));
export const documents = pgTable('documents', {
  id: serial('id').primaryKey(), orgId: integer('org_id').notNull(),
  projectId: integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  code: text('code'), title: text('title').notNull(), type: text('type'), version: text('version').default('v1.0').notNull(),
  status: text('status').default('draft').notNull(), author: text('author'), approver: text('approver'),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({ projIdx: index('docs_project_idx').on(t.orgId, t.projectId) }));
// 산출물 버전이력(형상관리)
export const documentVersions = pgTable('document_versions', {
  id: serial('id').primaryKey(), orgId: integer('org_id').notNull(),
  documentId: integer('document_id').notNull().references(() => documents.id, { onDelete: 'cascade' }),
  version: text('version'), status: text('status'), author: text('author'), note: text('note'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({ i: index('document_versions_idx').on(t.orgId, t.documentId) }));
// 커스텀 산출물 양식(form_definitions) — 프로젝트별 산출물 템플릿 정의
export const formDefinitions = pgTable('form_definitions', {
  id: serial('id').primaryKey(), orgId: integer('org_id').notNull(),
  projectId: integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  code: text('code'), name: text('name').notNull(), targetType: text('target_type'), fields: text('fields'), note: text('note'),
  status: text('status').default('draft').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({ i: index('form_definitions_project_idx').on(t.orgId, t.projectId) }));
export const meetings = pgTable('meetings', {
  id: serial('id').primaryKey(), orgId: integer('org_id').notNull(),
  projectId: integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  code: text('code'), title: text('title').notNull(), meetingDate: text('meeting_date'), location: text('location'),
  attendees: text('attendees'), agenda: text('agenda'), decisions: text('decisions'), actionItems: text('action_items'), nextDate: text('next_date'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({ projIdx: index('meetings_project_idx').on(t.orgId, t.projectId) }));
export const notifications = pgTable('notifications', {
  id: serial('id').primaryKey(), orgId: integer('org_id').notNull(), userId: integer('user_id').notNull(),
  message: text('message').notNull(), link: text('link'), isRead: boolean('is_read').default(false).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({ userIdx: index('notif_user_idx').on(t.userId) }));
export const comments = pgTable('comments', {
  id: serial('id').primaryKey(), orgId: integer('org_id').notNull(),
  entity: text('entity').notNull(), entityId: integer('entity_id').notNull(),
  userId: integer('user_id').notNull(), authorName: text('author_name').notNull(), body: text('body').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({ eIdx: index('comments_entity_idx').on(t.orgId, t.entity, t.entityId) }));
export const sprints = pgTable('sprints', {
  id: serial('id').primaryKey(), orgId: integer('org_id').notNull(),
  projectId: integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  code: text('code'), name: text('name').notNull(), goal: text('goal'),
  status: text('status').default('planned').notNull(), startDate: text('start_date'), endDate: text('end_date'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({ projIdx: index('sprints_project_idx').on(t.orgId, t.projectId) }));
export const interfaces = pgTable('interfaces', {
  id: serial('id').primaryKey(), orgId: integer('org_id').notNull(),
  projectId: integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  code: text('code'), name: text('name').notNull(), srcSystem: text('src_system'), dstSystem: text('dst_system'),
  protocol: text('protocol'), format: text('format'), cycle: text('cycle'), owner: text('owner'), spec: text('spec'), testStatus: text('test_status'), status: text('status').default('draft').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({ i: index('itf_proj_idx').on(t.orgId, t.projectId) }));
export const infraAssets = pgTable('infra_assets', {
  id: serial('id').primaryKey(), orgId: integer('org_id').notNull(),
  projectId: integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  code: text('code'), name: text('name').notNull(), category: text('category'), model: text('model'),
  location: text('location'), ipAddress: text('ip_address'), owner: text('owner'), hostname: text('hostname'), os: text('os'), cpu: text('cpu'), memory: text('memory'), rack: text('rack'), serialNo: text('serial_no'), status: text('status').default('active').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({ i: index('asset_proj_idx').on(t.orgId, t.projectId) }));
export const firewallRequests = pgTable('firewall_requests', {
  id: serial('id').primaryKey(), orgId: integer('org_id').notNull(),
  projectId: integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  code: text('code'), title: text('title').notNull(), srcIp: text('src_ip'), dstIp: text('dst_ip'),
  port: text('port'), protocol: text('protocol'), reason: text('reason'), approver: text('approver'), expireDate: text('expire_date'), status: text('status').default('requested').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({ i: index('fw_proj_idx').on(t.orgId, t.projectId) }));
export const procurementItems = pgTable('procurement_items', {
  id: serial('id').primaryKey(), orgId: integer('org_id').notNull(),
  projectId: integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  code: text('code'), item: text('item').notNull(), category: text('category'), qty: integer('qty').default(1).notNull(),
  unitPrice: integer('unit_price').default(0).notNull(), vendor: text('vendor'), poNumber: text('po_number'), deliveryDate: text('delivery_date'), receiptDate: text('receipt_date'), status: text('status').default('requested').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({ i: index('proc_proj_idx').on(t.orgId, t.projectId) }));
export const boards = pgTable('boards', {
  id: serial('id').primaryKey(), orgId: integer('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  code: text('code'), title: text('title').notNull(), category: text('category'), author: text('author'), content: text('content'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({ i: index('board_org_idx').on(t.orgId) }));
// 테스트 차수(Cycle) — 회차별 테스트 묶음
export const testCycles = pgTable('test_cycles', {
  id: serial('id').primaryKey(), orgId: integer('org_id').notNull(),
  projectId: integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  code: text('code'), name: text('name').notNull(), goal: text('goal'),
  status: text('status').default('planned').notNull(), startDate: text('start_date'), endDate: text('end_date'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({ i: index('test_cycles_project_idx').on(t.orgId, t.projectId) }));
// 개인 To-Do — 사용자별 할 일(본인만 조회)
export const todos = pgTable('todos', {
  id: serial('id').primaryKey(), orgId: integer('org_id').notNull(), userId: integer('user_id').notNull(),
  code: text('code'), title: text('title').notNull(), note: text('note'),
  priority: text('priority').default('medium').notNull(), status: text('status').default('todo').notNull(), dueDate: text('due_date'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({ i: index('todos_user_idx').on(t.orgId, t.userId) }));
// 기성고·진척 스냅샷
export const snapshots = pgTable('snapshots', {
  id: serial('id').primaryKey(), orgId: integer('org_id').notNull(),
  projectId: integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  code: text('code'), label: text('label').notNull(), snapshotDate: text('snapshot_date'),
  plannedPct: integer('planned_pct').default(0).notNull(), actualPct: integer('actual_pct').default(0).notNull(), billingPct: integer('billing_pct').default(0).notNull(),
  note: text('note'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({ i: index('snapshots_project_idx').on(t.orgId, t.projectId) }));

// 이슈 이력(journal) — 변경 추적(누가 언제 무엇을)
export const issueJournals = pgTable('issue_journals', {
  id: serial('id').primaryKey(), orgId: integer('org_id').notNull(),
  issueId: integer('issue_id').notNull().references(() => issues.id, { onDelete: 'cascade' }),
  userId: integer('user_id').notNull(), authorName: text('author_name').notNull(),
  changes: text('changes'), note: text('note'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({ i: index('issue_journals_idx').on(t.orgId, t.issueId) }));
// 이슈 워처 — 관심 등록자
export const issueWatchers = pgTable('issue_watchers', {
  id: serial('id').primaryKey(), orgId: integer('org_id').notNull(),
  issueId: integer('issue_id').notNull().references(() => issues.id, { onDelete: 'cascade' }),
  userId: integer('user_id').notNull(), userName: text('user_name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({ i: index('issue_watchers_idx').on(t.orgId, t.issueId), u: uniqueIndex('issue_watchers_uniq').on(t.orgId, t.issueId, t.userId) }));

// ── 2026-10-07 배치181(주간 수동) 신규 4종 — DDL 은 lib/migrate.ts MIGRATION_DDL(멱등, 부팅 자동) 에 같은 컬럼으로 선언 ──
// 비밀번호 재설정 토큰 — 원문은 저장하지 않고 sha256 해시만. 사용자 스코프(org 없음) → tenantScan GLOBAL_TABLES 에 등재
export const passwordResetTokens = pgTable('password_reset_tokens', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull(), expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({ h: uniqueIndex('password_reset_tokens_hash_idx').on(t.tokenHash), u: index('password_reset_tokens_user_idx').on(t.userId) }));
// 첨부(메타데이터) — 산출물·이슈. STORAGE_PROVIDER 미설정이면 본문 없이 파일명·크기·형식·만료일만(status=metadata_only)
export const attachments = pgTable('attachments', {
  id: serial('id').primaryKey(), orgId: integer('org_id').notNull(),
  entity: text('entity').notNull(), entityId: integer('entity_id').notNull(),
  filename: text('filename').notNull(), size: integer('size').default(0).notNull(), mime: text('mime'),
  provider: text('provider').default('none').notNull(), storageKey: text('storage_key'), status: text('status').default('metadata_only').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  uploadedBy: integer('uploaded_by').notNull(), uploaderName: text('uploader_name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({ i: index('attachments_entity_idx').on(t.orgId, t.entity, t.entityId) }));
// 이슈 관계(차단함·연관·중복) — blocks 만 방향 있음(src 가 dst 를 차단)
export const issueLinks = pgTable('issue_links', {
  id: serial('id').primaryKey(), orgId: integer('org_id').notNull(),
  srcIssueId: integer('src_issue_id').notNull().references(() => issues.id, { onDelete: 'cascade' }),
  dstIssueId: integer('dst_issue_id').notNull().references(() => issues.id, { onDelete: 'cascade' }),
  kind: text('kind').default('relates').notNull(), createdBy: integer('created_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({ s: index('issue_links_src_idx').on(t.orgId, t.srcIssueId), d: index('issue_links_dst_idx').on(t.orgId, t.dstIssueId) }));
// 커스텀 양식 입력 — form_definitions.fields 정의대로 검증된 값(JSON). document_id 는 선택(산출물에 매인 입력)
export const formEntries = pgTable('form_entries', {
  id: serial('id').primaryKey(), orgId: integer('org_id').notNull(),
  projectId: integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  formDefinitionId: integer('form_definition_id').notNull().references(() => formDefinitions.id, { onDelete: 'cascade' }),
  documentId: integer('document_id'), data: text('data'),
  createdBy: integer('created_by').notNull(), authorName: text('author_name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({ i: index('form_entries_def_idx').on(t.orgId, t.formDefinitionId) }));
