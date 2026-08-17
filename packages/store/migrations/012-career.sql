-- 선수 페이지의 **年度別成績**.
--
-- ⚠**출처가 우리 경기 데이터와 다르다**(M4). 여기 있는 것은 **NPB 공표치**이고,
--   `batting_line`/`pitching_line` 은 우리가 박스스코어에서 쌓은 값이다.
--   **같은 열에 섞지 마라** — 「어디서 온 숫자인가」에 답할 수 없게 된다.
--   그래서 테이블을 따로 둔다. 화면도 「出典: 選手ページ」라고 적는다.
--
-- ⚠**「通算」 합계 행은 저장하지 않는다.** NPB 도 합계 행을 싣지만(`<tfoot>` 의 `通　算`, 실측 980/980)
-- 그것은 **대조에만** 쓰고, 표시는 우리가 더한 값으로 한다. (예전 주석의 「0/980」은 틀린 판정이었다.)
--   통산은 **우리가 더한다** — 남의 계산값을 빌리는 것이 아니다.
--   합계를 저장해 두면 연도별과 어긋날 날이 온다.
--
-- ⚠**한 해에 여러 줄이 될 수 있다**(시즌 도중 이적). 그래서 키가 (선수, 연도, 구단)이다.
--   「몇 시즌 뛰었나」를 셀 때는 연도로 묶어야 한다.
--
-- ⚠**구단은 원문 그대로** 둔다(`福岡ソフトバンク`). 코드로 바꾸면 옛 구단명이 사라진다.

CREATE TABLE IF NOT EXISTS career_batting (
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
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (player_id, year, team)
) STRICT;

CREATE TABLE IF NOT EXISTS career_pitching (
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
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (player_id, year, team)
) STRICT;

CREATE INDEX IF NOT EXISTS career_batting_by_player ON career_batting (player_id, year);
CREATE INDEX IF NOT EXISTS career_pitching_by_player ON career_pitching (player_id, year);
