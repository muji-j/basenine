/**
 * **투수의 승·패가 NPB 공표치와 같은가** — 실DB로.
 *
 * ⚠**개인 勝率(最高勝率)의 입력이 이 두 수다.** 산식(`勝 ÷ (勝 + 敗)`)은 공식이지만,
 * **입력이 공표치와 다르면 산식이 옳아도 값이 틀린다.** `docs/metrics/README.md` §2 가
 * 개인 勝率을 **T1**(공표값과 직접 대조 가능)이라고 적는 근거가 여기 있어야 한다 —
 * 없으면 그 등급은 **한 번 손으로 재고 잊은 주장**이 된다(§0 「T1 과 T2 를 섞어 말하지 마라」).
 *
 * ⚠**출처가 다른 두 값을 맞댄다**(M4). 우리 쪽은 **박스스코어의 결정 표기**(`○ ●`)를 센 것이고,
 * `career_pitching` 은 **선수 페이지에서 받아 온 NPB 공표치**다.
 *
 * ⚠**DB 가 없으면 건너뛴다**(개발자 머신마다 상태가 다르다). CI 는 `BB_REQUIRE_DB=1` 로 막는다 —
 * 「0건 통과」와 「안 쟀음」을 가른다(작업규칙 7·8).
 *
 * ⚠**`career_pitching` 은 현재 등록 선수만 담는다** — 그래서 이 대조는 리그 전량이 아니다.
 * 은퇴·이적으로 NPB 를 떠난 투수는 공표치 쪽 행이 아예 없어서 빠진다(`gidp-seasons.test.ts` 와 같다).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { winPct } from "../src/standings.ts";

const DB = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "data", "bb.sqlite");
const HAS_DB = existsSync(DB);
if (process.env["BB_REQUIRE_DB"] === "1" && !HAS_DB) {
  throw new Error(`BB_REQUIRE_DB=1 인데 ${DB} 가 없다`);
}

/**
 * 우리 값. **`season.ts` 의 판정과 같은 표기를 본다**(`○` = 승 · `●` = 패).
 * ⚠**포스트시즌을 섞지 않는다**(§2-1) — 선수 페이지의 年度別成績은 정규시즌이다.
 */
const OURS = `
SELECT g.season AS season, p.player_id AS pid,
       SUM(CASE WHEN p.decision = '○' THEN 1 ELSE 0 END) AS w,
       SUM(CASE WHEN p.decision = '●' THEN 1 ELSE 0 END) AS l,
       COUNT(*) AS games
FROM pitching_line p
JOIN game g ON g.game_id = p.game_id
WHERE g.status = 'played' AND g.competition = 'regular'
GROUP BY g.season, p.player_id
`;

/** ⚠**연도로 묶는다** — 시즌 도중 이적하면 `(선수, 연도, 구단)` 으로 여러 줄이다 */
const OFFICIAL = `
SELECT year, player_id AS pid, SUM(w) AS w, SUM(l) AS l
FROM career_pitching GROUP BY year, player_id
`;

test("⚠투수의 승·패가 NPB 공표치와 일치한다 — 개인 勝率이 T1 인 근거다", { skip: HAS_DB ? false : "DB 없음" }, () => {
  const db = new DatabaseSync(DB, { readOnly: true });
  try {
    const ours = db.prepare(OURS).all() as unknown as
      { season: number; pid: string; w: number; l: number; games: number }[];
    const official = db.prepare(OFFICIAL).all() as unknown as
      { year: number; pid: string; w: number; l: number }[];
    const mine = new Map(ours.map((r) => [`${r.season}|${r.pid}`, r]));

    const problems: string[] = [];
    const bySeason = new Map<number, number>();
    let compared = 0;
    /**
     * ⚠**「분모 = 등판 수」로 써도 통과하는 상태를 막는다.** 노디시전이 하나도 없으면
     * 決着数와 登板数가 같아져 이 시험이 그 축을 안 재게 된다.
     */
    let differsFromGames = 0;

    for (const r of official) {
      const got = mine.get(`${r.year}|${r.pid}`);
      // 우리 아카이브에 그 시즌 기록이 없는 투수(=보유 시즌 밖)는 대조 대상이 아니다
      if (got === undefined) continue;
      compared += 1;
      bySeason.set(r.year, (bySeason.get(r.year) ?? 0) + 1);
      if (Number(got.w) !== Number(r.w) || Number(got.l) !== Number(r.l)) {
        problems.push(`${r.year} ${r.pid}: 公表 ${r.w}勝${r.l}敗 · 当サイト ${got.w}勝${got.l}敗`);
      }
      if (Number(got.games) !== Number(got.w) + Number(got.l)) differsFromGames += 1;
    }

    // ⚠**공회전 방지**(작업규칙 8). 기준선은 2026-08-20 실측 2,215건이다
    assert.ok(compared >= 2000, `대조한 선수-시즌이 ${compared}건뿐이다 — 이 시험이 공회전한다`);
    assert.ok(bySeason.size >= 9, `대조한 시즌이 ${bySeason.size}개뿐이다 — ${[...bySeason.keys()].join(" ")}`);
    assert.ok(
      differsFromGames >= 100,
      `決着数가 登板数와 다른 선수-시즌이 ${differsFromGames}건뿐이다 — 두 수가 같으면 분모 축을 안 재는 것이다`,
    );

    assert.deepEqual(
      problems.slice(0, 10),
      [],
      `공표치와 어긋난 선수-시즌 ${problems.length}건 / 대조 ${compared}건`,
    );
  } finally {
    db.close();
  }
});

/**
 * ⚠**분모에서 무승부·노디시전이 빠진다**(NPB 규칙). 산식 자체는 `standings.ts` 한 벌이고
 * 구단 순위와 투수 개인이 같은 함수를 쓴다(M1) — 그 계약을 여기서 못박는다.
 */
test("⚠勝率은 決着数(勝+敗)로 나눈다 — 등판 수도 시합 수도 아니다", () => {
  assert.equal(winPct(10, 5), 10 / 15, "勝 ÷ (勝+敗) 가 아니다");
  // 25등판 중 15경기만 결판났어도 분모는 15다 — 함수가 등판 수를 아예 모른다는 것이 그 보증이다
  assert.equal(winPct(10, 5), 10 / 15);
  // ⚠결판이 하나도 없으면 `null` 이다(M11) — 「0할」이 아니다
  assert.equal(winPct(0, 0), null, "0/0 을 값으로 만들었다");
  assert.equal(winPct(0, 3), 0, "3패한 것을 「없음」으로 만들었다");
});
