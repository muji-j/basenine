/**
 * **수집 판정의 증거** — 판정(순수)은 `@bb-app/domain` 의 `collectionVerdict` 가 하고, 여기는 **사실만 모은다.**
 *
 * 설계: `docs/superpowers/specs/2026-09-11-offseason-collection-verdict-design.md` (D1 · D3 · D4 · D10 · D11)
 *
 * ⚠**감시(`scripts/freshness.ts`)와 화면 띠(`packages/web`)가 이 함수 한 벌을 쓴다**(M1). SQL 을 두 곳에 두면 언젠가 갈린다.
 * ⚠**시계를 읽지 않는다**(M6) — 판정일 `today`(JST `YYYY-MM-DD`)는 호출자가 준다(감시 = 실행 시각 · 화면 = `builtOn`).
 * ⚠**유예(감시 2일 · 화면 3일)는 여기서 적용하지 않는다** — 창 `[today − LOOKBACK_DAYS, today]` 의 후보만 준다.
 */
import type { DatabaseSync } from "node:sqlite";
import type { CollectionEvidence, MissedAnnounced, MissedPlayed } from "@bb-app/domain";
import { LOOKBACK_DAYS } from "@bb-app/domain";
import type { Db } from "./db.ts";
import { seasonIsOver } from "./season-over.ts";

function rawOf(src: Db | DatabaseSync): DatabaseSync {
  return "raw" in src ? src.raw : src;
}

export function collectionEvidence(src: Db | DatabaseSync, today: string, lookbackDays: number = LOOKBACK_DAYS): CollectionEvidence {
  const db = rawOf(src);
  const one = <T>(sql: string, ...params: (string | number)[]): T => db.prepare(sql).get(...params) as unknown as T;
  const from = one<{ d: string }>("SELECT DATE(?, ?) AS d", today, `-${lookbackDays} days`).d;

  const latest = one<{ d: string | null; s: number | null }>(
    "SELECT MAX(game_date) AS d, MAX(season) AS s FROM game WHERE status = 'played'",
  );

  /**
   * **A** — 월간 일정이 「치렀다」(점수 링크)고 표시했는데 우리에게 경기 행이 없다.
   * ⚠**경기 단위다** — 같은 날 같은 카드가 둘이면 페이지 순서의 `seq` 로 가르고, 경기 행이 `seq` 개 이하면 그 번째가 없다.
   * ⚠**상태를 가리지 않는다** — 중지(`notPlayed`) 행도 「받았다」다(점수 페이지를 받아 중지로 적재했다).
   */
  const playedWithoutGame = db.prepare(
    `SELECT p.game_date AS date, p.home_code AS homeCode, p.away_code AS awayCode, p.seq AS seq
       FROM schedule_played p
      WHERE p.game_date BETWEEN ? AND ?
        AND (SELECT COUNT(*) FROM game g
              WHERE g.game_date = p.game_date AND g.home_code = p.home_code AND g.away_code = p.away_code) <= p.seq
      ORDER BY p.game_date, p.home_code, p.away_code, p.seq`,
  ).all(from, today) as unknown as MissedPlayed[];

  /**
   * **B** — 예고됐는데 받지 못했고, **그 달 일정 사본이 D 뒤에 한 번도 안 받아졌다**(없음 · 시각 모름 포함).
   * ⚠**사본이 새로우면 쓰지 않는다** — 새 사본이 치러짐 표시를 안 했다면 NPB 가 「안 치렀다」고 한 것이다(예비 경기).
   * ⚠**그날 경기 행이 하나라도 있으면 뺀다** — B 의 전제(사본 낡음)는 그 달 경기 발견이 통째로 멈춘 것이라 「일부만」은 이 경로가 아니다.
   * ⚠**예고보다 늦게 받은 그 날짜의 휴식 공표가 있으면 뺀다**(보조 장치) — 둘 중 하나라도 시각을 모르면 순서를 모르므로 남긴다(M11).
   * ⚠사본 시각은 **JST 달력으로** D 와 비교한다 — `datetime(…, '+9 hours')`.
   */
  const announcedWithoutGame = db.prepare(
    `SELECT pp.game_date AS date, pp.team_code AS teamCode
       FROM probable_pitcher pp
      WHERE pp.game_date BETWEEN ? AND ?
        AND NOT EXISTS (SELECT 1 FROM game g WHERE g.game_date = pp.game_date)
        AND NOT EXISTS (
              SELECT 1 FROM schedule_month m
               WHERE m.season = CAST(substr(pp.game_date, 1, 4) AS INTEGER)
                 AND m.month = CAST(substr(pp.game_date, 6, 2) AS INTEGER)
                 AND m.fetched_at IS NOT NULL
                 AND substr(datetime(m.fetched_at, '+9 hours'), 1, 10) > pp.game_date)
        AND NOT EXISTS (
              SELECT 1 FROM starters_fetch s
               WHERE s.game_date = pp.game_date AND s.no_games = 1
                 AND s.fetched_at IS NOT NULL AND pp.fetched_at IS NOT NULL
                 AND s.fetched_at > pp.fetched_at)
      ORDER BY pp.game_date, pp.team_code`,
  ).all(from, today) as unknown as MissedAnnounced[];

  const startersLatest = one<{ d: string | null }>("SELECT MAX(game_date) AS d FROM probable_pitcher").d;
  /** ⚠**맥박은 경기 유무와 무관하다** — 휴식 공표 페이지도 행을 남긴다(설계 D3). 시각을 모르는 행은 뺀다 */
  const startersPulseDate = one<{ d: string | null }>(
    "SELECT substr(datetime(MAX(fetched_at), '+9 hours'), 1, 10) AS d FROM starters_fetch WHERE fetched_at IS NOT NULL",
  ).d;

  /** 오늘 이후 가장 가까운 경기일과 **그 행의 시즌**(`game` ∪ `upcoming_game`) — ⚠「최신 시즌」이 아니다(설계 D4) */
  const next = one<{ d: string | null; s: number | null } | undefined>(
    `SELECT d, s FROM (
       SELECT game_date AS d, season AS s FROM game WHERE game_date >= ?
       UNION ALL
       SELECT game_date AS d, season AS s FROM upcoming_game WHERE game_date >= ?
     ) ORDER BY d LIMIT 1`,
    today, today,
  );
  const nextGameDay = next?.d ?? null;
  const nextGameRestDeclared = nextGameDay !== null && one<{ n: number }>(
    "SELECT COUNT(*) AS n FROM starters_fetch WHERE game_date = ? AND no_games = 1", nextGameDay,
  ).n > 0;
  const nextGameSeasonOver = next?.s != null && seasonIsOver(db, next.s);

  /**
   * **통산** — ⚠**기존 감시(`scripts/freshness.ts`)의 SQL 을 그대로 옮겼다**(설계 D10 · 규칙을 바꾸지 않는다).
   * 「아직 못 받은 선수 중 가장 오래전에 뛴 사람의 그 경기일」 — 재취득이 멈추면 하루씩 뒤로 밀린다.
   */
  const career = one<{ players: number; stalestPlayed: string | null }>(`
    WITH appearance AS (
      SELECT b.player_id AS id, MAX(g.game_date) AS last
        FROM batting_line b JOIN game g ON g.game_id = b.game_id
       WHERE g.status = 'played' GROUP BY b.player_id
      UNION ALL
      SELECT t.player_id AS id, MAX(g.game_date) AS last
        FROM pitching_line t JOIN game g ON g.game_id = t.game_id
       WHERE g.status = 'played' GROUP BY t.player_id
    ),
    last_seen AS (SELECT id, MAX(last) AS last FROM appearance GROUP BY id),
    fetched AS (
      SELECT player_id AS id,
             MAX(SUBSTR(datetime(fetched_at, '+9 hours'), 1, 10)) AS day
        FROM (SELECT player_id, fetched_at FROM career_batting
              UNION ALL
              SELECT player_id, fetched_at FROM career_pitching)
       GROUP BY player_id
    )
    SELECT COUNT(*) AS players,
           (SELECT MIN(l2.last) FROM last_seen l2
              LEFT JOIN fetched f2 ON f2.id = l2.id
             WHERE (f2.day IS NULL OR f2.day <= l2.last)
               AND l2.last >= (SELECT DATE(MAX(game_date), '-400 days') FROM game WHERE status = 'played')
           ) AS stalestPlayed
      FROM fetched f
      JOIN last_seen l ON l.id = f.id
     WHERE l.last >= (SELECT DATE(MAX(game_date), '-400 days') FROM game WHERE status = 'played')
  `);

  return {
    today,
    latestPlayed: latest.d,
    latestSeasonOver: latest.s !== null && seasonIsOver(db, latest.s),
    playedWithoutGame: playedWithoutGame.map((m) => ({ ...m })),
    announcedWithoutGame: announcedWithoutGame.map((m) => ({ ...m })),
    startersLatest,
    startersPulseDate,
    nextGameDay,
    nextGameRestDeclared,
    nextGameSeasonOver,
    careerPlayers: career.players,
    careerStalestPlayed: career.stalestPlayed,
    latestGameRowDate: one<{ d: string | null }>("SELECT MAX(game_date) AS d FROM game WHERE game_date <= ?", today).d,
    latestPlayedMarkDate: one<{ d: string | null }>("SELECT MAX(game_date) AS d FROM schedule_played WHERE game_date <= ?", today).d,
    nextAnnouncementDate: one<{ d: string | null }>("SELECT MIN(game_date) AS d FROM probable_pitcher WHERE game_date >= ?", today).d,
  };
}
