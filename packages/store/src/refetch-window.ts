/**
 * **재취득 선정의 창** — 재취득 선정기(`tools/emit-stale-player-ids.ts`)가 **뽑을 수 있는** 선수의 정의
 * (2026-09-27 · 3중 검토 2차 m1 · 설계 `docs/superpowers/specs/2026-09-27-profile-version-guard-design.md` §5-4).
 *
 * 출장 기록이 있고(치러진 경기 · 대회 무관) 마지막 출장일이 **(가진 마지막 경기일 − 400일) 이후**인 선수다.
 * 이 창 밖의 선수는 선정기가 **어떤 사유로도** 뽑지 않는다 — 받을 수 없는 선수(NPB 를 떠났다)가 매일 몫의 앞자리를 먹지 않게 하는 선이다.
 *
 * ⚠**선정기와 선수 적재기가 같이 쓴다(M1).** 적재기는 옛 판으로 건너뛴 선수를 「재취득 대상」과 「선정 밖이라 못 고침」으로
 *   가르는데, 두 벌이면 적재기가 「재취득 대상(할 일 없음)」이라 부른 선수를 선정기가 **영영 안 뽑는다** — 경고가 매 실행 남는데
 *   「같은 실행이 푼다」로 읽힌다(2차 m1 이 짚은 모양).
 * ⚠**같은 규칙의 사본이 하나 더 있다** — 신선도 감시의 통산 증거(`collection-evidence.ts` · 설계 D10 이 「기존 SQL 을 그대로 옮겼다」).
 *   이 모듈은 그 사본을 건드리지 않았다(감시 규칙은 별도 작업). **400 을 바꾸면 그쪽도 같이 봐라.**
 */
import type { Db } from "./db.ts";

/** 창의 폭(일) — 가진 마지막 경기일에서 센다(벽시계가 아니라 데이터 기준 · M6) */
export const REFETCH_WINDOW_DAYS = 400;

/**
 * 창의 CTE 조각 — `appearance` · `last_seen` · `cutoff`. `WITH` 뒤에 그대로 이어 쓴다(뒤에 다른 CTE 를 붙이려면 `,` 로 잇는다).
 * ⚠**자리표시자(`?`)가 없다** — 선정기는 `json_each(?)` 자리 수로 인자를 센다(`archiveArgs`). 여기 `?` 가 생기면 인자가 어긋난다
 *   (`stale-players.test.ts` 3-16 이 지킨다).
 */
export const REFETCH_WINDOW_CTES = `
  /**
   * ⚠**「마지막 출장일」은 대회를 가리지 않는다** — 올스타·포스트시즌에 나와도 선수 페이지는
   * 갱신될 수 있고, 여기서 고르는 것은 「집계 대상」이 아니라 「다시 받을 대상」이다.
   */
  appearance AS (
    SELECT b.player_id AS id, MAX(g.game_date) AS last
      FROM batting_line b JOIN game g ON g.game_id = b.game_id
     WHERE g.status = 'played'
     GROUP BY b.player_id
    UNION ALL
    SELECT t.player_id AS id, MAX(g.game_date) AS last
      FROM pitching_line t JOIN game g ON g.game_id = t.game_id
     WHERE g.status = 'played'
     GROUP BY t.player_id
  ),
  last_seen AS (SELECT id, MAX(last) AS last FROM appearance GROUP BY id),
  /**
   * 「받을 수 없는 선수」를 가르는 선.
   *
   * ⚠**이 조건이 없으면 그들이 매일 몫의 앞자리를 먹는다**(2026-08-17 재검토 P1).
   * 선수 페이지는 **현재 등록 선수만** 확실히 받을 수 있으므로 NPB 를 떠난 선수는 받아도 안 온다.
   * 소급 시즌을 넣을수록 이 무리가 시즌당 100~160명씩 늘어 상한을 통째로 잠식한다
   * (실측 CI DB: **810명** · 마지막 출장 2018:101 · 2019:113 · 2020:96 · 2021:104 · 2022:132 ·
   *  2023:113 · 2024:121 · 2025:30).
   * ⚠**그건 백필의 일이지 「신선도 유지」의 일이 아니다.** 선정기는 빼고, 몇 명 뺐는지 보고에 낸다.
   * ⚠**벽시계가 아니라 데이터 기준이다**(M6) — 우리가 가진 마지막 경기일에서 센다.
   */
  cutoff AS (SELECT DATE(MAX(game_date), '-${REFETCH_WINDOW_DAYS} days') AS d FROM game WHERE status = 'played')`;

/**
 * 창 안의 선수 ID. ⚠출장 기록이 **아예 없는** 선수는 `last_seen` 에 없으므로 창 밖이다(선정기도 `JOIN last_seen` 으로 뺀다).
 * ⚠경기가 하나도 없으면 `cutoff` 가 NULL 이라 **아무도** 창 안이 아니다 — 선정기도 그날 아무도 안 뽑는다(같은 규칙).
 * ⚠**비싸다** — 타격·투구 줄 전부(CI 사본 214,404 + 64,108행)를 선수별로 접는다. 실측(2026-09-27 · CI DB 사본 · 선수 1,644 · 창 안 820):
 *   중앙 약 7.1~7.4초(기계 부하는 통제하지 않았다 — 같은 조각이 1.4~4.7초로 흔들렸다). 선정기도 같은 조각을 돈다.
 *   그래서 적재기는 **옛 판이 있을 때만** 부른다.
 */
export function playersInRefetchWindow(db: Db): Set<string> {
  const rows = db.raw
    .prepare(`WITH ${REFETCH_WINDOW_CTES}
      SELECT l.id AS id FROM last_seen l WHERE l.last >= (SELECT d FROM cutoff)`)
    .all() as unknown as { id: string }[];
  return new Set(rows.map((r) => r.id));
}
