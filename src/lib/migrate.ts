import { db } from '@/db';
import { sql as dsql } from 'drizzle-orm';

// 멱등 스키마 자가정합 DDL. 반복 실행 안전(모두 IF EXISTS/IF NOT EXISTS).
export const MIGRATION_DDL: string[] = [
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
];

export async function runMigrations(): Promise<{ applied: number; failed: { stmt: string; error: string }[] }> {
  const applied: string[] = []; const failed: { stmt: string; error: string }[] = [];
  for (const stmt of MIGRATION_DDL) {
    try { await db.execute(dsql.raw(stmt)); applied.push(stmt.slice(0, 60)); }
    catch (e: any) { failed.push({ stmt: stmt.slice(0, 80), error: String(e?.message || e) }); }
  }
  return { applied: applied.length, failed };
}

// 서버 인스턴스당 1회만 실행(메모이즈). 절대 throw하지 않음 → 요청을 막지 않음.
let _once: Promise<void> | null = null;
export function ensureSchema(): Promise<void> {
  if (!_once) {
    _once = runMigrations()
      .then((r) => { if (r.failed.length) console.error('[ensureSchema] 일부 실패', r.failed); else console.log('[ensureSchema] ok, applied', r.applied); })
      .catch((e) => { console.error('[ensureSchema] error', e); });
  }
  return _once;
}
