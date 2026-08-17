-- 생년월일을 **연도만** 보관한다.
--
-- ⚠**화면은 처음부터 연도만 썼다** — `player-page.ts` 가 `birthDate.slice(0, 4)` 로
--   「1998年生」이라고만 그린다. 그런데 DB 에는 980명분의 **일 단위** 값이 들어 있었다
--   (2026-08-18 다방면 감사 P3).
-- ⚠**L5(공개된 직업활동 성적만)의 정신은 「필요한 만큼만」이다.** 생년월일은 NPB 가 공표하는
--   공개 정보라 수집 자체가 문제는 아니지만, **쓰지 않는 정밀도를 들고 있을 이유가 없다.**
--   보관하지 않은 것은 새지 않는다.
-- ⚠**파서는 그대로 둔다** — 파서는 원문을 충실히 읽는 층이고, 무엇을 남길지는 적재가 정한다.
--
-- ⚠**되돌릴 수 없다.** 이 마이그레이션이 돌면 월·일은 사라진다. 다시 필요해지면
--   선수 페이지를 다시 받아야 한다(아카이브에는 원본이 남아 있으므로 복구는 가능하다).

ALTER TABLE player ADD COLUMN birth_year INTEGER;

UPDATE player
   SET birth_year = CAST(SUBSTR(birth_date, 1, 4) AS INTEGER)
 WHERE birth_date IS NOT NULL
   AND birth_year IS NULL;

-- ⚠**열을 지우지 않고 비운다.** SQLite 의 DROP COLUMN 은 인덱스·뷰가 걸려 있으면 실패하고,
--   이 표는 여러 도구가 읽는다. 값을 비우면 목적(정밀도를 안 들고 있기)은 달성된다.
UPDATE player SET birth_date = NULL WHERE birth_date IS NOT NULL;
