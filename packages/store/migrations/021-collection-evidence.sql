-- 021 수집 판정 증거 — 오프시즌·휴식기에 수집 잡이 헛실패하지 않게
--
-- 설계: docs/superpowers/specs/2026-09-11-offseason-collection-verdict-design.md (D3 · D5)
--
-- ⚠**판정을 「최신 경기가 며칠 전인가」에서 「NPB 가 치렀다고 표시한 경기를 못 받았나」로 바꾼다.**
--   보유 완결 8시즌에 시즌 도중 3일 넘게 빈 구간이 23개였고(해마다 10월 CS 전후 두 번), 옛 규칙은 그때마다
--   수집 잡을 실패시켜 배포를 막았다. 휴식이면 「치렀다」는 표시가 없으므로 날짜를 박지 않고도 조용해진다.
--
-- ⚠**셋 다 「받고 있는데 안 읽던 것」을 기록하는 자리다** — 외부 요청을 하나도 늘리지 않는다.
--   · 予告先発 페이지는 경기가 없는 날에도 날짜와 「試合が予定されていません」을 적는데 적재가 버렸다(`load-starters.ts`).
--   · 월간 일정은 치러진 경기에 점수 링크를 붙이는데 적재가 그 행을 세기만 하고 버렸다(`load-upcoming.ts` orphans).

-- 予告先発 페이지를 받은 날마다 한 행 — **경기 유무와 무관한 맥박**.
-- ⚠옛 맥박(`probable_pitcher` 의 MAX(fetched_at))은 휴식 공표 페이지에서 행이 안 생겨 **경기가 없으면 멈췄다.**
CREATE TABLE starters_fetch (
  -- 아카이브 파일 이름의 날짜(JST). 그 날의 마지막 취득이 파일을 덮는다
  fetched_date TEXT    NOT NULL PRIMARY KEY,
  -- 페이지 제목의 날짜. 연도를 못 정하면 NULL
  game_date    TEXT,
  -- 1 이면 「試合が予定されていません」(NPB 의 휴식 공표)
  no_games     INTEGER NOT NULL CHECK (no_games IN (0, 1)),
  source_url   TEXT    NOT NULL,
  -- ⚠NULL 이 「취득 시각을 모른다」다. 적재 시각으로 메우지 마라(017 선례)
  fetched_at   TEXT
) STRICT;

-- 월간 일정이 「치렀다」(점수 링크)고 표시한 경기. 같은 날 같은 카드는 페이지 순서의 seq 로 가른다.
CREATE TABLE schedule_played (
  season     INTEGER NOT NULL,
  game_date  TEXT    NOT NULL,
  home_code  TEXT    NOT NULL,
  away_code  TEXT    NOT NULL,
  seq        INTEGER NOT NULL,
  source     TEXT    NOT NULL,
  fetched_at TEXT,
  PRIMARY KEY (game_date, home_code, away_code, seq)
) STRICT;

-- 월간 일정 사본을 언제 받았는가 — 「사본이 새롭다」의 근거.
CREATE TABLE schedule_month (
  season     INTEGER NOT NULL,
  month      INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
  source     TEXT    NOT NULL,
  -- ⚠NULL 이면 「사본이 새롭다」가 거짓이 된다(모르면 새롭다고 하지 않는다 · M11)
  fetched_at TEXT,
  date_rows  INTEGER NOT NULL,
  games      INTEGER NOT NULL,
  PRIMARY KEY (season, month)
) STRICT;
