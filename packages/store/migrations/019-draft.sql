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
--
-- ⚠**검수 지적 반영**(2026-09-05 · 초판은 이 검수 전에 STRICT·CHECK·FK·PK 를 전부 빠뜨렸다.
-- 이 저장소의 다른 마이그레이션이 지키는 관용을 그대로 옮긴다. 실 DB(`data/bb.sqlite`)에
-- 이미 적용돼 있던 초판은 4표 전부 0행임을 확인한 뒤 되돌리고 이 판으로 다시 적용했다):
--   1. 4표 전부 `STRICT` 누락 → 붙였다(018·010 이 이미 그렇다).
--   2. `CHECK` 제약 없음 → `kind`·`won`·`origin`·`waiver_dir`·`note_kind` 에 걸었다
--      (003의 `throws`·010의 `kind` 가 이 저장소의 관용이다).
--   3. `player_id` 에 `REFERENCES player (player_id)` 누락 → 붙였다
--      (`pa_event.pitcher_id`·`probable_pitcher.player_id`·017 과 같은 패턴).
--   4. `draft_note` 에 PK·UNIQUE 없음 → 아래 draft_note 주석 참조.
--   5. `draft_pick`·`draft_bid` 의 PK 에 `name_display` 가 들어 있었음 → 뺐다.
--      2순위 이후 웨이버는 팀당 라운드당 1명이 자연 키다(`season, kind, team, round_no`).
--      `name_display` 를 PK 에 더하면 이름이 정정된 뒤 재수집할 때 기존 행을 갱신하지 않고
--      새 행을 추가해 한 팀·한 라운드에 선수가 둘 남는다 — `018-player-season-name.sql` 이
--      다루는 것과 같은 모양의 사고다.
--
-- ⚠**`kind` 가 6종이다**(2026-09-05 · 파서 검수에서 나온 결정. 위와 같은 절차로
-- 4표 0행을 확인하고 되돌린 뒤 다시 적용했다). 초판은 4종이었고 파서가
-- `自由獲得選手`(2001)·`希望入団枠獲得選手`(2006)를 `shihaika` 로 접었다.
-- **접으면 「1巡目 지명」과 「희망입단枠 지명」이 DB 에서 같은 것이 된다** — 둘 다
-- `round_no` 가 없는 제도라 적재가 순번을 매기는 순간 구별할 근거가 사라진다.
-- `kind` 는 이미 「어느 구획/회의인가」를 뜻하므로(`koukousei`·`daigaku_shakaijin` 이 그렇다)
-- 새 칼럼이 아니라 **이 축을 늘렸다.**
-- ⚠**`draft_bid`·`draft_note` 에도 같은 6종을 넣었다** — 그 둘에서 새 값이 실제로 쓰일
-- 일은 없어 보이지만(自由獲得·希望入団枠 에는 추첨이 없다), **어휘를 표마다 다르게 두면
-- 어느 표의 `kind` 인지에 따라 뜻이 갈린다.** 어휘는 한 벌이다(M1).

CREATE TABLE draft_event (
  season       INTEGER NOT NULL,
  -- shihaika(支配下) | ikusei(育成) | koukousei(高校生) | daigaku_shakaijin(大学生・社会人)
  -- | jiyuu_kakutoku(自由獲得選手 · 회차 없음) | kibou_nyudanwaku(希望入団枠獲得選手 · 회차 없음)
  kind         TEXT    NOT NULL CHECK (kind IN ('shihaika', 'ikusei', 'koukousei', 'daigaku_shakaijin', 'jiyuu_kakutoku', 'kibou_nyudanwaku')),
  held_on      TEXT,               -- YYYY-MM-DD · 모르면 NULL(M11)
  source       TEXT    NOT NULL,
  fetched_at   TEXT    NOT NULL,
  revision     TEXT    NOT NULL,   -- 본문 해시
  license      TEXT,               -- wikipedia 유래일 때 CC BY-SA 4.0
  PRIMARY KEY (season, kind)
) STRICT;

CREATE TABLE draft_pick (
  season         INTEGER NOT NULL,
  kind           TEXT    NOT NULL CHECK (kind IN ('shihaika', 'ikusei', 'koukousei', 'daigaku_shakaijin', 'jiyuu_kakutoku', 'kibou_nyudanwaku')),
  team           TEXT    NOT NULL,
  round_no       INTEGER NOT NULL,
  pick_seq       INTEGER,          -- 전체 지명 순번. 모르면 NULL
  waiver_dir     TEXT    CHECK (waiver_dir IS NULL OR waiver_dir IN ('→', '←')),  -- NULL(1순위)
  name_display   TEXT    NOT NULL,
  name_canonical TEXT,
  position       TEXT,
  from_org       TEXT,
  origin         TEXT    NOT NULL CHECK (origin IN ('npb', 'wikipedia')),
  player_id      TEXT    REFERENCES player (player_id),
  source         TEXT    NOT NULL,
  fetched_at     TEXT    NOT NULL,
  revision       TEXT    NOT NULL,
  -- ⚠`name_display` 를 PK 에서 뺐다 — 위 「검수 지적 반영」 5 참조.
  PRIMARY KEY (season, kind, team, round_no)
) STRICT;

CREATE TABLE draft_bid (
  season         INTEGER NOT NULL,
  kind           TEXT    NOT NULL CHECK (kind IN ('shihaika', 'ikusei', 'koukousei', 'daigaku_shakaijin', 'jiyuu_kakutoku', 'kibou_nyudanwaku')),
  round_no       INTEGER NOT NULL, -- 1巡目 몇 회차인가(1·2·3·4)
  team           TEXT    NOT NULL,
  group_key      TEXT,             -- 같은 회차·같은 경합 대상. 단독지명이면 NULL
  won            INTEGER CHECK (won IS NULL OR won IN (0, 1)),  -- 1 | 0 | NULL(단독지명)
  name_display   TEXT    NOT NULL,
  name_canonical TEXT,
  origin         TEXT    NOT NULL CHECK (origin IN ('npb', 'wikipedia')),
  player_id      TEXT    REFERENCES player (player_id),
  source         TEXT    NOT NULL,
  fetched_at     TEXT    NOT NULL,
  revision       TEXT    NOT NULL,
  PRIMARY KEY (season, kind, round_no, team)
) STRICT;

-- ⚠**`team`·`name_display` 를 `NOT NULL` 로 바꿨다**(검수 지적 4 · 내 판단).
-- 브리프 원안은 둘 다 nullable 이었는데, SQLite 는 `NOT NULL` 을 요구하지 않는 열은
-- PK/UNIQUE 에 넣어도 `NULL ≠ NULL` 이라 유일성이 안 걸린다 — **재수집(교섭권 정정이 이
-- 표의 존재 이유다)이 조용히 중복 행을 쌓는다.**
-- 세 선택지(NOT NULL 로 바꾼다 / UNIQUE 인덱스에 COALESCE 를 쓴다 / 대리 키를 둔다) 중
-- **NOT NULL 을 골랐다**: `note_kind` 4종(kousyouken_teisei·nyudan_kyohi·shimei_hakudatsu·fugoui)은
-- 전부 「특정 구단의 특정 지명」에 대한 사후 사실이다 — 조사 문서(2026-09-04-draft-source-survey.md §6)
-- 의 실측 사례(2005 교섭권 정정 辻内崇伸 オリックス→巨人·陽仲壽 ソフトバンク→日本ハム · 2025 입단거부
-- 佐々木麟太郎·石川ケニー) 전부 팀·선수가 둘 다 있고, 「이 시즌 전체」처럼 팀·선수가 없는 주석은
-- 조사한 소스 어디에도 없다. COALESCE 인덱스나 대리 키는 **존재가 확인되지 않은 사례를 위해
-- 자연 키를 흐리는 것**이라 고르지 않았다. ⚠다음에 팀·선수 없는 사후 사실이 실제로 나오면
-- (예: 이 시즌 자체가 취소됐다는 사실) 이 판단을 다시 검토한다 — 그건 draft_event 쪽 사실일
-- 가능성이 높다.
CREATE TABLE draft_note (
  season       INTEGER NOT NULL,
  kind         TEXT    NOT NULL CHECK (kind IN ('shihaika', 'ikusei', 'koukousei', 'daigaku_shakaijin', 'jiyuu_kakutoku', 'kibou_nyudanwaku')),
  team         TEXT    NOT NULL,
  name_display TEXT    NOT NULL,
  note_kind    TEXT    NOT NULL
    CHECK (note_kind IN ('kousyouken_teisei', 'nyudan_kyohi', 'shimei_hakudatsu', 'fugoui')),
  detail       TEXT    NOT NULL,
  source       TEXT    NOT NULL,
  fetched_at   TEXT    NOT NULL,
  revision     TEXT    NOT NULL,
  PRIMARY KEY (season, kind, team, name_display, note_kind)
) STRICT;

CREATE INDEX draft_pick_season ON draft_pick (season, kind, round_no);
CREATE INDEX draft_bid_group   ON draft_bid (season, kind, round_no, group_key);
