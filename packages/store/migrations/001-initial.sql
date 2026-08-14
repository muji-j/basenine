-- 001 초기 스키마
--
-- ⚠**Cloudflare D1(SQLite) 호환 SQL만 쓴다.** 로컬 개발은 node:sqlite로 하지만
-- 같은 DDL이 D1에서도 그대로 돌아야 한다. 방언을 쓰지 마라.
--
-- 원칙
--  · 선수는 **NPB 공식 ID**가 정본이다. 이름 문자열로 조인하지 않는다(M10).
--  · 이닝은 **아웃 카운트(정수)**로 저장한다. 6.2를 부동소수로 두지 않는다.
--  · 경기구분·상태 컬럼을 **처음부터** 둔다. 나중에 붙이면 전 쿼리 재작성이다.
--  · 집계는 여기 없다. 전부 원시에서 재계산 가능해야 한다.

CREATE TABLE IF NOT EXISTS player (
  player_id     TEXT PRIMARY KEY,          -- NPB 공식 ID (/bis/players/{id}.html)
  display_name  TEXT NOT NULL,             -- 최신 표기. 시점에 따라 바뀐다 — 조인 키가 아니다
  first_seen_at TEXT NOT NULL,
  last_seen_at  TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS game (
  game_id     TEXT PRIMARY KEY,            -- 2026/0814/s-db-17
  season      INTEGER NOT NULL,
  game_date   TEXT NOT NULL,               -- YYYY-MM-DD (JST 경기일)
  away_code   TEXT NOT NULL,
  home_code   TEXT NOT NULL,
  game_no     INTEGER NOT NULL,
  -- played | notPlayed. 중지 경기는 오류가 아니라 상태다(M11)
  status      TEXT NOT NULL CHECK (status IN ('played', 'notPlayed')),
  not_played_reason TEXT,
  -- regular | climax | japanSeries | preseason. v1은 regular만 넣지만 컬럼은 처음부터 둔다
  competition TEXT NOT NULL DEFAULT 'regular',
  -- M4: 출처 추적성
  source_url  TEXT NOT NULL,
  fetched_at  TEXT NOT NULL,
  revision    INTEGER NOT NULL DEFAULT 1
) STRICT;

CREATE INDEX IF NOT EXISTS game_by_date ON game (season, game_date);

CREATE TABLE IF NOT EXISTS batting_line (
  game_id       TEXT NOT NULL REFERENCES game (game_id),
  player_id     TEXT NOT NULL REFERENCES player (player_id),
  side          TEXT NOT NULL CHECK (side IN ('away', 'home')),
  batting_order TEXT,
  position      TEXT,
  pa   INTEGER NOT NULL,
  ab   INTEGER NOT NULL,
  h    INTEGER NOT NULL,
  d2   INTEGER NOT NULL,   -- 2루타. `double`은 SQL 예약어 충돌을 피해 d2로 둔다
  d3   INTEGER NOT NULL,   -- 3루타
  hr   INTEGER NOT NULL,
  bb   INTEGER NOT NULL,   -- 고의사구 포함
  ibb  INTEGER NOT NULL,
  hbp  INTEGER NOT NULL,
  sf   INTEGER NOT NULL,
  sh   INTEGER NOT NULL,
  so   INTEGER NOT NULL,
  roe  INTEGER NOT NULL,   -- 실책 출루. wOBA 공식 산식이 요구한다
  runs INTEGER NOT NULL,
  rbi  INTEGER NOT NULL,
  sb   INTEGER NOT NULL,
  PRIMARY KEY (game_id, player_id)
) STRICT;

CREATE INDEX IF NOT EXISTS batting_by_player ON batting_line (player_id);

CREATE TABLE IF NOT EXISTS pitching_line (
  game_id   TEXT NOT NULL REFERENCES game (game_id),
  player_id TEXT NOT NULL REFERENCES player (player_id),
  side      TEXT NOT NULL CHECK (side IN ('away', 'home')),
  decision  TEXT,                 -- ○ ● S H 등
  outs      INTEGER NOT NULL,     -- 투구회를 아웃으로. 6.2 → 20
  bf        INTEGER,
  pitches   INTEGER,
  h         INTEGER NOT NULL,
  hr        INTEGER NOT NULL,
  bb        INTEGER NOT NULL,
  hbp       INTEGER NOT NULL,
  so        INTEGER NOT NULL,
  runs      INTEGER NOT NULL,
  er        INTEGER NOT NULL,
  PRIMARY KEY (game_id, player_id)
) STRICT;

CREATE INDEX IF NOT EXISTS pitching_by_player ON pitching_line (player_id);

-- 규칙 밖 값은 **버리지 않고 격리한다**(CLAUDE.md). 나중에 사람이 판단한다.
CREATE TABLE IF NOT EXISTS quarantine (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  kind      TEXT NOT NULL,        -- unknownToken | paMismatch 등
  game_id   TEXT,
  player_id TEXT,
  raw       TEXT NOT NULL,
  detail    TEXT,
  seen_at   TEXT NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS quarantine_by_kind ON quarantine (kind);
