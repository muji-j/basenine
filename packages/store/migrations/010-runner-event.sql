-- 010 주자 사건(도루·도루자·견제사)
--
-- ⚠**재수집이 필요 없다.** 이 행들은 이미 받아 둔 `playbyplay.html` 안에 있었고,
-- 파서가 「선수 링크가 없는 행」으로 걸러 **버리고 있었다**(2026-08-17 확인).
-- 주자 행도 칸이 5개라 타석 행과 모양이 같은데, 이름 칸만 비어 있다.
--
-- ⚠**왜 `pa_event` 에 못 넣는가**: 타석이 아니다. 타자가 없고(`batter_id` 는 NOT NULL),
-- 넣으면 타석 수가 부풀어 **타율의 분모가 틀린다**. 사건의 종류가 다르면 표를 나눈다.
--
-- 도루자(盗塁刺)는 §2-2 지표 카탈로그의 항목인데 **박스스코어가 주지 않는다** —
-- 여기가 유일한 출처다. 그리고 도루 성공률의 분모가 바로 이것이다(M2).
--
-- ## 대조 실측 (2026-08-17)
--   · 경기별 도루 수 대 박스스코어 `盗塁` 열: **2,395경기 중 어긋남 0건**(2024〜2026)
--   · 2026 정규시즌 합계: 도루 611 = 공표 611 · 도루자 254 = 공표 `盗塁刺` 254
--   · 파싱 실패 0 / playbyplay 2,484장 · 고유 표기 12종(3시즌 내내 동일)
--   ⚠올스타를 섞으면 도루가 620이 되어 공표와 9 어긋난다(§2-1). **대회를 섞지 않는다.**

-- ⚠**M4 4종(`source`·`fetched_at`·`as_of`·`revision`)을 이 표에 두지 않는다** — 판단을 적어 둔다.
-- 출처는 「그 경기의 playbyplay 한 장」이고, 그 provenance 는 `game` 행이 이미 들고 있다.
-- 주자 사건은 경기 단위로 지우고 다시 넣으므로(멱등) 행마다 판(revision)이 갈리지 않는다.
-- `pa_event` 도 같은 판단을 따랐다. **이 표만의 새 판단이 아니라는 것**이 요점이다 —
-- 경기와 다른 주기로 갱신되는 표를 만들 때는 이 판단을 다시 해야 한다.

CREATE TABLE runner_event (
  game_id   TEXT    NOT NULL REFERENCES game (game_id),
  -- 경기 내 주자 사건 순번(1부터). ⚠타석 순번과 **다른 계열**이다
  seq       INTEGER NOT NULL,
  inning    INTEGER NOT NULL,
  half      TEXT    NOT NULL CHECK (half IN ('top', 'bottom')),
  -- 직전 타석의 순번. 아직 타석이 없으면 0 — 「1번 타석 앞」과 구별한다
  after_seq INTEGER NOT NULL,
  outs_before INTEGER NOT NULL,
  bases     TEXT    NOT NULL,
  runner_id TEXT    NOT NULL REFERENCES player (player_id),
  kind      TEXT    NOT NULL CHECK (kind IN ('steal', 'caughtStealing', 'pickoff')),
  -- ⚠**뜻이 종류에 따라 다르다** — 도루는 **노린 루**, 견제사는 **있던 루**다
  base      TEXT    NOT NULL CHECK (base IN ('1b', '2b', '3b', 'home')),
  double_steal INTEGER NOT NULL CHECK (double_steal IN (0, 1)),
  -- 원문 그대로(M4). 해석이 틀렸을 때 되돌아갈 자리다
  raw       TEXT    NOT NULL,
  PRIMARY KEY (game_id, seq)
) STRICT;

-- 선수별 조회가 주 용도다(선수 페이지 · 순위)
CREATE INDEX runner_event_runner ON runner_event (runner_id);
