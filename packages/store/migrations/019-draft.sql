-- 019 드래프트 회의 — 지명·1순위 입찰·사후 사실
--
-- ⚠**드래프트는 `player` 의 속성이 될 수 없다.** 011 이 `player.draft` 에
-- `2000年ドラフト5位` 원문을 넣었지만 그것으로는 지명 구단도 경합도 추첨도 답하지 못한다.
-- 더 근본적으로 **「추첨에서 진 구단」은 그 선수와 아무 기록도 안 남긴다** — 선수 단위로
-- 표현 자체가 불가능하다. 그리고 지명된 선수의 상당수가 `player` 에 영영 없다
-- (입단 거부 · 은퇴 · 1군 미등록). 그래서 독립 이벤트 표다.
--
-- ⚠**M4 를 자체 컬럼으로 갖는다.** 경기 데이터는 `game_id` 로 부모를 타고 출처를 답하지만
-- 드래프트에는 그 부모가 없다. npb.jp 는 `ETag`·`Last-Modified` 를 주지 않으므로
-- `revision` 은 **본문 해시**다.
--
-- ⚠**`won` 이 3값이다**: 1=당첨 · 0=낙첨 · NULL=단독지명.
-- **단독지명은 어느 소스도 적지 않는다** — 경합 그룹의 여집합으로 유도한다.
-- 셋을 같은 값으로 쓰면 「경합에서 이겼다」와 「아무도 안 겹쳤다」가 섞인다(M11).

CREATE TABLE draft_event (
  season       INTEGER NOT NULL,
  kind         TEXT    NOT NULL,   -- shihaika | ikusei | koukousei | daigaku_shakaijin
  held_on      TEXT,               -- YYYY-MM-DD · 모르면 NULL(M11)
  source       TEXT    NOT NULL,
  fetched_at   TEXT    NOT NULL,
  revision     TEXT    NOT NULL,   -- 본문 해시
  license      TEXT,               -- wikipedia 유래일 때 CC BY-SA 4.0
  PRIMARY KEY (season, kind)
);

CREATE TABLE draft_pick (
  season         INTEGER NOT NULL,
  kind           TEXT    NOT NULL,
  team           TEXT    NOT NULL,
  round_no       INTEGER NOT NULL,
  pick_seq       INTEGER,          -- 전체 지명 순번. 모르면 NULL
  waiver_dir     TEXT,             -- '→' | '←' | NULL(1순위)
  name_display   TEXT    NOT NULL,
  name_canonical TEXT,
  position       TEXT,
  from_org       TEXT,
  origin         TEXT    NOT NULL, -- 'npb' | 'wikipedia'
  player_id      TEXT,
  source         TEXT    NOT NULL,
  fetched_at     TEXT    NOT NULL,
  revision       TEXT    NOT NULL,
  PRIMARY KEY (season, kind, team, round_no, name_display)
);

CREATE TABLE draft_bid (
  season         INTEGER NOT NULL,
  kind           TEXT    NOT NULL,
  round_no       INTEGER NOT NULL, -- 1巡目 몇 회차인가(1·2·3·4)
  team           TEXT    NOT NULL,
  group_key      TEXT,             -- 같은 회차·같은 경합 대상. 단독지명이면 NULL
  won            INTEGER,          -- 1 | 0 | NULL(단독지명)
  name_display   TEXT    NOT NULL,
  name_canonical TEXT,
  origin         TEXT    NOT NULL,
  player_id      TEXT,
  source         TEXT    NOT NULL,
  fetched_at     TEXT    NOT NULL,
  revision       TEXT    NOT NULL,
  PRIMARY KEY (season, kind, round_no, team)
);

CREATE TABLE draft_note (
  season       INTEGER NOT NULL,
  kind         TEXT    NOT NULL,
  team         TEXT,
  name_display TEXT,
  note_kind    TEXT    NOT NULL,   -- kousyouken_teisei | nyudan_kyohi | shimei_hakudatsu | fugoui
  detail       TEXT    NOT NULL,
  source       TEXT    NOT NULL,
  fetched_at   TEXT    NOT NULL,
  revision     TEXT    NOT NULL
);

CREATE INDEX draft_pick_season ON draft_pick (season, kind, round_no);
CREATE INDEX draft_bid_group   ON draft_bid (season, kind, round_no, group_key);
