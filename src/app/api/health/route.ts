import { NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { assetCoverageCheck } from '@/lib/assetCoverage';
import { billingStatus } from '@/lib/portone';
import { dbIdentityCheck } from '@/lib/dbIdentity';
import { deployPinCheck } from '@/lib/deployRollback';
import { envPresenceCheck } from '@/lib/envPresence';
import { externalStateCheck } from '@/lib/externalReconcile';
import { buildHealthBody, sanitizeError, statusCode, type Checks } from '@/lib/health';
import {
  DETAIL_TOKEN_HEADER,
  disclosureCheck,
  disclosureGate,
  publicHealthView,
  publicSignalHeaders,
} from '@/lib/healthDisclosure';
import { signalHeaders, withSignal } from '@/lib/healthSignal';
import { closureCheck } from '@/lib/incidentClosure';
import { securityReapplyCheck } from '@/lib/postRestoreSecurity';
import { periodicCheckHealth } from '@/lib/periodicCheck';
import { rateLimitResponse, RL } from '@/lib/ratelimit';
import { recoveryReadinessCheck } from '@/lib/recoveryVerify';
import { rehearsalScopeCheck } from '@/lib/rehearsalScope';
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

  // §2 정기 점검(월 1회)이 밀렸는지와, 그 점검만이 갱신하는 **날짜 없는 설정값**의 신선도.
  // 위 recoveryWindow 는 보존 시간이 설정돼 있으면 영구히 ok 다 — 플랜·보존 설정을 바꾼 뒤
  // 점검이 밀리면 옛 수치로 창을 계산해 **창 밖 시점에 ok 와 deadline 을 돌려준다**.
  // 그러면 §3 2단계 쓰기 차단(전 사용자 저장 503)을 건 뒤 3단계에서야 복구 불가를 알게 된다.
  // 점검 일자 하나로 그 순서를 뒤집는다. 날짜·일수·키 이름만 담고(설정값 없음) required: false.
  checks.periodicCheck = periodicCheckHealth();

  // §4 환경변수·시크릿 복구가 **실제로 됐는지**. §4 머리말은 「빠진 키는 오류를 내지 않고 조용히
  // 기본값으로 되돌아간다」고 경고하는데, 정본(lib/envRegistry.ts)은 설계상 process.env 를 보지
  // 않으므로 **레지스트리와 돌고 있는 배포가 한 번도 대조되지 않았다** — §4-10 의 확인은 눈 확인
  // 이고, LEGAL_* 처럼 fail-safe 로 draft 로 남는 조합은 「아직 확정 전」과 구분되지 않는다.
  // 여기서 (가) 켜졌는데 선행 값이 없는 스위치와 (나) §2 스냅샷 대비 사라진 키를 드러낸다.
  // 값은 담지 않는다(키 이름·판정·날짜·개수만). required: false — 설정 유실로 서비스를 내리면
  // 복구 자신이 막힌다. 기준 스냅샷 미설정(no_baseline)은 평상시 상태라 degraded 가 아니다.
  checks.envPresence = envPresenceCheck();

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

  // 복구가 되돌린 **보안 상태**를 다시 적용했는지(RUNBOOK §3 6-1단계·§3-8). 시점 복구는 업무 데이터만
  // 되돌리는 것이 아니다 — 끊은 세션(sessions 행 삭제)·바꾼 비밀번호(users.password_hash)·잠근 계정·
  // 회수한 권한이 전부 T-ε 상태로 돌아온다. 4단계 행 수 대조도 6단계 스키마 확인도 이것을 잡지 못해
  // (되돌아온 행은 「기준치 이상」이다) 복구는 「성공」으로 끝나고 사건의 접근 수단이 되살아난 채 열린다.
  // 그래서 **차단이 걸려 있는 동안**(= 아직 아무도 들어오지 못하는 동안) 재적용 미기록을 드러낸다.
  // 상태·키 이름·시각만 담고(계정·토큰·행 수 없음) required:false 라 503 이 되지는 않는다.
  checks.postRestoreSecurity = securityReapplyCheck();

  // 복구가 **되돌리지 못하는 외부 상태**와 대조했는지(RUNBOOK §3 6-2단계·§3-9). 시점 복구는 이 DB 안만
  // 되돌린다 — 결제 제공자 쪽 결제·구독·영수증은 그대로 남는데, 그 반영 결과인 organizations.plan 과
  // 감사 행(BILLING_PLAN_APPLIED)은 T-ε 로 돌아간다. 그래서 돈을 낸 조직의 플랜이 내려가고(좌석·기능이
  // 잠긴다) 해지한 조직의 유료 플랜이 되살아난다 — 4단계는 organizations 를 **행 수로만** 세므로 둘 다
  // `ok` 로 통과한다. 차단 중 503 을 받은 웹훅은 제공자 재시도가 만료되면 다시 오지 않는다
  // (writeFreeze 의 FREEZE_LIMITS 가 「수동 대조가 필요하다」고 적어 둔 바로 그 구간이다).
  // 그래서 **차단이 걸려 있는 동안**(= 아직 사용자가 들어오지 못하는 동안) 미대조를 드러낸다.
  // 상태·키 이름·시각·개수만 담고(조직·금액·결제 식별자 없음) required: false 라 503 이 되지는 않는다.
  checks.externalState = externalStateCheck();

  // §1 보호 대상 표가 **실제 저장 위치와 맞는지**(RUNBOOK §1·§1-1). §3·§4·§5 의 기계적 판정은 모두
  // 그 표 한 장을 전제로 삼는데, 표 자체는 한 번도 코드와 대조되지 않았다 — 「업로드 파일 = DB 저장 =
  // DB 백업에 포함」은 사실이 아니다. `lib/attachments.ts` 의 어떤 어댑터도 `canStore: true` 가 아니라
  // 본문은 어디에도 보관되지 않고, 복구로 돌아오는 것은 **목록**이다(그 목록조차 4단계 핵심 테이블에
  // attachments 가 없어 행 수 대조로 드러나지 않는다). 외부 스토리지를 켜면 본문이 PITR 경계 밖으로
  // 나가 고아 객체·깨진 참조가 생기는데, 그 전환은 환경변수 한 줄이다.
  // 판정·위치 설명만 담고(파일명·업로더·저장 키 없음) required: false 라 503 이 되지는 않는다.
  checks.assetCoverage = assetCoverageCheck();

  // 리허설이 **어느 배포에 걸려 있는가**(RUNBOOK §6·§6-1). §6 머리말은 「리허설은 운영 DB가 아닌
  // 복구 브랜치에서 수행한다」고만 적어 두었고 확인하는 코드가 없었다 — 체크리스트가 지시하는 관측
  // (`frozen: true` · `PATCH` → 503 · 지문 `match`)은 **그 설정이 운영 스코프에 들어갔을 때도 똑같이**
  // 나온다. 운영이 버려질 복구 브랜치에 쓰기를 쌓아도 `checks.db` 는 `select 1` 이라 ok 다.
  // 선언(RECOVERY_REHEARSAL_ACTIVE)과 파괴적 설정은 **같은 재배포로 반영**되므로 스코프를 틀리면
  // 선언도 함께 틀린 배포로 간다 — 그래서 운영 배포 자신이 production_rehearsal 로 보고한다.
  // 판정·역할·키 이름만 담고(설정값·호스트 없음) required: false 라 503 이 되지 않는다.
  checks.rehearsalScope = rehearsalScopeCheck();

  // 배포 롤백이 유지되고 있는지(RUNBOOK §5·§5-1). §5 2단계는 「`commit` 이 롤백 대상과 일치하는지
  // 확인」인데 그 눈 확인은 **그 순간**만 말한다 — 이 배포 경로는 AutoPush(20분) → push →
  // Vercel 자동 배포(main)이고, Promote 는 `main` 을 고치지 않으므로 롤백은 주기 안에 저절로 풀린다.
  // 고정 커밋(DEPLOY_PINNED_COMMIT)을 적어 두면 풀린 사실이 `drifted` 로 응답에 남는다.
  // 미설정이 평상시 상태이고 required: false 라 어느 경우에도 503 이 되지 않는다.
  // 커밋 접두사·env 키 이름·판정만 담는다(설정값 없음).
  checks.deployPin = deployPinCheck();

  // 위 체크들이 **무인증으로** 무엇을 말하는지(RUNBOOK §2-3). 이 라우트는 인증이 없고 한도도
  // 넉넉한데(업타임 모니터용), 복구 중에는 응답이 차단 여부·차단을 건 시각·보안 재적용 미완
  // (`postRestoreSecurity: pending` = 되돌아온 세션·비밀번호가 **아직 통한다**)·빠진 설정 키를
  // 실시간으로 공표한다 — §3-8 이 줄이려던 그 구간의 시작과 끝을 바깥에 먼저 알려 주는 셈이다.
  // 각 배치는 「값은 담지 않는다」를 지켰고 그래서 **판정과 키 이름만으로 생기는** 이 노출은
  // 한 번도 점검되지 않았다. 판정·키 이름만 담고(토큰 값·설정값 없음) required: false.
  checks.disclosure = disclosureCheck();

  const body = buildHealthBody({ checks, uptimeSec: (Date.now() - startedAt) / 1000 });

  // 위 판정들이 **도달하게** 한다(RUNBOOK §2-2). 복구 관련 체크는 전부 required: false 라
  // degraded(200) + `ok: true` 로 나가는데, 이 응답을 상시로 읽는 쪽 셋 — 업타임 모니터(상태 코드)·
  // `ok` 만 보는 감시자·오류 알림 웹훅(예외만) — 은 **어느 쪽도 degraded 를 보지 못한다**.
  // 남은 통로인 사람의 §2 월 점검은 계기가 점검 자신이라 순환이고, writeFreeze·incidentClosure·
  // postRestoreSecurity·externalState 는 차단이 걸려 있는 **수십 분 동안만** 쓸모가 있다.
  // 그래서 상태 코드는 그대로 두고(degraded 로 503 을 내면 복구가 자기 자신을 막는다)
  // 헤더 2개와 본문 `signal` 요약으로 걸 수 있는 표면만 만든다 — 알림 발신은 하지 않는다
  // (폴링마다 중복이 되고 서버리스에서 디듀프할 방법이 없다. signal.limits 에 적어 내보낸다).
  // 체크 이름·판정·개수만 담는다(설정값·호스트·행 수 없음).
  // 사건 표지(§3 의 복구용 env)가 들어가 있고 상세를 볼 경로(`HEALTH_DETAIL_TOKEN`)가 있을 때만,
  // 무인증 요청에서 체크 **상세와 이름**을 가린다(RUNBOOK §2-3). 토큰이 없으면 가리지 않는다 —
  // 복구 담당자의 유일한 확인 수단을 막는 쪽이 더 위험하다. 대신 그 상태를 `checks.disclosure` 가
  // `exposed` 로 드러낸다. 평상시(표지 없음)에는 응답이 한 글자도 바뀌지 않는다.
  // 상태 코드·`status`·`x-health-status` 는 어느 경우에도 그대로다(§2-2 의 도달 경로를 죽이지 않는다).
  const gate = disclosureGate({ token: req.headers.get(DETAIL_TOKEN_HEADER) });
  if (gate.withhold) {
    return NextResponse.json(publicHealthView(withSignal(body), { gated: true }), {
      status: statusCode(body.status),
      headers: publicSignalHeaders({ 'Cache-Control': 'no-store', ...signalHeaders(body) }, { gated: true }),
    });
  }

  return NextResponse.json(withSignal(body), {
    status: statusCode(body.status),
    headers: { 'Cache-Control': 'no-store', ...signalHeaders(body) },
  });
}
