/**
 * 경기별 ベンチ入り選手 명단(`roster.html`) 파서.
 *
 * ⚠**이 페이지는 처음부터 받고 있었는데 한 번도 읽지 않았다**(2026-08-17 확인).
 * 경기마다 1장씩 쌓이고, 그 안에 **배번·투타·포지션 구획**이 있다.
 * ⚠**~~3,126장에 52명~~ 은 낡았다**(2026-08-27 정정). 지금은 **7,805장**이고
 * 그중 **행이 있는 것이 7,533장**, 인원은 **43~64명**(최빈 52 · 5,238장)이다 —
 * 「52명」은 최빈값이지 상수가 아니었다. **나머지 272장은 행도 머리도 0개**라 실패로 센다.
 * ⚠**이 수는 매일 는다**(경기가 들어오면 명단도 는다) — 날짜와 함께 읽어라.
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
// ⚠어휘는 `positions.ts` 한 벌이다(M1) — 드래프트 명단이 같은 4종을 쓴다.
// **정규화는 가져오지 않는다**: 여기는 구획 머리를 그대로 쓰고 드래프트는 NFKC 를 건다.
import { POSITIONS } from "./positions.ts";
import type { Position } from "./positions.ts";

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
  /**
   * 그 경기에서 어느 구획에 있었는가.
   * ⚠**배번과 같은 성질이다** — 「현재 포지션」이 아니라 **그 경기 시점**이고,
   * 전향(투수→야수)이 실재하므로 **선수 페이지 값을 덮어쓰면 안 된다.**
   *
   * ⚠**선수 페이지의 「ポジション」과 어휘가 같다**(실측: DB 값이
   * 投手 420 · 内野手 177 · 外野手 136 · 捕手 78 로 이 넷뿐) — 그래서 같은 칸에 채울 수 있다.
   */
  position: Position;
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
 * 포지션 구획의 머리 행. `<tr><th colspan="3">投手</th></tr>`
 *
 * ⚠**선수 행과 같은 순서로 훑어야 한다** — 구획은 위치로만 정해진다.
 * 그래서 아래에서 **머리와 행을 한 정규식으로 번갈아 잡는다.** 따로 훑어 인덱스로
 * 맞추려 하면 마크업이 조금만 바뀌어도 **한 칸씩 밀린 포지션**이 조용히 들어간다.
 */
const GROUP = /<th[^>]*colspan="3"[^>]*>\s*([^<]*?)\s*<\/th>/g;

/**
 * 명단을 읽는다.
 *
 * @throws {RosterParseError} 한 행도 못 찾았을 때. ⚠**빈 배열로 넘기지 마라** —
 *   마크업이 바뀌면 「그날은 벤치가 비어 있었다」가 되고, 투타 보충이 조용히 멈춘다.
 *   실측(2026-08-27 · 7,805장): 행이 있는 7,533장에서 43~64명이 잡히고, 272장은 0명이라 여기서 걸린다.
 */
export function parseGameRoster(html: string): RosterEntry[] {
  const out: RosterEntry[] = [];

  /**
   * 머리 행의 **문서 위치**를 먼저 모아 둔다. 선수 행을 훑으면서
   * 「그 행보다 앞에 있는 마지막 머리」를 그 행의 구획으로 삼는다.
   *
   * ⚠**모르는 머리를 조용히 넘기지 않는다**(M7). 넘기면 그 구획 선수들이
   * **바로 위 구획의 포지션**을 받아 조용히 틀린 값이 들어간다 — 빈 값보다 나쁘다.
   */
  const groups: { at: number; position: Position }[] = [];
  for (const g of html.matchAll(GROUP)) {
    const label = g[1]!;
    const position = POSITIONS[label];
    if (position === undefined) {
      throw new RosterParseError("명단의 포지션 구획을 해석하지 못했다", `value=${JSON.stringify(label)}`);
    }
    groups.push({ at: g.index, position });
  }

  const positionAt = (at: number): Position => {
    let found: Position | undefined;
    for (const g of groups) {
      if (g.at > at) break;
      found = g.position;
    }
    /**
     * ⚠**구획 밖의 선수 행은 실패로 만든다.** 마크업이 바뀌어 머리를 못 찾으면
     * 여기서 전부 걸린다 — 「포지션 없음」으로 흘리면 보충이 조용히 멈춘다.
     */
    if (found === undefined) {
      throw new RosterParseError("포지션 구획 앞에 있는 선수 행을 만났다", `offset=${at}`);
    }
    return found;
  };

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
      position: positionAt(m.index),
    });
  }
  if (out.length === 0) {
    throw new RosterParseError("명단을 한 행도 찾지 못했다", `length=${html.length}`);
  }
  return out;
}
