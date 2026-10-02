# 공표 정정 자동 재수집 — 구현 계획

> 설계 정본: `docs/superpowers/specs/2026-10-02-correction-auto-refetch-design.md`(커밋 `485a3e7`).
> **계약(이름·값·순서·종료코드·스키마)은 전부 설계서에 있다. 이 계획은 작업 분해와 순서만 정한다.** 둘이 어긋나면 설계서가 이긴다.

**목표**: 외부 대조가 진행 중 시즌에서 찾을 결함 후보를 관문 앞에서 감지하고, 그 차이를 만들 수 있는 경기만 그 실행 안에서 다시 받아 적재한다. 풀리지 않으면 관문이 지금처럼 막는다(사용자 결정 ②).

## 전역 제약 (모든 작업에 적용)

- 외부 요청 0(시험은 가짜 fetcher · 저장된 픽스처) · `scripts/update.ts` 를 import·실행하지 않는다.
- 새 시험은 **고치기 전 코드에서 붉어지는 것**을 확인한 뒤 채택한다(루트 §1).
- 시계 직접 호출 금지(M6) — `scripts/correction-refetch.ts` 만 1회(`clock-injection.test.ts` 허용 목록).
- 이름 문자열로 선수를 잇지 않는다(M10) — 후보 조회는 `player_id`·팀으로만.
- 파서·계산식 한 벌(M1) — 범위 조각 `crosscheckScope` 를 crosscheck 두 SQL 과 후보 조회가 함께 쓴다.
- 상한 값의 정본은 `packages/store/src/refetch-limit.ts`(import 0개인 잎).
- 로컬 `data/bb.sqlite` 는 시험이 바꿀 수 있다 — 작업 끝에 sha256 이 `05a306f2446f…` 인지 확인하고 아니면 세션 백업에서 `cp -p` 로 되돌린다.
- 커밋은 작업마다 1개 이상 · 명시한 경로만 stage.

## 작업 (차례대로 · 구현자 1명씩)

### 작업 A — 감지 쪽(crosscheck)
- 파일: `packages/aggregate/src/crosscheck-fields.ts`(새 · 잎) · `packages/aggregate/package.json`(서브패스) · `packages/aggregate/tools/crosscheck.ts` · `packages/aggregate/src/crosscheck-classify.ts`.
- 설계: D2 · D3(`as_of.source`) · D4(닫힌 표 35행 · `parseFieldValue`) · D5 의 `crosscheckScope`.
- 시험: T1 · T2 · T12 의 `crosscheck-classify.test.ts` 픽스처(`playerId`).
- 산출 인터페이스: `CROSSCHECK_FIELDS` · `crosscheckScope(alias)` · `parseFieldValue(field, s)` · `crosscheckEmitStatus(...)` · `--emit <path>` JSON 스키마 1.

### 작업 B — 받기 쪽(archiver)
- 파일: `packages/archiver/src/discover.ts`(`gameRefFromId`) · `fetcher.ts`(`RETRYABLE` 내보내기만) · `sink.ts`(`RestorableSink`) · `metered-fetch.ts`(새) · `refetch-games.ts`(새) · `cli-games.ts`(새) · `packages/store/src/refetch-limit.ts`(상수 6개 · 주석 168→182).
- 설계: D7 전체(D7-1 ~ D7-10) · D12.
- 시험: T7 · T13.

### 작업 C — 판단·진입점(scripts)
- 파일: `scripts/correction-plan.ts`(순수) · `scripts/correction-candidates.ts`(DB 읽기 전용) · `scripts/correction-refetch.ts`(진입점 · `main(deps)` · `--plan-only`).
- 설계: D5 · D6 · D8 · D9 · D14 · §0 의 3차 결정(R3-2 다시 적재 조건 · R3-4 `parseHistory` · R3-5 실행 ref).
- 시험: T3(⑩·⑪ 포함) · T4 · T5 · T6 · T9 · T11.
- 소비: 작업 A 의 `crosscheck-fields` · 작업 B 의 `cli-games.ts` CLI 계약과 `refetch-limit.ts` 상수.

### 작업 D — 배선·런북(workflow · docs)
- 파일: `.github/workflows/daily.yml`(`job-start` · `decide` 의 `slot` · 새 단계 · 기록 단계의 이력 반영 · 관문의 보고 출력 · `refetch_dates` 설명) · `docs/operations/deploy.md`(§7-I) · `scripts/test/refetch-wiring.test.ts` · `scripts/test/retry-slot.test.ts`.
- 설계: D1 · D10 · D13 의 T8 · T10 · T12(`retry-slot`).
- 시험: T8 · T10 · T12.

## 검증 (작업 D 뒤)

1. 분할 러너로 전체 시험(FAIL·ERROR 를 갈라 분모와 함께).
2. 실측 검증(설계 D13 끝): 정정 전 CI 사본 DB(세션 스크래치)로 `crosscheck.ts --emit` → `status: "defects"` · `player_id: "91095136"` · `team: "t"` / 진입점 `--plan-only` → 고른 날짜 `2026-09-23, 2026-09-17, 2026-05-13`.
3. 배포 전 `shiro-core:triple-review`(루트 §4 · 고위험).
4. 머지 뒤 첫 정시 실행의 보고 첫 줄.

## 진행 기록

(작업이 끝날 때마다 한 줄: `작업 X: 완료 (커밋 a..b · 시험 N/N)`)
