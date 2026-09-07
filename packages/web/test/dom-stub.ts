/**
 * 최소 DOM 스텁 — 클라이언트 스크립트를 **실행해서** 검증하기 위한 것.
 *
 * ⚠**브라우저가 아니다.** 여기서 통과하는 것은 「우리 로직이 의도대로 도는가」이지
 * 「브라우저에서 보이는가」가 아니다. 실기 확인을 대신하지 않는다.
 * ⚠지원하는 선택자는 클라이언트가 실제로 쓰는 것뿐이다 — `#id` · `.class` · `[attr]` ·
 * `[attr="v"]`와 공백(자손) 결합. 그 밖의 문법을 쓰면 **조용히 빈 결과가 아니라 예외**가 난다.
 */

export interface StubStyle {
  [property: string]: string | ((name: string, value: string) => void) | ((name: string) => string) | undefined;
  setProperty(name: string, value: string): void;
  /**
   * ⚠**실제 DOM 에는 있는데 스텁에 없었다.** 사용자 정의 속성(`--x`)은
   * `style["--x"]` 로는 못 읽는 것이 표준이고 `getPropertyValue` 로 읽는다 —
   * 스텁이 그 짝을 안 갖고 있어서, 그렇게 읽는 시험이 조용히 `undefined` 를 받았다.
   * **스텁이 실제와 다르면 시험은 실제를 재지 않는다**(2026-08-17).
   */
  getPropertyValue(name: string): string;
}

function makeStyle(): StubStyle {
  const style = {
    setProperty(name: string, value: string): void {
      style[name] = value;
    },
    getPropertyValue(name: string): string {
      const v = style[name];
      return typeof v === "string" ? v : "";
    },
  } as StubStyle;
  return style;
}

export class El {
  readonly tagName: string;
  /**
   * ⚠**실제 DOM 에는 있는데 스텁에 없었다.** 이벤트의 `target` 에서 조상을 거슬러 올라가며
   * 「이 노드가 요소인가」를 묻는 코드가 있는데(용어 설명이 스크롤에 자리를 다시 잡을 때
   * **툴팁 안을 굴린 것인지** 가리는 자리), 스텁에서는 `undefined === 1` 이 되어
   * **그 분기가 통째로 안 돌았다.** 스텁이 실물과 다르면 시험은 실물을 재지 않는다.
   */
  readonly nodeType = 1;
  readonly children: El[] = [];
  readonly attrs: Record<string, string> = {};
  readonly dataset: Record<string, string> = {};
  /** `el.style.setProperty("--i","3")`도 쓰이므로 순수 객체가 아니다 */
  readonly style: StubStyle = makeStyle();
  readonly listeners: Record<string, ((e: unknown) => void)[]> = {};
  parentNode: El | null = null;
  hidden = false;
  checked = false;
  disabled = false;
  type = "";
  /**
   * 기하(幾何). ⚠**스텁에는 레이아웃이 없으므로 시험이 손으로 넣는다.**
   *
   * ⚠**기본값 0은 「아무 일도 안 일어남」이다** — `scrollWidth > clientWidth+1` 이 거짓이라
   * 넘침 판정이 발동하지 않는다. 즉 이 값을 안 쓰는 기존 시험의 뜻은 그대로다.
   * 여태 이 속성들이 아예 없어서 가로스크롤 접근성 코드가 **한 번도 실행되지 않았다**
   * (`typeof el.scrollWidth!=="number"` 에서 조기 반환) — 그래서 감사 전까지 결함이 살아 있었다.
   */
  scrollWidth = 0;
  clientWidth = 0;
  offsetLeft = 0;
  offsetWidth = 0;
  /**
   * 가로로 얼마나 밀려 있는가. ⚠**실제 요소에는 언제나 있고 초기값이 0 이다.**
   * 없으면 `el.scrollLeft += n` 이 `undefined + n = NaN` 이 되어, 시험이
   * **「굴리지 않았다」와 「굴렸는데 값이 NaN 이다」를 구별하지 못한다.**
   */
  scrollLeft = 0;
  #text = "";
  #value: string | null = null;

  /** input의 입력값이자 option의 `value` 속성 — 둘을 같은 이름으로 읽는 코드가 있다 */
  get value(): string {
    return this.#value ?? this.getAttribute("value") ?? "";
  }
  set value(v: string) {
    this.#value = v;
  }

  /** select의 선택지 */
  get options(): El[] {
    return this.children.filter((c) => c.tagName === "OPTION");
  }

  /** 지금 값과 일치하는 선택지의 위치. 없으면 -1(브라우저와 같다) */
  get selectedIndex(): number {
    return this.options.findIndex((o) => o.value === this.value);
  }

  constructor(tag: string) {
    this.tagName = tag.toUpperCase();
  }

  get className(): string {
    return this.attrs["class"] ?? "";
  }
  set className(v: string) {
    this.attrs["class"] = v;
  }

  get id(): string {
    return this.attrs["id"] ?? "";
  }
  set id(v: string) {
    this.attrs["id"] = v;
  }

  /**
   * 링크 주소.
   *
   * ⚠**실제 DOM 에서 `a.href = x` 는 속성에 반영된다.** 스텁에 그 짝이 없어서, 클라이언트가
   * 만든 링크의 **목적지를 시험이 읽을 방법이 없었다**(`getAttribute("href")` 가 늘 `null`).
   * `className`·`id` 와 같은 종류의 구멍이다 — 실물과 다른 만큼 시험이 지키는 것이 줄어든다.
   * ⚠**한 가지는 실물과 다르다**: 브라우저의 `a.href` 게터는 **절대 URL** 을 돌려주고
   * 원문은 `getAttribute("href")` 가 돌려준다. 여기서는 둘 다 원문이다 —
   * 이 대역이 재는 것은 「어디를 가리키는가」이지 URL 해석이 아니다.
   */
  get href(): string {
    return this.attrs["href"] ?? "";
  }
  set href(v: string) {
    this.attrs["href"] = v;
  }

  get textContent(): string {
    return this.children.length === 0 ? this.#text : this.children.map((c) => c.textContent).join("");
  }
  /**
   * ⚠**떼어 낸 자식의 `parentNode` 를 비운다** — 실제 DOM 이 그렇게 한다.
   * 안 비우면 그 자식을 **다시 붙일 때** `detach()` 가 `indexOf` 로 −1 을 받아
   * `splice(-1,1)` 로 **엉뚱한 마지막 자식을 지운다.** 실제로 「글자를 갈아 끼우고
   * 표식을 다시 붙인다」가 스텁에서만 깨졌다(2026-09-07).
   */
  set textContent(v: string) {
    for (const c of this.children) c.parentNode = null;
    this.children.length = 0;
    this.#text = v;
  }

  setAttribute(k: string, v: string): void {
    this.attrs[k] = String(v);
    if (k.startsWith("data-")) {
      this.dataset[k.slice(5).replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())] = String(v);
    }
  }
  getAttribute(k: string): string | null {
    return this.attrs[k] ?? null;
  }

  /**
   * ⚠**스텁에 없어서 클라이언트가 터졌다**(2026-08-18). 실제 DOM 에는 있는 메서드인데
   * 여기 없으면 **브라우저에서는 되는 코드가 시험에서만 죽는다** — 반대 방향의 거짓말이라
   * 알아채기는 쉽지만, 그때마다 「시험을 피해 코드를 고치는」 유혹이 생긴다.
   * 스텁이 실물에서 멀어질수록 시험이 지키는 것이 줄어든다.
   */
  hasAttribute(k: string): boolean {
    return this.attrs[k] !== undefined;
  }

  removeAttribute(k: string): void {
    delete this.attrs[k];
    if (k.startsWith("data-")) {
      delete this.dataset[k.slice(5).replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())];
    }
  }


  appendChild(c: El): El {
    /**
     * ⚠**조각은 자기 자식을 넘기고 사라진다** — 진짜 DOM 이 그렇게 한다.
     * 그대로 넣으면 `tbody` 아래에 `#FRAGMENT` 한 개가 붙고, `querySelectorAll("tr")` 이
     * **그 안의 행을 못 찾는다** — 시험이 「행이 안 붙었다」고 말하는데 실은 붙어 있는 상태다.
     */
    if (c.tagName === "#FRAGMENT") {
      for (const child of [...c.children]) this.appendChild(child);
      c.children.length = 0;
      return c;
    }
    c.detach();
    c.parentNode = this;
    this.children.push(c);
    return c;
  }

  /**
   * 자기 자신을 부모에서 뗀다.
   *
   * ⚠**없어서 「もっと見る」로 붙인 행을 지우는 경로가 죽었다**(2026-08-31).
   * ⚠**대역의 구멍이 결함과 같은 얼굴을 한다** — 이번에도 시험은 「행이 안 붙었다」로만 말했고,
   * 진짜 원인(`createDocumentFragment`·`remove` 가 없다)은 스택을 봐야 나왔다.
   * **대역에 없는 API 를 쓸 때는 여기부터 확인하라.**
   */
  remove(): void {
    this.detach();
  }

  insertBefore(c: El, ref: El): El {
    c.detach();
    const i = this.children.indexOf(ref);
    if (i < 0) throw new Error("기준 노드가 이 부모의 자식이 아니다");
    c.parentNode = this;
    this.children.splice(i, 0, c);
    return c;
  }

  detach(): void {
    const p = this.parentNode;
    if (p === null) return;
    p.children.splice(p.children.indexOf(this), 1);
    this.parentNode = null;
  }

  addEventListener(type: string, fn: (e: unknown) => void): void {
    (this.listeners[type] ??= []).push(fn);
  }

  /**
   * 테스트에서 이벤트를 쏜다.
   *
   * ⚠`event`를 받는다 — 키보드 조작은 `key`가 없으면 검증할 수 없다.
   * `preventDefault`를 항상 넣어 둔다: 핸들러가 그걸 부르는 것이 정상 동작이고,
   * 없으면 스텁에서만 죽는다(실제 브라우저에는 늘 있다).
   */
  fire(type: string, event: Record<string, unknown> = {}): void {
    const e = { preventDefault: () => {}, ...event };
    for (const fn of this.listeners[type] ?? []) fn(e);
  }

  descendants(): El[] {
    return this.children.flatMap((c) => [c, ...c.descendants()]);
  }

  querySelector(sel: string): El | null {
    return this.querySelectorAll(sel)[0] ?? null;
  }

  querySelectorAll(sel: string): El[] {
    /**
     * ⚠**쉼표 목록을 지원한다.** `a[href],button,input,…` 처럼 「어느 하나라도」를 묻는
     * 선택자가 실제 코드에 있는데 스텁이 예외를 던져서, 그 코드가 **시험에서 통째로 죽어 있었다**
     * (2026-08-18 감사 P1의 가로스크롤 접근성 경로가 정확히 그랬다 —
     * 무엇을 넣어도 초록이었으니 결함이 살아남았다).
     * ⚠**중복을 지우고 문서 순서를 지킨다** — 브라우저가 그렇고,
     * 「가장 오른쪽 포커스 지점」 같은 판정이 순서에 기댄다.
     */
    const groups = sel.split(",").map((s) => s.trim()).filter((s) => s !== "");
    if (groups.length > 1) {
      const hit = new Set(groups.flatMap((g) => this.querySelectorAll(g)));
      return this.descendants().filter((el) => hit.has(el));
    }
    const parts = sel.trim().split(/\s+/);
    // ⚠**빈 결과가 아니라 예외로 알린다.** 지원하지 않는 선택자가 조용히 0건을 내면
    // 「클라이언트가 아무것도 안 했다」와 「스텁이 못 찾았다」가 구별되지 않는다.
    for (const part of parts) assertSupported(part);
    let pool = this.descendants();
    for (const [i, part] of parts.entries()) {
      const matched = pool.filter((el) => matches(el, part));
      pool = i === parts.length - 1 ? matched : matched.flatMap((el) => el.descendants());
    }
    return pool;
  }
}

function assertSupported(simple: string): void {
  const token = /^(?:([a-z][a-z0-9]*)|#([\w-]+)|\.([\w-]+)|\[([\w-]+)(?:="([^"]*)")?\])+$/i;
  if (!token.test(simple)) throw new Error(`스텁이 모르는 선택자: ${simple}`);
}

function matches(el: El, simple: string): boolean {
  for (const m of simple.matchAll(/([a-z][a-z0-9]*)|#([\w-]+)|\.([\w-]+)|\[([\w-]+)(?:="([^"]*)")?\]/gi)) {
    const [, tag, id, cls, attr, val] = m;
    if (tag !== undefined && el.tagName !== tag.toUpperCase()) return false;
    if (id !== undefined && el.id !== id) return false;
    if (cls !== undefined && !el.className.split(/\s+/).includes(cls)) return false;
    if (attr !== undefined) {
      const have = el.getAttribute(attr);
      if (have === null) return false;
      if (val !== undefined && have !== val) return false;
    }
  }
  return true;
}

export interface StubDocument {
  documentElement: El;
  body: El;
  createElement(tag: string): El;
  /**
   * SVG 요소. ⚠**태그만 만들고 이름공간은 무시한다** — 이 대역이 재는 것은 구조이지
   * 렌더링이 아니다. 없으면 紋을 그리는 경로가 통째로 **오류로 빠져** 시험이 엉뚱한 것을 재게 된다.
   */
  createElementNS(ns: string, tag: string): El;
  /** 글자 노드. 용어집에 없는 라벨이 이 경로로 그려진다 */
  createTextNode(text: string): El;
  /**
   * 여러 행을 한 번에 붙일 때 쓰는 조각.
   *
   * ⚠**없어서 순위표의 「もっと見る」 경로가 통째로 죽었다**(2026-08-31).
   * 대역에 없는 API 를 쓰면 시험은 「행이 안 붙었다」로만 말하고 **왜인지는 안 말한다** —
   * 진짜 결함과 대역의 구멍이 같은 얼굴이 된다.
   * ⚠**진짜 조각은 아니다** — 붙이면 자기 자식을 옮기는 것이 아니라 그대로 들어간다.
   * 재는 것이 「몇 행이 붙었나」이므로 그걸로 충분하고, 아니게 되면 여기를 고쳐라.
   */
  createDocumentFragment(): El;
  getElementById(id: string): El | null;
  querySelector(sel: string): El | null;
  querySelectorAll(sel: string): El[];
  /** 바깥 클릭으로 목록을 닫는 코드가 문서에 붙는다 */
  addEventListener(type: string, fn: (e: unknown) => void): void;
  /** 테스트에서 문서 수준 이벤트를 쏜다 */
  fire(type: string, event?: unknown): void;
}

export function makeDocument(base = ""): StubDocument {
  const root = new El("html");
  root.dataset["base"] = base;
  const body = new El("body");
  root.appendChild(body);
  const listeners: Record<string, ((e: unknown) => void)[]> = {};
  return {
    documentElement: root,
    body,
    createElement: (tag) => new El(tag),
    createElementNS: (_ns, tag) => new El(tag),
    createTextNode: (text) => {
      const t = new El("#text");
      t.textContent = text;
      return t;
    },
    createDocumentFragment: () => new El("#fragment"),
    getElementById: (id) => root.descendants().find((el) => el.id === id) ?? null,
    querySelector: (sel) => root.querySelector(sel),
    querySelectorAll: (sel) => root.querySelectorAll(sel),
    addEventListener: (type, fn) => void (listeners[type] ??= []).push(fn),
    fire: (type, event) => {
      for (const fn of listeners[type] ?? []) fn(event ?? {});
    },
  };
}

/** 저장이 막힌 환경을 흉내내는 저장소. */
export function makeStorage(broken = false): Storage {
  const map = new Map<string, string>();
  const boom = (): never => {
    throw new Error("storage disabled");
  };
  return {
    getItem: (k: string) => (broken ? boom() : (map.get(k) ?? null)),
    setItem: (k: string, v: string) => {
      if (broken) boom();
      map.set(k, v);
    },
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  } as Storage;
}

/**
 * 그 요소에만 기하를 넣는다 — **가로 위치**를 재는 코드용.
 *
 * ⚠**클래스에 메서드로 두지 않는다.** 클라이언트는 `typeof el.getBoundingClientRect!=="function"`
 * 으로 「기하를 모르는 환경」을 가리고, 그 갈래가 **스텁 전체의 기본 상태**다(스텁에는 레이아웃이
 * 없으므로 그게 맞다). 클래스에 달면 그 안전 갈래가 **전 시험에서 통째로 사라지고**,
 * 툴팁·앵커 보정처럼 세로 기하를 읽는 코드가 **0 을 진짜 값으로 믿게 된다.**
 * → **재려는 시험이 재려는 요소에만** 붙인다.
 */
export function withRect(el: El, left: number, right: number): El {
  (el as unknown as { getBoundingClientRect: () => { left: number; right: number } }).getBoundingClientRect =
    () => ({ left, right });
  return el;
}

/** `el.className`으로 만든 요소. 테스트에서 마크업을 조립할 때 쓴다 */
export function make(tag: string, attrs: Record<string, string> = {}, children: El[] = []): El {
  const el = new El(tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  for (const c of children) el.appendChild(c);
  return el;
}
