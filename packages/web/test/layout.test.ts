import { test } from "node:test";
import assert from "node:assert/strict";
import { toString } from "../src/html.ts";
import {
  STALE_AFTER_DAYS,
  freshness,
  freshnessBar,
  isStale,
  page,
  safeScript,
  stateNote,
} from "../src/layout.ts";
import { NEUTRAL_COLOR } from "@bb-app/domain";
import { renderTodayPage } from "../src/today-page.ts";
import { context } from "./fixtures.ts";
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
