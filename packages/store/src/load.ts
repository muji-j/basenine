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
  sourceUrl: string;
  fetchedAt: string;
}

export interface WriteBudget {
  players: number;
  games: number;
  batting: number;
  pitching: number;
  quarantine: number;
  total: number;
}

export function emptyBudget(): WriteBudget {
  return { players: 0, games: 0, batting: 0, pitching: 0, quarantine: 0, total: 0 };
}

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

export function upsertGame(db: Db, g: GameRow): number {
  db.raw
    .prepare(
      `INSERT INTO game (game_id, season, game_date, away_code, home_code, game_no,
                         status, not_played_reason, competition, source_url, fetched_at, revision)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
       ON CONFLICT(game_id) DO UPDATE SET
         status = excluded.status,
         not_played_reason = excluded.not_played_reason,
         competition = excluded.competition,
         source_url = excluded.source_url,
         fetched_at = excluded.fetched_at,
         -- 내용이 실제로 달라졌을 때만 revision을 올린다. 재적재만으로는 오르지 않는다
         revision = CASE
           WHEN game.status IS NOT excluded.status
             OR game.not_played_reason IS NOT excluded.not_played_reason
           THEN game.revision + 1 ELSE game.revision END`,
    )
    .run(
      g.gameId, g.season, g.gameDate, g.awayCode, g.homeCode, g.gameNo,
      g.status, g.notPlayedReason, g.competition, g.sourceUrl, g.fetchedAt,
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
         h, hr, bb, hbp, so, runs, er)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(game_id, player_id) DO UPDATE SET
         side = excluded.side, decision = excluded.decision, outs = excluded.outs,
         bf = excluded.bf, pitches = excluded.pitches, h = excluded.h, hr = excluded.hr,
         bb = excluded.bb, hbp = excluded.hbp, so = excluded.so,
         runs = excluded.runs, er = excluded.er`,
    )
    .run(
      r.gameId, r.playerId, r.side, r.decision, r.outs, r.bf, r.pitches,
      r.h, r.hr, r.bb, r.hbp, r.so, r.runs, r.er,
    );
  return 1;
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
