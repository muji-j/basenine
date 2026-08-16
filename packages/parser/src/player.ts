/**
 * 선수 페이지(`/bis/players/{id}.html`) 프로필 파서.
 *
 * 좌우 스플릿(좌투 상대 타율 등)은 **투타 정보**가 있어야 성립하는데
 * 박스스코어에도 playbyplay에도 없다. 이 페이지가 유일한 출처다.
 *
 * ```html
 * <section id="pc_bio"><table>
 *   <tr><th>ポジション</th><td>投手</td></tr>
 *   <tr><th>投打</th><td>右投左打</td></tr>
 *   <tr><th>生年月日</th><td>2004年6月6日</td></tr>
 * </table></section>
 * ```
 */

/** 던지는 손 / 치는 손. `both`는 양투·스위치히터. */
export type Hand = "right" | "left" | "both";

export interface PlayerProfile {
  /** `投手` `内野手` `外野手` `捕手` 등 원문 */
  position: string | null;
  throws: Hand | null;
  bats: Hand | null;
  /** `YYYY-MM-DD`. 파싱하지 못하면 null */
  birthDate: string | null;
  /** `186cm／92kg` 원문 */
  physique: string | null;
  /**
   * 읽는 법. **원문 그대로 둔다**(M4).
   *
   * ⚠**「히라가나」가 아니다.** 실측 858장 중 737장이 `たかはし・こうや` 꼴이지만
   * **121장은 외국인 선수라 `ルーク・ボイト (LUKE VOIT)` 꼴**이다. 히라가나로 정규화하면
   * 그 121명의 검색어가 통째로 사라진다. 해석은 읽는 쪽(검색 색인)에서 한다.
   */
  kana: string | null;
  /**
   * 등번호. **문자열이다** — `00`이 실재하고, 숫자로 바꾸면 `0`과 구별할 수 없다.
   *
   * ⚠**null은 「0번」이 아니라 「지금 등록이 없다」**(M11). 실측 858명 중 76명이
   * 이 항목 자체가 없고, 그 76명은 **2026시즌 출장이 0**이다(은퇴·이적).
   * 0으로 채우면 은퇴 선수 전원이 「배번 0」이 된다.
   */
  uniformNumber: string | null;
}

export class PlayerParseError extends Error {
  readonly detail: string;
  constructor(message: string, detail: string) {
    super(`${message} — ${detail}`);
    this.name = "PlayerParseError";
    this.detail = detail;
  }
}

const HAND: Readonly<Record<string, Hand>> = {
  右: "right",
  左: "left",
  両: "both",
};

function strip(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * `右投左打` → `{ throws: right, bats: left }`.
 * ⚠**모르는 표기는 조용히 null로 만들지 않고 던진다.** 좌우 스플릿의 근거가 되는 값이라
 * 절반이 null이면 스플릿이 조용히 반쪽이 된다.
 */
export function parseThrowsBats(text: string): { throws: Hand; bats: Hand } {
  const m = /^([右左両])投([右左両])打$/.exec(text.replace(/\s/g, ""));
  if (!m) throw new PlayerParseError("投打 표기를 해석하지 못했다", `value=${JSON.stringify(text)}`);
  return { throws: HAND[m[1]!]!, bats: HAND[m[2]!]! };
}

/** `2004年6月6日` → `2004-06-06`. */
export function parseBirthDate(text: string): string | null {
  const m = /^(\d{4})年(\d{1,2})月(\d{1,2})日$/.exec(text.replace(/\s/g, ""));
  if (!m) return null;
  return `${m[1]}-${String(Number(m[2])).padStart(2, "0")}-${String(Number(m[3])).padStart(2, "0")}`;
}

/**
 * @throws {PlayerParseError} 프로필 표를 찾지 못했을 때.
 * ⚠빈 프로필을 돌려주지 마라 — 그러면 전 선수가 투타 미상이 되고 좌우 스플릿이 통째로 사라진다.
 */
export function parsePlayerProfile(html: string): PlayerProfile {
  const section = /<section id="pc_bio">([\s\S]*?)<\/section>/.exec(html);
  if (!section) {
    throw new PlayerParseError("프로필 표(#pc_bio)를 찾지 못했다", `length=${html.length}`);
  }

  const fields = new Map<string, string>();
  for (const row of section[1]!.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
    const th = /<th[^>]*>([\s\S]*?)<\/th>/.exec(row[1]!);
    const td = /<td[^>]*>([\s\S]*?)<\/td>/.exec(row[1]!);
    if (th && td) fields.set(strip(th[1]!), strip(td[1]!));
  }

  const throwsBats = fields.get("投打");
  const parsed = throwsBats === undefined ? null : parseThrowsBats(throwsBats);
  const birth = fields.get("生年月日");

  return {
    position: fields.get("ポジション") ?? null,
    throws: parsed?.throws ?? null,
    bats: parsed?.bats ?? null,
    birthDate: birth === undefined ? null : parseBirthDate(birth),
    physique: fields.get("身長／体重") ?? null,
    ...parseVitals(html),
  };
}

/**
 * 표제부(`#pc_vitals`)에서 **읽는 법과 등번호**를 꺼낸다.
 *
 * ```html
 * <div id="pc_v_name"><ul>
 *   <li id="pc_v_no">34</li>
 *   <li id="pc_v_team">広島東洋カープ</li>
 *   <li id="pc_v_name">高橋　昂也</li>
 *   <li id="pc_v_kana">たかはし・こうや</li>
 * </ul></div>
 * ```
 *
 * ⚠**사진과 구단 로고는 같은 구획에 있지만 읽지 않는다.** 사진은 촬영자의 저작물이고
 * 선수의 초상권이 붙으며 로고는 상표다 — 수치(사실)와 표현물의 경계가 여기다(CLAUDE.md §6).
 *
 * ⚠**표제부가 없으면 던진다**(M7). 실측 858/858 이므로 임계값 0으로 걸 수 있다.
 * 조용히 null 을 돌려주면 어느 날 검색이 이름만으로 좁아지고 아무도 눈치채지 못한다.
 */
export function parseVitals(html: string): { kana: string | null; uniformNumber: string | null } {
  const section = /<section id="pc_vitals">([\s\S]*?)<\/section>/.exec(html);
  if (!section) {
    throw new PlayerParseError("표제부(#pc_vitals)를 찾지 못했다", `length=${html.length}`);
  }
  const body = section[1]!;
  const pick = (id: string): string | null => {
    const m = new RegExp(`<li id="${id}">([\\s\\S]*?)</li>`).exec(body);
    if (!m) return null;
    const t = strip(m[1]!);
    return t === "" ? null : t;
  };
  return { kana: pick("pc_v_kana"), uniformNumber: pick("pc_v_no") };
}
