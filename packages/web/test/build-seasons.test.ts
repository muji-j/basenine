/**
 * **빌드 시즌 목록의 순수 판정**(`../src/build-seasons.ts` · PR-4 설계 D4 · 3중 검토 반영 ①②).
 *
 * ⚠**빌드를 띄워 재는 쪽은 `build-gates.test.ts` 다**(그 판정이 `rmSync(outDir)` 앞에서 실제로 쓰이는가 · 기존 dist 가 남는가).
 *   여기서는 **판정식의 각 갈래**를 잰다 — 자식 빌드 하나가 1초 안팎이라 갈래마다 빌드를 띄우지 않는다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFER_MAX_GAME_DAYS, PUBLIC_SEASON_FLOOR, deferNewestSeason, deferNotice, resolveBuildSeasons } from "../src/build-seasons.ts";
import type { BuildSeasons, Parsed } from "../src/build-seasons.ts";

const AUTO = { kind: "auto" } as const;
const list = (...seasons: number[]): { kind: "list"; seasons: number[] } => ({ kind: "list", seasons });
const range = (from: number, to: number): number[] => Array.from({ length: to - from + 1 }, (_, i) => from + i);

function ok(r: Parsed<BuildSeasons>): BuildSeasons {
  assert.ok(r.ok, r.ok ? "" : `실패했다:\n${r.message}`);
  return r.value;
}
function fail(r: Parsed<BuildSeasons>): string[] {
  assert.ok(!r.ok, "실패해야 하는데 통과했다");
  return r.message.split("\n");
}

test("⚠공개 하한은 2018 이다 — 보유 9시즌(2018~2026)의 첫 시즌", () => {
  assert.equal(PUBLIC_SEASON_FLOOR, 2018);
});

test("auto — 하한 이상 치른 시즌 전부 · 내림차순 · 최댓값이 루트 · 경고 없음(실측 모양 2018~2026 연속)", () => {
  const v = ok(resolveBuildSeasons(AUTO, range(2018, 2026)));
  assert.deepEqual(v.seasons, range(2018, 2026).reverse());
  assert.deepEqual(v.warnings, []);
});

test("⚠auto — 새 시즌(최신 + 1)은 하한과 무관하게 자동으로 든다", () => {
  assert.deepEqual(ok(resolveBuildSeasons(AUTO, range(2018, 2027))).seasons[0], 2027);
});

test("⚠⚠auto — 하한 아래 치른 시즌(2017)은 굽지 않고 경고 한 줄 · 실패가 아니다", () => {
  const v = ok(resolveBuildSeasons(AUTO, [2017, ...range(2018, 2026)]));
  assert.ok(!v.seasons.includes(2017), "하한 아래 시즌을 굽는 목록에 넣었다 — 품질을 안 잰 소급 시즌이 공개된다");
  assert.deepEqual(v.seasons, range(2018, 2026).reverse());
  assert.equal(v.warnings.length, 1);
  assert.match(v.warnings[0]!, /^::warning::공개 하한\(2018\) 아래 치른 시즌 2017 은 굽지 않는다/);
  assert.match(v.warnings[0]!, /품질을 재고/);
  assert.match(v.warnings[0]!, /통산 집계·「収録」 범위에는 이미 들어간다/, "화면 밖으로 새는 몫(통산)을 말하지 않는다");
});

test("⚠⚠구멍 — 하한~최신 사이에 치른 경기가 없는 시즌이 있으면 실패(가운데 · 하한 자신 · 둘 다)", () => {
  const mid = fail(resolveBuildSeasons(AUTO, [2018, 2020]));
  assert.equal(mid.length, 1, mid.join("\n"));
  assert.match(mid[0]!, /공개 하한\(2018\)~최신\(2020\) 사이에 치른 경기가 없는 시즌이 있다: 2019 —/);
  // ⚠하한 자신이 빠진 경우 — 범위를 「가진 시즌의 최솟값부터」로 잡으면 이것을 못 본다(하한 시즌이 조용히 사라진다)
  assert.match(fail(resolveBuildSeasons(AUTO, [2019, 2020]))[0]!, /치른 경기가 없는 시즌이 있다: 2018 —/);
  assert.match(fail(resolveBuildSeasons(AUTO, [2019, 2021]))[0]!, /치른 경기가 없는 시즌이 있다: 2018·2020 —/);
  // 명시 목록도 같다 — 구멍은 인자가 아니라 DB 의 상태다
  assert.match(fail(resolveBuildSeasons(list(2020, 2018), [2018, 2020]))[0]!, /치른 경기가 없는 시즌이 있다: 2019 —/);
});

test("⚠구멍 판정은 하한 아래를 보지 않는다 — 2016·2018 이 있어도 2017 은 구멍이 아니다", () => {
  const v = ok(resolveBuildSeasons(AUTO, [2016, 2018, 2019]));
  assert.deepEqual(v.seasons, [2019, 2018]);
  assert.equal(v.warnings.length, 1);
  assert.match(v.warnings[0]!, /치른 시즌 2016 은/);
});

test("auto — 하한 이상 치른 시즌이 0 이면 실패(하한 아래만 있어도) · 구멍 줄은 안 낸다", () => {
  for (const played of [[], [2017], [2010, 2017]]) {
    const lines = fail(resolveBuildSeasons(AUTO, played));
    assert.equal(lines.length, 1, lines.join("\n"));
    assert.match(lines[0]!, /공개 하한\(2018\) 이상 치른 경기가 있는 시즌이 하나도 없다/);
  }
});

test("명시 목록 — 목록 밖의 치른 시즌(하한 이상)이 있으면 실패 · 그 줄만 낸다", () => {
  const lines = fail(resolveBuildSeasons(list(2019), [2018, 2019]));
  assert.equal(lines.length, 1, lines.join("\n"));
  assert.match(lines[0]!, /치른 경기가 있는 시즌이 시즌 목록\(2019\)에 없다: 2018 —/);
});

test("명시 목록 — 실패 사유가 여럿이면 전부 한 메시지에 줄로(구멍 · 목록 밖)", () => {
  const lines = fail(resolveBuildSeasons(list(2020), [2018, 2020]));
  assert.equal(lines.length, 2, lines.join("\n"));
  assert.match(lines[0]!, /치른 경기가 없는 시즌이 있다: 2019/);
  assert.match(lines[1]!, /시즌 목록\(2020\)에 없다: 2018/);
});

test("명시 목록 — 입력 순서는 뜻이 없다(내림차순) · 목록에 적은 하한 아래 시즌은 사람이 고른 것이라 굽고 경고하지 않는다", () => {
  assert.deepEqual(ok(resolveBuildSeasons(list(2018, 2019), [2018, 2019])).seasons, [2019, 2018]);
  const v = ok(resolveBuildSeasons(list(2017, 2019, 2018), [2017, 2018, 2019]));
  assert.deepEqual(v.seasons, [2019, 2018, 2017]);
  assert.deepEqual(v.warnings, []);
  // 목록에 안 적은 하한 아래 시즌은 auto 와 같이 경고한다
  const w = ok(resolveBuildSeasons(list(2019, 2018), [2016, 2018, 2019])).warnings;
  assert.equal(w.length, 1);
  assert.match(w[0]!, /치른 시즌 2016 은/);
});

test("하한 인자 — 시험에서만 넘긴다(기본은 PUBLIC_SEASON_FLOOR)", () => {
  assert.deepEqual(ok(resolveBuildSeasons(AUTO, [2010, 2011], 2010)).seasons, [2011, 2010]);
  assert.match(fail(resolveBuildSeasons(AUTO, [2011], 2010))[0]!, /공개 하한\(2010\)~최신\(2011\) 사이에 치른 경기가 없는 시즌이 있다: 2010/);
});

// ── 새 시즌 유예(반영 ① · 조정자 결정 ⒜) — 조건 넷이 전부 서야 한다 ─────────────────────────

const BASE = { kind: "auto", seasons: [2027, 2026, 2025], failedSeason: 2027, failedSeasonOver: false, gameDays: 1 } as const;

test("⚠미루는 상한은 7경기일이다 — 실측 최댓값(2경기일 미뤄짐 · 3경기일째 이후 0/9)의 여유", () => {
  assert.equal(DEFER_MAX_GAME_DAYS, 7);
});

test("⚠⚠유예 — auto · 실패한 시즌이 굽는 목록의 최대 · 아직 안 끝남 · 남는 시즌이 있다 · 개막 직후(상한 이하) → 유예한다", () => {
  assert.equal(deferNewestSeason(BASE), true);
  assert.equal(deferNewestSeason({ ...BASE, gameDays: DEFER_MAX_GAME_DAYS }), true, "상한 당일을 유예하지 않았다");
});

test("⚠⚠유예하지 않는다 — 조건 하나라도 빠지면(명시 목록 · 최대가 아님 · 끝난 시즌 · 남는 시즌 없음 · 개막 직후가 아님)", () => {
  assert.equal(deferNewestSeason({ ...BASE, kind: "list" }), false, "명시 목록인데 유예했다 — 사람이 그 시즌을 적었다");
  assert.equal(deferNewestSeason({ ...BASE, failedSeason: 2026 }), false, "최대가 아닌 시즌의 표본 0 을 유예했다 — 끝난 시즌의 데이터 결함이다");
  assert.equal(deferNewestSeason({ ...BASE, failedSeasonOver: true }), false, "끝난 시즌의 표본 0 을 유예했다 — 개막 직후가 아니다");
  assert.equal(deferNewestSeason({ ...BASE, seasons: [2027] }), false, "남는 시즌이 없는데 유예했다 — 빈 사이트가 된다");
  assert.equal(
    deferNewestSeason({ ...BASE, gameDays: DEFER_MAX_GAME_DAYS + 1 }),
    false,
    "시즌 도중의 표본 0 을 유예했다 — 파서·적재 회귀가 「아직 이르다」로 읽혀 현재 시즌이 사이트에서 빠진 채 종료 0 이 된다",
  );
});

test("유예 경고 — 사유 · 시즌 · 개막 며칠째(첫 경기) · 이번 루트를 한 줄로", () => {
  const line = deferNotice({ season: 2027, reason: "central 의 triple 표본 0", gameDays: 2, firstDate: "2027-03-26", root: 2026 });
  assert.match(line, /^::warning::2027 시즌은 아직 굽지 않는다 — 계수 유도 표본이 서지 않았다\(central 의 triple 표본 0\)/);
  assert.match(line, /개막 2경기일째\(첫 경기 2027-03-26\)/);
  assert.match(line, /이번 배포는 2026 시즌이 루트다/);
  assert.ok(!line.includes("\n"), "경고가 한 줄이 아니다");
  assert.doesNotMatch(deferNotice({ season: 2027, reason: "x", gameDays: 0, firstDate: null, root: 2026 }), /첫 경기/);
});
