-- 022 이미 들어간 무효 취득 시각을 NULL 로 · 유효하지만 정규형이 아닌 값을 UTC 한 모양으로 — 스스로 안 고쳐지기 때문이다
--
-- 설계: docs/superpowers/specs/2026-09-11-offseason-collection-verdict-design.md (D3 ⑹)
--
-- ⚠**`upsertProbablePitcher` 는 새 시각이 기존보다 클 때만 덮는다**(문자열 비교). 기존 값이 `'not-a-date'` 면
--   문자 `n` 이 숫자보다 커서 **정상 시각으로 영영 못 바꾼다**(2026-09-11 · 콜드 리뷰 지적).
--   `fetchedAtOf` 가 무효 값을 더는 내놓지 않으므로 새로 들어올 길은 막혔고, 남은 것은 이미 들어간 값이다.
-- ⚠**CI DB 실측으로 대상 0행이다**(2026-09-11 · probable_pitcher 254 · upcoming_game 104 · career 14,178 행 · 무효 0 ·
--   `Z` 로 안 끝나는 값 0) — 보험이다.
-- ⚠**여러 번 돌려도 같다**(M5) — 이미 정규형인 값은 `IS NOT` 조건에 안 걸린다.
-- ⚠`game.fetched_at` 은 NOT NULL 이라 여기서 못 비운다. 경기 행은 적재가 아카이브에서 다시 쓰고, 실측 무효 0 이다.
--
-- ⚠⚠**판정은 SQL 이 아니라 `bb_fetched_at()` 이 한다** — `packages/store/src/db.ts` 가 마이그레이션 직전에
--   `packages/store/src/meta.ts` 의 `normalizeFetchedAt`(유효하면 UTC `toISOString` 모양 · 아니면 NULL)을 등록한다.
--   ⚠**이 파일을 그 함수 없이 돌리면 `no such function` 으로 실패한다** — 조용히 다른 판정을 하는 것보다 낫다.
-- ⚠⚠**두 번 틀렸다**(2026-09-11 · 머지 전 · 운영 DB 에 적용된 적 없음):
--   ⑴ 앞모양 GLOB 만 봤다 → `2026-99-99T00:00:00.000Z` 가 남았다(3중 검토 3차 P2)
--   ⑵ 조건을 SQL 로 흉내 냈다(`datetime()` · 시간대 GLOB) → SQLite 와 JS 가 경계값 19개 중 5개에서 갈렸고
--      `24:01` 이 남아 upsert 를 막았다(수정분 재검토 2·3차). **정의를 두 벌 두면 반드시 갈린다**(M1).

UPDATE probable_pitcher SET fetched_at = bb_fetched_at(fetched_at)
 WHERE fetched_at IS NOT NULL AND fetched_at IS NOT bb_fetched_at(fetched_at);

UPDATE upcoming_game SET fetched_at = bb_fetched_at(fetched_at)
 WHERE fetched_at IS NOT NULL AND fetched_at IS NOT bb_fetched_at(fetched_at);

UPDATE career_batting SET fetched_at = bb_fetched_at(fetched_at)
 WHERE fetched_at IS NOT NULL AND fetched_at IS NOT bb_fetched_at(fetched_at);

UPDATE career_pitching SET fetched_at = bb_fetched_at(fetched_at)
 WHERE fetched_at IS NOT NULL AND fetched_at IS NOT bb_fetched_at(fetched_at);

UPDATE player SET profile_fetched_at = bb_fetched_at(profile_fetched_at)
 WHERE profile_fetched_at IS NOT NULL AND profile_fetched_at IS NOT bb_fetched_at(profile_fetched_at);
