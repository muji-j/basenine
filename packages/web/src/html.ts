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

/**
 * 이체자 선택자 — **IVS**(U+E0100–E01EF) · **SVS**(U+FE00–FE0F).
 * ⚠**소스에 그 글자를 날것으로 적지 마라** — 보이지 않는다. 범위는 이스케이프로만 쓴다.
 */
const VARIATION_SELECTORS = /[\u{E0100}-\u{E01EF}\u{FE00}-\u{FE0F}]/gu;

/**
 * **이체자 선택자를 뗀다 — 화면에 나가는 데이터 문자열의 출력 경계**(2026-10-25).
 *
 * ⚠**2026-10-24 배포가 이것으로 멈췄다**(daily run 40116508045 · 「서체 부분집합」 단계).
 * 2026 드래프트 npb 원본이 이름 두 곳(辻村 大我 · 榊原 七斗)의 첫 글자 뒤에 U+E0100 을 달았고,
 * **어느 서체도 그 글자를 못 덮어** 서체 게이트(`scripts/build-fonts.ts`)가 섰다 — **게이트는 옳았다.**
 * 게이트가 허용하는 두 길 중 ⑴ 「그 글자를 화면에서 안 쓴다」를 여기서 탄다(⑵ 서체 교체는 사람의 결정이다).
 *
 * ⚠**보이지 않는 글자다**(Unicode Default_Ignorable) — 같은 한자의 **글리프 변형만** 고른다.
 * 떼면 같은 한자가 서체의 기본 모양으로 나온다(위키백과 표기와 같다). **이름의 뜻은 안 바뀐다.**
 * 두면 그 글자를 덮는 서체가 없어 게이트가 선다 — 게이트가 막는 까닭은 `scripts/fonts.ts` 머리말(빠진 글자는
 * 시스템 서체로 떨어진다)이고, ⚠**이 글자를 브라우저가 실제로 어떻게 그리는지는 안 쟀다.**
 * ⚠**독립 코드포인트 이체자(髙 U+9AD9 · 﨑 U+FA11 · 𠮷 U+20BB7)는 다른 글자다** — 서체가 덮고, 떼면 이름이 바뀐다. 건드리지 않는다.
 * ⚠**클라이언트 번들(`assets.ts`)에 이 범위를 이스케이프로 적지 마라** — 게이트가 `.js` 의 `\u` 이스케이프를 풀어
 *   **양 끝 글자 넷(U+E0100·E01EF·FE00·FE0F)을 요구 목록에 넣는다**(2026-10-25 실측). 질의어에서 떼야 할 날이 오면 그것부터 풀어라.
 * ⚠**원본·DB 는 그대로다**(M4 — 원본 표기는 사실로 남긴다). 파서·적재기에서 떼지 마라.
 * ⚠**게이트를 느슨하게 하지 마라** — `scripts/fonts.ts` 의 `isNonGlyph` 에 이 범위를 더하면
 *   글자가 배포물에 남은 채로 통과한다. **서체가 덮지 못하는 글자를 화면에 내보내는 것** — 게이트가 막는 바로 그것이다.
 * ⚠**화면 문구에 SVS 를 쓰는 곳은 0건이었다**(2026-10-25 실측 · 이 변경 전 git 추적 텍스트 606파일 전수 ·
 *   글자·이스케이프 둘 다 — 이체자 선택자는 런북 한 곳의 IVS 3자뿐). 기호의 텍스트/이모지 표시를 강제하려고
 *   U+FE0E·FE0F 를 **끼워 넣는 값으로** 넘기면 여기서 사라진다 — 우리 문구라면 템플릿의 고정 부분에 쓴다
 *   (그 자리는 이 함수를 안 지난다. 그리고 서체 게이트가 그 글자를 따로 본다).
 */
export function stripVariationSelectors(s: string): string {
  return s.replace(VARIATION_SELECTORS, "");
}

/**
 * ⚠**이체자 선택자도 여기서 뗀다**(`stripVariationSelectors`) — 템플릿에 끼워 넣는 값은 **전부** 이 함수를 지나므로
 * 출력 경계가 한 곳이다(M1). `raw()` 는 지나지 않는다 — **데이터 유래 문자열을 `raw()` 로 넣지 마라.**
 */
export function escapeHtml(s: string): string {
  return stripVariationSelectors(s).replace(/[&<>"']/g, (c) => ESCAPES[c]!);
}

/**
 * **배포물에 나가는 JSON 의 출력 경계** — `escapeHtml` 의 JSON 짝(검색 색인 · 比較 샤드 · 순위 「もっと見る」).
 *
 * ⚠**서체 게이트는 `.json` 도 훑는다**(`scripts/fonts.ts` 의 `TEXT_EXTENSIONS`) — 브라우저가 그 글자를 그리기 때문이다.
 * 그래서 이름이 실리는 JSON 이 이 함수를 비켜 가면 HTML 을 고쳐도 게이트가 다시 선다.
 * ⚠**직렬화한 결과에서 뗀다** — `JSON.stringify` 는 짝이 맞는 서러게이트와 U+FE0x 를 이스케이프하지 않고
 * 글자 그대로 쓰고, JSON 의 구조 글자는 전부 ASCII 라 떼도 JSON 이 안 깨진다. 값과 키에 함께 걸린다.
 */
export function toJson(value: unknown): string {
  return stripVariationSelectors(JSON.stringify(value));
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
 * (2026-10-25 에 이체자 선택자를 떼는 일이 더해졌다 — 지우기만 하므로 `<` 를 만들지 않는다. 전제는 그대로다.)
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
