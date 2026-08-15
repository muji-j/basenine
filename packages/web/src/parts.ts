/**
 * 화면 부품 — 名鑑의 시각 언어를 코드로 굳힌 것.
 *
 * ⚠**여기 있는 `stat`이 M2의 집행 지점이다.** 비율을 그리는 유일한 경로로 만들고,
 * 분모를 선택 인자로 두지 않는다 — 「이번만 분모 없이」가 가능하면 언젠가 그렇게 된다.
 */
import { html, raw } from "./html.ts";
import type { RawHtml } from "./html.ts";
import type { Rate } from "@bb-app/metrics";
import { NO_VALUE, avg3, dec1, dec2, denominator, innings, int, signed1 } from "./format.ts";

/** 자릿수 규약 — 3=타율 계열(선행 0 없음) · 2=방어율 계열 · 1=wRC+ 같은 지수 */
export type Digits = 1 | 2 | 3;

/** 순위표는 개수 지표(홈런·탈삼진)도 실으므로 0(정수)이 더 필요하다 */
export type RankDigits = 0 | Digits;

function fmt(value: number | null, digits: Digits): string {
  return digits === 3 ? avg3(value) : digits === 2 ? dec2(value) : dec1(value);
}

/**
 * 순위표 한 칸의 값 표기.
 * ⚠**표기 규칙을 페이지마다 다시 쓰지 마라** — 선수 페이지와 순위표 페이지가 같은 값을
 * 다르게 그리면 그것만으로 신뢰가 깎인다.
 */
export function rankValue(value: number | null, digits: RankDigits): string {
  return digits === 0 ? int(value) : fmt(value, digits);
}

/** 순위 배지. 자격 미달이면 배지 자체가 없다(순위가 「없다」는 것도 정보다) */
export function rankBadge(rank: number | null): RawHtml {
  return rank === null ? raw("") : html`<span class="rank">${rank}位</span>`;
}

/**
 * 비율 항목 한 줄. **분모가 필수 인자다.**
 * @param digits 타율 계열은 3자리·선행 0 없음, 방어율 계열은 2자리
 */
export function statRate(
  label: string,
  r: Rate,
  unit: string,
  digits: Digits = 3,
  rank: number | null = null,
): RawHtml {
  return html`<dt>${label}</dt><dd>${fmt(r.value, digits)}<span class="den">${denominator(r.denominator, unit)}</span>${rankBadge(rank)}</dd>`;
}

/**
 * 분모가 **아웃 카운트**인 비율(방어율·WHIP·FIP·K/9).
 *
 * ⚠**아웃 수를 그대로 「投球回」로 쓰지 마라.** 40아웃은 13.1이닝이고, `40投球回`라고 쓰면
 * 분모가 3배로 부풀어 보인다. 분모를 붙이는 것만으로는 M2를 지킨 것이 아니다 —
 * **맞는 분모**여야 한다.
 */
export function statRateOuts(
  label: string,
  r: Rate,
  digits: Digits = 2,
  rank: number | null = null,
): RawHtml {
  return html`<dt>${label}</dt><dd>${fmt(r.value, digits)}<span class="den">${innings(r.denominator)}回</span>${rankBadge(rank)}</dd>`;
}

/** 순위표의 분모 칸. 아웃 카운트는 이닝으로 바꿔 보여준다 */
export function denText(value: number, unit: string, asInnings = false): string {
  return asInnings ? `${innings(value)}回` : `${value}${unit}`;
}

/** 0이 기준인 값(SRC·wRAA). 부호를 항상 붙이고 분모를 함께 낸다. */
export function statSigned(
  label: string,
  value: number | null,
  sample: number,
  unit: string,
  rank: number | null = null,
): RawHtml {
  return html`<dt>${label}</dt><dd>${signed1(value)}<span class="den">${denominator(sample, unit)}</span>${rankBadge(rank)}</dd>`;
}

/** 개수 항목 한 줄. 개수에는 분모가 없다 — **비율이 아니기 때문**이지 예외가 아니다. */
export function statCount(label: string, n: number | null, rank: number | null = null): RawHtml {
  return html`<dt>${label}</dt><dd>${int(n)}${rankBadge(rank)}</dd>`;
}

/** 이미 문자열로 만든 값. 이닝(6.2)처럼 포맷이 특수한 것에만 쓴다. */
export function statText(label: string, text: string, rank: number | null = null): RawHtml {
  return html`<dt>${label}</dt><dd>${text === "" ? NO_VALUE : text}${rankBadge(rank)}</dd>`;
}

export interface BlockOptions {
  id: string;
  title: string;
  /** 제목 줄 오른쪽에 붙는 전환 버튼 등 */
  controls?: RawHtml;
  /** 제목 옆의 작은 주석(자격 기준 등) */
  qualifier?: string;
  body: RawHtml;
}

export function block(o: BlockOptions): RawHtml {
  return html`<section class="block" id="b-${o.id}">
  <h4>${o.title}${o.qualifier === undefined ? null : html`<span class="qt">${o.qualifier}</span>`}${o.controls === undefined ? null : html`<span class="sw">${o.controls}</span>`}</h4>
  ${o.body}
</section>`;
}

/** 여러 개의 `dl`을 단(段)으로 흘린다. 항목이 많아도 세로로 훑을 수 있게. */
export function columns(...groups: RawHtml[]): RawHtml {
  return html`<div class="cols">${groups.map((g) => html`<dl>${g}</dl>`)}</div>`;
}

export function scroller(body: RawHtml): RawHtml {
  return html`<div class="scroller">${body}</div>`;
}

export interface BarRow {
  label: string;
  /** 0~1로 정규화된 길이 */
  fill: number;
  /** 오른쪽에 찍을 표기(값 + 분모) */
  text: RawHtml;
  /** 표본이 얇으면 칠을 약하게 한다 — 값은 그대로 보이되 시각적 무게를 뺀다 */
  thin: boolean;
}

export function bars(rows: readonly BarRow[]): RawHtml {
  return html`<div class="bars">${rows.map(
    (r) => html`<div class="bar">
      <span>${r.label}</span>
      <div class="track"><i style="width:${Math.round(Math.max(0, Math.min(1, r.fill)) * 100)}%${r.thin ? ";opacity:.35" : ""}"></i></div>
      <em>${r.text}</em>
    </div>`,
  )}</div>`;
}

/** 값과 분모를 한 덩어리로 — **떼어 쓰지 못하게** 이 함수로만 만든다. */
export function valueWithDen(r: Rate, unit: string, digits: Digits = 3): RawHtml {
  return html`${fmt(r.value, digits)}<span class="den">${denominator(r.denominator, unit)}</span>`;
}

export function note(text: string): RawHtml {
  return html`<p class="note">${text}</p>`;
}

/**
 * 탭 한 줄.
 *
 * ⚠**같은 `group`을 쓰는 탭줄은 함께 움직인다.** 순위표에서 리그를 바꿔도 보고 있던
 * 지표가 유지되는 것이 이 성질 덕분이다 — 리그마다 탭줄을 따로 그리되 그룹은 하나다.
 * @param scroll 좁은 화면에서 줄바꿈 대신 가로로 흐르게 한다
 */
export function tablist(
  group: string,
  items: readonly { id: string; label: string }[],
  scroll = false,
): RawHtml {
  return html`<div class="tabs${scroll ? " scroll" : ""}" role="tablist" data-tabgroup="${group}" aria-label="表示の切り替え">
    ${items.map(
      (t, i) => html`<button class="tab" type="button" role="tab" data-tab="${t.id}" aria-selected="${i === 0 ? "true" : "false"}">${t.label}</button>`,
    )}
  </div>`;
}

/** 탭에 대응하는 패널. **첫 번째만 열어둔다** — JS가 없어도 뭔가는 보인다 */
export function panel(group: string, key: string, first: boolean, body: RawHtml): RawHtml {
  return html`<div data-panelgroup="${group}" data-panelkey="${key}" role="tabpanel" ${raw(first ? "" : "hidden")}>${body}</div>`;
}
