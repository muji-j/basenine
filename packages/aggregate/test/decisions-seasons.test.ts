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
 * ⚠**기준일을 출장량으로 맞춘다**(2026-08-20). 그 전에는 시즌 전량끼리 맞대서
 * **CI 에서만 22건 / 대조 3,133건**이 어긋났다 — 같은 커밋이 로컬에서는 0건이었다.
 * 원인은 코드가 아니라 DB 였다: CI 는 08-19 경기까지 수집했는데 공표표는 선수마다
 * 08-15~08-20 에 걸쳐 받은 것이라 **기준일이 선수마다 달랐다.**
 * ⚠**어긋난 22건은 실측으로 전부 기준일 차이였다**(진짜 결함 0건) —
 * 22건 모두 「잘라낸 첫 경기」가 **08-18 또는 08-19**(우리 최신 경기일 = 08-19)였다.
 * 판정 방식은 `published.ts` 에 한 벌로 있다.
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
import { openDb } from "@bb-app/store";
import { winPct } from "../src/standings.ts";
import { crossCheck, settledSeasons } from "./published.ts";
import type { PublishedSample, Sample } from "./published.ts";

const DB = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "data", "bb.sqlite");
const HAS_DB = existsSync(DB);
if (process.env["BB_REQUIRE_DB"] === "1" && !HAS_DB) {
  throw new Error(`BB_REQUIRE_DB=1 인데 ${DB} 가 없다`);
}

/**
 * 우리 값. **`season.ts` 의 판정과 같은 표기를 본다**(`○` = 승 · `●` = 패).
 * ⚠**포스트시즌을 섞지 않는다**(§2-1) — 선수 페이지의 年度別成績은 정규시즌이다.
 * ⚠`games` 는 **登板数**다 — 기준일을 맞추는 출장량이면서, 아래 「決着数 ≠ 登板数」 축의 입력이다.
 */
const OURS = `
SELECT g.season AS season, p.player_id AS pid,
       COUNT(DISTINCT p.game_id) AS games,
       SUM(CASE WHEN p.decision = '○' THEN 1 ELSE 0 END) AS w,
       SUM(CASE WHEN p.decision = '●' THEN 1 ELSE 0 END) AS l
FROM pitching_line p
JOIN game g ON g.game_id = p.game_id
WHERE g.status = 'played' AND g.competition = 'regular'
GROUP BY g.season, p.player_id
`;

/** ⚠**연도로 묶는다** — 시즌 도중 이적하면 `(선수, 연도, 구단)` 으로 여러 줄이다 */
const OFFICIAL = `
SELECT year, player_id AS pid, SUM(games) AS games, SUM(w) AS w, SUM(l) AS l,
       MAX(fetched_at) AS fetched_at
FROM career_pitching GROUP BY year, player_id
`;

test("⚠투수의 승·패가 NPB 공표치와 일치한다 — 개인 勝率이 T1 인 근거다", { skip: HAS_DB ? false : "DB 없음" }, () => {
  const db = openDb(DB, "1970-01-01T00:00:00.000Z");
  try {
    const ourRows = db.raw.prepare(OURS).all() as unknown as
      { season: number; pid: string; games: number; w: number; l: number }[];
    const ours = new Map<string, Sample>(
      ourRows.map((r) => [
        `${r.season}|${r.pid}`,
        { volume: Number(r.games), value: `${Number(r.w)}勝${Number(r.l)}敗` },
      ]),
    );
    const published: PublishedSample[] = (
      db.raw.prepare(OFFICIAL).all() as unknown as
        { year: number; pid: string; games: number; w: number; l: number; fetched_at: string | null }[]
    ).map((r) => ({
      year: r.year,
      playerId: r.pid,
      volume: Number(r.games),
      value: `${Number(r.w)}勝${Number(r.l)}敗`,
      // ⚠**「모른다」를 그대로 넘긴다**(M11) — 완결 판정이 그것을 보고 엄격도를 정한다
      fetchedAt: r.fetched_at,
    }));

    const got = crossCheck(ours, published, settledSeasons(db), "試合");

    /**
     * ⚠**「분모 = 등판 수」로 써도 통과하는 상태를 막는다.** 노디시전이 하나도 없으면
     * 決着数와 登板数가 같아져 이 시험이 그 축을 안 재게 된다.
     */
    let differsFromGames = 0;
    for (const r of ourRows) {
      if (Number(r.games) !== Number(r.w) + Number(r.l)) differsFromGames += 1;
    }

    /**
     * ⚠**공회전 방지**(작업규칙 8). 실측(2026-08-20): CI DB(08-19 수집) **3,043건**
     * — 기준일이 어긋나 못 잰 90명을 뺀 수다. 로컬 08-16 스냅샷에서는 **2,215건**
     * (그쪽은 못 잰 것이 0건이었다). **두 DB 를 다 통과해야 하므로 하한은 로컬 쪽에 맞춘다.**
     * ⚠**이 하한이 「미대조가 폭증했다」의 감시도 겸한다** — 공표표가 통째로 낡으면
     * `behind` 가 커지면서 `compared` 가 이 선 아래로 떨어진다.
     */
    assert.ok(got.compared >= 2000, `대조한 선수-시즌이 ${got.compared}건뿐이다 — 이 시험이 공회전한다`);
    assert.ok(got.bySeason.size >= 9, `대조한 시즌이 ${got.bySeason.size}개뿐이다 — ${[...got.bySeason.keys()].join(" ")}`);
    assert.ok(
      differsFromGames >= 100,
      `決着数가 登板数와 다른 선수-시즌이 ${differsFromGames}건뿐이다 — 두 수가 같으면 분모 축을 안 재는 것이다`,
    );

    // ⚠**공표가 우리보다 앞선 것 = 우리가 경기를 놓쳤다.** 기준일로 설명되지 않는다
    assert.deepEqual(got.ahead.slice(0, 10), [], `공표에 있는 등판이 우리에게 없다 ${got.ahead.length}건 — 수집 누락이다`);
    // ⚠**완결 시즌은 양쪽 다 더 늘 것이 없다** — 그런데 다르면 기준일이 아니라 결함이다
    assert.deepEqual(
      got.behindSettled.slice(0, 10),
      [],
      `완결 시즌인데 登板数가 어긋난 선수-시즌 ${got.behindSettled.length}건 — 기준일로 설명되지 않는다`,
    );

    assert.deepEqual(
      got.mismatches.slice(0, 10),
      [],
      `공표치와 어긋난 선수-시즌 ${got.mismatches.length}건 / 대조 ${got.compared}건` +
        `（기준일이 달라 못 잰 것 ${got.behind.length}건）`,
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
