/**
 * **화면의 wOBA 가 「우리가 유도한 리그·시즌 계수」로 계산됐는가** — DB 로 재서 못 박는다.
 *
 * ⚠**이 시험이 막는 것은 「조용히 폴백으로 떨어지는 것」이다**(2026-08-20).
 * `leagueConstants` 는 선형가중치를 **안 주면 폴백 계수**로 떨어진다. 그 경로는 던지지도 않고
 * 화면도 안 바뀐다 — **값만 조금 밀린다**(실측 자격자 중앙 약 1 wRC+). 눈으로는 안 잡히고,
 * 타입도 린트도 못 잡는다. 그런데 **용어집이 「係数は当サイトがリーグ・シーズンごとに算出」이라고
 * 화면에 쓰고 있으므로**, 폴백으로 떨어지는 순간 그 문장이 거짓이 된다.
 *
 * ## 무엇으로 판정하는가
 *
 * 유도한 계수에는 **정의상 참인 성질**이 하나 있다:
 * **그 리그의 평균 wOBA = 그 리그의 출루율.** 폴백 계수에는 그 성질이 없다.
 * → 순위표에 실린 wOBA 값을 **선수의 성적 한 줄에서 두 벌로 다시 계산**해서,
 *   **유도값 쪽과만** 맞는지를 본다.
 *
 * ⚠**기대값을 손으로 적지 않는다** — 계수도 값도 DB 에서 만든다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { openDb } from "@bb-app/store";
import { TEAMS } from "@bb-app/domain";
import type { League } from "@bb-app/domain";
import {
  aggregateSeason,
  buildRunExpectancy,
  deriveRunValues,
} from "@bb-app/aggregate";
import {
  WOBA_WEIGHTS,
  onBasePercentage,
  sumBatting,
  wobaRawWith,
  wobaWeightsFrom,
} from "@bb-app/metrics";
import { loadSite } from "../src/query.ts";

const DB = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "data", "bb.sqlite");
const HAS_DB = existsSync(DB);
if (process.env["BB_REQUIRE_DB"] === "1" && !HAS_DB) {
  throw new Error(`BB_REQUIRE_DB=1 인데 ${DB} 가 없다`);
}
/** ⚠**기본은 한 시즌, CI 는 전 시즌** — `ranking-min-sample.test.ts` 와 같은 형식 */
const FULL = process.env["BB_FULL_SCAN"] === "1";
const BUILT_ON = "2026-08-20";

/** 어느 시즌을 볼 것인가 — **DB 에 물어본다.** 목록을 손으로 적으면 백필할 때 낡는다 */
function seasonsToScan(db: ReturnType<typeof openDb>): number[] {
  const rows = db.raw
    .prepare(
      `SELECT season AS s, COUNT(*) AS n FROM game
        WHERE competition = 'regular' AND status = 'played'
        GROUP BY season HAVING n > 100 ORDER BY season DESC`,
    )
    .all() as { s: number }[];
  const all = rows.map((r) => r.s);
  return FULL ? all : all.slice(0, 1);
}

test(
  "⚠순위표의 wOBA 는 리그·시즌 유도 계수로 계산돼 있다 — 폴백으로 떨어지면 여기서 잡힌다",
  { skip: HAS_DB ? false : "DB 없음" },
  () => {
    const db = openDb(DB, "1970-01-01T00:00:00.000Z");
    try {
      const seasons = seasonsToScan(db);
      assert.ok(seasons.length > 0, "볼 시즌이 없다 — 이 시험이 공회전한다");
      let checked = 0;

      for (const season of seasons) {
        const site = loadSite(db, { season, builtOn: BUILT_ON });
        const agg = aggregateSeason(db, season);

        for (const league of ["central", "pacific"] as const) {
          const codes = TEAMS.filter((t) => t.league === league).map((t) => t.code);
          const lines = agg.battingByLeague.filter((b) => b.league === league);
          if (lines.length === 0) continue;

          // 화면과 **같은 재료**로 계수를 다시 만든다
          const re = buildRunExpectancy(db, season, league, codes, "regular");
          assert.ok(re.totalPa > 0, `${season} ${league}: 타석 로그가 없다 — 이 시험이 공회전한다`);
          const rv = deriveRunValues(db, re, codes, "regular").runValues;
          const leagueLine = sumBatting(lines.map((b) => b.line));
          const { weights } = wobaWeightsFrom(rv, leagueLine, `(${season} ${league})`);

          /**
           * ⚠**두 계수가 실제로 다른가부터 확인한다.** 우연히 같으면 아래 판정이 아무것도
           * 안 말하는데, 그건 「통과」가 아니라 **공회전**이다(작업규칙 8).
           */
          const fallbackWoba = wobaRawWith(leagueLine, WOBA_WEIGHTS)!;
          const derivedWoba = wobaRawWith(leagueLine, weights)!;
          assert.ok(
            Math.abs(fallbackWoba - derivedWoba) > 1e-6,
            `${season} ${league}: 폴백과 유도값이 같아서 이 시험이 아무것도 못 가른다`,
          );
          // 유도값 쪽만 리그 출루율과 일치한다 — 이것이 판정의 근거다
          assert.ok(Math.abs(derivedWoba - onBasePercentage(leagueLine).value!) < 1e-12);

          // ⚠**화면이 실제로 내보내는 자리에서 읽는다** — 중간 계산이 아니라 순위표 패널이다
          const panel = site.ranking.leagues
            .find((s) => s.id === league)
            ?.categories.flatMap((c) => c.panels)
            .find((p) => p.id === "woba");
          assert.notEqual(panel, undefined, `${season} ${league}: wOBA 패널이 없다`);

          const byId = new Map(lines.map((b) => [b.playerId, b.line]));
          let compared = 0;
          for (const row of panel!.rows) {
            const line = byId.get(row.playerId);
            if (line === undefined || row.value.value === null) continue;
            const derived = wobaRawWith(line, weights)!;
            const fallback = wobaRawWith(line, WOBA_WEIGHTS)!;
            assert.ok(
              Math.abs(row.value.value - derived) < 1e-12,
              `${season} ${league} ${row.name}: 화면 ${row.value.value} · 유도값 ${derived} · 폴백 ${fallback}`,
            );
            compared += 1;
          }
          assert.ok(compared > 10, `${season} ${league}: ${compared}행밖에 못 맞댔다 — 공회전이다`);
          checked += 1;
        }
      }
      assert.ok(checked >= 2, `리그-시즌 ${checked}개밖에 못 봤다 — 이 시험이 공회전한다`);
    } finally {
      db.close();
    }
  },
);
