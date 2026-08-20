/**
 * 引き分けの解剖 — **「2021년은 왜 무승부가 이렇게 많았어?」**에 답하는 값.
 *
 * ⚠**NPB 특유의 축이다.** MLB 파생 지표는 무승부를 아예 다루지 않는다(MLB 에는 없다).
 * ⚠**새 수집이 0이고 새 계산도 거의 없다** — `game.away_runs`/`home_runs` 와 `pa_event.inning` 만 읽는다.
 *
 * ## 규정 변경이 데이터에 그대로 새겨져 있다 (2026-08-20 실측 · 정규시즌)
 *
 * ```
 * 시즌  경기   무승부  연장진입  연장무승부  9회무승부  최대이닝
 * 2018   858     16       80        16          0        12
 * 2019   858     22       93        20          2        12
 * 2020   720     40       60        40          0        10   ← 연장 10회까지
 * 2021   858    102        0         0        102         9   ← **연장 자체가 없었다**
 * 2022   858     16       90        15          1        12
 * 2023   858     19       84        19          0        12
 * 2024   858     30       99        28          2        12
 * 2025   858     23      101        21          2        12
 * 2026   641     11       46        11          0        12   ← 진행 중
 * ```
 *
 * ⚠**이 표를 화면에 하드코딩하지 마라.** 직전 라운드가 정확히 그 실수를 했고(리그 실측치를
 * 1,808장에 박았다), **DB 에서 다시 세어 화면과 대조하는 시험**으로 고쳤다.
 * 여기서도 화면은 이 함수의 출력만 그리고, `draw-seasons.test.ts` 가 그것을 다시 센다.
 *
 * ⚠**「9회 뒤에는 연장이 있다」를 상수로 박으면 2020·2021 에서 조용히 틀린다.**
 * `REGULATION_INNINGS`(9)만 상수이고, **연장의 상한은 데이터가 말한다.**
 *
 * ## ⚠무엇을 재지 않는가
 *
 * **「무승부가 순위에 미친 영향」을 재지 않는다.** NPB 의 勝率은 무승부를 분모에서 빼므로
 * (`standings.ts` 가 이미 그렇게 한다) 「무승부가 1승 반」 같은 환산은 이 사이트의 셈이 아니다.
 * **「어느 팀이 무승부에 강한가」도 재지 않는다** — 무승부는 두 팀에 동시에 붙는 사건이고,
 * 그것을 팀의 성질로 읽는 순간 근거 없는 이야기가 된다.
 */
import type { Db } from "@bb-app/store";
import type { Rate } from "@bb-app/metrics";
import { rate } from "@bb-app/metrics";

/** 정규 이닝. ⚠**연장의 상한은 여기 없다** — 해마다 다르고, 데이터가 말한다 */
export const REGULATION_INNINGS = 9;

export interface SeasonDrawLine {
  season: number;
  /** 성립한 경기 수 */
  games: number;
  /** 무승부 */
  draws: number;
  /** 연장(10회 이상)에 들어간 경기 */
  extra: number;
  /** 연장에 들어가 무승부로 끝난 경기 */
  extraDrawn: number;
  /**
   * **9회 이내**에 무승부로 끝난 경기.
   * ⚠**연장이 있는 해에 이 수가 0이 아니면 그것은 콜드 게임**(우천 등)이다.
   *   2021 년처럼 연장 자체가 없는 해에는 무승부가 전부 여기로 온다.
   */
  regulationDrawn: number;
  /** 그 시즌에 실제로 도달한 최대 이닝. 타석 로그가 하나도 없으면 null */
  maxInning: number | null;
  /**
   * 타석 로그가 없어 이닝을 모르는 경기.
   * ⚠**9회로 때우지 않는다**(M11) — 「9회로 끝났다」와 「몇 회였는지 모른다」는 다르다.
   *   이 경기들은 `extra` 에도 `regulationDrawn` 에도 들어가지 않는다.
   */
  inningUnknown: number;
}

/**
 * ⚠**대회를 섞지 않는다**(§2-1) · **미성립 경기는 기록이 무효다**(`status='played'`) ·
 * **잠정값을 섞지 않는다**(M9 · `e.status='final'`).
 *
 * ⚠**`LEFT JOIN` 이다.** 타석 로그가 없는 경기를 **떨어뜨리면** 경기 수 자체가 줄어
 * 무승부율의 분모가 조용히 작아진다.
 */
const SQL = `
WITH per_game AS (
  SELECT g.season AS season, g.game_id AS gameId,
         g.away_runs AS awayRuns, g.home_runs AS homeRuns,
         MAX(e.inning) AS lastInning
  FROM game g
  LEFT JOIN pa_event e ON e.game_id = g.game_id AND e.status = 'final'
  WHERE g.status = 'played' AND g.competition = ? AND g.game_date <= ?
    AND g.season BETWEEN ? AND ?
  GROUP BY g.game_id
)
SELECT season,
       COUNT(*) AS games,
       SUM(CASE WHEN awayRuns = homeRuns THEN 1 ELSE 0 END) AS draws,
       SUM(CASE WHEN lastInning > ${REGULATION_INNINGS} THEN 1 ELSE 0 END) AS extra,
       SUM(CASE WHEN lastInning > ${REGULATION_INNINGS} AND awayRuns = homeRuns THEN 1 ELSE 0 END) AS extraDrawn,
       SUM(CASE WHEN lastInning IS NOT NULL AND lastInning <= ${REGULATION_INNINGS}
                     AND awayRuns = homeRuns THEN 1 ELSE 0 END) AS regulationDrawn,
       SUM(CASE WHEN lastInning IS NULL THEN 1 ELSE 0 END) AS inningUnknown,
       MAX(lastInning) AS maxInning
FROM per_game
GROUP BY season
ORDER BY season
`;

/**
 * 시즌별 무승부·연장의 내역.
 *
 * @param fromSeason 보유 첫 시즌
 * @param toSeason 화면이 보고 있는 시즌. ⚠**미래 시즌을 과거 화면에 싣지 않는다** —
 *   `query.ts` 의 통산 대전(`careerMatchups`)과 같은 규약이다
 */
export function seasonDraws(
  db: Db,
  competition: string,
  through: string,
  fromSeason: number,
  toSeason: number,
): SeasonDrawLine[] {
  const rows = db.raw.prepare(SQL).all(competition, through, fromSeason, toSeason) as unknown as {
    season: number; games: number; draws: number; extra: number; extraDrawn: number;
    regulationDrawn: number; inningUnknown: number; maxInning: number | null;
  }[];
  return rows.map((r) => ({
    season: Number(r.season),
    games: Number(r.games),
    draws: Number(r.draws),
    extra: Number(r.extra),
    extraDrawn: Number(r.extraDrawn),
    regulationDrawn: Number(r.regulationDrawn),
    inningUnknown: Number(r.inningUnknown),
    maxInning: r.maxInning === null ? null : Number(r.maxInning),
  }));
}

/** 무승부율. ⚠**경기가 0이면 값을 내지 않는다**(M11) */
export function drawRate(l: Pick<SeasonDrawLine, "draws" | "games">): Rate {
  return rate(l.draws, l.games);
}

/** 연장 진입률 */
export function extraRate(l: Pick<SeasonDrawLine, "extra" | "games">): Rate {
  return rate(l.extra, l.games);
}

/**
 * 연장에 들어간 뒤 결착이 난 비율.
 * ⚠**연장이 0인 해(2021)에는 값이 없다** — `.000` 으로 내면 「연장에서 한 번도 못 이겼다」가 되어
 * 정반대의 거짓말이 된다(M11).
 */
export function extraDecidedRate(l: Pick<SeasonDrawLine, "extra" | "extraDrawn">): Rate {
  return rate(l.extra - l.extraDrawn, l.extra);
}
