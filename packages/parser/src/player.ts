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
  };
}
