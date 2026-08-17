/**
 * 「정렬·좁히기가 되는 표」의 **양쪽을 맞대는 시험**.
 *
 * ⚠**이 시험이 없으면 `client.test.ts` 는 「우리가 상상한 마크업」을 잰다.**
 * 그쪽 픽스처는 DOM 을 손으로 짓기 때문에, 실제 렌더러가 내는 속성 이름이 바뀌어도
 * 픽스처는 옛 이름을 그대로 들고 초록으로 남는다. 그러면 **시험은 전부 통과하는데
 * 실물은 아무 표도 정렬되지 않는** 상태가 된다.
 *
 * 이 프로젝트는 같은 함정을 이미 밟았다 — 합성 픽스처에 「타석 결과 칸이 0개」여서
 * 구형 파서 경로가 늘 빈 배열이어도 시험이 전부 초록이었다(CLAUDE.md §2-2).
 *
 * 그래서 여기서는 **진짜 렌더 결과**를 문자열로 받아, 클라이언트가 실제로 읽는
 * 갈고리가 전부 있는지 센다. 클라이언트 소스도 함께 읽어 **한쪽에만 있는 이름**을 찾는다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { CLIENT_JS } from "../src/assets.ts";
import { sortStatusText, stableTable } from "../src/table.ts";
import { html, raw } from "../src/html.ts";

function sample(): string {
  return stableTable({
    id: "demo",
    columns: [
      { key: "name", label: "選手", left: true, text: true },
      { key: "pa", label: "打席" },
      { key: "avg", label: "打率", rate: true },
    ],
    sortKey: "pa",
    findLabel: "名前でしぼる",
    findPlaceholder: "例：佐藤",
    select: {
      id: "demoTeam",
      field: "teamcode",
      label: "球団",
      options: [
        { value: "", label: "すべての球団" },
        { value: "t", label: "阪神（1）" },
      ],
    },
    onlyQualified: { label: "規定到達のみ", qualifier: "規定打席 428" },
    thin: { field: "pa", min: 10, unit: "打席" },
    minGroup: "demoMin",
    minField: "pa",
    total: 2,
    unit: "人",
    emptyText: "この条件の記録はありません。",
    rows: html`<tr data-name="佐藤" data-teamcode="t" data-pa="400" data-qualified="0" data-avg="0.2860">
      <td class="l">佐藤</td><td>400</td><td>.286</td></tr>
    <tr data-name="山本" data-teamcode="t" data-pa="9" data-qualified="0">
      <td class="l">山本</td><td>9</td><td>${raw("&mdash;")}</td></tr>`,
  }).__raw;
}

/** 클라이언트가 실제로 읽는 갈고리. **이름을 바꾸면 양쪽을 같이 고쳐야 한다** */
const HOOKS = [
  "data-stable=",
  "data-sortdefault=",
  "data-stable-filter",
  "data-stable-select",
  "data-stable-only",
  "data-stable-count",
  "data-stable-empty",
  "data-stable-status",
  "data-thinfield=",
  "data-thinmin=",
  "data-thinunit=",
  "data-mingroup=",
  "data-minfield=",
  "data-unit=",
  "data-sortkey=",
  "data-sorttype=",
  "data-sortrate=",
] as const;

test("⚠렌더러가 내는 갈고리와 클라이언트가 읽는 갈고리가 같다", () => {
  const out = sample();
  const missingInMarkup = HOOKS.filter((h) => !out.includes(h));
  assert.deepEqual(missingInMarkup, [], "마크업에 없는 갈고리가 있다");

  // 클라이언트 쪽은 dataset 접근이라 카멜케이스다 — 이름 규칙을 그대로 옮겨 찾는다
  const camel = (h: string): string =>
    h.replace(/=$/, "").replace(/^data-/, "").replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase());
  const missingInClient = HOOKS.filter((h) => {
    const c = camel(h);
    // `data-stable-filter` 같은 것은 셀렉터 문자열로 쓰인다
    return !CLIENT_JS.includes(`dataset.${c}`) && !CLIENT_JS.includes(h);
  });
  assert.deepEqual(missingInClient, [], "클라이언트가 읽지 않는 갈고리가 있다 — 붙여도 아무 일이 없다");
});

/**
 * ⚠**대전 표의 DOM id 는 바뀌면 안 된다.** 그 이름들에 기존 시험이 붙어 있고,
 * 그것이 이 리팩터의 유일한 회귀 감시자다. 규칙을 「id + 역할」로 고정한다.
 */
test("⚠DOM id 는 저장 키에서 기계적으로 나온다 — 대전 표의 이름이 그대로 남는다", () => {
  const out = sample();
  for (const part of ["Table", "Filter", "Count", "Empty", "Status"]) {
    assert.ok(out.includes(`id="demo${part}"`), `demo${part} 가 없다`);
  }
});

/**
 * ⚠**분모를 좁히기 전후로 둘 다 낸다**(M2). 「46人」만 있으면 좁힌 뒤에
 * 그 구단에 46명뿐인 것으로 읽힌다 — 작업규칙 7의 화면 쪽 대응이다.
 */
test("⚠좁히기 줄에 「지금 몇 / 전체 몇」이 함께 나온다(M2)", () => {
  const out = sample();
  assert.match(out, /<span id="demoCount" data-stable-count>2人<\/span> \/ 全2人/);
});

/**
 * ⚠**0건 전용 상태가 있다**(M12). 「조건에 맞는 것이 없다」와 「고장났다」가
 * 같은 화면이면 그 자체가 결함이다.
 */
test("⚠0건 전용 상태가 처음부터 숨겨진 채 존재한다(M12)", () => {
  const out = sample();
  assert.match(out, /<p class="empty" id="demoEmpty" data-stable-empty hidden role="status">/);
});

/**
 * ⚠**정렬 방향은 머리에 `aria-sort` 로 나온다.** 색이나 화살표만으로 내면
 * 낭독기에서 「무엇으로 정렬돼 있는지」가 사라진다.
 */
test("처음 정렬된 열에만 aria-sort 가 붙는다", () => {
  const out = sample();
  assert.equal((out.match(/aria-sort="descending"/g) ?? []).length, 1);
  assert.equal((out.match(/aria-sort="none"/g) ?? []).length, 2);
});

/**
 * ⚠**스크립트가 없어도 「무엇으로 정렬돼 있는지」가 적혀 있어야 한다**(§0-1).
 * 표는 서버가 그린 순서 그대로 보이는데 상태 줄만 비면, **순서는 있는데 근거가 없는 화면**이
 * 된다 — 리팩터 중에 실제로 한 번 그렇게 됐다(2026-08-17).
 */
test("⚠상태 줄의 기본 문구를 서버가 미리 적는다 — 스크립트 없이도 근거가 남는다", () => {
  assert.match(sample(), /id="demoStatus" role="status" data-stable-status>打席の多い順</);
});

/**
 * ⚠**같은 말을 두 곳에서 만든다 — 그러면 어느 날 갈린다**(M1).
 * 서버의 `sortStatusText` 와 클라이언트의 상태 줄 조립이 **같은 어미**를 써야 한다.
 * 여기서 재는 것은 「클라이언트에 그 어미들이 실재하는가」다.
 */
test("⚠정렬 상태의 어미가 서버·클라이언트에서 같다", () => {
  for (const tail of ["の少ない順", "の多い順", " 昇順", " 降順"]) {
    assert.ok(CLIENT_JS.includes(tail), `클라이언트에 ${tail} 가 없다`);
    assert.ok(
      sortStatusText([{ key: "x", label: "打席" }, { key: "y", label: "選手", text: true }], "x", "desc").length > 0,
    );
  }
  assert.equal(sortStatusText([{ key: "x", label: "打席" }], "x", "asc"), "打席の少ない順");
  assert.equal(sortStatusText([{ key: "n", label: "選手", text: true }], "n", "asc"), "選手 昇順");
  // 없는 열을 물으면 빈 문자열 — 지어내지 않는다
  assert.equal(sortStatusText([{ key: "x", label: "打席" }], "없음", "asc"), "");
});
