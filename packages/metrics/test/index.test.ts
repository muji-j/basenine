import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import * as metrics from "../src/index.ts";

test("공개 API가 전부 노출된다", () => {
  for (const name of [
    "rate", "singles", "totalBases", "inningsPitched",
    "battingAverage", "onBasePercentage", "sluggingPercentage", "ops", "iso", "babip",
    "strikeoutRate", "walkRate",
    "earnedRunAverage", "whip", "strikeoutsPer9", "walksPer9", "homeRunsPer9",
    "sumBatting", "sumPitching", "leagueConstants",
    "WOBA_WEIGHTS", "WOBA_SCALE", "woba", "wobaRaw", "wraa", "wrcPlus", "fip",
    "qualifiedBatterPa", "qualifiedPitcherOuts", "rankBy",
  ]) {
    assert.ok(name in metrics, `${name}이(가) 공개되지 않았다`);
  }
});

/**
 * ⚠순수성이 이 패키지의 존재 이유다(M1).
 * I/O가 한 줄이라도 들어오는 순간 서버·배치·클라가 같은 1벌을 쓴다는 전제가 무너진다.
 */
test("⚠이 패키지는 I/O를 하지 않고 시계를 직접 읽지 않는다", async () => {
  const dir = new URL("../src/", import.meta.url);
  const files = (await readdir(dir)).filter((f) => f.endsWith(".ts"));
  assert.ok(files.length > 0, "검사 대상이 0건이면 이 테스트는 아무것도 재지 않는다");

  for (const f of files) {
    const src = await readFile(new URL(f, dir), "utf8");
    assert.doesNotMatch(src, /from ["']node:(fs|http|https|net|child_process|crypto)/, `${f}에 I/O import가 있다`);
    assert.doesNotMatch(src, /\bfetch\s*\(/, `${f}에 fetch 호출이 있다`);
    assert.doesNotMatch(src, /new Date\(|Date\.now\(/, `${f}에 시계 직접 호출이 있다 (M6)`);
  }
});

test("런타임 의존성이 없다", async () => {
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(pkg.dependencies, undefined, "이 패키지에 런타임 의존성을 추가하지 않는다");
});
