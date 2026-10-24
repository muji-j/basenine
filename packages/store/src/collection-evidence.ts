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
import { CAREER_RECEIVED_CTES } from "./career-received.ts";
import type { Db } from "./db.ts";
import { REFETCH_WINDOW_CTES } from "./refetch-window.ts";
import { seasonIsOver } from "./season-over.ts";

function rawOf(src: Db | DatabaseSync): DatabaseSync {
  return "raw" in src ? src.raw : src;
}

/**
 * 판정에 쓰는 증거 + **보고에만 쓰는** 통산 취득일 요약.
 * ⚠**요약도 판정과 같은 「최근 출장자」 범위다**(2026-09-11 · 3중 검토 1차 F4 · 2차 N2). 재배선하면서 요약만 범위 없는 별도 쿼리로
 * 떼어 냈더니 콘솔은 「최근 출장자」라고 적는데 JSONL 은 전원을 셌다 — 같은 SQL 한 벌에서 함께 나오게 되돌렸다(옛 감시와 같다).
 * ⚠도메인 판정 타입(`CollectionEvidence`)에 넣지 않는다 — 판정이 안 쓰는 값이다.
 */
export interface CollectionEvidenceReport extends CollectionEvidence {
  /** 최근 출장자 중 통산 취득 시각을 모르는 선수 */
  careerUnknown: number;
  /** 최근 출장자의 통산 취득일(JST) 중 가장 오래된 날 */
  careerOldest: string | null;
  careerNewest: string | null;
}

export function collectionEvidence(src: Db | DatabaseSync, today: string, lookbackDays: number = LOOKBACK_DAYS): CollectionEvidenceReport {
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
   * ⚠**올스타도 든다**(2026-10-24 · PR-2b 검토 P2-2) — 적재기가 치러진 올스타 행을 리그 선발 코드(`cl`·`pl`)로 남기고, 경기 행도 같은 코드를 쓴다.
   * ⚠**따라잡기의 owed ⒜(잎 `schedule-owed.ts`)가 같은 식을 따로 적는다**(잎은 import 0) — `schedule-owed.test.ts` 의 P3-3 이 두 벌의 날 집합을 대조한다
   *   (이쪽은 오늘까지 · 저쪽은 어제까지 — 의도된 차이).
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
   * **통산** — 「아직 못 받은 선수 중 가장 오래전에 뛴 사람의 그 경기일」 — 재취득이 멈추면 하루씩 뒤로 밀린다.
   * ⚠~~기존 감시의 SQL 을 그대로 옮겼다(설계 D10 · 규칙을 바꾸지 않는다)~~ 는 2026-10-24 부로 낡았다 — **「받았다」가 바뀌었다**:
   *   통산 행이 없고 **정규시즌 출장도 없으면** 프로필 취득 시각으로 받은 것이다(`career-received.ts` · 사용자 결정 A). 통산 행이 0 인
   *   CS 출장자가 **영원히 못 받은 선수**로 남아 `career-lag` 이 10-20 부터 수집 잡을 매일 실패시켰다.
   *   ⚠정규시즌에 나왔는데 통산 행이 0 이면 여전히 「못 받음」이다 — 데뷔 직후 늦은 사본이라 울어야 한다(이중 검토 P2).
   * ⚠**「받았다」와 창(마지막 출장일 · 400일 선)은 재취득 선정기와 한 벌이다**(M1 · `career-received.ts` · `refetch-window.ts`) —
   *   예전에는 둘 다 이 자리에 사본이 있었고, 그래서 **감시와 선정이 같이 틀렸다**(선정기는 그를 매 실행 다시 받았다).
   * ⚠**요약(대상 수 · 취득일 범위 · 모름)은 여전히 「통산 기록」의 것이다**(`career_fetched`) — 통산 행이 없는 선수는 대상 수에 안 든다.
   *   대상이 0 이면 판정이 꺼지는 규칙(통산을 아직 적재하지 않은 DB)도 그대로다.
   */
  const career = one<{ players: number; unknown: number | null; oldest: string | null; newest: string | null; stalestPlayed: string | null }>(`
    WITH ${REFETCH_WINDOW_CTES},
    ${CAREER_RECEIVED_CTES}
    SELECT COUNT(*) AS players,
           SUM(f.day IS NULL) AS unknown,
           MIN(f.day) AS oldest,
           MAX(f.day) AS newest,
           (SELECT MIN(l2.last) FROM last_seen l2
              LEFT JOIN career_received r ON r.id = l2.id
             WHERE (r.day IS NULL OR r.day <= l2.last)
               AND l2.last >= (SELECT d FROM cutoff)
           ) AS stalestPlayed
      FROM career_fetched f
      JOIN last_seen l ON l.id = f.id
     WHERE l.last >= (SELECT d FROM cutoff)
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
    careerUnknown: career.unknown ?? 0,
    careerOldest: career.oldest,
    careerNewest: career.newest,
    latestGameRowDate: one<{ d: string | null }>("SELECT MAX(game_date) AS d FROM game WHERE game_date <= ?", today).d,
    latestPlayedMarkDate: one<{ d: string | null }>("SELECT MAX(game_date) AS d FROM schedule_played WHERE game_date <= ?", today).d,
    nextAnnouncementDate: one<{ d: string | null }>("SELECT MIN(game_date) AS d FROM probable_pitcher WHERE game_date >= ?", today).d,
  };
}
