-- 앞으로의 경기(일정).
--
-- ⚠**`game` 표에 넣지 않는다.** 두 가지 이유가 있고, 둘 다 조용한 사고로 이어진다:
--   ⑴ `game.game_id` 는 슬러그(`2026/0814/s-db-17`)가 PK 인데 **미래 경기에는 슬러그가 없다.**
--      npb.jp 가 경기 후에 붙인다. 가짜 id 를 만들면 실제 경기가 들어올 때 중복이 된다.
--   ⑵ `status` 가 `played|notPlayed` 로 CHECK 돼 있다. 세 번째 값을 넣으면
--      **기존 집계가 보는 것이 조용히 바뀐다** — 지금 수십 개 질의가 이 표를 세고 있다.
-- → 별도 표로 두면 `game` 은 계속 「치러졌거나 중지된 경기」만 뜻한다.
--
-- ⚠**이 표는 파생이다.** 매 적재마다 시즌 단위로 지우고 다시 넣는다(멱등 · M5).
--   월간 일정 페이지가 유일한 출처이고, 경기가 치러지면 그 페이지에 점수 링크가 붙어
--   **자동으로 이 표에서 빠진다** — 손으로 지울 일이 없다.
--
-- ⚠**더블헤더를 감당한다**(§2-1). 같은 날 같은 카드가 두 번 있을 수 있으므로
--   `seq`(그 날 표에서 몇 번째 행이었나)까지 키에 넣는다. 지금 NPB 정규시즌에는 없지만,
--   식별자가 감당하지 못하면 나중에 **한 경기가 조용히 사라진다.**

CREATE TABLE IF NOT EXISTS upcoming_game (
  season     INTEGER NOT NULL,
  -- YYYY-MM-DD (JST). ⚠일정 표에는 `8/18（火）` 라고만 있다 — 연도는 수집기가 붙인다
  game_date  TEXT NOT NULL,
  home_code  TEXT NOT NULL,
  away_code  TEXT NOT NULL,
  -- 그 날 표에서 몇 번째 행이었나. 더블헤더 구별용
  seq        INTEGER NOT NULL,
  -- `横浜` 등. 미정이면 빈 문자열
  venue      TEXT NOT NULL,
  -- `18:00`. ⚠**미정이면 NULL 이다. 0시가 아니다**(M11)
  start_time TEXT,
  -- M4: 어디서 언제 왔는가. ⚠`fetched_at` 은 **적재 시각이 아니라 취득 시각**이다
  source     TEXT NOT NULL,
  fetched_at TEXT,
  PRIMARY KEY (game_date, home_code, away_code, seq)
) STRICT;

-- 「이 날 누가 뛰나」와 「이 팀 다음 경기가 언제인가」 둘 다 자주 묻는다
CREATE INDEX IF NOT EXISTS upcoming_by_date ON upcoming_game (game_date);
CREATE INDEX IF NOT EXISTS upcoming_by_home ON upcoming_game (home_code, game_date);
CREATE INDEX IF NOT EXISTS upcoming_by_away ON upcoming_game (away_code, game_date);
