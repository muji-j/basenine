/**
 * 최소 DOM 스텁 — 클라이언트 스크립트를 **실행해서** 검증하기 위한 것.
 *
 * ⚠**브라우저가 아니다.** 여기서 통과하는 것은 「우리 로직이 의도대로 도는가」이지
 * 「브라우저에서 보이는가」가 아니다. 실기 확인을 대신하지 않는다.
 * ⚠지원하는 선택자는 클라이언트가 실제로 쓰는 것뿐이다 — `#id` · `.class` · `[attr]` ·
 * `[attr="v"]`와 공백(자손) 결합. 그 밖의 문법을 쓰면 **조용히 빈 결과가 아니라 예외**가 난다.
 */

export class El {
  readonly tagName: string;
  readonly children: El[] = [];
  readonly attrs: Record<string, string> = {};
  readonly dataset: Record<string, string> = {};
  readonly style: Record<string, string> = {};
  readonly listeners: Record<string, ((e: unknown) => void)[]> = {};
  parentNode: El | null = null;
  hidden = false;
  checked = false;
  value = "";
  type = "";
  #text = "";

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

  /** 테스트에서 이벤트를 쏜다 */
  fire(type: string): void {
    for (const fn of this.listeners[type] ?? []) fn({});
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
  getElementById(id: string): El | null;
  querySelector(sel: string): El | null;
  querySelectorAll(sel: string): El[];
}

export function makeDocument(base = ""): StubDocument {
  const root = new El("html");
  root.dataset["base"] = base;
  const body = new El("body");
  root.appendChild(body);
  return {
    documentElement: root,
    body,
    createElement: (tag) => new El(tag),
    getElementById: (id) => root.descendants().find((el) => el.id === id) ?? null,
    querySelector: (sel) => root.querySelector(sel),
    querySelectorAll: (sel) => root.querySelectorAll(sel),
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
