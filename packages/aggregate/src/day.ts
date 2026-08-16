/**
 * 하루치 경기 — 「무슨 일이 있었나」.
 *
 * ⚠**이 모듈이 다루는 것은 「직전 경기일」이지 「오늘」이 아니다.** 수집은 하루 1회이고
 * 사이트 생성일과 경기일은 어긋난다(2026-08-16 생성 시점의 최신 경기일은 8/14였다).
 * 「今日」라고 단정하면 이틀 전 결과를 오늘 것으로 읽게 만든다 — 그래서 날짜를 그대로 낸다.
 *
 * ⚠**중지·노게임을 0대0으로 만들지 않는다**(M11). 「경기가 없었다」와 「0점이었다」는 다르다.
 */
import type { Db } from "@bb-app/store";

export interface DaySide {
  teamCode: string;
  /** 득점·안타·실책. **미수집이면 null**(M11) — 0과 구별한다 */
  runs: number | null;
  hits: number | null;
  errors: number | null;
}

/** 결정 표기가 붙은 투수. **소속을 함께 든다**(동명이인 대응) */
export interface DayPitcherRef {
  playerId: string;
  teamCode: string;
}

export interface DayPitcher {
  playerId: string;
  /** 그 경기의 이닝(아웃 카운트) */
  outs: number;
  /** 자책점 */
  er: number;
  so: number;
}

/**
 * 그 경기에서 눈에 띈 기록.
 *
 * ⚠**「눈에 띈다」의 기준을 코드에만 두지 않는다** — 화면에도 적고 테스트로 고정한다.
 * 기준이 숨어 있으면 「왜 이 선수가 없지?」에 답할 수 없다.
 */
export interface DayStar {
  playerId: string;
  teamCode: string;
  /** `4打数3安打1本塁打` 같은 조립 재료. **분모(打数·投球回)를 반드시 함께 낸다**(M2) */
  kind: "batting" | "pitching";
  ab: number;
  h: number;
  hr: number;
  rbi: number;
  outs: number;
  er: number;
  so: number;
  /** 승·패·세이브·홀드 표기. 없으면 null */
  decision: string | null;
}

export interface DayGame {
  gameId: string;
  venue: string | null;
  competition: string;
  /** `played`면 결과가 있다. 아니면 `notPlayedReason`이 이유를 말한다 */
  status: string;
  notPlayedReason: string | null;
  away: DaySide;
  home: DaySide;
  /** 이긴 쪽. 무승부는 null. **경기를 안 했으면 이 필드를 읽지 마라** */
  winner: "away" | "home" | null;
  /**
   * 勝利投手·敗戦投手·セーブ. 없으면 null.
   *
   * ⚠**소속을 함께 낸다.** 같은 카드에 동명이인이 서는 일이 실제로 있다
   * (2026-08-14 西武−ロッテ 전의 「小島」 — 로데의 패전투수와 세이부의 타자).
   * 구단이 없으면 화면이 「진 투수가 상대 팀에 홈런을 쳤다」로 읽힌다.
   */
  winPitcher: DayPitcherRef | null;
  losePitcher: DayPitcherRef | null;
  savePitcher: DayPitcherRef | null;
  stars: DayStar[];
}

/** 몇 안타부터 「눈에 띄었다」로 볼 것인가. **화면에도 이 수를 적는다** */
export const STAR_HITS = 3;
/** 몇 타점부터 */
export const STAR_RBI = 4;
/** 선발의 호투 기준 — 이 아웃 수(6이닝) 이상에 자책 이하 */
export const STAR_OUTS = 18;
export const STAR_ER = 2;
/** 몇 탈삼진부터 */
export const STAR_SO = 10;

/** 한 경기에 싣는 최대 인원. **자른 사실은 화면이 말한다** */
export const STAR_LIMIT = 6;

const GAME_SQL = `
SELECT game_id AS gameId, venue, competition, status,
       not_played_reason AS notPlayedReason,
       away_code AS awayCode, home_code AS homeCode,
       away_runs AS awayRuns, home_runs AS homeRuns,
       away_hits AS awayHits, home_hits AS homeHits,
       away_errors AS awayErrors, home_errors AS homeErrors
FROM game
WHERE season = ? AND game_date = ?
ORDER BY game_id
`;

const DECISION_SQL = `
SELECT pl.game_id AS gameId, pl.player_id AS playerId, pl.side, pl.decision
FROM pitching_line pl
JOIN game g ON g.game_id = pl.game_id
WHERE g.season = ? AND g.game_date = ? AND pl.decision IS NOT NULL
`;

/**
 * ⚠**타자와 투수를 한 번에 긁지 않는다.** 한 사람이 양쪽에 나올 수 있고(투수의 타석),
 * 그때 JOIN으로 합치면 행이 곱해진다. 따로 읽어 코드에서 합친다.
 */
const BATTING_SQL = `
SELECT b.game_id AS gameId, b.player_id AS playerId, b.side,
       b.ab, b.h, b.hr, b.rbi
FROM batting_line b
JOIN game g ON g.game_id = b.game_id
WHERE g.season = ? AND g.game_date = ? AND g.status = 'played'
  AND (b.h >= ? OR b.hr > 0 OR b.rbi >= ?)
`;

const PITCHING_SQL = `
SELECT p.game_id AS gameId, p.player_id AS playerId, p.side,
       p.outs, p.er, p.so, p.decision
FROM pitching_line p
JOIN game g ON g.game_id = p.game_id
WHERE g.season = ? AND g.game_date = ? AND g.status = 'played'
  AND ((p.outs >= ? AND p.er <= ?) OR p.so >= ?)
`;

interface GameRow {
  gameId: string;
  venue: string | null;
  competition: string;
  status: string;
  notPlayedReason: string | null;
  awayCode: string;
  homeCode: string;
  awayRuns: number | null;
  homeRuns: number | null;
  awayHits: number | null;
  homeHits: number | null;
  awayErrors: number | null;
  homeErrors: number | null;
}

function winnerOf(row: GameRow): "away" | "home" | null {
  if (row.status !== "played") return null;
  if (row.awayRuns === null || row.homeRuns === null) return null;
  if (row.awayRuns === row.homeRuns) return null;
  return row.awayRuns > row.homeRuns ? "away" : "home";
}

/**
 * 그 하루의 경기들.
 *
 * @param date `YYYY-MM-DD`. **호출자가 정한다** — 이 함수는 시계를 모른다(M6)
 */
export function dayResults(db: Db, season: number, date: string): DayGame[] {
  const rows = db.raw.prepare(GAME_SQL).all(season, date) as unknown as GameRow[];
  if (rows.length === 0) return [];

  const decisions = db.raw.prepare(DECISION_SQL).all(season, date) as unknown as {
    gameId: string;
    playerId: string;
    side: string;
    decision: string;
  }[];
  const bats = db.raw.prepare(BATTING_SQL).all(season, date, STAR_HITS, STAR_RBI) as unknown as {
    gameId: string;
    playerId: string;
    side: string;
    ab: number;
    h: number;
    hr: number;
    rbi: number;
  }[];
  const pits = db.raw
    .prepare(PITCHING_SQL)
    .all(season, date, STAR_OUTS, STAR_ER, STAR_SO) as unknown as {
    gameId: string;
    playerId: string;
    side: string;
    outs: number;
    er: number;
    so: number;
    decision: string | null;
  }[];

  const codeOf = new Map(rows.map((r) => [r.gameId, { away: r.awayCode, home: r.homeCode }]));

  const decisionOf = new Map<string, Map<string, DayPitcherRef>>();
  for (const d of decisions) {
    const codes = codeOf.get(d.gameId);
    if (codes === undefined) continue;
    let m = decisionOf.get(d.gameId);
    if (m === undefined) {
      m = new Map();
      decisionOf.set(d.gameId, m);
    }
    m.set(d.decision, {
      playerId: d.playerId,
      teamCode: d.side === "away" ? codes.away : codes.home,
    });
  }

  const starsOf = new Map<string, DayStar[]>();
  const push = (gameId: string, s: DayStar): void => {
    const list = starsOf.get(gameId);
    if (list === undefined) starsOf.set(gameId, [s]);
    else list.push(s);
  };
  for (const b of bats) {
    const codes = codeOf.get(b.gameId);
    if (codes === undefined) continue;
    push(b.gameId, {
      playerId: b.playerId,
      teamCode: b.side === "away" ? codes.away : codes.home,
      kind: "batting",
      ab: b.ab,
      h: b.h,
      hr: b.hr,
      rbi: b.rbi,
      outs: 0,
      er: 0,
      so: 0,
      decision: null,
    });
  }
  for (const p of pits) {
    const codes = codeOf.get(p.gameId);
    if (codes === undefined) continue;
    push(p.gameId, {
      playerId: p.playerId,
      teamCode: p.side === "away" ? codes.away : codes.home,
      kind: "pitching",
      ab: 0,
      h: 0,
      hr: 0,
      rbi: 0,
      outs: p.outs,
      er: p.er,
      so: p.so,
      decision: p.decision,
    });
  }

  return rows.map((r) => {
    const dm = decisionOf.get(r.gameId);
    const stars = (starsOf.get(r.gameId) ?? []).slice();
    // ⚠**투수를 먼저 세운다.** 호투는 그 경기의 뼈대이고, 안타 3개는 그 위에 얹히는 이야기다
    stars.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "pitching" ? -1 : 1;
      if (a.kind === "pitching") return b.outs - a.outs || b.so - a.so;
      return b.hr - a.hr || b.h - a.h || b.rbi - a.rbi;
    });
    return {
      gameId: r.gameId,
      venue: r.venue,
      competition: r.competition,
      status: r.status,
      notPlayedReason: r.notPlayedReason,
      away: { teamCode: r.awayCode, runs: r.awayRuns, hits: r.awayHits, errors: r.awayErrors },
      home: { teamCode: r.homeCode, runs: r.homeRuns, hits: r.homeHits, errors: r.homeErrors },
      winner: winnerOf(r),
      winPitcher: dm?.get("○") ?? null,
      losePitcher: dm?.get("●") ?? null,
      savePitcher: dm?.get("S") ?? null,
      stars: stars.slice(0, STAR_LIMIT),
    };
  });
}

/**
 * 가장 최근 경기일.
 *
 * ⚠**「중지된 날」도 경기일이다.** 전 경기가 비로 날아간 날을 건너뛰면 화면이
 * 「그날은 아무 일도 없었다」가 아니라 「그날이 없었다」고 말하게 된다.
 */
export function latestGameDate(db: Db, season: number, through = "9999-12-31"): string | null {
  const row = db.raw
    .prepare(
      `SELECT MAX(game_date) AS d FROM game WHERE season = ? AND game_date <= ? AND competition = 'regular'`,
    )
    .get(season, through) as unknown as { d: string | null } | undefined;
  return row?.d ?? null;
}
