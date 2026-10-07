import { db, schema } from '@/db';
import { sql as dsql, getTableName, is } from 'drizzle-orm';
import { PgTable } from 'drizzle-orm/pg-core';
import {
  PRESENT_TABLES_SQL,
  createdTables,
  migrationLogLine,
  migrationReport,
  rowsOf,
  tableNamesFrom,
  verifySchema,
  type MigrationReport,
} from '@/lib/schemaVerify';

// 멱등 스키마 자가정합 DDL. 반복 실행 안전(모두 IF EXISTS/IF NOT EXISTS).
export const MIGRATION_DDL: string[] = [
  // 구독 결제(빌링) — 멱등, 실결제와 무관하게 스키마만 준비
  `CREATE TABLE IF NOT EXISTS billing_customers (id serial PRIMARY KEY, org_id integer NOT NULL, pg_customer_key text, created_at timestamptz DEFAULT now() NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS billing_methods (id serial PRIMARY KEY, org_id integer NOT NULL, billing_key text, card_brand text, last4 text, status text DEFAULT 'active' NOT NULL, created_at timestamptz DEFAULT now() NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS subscriptions (id serial PRIMARY KEY, org_id integer NOT NULL, plan text DEFAULT 'basic' NOT NULL, seats integer DEFAULT 1 NOT NULL, status text DEFAULT 'inactive' NOT NULL, current_period_start timestamptz, current_period_end timestamptz, cancel_at_period_end boolean DEFAULT false NOT NULL, created_at timestamptz DEFAULT now() NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS invoices (id serial PRIMARY KEY, org_id integer NOT NULL, subscription_id integer, amount integer DEFAULT 0 NOT NULL, tax integer DEFAULT 0 NOT NULL, status text DEFAULT 'draft' NOT NULL, pg_tx_id text, issued_at timestamptz DEFAULT now() NOT NULL, paid_at timestamptz)`,
  `CREATE TABLE IF NOT EXISTS billing_events (id serial PRIMARY KEY, org_id integer NOT NULL, type text NOT NULL, payload text, actor text, created_at timestamptz DEFAULT now() NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS subscriptions_org_idx ON subscriptions (org_id)`,
  `CREATE INDEX IF NOT EXISTS invoices_org_idx ON invoices (org_id)`,
  `CREATE TABLE IF NOT EXISTS tests (id serial PRIMARY KEY, org_id integer NOT NULL, project_id integer NOT NULL REFERENCES projects(id) ON DELETE CASCADE, code text, req_code text, title text NOT NULL, type text DEFAULT '단위' NOT NULL, priority text DEFAULT 'medium' NOT NULL, steps text, expected text, assignee text, status text DEFAULT 'draft' NOT NULL, result text DEFAULT 'na' NOT NULL, executed_at timestamptz, created_at timestamptz DEFAULT now() NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS tests_project_idx ON tests (org_id, project_id)`,
  // issues (agile fields added after initial release)
  `ALTER TABLE IF EXISTS issues ADD COLUMN IF NOT EXISTS type text DEFAULT 'bug' NOT NULL`,
  `ALTER TABLE IF EXISTS issues ADD COLUMN IF NOT EXISTS priority text DEFAULT 'medium' NOT NULL`,
  `ALTER TABLE IF EXISTS issues ADD COLUMN IF NOT EXISTS status text DEFAULT 'open' NOT NULL`,
  `ALTER TABLE IF EXISTS issues ADD COLUMN IF NOT EXISTS assignee text`,
  `ALTER TABLE IF EXISTS issues ADD COLUMN IF NOT EXISTS due_date text`,
  `ALTER TABLE IF EXISTS issues ADD COLUMN IF NOT EXISTS labels text`,
  `ALTER TABLE IF EXISTS issues ADD COLUMN IF NOT EXISTS story_points integer DEFAULT 0 NOT NULL`,
  `ALTER TABLE IF EXISTS issues ADD COLUMN IF NOT EXISTS sprint_id integer`,
  `ALTER TABLE IF EXISTS issues ADD COLUMN IF NOT EXISTS epic text`,
  `ALTER TABLE IF EXISTS issues ADD COLUMN IF NOT EXISTS description text`,
  `ALTER TABLE IF EXISTS issues ADD COLUMN IF NOT EXISTS code text`,
  // tasks / risks / procurement numeric safety (in case older DB)
  `ALTER TABLE IF EXISTS tasks ADD COLUMN IF NOT EXISTS progress integer DEFAULT 0 NOT NULL`,
  `ALTER TABLE IF EXISTS risks ADD COLUMN IF NOT EXISTS probability integer DEFAULT 3 NOT NULL`,
  `ALTER TABLE IF EXISTS risks ADD COLUMN IF NOT EXISTS impact integer DEFAULT 3 NOT NULL`,
  `ALTER TABLE IF EXISTS risks ADD COLUMN IF NOT EXISTS level text DEFAULT 'medium' NOT NULL`,
  `ALTER TABLE IF EXISTS procurement_items ADD COLUMN IF NOT EXISTS qty integer DEFAULT 1 NOT NULL`,
  `ALTER TABLE IF EXISTS procurement_items ADD COLUMN IF NOT EXISTS unit_price integer DEFAULT 0 NOT NULL`,
  `ALTER TABLE IF EXISTS tasks ADD COLUMN IF NOT EXISTS req_code text`,
  `ALTER TABLE IF EXISTS issues ADD COLUMN IF NOT EXISTS req_code text`,
  `ALTER TABLE IF EXISTS tasks ADD COLUMN IF NOT EXISTS predecessor text`,
  `ALTER TABLE IF EXISTS tasks ADD COLUMN IF NOT EXISTS parent_id integer`,
  `ALTER TABLE IF EXISTS tasks ADD COLUMN IF NOT EXISTS planned_hours integer DEFAULT 0 NOT NULL`,
  `ALTER TABLE IF EXISTS tasks ADD COLUMN IF NOT EXISTS actual_hours integer DEFAULT 0 NOT NULL`,
  `ALTER TABLE IF EXISTS tasks ADD COLUMN IF NOT EXISTS baseline_start text`,
  `ALTER TABLE IF EXISTS tasks ADD COLUMN IF NOT EXISTS baseline_end text`,
  `ALTER TABLE IF EXISTS documents ADD COLUMN IF NOT EXISTS approved_at timestamptz`,
  `ALTER TABLE IF EXISTS tests ADD COLUMN IF NOT EXISTS reporter text`,
  `ALTER TABLE IF EXISTS tests ADD COLUMN IF NOT EXISTS due_date text`,
  `ALTER TABLE IF EXISTS tests ADD COLUMN IF NOT EXISTS progress integer DEFAULT 0 NOT NULL`,
  // 성능 인덱스 (세션 토큰·담당자·소유자)
  `CREATE INDEX IF NOT EXISTS sessions_token_idx ON sessions (token)`,
  `CREATE INDEX IF NOT EXISTS tasks_assignee_idx ON tasks (org_id, assignee)`,
  `CREATE INDEX IF NOT EXISTS issues_assignee_idx ON issues (org_id, assignee)`,
  `CREATE INDEX IF NOT EXISTS risks_owner_idx ON risks (org_id, owner)`,
  // phases sort order safety
  `ALTER TABLE IF EXISTS phases ADD COLUMN IF NOT EXISTS sort_order integer DEFAULT 0 NOT NULL`,
  `ALTER TABLE IF EXISTS phases ADD COLUMN IF NOT EXISTS color text`,
  // 이슈 이력(journal)·워처 (신규 테이블)
  `CREATE TABLE IF NOT EXISTS issue_journals (id serial PRIMARY KEY, org_id integer NOT NULL, issue_id integer NOT NULL REFERENCES issues(id) ON DELETE CASCADE, user_id integer NOT NULL, author_name text NOT NULL, changes text, note text, created_at timestamptz DEFAULT now() NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS issue_journals_idx ON issue_journals (org_id, issue_id)`,
  `CREATE TABLE IF NOT EXISTS issue_watchers (id serial PRIMARY KEY, org_id integer NOT NULL, issue_id integer NOT NULL REFERENCES issues(id) ON DELETE CASCADE, user_id integer NOT NULL, user_name text NOT NULL, created_at timestamptz DEFAULT now() NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS issue_watchers_idx ON issue_watchers (org_id, issue_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS issue_watchers_uniq ON issue_watchers (org_id, issue_id, user_id)`,
  // 테스트 차수(Cycle)
  `CREATE TABLE IF NOT EXISTS test_cycles (id serial PRIMARY KEY, org_id integer NOT NULL, project_id integer NOT NULL REFERENCES projects(id) ON DELETE CASCADE, code text, name text NOT NULL, goal text, status text DEFAULT 'planned' NOT NULL, start_date text, end_date text, created_at timestamptz DEFAULT now() NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS test_cycles_project_idx ON test_cycles (org_id, project_id)`,
  `ALTER TABLE IF EXISTS tests ADD COLUMN IF NOT EXISTS cycle text`,
  // 개인 To-Do
  `CREATE TABLE IF NOT EXISTS todos (id serial PRIMARY KEY, org_id integer NOT NULL, user_id integer NOT NULL, code text, title text NOT NULL, note text, priority text DEFAULT 'medium' NOT NULL, status text DEFAULT 'todo' NOT NULL, due_date text, created_at timestamptz DEFAULT now() NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS todos_user_idx ON todos (org_id, user_id)`,
  // 이슈 공수(시간기록)
  `ALTER TABLE IF EXISTS issues ADD COLUMN IF NOT EXISTS estimate_hours integer DEFAULT 0 NOT NULL`,
  `ALTER TABLE IF EXISTS issues ADD COLUMN IF NOT EXISTS spent_hours integer DEFAULT 0 NOT NULL`,
  // 인프라 자산 상세
  `ALTER TABLE IF EXISTS infra_assets ADD COLUMN IF NOT EXISTS hostname text`,
  `ALTER TABLE IF EXISTS infra_assets ADD COLUMN IF NOT EXISTS os text`,
  `ALTER TABLE IF EXISTS infra_assets ADD COLUMN IF NOT EXISTS cpu text`,
  `ALTER TABLE IF EXISTS infra_assets ADD COLUMN IF NOT EXISTS memory text`,
  `ALTER TABLE IF EXISTS infra_assets ADD COLUMN IF NOT EXISTS rack text`,
  `ALTER TABLE IF EXISTS infra_assets ADD COLUMN IF NOT EXISTS serial_no text`,
  // SI 도메인 필드 보강
  `ALTER TABLE IF EXISTS requirements ADD COLUMN IF NOT EXISTS acceptance_criteria text`,
  `ALTER TABLE IF EXISTS meetings ADD COLUMN IF NOT EXISTS action_items text`,
  `ALTER TABLE IF EXISTS meetings ADD COLUMN IF NOT EXISTS next_date text`,
  `ALTER TABLE IF EXISTS procurement_items ADD COLUMN IF NOT EXISTS po_number text`,
  `ALTER TABLE IF EXISTS procurement_items ADD COLUMN IF NOT EXISTS delivery_date text`,
  `ALTER TABLE IF EXISTS procurement_items ADD COLUMN IF NOT EXISTS receipt_date text`,
  `ALTER TABLE IF EXISTS issues ADD COLUMN IF NOT EXISTS related text`,
  // 방화벽 승인자·만료
  `ALTER TABLE IF EXISTS firewall_requests ADD COLUMN IF NOT EXISTS approver text`,
  `ALTER TABLE IF EXISTS firewall_requests ADD COLUMN IF NOT EXISTS expire_date text`,
  // 기성고 스냅샷
  `CREATE TABLE IF NOT EXISTS snapshots (id serial PRIMARY KEY, org_id integer NOT NULL, project_id integer NOT NULL REFERENCES projects(id) ON DELETE CASCADE, code text, label text NOT NULL, snapshot_date text, planned_pct integer DEFAULT 0 NOT NULL, actual_pct integer DEFAULT 0 NOT NULL, billing_pct integer DEFAULT 0 NOT NULL, note text, created_at timestamptz DEFAULT now() NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS snapshots_project_idx ON snapshots (org_id, project_id)`,
  // 인터페이스 상세
  `ALTER TABLE IF EXISTS interfaces ADD COLUMN IF NOT EXISTS owner text`,
  `ALTER TABLE IF EXISTS interfaces ADD COLUMN IF NOT EXISTS spec text`,
  `ALTER TABLE IF EXISTS interfaces ADD COLUMN IF NOT EXISTS test_status text`,
  // 프로젝트 계약정보
  `ALTER TABLE IF EXISTS projects ADD COLUMN IF NOT EXISTS orderer text`,
  `ALTER TABLE IF EXISTS projects ADD COLUMN IF NOT EXISTS contract_no text`,
  `ALTER TABLE IF EXISTS projects ADD COLUMN IF NOT EXISTS budget integer DEFAULT 0 NOT NULL`,
  // 리스크 대응방안
  `ALTER TABLE IF EXISTS risks ADD COLUMN IF NOT EXISTS mitigation text`,
  `ALTER TABLE IF EXISTS risks ADD COLUMN IF NOT EXISTS contingency text`,
  `ALTER TABLE IF EXISTS risks ADD COLUMN IF NOT EXISTS due_date text`,
  // 산출물 버전이력
  `CREATE TABLE IF NOT EXISTS document_versions (id serial PRIMARY KEY, org_id integer NOT NULL, document_id integer NOT NULL REFERENCES documents(id) ON DELETE CASCADE, version text, status text, author text, note text, created_at timestamptz DEFAULT now() NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS document_versions_idx ON document_versions (org_id, document_id)`,
  // 커스텀 산출물 양식
  `CREATE TABLE IF NOT EXISTS form_definitions (id serial PRIMARY KEY, org_id integer NOT NULL, project_id integer NOT NULL REFERENCES projects(id) ON DELETE CASCADE, code text, name text NOT NULL, target_type text, fields text, note text, status text DEFAULT 'draft' NOT NULL, created_at timestamptz DEFAULT now() NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS form_definitions_project_idx ON form_definitions (org_id, project_id)`,
  // 조직 초대 코드(팀원 합류)
  `ALTER TABLE IF EXISTS organizations ADD COLUMN IF NOT EXISTS invite_code text`,
  // ── 2026-10-07 배치181(주간 수동) 신규 4종 — schema.ts 선언과 컬럼이 1:1(테스트가 원문을 대조한다) ──
  // 비밀번호 재설정 토큰(해시만 저장)
  `CREATE TABLE IF NOT EXISTS password_reset_tokens (id serial PRIMARY KEY, user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE, token_hash text NOT NULL, expires_at timestamptz NOT NULL, used_at timestamptz, created_at timestamptz DEFAULT now() NOT NULL)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS password_reset_tokens_hash_idx ON password_reset_tokens (token_hash)`,
  `CREATE INDEX IF NOT EXISTS password_reset_tokens_user_idx ON password_reset_tokens (user_id)`,
  // 첨부 메타데이터(산출물·이슈)
  `CREATE TABLE IF NOT EXISTS attachments (id serial PRIMARY KEY, org_id integer NOT NULL, entity text NOT NULL, entity_id integer NOT NULL, filename text NOT NULL, size integer DEFAULT 0 NOT NULL, mime text, provider text DEFAULT 'none' NOT NULL, storage_key text, status text DEFAULT 'metadata_only' NOT NULL, expires_at timestamptz, uploaded_by integer NOT NULL, uploader_name text NOT NULL, created_at timestamptz DEFAULT now() NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS attachments_entity_idx ON attachments (org_id, entity, entity_id)`,
  // 이슈 관계
  `CREATE TABLE IF NOT EXISTS issue_links (id serial PRIMARY KEY, org_id integer NOT NULL, src_issue_id integer NOT NULL REFERENCES issues(id) ON DELETE CASCADE, dst_issue_id integer NOT NULL REFERENCES issues(id) ON DELETE CASCADE, kind text DEFAULT 'relates' NOT NULL, created_by integer, created_at timestamptz DEFAULT now() NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS issue_links_src_idx ON issue_links (org_id, src_issue_id)`,
  `CREATE INDEX IF NOT EXISTS issue_links_dst_idx ON issue_links (org_id, dst_issue_id)`,
  // 커스텀 양식 입력
  `CREATE TABLE IF NOT EXISTS form_entries (id serial PRIMARY KEY, org_id integer NOT NULL, project_id integer NOT NULL REFERENCES projects(id) ON DELETE CASCADE, form_definition_id integer NOT NULL REFERENCES form_definitions(id) ON DELETE CASCADE, document_id integer, data text, created_by integer NOT NULL, author_name text NOT NULL, created_at timestamptz DEFAULT now() NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS form_entries_def_idx ON form_entries (org_id, form_definition_id)`,
];

/** 앱이 실제로 쓰는 테이블 = drizzle 선언 ∪ MIGRATION_DDL 이 CREATE 하는 테이블 */
export function expectedTables(): string[] {
  const declared = Object.values(schema as Record<string, unknown>)
    .filter((v): v is PgTable => is(v, PgTable))
    .map((t) => getTableName(t));
  return [...declared, ...createdTables(MIGRATION_DDL)];
}

/**
 * 실제 존재하는 테이블 — **읽기 전용 조회**. 실패하면 null 을 돌려
 * "테이블이 없다"로 단정하지 않고 검증만 보류한다(migrate 자체는 막지 않는다).
 */
async function presentTables(): Promise<string[] | null> {
  try { return tableNamesFrom(rowsOf(await db.execute(dsql.raw(PRESENT_TABLES_SQL)))); }
  catch (e: any) { console.error('[runMigrations] 스키마 검증 조회 실패', String(e?.message || e)); return null; }
}

/**
 * MIGRATION_DDL 을 적용한 뒤 **실제 스키마와 대조**해서 돌려준다.
 * `applied` 는 예외를 던지지 않은 문장 수일 뿐이라(빈 DB 에서는 ALTER IF EXISTS 가 조용히
 * 건너뛰면서도 applied 로 세어진다) 그것만으로 성공을 판단하면 안 된다 — `schema`·`silentSuccess` 를 볼 것.
 */
export async function runMigrations(): Promise<MigrationReport> {
  const applied: string[] = []; const failed: { stmt: string; error: string }[] = [];
  for (const stmt of MIGRATION_DDL) {
    try { await db.execute(dsql.raw(stmt)); applied.push(stmt.slice(0, 60)); }
    catch (e: any) { failed.push({ stmt: stmt.slice(0, 80), error: String(e?.message || e) }); }
  }
  const verification = verifySchema({
    expected: expectedTables(),
    present: await presentTables(),
    statements: MIGRATION_DDL,
  });
  return migrationReport({ applied: applied.length, failed }, verification);
}

// 서버 인스턴스당 1회만 실행(메모이즈). 절대 throw하지 않음 → 요청을 막지 않음.
let _once: Promise<void> | null = null;
export function ensureSchema(): Promise<void> {
  if (!_once) {
    _once = runMigrations()
      .then((r) => {
        if (r.failed.length) console.error('[ensureSchema] 일부 실패', r.failed);
        // failed 0 이어도 스키마가 비어 있을 수 있다 — 그 경우를 "ok" 로 적지 않는다
        if (r.silentSuccess) console.error('[ensureSchema] 스키마 미정합', migrationLogLine(r));
        else if (!r.failed.length) console.log('[ensureSchema]', migrationLogLine(r));
      })
      .catch((e) => { console.error('[ensureSchema] error', e); });
  }
  return _once;
}
