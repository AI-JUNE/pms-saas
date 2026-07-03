# PRISM PMS — 변경 이력 (CHANGELOG)

> 야간 자동 개발이 매 실행마다 최신 항목을 **맨 위에** 추가합니다.
> 아침에 `배포.ps1` 실행 → GitHub 푸시 → Vercel 자동배포.

## 2026-07-04 (야간 배치 13 — 배포 대기 · ⚠️마이그레이션 필요)
- 간트/WBS ①: **베이스라인(기준선) 이중 막대** — 업무에 `기준선 시작/마감(계획)`(baselineStart·baselineEnd) 날짜 필드를 추가하고, 간트차트 각 작업 막대 **아래에 옅은 기준선 막대**를 렌더링해 "최초 계획 vs 현재 일정"을 한눈에 비교. 현재 마감이 기준선보다 늦으면 기준선 막대를 **적색·툴팁에 "N일 지연"**, 빠르면 "N일 단축", 같으면 "계획대로"로 표기. 헤더 범례에 `▬ 기준선(계획)` 추가. 기준선 미입력 작업은 기존과 동일(추가 렌더 없음)해 영향 없음. — db/schema.ts(tasks.baseline_start/baseline_end), lib/migrate.ts(ALTER 2건), lib/configs.ts(tasks fields 화이트리스트), app/tasks/page.tsx(폼 필드 2), components/views.tsx(간트 렌더)
- ⚠️ tasks 신규 컬럼 baseline_start·baseline_end(둘 다 nullable text) — 배포 후 기동훅(ensureSchema)이 자동 정합하거나, 필요 시 관리자 > "스키마 업데이트 실행" 1회. 기존 데이터/동작 무영향(순수 추가·표시 로직).
- 검증: tsc --noEmit 통과(에러 0). (야간 OneDrive 마운트 동기화 지연으로 tsc가 schema·configs·migrate·tasks·views 5개 사본을 각각 끝단이 잘린 상태로 읽어 오탐 → 호스트 원본(Read) 무결성 확인 후 python(utf-8)으로 마운트 사본을 원본과 동일 재구성해 0에러 재확인.)

## 2026-07-04 (야간 배치 12 — 배포 대기)
- 안정화 ④ **RBAC 결재 경계 강화** — 공용 CRUD(lib/crud.ts)에 설정 기반 `approveOn`(필드+확정값 목록)을 추가. 항목 PATCH 시 상태를 **결재 확정값**으로 변경하는 요청은 기존 `write`에 더해 `approve` 권한을 추가로 요구하도록 게이트. 산출물(documents) 설정에 `approveOn: { field:'status', values:['approved','rejected'] }`를 배선 — 이제 **승인/반려는 PM·PMO·관리자(approve 이상)만** 가능하고, 일반 멤버(write)는 결재 확정을 할 수 없음(자가결재 방지). 조직관리자·슈퍼관리자는 기존대로 전권. 일반 편집/생성/삭제 흐름은 영향 없음. — lib/crud.ts, lib/configs.ts (2개 파일)
- 스키마/DB 변경 없음, 마이그레이션 불필요. 권한 판정만 강화(hasPermission의 approve 랭크 재사용).
- 보류·메모: 목록 GET의 **읽기(read) 게이트**는 커스텀 롤(권한 미부여) 사용자가 즉시 잠길 위험이 있어 야간 자동 적용에서 제외(주간 검토 권장). 쓰기/관리 경계는 기존 write/isOrgAdmin 검사로 이미 강제됨 확인.
- 검증: tsc --noEmit 통과(에러 0). (야간 OneDrive 마운트 동기화 지연으로 tsc가 crud.ts·configs.ts 사본을 각각 76/19줄에서 잘린 상태로 읽어 오탐 → 호스트 원본(Read) 무결성 확인 후 python(utf-8)으로 마운트 사본을 원본과 동일 재구성해 0에러 재확인.)

## 2026-07-04 (야간 배치 11 — 배포 대기)
- 안정화 ④: **삭제 시 관련 데이터 정합성 가드** — 공용 CRUD(lib/crud.ts)에 `guardDelete` 훅을 추가하고 DELETE 실행 전 호출. (1) **단계 삭제 차단** — 해당 단계를 사용 중인 업무(tasks.phase=단계명)가 있으면 삭제를 막고 "단계를 변경하세요" 안내(고아 단계 방지). (2) **상위 작업 삭제 차단** — parentId로 연결된 하위 작업이 있으면 삭제를 막아 WBS 계층 고아 방지. 두 가드를 configs.ts의 phases/tasks 설정에 배선. 위반 시 사용자 친화 메시지(ApiError VALIDATION)로 응답, 정상 삭제는 그대로 동작. — lib/crud.ts, lib/configs.ts (2개 파일)
- 스키마/DB 변경 없음, 마이그레이션 불필요. 조회(select limit 1) 기반 가드로 삭제 경로만 보강.
- ROADMAP 정리: ① **WBS 계층구조**(★/CC 배치와 중복)를 완료 확인 체크오프.
- 검증: tsc --noEmit 통과(에러 0). (야간 OneDrive 마운트 동기화 지연으로 crud.ts·configs.ts 사본이 각각 59/18줄로 잘려 tsc 오탐 → 호스트 원본(Read) 무결성 확인 후 python(utf-8)으로 마운트 사본을 원본과 동일 재구성해 0에러 재확인.)

## 2026-07-04 (야간 배치 10 — 배포 대기)
- 간트/WBS ①: **단계(phase)별 스윔레인 + 접기/펼치기** — 간트차트에서 작업을 phase 필드로 자동 그룹핑해 단계 헤더 행(색상 점·단계명·작업수)으로 묶고, 각 헤더의 타임라인에 단계 전체 기간을 나타내는 옅은 요약 바를 표시. 헤더 클릭으로 해당 단계 작업을 **접기/펼치기**하고, 상단에 **"단계 묶기" 토글**(단계가 2개 이상일 때만 노출)로 그룹/평면 뷰 전환. 단계 미지정 작업은 "단계 미지정"으로 묶음. 표시 행 좌표를 그룹 헤더까지 반영해 계산하므로 의존선 화살표·오늘선·주말/월 격자·임계경로 강조가 접힘 상태에서도 정확히 정렬. — components/views.tsx (단일 파일)
- 데이터/스키마 영향 없음(기존 tasks.phase 텍스트 필드 재사용), 마이그레이션 불필요. 클라이언트 표시 로직만 추가.
- 검증: tsc --noEmit 통과(에러 0). (야간 OneDrive 마운트 동기화 지연으로 마운트 사본이 324줄에서 잘린 상태로 제공되어 tsc가 미종료 JSX 오탐 → 호스트 원본(Read) 무결성 확인 후 outputs 경유 python(utf-8)으로 마운트 사본을 원본과 동일하게 재구성해 0에러 재확인.)

## 2026-07-04 (야간 배치 9 — 배포 대기)
- 리포트/분석 ⑤: **테스트 실행 결과 리포트(통과율·실패)** 추가 — 리포트 화면에 '테스트 실행 결과' 카드(전체 통과율 대형 표기+실행 n/전체, 통과·실패·블록·미실행 결과 분포 막대)와 '프로젝트별 테스트 통과율' 표(실행/통과/실패/통과율, 80%↑ 녹색·50%↑ 주황·미만 빨강)를 신설. 통과율=통과/(통과+실패), 미실행 제외. 엑셀 내보내기에 '테스트실행' 시트도 추가. `/api/tests` 로드만 추가한 클라이언트 집계로 DB·타입·스키마 영향 없음, 마이그레이션 불필요. — app/reports/page.tsx (단일 파일)
- 검증: tsc --noEmit 통과(에러 0). (야간 OneDrive 마운트 동기화 지연으로 tsc가 reports 사본을 138줄에서 잘린 상태로 읽어 오탐 → 호스트 원본(Read) 무결성 확인 후 outputs 경유로 마운트 사본을 원본과 동일하게 재구성해 0에러 재확인.)

## 2026-07-03 (야간 배치 8 — 배포 대기)
- 리포트/분석 ③: **엑셀 내보내기(다중 시트)** 추가 — 리포트 화면 상단에 '엑셀 내보내기' 버튼 신설. 외부 라이브러리 없이 **SpreadsheetML(엑셀 XML)** 로 워크북을 생성해 6개 시트(프로젝트·담당자별이슈·스프린트벨로시티·이슈·리스크·요구사항)로 **시트 분리** 다운로드. 헤더는 브랜드색(#BE5535) 스타일 적용, 파일명 `PRISM_리포트_YYYY-MM-DD.xls`, 한글 UTF-8 BOM 처리. npm 설치 불필요. — app/reports/page.tsx (단일 파일)
- 검증: tsc --noEmit 통과(에러 0). 클라이언트 전용 추가로 DB·타입·스키마 영향 없음, 마이그레이션 불필요. (야간 OneDrive 마운트 동기화 지연으로 tsc가 reports 꼬리가 잘린 사본을 읽어 오탐 → 호스트 원본(Read) 무결성 확인 후 마운트 사본을 원본과 동일하게 재구성해 0에러 재확인.)

## 2026-07-03 (야간 배치 7 — 배포 대기)
- 안정화 ④: **로딩 스켈레톤 통일** — 리포트·업무부하·RTM·내작업·프로젝트 상세의 로딩 표시를 기존 "불러오는 중…" 텍스트에서 대시보드와 동일한 `.skel` 스켈레톤(카드/표 행 형태)으로 교체해 전 화면 로딩 경험을 일관화. DB·타입 영향 없음. — app/reports, app/workload, app/rtm, app/mywork, app/projects/[id]
- ROADMAP 정리: 이미 구현 확인된 항목 체크오프 — ② **상세 슬라이드오버 스와이프 닫기**(ResourceView onOverTouch*·grip 구현 확인), ⑧ **monday UX 요약 라인**(하위 전 항목 완료), ④ **로딩/빈 상태 일관화**.
- 검증: tsc --noEmit 통과(에러 0). CSS/JSX 표시만 변경, 마이그레이션 불필요. (야간 OneDrive 마운트 동기화 지연으로 tsc가 5개 파일의 잘린 사본을 순차로 읽어 반복 오탐 → 호스트 원본(Read) 무결성 확인 후 마운트 사본을 원본과 동일하게 재구성해 0에러 재확인.)

## 2026-07-03 (야간 배치 6 — 배포 대기)
- 모바일 ②: **KPI/차트 카드 레이아웃 최적화** — 좁은 화면에서 카드 여백(.card-pad)을 줄여 도넛+범례 공간을 확보하고, 대시보드 도넛 차트(150px 고정)를 ≤640px에서 120px로 축소해 범례와 겹침·넘침을 방지. ≤400px 초소형 화면에선 도넛(위)+범례(아래) 세로 배치로 전환하고 KPI 값·여백을 살짝 줄여 2열에서 숫자가 넘치지 않도록 함. — components? 아님: app/globals.css(v22), app/dashboard(Donut에 .donut-wrap/.donut-svg 클래스 훅 2개만 추가)
- 검증: tsc --noEmit 통과(에러 0). CSS + className 2건 추가로 DB·타입 영향 없음, 마이그레이션 불필요. (야간 OneDrive 마운트 동기화 지연으로 tsc가 dashboard 꼬리 4줄이 잘린 사본을 읽어 오탐 → 호스트 원본(Read)으로 무결성 확인 후 마운트 사본 보정해 0에러 재확인.)

## 2026-07-03 (주간 배치 II — 배포 자동 마이그레이션 · 무인 자동배포)
- 핵심(안정화): **배포 시 마이그레이션 자동 실행** — Next.js instrumentation(서버 기동 훅)에서 스키마 자가정합(ensureSchema)을 1회 실행. 이제 스키마가 바뀐 배포도 **관리자 버튼 없이** 자동 정합 → 오늘 같은 "배포 직후 컬럼 미적용으로 화면 멈춤" 원천 차단. — src/instrumentation.ts, src/lib/migrate.ts, next.config.js
- 리팩터: 마이그레이션 DDL을 lib/migrate로 공용화(라우트/기동훅 공유). ensureSchema는 인스턴스당 1회·throw 없음(요청 무영향). — lib/migrate, app/api/admin/migrate
- 배포 스크립트: **tsc 검증 게이트** 추가 — 타입 오류 시 푸시 중단(무인 자동배포에서 깨진 코드 방지). SETUP-SCHEDULE.ps1로 **2시간마다 자동 배포** 예약작업 등록(주말 무인 운영). (로컬 스크립트, 미배포)
- 검증: tsc --noEmit 통과(에러 0).

## 2026-07-03 (주간 배치 HH — 성능/DB 튜닝 · 배포 대기 · ⚠️마이그레이션 필요)
- 성능(핵심): **세션 토큰 인덱스** 추가 — 모든 인증 요청이 매번 sessions.token 전체 스캔하던 것을 인덱스 조회로 전환(요청당 DB 비용 대폭 감소). — db/schema, migrate
- 성능: **담당자/소유자 인덱스** 추가 — 내 작업·업무 부하의 담당자 필터 조회 가속(tasks/issues.assignee, risks.owner). — db/schema, migrate
- 안정화(중요): 마이그레이션을 **문장별 예외 처리**로 견고화 — 한 문장 실패가 전체를 중단시키지 않고 나머지를 계속 적용(applied/failed 리포트). 배포 직후 신규 컬럼 미적용으로 화면이 멈추는 문제 재발 방지. — app/api/admin/migrate
- 버그(운영): EE·FF 배포 직후 tasks 신규 컬럼(planned/actual_hours) 미마이그레이션으로 tasks·my-work·dashboard가 500 → 스키마 업데이트 실행(31개 적용)으로 복구 확인.
- ⚠️ 신규 인덱스 — 배포 후 관리자 > "스키마 업데이트 실행" 1회.
- 검증: tsc --noEmit 통과(에러 0). 16개 API 200 라이브 확인.

## 2026-07-03 (주간 배치 EE·FF — 배포 대기 · ⚠️마이그레이션 필요)
- 핵심 ★ **테스트 실행 리포트** (EE) — 프로젝트 상세에 **통과율·실행/전체·통과/실패/블록** + 결과 분포 막대 + 검증단계(개발·PL·PM·완료) 요약 카드 추가. DB 변경 없음. — app/api/project-summary, app/projects/[id]
- 핵심 ★ **공수(계획/실제 시간)** (FF) — 업무에 계획공수·실제공수(시간) 입력 추가. EVM을 **공수 시간 기준**으로 전환(입력 시): **AC(실제원가)·CPI(원가효율)** 실값 계산·표시. 공수 미입력 시 기존 작업수 기준으로 자동 폴백. — db/schema(tasks.planned_hours/actual_hours), lib/configs, app/tasks, app/api/project-summary, app/projects/[id]
- ⚠️ tasks 신규 컬럼 planned_hours·actual_hours — 배포 후 관리자 > "스키마 업데이트 실행" 1회.
- 검증: tsc --noEmit 통과(에러 0).

## 2026-07-03 (주간 배치 CC — 배포 대기 · ⚠️마이그레이션 필요)
- 핵심 ★ **WBS 계층구조** — 업무에 **상위 작업** 지정 기능 추가. 목록이 상위→하위 순으로 자동 정렬되고, **WBS 번호(1·1.1·1.2)** 부여 + 단계별 **들여쓰기**로 계층 표시. 상위 작업은 현재 프로젝트 작업 중에서 선택(자기 자신 제외). — db/schema(tasks.parent_id), lib/configs, components/ResourceView(treeKey), app/tasks
- 편의: 관리자 화면에 **"DB 스키마 업데이트" 버튼** 추가 — 배포 후 원클릭으로 마이그레이션 실행(반복 안전). — app/admin
- ⚠️ tasks 신규 컬럼 parent_id — 배포 후 관리자 > "스키마 업데이트 실행" 1회 클릭.
- 검증: tsc --noEmit 통과(에러 0).

## 2026-07-03 (야간 배치 5 — 배포 대기)
- 모바일 ②: **하단 탭바 네비게이션** 신규 — 모바일(≤860px)에서 화면 하단에 고정 탭바(대시보드·내 작업·업무·알림)를 추가해 엄지 도달 범위에서 핵심 화면 전환. 현재 경로 active 강조, 알림 미읽음 배지 표시, iOS 세이프에어리어(safe-area-inset) 대응, 콘텐츠 하단 패딩 확보. 데스크톱에선 미표시. — components/Shell.tsx, app/globals.css
- 안정화/버그픽스 ④: **globals.css 손상 복구** — 직전 배치들의 OneDrive 동기화 잘림으로 `@media (max-width:520px)` 블록의 `.kpis{…;gap:8` 규칙이 미완결·미닫힘 상태로 남아, v20 포커스링(:focus-visible) 전역 블록이 통째로 520px 미디어쿼리에 갇혀 있던 문제 수정. 규칙을 `gap:8px}`로 완결하고 미디어쿼리를 정상 종료해 포커스링이 전 해상도에서 다시 동작하도록 복원. — app/globals.css
- 검증: tsc --noEmit 통과(에러 0). CSS·컴포넌트 변경, DB·타입영향 없음, 마이그레이션 불필요. (야간 OneDrive 마운트가 Shell.tsx를 잘린 사본으로 제공해 tsc가 오탐 → 호스트 원본(Read)으로 무결성 확인 + 완전 사본 재구성 후 tsc 0에러 확인.)

## 2026-07-03 (야간 배치 4 — 배포 대기)
- 모바일 ②: **터치 타깃 44px 확보** — 모바일(≤860px)에서 버튼(.btn)·셀렉트(.sel)·입력(.in)·메뉴버튼을 최소 44px 높이로, 아이콘버튼(.iconbtn)을 44×44px로 확대. 네비/메뉴 항목·목록 행(td) 세로 패딩을 늘려 탭 영역을 넓히고, 세그먼트 버튼·행 빠른액션 버튼도 40px+ 확보. 인라인 상태배지(.pill)는 제외해 표 가독성 유지. — app/globals.css
- 검증: tsc --noEmit 통과(에러 0). CSS 전용 변경, DB·타입 영향 없음. (야간 OneDrive 마운트 동기화 지연으로 tsc는 직전 사본을 읽었으나 CSS는 타입검사 무관.)

## 2026-07-03 (야간 배치 3 — 배포 대기)
- 안정화/접근성 ④: **키보드 포커스 링 통일** — 링크·버튼·입력·셀렉트·역할요소(role=button/tab/menuitem)에 `:focus-visible` 브랜드 색 링을 전역 적용(마우스 클릭엔 숨김, Tab 탐색엔 노출). 폼 입력은 기존 box-shadow 링과 이중 표시되지 않게 예외 처리. 목록 행 포커스 시 배경 강조. — app/globals.css
- 접근성: **prefers-reduced-motion** 지원 추가 — 모션 최소화 설정 사용자에겐 애니메이션/트랜지션을 사실상 제거. — app/globals.css
- 검증: tsc --noEmit 통과(에러 0). CSS 전용 변경, DB·타입 영향 없음.

## 2026-07-03 (야간 배치 2 — 배포 대기)
- 리포트/분석 ★: **획득가치(EVM) 카드** 추가 — 프로젝트 상세에 PV(계획가치)·EV(획득가치)·SV(일정차이)·SPI를 표시. 작업 환산 단위(BAC=작업 수)로 계산해 DB 변경 없음. AC(실제원가)·CPI는 공수(실적) 데이터 연동 시 표시(현재 '—' 플레이스홀더). — app/api/project-summary/route.ts, app/projects/[id]/page.tsx
- 검증: tsc --noEmit 통과(에러 0). DB 변경 없음(마이그레이션 불필요).

## 2026-07-03 (야간 배치 — 배포 대기)
- monday UX/⑧: **컬럼 표시/숨김 토글** 추가 — 툴바 '컬럼' 버튼으로 각 목록의 표시 컬럼을 체크박스로 켜고 끔. 화면(제목)별로 localStorage(pms.cols.{제목})에 기억. 표/스켈레톤/그룹헤더/빈상태/빠른추가 colSpan 모두 표시 컬럼 수에 맞춰 정합. — components/ResourceView.tsx
- monday UX/⑧: **풀셀 컬러 태그** 옵션 — 툴바 '컬러셀' 토글 시 상태/우선순위 등 배지 셀 전체에 상태 색상 배경을 입혀 스캔 가독성↑(monday식). localStorage(pms.fulltag)에 기억. — components/ResourceView.tsx
- 검증: tsc --noEmit 통과(에러 0). DB 변경 없음. (야간 중 OneDrive 마운트 동기화 지연으로 tsc가 잘린 사본을 읽는 이슈가 있어, 원본을 재구성해 검증함.)

## 2026-07-02 (야간 배치 3 — 배포 대기)
- monday UX/⑧: **행 hover 시 빠른 액션 노출** — 목록 행의 수정/삭제 버튼을 평소 숨기고 마우스 hover(또는 포커스) 시 부드럽게 표시(스캔 가독성↑). 터치 기기(hover 없음)에서는 항상 표시. — components/ResourceView.tsx, app/globals.css
- monday UX/⑧: **행 밀도(컴팩트/편안) 전환** 토글 추가 — 툴바 버튼으로 표 셀 패딩/폰트를 컴팩트↔편안 전환, localStorage(pms.density)에