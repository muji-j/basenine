-- 005 予告先発(선발 예고)
--
-- 경기 **전에** 공표되는 유일한 라인업 정보다. 이것 하나로 「오늘의 매치업」 화면이 성립한다.
--
-- ⚠**라이브가 아니다.** 전날~당일에 공표되는 확정 정보이고, 경기 중에는 갱신하지 않는다.
-- 라이브 취득을 하지 않는 이유는 docs/decisions/2026-08-15-live-matchup-feasibility.md.
--
-- ⚠**예고는 바뀐다.** 우천 순연·등판 변경이 실재하므로 갱신이 멱등이어야 하고(M5),
-- 바뀐 사실은 revision으로 남는다(M4).
-- ⚠**미발표(NULL)와 「투수 없음」을 구별한다**(M11). 6경기 중 2경기만 발표된 상태가 정상이다.

CREATE TABLE IF NOT EXISTS probable_pitcher (
  -- YYYY-MM-DD (JST). 페이지에는 月日만 있어 연도는 수집기가 붙인다
  game_date     TEXT NOT NULL,
  team_code     TEXT NOT NULL,
  -- 같은 날 같은 카드의 상대. 경기 식별자가 아직 없으므로(경기 전) 이걸로 짝을 만든다
  opponent_code TEXT NOT NULL,
  -- 미발표면 NULL. 페이지에 /bis/players/{id} 링크가 있어 **이름으로 조인하지 않는다**(M10)
  player_id     TEXT REFERENCES player (player_id),
  -- 예고 페이지의 표기(`柳　裕也`). 박스스코어 표기(`柳`)와 다르다 —
  -- 화면에는 player.display_name을 쓰고 이것은 대조·추적용으로만 둔다
  source_name   TEXT,
  venue         TEXT,
  start_time    TEXT,
  league        TEXT NOT NULL,
  -- M4: 출처 추적성
  source_url    TEXT NOT NULL,
  fetched_at    TEXT NOT NULL,
  revision      INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (game_date, team_code)
) STRICT;

CREATE INDEX IF NOT EXISTS probable_by_date ON probable_pitcher (game_date);
