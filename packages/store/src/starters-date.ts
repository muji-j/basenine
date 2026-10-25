/**
 * **予告先発 페이지의 「M月D日」에 연도를 붙인다** — 결정적 규칙(PR-4 설계 `docs/superpowers/specs/2026-10-24-offseason-readiness-design.md` D3).
 *
 * ⚠**페이지에 연도가 없다**(`8月16日の予告先発投手`). 연도는 **취득일**(아카이브 파일 이름 · JST)에서 붙인다.
 * ⚠**옛 규칙(「취득한 해 · 12→1 이면 +1 · 1월에 12월이면 실패」)은 비시즌의 낡은 페이지에서 틀렸다** — 1월에 받은 「11月1日」(지난 일본시리즈)을
 *   `2027-11-01` 로 만들면 `MAX(probable_pitcher.game_date)` 가 미래가 되어 **2027 시즌 내내 `starters-behind` 가 조용히 꺼진다**(설계 G4).
 *
 * 규칙(`lag = 그 날 − 취득일` · 달력 일수) — **후보 창은 `[취득일 − 351, 취득일 + 14]`(366일)**:
 * 1. 후보 해 `{Y−1, Y, Y+1}` 중 **그 해에 그 날짜가 실재하는 것만**(Y = 취득일의 해). ⚠**자동 정규화 금지** — `2027-02-29` 를 `03-01` 로 넘기지 않는다.
 * 2. 후보가 없으면 **실패**(M7 — 「정할 수 없다」를 빈 값·추측으로 메우지 않는다).
 * 3. **앞쪽(오늘~미래)은 `0 ≤ lag ≤ 14` 인 후보만** 받는다(정상 예고 · 휴식 공표).
 * 4. **지난 후보**는 `−351 ≤ lag < 0`(창 안에 많아야 하나)일 때 받는다(호출자가 맥박만 남긴다).
 *    창 안의 후보는 평소 하나뿐이고 **둘이면(이중 걸림) 지난 후보**다. 창 안에 없으면 **실패**.
 *
 * ⚠⚠**앞쪽을 14일로 좁혔다**(2026-10-25 · PR-4 3중 검토 1차 P3 · 옛 판은 ±183 대칭이었다).
 *   대칭이면 **183일 넘게 낡은 페이지가 「미래 예고」로 들어간다** — 2027-06-15 에 받은 「10月30日」(지난 일본시리즈)이 2027-10-30(+137)의 예고가 되어
 *   `starters-behind` 가 그 시즌 내내 꺼진다(G4 가 막으려던 바로 그 피해 · 개막이 늦은 해(2020형 6월)나 연기된 해에 발현).
 *   **실측(2026-10-25)**: CI DB `starters_fetch` 68행(08-15~10-21)이 **0일 7 · +1일 61 · +2 이상 0**(휴식 공표 포함) ·
 *   실물 페이지 23장(데이터 보관소 사본 · 취득 08-15~09-06)이 0일 4 · +1일 19 — 둘 다 최대 +1.
 *   14일은 그 위의 여유다(연휴 뒤 며칠 앞 경기를 싣는 모양이 와도 거짓 실패를 내지 않게).
 * ⚠⚠**뒤쪽을 351(= 365 − 14)로 넓혔다**(3판 · 2026-10-25 · 조정자 결정). 앞쪽이 14일이면 「지난 날짜」는 더 이상 모호하지 않다 —
 *   3중 검토 반영 첫 판(앞쪽 14 · 뒤쪽 183)은 개막이 늦은 해(2020형 · 2019 일본시리즈 10/23 → 개막 6/19 · 240일)에 낡은 비시즌 페이지를 184일째부터 **받은 파일마다 실패**로 만들었고,
 *   적재는 아카이브 전체를 매번 다시 읽으므로 그건 **매 실행 blocking(배포 정지)** 이었다. 지금은 351일까지 맥박만이다.
 *   ⚠352일 넘게 낡은 날짜는 그 다음 해(앞쪽 0~13일)로 읽힌다 — 연도 없는 `MM-DD` 는 366일 창에서 하나로만 정해진다(오프시즌이 351일을 넘는 해는 없다).
 * ⚠**창이 366일이라 같은 날짜가 두 번 걸리는 날이 하나 있다** — 양 끝(−351 · +14)이 같은 `MM-DD` 이고 그 사이에 2/29 가 없을 때다.
 *   그때는 **지난 해(−351 · 맥박만)** 를 고른다(PR-4 재검토 m1 — 틀렸을 때 시끄러운 쪽 · 아래 본문).
 * ⚠**남는 실패는 2/29 뿐이다** — 평년 날짜는 366일 창에 언제나 한 번 걸린다(`starters-date.test.ts` 가 날짜 전수로 잰다). NPB 는 2월에 공식 경기를 안 하므로 사실상 안 난다.
 *
 * ⚠**`lag < 0`(지난 날짜)을 어떻게 쓸지는 호출자(`tools/load-starters.ts`)가 정한다** — 맥박만 남긴다(설계 D3-5). 이 함수는 날짜만 정한다.
 * ⚠**import 0개 · 시계를 읽지 않는다**(M6) — 주어진 두 문자열만 본다.
 */

/** 앞쪽(오늘~미래)으로 받는 최대 거리(일) — 실측 최대 +1 에 여유(위 머리말) */
export const STARTERS_MAX_AHEAD_DAYS = 14;
/** 뒤쪽(지난 날짜)으로 받는 최대 거리(일) — `365 − 앞쪽` 이라 창 `[−351, +14]` 가 366일이다(위 머리말 · 3판) */
export const STARTERS_MAX_BEHIND_DAYS = 365 - STARTERS_MAX_AHEAD_DAYS;

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

/** 부호를 붙인 일수 — `+15일` · `-352일` */
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
  // 4. 지난 후보 — 351일 안일 때만(창 안에 많아야 하나 · 가장 가까운 것)
  const behind = candidates.filter((c) => c.lag < 0).sort((a, b) => b.lag - a.lag)[0];
  const behindInWindow = behind !== undefined && -behind.lag <= STARTERS_MAX_BEHIND_DAYS ? behind : undefined;
  /**
   * ⚠⚠**둘 다 창 안이면(이중 걸림 · 양 끝 −351·+14 가 같은 날짜) 지난 해를 고른다**(PR-4 재검토 m1) — 틀렸을 때 시끄러운 쪽이다.
   *   앞쪽(예고)을 고르고 틀리면 예고 행이 14일 앞으로 가 `starters-behind` 가 그만큼 꺼진다(설계 G4 가 막으려던 방향) ·
   *   지난 해(맥박만)를 고르고 틀리면 그날 예고가 비어 감시가 운다. 평소에는 둘 중 하나만 창 안이라 순서가 뜻을 갖지 않는다.
   */
  if (behindInWindow !== undefined) return { ok: true, date: label(behindInWindow), lag: behindInWindow.lag };
  if (ahead !== undefined) return { ok: true, date: label(ahead), lag: ahead.lag };

  // 5. 창 밖 — 평년 날짜는 366일 창에 언제나 걸리므로 사실상 2/29 뿐이다
  const future = candidates.filter((c) => c.lag > STARTERS_MAX_AHEAD_DAYS).sort((a, b) => a.lag - b.lag)[0];
  return {
    ok: false,
    reason:
      `연도를 정할 수 없다 — 창 [취득일 −${String(STARTERS_MAX_BEHIND_DAYS)}, +${String(STARTERS_MAX_AHEAD_DAYS)}] 안에 ${String(month)}月${String(day)}日 이 없다:` +
      (behind === undefined ? " 지난 후보 없음" : ` 가장 가까운 지난 해 ${label(behind)} 는 ${signed(behind.lag)}`) +
      (future === undefined ? "" : ` · 앞쪽 후보 ${label(future)} 는 ${signed(future.lag)}(미래 예고로 받지 않는다)`),
  };
}
