# PRISM(PMS) 운영 매뉴얼 · SLA 초안

작성 2026-08-03 (자동 초안) · 상태: **초안 — 운영값·연락처·SLA 수치 확정은 [승인 필요]**

## 1. 시스템 개요
- 스택: Next.js 14(App Router) + Drizzle ORM + Neon(PostgreSQL, serverless)
- 배포: Windows AutoPush → git push → Vercel 자동 배포(main)
- 인증: 세션 쿠키(`pms_session`, httpOnly) + RBAC. `/api/auth/auto`(데모 자동로그인)는 비활성.
- 결제: 포트원 스캐폴딩(테스트키). `PAYMENTS_LIVE=true` 승격은 [승인 필요].

## 2. 환경 변수 (운영 필수)
| 변수 | 용도 | 비고 |
|---|---|---|
| `DATABASE_URL` | Neon 연결 문자열 | 운영/스테이징 분리 권장 |
| `SESSION_COOKIE` | 세션 쿠키명 | 기본 `pms_session` |
| `PORTONE_STORE_ID` / `PORTONE_CHANNEL_KEY` | 결제 스캐폴딩 | 테스트키만. 라이브 키 주입 [승인 필요] |
| `PORTONE_API_SECRET` / `PORTONE_WEBHOOK_SECRET` | 웹훅 서명검증 | 클라이언트 노출 금지 |
| `PAYMENTS_LIVE` | 실결제 스위치 | **항상 미설정/false 유지, 변경 [승인 필요]** |

## 3. 헬스체크·모니터링
- `GET /api/health` — DB 연결 포함 상태 응답. 외부 업타임 모니터(1분 간격) 연결 권장.
- 구조화 로깅: `src/lib/logger.ts` (JSON, level 필드). Vercel 로그에서 `level:error` 필터.
- Sentry: 스텁만 존재. DSN 주입·실연동은 [승인 필요].

## 4. 감사 로그
- 테이블 `audit_log`. CRUD 변이는 `audit()`(orgId=조직), 인증·결제 보안 이벤트는 `auditSecurity()`(orgId=0 sentinel).
- 이벤트: `AUTH_LOGIN`, `AUTH_LOGIN_FAIL`, `AUTH_LOGOUT`, `AUTH_REGISTER(_JOIN)`, `BILLING_CHECKOUT_SCAFFOLD`, `<RESOURCE>_CREATE/UPDATE/DELETE`.
- PII 정책: 감사로그에 이메일 원문 저장 금지 — `maskEmail()` 마스킹만 저장.
- 조회: `/api/audit` (조직 스코프 최근 100건). orgId=0 보안 이벤트 열람 화면은 추후 슈퍼관리자 전용으로 추가 예정.

## 5. 배포 절차
1. 로컬 검증: `node_modules/.bin/tsc --noEmit -p tsconfig.json` → `node --test tests/*.test.ts` → 필요 시 `next build`
2. 커밋(자동화는 커밋까지만) → Windows AutoPush가 push → Vercel 배포
3. 배포 후 확인: `/api/health` 200, 로그인/대시보드 스모크, Vercel 함수 에러 로그 0건

## 6. 장애 대응 (Runbook)
| 증상 | 1차 조치 |
|---|---|
| 5xx 급증 | Vercel 함수 로그 확인 → 직전 배포 Instant Rollback |
| DB 연결 실패 | Neon 콘솔 상태·연결수 확인, `DATABASE_URL` 유효성 확인 |
| 로그인 불가 | `sessions` 테이블 확인, 쿠키 도메인/HTTPS 설정 확인, rate limit(429) 여부 |
| 결제 웹훅 오류 | 서명검증 실패 로그 확인(`PORTONE_WEBHOOK_SECRET` 불일치가 최다 원인) |
- 롤백: Vercel 대시보드 Instant Rollback(이전 배포로 즉시 전환). DB 마이그레이션 롤백은 파괴적일 수 있어 [승인 필요].

## 7. 백업·데이터
- Neon PITR(시점 복구) 사용 — 보존 기간 운영 플랜 확인 [승인 필요].
- 파괴적 마이그레이션·대량 삭제는 자동 실행 금지, 사전 스냅샷 후 사람 승인.

## 8. SLA 초안 (계약 전 내부 목표 — 수치 확정 [승인 필요])
- 가용성 목표: 월 99.5%(Basic/Pro), 99.9%(Enterprise 협의)
- 장애 대응: 접수 후 L1 응답 4영업시간, 전면장애 복구 목표 24시간
- 정기점검: 사전 48시간 고지, 월 1회 이내
- 데이터: 일 백업(PITR), 탈퇴·해지 시 30일 보관 후 파기(개인정보 처리방침과 정합)
- 지원 채널: 이메일(운영 확정 [승인 필요]) / Enterprise 전용 채널 협의

## 9. 상용 활성화 게이트 (자동 실행 금지)
실결제 ON(`PAYMENTS_LIVE`) · Sentry 실연동 · 라이브 PG 키 주입 · 운영 DB 파괴적 변경 · 실개인정보 대량 처리 — 전부 사람 승인 후 수동 진행.
