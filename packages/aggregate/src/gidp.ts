/**
 * 併殺打(GIDP) — **§2-2 지표 카탈로그의 항목인데 화면 출현이 0회였다**(2026-08-20 실측:
 * `dist` 전량 grep 에서 「併殺」 0건).
 *
 * ⚠**재료는 계속 있었다.** `pa_event` 는 2018 시즌부터 채워져 있고, 세는 코드가 없었을 뿐이다.
 * 새 수집은 0이다.
 *
 * ## 무엇을 재고 무엇을 재지 않는가
 *
 * 이 값은 **「그 타자의 타석이 병살로 끝난 횟수」**다.
 * ⚠**병살의 책임 배분을 재지 않는다** — 주자의 발, 앞 타자의 출루 성향, 수비 배치가 전부 섞인다.
 * 앞에 주자가 자주 나가는 타자는 그것만으로 이 수가 커진다.
 * **「이 타자가 나쁘다」가 아니다.**
 *
 * ## ⚠함정: `併失` 을 빼면 안 된다
 *
 * 박스스코어의 `遊併失`(併殺崩れの失策)은 어휘표에서 `失$` 가 먼저 걸려 `reachedOnError` 로
 * 저장돼 있다. 그런데 NPB 는 그것을 **併殺打로 센다** — 타석 로그 원문이
 * `ショートゴロ併殺打（エラー）` 이다(실측 20건 전부).
 * 빼면 공표치와 **선수-시즌 14건**이 −1 씩 어긋난다(2022:3 · 2023:6 · 2024:3 · 2025:1 · 2026:1).
 *
 * ⚠**그렇다고 `tokens.ts` 의 분류를 바꾸지 않는다.** 타자는 실제로 출루했으므로
 * 打数·出塁 계산에서는 `reachedOnError` 가 맞다(그 값들은 지금 공표치와 일치한다).
 * 併殺打는 **거기서 파생하는 별개의 셈**이다.
 *
 * ## 대조 실측 (2026-08-20)
 *
 * · `career_batting.gidp`(NPB 공표치)와 **선수-시즌 3,177건 대조 · 어긋남 0건**
 *   (2018:192 · 2019:251 · 2020:249 · 2021:314 · 2022:360 · 2023:397 · 2024:475 · 2025:482 · 2026:457).
 *   ⚠`career_batting` 은 **현재 등록 선수만** 담으므로 리그 전량이 아니다 —
 *   9시즌 **정규시즌**의 併殺打는 **9,887건**이고 그중 대조된 몫은 8,066건이다.
 * · ⚠**대회를 섞어 적지 마라**(§2-1 · 2026-08-20 이중 검토 P2에서 정정).
 *   전 대회 합계는 **10,068건**이다(정규 9,887 · CS 96 · 일본시리즈 50 · 올스타 35).
 *   위 대조는 **정규시즌만**이므로 그 옆에 10,068 을 놓으면 두 수가 같은 모집단으로 읽힌다.
 * · **독립 판정과도 일치한다**: 타석 로그 쪽 `raw_pbp LIKE '%併殺打%'` 로 세면 전 대회 10,068건으로
 *   **집합이 완전히 같다**(이쪽에만 있는 행 0 · 저쪽에만 있는 행 0).
 *   그래도 **박스 쪽을 정본으로 쓴다** — `outcome` 은 박스에서 온 값이고,
 *   playbyplay 문자열을 해석해 지표를 만들지 않는다는 것이 002 마이그레이션의 판단이다(M1).
 */
import type { Db } from "@bb-app/store";
import { seasonNameExpr, seasonNameJoin } from "./season-name.ts";

export interface GidpLine {
  playerId: string;
  displayName: string;
  /** ⚠**공격 측이다** — 표(top)면 원정, 리(bottom)면 홈. 구단 표가 이 키로 고른다 */
  teamCode: string;
  /** 併殺打. **분모는 打席**이고 그 수는 같은 화면의 옆 칸이 말한다(M2) */
  gidp: number;
}

/**
 * ⚠**`LIKE '%併失%'` 이지 `'%併失'` 이 아니다.**
 * 지금 아카이브의 20건은 전부 `併失` 로 끝나므로 두 패턴의 결과가 같다(20 = 20, 실측).
 * 그런데 `raw_box` 는 **타점의 丸数字를 뒤에 달고 저장된다**(`parsePaCell` 의 `raw`) —
 * 병살 도중 주자가 홈에 들어오는 판이 나오면 `遊併失①` 이 되어 접미 패턴은 **조용히 0을 센다.**
 * 앞뒤를 여는 쪽이 그 침묵을 막는다.
 *
 * ⚠**과다 매칭도 없다 — 전수로 확인했다.** 아카이브에서 `併` 을 포함한 고유 `raw_box` 는 **11종**이고
 * (`{一三二投捕遊}併打` 6종 · `{一三二投遊}併失` 5종) `併失` 을 부분 문자열로 갖는 다른 어휘가 없다.
 * 앞의 6종은 어휘표의 `/併打$/` 로 이미 `groundedIntoDoublePlay` 가 되므로 이 `LIKE` 와 겹치지 않는다.
 */
const SQL = `
SELECT e.batter_id AS playerId,
       ${seasonNameExpr("p")} AS displayName,
       CASE e.half WHEN 'top' THEN g.away_code ELSE g.home_code END AS teamCode,
       SUM(CASE WHEN e.outcome = 'groundedIntoDoublePlay' OR e.raw_box LIKE '%併失%' THEN 1 ELSE 0 END) AS gidp
FROM pa_event e
JOIN game g ON g.game_id = e.game_id
JOIN player p ON p.player_id = e.batter_id
${seasonNameJoin("e.batter_id", "g.season")}
WHERE g.season = ? AND g.status = 'played' AND g.competition = ? AND g.game_date <= ?
  AND e.status = 'final'
GROUP BY e.batter_id, teamCode
`;

/**
 * 한 시즌의 선수 × 구단별 併殺打.
 *
 * ⚠**대회를 섞지 않는다**(§2-1). ⚠**미성립 경기는 기록이 무효다**(`status = 'played'`).
 * ⚠**잠정값을 섞지 않는다**(M9 · `e.status = 'final'`).
 * ⚠**0인 타자도 행이 나온다** — 「0」과 「기록 없음」은 다르다(M11).
 *   행이 아예 없다는 것은 그 선수의 타석 로그가 없다는 뜻이고, 화면은 그때 「모름」을 낸다.
 */
export function groundedIntoDoublePlays(
  db: Db,
  season: number,
  competition: string,
  through: string,
): GidpLine[] {
  const rows = db.raw.prepare(SQL).all(season, competition, through) as unknown as {
    playerId: string; displayName: string; teamCode: string; gidp: number;
  }[];
  return rows.map((r) => ({
    playerId: r.playerId,
    displayName: r.displayName,
    teamCode: r.teamCode,
    gidp: Number(r.gidp),
  }));
}
