/**
 * 경기별 ベンチ入り選手 명단(`roster.html`) 파서.
 *
 * ⚠**이 페이지는 처음부터 받고 있었는데 한 번도 읽지 않았다**(2026-08-17 확인).
 * 경기마다 1장씩, 아카이브에 3,126장이 쌓여 있고 그 안에 **선수 52명의 배번과 투타**가 있다.
 *
 * ## 왜 필요한가 — 선수 페이지로는 닿지 않는 선수가 있다
 *
 * 투타는 좌우 스플릿의 근거인데(`player.ts` 머리말), 출처가 선수 페이지뿐이었다.
 * 그런데 선수 페이지는 **현재 등록된 선수만** 받는다 — NPB를 떠난 선수는 받을 수 없고,
 * 소급 시즌을 백필하면 그런 선수가 대거 들어온다.
 * 실측(2026-08-17): DB 980명 중 **122명이 투타 미상**이었고, 그 **122명 전원**이
 * 이 명단에 있다. 외부 요청 **0회**로 채워진다.
 *
 * ## 신뢰할 수 있는가 — 실측으로 확인했다
 *
 * 양쪽에 값이 있는 858명에서 **투타 일치 858/858 · 불일치 0**.
 * 명단 행 **156,782건 중 투타 형식을 벗어난 행 0건**.
 *
 * ⚠**등번호는 다르다.** 선수 페이지는 **현재** 번호, 이 명단은 **그 경기 시점**의 번호다.
 * 실측 782명 중 10명이 어긋났고 전부 실제 변경이다(育成 `122` → 支配下 `64` 등).
 * 그러니 **페이지 값을 명단으로 덮어쓰면 안 된다** — 없을 때 채우는 데만 쓴다.
 */
import type { Hand } from "./player.ts";

export interface RosterEntry {
  /** NPB 공식 선수 ID. **이것이 조인 키다**(M10) */
  playerId: string;
  name: string;
  /**
   * 그 경기 시점의 배번. 없으면 null.
   * ⚠**「현재 배번」이 아니다.** 시즌 중에 바뀌고, 育成 승격이면 세 자리에서 두 자리가 된다.
   */
  uniformNumber: string | null;
  throws: Hand;
  bats: Hand;
}

export class RosterParseError extends Error {
  readonly detail: string;
  constructor(message: string, detail: string) {
    super(`${message} — ${detail}`);
    this.name = "RosterParseError";
    this.detail = detail;
  }
}

const HAND: Readonly<Record<string, Hand>> = { 右: "right", 左: "left", 両: "both" };

/**
 * 명단 행 하나. `<td>배번</td><td><a …>이름</a></td><td>투타</td>`
 *
 * ⚠**투타 칸까지 한 덩어리로 잡는다.** 선수 링크만 찾으면 이 페이지의 다른 링크
 * (라인스코어 밑의 배터리 표기 등)까지 걸린다 — 그러면 투타가 없는 행이 섞인다.
 */
const ROW =
  /<td[^>]*>\s*(\d*)\s*<\/td>\s*<td[^>]*>\s*<a href="\/bis\/players\/(\d+)\.html"[^>]*>([^<]*)<\/a>\s*<\/td>\s*<td[^>]*>\s*([^<]*?)\s*<\/td>/g;

/**
 * 명단을 읽는다.
 *
 * @throws {RosterParseError} 한 행도 못 찾았을 때. ⚠**빈 배열로 넘기지 마라** —
 *   마크업이 바뀌면 「그날은 벤치가 비어 있었다」가 되고, 투타 보충이 조용히 멈춘다.
 *   실측 3,126장 전부에서 52명 안팎이 잡힌다.
 */
export function parseGameRoster(html: string): RosterEntry[] {
  const out: RosterEntry[] = [];
  for (const m of html.matchAll(ROW)) {
    const [, no, playerId, name, hand] = m;
    const t = /^([右左両])投([右左両])打$/.exec(hand!.replace(/\s/g, ""));
    /**
     * ⚠**모르는 표기를 조용히 넘기지 않는다**(M7). 실측 156,782행 중 0건이므로
     * 임계값 0으로 걸 수 있다. 흘리면 투타 보충이 서서히 줄고 아무도 눈치채지 못한다.
     */
    if (!t) {
      throw new RosterParseError("명단의 투타 표기를 해석하지 못했다", `value=${JSON.stringify(hand)}`);
    }
    out.push({
      playerId: playerId!,
      name: name!.trim(),
      // ⚠빈 문자열은 「배번 없음」이지 「0번」이 아니다(M11)
      uniformNumber: no === "" ? null : no!,
      throws: HAND[t[1]!]!,
      bats: HAND[t[2]!]!,
    });
  }
  if (out.length === 0) {
    throw new RosterParseError("명단을 한 행도 찾지 못했다", `length=${html.length}`);
  }
  return out;
}
