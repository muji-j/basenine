-- 003 선수 속성
--
-- 좌우 스플릿(좌투 상대 타율 등)은 **투타 정보**가 있어야 성립한다.
-- 박스스코어에도 playbyplay에도 없고, 선수 페이지가 유일한 출처다.
--
-- ⚠**미상(null)과 확인된 값을 구별한다**(M11). 투타를 모르는 선수를 임의로 「우투우타」로
-- 채우면 좌우 스플릿이 조용히 틀린다 — 모르면 스플릿에서 제외하고 그 사실을 표시한다.

ALTER TABLE player ADD COLUMN position TEXT;
-- right | left | both. 스위치히터·양투는 both
ALTER TABLE player ADD COLUMN throws TEXT CHECK (throws IS NULL OR throws IN ('right', 'left', 'both'));
ALTER TABLE player ADD COLUMN bats TEXT CHECK (bats IS NULL OR bats IN ('right', 'left', 'both'));
ALTER TABLE player ADD COLUMN birth_date TEXT;
ALTER TABLE player ADD COLUMN physique TEXT;
-- 프로필을 언제 취득했는가(M4). null이면 아직 안 받은 것이다
ALTER TABLE player ADD COLUMN profile_fetched_at TEXT;
