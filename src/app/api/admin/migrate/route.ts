import { db } from '@/db';
import { sql as dsql } from 'drizzle-orm';
import { requireUser } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { handle, ok, ApiError, ERROR } from '@/lib/http';
export const dynamic = 'force-dynamic';

// Idempotent schema self-heal: adds any columns that the current code expects
// but that may be missing from an older DB table. Safe to run repeatedly.
const DDL: string[] = [
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
  `ALTER TABLE IF EXISTS documents ADD COLUMN IF NOT EXISTS approved_at timestamptz`,
  `ALTER TABLE IF EXISTS tests ADD COLUMN IF NOT EXISTS reporter text`,
  `ALTER TABLE IF EXISTS tests ADD COLUMN IF NOT EXISTS due_date text`,
  `ALTER TABLE IF EXISTS tests ADD COLUMN IF NOT EXISTS progress integer DEFAULT 0 NOT NULL`,
  // phases sort order safety
  `ALTER TABLE IF EXISTS phases ADD COLUMN IF NOT EXISTS sort_order integer DEFAULT 0 NOT NULL`,
  `ALTER TABLE IF EXISTS phases ADD COLUMN IF NOT EXISTS color text`,
];

export async function POST() {
  return handle(async () => {
    const ctx = await requireTenant(await requireUser());
    if (!ctx.isOrgAdmin && !ctx.user.isSuperadmin) throw new ApiError(ERROR.FORBIDDEN, '관리자만 실행할 수 있습니다');
    const applied: string[] = [];
    for (const stmt of DDL) { await db.execute(dsql.raw(stmt)); applied.push(stmt.replace(/ALTER TABLE IF EXISTS /,'').slice(0,60)); }
    return ok({ applied: applied.length });
  });
}
