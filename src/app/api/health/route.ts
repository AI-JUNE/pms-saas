import { NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { billingStatus } from '@/lib/portone';
import { dbIdentityCheck } from '@/lib/dbIdentity';
import { buildHealthBody, sanitizeError, statusCode, type Checks } from '@/lib/health';
import { closureCheck } from '@/lib/incidentClosure';
import { rateLimitResponse, RL } from '@/lib/ratelimit';
import { recoveryReadinessCheck } from '@/lib/recoveryVerify';
import { pitrWindowCheck } from '@/lib/recoveryWindow';
import { writeFreezeCheck } from '@/lib/writeFreeze';

// ★ route.ts에서는 HTTP 메서드와 Next 설정 외 export 금지(Vercel 빌드 실패 원인).
export const dynamic = 'force-dynamic';

const startedAt = Date.now();

// 공개 헬스체크: 인증 불필요. 업타임 모니터·로드밸런서·마켓플레이스 상태 점검용.
// 의존성(DB·결제 프로바이더 설정)과 배포 메타(버전·커밋·환경)를 노출하되,
// 연결 문자열·키 등 민감정보는 lib/health의 sanitizeError로 걸러낸다.
export async function GET(req: Request) {
  // 공개 엔드포인트 남용 방어. 업타임 모니터가 막히지 않도록 한도를 넉넉히 둔다.
  const limited = rateLimitResponse(req, RL.publicHealth);
  if (limited) return limited;

  const checks: Checks = {};

  // DB: 필수 의존성. 가벼운 select 1 핑.
  try {
    const t0 = Date.now();
    await db.execute(sql`select 1`); // tenant-scan: allow(연결 확인용 상수 쿼리, 테이블 접근 없음)
    checks.db = { ok: true, required: true, latencyMs: Date.now() - t0 };
  } catch (e: unknown) {
    checks.db = { ok: false, required: true, latencyMs: null, error: sanitizeError(e) };
  }

  // 결제 프로바이더: 외부 API를 실제로 호출하지 않고 설정 완비 여부만 본다.
  // 테스트 모드에서는 미설정이 정상이므로 실패로 보지 않는다(required: false, live일 때만 판정).
  try {
    const b = billingStatus();
    const needed = b.live ? b.configured.storeId && b.configured.channelKey && b.configured.apiSecret : true;
    checks.billing = {
      ok: Boolean(needed),
      required: false,
      detail: { provider: b.provider, mode: b.mode, configured: b.configured },
    };
  } catch (e: unknown) {
    checks.billing = { ok: false, required: false, error: sanitizeError(e) };
  }

  // 모니터링 배선 상태(정보성). DSN·웹훅 URL 자체는 노출하지 않고 설정 여부만 boolean으로 알린다.
  checks.monitoring = {
    ok: true,
    required: false,
    detail: {
      enabled: process.env.MONITORING_ENABLED === 'true',
      sentry: Boolean(process.env.SENTRY_DSN),
      alertWebhook: Boolean(process.env.ALERT_WEBHOOK_URL),
    },
  };

  // 백업·복구 준비도(정보성): 리허설 신선도 + **기준 스냅샷 신선도**.
  // 미실시·기한초과·낡은 스냅샷은 degraded(200)로만 드러내고 서비스를 down 처리하지 않는다
  // (required: false). 담당자 등 PII 는 publicRehearsal 로 제거되고, 행 수는 담지 않는다.
  checks.recovery = recoveryReadinessCheck();

  // PITR 보존 창(RUNBOOK §3 3단계·§3-6) 설정 상태. 보존기간은 §1 에 `[확인 필요]` 로 비어 있어
  // 복구일 3단계에서야 「그 시점으로 브랜치를 만들 수 없다」가 드러났다 — 그때는 2단계 쓰기 차단으로
  // 서비스가 이미 멈춘 뒤다. 평상시에 미설정을 드러내 그 순서를 뒤집는다.
  // 사건별 손상 시각 T 는 여기서 판정하지 않는다(설정 여부·보존 시간만, required: false).
  checks.recoveryWindow = pitrWindowCheck();

  // 쓰기 차단(RUNBOOK §3 2단계) 상태. 2단계는 「유지보수 상태로 전환」을 지시하면서도
  // 그것이 걸렸는지 확인할 방법이 없었다 — 여기서 드러내 확인 가능한 단계로 만든다.
  // 차단 중이면 ok:false(degraded 200)지만 required:false 라 503 이 되지는 않는다.
  // 이 값은 **이 배포 자신의** 차단 상태만 뜻한다(스테이징 검증과 운영 차단은 별개 배포다).
  checks.writeFreeze = writeFreezeCheck();

  // 연결 대상(RUNBOOK §3 5단계·§3-4). `checks.db` 의 `select 1` 은 **어느 DB 든** 통과하므로
  // 「운영 DATABASE_URL 을 복구 브랜치로 교체했다」가 실제로 이 배포에 반영됐는지 알 수 없었다
  // (Vercel 환경변수는 재배포 전까지 반영되지 않는다). 지문으로 그것을 확인 가능하게 만든다.
  // 공개 응답이므로 지문·provider·pooled·region 만 담는다 — 호스트·DB 이름·자격증명 제외.
  // 기준 지문(RECOVERY_EXPECTED_DB) 미설정이 평상시 상태이고, 불일치는 degraded(200)로만 드러난다.
  checks.dbIdentity = dbIdentityCheck();

  // 유실 구간을 확정할 수 있는 상태인지(RUNBOOK §3 8단계·§3-7). §3 말미는 「손실 구간을 반드시
  // 고지한다 — 2단계 차단을 **언제** 걸었는지가 그 구간의 끝이다」라고 하는데, 그 시각이 어디에도
  // 기록되지 않았고 7단계는 스위치를 지우라고 지시한다 — 해제 뒤에는 끝을 확정할 수 없다.
  // 그래서 **차단이 걸려 있는 동안**(= 아직 기록할 수 있는 동안) 미기록을 드러낸다.
  // 시각·상태만 담고(행 수·담당자 없음) required:false 라 503 이 되지는 않는다.
  checks.incidentClosure = closureCheck();

  const body = buildHealthBody({ checks, uptimeSec: (Date.now() - startedAt) / 1000 });

  return NextResponse.json(body, {
    status: statusCode(body.status),
    headers: { 'Cache-Control': 'no-store' },
  });
}
