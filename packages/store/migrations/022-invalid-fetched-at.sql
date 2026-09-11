-- 022 이미 들어간 무효 취득 시각을 NULL 로 — 스스로 안 고쳐지기 때문이다
--
-- 설계: docs/superpowers/specs/2026-09-11-offseason-collection-verdict-design.md (D3 ⑹)
--
-- ⚠**`upsertProbablePitcher` 는 새 시각이 기존보다 클 때만 덮는다**(문자열 비교). 기존 값이 `'not-a-date'` 면
--   문자 `n` 이 숫자보다 커서 **정상 시각으로 영영 못 바꾼다**(2026-09-11 · 콜드 리뷰 지적).
--   `fetchedAtOf` 가 무효 값을 더는 내놓지 않으므로 새로 들어올 길은 막혔고, 남은 것은 이미 들어간 값이다.
-- ⚠**CI DB 실측으로 대상 0행이다**(2026-09-11 · probable_pitcher 254 · upcoming_game 104 · career 14,178 행 · 무효 0) — 보험이다.
-- ⚠**여러 번 돌려도 같다**(M5) — 모양이 맞는 값은 건드리지 않는다.
-- ⚠`game.fetched_at` 은 NOT NULL 이라 여기서 못 비운다. 경기 행은 적재가 아카이브에서 다시 쓰고, 실측 무효 0 이다.
-- 「인정하는 모양」은 `packages/store/src/meta.ts` 의 `TIMESTAMP_HEAD`(YYYY-MM-DDTHH:MM 으로 시작)와 같다.

UPDATE probable_pitcher SET fetched_at = NULL
 WHERE fetched_at IS NOT NULL
   AND fetched_at NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]*';

UPDATE upcoming_game SET fetched_at = NULL
 WHERE fetched_at IS NOT NULL
   AND fetched_at NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]*';

UPDATE career_batting SET fetched_at = NULL
 WHERE fetched_at IS NOT NULL
   AND fetched_at NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]*';

UPDATE career_pitching SET fetched_at = NULL
 WHERE fetched_at IS NOT NULL
   AND fetched_at NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]*';

UPDATE player SET profile_fetched_at = NULL
 WHERE profile_fetched_at IS NOT NULL
   AND profile_fetched_at NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]*';
