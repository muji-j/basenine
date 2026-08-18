-- 017 予告先発의 취득 시각을 **모를 수 있게** 한다.
--
-- ⚠**014 가 통산 기록에 한 것을 予告先発에는 안 했다**(2026-08-18 다방면 감사 P1).
--   `load-starters.ts` 가 `fetched_at` 에 **적재 시각**을 넣고 있었다. 적재는 매일 돌고
--   아카이브 전체를 매번 다시 훑으므로, 8월 15일에 받은 페이지가 **매일 「오늘 받은 것」**이 된다.
--   그 결과 `scripts/freshness.ts` 의 「予告先発 수집이 멈췄다」 검사가 `MAX(fetched_at)` 을 보는데
--   그 값이 항상 오늘이라 **한 번도 발화할 수 없었다** — 감시가 구조적으로 죽어 있었다.
--
--   ⚠하필 이 자료가 **거르면 영영 못 받는 것**이다(페이지가 하루치만 게시된다).
--   손실이 나도 알아챌 장치가 없다는 뜻이라, 데이터 손실보다 이쪽이 더 나쁘다.
--
-- ⚠**「모른다」를 「오늘」로 바꾸지 않는다**(M11). 사이드카를 못 읽으면 NULL 이다.
--   그래서 `NOT NULL` 을 푼다 — 014 와 같은 이유, 같은 처방이다.
--
-- ⚠**SQLite 는 `NOT NULL` 을 ALTER 로 못 푼다** — 표를 다시 만든다.
--   이 표는 매 적재마다 아카이브 전체에서 재구성되는 파생 데이터라 재구축이 안전하다.
--   그래도 값은 옮긴다(다음 적재 전까지 화면이 비지 않게).
-- ⚠`STRICT`·`PRIMARY KEY`·인덱스·외래키를 **원본 그대로** 유지한다.
--   하나라도 빠뜨리면 조용히 중복이 들어오거나 느려진다.

ALTER TABLE probable_pitcher RENAME TO probable_pitcher_old;

CREATE TABLE probable_pitcher (
  game_date     TEXT NOT NULL,
  team_code     TEXT NOT NULL,
  opponent_code TEXT NOT NULL,
  player_id     TEXT REFERENCES player (player_id),
  source_name   TEXT,
  venue         TEXT,
  start_time    TEXT,
  league        TEXT NOT NULL,
  source_url    TEXT NOT NULL,
  -- ⚠**NULL 이 「취득 시각을 모른다」다.** 적재 시각으로 메우지 마라(위 사유).
  fetched_at    TEXT,
  revision      INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (game_date, team_code)
) STRICT;

INSERT INTO probable_pitcher
  (game_date, team_code, opponent_code, player_id, source_name, venue, start_time,
   league, source_url, fetched_at, revision)
SELECT game_date, team_code, opponent_code, player_id, source_name, venue, start_time,
       league, source_url, fetched_at, revision
FROM probable_pitcher_old;

DROP TABLE probable_pitcher_old;

CREATE INDEX IF NOT EXISTS probable_by_date ON probable_pitcher (game_date);
