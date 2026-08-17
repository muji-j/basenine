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

  get textContent(): string {
    return this.children.length === 0 ? this.#text : this.children.map((c) => c.textContent).join("");
  }
  set textContent(v: string) {
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

  removeAttribute(k: string): void {
    delete this.attrs[k];
    if (k.startsWith("data-")) {
      delete this.dataset[k.slice(5).replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())];
    }
  }


  appendChild(c: El): El {
    c.detach();
    c.parentNode = this;
    this.children.push(c);
    return c;
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

/** `el.className`으로 만든 요소. 테스트에서 마크업을 조립할 때 쓴다 */
export function make(tag: string, attrs: Record<string, string> = {}, children: El[] = []): El {
  const el = new El(tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  for (const c of children) el.appendChild(c);
  return el;
}
