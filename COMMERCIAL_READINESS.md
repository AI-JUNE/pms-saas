# 상용 출시 잔여 과제 (COMMERCIAL READINESS)

작성 2026-09-01. **이 문서는 자동 개발의 최우선 백로그다.** 위에서부터 소진한다.

## 원칙
- `[ ]` 미완, `[x]` 완료. 완료 시 근거(파일·테스트)를 한 줄로 남긴다.
- **build now, activate on approval**: 코드는 끝까지 만들되 실인증·실결제·실개인정보·실발신 **활성화는 사람 승인**. 스위치는 환경변수로 분리하고 기본 OFF.
- 임의 성과·KPI 수치를 화면·문서에 넣지 않는다. 실측 전에는 기능 서술로 쓴다.
- 모든 변경은 테스트·빌드 검증 통과 후 커밋한다.

## 공통 상용 필수 (전 제품)
- [x] **에러 모니터링** — 전역 에러 캡처 + 알림 훅. DSN은 환경변수, 미설정 시 무해하게 no-op
      → `lib/logger.ts`(installGlobalErrorHandlers·notifyAlert), `instrumentation.ts`, `app/global-error.tsx`, `api/client-errors/route.ts` / tests/logger.test.ts 8건 통과. 기본 OFF **[활성화 승인 필요]**
- [x] **구조화 로깅** — 요청 ID·소요시간·에러코드. PII 미기록
      → `lib/http.ts` handle(fn, req)에 requestId·durMs·status·code 로깅 + x-request-id 헤더, `lib/logger.ts` redact()로 PII 필드 마스킹 / tests/http.test.ts 5건 통과
- [x] **/health 확장** — 의존성(DB·외부API) 상태와 버전·커밋 해시 노출(민감정보 제외)
      → `lib/health.ts`(sanitizeError·buildInfo·summarize·buildHealthBody 순수 분리), `app/api/health/route.ts`가 db(필수)·billing·monitoring 체크와 version/commit(7자리)/branch/env/region 반환. 연결 문자열·키·토큰은 sanitizeError로 마스킹 / tests/health.test.ts 10건 통과
- [x] **표준 에러 응답** 전 API 통일 + 입력검증
      → 전 API가 `lib/http.ts` handle()/ApiError 경유(직접 NextResponse는 health만, 의도적). 신규 `lib/validate.ts`(ruleFor·validateOne·validateValues·summarizeErrors)로 필드명 규약 기반 타입·길이·범위 검증을 `lib/crud.ts` POST/PATCH에 일괄 적용, 위반 시 `{ok:false, code:'VALIDATION', message, fields:[{field,code,message}]}` 반환 / tests/validate.test.ts 12건 통과
- [x] **rate limit** 공개 API 적용
      → `lib/ratelimit.ts`에 공개 API 프리셋(publicHealth 120/분·publicPlans 60/분·publicAsset 60/분·billingWebhook 120/분)과 `rateLimitResponse()`(handle 미사용 라우트용 표준 429+Retry-After) 추가. `api/health`·`api/brand-logo`·`api/billing/plans`·`api/billing/webhook`에 적용(기존 auth/login·register·client-errors·billing/checkout와 합쳐 공개 엔드포인트 전건 커버) / tests/ratelimit.test.ts 통과
      ※ 인메모리 단일 인스턴스 기준. 다중 인스턴스 공유 스토어(Upstash 등) 승격은 **[활성화 승인 필요]**
- [x] **접근·감사 로그** — 관리 기능 접근 이력
      → 신규 `lib/auditAccess.ts`(순수: normalizePath·adminAccessEvent·sanitizeAccessDetail·adminChangeKind·coarseIp·accessMeta)와 `lib/audit.ts` auditAdminAccess()로 관리 API의 **열람까지** 기록. 적용: `api/admin/users`(GET/PATCH)·`api/admin/migrate`·`api/admin/seed-demo`·`api/audit`·`api/admin/security-events`. detail은 PII·비밀 키 제거, IP는 마지막 옥텟 마스킹, 변경은 유형만(값 미기록) / tests/auditAccess.test.ts 10건 통과(전체 123건 통과)
- [ ] **백업·복구 절차** RUNBOOK.md 문서화 + 복구 리허설 기록
      → 문서는 완료: `RUNBOOK.md`(보호 대상·Neon PITR 복구·시크릿 복구·배포 롤백·리허설 체크리스트). **복구 리허설 실시·기록은 사람 몫이라 미완** — 리허설 표는 의도적으로 비워 둠 [사람 수행 필요]
- [ ] **약관·개인정보 처리방침 확정본 반영** (현재 초안, 문안은 사람이 확정)
- [x] **테스트** 핵심 로직 커버리지 확보, CI에서 실행
      → `.github/workflows/ci.yml`(push·PR·수동, Node 22, npm ci → `npm run typecheck` → `npm run test:coverage`; 활성화 스위치 PAYMENTS_LIVE·BILLING_APPLY_LIVE 를 CI 환경에서 false 로 고정, 실DB·배포 단계 없음, permissions: contents read). `package.json` 에 `typecheck`·`test:coverage` 추가 — 커버리지는 `src/lib/**` 대상 임계값(lines 90·branches 80·funcs 85) 미달 시 **CI 실패**. 실측 96.47% lines / 88.42% branches / 93.75% funcs, 테스트 123건 전건 통과(tsc rc=0). 임계값 강제 동작은 lines=99 로 올려 rc=1 확인
      ※ 잔여(낮은 커버리지): `logger.ts` 83.73%, 그리고 DB 의존 모듈(crud·rbac·tenant·auth)은 테스트DB 필요 — 통합테스트는 별도 항목

## PMS 전용 (준비도 ~80%, 1순위)
- [x] 실로그인 게이트 코드 완성 (현재 자동로그인). 활성화 스위치 분리, 기본 OFF **[승인 후 ON]**
      → 코드 확인(2026-09-07): 자동로그인 `api/auth/auto/route.ts` 는 무조건 `{ok:false, disabled:true}` 반환(비활성)이고, 페이지는 `middleware.ts` 가 세션 쿠키 없으면 17개 앱 경로를 `/login` 리다이렉트, API 는 `lib/crud.ts` ctxOf → `requireUser()`(세션 없으면 UNAUTHORIZED) → `requireTenant()` 로 게이트. 로그인/가입은 rate limit + `password.ts` 해시 경유
      ※ 게이트는 환경변수 없이 **항상 ON**(하드코딩)으로 두었다 — 자동로그인을 되살릴 수 있는 스위치를 만들지 않는 편이 안전하므로 의도적. 남은 사람 몫: 운영 실계정 발급·비밀번호 정책 확정 **[승인 필요]**
- [x] 구독 결제 플로우 완성 — 빌링키 등록·정기청구·해지·환불 화면과 API (테스트키 전용) **[실결제는 승인]**
      → 신규 `lib/subscription.ts`(순수: 금액 파싱·좌석 청구액, 말일 보정 월가산·다음 청구일·현재 청구주기, 일할 환불 견적, 액션 화이트리스트·게이트, 해지 정책 period_end/immediate, 빌링키 발급 식별자·마스킹), 신규 `api/billing/manage/route.ts`(POST action=issue_billing_key·delete_billing_key·cancel·resume·refund, 조직관리자 전용·rate limit 20/분·감사로그), `settings/billing/page.tsx` 관리 UI(해지 예정일·환불 견적 표시) / tests/subscription.test.ts 13건 통과(전체 136건)
      ※ 기본은 **스캐폴딩 모드** — 외부 결제 호출·DB 변경 0. 실행 경로는 PAYMENTS_LIVE·BILLING_APPLY_LIVE 둘 다 ON일 때만 열리며 현재는 명시적으로 거절 **[활성화 승인 필요]**
      ※ 잔여: 빌링키·구독 상태 **영속화 테이블**(billing_keys·subscriptions)은 신규 DDL이라 야간 금지 규칙에 따라 미생성 — 실PG 연동 시 함께 진행
- [x] 요금제별 기능 제한(엔타이틀먼트) 로직 — 좌석 수·기능 게이팅
      → 신규 `lib/entitlements.ts`(순수 단일 소스: FEATURES 10종 최소플랜 매핑·SEAT_LIMIT(basic 10·pro 100·enterprise 무제한)·resolvePlan(미지/free/trial→basic, team/business→pro)·hasFeature·featuresFor·seatUsage·checkFeature·checkSeat·summarizeEntitlements), `api/billing/subscription`이 조직 플랜+멤버십 수로 요약을 반환(읽기 전용), `settings/billing` "플랜 이용 범위" 섹션에 좌석 사용량·기능 목록 표시 / tests/entitlements.test.ts 11건 통과(전체 147건, tsc rc=0, 커버리지 lines 97.23%)
      ※ 기본은 **관측 모드** — 판정만 하고 차단하지 않는다. `ENTITLEMENTS_ENFORCE=true` 일 때만 enforced=true 로 강제 **[활성화 승인 필요]**. 실제 차단 배선(멤버 초대·기능 라우트)은 승인 후 진행
- [x] 온보딩 흐름 — 가입 → 워크스페이스 생성 → 샘플 프로젝트
      → 신규 `lib/onboarding.ts`(순수: defaultOrgName·orgSlug·parseRegisterOptions·sampleProjectRows(today 기준 상대 일정)·onboardingSteps·summarizeOnboarding), `lib/onboardingDb.ts`(ensureSampleProject 멱등·loadOnboardingState), `api/onboarding`(GET 체크리스트 상태 / POST action=sample 관리자 전용), `api/auth/register`가 새 조직 생성 시 샘플 프로젝트(PRJ-SAMPLE: 단계4·업무6·요구2·이슈1·리스크1)를 기본 생성(createSample:false 로 생략, 실패해도 가입 성공), 대시보드 «시작 가이드» 카드(계정→워크스페이스→프로젝트→팀원 초대, 숨기기 가능) / tests/onboarding.test.ts 7건 통과(전체 154건)
- [x] 테넌트 데이터 격리 재점검 (org_id 파티션 누락 라우트 탐지)
      → 신규 `lib/tenantScan.ts`(순수 정적 점검기: drizzle 문 추출·테이블 식별·orgId 조건 판정·스프레드 조건 선언 추적·`// tenant-scan: allow(사유)` 예외)와 tests/tenantScan.test.ts 가 **실제 `app/api/**/route.ts` 전건 + DB 접근 lib 6종을 매 테스트마다 점검**(파일 79·DB 문 104건, 누락 0·미허용 원시SQL 0·허용 예외 5건 ≤ 8 상한). 점검으로 발견된 실제 누락 1건 수정: `api/issues/[id]/watchers` delete 에 orgId 조건 추가. CI 테스트에 포함되어 누락이 생기면 빌드 실패 / tests/tenantScan.test.ts 8건 통과(전체 163건, tsc rc=0)
      ※ values 가 변수인 insert 9건은 'indirect' 로만 보고(호출부 확인: crud POST·onboardingDb·audit·notifications 모두 orgId 주입 확인). 런타임 DB 레벨 격리(RLS)는 별도 [승인 필요]
- [x] 마켓플레이스 제출자료 — 서비스 개요·보안 설명·아키텍처 다이어그램
      → `docs/MARKETPLACE_SUBMISSION.md` 2026-09-16 갱신: §3 아키텍처 표에 인증(scrypt·middleware 게이트)·관측(구조화 로그·전역 에러 캡처)·CI 품질 게이트 행 추가, `/api/health` 의존성 상태·커밋 해시 설명, §3-1 Mermaid 에 로깅 계층 추가, §4 보안 설명을 인증·접근통제/감사·테넌트 격리(정적 점검 CI)·입력/무결성·보안 헤더·로깅 6절로 확장, §6 임의 가용성 수치(99.5%) 제거, §7 체크리스트 갱신
      ※ 문안 확정·법무 검토·다이어그램 이미지 첨부·SLA 수치는 **[승인 필요]**(사람 몫)

## 파트너 채널 (제이투모로우원 — 운영 대행 + 수익 배분)

계약·서비스 주체는 고원, 파트너는 영업·운영을 담당하고 수익을 배분한다.
**향후 리셀러(파트너 명의 계약)로 전환될 수 있으므로, 지금은 2계층으로 확장 가능한 형태로만 열어둔다.**

- [x] **파트너(채널) 개념 도입** — 조직/계약에 `partner_id`(nullable) 추가. 없으면 직접 계약. 스키마만 준비하고 화면 노출은 최소
      → 신규 `lib/partner.ts`(순수: tier agency/reseller·계약 주체 판정 contractParty, `PARTNER_MIGRATION_DDL` 초안(partners 테이블 + `organizations.partner_id` nullable FK ON DELETE SET NULL + 인덱스), 스위치 `partnerChannelEnabled`(PARTNER_CHANNEL_ENABLED, 기본 OFF → resolvePartnerId 항상 null=직접 계약), 코드 정규화, 조회 seam `PartnerScope`/`partnerScopeFor`/`filterOrgsByScope`, 연락처 제외 `publicPartner`, `partnerChannelStatus`) / tests/partner.test.ts 9건 통과(전체 172건, partner.ts 100%)
      ※ DDL 은 **부팅 자동 실행되는 MIGRATION_DDL 에 넣지 않았고**, drizzle `organizations` 스키마에도 partnerId 를 아직 선언하지 않음(미적용 상태에서 선언하면 select 가 깨짐) — 테스트가 두 조건을 매번 검사. 라이브 DDL 적용 → schema.ts `partnerId: integer('partner_id')` 추가 순서로 진행 **[활성화 승인 필요]**. 화면 노출 0
- [x] **매출 귀속 근거** — 어떤 고객사가 어느 파트너를 통해 유입됐는지 기록(유입 경로·계약일·담당자). 정산 분쟁을 예방하는 핵심
      → 신규 `lib/partnerAttribution.ts`(순수: `PARTNER_ATTRIBUTION_DDL` 초안(partner_attributions — org_id·partner_id nullable·코드 스냅샷·source 폐쇄목록 5종·contract_date·owner_ref·ended_at/end_reason, 조직당 열린 기록 1건 부분 유니크 인덱스), 스위치 `attributionEnabled`(PARTNER_ATTRIBUTION_ENABLED, 기본 OFF), 검증 `validateAttribution`(실존 날짜·미래 금지·파트너 경로↔파트너 id 모순 판정·담당자 연락처(이메일/전화) 거부), 종료 `closeAttribution`(수정 아닌 닫기, 계약일 이전 종료 금지), 정산 기준일 판정 `isActiveOn`/`activeAttribution`(반개구간), 무결성 점검 `auditAttributionRows`, 파트너별 유효 조직 근거 `attributionEvidence`, `publicAttribution`(memo·기록자 제외)) / tests/partnerAttribution.test.ts 12건 통과(전체 184건, partnerAttribution.ts lines 100%)
      ※ DDL 은 partners 테이블 이후 적용해야 하며 MIGRATION_DDL 미혼입(테스트가 검사). 기록 API·화면 배선은 DDL 적용 후 **[활성화 승인 필요]**. 금액·수수료 계산은 «정산 리포트» 항목에서
- [x] **파트너 역할 권한** — 파트너 담당자는 자기가 유치한 고객사만 조회. 기존 RBAC에 `partner_admin` 역할 추가(활성화는 승인)
      → 신규 `lib/partnerRbac.ts`(순수: `PARTNER_ROLE='partner_admin'`, 읽기 전용 화이트리스트 `PARTNER_READABLE_RESOURCES`(organization·subscription·attribution·settlement — 고객사 내부 업무 데이터·인원 PII 제외), `partnerCanAccess`(read 이외 액션·목록 밖 resource·스위치 OFF 전부 거부 fail-closed), 소속 `partnerIdOfMember`(정지·역할 불일치 차단), 가시 범위 `visibleOrgIds`/`canViewOrg`/`filterVisibleOrgs`는 **매출 귀속 기록(partner_attributions) 파생**(반개구간 — 귀속 종료일부터 비가시, 별도 소유권 테이블 없음), 라우트용 통합 판정 `decidePartnerAccess`, `PARTNER_RBAC_DDL` 초안(partner_members: partner_id·user_id·role·status + (partner_id,user_id) 유니크), `partnerRoleStatus`). `lib/rbac.ts` hasPermission 최상단에서 partner_admin 을 **isOrgAdmin 단축 경로보다 먼저** 분기(조직 관리자 권한 승계 차단) / tests/partnerRbac.test.ts 8건 통과(전체 192건, tsc rc=0)
      ※ 스위치 `PARTNER_ROLE_ENABLED` 기본 OFF → partner_admin 은 어떤 권한도 갖지 못한다. DDL 은 MIGRATION_DDL·schema.ts 미혼입(테스트가 매번 검사), partners 테이블 이후 적용 **[활성화 승인 필요]**. 파트너 로그인·화면 노출 0
- [x] **정산 리포트** — 파트너별 계약·이용 실적·수수료 산출 근거를 조회·내보내기. 수수료율은 설정값으로 분리(하드코딩 금지)
      → 신규 `lib/settlement.ts`(순수: 요율 설정 로더 `loadCommissionConfig`(env `PARTNER_COMMISSION_RATES` — JSON `{"DEFAULT":"20%","J2M1":0.25}` 또는 `DEFAULT=20%,J2M1=0.25` 두 형식, `PARTNER_COMMISSION_ROUNDING` floor/round/ceil 기본 floor, `PARTNER_COMMISSION_BASIS` net/gross 기본 net), `parseRate`(0~1·% 표기, 범위 밖 거부), `rateFor`(코드별 → DEFAULT → **없으면 null**), 정산 기간 `parsePeriod`(YYYY-MM 반개구간), 청구 라인 선별 `isBillableLine`·무결성 점검 `auditRevenueLines`, 집계 `buildSettlement`, 파트너별 조회 `partnerSettlementView`, 내보내기 `toSettlementCsv`/`toSettlementDetailCsv`(BOM + 수식 인젝션 방어 `csvCell`)·`settlementFilename`, 상태 `settlementStatus`) / tests/settlement.test.ts 13건 통과(전체 205건, tsc rc=0, settlement.ts lines 99.76%, 전체 커버리지 lines 98.26%)
      ※ **요율 하드코딩 없음** — 미설정이면 계산하지 않고 행 status=`rate_unconfigured` + 경고. 임의 기본 요율을 쓰지 않는다(테스트가 모듈에 요율 리터럴이 없음을 검사)
      ※ 귀속은 **청구일 단위** — 기간 중 파트너가 바뀌면 자동 분할. 귀속 기록 없는 매출은 `unattributed` 로 분리(직접 계약 partnerId=null 과 구분), 직접 계약은 수수료 대상 아님
      ※ 신규 테이블 없음(기존 청구 내역 집계). 스위치 `PARTNER_SETTLEMENT_ENABLED` 기본 OFF, 조회 API·화면 배선은 partners·partner_attributions DDL 적용 후 **[활성화 승인 필요]**. 실제 지급·세금계산서는 코드 범위 밖
- [x] **2계층 확장 여지 확보** — 테넌트 조회 경로에 파트너 필터가 나중에 끼어들 수 있도록 쿼리 계층 정리. 지금 화이트라벨은 구현하지 않음
      → 신규 `lib/tenantQuery.ts`(순수: 조회 스코프 단일 진입점 `resolveReadScope`(활성 조직 → 파트너 다중 조직 → deny), drizzle 비의존 조건 서술자 `tenantFilter`(eq/in/**deny**), `scopeOrgIds`·런타임 가드 `scopeAllows`, 단일 조직 어댑터 `soleOrgId`, 쓰기 가드 `writableOrgId`(파트너 스코프는 읽기 전용이라 거절), `TenantScopeError`, `tenantQueryStatus`). `lib/crud.ts` 목록 조회(설정기반 CRUD 40개 라우트)가 `eq(t.orgId, soleOrgId(resolveReadScope({orgId: ctx.orgId})))` 로 seam 경유 — 의미는 기존과 동일 / tests/tenantQuery.test.ts 10건 통과(전체 215건, tsc rc=0). 테넌트 격리 정적 점검(tenantScan) 전건 통과 유지
      ※ **fail-closed** — 스코프를 정할 수 없으면 "조건 없음"이 아니라 deny(0건). 다중 조직 스코프는 `soleOrgId` 가 조용히 첫 조직을 쓰지 않고 `MULTI_ORG_SCOPE_NOT_WIRED` 로 거절(테스트가 검사)
      ※ 실제 다중 조직 조회 배선(inArray 승격)·파트너 로그인·화이트라벨은 미구현 — partners·partner_attributions DDL 적용 후 **[활성화 승인 필요]**. 화면 노출 0

> 원칙: 파트너 관련 기능도 **코드는 만들되 활성화는 승인**. 실제 정산·청구는 계약서 확정 후.

