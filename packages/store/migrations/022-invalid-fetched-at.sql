-- 022 이미 들어간 무효 취득 시각을 NULL 로 — 스스로 안 고쳐지기 때문이다
--
-- 설계: docs/superpowers/specs/2026-09-11-offseason-collection-verdict-design.md (D3 ⑹)
--
-- ⚠**`upsertProbablePitcher` 는 새 시각이 기존보다 클 때만 덮는다**(문자열 비교). 기존 값이 `'not-a-date'` 면
--   문자 `n` 이 숫자보다 커서 **정상 시각으로 영영 못 바꾼다**(2026-09-11 · 콜드 리뷰 지적).
--   `fetchedAtOf` 가 무효 값을 더는 내놓지 않으므로 새로 들어올 길은 막혔고, 남은 것은 이미 들어간 값이다.
-- ⚠**CI DB 실측으로 대상 0행이다**(2026-09-11 · probable_pitcher 254 · upcoming_game 104 · career 14,178 행 · 무효 0 ·
--   `Z` 로 안 끝나는 값 0) — 보험이다.
-- ⚠**여러 번 돌려도 같다**(M5) — 유효한 값은 건드리지 않는다.
-- ⚠`game.fetched_at` 은 NOT NULL 이라 여기서 못 비운다. 경기 행은 적재가 아카이브에서 다시 쓰고, 실측 무효 0 이다.
--
-- 「유효한 취득 시각」은 `packages/store/src/meta.ts` 의 `TIMESTAMP` 와 **같은 세 조건**이다:
--   ⑴ `YYYY-MM-DDTHH:MM` 으로 시작한다(GLOB)
--   ⑵ 날짜로 해석된다 — `datetime()` 이 NULL 이 아니다
--   ⑶ 시간대 표기(`Z` · `±HH:MM`)로 끝난다
-- ⚠⚠**⑵⑶ 은 2026-09-11 3중 검토에서 더했다.** 처음엔 ⑴ 만 봐서 `2026-99-99T00:00:00.000Z` 가 남았고(3차 P2 · 실행 재현),
--   그 값은 문자 비교로 정상 시각보다 커서 역시 **영영 안 고쳐진다.** `meta.ts` 는 이미 `Date.parse` 로 거르고 있어
--   **정의가 두 벌로 갈려 있었다.** ⑶ 이 없으면 JS 는 현지 시간 · SQLite 는 UTC 로 읽어 **9시간 갈린다**(2차 N3 · 실측).
-- ⚠SQLite `datetime()` 과 JS `Date.parse` 의 유효성 판정은 9개 값에서 일치했다(실측 · `02-30` 은 둘 다 `03-02` 로 넘긴다).
-- ⚠이 파일은 머지 전에 고쳤다 — 운영 DB 에는 아직 한 번도 적용된 적이 없다(개발 로컬 DB 는 옛 판을 적용했고 그때 대상 0행이었다).

UPDATE probable_pitcher SET fetched_at = NULL
 WHERE fetched_at IS NOT NULL
   AND (fetched_at NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]*'
        OR datetime(fetched_at) IS NULL
        OR NOT (fetched_at GLOB '*Z' OR fetched_at GLOB '*[+-][0-9][0-9]:[0-9][0-9]'));

UPDATE upcoming_game SET fetched_at = NULL
 WHERE fetched_at IS NOT NULL
   AND (fetched_at NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]*'
        OR datetime(fetched_at) IS NULL
        OR NOT (fetched_at GLOB '*Z' OR fetched_at GLOB '*[+-][0-9][0-9]:[0-9][0-9]'));

UPDATE career_batting SET fetched_at = NULL
 WHERE fetched_at IS NOT NULL
   AND (fetched_at NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]*'
        OR datetime(fetched_at) IS NULL
        OR NOT (fetched_at GLOB '*Z' OR fetched_at GLOB '*[+-][0-9][0-9]:[0-9][0-9]'));

UPDATE career_pitching SET fetched_at = NULL
 WHERE fetched_at IS NOT NULL
   AND (fetched_at NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]*'
        OR datetime(fetched_at) IS NULL
        OR NOT (fetched_at GLOB '*Z' OR fetched_at GLOB '*[+-][0-9][0-9]:[0-9][0-9]'));

UPDATE player SET profile_fetched_at = NULL
 WHERE profile_fetched_at IS NOT NULL
   AND (profile_fetched_at NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]*'
        OR datetime(profile_fetched_at) IS NULL
        OR NOT (profile_fetched_at GLOB '*Z' OR profile_fetched_at GLOB '*[+-][0-9][0-9]:[0-9][0-9]'));
