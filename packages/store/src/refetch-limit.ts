/**
 * 재수집 날짜의 상한. **L1 근거**다 — 하루 최대 6경기 × 4장 × 7일 = 168요청 ≈ 3초 간격 8.4분.
 * ⚠**여기가 유일한 정본이다**(M1) — `load-archive.ts` 의 복구 힌트 출력과 `scripts/date-window.ts` 의
 * `parseRefetchDates` 둘 다 이 값을 가져다 쓴다. 두 곳에 따로 적으면 하나만 고쳐졌을 때 어긋난다.
 *
 * ⚠**이 파일은 import 가 0개인 잎(leaf)이어야 한다**(감사 반영 I1). `scripts/update.ts`(수집
 * 오케스트레이터)가 `date-window.ts` 를 거쳐 이 값을 가져오는데, 그 스크립트는 경기·予告先発
 * 수집을 각각 자식 프로세스로 격리해 **부분 실패를 전체 실패로 만들지 않는다.** 이 상수가
 * store 배럴(`./index.ts`)을 거쳐 오면 parser·domain 까지 통째로 평가되고, 그중 **어디서든**
 * 로드 시점 오류가 나면 수집이 시작하기도 전에 죽는다 — **수집이 무관한 모듈 결함에 묶이지
 * 않게** 여기를 잎으로 둔다(`scripts/test/refetch-wiring.test.ts` 가 강제한다).
 */
export const MAX_REFETCH_DATES = 7;
