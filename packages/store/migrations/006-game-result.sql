-- 경기 결과와 구장, 그리고 투수의 폭투·보크.
--
-- ⚠**전부 이미 아카이브 안에 있던 값이다.** 새로 수집하는 것이 아니라
-- 파서가 읽지 않고 버리던 열을 이제 저장한다 — 재적재만으로 채워진다.
--
-- ⚠**팀 승패를 `pitching_line.decision`에서 세면 안 된다.** 그건 투수 개인에게 붙은
-- 승패라 무승부에서는 아무에게도 안 붙는다. 실측(2026-08-15): 실시 632경기에
-- 승 620·패 620 — **12경기가 무승부**다. 팀 승패는 여기 있는 득점으로만 판정한다.
--
-- ⚠**NULL을 0으로 채우지 않는다**(M11). 중지 경기에는 결과가 없고, 그건 0-0이 아니다.

ALTER TABLE game ADD COLUMN away_runs   INTEGER;
ALTER TABLE game ADD COLUMN home_runs   INTEGER;
ALTER TABLE game ADD COLUMN away_hits   INTEGER;
ALTER TABLE game ADD COLUMN home_hits   INTEGER;
ALTER TABLE game ADD COLUMN away_errors INTEGER;
ALTER TABLE game ADD COLUMN home_errors INTEGER;

-- 구장. ⚠**홈팀으로 대리하면 지방개최를 놓친다** — 같은 팀의 홈경기가 여러 구장에서 열린다.
-- 원문 표기를 그대로 넣는다(`京セラD大阪` 등). 정규화는 표시 계층의 일이다.
ALTER TABLE game ADD COLUMN venue TEXT;

-- 폭투·보크. 투수표에 열이 있는데 지금까지 건너뛰고 있었다.
ALTER TABLE pitching_line ADD COLUMN wp   INTEGER;
ALTER TABLE pitching_line ADD COLUMN balk INTEGER;

-- 경기일별 조회(수집 로그·오늘 화면)와 구장별 집계에 쓴다.
CREATE INDEX IF NOT EXISTS game_by_venue ON game (venue);
