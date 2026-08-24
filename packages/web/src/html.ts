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

/**
 * **주석을 떼는 자리** — 여는 태그 밖의 `<!-- … -->` 를 지운다.
 *
 * ⚠**배포물의 11.4%가 주석이었다**(실측 2026-08-24 · 15,341장 전수: **359,399개 · 114.62 MiB**).
 * gzip 표본 300장에서 **전송량 22.19% 절감** — 매 페이지가 5분의 1 이상 가벼워진다.
 * ⚠**Pages 20,000파일 벽에는 효과가 0이다**(파일 수는 안 준다). 줄어드는 것은 **전송량과 용량**이다.
 *
 * ## 왜 소스의 주석을 지우지 않는가
 *
 * 그 주석들이 **「왜 이렇게 했는가」**다 — 이 저장소가 가장 아끼는 것이다.
 * 그래서 소스는 그대로 두고 **출력 경계 한 곳에서만** 뗀다(M1).
 *
 * ## ⚠세 자리에서 깨질 수 있다 — 구조로 막는다
 *
 * ⑴ script · ⑵ style · ⑶ pre/textarea 안의 여는 주석 표기는 **주석이 아니라 내용**이다.
 * 실측(2026-08-24 · 전수): 지금은 그런 블록이 **0개**다. ⚠**그래서 안전한 게 아니다** —
 * 「오늘 없다」는 「내일도 없다」가 아니고, JS 문자열 하나면 생긴다.
 * → **그 네 구역을 통째로 건너뛴다.** 운이 아니라 구조로 안전하게 한다.
 *
 * ⚠**속성값은 걱정하지 않아도 된다** — `escapeHtml` 이 `<` 를 `&lt;` 로 바꾸므로
 * 끼워 넣은 값에 여는 주석 표기가 들어갈 수 없다(실측: 전수에서 속성값 안 **0건**).
 * **그 전제가 무너지면 이 함수도 무너진다** — `escapeHtml` 을 고칠 때 여기를 같이 봐라.
 *
 * ⚠**클라이언트가 주석 노드를 읽지 않는다**(`nodeType===8`·`COMMENT_NODE`·`createComment` **0건**).
 * 하나도 load-bearing 이 아니다.
 */
const COMMENT = /<!--[\s\S]*?-->/g;
/** 내용을 건드리면 안 되는 구역. ⚠**여는 태그와 닫는 태그가 같은 이름이어야 한다**(역참조) */
const VERBATIM = /<(script|style|pre|textarea)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;

export function stripComments(html: string): string {
  let out = "";
  let at = 0;
  for (const m of html.matchAll(VERBATIM)) {
    out += html.slice(at, m.index).replace(COMMENT, "");
    out += m[0];
    at = m.index + m[0].length;
  }
  return out + html.slice(at).replace(COMMENT, "");
}

/**
 * 최종 문자열로 꺼낸다. 파일에 쓰기 직전에만 쓴다.
 *
 * ⚠**여기서 주석을 뗀다**(2026-08-24). 출력 경계가 한 곳이라 여기 하나면 전 페이지에 걸린다 —
 * 10개 파일의 주석을 손으로 지우면 **「왜」가 사라진다.**
 */
export function toString(v: RawHtml): string {
  return stripComments(v.__raw);
}

/** 속성값으로 안전한 문자열인지 — 클래스명·데이터 키처럼 우리가 만든 값에만 쓴다. */
export function attrToken(s: string): string {
  return s.replace(/[^A-Za-z0-9_-]/g, "");
}
