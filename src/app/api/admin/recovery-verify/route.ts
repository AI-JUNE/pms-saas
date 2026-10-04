import { sql as dsql } from 'drizzle-orm';
import { db } from '@/db';
import { requireUser } from '@/lib/auth';
import { auditSecurity } from '@/lib/audit';
import { ADMIN_AUDIT_ENTITY, accessMeta, adminAccessEvent } from '@/lib/auditAccess';
import { handle, ok, ApiError, ERROR } from '@/lib/http';
import { MIGRATION_DDL, expectedTables } from '@/lib/migrate';
import { PRESENT_TABLES_SQL, normalizeTableNames, rowsOf, tableNamesFrom, verifySchema } from '@/lib/schemaVerify';
import {
  CORE_TABLES, baselineFromEnv, coreCountSql, countsFrom,
  recoveryVerification, recoveryVerifyLogLine, verifyRowCounts,
} from '@/lib/recoveryVerify';
export const dynamic = 'force-dynamic';

// 복구 검증(RUNBOOK §3 4단계) — **슈퍼관리자 전용 읽기 전용** 점검.
//
// 왜 조직 관리자가 아니라 슈퍼관리자인가: 이 응답은 전 테넌트 합계 행 수를 담는다.
// 특정 조직으로 스코프할 수 없는 성질의 조회이므로(복구는 DB 전체가 대상이다) 권한을 최상위로 올렸다.
// 쓰기·DDL 0 — `information_schema` 목록 조회와 `count(*)` 집계 두 건뿐이다.
// 한계: 빈 DB(사용자 테이블조차 없는 경로)에서는 로그인 자체가 불가능해 이 엔드포인트에 닿지 못한다.
// 그 경로는 `POST /api/admin/migrate` 의 `schema.verdict`·부팅 로그가 담당한다(RUNBOOK §3-1).

async function presentTables(): Promise<string[] | null> {
  try {
    // tenant-scan: allow(복구 검증 — information_schema 테이블 목록 조회, 테넌트 데이터가 아니다)
    return normalizeTableNames(tableNamesFrom(rowsOf(await db.execute(dsql.raw(PRESENT_TABLES_SQL)))));
  } catch (e: any) {
    console.error('[recovery-verify] 테이블 목록 조회 실패', String(e?.message || e));
    return null;
  }
}

async function coreCounts(tables: readonly string[]): Promise<Record<string, number> | null> {
  if (tables.length === 0) return null;
  try {
    // tenant-scan: allow(복구 검증 — 전 테넌트 행수 집계, 슈퍼관리자 전용 읽기)
    return countsFrom(rowsOf(await db.execute(dsql.raw(coreCountSql(tables)))));
  } catch (e: any) {
    console.error('[recovery-verify] 행수 조회 실패', String(e?.message || e));
    return null;
  }
}

export async function GET(req: Request) {
  return handle(async () => {
    const u = await requireUser();
    if (!u.isSuperadmin) throw new ApiError(ERROR.FORBIDDEN, '슈퍼관리자만 열람할 수 있습니다');

    const present = await presentTables();
    const schema = verifySchema({ expected: expectedTables(), present, statements: MIGRATION_DDL });
    // 없는 테이블을 세려 하면 조회 전체가 실패하므로 실존 목록으로 걸러서 넘긴다.
    const countable = present ? CORE_TABLES.filter((t) => present.includes(t)) : [...CORE_TABLES];
    const data = verifyRowCounts({ counts: await coreCounts(countable), present, baseline: baselineFromEnv() });
    const result = recoveryVerification(schema, data);

    console.log('[recovery-verify]', recoveryVerifyLogLine(result));
    // 열람 이력 — 조직 컨텍스트가 없는 슈퍼관리자 작업이므로 보안 이벤트로 남긴다(수치·판정만).
    await auditSecurity(adminAccessEvent(new URL(req.url).pathname, req.method), {
      userId: u.id,
      entity: ADMIN_AUDIT_ENTITY,
      detail: {
        ...accessMeta(req),
        schemaVerdict: schema.verdict,
        dataVerdict: data.verdict,
        switchReady: result.switchReady,
        rows: data.totalRows,
      },
    });
    return ok(result);
  }, req);
}
