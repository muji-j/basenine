-- 원문 행 순서.
--
-- ⚠**시즌 중 이적이 거꾸로 나왔다**(2026-08-17 이중 검토 실측).
--   키가 (선수, 연도, 구단)이라 원문 순서를 잃고, 되살릴 때 구단명 사전순으로 정렬됐다:
--     원문(NPB) : 2021 横浜DeNA(18경기) → 2021 千葉ロッテ(25경기)
--     우리 표시 : 2021 千葉ロッテ       → 2021 横浜DeNA      ← 역순
--   「DeNA에서 로데로 갔다」가 화면에서 반대로 읽힌다.
-- ⚠**날짜가 아니라 순서다.** 그 표에는 이적일이 없다 — 우리가 아는 것은 「원문에서 몇 번째였나」뿐이고,
--   그 이상을 아는 척하지 않는다.
ALTER TABLE career_batting ADD COLUMN seq INTEGER NOT NULL DEFAULT 0;
ALTER TABLE career_pitching ADD COLUMN seq INTEGER NOT NULL DEFAULT 0;
