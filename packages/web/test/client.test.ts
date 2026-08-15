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

/** 정렬 가능한 열. 서버(`player-page.ts`)의 목록과 같은 키여야 한다 */
const MATCHUP_COLUMNS: { key: string; label: string; type: "text" | "num"; rate?: true }[] = [
  { key: "name", label: "投手", type: "text" },
  { key: "team", label: "球団", type: "text" },
  { key: "pa", label: "打席", type: "num" },
  { key: "hr", label: "本塁打", type: "num" },
  { key: "avg", label: "打率", type: "num", rate: true },
];

/** 대전 성적 표의 행. 정렬·좁히기 테스트의 입력. `avg: null`은 타수 0 */
const MATCHUPS: { name: string; team: string; pa: number; hr: number; avg: number | null }[] = [
  { name: "山本", team: "B", pa: 14, hr: 1, avg: 0.333 },
  { name: "戸郷", team: "G", pa: 5, hr: 2, avg: 0.6 },
  { name: "今永", team: "DB", pa: 22, hr: 0, avg: 0.25 },
  { name: "森下", team: "C", pa: 9, hr: 3, avg: 0.5 },
  { name: "大勢", team: "G", pa: 2, hr: 0, avg: null },
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
      const h = make("h4");
      // 최소 타석은 탭이 아니라 버튼 묶음이다(여는 패널이 없다)
      const min = make("div", { class: "tabs", role: "group", "data-tabgroup": "matchupMin" });
      for (const n of ["1", "5", "10", "20"]) {
        min.appendChild(make("button", { class: "tab", "data-tab": n, "aria-pressed": "false" }));
      }
      h.appendChild(min);
      section.appendChild(h);
      section.appendChild(make("input", { id: "matchupFilter", type: "search" }));
      const sel = make("select", { id: "matchupTeam" });
      const all = make("option", { value: "" });
      all.textContent = "すべての球団";
      sel.appendChild(all);
      for (const code of [...new Set(MATCHUPS.map((m) => m.team))]) {
        const o = make("option", { value: code });
        o.textContent = code;
        sel.appendChild(o);
      }
      section.appendChild(sel);
      section.appendChild(make("span", { id: "matchupCount" }));
      section.appendChild(make("p", { id: "matchupStatus" }));

      const table = make("table", { id: "matchupTable" });
      const thead = make("thead");
      const hrow = make("tr");
      for (const c of MATCHUP_COLUMNS) {
        const th = make("th", { "aria-sort": c.key === "pa" ? "descending" : "none" });
        const btn = make("button", {
          class: "sortable",
          "data-sortkey": c.key,
          "data-sorttype": c.type,
          ...(c.rate === true ? { "data-sortrate": "1" } : {}),
        });
        btn.textContent = c.label;
        th.appendChild(btn);
        hrow.appendChild(th);
      }
      thead.appendChild(hrow);
      table.appendChild(thead);

      const tbody = make("tbody");
      for (const r of MATCHUPS) {
        const attrs: Record<string, string> = {
          "data-name": r.name,
          // 정렬은 표기(사람이 읽는 이름), 좁히기는 코드로 한다
          "data-team": r.team,
          "data-teamcode": r.team,
          "data-pa": String(r.pa),
          "data-hr": String(r.hr),
        };
        // ⚠타율이 없는 행은 속성 자체가 없다 — 「없음」과 「.000」은 다르다
        if (r.avg !== null) attrs["data-avg"] = String(r.avg);
        tbody.appendChild(make("tr", attrs));
      }
      table.appendChild(tbody);
      section.appendChild(table);
      const empty = make("p", { class: "empty", id: "matchupEmpty" });
      empty.hidden = true;
      section.appendChild(empty);
    }
    main.appendChild(section);
  }

  main.appendChild(make("div", { id: "blocksEnd" }));
  main.appendChild(make("footer", { class: "foot" }));
  return doc;
}

interface RunOptions {
  storage?: Storage;
  /** `players.json`의 내용. 주지 않으면 취득 실패로 다룬다 */
  index?: { i: string; n: string; t: string }[];
  /** `location` 대역. `?vs=` 처리를 보려면 필요하다 */
  location?: { search: string; href: string };
}

function run(doc: ReturnType<typeof makeDocument>, opts: RunOptions = {}): { location: { search: string; href: string } } {
  const win: Record<string, unknown> = {};
  const loc = opts.location ?? { search: "", href: "" };
  // 서버가 심는 것과 **같은 함수**로 만든다 — 두 벌이 되면 어긋난다
  new Function("window", `${bootstrapFor("batter")}`)(win);
  const fetchImpl =
    opts.index === undefined
      ? () => Promise.reject(new Error("no network"))
      : () => Promise.resolve({ json: () => Promise.resolve(opts.index) });
  new Function("document", "localStorage", "window", "fetch", "location", CLIENT_JS)(
    doc,
    opts.storage ?? makeStorage(),
    win,
    fetchImpl,
    loc,
  );
  return { location: loc };
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
  run(first, { storage });
  press(first, "preset", "simple");

  const second = buildPage();
  run(second, { storage });
  assert.deepEqual(visible(second), [...PRESETS.find((p) => p.id === "simple")!.blocks]);
});

test("저장이 막혀도 화면은 동작한다", () => {
  const doc = buildPage();
  assert.doesNotThrow(() => run(doc, { storage: makeStorage(true) }));
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

test("「すべて」를 고르면 그 그룹의 패널이 전부 열린다", () => {
  const doc = makeDocument("");
  const { list, panels } = tabs("starters", ["d-g", "s-db", "l-m"]);
  // 서버는 「すべて」 버튼을 같은 탭줄에 넣는다
  list.appendChild(make("button", { class: "card", role: "tab", "data-tab": "all" }));
  doc.body.appendChild(list);
  for (const p of panels) doc.body.appendChild(p);
  run(doc);

  assert.deepEqual(openPanels(doc, "starters"), ["d-g"]);
  clickTab(doc, "starters", "all");
  assert.deepEqual(openPanels(doc, "starters"), ["d-g", "s-db", "l-m"]);
  clickTab(doc, "starters", "l-m");
  assert.deepEqual(openPanels(doc, "starters"), ["l-m"]);
});

test("⚠어제 고른 경기가 오늘 없으면 첫 경기로 돌아간다 — 대전 카드는 매일 바뀐다", () => {
  const storage = makeStorage();
  storage.setItem("npb-meikan-layout", JSON.stringify({ tabs: { starters: "c-t" } }));
  const doc = makeDocument("");
  const { list, panels } = tabs("starters", ["d-g", "s-db"]);
  doc.body.appendChild(list);
  for (const p of panels) doc.body.appendChild(p);
  run(doc, { storage });
  assert.deepEqual(openPanels(doc, "starters"), ["d-g"]);
});

test("탭 선택도 저장된다", () => {
  const storage = makeStorage();
  const first = buildPage();
  run(first, { storage });
  clickTab(first, "splits", "base");

  const second = buildPage();
  run(second, { storage });
  assert.deepEqual(openPanels(second, "splits"), ["base"]);
});

test("저장된 탭이 지금 없는 값이면 첫 탭으로 돌아간다", () => {
  const storage = makeStorage();
  storage.setItem("npb-meikan-layout", JSON.stringify({ tabs: { splits: "존재하지않음" } }));
  const doc = buildPage();
  run(doc, { storage });
  assert.deepEqual(openPanels(doc, "splits"), ["hand"]);
});

function order(doc: ReturnType<typeof makeDocument>): (string | undefined)[] {
  return doc.querySelectorAll("#matchupTable tbody tr").map((r) => r.dataset["name"]);
}

function shownNames(doc: ReturnType<typeof makeDocument>): (string | undefined)[] {
  return doc
    .querySelectorAll("#matchupTable tbody tr")
    .filter((r) => !r.hidden)
    .map((r) => r.dataset["name"]);
}

function clickHeader(doc: ReturnType<typeof makeDocument>, key: string): void {
  const b = doc.querySelectorAll(".sortable").find((x) => x.dataset["sortkey"] === key);
  assert.notEqual(b, undefined, `${key} 머리 버튼이 없다`);
  b!.fire("click");
}

test("대전 성적은 기본이 대전수 많은 순이다", () => {
  const doc = buildPage();
  run(doc);
  assert.deepEqual(order(doc), ["今永", "山本", "森下", "戸郷", "大勢"]);
  assert.match(doc.getElementById("matchupStatus")!.textContent, /打席の多い順/);
});

test("머리를 누르면 그 열로 정렬된다", () => {
  const doc = buildPage();
  run(doc);
  clickHeader(doc, "hr");
  assert.deepEqual(order(doc), ["森下", "戸郷", "山本", "今永", "大勢"]);
  assert.match(doc.getElementById("matchupStatus")!.textContent, /本塁打の多い順/);
});

test("같은 머리를 다시 누르면 방향이 뒤집힌다", () => {
  const doc = buildPage();
  run(doc);
  clickHeader(doc, "hr");
  clickHeader(doc, "hr");
  assert.deepEqual(order(doc).slice(0, 2), ["今永", "大勢"]);
  assert.match(doc.getElementById("matchupStatus")!.textContent, /本塁打の少ない順/);
});

test("문자 열은 오름차순에서 시작한다 — 이름은 가나다순이 자연스럽다", () => {
  const doc = buildPage();
  run(doc);
  clickHeader(doc, "team");
  assert.match(doc.getElementById("matchupStatus")!.textContent, /球団 昇順/);
});

test("aria-sort가 지금 정렬된 열에만 붙는다", () => {
  const doc = buildPage();
  run(doc);
  clickHeader(doc, "avg");
  const sorted = doc
    .querySelectorAll("th")
    .filter((th) => th.getAttribute("aria-sort") !== "none")
    .map((th) => th.querySelector(".sortable")!.dataset["sortkey"]);
  assert.deepEqual(sorted, ["avg"]);
});

test("⚠값이 없는 행은 방향과 무관하게 뒤로 간다 — 「기록 없음」이 1위가 되면 안 된다(M11)", () => {
  const doc = buildPage();
  run(doc);
  clickHeader(doc, "avg");
  assert.equal(order(doc).at(-1), "大勢", "내림차순에서 타수 0이 뒤로 가지 않았다");
  clickHeader(doc, "avg");
  assert.equal(order(doc).at(-1), "大勢", "오름차순에서 타수 0이 앞으로 왔다");
});

test("최소 타석으로 좁힐 수 있다", () => {
  const doc = buildPage();
  run(doc);
  assert.equal(shownNames(doc).length, 5);
  clickTab(doc, "matchupMin", "10");
  assert.deepEqual(shownNames(doc), ["今永", "山本"]);
  assert.equal(doc.getElementById("matchupCount")!.textContent, "2件");
  assert.match(doc.getElementById("matchupStatus")!.textContent, /10打席以上/);
});

test("⚠율로 정렬하면서 표본이 얇으면 막지 않고 말한다", () => {
  const doc = buildPage();
  run(doc);
  clickHeader(doc, "avg");
  const status = doc.getElementById("matchupStatus")!.textContent;
  assert.match(status, /10打席未満が3件混ざっています/);
  // 막지 않는다 — 5타석 .600이 맨 위에 있다
  assert.equal(order(doc)[0], "戸郷");
});

test("좁히면 경고가 사라진다 — 없는 위험을 계속 말하지 않는다", () => {
  const doc = buildPage();
  run(doc);
  clickHeader(doc, "avg");
  clickTab(doc, "matchupMin", "10");
  assert.ok(!doc.getElementById("matchupStatus")!.textContent.includes("混ざって"));
});

test("구단을 고르면 그 구단 상대만 남는다", () => {
  const doc = buildPage();
  run(doc);
  const sel = doc.getElementById("matchupTeam")!;
  sel.value = "G";
  sel.fire("change");
  assert.deepEqual(shownNames(doc), ["戸郷", "大勢"]);
  assert.equal(doc.getElementById("matchupCount")!.textContent, "2件");
  assert.match(doc.getElementById("matchupStatus")!.textContent, /· G/);
});

test("구단 · 이름 · 최소 타석이 함께 걸린다", () => {
  const doc = buildPage();
  run(doc);
  const sel = doc.getElementById("matchupTeam")!;
  sel.value = "G";
  sel.fire("change");
  clickTab(doc, "matchupMin", "5");
  assert.deepEqual(shownNames(doc), ["戸郷"], "2타석짜리가 남았다");
});

test("구단 선택도 저장된다", () => {
  const storage = makeStorage();
  const first = buildPage();
  run(first, { storage });
  const sel = first.getElementById("matchupTeam")!;
  sel.value = "G";
  sel.fire("change");

  const second = buildPage();
  run(second, { storage });
  assert.equal(second.getElementById("matchupTeam")!.value, "G");
  assert.deepEqual(shownNames(second), ["戸郷", "大勢"]);
});

test("⚠저장된 구단이 이 선수의 선택지에 없으면 「すべて」로 돌아간다 — 0건 화면이 되지 않게", () => {
  const storage = makeStorage();
  storage.setItem("npb-meikan-layout", JSON.stringify({ matchupTeam: "t" }));
  const doc = buildPage();
  run(doc, { storage });
  assert.equal(doc.getElementById("matchupTeam")!.value, "");
  assert.equal(shownNames(doc).length, MATCHUPS.length);
});

test("정렬 선택도 저장된다", () => {
  const storage = makeStorage();
  const first = buildPage();
  run(first, { storage });
  clickHeader(first, "hr");

  const second = buildPage();
  run(second, { storage });
  assert.deepEqual(order(second), ["森下", "戸郷", "山本", "今永", "大勢"]);
});

test("저장된 정렬 열이 지금 표에 없으면 기본으로 돌아간다", () => {
  const storage = makeStorage();
  storage.setItem("npb-meikan-layout", JSON.stringify({ matchup: { key: "存在しない", dir: "asc" } }));
  const doc = buildPage();
  assert.doesNotThrow(() => run(doc, { storage }));
  assert.deepEqual(order(doc), ["今永", "山本", "森下", "戸郷", "大勢"]);
});

test("대전 상대를 이름으로 좁힐 수 있다", () => {
  const doc = buildPage();
  run(doc);
  const input = doc.getElementById("matchupFilter")!;
  input.value = "山";
  input.fire("input");
  assert.deepEqual(shownNames(doc), ["山本"]);
  assert.equal(doc.getElementById("matchupCount")!.textContent, "1件");
});

test("테마는 자동 → 밝게 → 어둡게로 돌고 저장된다", () => {
  const storage = makeStorage();
  const doc = buildPage();
  run(doc, { storage });
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
  run(again, { storage });
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
  assert.doesNotThrow(() => run(doc, { storage }));
  assert.deepEqual(visible(doc), [...PRESETS.find((p) => p.id === "standard")!.blocks]);
});

test("스텁이 모르는 선택자는 조용히 넘어가지 않는다", () => {
  const el = new El("div");
  assert.throws(() => el.querySelectorAll("div > span"), /스텁이 모르는 선택자/);
});

// ─── 対戦を選ぶ ─────────────────────────────────────────────────────────

const INDEX = [
  { i: "p1", n: "山本", t: "オリックス・バファローズ" },
  { i: "b1", n: "佐藤", t: "阪神タイガース" },
];

/** 「対戦を選ぶ」 화면의 뼈대 */
function buildPicker(): ReturnType<typeof makeDocument> {
  const doc = makeDocument("");
  const form = make("section", { class: "block", id: "pickForm" });
  for (const [id, key] of [
    ["Pitcher", "pitcher"],
    ["Batter", "batter"],
  ]) {
    form.appendChild(make("input", { id: `pick${id}`, type: "search", "aria-expanded": "false" }));
    form.appendChild(make("ul", { id: `pick${id}Hits`, role: "listbox" }));
    form.appendChild(make("b", { id: `pick-${key}-chosen` }));
  }
  const go = make("button", { id: "pickGo", type: "button" });
  go.disabled = true;
  form.appendChild(go);
  doc.body.appendChild(form);
  return doc;
}

/** 검색창에 입력하고, 색인 fetch가 끝난 뒤 결과 목록을 돌려준다 */
async function search(doc: ReturnType<typeof makeDocument>, inputId: string, term: string): Promise<El[]> {
  const input = doc.getElementById(inputId)!;
  input.fire("focus");
  input.value = term;
  input.fire("input");
  // 색인 fetch가 microtask 여러 단계로 풀린다 — 매크로태스크 하나로 전부 흘려보낸다
  await new Promise((resolve) => setTimeout(resolve, 0));
  return doc.querySelectorAll(`#${inputId}Hits li`);
}

test("투수와 타자를 고르면 버튼이 열리고, 타자 페이지로 상대를 달고 간다", async () => {
  const doc = buildPicker();
  const { location } = run(doc, { index: INDEX });
  const go = doc.getElementById("pickGo")!;
  assert.equal(go.disabled, true, "아무것도 안 고른 상태에서 버튼이 열려 있다");

  (await search(doc, "pickPitcher", "山"))[0]!.querySelector("a")!.fire("click");
  assert.equal(doc.getElementById("pick-pitcher-chosen")!.textContent, "山本（オリックス・バファローズ）");
  assert.equal(go.disabled, true, "한쪽만 골랐는데 버튼이 열렸다");

  (await search(doc, "pickBatter", "佐"))[0]!.querySelector("a")!.fire("click");
  assert.equal(go.disabled, false);

  go.fire("click");
  assert.equal(location.href, `players/b1.html?vs=${encodeURIComponent("山本")}#b-matchup`);
});

test("색인을 못 받으면 고르기 화면이 그렇다고 말한다", async () => {
  const doc = buildPicker();
  run(doc);
  const items = await search(doc, "pickPitcher", "山");
  assert.equal(items.length, 1);
  assert.match(items[0]!.textContent, /読み込めませんでした/);
});

test("?vs= 로 오면 상대가 미리 채워지고 대전 블록이 열린다", () => {
  const doc = buildPage();
  run(doc, { location: { search: `?vs=${encodeURIComponent("今永")}`, href: "" } });
  assert.equal(doc.getElementById("matchupFilter")!.value, "今永");
  assert.equal(doc.getElementById("b-matchup")!.hidden, false, "대전 블록이 닫혀 있다");
  const shown = doc
    .querySelectorAll("#matchupTable tbody tr")
    .filter((r) => !r.hidden)
    .map((r) => r.dataset["name"]);
  assert.deepEqual(shown, ["今永"]);
});

test("?vs= 는 저장된 구성을 바꾸지 않는다 — 이번 방문에만 연다", () => {
  const storage = makeStorage();
  const first = buildPage();
  run(first, { storage, location: { search: `?vs=${encodeURIComponent("今永")}`, href: "" } });

  const second = buildPage();
  run(second, { storage });
  assert.equal(second.getElementById("b-matchup")!.hidden, true, "다음 방문에도 대전 블록이 켜져 있다");
});

test("대전이 없는 조합이면 빈 표가 아니라 그렇다고 말한다(M12)", () => {
  const doc = buildPage();
  run(doc, { location: { search: `?vs=${encodeURIComponent("存在しない投手")}`, href: "" } });
  assert.equal(doc.getElementById("matchupCount")!.textContent, "0件");
  assert.equal(doc.getElementById("matchupEmpty")!.hidden, false);
});
