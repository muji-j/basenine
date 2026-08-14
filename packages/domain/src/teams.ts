/**
 * 구단 마스터.
 *
 * ⚠**도메인 상수를 코드에 흩뿌리지 않고 여기 한 곳에 둔다.** 그리고 **건수를 테스트가 고정한다** —
 * 형제 프로젝트에서 상수를 세다 4개를 빠뜨려 존재하지 않는 사람에게 멘션이 나간 전례가 있다.
 * 여기서 한 팀이 빠지면 그 팀 선수 전원이 리그 집계에서 조용히 사라진다.
 *
 * 코드는 npb.jp의 경기 URL 슬러그(`/scores/2026/0814/s-db-17/`)에 쓰이는 것과 같다.
 */
export type League = "central" | "pacific";

export interface Team {
  /** URL 슬러그에 쓰이는 코드 */
  code: string;
  league: League;
  /** 일본어 표기 */
  name: string;
}

export const TEAMS: readonly Team[] = [
  { code: "g", league: "central", name: "読売ジャイアンツ" },
  { code: "t", league: "central", name: "阪神タイガース" },
  { code: "db", league: "central", name: "横浜DeNAベイスターズ" },
  { code: "c", league: "central", name: "広島東洋カープ" },
  { code: "d", league: "central", name: "中日ドラゴンズ" },
  { code: "s", league: "central", name: "東京ヤクルトスワローズ" },
  { code: "h", league: "pacific", name: "福岡ソフトバンクホークス" },
  { code: "f", league: "pacific", name: "北海道日本ハムファイターズ" },
  { code: "m", league: "pacific", name: "千葉ロッテマリーンズ" },
  { code: "l", league: "pacific", name: "埼玉西武ライオンズ" },
  { code: "e", league: "pacific", name: "東北楽天ゴールデンイーグルス" },
  { code: "b", league: "pacific", name: "オリックス・バファローズ" },
];

/**
 * 구단이 아닌 코드. **올스타전은 セ/パ 리그 선발이 싸우므로 팀 코드가 `cl`/`pl`이다.**
 *
 * ⚠이걸 구단으로 오인하면 올스타 성적이 정규시즌에 합산된다. 실제로 佐藤(阪神)의
 * 시즌 성적이 npb.jp 공표값보다 2경기·7타석·2홈런 많았고, 그 차이가 정확히 올스타 2경기였다.
 */
export const NON_TEAM_CODES: Readonly<Record<string, string>> = {
  cl: "allStar",
  pl: "allStar",
};

/**
 * 경기의 구분을 팀 코드로 판정한다.
 *
 * ⚠**모르는 코드는 예외다.** 조용히 `regular`로 흘리면 집계가 오염되고,
 * 오염은 숫자로만 드러나므로 알아채기 어렵다.
 * ⚠CS·일본시리즈는 정규 구단 코드를 쓰므로 **이 함수로 구별되지 않는다**(날짜·별도 판정 필요).
 * v1 범위는 8월까지라 아직 문제가 되지 않지만, 시즌 종반 전에 반드시 다뤄야 한다.
 */
export function competitionOf(awayCode: string, homeCode: string): string {
  const kinds = [awayCode, homeCode].map((code) => {
    const special = NON_TEAM_CODES[code];
    if (special !== undefined) return special;
    if (BY_CODE.has(code)) return "regular";
    throw new RangeError(`모르는 팀 코드: ${code}. 구단 마스터나 비구단 코드 표를 갱신하라`);
  });
  // ⚠양쪽이 같은 종류여야 한다. 구단 대 리그선발 같은 조합은 존재하지 않으므로
  // 그런 게 나왔다면 판정 규칙이 틀린 것이다 — regular로 흘려보내지 않는다.
  if (kinds[0] !== kinds[1]) {
    throw new RangeError(`구분을 정할 수 없는 조합: ${awayCode}(${kinds[0]}) vs ${homeCode}(${kinds[1]})`);
  }
  return kinds[0]!;
}

const BY_CODE = new Map(TEAMS.map((t) => [t.code, t]));

/** 모르는 코드는 **조용히 넘기지 않는다** — 팀이 하나 빠지면 그 선수 전원이 집계에서 사라진다. */
export function teamOf(code: string): Team {
  const t = BY_CODE.get(code);
  if (!t) throw new RangeError(`모르는 구단 코드: ${code}. 구단 마스터를 갱신하라`);
  return t;
}

export function leagueOf(code: string): League {
  return teamOf(code).league;
}
