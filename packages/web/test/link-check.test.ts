/**
 * ⚠**깨진 링크는 타입도 시험도 못 잡는다** — 문자열이 문자열로 맞기 때문이다.
 * 이 프로젝트는 구단 페이지를 만들며 **240개를 한 번에** 404로 만든 적이 있다(2026-08-16).
 * 그래서 빌드가 검사하고, 그 검사기를 이 파일이 검사한다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { brokenLinks, duplicateIds, linkIndex } from "../src/link-check.ts";

const page = (path: string, hrefs: string[]): { path: string; content: string } => ({
  path,
  content: hrefs.map((h) => `<a href="${h}">x</a>`).join(""),
});

test("있는 곳으로 가는 링크는 통과한다", () => {
  const out = brokenLinks([
    page("index.html", ["players/1.html", "teams/t.html"]),
    page("players/1.html", ["../index.html", "../teams/t.html"]),
    page("teams/t.html", ["../index.html"]),
  ]);
  assert.deepEqual(out, []);
});

test("없는 곳으로 가는 링크를 잡는다", () => {
  const out = brokenLinks([page("index.html", ["players/999.html"])]);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.to, "players/999.html");
});

/**
 * ⚠**실제로 났던 결함이 이 모양이다.** 데이터 계층이 깊이를 모르는 채 링크를 만들어
 * 구단 페이지(`teams/t.html`)에서 `games/…` 를 걸었고, 실제 파일은 `../games/…` 였다.
 */
test("깊이를 틀린 링크를 잡는다 — 240개가 이렇게 죽었다", () => {
  const out = brokenLinks([
    page("teams/t.html", ["games/2026-0814-t-db-17.html"]),
    { path: "games/2026-0814-t-db-17.html", content: "" },
  ]);
  assert.equal(out.length, 1, "깊이가 틀린 링크를 놓쳤다");
  assert.equal(out[0]!.to, "teams/games/2026-0814-t-db-17.html");
});

test("`..` 로 시즌 경계를 넘는 링크도 해석한다", () => {
  const out = brokenLinks([
    page("2025/players/1.html", ["../../index.html", "../teams/t.html"]),
    { path: "index.html", content: "" },
    { path: "2025/teams/t.html", content: "" },
  ]);
  assert.deepEqual(out, []);
});

test("바깥으로 나가는 링크는 검사하지 않는다 — 우리가 만드는 파일이 아니다", () => {
  const out = brokenLinks([
    page("index.html", [
      "https://npb.jp/",
      "http://npb.jp/",
      // ⚠슬래시 두 개도 절대 링크다. 놓치면 외부 링크를 내부로 오해한다
      "//npb.jp/",
      "mailto:a@b.c",
      "",
    ]),
  ]);
  assert.deepEqual(out, []);
});

/**
 * ⚠**같은 페이지 안의 앵커는 「바깥」이 아니다.**
 *
 * 예전에는 `#` 으로 시작하면 외부로 보고 **통째로 건너뛰었다** — 그래서 대시보드의 점프 내비가
 * 없는 구획을 가리켜도 조용히 아무 일이 없었다(M12). 게다가 커밋 메시지에
 * 「빌드가 앵커를 본다」고 적었는데 **그 문장이 거짓이었다**(2026-08-17 검토 P1).
 * ⚠**이 시험이 그 잘못된 동작을 고정하고 있었다** — `"#top"` 을 넣고 `[]` 를 기대했다.
 *   시험이 구현을 붙잡고 있으면 고칠 수가 없다.
 */
test("⚠같은 페이지 안의 앵커도 검사한다 — 없는 곳을 가리키면 잡는다", () => {
  const out = brokenLinks([
    { path: "index.html", content: '<a href="#nope">x</a><section id="here"></section>' },
  ]);
  assert.equal(out.length, 1, "없는 앵커를 놓쳤다");
  assert.equal(out[0]!.href, "#nope");
  assert.equal(out[0]!.kind, "anchor");
});

test("같은 페이지 안의 앵커가 실제로 있으면 통과한다", () => {
  const out = brokenLinks([
    { path: "index.html", content: '<a href="#here">x</a><section id="here"></section>' },
  ]);
  assert.deepEqual(out, []);
});

/**
 * ⚠**쿼리는 떼고 보지만 앵커는 뗀 뒤에 따로 본다.**
 * 쿼리는 정적 사이트에서 파일을 고르지 않는다(`?vs=` 는 스크립트가 읽는다).
 * 앵커는 다르다 — 닫힌 탭을 여는 것이 그 일이라, 틀리면 화면은 열리는데 아무 일도 안 일어난다.
 */
test("쿼리는 떼고 파일만 본다 — 파일을 고르지 않기 때문이다", () => {
  const out = brokenLinks([
    page("index.html", ["players/1.html?x=1"]),
    { path: "players/1.html", content: "" },
  ]);
  assert.deepEqual(out, []);
});

test("앵커는 떼고 나서 그 앵커가 있는지까지 본다", () => {
  const ok = brokenLinks([
    page("index.html", ["players/1.html#bat"]),
    { path: "players/1.html", content: `<section id="bat">x</section>` },
  ]);
  assert.deepEqual(ok, []);
});

test("디렉터리 링크는 index.html 로 읽는다", () => {
  assert.deepEqual(brokenLinks([page("a.html", ["2025/"]), { path: "2025/index.html", content: "" }]), []);
  assert.equal(brokenLinks([page("a.html", ["2026/"])]).length, 1);
});

test("src 도 본다 — 이미지·스크립트가 빠져도 화면은 깨진다", () => {
  const out = brokenLinks([{ path: "index.html", content: `<img src="i/x.svg">` }]);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.to, "i/x.svg");
});

test("같은 링크를 여러 번 보고하지 않는다 — 한 장에 같은 실수가 반복된다", () => {
  const out = brokenLinks([page("index.html", ["x.html", "x.html", "x.html"])]);
  assert.equal(out.length, 1);
});

test("HTML이 아닌 파일 안의 문자열은 링크로 읽지 않는다", () => {
  // CSS·JSON에도 `href="..."` 를 닮은 문자열이 들어간다. **공백 뒤에 오는 형태까지** 그렇다
  const out = brokenLinks([
    { path: "s.css", content: `.a{content:" href=\"none.html\""}` },
    { path: "d.json", content: `{"tpl": "<a href=\"none.html\">"}` },
  ]);
  assert.deepEqual(out, []);
});

/**
 * ⚠**앵커가 없는 링크는 더 조용히 실패한다.**
 * 파일은 열리므로 404조차 아니다 — 브라우저가 맨 위에 머무르고, 누른 사람은
 * 「아무 일도 안 일어났다」고만 안다. 타대회 화면을 대회별 탭으로 나누면서
 * 선수 페이지가 `postseason.html#pc-<대회id>` 를 가리키게 됐고, 그 링크의 일은
 * **닫힌 탭을 여는 것**이다. 앵커가 틀리면 그 일이 통째로 안 일어난다.
 */
test("파일은 있는데 앵커가 없으면 잡는다", () => {
  const out = brokenLinks([
    page("players/1.html", ["../postseason.html#pc-nipponSeries"]),
    { path: "postseason.html", content: `<div id="pc-climaxSeries">x</div>` },
  ]);
  assert.equal(out.length, 1, "없는 앵커를 흘렸다");
  assert.equal(out[0]!.kind, "anchor", "파일 없음과 앵커 없음을 구별하지 않는다");
  assert.equal(out[0]!.to, "postseason.html");
});

test("앵커가 있으면 통과한다", () => {
  const out = brokenLinks([
    page("players/1.html", ["../postseason.html#pc-nipponSeries"]),
    { path: "postseason.html", content: `<div id="pc-nipponSeries">x</div>` },
  ]);
  assert.deepEqual(out, []);
});

test("파일 자체가 없으면 앵커가 아니라 파일 없음으로 센다", () => {
  const out = brokenLinks([page("a.html", ["nope.html#x"])]);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.kind, "page", "파일이 없는데 앵커 탓으로 돌렸다");
});

test("앵커를 안 물은 링크는 앵커를 따지지 않는다", () => {
  const out = brokenLinks([page("a.html", ["b.html"]), { path: "b.html", content: "" }]);
  assert.deepEqual(out, []);
});

/**
 * ⚠**`id` 도 공백 뒤에 오는 것만 본다.** CSS 의 `[id="x"]` 같은 문자열을 id 로 세면
 * 없는 앵커가 있는 것으로 통과해 버린다 — 검사기가 조용히 무력해진다.
 */
test("문자열 안의 id 흉내를 앵커로 세지 않는다", () => {
  const out = brokenLinks([
    page("a.html", ["b.html#real"]),
    { path: "b.html", content: `.x{content:"id=\"real\""}` },
  ]);
  assert.equal(out.length, 1, "문자열 안의 id 를 진짜 앵커로 셌다");
});

/**
 * ⚠**ARIA 참조도 링크다**(2026-08-18 감사 P2).
 *
 * 予告先発 화면에서 패널 **6개 전부**가 존재하지 않는 탭 id 를 가리키고 있었는데
 * 화면은 멀쩡했고 빌드도 시험도 배포도 통과했다 — **낭독기 사용자에게만** 깨져 있었다.
 * ⚠**깨진 참조는 없는 것보다 나쁘다**: 「이 패널의 이름은 저기」라고 말해 놓고
 * 그 자리가 비어 있으면, 낭독기는 이름 없는 패널을 이름 있는 척 읽는다.
 */
test("⚠존재하지 않는 id 를 가리키는 aria-labelledby 를 잡는다", () => {
  const out = brokenLinks([
    { path: "a.html", content: `<div role="tabpanel" aria-labelledby="tb-x"></div>` },
  ]);
  assert.equal(out.length, 1, "깨진 ARIA 참조를 못 잡았다");
  assert.equal(out[0]?.kind, "aria");
  assert.match(out[0]?.href ?? "", /aria-labelledby="tb-x"/);
});

test("실재하는 id 를 가리키면 통과한다", () => {
  const out = brokenLinks([
    { path: "a.html", content: `<button id="tb-x"></button><div aria-labelledby="tb-x"></div>` },
  ]);
  assert.deepEqual(out, [], "멀쩡한 참조를 깨졌다고 했다");
});

/**
 * ⚠**`aria-controls` 는 공백 구분 목록을 받는다** — 「すべて」 탭이 패널 여럿을 가리킨다.
 * 목록을 통째로 하나의 id 로 보면 멀쩡한 마크업이 전부 깨진 것으로 나온다.
 */
test("⚠aria-controls 의 공백 구분 목록을 하나씩 본다", () => {
  const ok = brokenLinks([
    { path: "a.html", content: `<i id="p1"></i><i id="p2"></i><b aria-controls="p1 p2"></b>` },
  ]);
  assert.deepEqual(ok, [], "목록을 통째로 한 id 로 봤다");

  const bad = brokenLinks([
    { path: "a.html", content: `<i id="p1"></i><b aria-controls="p1 p2"></b>` },
  ]);
  assert.equal(bad.length, 1, "목록 중 하나만 깨진 것을 놓쳤다");
  assert.match(bad[0]?.href ?? "", /p2/);
});

/**
 * ⚠**`aria-label` 은 참조가 아니라 글자다.** 그것까지 id 로 찾으면
 * 멀쩡한 화면이 전부 「깨졌다」로 나와 검사기 자체가 무시당한다.
 */
test("⚠aria-label 은 참조가 아니다 — 글자를 id 로 찾지 않는다", () => {
  const out = brokenLinks([{ path: "a.html", content: `<nav aria-label="試合"></nav>` }]);
  assert.deepEqual(out, []);
});

/**
 * ⚠**ARIA 의 id 참조는 문서를 넘지 않는다.** 옆 페이지에 그 id 가 있어도 소용없다.
 */
test("⚠같은 문서 안에서만 찾는다 — 옆 페이지의 id 는 답이 아니다", () => {
  const out = brokenLinks([
    { path: "a.html", content: `<div aria-labelledby="tb-x"></div>` },
    { path: "b.html", content: `<button id="tb-x"></button>` },
  ]);
  assert.equal(out.length, 1, "다른 문서의 id 로 통과시켰다");
});

/**
 * ⚠**중복 id 는 이 검사기의 사각지대였다**(2026-08-19 감사).
 * `LinkIndex.ids` 가 `Set` 이라 두 번 나온 id 도 「있다」로만 보였고,
 * 앵커 검사와 ARIA 검사가 **둘 다 통과**하는 동안 브라우저는 먼저 나온 사본만 열었다.
 * 실측: `dist/ranking.html` 9장에 중복 id **86종 / 172노드** ·
 * `#pn-rankmetric-starter-era` 로 들어가면 열린 리그 패널이 언제나 `['central']`.
 */
test("⚠같은 문서에 id 가 두 번 있으면 잡는다 — 브라우저는 먼저 나온 하나만 연다", () => {
  const out = duplicateIds([
    linkIndex({ path: "a.html", content: `<div id="x"></div><div id="y"></div><div id="x"></div>` }),
  ]);
  assert.deepEqual(out, [{ path: "a.html", id: "x" }]);
});

/** ⚠**반대편도 잰다** — 늘 잡히는 검사면 위 시험은 아무것도 안 재는 것이다 */
test("id 가 전부 다르면 아무것도 잡지 않는다", () => {
  const out = duplicateIds([
    linkIndex({ path: "a.html", content: `<div id="x"></div><div id="y"></div>` }),
  ]);
  assert.deepEqual(out, []);
});

/**
 * ⚠**문서를 넘어선 중복은 중복이 아니다.** 모든 페이지가 헤더 검색창 `id="q"` 를 갖는 것이
 * 정상인데 문서를 뭉쳐서 세면 전 화면이 「깨졌다」로 나와 검사기 자체가 무시당한다.
 */
test("⚠다른 문서에 같은 id 가 있는 것은 정상이다 — 문서 안에서만 센다", () => {
  const out = duplicateIds([
    linkIndex({ path: "a.html", content: `<input id="q">` }),
    linkIndex({ path: "b.html", content: `<input id="q">` }),
  ]);
  assert.deepEqual(out, []);
});

/** 세 번 나와도 **한 건**으로 보고한다 — 같은 사실을 여러 번 말하지 않는다 */
test("같은 id 가 세 번 나와도 한 건이다", () => {
  const out = duplicateIds([
    linkIndex({ path: "a.html", content: `<b id="x"></b><b id="x"></b><b id="x"></b>` }),
  ]);
  assert.deepEqual(out, [{ path: "a.html", id: "x" }]);
});

/** HTML 이 아닌 파일은 색인에 본문이 없다 — 중복도 없다 */
test("HTML 이 아닌 파일에서는 id 를 세지 않는다", () => {
  const out = duplicateIds([linkIndex({ path: "a.css", content: `#x{} #x{}` })]);
  assert.deepEqual(out, []);
});
