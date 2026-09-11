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
 * **따라잡기의 상한(일).**
 *
 * ⚠**이 값이 있는 이유는 「없으면 비시즌에 매일 헛돈다」다.** 10월에 시즌이 끝나면
 * 「마지막으로 받은 경기일」이 그대로 멈추므로, 상한이 없으면 **다음 개막까지 매일
 * 수백 일을 훑는다.** 그건 따라잡기가 아니라 백필이고, 백필은 사람이 `--date` 로 돌리는 일이다.
 * ⚠**그래서 상한을 넘으면 따라잡지 않는다.** 침묵하는 쪽으로 넘어가지 않는 것이 핵심이다.
 * ⚠⚠**~~`scripts/freshness.ts` 가 2일에 이미 빨개지므로 모르고 지나가지 않는다~~ 는 2026-09-11 부로 조건부다**(3중 검토 2차 N5).
 *   감시가 이제 「최신 경기가 며칠 전인가」가 아니라 **「받았어야 할 경기의 증거」**(월간 일정의 치러짐 표시 · 予告先発)로 운다 —
 *   **증거가 있는 날만** 2일 뒤 운다. 7일 넘게 멈춘 기간이 **월 경계를 걸치면** 앞 달 끝 날짜들은 그 달 사본을 다시 안 받고
 *   예고도 못 받아 **증거가 안 남아 조용하다.** 멈춘 동안은 하트비트(24시간 무성공)가 울고, 재개 뒤의 구멍은
 *   런북의 소급 절차(`docs/operations.md` · `node scripts/update.ts --date <D>`)가 메운다.
 *   ⚠**회귀는 아니다** — 옛 규칙도 재개 뒤에는 최신 경기일이 새로워져 조용했다. 근거 문장이 틀렸던 것이다.
 */
export const MAX_CATCHUP_DAYS = 7;

/** `YYYY-MM-DD` 하루 뒤. ⚠**시계를 안 읽는다**(M6) — 주어진 글자를 해석할 뿐이다 */
function nextDay(d: string): string {
  return new Date(new Date(`${d}T00:00:00Z`).getTime() + 86_400_000).toISOString().slice(0, 10);
}

/** 두 `YYYY-MM-DD` 사이의 일수. ⚠시계를 안 읽는다(M6) */
function daysBetween(from: string, to: string): number {
  return Math.round(
    (new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86_400_000,
  );
}

/**
 * 받을 경기일 목록. **오래된 것부터.**
 *
 * ⚠**어제는 언제나 받는다.** 연장·서스펜디드·늦게 끝난 경기가 있으면 밤 실행이
 * `inProgress` 로 건너뛰므로, 다음 실행이 그것을 메워야 한다 — **거르면 영영 안 들어온다.**
 * ⚠**요청이 두 배가 되지 않는다**(L7) — 어제 것은 이미 받아 둔 것이라 조건부 요청으로 304 다.
 * ⚠**명시한 날짜가 있으면 그 하루만**이다. 소급 수집·재수집의 어법을 바꾸지 않는다.
 *
 * ## ⚠따라잡기 — 「이틀 이상 멈추면 가운데 날이 영구히 빈다」 (2026-08-31)
 *
 * 창이 **딱 하루**였다. 그래서 실행이 하루 걸러지면 그날 경기는 **다음 실행의 창 밖으로
 * 밀려나고 영영 안 들어온다.** 그날 실제로 그 상황이 왔다 — GitHub Actions 무료 분이
 * 소진돼 스케줄이 통째로 멈췄다. **그날 NPB 가 쉬는 날이라 손해가 0이었을 뿐이고,
 * 그건 설계가 막은 게 아니다.**
 *
 * ⚠**정상일 때 요청이 1건도 안 는다.** `collectedThrough` 가 어제(또는 그저께)면
 * 결과는 예전과 **글자까지 같다** — 늘어나는 것은 **실제로 빈 날이 있을 때뿐**이다.
 * ⚠**월요일(NPB 휴식일) 뒤에도 안 는다**: 일요일까지 받았고 어제가 월요일이면
 * 빠진 날은 `[월]` 하나이고 그건 예전의 `[어제]` 와 같다.
 * ⚠**상한을 넘으면 따라잡지 않는다**(위 `MAX_CATCHUP_DAYS`) — 비시즌에 매일 헛돌지 않기 위해서다.
 *
 * @param opts.collectedThrough 이미 받아 둔 **마지막 경기일**(`YYYY-MM-DD`).
 *   보통 DB 의 `MAX(game_date) WHERE status='played'` 다. 모르면 넘기지 않는다 —
 *   ⚠**모르는 것을 「오늘」로 메우지 마라**(M11): 그러면 빈 날이 있어도 안 메운다.
 */
export function targetDates(
  now: Date,
  opts: { date?: string; forceToday?: boolean; collectedThrough?: string } = {},
): string[] {
  if (opts.date !== undefined) return [opts.date];
  const includeToday = opts.forceToday === true || jstHour(now) >= JST_TODAY_FROM_HOUR;
  const yesterday = jstDate(now, -1);

  const past: string[] = [];
  const since = opts.collectedThrough;
  // ⚠**`gap >= 2` 일 때만 넓힌다.** 0·1 은 정상이고, 상한 초과는 백필이라 사람의 일이다
  if (since !== undefined && daysBetween(since, yesterday) >= 2 && daysBetween(since, yesterday) <= MAX_CATCHUP_DAYS) {
    for (let d = nextDay(since); d < yesterday; d = nextDay(d)) past.push(d);
  }

  const days = [...past, yesterday];
  return includeToday ? [...days, jstDate(now, 0)] : days;
}
