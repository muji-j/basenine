/**
 * 클라이언트 조립 계층을 **실행해서** 검증한다.
 *
 * ⚠**브라우저 검증이 아니다**(`dom-stub.ts` 참조). 여기서 잡는 것은 우리 로직의 결함이다 —
 * 프리셋이 엉뚱한 블록을 켜는가, 순서 바꾸기가 되는가, 저장이 막혀도 화면이 도는가.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { CLIENT_JS } from "../src/assets.ts";
import { BLOCKS, PRESETS } from "../src/blocks.ts";
import { bootstrapFor } from "../src/player-page.ts";
import { El, make, makeDocument, makeStorage } from "./dom-stub.ts";

/** 대전 성적 표의 행. 정렬·좁히기 테스트의 입력 */
const MATCHUPS = [
  { name: "山本", pa: 14, hr: 1, avg: 0.333 },
  { name: "戸郷", pa: 5, hr: 2, avg: 0.6 },
  { name: "今永", pa: 22, hr: 0, avg: 0.25 },
  { name: "森下", pa: 9, hr: 3, avg: 0.5 },
];

/** 탭 한 줄 + 대응 패널. 서버의 `tablist`/`panel`과 같은 모양이어야 한다 */
function tabs(group: string, keys: readonly string[]): { list: El; panels: El[] } {
  const list = make("div", { class: "tabs", role: "tablist", "data-tabgroup": group });
  for (const k of keys) {
    list.appendChild(make("button", { class: "tab", role: "tab", "data-tab": k, "aria-selected": "false" }));
  }
  const panels = keys.map((k) =>
    make("div", { "data-panelgroup": group, "data-panelkey": k, role: "tabpanel" }),
  );
  return { list, panels };
}

/** 선수 페이지의 뼈대를 스텁으로 다시 만든다. 실제 마크업과의 일치는 별도 테스트가 본다 */
function buildPage(): ReturnType<typeof makeDocument> {
  const doc = makeDocument("../");

  const topbar = make("header", { class: "topbar" });
  topbar.appendChild(make("button", { class: "tbtn", id: "themeBtn" }));
  doc.body.appendChild(topbar);

  const main = make("div", { class: "main" });
  doc.body.appendChild(main);

  const rail = make("div", { class: "rail" });
  for (const p of PRESETS) {
    rail.appendChild(make("button", { class: "tab", "data-preset": p.id, "aria-pressed": "false" }));
  }
  for (const d of ["normal", "compact"]) {
    rail.appendChild(make("button", { class: "tab", "data-density": d, "aria-pressed": "false" }));
  }
  rail.appendChild(make("button", { class: "tab", id: "editBtn", "aria-pressed": "false" }));
  main.appendChild(rail);

  const editor = make("section", { class: "editor", id: "editor" });
  editor.hidden = true;
  editor.appendChild(make("div", { class: "blocks", id: "blockList" }));
  main.appendChild(editor);

  for (const b of BLOCKS) {
    const section = make("section", { class: "block", id: `b-${b.id}` });
    const group = b.id === "splits" ? "splits" : b.id === "ranking" ? "pranking" : null;
    if (group !== null) {
      const keys = group === "splits" ? ["hand", "base"] : ["wrcPlus", "ops"];
      const { list, panels } = tabs(group, keys);
      const h = make("h4");
      h.appendChild(list);
      section.appendChild(h);
      for (const p of panels) section.appendChild(p);
    }
    if (b.id === "matchup") {
      const { list } = tabs("matchup", ["pa", "hr", "avg"]);
      const h = make("h4");
      h.appendChild(list);
      section.appendChild(h);
      section.appendChild(make("input", { id: "matchupFilter", type: "search" }));
      section.appendChild(make("span", { id: "matchupCount" }));
      const table = make("table", { id: "matchupTable" });
      const tbody = make("tbody");
      for (const r of MATCHUPS) {
        tbody.appendChild(
          make("tr", { "data-name": r.name, "data-pa": String(r.pa), "data-hr": String(r.hr), "data-avg": String(r.avg) }),
        );
      }
      table.appendChild(tbody);
      section.appendChild(table);
    }
    main.appendChild(section);
  }

  main.appendChild(make("div", { id: "blocksEnd" }));
  main.appendChild(make("footer", { class: "foot" }));
  return doc;
}

function run(doc: ReturnType<typeof makeDocument>, storage = makeStorage()): void {
  const win: Record<string, unknown> = {};
  // 서버가 심는 것과 **같은 함수**로 만든다 — 두 벌이 되면 어긋난다
  new Function("window", `${bootstrapFor("batter")}`)(win);
  new Function("document", "localStorage", "window", "fetch", CLIENT_JS)(
    doc,
    storage,
    win,
    () => Promise.reject(new Error("no network")),
  );
}

function visible(doc: ReturnType<typeof makeDocument>): string[] {
  return doc
    .querySelectorAll(".block")
    .filter((el) => !el.hidden)
    .map((el) => el.id.replace("b-", ""));
}

function press(doc: ReturnType<typeof makeDocument>, attr: string, value: string): void {
  const btn = doc.querySelectorAll(`[data-${attr}]`).find((b) => b.dataset[attr] === value);
  assert.notEqual(btn, undefined, `${attr}=${value} 버튼이 없다`);
  btn!.fire("click");
}

test("초기 상태는 標準 프리셋이고 그 블록만 보인다", () => {
  const doc = buildPage();
  run(doc);
  const standard = PRESETS.find((p) => p.id === "standard")!;
  assert.deepEqual(visible(doc), [...standard.blocks]);
});

test("프리셋을 바꾸면 그 프리셋의 블록만 그 순서로 보인다", () => {
  const doc = buildPage();
  run(doc);
  for (const preset of PRESETS) {
    press(doc, "preset", preset.id);
    assert.deepEqual(visible(doc), [...preset.blocks], `${preset.id} 프리셋이 어긋난다`);
  }
});

test("블록은 기준점 앞에 꽂힌다 — 꼬리말·내비를 넘어가지 않는다", () => {
  const doc = buildPage();
  run(doc);
  const main = doc.querySelector(".main")!;
  const ids = main.children.map((c) => c.id || c.className);
  assert.ok(ids.indexOf("blocksEnd") < ids.indexOf("foot"), "기준점이 꼬리말 뒤로 갔다");
  const lastBlock = Math.max(...main.children.map((c, i) => (c.className === "block" ? i : -1)));
  assert.ok(lastBlock < ids.indexOf("blocksEnd"), "블록이 기준점을 넘어갔다");
});

test("조립 UI는 켜야 나온다 — 설정 화면부터 보여주지 않는다", () => {
  const doc = buildPage();
  run(doc);
  const editor = doc.getElementById("editor")!;
  assert.equal(editor.hidden, true);
  doc.getElementById("editBtn")!.fire("click");
  assert.equal(editor.hidden, false);
  assert.equal(doc.getElementById("editBtn")!.getAttribute("aria-pressed"), "true");
});

test("조립 목록에는 모든 블록이 나오고 켜진 것만 체크돼 있다", () => {
  const doc = buildPage();
  run(doc);
  const rows = doc.querySelectorAll("#blockList .brow");
  assert.equal(rows.length, BLOCKS.length);
  const checked = rows.filter((r) => r.querySelector("input")!.checked).length;
  assert.equal(checked, PRESETS.find((p) => p.id === "standard")!.blocks.length);
});

test("체크를 끄면 그 블록이 사라지고 프리셋 선택이 풀린다", () => {
  const doc = buildPage();
  run(doc);
  const before = visible(doc);
  const cb = doc.querySelector("#blockList .brow input")!;
  cb.checked = false;
  cb.fire("change");
  assert.equal(visible(doc).length, before.length - 1);
  const pressed = doc.querySelectorAll("[data-preset]").filter((b) => b.getAttribute("aria-pressed") === "true");
  assert.deepEqual(pressed, [], "직접 조립했는데 프리셋이 선택된 채로 남았다");
});

test("↓로 순서를 바꾸면 화면 순서가 따라간다", () => {
  const doc = buildPage();
  run(doc);
  const before = visible(doc);
  // 첫 행의 ↓ 버튼
  const down = doc.querySelectorAll("#blockList .brow .mv")[1]!;
  down.fire("click");
  const after = visible(doc);
  assert.deepEqual(after, [before[1]!, before[0]!, ...before.slice(2)]);
});

test("맨 위 블록의 ↑와 맨 아래의 ↓는 눌리지 않는다", () => {
  const doc = buildPage();
  run(doc);
  const rows = doc.querySelectorAll("#blockList .brow");
  const n = PRESETS.find((p) => p.id === "standard")!.blocks.length;
  assert.equal(rows[0]!.querySelectorAll(".mv")[0]!.getAttribute("disabled") ?? "d", "d");
  assert.equal(rows[0]!.querySelectorAll(".mv")[0]!.hidden, false);
  // 스텁은 disabled를 프로퍼티로 갖지 않으므로 클릭해도 순서가 안 바뀌는 것으로 확인한다
  const before = visible(doc);
  rows[0]!.querySelectorAll(".mv")[0]!.fire("click");
  assert.deepEqual(visible(doc), before);
  rows[n - 1]!.querySelectorAll(".mv")[1]!.fire("click");
  assert.deepEqual(visible(doc), before);
});

test("설정은 저장되고 다음 방문에 살아난다", () => {
  const storage = makeStorage();
  const first = buildPage();
  run(first, storage);
  press(first, "preset", "simple");

  const second = buildPage();
  run(second, storage);
  assert.deepEqual(visible(second), [...PRESETS.find((p) => p.id === "simple")!.blocks]);
});

test("저장이 막혀도 화면은 동작한다", () => {
  const doc = buildPage();
  assert.doesNotThrow(() => run(doc, makeStorage(true)));
  assert.deepEqual(visible(doc), [...PRESETS.find((p) => p.id === "standard")!.blocks]);
  assert.doesNotThrow(() => press(doc, "preset", "analysis"));
  assert.deepEqual(visible(doc), [...PRESETS.find((p) => p.id === "analysis")!.blocks]);
});

function openPanels(doc: ReturnType<typeof makeDocument>, group: string): (string | undefined)[] {
  return doc
    .querySelectorAll(`[data-panelgroup="${group}"]`)
    .filter((p) => !p.hidden)
    .map((p) => p.dataset["panelkey"]);
}

function clickTab(doc: ReturnType<typeof makeDocument>, group: string, key: string): void {
  const btn = doc.querySelectorAll(`[data-tabgroup="${group}"] [data-tab]`).find((b) => b.dataset["tab"] === key);
  assert.notEqual(btn, undefined, `${group}:${key} 탭이 없다`);
  btn!.fire("click");
}

test("스플릿 축을 바꾸면 그 패널만 남는다", () => {
  const doc = buildPage();
  run(doc);
  assert.deepEqual(openPanels(doc, "splits"), ["hand"]);
  clickTab(doc, "splits", "base");
  assert.deepEqual(openPanels(doc, "splits"), ["base"]);
});

test("순위 지표를 바꾸면 그 표만 남는다", () => {
  const doc = buildPage();
  run(doc);
  assert.deepEqual(openPanels(doc, "pranking"), ["wrcPlus"]);
  clickTab(doc, "pranking", "ops");
  assert.deepEqual(openPanels(doc, "pranking"), ["ops"]);
});

test("탭 선택도 저장된다", () => {
  const storage = makeStorage();
  const first = buildPage();
  run(first, storage);
  clickTab(first, "splits", "base");

  const second = buildPage();
  run(second, storage);
  assert.deepEqual(openPanels(second, "splits"), ["base"]);
});

test("저장된 탭이 지금 없는 값이면 첫 탭으로 돌아간다", () => {
  const storage = makeStorage();
  storage.setItem("npb-meikan-layout", JSON.stringify({ tabs: { splits: "존재하지않음" } }));
  const doc = buildPage();
  run(doc, storage);
  assert.deepEqual(openPanels(doc, "splits"), ["hand"]);
});

test("대전 성적은 기본이 대전수 순이다", () => {
  const doc = buildPage();
  run(doc);
  const names = doc.querySelectorAll("#matchupTable tbody tr").map((r) => r.dataset["name"]);
  assert.deepEqual(names, ["今永", "山本", "森下", "戸郷"]);
});

test("본루타순으로 바꾸면 순서가 바뀐다", () => {
  const doc = buildPage();
  run(doc);
  clickTab(doc, "matchup", "hr");
  const names = doc.querySelectorAll("#matchupTable tbody tr").map((r) => r.dataset["name"]);
  assert.deepEqual(names, ["森下", "戸郷", "山本", "今永"]);
});

test("타율순은 10타석 미만을 뺀다 — 5타석 .600을 맨 위에 올리지 않는다", () => {
  const doc = buildPage();
  run(doc);
  clickTab(doc, "matchup", "avg");
  const shown = doc
    .querySelectorAll("#matchupTable tbody tr")
    .filter((r) => !r.hidden)
    .map((r) => r.dataset["name"]);
  assert.deepEqual(shown, ["山本", "今永"]);
  assert.ok(!shown.includes("戸郷"), "5타석짜리가 타율순에 남았다");
  assert.equal(doc.getElementById("matchupCount")!.textContent, "2件");
});

test("대전 상대를 이름으로 좁힐 수 있다", () => {
  const doc = buildPage();
  run(doc);
  const input = doc.getElementById("matchupFilter")!;
  input.value = "山";
  input.fire("input");
  const shown = doc
    .querySelectorAll("#matchupTable tbody tr")
    .filter((r) => !r.hidden)
    .map((r) => r.dataset["name"]);
  assert.deepEqual(shown, ["山本"]);
  assert.equal(doc.getElementById("matchupCount")!.textContent, "1件");
});

test("테마는 자동 → 밝게 → 어둡게로 돌고 저장된다", () => {
  const storage = makeStorage();
  const doc = buildPage();
  run(doc, storage);
  const btn = doc.getElementById("themeBtn")!;
  assert.equal(doc.documentElement.getAttribute("data-theme"), null);
  btn.fire("click");
  assert.equal(doc.documentElement.getAttribute("data-theme"), "light");
  btn.fire("click");
  assert.equal(doc.documentElement.getAttribute("data-theme"), "dark");
  btn.fire("click");
  assert.equal(doc.documentElement.getAttribute("data-theme"), null);

  btn.fire("click");
  const again = buildPage();
  run(again, storage);
  assert.equal(again.documentElement.getAttribute("data-theme"), "light");
});

test("밀도를 바꾸면 블록 여백이 바뀐다", () => {
  const doc = buildPage();
  run(doc);
  assert.equal(doc.querySelector(".block")!.style["paddingTop"], "16px");
  press(doc, "density", "compact");
  assert.equal(doc.querySelector(".block")!.style["paddingTop"], "9px");
});

test("저장된 설정이 깨져 있어도 기본값으로 돌아간다", () => {
  const storage = makeStorage();
  storage.setItem("npb-meikan-layout", '{"order":"망가짐"}');
  const doc = buildPage();
  assert.doesNotThrow(() => run(doc, storage));
  assert.deepEqual(visible(doc), [...PRESETS.find((p) => p.id === "standard")!.blocks]);
});

test("스텁이 모르는 선택자는 조용히 넘어가지 않는다", () => {
  const el = new El("div");
  assert.throws(() => el.querySelectorAll("div > span"), /스텁이 모르는 선택자/);
});
