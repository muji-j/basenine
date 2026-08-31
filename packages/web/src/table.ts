/**
 * 정렬·좁히기가 되는 표 — **마크업 한 벌**(M1).
 *
 * ⚠**이 동작은 원래 선수 페이지의 대전 표 하나에만 붙어 있었다.** 구단 打者/投手·순위표에도
 * 같은 것이 필요해졌는데, 표마다 복붙하면 「이 표는 결측을 뒤로 보내고 저 표는 안 보낸다」가
 * 생긴다. 구 PPS에서 파서가 3중 구현이었고 서로 값이 달랐던 것과 같은 종류의 사고다.
 *
 * ⚠**여기가 만드는 것은 마크업뿐이고 동작은 `assets.ts`의 한 벌이 한다.**
 * 그쪽이 읽는 것은 아래 속성들이고, 이름을 바꾸면 양쪽을 같이 고쳐야 한다.
 *
 * ```
 * [data-stable="<id>"]              바깥 상자. id 는 정렬 상태의 저장 키다
 *   [data-sortdefault="key:dir"]    기본 정렬. 저장된 값이 지금 표에 없으면 여기로 돌아온다
 *   .sortable[data-sortkey]         머리 버튼
 *           [data-sorttype=num|text]
 *           [data-sortrate="1"]     율이면 표시 — 얇은 표본 경고의 대상이 된다
 *   tbody>tr[data-<key>]            정렬 값. ⚠**없으면 결측**(M11) — 방향과 무관하게 뒤로 간다
 *          [data-name]              이름 좁히기가 보는 값
 *          [data-qualified="1"]     자격 기준 도달 여부. 없으면 「기준이 없는 표」다
 *   [data-stable-filter]            이름 좁히기 input
 *   [data-stable-select]            값 하나로 좁히는 select. `data-field` 가 볼 열
 *   [data-stable-only]              「전원 / 기준 도달자만」 전환 버튼
 *   [data-stable-count]             지금 보이는 건수
 *   [data-stable-empty]             0건 전용 상태(M12)
 *   [data-stable-status]            지금 무엇으로 정렬·좁히기 중인가
 * ```
 *
 * ⚠**표를 만드는 쪽이 값을 두 번 쓰게 된다** — 눈에 보이는 `<td>` 와 정렬용 `data-*`.
 * 이건 중복이 아니라 **번역**이다: 화면에는 `.286` 이 필요하고 정렬에는 `0.2860` 이 필요하며,
 * 「기록 없음」은 화면에 `—` 이지만 정렬에는 **속성 자체가 없어야** 한다(M11).
 */
import { html, raw } from "./html.ts";
import type { RawHtml } from "./html.ts";
import { termAttr } from "./parts.ts";
import { scroller } from "./parts.ts";

/** 한 열. `key` 는 행의 `data-<key>` 와 짝이 된다 */
export interface SortColumn {
  key: string;
  label: string;
  /** 왼쪽 정렬(이름·구단 같은 글자 열) */
  left?: true;
  /** 글자로 정렬한다. 기본은 수치 */
  text?: true;
  /** 율이다 — 얇은 표본 경고의 대상 */
  rate?: true;
  /** 머리에 쓸 글자가 라벨과 다를 때(대전 표의 첫 열이 「投手」/「打者」로 바뀐다) */
  head?: string;
}

export interface StableSelect {
  /** 이 select 가 보는 행 속성 이름 */
  field: string;
  label: string;
  /** `value` 가 빈 문자열인 항목이 「전부」다 */
  options: readonly { value: string; label: string }[];
  id: string;
}

export interface StableOptions {
  /** 정렬 상태의 저장 키. **화면마다 다르게 준다** — 같으면 서로의 선택을 덮는다 */
  id: string;
  /**
   * 표의 **이름**(`aria-label`). ⚠**필수다** — 이름 없는 표는 낭독기에서 그냥 「표」다.
   *
   * ⚠**실측(2026-08-31): 배포물의 표 327개 중 295개에 이름이 없었다.**
   * 순위표 한 장에만 87개가 있어서, 표 단위로 이동하면 **「표」만 87번 들린다.**
   * ⚠**화면에는 안 보인다.** 그래도 제품 언어이므로 일본어로 짓는다(§7).
   */
  label: string;
  columns: readonly SortColumn[];
  /** `<tr>` 들. 만드는 쪽이 `data-*` 를 붙인다 */
  rows: RawHtml;
  /** 기본 정렬 열과 방향 */
  sortKey: string;
  sortDir?: "asc" | "desc";
  /** 이름 좁히기 입력의 라벨. 없으면 입력 자체를 만들지 않는다 */
  findLabel?: string;
  findPlaceholder?: string;
  select?: StableSelect;
  /**
   * 「전원 / 기준 도달자만」 전환.
   * ⚠**기본은 전원이다.** 기준 도달자만 보이는 것이 기본이면, 화면에 없는 선수를
   * 「기록이 없다」로 읽게 된다(M11의 화면 쪽 대응).
   */
  onlyQualified?: { label: string; qualifier: string };
  /** 얇은 표본 경고: 이 열이 이 값 미만이면 얇다고 본다 */
  thin?: { field: string; min: number; unit: string };
  /**
   * 임계값 버튼줄과 짝짓기. `minGroup` 은 `buttonGroup()` 에 준 그룹 이름,
   * `minField` 는 그 값과 견줄 행 속성이다. 버튼줄 자체는 부르는 쪽이 `controls` 로 둔다.
   */
  minGroup?: string;
  minField?: string;
  /** 전체 건수. 좁히기 전 분모다(M2) */
  total: number;
  unit: string;
  /** 0건일 때의 말 */
  emptyText: string;
  /** 표 아래 설명 */
  note?: RawHtml;
}

/**
 * DOM id 는 **저장 키에서 기계적으로 만든다**.
 *
 * ⚠**모양을 마음대로 정하지 않았다.** 대전 표가 이미 `matchupTable`·`matchupFilter`·
 * `matchupCount`·`matchupEmpty`·`matchupStatus` 를 쓰고 있었고, 그 이름들을 기준으로
 * 시험이 붙어 있다. 규칙을 `<id> + 역할`로 두면 대전 표의 DOM 이 **한 글자도 바뀌지 않아서**,
 * 그 시험들이 이 리팩터의 회귀 감시자로 그대로 남는다(2026-08-17).
 */
const domId = (id: string, part: string): string => `${id}${part}`;

/**
 * 상태 줄의 **기본 문구를 서버가 미리 적는다**.
 *
 * ⚠**비워 두고 클라이언트에 맡기면 스크립트가 없을 때 빈 줄이 남는다**(§0-1).
 * 표는 서버가 그린 순서 그대로 보이는데 「무엇으로 정렬돼 있는지」만 사라지므로,
 * 그 상태가 오히려 더 나쁘다 — 순서가 있는데 근거가 없는 화면이 된다.
 * ⚠**클라이언트와 같은 말을 만들어야 한다**(M1의 문구 판). 여기 규칙을 바꾸면
 * `assets.ts` 의 상태 줄 조립도 같이 바꾼다 — `stable-contract.test.ts` 가 둘을 맞대 본다.
 */
export function sortStatusText(columns: readonly SortColumn[], key: string, dir: "asc" | "desc"): string {
  const c = columns.find((x) => x.key === key);
  if (c === undefined) return "";
  const label = c.head ?? c.label;
  if (c.text === true) return `${label}${dir === "asc" ? " 昇順" : " 降順"}`;
  return `${label}${dir === "asc" ? "の少ない順" : "の多い順"}`;
}

export function stableTable(o: StableOptions): RawHtml {
  const dir = o.sortDir ?? "desc";
  const head = o.columns.map(
    (c) => html`<th class="${c.left === true ? "l" : ""}" scope="col"
      aria-sort="${c.key === o.sortKey ? (dir === "asc" ? "ascending" : "descending") : "none"}">
      <button class="sortable" type="button" data-sortkey="${c.key}" data-sorttype="${c.text === true ? "text" : "num"}"
        ${raw(termAttr(c.label))}${raw(c.rate === true ? ' data-sortrate="1"' : "")}>${c.head ?? c.label}<i></i></button>
    </th>`,
  );

  // ⚠**좁히기 줄을 통째로 없애지 않는다.** 건수(분모)는 좁히기가 없어도 나와야 한다(M2)
  const controls = html`<div class="mfind">
  ${o.findLabel === undefined
    ? null
    : html`<label for="${domId(o.id, "Filter")}">${o.findLabel}</label>
  <input id="${domId(o.id, "Filter")}" type="search" autocomplete="off" data-stable-filter
    placeholder="${o.findPlaceholder ?? ""}">`}
  ${o.select === undefined
    ? null
    : html`<label for="${o.select.id}">${o.select.label}</label>
  <select id="${o.select.id}" data-stable-select data-field="${o.select.field}">
    ${o.select.options.map((x) => html`<option value="${x.value}">${x.label}</option>`)}
  </select>`}
  ${o.onlyQualified === undefined
    ? null
    : html`<button class="tab" type="button" data-stable-only aria-pressed="false"
      title="${o.onlyQualified.qualifier}">${o.onlyQualified.label}</button>`}
  <span class="count"><span id="${domId(o.id, "Count")}" data-stable-count>${o.total}${o.unit}</span> / 全${o.total}${o.unit}</span>
</div>`;

  /*
   * ⚠**속성을 문자열로 짓지 않는다**(2026-08-18 감사 P3). 예전에는 raw() 안에서
   * 따옴표까지 손으로 붙였는데, 그 안의 값은 **이스케이프를 거치지 않는다**.
   * html 태그드 템플릿을 쓰면 보간되는 값이 반드시 escapeHtml 을 지난다(따옴표 포함).
   *
   * ⚠**주석을 여는 태그 안에 넣지 마라**(2026-08-18 유저 지적으로 발견 · 내가 만든 결함).
   * 위 설명을 `<!-- … -->` 로 `<div` 와 `>` **사이에** 써 뒀더니, 파서가 `-->` 의 `>` 를
   * **태그의 끝**으로 읽어 div 가 거기서 닫혔다 — 그 뒤의 `data-thinfield="pa" …` 가
   * 통째로 **화면에 글자로 나왔다**(対戦 탭 스크린샷).
   * HTML 주석은 **마크업 수준**에서만 주석이다. 태그 안에서는 그냥 문자다.
   * → 설명은 이렇게 **TS 주석**으로 태그 밖에 둔다.
   */
  return html`<div class="stable" data-stable="${o.id}" data-sortdefault="${o.sortKey}:${dir}"${
    o.thin === undefined ? raw("") : html` data-thinfield="${o.thin.field}" data-thinmin="${o.thin.min}" data-thinunit="${o.thin.unit}"`
  }${
    o.minGroup === undefined ? raw("") : html` data-mingroup="${o.minGroup}" data-minfield="${o.minField ?? ""}"`
  } data-unit="${o.unit}">
${controls}
${scroller(html`<table id="${domId(o.id, "Table")}" aria-label="${o.label}">
  <thead><tr>${head}</tr></thead>
  <tbody>${o.rows}</tbody>
</table>`)}
<p class="empty" id="${domId(o.id, "Empty")}" data-stable-empty hidden role="status">${o.emptyText}</p>
<p class="note" id="${domId(o.id, "Status")}" role="status" data-stable-status>${sortStatusText(o.columns, o.sortKey, dir)}</p>
${o.note === undefined ? null : o.note}
</div>`;
}

/**
 * 정렬용 수치 속성 한 개.
 *
 * ⚠**`null` 이면 속성을 만들지 않는다**(M11). `data-avg="0"` 을 넣으면
 * 오름차순에서 「기록 없음」이 1위가 되어, 비어 있다는 사실이 성적처럼 읽힌다.
 * ⚠**소수는 자릿수를 고정한다** — 문자열 비교로 떨어지는 일이 없게 수로만 쓴다.
 */
export function sortAttr(key: string, value: number | null, digits = 0): string {
  if (value === null || !Number.isFinite(value)) return "";
  return ` data-${key}="${value.toFixed(digits)}"`;
}
