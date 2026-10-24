/**
 * **통산을 「받았다」의 정의** — 신선도 감시(`collection-evidence.ts` 의 `career-lag`)와 재취득 선정
 * (`tools/emit-stale-player-ids.ts`)가 **이 한 벌**을 쓴다(M1 · 2026-10-24).
 *
 * ## 무엇이 바뀌었나 — 통산 표가 없는 페이지
 *
 * 「받았다」는 통산 행(`career_batting` ∪ `career_pitching`)의 `fetched_at` 이었다. 그런데 年度別成績 표는 **정규시즌만** 싣는다 —
 * 1군 출장이 포스트시즌뿐인 선수는 페이지를 받아도 **통산 행이 0** 이라 「받았다」가 영원히 NULL 이었다.
 * 첫 실물: 2026 CS ファイナル 3차전(2026-10-16)에만 나온 투수 한 명(보유 선수 페이지 1,651장 중 통산 행 0 은 그 1장) —
 * 감시는 `career-lag` 으로 수집 잡을 10-20 부터 매일 실패시켰고(배포 차단), 선정기는 그를 「취득기록 없음」으로 매 실행 다시 받았다.
 * ⚠**둘이 같은 SQL 사본을 갖고 있어서 같이 틀렸다** — 그래서 이제 한 곳이다.
 * → **통산 행이 없으면 프로필 취득 시각**(`player.profile_fetched_at`)을 쓴다. 같은 페이지를 받은 같은 시각이다
 *   (선수 적재가 판정 시각 한 값을 프로필과 통산에 함께 쓴다 · 감사 C7 · `tools/load-players.ts`).
 *
 * ## ⚠「통산 행이 있는데 시각을 모른다」는 그대로 모른다(M11)
 *
 * 사용자 결정은 `COALESCE(통산 행 취득일, 프로필 취득일)` 이다. 여기서는 그것을 **통산 행이 아예 없을 때만** 프로필로 넘어가는 뜻으로 쓴다 —
 * 통산 행이 있는데 시각이 NULL 이면 「모름」을 프로필 시각으로 메우지 않는다. 두 시각은 적재가 한 값으로 쓰므로 보통 같고
 * (실측 CI 사본 2026-10-24: 1,651명 중 갈리는 선수 **0명**), 갈리는 것은 통산만 실패한(C8 · 프로필은 새 판 · 통산은 옛 판으로 남는다)
 * 뒤뿐이다 — 그때 프로필 시각을 빌리면 **옛 통산을 「받았다」고 거짓말한다.** 「모른다」를 「최신」으로 읽지 않는 것은
 * 선정기가 처음부터 지켜 온 원칙이다(`test/stale-players.test.ts` 첫 시험).
 *
 * ## 시각을 날짜로 바꾸는 법
 *
 * JST 로 맞춘다(§2-1) — `fetched_at` 은 ISO UTC 이고 출장일(`game_date`)은 JST 경기일이다. 그냥 앞 10글자를 자르면
 * JST 00:00~08:59 에 받은 페이지가 하루 이르게 기록된다. `fetched_at` 이 NULL 이면 `datetime()` 도 NULL 이다 — 「모름」이 그대로 흐른다(M11).
 *
 * ⚠**자리표시자(`?`)가 없다** — 선정기는 `json_each(?)` 자리 수로 인자를 센다(`archiveArgs`). 여기 `?` 가 생기면 인자가 어긋난다
 *   (`stale-players.test.ts` 가 지킨다).
 */

/**
 * CTE 조각 — `career_fetched`(통산 행이 있는 선수의 통산 취득일) · `career_received`(「받았다」 · 위 규칙).
 * `WITH` 뒤에 그대로 이어 쓴다(다른 조각과 `,` 로 잇는다). 둘 다 `id` · `day`(JST `YYYY-MM-DD` 또는 NULL = 모름) 열을 낸다.
 * ⚠`career_received` 는 **통산 행이 있는 선수 ∪ 선수 표의 선수**다 — 어디에도 없는 선수(출장만 있다)는 조인에서 NULL(= 못 받음)이 된다.
 * ⚠**`career_fetched` 와 `career_received` 를 섞어 쓰지 마라** — 앞의 것은 「통산 기록의 취득일」(감시의 보고 요약)이고
 *   뒤의 것이 「이 선수를 받았나」(판정 · 선정)다.
 */
export const CAREER_RECEIVED_CTES = `
  career_fetched AS (
    SELECT player_id AS id, MAX(SUBSTR(datetime(fetched_at, '+9 hours'), 1, 10)) AS day
      FROM (SELECT player_id, fetched_at FROM career_batting
            UNION ALL
            SELECT player_id, fetched_at FROM career_pitching)
     GROUP BY player_id
  ),
  career_received AS (
    SELECT c.id AS id, c.day AS day FROM career_fetched c
    UNION ALL
    SELECT p.player_id AS id, SUBSTR(datetime(p.profile_fetched_at, '+9 hours'), 1, 10) AS day
      FROM player p
     WHERE NOT EXISTS (SELECT 1 FROM career_fetched c WHERE c.id = p.player_id)
  )`;
