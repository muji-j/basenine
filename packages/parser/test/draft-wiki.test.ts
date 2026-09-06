/**
 * ja.wikipedia 드래프트 그리드 파서 — **실물 픽스처로만** 검증한다.
 *
 * ⚠**합성 픽스처로 검증하지 마라.** 이 저장소는 이미 데였다 — npb 구형 박스의 합성 픽스처에
 * **타석 결과 칸이 0개**여서 그 경로가 항상 빈 배열이어도 시험이 전부 초록이었다
 * (`fixtures/README.md`). 여기 픽스처는 **2026-09-06 에 실제로 받은 바이트 그대로**이고
 * `data/archive/wikipedia/draft/{year}.html.gz` 와 같은 파일이다.
 *
 * ⚠**「모양이 이럴 것이다」를 시험하지 않는다.** 각 본이 고정하는 것은 **규칙표가 실측한 사실**이고,
 * 픽스처는 그 사실이 실린 해를 고른 것이다(아래 표).
 *
 * | 픽스처 | 무엇을 못으로 박는가 |
 * |---|---|
 * | 2005 | P군 · `1巡目1`/`1巡目2→`/`希望枠` · 배너가 머리행 **위** · 구획 3개 |
 * | 2006 | P군 · 원문자 아닌 `1位①` · **`不合意` 표식**(배경색 없는 `normal` 의 반례) |
 * | 2007 | P군 · **`rowspan="5"` `指名権剥奪`** · 절 id `指名選手一覧（指名順表記）` · 추첨 구획 2개 |
 * | 2008 | Q군 · **`支配下` 배너가 없다**(배너 전 데이터 행) |
 * | 2010 | R군 · **셀 안의 HTML 주석**(`<!--横-->`) — 안 지우면 선수명에 붙는다 |
 * | 2013 | R군 · 원문자 `1巡目①` · **같은 색이 다른 행에서 재사용**된다 |
 * | 2019 | R군 · **CSS 에 `normal;` 와 `normal` 이 공존**한다 |
 * | 2023 | R군 · **목표 시즌** · `#ccf` 색 재사용 |
 * | 2024 | S군 · **배너가 머리행 위** · 첫 칸 `指名順` · `<br>` 이름 · `(存在しないページ)` 표제 |
 * | 2025 | S군 · **목표 시즌** |
 * | 2026 | **표가 없다** — 실패가 아니라 `no-grid`(M11) |
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import {
  DRAFT_WIKI_SECTION_IDS,
  DraftWikiParseError,
  checkDraftWikiInvariants,
  draftWikiUrl,
  parseDraftWiki,
} from "../src/draft-wiki.ts";
import type { DraftWikiParse } from "../src/draft-wiki.ts";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

/** 커밋된 픽스처가 있는 해. ⚠**분모다** — 「전부 통과」 대신 이 수로 말한다 */
const YEARS = [2005, 2006, 2007, 2008, 2010, 2013, 2019, 2023, 2024, 2025, 2026] as const;

function html(year: number): string {
  return new TextDecoder("utf-8").decode(gunzipSync(readFileSync(join(FIXTURES, `wiki-draft-${year}.html.gz`))));
}

function grid(year: number): Extract<DraftWikiParse, { kind: "grid" }> {
  const p = parseDraftWiki(html(year), year);
  assert.equal(p.kind, "grid", `${year} 가 그리드로 안 읽혔다`);
  return p as Extract<DraftWikiParse, { kind: "grid" }>;
}

// ──────────────────────────────────────────────────────────────────────────

test("픽스처 11장이 전부 읽힌다 — 10장은 그리드, 2026 은 no-grid", () => {
  let g = 0;
  let none = 0;
  for (const y of YEARS) {
    const p = parseDraftWiki(html(y), y);
    if (p.kind === "grid") g += 1;
    else none += 1;
  }
  assert.equal(g, 10, "그리드로 읽힌 해가 10이 아니다");
  assert.equal(none, 1, "no-grid 가 1이 아니다");
  assert.equal(g + none, YEARS.length);
});

test("⚠불변식 INV-1~6 이 픽스처 전수에서 위반 0 — **분모와 함께** 본다", () => {
  const total = { "INV-1": 0, "INV-2": 0, "INV-3": 0, "INV-4": 0, "INV-5": 0, "INV-6": 0 };
  const violations: string[] = [];
  for (const y of YEARS) {
    const r = checkDraftWikiInvariants(parseDraftWiki(html(y), y));
    for (const k of Object.keys(total) as (keyof typeof total)[]) total[k] += r.checked[k] ?? 0;
    violations.push(...r.violations.map((v) => `${v.id} ${v.detail}`));
  }
  assert.deepEqual(violations, [], "불변식 위반");
  // ⚠**분모가 0이면 「위반 0건」은 아무 말도 안 한다**(M11). 그래서 분모 자체를 못으로 박는다.
  assert.ok(total["INV-1"] > 0 && total["INV-2"] > 0 && total["INV-3"] > 0, `분모가 0인 불변식이 있다: ${JSON.stringify(total)}`);
  // ⚠**실측이다**(2026-09-06): 18+22+22+17+19+16+18+19+22+17. 바뀌면 픽스처가 바뀐 것이다.
  assert.equal(total["INV-5"], 190, "데이터 행 수가 바뀌었다 — 픽스처가 바뀌었는가");
});

test("⚠2026 은 실패가 아니라 `no-grid` 다 — 미개최를 예외로 만들지 않는다(M11)", () => {
  const p = parseDraftWiki(html(2026), 2026);
  assert.equal(p.kind, "no-grid");
  assert.ok(
    (DRAFT_WIKI_SECTION_IDS as readonly string[]).includes(p.kind === "no-grid" ? p.sectionId : ""),
    "절은 찾았어야 한다",
  );
});

test("⚠2007 `rowspan=5` 를 펼친다 — 안 펼치면 오른쪽 팀이 한 칸씩 밀린다(§6-1)", () => {
  const p = grid(2007);
  // 표식은 **한 번만** 센다(같은 원본 칸이 5행에 걸쳐 있다)
  assert.deepEqual(
    p.markers.map((m) => `${m.kind}/${m.columnIndex}/${m.marker}`),
    ["koukousei/5/指名権剥奪"],
  );
  assert.equal(p.grid.columns[5], "西武", "5번 열이 西武 가 아니다 — 펼치기가 어긋났다");

  // ⚠**밀림이 실제로 잡히는 자리**: 髙濱卓也 를 얻은 것은 **阪神**(6번 열)이고 西武 가 아니다.
  const koukousei2 = p.bids.filter((b) => b.kind === "koukousei" && b.bidRound === 2 && b.won === true);
  const takahama = koukousei2.find((b) => b.nameDisplay.endsWith("濱卓也"));
  assert.notEqual(takahama, undefined, "髙濱卓也 당첨 행이 없다");
  assert.equal(p.grid.columns[takahama!.columnIndex], "阪神", "髙濱卓也 를 얻은 구단이 阪神 이 아니다");

  // 지명권을 뺏긴 구단에는 高校生 1순위 지명이 **없다**
  assert.equal(p.picks.filter((x) => x.kind === "koukousei" && x.columnIndex === 5 && x.roundNo === 1).length, 0);
});

test("⚠2010 셀 안의 HTML 주석이 선수명에 붙지 않는다 — 보이지 않는 것을 읽지 않는다", () => {
  const p = grid(2010);
  const bad = p.picks.filter((x) => x.nameDisplay.includes("<") || x.nameDisplay.includes("-->"));
  assert.deepEqual(bad, [], "주석이 이름에 남았다");
  // 원문에 실제로 주석이 있다는 것부터 못으로 박는다 — 없으면 이 시험이 공회전한다
  assert.match(html(2010), /<!--横-->/u, "픽스처에 주석이 없다 — 이 시험이 아무것도 안 막고 있다");
  const kagami = p.picks.find((x) => x.nameDisplay.startsWith("加賀美"));
  assert.equal(kagami?.nameDisplay, "加賀美希昇");
});

test("⚠2019 CSS 를 문자열이 아니라 프로퍼티로 읽는다 — `normal;` 와 `normal` 이 공존한다(§6-5)", () => {
  const src = html(2019);
  assert.match(src, /font-weight:normal;/u, "픽스처에 `normal;` 이 없다");
  assert.match(src, /font-weight:normal"/u, "픽스처에 세미콜론 없는 `normal` 이 없다");
  assert.match(src, /background-color:#ffc"/u, "픽스처에 세미콜론 없는 색이 없다");
  const p = grid(2019);
  // 두 표기가 **같은 뜻**으로 읽혔는가 = 그룹마다 당첨이 정확히 1
  const groups = new Map<string, number>();
  for (const b of p.bids) {
    if (b.groupKey === null) continue;
    groups.set(b.groupKey, (groups.get(b.groupKey) ?? 0) + (b.won === true ? 1 : 0));
  }
  assert.ok(groups.size > 0, "2019 에 경합 그룹이 0개다");
  assert.deepEqual([...new Set(groups.values())], [1], "당첨이 1이 아닌 그룹이 있다");
});

test("⚠`1巡目→`(育成)과 `1巡目1`(支配下)을 섞지 않는다 — 육성 선수가 1위가 되지 않는다(§6-4)", () => {
  for (const y of [2013, 2019, 2023, 2024, 2025] as const) {
    const p = grid(y);
    // 育成 구획에서는 **입찰이 한 건도 안 나온다**
    assert.deepEqual(
      p.bids.filter((b) => b.kind === "ikusei"),
      [],
      `${y} 육성 구획에 입찰이 생겼다`,
    );
    // 育成 1라운드는 **지명**이고 회차는 1이다
    const r1 = p.picks.filter((x) => x.kind === "ikusei" && x.roundNo === 1);
    assert.ok(r1.length > 0, `${y} 육성 1라운드 지명이 0건이다`);
    assert.ok(r1.every((x) => x.waiverDir !== null), `${y} 육성 1라운드에 웨이버 방향이 없다`);
  }
});

test("⚠색을 표 전체가 아니라 (행, 색)으로 묶는다 — 색은 다른 행에서 재사용된다(§6-2)", () => {
  for (const y of [2013, 2023] as const) {
    const p = grid(y);
    const byColorRow = new Map<string, Set<number>>();
    for (const row of p.grid.rows) {
      for (const c of row.cells) {
        if (c.background === null || c.background === "#ccc") continue;
        const set = byColorRow.get(c.background) ?? new Set<number>();
        set.add(row.rowIndex);
        byColorRow.set(c.background, set);
      }
    }
    const reused = [...byColorRow.entries()].filter(([, rows]) => rows.size > 1);
    assert.ok(reused.length > 0, `${y} 에 재사용된 색이 없다 — 이 시험이 공회전한다`);
    // 재사용됐는데도 그룹마다 선수는 1종이어야 한다(표 전체로 묶으면 깨진다)
    const names = new Map<string, Set<string>>();
    for (const b of p.bids) {
      if (b.groupKey === null) continue;
      const set = names.get(b.groupKey) ?? new Set<string>();
      set.add(b.nameDisplay);
      names.set(b.groupKey, set);
    }
    assert.deepEqual([...new Set([...names.values()].map((s) => s.size))], [1], `${y} 한 그룹에 선수가 둘 이상이다`);
  }
});

test("⚠`#ccc` 는 추첨색이 아니다 — 육성 지명자가 「단독 당첨」이 되지 않는다(§6-3)", () => {
  let gray = 0;
  for (const y of YEARS) {
    const p = parseDraftWiki(html(y), y);
    if (p.kind !== "grid") continue;
    for (const row of p.grid.rows) {
      for (const c of row.cells) {
        if (c.background !== "#ccc") continue;
        gray += 1;
        // 회색 칸은 **1순위 입찰 행에 있을 수 없다**(있으면 파서가 던진다). 여기서는 그 사실을 못으로 박는다.
        assert.notEqual(row.label.kind, "lottery", `${y} ${row.labelRaw} 에 회색이 있다`);
      }
    }
  }
  assert.equal(gray, 5, "픽스처의 회색 칸 수가 바뀌었다 — 5개여야 한다");
});

test("⚠이름을 두 벌로 남긴다 — 표시명과 표제가 다르고 어느 쪽도 항상 옳지 않다(§6-7 · M10)", () => {
  const p = grid(2024);
  const diff = p.picks.filter((x) => x.nameCanonical !== null && x.nameCanonical !== x.nameDisplay);
  assert.ok(diff.length > 0, "표시명과 표제가 다른 건이 0건이다 — 픽스처가 바뀌었는가");
  // `<br>` 은 **빈 문자열로** 잇는다(§6-6). 공백으로 이으면 표제와 더 갈린다.
  const moi = p.picks.find((x) => x.nameDisplay.startsWith("モイセエフ"));
  assert.equal(moi?.nameDisplay, "モイセエフニキータ");
  assert.equal(moi?.nameCanonical, "モイセエフ・ニキータ");
  // `(存在しないページ)` 는 표제가 아니다 — 떼고 남긴다
  const sobu = p.picks.find((x) => x.nameDisplay.startsWith("曽布川"));
  assert.equal(sobu?.nameCanonical, "曽布川ザイレン");
  assert.ok(
    p.picks.every((x) => x.nameCanonical === null || !x.nameCanonical.includes("存在しないページ")),
    "표제에 `(存在しないページ)` 가 남았다",
  );
});

test("⚠`不合意` 는 선수가 아니다 — 각주를 안 떼면 `不合意[1]` 이 이름이 된다(§6-8)", () => {
  const p = grid(2006);
  assert.deepEqual(
    p.markers.map((m) => `${m.kind}/${m.labelRaw}/${m.marker}`),
    ["daigaku_shakaijin/希望枠/不合意"],
  );
  assert.ok(p.picks.every((x) => !x.nameDisplay.includes("不合意")), "`不合意` 가 선수명으로 들어갔다");
  // 希望枠 은 회차가 없는 제도다 — 순번은 적재가 매긴다(M11)
  const kibou = p.picks.filter((x) => x.kind === "kibou_nyudanwaku");
  assert.equal(kibou.length, 10, "2006 希望枠 지명이 10건이 아니다");
  assert.ok(kibou.every((x) => x.roundNo === null), "希望枠 에 회차가 붙었다");
});

test("⚠머리행을 위치로 찍지 않는다 — 배너가 위인 해와 아래인 해가 갈린다", () => {
  // R군: 머리행이 배너보다 **위**
  assert.equal(grid(2023).grid.headerLabel, "チーム");
  assert.equal(grid(2023).grid.rowsBeforeFirstBanner, 0);
  // S군: 배너가 머리행보다 **위** + 첫 칸이 `指名順`
  assert.equal(grid(2024).grid.headerLabel, "指名順");
  assert.equal(grid(2025).grid.headerLabel, "指名順");
  // Q군: `支配下` 배너 자체가 없다 → 배너 전 데이터 행이 존재한다
  assert.equal(grid(2008).grid.banners.join(","), "育成選手");
  assert.ok(grid(2008).grid.rowsBeforeFirstBanner > 0, "2008 에 배너 전 데이터 행이 없다");
  // P군: 배너 3개 · 머리행은 첫 배너 다음
  assert.deepEqual(grid(2005).grid.banners, ["高校生", "大学生・社会人", "育成選手"]);
});

test("⚠2024·2025 의 1순위 경합이 실제로 나온다 — 이 작업의 목표다", () => {
  const p = grid(2024);
  const round1 = p.bids.filter((b) => b.bidRound === 1);
  assert.equal(round1.length, 12, "1회차 입찰이 12구단이 아니다");
  const muneyama = round1.filter((b) => b.nameDisplay === "宗山塁");
  assert.equal(muneyama.length, 5, "宗山塁 경합이 5구단이 아니다");
  assert.equal(p.grid.columns[muneyama.find((b) => b.won === true)!.columnIndex], "楽天");
  // 단독지명은 「이겼다」가 아니다(M11)
  const solo = round1.filter((b) => b.won === null);
  assert.equal(solo.length, 1);
  assert.equal(p.grid.columns[solo[0]!.columnIndex], "ヤクルト");
  assert.equal(solo[0]!.groupKey, null);
  assert.ok(grid(2025).bids.length > 0, "2025 입찰이 0건이다");
});

test("⚠구조가 어긋나면 빈 값이 아니라 실패다(M7)", () => {
  const src = html(2024);
  /**
   * ⚠**바꾼 것이 없으면 시험이 공회전한다.** `String.replace(string, …)` 는 **첫 한 곳만** 바꾸므로
   * 노린 자리가 아닌 데를 건드리기 쉽다 — 실제로 그렇게 헛불이 났다(`font-weight:bold;` 가
   * 표보다 앞선 곳에도 있었다). **바뀌었는지부터 확인한다.**
   */
  const broken = (label: string, mutate: (h: string) => string): void => {
    const out = mutate(src);
    assert.notEqual(out, src, `${label}: 픽스처가 안 바뀌었다 — 이 본이 아무것도 안 막고 있다`);
    assert.throws(() => parseDraftWiki(out, 2024), DraftWikiParseError, label);
  };
  broken("절이 없다", (h) => h.replace(/<h2 id="指名選手一覧"/u, '<h2 id="別の節"'));
  // ⚠**표 여는 태그만** 노린다 — 굵기 규칙의 전제가 사라지는 자리는 거기다
  broken("표에 font-weight:bold 가 없다", (h) =>
    h.replace(/(<table class="wikitable" style="[^"]*?)font-weight:bold;/u, "$1"));
  broken("모르는 배경색", (h) => h.replace("background-color:#ffc", "background-color:#abc"));
  broken("모르는 굵기 값", (h) => h.replace("font-weight:normal", "font-weight:700"));
  broken("모르는 행 라벨", (h) => h.replace(">2巡目→<", ">2順目→<"));
  // ⚠**배너 행만** 노린다 — `>育成選手<` 는 목차·인포박스에도 있어서 첫 한 곳을 바꾸면 표가 안 바뀐다
  broken("모르는 배너", (h) => h.replace(/(<th colspan="13"[^>]*>)育成選手(<\/th>)/u, "$1練習生$2"));
  broken("닫히지 않은 주석", (h) => `${h}<!-- 열린 채로 끝`);
  // ⑻ 미지명 칸에 색이 붙으면 — 우리가 색을 잘못 읽고 있다는 뜻이다
  broken("미지명에 색", (h) => h.replace('<td id="mwpA">---</td>', '<td style="background-color:#fcc" id="mwpA">---</td>'));
});

test("⚠URL 은 `/wiki/` 만 친다 — `/w/`·`/api/` 는 robots Disallow 다", () => {
  const u = draftWikiUrl(2025);
  assert.equal(u, "https://ja.wikipedia.org/wiki/2025年度新人選手選択会議_(日本プロ野球)");
  assert.doesNotMatch(u, /\/w\/|\/api\//u);
});
