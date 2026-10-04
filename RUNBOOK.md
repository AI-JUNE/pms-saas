# RUNBOOK — 백업·복구 절차 (PRISM PMS)

작성 2026-09-05. 대상: 운영 담당자. 관련 문서: `docs/OPERATIONS.md`, `MONITORING_GUIDE.md`.

> 이 문서의 절차는 **읽기·검증 위주**로 기술한다. 실제 복구(쓰기) 실행은 담당자 승인 후 사람이 수행한다.
> 괄호 안 `[확인 필요]`는 계약/플랜에 따라 달라지는 값으로, 확정 후 이 문서에 채워 넣는다.

## 1. 보호 대상과 책임

| 자산 | 저장소 | 백업 주체 | 비고 |
| --- | --- | --- | --- |
| 애플리케이션 DB | Neon Postgres (`DATABASE_URL`) | Neon 자동 백업 + PITR | 유일한 상태 저장소. 최우선 복구 대상 |
| 소스코드 | Git 원격 저장소 | Git(분산) + AutoPush | 로컬·원격 이중화 |
| 배포 산출물 | Vercel | Vercel 빌드 이력 | 이전 배포로 즉시 롤백 가능 |
| 환경변수·시크릿 | Vercel 환경변수 | **자동 백업 없음** | 별도 보관 필요(아래 4절) |
| 업로드 파일 | (현재 DB 저장) | DB 백업에 포함 | 외부 스토리지 도입 시 이 표를 갱신할 것 |

- 백업 보존기간: Neon 플랜 기준 `[확인 필요]`
- 목표 복구시간(RTO)·목표 복구시점(RPO): `[확인 필요 — 계약 확정 후 기재]`
  ※ 실측 전에는 임의 수치를 적지 않는다.

## 2. 정기 점검 (월 1회)

1. Neon 콘솔에서 백업·PITR 활성 상태와 최신 복구 가능 시점 확인.
2. `GET /api/health` 응답에서 `db` 체크가 `ok`, `version`/`commit` 이 배포본과 일치하는지 확인.
3. **행 수 기준 스냅샷 갱신** — 슈퍼관리자로 `GET /api/admin/recovery-verify` 를 호출해
   응답의 `data.snapshot` 문자열을 그대로 복사해 환경변수 `RECOVERY_DATA_BASELINE` 에 넣는다.
   이것이 복구일에 3절 4단계가 대조할 **유일한 기준치**다(미설정이면 복구 검증이 `no_baseline` 로 멈춘다).
4. 환경변수 스냅샷이 최신인지 확인(4절).
5. 아래 6절 리허설 표에 점검 결과 1줄 기록.

## 3. DB 복구 절차 (Neon PITR)

**원칙: 운영 DB를 직접 되돌리지 않는다. 먼저 복구 브랜치를 만들어 검증한 뒤 전환한다.**

1. **중단 결정** — 데이터 손상 범위와 손상 시각 T를 특정한다. 감사로그(`/api/audit`, 슈퍼관리자는 `/api/admin/security-events`)로 T 직전 관리 작업 이력을 확인한다.
2. **쓰기 차단** — 배포를 유지보수 상태로 전환하거나 Vercel에서 트래픽을 차단한다.
3. **복구 브랜치 생성** — Neon에서 시점 T-ε 로 *새 브랜치*를 만든다(운영 브랜치는 그대로 둔다).
4. **검증** — 복구 브랜치 연결문자열을 스테이징 환경의 `DATABASE_URL`에 넣고 기동한 뒤,
   슈퍼관리자로 `GET /api/admin/recovery-verify` 를 호출한다(읽기 전용 — DDL·쓰기 없음).
   핵심 테이블 12개의 행 수를 **기준 스냅샷(`RECOVERY_DATA_BASELINE`, 아래 3-2)과 기계적으로 대조**한다.
   - `switchReady: true` 일 때만 5단계로 간다. `data.verdict` 의 뜻:
     `ok`(기준치 이상) / `short`(기준보다 적음 — `data.shortfalls` 확인) /
     `empty`(테이블은 있는데 전부 0건 = 스키마만 복원됨) / `incomplete`(핵심 테이블 자체가 없음 → 3-1) /
     `no_baseline`(기준 스냅샷 미설정 — 대조 불가, 판정 보류) / `unverified`(조회 실패 — "없음"이 아니라 "모름").
   - `short` 는 유실 확정이 아니다(정상 삭제로도 줄어든다). 감소분을 설명할 수 있을 때만 전환한다.
   - `ok` 는 **스냅샷 시점(`data.asOf`) 이상의 행 수**까지만 보장한다. 그 이후 생긴 행의 유실(RPO 구간)은
     이 점검으로 알 수 없다 — 손실 구간 고지는 그대로 해야 한다.
5. **전환** — 4단계가 `switchReady: true` 일 때만 운영 `DATABASE_URL`을 복구 브랜치로 교체하고 재배포한다.
6. **스키마 정합** — 전환 후 관리자 계정으로 `POST /api/admin/migrate` 1회 실행(멱등 DDL, `lib/migrate.ts`).
   ※ **PITR 복구 브랜치에만 유효하다.** 아래 3-1 을 먼저 읽을 것.
   ※ `applied`·`failed` 만 보고 넘어가지 말 것 — 응답의 `schema.verdict` 가 **`ok`** 여야 정합이다.
   `empty`/`incomplete` 면 `schema.missingTables` 에 없는 테이블이, `schema.action` 에 할 일이 적혀 있다.
   `failed: []` 인데 `silentSuccess: true` 라면 **적용은 다 됐지만 스키마는 복원되지 않은 상태**다(3-1 로).
   `unverified` 는 "정합"이 아니라 "확인 못 함"이다 — DB 연결·권한을 보고 직접 대조한다.
7. **사후** — `GET /api/health` 확인, 6절에 사건·조치·소요시간 기록.

> 되돌린 시점 이후의 데이터는 유실된다. 손실 구간을 반드시 이해관계자에게 고지한다.

### 3-1. 빈 DB(새 Neon 프로젝트·브랜치)로 복구할 때 — `migrate` 만으로는 복원되지 않는다

PITR 복구 브랜치는 기존 테이블을 그대로 물려받으므로 6단계만으로 충분하다. 그러나 **Neon 프로젝트 자체를
새로 만들어 빈 스키마에서 올라가는 경로**(계정·리전 이전, 프로젝트 삭제 등)에서는 사정이 다르다.

- `MIGRATION_DDL` 은 `users`·`organizations`·`projects`·`issues` 등 **기반 테이블 25개의 `CREATE TABLE` 을 담고
  있지 않다**(최초 1회 `drizzle-kit push` 로 만들어진 뒤 코드에 남지 않았다).
- 더 위험한 점: 뒤따르는 `ALTER TABLE **IF EXISTS** … ADD COLUMN` 들이 대상 테이블이 없으면 **오류 없이 전부
  건너뛴다**. `applied` 는 "예외를 던지지 않은 문장 수"라서 이 no-op 들까지 세고, `failed` 는 비어 있다.
  - 그래서 `runMigrations()` 는 적용 후 **실제 테이블 목록을 읽어 대조한다**(`lib/schemaVerify.ts`, 읽기 전용
    `information_schema` 조회). 응답의 `schema.verdict`(`ok`/`empty`/`incomplete`/`unverified`)·`schema.missingTables`·
    `schema.skippedAlters`(조용히 건너뛴 ALTER 수)·`silentSuccess` 가 그 결과다. 빈 DB 에서는 `empty` 가 나온다.
    부팅 자동 실행(`ensureSchema`)도 같은 판정을 로그에 `[ensureSchema] 스키마 미정합 …` 으로 남긴다.

그래서 빈 DB 경로는 **베이스라인 DDL 을 `migrate` 보다 먼저** 적용한다.

1. 베이스라인 DDL 을 얻는다 — `lib/schemaBaseline.ts` 의 `baselineDdl()` 이 `src/db/schema.ts` **원문에서
   도출**한다(사람이 손으로 적은 사본이 아니라서 낡지 않는다). 전건 `IF NOT EXISTS` 이고 FK 대상 테이블이
   먼저 오도록 정렬되어 있다.
   ```
   node --input-type=module -e "import fs from 'node:fs';import {parseSchemaSource,extractMigrationStatements,parseMigrationDdl,baselineDdl} from './src/lib/schemaBaseline.ts';const {model}=parseSchemaSource(fs.readFileSync('src/db/schema.ts','utf8'));const ddl=parseMigrationDdl(extractMigrationStatements(fs.readFileSync('src/lib/migrate.ts','utf8')));console.log(baselineDdl(model,ddl).map(s=>s+';').join('\n'))"
   ```
2. 출력된 문장을 **눈으로 확인한 뒤** 복구 대상 DB에 순서대로 실행한다(쓰기 작업 — 담당자 승인 후 사람이 수행).
3. 이어서 3절 6단계(`POST /api/admin/migrate`)를 실행해 이후 추가분·인덱스를 맞춘다.
4. 기계 검증: 그 응답의 `schema.verdict` 가 `ok`(= `missingTables` 가 빈 배열)인지 확인한다.
   아직 `incomplete` 면 1단계 출력 중 누락 테이블분을 다시 적용한다.
5. 눈 검증: 로그인 → 프로젝트·이슈 조회가 **빈 목록이 아니라 실제 데이터**를 내는지 확인한다.
   (`verdict: ok` 는 "테이블이 있다"까지만 보장한다 — 행이 복원됐는지는 보장하지 않는다.)

> 베이스라인 DDL 은 의도적으로 `MIGRATION_DDL` 에 배선하지 않았다 — 부팅 시 자동으로 테이블을 만드는 것은
> 승인 사항이다 **[승인 필요]**. `tests/schemaBaseline.test.ts` 가 실제 `schema.ts`·`migrate.ts` 를 매번 대조해
> 위 25개 목록이 바뀌면(새 테이블을 CREATE DDL 없이 추가하면) CI 를 실패시킨다.

### 3-2. 기준 스냅샷 — 없으면 4단계가 「대조」가 아니라 눈대중이 된다

4단계는 행 수를 **무언가와** 비교해야 성립한다. 그 비교 대상이 `RECOVERY_DATA_BASELINE` 이다.
미설정이면 응답이 `data.verdict: no_baseline` 으로 나오고 `switchReady` 는 **false 로 유지된다** —
"기준이 없으니 통과"로 올려 주지 않는다(`lib/recoveryVerify.ts`).

- 값 형식(둘 중 아무거나):
  - `asOf=2026-10-01,users=12,organizations=3,projects=5,…`
  - `{"asOf":"2026-10-01","counts":{"users":12,"projects":5}}`
- 값은 **사람이 넣는다.** 스냅샷 문자열 자체는 점검 응답의 `data.snapshot` 에 붙여 넣을 수 있는 형태로
  들어 있으니 그대로 복사한다(아래 2절 월 점검 3번).
- 담당자 이름·조직명 같은 식별 정보는 들어가지 않는다 — 테이블 이름과 행 수뿐이다.
- 핵심 테이블(12개)과 그 선정 사유는 `lib/recoveryVerify.ts` 의 `CORE_TABLE_ROLES` 에 있고,
  테스트가 실제 `src/db/schema.ts` 선언과 매번 대조한다(없는 테이블을 넣어 두면 CI 실패).

> 한계를 숨기지 않는다: 이 엔드포인트는 로그인을 요구하므로 **`users` 조차 없는 빈 DB 경로에서는 닿을 수 없다**.
> 그 경로의 판정은 `POST /api/admin/migrate` 의 `schema.verdict` 와 부팅 로그가 담당한다(위 3-1).

## 4. 환경변수·시크릿 복구

Vercel 환경변수는 DB 백업에 포함되지 않으므로 별도 보관한다.

> ⚠️ **이 목록이 복구의 전부다.** 빠진 키는 복구 후에도 오류를 내지 않고 **조용히 기본값으로 되돌아간다** —
> 서비스는 뜨지만 확정본 약관이 「초안」으로, 고지된 수탁자가 「고지 전」으로, 정산이 계산 중단 상태로 돌아간다.
> 그래서 목록을 코드(`lib/envRegistry.ts`)에 정본으로 두고, 테스트가 **실제 소스에서 읽는 키**와 아래 표를
> 매번 대조한다. 어긋나면 CI 가 실패하므로 이 표는 더 이상 낡을 수 없다(자동 채움은 하지 않는다 — 사람이 적는다).

#### 4-1. 필수 (없으면 동작하지 않는다)

| 환경변수 | 성격 | 설명 |
| --- | --- | --- |
| `DATABASE_URL` | 시크릿 | Neon Postgres 연결 문자열. 유일한 상태 저장소 |
| `SESSION_COOKIE` | 설정 | 세션 쿠키 이름(미설정 시 기본값). 바꾸면 기존 세션이 모두 무효가 된다 |

#### 4-2. 관측 (미설정 시 해당 기능만 OFF, 서비스는 정상)

`MONITORING_ENABLED`(스위치) · `SENTRY_DSN`(시크릿) · `ALERT_WEBHOOK_URL`(시크릿) · `LOG_LEVEL` · `APP_VERSION`

#### 4-3. 결제 (기본 OFF — **활성화는 승인 필요**)

`PORTONE_STORE_ID` · `PORTONE_CHANNEL_KEY` · `PORTONE_API_SECRET`(시크릿) · `PORTONE_WEBHOOK_SECRET`(시크릿) ·
`PAYMENTS_LIVE`(스위치) · `BILLING_APPLY_LIVE`(스위치)

#### 4-4. 요금제·엔타이틀먼트

`ENTITLEMENTS_ENFORCE`(스위치 — 좌석·기능 제한을 관측에서 차단으로 승격) · `PRICING_FREE_TRIAL_SEATS`(미설정 시 가격 화면이 아무 약속도 하지 않는다)

#### 4-5. 법적 문서 — **유실 시 고지 내용이 후퇴한다. 최우선 복구 대상**

| 환경변수 | 유실되면 |
| --- | --- |
| `LEGAL_DOCS_FINAL` | 확정본 약관·처리방침이 운영에서 「초안」 배너로 되돌아간다 |
| `LEGAL_TERMS_VERSION`, `LEGAL_TERMS_EFFECTIVE` | 이용약관 버전·시행일 표기가 사라진다(draft 유지 fail-safe) |
| `LEGAL_PRIVACY_VERSION`, `LEGAL_PRIVACY_EFFECTIVE` | 처리방침 버전·시행일 표기가 사라진다 |
| `LEGAL_CONSENT_REQUIRED` | 가입 동의 강제가 관측 모드로 내려간다 |
| `PRIVACY_PROCESSORS` | 처리위탁 고지 목록이 「아직 고지 전」으로 되돌아간다 |
| `PRIVACY_CROSS_BORDER` | 국외 이전 고지 절이 사라진다 |

#### 4-6. 파트너 채널 (전부 기본 OFF — **활성화는 승인 필요**)

`PARTNER_CHANNEL_ENABLED` · `PARTNER_ATTRIBUTION_ENABLED` · `PARTNER_ROLE_ENABLED` · `PARTNER_SETTLEMENT_ENABLED`(이상 스위치) ·
`PARTNER_COMMISSION_RATES`(유실 시 정산이 `rate_unconfigured` 로 계산을 멈춘다) · `PARTNER_COMMISSION_ROUNDING` · `PARTNER_COMMISSION_BASIS`

#### 4-7. 복구 리허설 (6절과 같은 키)

`RECOVERY_REHEARSAL_INTERVAL_DAYS` · `RECOVERY_LAST_REHEARSAL` · `RECOVERY_LAST_REHEARSAL_RESULT` · `RECOVERY_LAST_REHEARSAL_KIND` — 의미는 6절 표 참조.
`RECOVERY_DATA_BASELINE` — 핵심 테이블 행 수 기준 스냅샷(위 3-2). **유실되면 복구일에 대조 기준이 사라져
`data.verdict` 가 `no_baseline` 로 떨어지고 `switchReady` 가 올라가지 않는다.** 2절 월 점검에서 갱신한다.

#### 4-8. 사이트·포털

`SITE_URL` · `NEXT_PUBLIC_SITE_URL` · `NEXT_PUBLIC_ERM_URL`(사내 제안분석 바로가기 — 미설정 시 링크를 만들지 않는다)

※ `NEXT_PUBLIC_` 접두사는 **클라이언트 번들에 평문으로 인라인**된다. 시크릿에 이 접두사를 쓰지 않는다(테스트가 검사).
※ `VERCEL_ENV`·`VERCEL_URL`·`VERCEL_GIT_COMMIT_SHA` 등 플랫폼이 자동 주입하는 키는 복구 대상이 아니다.

#### 4-9. 절차

값 자체는 이 저장소에 커밋하지 않는다. 키 **목록**만 안전한 비밀 보관소에 스냅샷으로 유지하고, 값은 각 발급처(Neon·PortOne 등)에서 재발급한다.
복구 후 확인 순서:

1. 위 4-1 두 개가 들어갔는지 → `GET /api/health` 의 `db` 체크가 `ok`.
2. 활성화 스위치가 **의도한 상태**인지 — 특히 `PAYMENTS_LIVE`·`BILLING_APPLY_LIVE`가 기본 OFF인지 반드시 재확인한다.
   스위치는 `true` 문자열일 때만 ON 이다(`1`·`yes`·공백은 OFF 유지).
3. 4-5 법적 문서 키가 복구됐는지 → `/terms`·`/privacy` 에 「초안」 배너가 없고 버전·시행일이 표기되는지 눈으로 확인.
4. 4-6 파트너 키는 계약 상태에 맞게. 미설정이면 전건 직접 계약으로 동작한다.

## 5. 배포 롤백 (코드 문제일 때)

DB 손상이 아니라 배포 회귀라면 DB를 건드리지 말고 배포만 되돌린다.

1. Vercel 배포 목록에서 직전 정상 배포를 Promote(롤백).
2. `GET /api/health` 의 `commit` 이 롤백 대상과 일치하는지 확인.
3. 원인 커밋을 수정 후 재배포. AutoPush(20분 주기)가 자동 반영한다.

## 6. 복구 리허설 기록

리허설은 **운영 DB가 아닌 복구 브랜치**에서 수행한다. 실제 수행 후 사람이 아래 표에 기록한다.
(자동화 에이전트는 이 표를 임의로 채우지 않는다 — 미실시 상태를 그대로 둔다.)

| 일자 | 유형(정기/사건) | 복구 대상 시점 | 소요시간 | 검증 결과 | 담당 | 비고 |
| --- | --- | --- | --- | --- | --- | --- |
| (미실시) | | | | | | 최초 리허설 예정 `[확인 필요]` |

### 기한 추적 (자동)

위 표는 사람이 채우지만, **미실시·기한초과가 잊히지 않도록** `lib/recovery.ts`가 기계적으로 판정한다.

- `GET /api/health` → `checks.recovery.detail.rehearsal` 에 `status`(missing/stale/failing/ok)·`lastDate`·`ageDays`·`dueDate`·해야 할 일(`action`)이 노출된다.
  판정용 체크라서 **required: false** — 리허설 미실시로 서비스가 down(503)이 되지는 않고 `degraded`(200)로만 표시된다.
- 리허설을 실제로 수행하면 위 표에 기록하고, 아래 환경변수를 갱신한다(값 없으면 "미실시"로 남는다).

| 환경변수 | 값 | 설명 |
| --- | --- | --- |
| `RECOVERY_REHEARSAL_INTERVAL_DAYS` | 예: `180` | 리허설 주기(일). **미설정이면 기한 판정을 하지 않는다** — 임의 기본 주기를 쓰지 않는다 `[확인 필요]` |
| `RECOVERY_LAST_REHEARSAL` | `YYYY-MM-DD` | 마지막 리허설 일자. 형식 밖·비실존 날짜·미래 날짜는 무효 처리 |
| `RECOVERY_LAST_REHEARSAL_RESULT` | `정상` / `부분 통과` / `실패` | `정상`이 아니면 `failing` — 기한 내여도 `ok`가 되지 않는다 |
| `RECOVERY_LAST_REHEARSAL_KIND` | `정기` / `사건` | 선택 |

> 담당자 이름·비고는 환경변수에 넣지 않는다(공개 엔드포인트 노출 방지). 사람 정보는 위 표에만 둔다.

### 리허설 체크리스트

- [ ] Neon 복구 브랜치 생성 성공
- [ ] 스테이징에서 애플리케이션 기동 성공
- [ ] 로그인·프로젝트 조회·이슈 조회 정상
- [ ] `POST /api/admin/migrate` 멱등 실행 성공 — 응답 `schema.verdict` 가 `ok` 인지 확인(`failed: []` 만으로는 부족)
- [ ] `GET /api/admin/recovery-verify` 의 `switchReady` 가 `true` — `schema.verdict: ok` 만으로는 부족하다
      (스키마만 복원되고 행이 비어 있어도 `ok` 가 나온다). `no_baseline` 이면 3-2 를 먼저 설정한다
- [ ] `GET /api/health` 전 항목 정상
- [ ] 소요시간 측정 및 위 표 기록
- [ ] 리허설 브랜치 정리
