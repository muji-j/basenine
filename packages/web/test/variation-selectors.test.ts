/**
 * **이체자 선택자를 출력 경계에서 뗀다**(2026-10-25 핫픽스).
 *
 * ⚠**2026-10-24 배포가 이것으로 멈췄다**(daily run 40116508045 · 「서체 부분집합」 단계).
 * 2026 드래프트 npb 원본이 이름 두 곳(辻村 大我 · 榊原 七斗)의 첫 글자 뒤에 **U+E0100** 을 달았고,
 * 어느 서체도 그 글자를 못 덮어 서체 게이트(`scripts/build-fonts.ts`)가 섰다 — **게이트는 옳았다.**
 * 게이트가 허용하는 두 길 중 ⑴ 「그 글자를 화면에서 안 쓴다」를 출력 경계 한 곳(`html.ts`)에서 탄다.
 *
 * ⚠**원본·DB 는 그대로다**(M4) — 이 시험은 **출력**만 본다.
 * ⚠**독립 코드포인트 이체자(髙·﨑·𠮷)는 다른 글자다** — 서체가 덮고, 떼면 이름이 바뀐다. 그대로 나가야 한다.
 * ⚠**소스에 그 글자를 날것으로 적지 않는다** — 보이지 않아서 읽는 사람이 모른다. 전부 이스케이프로 쓴다.
 *
 * 배포물 전수(HTML·JSON)와 서체 게이트의 「쓰이는 글자」 수집기로 재는 빌드 수준 시험은
 * `build-gates.test.ts` 에 있다 — 그 파일의 빌드 하네스(`withBuild`)를 쓰기 위해서다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { escapeHtml, html, stripVariationSelectors, toString } from "../src/html.ts";
import { rankingRestJson, searchIndexJson } from "../src/pages.ts";
import { compareCard, compareShardJson } from "../src/compare.ts";
import { playerPage, r, rankingPanel } from "./fixtures.ts";

/** 辻 · 榊 에 실제로 붙어 온 것(IVS 첫 글자) */
const IVS = "\u{E0100}";
/** 이체자 선택자 두 범위 — IVS(U+E0100–E01EF) · SVS(U+FE00–FE0F) */
const SELECTORS: readonly [string, string][] = [
  ["IVS 처음 U+E0100", "\u{E0100}"],
  ["IVS 끝 U+E01EF", "\u{E01EF}"],
  ["SVS 처음 U+FE00", "\u{FE00}"],
  ["SVS 끝 U+FE0F", "\u{FE0F}"],
];
const ANY_SELECTOR = /[\u{E0100}-\u{E01EF}\u{FE00}-\u{FE0F}]/u;

/** 실물의 두 이름(2026 드래프트 · npb 표기) */
const TSUJIMURA = `辻${IVS}村 大我`;
const SAKAKIBARA = `榊${IVS}原 七斗`;

test("⚠escapeHtml 이 이체자 선택자를 뗀다 — IVS·SVS 두 범위의 양 끝까지", () => {
  for (const [label, vs] of SELECTORS) {
    assert.equal(escapeHtml(`辻${vs}村`), "辻村", `${label} 가 화면에 남는다 — 서체가 못 덮어 게이트가 선다`);
  }
  // 실물의 두 이름
  assert.equal(escapeHtml(TSUJIMURA), "辻村 大我");
  assert.equal(escapeHtml(SAKAKIBARA), "榊原 七斗");
});

test("⚠범위 밖은 그대로다 — 독립 이체자·일반 글자·이웃한 코드포인트", () => {
  const keep = [
    // ⚠**독립 코드포인트 이체자** — 다른 글자다. 떼면 이름이 바뀐다
    "髙橋", // U+9AD9
    "山﨑", // U+FA11
    "𠮷川", // U+20BB7 · 서러게이트 쌍 — 반쪽만 지우면 깨진다
    "皆吉\u{FA45}翔", // 海 = U+FA45 호환 한자(2026 드래프트 실물 · 겉보기는 U+6D77 과 같아서 이스케이프로 쓴다)
    "ひらがな カタカナ 漢字 ABC 123",
    // 범위의 바로 바깥(경계 한 칸 차이를 잡는다)
    "\u{E00FF}",
    "\u{E01F0}",
    "\u{FDFF}",
    "\u{FE10}",
    // ⚠**제로폭 결합자는 이 함수의 일이 아니다** — 이모지 순서를 깨뜨린다. 서체 게이트의 `isNonGlyph` 가 따로 다룬다
    "\u{200D}",
  ];
  for (const s of keep) {
    assert.equal(escapeHtml(s), s, `범위 밖 글자를 건드렸다: ${[...s].map((c) => c.codePointAt(0)!.toString(16)).join(" ")}`);
  }
});

/**
 * **떼는 규칙은 한 벌이다**(M1) — `escapeHtml` 도 JSON 출력도 이 함수를 부른다.
 * ⚠**뗀 결과를 다시 떼도 같다** — 출력 경계가 겹쳐도(이미 뗀 값을 또 끼워 넣어도) 값이 안 바뀐다.
 */
test("⚠stripVariationSelectors — 두 범위만 떼고 나머지는 한 글자도 안 건드린다", () => {
  for (const [label, vs] of SELECTORS) {
    assert.equal(stripVariationSelectors(`${vs}辻${vs}${vs}村${vs}`), "辻村", `${label} 를 못 뗐다(앞·뒤·연속)`);
  }
  const mixed = `髙橋 山﨑 𠮷川 ${TSUJIMURA} \u{FE10}\u{E01F0}`;
  const once = stripVariationSelectors(mixed);
  assert.equal(once, "髙橋 山﨑 𠮷川 辻村 大我 \u{FE10}\u{E01F0}");
  assert.equal(stripVariationSelectors(once), once, "두 번 떼면 값이 바뀐다 — 멱등이 아니다");
  assert.equal(stripVariationSelectors(""), "");
});

test("⚠떼면서도 이스케이프는 그대로다 — 한 함수가 둘 다 한다", () => {
  assert.equal(escapeHtml(`辻${IVS}<村>&"'`), "辻&lt;村&gt;&amp;&quot;&#39;");
});

test("⚠html 템플릿에 끼우면 본문·속성 둘 다에서 떼어진다 — 끼워 넣는 값은 전부 escapeHtml 을 지난다", () => {
  const out = toString(html`<a title="${TSUJIMURA}" aria-label="${SAKAKIBARA}">${TSUJIMURA}</a>`);
  assert.equal(out, '<a title="辻村 大我" aria-label="榊原 七斗">辻村 大我</a>');
});

// ── JSON — 브라우저가 그리는 글자다. ⚠**서체 게이트는 `.json` 도 훑는다**(`scripts/fonts.ts` 의 TEXT_EXTENSIONS) ──

test("⚠검색 색인(players.json)에서 뗀다 — 「辻村」으로 쳐도 찾힌다", () => {
  const json = searchIndexJson([{ i: "9000011", n: TSUJIMURA, t: "h", k: "つじむら たいが" }]);
  assert.ok(!ANY_SELECTOR.test(json), `색인에 이체자 선택자가 남았다: ${JSON.stringify(json)}`);
  const [e] = JSON.parse(json) as { n: string }[];
  assert.equal(e!.n, "辻村 大我");
  assert.ok(e!.n.includes("辻村"), "떼지 않으면 「辻村」 부분 일치가 안 된다");
});

test("⚠比較 샤드 JSON 에서 뗀다", () => {
  const card = compareCard(playerPage({ playerId: "9000011", name: TSUJIMURA }));
  const json = compareShardJson(new Map([[card.id, card]]));
  assert.ok(!ANY_SELECTOR.test(json), "比較 샤드에 이체자 선택자가 남았다");
  assert.equal((JSON.parse(json) as Record<string, { name: string }>)["9000011"]!.name, "辻村 大我");
});

test("⚠순위 「もっと見る」 JSON 에서 뗀다", () => {
  const panel = rankingPanel({
    rest: [{ rank: null, rankAll: 51, playerId: "9000011", name: SAKAKIBARA, teamCode: "t", value: r(120, 400), isMe: false }],
  });
  const json = rankingRestJson({ id: "batting", label: "打撃", panels: [panel] });
  assert.ok(!ANY_SELECTOR.test(json), "순위 JSON 에 이체자 선택자가 남았다");
  assert.equal((JSON.parse(json) as Record<string, { name: string }[]>)[panel.id]![0]!.name, "榊原 七斗");
});

/**
 * ⚠**직렬화한 결과에서 떼므로 JSON 이 안 깨지는지 따로 본다** — 따옴표·역슬래시가 이스케이프된 문자열 한가운데서도.
 * 구조 글자(`{}[]",:` · 역슬래시 이스케이프)는 전부 ASCII 라 그 범위와 겹치지 않는다.
 */
test("⚠떼고 나서도 JSON 이 깨지지 않는다 — 따옴표·역슬래시가 섞인 값에서도", () => {
  const nasty = `辻${IVS}"村\\${"\u{FE0F}"}`;
  const json = searchIndexJson([{ i: "1", n: nasty, t: "h" }]);
  assert.equal((JSON.parse(json) as { n: string }[])[0]!.n, '辻"村\\');
});
