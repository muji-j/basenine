/**
 * 재수집 상한의 정본. **L1 근거**다.
 * ⚠**여기가 유일한 정본이다**(M1) — `load-archive.ts` 의 복구 힌트 출력, `scripts/date-window.ts` 의
 * `parseRefetchDates`, 정정 자동 재수집(`packages/archiver/src/refetch-games.ts` · `cli-games.ts` · `scripts/correction-*.ts`)이
 * 전부 이 값을 가져다 쓴다. 두 곳에 따로 적으면 하나만 고쳐졌을 때 어긋난다.
 *
 * ⚠**이 파일은 import 가 0개인 잎(leaf)이어야 한다**(감사 반영 I1). `scripts/update.ts`(수집
 * 오케스트레이터)가 `date-window.ts` 를 거쳐 이 값을 가져오는데, 그 스크립트는 경기·予告先発
 * 수집을 각각 자식 프로세스로 격리해 **부분 실패를 전체 실패로 만들지 않는다.** 이 상수가
 * store 배럴(`./index.ts`)을 거쳐 오면 parser·domain 까지 통째로 평가되고, 그중 **어디서든**
 * 로드 시점 오류가 나면 수집이 시작하기도 전에 죽는다 — **수집이 무관한 모듈 결함에 묶이지
 * 않게** 여기를 잎으로 둔다(`scripts/test/refetch-wiring.test.ts` 가 강제한다).
 * ⚠아카이버(`@bb-app/archiver`)도 서브패스 `@bb-app/store/refetch-limit` 로 **이 파일만** 가져온다 — 잎이라 다른 모듈을 끌어오지 않는다.
 *
 * ⚠**자동 상한(`AUTO_REFETCH_*`)의 계산은 서로 기댄다**(설계 `docs/superpowers/specs/2026-10-02-correction-auto-refetch-design.md` D7-8 · D12).
 *   `MAX_REDIRECTS`(3 · `packages/archiver/src/fetcher.ts`)와 `--delay` 기본값(3000ms · `packages/archiver/src/cli-games.ts`)에도 기댄다.
 *   **`scripts/test/correction-budget.test.ts`(T13)가 코드의 상수로 그 합을 다시 셈한다** — 하나를 키우면 거기서 붉어진다.
 */

/**
 * 한 실행의 재수집 날짜 상한. **수동(`refetch_dates`)과 정정 자동 재수집이 나눠 쓴다**(설계 D6 의 9 · `7 − 수동 날짜 수`).
 * ⚠~~하루 최대 6경기 × 4장 × 7일 = 168요청~~ 은 **월간 일정을 빠뜨린 수**였다(2026-10-02 정정 · 설계 D12).
 *   수동 경로는 날짜마다 그 달·다음 달 월간 일정 2장을 더 받으므로 6경기 × 4장 × 7일 + 2장 × 7일 = **182** 다.
 *   ⚠**그것도 논리 페이지 수다** — 실제 HTTP 전송은 재시도·리디렉트로 더 많다(수동 경로는 기본 `maxRetries` 3 이라
 *   논리 페이지당 ≤ 16전송 · 설계 D7-7). 전부 200 이면 182 × 3초 간격 ≈ 9.1분이다.
 */
export const MAX_REFETCH_DATES = 7;

/**
 * 결함 후보(관문이 찍는 수 · `defects` 전체)가 이보다 많으면 자동 재수집을 하지 않는다(설계 D6 의 6 · `too_many_defects`).
 * 근거: 정정 하나의 발자국은 전형 4~7건 · 극단 약 12건이고, 체계적 원인의 실측 최소는 ≥ 79건이다(설계 M-O) — 20은 그 사이다.
 * ⚠작은 체계적 원인(2024 `犠失` · 6건)은 이 상한으로 못 가른다 — 그때는 소진으로 사람에게 간다(낭비는 실행당 HTTP 128 로 묶인다).
 */
export const AUTO_REFETCH_MAX_DEFECTS = 20;

/**
 * 한 실행의 자동 재수집 경기 상한 = **논리 페이지 96**(4장 × 24 · 하루 정시 3회면 288 · 설계 D7-7).
 * 전형적인 정정(키 1~3개 × 7일 ≤ 21경기)을 한 실행에 담는 크기다. ⚠시간은 이 값이 아니라 마감(`AUTO_REFETCH_START_DEADLINE_MIN`)이 지킨다.
 * ⚠받기 도구(`cli-games.ts`)는 이보다 많은 줄을 **요청 0으로 종료 2** 로 거부한다(L1 의 마지막 방어선).
 */
export const AUTO_REFETCH_MAX_GAMES = 24;

/**
 * 잡 시작 뒤 이 분이 지나면 계획 시점에 받지 않고(설계 D6 의 8 · `time_budget`), 경기를 새로 시작하지도 않는다(D7-4 · `deadline`).
 * ⚠두 자리가 **같은 식**이다 — `elapsedMs >= AUTO_REFETCH_START_DEADLINE_MIN × 60_000`(= `now >= deadline`).
 * 잡 최악 43.06분 ≤ 45 · 여유 1.94분(설계 D7-8 · T13 이 다시 셈한다).
 */
export const AUTO_REFETCH_START_DEADLINE_MIN = 25;

/**
 * 자동 경로 `PoliteFetcher` 의 `maxRetries` — 시도 ≤ 2 · 페이지당 전송 ≤ 8(설계 D7-3).
 * ⚠**평소 수집의 기본값 3 은 바꾸지 않는다** — 그쪽은 거르면 영영 못 받는 予告先発·당일 경기를 받는다.
 * 이 경로는 급하지 않다: 못 받은 경기는 `fetched_at` 이 그대로라 다음 정시 실행이 다시 고른다(E2). 아픈 상대를 네 번 치지 않는다(L1).
 */
export const AUTO_REFETCH_MAX_RETRIES = 1;

/**
 * 자동 경로의 전송 하나의 시간 상한(ms). 실측 최대 전송 시간 0.191초(설계 M-Q · 145간격)의 26배다.
 * ⚠평소 fetcher 에는 시간 상한이 없다(설계 M-R) — 상한이 런타임 기본값에 달려 한 경기의 최악을 셀 수 없었다.
 * 넘으면 예외 → 재시도 대상 → **고통 신호**(회로 차단 · D7-4). 5초보다 느린 응답은 그 자체로 상대가 아프다는 신호로 본다.
 */
export const AUTO_REFETCH_REQUEST_TIMEOUT_MS = 5000;

/**
 * 한 실행의 실제 HTTP 전송 상한 = 정상 24경기(96) + 한 경기 최악(32 = 4장 × 2시도 × (1 + 3홉)).
 * 경기를 **시작하기 전에** `http + 32 > 128` 이면 멈추므로 **절대 넘지 않는다**(설계 D7-4).
 */
export const AUTO_REFETCH_MAX_HTTP = 128;
