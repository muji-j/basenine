/**
 * 시즌 전환.
 *
 * ⚠**여기서 잡는 것은 「경로가 맞는가」다.** 시즌 접두사가 붙는 순간 자산 경로·시즌 링크가
 * 한 단계씩 어긋나고, 그때 생기는 것은 오류가 아니라 **404**다 — 조용하고 발견이 늦다.
 * 실측(2026-08-16): 과거 시즌의 記録 링크 하나 때문에 **1,585종**이 깨져 있었다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { freshnessBar, pathsFor } from "../src/layout.ts";
import { toString } from "../src/html.ts";
import { freshness } from "../src/layout.ts";
import { renderTodayPage } from "../src/today-page.ts";
import { context, seasonContext } from "./fixtures.ts";

/**
 * ⚠**대체 목적지(`players.html`)를 두 시즌 다 갖는다**(2026-09-07).
 * 예전 픽스처에는 그것이 없었는데, 아래 시험은 「선수 일람으로 보낸다」를 단언하고 있었다 —
 * **없는 곳으로 보내는 것을 옳다고 못 박고 있었던 셈**이다. 실제 시즌은 언제나 이 화면을 굽는다
 * (`site.ts` 의 `seasonPaths`). 없는 시즌을 시험하는 것은 아래 `DRAFT_ONLY_PLANS` 다.
 */
const PLANS = [
  { season: 2026, prefix: "", paths: new Set(["index.html", "players.html", "ranking.html", "players/A.html"]) },
  { season: 2025, prefix: "2025/", paths: new Set(["index.html", "players.html", "ranking.html", "players/B.html"]) },
];

/**
 * **드래프트만 굽는 시즌이 섞인 배치**(2026-09-07 · 보유 21시즌을 고를 수 있게).
 * 2010 에는 `draft.html` 하나뿐이다 — 대체 목적지(`players.html`)조차 없다.
 */
const DRAFT_ONLY_PLANS = [
  ...PLANS.map((p) => ({ ...p, paths: new Set([...p.paths, "draft.html"]) })),
  { season: 2010, prefix: "2010/", paths: new Set(["draft.html"]) },
];

test("현재 시즌은 사이트 루트에 놓인다 — 기존 URL이 그대로 산다", () => {
  const p = pathsFor(PLANS, 2026)("ranking.html");
  assert.equal(p.base, "");
  assert.equal(p.root, "");
});

test("⚠과거 시즌은 자산이 한 단계 더 위다 — 합치면 CSS가 조용히 404가 된다", () => {
  const top = pathsFor(PLANS, 2025)("ranking.html");
  assert.equal(top.base, "", "시즌 안의 링크는 시즌 루트 기준이다");
  assert.equal(top.root, "../", "자산은 사이트 루트 기준이다");

  const deep = pathsFor(PLANS, 2025)("players/B.html");
  assert.equal(deep.base, "../");
  assert.equal(deep.root, "../../");
});

test("깊이는 경로에서 센다 — 렌더러가 손으로 적지 않는다", () => {
  assert.equal(pathsFor(PLANS, 2026)("players/A.html").base, "../");
  assert.equal(pathsFor(PLANS, 2026)("index.html").base, "");
});

test("⚠시즌 전환은 같은 화면으로 간다 — 첫 화면으로 튕기지 않는다", () => {
  const s = pathsFor(PLANS, 2026)("ranking.html").seasons;
  const past = s.find((x) => x.season === 2025)!;
  assert.equal(past.href, "2025/ranking.html");
  assert.equal(past.fallback, false);
});

test("⚠그 시즌에 없는 화면이면 선수 일람으로 보낸다 — 404를 만들지 않는다", () => {
  // A는 2026에만 있다
  const s = pathsFor(PLANS, 2026)("players/A.html").seasons;
  const past = s.find((x) => x.season === 2025)!;
  // ⚠**대체 목적지는 選手一覧이다.** 2026-08-17부터 루트는 대시보드라
  // 그 주소가 index.html 에서 players.html 로 옮겨졌다 — 뜻은 그대로다
  assert.equal(past.href, "../2025/players.html");
  assert.equal(past.fallback, true, "대체로 보낸다는 사실을 표시하지 않았다");
});

test("현재 시즌 칸은 자기 자신을 가리키고 current다", () => {
  const s = pathsFor(PLANS, 2026)("players/A.html").seasons;
  const now = s.find((x) => x.season === 2026)!;
  assert.equal(now.current, true);
  assert.equal(now.href, "../players/A.html");
});

test("시즌이 하나면 전환 띠를 그리지 않는다 — 고를 것 없는 조작은 소음이다", () => {
  const out = renderTodayPage(
    {
      gameDate: "2026-08-14", builtOn: "2026-08-16", games: [], probableDate: null,
      probables: [], starRule: "x", starLimit: 6, prev: null, dayCount: 1,
    },
    context(),
  );
  assert.ok(!out.includes('class="seasons"'));
});

test("시즌이 둘이면 「シーズン」이라는 이름과 함께 그린다 — 연도만 띄우면 무엇인지 모른다", () => {
  const out = renderTodayPage(
    {
      gameDate: "2026-08-14", builtOn: "2026-08-16", games: [], probableDate: null,
      probables: [], starRule: "x", starLimit: 6, prev: null, dayCount: 1,
    },
    seasonContext(["today.html"]),
  );
  assert.match(out, /aria-label="シーズン"/);
  assert.match(out, /<span class="slab">シーズン<\/span>/);
  assert.match(out, /2025年/);
});

/**
 * ⚠**끝난 시즌에 「更新が止まっています」라고 쓰지 않는다.**
 * 수집이 죽은 것이 아니라 시즌이 끝난 것이고, 경고를 남발하면 진짜 경고가 안 보인다.
 * 실측(2026-08-16): 2025년 화면 2,307장 전부가 「315일 전」이라는 빨간 띠를 달고 있었다.
 */
test("⚠지난 시즌에는 「終了したシーズン」이라고 쓴다 — 고장으로 보이면 안 된다", () => {
  const f = freshness("2025-10-05", "2026-08-16");
  const past = toString(freshnessBar(f, true));
  assert.match(past, /終了したシーズンです/);
  assert.ok(!past.includes("更新が止まっています"), "끝난 시즌을 고장이라고 했다");
  assert.ok(!past.includes("stale"), "경고색이 붙었다");

  const now = toString(freshnessBar(f, false));
  assert.match(now, /更新が止まっています/, "현재 시즌의 경고까지 없애면 안 된다");
});

test("지난 시즌에 경기가 없으면 그렇게 말한다", () => {
  const out = toString(freshnessBar(freshness(null, "2026-08-16"), true));
  assert.match(out, /このシーズンの試合はありません/);
});

/* ── 일부 화면만 굽는 시즌 ─────────────────────────────────────
   ⚠**드래프트만 있는 시즌**(2005~2017)이 생기면서 지금까지 참이던 전제 하나가 깨졌다:
   「대체 목적지(選手一覧)는 어느 시즌에나 있다」. 아래가 그 새 규칙을 못 박는다. */

test("⚠그 화면도 대체 목적지도 없는 시즌은 띠에 안 낸다 — 고를 수 없는 해를 세워 두지 않는다", () => {
  const s = pathsFor(DRAFT_ONLY_PLANS, 2026)("ranking.html").seasons;
  assert.deepEqual(
    s.map((x) => x.season),
    [2026, 2025],
    "2010 에는 順位도 選手一覧도 없다 — 그리로 보내면 404다",
  );
});

test("⚠같은 화면이 있으면 그 시즌을 낸다 — ドラフト 는 2010 에도 있다", () => {
  const s = pathsFor(DRAFT_ONLY_PLANS, 2026)("draft.html").seasons;
  assert.deepEqual(s.map((x) => x.season), [2026, 2025, 2010]);
  const old = s.find((x) => x.season === 2010)!;
  assert.equal(old.href, "2010/draft.html");
  assert.equal(old.fallback, false, "실제로 있는 화면을 「대체」라고 말하면 안 된다");
});

/**
 * **상단 내비의 대체**(`navTo`).
 *
 * ⚠**여기가 없으면 드래프트만 있는 시즌의 탭이 전부 404 다.** 탭은 지금까지
 * 자기 시즌 폴더만 가리켰고, 그 시즌에 그 화면이 있는지 **한 번도 묻지 않았다.**
 */
test("⚠내비는 그 시즌에 없는 화면을 「그 화면이 있는 가장 최신 시즌」으로 보낸다", () => {
  const navTo = pathsFor(DRAFT_ONLY_PLANS, 2010)("draft.html").navTo;
  const ranking = navTo("ranking.html");
  assert.equal(ranking.href, "../ranking.html", "2010 에 順位는 없다 — 2026 으로 보내야 한다");
  assert.equal(ranking.toSeason, 2026, "어느 해로 보내는지 화면이 말할 수 있어야 한다");
  assert.equal(ranking.base, "../", "클라이언트가 쓰는 기준도 그 시즌이다");

  const draft = navTo("draft.html");
  assert.equal(draft.href, "draft.html", "있는 화면을 다른 시즌으로 보내면 안 된다");
  assert.equal(draft.toSeason, null);
});

test("⚠「가장 최신」을 배열 순서가 아니라 연도로 고른다 — 오름차순으로 넘겨도 같아야 한다", () => {
  const ascending = [...DRAFT_ONLY_PLANS].sort((a, b) => a.season - b.season);
  assert.equal(pathsFor(ascending, 2010)("draft.html").navTo("ranking.html").toSeason, 2026);
});

test("⚠아는 시즌 어디에도 없으면 자기 시즌을 가리킨다 — 항목을 지우지 않는다", () => {
  // ⚠**「어느 시즌에도 없다」가 아니라 「우리가 아는 곳이 없다」다**(M11).
  //   지우는 쪽으로 기울면 배치를 안 적은 문맥에서 헤더가 통째로 사라지고 아무 검사도 안 떨어진다.
  //   자기 시즌을 가리키면 없는 곳을 가리킨 순간 **링크 검사가 빌드를 세운다.**
  const t = pathsFor(DRAFT_ONLY_PLANS, 2026)("draft.html").navTo("nowhere.html");
  assert.equal(t.href, "nowhere.html");
  assert.equal(t.toSeason, null);
  // 배치를 아예 모르는 문맥(시즌 하나)에서도 같다
  assert.equal(pathsFor([], 2026)("draft.html").navTo("ranking.html").href, "ranking.html");
});
