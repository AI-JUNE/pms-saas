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

- 백업 보존기간(PITR 보존 창): Neon 플랜 기준 `[확인 필요]`
  ※ 이 칸이 비어 있으면 복구일에 **「그 시점으로 되돌릴 수 있는가」를 판정할 수 없다**. 확인한 값을
  환경변수 `RECOVERY_PITR_RETENTION_HOURS`(시간)에 함께 넣는다 — 그때부터 `GET /api/health` 의
  `checks.recoveryWindow` 가 미설정을 평상시에 드러내고, 3절 3단계가 기계적으로 판정된다(아래 3-6).
  임의 기본 보존기간은 쓰지 않는다(Neon 플랜마다 다르다).
- 목표 복구시간(RTO)·목표 복구시점(RPO): `[확인 필요 — 계약 확정 후 기재]`
  ※ 실측 전에는 임의 수치를 적지 않는다.

## 2. 정기 점검 (월 1회)

1. Neon 콘솔에서 백업·PITR 활성 상태와 **복구 가능 시점(History retention)** 확인.
   - 그 **보존 창 길이(시간)를 수치로 기록**하고 `RECOVERY_PITR_RETENTION_HOURS` 와 1절 표를 갱신한다.
     확인만 하고 수치를 남기지 않으면 복구일에 「T 가 창 안인지」를 판정할 수 없다(아래 3-6).
   - `GET /api/health` → `checks.recoveryWindow.detail.retentionConfigured` 가 `true` 인지 함께 본다.
     플랜을 바꾸면 보존 창도 바뀌므로, 코드는 이 값을 추측하지 않고 **사람이 적은 값만** 쓴다.
2. `GET /api/health` 응답에서 `db` 체크가 `ok`, `version`/`commit` 이 배포본과 일치하는지 확인.
3. **행 수 기준 스냅샷 갱신** — 슈퍼관리자로 `GET /api/admin/recovery-verify` 를 호출해
   응답의 `data.snapshot` 문자열을 그대로 복사해 환경변수 `RECOVERY_DATA_BASELINE` 에 넣는다.
   이것이 복구일에 3절 4단계가 대조할 **유일한 기준치**다(미설정이면 복구 검증이 `no_baseline` 로 멈춘다).
   - ⚠️ **이 복사는 「정상 운영 중」인 지금만 한다.** 복구 검증 중에 같은 값을 넣으면 복구 대상 DB 를
     자기 자신과 비교하게 되어 이후 모든 판정이 `ok` 가 된다. 응답의 `data.snapshotUse.adopt` 가
     `forbidden` 이면 이번 응답의 수치는 기준치로 쓸 수 없다는 뜻이다(3-2 참조).
   - 이 단계를 거르면 스냅샷이 낡는다. 낡은 수치는 현재 규모보다 낮으므로 **행을 잃은 DB 도
     「기준치 이상」을 만족**시킨다 — 그래서 갱신 기한을 `RECOVERY_BASELINE_MAX_AGE_DAYS` 로 두고
     기한을 넘기면 `data.verdict` 가 `stale` 로 떨어져 `switchReady` 가 올라가지 않는다.
4. 환경변수 스냅샷이 최신인지 확인(4절). `RECOVERY_EXPECTED_DB` 를 남겨 두었다면
   `checks.dbIdentity.detail.verdict` 가 `match` 인지 함께 본다 — `mismatch` 면 연결 대상이
   바뀐 것이다(의도한 변경이면 지문을 갱신한다. 3-4).
5. `GET /api/health` 의 `checks.recovery.detail.baseline.status` 가 `ok` 인지 확인
   (`stale`/`undated`/`absent` 면 위 3번이 밀린 것이다. `unjudged` 는 기한 미설정 상태).
6. 아래 6절 리허설 표에 점검 결과 1줄 기록.

## 3. DB 복구 절차 (Neon PITR)

**원칙: 운영 DB를 직접 되돌리지 않는다. 먼저 복구 브랜치를 만들어 검증한 뒤 전환한다.**

1. **중단 결정** — 데이터 손상 범위와 손상 시각 T를 특정한다. 감사로그(`/api/audit`, 슈퍼관리자는
   `/api/admin/security-events`)로 T 직전 관리 작업 이력을 확인한다.
   - 기간(`from`·`to`)을 **반드시 지정**하고, 응답의 `capture.verdict` 가 **`truncated`** 가 아닌지 본다.
     `truncated` 면 결과가 limit 에서 잘렸고, 정렬이 id 내림차순이라 **빠진 쪽은 가장 오래된 기록 =
     바로 그 「T 직전」**이다. 화면에서는 「결과가 잘렸습니다」 경고와 «이전 기록 더 불러오기» 로 이어 받는다.
   - ⚠️ **이 감사로그는 복구 대상과 같은 DB 에 있다.** 5단계 전환은 복구 시점 이후의 감사 이력을 함께
     되돌리므로, 조사 근거·원인 작업 기록·조사 자체의 열람 이력이 전부 사라진다. **3단계로 넘어가기 전에
     아래 3-5 의 보존을 먼저 한다.**
   - ⚠️ **T 를 특정했으면 2단계로 넘어가기 전에 「그 시점으로 되돌릴 수 있는지」를 먼저 본다**(아래 3-6).
     T 가 PITR **보존 창** 밖이면 복구 자체가 불가능한데, 2단계는 **쓰기 차단(전 사용자 저장 503)**이다 —
     순서를 바꾸면 **복구는 불가능한데 서비스는 멈춘 상태**가 되고 그때는 선택지가 남지 않는다.
     보존 창의 하한은 **시간과 함께 전진하므로** 조사·근거 보존에 쓰는 시간만큼 T 가 창 밖으로 밀려난다.
     3-6 의 `deadline`(이 시점으로 브랜치를 만들 수 있는 마지막 시각)을 먼저 적어 두고 조사한다.
2. **쓰기 차단** — 운영 배포의 환경변수 `RECOVERY_WRITE_FREEZE=true` 로 **읽기전용 모드**를 켠다(아래 3-3).
   조회는 그대로 열려 있고 저장·수정·삭제만 503 으로 거절된다.
   - 확인: `GET /api/health` → `checks.writeFreeze.detail.frozen` 이 **`true`** 인지 본다.
   - ⚠️ **그 `frozen` 이 `true` 로 바뀐 시각을 같은 스코프의 `RECOVERY_WRITE_FREEZE_AT` 에 적어 둔다**
     (타임존을 붙인 ISO 시각. 환경변수를 **저장한** 시각이 아니라 **실효된** 시각이다).
     이 값이 8단계에서 고지할 **유실 구간의 끝**이고, 7단계에서 차단을 풀면 그 시각을 아는 수단이
     어디에도 남지 않는다 — 지금이 기록할 수 있는 유일한 시점이다(아래 3-7).
     확인: `checks.incidentClosure.detail.state` 가 **`recorded`** 인지 본다(`frozen_unrecorded` 면 비어 있다).
     이 확인을 거르면 「차단한 줄 알았는데 안 걸린」 상태로 3~5단계를 진행하게 되고,
     그 사이 들어온 쓰기는 5단계 전환에서 **조용히 사라진다**(4단계 검증은 복구 브랜치를 보므로
     운영 DB 로 계속 들어오는 쓰기를 전혀 보지 못한다).
   - ⚠️ **Vercel 트래픽 차단으로 대신하지 말 것** — 4단계의 `/api/admin/recovery-verify`,
     6단계의 `/api/admin/migrate`, 확인용 `/api/health` 가 모두 같은 배포 뒤에 있어 복구 자신이 막힌다.
3. **복구 브랜치 생성** — Neon에서 시점 **T-ε** 로 *새 브랜치*를 만든다(운영 브랜치는 그대로 둔다).
   - 복구 시점과 보존 창 판정은 **아래 3-6 의 1줄 명령으로 산출한다**. ε(여유분)을 눈대중으로 정하지 않는다 —
     너무 작으면 손상 트랜잭션이 복구 브랜치에 그대로 들어오는데, **4단계 대조는 행 수만 보므로
     변조·부분 삭제는 「기준치 이상」을 그대로 통과한다**(행 수가 줄지 않는다). 너무 크면 유실 구간만 커진다.
   - `verdict` 가 `ok` 일 때만 그 시점으로 만든다. `expired` 면 **그 시점으로는 만들 수 없다**(3-6 판정 표).
     `unknown_window` 는 「창 밖」이 아니라 「보존 창을 몰라 판정하지 않았다」는 뜻이다.
   - 만든 브랜치의 **지문**을 아래 3-4 명령으로 산출해 적어 둔다(4단계 대조에 쓴다).
4. **검증** — 복구 브랜치 연결문자열을 스테이징 환경의 `DATABASE_URL`에 넣고 기동한 뒤,
   슈퍼관리자로 `GET /api/admin/recovery-verify` 를 호출한다(읽기 전용 — DDL·쓰기 없음).
   핵심 테이블 12개의 행 수를 **기준 스냅샷(`RECOVERY_DATA_BASELINE`, 아래 3-2)과 기계적으로 대조**한다.
   - `switchReady: true` 일 때만 5단계로 간다. `data.verdict` 의 뜻:
     `ok`(기준치 이상) / `short`(기준보다 적음 — `data.shortfalls` 확인) /
     `empty`(테이블은 있는데 전부 0건 = 스키마만 복원됨) / `incomplete`(핵심 테이블 자체가 없음 → 3-1) /
     `no_baseline`(기준 스냅샷이 없거나 핵심 테이블을 덜 덮음 — `data.uncovered` 확인, 대조 불가) /
     `stale`(기준 스냅샷이 갱신 기한을 넘김 → 3-2) / `undated`(기준일이 없거나 미래 → 3-2) /
     `unverified`(조회 실패 — "없음"이 아니라 "모름").
   - `short` 는 유실 확정이 아니다(정상 삭제로도 줄어든다). 감소분을 설명할 수 있을 때만 전환한다.
   - `ok` 는 **스냅샷 시점(`data.asOf`) 이상의 행 수**까지만 보장한다. 그 이후 생긴 행의 유실(RPO 구간)은
     이 점검으로 알 수 없다 — 그 구간이 며칠인지는 `data.age.blindWindow` 에 수치로 적혀 있다.
     손실 구간 고지는 그대로 해야 한다.
   - **무엇을 세고 있는지 먼저 본다** — 응답의 `identity.fingerprint`·`identity.hostMasked` 가
     3단계에서 만든 **복구 브랜치**인지 확인한다(아래 3-4 의 산출 명령과 대조). 스테이징에
     운영 연결문자열을 잘못 넣으면 **손상된 운영 DB 의 행 수**를 세고 `ok` 가 나온다.
     `identity.verdict` 가 `mismatch` 면 `switchReady` 는 자동으로 false 가 된다.
   - ⚠️ **여기서 `data.snapshot` 을 `RECOVERY_DATA_BASELINE` 에 넣지 않는다.** 지금 세고 있는 DB 가
     바로 의심 대상이므로, 그 수치를 기준치로 삼으면 손상이 「정상」으로 굳는다
     (`data.snapshotUse` 에 같은 경고가 들어 있다). 스냅샷 갱신은 §2 월 점검에서만 한다.
5. **전환** — 4단계가 `switchReady: true` 일 때만 운영 `DATABASE_URL`을 복구 브랜치로 교체하고,
   같은 스코프(Production)에 **기준 지문** `RECOVERY_EXPECTED_DB` 를 함께 넣은 뒤 **재배포한다**(아래 3-4).
   - 확인: `GET /api/health` → `checks.dbIdentity.detail.verdict` 가 **`match`** 인지 본다.
     `mismatch` 면 **교체가 이 배포에 반영되지 않았다** — 운영은 아직 손상된 DB 를 보고 있다.
   - ⚠️ **환경변수 저장만으로는 바뀌지 않는다.** Vercel 환경변수는 **재배포 전까지** 기존 배포에
     반영되지 않고, Preview·Development 스코프에만 넣으면 Production 은 옛 값을 그대로 쓴다.
     이 확인을 거르면 6단계 `schema.verdict` 는 손상된 DB 에도 테이블이 다 있으므로 **`ok`** 가 나오고,
     7단계에서 차단을 풀면 서비스가 정상으로 보인다 — **복구는 「성공」으로 끝나고 복구된 데이터는
     아무도 쓰지 않는다.** 그 뒤의 쓰기는 손상된 DB 에 쌓여 두 번째 복구 기회까지 줄어든다.
6. **스키마 정합** — 전환 후 관리자 계정으로 `POST /api/admin/migrate` 1회 실행(멱등 DDL, `lib/migrate.ts`).
   ※ **PITR 복구 브랜치에만 유효하다.** 아래 3-1 을 먼저 읽을 것.
   ※ `applied`·`failed` 만 보고 넘어가지 말 것 — 응답의 `schema.verdict` 가 **`ok`** 여야 정합이다.
   `empty`/`incomplete` 면 `schema.missingTables` 에 없는 테이블이, `schema.action` 에 할 일이 적혀 있다.
   `failed: []` 인데 `silentSuccess: true` 라면 **적용은 다 됐지만 스키마는 복원되지 않은 상태**다(3-1 로).
   `unverified` 는 "정합"이 아니라 "확인 못 함"이다 — DB 연결·권한을 보고 직접 대조한다.
7. **쓰기 차단 해제** — 6단계의 `schema.verdict` 가 `ok` 인 것을 확인한 뒤에만
   `RECOVERY_WRITE_FREEZE` 를 지우고(또는 `false`) 재배포한다.
   확인: `GET /api/health` → `checks.writeFreeze.detail.frozen` 이 `false`.
   ※ 이 단계를 잊으면 복구가 끝난 서비스가 **읽기전용으로 남는다** — 사용자에게는 저장이
   되지 않는 장애로 보이고, `/api/health` 는 `degraded` 로만 표시된다(503 이 아니므로
   업타임 모니터는 조용하다). 그래서 해제 확인을 절차에 넣어 둔다.
8. **사후** — 다음 네 가지를 **순서대로** 한다. 「`/api/health` 보고 표에 적는다」로 끝내지 않는다.
   1. `GET /api/health` 전 항목 확인 — 특히 `checks.writeFreeze.detail.frozen` 이 `false`(7단계 완료),
      `checks.dbIdentity.detail.verdict` 가 `match`(5단계 반영).
   2. **유실 구간을 확정해 고지한다** — 아래 **3-7 의 1줄 명령**으로 산출한다. 눈대중으로 적지 않고,
      §3-6 의 `lossMinutes` 를 그대로 쓰지도 않는다(그 값은 **산출한 순간까지**라 1단계에서 산출하면
      조사·근거 보존·승인에 쓴 시간이 빠져 **실제보다 작다**). 구간의 끝은 2단계에서 적어 둔
      `RECOVERY_WRITE_FREEZE_AT` 이다. 끝을 모르면 판정이 `end_unrecorded` 로 남는다 —
      그때는 **구간을 수치로 단정하지 말고** 모른다는 사실을 고지에 적는다.
   3. 6절 표에 사건·조치·소요시간 기록 — 소요시간은 **1단계 중단 결정 ~ 7단계 차단 해제**다
      (3-7 의 `assessDuration`). 표 초안 한 줄은 3-7 이 만들어 주지만 **붙여 넣는 것은 사람**이다.
   4. `RECOVERY_WRITE_FREEZE_AT` 를 **지운다.** 남겨 두면 다음 사건에서 **옛 시각이 구간의 끝**으로
      쓰인다. 평상시에 남아 있으면 `checks.incidentClosure.detail.state` 가 `stale_record` 로 드러난다.

> 되돌린 시점 이후의 데이터는 유실된다. 손실 구간을 반드시 이해관계자에게 고지한다.
> 2단계 차단을 **언제** 걸었는지가 그 구간의 끝이다(차단 이후의 쓰기는 애초에 없다) — 그래서
> 그 시각을 2단계에서 `RECOVERY_WRITE_FREEZE_AT` 에 적어 두고 8단계에서 구간을 확정한다(아래 3-7).

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
  들어 있으니 그대로 복사한다(위 2절 월 점검 3번).
- 담당자 이름·조직명 같은 식별 정보는 들어가지 않는다 — 테이블 이름과 행 수뿐이다.
- 핵심 테이블(12개)과 그 선정 사유는 `lib/recoveryVerify.ts` 의 `CORE_TABLE_ROLES` 에 있고,
  테스트가 실제 `src/db/schema.ts` 선언과 매번 대조한다(없는 테이블을 넣어 두면 CI 실패).

**기준치가 자격을 잃는 세 가지** — 수치가 기준치 이상이어도 `ok` 로 올라가지 않는다(`lib/recoveryBaseline.ts`).

| `data.verdict` | 뜻 | 무엇을 해야 하나 |
| --- | --- | --- |
| `no_baseline` | 스냅샷이 없거나 **핵심 테이블을 덜 덮었다**(`data.uncovered`) | 덮이지 않은 테이블은 대조 자체가 안 된 것이다. 복구일이라면 눈대중이 아니라 다른 근거로 판단한다 |
| `undated` | 기준일(`asOf`)이 없거나 **미래 일자**다 | 시점을 모르는 수치는 「손상 전 기대치」가 아니다. §2 에서 `asOf=` 를 포함해 다시 설정한다 |
| `stale` | 기준일이 `RECOVERY_BASELINE_MAX_AGE_DAYS` 를 넘겼다 | 낡은 수치는 유실된 DB 도 통과시킨다. §2 월 점검 주기를 지킨다 |

> **복구일에 스냅샷을 다시 뜨는 것이 이 절의 유일한 금기다.** `stale`·`undated`·`no_baseline` 을 만난
> 담당자가 가장 하기 쉬운 행동이 「그럼 지금 다시 떠서 넣자」인데, 그러면 복구 대상 DB 를 자기 자신과 비교
> 하게 되어 **그 뒤 모든 판정이 영구히 `ok`** 가 된다. 손상 전 수치는 이전 월 점검 기록·모니터링
> 이력·Neon 원본 브랜치 조회로 확인하고, §3 4단계는 사람이 판단한다.

- 갱신이 밀린 것을 잊지 않도록 `GET /api/health` → `checks.recovery.detail.baseline` 에
  `status`(ok/stale/undated/future/unjudged/absent)·`asOf`·`ageDays`·`dueDate`·`action` 이 노출된다.
  리허설 체크와 같은 **required: false** 라 서비스를 down 시키지 않고 `degraded`(200)로만 드러난다.
  행 수는 담지 않는다(공개 엔드포인트) — 기준일과 덮은 테이블 **수**뿐이다.

> 한계를 숨기지 않는다: 이 엔드포인트는 로그인을 요구하므로 **`users` 조차 없는 빈 DB 경로에서는 닿을 수 없다**.
> 그 경로의 판정은 `POST /api/admin/migrate` 의 `schema.verdict` 와 부팅 로그가 담당한다(위 3-1).

### 3-3. 쓰기 차단(읽기전용 모드) — 2단계를 실제로 수행·확인 가능하게 하는 장치

2단계는 오랫동안 **수행할 수 없는 문장**이었다. 「유지보수 상태」가 코드에 없었고, 남은 선택지인
「Vercel 트래픽 차단」은 복구 자신(검증·migrate·health)을 막는다. 그래서 실제로는 차단 없이 3~5단계를
진행하게 되고, 그 사이 운영 DB 에 들어온 쓰기는 5단계 전환에서 조용히 사라진다 —
**검증은 `switchReady: true`, 전환도 성공이므로 복구는 「성공」으로 보인다.**

- 켜는 법: 운영 배포 환경변수 `RECOVERY_WRITE_FREEZE=true` → 재배포. `'true'` 문자열일 때만 ON 이다
  (`1`·`yes`·공백은 OFF 유지).
- 걸리는 범위: `POST`·`PUT`·`PATCH`·`DELETE` **전건**(`src/middleware.ts` 가 전 경로를 덮으므로
  설정기반 CRUD 40개 라우트와 앞으로 생길 라우트까지 함께 걸린다). 목록 밖 메서드도 차단한다
  (모르는 메서드를 「읽기」로 가정하지 않는다).
- 응답: `503` + `{"ok":false,"code":"WRITE_FROZEN", …}` + `Retry-After`.
  ※ `Retry-After` 값은 클라이언트 백오프 힌트이고 **RTO 약속이 아니다**(RTO/RPO 는 §1 `[확인 필요]`).
- 조회(`GET`·`HEAD`·`OPTIONS`)는 열려 있다 — 담당자가 화면으로 상태를 보면서 복구할 수 있다.

**예외로 통과시키는 쓰기 경로**(복구 자신이 쓰는 경로. 사유는 `lib/writeFreeze.ts` 의 `FREEZE_EXEMPT`)

| 경로 | 왜 막지 않는가 |
| --- | --- |
| `POST /api/admin/migrate` | 6단계 스키마 정합(멱등 DDL). 막으면 복구 절차가 진행되지 않는다 |
| `POST /api/auth/login` | 세션 발급. 막으면 4·6단계의 슈퍼관리자 엔드포인트에 닿을 수 없다 |
| `POST /api/auth/logout` | 세션 종료. 담당자가 계정을 바꿔 붙어야 할 수 있다 |
| `POST /api/client-errors` | 장애 중 클라이언트 오류 수집. 끊기면 복구 중 오류의 원인을 못 찾는다 |

> **차단이 걸렸다는 것이 「유실 없음」을 뜻하지는 않는다.** 막지 못하는 경로를 그대로 적어 둔다
> (`/api/health` 의 `checks.writeFreeze.detail.limits` 에도 같은 목록이 나온다):
> `DATABASE_URL` 로 직접 붙는 쓰기(psql·Neon 콘솔)는 앱을 거치지 않아 막히지 않는다 ·
> 같은 `DATABASE_URL` 을 쓰는 다른 배포(프리뷰·스테이징·로컬)는 **각자 켜야 한다** ·
> 위 예외 경로는 통과한다 · 차단을 켠 순간 처리 중이던 요청은 끝까지 진행된다 ·
> 외부 웹훅(결제 등)도 503 을 받으므로 제공자 재시도에 의존하고, 재시도 만료분은 수동 대조가 필요하다.

- 끄는 법·잊었을 때: §3 7단계. 끄지 않으면 **복구가 끝난 서비스가 읽기전용으로 남고**
  `/api/health` 는 `degraded`(200)로만 표시된다(`required: false` 이므로 503 이 아니다).
- 왜 복구 검증 응답(`/api/admin/recovery-verify`)에 합치지 않았나: 검증은 **스테이징**에서 복구
  브랜치를 보고, 차단은 **운영 배포**에 걸린다. 서로 다른 배포의 상태를 한 응답에 합치면 거짓
  보증이 된다 — `/api/health` 는 각 배포가 **자기 차단 상태만** 말한다.
- `tests/writeFreeze.test.ts` 가 실제 `src/middleware.ts` 원문을 매번 점검한다 — 게이트 호출이
  빠지거나 `matcher` 가 `/api` 를 제외하게 바뀌면 CI 가 실패한다(화면은 그대로 돌기 때문에
  사람 눈으로는 알아챌 수 없는 회귀다).

### 3-4. 연결 대상 확인 — 5단계 「전환」이 실제로 반영됐는지 보는 유일한 수단

5단계는 오랫동안 **확인할 수 없는 문장**이었다. 「운영 `DATABASE_URL` 을 교체하고 재배포한다」고만
적혀 있고, 그 교체가 **이 배포에 반영됐는지** 보는 수단이 없었다. 뒤따르는 확인은 전부 통과한다 —
`checks.db` 는 `select 1` 이라 어느 DB 든 ok, 6단계 `schema.verdict` 는 손상된 운영 DB 에도 테이블이
다 있으므로 `ok`, 7단계에서 차단을 풀면 화면도 정상이다. **복구는 「성공」으로 끝나고 복구된
데이터는 아무도 쓰지 않는다.**

- 지문(fingerprint) = 연결 문자열에서 **자격증명을 버리고** 호스트(Neon 엔드포인트)와 DB 이름만
  남겨 만든 12자리 16진수다(`lib/dbIdentity.ts`). 비밀번호·사용자명은 애초에 들어가지 않는다.
- 복구 브랜치의 지문 산출 — Neon 이 보여 주는 복구 브랜치 연결문자열을 **환경변수로 넘겨** 실행한다
  (명령행에 붙여넣으면 셸 히스토리에 비밀번호가 남는다):
  ```
  DB=<복구 브랜치 연결문자열> node --input-type=module -e "import {dbFingerprint} from './src/lib/dbIdentity.ts';console.log(dbFingerprint(process.env.DB))"
  ```
- 4단계(스테이징): 응답의 `identity.fingerprint` 가 위 값과 같은지 본다. 다르면 스테이징이 다른 DB
  (흔한 실수는 **운영 연결문자열**)를 보고 있다 — 행 수 대조는 그 DB 에 대한 판정이므로 의미가 없다.
- 5단계(운영): `DATABASE_URL` 과 함께 `RECOVERY_EXPECTED_DB=<위 지문>` 을 **같은 스코프
  (Production)** 에 넣고 재배포한 뒤 `GET /api/health` → `checks.dbIdentity.detail.verdict` 를 본다.

| `verdict` | 뜻 | 무엇을 해야 하나 |
| --- | --- | --- |
| `match` | 이 배포가 기준 지문의 DB 를 본다 | 전환이 반영됐다. 6단계로 간다 |
| `mismatch` | **다른 DB 를 보고 있다** | 재배포를 했는지, 스코프가 Production 인지, 값이 잘려 들어가지 않았는지 본다. 운영은 아직 손상된 DB 를 보고 있을 수 있다 |
| `unset` | 기준 지문 미설정(**평상시 상태**) | 복구 중이라면 위 지문을 넣는다. 평상시에는 이 상태가 정상이며 degraded 로 만들지 않는다 |
| `invalid_expected` | 값을 읽을 수 없다 | 12자리 16진수만 넣는다. **연결 문자열을 넣지 않는다**(비밀번호가 한 벌 더 복제된다 — 그런 값은 비교하지 않고 거절한다) |
| `unknown_actual` | `DATABASE_URL` 자체를 읽을 수 없다 | 대조가 성립하지 않는다. 「일치」로 올리지 않는다 |

> **지문이 맞았다는 것이 「복구 성공」을 뜻하지는 않는다.** 보장하지 못하는 것을 그대로 적어 둔다
> (`checks.dbIdentity.detail.limits`·4단계 응답 `identity.limits` 에도 같은 목록이 나온다):
> 지문은 「**어느 DB 를 보도록 설정됐는가**」까지만 말하고 그 DB 의 데이터가 옳은지는 4단계가 본다 ·
> Neon 에서 운영 브랜치를 **제자리 복구**하면 엔드포인트가 그대로여서 **지문이 바뀌지 않는다**
> (그 경로는 지문으로 확인할 수 없다) · pooled(`-pooler`)와 직결은 같은 브랜치이므로 **같은 지문**이다 ·
> 컴퓨트 재생성·엔드포인트 변경은 같은 데이터인데도 `mismatch` 를 만든다(기준 지문을 다시 산출한다) ·
> 이 값은 **그 배포 자신의** 설정만 말한다 · 기준 지문은 사람이 넣는 값이라 전환과 함께 갱신하지
> 않으면 옛 기준으로 `mismatch` 가 난다.

- 복구가 끝난 뒤 `RECOVERY_EXPECTED_DB` 는 **지워도 되고 남겨도 된다.** 남겨 두면 이후 누군가
  `DATABASE_URL` 을 바꿨을 때 `mismatch` 로 드러난다(연결 대상 고정). 엔드포인트를 의도적으로
  바꿀 때 함께 갱신하는 것을 잊으면 거짓 경고가 나므로, 그때는 §2 월 점검에서 같이 본다.
- 신규 조회·쓰기 0 — 판정은 환경변수 해석만으로 한다. `tests/dbIdentity.test.ts` 가 실제
  `src/db/index.ts` 원문을 점검해 **DB 클라이언트가 다른 연결 키로 옮겨 가면 CI 를 실패시킨다**
  (지문이 엉뚱한 DB 를 가리키면서 계속 `match` 를 내는 것이 가장 조용한 회귀다). `/api/health`·
  4단계 라우트의 배선도 원문으로 함께 고정한다.

### 3-5. 조사 근거 보존 — 복구가 감사 이력을 되돌리기 전에

`audit_log` 는 **복구 대상과 같은 DB·같은 브랜치**에 있다. 3단계에서 T-ε 브랜치를 만들고 5단계에서
전환하면 `created_at > T-ε` 인 감사 기록이 전부 없어진다 — 손상을 일으킨 작업의 기록, 차단 전까지
들어온 쓰기의 흔적, 1단계 조사 자체의 열람 이력까지. 그런데 `lib/recoveryVerify.ts` 의
`CORE_TABLE_ROLES` 는 이 테이블을 「**사후 조사·법적 보존 대상이라 재생성이 불가능하다**」고 선언해
두었고, §3 8단계·§6 표의 사건 기록은 그 이력 위에서 쓰게 되어 있다. 전환 후에 열어 보면 그 구간은
**비어 있는 것이 아니라 「아무 일도 없었던 것처럼」** 보인다 — 오류가 나지 않으므로 아무도 알아채지 못한다.

**전환 전에 할 일** (쓰기 없음 — 조회·내보내기뿐. 실행·보관은 **[사람 수행 필요]**)

1. 사라질 구간을 수치로 확인한다(고지 문구에 그대로 쓴다):
   ```
   node --input-type=module -e "import {discardWindow} from './src/lib/incidentEvidence.ts';console.log(discardWindow('<T-ε ISO 시각>').text)"
   ```
2. 손상 구간의 감사로그를 **끝까지** 받아 DB 밖(사내 보관소·티켓 첨부)에 저장한다.
   `capture.verdict` 가 `complete` 가 될 때까지 `capture.nextCursor` 로 이어 받는다:
   ```
   GET /api/audit?from=YYYY-MM-DD&to=YYYY-MM-DD&limit=500
   GET /api/audit?from=…&to=…&limit=500&cursor=<앞 응답의 capture.nextCursor>   # nextCursor 가 null 이 될 때까지
   ```
   - 슈퍼관리자는 보안·인증 이벤트를 `/api/admin/security-events`(응답 `nextCursor`)로 함께 받는다.
   - 저장 위치는 **복구 대상 DB 밖**이어야 한다. 같은 DB 안의 테이블·메모에 옮겨 적으면 함께 사라진다.
   - 받은 파일에는 행위자 **이름**이 들어 있다 — 접근통제되는 보관소에 둔다.
3. `capture.verdict` 가 `truncated` 로 남은 채 전환하지 않는다. 그 상태는 「T 직전을 못 봤다」는 뜻이고,
   전환하면 다시 볼 기회가 없어진다. 커서로 끝까지 받을 수 없으면 기간을 더 좁혀 나눠 받는다.

> **감사로그가 보장하지 못하는 것**(응답 `capture.limits` 에도 같은 목록이 나온다):
> 앱을 거친 변경만 남는다 — `DATABASE_URL` 로 직접 붙은 쓰기(psql·Neon 콘솔)·DDL 은 기록되지 않는다 ·
> 기록은 대상(entity·entityId)만 남고 **값의 이전/이후를 남기지 않는다**(무엇이 어떻게 바뀌었는지는
> 복구 브랜치와 대조해야 안다) · 감사 기록 자체의 실패는 본 요청을 깨뜨리지 않고 흡수되므로
> **기록이 없는 것이 「일어나지 않았다」는 증거는 아니다** · `/api/audit` 는 **조직 스코프**이고
> `/api/admin/security-events` 는 보안·인증 이벤트만 본다 — **다른 조직의 업무 데이터 변경 이력을 보는
> 경로는 아직 없다**(전 테넌트 손상 범위는 이 화면으로 특정할 수 없다. 교차 테넌트 조사 경로는
> 슈퍼관리자 전용 신설이 필요한 **[승인 필요]** 사항이다) · 보존 기간(`AUDIT_RETENTION_DAYS`) 표기
> 밖의 기록은 조회 대상에서 빠진다.

- `tests/incidentEvidence.test.ts` 가 실제 `app/api/audit/route.ts`·`app/audit/page.tsx` 원문을 매번
  점검한다 — 판정을 응답에서 빼거나, 화면이 단발 조회로 되돌아가거나, 정렬이 `desc(audit_log.id)` 에서
  바뀌면(커서가 조용히 어긋난다) CI 가 실패한다. 화면은 그대로 돌기 때문에 사람 눈으로는 「최근 200건」과
  「잘린 200건」을 구분할 수 없는 회귀다.
- 자동화는 보존을 **대신하지 않는다** — 판정·구간 산출까지만 하고, 내보내기 실행과 보관은 사람이 한다.

### 3-6. 복구 시점 산출 — 3단계의 「T-ε」과 보존 창

3단계는 오랫동안 **산출할 수 없는 문장**이었다. 「시점 T-ε 로 브랜치를 만든다」고만 적혀 있고,
ε 를 무엇으로 정하는지, T 가 **되돌릴 수 있는 범위(PITR 보존 창) 안인지** 보는 수단이 없었다.
보존기간은 §1 에 `[확인 필요]` 로 비어 있었고 §2 월 점검도 수치를 남기지 않았다. 그래서 담당자는
1~2단계 — 그 2단계가 **쓰기 차단**이다 — 를 모두 수행한 뒤 3단계에서야 복구 불가를 알게 되고,
그때는 **복구는 불가능한데 서비스는 멈춘 상태**다.

**복구 시점 산출** (읽기·계산뿐 — DB·네트워크 접근 0. ε 결정은 **[사람 수행 필요]**)

```
node --input-type=module -e "import {restorePointStatus,restorePointText} from './src/lib/recoveryWindow.ts';console.log(restorePointText(restorePointStatus({damageAt:'2026-10-09T13:05:00+09:00',epsilonMinutes:10})))"
```

- `damageAt` = 1단계에서 특정한 손상 시각 T. **타임존을 반드시 붙인다** — 없으면 UTC 로 읽혀
  한국시간 기준 9시간 이른 시점이 되고(`caveats` 에 경고가 나온다), 그만큼 유실 구간이 커진다.
- `epsilonMinutes` = ε(분). **기본값이 없다** — 주지 않으면 `invalid_epsilon` 으로 멈춘다.
  근거 있게 고르는 방법(응답 `epsilonRules`):
  - 1단계 감사로그에서 **원인 작업의 직전 기록** 시각을 찾아 T 와의 간격을 쓴다(가장 근거 있다).
  - 감사 조회가 `truncated` 로 남아 있으면 ε 를 정할 근거가 아직 없다 — §3-5 로 끝까지 받은 뒤 정한다.
  - ε 를 키우면 복구 가능성이 아니라 **유실 구간만** 커진다. 창 안에서 작게, 다만 원인 작업보다 앞서게.
- 보존 창 길이는 `RECOVERY_PITR_RETENTION_HOURS`(시간)에서만 읽는다. 미설정이면 판정을 **보류**한다 —
  Neon 플랜별 기본값(24시간 등)을 코드가 추측하지 않는다. 평상시 설정 여부는
  `GET /api/health` → `checks.recoveryWindow.detail.retentionConfigured` 로 드러난다.

| `verdict` | 뜻 | 무엇을 해야 하나 |
| --- | --- | --- |
| `ok` | T-ε 가 보존 창 안이다 | 그 시점으로 브랜치를 만든다. `deadline` 전에 해야 한다 |
| `expired` | **창 밖이다 — 그 시점으로는 만들 수 없다** | 콘솔의 복구 가능 시점을 다시 확인하고, 창 안의 가장 이른 시점으로 복구할지(손상 일부 포함 가능 → 4단계 판단) 또는 §5 롤백·수동 정정으로 갈지 **사람이 결정**한다. 2단계 차단을 이미 걸었다면 해제 여부도 함께 판단한다 |
| `future` | T 가 현재보다 미래다 | 오타·타임존 확인(KST 를 UTC 로 적으면 9시간 미래가 된다) |
| `invalid_time` | T 를 읽을 수 없다 | 타임존을 붙인 ISO 시각으로 적는다 |
| `invalid_epsilon` | ε 가 없거나 범위 밖이다 | 위 규칙으로 ε 를 정한다. 임의 기본값을 쓰지 않는다 |
| `unknown_window` | 보존 창을 몰라 **판정하지 않았다** | 「창 밖」이 아니다. `RECOVERY_PITR_RETENTION_HOURS` 를 넣고, 이번 복구는 콘솔 표기를 정본으로 판단한다 |

- 함께 나오는 수치: `restorePoint`(Neon 콘솔에 넣을 T-ε) · `lossMinutes`(유실 구간의 **산출 시각 기준
  참고값**) · `deadline`(이 시점으로 브랜치를 만들 수 있는 **마지막 시각**) · `remainingMinutes`.
- ⚠️ **`lossMinutes` 를 고지 수치로 쓰지 않는다.** 그 값은 `복구 시점 ~ 이 명령을 실행한 순간`이다 —
  위 순서대로 1단계에서 산출하면 조사·근거 보존(§3-5)·승인에 쓴 시간이 **빠져 실제보다 작고**,
  3단계 이후에 산출하면 차단 이후까지 세어 크다. 고지할 구간은 8단계에서 **아래 3-7** 로 확정한다.
- ⚠️ **마감은 계속 당겨진다.** 보존 창의 하한은 현재 시각과 함께 전진하므로, 같은 T 가 어제는 창
  안이었어도 오늘은 밖이다. 조사·승인에 시간을 쓸 때 `deadline` 을 먼저 적어 두고 그 안에 3단계를 끝낸다.

> **보존 창 안이라는 것이 「복구 성공」을 뜻하지 않는다.** 보장하지 못하는 것(응답 `limits`):
> 보존기간은 **사람이 적은 설정값**이라 플랜·설정 변경을 코드가 알 수 없다(정본은 Neon 콘솔) ·
> 보존 창은 **브랜치별로 다르고** 자식 브랜치는 분기 시점보다 이전으로 갈 수 없다 ·
> 프로젝트·컴퓨트 삭제로 히스토리 자체가 없어진 경우는 창 계산과 무관하게 복구 불가 ·
> 이 판정은 **시점의 가용성**만 본다(브랜치 생성 성공·데이터 정합은 3단계 수행과 4단계 대조가 본다) ·
> 그 시점의 데이터가 **손상 전**이라는 보장은 아니다 — T 특정이 틀렸으면 손상된 시점으로 복구한다.

- `tests/recoveryWindow.test.ts` 가 실제 `RUNBOOK.md` 와 `app/api/health/route.ts` 원문을 매번 점검한다 —
  3단계가 「T-ε 로 브랜치를 만든다」 한 문장으로 되돌아가거나, `checks.recoveryWindow` 배선이 빠지면
  CI 가 실패한다(화면·응답은 그대로 돌기 때문에 사람 눈으로는 알아챌 수 없는 회귀다).

### 3-7. 유실 구간 확정 — 8단계의 고지와 §6 표 기록

§3 말미는 「손실 구간을 반드시 이해관계자에게 고지한다. **2단계 차단을 언제 걸었는지가 그 구간의
끝이다**」라고 적어 두었는데, 정작 그 「언제」가 **어디에도 기록되지 않았다**. 쓰기 차단은
`RECOVERY_WRITE_FREEZE` 불리언 하나이고 `/api/health` 는 현재 상태(`frozen`)만 말하며, **7단계는 그
스위치를 지우라고 지시한다** — 해제한 뒤에는 차단이 걸려 있었다는 사실조차 응답에 남지 않는다.
그래서 8단계의 고지 구간은 사람 기억에 의존했고, 손에 든 유일한 수치(§3-6 의 `lossMinutes`)는
**산출한 순간까지**라 고지 수치가 아니었다(1단계에서 산출하면 실제보다 작다).

**유실 구간 산출** (읽기·계산뿐 — DB·네트워크 접근 0)

```
node --input-type=module -e "import {lossWindowStatus,closureText} from './src/lib/incidentClosure.ts';console.log(closureText(lossWindowStatus({restorePoint:'2026-10-09T12:55:00+09:00',frozenAt:'2026-10-09T13:40:00+09:00'})))"
```

- `restorePoint` = **실제로** 브랜치를 만든 시점(3단계). §3-6 산출값과 다를 수 있다(창 밖이라 더 이른
  시점을 썼거나 제자리 복구를 했을 때) — 그때는 **실제 적용한 시점**을 쓴다.
- `frozenAt` = 2단계에서 적어 둔 `RECOVERY_WRITE_FREEZE_AT`(차단이 **실효된** 시각).
  차단을 걸지 않았다면 대신 `switchedAt`(5단계 전환 시각)을 넘긴다 — 그때는 전환 직전까지가 유실 대상이다.
- 소요시간(§6 표)은 `assessDuration({startedAt, endedAt})` — **1단계 중단 결정 ~ 7단계 차단 해제**.
  §6 표 한 줄 초안은 `incidentRecordDraft({...})` 가 만든다(`row`·`missing`). **표는 사람이 채운다.**

| `verdict` | 뜻 | 무엇을 해야 하나 |
| --- | --- | --- |
| `ok` | 구간이 확정됐다 | `notice` 를 고지에 쓰고 같은 수치를 §6 표 비고에 남긴다 |
| `end_unrecorded` | **끝이 기록되지 않았다** | 구간을 추정하지 않는다. 차단 당시의 배포 로그·`/api/health` 보관본·§3-5 보존본에서 「마지막으로 받아들인 쓰기」 시각을 찾는다. 끝내 모르면 **구간을 단정하지 말고 그 사실을 고지에 적는다** |
| `invalid_restore_point` | 복구 시점을 읽을 수 없다 | 타임존을 붙인 ISO 시각으로 적는다 |
| `invalid_end` | 끝 시각을 읽을 수 없다 | 같다 — 못 읽는 값으로 구간을 세지 않는다 |
| `end_before_restore` | 끝이 복구 시점보다 앞이다 | 정상적으로는 없는 일이다. 두 값을 확인한다(타임존 누락이 제1 용의자). **음수를 0 으로 바꿔 「유실 없음」으로 적지 않는다** |
| `future_end` | 끝이 현재보다 미래다 | 오타·타임존 확인 |

- 평상시 점검: `GET /api/health` → `checks.incidentClosure.detail.state` —
  `normal`(차단 OFF·미기록, 평상시) / `recorded`(차단 중·기록됨) /
  **`frozen_unrecorded`**(차단 중인데 시각이 비어 있다 — **지금** 넣어야 한다) /
  `invalid_record`(값을 못 읽는다) / **`stale_record`**(차단은 풀렸는데 값이 남아 있다 → 8단계 4번).
  `required: false` 라 어느 경우에도 503 이 되지 않는다(degraded 200).
- 사건 기록을 마치면 `RECOVERY_WRITE_FREEZE_AT` 를 **지운다** — 남으면 다음 사건의 구간 끝이 된다.

> **구간을 확정했다는 것이 「이만큼만 유실됐다」는 뜻이 아니다.** 보장하지 못하는 것(응답 `limits`):
> 구간은 **시간 범위**일 뿐이고 유실 **건수·대상**은 §3-5 보존본과 대조해야 한다(보존본이 없으면
> 전환으로 사라져 사후 재구성이 불가능하다) · 차단이 막지 못한 경로(`DATABASE_URL` 직접 접속·같은 DB 를
> 쓰는 다른 배포·예외 경로·외부 웹훅, 응답 `freezeLimits`)의 쓰기는 **구간 끝 이후에도** 들어왔을 수 있다 ·
> 차단을 켠 순간 처리 중이던 요청은 끝까지 진행되므로 경계가 그 초에 정확히 끊기지 않는다 ·
> 이 수치는 한 사건의 실측이고 **RPO 약속이 아니다**(§1 의 RTO/RPO 는 여전히 `[확인 필요]`) ·
> 4단계의 `blindWindow`(스냅샷 이후)와는 **다른 구간**이다.

- `tests/incidentClosure.test.ts` 가 실제 `RUNBOOK.md` 와 `app/api/health/route.ts` 원문을 매번 점검한다 —
  8단계가 「health 확인하고 6절에 기록」 한 줄로 되돌아가거나, 2단계에서 `RECOVERY_WRITE_FREEZE_AT`
  기록 지시가 빠지거나, `checks.incidentClosure` 배선이 사라지면 CI 가 실패한다.

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
`RECOVERY_BASELINE_MAX_AGE_DAYS` — 위 스냅샷의 갱신 기한(일, 예: `35`). **미설정이면 낡음 판정을 하지 않는다** —
임의 기본 주기를 쓰지 않는다(리허설 주기와 같은 규율). 설정하면 기한을 넘긴 스냅샷이 `stale` 로 떨어진다 `[확인 필요]`
`RECOVERY_PITR_RETENTION_HOURS` — Neon PITR **보존 창 길이(시간, 예: `168`)**. 위 3-6. §2 월 점검에서
콘솔의 「복구 가능 시점」을 확인해 적는다. **미설정이면 복구 시점이 창 안인지 판정하지 않는다**(`unknown_window`) —
임의 기본 보존기간을 쓰지 않는다. 유실되면 복구일 3단계에서야 복구 불가가 드러난다(그때는 2단계 쓰기
차단으로 서비스가 이미 멈춘 뒤다) `[확인 필요]`
`RECOVERY_WRITE_FREEZE` — 쓰기 차단(읽기전용 모드) 스위치. 위 3-3. **평상시에는 반드시 없어야 한다** —
복구 때 켠 뒤 지우지 않으면 복구가 끝난 서비스가 읽기전용으로 남는다(`/api/health` 가 `degraded`로만 드러낸다).
복구 후 확인 순서 2번에서 `PAYMENTS_LIVE`·`BILLING_APPLY_LIVE` 와 함께 OFF 인지 재확인한다.
`RECOVERY_WRITE_FREEZE_AT` — 위 차단이 **실효된** 시각(타임존 붙인 ISO. 위 3-7). **유실 구간의 끝**이고
사후에는 복원할 수 없는 값이다 — 2단계에서 차단과 **함께** 넣고, 8단계 기록을 마치면 **지운다**
(남겨 두면 다음 사건에서 옛 시각이 구간의 끝으로 쓰인다). 평상시에는 없어야 한다.
`RECOVERY_EXPECTED_DB` — 전환 확인용 **연결 대상 지문**(12자리 16진수. 위 3-4). 연결 문자열이 아니다 —
그런 값은 비교하지 않고 `invalid_expected` 로 거절한다. **미설정이 평상시 상태**이고, 유실되면
5단계 전환이 반영됐는지 기계적으로 확인할 수 없게 된다(눈으로는 어느 DB 를 보는지 알 수 없다).

#### 4-8. 메일·첨부 저장소·감사 보존 (전부 기본 미연동 — **활성화는 승인 필요**, 2026-10-07 배치181)

| 환경변수 | 미설정(기본)이면 | 유실되면 |
| --- | --- | --- |
| `MAIL_PROVIDER` | log 스텁 — 비밀번호 재설정 메일이 **실제로 나가지 않는다**(화면이 그 사실을 안내하고 관리자 초기화로 유도) | 재설정 메일이 조용히 멈춘다. 지원 provider 배선은 아직 없다 — 값을 넣어도 `unsupported` 로 보낸 척하지 않는다 |
| `PASSWORD_RESET_TTL_MIN` | 30분 | 유효시간이 기본값으로 돌아간다(5~1440 밖은 기본값) |
| `STORAGE_PROVIDER` | 메타데이터 전용 — 첨부 **본문을 저장하지 않고** 파일명·크기·형식·만료일만 기록(status=`metadata_only`) | 첨부가 메타데이터 전용으로 돌아간다. 지원 provider 배선은 아직 없다 |
| `ATTACHMENT_MAX_MB` | 20 | 상한이 기본값으로 |
| `ATTACHMENT_RETENTION_DAYS` | 365 — **운영 확정 전 기본값** `[확인 필요]` | 만료일 계산이 기본값으로. 삭제 작업은 없다(표시용) |
| `AUDIT_RETENTION_DAYS` | 365 — 응답·화면에 「운영 확정 전 기본값」으로 표기 `[확인 필요]` | 보존 기간 표기가 기본값으로. **자동 삭제는 어디에도 없다** — 정리 작업은 별도 승인 |

#### 4-9. 사이트·포털

`SITE_URL` · `NEXT_PUBLIC_SITE_URL` · `NEXT_PUBLIC_ERM_URL`(사내 제안분석 바로가기 — 미설정 시 링크를 만들지 않는다)

※ `NEXT_PUBLIC_` 접두사는 **클라이언트 번들에 평문으로 인라인**된다. 시크릿에 이 접두사를 쓰지 않는다(테스트가 검사).
※ `VERCEL_ENV`·`VERCEL_URL`·`VERCEL_GIT_COMMIT_SHA` 등 플랫폼이 자동 주입하는 키는 복구 대상이 아니다.

#### 4-10. 절차

값 자체는 이 저장소에 커밋하지 않는다. 키 **목록**만 안전한 비밀 보관소에 스냅샷으로 유지하고, 값은 각 발급처(Neon·PortOne 등)에서 재발급한다.
복구 후 확인 순서:

1. 위 4-1 두 개가 들어갔는지 → `GET /api/health` 의 `db` 체크가 `ok`.
2. 활성화 스위치가 **의도한 상태**인지 — 특히 `PAYMENTS_LIVE`·`BILLING_APPLY_LIVE`·`RECOVERY_WRITE_FREEZE`가
   기본 OFF인지 반드시 재확인한다. 스위치는 `true` 문자열일 때만 ON 이다(`1`·`yes`·공백은 OFF 유지).
3. 4-5 법적 문서 키가 복구됐는지 → `/terms`·`/privacy` 에 「초안」 배너가 없고 버전·시행일이 표기되는지 눈으로 확인.
4. 4-6 파트너 키는 계약 상태에 맞게. 미설정이면 전건 직접 계약으로 동작한다.
5. 전환 직후라면 `checks.dbIdentity.detail.verdict` 가 `match` 인지 → **어느 DB 를 보고 있는지** 확인(위 3-4).
   `checks.db` 의 `ok` 는 어느 DB 든 통과하므로 1번만으로는 전환 반영을 알 수 없다.

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

- [ ] 손상 구간 감사로그를 기간 지정으로 조회해 `capture.verdict` 가 `complete` 가 될 때까지 받았다(§3-5)
- [ ] 받은 기록을 **복구 대상 DB 밖**에 보관했다 — 전환하면 그 구간은 사라진다
- [ ] 복구 시점을 §3-6 명령으로 산출했다 — `verdict` 가 `ok` 이고 ε 의 근거(원인 작업 직전 기록)를 적었다
- [ ] 산출한 `deadline` 을 적어 두고 그 안에 브랜치를 만들었다(보존 창 하한은 시간과 함께 전진한다)
- [ ] 쓰기 차단(§3 2단계) ON — `GET /api/health` 의 `checks.writeFreeze.detail.frozen` 이 `true`
- [ ] 그 `true` 를 확인한 시각을 `RECOVERY_WRITE_FREEZE_AT` 에 적었다 —
      `checks.incidentClosure.detail.state` 가 `recorded`(§3-7. 해제 후에는 이 시각을 알 수 없다)
- [ ] 차단 중 쓰기가 실제로 거절되는지 1건 확인(예: `PATCH` 아무 자원 → `503` + `code: WRITE_FROZEN`)
- [ ] Neon 복구 브랜치 생성 성공 — 그 브랜치의 **지문**을 §3-4 명령으로 산출해 적어 둔다
- [ ] 스테이징에서 애플리케이션 기동 성공
- [ ] 스테이징이 보는 DB 가 복구 브랜치인지 — `GET /api/admin/recovery-verify` 의
      `identity.fingerprint` 가 위 지문과 같다(운영 연결문자열을 잘못 넣으면 손상된 DB 를 센다)
- [ ] 로그인·프로젝트 조회·이슈 조회 정상
- [ ] `POST /api/admin/migrate` 멱등 실행 성공 — 응답 `schema.verdict` 가 `ok` 인지 확인(`failed: []` 만으로는 부족)
- [ ] `GET /api/admin/recovery-verify` 의 `switchReady` 가 `true` — `schema.verdict: ok` 만으로는 부족하다
      (스키마만 복원되고 행이 비어 있어도 `ok` 가 나온다). `no_baseline`·`stale`·`undated` 면 3-2 를 본다
- [ ] 리허설 중에는 `data.snapshot` 을 `RECOVERY_DATA_BASELINE` 에 **넣지 않았다**(기준치를 덮으면 안 된다)
- [ ] 전환(§3 5단계) 리허설이라면 `RECOVERY_EXPECTED_DB` 를 넣고 재배포 후
      `checks.dbIdentity.detail.verdict` 가 `match` 인지 확인 — **재배포 없이는 반영되지 않는다**(§3-4)
- [ ] 쓰기 차단 **해제**(§3 7단계) — `checks.writeFreeze.detail.frozen` 이 `false` 로 돌아왔다
- [ ] `GET /api/health` 전 항목 정상
- [ ] 유실 구간을 §3-7 명령으로 산출했다 — `verdict` 가 `ok` 이고 `notice` 를 기록했다
      (리허설이라면 고지 대상은 없지만 **구간을 산출할 수 있는지**가 점검 대상이다)
- [ ] 소요시간 측정(§3-7 `assessDuration`: 1단계 중단 결정 ~ 7단계 차단 해제) 및 위 표 기록
- [ ] `RECOVERY_WRITE_FREEZE_AT` 를 지웠다 — `checks.incidentClosure.detail.state` 가 `normal`
- [ ] 리허설 브랜치 정리
