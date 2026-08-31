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
/**
 * ⚠**기본은 한 시즌, 깊은 실행은 전 시즌** — `ranking-min-sample.test.ts` 와 같은 형식.
 *
 * ⚠**이름이 `BB_FULL_SCAN` 이 아니다**(2026-08-31). 그 값은 **페이지 표본**과 **시즌 범위**라는
 * 서로 다른 두 가지를 겸하고 있었고, **켠 근거로 적힌 것은 페이지 쪽뿐**이었다.
 * 비용은 시즌 쪽에서 났다 — CI 실측(run 33379836307)으로 **이 본 하나가 150.7초**이고
 * `ranking-min-sample` 과 합쳐 **시험 490초의 60%** 다. 사유 전문은 그 파일에 있다.
 */
const FULL = process.env["BB_ALL_SEASONS"] === "1";
const BUILT_ON = "2026-08-20";

/**
 * 어느 시즌을 볼 것인가 — **DB 에 물어본다.** 목록을 손으로 적으면 백필할 때 낡는다.
 *
 * ⚠**`HAVING n > 100` 이었다**(2026-08-21 검토 P2-③). 그러면 **리그 총 100경기 미만인 시즌이
 * 통째로 검사 밖**이었다 — 그건 개막 후 2~3주이고, **하필 폴백이 가장 나기 쉬운 때**다
 * (박스는 들어왔는데 타석 로그 적재가 아직 안 붙은 상태). 그물이 가장 필요한 구간에 그물이 없었다.
 * ⚠**지금 DB 에서는 이 완화가 아무것도 바꾸지 않는다**(2018~2026 전부 600경기 이상 · 실측).
 * 바뀌는 것은 **다음 개막 직후**다.
 */
function seasonsToScan(db: ReturnType<typeof openDb>): number[] {
  const rows = db.raw
    .prepare(
      `SELECT season AS s, COUNT(*) AS n FROM game
        WHERE competition = 'regular' AND status = 'played'
        GROUP BY season HAVING n > 0 ORDER BY season DESC`,
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

        /**
         * ⚠**「0건」과 「안 쟀음」을 구별한다**(작업규칙 7 · 2026-08-21 검토 P2-②).
         * `deriveRunValues` 가 세는 `skipped`·`unrecognized` 는 예전에 화면 경로에서
         * **그 줄에서 버려졌다.** 지금은 `SiteData` 까지 나오고 빌드가 그것으로 배포를 막는다 —
         * **여기서 실데이터로 「0 인 것이 정상」을 못 박는다.**
         */
        assert.deepEqual(
          [...site.wobaDerivation].sort((a, b) => a.league.localeCompare(b.league)),
          [
            { league: "central", fellBack: false, skipped: 0, unrecognized: 0 },
            { league: "pacific", fellBack: false, skipped: 0, unrecognized: 0 },
          ],
          `${season}: wOBA 계수 유도가 온전하지 않다 — 폴백으로 떨어졌거나 미계산·미상 타석이 있다`,
        );

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
