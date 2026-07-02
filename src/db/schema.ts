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
}, (t) => ({ userIdx: index('sessions_user_idx').on(t.userId) }));
export const organizations = pgTable('organizations', {
  id: serial('id').primaryKey(), slug: text('slug').notNull(), name: text('name').notNull(),
  plan: text('plan').default('free').notNull(),
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
  code: text('code'), name: text('name').notNull(), client: text('client'),
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
  priority: text('priority').default('medium').notNull(), status: text('status').default('draft').notNull(), assignee: text('assignee'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({ projIdx: index('req_project_idx').on(t.orgId, t.projectId) }));
export const issues = pgTable('issues', {
  id: serial('id').primaryKey(), orgId: integer('org_id').notNull(),
  projectId: integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  code: text('code'), reqCode: text('req_code'), title: text('title').notNull(), description: text('description'),
  type: text('type').default('bug').notNull(), priority: text('priority').default('medium').notNull(),
  status: text('status').default('open').notNull(), assignee: text('assignee'), dueDate: text('due_date'), labels: text('labels'),
  storyPoints: integer('story_points').default(0).notNull(), sprintId: integer('sprint_id'), epic: text('epic'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({ projIdx: index('issues_project_idx').on(t.orgId, t.projectId) }));
export const risks = pgTable('risks', {
  id: serial('id').primaryKey(), orgId: integer('org_id').notNull(),
  projectId: integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  code: text('code'), title: text('title').notNull(), description: text('description'),
  probability: integer('probability').default(3).notNull(), impact: integer('impact').default(3).notNull(),
  level: text('level').default('medium').notNull(), status: text('status').default('identified').notNull(), owner: text('owner'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({ projIdx: index('risks_project_idx').on(t.orgId, t.projectId) }));
export const tasks = pgTable('tasks', {
  id: serial('id').primaryKey(), orgId: integer('org_id').notNull(),
  projectId: integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  code: text('code'), reqCode: text('req_code'), predecessor: text('predecessor'), name: text('name').notNull(), phase: text('phase'), assignee: text('assignee'),
  status: text('status').default('todo').notNull(), startDate: text('start_date'), endDate: text('end_date'),
  progress: integer('progress').default(0).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({ projIdx: index('tasks_project_idx').on(t.orgId, t.projectId) }));
export const documents = pgTable('documents', {
  id: serial('id').primaryKey(), orgId: integer('org_id').notNull(),
  projectId: integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  code: text('code'), title: text('title').notNull(), type: text('type'), version: text('version').default('v1.0').notNull(),
  status: text('status').default('draft').notNull(), author: text('author'), approver: text('approver'),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({ projIdx: index('docs_project_idx').on(t.orgId, t.projectId) }));
export const meetings = pgTable('meetings', {
  id: serial('id').primaryKey(), orgId: integer('org_id').notNull(),
  projectId: integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  code: text('code'), title: text('title').notNull(), meetingDate: text('meeting_date'), location: text('location'),
  attendees: text('attendees'), agenda: text('agenda'), decisions: text('decisions'),
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
  protocol: text('protocol'), format: text('format'), cycle: text('cycle'), status: text('status').default('draft').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({ i: index('itf_proj_idx').on(t.orgId, t.projectId) }));
export const infraAssets = pgTable('infra_assets', {
  id: serial('id').primaryKey(), orgId: integer('org_id').notNull(),
  projectId: integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  code: text('code'), name: text('name').notNull(), category: text('category'), model: text('model'),
  location: text('location'), ipAddress: text('ip_address'), owner: text('owner'), status: text('status').default('active').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({ i: index('asset_proj_idx').on(t.orgId, t.projectId) }));
export const firewallRequests = pgTable('firewall_requests', {
  id: serial('id').primaryKey(), orgId: integer('org_id').notNull(),
  projectId: integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  code: text('code'), title: text('title').notNull(), srcIp: text('src_ip'), dstIp: text('dst_ip'),
  port: text('port'), protocol: text('protocol'), reason: text('reason'), status: text('status').default('requested').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({ i: index('fw_proj_idx').on(t.orgId, t.projectId) }));
export const procurementItems = pgTable('procurement_items', {
  id: serial('id').primaryKey(), orgId: integer('org_id').notNull(),
  projectId: integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  code: text('code'), item: text('item').notNull(), category: text('category'), qty: integer('qty').default(1).notNull(),
  unitPrice: integer('unit_price').default(0).notNull(), vendor: text('vendor'), status: text('status').default('requested').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({ i: index('proc_proj_idx').on(t.orgId, t.projectId) }));
export const boards = pgTable('boards', {
  id: serial('id').primaryKey(), orgId: integer('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  code: text('code'), title: text('title').notNull(), category: text('category'), author: text('author'), content: text('content'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({ i: index('board_org_idx').on(t.orgId) }));
