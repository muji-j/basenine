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
import { readdirSync, readFileSync } from "node:fs";
import { CSS } from "../src/assets.ts";

const SRC = new URL("../src/", import.meta.url);

/**
 * ⚠**목록을 손으로 적지 않는다.** 적어 두면 두 가지가 조용히 무너진다 —
 * 없는 파일을 적어도(실제로 `day-page.ts` 가 그랬다) 아무도 모르고,
 * **새 화면을 추가하고 목록에 넣는 것을 잊으면 그 화면의 셀 클래스가 검사에서 빠진다.**
 * 그러면 원래 결함과 같은 종류의 버그를 이 시험이 놓치면서도 초록으로 통과한다.
 */
const SRC_FILES = readdirSync(SRC).filter((f) => f.endsWith(".ts"));

/**
 * 한 파일에서 셀의 `class` 속성에 나오는 클래스 이름을 줍는다.
 *
 * ⚠**정규식 하나로는 못 한다.** 실제 마크업에는 `class="${r.stale ? "bad" : "ok"}"` 처럼
 * **보간 안쪽에 따옴표가 중첩**되고 `${r.quarantine > 0 ? …}` 처럼 `>` 도 들어간다.
 * 통째로 버리면 그 칸의 클래스가 검사에서 사라지고, 대충 주우면 `stale` 같은 **변수 이름까지**
 * 클래스로 오해해 엉뚱한 규칙을 결함이라고 한다. 그래서 손으로 훑는다 —
 * 보간 **밖**의 맨 낱말과, 보간 **안**의 문자열 리터럴만 줍는다.
 */
function cellClassesIn(src: string): string[] {
  const out: string[] = [];
  const ok = (c: string): boolean => /^[a-zA-Z][\w-]*$/.test(c);
  for (const tag of src.matchAll(/<(td|th)\b/g)) {
    const at = src.indexOf('class="', tag.index);
    if (at === -1 || at - tag.index > 120) continue;
    let i = at + 7;
    let depth = 0;
    let plain = "";
    const inner: string[] = [];
    for (; i < src.length; i += 1) {
      const ch = src[i]!;
      if (depth === 0 && ch === '"') break;
      if (ch === "$" && src[i + 1] === "{") { depth += 1; i += 1; continue; }
      if (depth > 0) {
        if (ch === "}") { depth -= 1; continue; }
        // 보간 안쪽의 문자열 리터럴이 곧 클래스 이름이다
        if (ch === '"' || ch === "'") {
          const end = src.indexOf(ch, i + 1);
          if (end === -1) break;
          inner.push(src.slice(i + 1, end));
          i = end;
        }
        continue;
      }
      plain += ch;
    }
    for (const c of plain.split(/\s+/)) if (ok(c)) out.push(c);
    for (const lit of inner) for (const c of lit.split(/\s+/)) if (ok(c)) out.push(c);
  }
  return out;
}

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
    // ⚠읽기 실패를 삼키지 않는다 — 목록을 파일시스템에서 만들었으므로 실패는 진짜 이상이다
    const src = readFileSync(new URL(f, SRC), "utf8");
    for (const c of cellClassesIn(src)) out.add(c);
  }
  return out;
}

const CELL_CLASSES = cellClasses();

/**
 * 이 선택자가 테이블 셀을 가리키는가 — 요소 이름으로든, 셀에 붙는 클래스로든.
 *
 * ⚠**`:is()`·`:where()` 안쪽까지 본다.** `table :is(td,th){display:flex}` 는 겉보기에 클래스도
 * 요소도 아니라서 그냥 지나쳤다 — 결함을 숨기는 가장 쉬운 형태다.
 */
function hitsCell(sel: string): boolean {
  const last = (sel.trim().split(/[\s>+~]+/).pop() ?? "").trim();
  if (last === "") return false;
  // `:is(a,b)` / `:where(a,b)` 를 풀어 각 가지를 따로 본다
  const fn = /:(?:is|where|not|has)\(([^()]*)\)/g;
  for (const m of last.matchAll(fn)) {
    if ((m[1] ?? "").split(",").some((one) => hitsCell(one))) return true;
  }
  const bare = last.replace(fn, "");
  const el = /^([a-z]+)/.exec(bare)?.[1];
  if (el === "td" || el === "th") return true;
  return [...bare.matchAll(/\.([A-Za-z0-9_-]+)/g)].some((m) => CELL_CLASSES.has(m[1] ?? ""));
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
  assert.ok(SRC_FILES.length >= 15, `소스 파일을 ${SRC_FILES.length}개밖에 못 찾았다 — 목록이 비었다`);
  assert.ok(CELL_CLASSES.size >= 5, `셀 클래스를 ${CELL_CLASSES.size}개밖에 못 찾았다`);
  for (const must of ["tm", "l"]) {
    assert.ok(CELL_CLASSES.has(must), `셀 클래스 목록에 ${must} 가 없다`);
  }
});

test("⚠셀을 flex·grid 컨테이너로 만들지 않는다 — 그 열만 경계선이 어긋난다", () => {
  const bad = rules(CSS)
    .filter((r) => /display\s*:\s*(flex|grid|inline-flex|inline-grid)/.test(r.body))
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
    (r) => /position\s*:\s*sticky/.test(r.body) && /top\s*:\s*0/.test(r.body),
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
  const chip = rules(CSS).filter((r) => r.sel.split(",").some((one) => /\.tm\s*[>\s]\s*i$/.test(one.trim())));
  assert.ok(chip.length > 0, "칩 규칙을 찾지 못했다 — 이 시험이 공회전한다");
  for (const r of chip) {
    for (const one of r.sel.split(",")) {
      assert.ok(
        !/table\.|\.stand|\.iscore/.test(one),
        `칩 규칙이 특정 표에만 걸려 있다: ${one.trim()}`,
      );
    }
    assert.match(r.body, /display\s*:\s*inline-block/, "인라인 요소에 크기를 주려면 inline-block 이어야 한다");
  }
});

/**
 * ⚠**마크업 쪽도 함께 본다.** 규칙이 있어도 `<i>` 를 빠뜨리면 칩이 안 나온다.
 * 반대로 `<i>` 만 있고 `.tm` 이 없으면 빈 인라인 요소가 남는다.
 */
test("구단 색 칩을 쓰는 칸은 전부 .tm 과 <i> 를 함께 갖는다", () => {
  /**
   * ⚠**`pages.ts` 의 순위표는 이제 `.hteam` 을 쓴다**(2026-08-18 유저 요청으로 홈과 통합).
   * 두 화면이 같은 부품을 쓰게 되면서 그 표만 어법이 바뀌었다 —
   * 나머지 화면은 그대로 `.tm` 이므로 이 시험은 계속 뜻이 있다.
   */
  const files = ["game-page.ts", "pages.ts", "postseason-page.ts"];
  let found = 0;
  for (const f of files) {
    const src = readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8");
    for (const m of src.matchAll(/<(td|th)[^>]*class="[^"]*\btm\b[^"]*"[^>]*>(.{0,20})/g)) {
      found += 1;
      assert.ok((m[2] ?? "").startsWith("<i></i>"), `${f}: .tm 칸에 칩이 없다`);
    }
  }
  assert.ok(found >= 3, `칩을 쓰는 칸을 ${found}개밖에 못 찾았다 — 이 시험이 공회전한다`);
});

/**
 * ⚠**앵커가 고정 머리 아래로 숨지 않게 한다.** 깊은 링크로 들어오면 브라우저는 대상을
 * 화면 맨 위에 두는데, 그 자리는 topbar 가 덮고 있다 — 눌러서 왔는데 찾던 것이 안 보인다.
 */
test("앵커가 고정 머리 아래로 들어가지 않는다", () => {
  assert.match(CSS, /html\{scroll-padding-top:calc\(var\(--topbar\)/);
});

/**
 * ⚠**탭줄이 있는 화면은 여백이 한 겹 더 필요하다.**
 * 順位·타대회는 topbar 아래에 탭줄이 한 겹 더 sticky 로 얹힌다.
 * topbar 만 빼면 깊은 링크로 들어왔을 때 제목과 첫 줄이 그 탭줄 뒤로 가린 채 멈춘다 —
 * 「눌러서 왔는데 찾던 것이 안 보인다」가 정도만 줄어든 채 남는다.
 */
test("탭줄이 있는 화면은 그 높이만큼 여백을 더 준다", () => {
  assert.match(
    CSS,
    /html:has\(\.rail\)\{scroll-padding-top:calc\(var\(--topbar\) \+ var\(--rail\)/,
    "탭줄 높이가 스크롤 여백에 빠져 있다",
  );
  // ⚠계산이 쓰는 값과 실제 높이가 갈리면 여백이 틀린다 — .rail 이 그 높이를 보장해야 한다
  assert.match(CSS, /\.rail\{[^}]*min-height:var\(--rail\)/, ".rail 이 --rail 높이를 보장하지 않는다");
  assert.match(CSS, /--rail:\d+px/, "--rail 토큰이 없다");
});

/**
 * ⚠**가로·세로 양쪽으로 고정되는 칸은 첫 열의 머리 하나뿐이고, 그 칸이 제일 위여야 한다.**
 * 2026-08-16에 `thead th{z-index:2}` 를 넣으면서 이게 뒤집혔다 —
 * `.scroller th:first-child`(1) 가 특이도에서 이겨 **다른 머리 칸이 그 위를 지나갔다.**
 * 본문 첫 열은 멀쩡한데 그 열의 머리만 사라지므로 더 이상하게 보인다.
 */
test("⚠고정된 첫 열의 머리가 다른 머리 칸보다 위에 있다", () => {
  const z = (sel: string): number => {
    const r = rules(CSS).filter((x) => x.sel.split(",").some((one) => one.trim() === sel));
    const m = /z-index:\s*(-?\d+)/.exec(r.map((x) => x.body).join(";"));
    return m === null ? 0 : Number(m[1]);
  };
  const corner = z(".scroller thead th:first-child");
  const head = z("thead th");
  assert.ok(corner > head, `모서리 머리(${corner})가 다른 머리(${head})보다 아래다`);
});

test("⚠공백을 넣어 쓴 display 도 잡는다 — 검사를 우회할 수 있으면 검사가 아니다", () => {
  // 이 시험은 검사기 자체를 검사한다. 실제 CSS 가 아니라 가짜 문자열로 확인한다
  const fake = "td.x{display : flex}";
  const bad = rules(fake)
    .filter((r) => /display\s*:\s*(flex|grid|inline-flex|inline-grid)/.test(r.body))
    .filter((r) => r.sel.split(",").some((one) => hitsCell(one)));
  assert.equal(bad.length, 1, "공백이 든 display 를 놓쳤다");
});

test("⚠:is() 안쪽의 셀도 잡는다", () => {
  const fake = "table :is(td,th){display:flex}";
  const bad = rules(fake)
    .filter((r) => /display\s*:\s*(flex|grid)/.test(r.body))
    .filter((r) => r.sel.split(",").some((one) => hitsCell(one)));
  assert.equal(bad.length, 1, ":is() 안쪽의 셀을 놓쳤다");
});

test("동적 클래스가 든 칸의 리터럴 클래스도 모은다", () => {
  // `<td class="l ${x}">` 형태가 실제로 있다. 통째로 버리면 `l` 도 함께 사라진다
  assert.ok(CELL_CLASSES.has("ok") || CELL_CLASSES.has("bad") || CELL_CLASSES.has("sc"),
    "동적 클래스가 섞인 칸에서 아무 클래스도 못 건졌다");
});

/**
 * ⚠**이 시험은 예전에 정반대를 지키고 있었다**(2026-08-17 정정).
 *
 * 「머리가 상단 띠 뒤에 숨지 않게 top:var(--topbar) 를 걸어야 한다」고 못 박고 있었는데,
 * **그 규칙이 유저가 본 「각종 표에서 헤더가 내용 중간에 끼거나 겹친다」의 원인**이었다.
 *
 * 전제가 틀렸다: 우리 표는 전부 스크롤 상자 안이라 머리가 **화면에 붙은 적이 없다.**
 * 붙지도 않으면서 상자 안에서 46px(탭줄이 있으면 94px) 아래로 밀리기만 했다.
 * 그러니 「상단 띠 뒤로 숨는다」는 걱정 자체가 이 구조에서는 성립하지 않았다.
 *
 * ⚠**틀린 믿음을 지키는 시험은 결함을 굳힌다.** 이 시험이 초록인 동안 그 CSS 는 고쳐질 수 없었다.
 */
test("표 머리는 sticky 지만 세로 오프셋은 없다 — 가로 고정과 쌓임 순서만 여기서 나온다", () => {
  const head = rules(CSS).find((r) => r.sel.split(",").some((one) => one.trim() === "thead th"));
  assert.notEqual(head, undefined, "thead th 규칙을 못 찾았다 — 이 시험이 공회전한다");
  // 첫 열 머리의 가로 고정(`left:0`)과 배경·쌓임이 여기서 나온다 — sticky 를 지우면 그것들이 죽는다
  assert.match(head!.body, /position\s*:\s*sticky/, "thead th 의 sticky 가 사라졌다");
  assert.match(head!.body, /background/, "머리에 배경이 없으면 가로로 밀 때 아래 글자가 비쳐 보인다");
  assert.match(CSS, /\.scroller thead th:first-child\{[^}]*z-index\s*:\s*3/, "모서리 칸이 제일 위가 아니다");
  // ⚠예전 규칙이 되살아나지 않았는지 이름으로도 확인한다
  assert.ok(
    !/html:has\(\.rail\) thead th\{[^}]*top/.test(CSS),
    "탭줄 화면용 top 오프셋이 되살아났다 — 머리가 표 안으로 94px 내려앉는다",
  );
});

/**
 * ⚠**로고를 금지했으므로 이 9×9 사각형이 유일한 팀 식별 그래픽이다.**
 * 그런데 배경 대비가 24조합 중 11개에서 3:1 미만이다(阪神 1.54 · 다크의 オリックス 1.17).
 * 테두리 하나면 어느 테마에서도 보인다.
 */
test("⚠구단 색 칩에 테두리가 있다 — 배경에 묻히는 팀이 24조합 중 11개다", () => {
  const chip = rules(CSS).filter((r) => r.sel.split(",").some((one) => /\.tm\s*[>\s]\s*i$/.test(one.trim())));
  assert.ok(chip.length > 0, "칩 규칙을 못 찾았다");
  for (const r of chip) {
    assert.match(r.body, /box-shadow[^;]*var\(--tx-2\)/, "칩이 배경에 묻힐 수 있다 — 테두리가 없다");
  }
});

/**
 * 두 색의 대비비(WCAG 2.x 상대휘도). ⚠**본문은 4.5:1 이상이어야 한다.**
 */
function contrast(a: string, b: string): number {
  const lum = (hex: string): number => {
    const n = hex.replace("#", "");
    const ch = [0, 2, 4].map((i) => Number.parseInt(n.slice(i, i + 2), 16) / 255);
    const lin = ch.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * lin[0]! + 0.7152 * lin[1]! + 0.0722 * lin[2]!;
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x! + 0.05) / (y! + 0.05);
}

/**
 * 토큰 값을 CSS에서 꺼낸다 — 코드가 실제로 쓰는 값을 재야 의미가 있다.
 *
 * ⚠**다크 값은 두 곳에 있다.** `:root[data-theme="dark"]`(토글)와
 * `@media (prefers-color-scheme: dark)`(OS 설정)에 **같은 값이 중복**으로 적혀 있다.
 * 한쪽만 보면 다른 쪽이 옛 색으로 남아도 시험이 통과한다 — **둘 다 꺼내 비교한다.**
 */
function darkBlocks(): string[] {
  const a = /:root\[data-theme="dark"\]\s*\{([\s\S]*?)\}/.exec(CSS)?.[1] ?? "";
  const b = /:root:not\(\[data-theme="light"\]\)\s*\{([\s\S]*?)\}/.exec(CSS)?.[1] ?? "";
  return [a, b];
}

function token(name: string, dark = false): string {
  const block = dark ? darkBlocks()[0] ?? "" : /:root \{([\s\S]*?)\}/.exec(CSS)?.[1] ?? "";
  return new RegExp(`${name}:(#[0-9a-fA-F]{6})`).exec(block)?.[1] ?? "";
}

/**
 * ⚠**M2가 요구하는 바로 그 정보가 화면에서 가장 안 읽혔다.**
 * `--tx-3` 이 붙는 것은 **분모**(`.den`) · **자격 기준과 표본 경고**(`.note`) · 규정 미달 행이다.
 * 실측(2026-08-16): 라이트 3.20:1 · 다크 4.20:1 로 본문 기준 4.5:1 에 미달했고,
 * 구단 페이지는 표의 86%가 그 색이었다.
 */
test("⚠분모와 주석이 읽히는 대비로 그려진다(4.5:1)", () => {
  for (const dark of [false, true]) {
    const page = token("--page", dark);
    const panel = token("--panel-2", dark);
    const tx3 = token("--tx-3", dark);
    assert.ok(page !== "" && panel !== "" && tx3 !== "", `토큰을 못 읽었다(dark=${dark})`);
    assert.ok(
      contrast(tx3, page) >= 4.5,
      `${dark ? "다크" : "라이트"} 본문 위 대비 ${contrast(tx3, page).toFixed(2)}:1`,
    );
    assert.ok(
      contrast(tx3, panel) >= 4.5,
      `${dark ? "다크" : "라이트"} 패널 위 대비 ${contrast(tx3, panel).toFixed(2)}:1`,
    );
  }
});

/**
 * ⚠**「얇음」을 대비 강등으로 말하지 않는다.** 그러면 규정 미달 행 전체가 읽기 어려워진다 —
 * 구단 페이지 76행 중 65행(86%)이 그 상태였다. 다른 채널로 말한다.
 */
test("규정 미달 행을 색만으로 구별하지 않는다", () => {
  const thin = rules(CSS).filter((r) => r.sel.split(",").some((one) => one.trim().startsWith("tr.thin")));
  assert.ok(thin.length >= 2, "얇은 행 규칙이 색 하나뿐이다 — 다른 채널이 없다");
  assert.ok(
    thin.some((r) => /box-shadow|border|outline|font-style/.test(r.body)),
    "색 말고 다른 채널로 얇음을 말하지 않는다",
  );
});

/**
 * ⚠**다크 값이 두 곳에 중복으로 적혀 있다.** 토글용(`[data-theme="dark"]`)과
 * OS 설정용(`prefers-color-scheme`)이다. 한쪽만 고치면 **OS 다크 사용자는 옛 색을 계속 본다** —
 * 그리고 위의 대비 시험은 그걸 못 잡는다(한 블록만 읽으므로).
 */
test("⚠다크 토큰이 두 곳에서 같은 값이다 — 한쪽만 고치면 절반이 옛 색을 본다", () => {
  const [toggle, media] = darkBlocks();
  assert.ok((toggle ?? "") !== "" && (media ?? "") !== "", "다크 블록을 못 찾았다 — 이 시험이 공회전한다");
  const pick = (b: string, n: string): string => new RegExp(`${n}:(#[0-9a-fA-F]{6})`).exec(b)?.[1] ?? "";
  for (const n of ["--page", "--tx", "--tx-2", "--tx-3", "--panel", "--panel-2", "--hair", "--hair-2"]) {
    assert.equal(pick(toggle ?? "", n), pick(media ?? "", n), `${n} 가 두 다크 블록에서 다르다`);
  }
});

/**
 * ⚠**태그를 바꿨으면 선택자도 따라가야 한다.**
 * 헤딩 순서를 고치며 `h3`→`h2`, `h5`→`h3` 로 올렸는데 CSS가 옛 태그를 가리키면
 * 그 제목만 **브라우저 기본 크기**로 튄다 — 값이 아니라 형태가 조용히 무너진다.
 * ⚠**크기를 태그 기본값에 맡기지 않는다.** `.subhead` 는 font-size 가 없어
 * h5(0.83em) → h3(1.17em) 로 **41% 커졌다.**
 */
test("⚠태그를 올린 곳의 CSS가 따라왔다 — 기본 크기로 튀지 않는다", () => {
  const sel = (x: string): { sel: string; body: string } | undefined =>
    rules(CSS).find((r) => r.sel.split(",").some((one) => one.trim() === x));

  assert.notEqual(sel(".editor h2"), undefined, "편집 패널 제목이 h2 인데 규칙은 h3 를 가리킨다");
  assert.equal(sel(".editor h3"), undefined, "쓰이지 않는 h3 규칙이 남아 있다");

  const sub = sel(".rolecol .subhead");
  assert.notEqual(sub, undefined, ".subhead 규칙을 못 찾았다");
  assert.match(sub!.body, /font-size:\s*\d/, "크기를 태그 기본값에 맡기고 있다");
});

/**
 * ⚠**새로 낸 요소에 규칙이 없으면 body 기본값으로 그려진다.**
 * 명부의 성적 줄(실측 1,397칸)이 규칙 없이 나가 **선수 이름보다 크고 진해졌다.**
 * 검색 드롭다운의 `.qhits .hs` 는 그쪽 전용이라 여기 안 걸린다.
 */
test("⚠명부의 성적 줄에 규칙이 있다 — 없으면 이름보다 커진다", () => {
  const r = rules(CSS).filter((x) => x.sel.split(",").some((one) => /\.roster\s+\.hs$/.test(one.trim())));
  assert.ok(r.length > 0, "명부 성적 줄의 규칙이 없다 — body 기본 16px 로 그려진다");
  assert.match(r[0]!.body, /font-size:\s*\d/, "크기가 없다");
  assert.match(r[0]!.body, /color:\s*var\(--tx/, "색이 없다");
});

/**
 * ⚠**스크롤 상자 안의 머리 칸에 세로 오프셋(top)을 주면 머리가 표 안으로 내려앉는다.**
 *
 * 2026-08-16 에 `thead th{position:sticky;top:var(--topbar)}` 를 넣었고, 그것이
 * 유저가 본 **「각종 표에서 헤더가 내용 중간에 끼거나 겹친다」**의 원인이었다(2026-08-17).
 *
 * 원리: 우리 표는 전부 `.scroller` 안에 있고 `.scroller` 는 `overflow-x:auto` 다.
 * 한 축이 `visible` 이 아니면 **다른 축도 `auto` 로 계산**되어 `.scroller` 가 세로로도
 * 스크롤 컨테이너가 된다. `sticky` 의 기준은 화면이 아니라 **가장 가까운 스크롤 컨테이너**이므로
 * 머리는 화면에 붙지 못하고, 대신 그 상자 위에서 `top` 만큼 **아래로 밀려** 본문을 덮는다.
 *
 * ⚠**「눈으로만 보이는」 결함이다** — 타입·값·링크 검사 어느 것도 못 잡았고,
 * 사이트를 직접 본 사람이 잡았다. 그래서 CSS 를 글자로 읽어 막는다.
 */
test("⚠표 머리에 세로 sticky 오프셋을 주지 않는다 — 주면 머리가 표 안으로 내려앉는다", () => {
  /** `thead th` 를 선택자로 갖는 규칙들의 선언부를 전부 모은다 */
  const blocks = [...CSS.matchAll(/([^{}]*thead[^{}]*th[^{}]*)\{([^}]*)\}/g)];
  assert.ok(blocks.length > 0, "thead th 규칙을 하나도 못 찾았다 — 이 검사가 대상을 놓치고 있다");

  const offenders = blocks
    .map(([, sel, body]) => ({ sel: sel!.trim(), body: body!.trim() }))
    // `top:auto` 는 무효화이므로 문제가 아니다
    .filter((r) => /(^|;)\s*top\s*:\s*(?!auto\b)[^;]+/.test(r.body));

  assert.deepEqual(
    offenders.map((r) => `${r.sel} { ${r.body} }`),
    [],
    "표 머리에 top 이 걸려 있다. 우리 표는 전부 .scroller(overflow-x:auto) 안이라 " +
      "이 값은 머리를 화면에 붙이지 못하고 표 안으로 밀어 넣기만 한다",
  );
});

/**
 * ⚠**위 검사가 성립하는 전제를 함께 고정한다.**
 * 「표가 전부 스크롤 상자 안에 있다」가 깨지면 위 결론(top 이 무해하지 않다)도 달라진다 —
 * 전제가 조용히 바뀌는 것을 막는다. 실측(2026-08-17): 검사한 121개 표가 121/121 `.scroller` 안.
 */
test("표를 감싸는 상자가 여전히 가로 스크롤 컨테이너다 — 위 검사의 전제", () => {
  const m = /\.scroller\{([^}]*)\}/.exec(CSS);
  assert.notEqual(m, null, ".scroller 규칙이 없다");
  assert.match(m![1]!, /overflow-x\s*:\s*auto/, ".scroller 가 더는 가로 스크롤 상자가 아니다");
});

