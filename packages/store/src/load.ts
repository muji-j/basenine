/**
 * 적재.
 *
 * ⚠**멱등이어야 한다**(M5). 같은 경기를 두 번 적재해도 결과가 한 번과 같다.
 * 재수집·부분 실패 후 재실행·수동 재적재가 전부 일어난다.
 *
 * ⚠**쓰기 행 수를 센다.** D1 무료는 하루 10만 행에서 **차단**된다(과금이 아니다).
 * 예산을 모르면 적재가 도중에 멈춘 이유를 알 수 없다.
 */
import type { Db } from "./db.ts";
import type { BattingRow, PitchingRow, QuarantineRow } from "./derive.ts";
import type { PaEventRow } from "./align.ts";

export interface GameRow {
  gameId: string;
  season: number;
  gameDate: string;
  awayCode: string;
  homeCode: string;
  gameNo: number;
  status: "played" | "notPlayed";
  notPlayedReason: string | null;
  competition: string;
  /**
   * 대회 표기 **원문**(`JERA セ・リーグ公式戦` · `CS ファーストステージ` …).
   *
   * ⚠**판정 결과(`competition`)와 함께 든다**(M4). 판정 규칙이 바뀌었을 때
   * 「원본이 뭐라고 썼는가」로 되돌아갈 수 있어야 한다. 후원사 이름이 붙어 해마다 바뀐다.
   */
  series?: string | null;
  sourceUrl: string;
  fetchedAt: string;
  /**
   * 경기 결과. ⚠**중지 경기에는 없다 — 0이 아니라 null**이다(M11).
   * 팀 승패는 이 두 값으로만 판정한다(투수의 `decision`으로 세면 무승부가 사라진다).
   */
  awayRuns?: number | null;
  homeRuns?: number | null;
  awayHits?: number | null;
  homeHits?: number | null;
  awayErrors?: number | null;
  homeErrors?: number | null;
  /** 구장 원문 표기. ⚠홈팀으로 대리하면 지방개최를 놓친다 */
  venue?: string | null;
}

export interface WriteBudget {
  players: number;
  games: number;
  batting: number;
  pitching: number;
  paEvents: number;
  /** 주자 사건(도루·도루자·견제사). 타석과 다른 계열이라 따로 센다 */
  runnerEvents: number;
  quarantine: number;
  total: number;
}

export function emptyBudget(): WriteBudget {
  return { players: 0, games: 0, batting: 0, pitching: 0, paEvents: 0, runnerEvents: 0, quarantine: 0, total: 0 };
}

/** D1 무료 플랜의 하루 쓰기 한도. 초과하면 **과금이 아니라 차단**이다. */
export const D1_DAILY_WRITE_LIMIT = 100_000;

/**
 * 선수를 등록한다. 표시명은 최신으로 갱신하되 **ID는 절대 바뀌지 않는다**(M10).
 * 등록명 변경이 실재하므로 이름 갱신은 정상 동작이지 이상이 아니다.
 */
export function upsertPlayer(db: Db, playerId: string, displayName: string, nowIso: string): number {
  db.raw
    .prepare(
      `INSERT INTO player (player_id, display_name, first_seen_at, last_seen_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(player_id) DO UPDATE SET
         display_name = excluded.display_name,
         last_seen_at = excluded.last_seen_at`,
    )
    .run(playerId, displayName, nowIso, nowIso);
  return 1;
}

/**
 * 선수 행이 없으면 만든다. **있으면 표기를 건드리지 않는다.**
 *
 * ⚠`upsertPlayer`를 쓰면 안 된다 — 予告先発 페이지의 표기는 `柳　裕也`이고 박스스코어는 `柳`다.
 * 덮어쓰면 **예고 선발로 나온 선수만 표기가 길어져** 화면이 들쭉날쭉해진다.
 * 표기의 주인은 박스스코어 경로 하나로 둔다(M1의 정신).
 */
export function ensurePlayer(db: Db, playerId: string, displayName: string, nowIso: string): number {
  db.raw
    .prepare(
      `INSERT INTO player (player_id, display_name, first_seen_at, last_seen_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(player_id) DO NOTHING`,
    )
    .run(playerId, displayName, nowIso, nowIso);
  return 1;
}

export interface ProbablePitcherRow {
  gameDate: string;
  teamCode: string;
  opponentCode: string;
  playerId: string | null;
  sourceName: string | null;
  venue: string | null;
  startTime: string | null;
  league: string;
  sourceUrl: string;
  fetchedAt: string;
}

/**
 * 예고 선발을 적재한다. **멱등**이며(M5), 투수가 바뀌면 `revision`이 오른다(M4).
 *
 * ⚠`IS NOT`은 SQLite에서 NULL 안전 비교다. `<>`를 쓰면 미발표(NULL) → 발표 전이가
 * 조용히 「변화 없음」이 되어 revision이 멈춘다.
 */
export function upsertProbablePitcher(db: Db, r: ProbablePitcherRow): number {
  db.raw
    .prepare(
      `INSERT INTO probable_pitcher
         (game_date, team_code, opponent_code, player_id, source_name,
          venue, start_time, league, source_url, fetched_at, revision)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
       ON CONFLICT(game_date, team_code) DO UPDATE SET
         opponent_code = excluded.opponent_code,
         player_id     = excluded.player_id,
         source_name   = excluded.source_name,
         venue         = excluded.venue,
         start_time    = excluded.start_time,
         league        = excluded.league,
         source_url    = excluded.source_url,
         fetched_at    = excluded.fetched_at,
         revision      = probable_pitcher.revision
                         + (probable_pitcher.player_id IS NOT excluded.player_id)`,
    )
    .run(
      r.gameDate, r.teamCode, r.opponentCode, r.playerId, r.sourceName,
      r.venue, r.startTime, r.league, r.sourceUrl, r.fetchedAt,
    );
  return 1;
}

export function upsertGame(db: Db, g: GameRow): number {
  db.raw
    .prepare(
      `INSERT INTO game (game_id, season, game_date, away_code, home_code, game_no,
                         status, not_played_reason, competition, series, source_url, fetched_at, revision,
                         away_runs, home_runs, away_hits, home_hits, away_errors, home_errors, venue)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(game_id) DO UPDATE SET
         status = excluded.status,
         not_played_reason = excluded.not_played_reason,
         competition = excluded.competition,
         series = excluded.series,
         source_url = excluded.source_url,
         fetched_at = excluded.fetched_at,
         away_runs = excluded.away_runs,
         home_runs = excluded.home_runs,
         away_hits = excluded.away_hits,
         home_hits = excluded.home_hits,
         away_errors = excluded.away_errors,
         home_errors = excluded.home_errors,
         venue = excluded.venue,
         -- 내용이 실제로 달라졌을 때만 revision을 올린다. 재적재만으로는 오르지 않는다.
         -- ⚠득점이 바뀌는 것은 **정정**이다. revision이 올라가야 M4가 답할 수 있다
         revision = CASE
           WHEN game.status IS NOT excluded.status
             OR game.not_played_reason IS NOT excluded.not_played_reason
             OR game.away_runs IS NOT excluded.away_runs
             OR game.home_runs IS NOT excluded.home_runs
             -- ⚠**안타↔실책 판정은 경기 뒤에 바뀐다.** 공식 기록원의 정정은 야구에서 흔하고,
             -- 그때 우리 화면의 안타 수가 조용히 달라진다. revision이 안 오르면
             -- 「어제 본 숫자와 다른데?」에 답할 수 없다(M4). BABIP처럼 안타를 쓰는 지표도 움직인다
             OR game.away_hits IS NOT excluded.away_hits
             OR game.home_hits IS NOT excluded.home_hits
             OR game.away_errors IS NOT excluded.away_errors
             OR game.home_errors IS NOT excluded.home_errors
             -- 구장 정정(지방 개최 변경 등)도 구장별 스플릿을 움직인다
             OR game.venue IS NOT excluded.venue
             -- ⚠구분이 바뀌는 것도 정정이다. 정규시즌이던 경기가 CS로 바뀌면
             -- 그 선수의 시즌 성적이 통째로 달라진다
             OR game.competition IS NOT excluded.competition
           THEN game.revision + 1 ELSE game.revision END`,
    )
    .run(
      g.gameId, g.season, g.gameDate, g.awayCode, g.homeCode, g.gameNo,
      g.status, g.notPlayedReason, g.competition, g.series ?? null, g.sourceUrl, g.fetchedAt,
      g.awayRuns ?? null, g.homeRuns ?? null,
      g.awayHits ?? null, g.homeHits ?? null,
      g.awayErrors ?? null, g.homeErrors ?? null,
      g.venue ?? null,
    );
  return 1;
}

export function upsertBatting(db: Db, r: BattingRow): number {
  db.raw
    .prepare(
      `INSERT INTO batting_line (game_id, player_id, side, batting_order, position,
         pa, ab, h, d2, d3, hr, bb, ibb, hbp, sf, sh, so, roe, runs, rbi, sb)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(game_id, player_id) DO UPDATE SET
         side = excluded.side, batting_order = excluded.batting_order, position = excluded.position,
         pa = excluded.pa, ab = excluded.ab, h = excluded.h, d2 = excluded.d2, d3 = excluded.d3,
         hr = excluded.hr, bb = excluded.bb, ibb = excluded.ibb, hbp = excluded.hbp,
         sf = excluded.sf, sh = excluded.sh, so = excluded.so, roe = excluded.roe,
         runs = excluded.runs, rbi = excluded.rbi, sb = excluded.sb`,
    )
    .run(
      r.gameId, r.playerId, r.side, r.battingOrder, r.position,
      r.pa, r.ab, r.h, r.d2, r.d3, r.hr, r.bb, r.ibb, r.hbp, r.sf, r.sh, r.so, r.roe,
      r.runs, r.rbi, r.sb,
    );
  return 1;
}

export function upsertPitching(db: Db, r: PitchingRow): number {
  db.raw
    .prepare(
      `INSERT INTO pitching_line (game_id, player_id, side, decision, outs, bf, pitches,
         h, hr, bb, hbp, so, runs, er, wp, balk)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(game_id, player_id) DO UPDATE SET
         side = excluded.side, decision = excluded.decision, outs = excluded.outs,
         bf = excluded.bf, pitches = excluded.pitches, h = excluded.h, hr = excluded.hr,
         bb = excluded.bb, hbp = excluded.hbp, so = excluded.so,
         runs = excluded.runs, er = excluded.er,
         wp = excluded.wp, balk = excluded.balk`,
    )
    .run(
      r.gameId, r.playerId, r.side, r.decision, r.outs, r.bf, r.pitches,
      r.h, r.hr, r.bb, r.hbp, r.so, r.runs, r.er, r.wp ?? null, r.balk ?? null,
    );
  return 1;
}

/**
 * 타석 이벤트를 경기 단위로 **교체**한다.
 *
 * ⚠순번(`seq`)이 재파싱으로 바뀔 수 있으므로 upsert가 아니라 삭제 후 삽입이다.
 * 남은 옛 행이 새 행과 섞이면 타석이 중복되고, 그건 상대전적을 조용히 부풀린다.
 */
export function replacePaEvents(db: Db, gameId: string, rows: readonly PaEventRow[]): number {
  db.raw.prepare("DELETE FROM pa_event WHERE game_id = ?").run(gameId);
  const stmt = db.raw.prepare(
    `INSERT INTO pa_event (game_id, seq, inning, half, outs_before, bases,
       batter_id, pitcher_id, outcome, rbi, raw_box, raw_pbp, status, runs_scored, ball_count)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const r of rows) {
    stmt.run(
      r.gameId, r.seq, r.inning, r.half, r.outsBefore, r.bases,
      r.batterId, r.pitcherId, r.outcome, r.rbi, r.rawBox, r.rawPbp, r.status, r.runsScored,
      r.ballCount,
    );
  }
  return rows.length;
}

/** 적재용 주자 사건 1행. 파서의 `RunnerEvent` 에 `gameId`·`seq` 를 붙인 것이다 */
export interface RunnerEventRow {
  gameId: string;
  /** 경기 내 주자 사건 순번(1부터). ⚠타석 순번과 **다른 계열**이다 */
  seq: number;
  inning: number;
  half: "top" | "bottom";
  afterSeq: number;
  outsBefore: number;
  bases: string;
  runnerId: string;
  kind: "steal" | "caughtStealing" | "pickoff";
  base: "1b" | "2b" | "3b" | "home";
  doubleSteal: boolean;
  raw: string;
}

/**
 * 주자 사건(도루·도루자·견제사).
 *
 * ⚠**멱등이다**(M5) — 경기 단위로 지우고 넣는다. 재수집·재적재가 실제로 일어난다.
 * ⚠**미성립 경기는 애초에 여기 오지 않는다.** 파서가 `notPlayed` 를 돌려주기 때문이다 —
 * 실측으로 그 경계가 값을 갈랐다: 2024/0710 c-g-14 는 **우천 노게임**이라 기록이 무효인데
 * 페이지에는 도루 1건이 인쇄되어 있다. 세면 시즌 합계가 838이 아니라 839가 된다.
 */
export function replaceRunnerEvents(db: Db, gameId: string, rows: readonly RunnerEventRow[]): number {
  db.raw.prepare("DELETE FROM runner_event WHERE game_id = ?").run(gameId);
  const stmt = db.raw.prepare(
    `INSERT INTO runner_event (game_id, seq, inning, half, after_seq, outs_before, bases,
       runner_id, kind, base, double_steal, raw)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const r of rows) {
    stmt.run(
      r.gameId, r.seq, r.inning, r.half, r.afterSeq, r.outsBefore, r.bases,
      r.runnerId, r.kind, r.base, r.doubleSteal ? 1 : 0, r.raw,
    );
  }
  return rows.length;
}

/**
 * 격리 기록.
 * ⚠같은 경기를 재적재할 때 중복이 쌓이지 않게 **경기 단위로 먼저 지우고 넣는다.**
 */
export function replaceQuarantine(db: Db, gameId: string, rows: readonly QuarantineRow[], nowIso: string): number {
  db.raw.prepare("DELETE FROM quarantine WHERE game_id = ?").run(gameId);
  const stmt = db.raw.prepare(
    "INSERT INTO quarantine (kind, game_id, player_id, raw, detail, seen_at) VALUES (?, ?, ?, ?, ?, ?)",
  );
  for (const r of rows) stmt.run(r.kind, r.gameId, r.playerId, r.raw, r.detail, nowIso);
  return rows.length;
}
