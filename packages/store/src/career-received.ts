/**
 * **통산을 「받았다」의 정의** — 신선도 감시(`collection-evidence.ts` 의 `career-lag`)와 재취득 선정
 * (`tools/emit-stale-player-ids.ts`)가 **이 한 벌**을 쓴다(M1 · 2026-10-24).
 *
 * ## 무엇이 바뀌었나 — 정규시즌 출장이 없어 통산 표가 없는 페이지
 *
 * 「받았다」는 통산 행(`career_batting` ∪ `career_pitching`)의 `fetched_at` 이었다. 그런데 年度別成績 표는 **정규시즌만** 싣는다 —
 * 1군 출장이 포스트시즌뿐인 선수는 페이지를 받아도 **통산 행이 0** 이라 「받았다」가 영원히 NULL 이었다.
 * 첫 실물: 2026 CS ファイナル 3차전(2026-10-16)에 **대주자(走指 · 0타석)로 한 번** 나온 포수 61665152
 * (보유 선수 페이지 1,651장 중 통산 행 0 은 그 1장) — 감시는 `career-lag` 으로 수집 잡을 10-20 부터 매일 실패시켰고(배포 차단),
 * 선정기는 그를 「취득기록 없음」으로 매 실행 다시 받았다.
 * ⚠**둘이 같은 SQL 사본을 갖고 있어서 같이 틀렸다** — 그래서 이제 한 곳이다.
 * → **통산 행이 없고 정규시즌 출장도 없으면 프로필 취득 시각**(`player.profile_fetched_at`)을 쓴다. 같은 페이지를 받은 같은 시각이다
 *   (선수 적재가 판정 시각 한 값을 프로필과 통산에 함께 쓴다 · 감사 C7 · `tools/load-players.ts`).
 *
 * ## ⚠⚠정규시즌에 나왔는데 통산 행이 0 이면 대체하지 않는다 — 데뷔 직후 늦은 사본이다 (이중 검토 P2 · 2026-10-24)
 *
 * 첫 판은 「통산 행 0」 전원에 대체를 걸었다. 그러면 **정규시즌 데뷔전 다음날 받은 사본**(npb.jp 는 경기 다음날에도 그 경기를 아직 안
 * 싣는다 — 실측 08-19 01:05 JST 사본이 08-18 경기를 안 담았다)이 「출장 뒤에 받았다」로 읽혀 **그 데뷔가 영영 안 실리고 경보도 꺼진다.**
 * 그 선수는 통산 행이 없어 선정기의 출장량 대조(`lagging`)도 한 번도 안 돈다 — 날짜 판정이 유일한 그물이었다.
 * → 대체는 **치러진 정규시즌 출장(타격·투구 · 타석 0 인 대주자도 출장이다)이 0 인 선수**에게만 건다. 경계는 선정기의 출장량 대조
 *   (`ours_bat`·`ours_pit`: `status = 'played' AND competition = 'regular'`)와 같다. 정규시즌에 나왔는데 통산 행이 0 이면 「모름」(NULL)이다 —
 *   예전과 같이 「취득기록 없음」으로 다시 받고, 사본이 그 경기를 실으면 통산 행이 생겨 풀린다.
 * ⚠**보유 시즌 전부의 정규 출장을 본다** — 통산 행이 0 인데 어느 해든 정규 출장이 있으면 그 페이지는 통산 표를 실어야 한다.
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
 * ⚠정규 출장 확인은 **통산 행이 없는 선수에게만** 돈다(대부분은 통산 행이 있다) · `batting_by_player` · `pitching_by_player` 색인을 탄다.
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
    SELECT p.player_id AS id,
           CASE WHEN EXISTS (SELECT 1 FROM batting_line b JOIN game g ON g.game_id = b.game_id
                              WHERE b.player_id = p.player_id AND g.status = 'played' AND g.competition = 'regular')
                  OR EXISTS (SELECT 1 FROM pitching_line t JOIN game g ON g.game_id = t.game_id
                              WHERE t.player_id = p.player_id AND g.status = 'played' AND g.competition = 'regular')
                THEN NULL
                ELSE SUBSTR(datetime(p.profile_fetched_at, '+9 hours'), 1, 10) END AS day
      FROM player p
     WHERE NOT EXISTS (SELECT 1 FROM career_fetched c WHERE c.id = p.player_id)
  )`;
