/**
 * **수집·적재 단계(30분) 안에 드는 선수 재취득 상한**(설계 `docs/superpowers/specs/2026-10-24-collection-resilience-design.md` D6 ·
 * 2026-10-24 3중 검토 반영 — 1차 P2-2 · 2차 F2).
 *
 * ⚠**왜 있는가**: 이 PR 이 `수집·적재` 단계에 30분 걸쇠를 걸었다. 장애가 풀린 뒤의 **복구 실행**은 따라잡기로 대상 경기일이 최대 9일
 *   (어제 − 7 ~ 오늘)이고, 날짜 하나가 최대 26요청(6경기 × 4장 + 그 달·다음 달 월간 일정)이라 날짜만으로 십수 분이 든다. 거기에 선수 재취득
 *   400명(기본 상한)이 얹히면 걸쇠가 단계를 죽이고 — `rc` 출력이 없어 blocking(배포 0) — 다음 날도 같은 일이 되풀이된다.
 *   → 대상 경기일이 **2일을 넘으면** 선수 재취득 상한을 이 식으로 낮추고, 밀린 몫은 다음 실행이 잇는다(`emit-stale-player-ids` 가 밀린 수를 찍는다).
 * ⚠**정상 실행(1~2일)은 건드리지 않는다**(브리프 결정) — 설정값(기본 400) 그대로다. 그 경우의 시간은 실측 요청 속도에 기대고 이 식의 보수값으로는
 *   경계를 넘는다(설계 D6 의 표 · 뒤집힐 조건).
 * ⚠**순수다 — 시계·I/O 없음.** 가져오는 것은 import 0개인 잎 `l1.ts` 하나뿐이다(`update.ts` 가 가져온다 · I1).
 */
import { L1_MIN_DELAY_MS, isValidDelayMs } from "../packages/archiver/src/l1.ts";

/** `수집·적재` 단계의 `timeout-minutes` — `daily.yml` 과 같아야 한다(`scripts/test/collect-budget.test.ts` 가 대조한다) */
export const STEP_LIMIT_MIN = 30;
/** `update.ts` 의 로컬 구간(DB 적재 103.7초 + 나머지 8.5초 · 2026-10-21 09:49Z 실측)을 올린 값 */
export const LOCAL_MIN = 2.0;
/** 여유(우리가 고른 값) — 러너의 흔들림 · 정정 감지 등 측정 밖의 몫 */
export const MARGIN_MIN = 3.0;
/**
 * 요청 하나의 시간 = 간격(`--delay`) + 이 응답 여유(초).
 * ⚠**보수값이다**: CI 실측은 선수 재취득 **3.06~3.16초/장**(17실행 · 2026-09-28~10-16 · 간격 3초)이라 응답 몫이 0.2초 안쪽이지만,
 *   로컬 백필 실측은 **3.96초/장**이다(CLAUDE.md §2-2) — 복구 실행은 장애 직후라 느린 쪽을 쓴다.
 */
export const RESPONSE_ALLOWANCE_S = 1.0;
/** 경기일 하나의 최대 요청 — 6경기 × 4장(`GAME_PAGES`) + 그 달 · 다음 달 월간 일정(날짜 자식마다 따로 받는다) */
export const REQUESTS_PER_DATE = 26;
/** 신규 선수 프로필 몫(우리가 고른 값) — 평소 0~수 명이고 대개 받아 둔 선수라 건너뛴다 */
export const NEW_PLAYER_RESERVE = 40;
/** 予告先発 1요청 */
export const STARTERS_REQUESTS = 1;
/** 날짜 자식 말고 받기 자식 수 — 予告先発 1 + 선수 둘(재취득 · 신규) · 자식 사이마다 간격 하나(collect-steps) */
export const CHILD_COUNT_BESIDES_DATES = 3;
/** 정상 실행의 대상 경기일 수 — 어제와 오늘. 이것을 넘으면 복구 실행으로 보고 상한을 낮춘다 */
export const NORMAL_MAX_DATES = 2;
function check(dates: number, n: number, delayMs: number): void {
  if (!Number.isInteger(dates) || dates < 0) throw new RangeError(`대상 경기일 수가 0 이상의 정수가 아니다: ${String(dates)}`);
  if (!Number.isInteger(n) || n < 0) throw new RangeError(`선수 수가 0 이상의 정수가 아니다: ${String(n)}`);
  // ⚠간격은 L1 술어 한 벌로 본다(M1 · `l1.ts`)
  if (!isValidDelayMs(delayMs)) throw new RangeError(`간격이 L1 하한(${String(L1_MIN_DELAY_MS)}ms) 밖이다: ${String(delayMs)}`);
}

/**
 * **최악 시간(분)** — 로컬 + (예고 + 날짜 × 26 + 선수 재취득 + 신규 선수 여유) × (간격 + 응답 여유) + (받기 자식 수 − 1) × 간격.
 * ⚠회로·장애 모양은 여기 없다(성공 경로의 시간) — 장애 중의 시간은 설계 D3 의 표가 맡는다.
 */
export function worstStepMin(dates: number, playerRefetch: number, delayMs: number): number {
  check(dates, playerRefetch, delayMs);
  const requestS = delayMs / 1000 + RESPONSE_ALLOWANCE_S;
  const requests = STARTERS_REQUESTS + dates * REQUESTS_PER_DATE + playerRefetch + NEW_PLAYER_RESERVE;
  const gaps = (dates + CHILD_COUNT_BESIDES_DATES - 1) * (delayMs / 1000);
  return LOCAL_MIN + (requests * requestS + gaps) / 60;
}

/**
 * **선수 재취득 상한** — 대상 경기일이 `NORMAL_MAX_DATES` 이하면 `configured` 그대로 · 넘으면 `worstStepMin ≤ 단계 제한 − 여유` 를 지키는 가장 큰 수
 * (`configured` 를 넘지 않고 1 아래로 내려가지 않는다 — 목록 도구는 양의 정수만 받는다).
 * 간격 3초면 3~9일이 252 · 225 · 198 · 172 · 145 · 118 · 91 이다.
 */
export function playerRefetchCap(dates: number, configured: number, delayMs: number): number {
  check(dates, configured, delayMs);
  if (configured < 1) throw new RangeError(`설정한 상한이 양의 정수가 아니다: ${String(configured)}`);
  if (dates <= NORMAL_MAX_DATES) return configured;
  const requestS = delayMs / 1000 + RESPONSE_ALLOWANCE_S;
  const availS = (STEP_LIMIT_MIN - LOCAL_MIN - MARGIN_MIN) * 60 - (dates + CHILD_COUNT_BESIDES_DATES - 1) * (delayMs / 1000);
  const fixed = STARTERS_REQUESTS + dates * REQUESTS_PER_DATE + NEW_PLAYER_RESERVE;
  const cap = Math.floor(availS / requestS - fixed);
  return Math.max(1, Math.min(configured, cap));
}
