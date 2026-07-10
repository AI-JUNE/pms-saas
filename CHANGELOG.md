# PRISM PMS — 변경 이력 (CHANGELOG)

> 야간 자동 개발이 매 실행마다 최신 항목을 **맨 위에** 추가합니다.
> 아침에 `배포.ps1` 실행 → GitHub 푸시 → Vercel 자동배포.

## 2026-07-10 (배치 50 — 배포 대기, 인터페이스 연동테스트 상태 배지 색상화)
- ⑥/⑧ **인터페이스 '연동테스트'(testStatus) 상태 배지 색상화** — 인터페이스 목록의 '연동테스트' 컬럼이 그동안 무색 일반 텍스트(미실시/진행/완료)로만 표시돼 다른 상태 컬럼과 달리 한눈에 스캔되지 않던 것을 개선. 컬럼에 `badge:true`를 부여해 Pill 배지로 렌더(미실시=회색·진행=파랑·완료=초록). lib/ui.tsx BADGE와 ResourceView STATUS_COLOR에 3개 한글 상태값 색상 키를 additive로 추가. testStatus가 select 필드이므로 배지 셀이 monday식 **인라인 드롭다운 편집**까지 자동 지원(다른 상태 셀과 동일 UX). 순수 표시/색상 매핑이라 데이터·API·스키마 무영향, 마이그레이션 불필요. 해당 한글 값(미실시/진행/완료)은 앱 내 어디서도 저장값으로 쓰이지 않아 색상 오적용 충돌 없음(검증). — src/lib/ui.tsx, src/components/ResourceView.tsx, src/app/interfaces/page.tsx
- ⑥ 안전 백로그·⑧ monday UX·⑤ 테스트가 모두 [x] 소진, ROADMAP 잔여 `[ ]`는 전부 대형/주간 수동(⑦·라인17)이라 야간 금지 대상 → 배치40/41을 잇는 가독성 보너스 폴리시로 진행(신규 테이블 미접촉). ROADMAP 변경 없음.
- 검증: `tsc --noEmit` 통과(에러 0). 작업 전 src 백업(/tmp/bak). (야간 OneDrive 마운트 동기화 지연으로 3개 마운트 사본 꼬리 잘림 → 호스트 원본 무결성 확인 후 python(utf-8)으로 백업+동일 치환 재구성해 0에러·깨진문자 0 재확인.)

## 2026-07-10 (배치 49 — 배포 대기, 커스텀 산출물 양식 + 리포트 기성고)
- ⑦ **커스텀 산출물 양식(form_definitions) — 안전 MVP** — 프로젝트별 산출물 템플릿을 정의·표준화하는 도메인 신설. 신규 `form_definitions` 테이블(양식명·대상 산출물 유형·항목 구성(fields, 줄바꿈 구분)·설명·상태, 코드 FORM)과 전용 화면 `/form-definitions`(내비 '실행' 그룹, 산출물·결재 아래). 팀이 산출물 양식의 항목 구성을 등록해 표준화. (동적 폼 렌더링은 ResourceView 대공사라 고위험 → 별도 세션; 이번엔 정의/표준화 기반을 안전하게 제공.) — src/db/schema.ts, src/lib/migrate.ts, src/lib/configs.ts, src/app/api/form-definitions/route.ts(신규), src/app/api/form-definitions/[id]/route.ts(신규), src/app/form-definitions/page.tsx(신규), src/components/Shell.tsx(내비)
- ③ **리포트 기성고·스냅샷 추이 섹션** — 리포트 화면에 프로젝트 기성고 스냅샷(기준·기준일·계획%·실적%·기성률 바)을 표로 표시. 배치45 스냅샷 데이터를 종합 리포트에서 한눈에 확인. — src/app/reports/page.tsx
- 신규 테이블 1개 + 리포트 표시 강화. migrate.ts DDL로 배포 시 자동 반영. 제네릭 CRUD+config 기반, 중앙 ResourceView 미접촉(저위험).
- 검증: `tsc --noEmit` 통과(에러 0). 작업 전 src 백업. 마운트 무결성(깨진문자 0) 확인.

## 2026-07-10 (배치 48 — 배포 대기, 강화: 대시보드 To-Do 위젯)
- ③ **대시보드 '내 To-Do' 위젯** — 대시보드에 개인 미완료 To-Do 카드를 추가(우선순위·제목·기한·상태, 상위 6건 + 초과건수, '모두 보기'→/todos). 대시보드 마운트 시 /api/todos를 함께 조회해 배정 업무·마감임박과 함께 개인 할 일까지 한 화면에서 파악. 배치42(To-Do 도메인)·배치43(내작업 연계)에 이어 대시보드까지 노출 완결. 순수 표시 위젯이라 데이터·기존 위젯 무영향. — src/app/dashboard/page.tsx
- 검증: `tsc --noEmit` 통과(에러 0). 마운트 무결성(깨진문자 0) 확인.

## 2026-07-10 (배치 47 — 배포 대기, ★ 산출물 버전이력/형상관리)
- ★ **산출물 버전이력(형상관리)** 구현 — 산출물 문서의 버전 변경을 자동으로 이력화. 신규 `document_versions` 테이블(문서별 version·status·author·note·시각). 제네릭 CRUD에 **`versionOn` 플래그를 additive로 추가**(이슈 journal 패턴과 동일): 문서 생성 시 '최초 생성' 이력, 이후 PATCH에서 `version` 값이 바뀌면 '개정' 스냅샷을 자동 기록(documents config만 versionOn:true, 다른 리소스 무영향). 산출물 상세 슬라이드오버에 **버전 이력 타임라인** 표시(버전·결재상태·작성자·시각). 신규 API `GET /api/documents/[id]/versions`. 신규 컴포넌트 `DocumentVersions`를 ResourceView 상세에 `entity==='documents'` 조건으로 1줄 삽입(중앙 컴포넌트 최소 변경, 무결성 확인). — src/db/schema.ts, src/lib/migrate.ts, src/lib/configs.ts, src/lib/crud.ts(versionOn hook), src/app/api/documents/[id]/versions/route.ts(신규), src/components/DocumentVersions.tsx(신규), src/components/ResourceView.tsx(1줄)
- 신규 테이블은 migrate.ts DDL로 배포 시 자동 반영. (커스텀 산출물 양식 form_definitions '동적 폼 빌더'는 대형/고위험이라 별도 세션 권장 — 이번엔 형상관리/버전이력을 우선 완결.)
- 검증: `tsc --noEmit` 통과(에러 0). 작업 전 src 백업. 마운트 무결성(깨진문자 0, ResourceView 꼬리 정상) 확인.

## 2026-07-10 (배치 46 — 배포 대기, 리스크·프로젝트 보강)
- ④/⑦ **리스크 대응방안** — 리스크에 `mitigation`(대응방안·완화계획)·`contingency`(비상계획)·`dueDate`(대응기한) 필드 추가(폼 + 목록 '대응기한' 컬럼). 식별·평가에 더해 대응 전략·기한까지 관리해 리스크 관리 완성도 향상. — src/db/schema.ts, src/lib/migrate.ts, src/lib/configs.ts, src/app/risks/page.tsx
- ⑦ **프로젝트 계약정보** — 프로젝트에 `orderer`(발주처)·`contractNo`(계약번호)·`budget`(계약금액) 필드 추가(폼 + 목록 '계약금액' 컬럼, 원화 포맷). SI 사업의 계약·발주 정보를 프로젝트 단위로 기록. — src/db/schema.ts, src/lib/migrate.ts, src/lib/configs.ts, src/app/projects/page.tsx
- 신규 컬럼 6개는 migrate.ts `ALTER … ADD COLUMN IF NOT EXISTS`로 배포 시 자동 반영. 제네릭 CRUD+config 기반, 중앙 ResourceView 미접촉(저위험).
- 검증: `tsc --noEmit` 통과(에러 0). 작업 전 src 백업. 마운트 무결성(깨진문자 0) 확인. (배포는 Windows PMS-AutoDeploy 2시간 주기 무인 반영.)

## 2026-07-10 (배치 45 — 배포 대기, 기성고 + 인터페이스)
- ⑦ **기성고·스냅샷 도메인 신설** — 기준 시점(차수·마일스톤)별 계획/실적 진척과 기성률(billing%)을 기록. 신규 `snapshots` 테이블(프로젝트 범위: 기준(label)·기준일·계획%·실적%·기성률%·비고, 코드 SNP)과 전용 화면 `/snapshots`(좌측 내비 '현황' 그룹, 주간보고 아래) 추가. 기성 청구·진척 스냅샷을 시점별로 남겨 추이·정산 근거로 활용. — src/db/schema.ts, src/lib/migrate.ts, src/lib/configs.ts, src/app/api/snapshots/route.ts(신규), src/app/api/snapshots/[id]/route.ts(신규), src/app/snapshots/page.tsx(신규), src/components/Shell.tsx(내비)
- ⑦ **인터페이스 상세 보강** — 인터페이스에 담당자(owner)·연동 규격(spec)·연동테스트 상태(testStatus: 미실시/진행/완료) 필드 추가(폼 + 목록 '담당'·'연동테스트' 컬럼). 인터페이스 정의서 수준의 상세·검증 상태 관리. — src/db/schema.ts, src/lib/migrate.ts, src/lib/configs.ts, src/app/interfaces/page.tsx
- 신규 테이블 1개 + 컬럼 3개는 migrate.ts DDL(`CREATE TABLE IF NOT EXISTS`+인덱스, `ALTER … ADD COLUMN IF NOT EXISTS`)로 배포 시 자동 반영. 제네릭 CRUD+config 기반, 중앙 ResourceView 미접촉(저위험).
- 검증: `tsc --noEmit` 통과(에러 0). 작업 전 src 백업. 마운트 무결성(깨진문자 0) 확인. ROADMAP ⑦ 스냅샷/기성고 부분 [x].

## 2026-07-10 (배치 44 — 배포 대기, SI 도메인 다건 보강)
- ⑦ SI 실무 도메인 5종에 핵심 필드를 한 번에 보강(모두 config+migrate 기반, 중앙 ResourceView 미접촉·저위험):
  - **요구사항**: `acceptanceCriteria`(인수기준·완료조건, textarea) — 요구사항 검수 기준 명세.
  - **조달**: `poNumber`(발주번호)·`deliveryDate`(납기일)·`receiptDate`(입고일) + 목록 '납기' 컬럼 — 발주~입고 흐름 관리.
  - **회의**: `actionItems`(후속조치 Action Item, textarea)·`nextDate`(차기 회의일) + 목록 '차기' 컬럼 — 회의록 실행력 강화.
  - **이슈**: `related`(관계 이슈, 쉼표 코드) — 연관·중복·차단 이슈 연결 기록.
  - **방화벽**: `approver`(승인자)·`expireDate`(만료일) + 목록 '만료' 컬럼 — 정책 승인·만료 관리.
- 신규 컬럼 13개는 migrate.ts `ALTER TABLE … ADD COLUMN IF NOT EXISTS`로 배포 시 자동 반영. — src/db/schema.ts, src/lib/migrate.ts, src/lib/configs.ts, src/app/requirements|procurement|meetings|issues|firewall/page.tsx
- 검증: `tsc --noEmit` 통과(에러 0). 작업 전 src 백업. 마운트 무결성(깨진문자 0) 확인.

## 2026-07-10 (배치 43 — 배포 대기, 다건)
- ⑦ **개인 To-Do → 내 작업(/mywork) 연계** — 개인 할 일(미완료)을 '내 작업' 화면 최상단에 섹션으로 노출(제목·우선순위·상태·기한). /api/todos를 클라이언트에서 함께 조회해 배정 업무·이슈·리스크와 한 화면에 모아 봄. (배치42 To-Do 도메인의 주간/내작업 연계 완결.) — src/app/mywork/page.tsx
- ★ **이슈 시간기록(공수)** — 이슈에 `estimateHours`(예상)·`spentHours`(실제) 공수 필드 추가. 이슈 폼에 입력란, 목록에 '공수(h)' 컬럼 노출. 업무(WBS)의 계획/실제 공수처럼 이슈 단위 공수 추적 가능. (⑦ '이슈 …시간기록(공수)' 하위기능 충족.) — src/db/schema.ts, src/lib/migrate.ts, src/lib/configs.ts, src/app/issues/page.tsx
- ⑦ **인프라 자산 상세(CMDB 확장)** — 인프라 자산에 호스트명·OS·CPU·메모리·랙 위치·시리얼번호 필드 추가(폼 입력 + 목록에 호스트명·OS 컬럼). 랙·논리 서버 수준의 상세 자산 정보를 기록. — src/db/schema.ts, src/lib/migrate.ts, src/lib/configs.ts, src/app/infra/page.tsx
- 신규 컬럼 8개는 migrate.ts MIGRATION_DDL의 `ALTER TABLE … ADD COLUMN IF NOT EXISTS`로 배포 시 자동 반영(관리자 버튼 불필요). 제네릭 CRUD+config 기반이라 중앙 ResourceView 미접촉(저위험).
- 검증: `tsc --noEmit` 통과(에러 0). 작업 전 src 백업. 마운트 무결성(깨진문자 0) 확인.

## 2026-07-10 (배치 42 — 배포 대기)
- ⑦ **개인 To-Do/체크인 도메인 신설** — 사용자별 개인 할 일 관리(원본 PMS 반영). 신규 `todos` 테이블(코드 TD, 제목·메모·우선순위·상태[할 일/진행중/완료]·기한). 제네릭 CRUD 엔진에 **`user` 스코프를 additive로 추가**: 목록은 현재 사용자 것만 필터(orgId+userId), 생성 시 userId 자동 설정, 수정·삭제도 소유자 한정. 개인 데이터이므로 user 스코프에 한해 RBAC 리소스 권한 체크는 스킵(소유권은 userId로 보장) — 기존 org/project 리소스 동작은 완전 무영향(조건부 분기). 전용 화면 `/todos`(좌측 내비 '현황' 그룹의 내 작업 아래)에 목록 + **보드(칸반)** 뷰 제공. 신규 테이블은 schema.ts + migrate.ts DDL(`CREATE TABLE IF NOT EXISTS`+인덱스)로 배포 시 자동 마이그레이션. — src/lib/crud.ts(user 스코프), src/db/schema.ts, src/lib/migrate.ts, src/lib/configs.ts, src/app/api/todos/route.ts(신규), src/app/api/todos/[id]/route.ts(신규), src/app/todos/page.tsx(신규), src/components/Shell.tsx(내비)
- 검증: `tsc --noEmit` 통과(에러 0). 작업 전 src 백업. 마운트 무결성(깨진문자 0) 확인. (주간보고 연계는 프로젝트 단위 vs 개인 단위 스코프 차이로 다음 증분에서 별도 처리.) ROADMAP ⑦ '개인 To-Do/체크인' 도메인 [ ]→[x].

## 2026-07-10 (야간 배치 41 — 배포 대기)
- 공통 ⑥/③: **리스크 매트릭스 심각도 구간별 건수** — 배치37에서 추가한 RiskMatrix 하단 색상 범례(심각 15+·높음 10–14·중간 5–9·낮음 1–4)가 각 구간이 무슨 색·점수인지만 알려줄 뿐 **실제로 그 구간에 리스크가 몇 건 있는지**는 표시하지 않아, 전체 위험 분포(어디에 심각·높음이 쏠려 있는지)를 한눈에 파악하기 어려웠던 것을 개선. 매트릭스에 배치된(발생가능성·영향도 1~5) 리스크를 heatColor와 **동일한 임계값(≥15·≥10·≥5)**으로 심각/높음/중간/낮음 4구간에 집계(`sev`)해, 각 범례 라벨 옆에 해당 색으로 강조한 건수를 표기(0건이면 숨김, 각 칩에 `심각 리스크 N건` 툴팁). 이제 배치39의 `총 N건·미표시 M건` 배지가 커버리지를, 이 범례 건수가 심각도 분포를 함께 보여줘 매트릭스만 스캔해도 위험 쏠림을 즉시 인지 가능. 순수 표시 집계(미표시/범위밖 리스크는 제외)라 데이터·API·클릭(openDetail) 무영향. — src/components/views.tsx (단일 파일: RiskMatrix에 sev 집계 2줄 + 범례 map에 건수 표기)
- 데이터/스키마·타입 영향 없음(순수 표시), 마이그레이션 불필요. ⑥ 안전 백로그·⑧ monday UX가 모두 [x] 소진 상태이고 ROADMAP 잔여 `[ ]`는 전부 신규 테이블/주간 수동(⑦) 또는 대형 항목이라 야간 금지 대상이므로, 배치37(리스크 범례)·배치39(리스크 건수 배지)를 잇는 대체뷰 가독성 보너스 폴리시로 진행(신규 테이블 미접촉). ROADMAP 변경 없음.
- 검증: tsc --noEmit 통과(에러 0). 작업 전 `cp -r src /tmp/bak_*` 백업. (야간 OneDrive 마운트 동기화 지연으로 views.tsx 마운트 사본이 CalendarView 날짜셀 이벤트 div(`onClick={() => ope`)에서 잘려 tsc TS17008/1005 오탐 → 호스트 원본(Read/Edit) 무결성 456줄 확인 후 python(utf-8)으로 마운트 사본의 잘린 꼬리를 원본과 동일하게 재구성해 0에러 재확인. 편집 자체는 파일 상단 RiskMatrix로 CalendarView 무관.)

## 2026-07-10 (야간 배치 40 — 배포 대기)
- 공통 ⑥/①: **간트 헤더 "지연 N" 기한초과 배지** — 대체뷰 Gantt(일정 계획)가 그동안 개별 막대에는 기한 초과 시 적색 테두리(`overdue`)로 강조했고 헤더에는 임계경로 작업 중 지연분(`critOverdue`)만 표기해, 선행관계가 없는 일반 작업까지 포함한 **전체 기한초과 작업이 몇 건인지**는 헤더만 보고 알 수 없던 것을 개선. 헤더에 전체 기한초과 미완료 작업 수를 세는 `overdueCount`를 추가하고, 1건 이상일 때 임계경로 배지 옆에 앰버색 **`지연 N`** 배지를 표시(툴팁 `기한(마감)이 지난 미완료 작업 N건 (완료 제외)`). 초과 판정은 막대 렌더의 `overdue`와 **동일한 규칙** — `eff(r)`로 계획된(planned) 작업 중 완료(done) 아니고 종료일이 오늘 자정 이전(`x.e < todayMid`)인 건만 카운트. 색은 적색 주경로 배지와 구분되도록 앰버(#a86a12/#fbeed6)를 사용해, 배치38 칸반 "지연 N" 헤더 배지와 같은 스캔 즉시 병목 인지 패턴을 간트에도 일관 적용. 순수 표시 계산이라 데이터·API·드래그(save/create)·클릭(openDetail) 무영향. — src/components/views.tsx (단일 파일: Gantt에 overdueCount 1줄 + 헤더 배지 1블록)
- 데이터/스키마·타입 영향 없음(순수 표시), 마이그레이션 불필요. ⑥ 안전 백로그·⑧ monday UX가 모두 [x] 소진 상태이고 ROADMAP 잔여 `[ ]`는 전부 신규 테이블/주간 수동(⑦) 또는 대형 항목이라 야간 금지 대상이므로, 배치38(칸반 지연 배지)을 잇는 대체뷰 가독성 보너스 폴리시로 진행(신규 테이블 미접촉). ROADMAP 변경 없음.
- 검증: tsc --noEmit 통과(에러 0). 작업 전 `cp -r src /tmp/bak_*` 백업. (야간 OneDrive 마운트 동기화 지연으로 views.tsx 마운트 사본이 444줄 CalendarView 날짜셀(`{d && itemsOn(d).slice(0, 3).map`)에서 잘려 tsc TS17008/1005/1109 오탐 → 호스트 원본(Read/Edit) 무결성 454줄 확인 후 python(utf-8)으로 마운트 사본의 잘린 꼬리(443줄~CalendarView 닫힘)를 원본과 동일 454줄로 재구성해 0에러 재확인. 편집 자체는 파일 중단부 Gantt로 CalendarView 무관.)

## 2026-07-10 (야간 배치 39 — 배포 대기)
- 공통 ⑥/③: **리스크 매트릭스 총건수·미표시(누락) 건수 배지** — 대체뷰 RiskMatrix(발생가능성 5 × 영향도 5 히트맵)가 각 셀에 배치된 리스크 수만 보여줄 뿐, 전체 리스크가 몇 건인지와 **발생가능성/영향도 값이 없거나 1~5 범위 밖이라 매트릭스에 아예 표시되지 않은 리스크**가 얼마나 되는지는 알 수 없었던 것을 개선. 제목 옆에 `총 N건` 배지를 추가하고, 미표시 건이 있으면 `· 미표시 M건`을 앰버색(#a86a12)으로 덧붙여(툴팁으로 미표시 사유 안내) 매트릭스가 전체 리스크를 얼마나 커버하는지 즉시 파악하도록 함. 값이 비었거나 범위를 벗어난 리스크는 히트맵에서 조용히 누락돼 있었는데, 이제 그 사각지대(값 입력 필요 건)를 스캔만으로 인지 가능. 순수 표시 계산(`inCell` 범위 검사·건수 집계)이라 데이터·API·클릭(openDetail) 무영향. — src/components/views.tsx (단일 파일: RiskMatrix 상단에 plotted/unplotted 집계 3줄 + 제목 행을 배지 포함 row로 교체)
- 데이터/스키마·타입 영향 없음(순수 표시), 마이그레이션 불필요. ⑥ 안전 백로그·⑧ monday UX가 모두 [x] 소진 상태이고 ROADMAP 잔여 `[ ]`는 전부 신규 테이블/주간 수동(⑦) 또는 대형 항목이라 야간 금지 대상이므로, 배치37(리스크 매트릭스 색상 범례)을 잇는 대체뷰 가독성 보너스 폴리시로 진행(신규 테이블 미접촉). ROADMAP 변경 없음.
- 검증: tsc --noEmit 통과(에러 0). 작업 전 `cp -r src /tmp/bak_*` 백업. (야간 OneDrive 마운트 동기화 지연으로 views.tsx 마운트 사본이 CalendarView 날짜셀 렌더(`background: isToday(`)에서 잘려 tsc 오탐 위험 → 호스트 원본(Read/Edit) 무결성 확인 후 python(utf-8)으로 마운트 사본의 잘린 꼬리를 원본과 동일 451줄로 재구성해 0에러 재확인. 편집 자체는 파일 상단 RiskMatrix로 CalendarView 무관.)

## 2026-07-10 (야간 배치 38 — 배포 대기)
- 공통 ⑥/⑧: **칸반 열 헤더 "지연 N" 초과 배지** — 대체뷰 Kanban 보드가 그동안 열(상태) 헤더에 전체 카드 수(`cnt`)만 표기해, 어느 상태 열에 기한 초과 카드가 몇 장 쌓여 있는지 열자체만 보고는 알 수 없던 것을 개선. 각 열의 카드 중 기한이 지난(초과) 건수를 세어, 1건 이상일 때 헤더 카운트 옆에 적색 **`지연 N`** 배지를 추가(툴팁 `기한 초과 N건`). 초과 판정은 카드 D-day 칩(dueChip)과 **완전히 동일한 규칙** — `dueDate`(이슈·테스트) 또는 `endDate`(업무)를 자동 감지하고 완료·종료 상태(done·closed·resolved·completed·approved·pass=KB_DONE)는 제외하며 오늘 자정 기준 t<now인 카드만 카운트. 이제 이슈·업무·테스트를 보드로 볼 때 마감이 밀린 열을 스캔만으로 즉시 식별 가능(카드를 일일이 펼치지 않아도 병목 열 파악). 페이지(issues/tasks/tests) 미접촉 — 필드 자동 감지라 views.tsx 단일 파일만 변경. 순수 표시 계산이라 데이터·API·클릭(openDetail) 무영향. — src/components/views.tsx (단일 파일: Kanban 열 map에 overdue 카운트 1블록 + kb-h 헤더 배지 1개)
- 데이터/스키마·타입 영향 없음(순수 표시), 마이그레이션 불필요. ⑥ 안전 백로그·⑧ monday UX가 모두 [x] 소진 상태이고 ROADMAP 잔여 `[ ]`는 전부 신규 테이블/주간 수동(⑦) 또는 대형 항목이라 야간 금지 대상이므로, 배치35(칸반 D-day 칩)·배치37(리스크 범례)을 잇는 대체뷰 가독성 보너스 폴리시로 진행(신규 테이블 미접촉). ROADMAP 변경 없음.
- 검증: tsc --noEmit 통과(에러 0). 작업 전 `cp -r src /tmp/bak_*` 백업. (야간 OneDrive 마운트 동기화 지연으로 views.tsx 마운트 사본이 CalendarView 날짜셀 렌더(`{d && itemsOn(d).slice(0,3)`)에서 잘려 tsc TS17008/1005 오탐 → 호스트 원본(Read/Edit) 무결성 확인 후 python(utf-8)으로 마운트 사본의 잘린 꼬리를 원본과 동일 445줄로 재구성해 0에러 재확인. 편집 자체는 파일 상단 Kanban으로 CalendarView 무관.)

## 2026-07-10 (야간 배치 37 — 배포 대기)
- 공통 ⑥/③: **리스크 매트릭스 심각도 색상 범례** — 대체뷰 RiskMatrix(발생가능성 5 × 영향도 5 히트맵)가 그동안 셀을 점수(impact×prob)에 따라 4단계 색(적/주황/황/녹)으로 칠했으나 어떤 색이 무슨 위험 수준인지 알려주는 **범례가 없어** 색만으로는 심각도를 해석하기 어려웠던 것을 개선. 매트릭스 표 아래에 `심각(15+)·높음(10–14)·중간(5–9)·낮음(1–4)` 4개 색 스와치 범례를 추가해, heatColor의 임계값(≥15·≥10·≥5)과 정확히 일치하는 라벨·점수구간을 함께 표기. 이제 리스크 목록을 매트릭스 뷰로 볼 때 셀 색을 즉시 위험 등급으로 해석 가능. 순수 표시(정적 배열 렌더)라 데이터·API·클릭(openDetail) 무영향. — src/components/views.tsx (단일 파일: RiskMatrix `</table>` 뒤 범례 div 1블록)
- 데이터/스키마·타입 영향 없음(순수 표시), 마이그레이션 불필요. ⑥ 안전 백로그·⑧ monday UX가 모두 [x] 소진 상태이고 ROADMAP 잔여 `[ ]`는 전부 신규 테이블/주간 수동(⑦) 또는 대형 항목이라 야간 금지 대상이므로, 대체뷰 가독성 보너스 폴리시로 진행(신규 테이블 미접촉). ROADMAP 변경 없음.
- 검증: tsc --noEmit 통과(에러 0). 작업 전 `cp -r src /tmp/bak_*` 백업. (야간 OneDrive 마운트 동기화 지연으로 views.tsx 마운트 사본이 CalendarView 셀 렌더(`{d && itemsOn(`)에서 잘려 tsc 오탐 위험 → 호스트 원본(Read/Edit) 무결성 439줄 확인 후 python(utf-8)으로 마운트 사본의 잘린 꼬리(cells.map~CalendarView 닫힘)를 원본과 동일하게 재구성해 0에러 재확인.)

## 2026-07-09 (야간 배치 36 — 배포 대기)
- 공통 ⑥/③: **월력(CalendarView) 오늘 날짜 셀 강조** — 통합 캘린더(/calendar)와 목록 대체뷰로 쓰이는 CalendarView가 그동안 '오늘'을 날짜 숫자 배지(브랜드색 원)로만 표시해, 일정이 여러 개 들어찬 셀에서는 오늘 칸이 주변 칸과 잘 구분되지 않던 것을 개선. 오늘에 해당하는 셀 전체에 옅은 브랜드 배경(`var(--brand-50)`)과 안쪽 2px 브랜드 링(`inset box-shadow`)을 부여해, 월력을 스캔만 해도 "오늘 마감/오늘 일정"이 있는 칸이 즉시 눈에 띄도록 함(주말 배경보다 우선 적용). 순수 표시 계산(`isToday(d)` 재사용)이라 데이터·API·클릭(openDetail) 무영향. — src/components/views.tsx (단일 파일: 셀 div의 background·boxShadow 삼항 1줄)
- 데이터/스키마·타입 영향 없음(순수 표시), 마이그레이션 불필요. ⑥ 안전 백로그·⑧ monday UX가 모두 [x] 소진 상태라, 배치34(주말 색상·이번 달 건수)·배치35(칸반 D-day 칩)를 잇는 월력 가독성 보너스 폴리시로 진행(신규 테이블 미접촉).
- 검증: tsc --noEmit 통과(에러 0). 작업 전 `cp -r src /tmp/bak_*` 백업. (야간 OneDrive 마운트 동기화 지연으로 views.tsx 마운트 사본이 424줄 CalendarView `+N` 셀(`color: 'var(--tex`)에서 잘려 tsc 오탐 위험 → 호스트 원본(Read/Edit) 무결성 확인 후 python(utf-8)으로 마운트 사본의 잘린 꼬리를 원본과 동일하게 재구성해 0에러 재확인.)

## 2026-07-09 (야간 배치 35 — 배포 대기)
- 공통 ⑥/⑧: **칸반 카드 기한(due) D-day·초과 강조 칩** — 목록(ResourceView)·상세 패널에는 이미 기한 임박(≤7일)/초과 하이라이트가 있었으나, 대체뷰인 **칸반 카드**에는 기한 정보가 아예 표시되지 않아 이슈·업무·테스트를 보드로 볼 때 마감 긴급도를 알 수 없던 것을 개선. Kanban에 `dueChip(r)` 헬퍼를 추가해 카드에서 `dueDate`(이슈·테스트) 또는 `endDate`(업무)를 자동 감지하고, 목록/상세와 **완전히 동일한 규칙**으로 칩을 렌더: 초과=적색(#c0414f/#fdedef) `N일 초과`·`오늘 마감 초과`, 임박(≤7일)=앰버(#a86a12/#fbeed6) `D-N`·`오늘 마감`, 그 외 미래/기한은 옅은 `M/D 마감` 텍스트. 완료·종료 상태(done·closed·resolved·completed·approved·pass)는 강조하지 않아 배치22 상세 패널·목록 규칙과 일치. 카드 하단 배지 행에 `flexWrap`을 부여해 우선순위·유형·진척과 함께 자연스럽게 배치(좁은 카드에서도 줄바꿈). 페이지(issues/tasks/tests)는 미접촉 — 필드 자동 감지라 views.tsx 단일 파일만 변경. 순수 표시 계산이라 데이터·API·클릭(openDetail) 무영향. — src/components/views.tsx (단일 파일: Kanban에 KB_DONE·dueChip 헬퍼 + 카드 행 칩 1블록 + flexWrap)
- 데이터/스키마·타입 영향 없음(순수 표시), 마이그레이션 불필요. ⑥ 안전 백로그·⑧ monday UX가 모두 [x] 소진 상태라, 배치16/22의 목록·상세 기한 강조 패턴을 칸반 카드까지 잇는 보너스 폴리시로 진행(신규 테이블 미접촉).
- 검증: tsc --noEmit 통과(에러 0, 전체 컴파일 exit 0). 작업 전 `cp -r src /tmp/bak_*` 백업. (야간 OneDrive 마운트 동기화 지연으로 views.tsx 마운트 사본이 415줄 CalendarView 그리드 컨테이너(`borderRadius: 1`)에서 잘려 tsc TS17008/1005 오탐 → 호스트 원본(Read/Edit) 무결성 확인 후 python(utf-8)으로 마운트 사본의 잘린 꼬리(그리드~CalendarView 닫힘)를 원본과 동일 431줄로 재구성해 0에러 재확인.)

## 2026-07-09 (야간 배치 34 — 배포 대기)
- 공통 ⑥/③: **월력(CalendarView) 주말 색상 + 이번 달 건수** — 통합 캘린더(/calendar)와 목록 대체뷰로 쓰이는 CalendarView가 그동안 요일 헤더·날짜를 전부 회색으로만 표기해 한국 달력 관행(일요일 적색·토요일 청색)과 어긋나고, 한 달에 일정이 몇 건인지 한눈에 파악하기 어려웠던 것을 개선. 요일 헤더 7칸을 `dowColor(i)` 헬퍼로 **일=테라코타 계열 적색(#c0414f)·토=청색(#3b6fb0)·평일=기존 회색**으로 칠하고, 주말 열의 셀 배경을 `--surface-2`로 은은하게 톤다운, 주말 날짜 숫자도 오늘(브랜드 강조) 외에는 동일 색으로 표기해 주중/주말 구분이 스캔만으로 즉시 인지되도록 함. 헤더 제목 옆에는 `rows` 중 현재 표시 월(dateKey 앞 7자리 `YYYY-MM` 일치)에 해당하는 **`이번 달 N건`** 배지를 추가(0건이면 숨김)해 월 이동 시 일정 밀도를 바로 확인 가능. 순수 표시 계산(요일 인덱스 `i%7`·문자열 prefix 비교)이라 데이터·API·클릭 동작 무영향. — src/components/views.tsx (단일 파일: CalendarView에 monthCount·dowColor + 헤더 배지 1개 + 요일/셀/날짜 색상 3곳)
- 데이터/스키마·타입 영향 없음(순수 표시), 마이그레이션 불필요. ⑥ 안전 백로그·⑧ monday UX가 모두 [x] 소진 상태라 배치15 통합 캘린더·배치29 범례 필터를 잇는 월력 가독성 보너스 폴리시로 진행(신규 테이블 미접촉). 참고: 이번 실행 도중 다른 병렬 야간 런이 배치33(테스트 차수)을 동시 커밋 → 파일 겹침 없어 공존, 번호만 34로 부여.
- 검증: tsc --noEmit 통과(에러 0). 작업 전 `cp -r src /tmp/bak_*` 백업. (야간 OneDrive 마운트 동기화 지연으로 views.tsx 마운트 사본이 402줄 캘린더 셀 이벤트 렌더(`<div key={r.id} ...`)에서 잘려 tsc TS17008/1005/1109 오탐 → 호스트 원본(Read/Edit) 무결성 확인 후 python(utf-8)으로 마운트 사본의 잘린 꼬리(line 402~ CalendarView 닫힘)를 원본과 동일 411줄로 재구성해 0에러 재확인.)

## 2026-07-09 (배치 33 — 배포 대기)
- ★ 최우선: **테스트 차수(Cycle) 묶음 관리** 구현 — 회차별(1차·2차·회귀·인수 등)로 테스트를 그룹핑하는 원본 PMS 핵심 기능. 신규 `test_cycles` 테이블(프로젝트 범위: 차수명·목표·상태[계획/진행/완료]·시작/종료일, 코드 CYC)과 전용 관리 화면(`/test-cycles`, 좌측 내비 '통제' 그룹의 테스트 아래)을 추가해 차수를 정의·계획·상태관리. 함께 `tests`에 `cycle` 필드를 추가해 각 테스트 케이스를 차수에 배정(폼 콤보: 1차/2차/3차/회귀/인수/성능 선택·입력, 목록에 '차수' 컬럼)하고, 기존 목록 그룹화 기능으로 **회차별로 묶어** 볼 수 있게 함. 신규 테이블/컬럼은 schema.ts 정의 + migrate.ts MIGRATION_DDL에 `CREATE TABLE IF NOT EXISTS`(+인덱스)·`ALTER ADD COLUMN IF NOT EXISTS`로 배포 시 자동 마이그레이션(관리자 버튼 불필요). 제네릭 CRUD(collection/item)+config 기반이라 중앙 ResourceView는 미접촉(저위험). — src/db/schema.ts, src/lib/migrate.ts, src/lib/configs.ts, src/app/api/test-cycles/route.ts(신규), src/app/api/test-cycles/[id]/route.ts(신규), src/app/test-cycles/page.tsx(신규), src/components/Shell.tsx(내비), src/app/tests/page.tsx(차수 필드·컬럼)
- 검증: `tsc --noEmit -p tsconfig.json` 통과(에러 0). 작업 전 src 백업(/tmp/bak_pms_*). 마운트 무결성(깨진문자 0) 확인. ROADMAP ★ '테스트 차수(Cycle)' [ ]→[x].

## 2026-07-09 (야간 배치 32 — 배포 대기)
- ★ 최우선: **이슈 이력(journal)·워처** 구현 — 원본 PMS 핵심인 "누가 언제 무엇을 바꿨나" 변경 추적을 이슈에 도입. 이슈 수정 시 이전 값과 새 값을 필드별로 비교해 실제로 바뀐 항목만 `issue_journals`에 자동 기록(작성자·시각 포함), 이슈 상세 패널에 **변경 이력 타임라인**(필드 한글 라벨 + 이전값 취소선 → 새값 강조)을 표시. 함께 **워처(관심 등록)** 기능 추가: 상세 패널의 `관심`/`관심 해제` 토글로 `issue_watchers`에 현재 사용자를 등록/해제하고 워처 명단·인원수를 노출. 신규 테이블 2개(issue_journals, issue_watchers)는 schema.ts 정의 + migrate.ts MIGRATION_DDL에 `CREATE TABLE IF NOT EXISTS`(+인덱스, 워처 org·issue·user 유니크) 추가로 배포 시 자동 마이그레이션(관리자 버튼 불필요). 이력 기록은 제네릭 CRUD의 `item()` PATCH에 `journal` 플래그로 훅(이슈 config만 `journal:true`)해 다른 리소스에는 영향 없음. — src/db/schema.ts, src/lib/migrate.ts, src/lib/crud.ts, src/lib/configs.ts, src/app/api/issues/[id]/journal/route.ts(신규 GET), src/app/api/issues/[id]/watchers/route.ts(신규 GET·POST 토글), src/components/IssueJournal.tsx(신규), src/components/ResourceView.tsx(이슈 상세에 삽입)
- 검증: `tsc --noEmit -p tsconfig.json` 통과(에러 0). 작업 전 `cp -r src /tmp/bak_pms` 백업. 예약작업 pms-nightly-dev·pms-progress-digest 재활성화(수요일 예산 재설정 후 재개).

## 2026-07-09 (야간 배치 31 — 배포 대기)
- 공통 ⑧: **목록 뷰 모드(표/칸반/간트/캘린더) 사용자별 유지** — 배치24에서 그룹화·정렬·밀도·컬럼 표시를 localStorage로 유지하게 했으나, 대체뷰가 있는 목록(업무 간트·칸반, 리스크 매트릭스 등)의 **선택한 뷰 모드**만은 새로고침·재방문 시 항상 기본값(`표`)으로 되돌아갔던 것을 개선. 뷰 전환 세그먼트 버튼을 `pickMode(m)` 헬퍼로 일원화해 선택 시 `pms.mode.<제목>` 키로 저장하고, 마운트 시 복원. 저장값이 `table`이거나 현재 목록의 altViews에 실제 존재하는 key일 때만 적용해, 다른 목록의 값이나 사라진 뷰로 잘못 복원되지 않도록 검증(없으면 표 유지). 예: 업무를 칸반으로 보던 사용자는 다시 열어도 칸반으로 시작. 순수 클라이언트 상태라 데이터·API 무영향. — src/components/ResourceView.tsx (단일 파일: pickMode 헬퍼 1개 + 복원 useEffect 1줄 + seg 버튼 onClick 2곳)
- 데이터/스키마·타입 영향 없음(순수 클라이언트 상태 저장/복원), 마이그레이션 불필요. ⑥ 안전 백로그·⑧ monday UX가 모두 [x] 소진 상태이고 ROADMAP 잔여 `[ ]`는 전부 신규 테이블/주간 수동 항목(★ 이슈 이력·테스트 차수, ⑦ 전 항목)이라 야간 금지 대상이므로, 배치24의 "내 뷰 유지" 패턴을 뷰 모드까지 확장한 보너스 폴리시로 진행(신규 테이블 미접촉).
- 검증: tsc --noEmit 통과(에러 0). (야간 OneDrive 마운트 동기화 지연으로 ResourceView.tsx 마운트 사본이 453줄 모달 푸터(`button type="button" classNa`)에서 잘려 tsc TS17008/1005 오탐 → 호스트 원본(Read/Edit) 무결성 확인 후 python(utf-8)으로 마운트 사본의 잘린 꼬리(modal-f~Shell 닫힘·안내주석)를 원본과 동일하게 재구성해 0에러 재확인.)

## 2026-07-09 (야간 배치 30 — 배포 대기)
- 공통 ⑧: **그룹화 시 "모두 접기/모두 펼치기" 일괄 토글** — 목록을 상태/우선순위/담당자 등으로 그룹화했을 때, 그동안 각 그룹 헤더를 하나씩 클릭해야만 접거나 펼칠 수 있던 것을, 상단 툴바의 그룹화 드롭다운 옆에 **일괄 토글 버튼**을 추가해 한 번에 전 그룹을 접거나 펼치도록 개선(monday식 목록 편의). 그룹이 2개 이상일 때만 나타나며, 현재 모든 그룹이 접힌 상태면 `모두 펼치기`, 아니면 `모두 접기`로 라벨·툴팁이 상황에 맞게 전환됨. 기존 per-그룹 `collapsed`(Set) 상태를 그대로 재사용해, 클릭 시 전 그룹 키로 Set을 채우거나(접기) 비워서(펼치기) 즉시 반영. 그룹이 많은 목록(예: 담당자별)에서 원하는 그룹만 빠르게 훑을 때 반복 클릭 수고를 제거. 순수 클라이언트 상태라 데이터·API·정렬 동작 무영향. — src/components/ResourceView.tsx (단일 파일: 그룹화 select 옆 조건부 버튼 1블록)
- 데이터/스키마·타입 영향 없음(순수 클라이언트 상태 토글), 마이그레이션 불필요. ⑥ 안전 백로그·⑧ monday UX가 모두 [x] 소진 상태이고 ROADMAP 잔여 `[ ]`는 전부 신규 테이블/주간 수동 항목(★ 이슈 이력·테스트 차수, ⑦ 전 항목)이라 야간 금지 대상이므로, 배치21의 그룹 헤더 완료율·배치24의 그룹화 유지 패턴을 잇는 보너스 폴리시로 진행(신규 테이블 미접촉).
- 검증: tsc --noEmit 통과(에러 0). (야간 OneDrive 마운트 동기화 지연으로 ResourceView.tsx 마운트 사본이 모달 input 필드(line 444)에서 잘려 미종료 → 호스트 원본(Read/Edit) 무결성 확인 후 python(utf-8)으로 마운트 사본의 잘린 꼬리(f.hint~Shell 닫힘·안내주석)를 원본과 동일 457줄로 재구성해 0에러 재확인.)

## 2026-07-09 (야간 배치 29 — 배포 대기)
- 공통 ⑥/⑧: **통합 캘린더 범례 클릭 필터 + 종류별 건수** — /calendar 상단의 정적 색상 범례(회의·업무마감·테스트기한·이슈기한)를 **클릭 토글 가능한 칩**으로 바꿔, 특정 종류를 켜고/끄며 월력에서 해당 이벤트만 골라 보도록 개선(monday식 뷰 필터). 각 칩에 해당 종류의 **이번 프로젝트 총 건수**를 함께 표기해 어떤 일정이 얼마나 있는지 한눈에 파악 가능하고, 꺼진 칩은 흐리게+취소선으로 상태를 명확히 표시. 하나 이상 숨겨졌을 때만 `모두 표시` 버튼이 나타나 원클릭 복원. 캘린더 셀은 `hidden` 집합을 반영한 `byDay`(useMemo, deps `[evs,hidden]`)로 렌더되어 필터가 즉시 적용되고, 이벤트가 4종으로 겹쳐 붐비던 날에도 원하는 종류만 격리해 볼 수 있어 가독성이 향상됨. 순수 클라이언트 상태(useState Set)라 데이터·API 무영향. — src/app/calendar/page.tsx (단일 파일: hidden 상태·toggleKind·kindCount useMemo + byDay 필터 1줄 + 범례 버튼 블록)
- 데이터/스키마·타입 영향 없음(순수 표시 필터), 마이그레이션 불필요. ⑥ 안전 백로그·⑧ monday UX가 모두 [x] 소진 상태이고 ROADMAP 잔여 `[ ]`는 전부 신규 테이블/주간 수동 항목이라, 배치15의 통합 캘린더에 monday식 범례 필터를 이어붙인 보너스 폴리시로 진행(신규 테이블 미접촉).
- 검증: tsc --noEmit 통과(에러 0, 전체 컴파일 exit 0). (야간 OneDrive 마운트 동기화 지연으로 calendar/page.tsx 마운트 사본이 81줄 `const k = d ? dkey(d) :`에서 잘려 미종료 → 호스트 원본(Read/Edit) 무결성 확인 후 python(utf-8)으로 마운트 사본을 원본과 동일 101줄로 재구성해 0에러 재확인.)

## 2026-07-09 (야간 배치 28 — 배포 대기)
- 공통 ⑥/⑧: **CSV·Excel 내보내기 배지값 한글 라벨화** — 목록의 CSV/Excel 내보내기가 그동안 상태·우선순위 등 배지(badge) 컬럼을 저장 코드 원문(in_progress·high·resolved 등)으로 출력해, 화면 목록(Pill 한글 배지)·필터(배치18)·폼(배치25)이 모두 한글로 통일된 것과 달리 **내보낸 파일만 영문 코드**로 어긋났던 것을 해소. ResourceView에 `exportCell(c,r)` 헬퍼를 신설해 `c.badge`인 컬럼은 lib/ui.tsx의 LABEL로 변환(매핑 없으면 원문 폴백, 빈값은 빈칸)하고 CSV·Excel 두 내보내기가 이를 공유하도록 일원화. 이제 이슈·업무·테스트·리스크·요구사항·산출물 등 배지 컬럼을 가진 전 목록의 내보내기 결과가 화면 표시와 완전히 일치해, 리포트로 공유되는 스프레드시트 가독성이 향상됨. value 아닌 표시문자열만 바뀌므로 데이터·필터·정렬 동작 무영향. — src/components/ResourceView.tsx (단일 파일: exportCell 헬퍼 1개 + exportCsv/exportXlsx 셀 렌더 각 1곳)
- 데이터/스키마·타입 영향 없음(순수 표시 변환), 마이그레이션 불필요. ⑥ 안전 백로그·⑧ monday UX가 모두 [x] 소진 상태이고 ROADMAP 잔여 `[ ]`는 전부 신규 테이블/주간 수동 항목이라, 배치18(필터)·배치25(폼) 라벨 일관화를 내보내기까지 잇는 보너스 폴리시로 진행(신규 테이블 미접촉).
- 검증: tsc --noEmit 통과(에러 0). (야간 OneDrive 마운트 동기화 지연으로 ResourceView.tsx 마운트 사본이 445줄 모달 푸터(`btn bt`)에서 잘려 tsc TS17008/1002/1005 오탐 → 호스트 원본(Read/Edit) 무결성(454줄) 확인 후 python(utf-8)으로 마운트 사본 꼬리(line 446~)를 원본과 동일 454줄로 재구성해 0에러 재확인.)

## 2026-07-09 (야간 배치 27 — 배포 대기)
- 공통 ⑧: **상세 슬라이드오버 키보드 ↑/↓ 레코드 이동** — 배치26에서 추가한 상세 헤더의 `▲/▼` 이동 버튼을 키보드로도 조작할 수 있게 확장. 상세 패널이 열려 있을 때 `↑`/`↓` 방향키로 현재 필터·정렬이 적용된 목록(view) 순서대로 이전/다음 레코드로 바로 이동(monday식 빠른 훑어보기). 검색창·폼 등 입력 요소(INPUT/TEXTAREA/SELECT)에 포커스가 있을 때는 동작하지 않아 값 조정·타이핑과 충돌하지 않고, 목록이 1건 이하이거나 detail이 view에 없으면 무시됨(부작용 없음). 첫/마지막 항목에서는 해당 방향키가 no-op. 헤더의 이동 버튼 툴팁도 `이전 항목 (↑)`·`다음 항목 (↓)`로 단축키를 안내. useEffect는 `[detail, view]` 의존이라 이동 후에도 항상 최신 위치 기준으로 동작. — src/components/ResourceView.tsx (단일 파일: view 선언 이후 keydown useEffect 1개 + over-h 버튼 title 2곳)
- 데이터/스키마·타입 영향 없음(순수 클라이언트 상태 이동), 마이그레이션 불필요. ⑥ 안전 백로그·⑧ monday UX가 모두 [x] 소진 상태이고 ROADMAP 잔여 `[ ]`는 전부 신규 테이블/주간 수동 항목이라, 배치26 레코드 네비게이션을 잇는 보너스 폴리시로 진행(신규 테이블 미접촉).
- 검증: tsc --noEmit 통과(에러 0). 초기 배치에서 useEffect를 `view` 선언 이전에 두어 TS2448/2454(사용 전 선언) 발생 → useEffect를 view/grouped useMemo 뒤로 이동해 해결. (야간 OneDrive 마운트 동기화 지연으로 ResourceView.tsx 마운트 사본이 combo datalist(line 419 상당)에서 잘려 tsc 미종료 JSX 오탐 → 호스트 원본(Read/Edit) 무결성 확인 후 python(utf-8)으로 마운트 사본의 잘린 꼬리를 원본과 동일 448줄로 재구성해 0에러 재확인.)

## 2026-07-08 (야간 배치 26 — 배포 대기)
- 공통 ⑧: **상세 슬라이드오버 이전/다음 레코드 이동** — 목록에서 항목을 열어 상세 패널을 본 뒤 다른 항목을 보려면 매번 패널을 닫고 다시 클릭해야 했던 것을, 상세 헤더에 `▲/▼` 이동 버튼과 현재 위치 배지(`3/47`)를 추가해 패널을 닫지 않고 현재 필터·정렬이 적용된 목록(view) 순서대로 앞뒤 레코드로 바로 이동하도록 개선(monday식 레코드 네비게이션). 위치·이동 대상은 `view`(검색·상태필터·정렬·트리 반영본)를 기준으로 계산하므로 사용자가 보고 있는 목록 흐름과 정확히 일치하고, 첫/마지막 항목에서는 해당 방향 버튼이 비활성(opacity)됨. 목록이 1건 이하이거나 detail이 view에 없으면(예: rowHref로 페이지 이동하는 목록) 컨트롤 자체가 렌더되지 않아 부작용 없음. 상세 이동 시 기존 swipeY 리셋 useEffect(`[detail]`)가 그대로 동작해 모바일 제스처 상태도 초기화됨. — src/components/ResourceView.tsx (단일 파일: import에 ChevronUp/Down 추가 + over-h 네비 블록 1개)
- 데이터/스키마·타입 영향 없음(순수 클라이언트 상태 이동), 마이그레이션 불필요. ⑥ 안전 백로그·⑧ monday UX가 모두 [x] 소진 상태이고 ROADMAP 잔여 `[ ]`는 전부 신규 테이블/주간 수동 항목이라, 상세 패널 편의를 잇는 보너스 폴리시로 진행(신규 테이블 미접촉).
- 검증: tsc --noEmit 통과(에러 0). (야간 OneDrive 마운트 동기화 지연으로 ResourceView.tsx 마운트 사본이 418줄, line 419 combo 필드 datalist 중간(`</da`)에서 잘려 tsc가 미종료 JSX(TS17008/17014/1005) 오탐 → 호스트 원본(Read/Edit) 무결성·편집 반영(line5 import, over-h) 확인 후 python(utf-8)으로 마운트 사본의 잘린 꼬리(line 419~433)를 원본과 동일 433줄로 재구성해 0에러 재확인.)

## 2026-07-08 (야간 배치 25 — 배포 대기)
- 공통 ⑥/⑧: **입력 폼 상태·우선순위 드롭다운 한글 라벨화** — 배치18에서 상단 툴바의 *필터* 드롭다운만 LABEL(한글)로 바꿨던 것을, **새로 만들기/수정 모달의 select**·**인라인 셀 편집 드롭다운**·**다중선택 일괄 상태 버튼**·**상세 패널 상태 변경 버튼**까지 확장. 그동안 이 네 곳은 옵션이 문자열 배열(`['open','in_progress','resolved','closed']` 등)인 경우 영문 원문 코드를 그대로 노출해 목록 배지(한글)와 어긋났음. ResourceView에 `normOpt` 헬퍼(문자열이면 value=원본 코드 유지, label=`LABEL[코드]||코드`)를 신설해 세 곳의 옵션 정규화를 일원화하고, 상세 상태 버튼도 동일 매핑 적용. 이제 이슈·업무·리스크·요구사항·산출물·인프라·방화벽·조달 등 상태/우선순위를 select로 쓰는 전 화면에서 폼·목록·필터의 라벨이 완전히 일치. value(저장 코드)는 불변이라 저장/필터 동작 무영향. — src/components/ResourceView.tsx (단일 파일)
- 라벨 매핑 안전성 확인: LABEL 키(status/priority 코드)와 비상태 문자열 옵션(단계명·프로토콜·분류·역할 'PM'(대문자, 키 'pm'과 대소문자 불일치) 등) 간 충돌 없음 — 매핑 없는 값은 원문 폴백이라 오역 불가. 데이터/스키마·타입 영향 없음, 마이그레이션 불필요.
- 검증: tsc --noEmit 통과(에러 0). (야간 OneDrive 마운트 동기화 지연으로 ResourceView.tsx 마운트 사본 말미의 안내주석이 `// prism`에서 잘렸으나 export 함수 닫힘(`);`·`}`) 뒤 주석이라 tsc 무해·0에러 확인 → python(utf-8)으로 마운트 사본 꼬리 주석을 원본과 동일 432줄로 복원해 재확인.)

## 2026-07-08 (야간 배치 24 — 배포 대기)
- 공통 ⑧: **목록 뷰 설정(그룹화·정렬) 사용자별 유지** — 그동안 새로고침·재방문 시 매번 기본값(그룹화 없음, id 내림차순)으로 돌아가던 **그룹화 선택**과 **정렬 컬럼/방향**을 localStorage에 목록별로 저장해 다음 방문 때 그대로 복원하도록 개선. 이미 유지되던 밀도(density)·컬럼 표시/숨김·컬러셀 설정과 동일한 패턴(`pms.group.<제목>`·`pms.sort.<제목>` 키, title 기준 useEffect 복원)으로 구현. 예: 이슈 목록을 "상태로 그룹화 + 기한 오름차순"으로 보던 사용자는 다시 열어도 같은 뷰로 시작. 저장된 정렬 컬럼이 해당 목록에 없으면 정렬 비교가 무시(no-op)돼 안전. monday식 "내 뷰 유지" 편의로 반복 설정 수고를 제거. — src/components/ResourceView.tsx (단일 파일: title 복원 useEffect + sort()·그룹화 select onChange 3곳)
- 데이터/스키마·타입 영향 없음(순수 클라이언트 상태 저장/복원), 마이그레이션 불필요. ⑥ 안전 백로그·⑧ monday UX 모두 [x] 소진 상태(★ 최우선 2건은 신규 테이블이라 야간 금지)라, 기존 뷰 설정 유지 패턴(density/cols/fulltag)을 그룹화·정렬로 확장한 보너스 폴리시로 진행.
- 검증: tsc --noEmit 통과(에러 0). (야간 OneDrive 마운트 동기화 지연으로 ResourceView.tsx 마운트 사본이 419줄 모달 field 입력(`f.hint`) 뒤에서 잘려 tsc 오탐 위험 → 호스트 원본(Read/Edit) 무결성 확인 후 python(utf-8)으로 마운트 사본의 잘린 꼬리(field 닫힘~modal-f·form/Shell 닫힘·안내주석)를 원본과 동일 431줄로 재구성해 0에러 재확인.)

## 2026-07-08 (야간 배치 23 — 배포 대기)
- 공통 ⑥/⑧: **검색·상태 필터 원클릭 초기화 칩** — ResourceView 상단 툴바의 건수 배지 옆에, 검색어(q)나 상태 필터(filter)가 활성일 때만 나타나는 `초기화` 버튼(X 아이콘)을 추가. 클릭 시 검색어와 상태 필터를 한 번에 비워 전체 목록으로 즉시 복귀. 그동안 검색 입력창의 X는 검색어만 지우고, 상태 필터는 드롭다운에서 "전체 상태"로 따로 되돌려야 했던 번거로움을 해소(monday식 목록 편의). 필터·검색이 없으면 표시되지 않아 툴바가 깔끔하게 유지됨. 배치19의 `표시건/전체건` 비율 배지와 짝을 이뤄 필터링 상태 인지→해제 흐름이 완성됨. — src/components/ResourceView.tsx (단일 파일, 카운트 배지 옆 조건부 버튼 1줄)
- 데이터/스키마·타입 영향 없음(순수 클라이언트 상태 초기화), 마이그레이션 불필요. ⑥ 백로그는 전 항목 완료 상태라 monday UX(⑧) 연장선의 보너스 폴리시로 진행(안전 항목 소진, ★ 최우선 2건은 신규 테이블이라 야간 금지).
- 검증: tsc --noEmit 통과(에러 0). (야간 OneDrive 마운트 동기화 지연으로 ResourceView.tsx 마운트 사본이 line 420 모달 푸터(`modal-f` 버튼) 중간에서 잘려 tsc 오탐 위험 → 호스트 원본(Read/Edit) 무결성 확인 후 python(utf-8)으로 마운트 사본의 잘린 꼬리(modal-f~Shell 닫힘·안내주석)를 원본과 동일 427줄로 재구성해 0에러 재확인.)

## 2026-07-06 (야간 배치 22 — 배포 대기)
- 공통 ⑥/⑧: **상세 슬라이드오버 기한 필드 D-day·초과 강조** — 목록 기한(due/end) 셀에만 적용되던 임박(≤7일,