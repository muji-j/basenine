/**
 * 시즌 집계.
 *
 * ⚠**집계 테이블을 저장하지 않는다.** 전부 원시(`batting_line`/`pitching_line`)에서
 * 재계산한다 — 파서를 고치거나 새 지표를 만들 때 다시 돌리면 되기 때문이다.
 *
 * ⚠**읽기 예산**: D1 무료는 하루 500만 「행 읽기」에서 차단되고, 이는 반환 행이 아니라
 * **쿼리가 스캔한 행**이다. 그래서 여기 쿼리는 시즌 1회 스캔으로 끝나도록 짠다.
 * 스캔량을 `readRows`로 함께 돌려주므로 예산을 눈으로 볼 수 있다.
 */
import type { Db } from "@bb-app/store";
import type { BattingLine, PitchingLine } from "@bb-app/metrics";
import { leagueOf } from "@bb-app/domain";
import type { League } from "@bb-app/domain";

export interface SeasonBatting {
  playerId: string;
  displayName: string;
  teamCode: string;
  league: League;
  games: number;
  /** 득점·타점·도루는 지표 산식의 입력이 아니라 표시용이라 line 밖에 둔다 */
  runs: number;
  rbi: number;
  sb: number;
  line: BattingLine;
}

/**
 * 투수의 역할. **선발과 구원은 같은 잣대로 잴 수 없다.**
 *
 * 2026 시즌 실측(2026-08-15): 30이닝 이상 선발형 85명의 방어율 5분위는
 * `2.59 / 2.97 / 3.50 / 4.63`, 20이닝 이상 구원형 90명은 `1.84 / 2.34 / 2.84 / 3.86`이다.
 * ⚠**방어율 3.20은 선발에게 중위권이고 구원에게는 하위권이다.** 하나의 임계값으로 칠하면
 * 값은 맞는데 화면이 틀린 말을 한다.
 */
export type PitcherRole = "starter" | "reliever";

/** 승·패·세이브·홀드. 박스스코어의 결정 표기(`○ ● S H`)에서 센다 */
export interface Decisions {
  w: number;
  l: number;
  sv: number;
  hld: number;
  /** 구원 등판에서의 승리. **홀드포인트(HP = 홀드 + 구원승)의 입력이다** */
  reliefW: number;
}

export interface SeasonPitching {
  playerId: string;
  displayName: string;
  teamCode: string;
  league: League;
  games: number;
  line: PitchingLine;
  /** 선발 등판 수 */
  starts: number;
  /**
   * 투구수·폭투·보크. ⚠**투구 라인(PitchingLine)에 넣지 않는다** — 지표 산식의 입력이 아니라
   * 표시용이다(득점·타점·도루를 타자 라인 밖에 둔 것과 같은 이유).
   * ⚠전부 null일 수 있다(원본에 열이 없던 시절의 행) — 0으로 메우지 않는다(M11).
   */
  pitches: number | null;
  wp: number | null;
  balk: number | null;
  decisions: Decisions;
  /** 선발 등판에서의 성적만. 선발이 0경기면 전 항목이 0이다 */
  asStarter: PitchingLine;
  /** 구원 등판에서의 성적만 */
  asReliever: PitchingLine;
  /**
   * 역할 판정. **아웃 카운트가 많은 쪽**이다.
   *
   * ⚠**등판 수가 아니라 아웃으로 나눈다.** 33등판 중 1선발인 투수(실재한다)를
   * 등판 수로 재면 구원이 맞지만, 선발 1회가 6이닝이고 구원 32회가 30이닝인 투수를
   * 「선발」로 부르는 규칙도 만들 수 있다. 아웃으로 재면 그런 흔들림이 없다.
   * 동수면 선발로 본다(선발 등판이 있다는 사실을 우선한다).
   */
  role: PitcherRole;
}

export interface SeasonAggregate {
  season: number;
  batting: SeasonBatting[];
  pitching: SeasonPitching[];
  /** 팀별 소화 경기수. 규정타석 계산에 쓴다 */
  teamGames: Map<string, number>;
  /** 스캔한 행 수(개산). D1 읽기 예산 감시용 */
  readRows: number;
}

/**
 * 선수의 소속 구단은 `game`의 원정/홈 코드와 `side`로 정해진다.
 * ⚠**한 시즌에 이적하면 두 팀 행이 생긴다.** 지금은 **출장이 가장 많은 팀**을 소속으로 본다 —
 * 이 규칙을 코드에만 두지 않고 여기 적어둔다.
 */
const TEAM_EXPR = `CASE b.side WHEN 'away' THEN g.away_code ELSE g.home_code END`;

const BATTING_SQL = `
SELECT b.player_id AS playerId,
       p.display_name AS displayName,
       ${TEAM_EXPR} AS teamCode,
       COUNT(*) AS games,
       SUM(b.pa) AS pa, SUM(b.ab) AS ab, SUM(b.h) AS h,
       SUM(b.d2) AS d2, SUM(b.d3) AS d3, SUM(b.hr) AS hr,
       SUM(b.bb) AS bb, SUM(b.ibb) AS ibb, SUM(b.hbp) AS hbp,
       SUM(b.sf) AS sf, SUM(b.sh) AS sh, SUM(b.so) AS so, SUM(b.roe) AS roe,
       SUM(b.runs) AS runs, SUM(b.rbi) AS rbi, SUM(b.sb) AS sb
FROM batting_line b
JOIN game g ON g.game_id = b.game_id
JOIN player p ON p.player_id = b.player_id
WHERE g.season = ? AND g.status = 'played' AND g.competition = ? AND g.game_date <= ?
GROUP BY b.player_id, teamCode
`;

/**
 * 선발 투수 = **각 이닝 절반의 첫 타석을 던진 투수**.
 *
 * ⚠`pitching_line`에는 등판 순서가 없다(주키가 `game_id, player_id`라 순서를 담을 자리가 없다).
 * 그래서 타석 로그에서 되찾는다. 실측(2026-08-15): 실시경기 632경기 전부에서 양 팀 선발이
 * 빠짐없이 나오고(1264/1264), 그 투수가 `pitching_line`에 없는 경우는 0건이다.
 * ⚠타석 로그가 없는 31경기는 **전부 우천 중지**라 투수 기록 자체가 없다 — 빈틈이 아니다.
 */
const STARTER_CTE = `
starter AS (
  SELECT e.game_id AS game_id, e.pitcher_id AS pitcher_id
  FROM pa_event e
  JOIN (SELECT game_id, half, MIN(seq) AS s FROM pa_event GROUP BY game_id, half) m
    ON m.game_id = e.game_id AND m.half = e.half AND m.s = e.seq
  WHERE e.pitcher_id IS NOT NULL
)`;

/** 선발 등판인가 — `CASE WHEN` 안에서 반복해 쓰는 조건 */
const IS_START = `s.pitcher_id IS NOT NULL`;

/** `SUM(CASE WHEN 선발 THEN col ELSE 0 END)` 한 쌍을 만든다. 손으로 16줄 쓰면 반드시 하나 틀린다 */
function splitSum(col: string, alias: string): string {
  return `SUM(CASE WHEN ${IS_START} THEN t.${col} ELSE 0 END) AS sp_${alias},
       SUM(CASE WHEN ${IS_START} THEN 0 ELSE t.${col} END) AS rp_${alias}`;
}

/**
 * 일부 등판만 읽힌 합계는 **합계가 아니다**(M11).
 *
 * ⚠SQL의 `SUM`은 NULL 행을 건너뛰므로, 10등판 중 3등판의 열을 못 읽었어도
 * 7등판의 합이 돌아온다. 그걸 시즌 합계로 쓰면 **분자와 분모의 표본이 다른 비율**이 나온다
 * (球数/アウト의 분모는 아웃이고 그건 10등판분이다).
 * 「모른다」를 「작다」로 바꾸지 않는다.
 *
 * @param sum `SUM(x)` · @param count `COUNT(x)`(non-null) · @param total 전체 행 수
 */
function partial(sum: unknown, count: unknown, total: unknown): number | null {
  if (sum === null || sum === undefined) return null;
  return Number(count) === Number(total) ? Number(sum) : null;
}

const PITCHING_SQL = `
WITH ${STARTER_CTE}
SELECT t.player_id AS playerId,
       p.display_name AS displayName,
       CASE t.side WHEN 'away' THEN g.away_code ELSE g.home_code END AS teamCode,
       COUNT(*) AS games,
       SUM(CASE WHEN ${IS_START} THEN 1 ELSE 0 END) AS starts,
       SUM(t.outs) AS outs, SUM(t.bf) AS bf, SUM(t.h) AS h, SUM(t.hr) AS hr,
       SUM(t.bb) AS bb, SUM(t.hbp) AS hbp, SUM(t.so) AS so,
       SUM(t.runs) AS runs, SUM(t.er) AS er,
       -- ⚠SUM은 NULL 행을 **건너뛴다.** 10등판 중 3등판의 투구수를 못 읽었으면
       -- 7등판의 합이 「완전한 시즌 합계」처럼 나오고, 분모(아웃)는 10등판분이라
       -- 球数/アウト가 **분자와 분모의 표본이 다른 비율**이 된다.
       -- 그래서 non-null 개수를 함께 세어, 하나라도 빠졌으면 값을 내지 않는다(M11)
       SUM(t.pitches) AS pitches, COUNT(t.pitches) AS pitchesN,
       SUM(t.wp) AS wp, COUNT(t.wp) AS wpN,
       SUM(t.balk) AS balk, COUNT(t.balk) AS balkN,
       ${splitSum("outs", "outs")},
       ${splitSum("bf", "bf")},
       ${splitSum("h", "h")},
       ${splitSum("hr", "hr")},
       ${splitSum("bb", "bb")},
       ${splitSum("hbp", "hbp")},
       ${splitSum("so", "so")},
       ${splitSum("runs", "runs")},
       ${splitSum("er", "er")},
       SUM(CASE WHEN t.decision = '○' THEN 1 ELSE 0 END) AS w,
       SUM(CASE WHEN t.decision = '●' THEN 1 ELSE 0 END) AS l,
       SUM(CASE WHEN t.decision = 'S' THEN 1 ELSE 0 END) AS sv,
       SUM(CASE WHEN t.decision = 'H' THEN 1 ELSE 0 END) AS hld,
       SUM(CASE WHEN t.decision = '○' AND s.pitcher_id IS NULL THEN 1 ELSE 0 END) AS reliefW
FROM pitching_line t
JOIN game g ON g.game_id = t.game_id
JOIN player p ON p.player_id = t.player_id
LEFT JOIN starter s ON s.game_id = t.game_id AND s.pitcher_id = t.player_id
WHERE g.season = ? AND g.status = 'played' AND g.competition = ? AND g.game_date <= ?
GROUP BY t.player_id, teamCode
`;

const TEAM_GAMES_SQL = `
SELECT away_code AS code, COUNT(*) AS n FROM game
WHERE season = ? AND status = 'played' AND competition = ? AND game_date <= ?
GROUP BY away_code
UNION ALL
SELECT home_code AS code, COUNT(*) AS n FROM game
WHERE season = ? AND status = 'played' AND competition = ? AND game_date <= ?
GROUP BY home_code
`;

const SCANNED_SQL = `
SELECT (SELECT COUNT(*) FROM batting_line) + (SELECT COUNT(*) FROM pitching_line) AS n
`;

/** SQL이 `(player_id, teamCode)`로 묶으므로 시즌 중 이적하면 한 선수가 복수 행이 된다. */
interface Keyed {
  playerId: string;
  displayName: string;
  teamCode: string;
  games: number;
}

/**
 * 이적 선수의 성적을 합산하고 **소속은 출장이 가장 많은 팀**으로 둔다.
 *
 * ⚠규칙을 코드에만 두지 않고 여기 적어둔다 — 시즌 중 이적은 매년 있고,
 * 어느 팀으로 셀지는 정답이 없는 선택이다.
 * @param sum 숫자 필드를 어떻게 더할지는 호출자가 안다(타자·투수 필드가 다르므로)
 */
function mergeByPlayer<T extends Keyed>(rows: readonly T[], sum: (a: T, b: T) => T): T[] {
  const primary = new Map<string, T>();
  for (const r of rows) {
    const cur = primary.get(r.playerId);
    if (cur === undefined || r.games > cur.games) primary.set(r.playerId, r);
  }
  const merged = new Map<string, T>();
  for (const r of rows) {
    const acc = merged.get(r.playerId);
    merged.set(r.playerId, acc === undefined ? r : sum(acc, r));
  }
  return [...merged.values()].map((r) => ({ ...r, teamCode: primary.get(r.playerId)!.teamCode }));
}

/**
 * @param through 이 경기일까지만 집계한다(`YYYY-MM-DD`). 기본값은 시즌 끝.
 *   ⚠**외부 공표값과 대조할 때 반드시 쓴다** — 상대의 기준일과 우리 아카이브 범위가
 *   하루만 달라도 「불일치」로 보이고, 그건 버그가 아니라 시점 차이다.
 */
export function aggregateSeason(
  db: Db,
  season: number,
  competition = "regular",
  through = "9999-12-31",
): SeasonAggregate {
  const batRows = db.raw.prepare(BATTING_SQL).all(season, competition, through) as Record<string, number | string>[];
  const pitRows = db.raw.prepare(PITCHING_SQL).all(season, competition, through) as Record<string, number | string>[];
  const teamRows = db.raw
    .prepare(TEAM_GAMES_SQL)
    .all(season, competition, through, season, competition, through) as { code: string; n: number }[];
  const scanned = db.raw.prepare(SCANNED_SQL).get() as { n: number };

  const teamGames = new Map<string, number>();
  for (const r of teamRows) teamGames.set(r.code, (teamGames.get(r.code) ?? 0) + r.n);

  const batting = mergeByPlayer(
    batRows.map((r) => ({
      playerId: String(r["playerId"]),
      displayName: String(r["displayName"]),
      teamCode: String(r["teamCode"]),
      games: Number(r["games"]),
      pa: Number(r["pa"]), ab: Number(r["ab"]), h: Number(r["h"]),
      d2: Number(r["d2"]), d3: Number(r["d3"]), hr: Number(r["hr"]),
      bb: Number(r["bb"]), ibb: Number(r["ibb"]), hbp: Number(r["hbp"]),
      sf: Number(r["sf"]), sh: Number(r["sh"]), so: Number(r["so"]), roe: Number(r["roe"]),
      runs: Number(r["runs"]), rbi: Number(r["rbi"]), sb: Number(r["sb"]),
    })),
    (a, b) => ({
      ...a,
      games: a.games + b.games,
      pa: a.pa + b.pa, ab: a.ab + b.ab, h: a.h + b.h,
      d2: a.d2 + b.d2, d3: a.d3 + b.d3, hr: a.hr + b.hr,
      bb: a.bb + b.bb, ibb: a.ibb + b.ibb, hbp: a.hbp + b.hbp,
      sf: a.sf + b.sf, sh: a.sh + b.sh, so: a.so + b.so, roe: a.roe + b.roe,
      runs: a.runs + b.runs, rbi: a.rbi + b.rbi, sb: a.sb + b.sb,
    }),
  ).map((r) => ({
    playerId: r.playerId,
    displayName: r.displayName,
    teamCode: r.teamCode,
    league: leagueOf(r.teamCode),
    games: r.games,
    runs: r.runs,
    rbi: r.rbi,
    sb: r.sb,
    line: {
      pa: r.pa, ab: r.ab, h: r.h, double: r.d2, triple: r.d3, hr: r.hr,
      bb: r.bb, ibb: r.ibb, hbp: r.hbp, sf: r.sf, sh: r.sh, so: r.so, roe: r.roe,
    } satisfies BattingLine,
  }));

  /** `sp_`/`rp_` 접두사가 붙은 열을 한 벌의 `PitchingLine`으로 모은다 */
  const splitLine = (r: Record<string, number>, p: "sp" | "rp"): PitchingLine => ({
    outs: r[`${p}_outs`]!, bf: r[`${p}_bf`]!, h: r[`${p}_h`]!, hr: r[`${p}_hr`]!,
    bb: r[`${p}_bb`]!, ibb: 0, hbp: r[`${p}_hbp`]!, so: r[`${p}_so`]!,
    er: r[`${p}_er`]!, r: r[`${p}_runs`]!,
  });
  const addLine = (a: PitchingLine, b: PitchingLine): PitchingLine => ({
    outs: a.outs + b.outs, bf: a.bf + b.bf, h: a.h + b.h, hr: a.hr + b.hr,
    bb: a.bb + b.bb, ibb: a.ibb + b.ibb, hbp: a.hbp + b.hbp, so: a.so + b.so,
    er: a.er + b.er, r: a.r + b.r,
  });

  const pitching = mergeByPlayer(
    pitRows.map((r) => {
      const n = Object.fromEntries(
        Object.entries(r).map(([k, v]) => [k, typeof v === "number" ? v : 0]),
      ) as Record<string, number>;
      return {
        playerId: String(r["playerId"]),
        displayName: String(r["displayName"]),
        teamCode: String(r["teamCode"]),
        games: Number(r["games"]),
        starts: Number(r["starts"]),
        // ⚠**일부만 읽힌 합계는 합계가 아니다.** 전부 읽혔을 때만 값을 낸다
        pitches: partial(r["pitches"], r["pitchesN"], r["games"]),
        wp: partial(r["wp"], r["wpN"], r["games"]),
        balk: partial(r["balk"], r["balkN"], r["games"]),
        outs: Number(r["outs"]), bf: Number(r["bf"]), h: Number(r["h"]), hr: Number(r["hr"]),
        bb: Number(r["bb"]), hbp: Number(r["hbp"]), so: Number(r["so"]),
        runs: Number(r["runs"]), er: Number(r["er"]),
        asStarter: splitLine(n, "sp"),
        asReliever: splitLine(n, "rp"),
        decisions: {
          w: Number(r["w"]), l: Number(r["l"]), sv: Number(r["sv"]),
          hld: Number(r["hld"]), reliefW: Number(r["reliefW"]),
        } satisfies Decisions,
      };
    }),
    (a, b) => ({
      ...a,
      games: a.games + b.games,
      starts: a.starts + b.starts,
      pitches: a.pitches === null && b.pitches === null ? null : (a.pitches ?? 0) + (b.pitches ?? 0),
      wp: a.wp === null && b.wp === null ? null : (a.wp ?? 0) + (b.wp ?? 0),
      balk: a.balk === null && b.balk === null ? null : (a.balk ?? 0) + (b.balk ?? 0),
      outs: a.outs + b.outs, bf: a.bf + b.bf, h: a.h + b.h, hr: a.hr + b.hr,
      bb: a.bb + b.bb, hbp: a.hbp + b.hbp, so: a.so + b.so,
      runs: a.runs + b.runs, er: a.er + b.er,
      asStarter: addLine(a.asStarter, b.asStarter),
      asReliever: addLine(a.asReliever, b.asReliever),
      decisions: {
        w: a.decisions.w + b.decisions.w,
        l: a.decisions.l + b.decisions.l,
        sv: a.decisions.sv + b.decisions.sv,
        hld: a.decisions.hld + b.decisions.hld,
        reliefW: a.decisions.reliefW + b.decisions.reliefW,
      },
    }),
  ).map((r) => ({
    playerId: r.playerId,
    displayName: r.displayName,
    teamCode: r.teamCode,
    league: leagueOf(r.teamCode),
    games: r.games,
    starts: r.starts,
    pitches: r.pitches,
    wp: r.wp,
    balk: r.balk,
    decisions: r.decisions,
    asStarter: r.asStarter,
    asReliever: r.asReliever,
    // ⚠아웃이 같으면 선발로 본다. 0아웃끼리(등판했지만 아웃을 못 잡음)도 여기 걸리는데,
    // 그때는 선발 등판이 있었는지가 유일한 정보라 `starts`가 0이면 구원이 된다
    role: (r.asStarter.outs > r.asReliever.outs ||
      (r.asStarter.outs === r.asReliever.outs && r.starts > 0)
      ? "starter"
      : "reliever") satisfies PitcherRole as PitcherRole,
    line: {
      outs: r.outs, bf: r.bf, h: r.h, hr: r.hr, bb: r.bb,
      // 박스스코어 투수표에는 고의사구 컬럼이 없다. 0이 아니라 「없음」이지만
      // PitchingLine이 수를 요구하므로 0으로 두고, 이 사실을 정의서에 적는다.
      ibb: 0,
      hbp: r.hbp, so: r.so, er: r.er, r: r.runs,
    } satisfies PitchingLine,
  }));

  return { season, batting, pitching, teamGames, readRows: scanned.n };
}
