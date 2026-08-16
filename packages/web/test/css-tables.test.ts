/**
 * 표의 정렬을 깨는 CSS를 막는다.
 *
 * ⚠**이 결함은 눈으로만 보인다.** 타입도 시험도 못 잡고, 링크 검사도 못 잡는다 —
 * 값은 맞고 마크업도 맞는데 **한 열만 선이 어긋난다.**
 * 실제로 순위표의 球団 열이 그 상태였다(2026-08-16 유저 지적).
 * 원인은 `td{display:flex}` 였다 — 셀을 flex 컨테이너로 만들면 그 칸이 테이블 셀 박스에서
 * 빠져나와 아래 경계선이 다른 칸과 다른 자리에 그려진다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CSS } from "../src/assets.ts";

const SRC = new URL("../src/", import.meta.url);
const SRC_FILES = [
  "assets.ts", "pages.ts", "player-page.ts", "team-page.ts", "postseason-page.ts",
  "game-page.ts", "day-page.ts", "compare.ts", "today-page.ts", "log-page.ts", "parts.ts",
];

/**
 * 마크업에서 **셀에 실제로 붙는 클래스**를 모은다.
 *
 * ⚠**이것이 이 시험의 핵심이다.** 처음엔 선택자가 `td`/`th` 로 끝나는지만 봤는데,
 * 실제 결함은 `table.stand .tm{display:flex}` 였다 — 마지막 조각이 클래스라 **그냥 지나쳤다.**
 * 클래스가 어디에 붙는지는 CSS만 봐서는 알 수 없으므로 마크업에서 가져온다.
 */
function cellClasses(): Set<string> {
  const out = new Set<string>();
  for (const f of SRC_FILES) {
    let src: string;
    try {
      src = readFileSync(new URL(f, SRC), "utf8");
    } catch {
      continue;
    }
    for (const m of src.matchAll(/<(td|th)[^>]*\sclass="([^"$]*)"/g)) {
      for (const c of (m[2] ?? "").split(/\s+/)) if (c !== "") out.add(c);
    }
  }
  return out;
}

const CELL_CLASSES = cellClasses();

/** 이 선택자가 테이블 셀을 가리키는가 — 요소 이름으로든, 셀에 붙는 클래스로든 */
function hitsCell(sel: string): boolean {
  const last = (sel.trim().split(/[\s>+~]+/).pop() ?? "").trim();
  if (last === "") return false;
  const el = /^([a-z]+)/.exec(last)?.[1];
  if (el === "td" || el === "th") return true;
  return [...last.matchAll(/\.([A-Za-z0-9_-]+)/g)].some((m) => CELL_CLASSES.has(m[1] ?? ""));
}

/** `선택자{본문}` 를 늘어놓는다. 미디어쿼리 안쪽도 같이 걸린다 */
function rules(css: string): { sel: string; body: string }[] {
  const out: { sel: string; body: string }[] = [];
  // ⚠**주석을 먼저 걷어낸다.** 안 걷으면 주석이 선택자로 읽혀 이 시험이 헛것을 잡는다
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, " ");
  for (const m of bare.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    out.push({ sel: (m[1] ?? "").trim(), body: m[2] ?? "" });
  }
  return out;
}

test("셀에 붙는 클래스를 마크업에서 실제로 찾아낸다 — 못 찾으면 위 시험이 공회전한다", () => {
  assert.ok(CELL_CLASSES.size >= 5, `셀 클래스를 ${CELL_CLASSES.size}개밖에 못 찾았다`);
  for (const must of ["tm", "l"]) {
    assert.ok(CELL_CLASSES.has(must), `셀 클래스 목록에 ${must} 가 없다`);
  }
});

test("⚠셀을 flex·grid 컨테이너로 만들지 않는다 — 그 열만 경계선이 어긋난다", () => {
  const bad = rules(CSS)
    .filter((r) => /display:\s*(flex|grid|inline-flex|inline-grid)/.test(r.body))
    .filter((r) => r.sel.split(",").some((one) => hitsCell(one)));
  assert.deepEqual(
    bad.map((r) => r.sel),
    [],
    "셀에 display:flex/grid 가 걸렸다 — 그 칸이 테이블 셀 박스에서 빠져나온다",
  );
});

/**
 * ⚠**머리 고정은 `thead` 에만.** 전체 `th` 에 걸면 tbody 의 행 머리까지 화면 위에 붙어
 * 자기 행을 떠난다. 사이트에서 `scope="row"` 를 쓰는 표는 이닝 스코어 하나뿐이고,
 * 거기서 구단명 칸이 그 상태였다.
 */
test("⚠머리 고정은 thead 에만 걸린다 — 행 머리가 자기 행을 떠나지 않는다", () => {
  const sticky = rules(CSS).filter(
    (r) => /position:\s*sticky/.test(r.body) && /top:\s*0/.test(r.body),
  );
  const loose = sticky.filter((r) =>
    r.sel.split(",").some((one) => {
      const t = one.trim();
      return /(^|[\s>])th\b/.test(t) && !t.includes("thead");
    }),
  );
  assert.deepEqual(loose.map((r) => r.sel), [], "thead 밖의 th 까지 화면 위에 고정된다");
});

/**
 * ⚠**칩을 쓰는 화면이 넷인데 규칙이 두 표 안에만 있었다.**
 * `<i>` 는 인라인이라 width/height 가 먹지 않는다 — ポストシーズン 표에서는
 * 구단 색 칩이 **아예 그려지지 않았다.** 값이 틀린 것이 아니라 보이지 않는 결함이다.
 */
test("⚠구단 색 칩 규칙은 표를 가리지 않는다 — 한 벌이 전부를 덮는다", () => {
  const chip = rules(CSS).filter((r) => r.sel.split(",").some((one) => /\.tm\s+i$/.test(one.trim())));
  assert.ok(chip.length > 0, "칩 규칙을 찾지 못했다 — 이 시험이 공회전한다");
  for (const r of chip) {
    for (const one of r.sel.split(",")) {
      assert.ok(
        !/table\.|\.stand|\.iscore/.test(one),
        `칩 규칙이 특정 표에만 걸려 있다: ${one.trim()}`,
      );
    }
    assert.match(r.body, /display:\s*inline-block/, "인라인 요소에 크기를 주려면 inline-block 이어야 한다");
  }
});

/**
 * ⚠**마크업 쪽도 함께 본다.** 규칙이 있어도 `<i>` 를 빠뜨리면 칩이 안 나온다.
 * 반대로 `<i>` 만 있고 `.tm` 이 없으면 빈 인라인 요소가 남는다.
 */
test("구단 색 칩을 쓰는 칸은 전부 .tm 과 <i> 를 함께 갖는다", () => {
  const files = ["game-page.ts", "pages.ts", "postseason-page.ts"];
  let found = 0;
  for (const f of files) {
    const src = readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8");
    for (const m of src.matchAll(/<(td|th)[^>]*class="[^"]*\btm\b[^"]*"[^>]*>(.{0,20})/g)) {
      found += 1;
      assert.ok((m[2] ?? "").startsWith("<i></i>"), `${f}: .tm 칸에 칩이 없다`);
    }
  }
  assert.ok(found >= 4, `칩을 쓰는 칸을 ${found}개밖에 못 찾았다 — 이 시험이 공회전한다`);
});

/**
 * ⚠**앵커가 고정 머리 아래로 숨지 않게 한다.** 깊은 링크로 들어오면 브라우저는 대상을
 * 화면 맨 위에 두는데, 그 자리는 topbar 가 덮고 있다 — 눌러서 왔는데 찾던 것이 안 보인다.
 */
test("앵커가 고정 머리 아래로 들어가지 않는다", () => {
  assert.match(CSS, /html\{scroll-padding-top:calc\(var\(--topbar\)/);
});
