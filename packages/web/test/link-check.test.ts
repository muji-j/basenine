/**
 * ⚠**깨진 링크는 타입도 시험도 못 잡는다** — 문자열이 문자열로 맞기 때문이다.
 * 이 프로젝트는 구단 페이지를 만들며 **240개를 한 번에** 404로 만든 적이 있다(2026-08-16).
 * 그래서 빌드가 검사하고, 그 검사기를 이 파일이 검사한다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { brokenLinks } from "../src/link-check.ts";

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
      "#top",
      "",
    ]),
  ]);
  assert.deepEqual(out, []);
});

test("앵커와 쿼리는 떼고 파일만 본다", () => {
  const out = brokenLinks([
    page("index.html", ["players/1.html#bat", "players/1.html?x=1"]),
    { path: "players/1.html", content: "" },
  ]);
  assert.deepEqual(out, []);
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
