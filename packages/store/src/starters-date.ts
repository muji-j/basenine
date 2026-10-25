/**
 * **予告先発 페이지의 「M月D日」에 연도를 붙인다** — 결정적 규칙(PR-4 설계 `docs/superpowers/specs/2026-10-24-offseason-readiness-design.md` D3).
 *
 * ⚠**페이지에 연도가 없다**(`8月16日の予告先発投手`). 연도는 **취득일**(아카이브 파일 이름 · JST)에서 붙인다.
 * ⚠**옛 규칙(「취득한 해 · 12→1 이면 +1 · 1월에 12월이면 실패」)은 비시즌의 낡은 페이지에서 틀렸다** — 1월에 받은 「11月1日」(지난 일본시리즈)을
 *   `2027-11-01` 로 만들면 `MAX(probable_pitcher.game_date)` 가 미래가 되어 **2027 시즌 내내 `starters-behind` 가 조용히 꺼진다**(설계 G4).
 *
 * 규칙(`lag = 그 날 − 취득일` · 달력 일수):
 * 1. 후보 해 `{Y−1, Y, Y+1}` 중 **그 해에 그 날짜가 실재하는 것만**(Y = 취득일의 해). ⚠**자동 정규화 금지** — `2027-02-29` 를 `03-01` 로 넘기지 않는다.
 * 2. 후보가 없으면 **실패**(M7 — 「정할 수 없다」를 빈 값·추측으로 메우지 않는다).
 * 3. **앞쪽(오늘~미래)은 `0 ≤ lag ≤ 14` 인 후보만** 받는다 — 있으면 그것(정상 예고 · 휴식 공표).
 * 4. 없으면 **가장 가까운 지난 후보**(`lag < 0`)를 `|lag| ≤ 183` 일 때만 받는다(호출자가 맥박만 남긴다). 그 밖은 **실패**.
 *
 * ⚠⚠**앞쪽을 14일로 좁혔다**(2026-10-25 · PR-4 3중 검토 1차 P3 · 옛 판은 ±183 대칭이었다).
 *   대칭이면 **183일 넘게 낡은 페이지가 「미래 예고」로 들어간다** — 2027-06-15 에 받은 「10月30日」(지난 일본시리즈)이 2027-10-30(+137)의 예고가 되어
 *   `starters-behind` 가 그 시즌 내내 꺼진다(G4 가 막으려던 바로 그 피해 · 개막이 늦은 해(2020형 6월)나 연기된 해에 발현).
 *   **실측(2026-10-25)**: CI DB `starters_fetch` 68행(08-15~10-21)이 **0일 7 · +1일 61 · +2 이상 0**(휴식 공표 포함) ·
 *   실물 페이지 23장(데이터 보관소 사본 · 취득 08-15~09-06)이 0일 4 · +1일 19 — 둘 다 최대 +1.
 *   14일은 그 위의 여유다(연휴 뒤 며칠 앞 경기를 싣는 모양이 와도 거짓 실패를 내지 않게) — 1년 낡은 페이지가 앞쪽으로 잡히려면 351일 넘게 낡아야 한다.
 * ⚠**대가**: 지난 후보가 183일 밖이고 앞쪽 후보가 14일 밖이면 실패다 — 오프시즌이 183일보다 긴 해(2020형)에 페이지가 지난 날짜로 멈춰 있으면
 *   그 날부터 매일 받는 파일마다 적재가 1 이다(시끄러운 쪽 · 런북 `docs/operations/deploy.md` §7-L 의 처치).
 *   평년(일본시리즈 종료 → 개막 약 146일)은 183 안이라 맥박만이다.
 *
 * ⚠**`lag < 0`(지난 날짜)을 어떻게 쓸지는 호출자(`tools/load-starters.ts`)가 정한다** — 맥박만 남긴다(설계 D3-5). 이 함수는 날짜만 정한다.
 * ⚠**import 0개 · 시계를 읽지 않는다**(M6) — 주어진 두 문자열만 본다.
 */

/** 앞쪽(오늘~미래)으로 받는 최대 거리(일) — 실측 최대 +1 에 여유(위 머리말) */
export const STARTERS_MAX_AHEAD_DAYS = 14;
/** 뒤쪽(지난 날짜)으로 받는 최대 거리(일) — 넘으면 실패. 평년 오프시즌(약 146일)은 이 안이다 */
export const STARTERS_MAX_BEHIND_DAYS = 183;

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

/** 부호를 붙인 일수 — `+183일` · `-228일` */
const signed = (lag: number): string => `${lag > 0 ? "+" : ""}${String(lag)}일`;

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

  const candidates: { year: number; lag: number }[] = [];
  for (const y of [year - 1, year, year + 1]) {
    const n = dayNumber(y, month, day);
    if (n !== null) candidates.push({ year: y, lag: n - fetchedDay });
  }
  if (candidates.length === 0) {
    return { ok: false, reason: `후보 해가 없다 — ${String(year - 1)}·${String(year)}·${String(year + 1)} 어느 해에도 ${String(month)}月${String(day)}日 이 없다(자동 정규화 금지)` };
  }
  const label = (c: { year: number; lag: number }): string => `${String(c.year)}-${md[1]!}-${md[2]!}`;

  // 3. 앞쪽 0~14일 — 이웃 후보는 365·366일 떨어져 있어 많아야 하나다
  const ahead = candidates.find((c) => c.lag >= 0 && c.lag <= STARTERS_MAX_AHEAD_DAYS);
  if (ahead !== undefined) return { ok: true, date: label(ahead), lag: ahead.lag };

  // 4. 가장 가까운 지난 후보 — 183일 안일 때만
  const behind = candidates.filter((c) => c.lag < 0).sort((a, b) => b.lag - a.lag)[0];
  if (behind !== undefined && -behind.lag <= STARTERS_MAX_BEHIND_DAYS) return { ok: true, date: label(behind), lag: behind.lag };

  const future = candidates.filter((c) => c.lag > STARTERS_MAX_AHEAD_DAYS).sort((a, b) => a.lag - b.lag)[0];
  return {
    ok: false,
    reason:
      `연도를 정할 수 없다 — 앞쪽 ${String(STARTERS_MAX_AHEAD_DAYS)}일 안의 후보가 없고` +
      (behind === undefined ? " 지난 후보도 없다" : ` 가장 가까운 지난 해 ${label(behind)} 는 ${signed(behind.lag)}(뒤쪽 ${String(STARTERS_MAX_BEHIND_DAYS)}일 밖)`) +
      (future === undefined ? "" : ` · 앞쪽 후보 ${label(future)} 는 ${signed(future.lag)}(미래 예고로 받지 않는다)`),
  };
}
