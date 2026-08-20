/**
 * **wSB 를 막고 있는 선행 결함이 아직 그대로인가** — 실DB로.
 *
 * ⚠**이 시험은 「결함이 있다」를 못 박는다.** 이상하게 들리지만 이유가 있다:
 * `docs/metrics/README.md` §6 이 **「wSB 를 안 내는 사유」로 이 수치를 인용**하고 있고,
 * **사유로 쓰는 수는 사유로 쓰는 동안 참이어야 한다.** 누가 `after_seq` 를 고치면
 * 이 시험이 붉어지고, 그때 해야 할 일은 **문서에서 그 사유를 지우고 wSB 를 여는 것**이다.
 *
 * ⚠**반대로 수치가 나빠져도 붉어진다** — 파서가 회귀했다는 뜻이다.
 *
 * ⚠**완결 시즌만 센다**(2018~). 진행 중 시즌을 넣으면 경기가 들어올 때마다 낡고,
 * 시즌 중에는 매일 붉어진다 — `scripts/test/doc-figures.test.ts` 머리말이 적은 그 병이다.
 * ⚠**2020 은 120경기다**(`regularSeasonGames`).
 *
 * 재현: `node scripts/runner-seq-measure.ts data/bb.sqlite`
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { regularSeasonGames } from "@bb-app/domain";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const DB = `${ROOT}data/bb.sqlite`;
const HAS_DB = existsSync(DB);
if (process.env["BB_REQUIRE_DB"] === "1" && !HAS_DB) {
  throw new Error(`BB_REQUIRE_DB=1 인데 ${DB} 가 없다`);
}
const SKIP = HAS_DB ? false : "DB 없음";

const DOC = "docs/metrics/README.md";

interface Counts {
  total: number;
  noSuchPa: number;
  halfMismatch: number;
  inningMismatch: number;
  broken: number;
  offByOne: number;
  seasons: number[];
}

function measure(): Counts {
  const db = new DatabaseSync(DB, { readOnly: true });
  try {
    const seasons = (
      db
        .prepare(
          `SELECT season, MIN(n) AS fewest FROM (
             SELECT season, code, COUNT(*) AS n FROM (
               SELECT season, home_code AS code FROM game WHERE competition='regular' AND status='played'
               UNION ALL
               SELECT season, away_code AS code FROM game WHERE competition='regular' AND status='played'
             ) GROUP BY season, code
           ) GROUP BY season`,
        )
        .all() as unknown as { season: number; fewest: number }[]
    )
      .filter((r) => Number(r.fewest) >= regularSeasonGames(Number(r.season)))
      .map((r) => Number(r.season))
      .sort((a, b) => a - b);
    assert.ok(seasons.length >= 8, `완결 시즌이 ${seasons.length}개뿐이다 — 이 시험이 공회전한다`);
    const scope = `g.competition='regular' AND g.status='played' AND g.season IN (${seasons.join(",")})`;

    const r = db
      .prepare(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN r.after_seq > 0 AND p.seq IS NULL THEN 1 ELSE 0 END) AS noSuchPa,
                SUM(CASE WHEN p.seq IS NOT NULL AND p.half <> r.half THEN 1 ELSE 0 END) AS halfMismatch,
                SUM(CASE WHEN p.seq IS NOT NULL AND p.inning <> r.inning THEN 1 ELSE 0 END) AS inningMismatch,
                SUM(CASE WHEN p.seq IS NOT NULL AND (p.inning <> r.inning OR p.half <> r.half)
                         THEN 1 ELSE 0 END) AS anyMismatch
           FROM runner_event r
           JOIN game g ON g.game_id = r.game_id
           LEFT JOIN pa_event p ON p.game_id = r.game_id AND p.seq = r.after_seq
          WHERE ${scope}`,
      )
      .get() as Record<string, number>;

    const off = db
      .prepare(
        `SELECT SUM(CASE WHEN q.inning = r.inning AND q.half = r.half THEN 1 ELSE 0 END) AS prevMatches
           FROM runner_event r
           JOIN game g ON g.game_id = r.game_id
           JOIN pa_event p ON p.game_id = r.game_id AND p.seq = r.after_seq
           LEFT JOIN pa_event q ON q.game_id = r.game_id AND q.seq = r.after_seq - 1
          WHERE ${scope} AND (p.inning <> r.inning OR p.half <> r.half)`,
      )
      .get() as { prevMatches: number };

    return {
      total: r["total"]!,
      noSuchPa: r["noSuchPa"]!,
      halfMismatch: r["halfMismatch"]!,
      inningMismatch: r["inningMismatch"]!,
      broken: r["noSuchPa"]! + r["anyMismatch"]!,
      offByOne: off.prevMatches,
      seasons,
    };
  } finally {
    db.close();
  }
}

test("⚠wSB 를 막는 선행 결함이 아직 그대로다 — 고쳤으면 문서에서 사유를 지워라", { skip: SKIP }, () => {
  const c = measure();
  assert.deepEqual(
    {
      total: c.total,
      noSuchPa: c.noSuchPa,
      halfMismatch: c.halfMismatch,
      inningMismatch: c.inningMismatch,
      broken: c.broken,
      offByOne: c.offByOne,
    },
    // 실측 2026-08-21 · 완결 8시즌(2018~2025)
    { total: 10_944, noSuchPa: 11, halfMismatch: 209, inningMismatch: 119, broken: 220, offByOne: 191 },
    `잰 시즌: ${c.seasons.join("·")}\n` +
      "**고쳤다면 이 시험을 지우고 docs/metrics/README.md §6 의 wSB 항을 지운 뒤 wSB 를 열어라.**\n" +
      "**나빠졌다면 파서가 회귀한 것이다.**\n" +
      "⚠백필했거나 시즌이 끝났으면 값이 늘어난 것이 정상이다 — 재고 문서를 같이 고쳐라.",
  );
});

/**
 * ⚠**문서 전체가 아니라 그 절만 본다.**
 * 1,400줄짜리 문서에서 `119` 같은 짧은 수를 찾으면 **아무 데나 걸려서 시험이 공회전한다** —
 * 그게 「문법은 완벽하고 문장만 거짓」보다 더 나쁜, **「초록인데 아무것도 안 재는」** 상태다.
 */
function wsbSection(src: string): string {
  const start = src.indexOf("### ⚠wSB —");
  assert.ok(start >= 0, `${DOC} 에 「### ⚠wSB —」 절이 없다 — 사유를 지웠으면 이 시험도 지워라`);
  const end = src.indexOf("\n### ", start + 1);
  assert.ok(end > start, "wSB 절의 끝을 못 찾았다");
  return src.slice(start, end);
}

test("⚠문서가 말하는 수와 DB 가 같다 — 사유로 쓰는 수는 참이어야 한다", { skip: SKIP }, () => {
  const c = measure();
  const src = wsbSection(readFileSync(`${ROOT}${DOC}`, "utf8"));
  const group = (n: number): string => n.toLocaleString("en-US");
  const pct = (n: number): string => `${((n / c.total) * 100).toFixed(2)}%`;
  const miss = [
    { text: group(c.total), what: "완결 시즌 주자 사건" },
    { text: `**${c.broken}**`, what: "이어 붙일 수 없거나 어긋남" },
    { text: `**${pct(c.broken)}**`, what: "그 비율" },
    { text: `**${c.halfMismatch}**`, what: "표리 어긋남" },
    { text: `${c.inningMismatch} `, what: "이닝까지 어긋남" },
    { text: `**${c.offByOne}건`, what: "한 칸 밀림" },
  ].filter((r) => !src.includes(r.text));
  assert.deepEqual(
    miss.map((r) => `${r.what} = ${r.text}`),
    [],
    `${DOC} §6 의 wSB 항이 DB 와 갈렸다 — **DB 가 정본이다**`,
  );
});

/**
 * ⚠**도루 「수」는 멀쩡하다** — 깨진 것은 이어 붙이기뿐이다.
 * 이걸 같이 못 박아 두지 않으면 위 시험이 「주자 로그 전체가 못 믿을 것」으로 읽힌다.
 */
test("⚠깨진 것은 이어 붙이기뿐이다 — 주자 사건 자체는 이닝·표리를 다 들고 있다", { skip: SKIP }, () => {
  const db = new DatabaseSync(DB, { readOnly: true });
  try {
    const r = db
      .prepare(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN inning IS NULL OR inning < 1 THEN 1 ELSE 0 END) AS badInning,
                SUM(CASE WHEN half NOT IN ('top','bottom') THEN 1 ELSE 0 END) AS badHalf,
                SUM(CASE WHEN runner_id IS NULL OR runner_id = '' THEN 1 ELSE 0 END) AS noRunner
           FROM runner_event`,
      )
      .get() as Record<string, number>;
    assert.ok(r["total"]! > 10_000, `주자 사건이 ${r["total"]}건뿐이다 — 이 시험이 공회전한다`);
    assert.equal(r["badInning"], 0);
    assert.equal(r["badHalf"], 0);
    assert.equal(r["noRunner"], 0, "주자 신원이 빠진 행이 있다 — 도루 성공률의 분모가 흔들린다");
  } finally {
    db.close();
  }
});
