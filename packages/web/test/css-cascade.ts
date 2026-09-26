/**
 * 시험용 **CSS 캐스케이드 계산기** — 정적 CSS 에서 「이 요소의 최종 값」을 구한다.
 *
 * ⚠**문자열로는 특이도 싸움을 못 본다**(2026-09-27 · 감사 N9). 강제 색 블록의
 * `.card[aria-selected="true"]{outline:…}`(0,2,0)가 전역 `:focus-visible`(0,1,0)을 이겨
 * **초점이 와도 모양이 같았는데**, 이 저장소의 시험은 선택자 문자열이 「있는가」만 봤다.
 * 여기서는 규칙을 **특이도 → 소스 순서**(`!important` 는 그 위)로 겨루게 한다.
 *
 * ## 한계 — 조용히 틀리지 않게 **던진다**
 * - 결합자(공백·`>`·`+`·`~`)는 전부 「조상 어딘가에 있다」로 근사한다. 요소가 `ancestors` 를 주면 그걸로
 *   맞춰 보고, 안 주면 조상 조건은 맞는다고 본다(그래서 결과를 쓰는 시험이 조상을 적어 두는 편이 정확하다).
 * - 주어의 타입 선택자는 요소의 `tag` 로 맞춘다. 모르는 의사 클래스를 만나면 **던진다**.
 * - 가상 요소(`::before` 등)를 가진 선택자는 요소 자신에 맞지 않는다고 본다.
 * - 스타일 규칙 안의 중첩(`&`)은 없다고 보고, 있으면 던진다.
 */

/** 한 요소 — 계산할 대상 */
export interface El {
  tag: string;
  classes: readonly string[];
  /**
   * 요소의 id. **없으면 id 가 없는 요소**로 잰다 — `#x` 는 맞지 않는다.
   * ⚠**실제 요소에 id 가 있으면 반드시 적어라**(2026-09-27 · PR-D 검토 P3). 예전엔 이 칸이 아예 없어
   * `#favBtn{…}` 이 언제나 「불일치」였고, 브라우저에서 이기는 id 규칙을 계산기가 조용히 놓쳤다.
   */
  id?: string;
  attrs?: Readonly<Record<string, string>>;
  /** `:focus-visible`·`:focus`·`:focus-within` 에 맞는가 */
  focused?: boolean;
  /** 문서 뿌리(`:root`)인가 — 토큰(사용자 정의 속성)을 풀 때만 쓴다 */
  root?: boolean;
  /** 조상들. 주면 결합자 앞 조건을 이걸로 맞춘다(순서는 안 본다) */
  ancestors?: readonly Omit<El, "ancestors" | "focused">[];
}

export interface Rule {
  /** 쉼표로 나눈 선택자들 */
  parts: string[];
  body: string;
  /** 소스 순서 */
  order: number;
  /** 감싼 `@media` 조건. 무조건이면 null */
  media: string | null;
}

/** 괄호·대괄호·따옴표 밖에서만 나눈다 */
function splitTop(s: string, isSep: (c: string) => boolean): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let cur = "";
  for (const c of s) {
    if (quote !== null) {
      cur += c;
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    else if (c === "(" || c === "[") depth += 1;
    else if (c === ")" || c === "]") depth -= 1;
    if (depth === 0 && isSep(c)) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += c;
  }
  out.push(cur);
  return out;
}

/** CSS 전체를 규칙 목록으로. `@media` 안의 것은 그 조건을 달고, 그 밖의 at-규칙(@keyframes 등)은 건너뛴다 */
export function parseRules(source: string): Rule[] {
  const css = source.replace(/\/\*[\s\S]*?\*\//g, "");
  const out: Rule[] = [];
  let order = 0;
  const walk = (from: number, to: number, media: string | null): void => {
    let i = from;
    while (i < to) {
      const open = css.indexOf("{", i);
      if (open === -1 || open >= to) return;
      const prelude = css.slice(i, open).trim();
      // 짝이 맞는 닫는 괄호
      let depth = 0;
      let j = open;
      for (; j < to; j += 1) {
        if (css[j] === "{") depth += 1;
        else if (css[j] === "}") {
          depth -= 1;
          if (depth === 0) break;
        }
      }
      if (j >= to) throw new Error(`닫는 괄호를 못 찾았다: ${prelude.slice(0, 60)}`);
      if (prelude.startsWith("@media")) {
        const q = prelude.slice("@media".length).trim();
        walk(open + 1, j, media === null ? q : `${media} and ${q}`);
      } else if (!prelude.startsWith("@") && prelude !== "") {
        const body = css.slice(open + 1, j);
        if (body.includes("{")) throw new Error(`중첩된 스타일 규칙은 모른다: ${prelude.slice(0, 60)}`);
        out.push({
          parts: splitTop(prelude, (c) => c === ",").map((p) => p.trim().replace(/\s+/g, " ")).filter((p) => p !== ""),
          body,
          order: order++,
          media,
        });
      }
      i = j + 1;
    }
  };
  walk(0, css.length, null);
  return out;
}

type Spec = [number, number, number];
const add = (a: Spec, b: Spec): Spec => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const gt = (a: Spec, b: Spec): boolean => a[0] !== b[0] ? a[0] > b[0] : a[1] !== b[1] ? a[1] > b[1] : a[2] > b[2];

interface Compound {
  tag: string | null;
  ids: string[];
  classes: string[];
  attrs: { name: string; op: "=" | "^=" | null; value: string | null }[];
  pseudos: { name: string; arg: string | null }[];
  pseudoElement: boolean;
}

/** 복합 선택자 하나를 단순 선택자로 쪼갠다 */
function parseCompound(src: string): Compound {
  const c: Compound = { tag: null, ids: [], classes: [], attrs: [], pseudos: [], pseudoElement: false };
  let i = 0;
  const ident = (): string => {
    const m = /^-?[_a-zA-Z][\w-]*/.exec(src.slice(i));
    if (m === null) throw new Error(`식별자를 못 읽었다: 「${src}」 의 ${i}번째`);
    i += m[0].length;
    return m[0];
  };
  if (src[0] === "*") i = 1;
  else if (/^[a-zA-Z]/.test(src)) c.tag = ident().toLowerCase();
  while (i < src.length) {
    const ch = src[i];
    if (ch === ".") { i += 1; c.classes.push(ident()); }
    else if (ch === "#") { i += 1; c.ids.push(ident()); }
    else if (ch === "[") {
      const end = src.indexOf("]", i);
      const inner = src.slice(i + 1, end);
      i = end + 1;
      // ⚠**이 CSS 가 쓰는 연산자는 `=` 와 `^=` 둘뿐이다**(실측) — 모르는 연산자는 던진다
      const m = /^([\w-]+)\s*(?:(\^?=)\s*(?:"([^"]*)"|'([^']*)'|([\w-]+)))?$/.exec(inner.trim());
      if (m === null) throw new Error(`모르는 속성 선택자: [${inner}]`);
      c.attrs.push({
        name: m[1]!,
        op: (m[2] as "=" | "^=" | undefined) ?? null,
        value: m[2] === undefined ? null : (m[3] ?? m[4] ?? m[5] ?? ""),
      });
    } else if (src.startsWith("::", i)) {
      i += 2;
      ident();
      c.pseudoElement = true;
    } else if (ch === ":") {
      i += 1;
      const name = ident().toLowerCase();
      let arg: string | null = null;
      if (src[i] === "(") {
        let depth = 0;
        let j = i;
        for (; j < src.length; j += 1) {
          if (src[j] === "(") depth += 1;
          else if (src[j] === ")") { depth -= 1; if (depth === 0) break; }
        }
        arg = src.slice(i + 1, j);
        i = j + 1;
      }
      c.pseudos.push({ name, arg });
    } else throw new Error(`모르는 선택자 문자 「${ch}」: ${src}`);
  }
  return c;
}

function listOf(arg: string): Compound[] {
  return splitTop(arg, (c) => c === ",").map((p) => {
    const t = p.trim();
    if (splitTop(t, (c) => c === " " || c === ">" || c === "+" || c === "~").filter((x) => x !== "").length > 1) {
      throw new Error(`의사 클래스 안의 결합자는 모른다: (${arg})`);
    }
    return parseCompound(t);
  });
}

function specOf(c: Compound): Spec {
  let s: Spec = [c.ids.length, c.classes.length + c.attrs.length, (c.tag === null ? 0 : 1) + (c.pseudoElement ? 1 : 0)];
  for (const p of c.pseudos) {
    if (p.name === "where") continue;
    if (p.name === "not" || p.name === "is") {
      s = add(s, listOf(p.arg ?? "").map(specOf).reduce((m, x) => (gt(x, m) ? x : m), [0, 0, 0] as Spec));
      continue;
    }
    s = add(s, [0, 1, 0]);
  }
  return s;
}

type Node = Omit<El, "ancestors" | "focused"> & { focused?: boolean };

/** 태그·클래스·속성·id 만 본다 */
function matchesStatic(c: Compound, el: Node): boolean {
  // ⚠**id 는 요소의 id 와 맞춘다** — 예전엔 id 가 있으면 무조건 false 였다(PR-D 검토 P3)
  if (!c.ids.every((i) => i === el.id)) return false;
  if (!c.classes.every((k) => el.classes.includes(k))) return false;
  for (const a of c.attrs) {
    const v = el.attrs?.[a.name];
    if (v === undefined) return false;
    if (a.op === "=" && v !== a.value) return false;
    if (a.op === "^=" && !v.startsWith(a.value ?? "")) return false;
  }
  if (c.tag !== null && c.tag !== el.tag) return false;
  return true;
}

function matches(c: Compound, el: Node, subject: boolean): boolean {
  if (c.pseudoElement) return false;
  if (!matchesStatic(c, el)) return false;
  for (const p of c.pseudos) {
    switch (p.name) {
      case "focus-visible":
      case "focus":
      case "focus-within":
        if (!(subject && el.focused === true)) return false;
        break;
      case "root":
        if (!(subject && el.root === true)) return false;
        break;
      // 손을 대지 않은 · 체크 안 된 · 켜진 요소로 잰다
      case "hover":
      case "active":
      case "checked":
      case "disabled":
      case "target":
        return false;
      case "not":
        if (listOf(p.arg ?? "").some((x) => matches(x, el, subject))) return false;
        break;
      case "is":
      case "where":
        if (!listOf(p.arg ?? "").some((x) => matches(x, el, subject))) return false;
        break;
      default:
        throw new Error(`모르는 의사 클래스 :${p.name} — 이 계산기가 판정할 수 없다(조용히 틀리지 않게 던진다)`);
    }
  }
  return true;
}

/** 선택자 하나가 요소에 맞으면 그 특이도, 아니면 null */
export function match(part: string, el: El): Spec | null {
  const compounds = splitTop(part, (c) => c === " " || c === ">" || c === "+" || c === "~")
    .map((x) => x.trim())
    .filter((x) => x !== "")
    .map(parseCompound);
  const subject = compounds.at(-1);
  if (subject === undefined) return null;
  if (!matches(subject, el, true)) return null;
  if (el.ancestors !== undefined) {
    for (const up of compounds.slice(0, -1)) {
      if (!el.ancestors.some((a) => matches(up, a, false))) return null;
    }
  }
  return compounds.map(specOf).reduce(add, [0, 0, 0] as Spec);
}

/** 롱핸드 → 그것을 싣는 숏핸드와 그 숏핸드에서 롱핸드 값을 꺼내는 함수 */
const OUTLINE_STYLE = /^(?:none|auto|solid|dashed|dotted|double|groove|ridge|inset|outset)$/;
const OUTLINE_WIDTH = /^(?:thin|medium|thick|-?\d*\.?\d+(?:px|em|rem)?|0)$/;
function fromShorthand(prop: string, short: string, value: string): string | undefined {
  if (short !== "outline") return undefined;
  const toks = value.trim().split(/\s+/);
  if (prop === "outline-style") return toks.find((t) => OUTLINE_STYLE.test(t)) ?? "none";
  if (prop === "outline-width") return toks.find((t) => OUTLINE_WIDTH.test(t)) ?? "medium";
  if (prop === "outline-color") return toks.find((t) => !OUTLINE_STYLE.test(t) && !OUTLINE_WIDTH.test(t)) ?? "currentcolor";
  return undefined;
}
const SHORTHAND_OF: Readonly<Record<string, string>> = {
  "outline-style": "outline",
  "outline-width": "outline",
  "outline-color": "outline",
};

/**
 * 그 요소의 `prop` 최종 값. 선언이 없으면 undefined.
 * @param mediaOk 이 `@media` 조건을 켤 것인가. 무조건 규칙은 늘 켠다
 */
export function computed(rules: readonly Rule[], el: El, prop: string, mediaOk: (q: string) => boolean = () => false): string | undefined {
  let best: { imp: boolean; spec: Spec; order: number; value: string } | null = null;
  const short = SHORTHAND_OF[prop];
  for (const r of rules) {
    if (r.media !== null && !mediaOk(r.media)) continue;
    /**
     * ⚠**그 속성을 선언한 규칙만 선택자를 맞춰 본다.** 모르는 의사 클래스(`:has` 등)는
     * **값에 영향을 줄 수 있는 규칙에서만** 던진다 — 무관한 규칙 때문에 계산 전체가 멈추지 않게.
     * ⚠**`[\w-]` 다** — 토큰 이름에는 숫자가 들어간다(`--s8` · `--fs-num`). `[a-z-]` 면 토큰을 못 읽는다.
     */
    const decls: { imp: boolean; value: string }[] = [];
    for (const d of r.body.matchAll(/(?:^|;)\s*([\w-]+)\s*:\s*([^;]+)/g)) {
      const name = d[1]!;
      let raw = d[2]!.trim();
      const imp = /!important$/.test(raw);
      if (imp) raw = raw.replace(/\s*!important$/, "");
      let value: string | undefined;
      if (name === prop) value = raw;
      else if (short !== undefined && name === short) value = fromShorthand(prop, short, raw);
      if (value !== undefined) decls.push({ imp, value });
    }
    if (decls.length === 0) continue;
    let spec: Spec | null = null;
    for (const p of r.parts) {
      const s = match(p, el);
      if (s !== null && (spec === null || gt(s, spec))) spec = s;
    }
    if (spec === null) continue;
    for (const { imp, value } of decls) {
      const cand = { imp, spec, order: r.order, value };
      if (
        best === null ||
        (cand.imp && !best.imp) ||
        (cand.imp === best.imp && (gt(cand.spec, best.spec) || (!gt(best.spec, cand.spec) && cand.order >= best.order)))
      ) {
        best = cand;
      }
    }
  }
  return best?.value;
}

/**
 * 길이 값을 px 로 푼다 — `24px` · `var(--hit)`(`:root` 의 토큰을 **캐스케이드대로** 따라간다).
 *
 * ⚠**켠 미디어 안의 `:root` 재정의도 반영한다**(2026-09-27 · PR-D 검토 P3). 옛 판은 첫 `@media` 앞의
 *   `:root` 만 읽어서, `@media (pointer:coarse){:root{--hit:20px}}` 를 넣어도 손가락 장면이 24px 로 통과했다.
 * ⚠**모르는 형태는 던진다**(`calc()` · `em` · 토큰 없음) — 못 푼 것을 0 이나 통과로 흘리지 않는다.
 * ⚠**요소 단위 재정의(`.x{--hit:…}`)는 모른다** — 상속을 따라가야 하는데 이 계산기는 조상 값을 안 들고 다닌다.
 *   그런 선언이 있으면 **던진다**(`:root` 값을 조용히 내지 않는다).
 * @param mediaOk 켤 `@media` 조건 — `computed` 에 주는 것과 같은 것을 준다
 */
export function toPx(source: string, value: string, mediaOk: (q: string) => boolean = () => false): number {
  const rules = parseRules(source);
  const root: El = { tag: "html", classes: [], root: true };
  const seen = new Set<string>();
  let v = value.trim();
  for (;;) {
    const px = /^(-?\d*\.?\d+)px$/.exec(v);
    if (px !== null) return Number(px[1]);
    if (v === "0") return 0;
    const ref = /^var\(\s*(--[\w-]+)\s*\)$/.exec(v);
    if (ref === null) throw new Error(`px 로 풀 수 없는 값: ${value}`);
    const name = ref[1]!;
    if (seen.has(name)) throw new Error(`토큰이 돌고 돈다: ${name}`);
    seen.add(name);
    const declares = new RegExp(`(?:^|;)\\s*${name}\\s*:`);
    for (const r of rules) {
      if (!declares.test(r.body)) continue;
      const other = r.parts.filter((p) => !/^:root(?:$|[:[])/.test(p));
      if (other.length > 0) throw new Error(`요소 단위 재정의는 이 계산기가 모른다: ${other.join(", ")}{${name}:…}`);
    }
    const won = computed(rules, root, name, mediaOk);
    if (won === undefined) throw new Error(`:root 에 없는 토큰: ${name}`);
    v = won.trim();
  }
}

/** 복합 선택자 하나(`.card[aria-selected="true"]`)에서 요소를 만든다 */
export function elementOf(compound: string, tag: string): El {
  const c = parseCompound(compound);
  if (c.pseudos.length > 0 || c.pseudoElement) throw new Error(`의사 클래스·요소가 붙은 선택자로 요소를 만들 수 없다: ${compound}`);
  if (new Set(c.ids).size > 1) throw new Error(`id 가 둘인 요소는 없다: ${compound}`);
  return {
    tag,
    classes: c.classes,
    attrs: Object.fromEntries(c.attrs.map((a) => {
      if (a.op === "^=") throw new Error(`앞머리 일치(^=)로는 요소의 값을 정할 수 없다: ${compound}`);
      return [a.name, a.value ?? ""];
    })),
    ...(c.ids.length === 0 ? {} : { id: c.ids[0]! }),
  };
}
