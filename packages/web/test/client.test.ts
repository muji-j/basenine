/**
 * 클라이언트 조립 계층을 **실행해서** 검증한다.
 *
 * ⚠**브라우저 검증이 아니다**(`dom-stub.ts` 참조). 여기서 잡는 것은 우리 로직의 결함이다 —
 * 프리셋이 엉뚱한 블록을 켜는가, 순서 바꾸기가 되는가, 저장이 막혀도 화면이 도는가.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { CLIENT_JS, CSS } from "../src/assets.ts";
import { BLOCKS, PRESETS, blocksFor, presetsFor } from "../src/blocks.ts";

/**
 * ⚠**클라이언트에 실제로 실리는 목록**이다(`bootstrapFor("batter")`와 같은 것).
 * 필터 전 `PRESETS`와 비교하면 투수 전용 블록이 타자 화면에 섞여도 테스트가 통과한다.
 */
const BATTER_PRESETS = presetsFor("batter");
const BATTER_BLOCKS = blocksFor("batter");
import { bootstrapFor } from "../src/player-page.ts";
import { El, make, makeDocument, makeStorage, withRect } from "./dom-stub.ts";
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
const MATCHUPS: { id: string; name: string; team: string; pa: number; hr: number; avg: number | null }[] = [
  { id: "11", name: "山本", team: "B", pa: 14, hr: 1, avg: 0.333 },
  { id: "22", name: "戸郷", team: "G", pa: 5, hr: 2, avg: 0.6 },
  { id: "33", name: "今永", team: "DB", pa: 22, hr: 0, avg: 0.25 },
  { id: "44", name: "森下", team: "C", pa: 9, hr: 3, avg: 0.5 },
  { id: "55", name: "大勢", team: "G", pa: 2, hr: 0, avg: null },
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

      /**
       * ⚠**여기부터가 「정렬·좁히기가 되는 표」의 계약이다**(src/table.ts).
       * 손으로 짓는 픽스처라 실제 마크업과 어긋날 수 있어서,
       * `stable-contract.test.ts` 가 **진짜 렌더 결과에 이 갈고리들이 다 있는지** 따로 잰다.
       * 그 시험이 없으면 이 픽스처는 「우리가 상상한 마크업」을 재는 것이 된다
       * (2016년 박스 픽스처에서 이미 밟은 함정이다).
       */
      const stable = make("div", {
        class: "stable",
        "data-stable": "matchup",
        "data-sortdefault": "pa:desc",
        "data-thinfield": "pa",
        "data-thinmin": "10",
        "data-thinunit": "打席",
        "data-mingroup": "matchupMin",
        "data-minfield": "pa",
        "data-unit": "件",
      });
      section.appendChild(stable);
      stable.appendChild(make("input", { id: "matchupFilter", type: "search", "data-stable-filter": "" }));
      const sel = make("select", { id: "matchupTeam", "data-stable-select": "", "data-field": "teamcode" });
      const all = make("option", { value: "" });
      all.textContent = "すべての球団";
      sel.appendChild(all);
      for (const code of [...new Set(MATCHUPS.map((m) => m.team))]) {
        const o = make("option", { value: code });
        o.textContent = code;
        sel.appendChild(o);
      }
      stable.appendChild(sel);
      stable.appendChild(make("span", { id: "matchupCount", "data-stable-count": "" }));
      stable.appendChild(make("p", { id: "matchupStatus", "data-stable-status": "" }));

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
          // ⚠**못 박기는 ID 로 한다**(M10) — 이름은 화면에 보여 줄 때만 쓴다
          "data-oppid": r.id,
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
      stable.appendChild(table);
      const empty = make("p", { class: "empty", id: "matchupEmpty", "data-stable-empty": "" });
      empty.hidden = true;
      stable.appendChild(empty);
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
  /** ⚠`hostname`·`pathname` 은 **동결 스냅샷 경고**가 본다(2026-08-30 사고) */
  location?: { search: string; href: string; hash?: string; hostname?: string; pathname?: string };
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
  /**
   * 서버가 심는 것과 **같은 함수**로 만든다 — 두 벌이 되면 어긋난다.
   *
   * ⚠**실행하지 않는다**(2026-08-18). 예전에는 `new Function("window", bootstrapFor(...))` 로
   * **JS 처럼 돌렸는데**, 지금 그것은 `type="application/json"` 데이터 블록의 내용이라 JSON 이다
   * (CSP 의 script-src 를 unsafe-inline 없이 닫으려고 바꿨다 · site.ts HEADERS).
   * 하네스도 **브라우저와 같은 방식**으로, 문서에 데이터 블록을 심어서 넘긴다.
   */
  const boot = doc.createElement("script");
  boot.id = "bb-boot";
  boot.setAttribute("type", "application/json");
  boot.textContent = bootstrapFor("batter");
  doc.body.appendChild(boot);
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
  // ⚠저장 자리가 `state.matchup` 에서 `state.sort.matchup` 으로 옮겨졌다(표마다 하나씩 두므로).
  // 옛 자리에 넣어 두면 「없는 열」이 아니라 「아무것도 저장 안 된 상태」를 재게 된다.
  storage.setItem("npb-meikan-layout", JSON.stringify({ sort: { matchup: { key: "存在しない", dir: "asc" } } }));
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

/**
 * ⚠**패딩을 인라인으로 덮지 않는다 — 토큰만 바꾼다.**
 *
 * 예전에는 `el.style.paddingTop` 을 직접 넣었는데, 그러면 **스타일시트의 설계값이
 * 한 번도 렌더되지 않는다**(인라인이 이긴다). 실제로 `.block` 에 적은 22px/26px 가
 * 스크립트가 도는 순간 16px/16px 로 덮여, 첫 페인트 뒤 블록마다 레이아웃이 튀었다
 * (2026-08-17 디자인 감사 P1).
 * ⚠**이 시험이 그 잘못된 계약을 고정하고 있었다** — 인라인 패딩을 검사했기 때문에
 *   토큰으로 옮기자 빨개졌다. 시험이 구현을 붙잡고 있으면 고칠 수가 없다.
 *   그래서 「무엇을 하는가」(여백이 바뀐다)를 재되, **어떻게 하는가는 토큰으로** 고정한다.
 */
test("밀도를 바꾸면 블록 여백 토큰이 바뀐다 — 인라인 패딩으로 덮지 않는다", () => {
  const doc = buildPage();
  run(doc);
  const el = doc.querySelector(".block")!;
  const normal = el.style.getPropertyValue("--block-pad-y");
  press(doc, "density", "compact");
  const compact = el.style.getPropertyValue("--block-pad-y");
  // ⚠**인라인 패딩이 다시 들어오면 안 된다** — 그게 원래 결함이다
  assert.equal(el.style["paddingTop"] ?? "", "", "인라인 패딩이 되살아났다");

  /**
   * ⚠**~~"22px"·"11px" 리터럴을 여기서 고정하고 있었다~~**(2026-09-08 · 2a).
   * 그 두 수는 **간격 척도 밖의 값**이었고, 척도로 접으면서 스크립트도 토큰을 쓰게 됐다.
   * ⚠**그런데 이름을 고정하는 것만으로는 부족하다** — 2a 가 --sN 의 **번호를 밀었다**
   * (옛 --s1(4px)이 지금 --s2 다). 이름만 보면 다음 번호 이동 때 **조용히 다른 단**을 가리킨다.
   * → **이름이 CSS 에 실재하는지 · 값이 어느 쪽이 큰지**까지 여기서 잰다.
   */
  const step = (v: string): number => {
    const name = /^var\((--s\d+)\)$/.exec(v.trim())?.[1];
    assert.ok(name !== undefined, `여백을 척도 토큰으로 안 넘겼다: ${v}`);
    const px = new RegExp(`${name}:\\s*(\\d+)px`).exec(CSS)?.[1];
    assert.ok(px !== undefined, `${name} 이 CSS 에 없다 — 스크립트가 없는 단을 가리킨다`);
    return Number(px);
  };
  assert.ok(step(normal) > step(compact), `밀도를 좁혀도 여백이 안 줄었다: ${normal} → ${compact}`);
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
 * **한 그룹이 리그마다 탭줄을 한 벌씩 갖는다 — 로빙 tabindex 는 그 탭줄 안의 규약이다.**
 *
 * ⚠**둘을 한 배열로 모아 놓았다**(2026-09-07 이중 검토 P3 · **이 diff 이전부터 있던 결함**).
 * `initTabs` 가 `[data-tabgroup="G"] [data-tab]` 를 **문서 전체에서** 모으므로:
 * ⑴ 탭 정지(`tabindex="0"`)가 **그룹 전체에 하나**뿐이라, パ 로 바꾸면 그 탭줄에
 *    탭 정지가 **0개**가 되어 **키보드로 아예 닿을 수 없다**(WCAG 2.1.1).
 * ⑵ 끝에서 화살표를 누르면 **숨은 반대 리그의 버튼**으로 넘어가고, 숨은 요소는 초점을
 *    못 받으므로 **초점이 사라진다.**
 *
 * ⚠**「그룹을 리그별로 나눈다」로 고치면 안 된다**(`parts.ts` 의 `TabGroup` 주석) —
 * 「리그를 바꿔도 보던 지표가 남는다」가 함께 사라진다. **순환과 탭 정지만** 탭줄 안으로 가둔다.
 */
test("⚠탭 정지는 탭줄마다 하나씩 — 반대 리그의 탭줄이 키보드에서 사라지면 안 된다", () => {
  const doc = buildRankingPage();
  run(doc);
  const lists = doc.querySelectorAll('[data-tabgroup="rankcat"]');
  assert.equal(lists.length, 2, "픽스처가 두 리그의 탭줄을 안 만들었다 — 이 시험이 공회전한다");
  for (const [i, list] of lists.entries()) {
    const stops = list
      .querySelectorAll("[data-tab]")
      .filter((b) => b.getAttribute("tabindex") === "0");
    assert.equal(stops.length, 1, `${i === 0 ? "セ" : "パ"}의 탭줄에 탭 정지가 ${stops.length}개다`);
  }
});

test("⚠화살표는 그 탭줄 안에서만 돈다 — 숨은 반대 리그로 넘어가면 초점이 사라진다", () => {
  const doc = buildRankingPage();
  run(doc);
  const [ce, pa] = doc.querySelectorAll('[data-tabgroup="rankcat"]');
  const ceBtns = ce!.querySelectorAll("[data-tab]");
  const paBtns = pa!.querySelectorAll("[data-tab]");
  // セ의 **마지막** 버튼에서 오른쪽 → 같은 탭줄의 첫 버튼으로 돌아와야 한다
  ceBtns[ceBtns.length - 1]!.fire("keydown", { key: "ArrowRight" });
  assert.equal(
    ceBtns[0]!.getAttribute("tabindex"),
    "0",
    "끝에서 오른쪽을 눌렀는데 같은 탭줄의 첫 버튼으로 안 돌아왔다",
  );
  assert.equal(
    paBtns.filter((b) => b.getAttribute("tabindex") === "0").length,
    1,
    "반대 리그의 탭줄이 탭 정지를 잃었다",
  );
});

test("⚠그래도 리그 간 선택은 함께 움직인다 — 그룹을 나누면 그것이 사라진다", () => {
  const doc = buildRankingPage();
  run(doc);
  const [ce, pa] = doc.querySelectorAll('[data-tabgroup="rankcat"]');
  ce!.querySelectorAll("[data-tab]").find((b) => b.dataset["tab"] === "starter")!.fire("click");
  const on = (list: El): string[] =>
    list
      .querySelectorAll("[data-tab]")
      .filter((b) => b.getAttribute("aria-selected") === "true")
      .map((b) => b.dataset["tab"]!);
  assert.deepEqual(on(ce!), ["starter"]);
  assert.deepEqual(on(pa!), ["starter"], "리그를 바꿨을 때 보던 지표가 남지 않는다");
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
    const qbox = make("div", { class: "qbox" });
    qbox.appendChild(make("input", { id: `pick${id}`, type: "search" }));
    qbox.appendChild(make("ul", { id: `pick${id}Hits`, role: "list", "aria-label": "候補" }));
    qbox.appendChild(make("p", { class: "vh", "data-hitstatus": "", role: "status" }));
    form.appendChild(qbox);
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
  // ⚠**이름이 아니라 선수 ID 를 넘긴다**(M10 · 2026-08-18 감사 P2) — 동명이인이 함께 걸리지 않게
  assert.equal(location.href, "players/b1.html?vs=p1#b-matchup");
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
  // ⚠**이름이 아니라 선수 ID 를 넘긴다**(M10 · 2026-08-18 감사 P2) — 동명이인이 함께 걸리지 않게
  assert.equal(location.href, "players/b1.html?vs=p1#b-matchup");
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

/**
 * ⚠**이름으로 넘기면 동명이인이 함께 걸린다**(M10 · 2026-08-18 감사 P2).
 * 이 저장소에 「小島」가 실제로 둘 있다. 「이 투수와의 성적」이라며 **남의 기록이 섞인 표**를
 * 보여 주는 것은 분모 없는 비율만큼 나쁘다 — 숫자가 그럴듯해서 의심조차 안 된다.
 */
function withHomonyms(doc: ReturnType<typeof makeDocument>): void {
  const tbody = doc.querySelectorAll("#matchupTable tbody")[0]!;
  for (const [id, team] of [["66", "M"], ["77", "T"]] as const) {
    tbody.appendChild(make("tr", {
      "data-name": "小島", "data-oppid": id, "data-team": team, "data-teamcode": team,
      // ⚠**최소 타석 문턱(10)을 넘겨 둔다** — 안 그러면 못 박기와 무관하게 걸러져
      //   이 시험이 「못 박기가 되는가」가 아니라 「문턱이 도는가」를 재게 된다
      "data-pa": "20", "data-hr": "0", "data-avg": "0.2",
    }));
  }
}

const shownIds = (doc: ReturnType<typeof makeDocument>): string[] =>
  doc.querySelectorAll("#matchupTable tbody tr").filter((r) => !r.hidden)
    .map((r) => String(r.dataset["oppid"]));

test("⚠?vs= 는 선수 ID다 — 동명이인 중 그 한 사람만 남는다", () => {
  const doc = buildPage();
  withHomonyms(doc);
  run(doc, { location: { search: "?vs=66", href: "" } });
  assert.deepEqual(shownIds(doc), ["66"], "동명이인이 함께 걸렸다 — 남의 대전 기록이 섞인다");
  // ⚠**무엇이 걸렸는지 화면이 말한다** — 못 박기는 ID로 하되 사람이 읽는 것은 이름이다
  assert.equal(doc.getElementById("matchupFilter")!.value, "小島");
});

test("⚠좁히기 칸을 건드리면 못 박기가 풀린다 — 지웠는데 한 행만 남으면 고장으로 보인다", () => {
  const doc = buildPage();
  withHomonyms(doc);
  run(doc, { location: { search: "?vs=66", href: "" } });
  const input = doc.getElementById("matchupFilter")!;
  input.value = "";
  input.fire("input");
  assert.ok(shownIds(doc).length > 1, `못 박기가 안 풀렸다 — ${shownIds(doc).length}행만 남았다`);
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
    const qbox = make("div", { class: "qbox" });
    qbox.appendChild(make("input", { id: `cmp${id}`, type: "search" }));
    qbox.appendChild(make("ul", { id: `cmp${id}Hits`, role: "list", "aria-label": "候補" }));
    qbox.appendChild(make("p", { class: "vh", "data-hitstatus": "", role: "status" }));
    form.appendChild(qbox);
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

// ─── 검색이 자르는 것을 말하는가 ────────────────────────────────────────

/**
 * ⚠**20건에서 조용히 잘리고 있었다**(2026-08-19 감사 P1 · HTTP 서빙 실측).
 *
 * 색인 698명에서 「田」 **81건 중 20** · 「中」 **86건 중 20** · 「山」 **48건 중 20** 이
 * 표시됐고, 「N건 중 20건」도 「더 보기」도 없었다. 「佐」는 11건이라 전부 나왔다 —
 * 즉 **잘린 화면과 안 잘린 화면이 똑같이 생겼다.** 21번째 선수는 「이 사이트에 없는 사람」이 된다.
 * §0-1(3클릭 이내 도달)의 **주 경로가 침묵으로 실패**하는 것이고,
 * 이 프로젝트가 순위표에는 「이 지표로 기록이 있는 선수 256人」까지 적으면서
 * **가장 많이 쓰는 조작에만** 그 규율이 없었다(작업규칙 7).
 */
const MANY_INDEX = Array.from({ length: 25 }, (_, i) => ({
  i: `t${i}`,
  n: `田${i}`,
  t: "チーム",
}));

/**
 * 헤더 검색(`#q` → `#qhits`)의 뼈대. 목록 id 가 「Hits」가 아니라 `qhits` 다.
 * ⚠**listbox / combobox 를 쓰지 않는다**(2026-08-20) — 서버 마크업과 같은 모양이어야 한다.
 * 그 일치는 `layout.test.ts` 가 실제 렌더 결과에서 따로 잰다.
 */
function buildHeaderSearch(): ReturnType<typeof makeDocument> {
  const doc = makeDocument("");
  const box = make("div", { class: "qbox" });
  box.appendChild(make("input", { id: "q", type: "search" }));
  box.appendChild(make("ul", { class: "qhits", id: "qhits", role: "list", "aria-label": "検索結果" }));
  box.appendChild(make("p", { class: "vh", "data-hitstatus": "", role: "status" }));
  doc.body.appendChild(box);
  return doc;
}

async function searchIn(
  doc: ReturnType<typeof makeDocument>,
  inputId: string,
  listId: string,
  term: string,
): Promise<El[]> {
  const input = doc.getElementById(inputId)!;
  input.fire("focus");
  input.value = term;
  input.fire("input");
  await new Promise((resolve) => setTimeout(resolve, 0));
  return doc.querySelectorAll(`#${listId} li`);
}

/**
 * **낭독 영역이 실제로 말한 것.**
 *
 * ⚠**`role="status"` 갱신은 150ms 모아서 낸다**(2026-08-21 · `assets.ts` 의 `SAY_DELAY`).
 * 폴라이트 라이브 영역이라 한 글자마다 인원수가 바뀌면 그만큼 낭독이 쌓이기 때문이다 —
 * IME 로 「たなか」를 치는 구간이 그렇다. **화면(목록)은 안 미룬다**, 그래서 `searchIn` 은 그대로다.
 * ⚠**여기서만 기다린다** — `searchIn` 에 150ms 를 넣으면 검색 시험 전체가 그만큼 느려진다.
 */
async function said(doc: ReturnType<typeof makeDocument>): Promise<string> {
  await new Promise((resolve) => setTimeout(resolve, 200));
  return doc.querySelector("[data-hitstatus]")!.textContent;
}

/** 결과 항목만. 꼬리의 안내줄은 결과가 아니다 */
function picks(items: El[]): El[] {
  return items.filter((li) => li.className !== "more");
}

test("⚠검색이 20건에서 자른 것을 말한다 — 잠자코 자르면 21번째 선수가 「없는 사람」이 된다", async () => {
  // ⚠**대상 질의가 실제로 20건을 넘는지 먼저 단언한다.** 안 넘으면 이 시험은 조용히 통과한다
  assert.ok(
    MANY_INDEX.filter((p) => p.n.includes("田")).length > 20,
    "20건을 넘는 질의가 없다 — 이 시험이 공회전한다",
  );
  const doc = buildHeaderSearch();
  run(doc, { index: MANY_INDEX });
  const items = await searchIn(doc, "q", "qhits", "田");

  assert.equal(picks(items).length, 20, "그리는 인원이 20명이 아니다");
  const tail = items.at(-1)!;
  assert.equal(tail.getAttribute("class"), "more", "목록 끝에 안내줄이 없다");
  assert.match(tail.textContent, /25人中20人を表示/, "「몇 명 중 몇 명」을 말하지 않는다");
  // ⚠**자르기 전 수여야 한다.** 자른 뒤에 세면 「20人中20人」이 되어 아무 말도 안 한 것과 같다
  assert.ok(!tail.textContent.includes("20人中"), "자른 뒤의 수를 총건수라고 말했다");
});

/**
 * ⚠**보내는 곳이 실제로 그 질의를 받는지 확인하고 링크를 만들었다.**
 * `players.html` 은 서버가 전 선수를 그려 두고 클라이언트가 좁히기만 얹는 화면이라,
 * `?q=` 를 읽어 좁힌 상태로 열 수 있다. 받지 못하는 곳이었다면 문구만 냈어야 한다.
 */
test("⚠꼬리는 選手一覧으로 그 질의를 달고 간다 — 다시 치게 하면 안내가 빈말이 된다", async () => {
  const doc = buildHeaderSearch();
  run(doc, { index: MANY_INDEX });
  const tail = (await searchIn(doc, "q", "qhits", "田")).at(-1)!;
  const a = tail.querySelector("a");
  assert.notEqual(a, null, "갈 곳이 없다");
  assert.equal(a!.getAttribute("href"), `players.html?q=${encodeURIComponent("田")}`);
  /**
   * ⚠**이 줄은 실기가 잡은 결함이다**(2026-08-19 Playwright). 처음 만들 때 안내줄에
   * `role="option" aria-disabled="true"` 를 붙였는데, 그러면 그 안의 링크가
   * **「disabled」로 판정돼 눌리지 않는다** — 「여기로 가라」고 써 놓고 「못 쓴다」고 말하는 꼴이다.
   * 읽기로는 안 잡혔고 브라우저가 잡았다.
   */
  assert.equal(tail.getAttribute("aria-disabled"), null, "갈 수 있는 줄을 「쓸 수 없다」고 표시했다");
});

test("⚠20건 이하면 안내줄을 만들지 않는다 — 안 자른 것을 잘랐다고 하면 그것도 거짓말이다", async () => {
  const doc = buildHeaderSearch();
  run(doc, { index: MANY_INDEX });
  // 「田1」은 田1·田10〜田19 = 11건. 20 이하다
  const items = await searchIn(doc, "q", "qhits", "田1");
  assert.equal(picks(items).length, 11, "표본이 11건이 아니다 — 이 시험이 재는 것이 바뀌었다");
  assert.equal(items.length, 11, "자르지 않았는데 안내줄이 붙었다");
});

/**
 * ⚠**「対戦を選ぶ」의 검색창은 고르는 중이다.** 여기서 선수 일람으로 보내면 반대쪽 선택이
 * 날아간다 — 안내는 하되 페이지를 떠나는 링크는 만들지 않는다.
 */
test("⚠고르는 중인 검색창은 안내만 하고 화면을 떠나지 않는다", async () => {
  const doc = buildPicker();
  run(doc, { index: MANY_INDEX });
  const items = await searchIn(doc, "pickPitcher", "pickPitcherHits", "田");
  const tail = items.at(-1)!;
  assert.match(tail.textContent, /25人中20人を表示/, "고르는 화면에서는 총건수를 안 말한다");
  assert.equal(tail.querySelector("a"), null, "고르는 중인데 화면을 떠나는 링크를 놓았다");
});

/**
 * ⚠**화살표 이동이 안내줄에 멈추지 않는다.** 멈추면 Enter 로 아무 데도 못 가는 상태가 되고,
 * 마지막 선수 다음에 「고를 수 없는 것」이 하나 낀 것처럼 보인다.
 */
test("⚠안내줄은 골라지지 않는다 — 화살표가 스무 번째에서 멈춘다", async () => {
  const doc = buildHeaderSearch();
  const { location } = run(doc, { index: MANY_INDEX });
  const input = doc.getElementById("q")!;
  await searchIn(doc, "q", "qhits", "田");
  for (let n = 0; n < 25; n += 1) input.fire("keydown", { key: "ArrowDown" });
  input.fire("keydown", { key: "Enter" });
  // 20번째(= 田19)에서 멈춘다. 안내줄이 골라졌다면 여기서 아무 데도 안 가거나 딴 곳으로 간다
  assert.equal(location.href, "players/t19.html", "화살표 끝이 스무 번째 선수가 아니다");
});

// ── 롤을 뺀 뒤에도 남아야 하는 것 ─────────────────────────────────────────

/**
 * ⚠**롤을 빼는 것이지 조작을 빼는 게 아니다**(2026-08-20).
 * `role="option"`/`aria-selected` 를 지우면 **어디를 고르고 있는지 보여 주던 표시**가
 * 같이 사라진다 — 화살표는 도는데 화면이 안 움직이면 「키보드가 안 먹는다」가 된다.
 * ⚠**ARIA 로 되돌리지 않는다.** 그건 방금 뺀 것을 다시 넣는 것이다 — 표시는 우리 클래스로 한다.
 */
test("⚠결과 줄에 option 롤도 aria-selected 도 없다 — 그 안의 링크가 「못 쓴다」로 판정된 자리다", async () => {
  const doc = buildHeaderSearch();
  run(doc, { index: MANY_INDEX });
  const items = await searchIn(doc, "q", "qhits", "田");
  assert.ok(items.length > 1, `줄이 ${items.length}개뿐이다 — 이 시험이 공회전한다`);
  for (const li of items) {
    assert.equal(li.getAttribute("role"), null, "결과 줄에 롤이 남아 있다");
    assert.equal(li.getAttribute("aria-selected"), null, "결과 줄에 aria-selected 가 남아 있다");
    assert.equal(li.getAttribute("aria-disabled"), null, "링크를 「못 쓴다」고 표시했다");
  }
});

test("⚠화살표가 고른 자리는 눈에 보인다 — 표시가 없으면 「키보드가 안 먹는다」가 된다", async () => {
  const doc = buildHeaderSearch();
  run(doc, { index: MANY_INDEX });
  const input = doc.getElementById("q")!;
  await searchIn(doc, "q", "qhits", "田1");
  const on = (): number[] =>
    doc.querySelectorAll("#qhits li").map((li, i) => (li.className.split(/\s+/).includes("on") ? i : -1))
      .filter((i) => i >= 0);
  assert.deepEqual(on(), [], "아무것도 안 골랐는데 표시가 있다");
  input.fire("keydown", { key: "ArrowDown" });
  assert.deepEqual(on(), [0], "첫 줄이 안 골라진다");
  input.fire("keydown", { key: "ArrowDown" });
  assert.deepEqual(on(), [1], "표시가 하나만 움직이지 않는다");
  input.fire("keydown", { key: "ArrowUp" });
  assert.deepEqual(on(), [0], "위로 못 올라간다");
});

test("⚠Esc 로 닫힌다 — 롤을 빼는 것이지 조작을 빼는 게 아니다", async () => {
  const doc = buildHeaderSearch();
  run(doc, { index: MANY_INDEX });
  const input = doc.getElementById("q")!;
  const list = doc.getElementById("qhits")!;
  await searchIn(doc, "q", "qhits", "田");
  assert.equal(list.hidden, false, "목록이 안 열렸다 — 이 시험이 공회전한다");
  input.fire("keydown", { key: "Escape" });
  assert.equal(list.hidden, true, "Esc 로 안 닫힌다");
});

/**
 * ⚠**combobox 를 그만두면 「열렸다」를 말해 주던 것이 통째로 사라진다.**
 * 그 자리를 `role="status"` 한 줄이 받는다 — 안 넣으면 낭독기 사용자는 **입력에 아무 반응이 없는**
 * 화면을 쓰게 된다(§0-1 의 주 경로다).
 * ⚠**목록 자체를 live 로 만들지 않는다** — 키를 칠 때마다 스무 명을 통째로 읽는다.
 */
test("⚠결과 수를 소리로 낸다 — combobox 를 그만둔 자리를 이것이 받는다", async () => {
  const doc = buildHeaderSearch();
  run(doc, { index: MANY_INDEX });
  await searchIn(doc, "q", "qhits", "田1");
  assert.match(await said(doc), /11/, "고른 인원을 말하지 않는다");
  await searchIn(doc, "q", "qhits", "田");
  const many = await said(doc);
  assert.match(many, /25/, "자르기 전 인원을 말하지 않는다");
  assert.match(many, /20/, "그리는 인원을 말하지 않는다");
  await searchIn(doc, "q", "qhits", "존재하지않음");
  assert.match(await said(doc), /該当なし/, "0건을 말하지 않는다");
});

/**
 * ⚠**목록은 안 미룬다.** 낭독만 모으는 것이라, 화면은 키를 칠 때마다 바로 바뀌어야 한다 —
 * 안 그러면 「검색이 느려졌다」가 되고 그건 §0-1 의 주 경로다.
 */
test("⚠낭독을 모아도 목록은 즉시 바뀐다 — 미루는 것은 소리뿐이다", async () => {
  const doc = buildHeaderSearch();
  run(doc, { index: MANY_INDEX });
  const t0 = Date.now();
  const items = await searchIn(doc, "q", "qhits", "田1");
  assert.ok(picks(items).length > 0, "목록이 즉시 안 그려졌다 — 화면까지 미뤘다");
  /**
   * ⚠**「아직 안 났다」는 시간에 기대는 판정이다.** 하네스가 150ms 이상 걸렸다면
   * 이 시험은 디바운스를 잰 것이 아니라 **자기 느림을 잰 것**이므로, 그걸 「고장」으로
   * 읽히게 두지 않는다 — 무엇 때문에 떨어졌는지 메시지가 말하게 한다(작업규칙 8).
   */
  const elapsed = Date.now() - t0;
  assert.ok(elapsed < 100, `하네스가 ${elapsed}ms 걸려 디바운스(150ms)를 잴 수 없었다 — 다시 돌려라`);
  // 그 시점에는 아직 소리가 안 났다(모으는 중이다)
  assert.equal(
    doc.querySelector("[data-hitstatus]")!.textContent,
    "",
    "키 입력 즉시 낭독 영역을 갱신했다 — 한 글자마다 낭독이 쌓인다",
  );
  assert.match(await said(doc), /11/, "모은 뒤에도 결국 말하지 않는다");
});

test("⚠읽지 못했을 때도 소리로 낸다 — 「없다」와 「못 읽었다」는 다르다(M12)", async () => {
  const doc = buildHeaderSearch();
  run(doc); // 색인을 주지 않는다 = 취득 실패
  await searchIn(doc, "q", "qhits", "田");
  const text = await said(doc);
  assert.ok(text !== "", "실패를 말하지 않는다");
  assert.ok(!text.includes("該当なし"), "취득 실패를 「없다」라고 말한다");
});

test("⚠닫으면 소리도 지운다 — 닫힌 목록의 인원을 낭독기가 계속 들고 있으면 안 된다", async () => {
  const doc = buildHeaderSearch();
  run(doc, { index: MANY_INDEX });
  const input = doc.getElementById("q")!;
  const status = doc.querySelector("[data-hitstatus]")!;
  await searchIn(doc, "q", "qhits", "田");
  assert.ok((await said(doc)) !== "");
  input.fire("keydown", { key: "Escape" });
  // ⚠**즉시** 지운다 — 모으는 시간을 기다리지 않는다(닫힌 목록의 인원이 뒤늦게 들리면 더 나쁘다)
  assert.equal(status.textContent, "", "닫았는데 결과 수가 남아 있다");
  // ⚠**미뤄 둔 낭독이 뒤늦게 되살아나지 않는가** — 이게 디바운스를 넣을 때의 진짜 함정이다
  assert.equal(await said(doc), "", "닫은 뒤에 미뤄 둔 인원수가 되살아났다");
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
 * ⚠**헤더 검색의 「선수一覧ですべて見る」가 닿는 곳이 여기다.**
 * 그 링크는 `?q=` 를 달고 오는데 이 화면이 안 읽으면, 안내를 따라온 사람은
 * **698명 목록 앞에서 처음부터 다시** 쳐야 한다 — 안내가 빈말이 된다.
 * ⚠**서버는 이 값을 모른다.** 목록은 전원이 그려져 있고 좁히기만 얹으므로,
 * 스크립트가 없으면 전 선수 목록이 그대로 나온다(§0-1) — 그래서 문구도 「すべて見る」다.
 */
test("⚠?q= 로 들어오면 그 말로 좁힌 상태에서 열린다", () => {
  const doc = buildKanaRoster();
  run(doc, { location: { search: `?q=${encodeURIComponent("やまもと")}`, href: "" } });
  assert.deepEqual(rosterNames(doc), ["山本"], "?q= 를 안 읽었다");
  assert.equal(doc.getElementById("rosterFilter")!.value, "やまもと", "검색창이 무엇으로 좁혔는지 안 말한다");
  assert.equal(doc.getElementById("rosterCount")!.textContent, "1人", "몇 명이 남았는지 안 고쳤다");
});

test("⚠?q= 가 아닌 것으로는 좁히지 않는다 — 첫 방문이 빈 화면이 되면 안 된다", () => {
  const doc = buildKanaRoster();
  run(doc);
  assert.equal(rosterNames(doc).length, 3, "질의어가 없는데 좁혔다");
  assert.equal(doc.getElementById("rosterFilter")!.value, "");

  /**
   * ⚠**다른 화면이 쓰는 파라미터로 좁히면 안 된다.** `?vs=` 는 선수 페이지에서 **상대 투수를
   * ID 로 못 박는 값**이라(M10), 그것으로 이름 좁히기를 걸면 선수 일람이 통째로 0건이 된다.
   */
  const other = buildKanaRoster();
  run(other, { location: { search: `?vs=${encodeURIComponent("山本")}`, href: "" } });
  assert.equal(rosterNames(other).length, 3, "?q= 가 아닌 값으로 좁혔다");
  assert.equal(other.getElementById("rosterFilter")!.value, "");
});

/**
 * ⚠**`decodeURIComponent` 는 깨진 % 열에서 던진다.** 여기서 던지면 그 뒤의 초기화가
 * 통째로 죽어 화면 전체가 조용히 고장난다 — 주소창 한 글자로 일어날 수 있는 일이다.
 */
test("⚠깨진 ?q= 로도 화면이 죽지 않는다", () => {
  const doc = buildKanaRoster();
  run(doc, { location: { search: "?q=%E5%B1%B1%", href: "" } });
  // 못 푸는 값은 원문 그대로 쓴다. 결과가 0건이어도 **화면은 살아 있다**
  assert.equal(doc.getElementById("rosterFilter")!.value, "%E5%B1%B1%");
  assert.equal(doc.getElementById("rosterCount")!.textContent, "0人");
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
/**
 * ⚠**紋이 있는 선수를 쓴다.**
 *
 * 처음에는 `mark:{axes:[]}` 로 紋을 없앴고, 그 이유를 「대역에 `createElementNS` 가 없어서」라고
 * 적었다. 그런데 **같은 커밋이 그 대역을 고쳤으므로 그 주석은 쓰는 순간 거짓**이었고,
 * 결과적으로 대역에 넣은 `createElementNS` 를 **1,106개 시험 중 0건이 밟는** 상태가 됐다
 * (2026-08-17 이중 검토가 호출 횟수를 계측해 지적).
 *
 * 「고쳤다」고 적어 놓고 아무도 안 지나가는 길을 만드는 것이 이 프로젝트가 반복해 온 실패다.
 * 紋을 살려 **比較 화면의 시각적 주역(겹쳐 그리는 오각형)이 실제로 그려지는지**까지 잰다.
 */
function card(playerId: string, name: string): unknown {
  return JSON.parse(JSON.stringify(compareCard(playerPage({ playerId, name }))));
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
  /**
   * ⚠**紋까지 그려지는지 본다.** 이 경로는 SVG(`createElementNS`)를 쓰는데,
   * 대역에 그것이 없던 동안 **렌더 전체가 조용히 오류로 빠지고 있었다** —
   * 시험은 초록인데 재는 것이 「오류 화면이 나왔다」였다.
   */
  assert.equal(doc.querySelectorAll("svg").length, 1, "겹친 紋이 그려지지 않았다 — SVG 경로가 죽었다");
  // ⚠**두 선수의 도형이 한 그림에 겹쳐야** 비교가 된다. 눈금 1개 + 선수 2개 = 3개 이상
  assert.ok(
    doc.querySelectorAll("polygon").length >= 3,
    `紋의 도형이 모자란다(${doc.querySelectorAll("polygon").length}개) — 겹쳐 그리지 않았다`,
  );
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
 * ⚠**「どちらが上か」가 낭독기에 전혀 안 들렸다**(2026-09-08 1차 검토).
 *
 * 채널이 **굵기(`.cmprow .win{font-weight}`)와 생성 콘텐츠 삼각형(`::after`/`::before`)** 둘뿐이었고,
 * **그 자리에** `aria-label` 도 숨김 글자도 **0건**이었다(비교 화면을 그리는 `compare.ts`·`assets.ts` 전수).
 * ⚠**「이 저장소에 aria-label 이 0건」이 아니다** — 겹친 紋(SVG)과 테마 버튼은 갖고 있다.
 *   없던 것은 **이긴 쪽을 말하는 채널**이다.
 * → **두 값은 들리는데 어느 쪽이 위인지가 안 들린다.** 색만으로 상태를 말하는 것과 같은 얼굴이다.
 *
 * ⚠**이 시험이 잡는 것과 못 잡는 것.** 잡는 것은 「이긴 칸에 **읽히는 글자**가 있는가」까지다.
 * 실제 낭독기가 어떻게 읽는지는 **CI 에 낭독기가 없어서 못 잰다** — `forced-colors.test.ts` 가
 * 같은 이유로 「구조를 잰다」고 적은 그 자리다.
 */
test("⚠比較の「どちらが上か」が読み上げにも届く — 太字と三角だけでは聞こえない", async () => {
  /** 판정 가능한 지표 하나를 **지는 쪽으로** 흔든다. 안 흔들면 두 카드가 같아 승자가 안 나온다 */
  const weaken = (c: unknown): unknown => {
    const card = JSON.parse(JSON.stringify(c)) as {
      stats: { k: string; dir: number; min: number | null; n: number | null; s: number }[];
    };
    const hit = card.stats.find((s) => s.dir !== 0 && s.min !== null && s.n !== null && s.s >= s.min);
    assert.notEqual(hit, undefined, "판정 가능한 지표가 없다 — 이 시험이 공회전한다");
    hit!.n = hit!.n! - hit!.dir; // dir=1 이면 작게, dir=-1 이면 크게 = 어느 쪽이든 진다
    return card;
  };
  const doc = buildCompare();
  run(doc, { routes: { "compare/p.json": { p1: card("p1", "山本"), p2: weaken(card("p2", "宮城")) } } });
  cpk(doc, "p1").fire("click");
  cpk(doc, "p2").fire("click");
  doc.getElementById("cmpGo")!.fire("click");
  await new Promise((r) => setTimeout(r, 0));

  const wins = doc.querySelectorAll(".cmprow .win");
  // ⚠**공회전 방지** — 승자 표시가 0건이면 이 시험은 아무것도 안 잰다
  assert.ok(wins.length >= 1, `이긴 쪽 표시가 ${wins.length}건이다 — 이 시험이 공회전한다`);
  for (const w of wins) {
    const vh = w.querySelectorAll(".vh");
    assert.equal(
      vh.length,
      1,
      "이긴 칸에 보이지 않는 글자가 없다 — 굵기와 삼각형은 낭독기에 안 들린다(색만으로 말하는 것과 같다)",
    );
    // ⚠**「こちらが上」이 아니라 이름이다** — 선형으로 읽히면 「こちら」가 무엇인지 사라진다
    assert.match(vh[0]!.textContent, /^(山本|宮城)が上$/, `읽히는 글자가 뜻을 안 나른다: ${vh[0]!.textContent}`);
  }
  // ⚠**진 칸에는 붙지 않는다** — 양쪽에 붙이면 아무 말도 안 한 것과 같다
  const all = doc.querySelectorAll(".cmprow .vh");
  assert.equal(all.length, wins.length, `이기지 않은 칸에도 붙었다(표시 ${wins.length} · 글자 ${all.length})`);
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

  /**
   * ⚠**「못 받았다」와 같은 문구로 뭉개지 않는다**(M12) — 시키는 행동이 다르다.
   * 샤드는 이미 성공 캐시라 **다시 눌러도 요청조차 안 나간다** — 「통신을 확인하고 다시」는
   * 원리적으로 절대 낫지 않는 안내다(2026-08-17 이중 검토 지적).
   */
  const out = doc.getElementById("cmpOut")!.textContent;
  assert.match(out, /見つかりませんでした/, "없는 선수를 「못 찾았다」로 말하지 않았다");
  assert.ok(!out.includes("通信を確認"), "낫지 않는 행동(통신 확인·재시도)을 시켰다");
});

/** 진짜 취득 실패는 여전히 「통신을 확인하라」다 — 두 상태가 서로를 덮지 않는다 */
test("취득 실패와 「그 선수가 없다」를 다른 문구로 말한다", async () => {
  const doc = buildCompare();
  run(doc); // routes 없음 = 진짜 취득 실패
  cpk(doc, "p1").fire("click");
  cpk(doc, "p2").fire("click");
  doc.getElementById("cmpGo")!.fire("click");
  await new Promise((r) => setTimeout(r, 0));
  const out = doc.getElementById("cmpOut")!.textContent;
  assert.match(out, /通信を確認/, "취득 실패인데 통신을 확인하라고 하지 않았다");
  assert.ok(!out.includes("見つかりませんでした"), "취득 실패를 「없다」로 말했다");
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

/**
 * ⚠**가로로 넘치는 표에 키보드가 닿는가**(WCAG 2.1.1 Keyboard · Level A).
 *
 * ⚠**「포커스 갈 것이 있으면 건너뛴다」로 판정하던 것이 순위표를 통째로 놓쳤다**
 * (2026-08-18 재감사 P1). 순위표의 **유일한 링크가 sticky 로 고정된 2열의 팀명**이라
 * 포커스를 받아도 상자가 1px 도 안 밀린다 — 그런데 판정은 「포커스 있음 → 안 붙임」이었다.
 * 실측 dist/index.html 5/5 · dist/ranking.html 82/82 가 그렇게 빠져서, 그 수정이 고친 것이 0개였다.
 *
 * ⚠**이 시험이 여태 없었던 이유가 스텁에 기하가 없어서**다 — `scrollWidth` 가 없으니
 * 코드가 첫 줄에서 조기 반환했고, 무엇을 넣든 초록이었다. 그래서 스텁에 폭을 넣었다.
 */
function scrollerCase(scrollWidth: number, clientWidth: number, linkLeft: number, linkWidth: number): El {
  const sc = make("div", { class: "scroller" });
  sc.scrollWidth = scrollWidth;
  sc.clientWidth = clientWidth;
  const table = make("table", {});
  const th = make("th", {});
  th.textContent = "順位表";
  table.appendChild(th);
  const a = make("a", { href: "teams/t.html" });
  a.offsetLeft = linkLeft;
  a.offsetWidth = linkWidth;
  table.appendChild(a);
  sc.appendChild(table);
  return sc;
}

test("⚠sticky 열에 링크가 갇힌 넓은 표는 키보드 스크롤을 얻는다", () => {
  const doc = buildPage();
  // 순위표의 실제 모양: 최소폭 787px · 스마트폰 353px · 링크는 왼쪽 고정 열(offsetLeft 8)
  const stuck = scrollerCase(787, 353, 8, 90);
  doc.body.appendChild(stuck);
  run(doc);
  assert.equal(stuck.getAttribute("tabindex"), "0", "키보드로 밀 방법이 없는 표에 탭 정지가 안 붙었다");
  assert.equal(stuck.getAttribute("role"), "region");
  assert.match(stuck.getAttribute("aria-label") ?? "", /横スクロール/);
});

test("⚠포커스로 오른쪽 끝까지 밀 수 있으면 탭 정지를 늘리지 않는다", () => {
  const doc = buildPage();
  // 마지막 링크가 오른쪽 끝에 닿는다 — Tab 만으로 전부 볼 수 있으므로 정지를 더할 이유가 없다
  const reachable = scrollerCase(787, 353, 700, 87);
  doc.body.appendChild(reachable);
  run(doc);
  assert.equal(reachable.getAttribute("tabindex"), null, "쓸모없는 탭 정지가 늘었다");
});

/**
 * **가로로 넘치는 탭줄 + 뒤쪽 탭이 여는 패널.**
 *
 * ⚠**기하를 손으로 넣는다** — 스텁에는 레이아웃이 없고, 클라이언트는 기하를 모르면
 * 아무것도 안 한다(그게 안전 방향이다). `withRect` 로 **이 요소들에만** 넣는다.
 * 상자는 [0,100] 인데 뒤쪽 탭이 [200,260] 이라 **한 글자도 안 보인다** — 실측(390px)에서
 * 상자 [80,330] 대 ドラフト [343,391] 이던 그 모양이다.
 */
function deepTabStrip(doc: ReturnType<typeof makeDocument>): El {
  const strip = make("div", { class: "tabs scroll", role: "tablist", "data-tabgroup": "deep" });
  strip.scrollWidth = 300;
  strip.clientWidth = 100;
  withRect(strip, 0, 100);
  for (const [key, left, right] of [["a", 0, 60], ["b", 200, 260]] as const) {
    const b = make("button", { class: "tab", role: "tab", "data-tab": key, "aria-selected": "false" });
    withRect(b, left, right);
    strip.appendChild(b);
  }
  doc.body.appendChild(strip);
  for (const key of ["a", "b"]) {
    const p = make("div", { "data-panelgroup": "deep", "data-panelkey": key, role: "tabpanel" });
    if (key === "b") p.appendChild(make("h4", { id: "deep-target" }));
    doc.body.appendChild(p);
  }
  return strip;
}

/**
 * ⚠⚠**초기화에서 한 번만 부르고 있었다**(2026-09-07 이중 검토 P2).
 *
 * `showCurrentTab()` 의 호출처가 코드 전체에서 초기화 한 곳뿐이었는데, **그 뒤에 탭 선택을
 * 바꾸는 경로가 둘 더 있다** — 깊은 링크(`revealHash`)와 브라우저 찾기(`beforematch`).
 * 그래서 뒤쪽 탭을 가리키는 해시로 들어오면 **패널은 열리는데 그 탭이 상자 밖에 남았다.**
 * ⚠**유저가 이번에 고쳐 달라고 한 바로 그 증상이고, 경로만 다르다.**
 */
test("⚠해시로 뒤쪽 탭을 열면 그 탭도 상자 안으로 들어온다 — 패널만 열고 끝내지 않는다", () => {
  const doc = buildPage();
  const strip = deepTabStrip(doc);
  run(doc, { location: { search: "", href: "", hash: "#deep-target" } });
  assert.equal(
    doc.querySelectorAll('[data-panelgroup="deep"][data-panelkey="b"]')[0]!.hidden,
    false,
    "패널이 안 열렸다 — 이 시험은 스크롤을 재고 있지 않다",
  );
  assert.equal(strip.scrollLeft, 160, "패널은 열렸는데 그 탭이 상자 밖에 남았다");
});

test("⚠브라우저 찾기가 패널을 펼쳐도 같다 — 탭줄만 옛 자리에 남지 않는다", () => {
  const doc = buildPage();
  const strip = deepTabStrip(doc);
  run(doc, { storage: makeStorage() });
  assert.equal(strip.scrollLeft, 0, "아직 아무 일도 없어야 한다 — 첫 탭은 상자 안이다");
  doc.querySelectorAll('[data-panelgroup="deep"][data-panelkey="b"]')[0]!.fire("beforematch");
  assert.equal(strip.scrollLeft, 160, "찾기로 열린 탭이 상자 밖에 남았다");
});

test("⚠넘치지 않으면 아무것도 붙이지 않는다", () => {
  const doc = buildPage();
  const fits = scrollerCase(340, 353, 8, 90);
  doc.body.appendChild(fits);
  run(doc);
  assert.equal(fits.getAttribute("tabindex"), null, "넘치지도 않는데 탭 정지가 붙었다");
});

// ─── 최애 구단 ──────────────────────────────────────────────────────────
/**
 * ⚠**최애는 하나다.** 「내비의 가장 첫 자리」가 하나이기 때문이다.
 * 선수 즐겨찾기(`state.favs`)는 다른 개념이라 건드리지 않는다.
 *
 * ⚠**서버는 어느 화면에서나 「球団」을 그린다**(§0-1). 스크립트가 하는 일은
 * 라벨과 링크를 바꾸는 것뿐이고, JS 가 없으면 구단 목록으로 간다 — 길이 끊기지 않는다.
 */
function favTeamButton(): El {
  return make("button", {
    "data-favteam": "t",
    "data-favname": "阪神",
    /**
     * ⚠**경로를 클라이언트가 짓지 않는다**(M1). `teamPath()` 가 「한 곳에서만 만든다 —
     * 갈리면 어딘가는 404다」로 선언된 함수인데 클라이언트는 그 밖에 있다.
     * → **서버가 만든 값**을 버튼이 실어 온다(`teams-page.test.ts` 가 그 일치를 잰다).
     */
    "data-favpath": "teams/t.html",
    "aria-pressed": "false",
  });
}

/**
 * 내비 한 줄. `aria-current` 는 서버가 「이 문서」에만 적는다.
 *
 * ⚠**서버가 그리는 그대로 짓는다** — 라벨 `球団` 과 `teams.html` 링크가 여기 있어야 한다.
 * 클라이언트는 해제할 때 **서버가 그린 것을 되돌릴 뿐** 라벨을 스스로 짓지 않기 때문이다
 * (경로는 M1 이 `teamPath()` 로 못 박았고 라벨은 i18n 대상이다 · §7).
 * ⚠**이 픽스처가 실물과 어긋나면 시험은 실물을 재지 않는다.** 실물 쪽은
 * `layout.test.ts` 의 「내비 첫 항목이 球団이고 구단 목록으로 간다」가 따로 못 박는다.
 *
 * ⚠**표식의 「값」은 이 화면이 어느 구단의 상세인가다**(2026-08-19 검토 ④). 구단 상세도 구단 목록도
 * 서버가 같은 링크를 그리는데, 최애를 걸면 그 링크가 **최애 구단의 페이지**로 바뀐다 —
 * 「이 링크가 지금 문서인가」를 이 값 없이는 판정할 수 없다. 구단 상세가 아니면 빈 문자열이다.
 */
function navTeamLink(doc: ReturnType<typeof makeDocument>, current: string | null, team = ""): El {
  const nav = make("nav", { class: "tnav" });
  const attrs: Record<string, string> = { href: "../teams.html", "data-navteam": team };
  if (current !== null) attrs["aria-current"] = current;
  const a = make("a", attrs);
  a.textContent = "球団";
  nav.appendChild(a);
  doc.body.appendChild(nav);
  return a;
}

/** 서버가 그 자리에 실제로 쓰는 문장. ⚠**여기서 짓지 않는다** — `layout.ts` 의 `away()` 형식이다 */
const AWAY_NOTE = "（この年にはありません。2026年へ移動します）";

/**
 * **다른 시즌으로 보내는** 내비 한 줄 — 드래프트만 굽는 시즌(2005~2017)의 실물이다.
 *
 * ⚠⚠**픽스처가 실물과 어긋나면 시험은 실물을 재지 않는다.** 위 `navTeamLink` 는 평문
 * `球団` 만 만드는데, 그건 **같은 해 안에서 끝나는 화면**의 모양이다. 그 시즌에 없는 화면은
 * 서버가 두 가지를 더 그린다 — 보이는 표식(`<i aria-hidden>→</i>`)과 어디로 가는지 말하는
 * `aria-label`. **그 둘을 모델링하지 않아서 P1 이 시험을 그대로 통과했다**(2026-09-07).
 * 실물: `<a href="../teams.html" data-navteam aria-label="球団（…）">球団<i aria-hidden="true">→</i></a>`
 * ⚠**글자와 표식이 형제다** — `textContent` 하나로 되돌리면 표식이 평문으로 뭉개진다.
 */
function navTeamLinkAway(doc: ReturnType<typeof makeDocument>, team = ""): El {
  const nav = make("nav", { class: "tnav" });
  const a = make("a", {
    href: "../teams.html",
    "data-navteam": team,
    "aria-label": `球団${AWAY_NOTE}`,
  });
  a.appendChild(doc.createTextNode("球団"));
  const mark = make("i", { "aria-hidden": "true" });
  mark.textContent = "→";
  a.appendChild(mark);
  nav.appendChild(a);
  doc.body.appendChild(nav);
  return a;
}

/** 최애가 저장된 브라우저. 구단 목록 화면이 아니어도 내비는 그 값을 쓴다 */
function storedFav(code: string, name: string): Storage {
  const storage = makeStorage();
  storage.setItem(
    "npb-meikan-layout",
    JSON.stringify({ favTeam: { code, name, path: `teams/${code}.html` } }),
  );
  return storage;
}

/** 표식(`<i>`)이 **요소로** 남아 있는가. 평문 "→" 로 뭉개지면 스타일이 안 걸린다 */
function markKept(a: El): boolean {
  const i = a.querySelector("i");
  return i !== null && i.textContent === "→" && i.getAttribute("aria-hidden") === "true";
}

/** 구단 목록 화면의 최소 모양 — 내비 + 최애 버튼 */
function withNavAndFav(current: string | null = "page"): ReturnType<typeof makeDocument> {
  const doc = buildPage();
  navTeamLink(doc, current);
  doc.body.appendChild(favTeamButton());
  return doc;
}

/**
 * 구단 목록 **밖의** 화면 — 내비는 있고 최애 버튼은 없다.
 *
 * ⚠**이쪽이 거의 전부다.** 분모를 정확히 쓴다(작업규칙 7 · 2026-08-19 검토 ⑤에서 정정 —
 * 예전 주석은 「dist 15,443장 중 … 나머지 15,434장」이었는데 **15,443 은 assets/json 을 포함한
 * 전 파일 수**라 화면 수가 아니었다). 실측(9시즌 빌드 직후):
 * ```
 * dist 총 파일   15,443   (HTML 15,340 + assets/json 103)
 * 내비 보유      15,340   (전 HTML)
 * 최애 버튼 보유      9   (시즌당 1장 = 구단 목록)
 * → 버튼 없는 화면 15,331장
 * ```
 * 클라이언트가 구단 이름·경로를 **버튼에서만** 읽으면 그 15,331장에서 조용히 열화한다.
 */
function withNavOnly(): ReturnType<typeof makeDocument> {
  const doc = buildPage();
  navTeamLink(doc, null);
  return doc;
}

test("⚠최애를 지정하면 내비 첫 항목이 그 구단이 된다", () => {
  const doc = withNavAndFav();
  run(doc, { storage: makeStorage() });
  doc.querySelectorAll("[data-favteam]")[0]!.fire("click");
  const a = doc.querySelectorAll("[data-navteam]")[0]!;
  assert.match(a.getAttribute("href") ?? "", /teams\/t\.html$/);
  assert.equal(a.textContent, "阪神");
  assert.equal(doc.querySelectorAll("[data-favteam]")[0]!.getAttribute("aria-pressed"), "true");
});

test("⚠다시 누르면 해제되고 내비가 球団으로 돌아온다", () => {
  const doc = withNavAndFav();
  run(doc, { storage: makeStorage() });
  const btn = doc.querySelectorAll("[data-favteam]")[0]!;
  btn.fire("click");
  btn.fire("click");
  const a = doc.querySelectorAll("[data-navteam]")[0]!;
  assert.match(a.getAttribute("href") ?? "", /teams\.html$/);
  assert.equal(a.textContent, "球団");
  assert.equal(btn.getAttribute("aria-pressed"), "false");
});

test("최애는 이 브라우저에 남는다 — 다시 열어도 살아 있다", () => {
  const storage = makeStorage();
  const first = withNavAndFav();
  run(first, { storage });
  first.querySelectorAll("[data-favteam]")[0]!.fire("click");
  const second = withNavAndFav();
  run(second, { storage });
  assert.match(second.querySelectorAll("[data-navteam]")[0]!.getAttribute("href") ?? "", /teams\/t\.html$/);
  assert.equal(second.querySelectorAll("[data-favteam]")[0]!.getAttribute("aria-pressed"), "true");
});

/**
 * ⚠**여기가 이 기능의 진짜 시험이다.**
 *
 * 최애 버튼은 **구단 목록 화면에만** 있는데 내비는 **전 페이지**에 있다.
 * 이름을 버튼에서만 읽으면 다른 화면에서는 읽을 것이 없어 코드 대문자(「T」)로 떨어지고,
 * 경로도 만들 수 없다. **화면은 멀쩡히 그려지므로 눈으로는 안 잡힌다.**
 * → 지정할 때 이름과 경로를 함께 남긴다.
 */
test("⚠구단 목록 밖의 화면에서도 이름이 나온다 — 「T」로 떨어지지 않는다", () => {
  const storage = makeStorage();
  const list = withNavAndFav();
  run(list, { storage });
  list.querySelectorAll("[data-favteam]")[0]!.fire("click");

  const other = withNavOnly();
  run(other, { storage });
  const a = other.querySelectorAll("[data-navteam]")[0]!;
  assert.equal(a.textContent, "阪神", "최애 버튼이 없는 화면에서 내비 라벨이 코드로 떨어졌다");
  assert.match(a.getAttribute("href") ?? "", /teams\/t\.html$/);
});

/**
 * ⚠**「이 문서」라고 말하면 거짓말이 된다.**
 *
 * 구단 목록 화면에서 서버는 이 링크에 `aria-current="page"` 를 적는다 — 링크가 이 문서를
 * 가리키기 때문이다. 최애가 걸리면 링크는 **구단 페이지**로 가므로 그 말이 틀린다.
 * 같은 구획 안이라는 뜻의 `true` 로 낮춘다(구단 상세 화면이 이미 쓰는 값이다).
 */
test("⚠최애가 걸리면 내비는 「이 문서」가 아니다 — aria-current 를 낮춘다", () => {
  const doc = withNavAndFav("page");
  run(doc, { storage: makeStorage() });
  const a = doc.querySelectorAll("[data-navteam]")[0]!;
  assert.equal(a.getAttribute("aria-current"), "page", "서버가 적은 값이 지정 전에 이미 바뀌었다");
  const btn = doc.querySelectorAll("[data-favteam]")[0]!;
  btn.fire("click");
  assert.equal(a.getAttribute("aria-current"), "true");
  btn.fire("click");
  assert.equal(a.getAttribute("aria-current"), "page", "해제했는데 서버가 적은 값으로 안 돌아왔다");
});

/**
 * ⚠**최애는 하나다** — 「내비의 첫 자리」가 하나이기 때문이다.
 * 다른 구단을 누르면 **갈아타는** 것이지 늘어나는 것이 아니다(선수 즐겨찾기와 갈리는 지점).
 * 실제 화면에는 버튼이 12개 있는데 앞의 시험들은 하나짜리 픽스처라 이 규칙을 못 잰다.
 */
test("⚠다른 구단을 누르면 갈아탄다 — 최애가 둘이 되지 않는다", () => {
  const doc = buildPage();
  navTeamLink(doc, null);
  doc.body.appendChild(favTeamButton());
  doc.body.appendChild(
    make("button", {
      "data-favteam": "g",
      "data-favname": "巨人",
      "data-favpath": "teams/g.html",
      "aria-pressed": "false",
    }),
  );
  run(doc, { storage: makeStorage() });
  const [tigers, giants] = doc.querySelectorAll("[data-favteam]");
  tigers!.fire("click");
  giants!.fire("click");
  assert.equal(giants!.getAttribute("aria-pressed"), "true");
  assert.equal(tigers!.getAttribute("aria-pressed"), "false", "최애가 둘이 됐다");
  const a = doc.querySelectorAll("[data-navteam]")[0]!;
  assert.equal(a.textContent, "巨人");
  assert.match(a.getAttribute("href") ?? "", /teams\/g\.html$/);
});

/**
 * ⚠**저장값은 서버 데이터의 사본이다.**
 *
 * 약칭이 바뀌거나 경로 규칙이 바뀌면 사본만 옛 값을 들고 남는데, **그 사본은 이 브라우저에만
 * 있어 서버가 고칠 방법이 없다.** 경로가 낡으면 404 라도 나지만 **약칭이 낡으면 아무 일도 안 난다** —
 * 내비가 **틀린 구단 이름을 조용히** 보여준다. 이 저장소가 가장 싫어하는 모양이다.
 * ⚠**경로 규칙은 바뀔 예정이다** — Pages 파일 상한 때문에 파일 수를 줄이는 안이 대기 중이다
 * (CLAUDE.md §2-2 「2시즌만 더 넣으면 벽이다」).
 * → 정본이 눈앞에 있는 화면(구단 목록)에서 사본을 고친다.
 */
test("⚠구단 목록에 서면 낡은 사본을 고친다 — 틀린 이름을 조용히 들고 있지 않는다", () => {
  const storage = makeStorage();
  storage.setItem(
    "npb-meikan-layout",
    JSON.stringify({ favTeam: { code: "t", name: "旧タイガース", path: "old/t.html" } }),
  );
  const doc = withNavAndFav(null);
  run(doc, { storage });
  const a = doc.querySelectorAll("[data-navteam]")[0]!;
  assert.equal(a.textContent, "阪神", "눈앞의 정본으로 안 고쳤다");
  assert.match(a.getAttribute("href") ?? "", /teams\/t\.html$/);

  // ⚠**화면만 고치면 다음 화면에서 다시 낡은 값이 나온다** — 저장까지 갔는지 본다
  const other = withNavOnly();
  run(other, { storage });
  assert.equal(other.querySelectorAll("[data-navteam]")[0]!.textContent, "阪神", "사본이 안 고쳐졌다");
});

/**
 * ⚠**위 시험의 짝 — 「모르면 손대지 않는다」쪽이 시험 밖이었다**(2026-08-20 최종 검토 ②).
 *
 * `refreshFavTeam` 은 눈앞의 정본으로 낡은 사본을 고치는데, **정본을 못 읽었을 때는 손대지 않는다**
 * (`if(fresh===null…)return;`). 배포 전 HTML 을 캐시에 들고 있는 브라우저의 버튼에는
 * `data-favpath` 가 없어 `readFavTeam` 이 `null`(**모른다**)을 내기 때문이다 — 그 `null` 을
 * 「없다」로 쓰면 이미 지정해 둔 최애가 조용히 지워진다(M11).
 *
 * ⚠**그 가지를 1건도 안 재고 있었다.** 실측(2026-08-20 리뷰어): `fresh===null` 일 때
 * `state.favTeam = null` 로 바꿔도 **806/806 이 그대로 초록**이었다. 아래 클릭 경로 시험
 * (「경로를 모르는 버튼을 눌러도 …」)은 **저장이 `g` 인데 화면 버튼이 `t`** 라
 * `if(!b)return` 에서 빠져 이 가지를 한 번도 안 태운다.
 * → 여기서는 **저장과 버튼의 코드를 `t` 로 맞춰** 가지를 태우고, 그 버튼에서 `data-favpath` 만 뺀다.
 *
 * ⚠**낡은 이름이 그대로 남는 것이 정답이다.** 「그 구단이 사라졌다」와 「지금 이 화면에서 못 읽었다」를
 * 구별할 수 없으므로, 지우면 사용자 설정을 우리 추측으로 날리는 것이 된다.
 * ⚠**뮤테이션 확인(2026-08-20 실측 · 둘 다 이 한 본만 떨어진다)**:
 * ⑴ `fresh===null` 일 때 `state.favTeam=null` → `packages/web/test` **807본 중 FAIL 1 · ERROR 0**
 *    (라벨 단언이 잡는다: `球団` !== `旧タイガース`).
 * ⑵ 화면은 그대로 두고 **저장만** 지우는 판 → `client.test.ts` 108본 중 FAIL 1 · ERROR 0
 *    (아래 저장 단언이 잡는다 — 그래서 저장 단언은 라벨 단언의 중복이 아니다).
 */
test("⚠경로를 못 읽으면 최애를 손대지 않는다 — 「모른다」로 알던 것을 지우지 않는다(M11)", () => {
  const storage = makeStorage();
  storage.setItem(
    "npb-meikan-layout",
    JSON.stringify({ favTeam: { code: "t", name: "旧タイガース", path: "old/t.html" } }),
  );
  const doc = buildPage();
  navTeamLink(doc, null);
  // ⚠**저장과 같은 코드(`t`)의 버튼이다** — 그래야 `refreshFavTeam` 이 `if(!b)return` 에서 안 빠진다.
  //   그리고 **`data-favpath` 가 없다** — 배포 전 HTML 을 들고 있는 브라우저의 모양 그대로다
  doc.body.appendChild(make("button", { "data-favteam": "t", "data-favname": "阪神", "aria-pressed": "false" }));
  run(doc, { storage });

  const a = doc.querySelectorAll("[data-navteam]")[0]!;
  assert.equal(a.textContent, "旧タイガース", "못 읽은 정본이 알던 이름을 지웠다");
  assert.match(a.getAttribute("href") ?? "", /old\/t\.html$/, "못 읽은 정본이 알던 링크를 지웠다");

  // ⚠**저장까지 남아 있는지 본다** — 화면만 버텨도 다음 방문에 사라지면 같은 결함이다
  const saved = JSON.parse(storage.getItem("npb-meikan-layout") ?? "{}") as {
    favTeam?: { name?: string; path?: string } | null;
  };
  assert.equal(saved.favTeam?.name, "旧タイガース", "저장된 최애가 지워졌다");
  assert.equal(saved.favTeam?.path, "old/t.html", "저장된 경로가 지워졌다");
});

/**
 * ⚠**저장이 막힐 수 있다**(프라이빗 모드 등). 기존 `load`/`save`/`toggleFav` 와 같은 규칙 —
 * 저장은 조용히 실패하되 **이번 방문 동안의 화면은 돈다.**
 */
test("저장이 막혀도 최애 지정은 이번 방문 동안 동작한다", () => {
  const doc = withNavAndFav();
  run(doc, { storage: makeStorage(true) });
  doc.querySelectorAll("[data-favteam]")[0]!.fire("click");
  assert.equal(doc.querySelectorAll("[data-navteam]")[0]!.textContent, "阪神");
});

/**
 * ⚠**「모른다」가 「없음」을 뜻하게 두지 않는다**(M11).
 *
 * 배포 전 HTML 을 캐시에 들고 있는 브라우저의 버튼에는 `data-favpath` 가 없다 —
 * `readFavTeam` 은 그때 **`null`(모른다)**을 낸다. 그 `null` 이 그대로 `state.favTeam` 에 들어가면
 * **「미지정」과 같은 값**이 되어, 이미 지정해 둔 최애가 조용히 지워진다.
 * 실측(2026-08-19 검토 ②): fav=巨人 상태에서 `data-favpath` 없는 阪神 버튼을 누르면
 * 라벨이 `巨人 → 球団` 이 되고 저장이 `{"favTeam":null}` 이 됐다.
 *
 * ⚠**바로 위 `refreshFavTeam` 은 정반대로 짜여 있었다**(`if(fresh===null…)return;`) —
 * 같은 상황에 두 경로가 다른 규칙을 쓰고 있었다(M1). 「모르면 손대지 않는다」쪽이 옳다.
 */
test("⚠경로를 모르는 버튼을 눌러도 이미 지정된 최애를 지우지 않는다(M11)", () => {
  const storage = makeStorage();
  storage.setItem(
    "npb-meikan-layout",
    JSON.stringify({ favTeam: { code: "g", name: "巨人", path: "teams/g.html" } }),
  );
  const doc = buildPage();
  navTeamLink(doc, null);
  // ⚠**`data-favpath` 가 없다** — 배포 전 HTML 을 들고 있는 브라우저의 모양 그대로다
  doc.body.appendChild(make("button", { "data-favteam": "t", "data-favname": "阪神", "aria-pressed": "false" }));
  run(doc, { storage });

  const a = doc.querySelectorAll("[data-navteam]")[0]!;
  assert.equal(a.textContent, "巨人", "누르기 전부터 최애가 안 걸려 있다 — 이 시험은 아무것도 재고 있지 않다");
  doc.querySelectorAll("[data-favteam]")[0]!.fire("click");

  assert.equal(a.textContent, "巨人", "모른다는 값이 알던 것을 지웠다");
  assert.match(a.getAttribute("href") ?? "", /teams\/g\.html$/);
  const saved = JSON.parse(storage.getItem("npb-meikan-layout") ?? "{}") as { favTeam?: { name?: string } | null };
  assert.equal(saved.favTeam?.name, "巨人", "저장된 최애까지 지워졌다");
});

/**
 * ⚠**주석이 코드보다 강하게 말하고 있었다**(2026-08-19 검토 ③).
 *
 * `readFavTeam` 위에는 「**경로는 상대경로만 받는다.** 저장값이 상하거나 남이 심어도 이 링크가
 * 바깥으로 나가지 않는다」고 적혀 있는데, 실제 검사는 `indexOf(":")` 와 `charAt(0)==="/"` 둘뿐이라
 * **역슬래시와 선행 공백**이 빠져 있었다. 브라우저 URL 파서는 `\` 를 `/` 로 정규화하고 선행 공백을
 * 버리므로 둘 다 바깥 주소로 읽힌다(실측: BASE 가 빈 문자열인 화면이 dist 에 91장).
 *
 * ⚠악용에는 동일 출처 스크립트 실행이 필요해 실질 위험은 낮다 — 고치는 이유는
 * **주석이 참이 되게 하는 것**이다. 그래서 검사를 화이트리스트로 바꿨다.
 */
test("⚠최애 경로는 화이트리스트를 통과한 상대경로만이다 — 주석이 약속한 그대로", () => {
  // ⚠**먼저 통제군이다.** 이게 없으면 아래 다섯 입력은 「저장을 아예 안 읽는다」로도 전부 통과한다
  const ok = makeStorage();
  ok.setItem("npb-meikan-layout", JSON.stringify({ favTeam: { code: "t", name: "阪神", path: "teams/t.html" } }));
  const good = withNavOnly();
  run(good, { storage: ok });
  assert.equal(good.querySelectorAll("[data-navteam]")[0]!.textContent, "阪神", "멀쩡한 경로까지 막혔다");

  const bad = [
    "\\\\evil.example/x.html", // 역슬래시 둘 — 브라우저가 「//」 로 정규화한다
    " //evil.example/x.html", // 선행 공백 — 브라우저가 버린다
    "/evil", // 루트 절대경로(상대경로가 아니다)
    "/evil.html", // ⚠글자와 확장자만 보면 통과한다 — 선행 「/」 검사가 살아 있어야 막힌다
    ".html", // ⚠확장자만 남은 값 — 우리가 만드는 경로가 아니다(내비가 404 로 간다)
  ];
  for (const path of bad) {
    const storage = makeStorage();
    storage.setItem("npb-meikan-layout", JSON.stringify({ favTeam: { code: "t", name: "阪神", path } }));
    const doc = withNavOnly();
    run(doc, { storage });
    const a = doc.querySelectorAll("[data-navteam]")[0]!;
    assert.equal(a.getAttribute("href"), "../teams.html", `거부해야 할 경로가 링크가 됐다: ${JSON.stringify(path)}`);
    assert.equal(a.textContent, "球団", `경로는 막았는데 라벨만 바뀌었다: ${JSON.stringify(path)}`);
  }
});

/**
 * ⚠**구단 상세 화면에서 서버는 이 링크에 `aria-current="true"` 를 적는다**(실측 `dist/teams/t.html`).
 *
 * 서버가 적은 그 말은 **`teams.html` 로 가는 링크**에 대한 것이다. 최애가 걸리면 링크는
 * **최애 구단의 페이지**로 바뀌므로 다시 재야 한다:
 *
 * ```
 * 바뀐 목적지가 이 문서다(구단 상세 = 최애)      → page
 * 이 문서가 구단 목록이다(목록 → 그 안의 한 장)  → true
 * 그 밖(다른 구단의 상세)                        → 아무 말도 하지 않는다
 * ```
 *
 * 마지막 줄이 2026-08-19 검토 ④가 지적한 자리다. 巨人 페이지에서 라벨이 「阪神」인 링크에
 * `true` 가 남아 있으면 **현재 항목이 아닌 것을 현재라고 말하는 것**이 된다.
 */
function teamDetailWithFav(here: string, favCode: string, favName: string): ReturnType<typeof makeDocument> {
  const storage = storedFav(favCode, favName);
  const doc = buildPage();
  // 서버가 구단 상세에 그리는 그대로 — 구획 표시(`true`)와 **이 화면의 구단 코드**
  navTeamLink(doc, "true", here);
  run(doc, { storage });
  return doc;
}

test("⚠다른 구단의 상세에서는 「지금 여기」라고 말하지 않는다 — 링크가 딴 데를 가리킨다", () => {
  const doc = teamDetailWithFav("g", "t", "阪神");
  const a = doc.querySelectorAll("[data-navteam]")[0]!;
  assert.equal(a.textContent, "阪神", "최애가 안 걸렸다 — 이 시험은 aria-current 를 재고 있지 않다");
  assert.equal(a.getAttribute("aria-current"), null, "巨人 화면에서 「阪神」 링크를 현재 항목이라고 말한다");
});

test("⚠최애 구단의 상세에서는 「이 문서」다 — true 로 두면 덜 말하는 것이 된다", () => {
  const doc = teamDetailWithFav("t", "t", "阪神");
  const a = doc.querySelectorAll("[data-navteam]")[0]!;
  assert.equal(a.textContent, "阪神");
  assert.equal(a.getAttribute("aria-current"), "page");
});

// ── 다른 시즌으로 보내는 내비(드래프트만 굽는 2005~2017) ──────────────────
//
// ⚠**이 네 본이 재는 것은 「서버가 그린 것을 되돌릴 수 있는가」다.** 클라이언트는 라벨을
// 스스로 짓지 않는다 — 그런데 서버가 그리는 것이 **글자 하나에서 셋(글자·표식·이름)으로**
// 늘어난 것을 되돌리기 쪽이 따라가지 않았다(2026-09-07 이중 검토 P1).

test("⚠최애 미설정이어도 「→」 표식을 평문으로 뭉개지 않는다 — 되돌리기가 기본 경로다", () => {
  const doc = buildPage();
  const a = navTeamLinkAway(doc);
  run(doc, { storage: makeStorage() });
  assert.equal(a.textContent, "球団→", "글자가 사라졌다");
  assert.ok(markKept(a), "표식이 요소가 아니라 평문이 됐다 — .tnav a i 가 안 걸린다");
  assert.equal(a.getAttribute("aria-label"), `球団${AWAY_NOTE}`, "어디로 가는지 말하던 것이 사라졌다");
});

test("⚠최애를 걸어도 다른 해로 간다는 사실이 남는다 — 표식과 이름 둘 다", () => {
  const doc = buildPage();
  const a = navTeamLinkAway(doc);
  run(doc, { storage: storedFav("t", "阪神") });
  assert.equal(a.getAttribute("href"), "../teams/t.html");
  assert.ok(markKept(a), "최애를 걸었더니 표식이 사라졌다 — 조용히 해가 바뀐다");
  // ⚠**보이는 글자가 접근성 이름 안에 있어야 한다**(WCAG 2.5.3 label-in-name)
  assert.equal(a.getAttribute("aria-label"), `阪神${AWAY_NOTE}`);
});

test("⚠최애를 해제하면 서버가 그린 그대로 돌아온다 — 이름까지", () => {
  const doc = buildPage();
  const a = navTeamLinkAway(doc);
  doc.body.appendChild(favTeamButton());
  run(doc, { storage: makeStorage() });
  const btn = doc.querySelectorAll("[data-favteam]")[0]!;
  btn.fire("click");
  assert.equal(a.getAttribute("aria-label"), `阪神${AWAY_NOTE}`, "최애가 안 걸렸다 — 이 시험이 공회전한다");
  btn.fire("click");
  assert.equal(a.textContent, "球団→");
  assert.ok(markKept(a));
  assert.equal(a.getAttribute("aria-label"), `球団${AWAY_NOTE}`);
});

/**
 * ⚠**분모가 여기에 있다** — 표식도 이름도 없는 화면이 배포물의 거의 전부다:
 * **9,379장 / 9,392장**(2026-09-07 배포물 실측 · 표식이 붙는 것은 드래프트만 굽는 13장뿐).
 * 그쪽에 이름을 새로 붙이면 **전 페이지가 새 파일**이 되고, 그건 이 저장소가 이미 밟은 함정이다.
 */
test("⚠같은 해 안에서 끝나는 화면에는 이름을 붙이지 않는다 — 없던 것을 만들지 않는다", () => {
  const doc = withNavOnly();
  const a = doc.querySelectorAll("[data-navteam]")[0]!;
  run(doc, { storage: storedFav("t", "阪神") });
  assert.equal(a.textContent, "阪神");
  assert.equal(a.querySelector("i"), null, "없던 표식이 생겼다");
  assert.equal(a.getAttribute("aria-label"), null, "없던 이름이 생겼다 — 전 페이지가 새 파일이 된다");
});

// ── 순위표의 「全員」 + 최소 표본 ──────────────────────────────────────────

/**
 * ⚠**여기서 재는 것은 「입력이 실제로 행을 줄이는가」다** — 입력값이 아니라 **출력**이다.
 * 「그 코드가 있다」로 「그 코드가 효력이 있다」를 확인했다고 믿는 것이 이 저장소가
 * 두 번 데인 자리다(CLAUDE.md §2-2 의 합성 픽스처).
 *
 * ⚠**마크업의 일치는 `standings-page.test.ts` 의 「클라이언트가 읽는 갈고리」가 따로 본다.**
 * 여기 픽스처는 손으로 짓기 때문에, 서버가 내는 속성 이름이 바뀌어도 이 시험은 옛 이름을
 * 들고 초록으로 남는다 — 그러면 시험은 전부 통과하는데 실물은 아무것도 안 걸러진다.
 */
function rankingPanelDom(
  id: string,
  dens: readonly (number | null)[],
  /**
   * `more` 를 주면 「順位をもっと見る」 버튼을 단다.
   * ⚠**서버는 받을 것이 있을 때만 그린다** — 그래서 픽스처도 선택으로 둔다.
   */
  opts: { outs?: true; more?: true } = {},
): { doc: ReturnType<typeof makeDocument>; rows: El[] } {
  const doc = makeDocument("");
  const panel = make("div", { "data-panelgroup": "rankmetric", "data-panelkey": id });
  const bar = make("div", { class: "mfind rankonly" });
  bar.appendChild(make("button", { class: "tab", "data-rankonly": id, "aria-pressed": "true" }));
  const label = make("label", { class: "rankmin" });
  label.hidden = true;
  const input = make("input", { type: "text", "data-rankmin": id, value: "0", ...(opts.outs === true ? { "data-rankouts": "" } : {}) });
  label.appendChild(input);
  bar.appendChild(label);
  const count = make("span", { class: "count" });
  count.appendChild(make("span", { "data-rankcount": id }));
  bar.appendChild(count);
  panel.appendChild(bar);

  const bad = make("p", { class: "empty", "data-rankbad": id });
  bad.hidden = true;
  panel.appendChild(bad);

  const table = make("table");
  const tbody = make("tbody");
  const rows = dens.map((den, i) => {
    // ⚠**분모가 규정 이상이면 도달자**로 둔다 — 서버가 내는 것과 같은 관계여야 한다
    const qualified = den !== null && den >= 100;
    const tr = make("tr", { "data-qualified": qualified ? "1" : "0", ...(den === null ? {} : { "data-den": String(den) }) });
    tr.hidden = !qualified;
    const td = make("td");
    td.appendChild(make("b", { "data-rankq": "" }));
    const all = make("b", { "data-ranka": "" });
    all.hidden = true;
    td.appendChild(all);
    tr.appendChild(td);
    tr.appendChild(make("td", { class: "l" }, [make("a", { href: `players/p${i}.html` })]));
    tbody.appendChild(tr);
    return tr;
  });
  table.appendChild(tbody);
  panel.appendChild(table);

  const empty = make("p", { class: "empty", "data-rankempty": id });
  empty.hidden = true;
  panel.appendChild(empty);

  if (opts.more === true) {
    const more = make("button", { "data-rankmore": id, "data-rankrest": "rank/x.json", "aria-expanded": "false" });
    more.hidden = true;
    panel.appendChild(more);
  }

  doc.body.appendChild(panel);
  return { doc, rows };
}

const shown = (rows: readonly El[]): number => rows.filter((r) => !r.hidden).length;

function rankParts(doc: ReturnType<typeof makeDocument>, id: string) {
  return {
    btn: doc.querySelector(`[data-rankonly="${id}"]`)!,
    input: doc.querySelector(`[data-rankmin="${id}"]`)!,
    count: doc.querySelector(`[data-rankcount="${id}"]`)!,
    bad: doc.querySelector(`[data-rankbad="${id}"]`)!,
    empty: doc.querySelector(`[data-rankempty="${id}"]`)!,
  };
}

/** 규정 도달 3명(400·300·200打席) + 미달 3명(90·50·10打席) */
const DENS = [400, 300, 200, 90, 50, 10];

test("⚠최소 표본이 실제로 행을 줄인다 — 입력을 잰 게 아니라 출력을 잰다", () => {
  const { doc, rows } = rankingPanelDom("avg", DENS);
  run(doc);
  const { btn, input } = rankParts(doc, "avg");
  assert.equal(shown(rows), 3, "처음에는 규정 도달자만 보여야 한다");
  btn.fire("click");
  assert.equal(shown(rows), 6, "「全員」으로 바꿨는데 전원이 안 나온다");
  input.value = "100";
  input.fire("input");
  assert.equal(shown(rows), 3, "100打席 미만이 안 걸러졌다");
  input.value = "250";
  input.fire("input");
  assert.equal(shown(rows), 2, "250打席 미만이 안 걸러졌다");
});

test("⚠0이면 전원이다 — 되돌릴 수 없으면 그건 되돌릴 수 없는 필터다", () => {
  const { doc, rows } = rankingPanelDom("avg", DENS);
  run(doc);
  const { btn, input } = rankParts(doc, "avg");
  btn.fire("click");
  input.value = "250";
  input.fire("input");
  assert.equal(shown(rows), 2);
  input.value = "0";
  input.fire("input");
  assert.equal(shown(rows), 6, "0을 넣었는데 전원으로 안 돌아온다");
});

test("⚠개수 표시가 분모와 함께 움직인다 — 자른 결과를 말하지 않으면 M2 를 안 지킨 것이다", () => {
  const { doc } = rankingPanelDom("avg", DENS);
  run(doc);
  const { btn, input, count } = rankParts(doc, "avg");
  assert.equal(count.textContent, "3人");
  btn.fire("click");
  assert.equal(count.textContent, "6人");
  input.value = "250";
  input.fire("input");
  assert.equal(count.textContent, "2人", "거른 뒤의 인원을 말하지 않는다");
});

test("⚠「規定到達のみ」 동안에는 입력칸을 숨긴다 — 눌러도 아무 일이 없는 조작을 두지 않는다", () => {
  const { doc } = rankingPanelDom("avg", DENS);
  run(doc);
  const { btn, input } = rankParts(doc, "avg");
  assert.equal(input.parentNode!.hidden, true, "규정 도달자만 보는데 입력칸이 나와 있다");
  btn.fire("click");
  assert.equal(input.parentNode!.hidden, false, "「全員」인데 입력칸이 안 나온다");
  btn.fire("click");
  assert.equal(input.parentNode!.hidden, true, "규정으로 돌아왔는데 입력칸이 남아 있다");
});

test("⚠규정 도달자만 볼 때는 최소 표본을 걸지 않는다 — 숨긴 칸이 몰래 자르면 그게 최악이다", () => {
  const { doc, rows } = rankingPanelDom("avg", DENS);
  run(doc);
  const { btn, input } = rankParts(doc, "avg");
  btn.fire("click");
  input.value = "350";
  input.fire("input");
  assert.equal(shown(rows), 1);
  btn.fire("click");
  assert.equal(shown(rows), 3, "숨긴 입력칸이 규정 목록까지 자르고 있다");
});

test("⚠못 읽은 값은 조용히 0이 되지 않는다 — 안 먹었으면 그게 보여야 한다", () => {
  const { doc, rows } = rankingPanelDom("avg", DENS);
  run(doc);
  const { btn, input, bad } = rankParts(doc, "avg");
  btn.fire("click");
  input.value = "250";
  input.fire("input");
  assert.equal(bad.hidden, true, "정상값에 경고가 떴다");
  // ⚠**7자리는 못 읽는 값으로 본다** — NPB 의 어떤 분모도 그 자리에 닿지 않는다.
  //   막는 것이 아니라 **말한다**: 잠자코 0으로 바꾸면 친 값이 사라진 것을 알 수 없다
  for (const junk of ["-5", "あ", "3.5", "1e9", "1234567", "２５０"]) {
    input.value = junk;
    input.fire("input");
    assert.equal(bad.hidden, false, `「${junk}」를 잠자코 받았다`);
    assert.equal(input.getAttribute("aria-invalid"), "true", `「${junk}」가 낭독기에 정상으로 들린다`);
    assert.equal(shown(rows), 2, `「${junk}」로 걸러진 결과가 바뀌었다 — 직전 값이 그대로여야 한다`);
  }
  input.value = "0";
  input.fire("input");
  assert.equal(bad.hidden, true, "고쳤는데 경고가 남아 있다");
  assert.equal(input.getAttribute("aria-invalid"), "false");
});

/**
 * ⚠**칸을 비우는 것은 「못 읽은 값」이 아니라 「하한 없음」이다.**
 * 입력마다 판정하므로, 지우고 다시 치는 그 한순간을 오류로 부르면 **정상 조작 중에
 * 경고가 번쩍인다.** 게다가 결과가 화면에 그대로 보이므로(전원으로 돌아온다)
 * 조용히 삼키는 것과 구별된다.
 */
test("칸을 비우면 하한이 없어진다 — 지우고 다시 치는 도중에 경고가 번쩍이지 않는다", () => {
  const { doc, rows } = rankingPanelDom("avg", DENS);
  run(doc);
  const { btn, input, bad } = rankParts(doc, "avg");
  btn.fire("click");
  input.value = "250";
  input.fire("input");
  input.value = "";
  input.fire("input");
  assert.equal(bad.hidden, true, "칸을 비웠다고 오류라고 말한다");
  assert.equal(shown(rows), 6, "칸을 비웠는데 하한이 남아 있다");
});

test("⚠아무도 안 남으면 그렇다고 말한다 — 머리줄만 남은 표는 고장으로 읽힌다(M12)", () => {
  const { doc, rows } = rankingPanelDom("avg", DENS);
  run(doc);
  const { btn, input, empty, count } = rankParts(doc, "avg");
  btn.fire("click");
  assert.equal(empty.hidden, true);
  input.value = "9999";
  input.fire("input");
  assert.equal(shown(rows), 0);
  assert.equal(empty.hidden, false, "0건인데 빈 표만 남았다");
  assert.equal(count.textContent, "0人");
});

/**
 * ⚠**분모가 아웃 카운트인 패널**(방어율·WHIP)은 화면의 母数 칸이 `138.1回` 라는 야구 표기다.
 * 거기 보이는 수를 그대로 칠 수 있어야 하고, 50 을 **50아웃**으로 읽으면 3배로 자른다.
 */
test("⚠投球回는 이닝으로 받는다 — 50을 50아웃으로 읽으면 3배로 자른다", () => {
  // 415아웃(138.1回) · 300아웃(100回) · 150아웃(50回) · 90아웃(30回)
  const { doc, rows } = rankingPanelDom("era", [415, 300, 150, 90], { outs: true });
  run(doc);
  const { btn, input } = rankParts(doc, "era");
  btn.fire("click");
  input.value = "50";
  input.fire("input");
  assert.equal(shown(rows), 3, "50回 이상이 3명이 아니다 — 아웃으로 읽고 있다");
  input.value = "138.1";
  input.fire("input");
  assert.equal(shown(rows), 1, "138.1回 = 415아웃의 경계가 안 맞는다");
  input.value = "138.2";
  input.fire("input");
  assert.equal(shown(rows), 0, "138.2回 = 416아웃인데 415아웃이 남았다");
});

test("⚠이닝 표기에 3 이상의 소수는 없다 — 138.3 은 못 읽는 값이다", () => {
  const { doc } = rankingPanelDom("era", [415, 300], { outs: true });
  run(doc);
  const { btn, input, bad } = rankParts(doc, "era");
  btn.fire("click");
  input.value = "138.3";
  input.fire("input");
  assert.equal(bad.hidden, false, "있을 수 없는 이닝 표기를 잠자코 받았다");
});

test("⚠최소 표본이 저장된다 — 다시 열었을 때 사라지면 「저장된다」가 거짓이 된다", () => {
  const storage = makeStorage();
  const first = rankingPanelDom("avg", DENS);
  run(first.doc, { storage });
  const a = rankParts(first.doc, "avg");
  a.btn.fire("click");
  a.input.value = "250";
  a.input.fire("input");

  const second = rankingPanelDom("avg", DENS);
  run(second.doc, { storage });
  const b = rankParts(second.doc, "avg");
  assert.equal(shown(second.rows), 2, "다시 열었더니 최소 표본이 사라졌다");
  assert.equal(b.input.value, "250", "입력칸이 저장된 값을 안 보여준다");
});

/**
 * ⚠**같은 지표가 セ·パ 두 벌로 그려지고 상태는 한 벌이다**(`data-rankonly` 가 리그로
 * 갈라져 있지 않다 — 실측 2026-08-20 `dist/ranking.html`: `data-rankonly="avg"` 가 2건,
 * 투수 지표는 선발·구원까지 4건). 누른 쪽만 갱신하면 반대쪽 표가 저장된 상태와 어긋난 채
 * 남아, **새로고침해야 맞는 화면**이 된다.
 */
test("⚠같은 지표의 사본이 함께 움직인다 — 한쪽만 갱신하면 새로고침해야 맞는 화면이 된다", () => {
  const { doc, rows } = rankingPanelDom("avg", DENS);
  const second = make("div", { "data-panelgroup": "rankmetric", "data-panelkey": "avg2" });
  const twin = rankingPanelDom("avg", DENS);
  for (const c of [...twin.doc.body.children]) second.appendChild(c);
  doc.body.appendChild(second);
  run(doc);

  const both = doc.querySelectorAll('[data-rankonly="avg"]');
  assert.equal(both.length, 2, "사본이 둘이 아니다 — 이 시험이 공회전한다");
  both[0]!.fire("click");
  const inputs = doc.querySelectorAll('[data-rankmin="avg"]');
  inputs[0]!.value = "250";
  inputs[0]!.fire("input");

  const all = doc.querySelectorAll("tr");
  assert.equal(all.filter((r) => !r.hidden).length, 4, "사본 쪽 표가 따라오지 않았다");
  assert.equal(inputs[1]!.value, "250", "사본의 입력칸이 저장된 값을 안 보여준다");
});

/**
 * ⚠**못 읽은 입력의 상태가 사본 간에 어긋났다**(2026-08-21 최종 검토 P3).
 *
 * `bad` 는 사본마다 따로 있는데 **칸의 값은 다른 사본의 조작으로도 덮어써진다.**
 * A 에 「-5」를 친 채 B 의 버튼을 누르면 A 의 칸은 유효한 수로 돌아가는데
 * `aria-invalid="true"` 와 경고문만 A 에 남아 **「값은 정상인데 오류라고 말하는 칸」**이 된다.
 * ⚠**낭독기에는 그게 전부다** — 화면에서 눈으로 값을 보는 사람만 모순을 알아챌 수 있다.
 */
test("⚠못 읽은 입력을 사본 쪽 조작이 되돌려 놓으면 오류 표시도 같이 사라진다", () => {
  const { doc } = rankingPanelDom("avg", DENS);
  const second = make("div", { "data-panelgroup": "rankmetric", "data-panelkey": "avg2" });
  const twin = rankingPanelDom("avg", DENS);
  for (const c of [...twin.doc.body.children]) second.appendChild(c);
  doc.body.appendChild(second);
  run(doc);

  const btns = doc.querySelectorAll('[data-rankonly="avg"]');
  const inputs = doc.querySelectorAll('[data-rankmin="avg"]');
  const bads = doc.querySelectorAll('[data-rankbad="avg"]');
  assert.equal(btns.length, 2, "사본이 둘이 아니다 — 이 시험이 공회전한다");

  btns[0]!.fire("click"); // 「全員」으로
  inputs[0]!.value = "-5";
  inputs[0]!.fire("input");
  // 먼저 **못 읽었다고 말하는가**를 확인한다 — 아니면 아래가 아무것도 안 재는 것이다
  assert.equal(inputs[0]!.getAttribute("aria-invalid"), "true", "못 읽은 입력을 못 읽었다고 안 한다");
  assert.equal(bads[0]!.hidden, false, "못 읽은 입력인데 경고문이 안 나온다");

  // **사본 쪽**을 두 번 눌러 같은 표시 상태로 되돌린다(그 사이 A 의 칸은 유효값으로 덮어써진다)
  btns[1]!.fire("click");
  btns[1]!.fire("click");

  assert.equal(inputs[0]!.value, "0", "사본 조작이 A 의 칸을 안 되돌렸다 — 이 시험이 다른 것을 재고 있다");
  assert.equal(
    inputs[0]!.getAttribute("aria-invalid"),
    "false",
    "값은 정상으로 돌아갔는데 칸이 여전히 오류라고 말한다",
  );
  assert.equal(bads[0]!.hidden, true, "값은 정상으로 돌아갔는데 경고문이 남아 있다");
});

/**
 * **동결 스냅샷 주소 경고**(2026-08-30 사고).
 *
 * ⚠**사용자가 실제로 여기 걸렸다.** Cloudflare Pages 는 배포마다 불변 주소를 주는데
 * (`<hex8>.<project>.pages.dev`), 그것을 즐겨찾기에 넣으면 **영원히 그 날짜가 보인다.**
 * ⚠**고장으로 안 읽힌다** — 그 사본은 만들어질 당시엔 신선했으므로 띠가 **초록**이고
 * 「まで反映」이라고 말한다. **사람이 눈으로 구별할 방법이 없다.**
 * ⚠**서버가 못 잡는다** — 같은 파일이 두 주소로 나가므로 보는 쪽에서만 알 수 있다.
 */
function snapshotBar(hostname: string, pathname = "/players/1.html"): El | undefined {
  const doc = buildPage();
  run(doc, { location: { search: "", href: "", hostname, pathname } });
  return doc.querySelectorAll(".state.stale").find((el) => /スナップショット/.test(el.textContent));
}

test("⚠배포 해시 주소로 보고 있으면 화면이 그렇게 말한다 — 초록 띠로는 구별이 안 된다", () => {
  const bar = snapshotBar("b49f9aa2.bb-app-7mk.pages.dev");
  assert.notEqual(bar, undefined, "동결 사본인데 아무 말도 안 한다");
  const link = bar!.querySelectorAll("a")[0];
  assert.notEqual(link, undefined, "최신으로 가는 길을 안 준다 — 경고만 하면 사용자가 할 일이 없다");
  assert.equal(
    link!.getAttribute("href"),
    "https://bb-app-7mk.pages.dev/players/1.html",
    "정본 주소를 잘못 만들었다 — 첫 라벨만 떼야 한다",
  );
});

/**
 * ⚠**사용자가 밟은 순서 그대로다**(2026-08-31 보고):
 * 「規定到達のみ」를 풀고 → **펼치고** → 다시 「規定到達のみ」를 누르면,
 * **펼쳐 붙인 미달자 행이 순위를 단 채 아래에 남아 있었다.**
 *
 * ⚠**접었다가 누르면 정상이었다** — 그래서 「전환이 안 된다」가 아니라
 * **「전환이 붙인 행을 안 지운다」**가 결함이었다. 순서를 밟아야만 보이는 종류다.
 *
 * 원인: 전환은 `apply()` 만 부르는데 붙인 행을 지우는 것은 `drawRest()` 라 아무도 안 불렀다.
 * → **`apply()` 가 끝에서 항상 다시 그린다** — 모드 전환·하한 변경·펼치기가 한 경로로 모인다.
 */
test("⚠펼친 뒤 「規定到達のみ」로 돌아가면 붙인 행이 남지 않는다", async () => {
  const { doc, rows } = rankingPanelDom("avg", [400, 300, 200, 90, 50, 10], { more: true });
  const rest = [
    { r: 51, playerId: "x1", name: "미달1", t: "T", v: ".200", d: "20打席", den: 20, q: false },
    { r: 52, playerId: "x2", name: "미달2", t: "G", v: ".190", d: "15打席", den: 15, q: false },
  ];
  const requested: string[] = [];
  run(doc, { routes: { "rank/x.json": { avg: rest } }, requested });

  const { btn } = rankParts(doc, "avg");
  const more = doc.querySelector('[data-rankmore="avg"]')!;

  btn.fire("click"); // 「全員」으로
  assert.equal(more.hidden, false, "「全員」인데 펼치기 버튼이 안 보인다");
  more.fire("click"); // 펼친다
  await new Promise((r) => setTimeout(r, 20));
  assert.ok(requested.some((u) => u.includes("rank/x.json")), `파일을 안 받았다: ${requested.join(",")}`);
  const added = doc.querySelectorAll("[data-restrow]");
  assert.ok(added.length > 0, "펼쳤는데 행이 안 붙었다 — 이 시험이 공회전한다");

  btn.fire("click"); // 다시 「規定到達のみ」
  assert.deepEqual(
    doc.querySelectorAll("[data-restrow]").map((el) => el.textContent),
    [],
    "규정 모드로 돌아왔는데 펼친 행이 남아 있다",
  );
  // ⚠**규정 도달자만 보인다** — 남은 것이 없다는 것과 별개로 확인한다
  assert.equal(shown(rows), 3, "규정 도달자 3명만 보여야 한다");
});

test("⚠정본 주소에서는 아무 말도 안 한다 — 매일 뜨는 경고는 소음이 된다", () => {
  assert.equal(snapshotBar("bb-app-7mk.pages.dev"), undefined, "정본인데 경고가 뜬다");
});

/**
 * ⚠**hex8 이 아닌 것을 스냅샷으로 읽지 않는다.** 브랜치 별칭(`main.<project>.pages.dev`)과
 * 앞으로 붙을 커스텀 도메인은 **정본**이다. 여기서 잘못 물면 정상 화면에 매일 붉은 띠가 뜬다.
 */
test("⚠브랜치 별칭·커스텀 도메인은 스냅샷이 아니다", () => {
  assert.equal(snapshotBar("main.bb-app-7mk.pages.dev"), undefined, "브랜치 별칭에 경고가 뜬다");
  assert.equal(snapshotBar("basenine.example.com"), undefined, "커스텀 도메인에 경고가 뜬다");
  // ⚠**여덟 글자여야 한다** — 일곱이나 아홉은 Cloudflare 가 주는 모양이 아니다
  assert.equal(snapshotBar("b49f9aa.bb-app-7mk.pages.dev"), undefined, "7글자를 스냅샷으로 읽었다");
});

test("⚠주소를 모르면 아무 말도 안 한다 — 모르는 것으로 경고하지 않는다(M11)", () => {
  const doc = buildPage();
  run(doc, { location: { search: "", href: "" } });
  assert.equal(
    doc.querySelectorAll(".state.stale").find((el) => /スナップショット/.test(el.textContent)),
    undefined,
    "hostname 을 모르는데 경고했다",
  );
});
