-- 002 타석 단위 이벤트
--
-- 스플릿(주자상황·홈원정·월별)과 투수×타자 상대전적의 원천이다.
-- 경기별 성적(`batting_line`)은 여기서 재계산 가능하지만, **재계산으로 대체하지 않는다** —
-- 박스스코어의 합계 컬럼이 외부 정답 역할을 하므로 둘 다 두고 서로 대조한다.
--
-- 출처가 둘이라는 점이 중요하다:
--   · `outcome`·`rbi` = **박스스코어**에서 온 값. 17,351행에서 npb.jp 합계와 대조 완료
--   · `inning`·`outs_before`·`bases`·`pitcher_id` = **playbyplay**에서 온 문맥
-- 두 소스는 타자별 타석 수가 전건 일치하는 것으로 정렬 가능성이 확인됐다.

CREATE TABLE IF NOT EXISTS pa_event (
  game_id     TEXT NOT NULL REFERENCES game (game_id),
  -- 경기 내 타석 순번(1부터). 도중 종료·도중 교대 행은 제외한 뒤의 순번이다
  seq         INTEGER NOT NULL,
  inning      INTEGER NOT NULL,
  half        TEXT NOT NULL CHECK (half IN ('top', 'bottom')),
  outs_before INTEGER NOT NULL CHECK (outs_before BETWEEN 0 AND 2),
  -- 주자 상태. '' '1' '2' '3' '12' '13' '23' '123'
  bases       TEXT NOT NULL,
  batter_id   TEXT NOT NULL REFERENCES player (player_id),
  -- 이론상 항상 있지만(실측 미상 0건) 소스가 바뀌면 빠질 수 있으므로 NULL을 허용한다
  pitcher_id  TEXT REFERENCES player (player_id),
  -- 박스스코어에서 온 분류. **playbyplay 문자열을 해석해 만들지 않는다**(M1)
  outcome     TEXT NOT NULL,
  rbi         INTEGER NOT NULL,
  -- 원문 보존. 분류가 틀렸다고 판명되면 여기서 다시 만든다
  raw_box     TEXT NOT NULL,
  raw_pbp     TEXT NOT NULL,
  -- ⚠확정값과 잠정값을 타입 수준에서 구분한다(M9). v1은 'final'만 쓰지만
  -- 컬럼을 처음부터 둬서 v2 라이브가 DDL 변경 없이 얹히게 한다
  status      TEXT NOT NULL DEFAULT 'final' CHECK (status IN ('final', 'live')),
  PRIMARY KEY (game_id, seq)
) STRICT;

-- ⚠D1의 「행 읽기」는 **스캔한 행**을 센다. 인덱스가 성능이 아니라 가용성 문제다.
CREATE INDEX IF NOT EXISTS pa_by_batter ON pa_event (batter_id);
CREATE INDEX IF NOT EXISTS pa_by_pitcher ON pa_event (pitcher_id);
-- 상대전적은 이 조합으로만 조회한다. 없으면 매 조회가 전량 스캔이 된다
CREATE INDEX IF NOT EXISTS pa_matchup ON pa_event (pitcher_id, batter_id);
