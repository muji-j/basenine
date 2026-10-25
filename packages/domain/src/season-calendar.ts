/**
 * **시즌 달력** — NPB 공식 경기가 열리는 달에 대한 사실(우리가 고른 값이 아니라 실측).
 *
 * ⚠**이 파일은 import 가 0개인 잎이다**(I1) — `scripts/collected-through.ts`(→ `scripts/update.ts` · 수집 오케스트레이터)가
 *   서브패스 `@bb-app/domain/season-calendar` 로 가져온다. 배럴(`@bb-app/domain`)을 거치면 domain 전체가 평가되고, 그 사슬의
 *   어디서든 로드 오류가 나면 **수집이 시작하기도 전에** 죽는다(`@bb-app/store/refetch-limit` · `game-slug` · `schedule-owed` 선례).
 * ⚠PR-4(비시즌 준비 · 설계 `docs/superpowers/specs/2026-10-24-offseason-readiness-design.md` D1)가 같은 파일에 `scheduleAbsencePolicy` 를 더했다 —
 *   아카이버(`packages/archiver/src/archive.ts` · `cli.ts`)도 이 서브패스로 가져온다(받기 자식이 배럴의 로드 오류에 끌려 죽지 않게).
 */

/**
 * **NPB 공식 경기가 열리지 않는 달** — 12·1·2월.
 *
 * 실측(2026-10-24 · CI DB 사본 `game` 8,043행 · 2018~2026 · 전 대회): 경기가 있는 달은 **3~11월뿐**이고 12·1·2월은 **0경기**다.
 * 로컬 아카이브의 월간 일정 사본 **75장**도 3~11월뿐이고 12·1·2월은 **0장**이다(그 달 페이지가 404 인지 빈 날짜 행인지는 미측정 · 11월은 9시즌 중 6장).
 *
 * 쓰는 곳: 따라잡기의 **확인된 휴식일**(`@bb-app/store/schedule-owed` 의 `confirmedRestThrough` · PR-2b 검토 P2-1 · PR-4 설계 D1-c) —
 * 이 달의 날은 그 달 일정 사본이 없어도 **그 해·달 전체의** 예정 · 치러짐 표시 · 경기 행이 0 이면 휴식으로 확인한다
 *   (그 달에 한 행이라도 있으면 일반 달처럼 사본이 그 날 뒤를 봤어야 한다 · 재검토 GPT P2). 사본 조건만 보면 확인이 11/30 에서 멈춰
 * 12월 첫 주마다 사이 메우기가 늘었다(최대 +6 날짜 자식 · 일정 2요청씩).
 * ⚠**11월은 넣지 않는다 — 경기가 열리는 해가 있다**(5시즌 71경기: 2018 · 2020 · 2021 · 2023 · 2024 — 일본시리즈 · CS · 2020/2021 정규).
 *   넣으면 사본 없이 그 날을 휴식으로 쳐서 따라잡기가 남은 경기를 건너뛴다.
 * ⚠**얼려 둔다** — 모듈 전역 가변 상태를 두지 않는다(누가 `push` 하면 모든 호출자의 판정이 조용히 바뀐다).
 */
export const NO_GAME_MONTHS: readonly number[] = Object.freeze([12, 1, 2]);

/** 현재 달 월간 일정 404·410 의 해석 — 아래 `scheduleAbsencePolicy` */
export type ScheduleAbsencePolicy = "quiet" | "warn" | "fail";

/**
 * **현재 달 월간 일정이 404·410 일 때 그것을 어떻게 읽는가** — PR-4 설계 D1(`docs/superpowers/specs/2026-10-24-offseason-readiness-design.md`).
 *
 * | 달 | 값 | 아카이버가 하는 일 |
 * |---|---|---|
 * | 12·1·2(`NO_GAME_MONTHS`) | `quiet` | 「그날 경기 0」인 사실로 받는다 · 로그 한 줄 · 종료 무영향 |
 * | 11 | `warn` | 같고 표준출력에 `::warning::` 한 줄 — 경기가 열리는 해가 있다(5시즌 71경기 · 위 상수 주석) |
 * | 3~10 | `fail` | 지금처럼(PR-2a D1) 우리가 모르는 상태 → local → 막는다 — 시즌 달의 일정이 없다 = 주소·구조 변경 의심 |
 *
 * ⚠**조용한 달은 `NO_GAME_MONTHS` 에서 나온다**(M1) — 따라잡기의 「확인된 휴식일」과 404 의 해석이 다른 달 목록을 쓰지 않게 한다.
 * ⚠**11월을 조용하게 만들지 마라** — 11월에 경기가 남았는데 주소가 바뀌었다면 사본이 낡는다. 그 경우 예고 대조(B · `game-missed`)가
 *   유예 2일 뒤 막는데 **그 안전망은 予告先発에 기댄다**(설계 §6 P3) — 사람이 그 경고 줄을 볼 수 있게 시끄럽게 받는다.
 * ⚠「달력 날짜로 감시를 켜고 끄기」(9/11 설계 §9 기각)와 다르다 — **404 하나의 해석에만** 쓴다.
 * @param month 1~12 — 그 밖이면 `RangeError`(모르는 달을 조용히 받지 않는다 · M11)
 */
export function scheduleAbsencePolicy(month: number): ScheduleAbsencePolicy {
  if (!Number.isInteger(month) || month < 1 || month > 12) throw new RangeError(`달은 1~12 의 정수여야 한다: ${String(month)}`);
  if (NO_GAME_MONTHS.includes(month)) return "quiet";
  return month === 11 ? "warn" : "fail";
}
