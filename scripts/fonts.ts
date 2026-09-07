/**
 * **서체 부분집합 — 쓰이는 글자를 배포물에서 유도하고, 빠지면 빌드를 멈춘다.**
 *
 * 정본은 `docs/superpowers/specs/2026-09-07-design-direction.md` §5-A · §5-B · §5-C · §5-E · §7-1.
 * 여기는 **그 규칙의 구현**이고 새로 정하는 것이 없다.
 *
 * ## 이 파일이 지키는 것
 *
 * ⚠**「(쓰이는 글자) ⊆ (그 서체의 cmap)」이 아니면 빌드가 실패한다**(§5-C · M7).
 * 빠진 글자를 시스템 폰트로 흘리면 **이름 한가운데서 얼굴이 바뀐다** — 웹폰트가 없는 것보다 나쁘다.
 * 그러므로 여기서 「없으면 건너뛴다」를 절대 쓰지 마라.
 *
 * ⚠**검사 대상은 배포되는 WOFF2 다**(§7-1 P1). 원본만 보면 **부분집합 과정에서 빠지는 것**을 놓친다.
 * `verifyCoverage` 는 원본이 아니라 **산출 버퍼**를 받는다.
 *
 * ⚠**커버리지 단위는 「스택에서 그 글자를 담당하는 폰트」다**(§7-1 P2) —
 * 라틴 폰트에 한자를 요구하지 않는다. `assign` 이 브라우저 규칙(앞에서부터 가진 놈이 이긴다)을 흉내낸다.
 *
 * ⚠**Plex 가 못 덮으면 실패다. 조용히 Noto 로 바꾸지 마라**(§7-1 P2 · M7).
 *
 * ## ⚠ASCII 를 바닥으로 깔아 두는 이유 — 이것이 없으면 파이프라인이 멱등이 아니다(M5)
 *
 * 파일 이름에 **내용 해시**가 들어가고(§7-1 P2 캐시 키), 그 이름은 언젠가 CSS 에 적힌다.
 * 그러면 「dist 를 훑어 글자를 모은다 → 그 글자로 파일을 만든다 → 그 파일 이름이 dist 에 들어간다」가
 * 스스로를 먹는다. 해시는 16진수라 **ASCII 를 항상 넣어 두면 그 되먹임이 집합을 못 바꾼다.**
 * 거기에 더해 `collectUsedChars` 는 **자기 산출 디렉터리를 안 훑는다.** 둘을 합쳐야 고정점이다.
 */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// 1. 쓰이는 글자를 모은다
// ---------------------------------------------------------------------------

/**
 * 훑는 확장자.
 *
 * ⚠**`.json` 이 빠지면 검색·비교 화면의 선수 이름이 통째로 빠진다**(§5-C 2 — 「클라이언트가 만드는 글자」).
 * 실측으로 `dist` 의 `.json` 은 153개이고 전부 화면이 그려 내는 데이터다.
 * ⚠**`.js` 도 마찬가지다** — 번들 안의 일본어 문자열은 HTML 본문에 안 나온다.
 */
export const TEXT_EXTENSIONS: readonly string[] = [".html", ".json", ".js", ".css", ".svg", ".txt"];

/** 훑지 않는 것. 배포 설정이지 화면에 그려지는 내용이 아니다 */
const SKIP_NAMES: ReadonlySet<string> = new Set(["_headers", "_redirects", "_routes.json"]);

/**
 * ⚠**우리가 만든 것은 안 훑는다** — 되먹임을 끊는 두 장치 중 하나다(맨 위 M5 설명).
 * `dist` 기준 상대경로가 이걸로 시작하면 건너뛴다.
 */
export const FONT_OUT_DIR = join("assets", "fonts");

/**
 * **글리프가 없는 것들** — 요구 목록에서 뺀다.
 *
 * ⚠**이건 「덮지 못해도 봐준다」가 아니다.** 줄바꿈·탭·제로폭·BOM 은 **애초에 그려지는 글자가 아니라서**
 * 어느 서체의 cmap 에도 없다. 안 빼면 **첫 실행부터 전 서체가 실패**하고, 그러면 사람이
 * 검사를 끄는 쪽으로 간다 — 그게 이 검사를 죽이는 길이다.
 * ⚠**여기에 「이 한자는 봐준다」류를 절대 더하지 마라.** 그 순간 §5-C 가 무의미해진다.
 */
export function isNonGlyph(cp: number): boolean {
  if (cp < 0x20) return true; // C0 — 줄바꿈·탭 포함
  if (cp === 0x7f) return true; // DEL
  if (cp >= 0x80 && cp <= 0x9f) return true; // C1
  if (cp >= 0x200b && cp <= 0x200f) return true; // 제로폭·방향
  if (cp === 0x2028 || cp === 0x2029) return true; // 줄·문단 구분
  if (cp >= 0x202a && cp <= 0x202e) return true; // 방향 지정
  if (cp === 0xfeff) return true; // BOM
  return false;
}

const NAMED_ENTITIES: Readonly<Record<string, number>> = {
  amp: 0x26,
  lt: 0x3c,
  gt: 0x3e,
  quot: 0x22,
  apos: 0x27,
  nbsp: 0xa0,
};

/**
 * ⚠**모르는 이름 엔티티는 풀지 않는다** — 억지로 풀면 없는 글자를 만들어 낸다.
 *
 * ⚠**~~안 풀어도 손해가 없다~~ 는 거짓이었다**(2026-09-08 3차 검토 · P3).
 * 위 표에 없는 이름(`&copy;` 등)은 **조용히 무시**되므로 **그 형태로만 존재하는 글자가
 * 요구 목록에서 통째로 빠진다** — 화면에는 나오는데 부분집합에는 없다.
 * → **여기서는 여전히 안 푼다**(없는 글자를 만들지 않는다) — 대신 **부르는 쪽이 이름을 받아
 * 빌드를 세운다**(`scanBytes`/`scanChars` 의 반환값 · `collectUsedChars.unknownEntities`).
 * ⚠**HTML5 이름 개체는 2,231종이라 표로 다 담지 않는다.** 담아야 할 이름이 생기면
 * **그때 그 이름만** 위 표에 더해라 — 실측(2026-09-08 · dist 전수)으로 `.html`/`.svg` 의
 * 이름 개체는 `&amp;` **1건이 전부**다.
 */
export function entityCodePoint(body: string): number | undefined {
  if (body.startsWith("#x") || body.startsWith("#X")) {
    const cp = Number.parseInt(body.slice(2), 16);
    return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff ? cp : undefined;
  }
  if (body.startsWith("#")) {
    const cp = Number.parseInt(body.slice(1), 10);
    return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff ? cp : undefined;
  }
  return NAMED_ENTITIES[body];
}

const ENTITY_RE = /^&(#x[0-9a-fA-F]{1,6}|#\d{1,7}|[a-zA-Z][a-zA-Z0-9]{1,31});/;

/**
 * `\uXXXX` · `\u{XXXXX}` · `\xXX` 를 읽는다.
 *
 * ⚠**이스케이프로만 존재하는 글자를 놓치지 않기 위해서다**(2026-09-08 3차 검토 · P3).
 * `"髙"` 는 바이트로 보면 ASCII 뿐이라, 안 풀면 **髙 가 요구 목록에서 통째로 빠진다** —
 * 화면에는 나오는데 부분집합에는 없는, 이 게이트가 막으려는 바로 그 상태다.
 *
 * ⚠**서러게이트 쌍을 먼저 본다.** `𠮷` 을 반쪽씩 세면 **어느 서체에도 없는
 * 외톨이 서러게이트**를 요구하게 되어 빌드가 거짓으로 붉어진다. 짝이 없는 반쪽은 **안 센다**
 * (「없는 글자를 만들지 않는다」의 같은 원칙).
 *
 * ⚠**CSS 고유의 `\4E9C` 꼴(마커 없는 16진)은 풀지 않는다** — 정규식의 `\b`·`\d` 와
 * 글자 그대로 같은 모양이라 **없는 글자를 만들어 낸다**(`\bd` → U+00BD). 실측(2026-09-08 ·
 * dist 전수)으로 `.css` 의 역슬래시는 **0개**이고, `.html` 도 **0개**다(전체 1개 · `.js` 의 정규식).
 * 필요해지면 **확장자를 봐서** 그때 더해라.
 */
const ESCAPE_PAIR_RE = /^\\u([dD][89abAB][0-9a-fA-F]{2})\\u([dD][c-fC-F][0-9a-fA-F]{2})/;
const ESCAPE_RE = /^\\(?:u\{([0-9a-fA-F]{1,6})\}|u([0-9a-fA-F]{4})|x([0-9a-fA-F]{2}))/;

export function escapeCodePoint(text: string): number | undefined {
  const pair = ESCAPE_PAIR_RE.exec(text);
  if (pair !== null) {
    return (Number.parseInt(pair[1]!, 16) - 0xd800) * 0x400 + (Number.parseInt(pair[2]!, 16) - 0xdc00) + 0x10000;
  }
  const m = ESCAPE_RE.exec(text);
  if (m === null) return undefined;
  const cp = Number.parseInt(m[1] ?? m[2] ?? m[3]!, 16);
  if (!Number.isFinite(cp) || cp <= 0 || cp > 0x10ffff) return undefined;
  // ⚠짝을 못 이룬 서러게이트는 글자가 아니다 — 세면 전 서체가 「못 덮는다」로 붉어진다
  if (cp >= 0xd800 && cp <= 0xdfff) return undefined;
  return cp;
}

/** 이스케이프 한 개가 차지할 수 있는 최대 길이(`𠮷` = 12) + 여유 */
const ESCAPE_WINDOW = 14;

/**
 * 이 키워드 **뒤**의 `/` 는 나눗셈이 아니라 정규식이다 — `return /x/.test(s)`.
 * ⚠식별자 뒤는 기본이 나눗셈이므로, 이 목록이 없으면 그 흔한 모양이 위 사고를 낸다.
 */
const REGEX_AFTER_KEYWORD: ReadonlySet<string> = new Set([
  "return", "typeof", "instanceof", "in", "of", "new", "delete", "void", "throw",
  "case", "do", "else", "yield", "await",
]);

/**
 * 직전 토큰으로 「이 `/` 가 정규식을 여는가」를 가른다(표준 휴리스틱).
 *
 * ⚠**남는 애매함 둘을 적어 둔다** — `)` 와 `}` 뒤다. `if(a)/re/.test(b)` 와 블록 `}` 뒤의
 * 정규식은 **나눗셈으로 읽힌다.** 반대로 고르면 훨씬 흔한 `(a+b)/2 // 주석` 이 깨져
 * 주석의 한글이 요구 목록에 들어간다(빌드가 거짓으로 붉어진다).
 * ⚠**실측(2026-09-08 · `dist/assets/site.js`)**: `/` 50개 중 `)` 가 앞선 2개는 둘 다
 * **정규식을 닫는 슬래시**라 이 판정에 오지 않고, `}` 가 앞선 것은 **0개**다.
 * 그 두 모양이 번들에 들어오면 여기를 다시 판단하라.
 *
 * ⚠**이 함수는 TypeScript 도 읽는다**(`forced-colors.test.ts` 가 `.ts` 소스에 쓴다).
 * 그래서 **뒤에 붙는 `!`(non-null 단언)와 앞에 붙는 `!`(부정)를 갈라야 한다** —
 * `sum.get(k)! / count` 와 `!/re/.test(s)` 가 글자로는 같다. **앞 글자로 가른다.**
 * ⚠**안 가르면 저장소에서 7건이 걸렸다**(2026-09-08 실측 · `run-expectancy.ts` ·
 * `woba-weights.ts` · `asrc-asrp-measure.ts` ×4 · `woba-weights-derive.ts` — 전부 나눗셈).
 */
function regexAllowed(lastSig: string, prevSig: string, lastWord: string): boolean {
  if (lastSig === "") return true; // 파일의 첫 토큰
  if (/[A-Za-z0-9_$]/.test(lastSig)) return REGEX_AFTER_KEYWORD.has(lastWord);
  // ⚠피연산자 뒤의 `!` 는 TS 의 non-null 단언 — 그 뒤의 `/` 는 나눗셈이다
  if (lastSig === "!") return !/[A-Za-z0-9_$)\]"'`]/.test(prevSig);
  return !")]}\"'`.".includes(lastSig);
}

/**
 * ⚠**JS 주석은 안 센다 — 그리지 않기 때문이다.**
 *
 * 실측(2026-09-08 · `dist/assets/site.js`): 이 번들은 **줄 주석 5줄**에 한국어를 담고 있고,
 * 그걸 요구 목록에 넣으면 **한글 76자**가 들어와 Plex·Noto 둘 다 못 덮어 **빌드가 붉어진다.**
 * 그런데 그 글자는 **화면에 한 번도 안 나온다.**
 *
 * ⚠**문자열은 절대 지우지 않는다** — 지우면 §5-C 가 막으려는 「덜 센다」가 된다.
 * 그래서 따옴표·역따옴표 상태를 좇는다.
 *
 * ## ⚠정규식 리터럴을 좇는다 — ~~안 좇는다~~ 는 침묵 실패였다 (2026-09-08 3차 검토 · P2)
 *
 * 옛 판은 「`/[/*]/` 같은 것이 있으면 어긋나는데, 어긋나면 끝에서 상태가 안 돌아오므로 **던진다**」
 * 고 적었다. **그 주장이 이 입력에서 성립하지 않는다:**
 *
 * ```
 * const r=/\//;document.body.textContent="髙";
 * ```
 *
 * 이스케이프된 슬래시의 **두 번째 글자**와 **정규식을 닫는 슬래시**가 붙어 `//` 를 만들고,
 * 옛 판은 그 자리에서 줄 주석으로 들어가 **그 줄의 나머지를 통째로 주석으로 분류**했다 —
 * **던지지 않고 조용히.** 髙 는 요구 목록에서 사라지고 화면에서는 시스템 폰트로 떨어진다.
 * **정확히 이 게이트가 막으려던 결함이다.**
 *
 * ⚠**어느 쪽으로 틀리는가가 여기서 전부다.**
 *   · 나눗셈을 정규식으로 잘못 보면 → 그 구간이 전부 `code` 로 간다. **덜 세지 않는다.**
 *     주석 하나를 코드로 셀 수는 있고 그러면 빌드가 붉어진다 — **시끄럽지만 안전하다.**
 *   · 정규식을 나눗셈으로 잘못 보면 → 위 사고 그대로. **조용히 글자가 빠진다.**
 * 그래서 애매하면 **정규식 쪽으로 기울이되**, 흔한 나눗셈(`(a+b)/2 // 주석`)을 깨지 않는
 * 표준 휴리스틱을 쓴다(`regexAllowed`).
 *
 * ⚠**떨어져 나간 글자는 부르는 쪽이 받아서 보고한다** — 「조용히 뺐다」가 되지 않게.
 */
export function stripJsComments(src: string): { code: string; comments: string } {
  let code = "";
  let comments = "";
  let i = 0;
  const n = src.length;
  let state: "code" | "sq" | "dq" | "tpl" | "line" | "block" | "re" = "code";
  /** 정규식의 `[...]` 안에서는 `/` 가 정규식을 닫지 않는다 */
  let inClass = false;
  /**
   * ⚠**보간(`${…}`)을 좇는다 — 안 좇으면 안쪽 템플릿의 여는 역따옴표가 바깥을 닫는다.**
   *
   * 이 저장소의 화면 코드는 `html\`…${cond ? html\`…\` : raw("")}…\`` 모양이 흔한데,
   * 옛 판은 `${}` 를 모르므로 **안쪽 역따옴표를 바깥의 닫는 짝으로 읽고** 거기서부터
   * 템플릿 내용을 코드로 셌다. 그 상태에서 `</span>` 의 `<` 뒤 `/` 가 나오면
   * **정규식 판정에 걸린다** — 즉 이 결함은 원래 있었고 옛 판에서는 조용했다.
   * ⚠**같은 이유로 보간 안의 `//` 주석도 옛 판은 코드로 셌다.** 여기서 함께 낫는다.
   *
   * 쌓는 것은 **보간에 들어가기 직전의 중괄호 깊이**다. `}` 를 만났을 때 깊이가 0이고
   * 이 스택이 비어 있지 않으면 그 `}` 가 보간을 닫는 것이다.
   */
  const tplStack: number[] = [];
  let braceDepth = 0;
  /** 마지막으로 code 에 넣은 **공백 아닌** 글자 · 그 앞의 것 · 그 자리에서 끝나는 식별자 */
  let lastSig = "";
  let prevSig = "";
  let lastWord = "";
  const push = (ch: string): void => {
    code += ch;
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") return;
    prevSig = lastSig;
    lastSig = ch;
    lastWord = /[A-Za-z0-9_$]/.test(ch) ? lastWord + ch : "";
  };
  while (i < n) {
    const c = src[i]!;
    if (state === "code") {
      // ⚠**주석 판정이 먼저다.** 빈 정규식 `//` 도 `/*` 로 시작하는 정규식도 JS 에 없다
      if (c === "/" && src[i + 1] === "/") {
        state = "line";
        i += 2;
        continue;
      }
      if (c === "/" && src[i + 1] === "*") {
        state = "block";
        i += 2;
        continue;
      }
      if (c === "/" && regexAllowed(lastSig, prevSig, lastWord)) {
        state = "re";
        inClass = false;
        push(c);
        i += 1;
        continue;
      }
      if (c === "'") state = "sq";
      else if (c === '"') state = "dq";
      else if (c === "`") state = "tpl";
      else if (c === "{") braceDepth += 1;
      else if (c === "}") {
        if (braceDepth === 0 && tplStack.length > 0) {
          // ⚠이 `}` 는 블록이 아니라 **보간을 닫는다** — 바깥 템플릿으로 돌아간다
          braceDepth = tplStack.pop()!;
          state = "tpl";
        } else if (braceDepth > 0) braceDepth -= 1;
      }
      push(c);
      i += 1;
      continue;
    }
    if (state === "re") {
      push(c);
      if (c === "\\") {
        // ⚠**이스케이프는 통째로 넘긴다** — `/\//` 의 두 번째 글자가 정규식을 닫지 않게
        if (i + 1 < n) push(src[i + 1]!);
        i += 2;
        continue;
      }
      if (c === "\n") {
        // ⚠**정규식 리터럴은 줄을 넘지 못한다.** 여기 왔다는 것은 위 판정이 틀렸다는 뜻이고,
        //   그대로 두면 다음 줄의 주석을 코드로 세게 된다 — **조용히 넘기지 않는다.**
        throw new Error(
          "JS 주석 제거가 어긋났다(정규식 리터럴이 줄을 넘었다) — `/` 를 정규식으로 잘못 읽었다. " +
            "regexAllowed 의 판정을 다시 보라.",
        );
      }
      if (c === "[") inClass = true;
      else if (c === "]") inClass = false;
      else if (c === "/" && !inClass) state = "code";
      i += 1;
      continue;
    }
    if (state === "sq" || state === "dq" || state === "tpl") {
      push(c);
      if (c === "\\") {
        if (i + 1 < n) push(src[i + 1]!);
        i += 2;
        continue;
      }
      if (state === "tpl" && c === "$" && src[i + 1] === "{") {
        // ⚠**보간 안은 코드다** — 여기 있는 주석·정규식·중첩 템플릿을 전부 제대로 봐야 한다
        push("{");
        tplStack.push(braceDepth);
        braceDepth = 0;
        state = "code";
        i += 2;
        continue;
      }
      // ⚠**여는 따옴표는 여기 안 온다** — `code` 상태에서 이미 먹었다. 그러니 이건 닫는 쪽이다
      if ((state === "sq" && c === "'") || (state === "dq" && c === '"') || (state === "tpl" && c === "`")) {
        state = "code";
      }
      i += 1;
      continue;
    }
    if (state === "line") {
      if (c === "\n") {
        state = "code";
        push(c);
      } else comments += c;
      i += 1;
      continue;
    }
    // block
    if (c === "*" && src[i + 1] === "/") {
      state = "code";
      i += 2;
      continue;
    }
    comments += c;
    i += 1;
  }
  if (state === "sq" || state === "dq" || state === "tpl" || state === "block" || state === "re") {
    throw new Error(
      `JS 주석 제거가 어긋났다(끝에서 상태가 ${state}) — 이 상태로는 문자열을 지웠을 수 있다. ` +
        "정규식 리터럴이나 새 문법을 의심하라.",
    );
  }
  if (tplStack.length > 0) {
    throw new Error(
      `JS 주석 제거가 어긋났다(끝에서 안 닫힌 보간 \${…} 이 ${tplStack.length}개) — ` +
        "템플릿 리터럴을 잘못 읽었다.",
    );
  }
  return { code, comments };
}

export interface Charset {
  /** 코드포인트 집합. ⚠**ASCII 바닥이 이미 들어 있다** */
  readonly chars: ReadonlySet<number>;
  /** 실제로 읽은 파일 수 — ⚠**분모다. 0 이면 「깨끗함」이 아니라 「안 쟀음」이다** */
  readonly filesRead: number;
  /** 확장자별 파일 수 */
  readonly byExtension: Readonly<Record<string, number>>;
  /** ⚠**주석에만 있어서 뺀 글자.** 「조용히 뺐다」가 안 되게 밖으로 낸다 */
  readonly commentOnly: readonly number[];
  /**
   * ⚠**풀지 못한 이름 개체.** 비어 있지 않으면 **그 글자가 요구 목록에서 빠져 있다** —
   * 「조용히 뺐다」가 안 되게 밖으로 내고, `build-fonts.ts` 가 이걸로 빌드를 세운다.
   */
  readonly unknownEntities: readonly { name: string; count: number; where: string }[];
  /** 읽은 바이트(UTF-16 코드유닛 기준이 아니라 파일 크기) */
  readonly bytesRead: number;
}

/** ASCII 인쇄 가능 영역. **바닥으로 항상 깐다**(맨 위 M5 설명) */
export function asciiFloor(): number[] {
  const out: number[] = [];
  for (let cp = 0x20; cp <= 0x7e; cp += 1) out.push(cp);
  return out;
}

/** 모은 글자를 담는 그릇. BMP 는 비트맵, 그 밖(서러게이트 쌍)은 `Set` 이다 */
export class CharSink {
  /**
   * ⚠**비트맵을 밖에 그대로 내준다.** 훑는 쪽이 바이트마다 `add()` 를 부르면
   * **그 호출 자체가 병목**이 된다 — 아래 `scanBytes` 의 실측표를 봐라.
   */
  readonly bitmap = new Uint8Array(0x10000);
  private readonly astral = new Set<number>();

  add(cp: number): void {
    if (cp < 0x10000) this.bitmap[cp] = 1;
    else this.astral.add(cp);
  }

  /** ⚠**여기서 비로소 「그릴 수 없는 것」을 걸러낸다** — 훑는 도중에 거르면 그만큼 느려진다 */
  toSet(): Set<number> {
    const out = new Set<number>();
    for (let cp = 0; cp < 0x10000; cp += 1) if (this.bitmap[cp] === 1 && !isNonGlyph(cp)) out.add(cp);
    for (const cp of this.astral) if (!isNonGlyph(cp)) out.add(cp);
    return out;
  }
}

/**
 * **바이트를 그대로 훑는다** — 문자열로 풀지 않는다.
 *
 * ⚠**여기가 이 도구에서 가장 비싼 곳이다.** `dist` 는 1.49 GiB 이고 매일 3번 구워진다.
 * 실측(2026-09-08 · 같은 기계 · 같은 `dist` 9,548장 1,486.6 MiB · 결과 글자 수는 넷 다 **1,646자로 같다**):
 *
 * | 어떻게 | 훑는 시간 |
 * |---|---|
 * | `for (const ch of s)` + 전문 정규식 치환 | **122.5초** |
 * | `charCodeAt` 순회(문자열로 디코드) | **58.9초** |
 * | 위 + `Set` 대신 비트맵 | **62.6초**(⚠**느려졌다**) |
 * | 바이트 순회 + `sink.add()` 호출 | **54.5초** |
 * | **바이트 순회 + 비트맵에 직접 쓰기** | **21.3초** |
 *
 * ⚠**「`Set.add` 가 병목이겠지」가 틀렸다** — 비트맵만 넣었을 땐 오히려 느려졌다.
 * 병목은 둘이었다: ⑴**UTF-8 을 문자열로 푸는 것** ⑵**바이트마다 메서드를 부르는 것**.
 * **둘 다 없애야 떨어진다.** ⚠**「빠를 것 같다」로 고르지 말고 재라.**
 * ⚠**남은 21.3초 중 11.5초는 순수 읽기다**(같은 파일 목록을 두 번 읽어 잰 값 · 129 MiB/s) —
 * **여기서 더 짜낼 것은 별로 없다.**
 */
export function scanBytes(buf: Buffer, into: CharSink, entities: boolean): readonly string[] {
  const n = buf.length;
  const bmp = into.bitmap;
  let unknown: string[] | undefined;
  for (let i = 0; i < n; i += 1) {
    const b = buf[i]!;
    if (b < 0x80) {
      bmp[b] = 1;
      if (entities && b === 0x26 /* & */) {
        // ⚠엔티티 본문은 전부 ASCII 다 — 그래서 바이트만 보고 끝낼 수 있다
        const end = Math.min(n, i + 36);
        for (let j = i + 1; j < end; j += 1) {
          const c = buf[j]!;
          if (c === 0x3b /* ; */) {
            const body = buf.toString("latin1", i + 1, j);
            const cp = entityCodePoint(body);
            // ⚠**못 푼 이름을 조용히 흘리지 않는다** — 그 글자가 요구 목록에서 빠진다
            if (cp === undefined) (unknown ??= []).push(body);
            else into.add(cp);
            break;
          }
          const ok =
            (c >= 0x30 && c <= 0x39) || (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a) || c === 0x23;
          if (!ok) break;
        }
      } else if (b === 0x5c /* \ */) {
        // ⚠**이스케이프 본문도 전부 ASCII 다.** 확장자를 안 가리고 늘 본다 —
        //   과다 계상은 시끄러울 뿐이고, 놓치면 글자가 조용히 빠진다.
        //   ⚠**건너뛰지 않는다**(`i` 를 안 민다): 이스케이프의 ASCII 는 어차피 바닥에 있다
        const cp = escapeCodePoint(buf.toString("latin1", i, Math.min(n, i + ESCAPE_WINDOW)));
        if (cp !== undefined) into.add(cp);
      }
      continue;
    }
    if (b >= 0xc2 && b <= 0xdf && i + 1 < n) {
      bmp[((b & 0x1f) << 6) | (buf[i + 1]! & 0x3f)] = 1;
      i += 1;
    } else if (b >= 0xe0 && b <= 0xef && i + 2 < n) {
      bmp[((b & 0x0f) << 12) | ((buf[i + 1]! & 0x3f) << 6) | (buf[i + 2]! & 0x3f)] = 1;
      i += 2;
    } else if (b >= 0xf0 && b <= 0xf4 && i + 3 < n) {
      // ⚠4바이트는 BMP 를 넘으므로 **비트맵이 아니라 `Set` 으로** 간다
      into.add(((b & 0x07) << 18) | ((buf[i + 1]! & 0x3f) << 12) | ((buf[i + 2]! & 0x3f) << 6) | (buf[i + 3]! & 0x3f));
      i += 3;
    }
    // ⚠**깨진 바이트는 건너뛴다** — 여기서 던지면 배포물 한 곳의 잡음이 전체를 멈춘다.
    //   손해는 「덜 세는 것」인데, 애초에 UTF-8 이 아닌 바이트는 화면에도 글자로 안 나온다.
  }
  return unknown ?? EMPTY_NAMES;
}

/** ⚠**빈 배열을 매번 새로 만들지 않는다** — 파일마다 부르는 자리다 */
const EMPTY_NAMES: readonly string[] = [];

export function scanChars(text: string, into: CharSink, entities: boolean): readonly string[] {
  const n = text.length;
  let unknown: string[] | undefined;
  for (let i = 0; i < n; i += 1) {
    const c = text.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < n) {
      const lo = text.charCodeAt(i + 1);
      if (lo >= 0xdc00 && lo <= 0xdfff) {
        into.add((c - 0xd800) * 0x400 + (lo - 0xdc00) + 0x10000);
        i += 1;
        continue;
      }
    }
    into.add(c);
    if (entities && c === 0x26 /* & */) {
      const m = ENTITY_RE.exec(text.slice(i, i + 36));
      if (m !== null) {
        const cp = entityCodePoint(m[1]!);
        if (cp === undefined) (unknown ??= []).push(m[1]!);
        else into.add(cp);
      }
    } else if (c === 0x5c /* \ */) {
      // ⚠바이트 경로와 **같은 규칙**이다(M1) — 한쪽만 풀면 `.js` 와 `.json` 이 갈린다
      const cp = escapeCodePoint(text.slice(i, i + ESCAPE_WINDOW));
      if (cp !== undefined) into.add(cp);
    }
  }
  return unknown ?? EMPTY_NAMES;
}

/**
 * `dist` 전수를 훑어 쓰이는 글자를 모은다.
 *
 * ⚠**표본이 아니다.** §5-A 의 1,183자는 9,392장 중 627장 표본이었고, 여기는 전수다.
 * ⚠**태그·속성 이름까지 통째로 센다**(마크업의 경우). 「본문만 고르는」 쪽이 정확해 보이지만
 * **덜 세는 방향으로 틀리고**, 덜 센 결과가 정확히 §5-C 가 막으려는 그 결함이다.
 * 더 세서 손해 보는 것은 ASCII 몇 자뿐이고 그건 어차피 바닥으로 깔린다.
 */
export function collectUsedChars(distDir: string): Charset {
  const sink = new CharSink();
  for (const cp of asciiFloor()) sink.add(cp);
  const commentSink = new CharSink();
  const byExtension: Record<string, number> = {};
  /** 못 푼 이름 개체 — 이름 → 횟수·처음 본 파일 */
  const unresolved = new Map<string, { count: number; where: string }>();
  let filesRead = 0;
  let bytesRead = 0;
  const noteUnknown = (names: readonly string[], rel: string): void => {
    for (const name of names) {
      const hit = unresolved.get(name);
      if (hit === undefined) unresolved.set(name, { count: 1, where: rel });
      else hit.count += 1;
    }
  };

  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const full = join(dir, entry.name);
      const rel = relative(distDir, full);
      if (rel === FONT_OUT_DIR || rel.startsWith(FONT_OUT_DIR + sep)) continue;
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      if (SKIP_NAMES.has(entry.name)) continue;
      const dot = entry.name.lastIndexOf(".");
      const ext = dot < 0 ? "" : entry.name.slice(dot).toLowerCase();
      if (!TEXT_EXTENSIONS.includes(ext)) continue;
      const raw = readFileSync(full);
      if (ext === ".js") {
        // ⚠주석을 가르려면 문자열이 필요하다. **번들은 한 장뿐이라**(실측) 비용이 안 든다
        const split = stripJsComments(raw.toString("utf8"));
        scanChars(split.code, sink, false);
        scanChars(split.comments, commentSink, false);
      } else {
        noteUnknown(scanBytes(raw, sink, ext === ".html" || ext === ".svg"), rel);
      }
      filesRead += 1;
      bytesRead += raw.length;
      byExtension[ext] = (byExtension[ext] ?? 0) + 1;
    }
  };

  const st = statSync(distDir);
  if (!st.isDirectory()) throw new Error(`dist 가 디렉터리가 아니다: ${distDir}`);
  walk(distDir);

  if (filesRead === 0) {
    // ⚠「0건 = 합격」을 만들지 않는다(루트 §1). 훑을 것이 없으면 그건 실패다.
    throw new Error(`${distDir} 에서 훑을 파일이 0개다 — 화면을 먼저 구웠는가?`);
  }
  const chars = sink.toSet();
  const commentOnly = [...commentSink.toSet()].filter((cp) => !chars.has(cp)).sort((a, b) => a - b);
  const unknownEntities = [...unresolved.entries()]
    .map(([name, v]) => ({ name, count: v.count, where: v.where }))
    .sort((a, b) => (a.name < b.name ? -1 : 1));
  return { chars, filesRead, byExtension, commentOnly, unknownEntities, bytesRead };
}

// ---------------------------------------------------------------------------
// 2. sfnt 를 읽는다 (cmap · 레이아웃 기능)
// ---------------------------------------------------------------------------

interface TableRecord {
  readonly tag: string;
  readonly offset: number;
  readonly length: number;
}

/**
 * ⚠**모르는 형식이면 던진다.** 여기서 빈 집합을 돌려주면 커버리지 검사가
 * 「전부 빠졌다」로 붉어지므로 안전한 방향이긴 하지만, **왜 붉은지 못 읽는다.**
 */
export function tableRecords(sfnt: Buffer): TableRecord[] {
  if (sfnt.length < 12) throw new Error(`sfnt 가 너무 짧다: ${sfnt.length}B`);
  const version = sfnt.readUInt32BE(0);
  if (version !== 0x00010000 && version !== 0x4f54544f && version !== 0x74727565) {
    throw new Error(`sfnt 서명이 아니다: 0x${version.toString(16)} — woff2 를 안 풀었는가?`);
  }
  const numTables = sfnt.readUInt16BE(4);
  const out: TableRecord[] = [];
  for (let i = 0; i < numTables; i += 1) {
    const base = 12 + i * 16;
    out.push({
      tag: sfnt.toString("latin1", base, base + 4),
      offset: sfnt.readUInt32BE(base + 8),
      length: sfnt.readUInt32BE(base + 12),
    });
  }
  return out;
}

/**
 * cmap 이 실제로 그릴 수 있는 코드포인트.
 *
 * ⚠**「글리프 번호가 0 이 아닌 것」만 센다.** 0(`.notdef`)에 매핑된 코드포인트는
 * 그 글자를 **못 그린다**는 뜻이고, 그걸 「덮는다」로 세면 이 검사가 통째로 거짓이 된다.
 */
export function cmapMap(sfnt: Buffer): Map<number, number> {
  const cmap = tableRecords(sfnt).find((t) => t.tag === "cmap");
  if (cmap === undefined) throw new Error("cmap 테이블이 없다");
  const base = cmap.offset;
  const numSubtables = sfnt.readUInt16BE(base + 2);

  // (3,10) UCS-4 → (3,1) BMP → (0,*) 순으로 고른다. 앞이 더 넓다
  let best: { rank: number; offset: number } | undefined;
  for (let i = 0; i < numSubtables; i += 1) {
    const rec = base + 4 + i * 8;
    const platform = sfnt.readUInt16BE(rec);
    const encoding = sfnt.readUInt16BE(rec + 2);
    const offset = base + sfnt.readUInt32BE(rec + 4);
    const rank =
      platform === 3 && encoding === 10 ? 0 : platform === 3 && encoding === 1 ? 1 : platform === 0 ? 2 : 3;
    if (best === undefined || rank < best.rank) best = { rank, offset };
  }
  if (best === undefined) throw new Error("cmap 서브테이블이 0개다");

  const out = new Map<number, number>();
  const off = best.offset;
  const format = sfnt.readUInt16BE(off);
  if (format === 4) {
    const segCount = sfnt.readUInt16BE(off + 6) / 2;
    const endBase = off + 14;
    const startBase = endBase + segCount * 2 + 2;
    const deltaBase = startBase + segCount * 2;
    const rangeBase = deltaBase + segCount * 2;
    for (let s = 0; s < segCount; s += 1) {
      const end = sfnt.readUInt16BE(endBase + s * 2);
      const start = sfnt.readUInt16BE(startBase + s * 2);
      if (start > end) continue;
      const delta = sfnt.readInt16BE(deltaBase + s * 2);
      const rangeOffset = sfnt.readUInt16BE(rangeBase + s * 2);
      for (let c = start; c <= end && c !== 0xffff; c += 1) {
        let gid: number;
        if (rangeOffset === 0) {
          gid = (c + delta) & 0xffff;
        } else {
          const gi = rangeBase + s * 2 + rangeOffset + (c - start) * 2;
          if (gi + 1 >= sfnt.length) continue;
          const raw = sfnt.readUInt16BE(gi);
          gid = raw === 0 ? 0 : (raw + delta) & 0xffff;
        }
        if (gid !== 0) out.set(c, gid);
      }
    }
  } else if (format === 12) {
    const numGroups = sfnt.readUInt32BE(off + 12);
    for (let g = 0; g < numGroups; g += 1) {
      const rec = off + 16 + g * 12;
      const start = sfnt.readUInt32BE(rec);
      const end = sfnt.readUInt32BE(rec + 4);
      const startGid = sfnt.readUInt32BE(rec + 8);
      for (let c = start; c <= end; c += 1) {
        const gid = startGid + (c - start);
        if (gid !== 0) out.set(c, gid);
      }
    }
  } else if (format === 6) {
    const first = sfnt.readUInt16BE(off + 6);
    const count = sfnt.readUInt16BE(off + 8);
    for (let i = 0; i < count; i += 1) {
      const gid = sfnt.readUInt16BE(off + 10 + i * 2);
      if (gid !== 0) out.set(first + i, gid);
    }
  } else {
    throw new Error(`cmap format ${format} 은 안 읽는다 — 읽는 법을 추가하고 나서 써라`);
  }

  if (out.size === 0) throw new Error("cmap 을 읽었는데 코드포인트가 0개다 — 읽는 방식이 헛돌고 있다");
  return out;
}

/** 그릴 수 있는 코드포인트만. ⚠**`.notdef`(0) 로 가는 것은 「덮는다」가 아니다** */
export function cmapCodePoints(sfnt: Buffer): Set<number> {
  return new Set(cmapMap(sfnt).keys());
}

/**
 * **숫자 0~9 의 진폭(advance)** — §5-A 착수 전 확인 3 이 요구한 실측이다.
 *
 * ⚠**`font-variant-numeric: tabular-nums` 는 `tnum` 기능이 있어야 도는데,
 * 그 기능이 없어도 기본 숫자가 이미 등폭이면 표는 안 흔들린다.** 둘은 다른 질문이고
 * **답해야 하는 것은 뒤쪽**이다 — 그러니 기능 목록만 보고 판정하지 마라.
 *
 * @returns 코드포인트별 진폭(폰트 단위) · `unitsPerEm`
 */
export function digitAdvances(sfnt: Buffer): { advances: Map<number, number>; unitsPerEm: number } {
  const rec = (tag: string): TableRecord => {
    const t = tableRecords(sfnt).find((x) => x.tag === tag);
    if (t === undefined) throw new Error(`${tag} 테이블이 없다`);
    return t;
  };
  const unitsPerEm = sfnt.readUInt16BE(rec("head").offset + 18);
  const numberOfHMetrics = sfnt.readUInt16BE(rec("hhea").offset + 34);
  const hmtx = rec("hmtx").offset;
  const cmap = cmapMap(sfnt);
  const advances = new Map<number, number>();
  for (let d = 0x30; d <= 0x39; d += 1) {
    const gid = cmap.get(d);
    if (gid === undefined) continue;
    // ⚠**`numberOfHMetrics` 를 넘는 글리프는 마지막 진폭을 나눠 쓴다**(스펙) — 안 그러면 범위 밖을 읽는다
    const i = Math.min(gid, numberOfHMetrics - 1);
    advances.set(d, sfnt.readUInt16BE(hmtx + i * 4));
  }
  return { advances, unitsPerEm };
}

/**
 * GSUB·GPOS 의 FeatureList 에 있는 기능 태그.
 *
 * ⚠**`palt` 가 살아 있는지 보려고 있다**(§5-A 착수 전 확인 2 — 화면이 `font-feature-settings:"palt" 1` 를 이미 켠다).
 * `tnum`(자릿수 고정)도 여기서 본다 — §5-A 3 이 등폭 코드 서체를 버리기로 했으므로 이게 없으면 표가 흔들린다.
 */
export function layoutFeatures(sfnt: Buffer): Set<string> {
  const out = new Set<string>();
  for (const tag of ["GSUB", "GPOS"] as const) {
    const rec = tableRecords(sfnt).find((t) => t.tag === tag);
    if (rec === undefined) continue;
    const featureListOffset = rec.offset + sfnt.readUInt16BE(rec.offset + 6);
    const featureCount = sfnt.readUInt16BE(featureListOffset);
    for (let i = 0; i < featureCount; i += 1) {
      out.add(sfnt.toString("latin1", featureListOffset + 2 + i * 6, featureListOffset + 6 + i * 6));
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 3. 스택 — 어느 글자를 어느 서체가 맡는가
// ---------------------------------------------------------------------------

export interface FamilySource {
  /** 산출 파일 이름의 앞부분이자 매니페스트의 키 */
  readonly key: string;
  /** `@font-face` 가 쓸 이름. ⚠**여기서 정하지 않는다 — CSS 배선이 이 값을 읽어 쓴다** */
  readonly cssFamily: string;
  /** 웨이트 → 원본 파일(저장소 루트 기준 상대경로) */
  readonly weights: Readonly<Record<number, string>>;
  /**
   * ⚠**벤더링한 파일의 sha256** — npm 이 아니라 저장소에 있는 것만 갖는다.
   * npm 쪽은 락파일의 `integrity` 가 같은 일을 하므로 `null` 이다(**「안 쟀음」이 아니다**).
   */
  readonly sha256: Readonly<Record<number, string>> | null;
  /** OFL 사본 원본 경로 */
  readonly licenseFrom: string;
  /** 배포물에 놓을 OFL 사본 이름 */
  readonly licenseAs: string;
  /** ⚠OFL 의 Reserved Font Name. **없으면 `null` 이라고 적는다** — 「안 봤음」과 구별해야 한다 */
  readonly reservedFontName: string | null;
}

export interface Stack {
  readonly key: string;
  readonly label: string;
  /**
   * ⚠**앞이 이긴다** — 브라우저의 글꼴 스택 규칙 그대로다.
   * 라틴이 앞이므로 라틴 글자는 라틴 서체가 맡고, 한자는 뒤의 일본어 서체가 맡는다.
   */
  readonly order: readonly FamilySource[];
}

/**
 * 우리가 내보내는 웨이트.
 *
 * ⚠**토큰이 셋뿐이다**(`--w-reg:400 --w-semi:600 --w-bold:700` · `assets.ts` 실측).
 * CSS 에 `font-weight:500`(표 머리)과 `800`(순위 1위)이 각 1곳 있는데, 웨이트 매칭 규칙상
 * **500 → 400 · 800 → 700** 로 붙는다. **합성 굵게가 아니라 실제 페이스 선택**이다.
 * ⚠**늘리면 값이 붙는다**: Plex JP 는 저장소가 **2.3 MB/웨이트** 늘고(벤더링이라)
 * 굽는 시간도 그만큼 는다. **재 보고 정해라.**
 */
export const WEIGHTS: readonly number[] = [400, 600, 700];

/**
 * 저장소 루트. ⚠**cwd 에 기대지 않는다** — 시험과 빌드가 다른 데서 돌아도 같은 파일을 봐야 한다.
 */
export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** 저장소 루트 기준 경로를 실제 경로로 */
export function fromRoot(rel: string): string {
  return join(REPO_ROOT, rel);
}

/**
 * **원본을 읽으면서 적어 둔 sha256 과 대조한다**(2026-09-08 3차 검토 · P2 · 공급망).
 *
 * ⚠**~~시험이 지킨다~~ 로는 부족했다.** `npm test` 와 `npm run build:fonts` 는 **별개 실행**이라
 * **시험을 건너뛰고 빌드만 돌리면** 갈린 폰트 바이트가 그대로 부분집합에 들어간다 —
 * 그러면 글리프가 통째로 달라져도 **아무것도 안 운다.**
 * **게이트는 바이트를 읽는 그 자리에 있어야 한다.**
 *
 * ⚠**여기서 던지는 것이 맞다** — 「나중에 모아서 보고」로 미루면 **이미 갈린 바이트로 구운 뒤**가 된다.
 * ⚠**`want` 가 `undefined` 인 것은 「안 쟀음」이 아니다** — npm 쪽은 락파일의 `integrity` 가
 * 같은 일을 한다(`FamilySource.sha256` 주석). 부르는 쪽이 그 수를 분모로 찍는다.
 */
export function readVerified(rel: string, want: string | undefined, label: string): Buffer {
  const buf = readFileSync(fromRoot(rel));
  if (want === undefined) return buf;
  const got = createHash("sha256").update(buf).digest("hex");
  if (got !== want) {
    throw new Error(
      `⚠${label} 의 원본이 적어 둔 sha256 과 다르다 — 조용한 교체를 여기서 세운다.\n` +
        `  파일: ${rel}\n  적어 둔 값: ${want}\n  읽은 값:   ${got}\n` +
        "  → 일부러 바꿨다면 scripts/fonts.ts 의 sha256 과 vendor/fonts/ibm-plex/README.md 를 같이 고쳐라.",
    );
  }
  return buf;
}

/**
 * ⚠**IBM Plex 만 저장소에 있고 Noto 는 npm 이다. 층이 다르니 통일하지 마라.**
 *
 * Plex 는 `@ibm/plex-sans{,-jp}` 가 **`postinstall: ibmtelemetry` 를 달아서** 못 쓴다 —
 * 그 스크립트는 `contents: write` 와 배포 토큰이 도는 잡에서 실행되고,
 * `scripts/test/install-scripts.test.ts` 가 「**무엇을 놓는지** 적어라」를 요구한다.
 * 텔레메트리는 아무것도 안 놓는다. 사유가 성립하지 않으므로 **파일만 가져왔다**
 * (출처·해시·대안 비교는 `vendor/fonts/ibm-plex/README.md`).
 *
 * Noto(`@expo-google-fonts/*`)는 **설치 스크립트가 0개**라 npm 으로 고정한다 —
 * 저장소 바이트를 안 쓰는 쪽이 낫다.
 */
export function stacks(): Stack[] {
  const V = "vendor/fonts/ibm-plex";
  const plexWeights = (prefix: string): Record<number, string> => ({
    400: `${V}/${prefix}-Regular.woff2`,
    600: `${V}/${prefix}-SemiBold.woff2`,
    700: `${V}/${prefix}-Bold.woff2`,
  });
  const notoWeights = (pkg: string, prefix: string): Record<number, string> => ({
    400: `node_modules/@expo-google-fonts/${pkg}/400Regular/${prefix}_400Regular.ttf`,
    600: `node_modules/@expo-google-fonts/${pkg}/600SemiBold/${prefix}_600SemiBold.ttf`,
    700: `node_modules/@expo-google-fonts/${pkg}/700Bold/${prefix}_700Bold.ttf`,
  });

  return [
    {
      key: "plex",
      label: "IBM Plex",
      order: [
        {
          key: "plex-latin",
          cssFamily: "IBM Plex Sans",
          weights: plexWeights("IBMPlexSans"),
          sha256: {
            400: "ba711a3085ff9f27440b6b9c4550cfc47c97bf36591d5da958b975bb3add8c1a",
            600: "f78048030eab62e860efa39a0df79e2e5581bf122eb95b9bc42c0b8a4988d205",
            700: "fa7130d854a660b39a7fc9e6e0f2dc23dba5f1346e2adea3e1fe37b6d884133d",
          },
          licenseFrom: `${V}/OFL.txt`,
          licenseAs: "OFL-IBM-Plex.txt",
          reservedFontName: "Plex",
        },
        {
          key: "plex-jp",
          cssFamily: "IBM Plex Sans JP",
          weights: plexWeights("IBMPlexSansJP"),
          sha256: {
            400: "ec27e9b75cd90a6f7abe96ede49d00b151eb5b1c2c886bfe9b4fc845f40be1ff",
            600: "88c41ab69fd76c6211b47332d855d58ed20359b01b24e8bd2697c2c87e181f2c",
            700: "38336fbb169ae1b7b6ca2539332e1d59c9be222227659d23f8eb70ecda60337d",
          },
          licenseFrom: `${V}/OFL.txt`,
          licenseAs: "OFL-IBM-Plex.txt",
          reservedFontName: "Plex",
        },
      ],
    },
    {
      key: "noto",
      label: "Noto Sans JP",
      order: [
        {
          key: "noto-latin",
          cssFamily: "Noto Sans",
          weights: notoWeights("noto-sans", "NotoSans"),
          sha256: null,
          licenseFrom: "node_modules/@expo-google-fonts/noto-sans/LICENSE_FONT",
          licenseAs: "OFL-Noto-Sans.txt",
          reservedFontName: null,
        },
        {
          key: "noto-jp",
          cssFamily: "Noto Sans JP",
          weights: notoWeights("noto-sans-jp", "NotoSansJP"),
          sha256: null,
          licenseFrom: "node_modules/@expo-google-fonts/noto-sans-jp/LICENSE_FONT",
          licenseAs: "OFL-Noto-Sans-JP.txt",
          // ⚠Noto Sans JP 의 OFL 은 Adobe Source Han 계열이라 **예약명이 `Source` 다** — `Noto` 가 아니다
          reservedFontName: "Source",
        },
      ],
    },
  ];
}

export interface Assignment {
  /** 서체 키 → 그 서체가 맡은 코드포인트 */
  readonly perFamily: ReadonlyMap<string, Set<number>>;
  /** ⚠**스택 안 어느 서체도 못 덮는 글자.** 비어 있지 않으면 빌드가 실패한다 */
  readonly missing: number[];
}

/**
 * 브라우저 규칙대로 글자를 나눈다 — **앞에서부터, 가진 놈이 맡는다.**
 *
 * ⚠**라틴 폰트에 한자를 요구하지 않는다**(§7-1 P2). 그 요구가 「Plex 는 못 쓴다」는
 * 거짓 결론을 만든다.
 */
export function assign(chars: ReadonlySet<number>, stack: Stack, cmaps: ReadonlyMap<string, ReadonlySet<number>>): Assignment {
  const perFamily = new Map<string, Set<number>>();
  for (const fam of stack.order) perFamily.set(fam.key, new Set<number>());
  const missing: number[] = [];

  for (const cp of [...chars].sort((a, b) => a - b)) {
    let placed = false;
    for (const fam of stack.order) {
      const cmap = cmaps.get(fam.key);
      if (cmap === undefined) throw new Error(`${fam.key} 의 cmap 을 안 읽었다 — 이 검사가 공회전한다`);
      if (cmap.has(cp)) {
        perFamily.get(fam.key)!.add(cp);
        placed = true;
        break;
      }
    }
    if (!placed) missing.push(cp);
  }
  return { perFamily, missing };
}

/**
 * **산출물이 실제로 그 글자를 갖는가.**
 *
 * ⚠**원본이 아니라 배포되는 파일을 받는다**(§7-1 P1). 원본에는 있는데 부분집합에서
 * 빠지는 일이 실재하고, 그게 이 검사의 존재 이유다.
 */
export function verifyCoverage(producedSfnt: Buffer, required: ReadonlySet<number>): number[] {
  const have = cmapCodePoints(producedSfnt);
  return [...required].filter((cp) => !have.has(cp)).sort((a, b) => a - b);
}

// ---------------------------------------------------------------------------
// 4. 이름 · 보고 형식
// ---------------------------------------------------------------------------

/**
 * 파일 이름에 **내용 해시**를 넣는다(§7-1 P2).
 *
 * ⚠**이 저장소는 캐시 불일치로 실제 사고를 겪었다**(CLAUDE.md §6 · 2026-08-30).
 * 부분집합이 바뀌면 URL 이 바뀌어야 새 HTML 이 옛 폰트를 물지 않는다.
 */
export function hashedName(familyKey: string, weight: number, bytes: Buffer): string {
  const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 10);
  return `${familyKey}-${weight}.${hash}.woff2`;
}

/** 사람이 읽을 수 있게. ⚠**빠진 글자는 전부 출력한다**(§5-C 3) — 「일부」로 줄이지 마라 */
export function describeChars(cps: readonly number[]): string {
  return cps
    .map((cp) => `U+${cp.toString(16).toUpperCase().padStart(4, "0")} ${JSON.stringify(String.fromCodePoint(cp))}`)
    .join("\n  ");
}

/** 글자를 갈래로 나눠 센다 — 보고용. §5-A 의 표와 같은 축이다 */
export function breakdown(chars: ReadonlySet<number>): Record<string, number> {
  let ascii = 0;
  let hira = 0;
  let kata = 0;
  let kanji = 0;
  let other = 0;
  for (const cp of chars) {
    if (cp <= 0x7f) ascii += 1;
    else if (cp >= 0x3040 && cp <= 0x309f) hira += 1;
    else if ((cp >= 0x30a0 && cp <= 0x30ff) || (cp >= 0x31f0 && cp <= 0x31ff)) kata += 1;
    else if (
      (cp >= 0x3400 && cp <= 0x4dbf) ||
      (cp >= 0x4e00 && cp <= 0x9fff) ||
      (cp >= 0xf900 && cp <= 0xfaff) ||
      (cp >= 0x20000 && cp <= 0x2fa1f)
    )
      kanji += 1;
    else other += 1;
  }
  return { ASCII: ascii, "ひらがな": hira, "カタカナ": kata, "漢字": kanji, "記号など": other };
}
