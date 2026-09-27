-- 023 선수 프로필의 적용 판과 순서 기준선 — 옛 판 선수 페이지가 더 새 프로필·통산을 덮지 못하게 한다(감사 N3)
--   두 칸: `profile_revision`(적용한 본문의 sha256 · 동일성) · `profile_content_at`(그 본문의 내용 시각 · 순서 · 3중 검토 3차 P2 로 더했다)
--
-- 설계: docs/superpowers/specs/2026-09-27-profile-version-guard-design.md §5-1
--
-- ⚠**「판」은 본문 sha256(소문자 hex 64자)이다** — 019 드래프트와 같은 정의(「npb.jp 는 `ETag`·`Last-Modified` 를
--   주지 않으므로 `revision` 은 본문 해시다」). 적재기가 **적용한 본문**의 해시를 넣는다.
-- ⚠**`game.revision`(정수 카운터)과 뜻이 다르다** — 이름만 같다(019 선례를 따랐다).
-- ⚠**사이드카의 `revision` 을 복사하지 않는다** — 아카이브 안의 카운터라, 세대를 복원한 뒤 다시 세면 **다른 본문에 같은 번호**가
--   붙고 상류가 이전 내용으로 돌아가면 번호가 작은 채 최신이다(019 가 같은 이유로 기각했다).
-- ⚠**NULL = 이 칸이 생긴 뒤 한 번도 안 썼다(모름).** 적재기는 NULL 을 「처음」으로 보고 **시각을 비교하지 않고** 진행한다 —
--   C7 이전 DB 의 `profile_fetched_at` 은 적재 실행 시각이라 사이드카보다 언제나 늦어(실측 1,644/1,644 · 980/980),
--   시각만 보면 첫 실행에 전원이 **영구히** 거짓 옛 판이 된다(설계 §4-2 · G4).
-- ⚠**가산 마이그레이션이다** — 기존 행·칸을 안 바꾼다(기존 행의 새 칸은 NULL).
--   되돌리기: `ALTER TABLE player DROP COLUMN profile_revision`(칸 CHECK 는 그 칸의 것이라 막지 않는다 · 시험 3-20 이 확인한다).
--   이 칸을 모르는 옛 코드로 되돌려도 값만 쓰고 칸은 남는다 — 다시 배포하면 적용 판(옛 sha) ≠ 본문이라 내용 시각으로 순서를 가른다(§5-6 ⑦).

ALTER TABLE player ADD COLUMN profile_revision TEXT
  CHECK (profile_revision IS NULL OR (length(profile_revision) = 64 AND profile_revision NOT GLOB '*[^0-9a-f]*'));

-- ⚠⚠**순서 전용 칸 — 적용한 본문의 내용 시각**(2026-09-27 · 3중 검토 3차 P2 · 설계 §5-1).
--   판의 **순서**(옛 판인가)는 이 칸과만 가른다. `profile_fetched_at`(표시·신선도 · `career-lag`)은 「마지막으로 본 시각」이라
--   **같은 본문의 404 확인으로 오른다** — 그 값을 기준선으로 쓰자, 그 사이에 받은 **실제로 더 새** 본문이 「DB 보다 이르다」로
--   버려졌다(재현: A(t1) → A 의 404(t3) → B(t2) 복원 → 옛 판 건너뜀 · 종료 0 · 옛 값 남음).
--   → 쓰기: 처음·새 판은 후보의 내용 시각 · 같은 본문은 저장값과 후보 내용 시각 중 **늦은 쪽**(404 의 내용 시각은 받은 시각이라 안 오른다).
-- ⚠**정규화된 ISO(`toISOString` 모양 24자)만** 받는다 — 판처럼 모양을 CHECK 한다. 달력상 무효(`2026-19-39T…`)는 모양을 통과하므로
--   적재기가 `normalizeFetchedAt` 로 다시 보고 무효면 건너뛴다(fail-closed · DB VERSION INVALID).
-- ⚠NULL = 그 본문의 내용 시각을 모른다(판 없음 · 또는 사이드카가 본문을 말하지 않던 첫 적재). 처리는 설계 §5-2 5번.
--   ⚠이 칸이 생기기 **전에** 판이 적힌 행은 없다 — 023 이 두 칸을 한꺼번에 만든다(아직 배포 전에 같은 마이그레이션에 더했다).
-- 되돌리기: `ALTER TABLE player DROP COLUMN profile_content_at`(칸 CHECK 는 그 칸의 것이다 · 시험 3-20 이 확인한다).
ALTER TABLE player ADD COLUMN profile_content_at TEXT
  CHECK (profile_content_at IS NULL OR (length(profile_content_at) = 24
    AND profile_content_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'));
