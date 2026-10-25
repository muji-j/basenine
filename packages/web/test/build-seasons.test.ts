/**
 * **빌드 시즌 목록의 순수 판정**(`../src/build-seasons.ts` · PR-4 설계 D4 · 3중 검토 반영 ①②).
 *
 * ⚠**빌드를 띄워 재는 쪽은 `build-gates.test.ts` 다**(그 판정이 `rmSync(outDir)` 앞에서 실제로 쓰이는가 · 기존 dist 가 남는가).
 *   여기서는 **판정식의 각 갈래**를 잰다 — 자식 빌드 하나가 1초 안팎이라 갈래마다 빌드를 띄우지 않는다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFER_MAX_GAME_DAYS, PUBLIC_SEASON_FLOOR, deferNewestSeason, deferNotice, resolveBuildSeasons } from "../src/build-seasons.ts";
import type { Parsed } from "../src/build-seasons.ts";

const AUTO = { kind: "auto" } as const;
const list = (...seasons: number[]): { kind: "list"; seasons: number[] } => ({ kind: "list", seasons });
const range = (from: number, to: number): number[] => Array.from({ length: to - from + 1 }, (_, i) => from + i);
/** DB 의 두 목록 — 치른 시즌 · 경기 행이 있는 시즌(상태 무관 · `extra` 는 중지 경기만 있는 시즌) */
const db = (played: readonly number[], extra: readonly number[] = []): { played: number[]; withGames: number[] } => ({
  played: [...played],
  withGames: [...played, ...extra],
});

function ok(r: Parsed<number[]>): number[] {
  assert.ok(r.ok, r.ok ? "" : `실패했다:\n${r.message}`);
  return r.value;
}
function fail(r: Parsed<number[]>): string[] {
  assert.ok(!r.ok, "실패해야 하는데 통과했다");
  return r.message.split("\n");
}

test("⚠공개 하한은 2018 이다 — 보유 9시즌(2018~2026)의 첫 시즌", () => {
  assert.equal(PUBLIC_SEASON_FLOOR, 2018);
});

test("auto — 하한 이상 치른 시즌 전부 · 내림차순 · 최댓값이 루트(실측 모양 2018~2026 연속)", () => {
  assert.deepEqual(ok(resolveBuildSeasons(AUTO, db(range(2018, 2026)))), range(2018, 2026).reverse());
});

test("⚠auto — 새 시즌(최신 + 1)은 하한과 무관하게 자동으로 든다", () => {
  assert.deepEqual(ok(resolveBuildSeasons(AUTO, db(range(2018, 2027))))[0], 2027);
});

/**
 * ⚠⚠**하한 아래 시즌의 경기가 DB 에 있으면 멈춘다**(fail-closed · 2026-10-25 조정자 결정 · 옛 명시 목록 시절과 같다).
 * 화면은 안 굽지만 통산·「収録」 범위·드래프트 꼬리말(`query.ts` 의 `heldSeasonsOf` · `build.ts` 의 `held`)에 그 시즌이 섞인다 —
 * 품질을 안 잰 시즌의 통산을 조용히 내보내는 것이다(M7 · M11).
 */
test("⚠⚠하한 아래 시즌의 경기가 있으면 실패 — auto · 명시 목록(그 시즌을 적어도) 둘 다 · 사유와 처치(하한을 내리거나 보관소에서 빼라 · 런북 §7-L)를 말한다", () => {
  for (const arg of [AUTO, list(2026, 2025, 2024, 2023, 2022, 2021, 2020, 2019, 2018), list(2026, 2025, 2024, 2023, 2022, 2021, 2020, 2019, 2018, 2017)]) {
    const lines = fail(resolveBuildSeasons(arg, db([2017, ...range(2018, 2026)])));
    const below = lines.filter((l) => l.includes("아래 시즌의 경기가 DB 에 있다"));
    assert.equal(below.length, 1, `${JSON.stringify(arg)}:\n${lines.join("\n")}`);
    assert.match(below[0]!, /공개 하한\(2018\) 아래 시즌의 경기가 DB 에 있다: 2017 —/);
    assert.match(below[0]!, /통산/, "왜 막는지(통산에 섞인다) 안 말한다");
    assert.match(below[0]!, /품질을 재고/);
    assert.match(below[0]!, /공개 하한\(PUBLIC_SEASON_FLOOR\)을 내리거나 그 시즌을 보관소에서 빼라/);
    assert.match(below[0]!, /§7-L/, "런북 절을 안 가리킨다");
  }
});

test("⚠⚠하한 아래 시즌이 중지 경기만 있어도 실패 — 「収録」 범위(`heldSeasonsOf`)는 상태를 안 가린다", () => {
  const lines = fail(resolveBuildSeasons(AUTO, db(range(2018, 2026), [2017])));
  assert.equal(lines.length, 1, lines.join("\n"));
  assert.match(lines[0]!, /아래 시즌의 경기가 DB 에 있다: 2017 —/);
});

test("⚠드래프트만 있는 하한 아래 시즌(경기 행 0)은 해당 없다 — 그 시즌은 이 판정의 입력에 없다(드래프트 한 장은 빌드가 따로 굽는다)", () => {
  assert.deepEqual(ok(resolveBuildSeasons(AUTO, db(range(2018, 2026)))), range(2018, 2026).reverse());
});

test("⚠⚠구멍 — 하한~최신 사이에 치른 경기가 없는 시즌이 있으면 실패(가운데 · 하한 자신 · 둘 다)", () => {
  const mid = fail(resolveBuildSeasons(AUTO, db([2018, 2020])));
  assert.equal(mid.length, 1, mid.join("\n"));
  assert.match(mid[0]!, /공개 하한\(2018\)~최신\(2020\) 사이에 치른 경기가 없는 시즌이 있다: 2019 —/);
  // ⚠하한 자신이 빠진 경우 — 범위를 「가진 시즌의 최솟값부터」로 잡으면 이것을 못 본다(하한 시즌이 조용히 사라진다)
  assert.match(fail(resolveBuildSeasons(AUTO, db([2019, 2020])))[0]!, /치른 경기가 없는 시즌이 있다: 2018 —/);
  assert.match(fail(resolveBuildSeasons(AUTO, db([2019, 2021])))[0]!, /치른 경기가 없는 시즌이 있다: 2018·2020 —/);
  // 명시 목록도 같다 — 구멍은 인자가 아니라 DB 의 상태다
  assert.match(fail(resolveBuildSeasons(list(2020, 2018), db([2018, 2020])))[0]!, /치른 경기가 없는 시즌이 있다: 2019 —/);
  // 중지 경기만 있는 시즌은 구멍이다(치른 경기로 센다)
  assert.match(fail(resolveBuildSeasons(AUTO, db([2018, 2020], [2019])))[0]!, /치른 경기가 없는 시즌이 있다: 2019 —/);
});

test("⚠구멍 판정은 하한 아래를 보지 않는다 — 2016·2018·2019 면 하한 아래 줄만 나고 「2017 구멍」이라고 말하지 않는다", () => {
  const lines = fail(resolveBuildSeasons(AUTO, db([2016, 2018, 2019])));
  assert.equal(lines.length, 1, lines.join("\n"));
  assert.match(lines[0]!, /아래 시즌의 경기가 DB 에 있다: 2016 —/);
});

test("auto — 하한 이상 치른 시즌이 0 이면 실패 · 구멍 줄은 안 낸다(하한 아래만 있으면 그 줄도 함께)", () => {
  const none = fail(resolveBuildSeasons(AUTO, db([])));
  assert.equal(none.length, 1, none.join("\n"));
  assert.match(none[0]!, /공개 하한\(2018\) 이상 치른 경기가 있는 시즌이 하나도 없다/);
  const onlyBelow = fail(resolveBuildSeasons(AUTO, db([2010, 2017])));
  assert.equal(onlyBelow.length, 2, onlyBelow.join("\n"));
  assert.match(onlyBelow[0]!, /아래 시즌의 경기가 DB 에 있다: 2017·2010 —/);
  assert.match(onlyBelow[1]!, /하나도 없다/);
});

test("명시 목록 — 목록 밖의 치른 시즌(하한 이상)이 있으면 실패 · 그 줄만 낸다", () => {
  const lines = fail(resolveBuildSeasons(list(2019), db([2018, 2019])));
  assert.equal(lines.length, 1, lines.join("\n"));
  assert.match(lines[0]!, /치른 경기가 있는 시즌이 시즌 목록\(2019\)에 없다: 2018 —/);
});

test("명시 목록 — 실패 사유가 여럿이면 전부 한 메시지에 줄로(하한 아래 · 구멍 · 목록 밖)", () => {
  const lines = fail(resolveBuildSeasons(list(2020), db([2017, 2018, 2020])));
  assert.equal(lines.length, 3, lines.join("\n"));
  assert.match(lines[0]!, /아래 시즌의 경기가 DB 에 있다: 2017/);
  assert.match(lines[1]!, /치른 경기가 없는 시즌이 있다: 2019/);
  assert.match(lines[2]!, /시즌 목록\(2020\)에 없다: 2018/);
});

test("명시 목록 — 입력 순서는 뜻이 없다(내림차순)", () => {
  assert.deepEqual(ok(resolveBuildSeasons(list(2018, 2019), db([2018, 2019]))), [2019, 2018]);
});

test("하한 인자 — 시험에서만 넘긴다(기본은 PUBLIC_SEASON_FLOOR)", () => {
  assert.deepEqual(ok(resolveBuildSeasons(AUTO, db([2010, 2011]), 2010)), [2011, 2010]);
  assert.match(fail(resolveBuildSeasons(AUTO, db([2011]), 2010))[0]!, /공개 하한\(2010\)~최신\(2011\) 사이에 치른 경기가 없는 시즌이 있다: 2010/);
  assert.match(fail(resolveBuildSeasons(AUTO, db([2009, 2010]), 2010))[0]!, /공개 하한\(2010\) 아래 시즌의 경기가 DB 에 있다: 2009/);
});

// ── 새 시즌 유예(반영 ① · 조정자 결정 ⒜) — 조건 다섯이 전부 서야 한다 ─────────────────────────

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
  // ⚠시즌 수를 박지 않는다(재검토 m3) — 「보유 9시즌 실측」은 시즌이 늘면 낡는다
  assert.doesNotMatch(line, /\d+\s*시즌 실측/, "경고 문구에 시즌 수가 박혀 있다 — 시즌이 늘면 거짓이 된다");
  assert.match(line, /8경기일째에도 안 서면 실패/, "상한(실패하는 날)을 안 말한다");
});
