/**
 * 클라이언트 조립 계층을 **실행해서** 검증한다.
 *
 * ⚠**브라우저 검증이 아니다**(`dom-stub.ts` 참조). 여기서 잡는 것은 우리 로직의 결함이다 —
 * 프리셋이 엉뚱한 블록을 켜는가, 순서 바꾸기가 되는가, 저장이 막혀도 화면이 도는가.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { CLIENT_JS } from "../src/assets.ts";
import { BLOCKS, PRESETS, blocksFor, presetsFor } from "../src/blocks.ts";

/**
 * ⚠**클라이언트에 실제로 실리는 목록**이다(`bootstrapFor("batter")`와 같은 것).
 * 필터 전 `PRESETS`와 비교하면 투수 전용 블록이 타자 화면에 섞여도 테스트가 통과한다.
 */
const BATTER_PRESETS = presetsFor("batter");
const BATTER_BLOCKS = blocksFor("batter");
import { bootstrapFor } from "../src/player-page.ts";
import { El, make, makeDocument, makeStorage } from "./dom-stub.ts";
import { compareCard } from "../src/compare.ts";
import { playerPage } from "./fixtures.ts";

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
  index?: { i: string; n: string; t: string; s?: string }[];
  /** `location` 대역. `?vs=` 처리와 `#앵커` 처리를 보려면 필요하다 */
  location?: { search: string; href: string; hash?: string };
  /**
   * URL 조각 → 응답 본문. `compare/p.json` 처럼 **부분 일치**로 고른다.
   * ⚠**요청 URL을 보는 스텁이 필요했다** — 예전 스텁은 URL을 무시하고 `index` 를 돌려줬다.
   * 그래서 「어느 파일을 몇 번 받는가」를 재는 시험을 쓸 수 없었다.
   */
  routes?: Record<string, unknown>;
  /**
   * 응답을 늦출 URL 조각 → 풀어 줄 함수를 받는 곳.
   * ⚠**지연 차를 만들 수 있어야 경합을 잴 수 있다** — 모든 응답이 같은 틱에 오면
   * 「늦게 온 응답이 새 화면을 덮어쓴다」를 재현할 방법이 없다.
   */
  hold?: Record<string, (release: () => void) => void>;
  /** 요청한 URL이 순서대로 쌓인다. 캐시가 도는지 세는 데 쓴다 */
  requested?: string[];
}

function run(
  doc: ReturnType<typeof makeDocument>,
  opts: RunOptions = {},
): { location: { search: string; href: string; hash?: string } } {
  const win: Record<string, unknown> = {};
  const loc = opts.location ?? { search: "", href: "" };
  // 서버가 심는 것과 **같은 함수**로 만든다 — 두 벌이 되면 어긋난다
  new Function("window", `${bootstrapFor("batter")}`)(win);
  const fetchImpl = (url: string): Promise<unknown> => {
    opts.requested?.push(String(url));
    for (const [fragment, body] of Object.entries(opts.routes ?? {})) {
      if (String(url).includes(fragment)) {
        const res = { ok: true, json: () => Promise.resolve(body) };
        const holder = Object.entries(opts.hold ?? {}).find(([f]) => String(url).includes(f))?.[1];
        if (holder === undefined) return Promise.resolve(res);
        return new Promise((resolve) => holder(() => resolve(res)));
      }
    }
    if (opts.index !== undefined && String(url).includes("players.json")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(opts.index) });
    }
    return Promise.reject(new Error("no network"));
  };
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
  const standard = BATTER_PRESETS.find((p) => p.id === "standard")!;
  assert.deepEqual(visible(doc), [...standard.blocks]);
});

test("프리셋을 바꾸면 그 프리셋의 블록만 그 순서로 보인다", () => {
  const doc = buildPage();
  run(doc);
  for (const preset of BATTER_PRESETS) {
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
  // ⚠타자 페이지의 조립 목록에는 **타자 블록만** 나온다. 투수 전용이 섞이면 고를 수 없는 줄이 생긴다
  assert.equal(rows.length, BATTER_BLOCKS.length);
  assert.ok(BATTER_BLOCKS.length < BLOCKS.length, "역할별 필터가 아무것도 걸러내지 않는다");
  const checked = rows.filter((r) => r.querySelector("input")!.checked).length;
  assert.equal(checked, BATTER_PRESETS.find((p) => p.id === "standard")!.blocks.length);
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
  const n = BATTER_PRESETS.find((p) => p.id === "standard")!.blocks.length;
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
  assert.deepEqual(visible(second), [...BATTER_PRESETS.find((p) => p.id === "simple")!.blocks]);
});

test("저장이 막혀도 화면은 동작한다", () => {
  const doc = buildPage();
  assert.doesNotThrow(() => run(doc, { storage: makeStorage(true) }));
  assert.deepEqual(visible(doc), [...BATTER_PRESETS.find((p) => p.id === "standard")!.blocks]);
  assert.doesNotThrow(() => press(doc, "preset", "analysis"));
  assert.deepEqual(visible(doc), [...BATTER_PRESETS.find((p) => p.id === "analysis")!.blocks]);
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
  assert.deepEqual(visible(doc), [...BATTER_PRESETS.find((p) => p.id === "standard")!.blocks]);
});

/**
 * 순위표·일람의 화면 뼈대.
 *
 * ⚠**여기에는 조립 시스템이 없다** — `#blocksEnd`도, `window.__BLOCKS__`도 없다.
 * 그런데 `.block`은 있다. 선수 페이지용 숨김 규칙이 이 페이지까지 훑으면 **전부 사라진다.**
 * 2026-08-15에 실제로 그렇게 나갔다 — 순위 탭이 통째로 빈 화면이었다.
 */
function buildRankingPage(): ReturnType<typeof makeDocument> {
  const doc = makeDocument();
  const main = make("div", { class: "main" });
  doc.body.appendChild(main);

  // 레일 한 줄에 상위 갈래(チーム/個人)와 하위 리그 탭줄이 함께 놓인다.
  // 리그 탭줄은 **패널이 아니라 따라 움직이는 자리**에 들어간다(`follower`)
  const rail = make("div", { class: "rail" });
  rail.appendChild(tabs("ranktype", ["team", "personal"]).list);
  const sub = make("div", { "data-panelgroup": "ranktype", "data-panelkey": "personal" });
  sub.hidden = true;
  sub.appendChild(tabs("rankleague", ["central", "pacific"]).list);
  rail.appendChild(sub);
  main.appendChild(rail);

  const teamPanel = make("div", {
    "data-panelgroup": "ranktype",
    "data-panelkey": "team",
    role: "tabpanel",
  });
  teamPanel.appendChild(make("section", { class: "block", id: "b-standings" }));
  main.appendChild(teamPanel);

  const personalPanel = make("div", {
    "data-panelgroup": "ranktype",
    "data-panelkey": "personal",
    role: "tabpanel",
  });
  personalPanel.hidden = true;
  main.appendChild(personalPanel);

  for (const [i, lg] of ["central", "pacific"].entries()) {
    const leaguePanel = make("div", {
      "data-panelgroup": "rankleague",
      "data-panelkey": lg,
      role: "tabpanel",
    });
    // ⚠순위표의 블록 id는 **조립 목록에 없는 id**다 — 조립 규칙이 훑으면 전부 사라진다
    const section = make("section", { class: "block", id: `lg-${lg}` });
    const cat = tabs("rankcat", ["batter", "starter", "reliever"]);
    const h = make("h4");
    h.appendChild(cat.list);
    section.appendChild(h);
    for (const c of cat.panels) section.appendChild(c);
    leaguePanel.appendChild(section);
    if (i > 0) leaguePanel.hidden = true;
    personalPanel.appendChild(leaguePanel);
  }

  // 일람의 하이라이트 블록 — id는 있지만 **조립 목록에 없는 id**다
  main.appendChild(make("section", { class: "block", id: "b-hi-central" }));
  return doc;
}

test("⚠순위표의 블록을 숨기지 않는다 — 선수 페이지의 조립 규칙을 다른 화면에 적용하지 마라", () => {
  const doc = buildRankingPage();
  run(doc);
  const blocks = doc.querySelectorAll(".block");
  assert.equal(blocks.length, 4, "픽스처가 블록을 못 만들었다");
  const hiddenOnes = blocks.filter((b) => b.hidden).map((b) => b.id || "(id 없음)");
  assert.deepEqual(hiddenOnes, [], `순위표의 블록이 숨겨졌다: ${hiddenOnes.join(", ")}`);
});

test("조립 시스템이 없는 화면에서도 탭은 동작한다 — 부문 패널이 열려 있다", () => {
  const doc = buildRankingPage();
  run(doc);
  const open = doc
    .querySelectorAll('[data-panelgroup="rankcat"]')
    .filter((p) => !p.hidden)
    .map((p) => p.dataset["panelkey"]);
  // 리그 패널이 둘이라 부문 패널도 리그마다 하나씩 열린다
  assert.deepEqual(open, ["batter", "batter"], "부문 패널이 하나도 안 열렸다");
});

/**
 * 지금 열려 있는 **패널**의 키.
 * ⚠`role="tabpanel"`로 거른다 — 같은 그룹에는 레일 안의 하위 탭줄(`follower`)도 붙어 있어서
 * 거르지 않으면 한 갈래가 두 번 세어진다.
 */
function openKeys(doc: ReturnType<typeof makeDocument>, group: string): string[] {
  return doc
    .querySelectorAll(`[data-panelgroup="${group}"]`)
    .filter((p) => !p.hidden && p.getAttribute("role") === "tabpanel")
    .map((p) => p.dataset["panelkey"]!);
}

test("갈래를 안 고르면 팀 순위가 열린다 — 「順位」를 누른 사람이 먼저 찾는 것이다", () => {
  const doc = buildRankingPage();
  run(doc);
  assert.deepEqual(openKeys(doc, "ranktype"), ["team"]);
});

/**
 * ⚠**깊은 링크가 닫힌 탭 안을 가리키면 브라우저는 아무 일도 하지 않는다.**
 * 탭 선택은 localStorage에 남으므로, 「セの順位表をすべて見る」를 눌러도
 * 지난번에 팀 순위를 보고 있었다면 개인 순위는 hidden 인 채다 — **눌러도 아무 반응이 없다.**
 */
test("#lg-central 로 오면 그 자리를 감싼 탭을 전부 연다 — 상위 갈래까지 거슬러 올라간다", () => {
  const doc = buildRankingPage();
  // 저장된 선택은 「팀 순위 · パ리그」 — 링크가 가리키는 곳과 **둘 다** 어긋나 있다
  const storage = makeStorage();
  storage.setItem(
    "npb-meikan-layout",
    JSON.stringify({ tabs: { ranktype: "team", rankleague: "pacific" } }),
  );
  run(doc, { storage, location: { search: "", href: "", hash: "#lg-central" } });

  assert.deepEqual(openKeys(doc, "ranktype"), ["personal"], "상위 갈래가 안 열렸다");
  assert.deepEqual(openKeys(doc, "rankleague"), ["central"], "리그 탭이 안 따라왔다");
  // 레일의 하위 탭줄도 함께 나와야 한다 — 열린 화면에 조작이 없으면 되돌아갈 수 없다
  const sub = doc
    .querySelectorAll('[data-panelgroup="ranktype"]')
    .filter((p) => p.dataset["panelkey"] === "personal" && p.getAttribute("role") === null);
  assert.equal(sub.length, 1, "레일 안의 리그 탭줄 자리가 없다");
  assert.equal(sub[0]!.hidden, false, "리그 탭줄이 숨겨진 채다");
});

/**
 * ⚠**깊은 링크가 사용자의 기본값을 바꾸면 안 된다.**
 * 「セの順位表をすべて見る」를 한 번 누른 뒤로 상단 내비의 「順位」가 영원히 개인 순위부터
 * 열리면, 링크 한 번이 사용자의 설정을 뒤집은 것이다(2026-08-16 이중 검토 P2).
 * 이번 방문에만 열고 **저장하지 않는다.**
 */
test("⚠깊은 링크로 연 탭은 저장되지 않는다 — 다음 방문의 기본값을 바꾸지 않는다", () => {
  const doc = buildRankingPage();
  const storage = makeStorage();
  storage.setItem("npb-meikan-layout", JSON.stringify({ tabs: { ranktype: "team", rankleague: "pacific" } }));
  run(doc, { storage, location: { search: "", href: "", hash: "#lg-central" } });

  // 이 방문에서는 열린다
  assert.deepEqual(openKeys(doc, "ranktype"), ["personal"]);
  // 그러나 저장된 것은 그대로여야 한다
  const saved = JSON.parse(storage.getItem("npb-meikan-layout")!);
  assert.equal(saved.tabs.ranktype, "team", "링크 한 번이 저장된 기본값을 바꿨다");
  assert.equal(saved.tabs.rankleague, "pacific");
});

test("직접 누른 탭은 임시 선택을 이기고, 그때는 저장된다", () => {
  const doc = buildRankingPage();
  const storage = makeStorage();
  storage.setItem("npb-meikan-layout", JSON.stringify({ tabs: { ranktype: "team" } }));
  run(doc, { storage, location: { search: "", href: "", hash: "#lg-central" } });
  assert.deepEqual(openKeys(doc, "ranktype"), ["personal"]);

  const teamTab = doc
    .querySelectorAll('[data-tabgroup="ranktype"] [data-tab]')
    .find((b) => b.dataset["tab"] === "team")!;
  teamTab.fire("click");
  assert.deepEqual(openKeys(doc, "ranktype"), ["team"], "직접 누른 것이 임시 선택에 졌다");
  assert.equal(JSON.parse(storage.getItem("npb-meikan-layout")!).tabs.ranktype, "team");
});

/**
 * ⚠**저장은 다른 조작에 딸려서 일어난다.** 깊은 링크가 `state`를 더럽혀 두면,
 * 사용자가 **전혀 다른 탭**을 누른 순간 그 값까지 함께 저장된다 — 한 박자 늦게 새어 나간다.
 */
test("⚠다른 탭을 눌러 저장이 일어나도 깊은 링크의 선택은 새어 나가지 않는다", () => {
  const doc = buildRankingPage();
  const storage = makeStorage();
  storage.setItem("npb-meikan-layout", JSON.stringify({ tabs: { ranktype: "team", rankcat: "batter" } }));
  run(doc, { storage, location: { search: "", href: "", hash: "#lg-central" } });

  // 관계없는 그룹(부문 탭)을 누른다 → 여기서 save 가 일어난다
  const other = doc
    .querySelectorAll('[data-tabgroup="rankcat"] [data-tab]')
    .find((b) => b.dataset["tab"] === "starter")!;
  other.fire("click");

  const saved = JSON.parse(storage.getItem("npb-meikan-layout")!);
  assert.equal(saved.tabs.rankcat, "starter", "누른 탭이 저장되지 않았다");
  assert.equal(saved.tabs.ranktype, "team", "깊은 링크가 연 탭이 다른 조작에 딸려 저장됐다");
});

test("가리키는 자리가 이미 열려 있으면 선택을 건드리지 않는다", () => {
  const doc = buildRankingPage();
  const storage = makeStorage();
  storage.setItem("npb-meikan-layout", JSON.stringify({ tabs: { ranktype: "team" } }));
  run(doc, { storage, location: { search: "", href: "", hash: "#b-standings" } });
  assert.deepEqual(openKeys(doc, "ranktype"), ["team"]);
});

test("없는 앵커가 와도 조용히 넘어간다 — 화면이 멈추면 안 된다", () => {
  const doc = buildRankingPage();
  run(doc, { location: { search: "", href: "", hash: "#nowhere" } });
  assert.deepEqual(openKeys(doc, "ranktype"), ["team"]);
});

/** 확대한 紋의 뼈대 — 꼭짓점 5개, 항목 버튼 5개, 판독부 5벌 */
function buildMarkPanel(): ReturnType<typeof makeDocument> {
  const doc = makeDocument();
  const main = make("div", { class: "main" });
  doc.body.appendChild(main);

  const btn = make("button", { class: "mark markbtn", id: "markBtn", "aria-expanded": "false" });
  main.appendChild(btn);

  const panel = make("section", { class: "markpanel", id: "markPanel" });
  panel.hidden = true;
  const svg = make("svg", { class: "mkfig" });
  const pick = make("div", { class: "tabs", "data-markpick": "" });
  const labels = ["打率", "出塁", "長打", "選球", "接触"];
  labels.forEach((_, i) => {
    const g = make("g", {
      class: "mf-ax",
      role: "button",
      tabindex: "0",
      "data-axis": String(i),
      "aria-pressed": i === 0 ? "true" : "false",
    });
    svg.appendChild(g);
    pick.appendChild(
      make("button", { class: "tab", "data-axis": String(i), "aria-pressed": i === 0 ? "true" : "false" }),
    );
    const read = make("div", { class: "mkread", "data-axisread": String(i) });
    read.hidden = i !== 0;
    panel.appendChild(read);
  });
  panel.appendChild(svg);
  panel.appendChild(pick);
  main.appendChild(panel);
  main.appendChild(make("div", { id: "blocksEnd" }));
  return doc;
}

function openMark(doc: ReturnType<typeof makeDocument>): void {
  doc.getElementById("markBtn")!.fire("click");
}

function shownAxis(doc: ReturnType<typeof makeDocument>): string[] {
  return doc
    .querySelectorAll("[data-axisread]")
    .filter((el) => !el.hidden)
    .map((el) => el.dataset["axisread"] ?? "");
}

test("紋은 닫혀서 시작하고 눌러서 연다 — 열린 채로 시작하면 성적이 화면 밖으로 밀린다", () => {
  const doc = buildMarkPanel();
  run(doc);
  assert.equal(doc.getElementById("markPanel")!.hidden, true);
  assert.equal(doc.getElementById("markBtn")!.getAttribute("aria-expanded"), "false");
  openMark(doc);
  assert.equal(doc.getElementById("markPanel")!.hidden, false);
  assert.equal(doc.getElementById("markBtn")!.getAttribute("aria-expanded"), "true");
});

test("꼭짓점을 누르면 그 항목만 보이고 그 꼭짓점이 커진다", () => {
  const doc = buildMarkPanel();
  run(doc);
  openMark(doc);
  assert.deepEqual(shownAxis(doc), ["0"]);

  doc.querySelectorAll(".mf-ax").filter((g) => g.dataset["axis"] === "3")[0]!.fire("click");
  assert.deepEqual(shownAxis(doc), ["3"], "판독부가 하나만 보여야 한다");
  const on = doc.querySelectorAll(".mf-ax").filter((g) => g.getAttribute("class") === "mf-ax on");
  assert.equal(on.length, 1, "강조된 꼭짓점이 하나여야 한다");
  assert.equal(on[0]!.dataset["axis"], "3");
  assert.equal(on[0]!.getAttribute("aria-pressed"), "true");
});

test("항목 버튼도 같은 일을 한다 — 손가락에는 이쪽이 확실하다", () => {
  const doc = buildMarkPanel();
  run(doc);
  openMark(doc);
  doc.querySelectorAll("[data-markpick] [data-axis]")[2]!.fire("click");
  assert.deepEqual(shownAxis(doc), ["2"]);
  const pressed = doc
    .querySelectorAll("[data-markpick] [data-axis]")
    .filter((b) => b.getAttribute("aria-pressed") === "true")
    .map((b) => b.dataset["axis"]);
  assert.deepEqual(pressed, ["2"], "눌린 버튼이 하나여야 한다");
});

test("⚠키보드로도 고를 수 있다 — SVG에 클릭만 붙이면 키보드 사용자는 못 연다", () => {
  const doc = buildMarkPanel();
  run(doc);
  openMark(doc);
  // 실제 브라우저에서는 초점이 옮겨간 꼭짓점에서 다음 키가 눌린다. 그대로 흉내 낸다
  const arrow = (key: string): void => {
    const at = shownAxis(doc)[0]!;
    doc.querySelectorAll(".mf-ax").filter((g) => g.dataset["axis"] === at)[0]!.fire("keydown", { key });
  };
  arrow("ArrowRight");
  assert.deepEqual(shownAxis(doc), ["1"]);
  arrow("ArrowRight");
  assert.deepEqual(shownAxis(doc), ["2"]);
  arrow("ArrowLeft");
  assert.deepEqual(shownAxis(doc), ["1"], "왼쪽으로도 움직여야 한다");
  // 끝에서 반대편으로 넘어간다 — 다섯 개를 한 방향으로만 돌게 하지 않는다
  arrow("ArrowLeft");
  arrow("ArrowLeft");
  assert.deepEqual(shownAxis(doc), ["4"], "0에서 왼쪽이면 마지막으로 돌아야 한다");
});

test("Enter로도 고를 수 있다", () => {
  const doc = buildMarkPanel();
  run(doc);
  openMark(doc);
  doc.querySelectorAll(".mf-ax")[2]!.fire("keydown", { key: "Enter" });
  assert.deepEqual(shownAxis(doc), ["2"]);
});

test("연 상태가 저장된다 — 선수를 넘겨 볼 때마다 다시 여는 것은 성가시다", () => {
  const storage = makeStorage();
  const first = buildMarkPanel();
  run(first, { storage });
  openMark(first);

  const second = buildMarkPanel();
  run(second, { storage });
  assert.equal(second.getElementById("markPanel")!.hidden, false, "다음 방문에 닫혀 있다");
});

test("紋이 없는 화면에서도 스크립트가 죽지 않는다 — 성적 없는 선수는 판이 없다", () => {
  const doc = makeDocument();
  doc.body.appendChild(make("div", { class: "main" }));
  assert.doesNotThrow(() => run(doc));
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

  // 오늘 대전 두 팀의 빠른 선택 버튼. 서버가 내는 구조와 같은 모양이어야 한다
  // (`.picklist` 상자가 있어야 화살표 이동이 어디까지인지 정해진다)
  const today = make("div", { id: "pickToday" });
  for (const [role, people] of [
    ["pitcher", [["p1", "山本", "オリックス・バファローズ"], ["p2", "宮城", "オリックス・バファローズ"]]],
    ["batter", [["b1", "佐藤", "阪神タイガース"]]],
  ] as [string, string[][]][]) {
    const list = make("div", { class: "picklist", role: "toolbar", "aria-orientation": "horizontal" });
    for (const [i, n, t] of people) {
      list.appendChild(
        make("button", { class: "pk", type: "button", "aria-pressed": "false", "data-pick": role, "data-i": i!, "data-n": n!, "data-t": t! }),
      );
    }
    today.appendChild(list);
  }
  form.appendChild(today);
  doc.body.appendChild(form);
  return doc;
}

/** 빠른 선택 버튼 하나 */
function pk(doc: ReturnType<typeof makeDocument>, id: string): El {
  const b = doc.querySelectorAll("#pickToday [data-pick]").find((x) => x.dataset["i"] === id);
  assert.notEqual(b, undefined, `${id} 버튼이 없다`);
  return b!;
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

/**
 * ⚠**이 경로는 색인 fetch를 타지 않는다.** 오늘 대전하는 두 팀은 서버가 이미 알고 있어서
 * 버튼으로 나와 있다 — 검색이 실패해도 고를 수 있어야 한다는 뜻이기도 하다.
 */
test("오늘 대전 팀의 버튼만으로 고르기가 끝난다 — 이름을 칠 필요도, 색인을 받을 필요도 없다", () => {
  const doc = buildPicker();
  const { location } = run(doc); // 색인 없음 = 취득 실패
  const go = doc.getElementById("pickGo")!;

  pk(doc, "p1").fire("click");
  assert.equal(doc.getElementById("pick-pitcher-chosen")!.textContent, "山本（オリックス・バファローズ）");
  assert.equal(doc.getElementById("pickPitcher")!.value, "山本", "검색창에도 반영되지 않았다");
  assert.equal(pk(doc, "p1").getAttribute("aria-pressed"), "true", "누른 버튼이 그렇다고 말하지 않는다");
  assert.equal(go.disabled, true, "한쪽만 골랐는데 버튼이 열렸다");

  pk(doc, "b1").fire("click");
  assert.equal(go.disabled, false);
  go.fire("click");
  assert.equal(location.href, `players/b1.html?vs=${encodeURIComponent("山本")}#b-matchup`);
});

test("같은 갈래에서 다른 사람을 누르면 앞의 것이 풀린다 — 둘 다 눌린 것처럼 보이면 안 된다", () => {
  const doc = buildPicker();
  run(doc);
  pk(doc, "p1").fire("click");
  pk(doc, "p2").fire("click");
  assert.equal(pk(doc, "p1").getAttribute("aria-pressed"), "false");
  assert.equal(pk(doc, "p2").getAttribute("aria-pressed"), "true");
  assert.equal(doc.getElementById("pick-pitcher-chosen")!.textContent, "宮城（オリックス・バファローズ）");
});

test("⚠같은 버튼을 다시 누르면 풀린다 — 잘못 눌렀을 때 되돌릴 길이 없으면 안 된다", () => {
  const doc = buildPicker();
  run(doc);
  pk(doc, "p1").fire("click");
  pk(doc, "b1").fire("click");
  assert.equal(doc.getElementById("pickGo")!.disabled, false);

  pk(doc, "p1").fire("click");
  assert.equal(pk(doc, "p1").getAttribute("aria-pressed"), "false");
  assert.equal(doc.getElementById("pick-pitcher-chosen")!.textContent, "未選択");
  assert.equal(doc.getElementById("pickPitcher")!.value, "", "검색창에 이름이 남았다");
  assert.equal(doc.getElementById("pickGo")!.disabled, true, "한쪽을 풀었는데 버튼이 열린 채다");
});

/**
 * ⚠**한 팀에 투수 30명·타자 40명이 실제로 나온다.** 전부 탭 정지로 두면 이 화면을
 * 키보드로 지나가는 데만 탭을 100번 넘게 눌러야 한다. 목록 하나가 탭 정지 하나다.
 */
test("긴 목록은 탭 정지 하나다 — 안에서는 화살표로 움직인다", () => {
  const doc = buildPicker();
  run(doc);
  const list = doc.querySelectorAll(".picklist")[0]!;
  const items = doc.querySelectorAll('.picklist [data-pick="pitcher"]');
  assert.deepEqual(
    items.map((b) => b.getAttribute("tabindex")),
    ["0", "-1"],
    "목록의 버튼이 전부 탭 정지다",
  );
  // ⚠**`group`이 아니라 `toolbar`다.** roving tabindex(화살표로 이동)를 규정하는 롤이 toolbar이고,
  // group 은 그걸 함의하지 않는다 — 「여기서 화살표를 쓰라」는 신호가 어디에도 없게 된다
  assert.equal(list.getAttribute("role"), "toolbar", "화살표로 움직이는 묶음이라고 말하지 않는다");
  assert.equal(list.getAttribute("aria-orientation"), "horizontal");

  items[0]!.fire("keydown", { key: "ArrowRight" });
  assert.deepEqual(items.map((b) => b.getAttribute("tabindex")), ["-1", "0"]);
  // 끝에서 한 번 더 — 처음으로 돌아온다
  items[1]!.fire("keydown", { key: "ArrowDown" });
  assert.deepEqual(items.map((b) => b.getAttribute("tabindex")), ["0", "-1"]);
  items[0]!.fire("keydown", { key: "End" });
  assert.deepEqual(items.map((b) => b.getAttribute("tabindex")), ["-1", "0"]);
});

test("화살표 이동은 그 목록 안에서 끝난다 — 투수를 넘어 타자로 새지 않는다", () => {
  const doc = buildPicker();
  run(doc);
  const batters = doc.querySelectorAll('.picklist [data-pick="batter"]');
  doc.querySelectorAll('.picklist [data-pick="pitcher"]')[1]!.fire("keydown", { key: "ArrowRight" });
  assert.deepEqual(batters.map((b) => b.getAttribute("tabindex")), ["0"], "타자 목록의 탭 정지가 움직였다");
});

test("검색으로 고르면 빠른 선택 버튼의 눌림 표시도 따라간다 — 두 경로가 어긋나면 안 된다", async () => {
  const doc = buildPicker();
  run(doc, { index: INDEX });
  (await search(doc, "pickPitcher", "山"))[0]!.querySelector("a")!.fire("click");
  assert.equal(pk(doc, "p1").getAttribute("aria-pressed"), "true", "검색으로 고른 것이 버튼에 안 비쳤다");
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

// ─── 즐겨찾기 ───────────────────────────────────────────────────────────

/**
 * ⚠**계정 없이 되는 것만 만든다**(§0-1). 서버는 즐겨찾기를 모르고, 표시는 이 브라우저에만 남는다.
 * ⚠**서버가 그린 목록의 순서를 바꾸지 않는다.** 순서를 바꾸면 「내 선수가 어디 갔지」가 되고,
 * 명감의 배열이 무너진다 — 표식과 좁히기만 얹는다.
 */
function buildRoster(): ReturnType<typeof makeDocument> {
  const doc = makeDocument();
  const main = make("div", { class: "main" });
  doc.body.appendChild(main);

  const find = make("section", { class: "find" });
  find.appendChild(make("input", { id: "rosterFilter", type: "search" }));
  const chips = make("div", { class: "chips" });
  for (const code of ["t", "g"]) {
    chips.appendChild(make("button", { class: "chip", "data-team": code, "aria-pressed": "false" }));
  }
  find.appendChild(chips);
  const fav = make("button", { class: "chip fav", id: "favOnly", "aria-pressed": "false" });
  fav.hidden = true;
  find.appendChild(fav);
  find.appendChild(make("s", { id: "favCount" }));
  find.appendChild(make("span", { id: "rosterCount" }));
  main.appendChild(find);

  for (const [code, ids] of [["t", ["p1", "p2"]], ["g", ["p3"]]] as [string, string[]][]) {
    const g = make("section", { class: "teamgroup" });
    const ul = make("ul", { class: "roster" });
    for (const id of ids) {
      ul.appendChild(make("li", { "data-team": code, "data-name": id, "data-id": id }));
    }
    g.appendChild(ul);
    main.appendChild(g);
  }
  return doc;
}

/** 선수 페이지의 즐겨찾기 버튼만 있는 최소 문서 */
function buildFavBtn(id = "p1"): ReturnType<typeof makeDocument> {
  const doc = makeDocument();
  const b = make("button", { class: "favbtn", id: "favBtn", "data-fav": id, "aria-pressed": "false" });
  b.hidden = true;
  doc.body.appendChild(b);
  return doc;
}

test("즐겨찾기는 이 브라우저에만 남는다 — 저장되고 다시 열어도 살아 있다", () => {
  const storage = makeStorage();
  const first = buildFavBtn();
  run(first, { storage });
  const btn = first.getElementById("favBtn")!;
  assert.equal(btn.hidden, false, "스크립트가 있는데 버튼이 숨겨진 채다");
  assert.equal(btn.getAttribute("aria-pressed"), "false");

  btn.fire("click");
  assert.equal(btn.getAttribute("aria-pressed"), "true");
  assert.match(btn.getAttribute("aria-label")!, /外す/, "누른 뒤에도 「넣는다」라고 말한다");

  // 다시 연다
  const second = buildFavBtn();
  run(second, { storage });
  assert.equal(second.getElementById("favBtn")!.getAttribute("aria-pressed"), "true");
});

test("⚠스크립트가 없으면 버튼을 띄우지 않는다 — 눌러도 아무 일이 없는 버튼을 두지 않는다", () => {
  const doc = buildFavBtn();
  // run 하지 않는다 = 스크립트가 없는 상태
  assert.equal(doc.getElementById("favBtn")!.hidden, true);
});

test("일람에서 즐겨찾기로 좁힌다 — 순서는 그대로 두고 표식만 얹는다", () => {
  const storage = makeStorage();
  storage.setItem("npb-meikan-layout", JSON.stringify({ favs: ["p2"] }));
  const doc = buildRoster();
  run(doc, { storage });

  const li = doc.querySelectorAll(".roster li[data-id]");
  assert.deepEqual(
    li.map((x) => x.getAttribute("data-favon")),
    ["false", "true", "false"],
    "표식이 즐겨찾기한 선수에만 붙지 않았다",
  );
  // 순서는 서버가 그린 그대로다
  assert.deepEqual(li.map((x) => x.dataset["id"]), ["p1", "p2", "p3"]);

  const only = doc.getElementById("favOnly")!;
  assert.equal(only.hidden, false, "즐겨찾기가 있는데 버튼이 숨겨져 있다");
  only.fire("click");
  assert.deepEqual(
    doc.querySelectorAll(".roster li[data-id]").filter((x) => !x.hidden).map((x) => x.dataset["id"]),
    ["p2"],
  );
  assert.equal(doc.getElementById("rosterCount")!.textContent, "1人");
});

test("⚠하나도 없으면 좁히기 버튼을 띄우지 않는다 — 눌러도 빈 화면이 되는 조작은 고장으로 읽힌다", () => {
  const doc = buildRoster();
  run(doc);
  assert.equal(doc.getElementById("favOnly")!.hidden, true);
});

test("즐겨찾기 좁히기는 이름·구단 좁히기와 함께 걸린다", () => {
  const storage = makeStorage();
  storage.setItem("npb-meikan-layout", JSON.stringify({ favs: ["p1", "p3"] }));
  const doc = buildRoster();
  run(doc, { storage });
  doc.getElementById("favOnly")!.fire("click");
  // 阪神(t)만 남기면 p1 하나다
  doc.querySelectorAll(".chip[data-team]").find((b) => b.dataset["team"] === "t")!.fire("click");
  assert.deepEqual(
    doc.querySelectorAll(".roster li[data-id]").filter((x) => !x.hidden).map((x) => x.dataset["id"]),
    ["p1"],
  );
});

// ─── 탭 전환의 방향 ─────────────────────────────────────────────────────

/**
 * ⚠**방향은 「어디서 어디로 갔는가」다.** 탭줄에 적힌 순서가 기준이고,
 * 앞으로 가면 next·뒤로 가면 prev다. 방향이 없으면 fade만 남아 이동이 순간이동이 된다.
 */
test("탭을 앞으로 넘기면 next, 뒤로 넘기면 prev 가 붙는다", () => {
  const doc = buildRankingPage();
  run(doc);
  const open = () =>
    doc
      .querySelectorAll('[data-panelgroup="rankcat"]')
      .filter((p) => !p.hidden)[0]!;
  const tab = (key: string) =>
    doc.querySelectorAll('[data-tabgroup="rankcat"] [data-tab]').find((b) => b.dataset["tab"] === key)!;

  tab("starter").fire("click");
  assert.equal(open().getAttribute("data-slide"), "next", "앞으로 갔는데 방향이 없다");
  tab("batter").fire("click");
  assert.equal(open().getAttribute("data-slide"), "prev", "뒤로 갔는데 방향이 앞이다");
});

test("첫 그리기에는 방향이 없다 — 어디서 왔는지가 없기 때문이다", () => {
  const doc = buildRankingPage();
  run(doc);
  const open = doc.querySelectorAll('[data-panelgroup="rankcat"]').filter((p) => !p.hidden)[0]!;
  assert.equal(open.getAttribute("data-slide"), null);
});

// ─── 검색 결과의 성적 ───────────────────────────────────────────────────

/**
 * ⚠**분모까지 나와야 뜻이 있다**(M2). 이 줄의 존재 이유가 「이 사람이 맞나」의 판단인데,
 * 10타석 .400과 400타석 .400을 구별하지 못하면 판단을 돕는 대신 오해를 만든다.
 */
test("검색 결과에 성적 한 줄이 분모와 함께 나온다", async () => {
  const doc = buildPicker();
  run(doc, {
    index: [
      { i: "p1", n: "山本", t: "オリックス・バファローズ", s: "防御率 1.82（193回）" },
      { i: "b1", n: "佐藤", t: "阪神タイガース" },
    ],
  });
  const hits = await search(doc, "pickPitcher", "山");
  const line = hits[0]!.querySelectorAll(".hs");
  assert.equal(line.length, 1, "성적 줄이 없다");
  assert.equal(line[0]!.textContent, "防御率 1.82（193回）");
  assert.match(line[0]!.textContent, /（[0-9.]+回）/, "분모가 없다");
});

test("성적이 없는 선수에게는 빈 줄을 만들지 않는다 — 빈 줄은 「0」처럼 읽힌다(M11)", async () => {
  const doc = buildPicker();
  run(doc, { index: [{ i: "b1", n: "佐藤", t: "阪神タイガース" }] });
  const hits = await search(doc, "pickBatter", "佐");
  assert.equal(hits[0]!.querySelectorAll(".hs").length, 0);
});

// ─── 비교 화면의 빠른 선택 ──────────────────────────────────────────────

/**
 * ⚠**이 화면에는 한동안 실행되는 시험이 0건이었다**(2026-08-16 이중 검토).
 * 그 사이에 두 결함이 지나갔다 — 로빙 tabindex 미적용(탭 정지 129개인데 화살표가 안 먹었다)과
 * **화면과 동작이 반대로 읽히는 표시 미갱신**.
 */
function buildCompare(): ReturnType<typeof makeDocument> {
  const doc = makeDocument();
  const form = make("section", { class: "block", id: "cmpForm" });
  for (const [id, key] of [["A", "a"], ["B", "b"]] as [string, string][]) {
    form.appendChild(make("input", { id: `cmp${id}`, type: "search", "aria-expanded": "false" }));
    form.appendChild(make("ul", { id: `cmp${id}Hits`, role: "listbox" }));
    form.appendChild(make("b", { id: `cmp-${key}-chosen` }));
  }
  const go = make("button", { id: "cmpGo", type: "button" });
  go.disabled = true;
  form.appendChild(go);
  const swap = make("button", { id: "cmpSwap", type: "button" });
  swap.disabled = true;
  form.appendChild(swap);

  const today = make("div", { id: "cmpToday" });
  const list = make("div", { class: "picklist", role: "toolbar", "aria-orientation": "horizontal" });
  for (const [i, n] of [["p1", "山本"], ["p2", "宮城"], ["b1", "佐藤"]] as [string, string][]) {
    list.appendChild(
      make("button", {
        class: "pk", type: "button", "aria-pressed": "false",
        "data-pick": i === "b1" ? "batter" : "pitcher", "data-i": i, "data-n": n, "data-t": "チーム",
      }),
    );
  }
  today.appendChild(list);
  form.appendChild(today);
  doc.body.appendChild(form);
  form.appendChild(make("div", { id: "cmpOut" }));
  return doc;
}

const cpk = (doc: ReturnType<typeof makeDocument>, id: string): El =>
  doc.querySelectorAll("#cmpToday [data-pick]").find((b) => b.dataset["i"] === id)!;

test("누른 순서대로 A → B에 들어가고, 버튼이 어느 자리인지 말한다", () => {
  const doc = buildCompare();
  run(doc);
  cpk(doc, "p1").fire("click");
  assert.equal(doc.getElementById("cmp-a-chosen")!.textContent, "山本（チーム）");
  assert.equal(cpk(doc, "p1").getAttribute("data-slot"), "A", "어느 자리인지 말하지 않는다");
  assert.equal(doc.getElementById("cmpGo")!.disabled, true, "한쪽만 골랐는데 열렸다");

  cpk(doc, "b1").fire("click");
  assert.equal(cpk(doc, "b1").getAttribute("data-slot"), "B");
  assert.equal(doc.getElementById("cmpGo")!.disabled, false);
});

test("같은 버튼을 다시 누르면 그 자리가 비워진다 — 되돌릴 길이 없으면 안 된다", () => {
  const doc = buildCompare();
  run(doc);
  cpk(doc, "p1").fire("click");
  cpk(doc, "p1").fire("click");
  assert.equal(doc.getElementById("cmp-a-chosen")!.textContent, "未選択");
  assert.equal(cpk(doc, "p1").getAttribute("data-slot"), null);
  assert.equal(cpk(doc, "p1").getAttribute("aria-pressed"), "false");
});

/**
 * ⚠**화면이 「안 눌림」인데 누르면 해제되는 상태를 만들지 않는다.**
 * 선택이 바뀌는 곳은 셋(직접 고르기·入れかえ·공유 링크 복원)인데 다시 그리는 곳이 하나뿐이면
 * 나머지 둘에서 **버튼이 실제 상태와 반대로 읽힌다.**
 */
test("入れかえ 하면 버튼의 A·B 표시도 따라 바뀐다", () => {
  const doc = buildCompare();
  run(doc);
  cpk(doc, "p1").fire("click");
  cpk(doc, "b1").fire("click");
  assert.deepEqual(
    [cpk(doc, "p1").getAttribute("data-slot"), cpk(doc, "b1").getAttribute("data-slot")],
    ["A", "B"],
  );

  doc.getElementById("cmpSwap")!.fire("click");
  assert.deepEqual(
    [cpk(doc, "p1").getAttribute("data-slot"), cpk(doc, "b1").getAttribute("data-slot")],
    ["B", "A"],
    "자리를 바꿨는데 버튼은 옛 자리를 말한다",
  );
});

test("공유 링크로 들어와도 버튼이 눌린 것으로 보인다 — 안 그러면 누르는 순간 해제된다", async () => {
  const doc = buildCompare();
  run(doc, {
    index: [
      { i: "p1", n: "山本", t: "チーム" },
      { i: "b1", n: "佐藤", t: "チーム" },
    ],
    location: { search: "?a=p1&b=b1", href: "" },
  });
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(
    [cpk(doc, "p1").getAttribute("data-slot"), cpk(doc, "b1").getAttribute("data-slot")],
    ["A", "B"],
    "공유 링크로 복원했는데 버튼이 안 눌린 것으로 보인다",
  );
});

/**
 * ⚠**부품을 공유하면 그 부품을 살리는 처리도 공유해야 한다.**
 * aria-label 이 「左右キーで移動」라고 말하는데 화살표가 안 먹으면 라벨이 거짓말이 된다.
 */
test("비교 화면의 긴 목록도 탭 정지 하나다 — 대전 화면과 같은 약속을 지킨다", () => {
  const doc = buildCompare();
  run(doc);
  const items = doc.querySelectorAll("#cmpToday [data-pick]");
  assert.deepEqual(
    items.map((b) => b.getAttribute("tabindex")),
    ["0", "-1", "-1"],
    "비교 화면의 목록이 전부 탭 정지다",
  );
  items[0]!.fire("keydown", { key: "ArrowRight" });
  assert.deepEqual(items.map((b) => b.getAttribute("tabindex")), ["-1", "0", "-1"]);
});

/**
 * ⚠**「읽는 중」과 「없음」은 다르다**(M12의 4상태).
 * 실패와 0건에는 문구가 있는데 로딩만 없어서, 인덱스가 오는 동안 목록이 숨겨진 채 남았다 —
 * 느린 회선에서는 「검색이 고장났다」로 읽힌다. M12가 4상태를 요구하는 이유가 정확히 이것인데
 * 이 화면만 3상태였다.
 */
test("⚠검색에 「읽는 중」 상태가 있다 — 「아직 안 침」과 구별된다", () => {
  const draw = /const draw=\(items,failed\)=>\{([\s\S]*?)\n  \};/.exec(CLIENT_JS);
  assert.notEqual(draw, null, "그리기 함수를 못 찾았다 — 이 시험이 공회전한다");
  const body = draw![1] ?? "";
  assert.match(body, /読み込み中/, "로딩 문구가 없다");
  assert.match(body, /items===null/, "로딩을 0건과 구별하지 않는다");

  // 그리고 실제로 그 상태로 그린다 — 문구만 있고 부르는 곳이 없으면 죽은 코드다
  const run = /const run=\(\)=>\{([\s\S]*?)\n  \};/.exec(CLIENT_JS);
  assert.notEqual(run, null, "검색 실행부를 못 찾았다");
  assert.match(run![1] ?? "", /draw\(null,false\)/, "인덱스를 기다리는 동안 아무것도 안 그린다");
});

/**
 * ⚠**늦게 온 응답이 새 입력을 덮어쓰지 않는다.**
 * 인덱스를 기다리는 사이에 글자를 더 치면, 먼저 걸어 둔 콜백이 나중에 돌아와
 * **옛 검색어의 결과**를 그린다. 로딩 상태를 넣으면서 대기 경로가 늘었으므로 함께 막는다.
 */
test("늦게 온 결과가 새 검색어를 덮지 않는다", () => {
  const run = /const run=\(\)=>\{([\s\S]*?)\n  \};/.exec(CLIENT_JS);
  assert.match(run![1] ?? "", /input\.value\.trim\(\)!==term/, "옛 검색어의 결과를 그대로 그린다");
});

/**
 * 읽는 법·등번호 검색.
 *
 * ⚠**접기는 클라이언트 한 벌뿐이다**(M1) — 색인은 읽는 법 원문을 싣고, 질의어와 색인을
 * 같은 함수로 접는다. 그래서 여기서 실행해 확인하는 것이 그 규칙의 유일한 검증이다.
 *
 * 실측 근거: 읽는 법이 있는 858명 중 **121명이 외국인 선수**라 값이 카타카나 + 라틴이다
 * (`ルーク・ボイト (LUKE VOIT)`). 접지 않으면 그 121명은 히라가나 입력으로 영영 안 나온다.
 */
const KANA_INDEX = [
  { i: "p1", n: "山本", t: "オリックス・バファローズ", k: "やまもと・よしのぶ", u: "18" },
  { i: "b1", n: "佐藤", t: "阪神タイガース", k: "さとう・てるあき", u: "8" },
  { i: "f1", n: "ボイト", t: "阪神タイガース", k: "ルーク・ボイト (LUKE VOIT)", u: "44" },
  // ⚠은퇴·이적으로 **등번호가 없는 선수**. 화면 색인 기준 2025년 721명 중 76명이 이것이다
  { i: "r1", n: "松山", t: "広島東洋カープ", k: "まつやま・りゅうへい" },
];

/**
 * ⚠**개수로 판정하지 않는다.** 결과 0건일 때도 목록에는 「該当なし」 항목이 **하나** 그려지므로
 * `length === 1` 은 「1건 찾음」과 「0건」을 구별하지 못한다. 실제로 이 함정에 한 번 빠졌고,
 * 뮤테이션 검사가 그것을 잡았다 — 이름 텍스트로 판정한다.
 */
function names(hits: El[]): string[] {
  return hits.map((h) => h.querySelector(".hn")?.textContent ?? "").filter((x) => x !== "");
}

test("읽는 법으로 찾는다 — 한자를 모르면 지금은 찾을 방법이 없다", async () => {
  const doc = buildPicker();
  run(doc, { index: KANA_INDEX });
  assert.deepEqual(names(await search(doc, "pickPitcher", "やまもと")), ["山本"],
    "히라가나 읽는 법으로 못 찾았다");
});

test("⚠외국인 선수를 히라가나 입력으로도 찾는다 — 카타카나를 접지 않으면 121명이 사라진다", async () => {
  const doc = buildPicker();
  run(doc, { index: KANA_INDEX });
  // IME 로 「ぼいと」까지 친 상태. 색인 값은 「ボイト」다
  assert.deepEqual(names(await search(doc, "pickPitcher", "ぼいと")), ["ボイト"],
    "히라가나 입력으로 카타카나 표기를 못 찾았다");
  // 라틴 표기는 색인이 대문자다 — 소문자로 쳐도 나와야 한다
  assert.deepEqual(names(await search(doc, "pickPitcher", "voit")), ["ボイト"],
    "소문자 라틴 입력으로 대문자 표기를 못 찾았다");

  /**
   * ⚠**질의어도 같은 함수로 접어야 한다.** 색인만 접으면 이 두 줄이 실패한다 —
   * 색인의 「ボイト」는 「ぼいと」로 접혀 있는데 질의어가 「ボイト」 그대로면 안 맞는다.
   * 접기가 한 벌인 이유가 이것이고, 여기가 그 규칙의 유일한 검증이다.
   */
  // ⚠**표시명이 「山本」이라 이름으로는 절대 안 걸리는 질의어를 쓴다** — 카타카나로 친
  // 「ヤマモト」는 색인의 히라가나 「やまもと」와 **양쪽을 접어야만** 맞는다
  assert.deepEqual(names(await search(doc, "pickPitcher", "ヤマモト")), ["山本"],
    "질의어를 접지 않아 카타카나 입력이 안 맞았다");
  assert.deepEqual(names(await search(doc, "pickPitcher", "VOIT")), ["ボイト"],
    "질의어를 접지 않아 대문자 입력이 안 맞았다");
});

test("⚠등번호는 완전일치다 — 부분일치면 「1」이 100번대까지 끌고 온다", async () => {
  const doc = buildPicker();
  run(doc, { index: KANA_INDEX });
  assert.deepEqual(names(await search(doc, "pickPitcher", "8")), ["佐藤"],
    "8번만 나와야 하는데 18번·44번까지 나왔다");
  assert.deepEqual(names(await search(doc, "pickPitcher", "18")), ["山本"]);
});

test("⚠등번호가 없는 선수에게 자리를 만들지 않는다 — 「―」로 채우면 198줄이 같은 기호가 된다", async () => {
  const doc = buildPicker();
  run(doc, { index: KANA_INDEX });
  const hits = await search(doc, "pickPitcher", "まつやま");
  assert.deepEqual(names(hits), ["松山"]);
  assert.ok(!hits[0]!.querySelector(".hu"), "등번호가 없는데 자리가 생겼다");
  const has = await search(doc, "pickPitcher", "やまもと");
  assert.equal(has[0]!.querySelector(".hu")!.textContent, "18", "등번호가 안 나온다");
});

/**
 * 첫 화면(選手一覧)의 「名前でしぼる」.
 *
 * ⚠**헤더 검색과 같은 것을 찾아야 한다.** 예전에는 이 목록이 `data-name` 부분일치만 봐서
 * 「やまもと」나 「18」을 치면 **첫 화면에서만 0건**이 됐다 —
 * 「등번호로 찾을 수 있다」가 화면에 따라 참·거짓이 갈렸다.
 * 접기 함수가 한 벌인 것과 **검색의 뜻이 한 벌인 것은 다르다**.
 */
function buildKanaRoster(): ReturnType<typeof makeDocument> {
  const doc = makeDocument("");
  const find = make("section", { class: "find" });
  find.appendChild(make("input", { id: "rosterFilter", type: "search" }));
  find.appendChild(make("p", { class: "count" }));
  const count = make("span", { id: "rosterCount" });
  find.appendChild(count);
  doc.body.appendChild(find);

  const group = make("section", { class: "teamgroup" });
  const ul = make("ul", { class: "roster" });
  for (const p of [
    { id: "p1", name: "山本", kana: "やまもと・よしのぶ", uniform: "18" },
    { id: "p2", name: "佐藤", kana: "さとう・てるあき", uniform: "8" },
    { id: "p3", name: "ボイト", kana: "ルーク・ボイト (LUKE VOIT)", uniform: "44" },
  ]) {
    const li = make("li", {
      "data-team": "t", "data-name": p.name, "data-id": p.id,
      "data-kana": p.kana, "data-uniform": p.uniform,
    });
    ul.appendChild(li);
  }
  group.appendChild(ul);
  doc.body.appendChild(group);
  return doc;
}

/** 좁히기 후 보이는 선수 이름 */
function rosterNames(doc: ReturnType<typeof makeDocument>): string[] {
  return doc.querySelectorAll(".teamgroup li").filter((li) => !li.hidden)
    .map((li) => li.dataset["name"] ?? "");
}

test("⚠첫 화면의 좁히기도 읽는 법·등번호로 찾는다 — 검색창마다 다르게 동작하면 안 된다", async () => {
  const doc = buildKanaRoster();
  run(doc);
  const filter = doc.getElementById("rosterFilter")!;

  filter.value = "やまもと";
  filter.fire("input");
  assert.deepEqual(rosterNames(doc), ["山本"], "첫 화면에서 읽는 법으로 못 찾았다");

  // 카타카나 입력 → 히라가나 색인. **양쪽을 접어야만** 맞는다
  filter.value = "ヤマモト";
  filter.fire("input");
  assert.deepEqual(rosterNames(doc), ["山本"], "질의어를 접지 않았다");

  // 외국인 선수의 라틴 표기. 색인은 대문자다
  filter.value = "voit";
  filter.fire("input");
  assert.deepEqual(rosterNames(doc), ["ボイト"], "소문자 라틴 입력이 안 맞았다");

  // ⚠등번호는 완전일치 — 「8」이 18·44를 끌고 오면 안 된다
  filter.value = "8";
  filter.fire("input");
  assert.deepEqual(rosterNames(doc), ["佐藤"], "등번호가 부분일치로 걸렸다");

  // 이름 부분일치는 그대로 남는다
  filter.value = "佐";
  filter.fire("input");
  assert.deepEqual(rosterNames(doc), ["佐藤"]);
});

/**
 * 比較 데이터의 샤딩.
 *
 * ⚠**예전에는 선수마다 파일 하나였다**(시즌당 ~700개). 그 2.5KB짜리들이 4시즌 산출물의
 * **29%(2,797개)**를 차지해 Cloudflare Pages의 배포당 파일 상한(20,000)을 먹고 있었다.
 * 이제 **선수 ID의 첫 글자**로 묶는다 — 시즌당 ~700 → 10개.
 *
 * ⚠**규칙이 빌드와 클라 양쪽에 있다**(M1이 경계하는 모양). 그래서 여기서 **실행해서** 잰다:
 * 어느 파일을 받는가 · 같은 샤드면 두 번째부터 안 받는가 · 없는 선수를 빈 카드로 그리지 않는가.
 */
/**
 * ⚠**서버가 실제로 내는 카드를 쓴다.** 손으로 만든 최소 객체를 넘기면 렌더가 요구하는 필드가
 * 빠져도 시험이 통과하고, 그러면 「샤드에서 꺼냈다」만 재고 「그려진다」는 못 재게 된다.
 * (실제로 그렇게 만들었다가 렌더가 조용히 오류 경로로 빠졌다.)
 */
function card(playerId: string, name: string): unknown {
  /**
   * ⚠**紋이 없는 선수를 쓴다.** 紋을 그리려면 SVG가 필요한데 `dom-stub.ts` 에는
   * `createElementNS` 가 없어서, 있으면 렌더가 오류 경로로 빠진다 —
   * **제품의 결함이 아니라 시험 대역의 한계**다(실측으로 확인). 여기서 재는 것은 샤딩이다.
   */
  return JSON.parse(
    JSON.stringify(compareCard(playerPage({ playerId, name, mark: { axes: [], sampleText: "0打席" } }))),
  );
}

test("⚠比較는 선수 ID 첫 글자의 샤드를 받는다 — 선수마다 파일을 만들지 않는다", async () => {
  const doc = buildCompare();
  const requested: string[] = [];
  run(doc, { requested, routes: { "compare/p.json": { p1: card("p1", "山本"), p2: card("p2", "宮城") } } });

  cpk(doc, "p1").fire("click");
  cpk(doc, "p2").fire("click");
  doc.getElementById("cmpGo")!.fire("click");
  await new Promise((r) => setTimeout(r, 0));

  const compareCalls = requested.filter((u) => u.includes("compare/"));
  // ⚠**같은 샤드의 두 선수는 요청 1회다.** 선수마다 파일이면 2회가 된다
  assert.deepEqual(compareCalls, ["compare/p.json"], `받은 것: ${JSON.stringify(compareCalls)}`);
  const out = doc.getElementById("cmpOut")!;
  assert.ok(!out.textContent.includes("読み込めませんでした"), "샤드를 받았는데 오류로 그렸다");
  /**
   * ⚠**요청 수만 세면 부족하다.** 샤드를 통째로 돌려줘도 요청 수는 같다 —
   * **그 선수의 카드가 나왔는지**를 봐야 「지도에서 ID로 집었다」가 확인된다.
   */
  assert.match(out.textContent, /山本/, "A 자리의 선수가 안 그려졌다");
  assert.match(out.textContent, /宮城/, "B 자리의 선수가 안 그려졌다");
});

test("샤드가 다르면 각각 받고, 같은 샤드는 두 번째부터 안 받는다", async () => {
  const doc = buildCompare();
  const requested: string[] = [];
  run(doc, {
    requested,
    routes: { "compare/p.json": { p1: card("p1", "山本"), p2: card("p2", "宮城") }, "compare/b.json": { b1: card("b1", "佐藤") } },
  });

  cpk(doc, "p1").fire("click");
  cpk(doc, "b1").fire("click");
  doc.getElementById("cmpGo")!.fire("click");
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(
    requested.filter((u) => u.includes("compare/")).sort(),
    ["compare/b.json", "compare/p.json"],
  );

  // 두 번째 비교 — `p2` 는 이미 받은 샤드 안에 있으므로 새 요청이 없어야 한다
  const before = requested.filter((u) => u.includes("compare/")).length;
  cpk(doc, "b1").fire("click"); // B 자리를 비운다
  cpk(doc, "p2").fire("click");
  doc.getElementById("cmpGo")!.fire("click");
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(
    requested.filter((u) => u.includes("compare/")).length,
    before,
    "이미 받은 샤드를 다시 받았다 — 캐시가 안 돈다",
  );
});

/**
 * ⚠**샤드는 받았는데 그 선수가 없는 경우를 조용히 넘기지 않는다.**
 * 빈 카드로 그리면 「성적 0」처럼 보인다(M11) — 「없다」와 「못 읽었다」는 다른 상태다(M12).
 *
 * ⚠**이 시험은 `load` 의 명시적 검사를 「단독으로」 잡지 못한다**(뮤테이션으로 확인).
 * 그 검사를 빼도 `render` 가 `undefined` 를 만나 예외로 빠지므로 **화면 결과가 같다** —
 * 동등 변이체다. 그래도 검사를 남기는 이유는 **렌더 내부 동작에 기대지 않기 위해서**다.
 * 언젠가 `render` 가 빈 값을 견디게 바뀌면 그때 이 검사만이 빈 카드를 막는다.
 */
test("⚠샤드에 없는 선수를 빈 카드로 그리지 않는다", async () => {
  const doc = buildCompare();
  // `p2` 를 일부러 빼 둔다
  run(doc, { routes: { "compare/p.json": { p1: card("p1", "山本") } } });

  cpk(doc, "p1").fire("click");
  cpk(doc, "p2").fire("click");
  doc.getElementById("cmpGo")!.fire("click");
  await new Promise((r) => setTimeout(r, 0));

  assert.match(
    doc.getElementById("cmpOut")!.textContent,
    /読み込めませんでした/,
    "없는 선수를 오류로 말하지 않았다",
  );
});

/** ⚠실패한 샤드를 캐시에 남기면 **다시 눌러도 영영 같은 오류**가 난다 */
test("⚠샤드 취득에 실패해도 다시 시도할 수 있다", async () => {
  const doc = buildCompare();
  const requested: string[] = [];
  run(doc, { requested }); // routes 없음 = 전부 실패

  cpk(doc, "p1").fire("click");
  cpk(doc, "p2").fire("click");
  doc.getElementById("cmpGo")!.fire("click");
  await new Promise((r) => setTimeout(r, 0));
  const first = requested.filter((u) => u.includes("compare/")).length;
  assert.ok(first > 0, "요청을 아예 안 했다");

  doc.getElementById("cmpGo")!.fire("click");
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(
    requested.filter((u) => u.includes("compare/")).length > first,
    "실패한 샤드가 캐시에 남아 재시도가 요청을 내지 않았다",
  );
});

/**
 * ⚠**늦게 온 응답이 새 비교를 덮어쓰지 않는다.**
 *
 * 샤드로 묶은 뒤로 「이미 받은 샤드는 즉시 · 새 샤드는 왕복」이라는 **지연 비대칭**이 생겼다.
 * 그래서 A를 누르고 곧바로 B를 누르면, B가 먼저 그려진 뒤 A가 늦게 도착해 화면을 되돌린다 —
 * **사용자가 마지막에 고른 것과 다른 것이 보이는 상태**다.
 * (경합 자체는 예전부터 있었지만, 지연 차를 구조적으로 만든 것은 샤딩이다.)
 */
test("⚠늦게 도착한 비교 결과가 새 비교를 덮어쓰지 않는다", async () => {
  const doc = buildCompare();
  let releaseSlow: (() => void) | null = null;
  run(doc, {
    routes: {
      "compare/p.json": { p1: card("p1", "山本"), p2: card("p2", "宮城") },
      "compare/b.json": { b1: card("b1", "佐藤") },
    },
    // `b` 샤드만 붙잡아 둔다 — 첫 비교가 늦게 도착하게 만든다
    hold: { "compare/b.json": (release) => { releaseSlow = release; } },
  });

  // ① 느린 샤드가 걸린 비교(山本 × 佐藤)를 요청한다
  cpk(doc, "p1").fire("click");
  cpk(doc, "b1").fire("click");
  doc.getElementById("cmpGo")!.fire("click");
  await new Promise((r) => setTimeout(r, 0));

  // ② 기다리지 않고 다른 비교(山本 × 宮城)로 바꿔 다시 누른다 — 이쪽은 캐시라 즉시 그려진다
  cpk(doc, "b1").fire("click"); // B 자리를 비운다
  cpk(doc, "p2").fire("click");
  doc.getElementById("cmpGo")!.fire("click");
  await new Promise((r) => setTimeout(r, 0));
  assert.match(doc.getElementById("cmpOut")!.textContent, /宮城/, "새 비교가 안 그려졌다");

  // ③ 이제 느린 응답이 도착한다. **화면이 되돌아가면 안 된다**
  assert.notEqual(releaseSlow, null, "느린 응답을 붙잡지 못했다 — 시험이 경합을 만들지 못했다");
  releaseSlow!();
  await new Promise((r) => setTimeout(r, 0));
  const out = doc.getElementById("cmpOut")!.textContent;
  assert.match(out, /宮城/, "늦게 온 응답이 새 비교를 덮어썼다");
  assert.ok(!out.includes("佐藤"), "낡은 비교가 화면을 되돌렸다");
});
