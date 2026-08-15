/**
 * HTML 조립.
 *
 * ⚠**우리가 만들지 않은 문자열이 전부 화면에 들어간다** — 선수명·팀명·타석 결과 표기는
 * npb.jp에서 온 것이고, 우리는 그 내용을 통제하지 못한다. 그래서 **이스케이프를 잊을 수 없게**
 * 만든다: 템플릿에 끼워 넣는 값은 기본으로 이스케이프되고, 원문 삽입은 `raw()`로 **명시**해야 한다.
 *
 * 문자열 연결로 HTML을 만들지 마라. 한 곳만 빠뜨려도 그게 XSS다.
 */

/** 이스케이프를 건너뛴다는 **명시적** 표시. 이 타입이 붙은 것만 그대로 들어간다. */
export interface RawHtml {
  readonly __raw: string;
}

export function raw(s: string): RawHtml {
  return { __raw: s };
}

export function isRaw(v: unknown): v is RawHtml {
  return typeof v === "object" && v !== null && typeof (v as RawHtml).__raw === "string";
}

const ESCAPES: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ESCAPES[c]!);
}

/** 배열·null·숫자도 받는다. null/undefined는 빈 문자열이 된다(빈 값 렌더링과 구별은 호출자 책임). */
export type Renderable = string | number | RawHtml | null | undefined | Renderable[];

function render(v: Renderable): string {
  if (v === null || v === undefined) return "";
  if (Array.isArray(v)) return v.map(render).join("");
  if (isRaw(v)) return v.__raw;
  if (typeof v === "number") return escapeHtml(String(v));
  return escapeHtml(v);
}

/**
 * 태그드 템플릿. 끼워 넣는 값은 **자동으로 이스케이프**된다.
 *
 * ```ts
 * html`<td>${player.name}</td>`          // 이스케이프됨
 * html`<div>${raw(childHtml)}</div>`     // 명시적으로 그대로
 * ```
 */
export function html(strings: TemplateStringsArray, ...values: Renderable[]): RawHtml {
  let out = strings[0] ?? "";
  for (const [i, v] of values.entries()) {
    out += render(v) + (strings[i + 1] ?? "");
  }
  return raw(out);
}

/** 최종 문자열로 꺼낸다. 파일에 쓰기 직전에만 쓴다. */
export function toString(v: RawHtml): string {
  return v.__raw;
}

/** 속성값으로 안전한 문자열인지 — 클래스명·데이터 키처럼 우리가 만든 값에만 쓴다. */
export function attrToken(s: string): string {
  return s.replace(/[^A-Za-z0-9_-]/g, "");
}
