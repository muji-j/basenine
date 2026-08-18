/**
 * **어느 날의 경기를 받을 것인가.**
 *
 * ⚠**`update.ts` 에서 떼어냈다**(2026-08-18). 그 파일은 import 하는 순간 수집을 시작하므로
 * 시험할 수가 없다 — 그래서 스케줄을 정하는 이 판단이 **한 번도 검증된 적이 없었다.**
 * 스케줄이 조용히 어긋나면 「어제 것도 오늘 것도 안 받는 날」이 생기고,
 * 하필 경기 페이지는 소급이 되므로 눈치채기까지 오래 걸린다.
 *
 * ⚠**시계는 주입받는다**(M6). 여기서 `Date.now()` 를 부르면 자정 경계를 시험할 수 없다.
 */

/**
 * 오늘 것까지 받을 시각인가.
 *
 * ⚠**이 판정의 이유는 M9 가 아니라 M7 이다.**
 * 「끝나지 않은 경기」는 파서가 안전하게 다룬다 — 표는 있고 `試合時間` 이 없으니 `inProgress` 다.
 * 문제는 **시작도 안 한 경기**다: 그 페이지에는 타격표가 **아예 없어서** 파서가
 * 「표가 없는데 중지 표기도 없다 → 구조 변경을 의심하라」로 예외를 던진다(M7 의 의도된 동작).
 * 아침·낮에 오늘 것을 받으면 그 예외가 **매일** 나고, 진짜 구조 변경 경보가 소음에 묻힌다.
 *
 * 22시로 잡은 근거: NPB 최종 개시는 18:00 이고 정규시즌 연장은 12회까지라 22시면 대부분 끝나 있다.
 * 안 끝난 경기는 `inProgress` 로 조용히 건너뛰고 **다음 실행(아침)이 메운다.**
 */
export const JST_TODAY_FROM_HOUR = 22;

/** UTC 기준 시각 → JST 의 `YYYY-MM-DD`. `offsetDays` 만큼 밀어서 낸다 */
export function jstDate(now: Date, offsetDays = 0): string {
  return new Date(now.getTime() + (9 * 60 + offsetDays * 24 * 60) * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

/** 그 시각의 JST 시(0~23) */
export function jstHour(now: Date): number {
  return new Date(now.getTime() + 9 * 60 * 60 * 1000).getUTCHours();
}

/**
 * 받을 경기일 목록. **오래된 것부터.**
 *
 * ⚠**어제는 언제나 받는다.** 연장·서스펜디드·늦게 끝난 경기가 있으면 밤 실행이
 * `inProgress` 로 건너뛰므로, 다음 실행이 그것을 메워야 한다 — **거르면 영영 안 들어온다.**
 * ⚠**요청이 두 배가 되지 않는다**(L7) — 어제 것은 이미 받아 둔 것이라 조건부 요청으로 304 다.
 * ⚠**명시한 날짜가 있으면 그 하루만**이다. 소급 수집·재수집의 어법을 바꾸지 않는다.
 */
export function targetDates(now: Date, opts: { date?: string; forceToday?: boolean } = {}): string[] {
  if (opts.date !== undefined) return [opts.date];
  const includeToday = opts.forceToday === true || jstHour(now) >= JST_TODAY_FROM_HOUR;
  return includeToday ? [jstDate(now, -1), jstDate(now, 0)] : [jstDate(now, -1)];
}
