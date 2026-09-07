import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { toString } from "../src/html.ts";
import {
  DRAFT_PATH,
  STALE_AFTER_DAYS,
  freshness,
  freshnessBar,
  isStale,
  page,
  pathsFor,
  safeScript,
  stateNote,
} from "../src/layout.ts";
import { CSS } from "../src/assets.ts";
import { NEUTRAL_COLOR } from "@bb-app/domain";
import { renderTodayPage } from "../src/today-page.ts";
import { renderPlayerPage } from "../src/player-page.ts";
import { context, pastSeasonContext, playerPage } from "./fixtures.ts";
import { html } from "../src/html.ts";

test("신선도는 경기일과 생성일의 간격으로 정해진다", () => {
  assert.equal(freshness("2026-08-14", "2026-08-15").lagDays, 1);
  assert.equal(freshness("2026-08-01", "2026-08-15").lagDays, 14);
  assert.equal(freshness(null, "2026-08-15").lagDays, null);
});

test("경계에서 낡음 판정이 뒤집힌다 — 임계값을 테스트가 고정한다", () => {
  assert.equal(STALE_AFTER_DAYS, 3);
  assert.equal(isStale(freshness("2026-08-12", "2026-08-15")), false);
  assert.equal(isStale(freshness("2026-08-11", "2026-08-15")), true);
});

test("경기가 하나도 없으면 낡음이다 — 「데이터 없음」을 정상으로 보이게 하지 않는다", () => {
  assert.equal(isStale(freshness(null, "2026-08-15")), true);
  assert.match(toString(freshnessBar(freshness(null, "2026-08-15"))), /データがありません/);
});

test("낡았을 때만 경고 띠가 된다", () => {
  assert.match(toString(freshnessBar(freshness("2026-08-14", "2026-08-15"))), /class="state fresh"/);
  assert.match(toString(freshnessBar(freshness("2026-07-01", "2026-08-15"))), /class="state stale"/);
});

test("4상태는 서로 다른 문구가 된다(M12)", () => {
  assert.equal(toString(stateNote({ kind: "ok" })), "");
  const empty = toString(stateNote({ kind: "empty", detail: "打席がありません" }));
  const failed = toString(stateNote({ kind: "failed", detail: "取得エラー" }));
  const off = toString(stateNote({ kind: "offseason", detail: "開幕前" }));
  assert.notEqual(empty, failed);
  assert.notEqual(failed, off);
  assert.match(failed, /取得できていません/);
  assert.match(off, /シーズン外/);
});

/**
 * ⚠**바로 위 시험은 문구만 봤고, 그동안 여섯이 화면에서 한 갈래였다**(2026-09-05 감사 P1).
 * `stateNote` 가 전부 `<p class="empty">` 로 냈고 `.empty` 는 테두리 0·바탕 0 이라
 * **다른 것이 문장 첫 낱말뿐**이었다 — 「4상태를 각각 디자인하라」(M12)를 문구로만 만족시킨 것이다.
 * ⚠**이 저장소가 같은 사고를 세 번 냈다**: `.pmiss`(2026-08-18) · `td.ok`/`td.bad`(같은 날) ·
 * 여기. 셋 다 **표식은 붙었는데 규칙이 없었다** — 그래서 표식과 규칙을 **함께** 잰다.
 */
test("⚠상태가 CSS 에서도 갈린다 — 표식만 붙고 규칙이 0건이면 안 갈린 것이다(M12)", () => {
  const kinds = ["empty", "failed", "offseason", "unpublished", "uncollected"] as const;
  const marks = kinds.map((kind) => /data-state="([a-z]+)"/.exec(toString(stateNote({ kind, detail: "x" })))?.[1]);
  assert.deepEqual(marks, [...kinds], "상태가 화면에서 자기 이름을 안 말한다 — CSS 가 가를 근거가 없다");

  // ⚠주석 안의 글자를 규칙으로 세지 않는다 — 이 스타일시트는 주석이 많다
  const rules = CSS.replace(/\/\*[\s\S]*?\*\//g, "");
  const base = /\.empty\[data-state\]\{([^}]*)\}/.exec(rules)?.[1] ?? "";
  assert.notEqual(base, "", ".empty[data-state] 규칙이 없다 — 표식이 아무 일도 안 한다");
  assert.match(base, /background:var\(--panel-2\)/);
  // ⚠**굵기가 토큰이 됐다**(2026-09-07 토큰 1단계 · --rw-mast:3px). 여기서 묻는 것은
  // 「값이 3인가」가 아니라 **「기둥 굵기의 왼쪽 괘가 있는가」**다.
  assert.match(base, /border-left:(?:3px|var\(--rw-mast\))/);
  // ⚠**판정선은 .dnolot 이다**(감사) — 그보다 약하면 「가장 안 중요한 사실이 가장 진한」 상태로 돌아간다
  const nolot = /\.dnolot\{([^}]*)\}/.exec(rules)?.[1] ?? "";
  assert.doesNotMatch(nolot, /background:/, ".dnolot 이 바탕을 얻었다 — 무게가 다시 뒤집힌다");
  // 「우리 몫의 남은 일」과 「영영 안 열린다」를 형태로 가른다(DataState 주석이 요구하는 구별)
  assert.match(rules, /\[data-state="uncollected"\][^{]*\{[^}]*dashed/);
  assert.match(rules, /\[data-state="offseason"\][^{]*\{[^}]*dashed/);
  // 고장만 색을 쓴다 — 「없음」은 고장이 아니다
  assert.match(rules, /\.empty\[data-state="failed"\]\{[^}]*var\(--warn\)/);
  assert.doesNotMatch(base, /--warn/, "「없음」에까지 경고색을 칠했다");
});

/**
 * ⚠**손으로 적은 `<p class="empty">` 까지 물들이면 안 된다.** 「この回の競合はありません。」은
 * **빈 자리가 아니라 답**이라 상태 표시와 같은 모양이면 그 구별이 사라진다.
 */
test("⚠표식 없는 .empty 는 그대로다 — 「행이 0건이다」와 「받지 못했다」는 다른 사실이다", () => {
  const rules = CSS.replace(/\/\*[\s\S]*?\*\//g, "");
  const plain = /(^|\})\s*\.empty\{([^}]*)\}/.exec(rules)?.[2] ?? "";
  assert.notEqual(plain, "", ".empty 규칙을 못 찾았다 — 이 시험이 공회전한다");
  assert.doesNotMatch(plain, /background|border-left/, ".empty 자체가 상태 표시가 됐다");
});

test("safeScript는 문서를 끊는 문자를 죽인다", () => {
  const out = safeScript(`window.X=["</script><script>evil()</script>"]`);
  assert.ok(!out.includes("</script>"), "스크립트 종료 태그가 남으면 안 된다");
  assert.ok(out.includes("\\u003c/script"), "이스케이프된 형태로는 남아야 한다");
});

test("safeScript는 JS 줄바꿈 문자(U+2028/2029)도 막는다", () => {
  const out = safeScript(`"a${String.fromCharCode(0x2028)}b${String.fromCharCode(0x2029)}c"`);
  assert.ok(!out.includes(String.fromCharCode(0x2028)));
  assert.ok(!out.includes(String.fromCharCode(0x2029)));
  assert.ok(out.includes("\\u2028") && out.includes("\\u2029"));
});

function render(contact: string): string {
  return page({
    title: "테스트",
    base: "",
    root: "",
    seasons: [],
    navTo: pathsFor([], 2026)("index.html").navTo,
    color: NEUTRAL_COLOR,
    freshness: freshness("2026-08-14", "2026-08-15"),
    site: { name: "bb-app", contact },
    nav: "index",
    body: html`<p>본문</p>`,
  });
}

test("모든 화면에 출처와 원본 링크가 있다(L3)", () => {
  const out = render("a@example.invalid");
  assert.match(out, /出典：日本野球機構/);
  assert.match(out, /https:\/\/npb\.jp\//);
  assert.match(out, /独自に再計算/);
});

/**
 * ⚠⚠**푸터가 「出典：日本野球機構（NPB）公式サイト」라고 단정하는데, 그것이 거짓인 화면이 있다**
 * (2026-09-06 최종 검토 [C-2]). ドラフト 2023~2025 의 1位指名 경합은 **ja.wikipedia** 에서 온다.
 * → 그런 화면은 `extraSources` 로 **이름과 라이선스를 함께** 댄다.
 *
 * ⚠**안 넘긴 화면의 바이트는 그대로여야 한다.** 이 줄은 전 화면(수천 장)에 실리므로
 * 한 글자가 늘면 **그날 배포가 통째로 새 파일**이 된다 — `footStamp` 가 정확히 그 사고로 생겼다.
 */
test("⚠[C-2] 다른 출처가 섞인 화면만 푸터가 그것을 말한다 — 안 넘기면 한 글자도 안 는다", () => {
  const plain = render("a@example.invalid");
  assert.doesNotMatch(plain, /この画面には/u, "안 넘긴 화면의 푸터에 글자가 늘었다");

  const mixed = page({
    title: "테스트",
    base: "",
    root: "",
    seasons: [],
    navTo: pathsFor([], 2026)("index.html").navTo,
    color: NEUTRAL_COLOR,
    freshness: freshness("2026-08-14", "2026-08-15"),
    site: { name: "bb-app", contact: "a@example.invalid" },
    nav: "index",
    body: html`<p>본문</p>`,
    extraSources: [{ name: "ja.wikipedia", url: "https://ja.wikipedia.org/wiki/x", license: "CC BY-SA 4.0" }],
  });
  assert.match(mixed, /出典：日本野球機構/u, "원래 출처를 지우면 안 된다 — 더하는 것이다");
  assert.match(mixed, /<a href="https:\/\/ja\.wikipedia\.org\/wiki\/x"[^>]*>ja\.wikipedia<\/a>/u);
  assert.match(mixed, /CC BY-SA 4\.0/u, "⚠재배포 조건을 안 적으면 모르는 채로 퍼진다");

  // ⚠**빈 배열은 「안 넘긴 것」과 같아야 한다** — 「0건」을 문장으로 만들지 않는다
  const empty = page({
    title: "테스트",
    base: "",
    root: "",
    seasons: [],
    navTo: pathsFor([], 2026)("index.html").navTo,
    color: NEUTRAL_COLOR,
    freshness: freshness("2026-08-14", "2026-08-15"),
    site: { name: "bb-app", contact: "a@example.invalid" },
    nav: "index",
    body: html`<p>본문</p>`,
    extraSources: [],
  });
  assert.equal(empty, plain, "빈 배열이 출력을 바꿨다 — 전 화면의 바이트가 움직인다");
});

test("연락처가 없으면 화면이 그 사실을 말한다(L4) — 가짜 주소를 만들지 않는다", () => {
  assert.match(render(""), /連絡先が未設定/);
  assert.ok(!render("a@example.invalid").includes("連絡先が未設定"));
});

test("페이지는 구단 색을 CSS 변수로만 싣는다", () => {
  const out = render("a@example.invalid");
  assert.match(out, /--team:#6b7280/);
  assert.match(out, /<html lang="ja" data-base=""/);
});

test("검색 엔진에 올리지 않는다 — S1은 지인한정이다", () => {
  assert.match(render(""), /name="robots" content="noindex, nofollow"/);
});

/**
 * ⚠**스크립트가 없으면 탭은 조작이 아니라 벽이다.**
 * 탭 패널은 첫 장만 열어 두고 나머지를 `hidden`으로 내보내므로, 여는 수단이 사라지면
 * 그 내용에 **도달할 방법이 아예 없다.** 2026-08-16에 실제로 걸렸다 —
 * 順位를 チーム/個人으로 나눈 순간 개인 타이틀 전체가 JS 없이는 닿을 수 없게 됐다.
 */
test("스크립트가 없으면 닫힌 탭 패널을 전부 펼친다 — 길어지는 것이 닿지 못하는 것보다 낫다", () => {
  const out = renderTodayPage(
    {
      gameDate: "2026-08-14", builtOn: "2026-08-16", games: [], probableDate: null,
      probables: [], starRule: "x", starLimit: 6, prev: null, dayCount: 1,
    },
    context(),
  );
  const at = out.indexOf("<noscript>");
  assert.ok(at > 0, "noscript 폴백이 없다");
  assert.ok(at < out.indexOf("</head>"), "폴백이 head 밖에 있다");
  assert.match(
    out.slice(at, at + 200),
    /\[data-panelgroup\]\[hidden\]\{display:block!important\}/,
    "닫힌 탭 패널을 펼치는 규칙이 아니다",
  );
});

const shell = (): string =>
  renderTodayPage(
    {
      gameDate: "2026-08-14", builtOn: "2026-08-16", games: [], probableDate: null,
      probables: [], starRule: "x", starLimit: 6, prev: null, dayCount: 1,
    },
    context(),
  );

/**
 * ⚠**주석이 「전부 펼친다」고 적어 놓고 규칙은 탭 패널만 폈다**(2026-08-20 최종 검토 ⑤).
 *
 * 선수 페이지는 프리셋 밖의 구획을 `<section class="block" hidden>` 으로 내보내는데,
 * `[data-panelgroup][hidden]` 은 거기 안 걸린다. 실브라우저(JS 끔)에서
 * `players/01105138.html` 의 `b-count`·`b-relief` 높이가 **0** 이었고 앵커로 들어가도 0이었다 —
 * 즉 **닿을 방법이 없는 내용이 페이지에 실려 있었다**(§0-1).
 * ⚠**기존 구획 6개가 이미 같은 상태였다** — 이번 라운드가 만든 결함이 아니라 이번에 둘을 더 넣었다.
 *
 * → **넓히는 쪽을 골랐다.** 길어지는 것이 닿지 못하는 것보다 낫다(같은 파일의 원래 논거).
 *   인쇄에도 이미 같은 규칙이 있다(`@media print` 의 `.block[hidden]{display:block}`).
 */
test("⚠스크립트가 없으면 접힌 구획도 펼친다 — 탭 패널만 펴면 선수 페이지는 여전히 벽이다", () => {
  const out = shell();
  const at = out.indexOf("<noscript>");
  assert.ok(at > 0, "noscript 폴백이 없다");
  const rule = out.slice(at, out.indexOf("</noscript>", at));
  assert.match(rule, /\[data-panelgroup\]\[hidden\]\{display:block!important\}/, "탭 패널 규칙이 사라졌다");
  assert.match(
    rule,
    /\.block\[hidden\]\{display:block!important\}/,
    "선수 페이지의 접힌 구획을 펴는 규칙이 없다 — JS 없이는 그 내용에 닿을 수 없다",
  );
});

test("⚠그 규칙에 실제로 대상이 있다 — 선수 페이지가 구획을 hidden 으로 내보낸다", () => {
  const out = renderPlayerPage(playerPage(), context());
  const hiddenBlocks = [...out.matchAll(/<section class="block" hidden[^>]*id="b-([\w-]+)"/g)].map((m) => m[1]);
  /**
   * ⚠**0이면 통과가 아니라 실패다**(작업규칙 8) — 접힌 구획이 하나도 없으면
   * 위 시험은 「아무 대상도 없는 규칙」을 지키는 셈이 된다.
   * 실측(2026-08-20 · 이 타자 픽스처): 구획 10개 중 **6개**가 접혀 나간다
   * (scorebook · situation · count · streak · matchup · career).
   * ⚠**하한을 실측값에 딱 맞추지 않는다** — 프리셋 구성이 바뀌면 이 시험이 그것 때문에 떨어진다.
   *   여기서 지키는 것은 「대상이 있다」이지 「몇 개인가」가 아니다.
   */
  assert.ok(
    hiddenBlocks.length >= 3,
    `접힌 구획이 ${hiddenBlocks.length}개뿐이다 — 이 규칙이 무엇을 펴는지 모르게 된다`,
  );
  // 검토자가 브라우저로 높이 0을 확인한 구획이 실제로 이 목록에 있다(`relief` 는 투수 전용이라 여기 없다)
  assert.ok(hiddenBlocks.includes("count"), `접힌 구획 목록에 count 가 없다: ${hiddenBlocks.join(", ")}`);
});

/**
 * ⚠**구단 로고를 쓰지 않는다**(§6). 로고는 상표이고, 「사실은 저작물이 아니다」의 논리가
 * 거기까지 닿지 않는다. 탭 아이콘도 **우리가 그린 것**이어야 한다.
 */
test("탭 아이콘은 우리가 그린 도형이고 자산으로 나간다", () => {
  const out = shell();
  assert.match(out, /<link rel="icon" href="assets\/icon\.svg" type="image\/svg\+xml">/);
  assert.ok(!out.includes("npb.jp/img"), "외부 이미지를 참조했다");
});

/**
 * ⚠**JS 가 없어도 구단으로 가는 길이 있어야 한다**(§0-1).
 *
 * 최애를 지정하면 클라이언트가 이 항목의 라벨과 링크를 그 구단으로 바꾸지만,
 * **항목 자체는 서버가 그린다.** 지금까지 구단 페이지는 순위표에서 팀명을 눌러야만 닿았고,
 * 스크립트가 죽은 브라우저에서는 사실상 닿을 수 없었다.
 * ⚠**첫 자리여야 한다**(2026-08-18 유저 요청) — 최애 구단이 앉을 자리다.
 */
test("⚠내비 첫 항목이 球団이고 구단 목록으로 간다 — 서버가 항상 그린다(§0-1)", () => {
  const nav = /<nav class="tnav"[\s\S]*?<\/nav>/.exec(shell());
  assert.notEqual(nav, null, "내비가 없다");
  const first = /<a\s[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/.exec(nav![0]);
  assert.notEqual(first, null, "내비에 링크가 하나도 없다");
  assert.equal(first![2], "球団", `첫 항목이 「${first![2]}」다`);
  assert.match(first![1]!, /(^|\/)teams\.html$/, `첫 항목이 구단 목록으로 가지 않는다: ${first![1]}`);
});

/**
 * ⚠**T9 의 클라이언트가 이 표식으로 항목을 찾는다.** 없으면 최애를 지정해도
 * 내비가 그대로 「球団」인 채 남는다 — 화면은 멀쩡히 그려지므로 눈으로는 안 잡힌다.
 */
test("⚠球団 항목에 클라이언트가 잡을 표식이 있다 — T9 이 라벨을 바꾼다", () => {
  const nav = /<nav class="tnav"[\s\S]*?<\/nav>/.exec(shell())![0];
  const item = /<a\s[^>]*href="[^"]*teams\.html"[^>]*>/.exec(nav);
  assert.notEqual(item, null, "내비에 구단 링크가 없다");
  assert.match(item![0], /\bdata-navteam\b/, `표식이 없다: ${item![0]}`);
});

/**
 * ⚠**ドラフト는 시즌마다 있는 화면이라 `root` 가 아니라 `base` 로 간다**(2026-09-05 · Task 3).
 *
 * 用語·記録 은 사이트에 한 장이라 `root` 로 가지만, 드래프트는 시즌마다 한 장이다.
 * `root` 로 두면 과거 시즌 화면이 전부 **현재 시즌의 드래프트**를 가리키고,
 * 그건 404가 아니라 **틀린 해를 조용히 보여주는** 쪽이라 더 나쁘다.
 * ⚠**깊은 화면에서 상대 경로가 맞는지까지 본다** — 선수 페이지는 `../` 가 붙어야 한다.
 */
test("⚠내비의 ドラフト가 그 시즌의 화면으로 간다 — root 로 두면 과거 시즌이 딴 해를 본다", () => {
  const top = /<nav class="tnav"[\s\S]*?<\/nav>/.exec(shell())![0];
  const item = /<a\s[^>]*href="([^"]*draft\.html)"[^>]*>([^<]+)<\/a>/.exec(top);
  assert.notEqual(item, null, "내비에 드래프트 항목이 없다");
  assert.equal(item![1], "draft.html", `최상위에서 경로가 어긋난다: ${item![1]}`);

  /**
   * ⚠**과거 시즌 화면이라야 `base` 와 `root` 가 갈린다.** 현재 시즌에서는 둘이 같은 값이라
   * `root` 로 바꿔도 아무것도 안 깨진다 — **그 문맥으로만 재면 이 시험은 공회전한다.**
   * 2025 의 `players/x.html` 은 `base="../"` · `root="../../"` 다.
   */
  const past = /<nav class="tnav"[\s\S]*?<\/nav>/.exec(
    renderPlayerPage(playerPage(), pastSeasonContext([DRAFT_PATH])),
  )![0];
  const pastItem = /<a\s[^>]*href="([^"]*draft\.html)"[^>]*>/.exec(past);
  assert.notEqual(pastItem, null, "과거 시즌 선수 페이지 내비에 드래프트 항목이 없다");
  assert.equal(
    pastItem![1],
    "../draft.html",
    `과거 시즌에서 경로가 어긋난다(root 로 두면 딴 해를 연다): ${pastItem![1]}`,
  );
});

test("주소창 색을 라이트·다크 양쪽으로 준다 — 한쪽만 주면 반대 테마에서 어긋난다", () => {
  const out = shell();
  assert.match(out, /theme-color" content="#fbfaf7" media="\(prefers-color-scheme: light\)"/);
  assert.match(out, /theme-color" content="#15161a" media="\(prefers-color-scheme: dark\)"/);
});

/**
 * ⚠**지금 이 카드는 보이지 않는다.** 사이트가 Cloudflare Access 뒤에 있어 링크를 펼치는 쪽은
 * 로그인 화면을 받는다. 공개 전환(S2) 시점에 비로소 효과가 생긴다 — 그때 잊지 않으려고 지금 넣는다.
 */
test("링크 카드 정보를 싣는다 — 제목은 페이지 제목과 같다", () => {
  const out = shell();
  assert.match(out, /property="og:title" content="試合 — 2026年8月14日"/);
  assert.match(out, /property="og:site_name" content="bb-app"/);
  assert.match(out, /property="og:locale" content="ja_JP"/);
});

/**
 * ⚠**띠는 사이트 공통인데 화면 대부분은 정규시즌만 싣는다.**
 * 포스트시즌 기간에 「最新の試合 10月19日 まで反映」이라고만 쓰면,
 * 10월 5일까지밖에 안 담긴 순위표 위에서 그 문장이 거짓이 된다.
 * 정규시즌이 다른 날에서 멈춰 있으면 **그것도 적는다.**
 */
test("정규시즌이 뒤처져 있으면 띠가 두 날짜를 다 말한다", () => {
  const out = toString(freshnessBar(freshness("2026-10-19", "2026-10-20", "2026-10-05")));
  assert.match(out, /最新の試合 2026年10月19日 まで反映/);
  assert.match(out, /レギュラーシーズンは 2026年10月5日 まで/, "정규시즌 기준일을 숨겼다");
});

test("두 날짜가 같으면 괄호를 달지 않는다 — 같은 말을 두 번 하지 않는다", () => {
  const out = toString(freshnessBar(freshness("2026-08-14", "2026-08-15", "2026-08-14")));
  assert.ok(!out.includes("レギュラーシーズンは"), "같은 날짜인데 괄호가 나왔다");
});

/**
 * ⚠**그 한정어가 진행 중 분기에만 걸려 있었다**(2026-09-08 · design-auditor P2).
 *
 * 완결 시즌 화면은 띠에 「最後の試合は 2025年10月30日」(전 대회)을 쓰고,
 * 푸터 도장은 `footStamp`(= `regularGameDate ?? latestGameDate`)라 「2025年10月5日までのデータ」를 쓴다.
 * **어느 쪽도 자기 범위를 말하지 않은 채** 한 화면에 나란히 실렸다.
 * 실측(2026-09-08 · DB 로 다시 셈): **완결 8시즌(2018~2025) 8/8 이 불일치**하고 차이는 **11~27일**이다
 * (2018 21 · 2019 23 · 2020 11 · 2021 26 · 2022 27 · 2023 26 · 2024 25 · 2025 25).
 * ⚠**사용자는 그것을 「데이터가 25일 밀렸나?」로 읽는다** — CLAUDE.md §6 의 그 사고와 같은 모양이다.
 * ⚠**같은 문제를 인지하고 만든 장치가 한쪽 분기에만 걸려 있었다.**
 */
test("⚠끝난 시즌의 띠도 정규시즌 기준일을 말한다 — 푸터 도장이 쓰는 것은 그쪽이다", () => {
  const f = freshness("2025-10-30", "2026-09-08", "2025-10-05", { from: 2018, to: 2026 }, true);
  const out = toString(freshnessBar(f, true));
  assert.match(out, /最後の試合は 2025年10月30日/, "전 대회의 마지막 날이 사라졌다");
  assert.match(
    out,
    /レギュラーシーズンは 2025年10月5日 まで/,
    "완결 시즌 띠가 정규시즌 기준일을 안 말한다 — 푸터는 그 날짜를 쓰는데 띠는 다른 날짜를 쓴다",
  );
});

test("⚠끝난 시즌이라도 두 날짜가 같으면 괄호를 달지 않는다 — 같은 말을 두 번 하지 않는다", () => {
  const f = freshness("2025-10-05", "2026-09-08", "2025-10-05", { from: 2018, to: 2026 }, true);
  const out = toString(freshnessBar(f, true));
  assert.ok(!out.includes("レギュラーシーズンは"), `같은 날짜인데 괄호가 나왔다: ${out}`);
});

/** ⚠**경기가 하나도 없는 시즌에는 붙일 날짜가 없다** — 괄호가 새면 빈 괄호가 나간다 */
test("⚠경기가 없는 시즌의 띠에는 괄호가 없다", () => {
  const out = toString(freshnessBar(freshness(null, "2026-09-08", null, { from: 2018, to: 2026 }, true), true));
  assert.match(out, /このシーズンの試合はありません/);
  assert.ok(!out.includes("レギュラーシーズンは"), `경기가 없는데 괄호가 나왔다: ${out}`);
});

// ── 검색 드롭다운의 롤 ────────────────────────────────────────────────────

/**
 * ⚠**listbox / option 을 쓰지 않는다**(2026-08-20 유저 결정).
 *
 * 이 목록에는 **결과가 아닌 줄**이 섞인다 — 「該当なし」·「読み込み中…」과, 끝의
 * 「25人中20人を表示 — 選手一覧ですべて見る」이다. 그 줄에 `role="option"` 을 붙였다가
 * **그 안의 링크가 눌리지 않는 것이 실기에서 잡혔고**(2026-08-19 Playwright),
 * 롤을 빼면 이번에는 **포커스 모드의 낭독기가 그 줄을 못 읽는다**는 한계가 남았다.
 * → **목록을 listbox 로 부르는 것 자체를 그만둔다.** 그러면 전부 그냥 링크가 되어
 *   눌리고 읽히고 Tab 으로 닿는다.
 *
 * ⚠**반쪽으로 남기지 않는다.** `role="combobox"` 는 「팝업이 listbox 다」라는 약속이라,
 * 목록의 롤만 빼면 `aria-expanded`·`aria-controls` 가 **없는 것을 가리키는 약속**이 된다 —
 * 깨진 ARIA 는 없는 것보다 나쁘다(`parts.ts` 의 `aria-labelledby` 사건과 같은 모양).
 *
 * ⚠**대신 결과 수를 소리로 낸다.** combobox 를 그만두면 「목록이 열렸다」를 말해 주던 것이
 * 통째로 사라진다 — 그 자리를 `role="status"` 한 줄이 받는다(§0-1 의 주 경로다).
 */
test("⚠검색 드롭다운을 listbox 라고 부르지 않는다 — 결과가 아닌 줄이 섞이는 목록이다", () => {
  const out = shell();
  const box = /<div class="qbox">[\s\S]*?<\/div>/.exec(out);
  assert.notEqual(box, null, "헤더 검색 상자를 못 찾았다 — 이 시험이 공회전한다");
  assert.ok(!box![0].includes('role="listbox"'), "목록을 아직 listbox 라고 부른다");
  assert.ok(!box![0].includes('role="combobox"'), "입력만 combobox 로 남아 없는 팝업을 가리킨다");
  assert.ok(!box![0].includes("aria-controls"), "combobox 를 그만뒀는데 aria-controls 가 남았다");
  assert.ok(!box![0].includes("aria-autocomplete"), "combobox 를 그만뒀는데 aria-autocomplete 가 남았다");
  assert.ok(!box![0].includes("aria-expanded"), "combobox 를 그만뒀는데 aria-expanded 가 남았다");
});

/**
 * ⚠**`aria-label` 은 남기되 `role="list"` 를 붙인다.**
 *
 * 이 목록은 `list-style:none` 인데(`.qhits`), **Safari 는 그 스타일이 붙은 `<ul>` 에서
 * 목록 시맨틱을 떼어 버린다.** 롤이 사라지면 계산된 롤이 generic 이 되고,
 * generic 에는 이름이 붙지 않아 `aria-label="検索結果"` 가 **조용히 안 읽힌다.**
 * 명시적으로 `list` 라고 적으면 이름도 항목 수도 그대로 남는다 —
 * `listbox` 와 달리 `list` 는 조작을 약속하지 않으므로 위의 결함이 돌아오지 않는다.
 */
test("⚠목록은 list 로 남고 이름도 남는다 — list-style:none 이 Safari 에서 시맨틱을 떼어 간다", () => {
  const box = /<div class="qbox">[\s\S]*?<\/div>/.exec(shell())![0];
  assert.match(box, /<ul class="qhits" id="qhits" role="list" aria-label="検索結果"/, "목록의 이름이나 롤이 없다");
});

test("⚠결과 수를 소리로 낼 자리가 서버 마크업에 있다 — 나중에 만들면 첫 갱신을 놓친다", () => {
  const box = /<div class="qbox">[\s\S]*?<\/div>/.exec(shell())![0];
  assert.match(box, /data-hitstatus/, "결과 수를 말할 자리가 없다");
  assert.match(box, /role="status"/, "그 자리가 낭독 대상이 아니다");
  // ⚠**보이지 않는 글자로 둔다** — 화면에는 목록 자체와 꼬리줄이 이미 같은 말을 하고 있다
  assert.match(box, /class="vh"[^>]*data-hitstatus|data-hitstatus[^>]*class="vh"/, "화면에도 같은 말이 두 번 나온다");
});

/**
 * ⚠**세 곳이 같은 구현을 쓴다**(헤더 검색 · 対戦を選ぶ · 比較). 한 곳만 고치면
 * 「어떤 검색창은 눌리고 어떤 것은 안 눌리는」 상태가 되고, 그건 지금보다 나쁘다.
 * ⚠**말로 적은 규칙은 지켜지지 않는다 — 세는 것만 지켜진다**(`raw-attributes.test.ts`).
 */
test("⚠소스 어디에도 listbox·combobox 롤이 남아 있지 않다 — 한 곳만 고치면 화면마다 갈린다", () => {
  const dir = new URL("../src/", import.meta.url);
  const files = readdirSync(dir).filter((f) => f.endsWith(".ts"));
  assert.ok(files.length > 20, `소스가 ${files.length}개뿐이다 — 이 시험이 공회전한다`);
  /**
   * ⚠**「그 롤을 쓰는 모양」만 본다 — 낱말이 아니라.** 낱말로 세면 **왜 안 쓰는지 적어 둔 주석**이
   * 전부 걸려서, 이유를 적을수록 시험이 빨개진다. 그러면 다음 사람이 주석을 지운다.
   * 서버가 짓는 형태(`role="…"`)와 클라이언트가 붙이는 형태(`setAttribute("role","…")`) 둘 다 본다.
   *
   * ⚠**주석은 대상이 아니다**(`source-figures.test.ts` 와 같은 판단) — 사람이 읽는 기록이고,
   * 여기 남은 `role="option"` 은 **2026-08-19 에 그것 때문에 링크가 안 눌렸다는 이력**이다.
   */
  const BAD = ['role="listbox"', 'role="combobox"', 'role="option"', '"role","option"', "aria-autocomplete"];
  const strip = (src: string): string =>
    src.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
  const hitsIn = (src: string): string[] => BAD.filter((b) => strip(src).includes(b));

  // ⚠먼저 **잡히는지**를 보인다 — 「0건」은 검사기가 죽어 있을 때도 나오는 값이다(작업규칙 7)
  assert.deepEqual(
    hitsIn('<ul role="listbox"><li role="option"></li></ul>').sort(),
    ['role="listbox"', 'role="option"'],
    "검사기가 옛 형태를 못 잡는다 — 그물이 죽어 있다",
  );
  assert.deepEqual(hitsIn('li.setAttribute("role","option");'), ['"role","option"'], "클라이언트 형태를 못 잡는다");
  // ⚠**주석만 지우고 코드는 남긴다** — 주석을 지우다가 같은 줄의 코드까지 지우면 그물이 헐거워진다
  assert.deepEqual(
    hitsIn('/* role="option" 은 안 쓴다 */\n' + 'const x = \'role="listbox"\';'),
    ['role="listbox"'],
    "주석을 지우면서 코드까지 지웠거나, 주석을 안 지웠다",
  );
  assert.deepEqual(hitsIn("// listbox 라고 부르지 않는다"), [], "설명 주석까지 위반이라고 부른다");

  const left: string[] = [];
  for (const f of files) {
    for (const b of hitsIn(readFileSync(new URL(f, dir), "utf8"))) left.push(`${f}: ${b}`);
  }
  assert.deepEqual(left, [], "listbox/combobox/option 이 아직 남아 있다");
});

/**
 * ⚠**오프시즌에 매일 붉은 오진이 뜼다**(2026-08-21 반증 라운드 · P1 승격).
 *
 * `freshnessBar` 의 stale 판정이 `pastSeason` 하나로만 갈리는데,
 * 그 값은 `pastSeasonOf(seasons)` — **「그리는 시즌 번호가 최신이 아닌가」라는 순수 구조 판정**이고
 * **「이 시즌이 실제로 끝났는가」와는 무관**하다.
 * 그래서 11월~3월(최신 시즌이 끝나고 다음 시즌 첫 경기가 들어오기 전)에는
 * **수집이 멀지 않았는데도** 「取得に失敗している可能性があります」라는 붉은 띄가 매일 뜼다.
 *
 * ⚠**`season-over.test.ts` 가 같은 구멍을 이미 지목했는데 수정은 본문 문구 쪽만 했다** —
 * 이 띄는 그때 남았다. 그게 이 시험의 존재 이유다.
 */
test("⚠끝난 시즌은 「취득 실패」라고 말하지 않는다 — 다음 시즌 경기가 아직 없어도", () => {
  // 10월 19일에 끝난 시즌을 11월 20일에 그린다 — 32일 전이라 지금 코드는 stale 로 본다
  const over = freshness("2026-10-19", "2026-11-20", "2026-10-19", { from: 2018, to: 2026 }, true);
  const barOver = toString(freshnessBar(over, false));
  assert.ok(
    !barOver.includes("取得に失敗している可能性"),
    `끝난 시즌에 수집 실패 경고를 냈다: ${barOver}`,
  );
  assert.ok(!barOver.includes("state stale"), "끝난 시즌에 경고색 띄를 냈다");

  // ⚠**진행 중이면 여전히 경고해야 한다** — 이게 없으면 「늘 조용히」 구현이 통과한다
  const running = freshness("2026-10-19", "2026-11-20", "2026-10-19", { from: 2018, to: 2026 }, false);
  const barRunning = toString(freshnessBar(running, false));
  assert.match(barRunning, /取得に失敗している可能性/, "수집이 멈췄는데 아무 말도 안 했다");
});
