/**
 * **주석과 정의서에 적힌 루별 수치가 아직 참인가** — 실DB로.
 *
 * ⚠**이 파일은 한 번 잘못된 것을 못 박고 있었다**(2026-08-20).
 * 원래는 「보유 **전** 시즌」의 수를 못 박고, 그 수를 `player-page.ts` 의 **화면 문자열**과도
 * 맞대고 있었다. 그래서 **경기가 하나 들어올 때마다 떨어졌다** — 08-19 경기가 들어오자
 * CI 에서 곧바로 붉어졌고(로컬 08-16 스냅샷은 통과), 시즌 중에는 **매일** 그렇게 된다.
 * 사람이 매일 손으로 고쳐야 하는 시험은 결국 무시되고, 그때 진짜 회귀가 같이 묻힌다.
 *
 * → 둘로 갈랐다:
 *   ⑴ **화면**은 수를 DB 에서 읽는다(`leagueStealTotals`). 사람이 안 고쳐도 늘 참이고,
 *      배포물 대 DB 대조는 `packages/web/test/steal-note-dist.test.ts` 가 한다.
 *   ⑵ **주석·정의서**는 **완결 시즌**의 수만 인용한다. 완결 시즌은 경기가 늘지 않는다.
 *
 * ## ⚠「완결 시즌」은 이제 고정 범위다 — `DOC_SEASONS` (2026-10-24)
 *
 * ~~12팀이 그 시즌의 경기 수를 채웠는가로 판정하고, 그 목록을 여기서 못 박아 「백필했거나 시즌이 끝나면 여기서 먼저 떨어진다」~~ 였다.
 * **그 「먼저 떨어진다」가 배포를 막았다** — 2026-10-08 정규시즌이 끝난 날 이 파일 2본이 붉어졌다(고정 수치 시험 전체로는 13본).
 * → 세는 범위는 `@bb-app/domain` 의 `DOC_SEASONS` 한 벌이고(M1), 「시즌이 끝났다 · 백필했다」는 **수집 로그가 비차단으로 알린다**
 *   (`scripts/freshness.ts`). 범위를 올리는 날 이 파일이 붉어지는 것은 정상이다 — 절차는 `docs/operations.md` 「해마다 하는 일」.
 * ⚠**데이터 판정(`settledSeasons`)은 가드로만 남는다** — 「고정 범위가 이 DB 에서 정말 완결인가」(경기를 잃지 않았는가).
 * ⚠**정규시즌만**(§2-1) · **미성립 경기 제외**.
 *
 * ⚠**DB 가 없으면 건너뛴다.** CI 는 `BB_REQUIRE_DB=1` 로 막는다(작업규칙 7·8).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { openDb } from "@bb-app/store";
import type { Db } from "@bb-app/store";
import { DOC_SEASONS } from "@bb-app/domain";
import { leagueStealTotals } from "../src/steal.ts";
import { settledSeasons } from "./published.ts";

const DB = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "data", "bb.sqlite");
const HAS_DB = existsSync(DB);
if (process.env["BB_REQUIRE_DB"] === "1" && !HAS_DB) {
  throw new Error(`BB_REQUIRE_DB=1 인데 ${DB} 가 없다`);
}

const THROUGH = "9999-12-31";

/**
 * ⚠**출하 코드와 다른 판정으로 센다**(작업규칙 9의 정신). `leagueStealTotals` 가 행을
 * 흘리면 그 함수로 만든 기대값과 그 함수의 답이 **같이** 틀려서 아무것도 안 잡힌다.
 */
const RAW = `
SELECT r.kind AS kind, r.base AS base, r.double_steal AS ds, COUNT(*) AS n
FROM runner_event r JOIN game g ON g.game_id = r.game_id
WHERE g.status = 'played' AND g.competition = 'regular' AND g.season = ?
GROUP BY r.kind, r.base, r.double_steal
`;

interface RawRow { kind: string; base: string; ds: number; n: number }

/** 완결 시즌만 골라 직접 센다 */
function rawSettled(db: Db, settled: ReadonlySet<number>): {
  get: (kind: string, base: string) => number;
  doubleSteal: (base: string) => number;
  total: number;
} {
  const by = new Map<string, number>();
  const ds = new Map<string, number>();
  let total = 0;
  for (const season of settled) {
    for (const r of db.raw.prepare(RAW).all(season) as unknown as RawRow[]) {
      const n = Number(r.n);
      by.set(`${r.kind}|${r.base}`, (by.get(`${r.kind}|${r.base}`) ?? 0) + n);
      total += n;
      if (r.kind === "steal" && Number(r.ds) === 1) ds.set(r.base, (ds.get(r.base) ?? 0) + n);
    }
  }
  return {
    get: (kind, base) => by.get(`${kind}|${base}`) ?? 0,
    doubleSteal: (base) => ds.get(base) ?? 0,
    total,
  };
}

/**
 * ⚠**고정 범위가 이 DB 에서 정말 완결인가** — `DOC_SEASONS ⊆ settledSeasons(db)`.
 *
 * ~~완결 시즌 목록이 `[2018..2025]` 와 **같다**~~ 를 못 박았었다. 그 「같다」는 시즌이 끝나는 날 거짓이 되어
 * **배포를 막았다**(2026-10-08). 이제 묻는 것은 **포함**이다 — 범위의 시즌이 전부 12팀 규정 경기수를 채웠는가.
 * 이게 떨어지면 아래 수치가 틀린 것이 아니라 **DB 가 경기를 잃었거나 범위를 잘못 올린 것**이다.
 * ⚠**범위 밖의 완결 시즌(정규시즌이 끝난 2026 등)은 여기서 안 막는다** — 그건 수집 로그가 비차단으로 알린다.
 */
test("⚠고정 범위(DOC_SEASONS)는 이 DB 에서 전부 완결이다 — 범위 밖의 완결 시즌은 막지 않는다", { skip: HAS_DB ? false : "DB 없음" }, () => {
  const db = openDb(DB, "1970-01-01T00:00:00.000Z");
  try {
    const settled = settledSeasons(db);
    const missing = DOC_SEASONS.filter((s) => !settled.has(s));
    assert.deepEqual(
      missing,
      [],
      `고정 범위의 시즌 중 이 DB 에서 완결이 아닌 것: ${missing.join("·")} — 경기를 잃었거나 범위를 너무 일찍 올렸다. ` +
        `(이 DB 의 완결 시즌: ${[...settled.keys()].sort((a, b) => a - b).join("·")})`,
    );
  } finally {
    db.close();
  }
});

/**
 * ⚠**루별 수치는 코드 주석·정의서에 흩어져 있다**(`steal.ts` · `docs/metrics/README.md` §1-A).
 * 그쪽은 화면이 아니라 읽는 사람용이지만, 낡으면 다음 사람이 그 수를 믿고 판단한다.
 * 여기서 한 번에 고정해 **백필 때 같이 고치게** 만든다.
 *
 * ⚠**고정 범위(`DOC_SEASONS`)만이다** — 진행 중 시즌을 넣으면 매일 붉어진다(이 파일 표제부 참조).
 * 실측(2026-08-20 · 2018〜2025 정규시즌): 08-16 로컬 스냅샷과 08-19 CI DB 에서 **같은 값**이었다.
 */
test("⚠루별 도루·도루자·견제사가 문서에 적힌 수와 같다 — 완결 시즌", { skip: HAS_DB ? false : "DB 없음" }, () => {
  const db = openDb(DB, "1970-01-01T00:00:00.000Z");
  try {
    const c = rawSettled(db, new Set(DOC_SEASONS));
    // 공회전 방지: 주자 사건을 하나도 못 읽으면 아래 단언이 전부 0 대 0이 된다
    assert.ok(c.total > 10000, `주자 사건을 ${c.total}건밖에 못 읽었다 — 이 시험이 공회전한다`);

    assert.deepEqual(
      {
        sb: { "2b": c.get("steal", "2b"), "3b": c.get("steal", "3b"), home: c.get("steal", "home") },
        cs: {
          "2b": c.get("caughtStealing", "2b"),
          "3b": c.get("caughtStealing", "3b"),
          home: c.get("caughtStealing", "home"),
        },
        pickoff: {
          "1b": c.get("pickoff", "1b"),
          "2b": c.get("pickoff", "2b"),
          "3b": c.get("pickoff", "3b"),
        },
        doubleSteal: { "2b": c.doubleSteal("2b"), "3b": c.doubleSteal("3b"), home: c.doubleSteal("home") },
      },
      {
        sb: { "2b": 6877, "3b": 267, home: 44 },
        cs: { "2b": 2998, "3b": 117, home: 142 },
        pickoff: { "1b": 360, "2b": 120, "3b": 19 },
        doubleSteal: { "2b": 99, "3b": 65, home: 38 },
      },
      "루별 수치가 바뀌었다 — 고정 범위(DOC_SEASONS)를 올렸다면 정상이다: 이 표와 " +
        "packages/aggregate/src/steal.ts 의 주석 · docs/metrics/README.md §1-A 를 같이 고쳐라(docs/operations.md 「해마다 하는 일」)",
    );
    // ⚠**1루를 훔칠 수는 없다**(실측 0). 여기 수가 생기면 데이터나 파서가 이상한 것이다
    assert.equal(c.get("steal", "1b"), 0, "1루 도루가 생겼다 — 데이터나 파서를 의심하라");
    // ⚠**「본루만 실패가 성공보다 많다」는 정의서·화면 각주의 주장 자체**다. 뒤집히면 문구가 거짓이 된다
    assert.ok(
      c.get("caughtStealing", "home") > c.get("steal", "home"),
      `本盗 는 실패가 더 많다고 문서가 말하는데 성공 ${c.get("steal", "home")} · 실패 ${c.get("caughtStealing", "home")} 이다`,
    );
  } finally {
    db.close();
  }
});

/**
 * ⚠**화면이 부르는 함수가 같은 답을 내는가**(M1).
 *
 * 위 시험은 SQL 을 직접 써서 센다. 화면은 `leagueStealTotals()` 를 부른다 —
 * **두 벌이 갈리면 문서는 맞는데 화면만 틀린** 상태가 되고, 그건 배포물 대조가 잡기 전까지 조용하다.
 * 여기서 두 답을 맞대 그 창을 닫는다.
 */
test("⚠leagueStealTotals 가 직접 센 것과 같다 — 화면이 쓰는 함수다", { skip: HAS_DB ? false : "DB 없음" }, () => {
  const db = openDb(DB, "1970-01-01T00:00:00.000Z");
  try {
    // ⚠범위는 `DOC_SEASONS` 한 벌이다(M1) — 위 시험과 같은 범위를 맞대야 「문서는 맞는데 화면만 틀린」 창이 닫힌다
    const settled = [...DOC_SEASONS];
    const raw = rawSettled(db, new Set(settled));
    const got = leagueStealTotals(db, "regular", THROUGH, settled[0]!, settled[settled.length - 1]!);
    assert.deepEqual(got.seasons, settled, "함수가 본 시즌이 완결 시즌과 다르다");
    for (const base of ["1b", "2b", "3b", "home"] as const) {
      assert.equal(got.sbByBase[base], raw.get("steal", base), `盗塁 ${base} 가 다르다`);
      assert.equal(got.csByBase[base], raw.get("caughtStealing", base), `盗塁刺 ${base} 가 다르다`);
      assert.equal(got.pickoffByBase[base], raw.get("pickoff", base), `牽制死 ${base} 가 다르다`);
      assert.equal(got.doubleStealByBase[base], raw.doubleSteal(base), `ダブルスチール ${base} 가 다르다`);
    }
  } finally {
    db.close();
  }
});
