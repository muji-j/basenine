-- 취득 시각을 **모를 수 있게** 한다.
--
-- ⚠**「모른다」와 「오늘」은 다르다**(M11). `fetched_at` 이 `NOT NULL` 이라
--   사이드카(`*.meta.json`)를 읽지 못한 선수에게 **적재 시각을 넣을 수밖에** 없었다.
--   그러면 이 커밋이 고치려던 사고가 그 경로에 그대로 재발한다:
--     · 화면이 그 날짜를 「진짜 취득일」로 말한다
--     · 재취득 선정이 `fetched_at` 을 「가장 신선함」으로 읽어 **그 선수를 영영 다시 안 받는다**
--       (적재 시각은 어떤 경기일보다도 늦으므로 `fetched_at < 마지막 출장일` 이 영원히 거짓이다)
--   실제로 8월 15일에 받은 페이지가 매일 「오늘 받은 것」이 되어 있었고, 그것을 눈치채지 못해
--   **「NPB 가 늦다」고 오진**했다(2026-08-17).
--
-- ⚠**SQLite 는 `NOT NULL` 을 ALTER 로 못 푼다** — 표를 다시 만든다.
--   두 표는 **매 적재마다 선수 단위로 DELETE 후 재삽입**되는 파생 데이터라 재구축이 안전하다.
--   그래도 값은 옮긴다(다음 적재 전까지 화면이 비지 않게).
-- ⚠`STRICT` 와 `PRIMARY KEY`·인덱스를 **원본 그대로** 유지한다. 하나라도 빠뜨리면 조용히 느려지거나
--   중복이 들어온다.

ALTER TABLE career_batting RENAME TO career_batting_old;
ALTER TABLE career_pitching RENAME TO career_pitching_old;

CREATE TABLE career_batting (
  player_id TEXT NOT NULL,
  year      INTEGER NOT NULL,
  team      TEXT NOT NULL,
  games INTEGER NOT NULL, pa INTEGER NOT NULL, ab INTEGER NOT NULL,
  runs INTEGER NOT NULL, h INTEGER NOT NULL, d2 INTEGER NOT NULL, d3 INTEGER NOT NULL,
  hr INTEGER NOT NULL, tb INTEGER NOT NULL, rbi INTEGER NOT NULL,
  -- ⚠**盗塁刺는 박스스코어에 없다.** 이 표가 유일한 공표 출처다(CLAUDE.md §2-2)
  sb INTEGER NOT NULL, cs INTEGER NOT NULL,
  sh INTEGER NOT NULL, sf INTEGER NOT NULL, bb INTEGER NOT NULL, hbp INTEGER NOT NULL,
  so INTEGER NOT NULL, gidp INTEGER NOT NULL,
  -- M4: 이 줄이 어디서 언제 왔는가
  source TEXT NOT NULL,
  -- ⚠**NULL = 「언제 받았는지 모른다」.** 적재 시각으로 메우지 마라
  fetched_at TEXT,
  seq INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (player_id, year, team)
) STRICT;

CREATE TABLE career_pitching (
  player_id TEXT NOT NULL,
  year      INTEGER NOT NULL,
  team      TEXT NOT NULL,
  games INTEGER NOT NULL, w INTEGER NOT NULL, l INTEGER NOT NULL, sv INTEGER NOT NULL,
  hld INTEGER NOT NULL, hp INTEGER NOT NULL, cg INTEGER NOT NULL, sho INTEGER NOT NULL,
  nbb INTEGER NOT NULL, bf INTEGER NOT NULL,
  -- ⚠**아웃 카운트다.** 표에는 `28.2` 로 나오고 그것은 86아웃이다
  outs INTEGER NOT NULL,
  h INTEGER NOT NULL, hr INTEGER NOT NULL, bb INTEGER NOT NULL, hbp INTEGER NOT NULL,
  so INTEGER NOT NULL, wp INTEGER NOT NULL, balk INTEGER NOT NULL,
  runs INTEGER NOT NULL, er INTEGER NOT NULL,
  source TEXT NOT NULL,
  fetched_at TEXT,
  seq INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (player_id, year, team)
) STRICT;

INSERT INTO career_batting
  (player_id, year, team, games, pa, ab, runs, h, d2, d3, hr, tb, rbi,
   sb, cs, sh, sf, bb, hbp, so, gidp, source, fetched_at, seq)
SELECT player_id, year, team, games, pa, ab, runs, h, d2, d3, hr, tb, rbi,
       sb, cs, sh, sf, bb, hbp, so, gidp, source, fetched_at, seq
  FROM career_batting_old;

INSERT INTO career_pitching
  (player_id, year, team, games, w, l, sv, hld, hp, cg, sho, nbb, bf, outs,
   h, hr, bb, hbp, so, wp, balk, runs, er, source, fetched_at, seq)
SELECT player_id, year, team, games, w, l, sv, hld, hp, cg, sho, nbb, bf, outs,
       h, hr, bb, hbp, so, wp, balk, runs, er, source, fetched_at, seq
  FROM career_pitching_old;

DROP TABLE career_batting_old;
DROP TABLE career_pitching_old;

CREATE INDEX IF NOT EXISTS career_batting_by_player ON career_batting (player_id, year);
CREATE INDEX IF NOT EXISTS career_pitching_by_player ON career_pitching (player_id, year);
