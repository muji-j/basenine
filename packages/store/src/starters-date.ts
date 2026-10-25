/**
 * **予告先発 페이지의 「M月D日」에 연도를 붙인다** — 결정적 규칙(PR-4 설계 `docs/superpowers/specs/2026-10-24-offseason-readiness-design.md` D3).
 *
 * ⚠**페이지에 연도가 없다**(`8月16日の予告先発投手`). 연도는 **취득일**(아카이브 파일 이름 · JST)에서 붙인다.
 * ⚠**옛 규칙(「취득한 해 · 12→1 이면 +1 · 1월에 12월이면 실패」)은 비시즌의 낡은 페이지에서 틀렸다** — 1월에 받은 「11月1日」(지난 일본시리즈)을
 *   `2027-11-01` 로 만들면 `MAX(probable_pitcher.game_date)` 가 미래가 되어 **2027 시즌 내내 `starters-behind` 가 조용히 꺼진다**(설계 G4).
 *
 * 규칙:
 * 1. 후보 해 `{Y−1, Y, Y+1}` 중 **그 해에 그 날짜가 실재하는 것만**(Y = 취득일의 해). ⚠**자동 정규화 금지** — `2027-02-29` 를 `03-01` 로 넘기지 않는다.
 * 2. 후보가 없으면 **실패**(M7 — 「정할 수 없다」를 빈 값·추측으로 메우지 않는다).
 * 3. `lag = 그 날 − 취득일`(달력 일수). `|lag|` 가 가장 작은 해 · **동률이면 과거**(`lag < 0`).
 * 4. 고른 `|lag| ≤ 183` 이면 받고 **`≥ 184` 면 실패**. ⚠세 해가 다 실재하면 이웃 후보 간격이 365·366일이라 늘 183 이하다 —
 *    3·4 의 실패는 **2월 29일에서만** 난다.
 *
 * ⚠**`lag < 0`(지난 날짜)을 어떻게 쓸지는 호출자(`tools/load-starters.ts`)가 정한다** — 맥박만 남긴다(설계 D3-5). 이 함수는 날짜만 정한다.
 * ⚠근거: 시즌 중 실측 68회 전부 0·+1일(설계 R4 · CI DB `starters_fetch` 08-15~10-21) — 음수는 비시즌의 낡은 페이지뿐이다.
 * ⚠**import 0개 · 시계를 읽지 않는다**(M6) — 주어진 두 문자열만 본다.
 */

/** 받는 최대 거리(일) — 넘으면 실패. ⚠세 해가 다 실재하면 늘 이 안이다(위 4) */
export const STARTERS_MAX_LAG_DAYS = 183;

export type StartersDate =
  | { readonly ok: true; readonly date: string; readonly lag: number }
  | { readonly ok: false; readonly reason: string };

const DAY_MS = 86_400_000;

/** `Date.UTC` 왕복이 같은 년·월·일인가 — 자동 정규화(2/29 → 3/1)를 막는다 */
function dayNumber(y: number, m: number, d: number): number | null {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d) || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const t = Date.UTC(y, m - 1, d);
  const back = new Date(t);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== m - 1 || back.getUTCDate() !== d) return null;
  return t / DAY_MS;
}

/**
 * @param fetchedDate 취득일(JST `YYYY-MM-DD` · 파일 이름)
 * @param monthDay 페이지의 게시 날짜(`MM-DD` · 파서 `parseAnnouncedStarters` 의 `monthDay`)
 */
export function resolveStartersDate(fetchedDate: string, monthDay: string): StartersDate {
  const f = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fetchedDate);
  const fetchedDay = f === null ? null : dayNumber(Number(f[1]), Number(f[2]), Number(f[3]));
  if (f === null || fetchedDay === null) return { ok: false, reason: `취득일이 날짜가 아니다: ${fetchedDate}` };
  const md = /^(\d{2})-(\d{2})$/.exec(monthDay);
  if (md === null) return { ok: false, reason: `게시 날짜가 MM-DD 가 아니다: ${monthDay}` };
  const year = Number(f[1]);
  const month = Number(md[1]);
  const day = Number(md[2]);

  let best: { year: number; lag: number } | null = null;
  for (const y of [year - 1, year, year + 1]) {
    const n = dayNumber(y, month, day);
    if (n === null) continue;
    const lag = n - fetchedDay;
    // ⚠동률이면 과거 — 이웃 후보는 부호가 반대라 「더 작은 lag」가 과거다
    if (best === null || Math.abs(lag) < Math.abs(best.lag) || (Math.abs(lag) === Math.abs(best.lag) && lag < best.lag)) best = { year: y, lag };
  }
  if (best === null) {
    return { ok: false, reason: `후보 해가 없다 — ${String(year - 1)}·${String(year)}·${String(year + 1)} 어느 해에도 ${String(month)}月${String(day)}日 이 없다(자동 정규화 금지)` };
  }
  if (Math.abs(best.lag) > STARTERS_MAX_LAG_DAYS) {
    return {
      ok: false,
      reason: `가장 가까운 해(${String(best.year)})가 취득일에서 ${String(Math.abs(best.lag))}일 떨어져 있다 — ±${String(STARTERS_MAX_LAG_DAYS)}일 밖은 연도를 정할 수 없다`,
    };
  }
  return { ok: true, date: `${String(best.year)}-${md[1]!}-${md[2]!}`, lag: best.lag };
}
