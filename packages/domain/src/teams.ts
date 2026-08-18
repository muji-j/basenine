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
 * 경기의 구분.
 *
 * ⚠**交流戦은 `regular`다.** 정규시즌 경기이고 **리그 순위에 그대로 들어간다** —
 * 따로 빼면 어느 사이트와도 승패 수가 맞지 않는다. 원문 표기는 `game.series`에 남긴다.
 * ⚠**CS·일본시리즈는 `regular`가 아니다.** 섞으면 「시즌 성적」이 시즌 성적이 아니게 된다(§2-1).
 */
export type Competition = "regular" | "climaxSeries" | "nipponSeries" | "allStar";

/**
 * **정규시즌의 팀당 경기 수.**
 *
 * 실측으로 고정돼 있다 — 보유한 **2018~2025 중 2020 을 뺀 7시즌 × 12팀 = 84개가
 * 전부 정확히 143**이었다(2026-08-18 · 2018 백필 후 재측정).
 * 중지된 경기는 반드시 재편성되므로 최종적으로 어긋나지 않는다.
 *
 * ⚠**이 분모가 낡으면 판정 기준 자체가 거짓이 된다**(2026-08-18 감사 P3).
 * 「2022~2025 4시즌 = 48개」로 적혀 있었는데 그때 이미 DB 는 2019~2026 이었다.
 * → **주석이 아니라 시험이 이 사실을 지킨다**: `season-games.test.ts` 가
 *   **DB 가 실제로 보유한 전 시즌**을 훑어 12팀 값과 대조하므로,
 *   백필로 시즌이 늘면 **주석을 안 고쳐도 시험이 먼저 깨진다.**
 *
 * 쓰임: **아직 안 치른 경기의 대회를 가르는 유일한 근거**다. 월간 일정 페이지에는
 * CS·일본시리즈가 정규시즌과 **완전히 같은 모양**으로 실리고 대회 표시가 없어서
 * (2025-10 실측: 표 1개 · 31경기 중 포스트시즌 18), 「143을 넘는 예정은 정규시즌이 아니다」
 * 말고는 가를 방법이 없다. 자세한 것은 `calendarOf`.
 *
 * ⚠**교류전은 이 143 안에 들어간다**(위 `Competition` 주석과 같은 이유).
 * ⚠**이 값이 바뀌는 해가 오면 조용히 틀린다** — 실제로 2020년은 120경기였다.
 *   보유 시즌이 2020년 이전으로 늘어나면 시즌별 표로 바꿔라.
 */
export const REGULAR_SEASON_GAMES = 143;

/**
 * **143이 아닌 해.** 여기 없는 해는 143이다.
 *
 * ⚠**위 상수의 주석이 예고한 그 일이 왔다** — 「이 값이 바뀌는 해가 오면 조용히 틀린다.
 * 실제로 2020년은 120경기였다. 보유 시즌이 2020년 이전으로 늘어나면 시즌별 표로 바꿔라.」
 *
 * ⚠**여기 적는 수는 반드시 실측이어야 한다.** 「알려진 사실」로 적어 두면 그것이 곧 판정 기준이 되는데,
 * 이 리포는 이미 「2023~2026 4시즌」 같은 낡은 서술이 판정 기준 노릇을 하던 사고를 겪었다.
 * 새 시즌을 넣을 때는 **적재 후 `SUM(played) GROUP BY team` 으로 12팀 전부를 확인**하고 적어라.
 */
const SEASON_GAMES: ReadonlyMap<number, number> = new Map<number, number>([
  /**
   * 2020: 코로나로 단축. **실측이다**(2026-08-18 백필 후) —
   * 12팀 전부 정확히 120(`b c d db e f g h l m s t` 전부 120 · 서로 다른 값 1개).
   * ⚠같은 해의 부수 사실도 맞았다: 일본시리즈 **4경기**(소프트뱅크 스윕) ·
   * 클라이맥스 **2경기**(그해 센트럴은 CS 를 열지 않았다) · 타석 귀속 54,612/54,612.
   */
  [2020, 120],
]);

/**
 * 그 시즌의 정규시즌 경기 수(팀당).
 *
 * ⚠**시즌을 받지 않는 계산을 남기지 마라.** 143을 그대로 쓰면 2020년 화면에서
 * 「잔여 −23경기」·「143試合換算」처럼 **그 시즌에 존재하지 않는 기준**이 나온다.
 */
export function regularSeasonGames(season: number): number {
  return SEASON_GAMES.get(season) ?? REGULAR_SEASON_GAMES;
}

/**
 * 박스스코어의 대회 표기(`【…】` 안쪽)로 구분을 판정한다.
 *
 * ⚠**후원사 이름이 붙어 해마다 바뀐다** — `JERA セ・リーグ公式戦` · `パーソル パ・リーグ公式戦` ·
 * `日本生命セ・パ交流戦` · `SMBC日本シリーズ`. 전체 일치로 판정하면 후원사가 바뀐 해에
 * **조용히 전 경기가 미분류가 된다.** 그래서 변하지 않는 알맹이만 본다.
 *
 * ⚠**모르는 표기는 예외다**(M7). 조용히 `regular`로 흘리면 아무도 모르는 채로 집계가 오염되고,
 * 오염은 숫자로만 드러나므로 알아채기 어렵다. 실제로 2025년 CS·일본시리즈 18경기가
 * 그렇게 「정규시즌」에 들어와 있었다(2026-08-16 발견).
 *
 * 근거: 아카이브 1,569장 전수 조사(2026-08-16) — 위 6종 외의 표기는 없었다.
 */
export function competitionFromLabel(label: string): Competition {
  // ⚠순서가 뜻을 갖는다. 「日本シリーズ」를 먼저 봐야 한다 — 「セ・リーグ公式戦」과 겹치지 않지만,
  // 앞으로 표기가 늘어날 때 넓은 규칙이 좁은 규칙을 삼키는 사고를 막는다
  if (label.includes("日本シリーズ")) return "nipponSeries";
  if (label.includes("クライマックス") || /\bCS\b/.test(label) || label.startsWith("CS ")) {
    return "climaxSeries";
  }
  if (label.includes("オールスター")) return "allStar";
  if (label.includes("交流戦")) return "regular";
  if (label.includes("セ・リーグ公式戦") || label.includes("パ・リーグ公式戦")) return "regular";
  throw new RangeError(
    `모르는 대회 표기: ${JSON.stringify(label)}. 판정 규칙을 갱신하라 — regular로 흘리면 집계가 조용히 오염된다`,
  );
}

/**
 * 경기의 구분을 팀 코드로 판정한다.
 *
 * ⚠**모르는 코드는 예외다.** 조용히 `regular`로 흘리면 집계가 오염되고,
 * 오염은 숫자로만 드러나므로 알아채기 어렵다.
 * ⚠**CS·일본시리즈는 정규 구단 코드를 쓰므로 이 함수로 구별되지 않는다.**
 * 판정의 본체는 `competitionFromLabel`이고, 이 함수는 **표기를 못 읽었을 때의 대비책**이자
 * 올스타 판정의 **대조용**이다(둘이 어긋나면 규칙이 틀린 것이다).
 */
export function competitionOf(awayCode: string, homeCode: string): string {
  const kinds = [awayCode, homeCode].map((code) => {
    const special = NON_TEAM_CODES[code];
    if (special !== undefined) return special;
    // ⚠**옛 슬러그도 구단이다**(오릭스 `bs`, 2018 시즌까지) — 아니면 그 시즌이 통째로 실패한다
    if (BY_CODE.has(canonicalTeamCode(code))) return "regular";
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

/**
 * **옛 슬러그 → 지금 슬러그.**
 *
 * ⚠**npb.jp 의 URL 슬러그는 불변이 아니다**(2026-08-18 백필에서 실측으로 알았다).
 * 오릭스는 **2018 시즌까지 `bs`, 2019 시즌부터 `b`** 다.
 * 실측(아카이브 전수 · 2018~2026): 2018 `bs` **148경기** · `b` 0 / 2019 이후 `bs` 0 · `b` 147~159.
 * 그 밖의 미지 코드는 **0건**이다.
 *
 * ⚠**이걸 모른 채 백필하면 그 구단이 통째로 사라진다** — 실제로 2018 적재에서
 * **148경기가 「모르는 팀 코드」로 실패**했고, 그대로 뒀으면 2018 오릭스의 성적이
 * 화면에서 사라진 채 「그 시즌은 원래 그렇다」로 읽혔을 것이다.
 * ⚠**조용히 넘기지 않는 설계가 이걸 잡았다** — 예외를 던지지 않았다면 못 봤다(M7).
 * ⚠**별칭은 「우리가 확인한 것」만 넣는다.** 모르는 코드는 계속 예외여야 한다 —
 *   여기에 폭넓은 규칙을 넣는 순간 다음 슬러그 변경이 조용히 흡수된다.
 */
export const TEAM_CODE_ALIASES: Readonly<Record<string, string>> = {
  /** オリックス・バファローズ — 2018 시즌까지의 슬러그 */
  bs: "b",
};

/** 옛 슬러그를 지금 코드로. **모르는 코드는 그대로 돌려준다**(판정은 부르는 쪽이 한다) */
export function canonicalTeamCode(code: string): string {
  return TEAM_CODE_ALIASES[code] ?? code;
}

/** 모르는 코드는 **조용히 넘기지 않는다** — 팀이 하나 빠지면 그 선수 전원이 집계에서 사라진다. */
export function teamOf(code: string): Team {
  const t = BY_CODE.get(canonicalTeamCode(code));
  if (!t) throw new RangeError(`모르는 구단 코드: ${code}. 구단 마스터를 갱신하라`);
  return t;
}

export function leagueOf(code: string): League {
  return teamOf(code).league;
}

/**
 * 짧은 표기. 칩·선택지·표 머리처럼 **좁은 자리**에 쓴다.
 *
 * ⚠`name`을 잘라 만들지 않는다 — 「福岡ソフトバンクホークス」를 앞에서 자르면 「福岡ソフ」가 되고
 * 「北海道日本ハムファイターズ」는 「北海道日」가 된다. 통용되는 약칭은 규칙이 아니라 목록이다.
 */
const SHORT_NAME: Readonly<Record<string, string>> = {
  g: "巨人", t: "阪神", db: "DeNA", c: "広島", d: "中日", s: "ヤクルト",
  h: "ソフトバンク", f: "日本ハム", m: "ロッテ", l: "西武", e: "楽天", b: "オリックス",
};

/** 모르는 코드는 정식 표기로 되돌린다(그것도 없으면 코드 자체). **던지지 않는다** — 표시용이다 */
export function shortNameOf(code: string): string {
  const c = canonicalTeamCode(code);
  return SHORT_NAME[c] ?? BY_CODE.get(c)?.name ?? c.toUpperCase();
}

const BY_NAME = new Map(TEAMS.map((t) => [t.name, t]));

/**
 * 정식 표기로 구단을 찾는다. 予告先発 페이지처럼 **코드가 아니라 이름만 오는 소스**에 쓴다.
 *
 * ⚠**부분 일치·정규화를 하지 않는다.** 「阪神」과 「阪神タイガース」를 같게 보기 시작하면
 * 어디까지 같게 볼지 규칙이 코드에 흩어지고, 표기가 흔들릴 때 조용히 틀린 팀에 붙는다.
 * 표기가 바뀌면 여기서 던지고, 구단 마스터를 고친다.
 */
export function teamByName(name: string): Team {
  const t = BY_NAME.get(name);
  if (!t) throw new RangeError(`모르는 구단 표기: ${JSON.stringify(name)}. 구단 마스터를 갱신하라`);
  return t;
}

const BY_SHORT = new Map(Object.entries(SHORT_NAME).map(([code, short]) => [short, code]));

/**
 * **약칭**으로 구단 코드를 찾는다. 월간 일정 표처럼 `巨人`·`DeNA` 로만 오는 소스에 쓴다.
 *
 * ⚠**`teamByName` 과 다른 표다.** 저쪽은 정식 표기(`阪神タイガース`), 이쪽은 약칭(`阪神`)이다 —
 * 같은 함수로 합치면 「어느 표기까지 받아 주는가」가 흐려지고, 표기가 흔들릴 때 조용히 틀린 팀에 붙는다.
 * ⚠**모르면 던진다**(M7). 일정 표에는 올스타의 `セ・リーグ`·`パ・リーグ` 처럼 구단이 아닌 것도 나온다 —
 * 그건 호출자가 걸러야 하고, 여기서 조용히 넘기면 **경기가 통째로 사라진다.**
 * ⚠**부분 일치·정규화를 하지 않는다**(위 함수와 같은 이유).
 */
export function teamCodeByShortName(short: string): string {
  const code = BY_SHORT.get(short);
  if (code === undefined) {
    throw new RangeError(`모르는 구단 약칭: ${JSON.stringify(short)}. 구단 마스터를 갱신하라`);
  }
  return code;
}

/** 구단 약칭인가. **던지지 않고 묻는다** — 올스타 행처럼 구단이 아닌 것을 거를 때 쓴다 */
export function isTeamShortName(short: string): boolean {
  return BY_SHORT.has(short);
}
