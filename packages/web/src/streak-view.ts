/**
 * 연속 기록의 **값 서식 한 벌**(M1).
 *
 * ⚠**이 파일이 존재하는 이유**: 「以上」과 「最大」의 서식이 `player-page.ts` 의 **지역 함수**로만
 * 있었다. 순위표(`pages.ts`)가 같은 값을 그리는 순간 **두 벌**이 되고, 그때
 * 정의서 §3-3-A 가 정한 규칙(두 사유가 겹치면 `保有範囲内では最大…`)이 **한쪽에만** 남는다.
 * 그 상태가 실제로 한 번 났고(`docs/superpowers/plans/2026-09-07-streak-metrics.md` §11-2),
 * 그때는 한 화면 안에서 스스로 모순됐다.
 *
 * ⚠**여기서 「以上」을 붙일지 말지를 정하지 않는다.** `atFloor` 는 **호출자가 판단해 넘긴다** —
 * `atRangeStart` 의 뜻이 **모드마다 다르기** 때문이다(`PitchingStreak.atRangeStart` 주석):
 * 시즌 모드에서는 「시즌 시작」이라 **「以上」이 아니고**, 통산 모드에서만 「(하한−1)年以前は未参照」다.
 * 이 파일이 그것을 스스로 정하면 **시즌 화면에 없어야 할 부등호가 붙는다.**
 *
 * ⚠**이닝 표기를 새로 만들지 마라**(정의서 §1-2). `innings()`(= `inningsFromOuts`)가
 * `49` · `33.1` · `28.2` 를 낸다. **`33.1回` 는 33과 1/3回**이지 33.1回가 아니다.
 */
import { html, raw } from "./html.ts";
import type { RawHtml } from "./html.ts";
import { NO_VALUE, gameDate, innings } from "./format.ts";

/**
 * 마루의 기간 — **M2 의 둘째 분모**(정의서 §1-6 ⑵).
 *
 * ⚠**끝은 「마지막 출장」이 아니라 「기록에 센 마지막 경기」다** — 타자는 9.23(b) 본문으로
 * 건너뛴 경기가 마지막이면 둘이 갈린다(`HomeStreak.to` 주석의 실측).
 * ⚠**한쪽만 없는 일이 없다고 가정하지 않는다**(M11) — 둘 중 하나라도 없으면 「모름」이다.
 */
export function streakSpan(from: string | null, to: string | null): string {
  return from === null || to === null ? NO_VALUE : `${gameDate(from)}〜${gameDate(to)}`;
}

/**
 * 분모 조각을 **한 칸에 모은다**.
 *
 * ⚠`<span class="den">` 이 둘 붙으면 화면에서 두 덩어리로 읽힌다 — 그래서 한 칸에 잇는다.
 * ⚠**빈 조각은 뺀다** — 「 · 57登板」처럼 앞에 구분자만 남는 것을 막는다.
 */
export function streakDen(...parts: string[]): RawHtml {
  const t = parts.filter((p) => p !== "").join(" · ");
  return t === "" ? raw("") : html`<span class="den">${t}</span>`;
}

/**
 * **連続無失点登板 / 連続試合◯◯** 의 값 — 단위가 붙은 개수.
 *
 * @param atFloor 마루가 **훑은 범위의 첫 사건**에서 시작하는가. ⚠**호출자가 판단한다**(머리주석).
 */
export function streakCountText(n: number, unit: string, atFloor: boolean): string {
  return `${n}${unit}${atFloor ? "以上" : ""}`;
}

/**
 * **連続無失点イニング** 의 값.
 *
 * ⚠**「以上」의 사유가 둘이고 여기서는 합쳐진다** — `exact=false`(그 등판의 실점 시점을 못 짚는다)와
 * `atFloor`(그 앞을 안 봤다). **글자는 같지만 사실이 다르므로 각주가 구별해야 한다**(정의서 §1-6).
 * 그 구별을 이 함수가 못 하는 것이 아니라 **각주의 일**이다.
 */
export function streakInningsText(lowerOuts: number, exact: boolean, atFloor: boolean): string {
  return `${innings(lowerOuts)}回${!exact || atFloor ? "以上" : ""}`;
}

/**
 * **連続無失点イニング** 의 상한. 확정이면 빈 문자열.
 *
 * ⚠**상한도 「반드시 참」이다**(정의서 §3-3) — 「어차피 비슷하니 점추정」으로 가지 않는다.
 * ⚠**단 `atFloor` 와 겹치면 단정할 수 없다**(정의서 §3-3-A). 그 마루는 보유 범위의 첫 사건에서
 * 시작하므로 **범위 밖으로 더 이어질 수 있고**, 그러면 「最大」와 「もっと長い可能性」이
 * **동시에 참일 수 없다.** → **지우지 않고 말로 한정한다.**
 */
export function streakInningsMax(upperOuts: number, exact: boolean, atFloor: boolean): string {
  if (exact) return "";
  return `${atFloor ? "保有範囲内では" : ""}最大${innings(upperOuts)}回`;
}
