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
import { termKeyForLabel } from "./glossary.ts";
import { GRADE_LABEL, GROUP_BASIS, gradeClass, gradeOf, gradeOrder } from "./grade.ts";
import type { GradeGroup } from "./grade.ts";

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
export function rankValue(
  value: number | null,
  digits: RankDigits,
  asInnings = false,
): string {
  // ⚠아웃 카운트를 그대로 정수로 내면 327아웃이 「327」이 된다. 109회여야 한다
  if (asInnings) return value === null ? NO_VALUE : `${innings(value)}回`;
  return digits === 0 ? int(value) : fmt(value, digits);
}

/** 순위 배지. 자격 미달이면 배지 자체가 없다(순위가 「없다」는 것도 정보다) */
export function rankBadge(rank: number | null): RawHtml {
  return rank === null ? raw("") : html`<span class="rank">${rank}位</span>`;
}

/**
 * 용어 라벨. 용어집에 있으면 **누를 수 있는 버튼**이 되어 설명이 뜬다.
 *
 * ⚠**버튼이어야 한다.** `<span>` + hover로 만들면 터치 단말과 키보드에서 열 방법이 없다.
 * PC는 호버, 모바일은 탭, 키보드는 포커스 — 셋이 같은 요소로 동작해야 한다.
 */
export function term(label: string): RawHtml {
  const key = termKeyForLabel(label);
  if (key === undefined) return html`${label}`;
  return html`<button class="term" type="button" data-term="${key}" aria-describedby="tip">${label}</button>`;
}

/**
 * 이미 버튼인 요소(정렬 헤더)에 붙일 `data-term` 조각.
 *
 * ⚠**버튼 안에 버튼을 넣을 수 없다.** 정렬 헤더는 이미 버튼이므로 `term()`을 쓸 수 없고,
 * 속성만 얹어 호버·포커스로 설명이 뜨게 한다(탭은 정렬이 가져간다).
 * @returns 앞에 공백이 붙은 속성 문자열. 용어집에 없으면 빈 문자열
 */
export function termAttr(label: string): string {
  const key = termKeyForLabel(label);
  return key === undefined ? "" : ` data-term="${key}"`;
}

/**
 * 값에 붙는 등급. **색만으로 전하지 않는다** — 보이지 않는 글자로도 등급을 낸다.
 *
 * ⚠색각 이상과 스크린리더에서 색은 전달되지 않는다. 색은 **빠르게 읽기 위한 보조**이고,
 * 등급 자체는 글자로도 존재해야 한다.
 */
function gradeMark(
  metric: string | undefined,
  value: number | null,
  sample: number,
  group: GradeGroup,
): {
  cls: string;
  label: RawHtml;
} {
  if (metric === undefined) return { cls: "", label: raw("") };
  const g = gradeOf(metric, value, sample, group);
  if (g === null) return { cls: "", label: raw("") };
  return { cls: ` ${gradeClass(g)}`, label: html`<span class="vh">（${GRADE_LABEL[g]}）</span>` };
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
  group: GradeGroup = "batter",
): RawHtml {
  // 등급 척도의 키는 용어집 키와 같다 — 라벨 하나로 설명과 색이 둘 다 붙는다
  const g = gradeMark(termKeyForLabel(label), r.value, r.denominator, group);
  // ⚠**등급 글자는 분모 뒤에 온다.** 값과 분모 사이에 아무것도 끼우지 않는다(M2) —
  // 읽는 순서로도 이쪽이 맞다. 분모를 모르고 들은 「とても良い」는 근거가 없다.
  return html`<dt>${term(label)}</dt><dd class="v${raw(g.cls)}">${fmt(r.value, digits)}<span class="den">${denominator(r.denominator, unit)}</span>${g.label}${rankBadge(rank)}</dd>`;
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
  group: GradeGroup = "starter",
): RawHtml {
  // ⚠표본은 **아웃 카운트**다. 등급 척도의 minSample도 아웃 단위로 적혀 있어야 한다
  const g = gradeMark(termKeyForLabel(label), r.value, r.denominator, group);
  return html`<dt>${term(label)}</dt><dd class="v${raw(g.cls)}">${fmt(r.value, digits)}<span class="den">${innings(r.denominator)}回</span>${g.label}${rankBadge(rank)}</dd>`;
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
  return html`<dt>${term(label)}</dt><dd class="v">${signed1(value)}<span class="den">${denominator(sample, unit)}</span>${rankBadge(rank)}</dd>`;
}

/** 개수 항목 한 줄. 개수에는 분모가 없다 — **비율이 아니기 때문**이지 예외가 아니다. */
export function statCount(label: string, n: number | null, rank: number | null = null): RawHtml {
  return html`<dt>${term(label)}</dt><dd class="v">${int(n)}${rankBadge(rank)}</dd>`;
}

/** 이미 문자열로 만든 값. 이닝(6.2)처럼 포맷이 특수한 것에만 쓴다. */
export function statText(label: string, text: string, rank: number | null = null): RawHtml {
  return html`<dt>${term(label)}</dt><dd class="v">${text === "" ? NO_VALUE : text}${rankBadge(rank)}</dd>`;
}

/**
 * 수준 색의 범례.
 *
 * ⚠**범례 없는 색은 장식이다.** 파랑이 좋은 쪽인지 주황이 좋은 쪽인지 화면이 말하지 않으면
 * 읽는 사람은 색을 무시하게 되고, 그러면 색을 칠한 의미가 없다.
 * ⚠**끄는 버튼을 함께 둔다.** 색이 방해가 되는 사람이 있고, 인쇄물의 질감을 원하는 사람도 있다.
 * ⚠**무엇과 비교한 색인지 밝힌다.** 선발과 구원은 잣대가 다르므로, 어느 분포와 견준
 * 색인지 말하지 않으면 같은 색이 두 뜻을 갖게 된다.
 */
export function gradeLegend(group: GradeGroup = "batter"): RawHtml {
  const order = gradeOrder();
  const first = order[0];
  const last = order[order.length - 1];
  /**
   * ⚠**눈금은 이어져 있어야 눈금으로 읽힌다**(2026-08-18 유저 지적).
   * 예전에는 `[색] 라벨 [색] 라벨 …` 처럼 **색과 글자가 번갈아** 놓여 있어서,
   * 첫 색이 바로 앞의 「水準」에 붙은 것으로 읽혔고 다섯 칸이 한 축이라는 것도 보이지 않았다.
   * → **양 끝에만 글자**(とても悪い … とても良い)를 두고 **가운데는 색을 이어 붙인다.**
   * 나쁨에서 좋음으로 가는 **한 줄의 축**이라는 것이 형태로 드러난다.
   * ⚠**색만으로 전하지 않는다** — 양 끝 글자가 방향을 말하고, 각 칸에는 이름이 숨은 글자로 남는다.
   */
  return html`<div class="legend">
    <span class="lg">水準</span>
    <span class="scale">
      <b class="send">${GRADE_LABEL[first!]}</b>
      <span class="bar">${order.map(
    (g) => html`<i class="${gradeClass(g)}"><span class="vh">${GRADE_LABEL[g]}</span></i>`,
  )}</span>
      <b class="send">${GRADE_LABEL[last!]}</b>
    </span>
    <span class="lg tail">${GROUP_BASIS[group]}と比較。母数が少ない値には色をつけていません</span>
    <button class="tab" type="button" id="gradeBtn" aria-pressed="true">色分け</button>
  </div>`;
}

/**
 * 순위표의 **승패분 칸** — 수와 띠를 같이 낸다.
 *
 * ⚠**홈과 順位 탭이 같은 한 벌을 쓴다**(M1 · 2026-08-18 유저 요청:
 * 「항상 같은 디자인일 수 있게 디자인 요소 통합하는 게 좋을 듯」).
 * 예전에는 두 화면이 각자 그렸고, 그래서 홈에만 띠가 있고 順位 탭에는 없었다 —
 * 같은 사실을 두 어법으로 말하면 읽는 사람이 매번 다시 배워야 한다.
 * ⚠**띠만으로는 정확한 수를 못 읽고, 수만으로는 비교가 안 된다.** 둘 다 낸다.
 */
export function wlCell(r: { w: number; l: number; t: number }): RawHtml {
  const total = r.w + r.l + r.t;
  const pc = (n: number): string => (total === 0 ? "0" : ((n / total) * 100).toFixed(2));
  return html`<span class="wlnum">${r.w}<s>勝</s>${r.l}<s>敗</s>${r.t}<s>分</s></span>${
    total === 0
      ? raw("")
      : html`<span class="wlbar" role="img" aria-label="${r.w}勝${r.l}敗${r.t}分（${total}試合）">
    <i class="ww" style="width:${pc(r.w)}%"></i><i class="wt" style="width:${pc(r.t)}%"></i><i class="wl" style="width:${pc(r.l)}%"></i>
  </span>`}`;
}

/**
 * 순위표의 **득실점 칸** — 点差를 주역으로, 得/失과 분모를 뒤에.
 *
 * ⚠**무엇을 나타내는 수인지 값 옆에서 말한다**(2026-08-18 유저 지적: 「이해가 안 됨」).
 * 열 이름은 得失点 인데 큰 수는 **그 차이**여서 둘이 어긋난 채로 읽는 사람에게 떠넘기고 있었다.
 * ⚠**띠는 가운데가 0이고 방향이 뜻이다** — `--up`/`--dn` 은 명도가 거의 같아(실측 1.01:1)
 * 색으로는 구별되지 않는다. 부호가 붙은 수가 바로 위에 있다.
 * @param maxAbs 그 리그에서 가장 큰 |득실차|. 0이면 띠를 그리지 않는다(나눌 수 없다).
 * @param denominator 득점·실점을 읽을 수 있었던 경기 수. **0이면 값 자체를 내지 않는다**(M11).
 */
export function runCell(
  r: { rf: number; ra: number },
  maxAbs: number,
  denominator: number,
): RawHtml {
  if (denominator === 0) return html`${NO_VALUE}`;
  const d = r.rf - r.ra;
  const sign = d > 0 ? "+" : d < 0 ? "−" : "±";
  const cls = d > 0 ? "up" : d < 0 ? "dn" : "";
  const w = maxAbs === 0 ? 0 : (Math.abs(d) / maxAbs) * 50;
  /** ⚠**낭독기에는 숨긴다** — 같은 사실이 바로 옆에 글자로 이미 있다 */
  const bar = maxAbs === 0
    ? raw("")
    : d === 0
      ? html`<span class="rdbar" aria-hidden="true"></span>`
      : html`<span class="rdbar" aria-hidden="true"><i class="${cls}" style="${
        d > 0 ? `left:50%;width:${w.toFixed(2)}%` : `right:50%;width:${w.toFixed(2)}%`
      }"></i></span>`;
  return html`<b class="rdiff ${cls}">${sign}${Math.abs(d)}</b><s class="rdlab">点差</s>${bar}<span class="den">${
    r.rf}<s>得</s> ${r.ra}<s>失</s><em>${denominator}試合</em></span>`;
}

/** 그 구간에서 가장 큰 |득실차| — 띠의 자다. **리그 안에서 정한다** */
export function widestRunDiff(rows: readonly { rf: number; ra: number }[]): number {
  return rows.reduce((m, x) => Math.max(m, Math.abs(x.rf - x.ra)), 0);
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
  <h2>${o.title}${o.qualifier === undefined ? null : html`<span class="qt">${o.qualifier}</span>`}${o.controls === undefined ? null : html`<span class="sw">${o.controls}</span>`}</h2>
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

/**
 * 설명 한 줄.
 *
 * ⚠**별표 두 개로 감싼 곳을 굵게 만든다.** 이 프로젝트의 문구는 어디서나 그 표기로 강조를 쓰는데,
 * 여기만 순수 텍스트라 **별표가 그대로 화면에 찍히고 있었다** — 실측 1,537장(2026-08-16).
 * ⚠**직접 HTML을 만들지 않는다.** 조각을 나눈 뒤 각 조각을 `html`에 넘기므로 이스케이프는 그대로 산다 —
 * 선수명·구단명이 이 문구에 섞여 들어와도 태그가 되지 않는다.
 * ⚠**짝이 맞지 않으면 아무것도 하지 않는다.** 별표가 홀수 개면 어디까지가 강조인지 알 수 없고,
 * 그때 억지로 자르면 엉뚱한 곳이 굵어진다.
 */
export function note(text: string): RawHtml {
  const parts = text.split("**");
  // 조각이 짝수 개 = 별표가 홀수 개 = 짝이 안 맞는다
  if (parts.length % 2 === 0) return html`<p class="note">${text}</p>`;
  return html`<p class="note">${parts.map((s, i) => (i % 2 === 1 ? html`<b>${s}</b>` : s))}</p>`;
}

/**
 * 탭 한 줄.
 *
 * ⚠**같은 `group`을 쓰는 탭줄은 함께 움직인다.** 순위표에서 리그를 바꿔도 보고 있던
 * 지표가 유지되는 것이 이 성질 덕분이다 — 리그마다 탭줄을 따로 그리되 그룹은 하나다.
 * @param scroll 좁은 화면에서 줄바꿈 대신 가로로 흐르게 한다
 * @param label ⚠**한 줄에 탭줄이 둘 이상이면 반드시 다르게 준다.** 같은 이름의 탭줄이
 *   나란히 있으면 스크린리더에서 어느 쪽인지 구별할 방법이 사라진다
 * @param seg 세그먼티드 표시 — 「둘 중 하나」인 상위 전환에만. 형태로 배타성을 말한다
 */
export function tablist(
  group: string,
  items: readonly { id: string; label: string }[],
  scroll = false,
  label = "表示の切り替え",
  seg = false,
): RawHtml {
  return html`<div class="tabs${scroll ? " scroll" : ""}${seg ? " seg" : ""}" role="tablist" data-tabgroup="${group}" aria-label="${label}">
    ${items.map(
      (t, i) => html`<button class="tab" type="button" role="tab"
        id="${tabId(group, t.id)}" aria-controls="${panelId(group, t.id)}"
        data-tab="${t.id}" aria-selected="${i === 0 ? "true" : "false"}">${t.label}</button>`,
    )}
  </div>`;
}

/**
 * 탭과 패널을 잇는 id.
 *
 * ⚠**`data-tabgroup`/`data-panelgroup` 은 우리 스크립트만 읽는다.** 낭독기는 그것을 모르고,
 * 표준으로 「이 탭이 저 패널을 연다」를 말하려면 `aria-controls`/`aria-labelledby` 가 있어야 한다
 * (WAI-ARIA 탭 패턴). 예전에는 둘 다 없어서 **탭을 눌러도 어느 패널이 열렸는지**가
 * 접근성 트리에 나타나지 않았다(2026-08-17 이중 검토 지적, 보류했다가 처리).
 *
 * ⚠**id 는 한 곳에서만 만든다**(M1) — 탭 쪽과 패널 쪽이 따로 만들면 어느 날 갈리고,
 * 갈리면 `aria-controls` 가 **존재하지 않는 id** 를 가리켜 조용히 무의미해진다.
 * ⚠**HTML id 로 쓸 수 있는 글자만 온다** — 그룹은 코드가 정한 상수이고
 * 키는 `^[a-z0-9+-]+$` 꼴이라(순위 지표 id 포함) 안전하다.
 */
export function tabId(group: string, key: string): string {
  return `tb-${group}-${key}`;
}

export function panelId(group: string, key: string): string {
  return `pn-${group}-${key}`;
}

/**
 * 탭 그룹을 따라 열리고 닫히지만 **패널은 아닌** 자리 — 레일 안의 하위 탭줄처럼.
 *
 * ⚠`role="tabpanel"`을 붙이지 않는다. 안에 든 것이 탭줄이면 「패널을 열었더니 또 탭」이 되어
 * 스크린리더에게 구조를 잘못 말한다. 보이고 숨는 규칙만 공유한다.
 */
export function follower(group: string, key: string, first: boolean, body: RawHtml): RawHtml {
  return html`<div data-panelgroup="${group}" data-panelkey="${key}" ${raw(first ? "" : "hidden")}>${body}</div>`;
}

/**
 * 패널이 없는 버튼 묶음 — 「최소 타석」처럼 **표를 좁히기만** 하는 선택지.
 *
 * ⚠**`role="tablist"`를 쓰지 않는다.** 탭은 「대응하는 패널을 연다」는 뜻이고,
 * 여는 것이 없는데 탭이라고 하면 스크린리더에게 거짓말이 된다. 상태는 `aria-pressed`로 낸다.
 * 선택 상태의 저장은 탭과 같은 구조를 쓰므로 `data-tabgroup`/`data-tab`은 그대로 둔다.
 */
export function buttonGroup(
  group: string,
  items: readonly { id: string; label: string }[],
  label: string,
  /**
   * 이 버튼줄이 **패널을 여는가**.
   *
   * ⚠**켜지 않으면 패널의 `aria-labelledby` 가 존재하지 않는 id 를 가리킨다.**
   * 실측(2026-08-17): 구단 페이지의 패널 8개 중 **4개가 없는 탭을 가리키고 있었다** —
   * 깨진 ARIA 참조는 없는 것보다 나쁘다(접근성 트리에 거짓이 들어간다).
   * ⚠**반대도 마찬가지다.** 패널이 없는 버튼줄(最少打席 같은 좁히기)에 `aria-controls` 를
   * 붙이면 그쪽이 없는 것을 가리킨다 — 그래서 **기본은 끔**이다.
   */
  controlsPanels = false,
): RawHtml {
  return html`<div class="tabs" role="group" data-tabgroup="${group}" aria-label="${label}">
    ${items.map(
      (t, i) => html`<button class="tab" type="button" data-tab="${t.id}"
        ${raw(controlsPanels ? ` id="${tabId(group, t.id)}" aria-controls="${panelId(group, t.id)}"` : "")}
        aria-pressed="${i === 0 ? "true" : "false"}">${t.label}</button>`,
    )}
  </div>`;
}

/** 탭에 대응하는 패널. **첫 번째만 열어둔다** — JS가 없어도 뭔가는 보인다 */
export function panel(group: string, key: string, first: boolean, body: RawHtml): RawHtml {
  return html`<div data-panelgroup="${group}" data-panelkey="${key}" role="tabpanel"
  id="${panelId(group, key)}" aria-labelledby="${tabId(group, key)}" ${raw(first ? "" : "hidden")}>${body}</div>`;
}
