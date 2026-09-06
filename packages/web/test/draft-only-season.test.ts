/**
 * **드래프트만 있는 시즌**(2005~2017 · 2026-09-07).
 *
 * DB 가 가진 드래프트는 2005~2025 인데 사이트가 굽는 시즌은 2018~2026 이라,
 * **13년분이 「데이터는 있는데 화면이 없다」**였다 — 화면 스스로 그렇게 적고 있었다
 * (「2018〜2025年を表示（収録は2005〜2025年）」).
 *
 * ⚠**이 시즌이 만드는 것은 한 장뿐이다.** 경기 데이터가 없으므로 선수·구단·순위를 만들면
 * **전부 빈 화면**이 되고, 그건 M12 가 말하는 「데이터 없음」이 아니라 우리가 만든 빈 화면이라
 * 「그 해는 원래 그렇다」로 읽힌다.
 *
 * ⚠**그래서 상단 내비가 문제가 된다.** 탭은 지금까지 자기 시즌 폴더만 가리켰다 —
 * 그대로 두면 이 화면에서 **탭 7개가 전부 404** 다. 아래 시험이 그 전제를 못 박는다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { DRAFT_SEASON_PATHS, buildDraftSeason } from "../src/site.ts";
import { DRAFT_PATH } from "../src/draft-page.ts";
import type { DraftPageData } from "../src/draft-page.ts";
import type { SeasonPlan } from "../src/layout.ts";

const SITE = { name: "bb-app", contact: "a@example.invalid" };
const BUILT_ON = "2026-09-07";
const HELD_GAMES = { from: 2018, to: 2026 };

/** 온전한 시즌이 굽는 화면(`site.ts` 의 `seasonPaths` 무조건 목록) */
const FULL = new Set([
  "today.html",
  "index.html",
  "players.html",
  "ranking.html",
  "starters.html",
  "matchup.html",
  "compare.html",
  "days.html",
  "teams.html",
  DRAFT_PATH,
]);

const PLANS: SeasonPlan[] = [
  { season: 2026, prefix: "", paths: FULL },
  { season: 2025, prefix: "2025/", paths: FULL },
  { season: 2010, prefix: "2010/", paths: DRAFT_SEASON_PATHS },
];

/** 2010 년의 드래프트 데이터. ⚠**경기 데이터 없이도 성립한다** — 그게 이 변경의 전제다 */
function draft(over: Partial<DraftPageData> = {}): DraftPageData {
  return {
    season: 2010,
    heldSeasons: [2005, 2010, 2025],
    state: { kind: "ok" },
    sections: [],
    notes: { state: { kind: "uncollected", detail: "まだ取り込んでいません" }, rows: [] },
    origins: ["npb"],
    links: { linked: 0, total: 0 },
    unknownTeamCodes: [],
    defects: { groupsWithoutWinner: [], groupsWithManyWinners: [] },
    ...over,
  };
}

const build = (d: DraftPageData = draft()): { path: string; content: string } => {
  const files = buildDraftSeason(d, SITE, BUILT_ON, HELD_GAMES, PLANS);
  assert.equal(files.length, 1, `한 장이 아니다: ${files.map((f) => f.path).join(" ")}`);
  return files[0]!;
};

/**
 * 상단 내비의 `<a>` 를 쪼갠다.
 * ⚠**`aria-hidden` 장식은 라벨이 아니다** — 표식(`→`)은 `marked` 로 따로 센다.
 */
function tabs(html: string): { href: string; label: string; aria: string | null; marked: boolean }[] {
  const nav = /<nav class="tnav"[^>]*>([\s\S]*?)<\/nav>/.exec(html);
  assert.ok(nav !== null, "상단 내비가 없다");
  return [...nav[1]!.matchAll(/<a\s([^>]*)>([\s\S]*?)<\/a>/g)].map((m) => ({
    href: (/href="([^"]*)"/.exec(m[1]!) ?? ["", ""])[1]!,
    label: m[2]!.replace(/<i\s[^>]*aria-hidden[^>]*>[\s\S]*?<\/i>/g, "").replace(/<[^>]*>/g, "").trim(),
    aria: (/aria-label="([^"]*)"/.exec(m[1]!) ?? [null, null])[1],
    marked: /<i\s[^>]*aria-hidden[^>]*>→<\/i>/.test(m[2]!),
  }));
}

test("⚠드래프트만 있는 시즌은 한 장만 만든다 — 빈 화면을 만들지 않는다", () => {
  const f = build();
  assert.equal(f.path, `2010/${DRAFT_PATH}`);
  assert.deepEqual([...DRAFT_SEASON_PATHS], [DRAFT_PATH], "만드는 것과 배치가 갈리면 시즌 띠가 404로 간다");
});

/**
 * ⚠**이것이 이 변경의 본체다.** 없으면 탭 7개(球団·試合·一覧·順位·対戦·比較 + 브랜드)가
 * `2010/teams.html` 처럼 **자기 시즌 폴더**를 가리켜 전부 404 가 된다.
 */
test("⚠이 시즌에 없는 탭은 그 화면이 있는 최신 시즌으로 간다 — 자기 폴더를 가리키면 404다", () => {
  const html = build().content;
  const byLabel = new Map(tabs(html).map((t) => [t.label, t]));
  for (const label of ["球団", "試合", "一覧", "順位", "対戦", "比較"]) {
    const t = byLabel.get(label);
    assert.ok(t !== undefined, `탭이 없다: ${label}`);
    assert.ok(
      t.href.startsWith("../") && !t.href.startsWith("../2010/"),
      `${label} 가 이 시즌 폴더를 가리킨다(404): ${t.href}`,
    );
  }
  // ⚠**드래프트는 이 시즌에 있다** — 있는 것을 다른 해로 보내면 틀린 해를 조용히 보여주게 된다
  assert.equal(byLabel.get("ドラフト")?.href, DRAFT_PATH);
});

/**
 * ⚠**조용히 해를 바꾸지 않는다.** 시즌 띠가 이미 `→` 와 `aria-label` 로 그 일을 한다 —
 * **같은 어휘를 쓴다**(M1). 한쪽만 두면 한쪽 사용자에게만 조용해진다.
 */
test("⚠다른 시즌으로 보낸다는 사실이 화면에 있다 — 눈으로도 낭독기로도", () => {
  const html = build().content;
  for (const t of tabs(html)) {
    if (t.label === "ドラフト" || t.label === "用語" || t.label === "記録") {
      assert.equal(t.aria, null, `보내지 않는 항목에 설명이 붙었다: ${t.label}`);
      assert.equal(t.marked, false, `보내지 않는 항목에 표식이 붙었다: ${t.label}`);
      continue;
    }
    assert.ok(t.aria !== null, `어느 해로 가는지 말하지 않는다: ${t.label}`);
    // ⚠**보이는 글자가 이름 안에 있어야 한다**(WCAG 2.5.3 label-in-name)
    assert.ok(t.aria.startsWith(t.label), `보이는 글자가 이름 안에 없다: ${t.label} / ${t.aria}`);
    assert.match(t.aria, /2026年へ移動します/, `어느 해인지 안 적었다: ${t.aria}`);
    // 눈으로 보이는 표식. ⚠**색이 아니라 글자다**(§7) — 낭독기만으로는 절반이다
    assert.equal(t.marked, true, `보내는 것을 눈으로 알 수 없다: ${t.label}`);
  }
  // ⚠**브랜드도 시즌 안의 링크다** — 로고를 누르면 조용히 2026 홈으로 간다
  assert.match(
    html,
    /<a class="brand" href="\.\.\/index\.html" aria-label="[^"]*2026年へ移動します[^"]*">/,
    "브랜드가 어느 해로 가는지 말하지 않는다",
  );
});

/**
 * ⚠**검색창이 죽은 채로 서 있게 하지 않는다.**
 * 번들이 `data-base` 로 만드는 것은 전부 시즌 자산이다 —
 * `players.json` · `players/*.html` · `compare/*.json` · 최애 구단의 `teams/*.html`.
 * 이 시즌에는 그게 하나도 없으므로 자기 폴더를 적으면 색인이 404 로 떨어진다.
 * **에러가 아니라 침묵이라 아무도 결함으로 못 읽는다.**
 */
test("⚠클라이언트의 시즌 자산 기준이 그 자산이 있는 시즌을 가리킨다 — 검색이 404를 부르지 않는다", () => {
  assert.match(build().content, /<html lang="ja" data-base="\.\.\/">/);
});

/**
 * ⚠⚠**404 를 면한 대가로 「조용히 다른 해」가 됐다**(2026-09-07 이중 검토 P0).
 *
 * 바로 위 줄이 색인을 살렸다 — 그런데 **화면은 그 사실을 한 마디도 안 했다.**
 * 2010년 화면에서 검색하면 2010년에 뛴 선수가 아니라 **2026년 선수가 나오고**,
 * 결과 링크도 2026년 선수 페이지로 간다. 이 저장소가 가장 두려워하는
 * **「틀린 값을 조용히 보여주는」** 그 모양이다(CLAUDE.md §6).
 * ⚠**링크 검사로는 못 잡는다** — 그 URL 은 클라이언트가 `fetch` 로 만든다.
 * ⚠**누른 뒤에 알면 늦다** — 검색은 결과를 보고 고르는 조작이라 **치기 전에** 말해야 한다.
 */
test("⚠검색창이 어느 해를 뒤지는지 말한다 — 결과만 조용히 다른 해 것이 되지 않는다", () => {
  const html = build().content;
  const input = /<input id="q"[^>]*>/.exec(html)?.[0] ?? "";
  assert.notEqual(input, "", "검색창이 없다 — 이 시험이 공회전한다");
  const ph = /placeholder="([^"]*)"/.exec(input)?.[1] ?? "";
  const aria = /aria-label="([^"]*)"/.exec(input)?.[1] ?? "";
  assert.match(ph, /2026年/, `보이는 글자가 어느 해인지 말하지 않는다: ${ph}`);
  // ⚠**보이는 글자가 이름 안에 있어야 한다**(WCAG 2.5.3 label-in-name)
  assert.ok(aria.startsWith(ph), `보이는 글자가 이름 안에 없다: ${ph} / ${aria}`);
  // ⚠**말투를 새로 만들지 않는다**(M1) — 내비·시즌 띠와 같은 문장이다
  assert.match(aria, /この年にはありません。2026年へ移動します/, `다른 말투를 하나 더 만들었다: ${aria}`);

  /**
   * ⚠**색인과 라벨이 갈리면 라벨이 거짓말이 된다**(M1). 검색이 뒤지는 해는
   * `data-base` 가 정하고 그 답은 **選手一覧(一覧 탭)이 가는 해**와 같아야 한다 —
   * 따로 세기 시작하면 어느 날 검색은 2026 을 뒤지는데 화면은 2025 라고 말한다.
   */
  const roster = tabs(html).find((t) => t.label === "一覧");
  assert.ok(roster !== undefined, "一覧 탭이 없다");
  assert.equal(roster.aria, `一覧${aria.slice(ph.length)}`, "검색창과 一覧 탭이 다른 해를 말한다");
});

/**
 * ⚠**「경기가 없다」와 「수집이 멈췄다」를 같은 문장으로 말하지 않는다**(M12).
 * 이 시즌에는 경기가 원래 없다 — 경고가 아니라 사실이다.
 */
test("⚠경기가 없는 것을 취득 실패라고 말하지 않는다", () => {
  const html = build().content;
  assert.match(html, /このシーズンの試合はありません/);
  assert.ok(!html.includes("取得に失敗している可能性"), "없는 것을 고장이라고 했다");
  assert.ok(!html.includes("更新が止まっています"), "없는 것을 고장이라고 했다");
});

/**
 * ⚠**그 시즌 선수 페이지가 없다** — 이름을 링크로 만들면 전부 404 다.
 * 통산 대전에서 쓴 규칙과 같다: **링크만 빼고 이름은 남긴다**(행을 지우지 않는다).
 */
test("⚠선수 페이지로 링크하지 않는다 — 그 시즌에는 없다", () => {
  const html = build().content;
  const hrefs = [...html.matchAll(/href="(?!https?:|#)([^"]+)"/g)].map((m) => m[1]!);
  assert.deepEqual(
    hrefs.filter((h) => h.includes("players/")),
    [],
    "없는 선수 페이지를 가리켰다",
  );
});

/**
 * ⚠**머리줄이 「収録」만 말하면 볼 수 없는 해를 보여 줄 것처럼 말한다** — 그 반대도 참이다.
 * 전 시즌이 보이게 된 지금 「N年を表示（収録は…）」이 남아 있으면 **그 문장이 거짓**이 된다.
 * ⚠**손으로 고치지 않았다** — `shownHeld` 가 시즌 띠에서 그 구별을 읽는다(M1).
 */
test("⚠전부 볼 수 있게 되면 「표시 범위」를 따로 말하지 않는다 — 없는 구별을 만들지 않는다", () => {
  const html = build(draft({ heldSeasons: [2010, 2025] })).content;
  const asof = /<span class="asof">([^<]*)<\/span>/.exec(html)?.[1] ?? "";
  assert.match(asof, /を収録$/, `쓸 수 없는 구별을 적었다: ${asof}`);
  assert.doesNotMatch(asof, /を表示/);
  assert.ok(!html.includes("まだ画面がありません"), "볼 수 있는 해를 못 본다고 말했다");

  // 반대로 **보유는 있는데 화면이 없는 해가 남아 있으면** 그 사실을 말해야 한다
  const partial = build(draft({ heldSeasons: [1999, 2010, 2025] })).content;
  assert.match(partial, /まだ画面がありません/, "못 보는 해가 있는데 아무 말도 안 했다");
});
