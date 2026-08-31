/**
 * 내부 링크 전수 검사 — **깨진 링크를 빌드가 잡는다.**
 *
 * ⚠**이 프로젝트는 이 결함으로 이미 한 번 크게 당했다.** 구단 페이지를 만들면서
 * 날짜 링크를 데이터 계층이 루트 깊이로 만들어 **240개의 링크가 한 번에 404**가 됐다(2026-08-16).
 * 타입도 시험도 못 잡았다 — 문자열이 문자열로 맞았기 때문이다.
 *
 * ⚠**잠복형이 더 무섭다.** 포스트시즌에만 나온 선수, 리그 번들이 없어 건너뛴 구단처럼
 * **지금 데이터에서는 0건이지만 조건이 갖춰지면 죽는 링크**가 실재한다(2026-08-16 이중 검토 지적).
 * 사람이 매번 확인할 수 없으므로 빌드가 확인한다.
 *
 * ⚠**배포 파이프라인에 다른 그물이 없다.** `daily.yml`은 테스트도 타입체크도 돌리지 않고
 * 빌드 뒤 바로 배포한다. 여기서 안 잡으면 404가 그대로 공개된다.
 *
 * ⚠**그물에 구멍이 있었다**(2026-08-19). 이 검사는 「가리키는 곳이 있는가」만 보고
 * 「그곳이 **하나인가**」는 안 봤다 — `id` 를 `Set` 으로 담았기 때문이다.
 * 중복 id 는 앵커 검사도 ARIA 검사도 전부 통과하지만 브라우저는 **먼저 나온 하나**만 연다.
 * 그래서 `duplicateIds()` 를 함께 둔다(아래).
 */

/** 페이지 안의 `id` 를 줍는다. ⚠공백 뒤에 오는 것만 본다 — `[href=...]` 같은 문자열을 피한다 */
const ID_RE = /\sid="([^"]*)"/g;

/**
 * 다른 요소의 `id` 를 가리키는 ARIA 속성.
 * ⚠**`aria-label` 은 여기 없다** — 그건 글자이지 참조가 아니다.
 */
const REF_RE = /\s(?:href|src)="([^"]*)"/g;

const ARIA_REF_RE = /\s(aria-(?:labelledby|controls|describedby|owns|details|errormessage|flowto))="([^"]*)"/g;

/**
 * 링크 검사에 **필요한 것만** 뽑아 둔 한 장.
 *
 * ⚠**본문을 들고 있으면 시즌이 늘 때 힙이 터진다**(2026-08-18 실측).
 * 링크 검사는 **전 시즌을 모은 뒤에** 해야 하는데(`../2025/…` 처럼 시즌을 넘는 링크가 있다),
 * 그러려고 15,434장의 **본문 전체**를 배열에 쌓고 있었다 — 약 900MB 다.
 * CI 러너의 기본 힙(약 2GB)에서 **9시즌째에 OOM 으로 죽었다**(run 32126443819).
 * ⚠**힙만 늘리면 벽이 옮겨질 뿐이다.** 들고 있는 것을 줄인다 —
 * 검사가 실제로 보는 것은 `id` 집합과 링크·ARIA 참조 목록뿐이다.
 */
export interface LinkIndex {
  path: string;
  /** 이 문서 안의 `id`. HTML 이 아니면 빈 집합 */
  ids: Set<string>;
  /**
   * 이 문서에서 **두 번 이상** 나온 `id`. 정상이면 빈 배열이라 힙에도 거의 안 남는다.
   *
   * ⚠**`ids` 가 `Set` 이라 중복은 원리적으로 안 보였다**(2026-08-19 감사).
   * 두 번 나온 id 도 「있다」로만 보이므로 앵커 검사·ARIA 검사가 **전부 통과**한다 —
   * 그런데 브라우저의 `getElementById` 는 **문서에서 먼저 나온 하나**만 준다.
   * 실측: `ranking.html` 9장에 중복 id **86종 / 172노드**가 있었고,
   * `#pn-rankmetric-starter-era` 로 들어가면 언제나 セ 사본이 열려
   * **パ의 개인 지표를 URL 로 가리킬 수 없었다.**
   */
  dupIds: string[];
  /** `href`·`src` 원문 */
  refs: string[];
  /** ARIA 참조. `[속성명, 값]` */
  aria: [string, string][];
}

/**
 * 파일 한 장에서 검사에 쓸 것만 뽑는다. **본문은 여기서 버려진다.**
 *
 * ⚠**HTML 이 아닌 파일도 넣는다** — 경로가 있어야 「그 파일이 있는가」를 판정한다.
 */
export function linkIndex(f: OutFile): LinkIndex {
  if (!f.path.endsWith(".html")) {
    return { path: f.path, ids: new Set(), dupIds: [], refs: [], aria: [] };
  }
  /**
   * ⚠**한 번 훑으면서 둘 다 만든다.** 매치 배열을 통째로 펼쳐 두면 그만큼이 힙에 남는데,
   * 이 파일은 9시즌 빌드에서 이미 한 번 OOM 을 낸 자리다(위 주석 참조).
   * 여기서 들고 있는 것은 **id 집합과 중복 목록뿐**이고, 중복은 정상이면 0개다.
   */
  const ids = new Set<string>();
  const dup = new Set<string>();
  for (const m of f.content.matchAll(ID_RE)) {
    const id = m[1] ?? "";
    if (ids.has(id)) dup.add(id);
    else ids.add(id);
  }
  return {
    path: f.path,
    ids,
    dupIds: [...dup],
    refs: [...f.content.matchAll(REF_RE)].map((m) => m[1] ?? ""),
    aria: [...f.content.matchAll(ARIA_REF_RE)].map((m) => [m[1] ?? "", m[2] ?? ""] as [string, string]),
  };
}

/** 같은 문서에 두 번 이상 나온 `id` 한 건 */
export interface DuplicateId {
  path: string;
  id: string;
}

/**
 * 같은 문서 안의 중복 `id` 를 모은다. **문서를 넘어선 중복은 중복이 아니다** —
 * 모든 페이지가 `id="q"`(헤더 검색창)를 갖는 것이 정상이다.
 *
 * ⚠**깨진 링크와 따로 센다.** 중복 id 는 링크가 가리키는 곳이 **없는** 것이 아니라
 * **둘인** 것이라, 같은 목록에 섞으면 「깨진 링크 N개」라는 수가 거짓말이 된다(작업규칙 7).
 * ⚠**이것이 앵커 검사의 사각지대였다**: `ids.has(frag)` 는 중복이어도 참이라,
 * 앵커도 ARIA 도 전부 통과시키면서 실제로는 다른 곳을 열고 있었다.
 */
export function duplicateIds(files: readonly LinkIndex[]): DuplicateId[] {
  const out: DuplicateId[] = [];
  for (const f of files) {
    for (const id of f.dupIds) out.push({ path: f.path, id });
  }
  return out;
}

/** 생성될 파일 한 장 */
export interface OutFile {
  /** 출력 루트 기준 경로. `players/123.html` · `2025/teams/t.html` */
  path: string;
  content: string;
}

export interface BrokenLink {
  /** 링크를 실은 페이지 */
  from: string;
  /** 원문 그대로의 href */
  href: string;
  /** 해석한 결과의 경로 */
  to: string;
  /**
   * 무엇이 없는가. `page` = 파일 자체가 없다 · `anchor` = 파일은 있는데 그 `id`가 없다.
   *
   * ⚠**둘을 구별한다.** 앵커가 없는 링크는 파일이 열리기는 해서 **더 조용히 실패한다** —
   * 브라우저는 맨 위에 머무르고, 누른 사람은 「아무 일도 안 일어났다」고만 안다.
   */
  kind: "page" | "anchor" | "aria";
}

/**
 * 밖으로 나가는 링크인가. **검사 대상이 아니다** — 우리가 만드는 파일이 아니다.
 * ⚠`//example.com` 도 절대 링크다. 슬래시 두 개를 놓치면 외부 링크를 내부로 오해한다.
 */
/**
 * ⚠**`#앵커` 는 여기에 넣지 않는다.** 예전에는 외부로 보고 통째로 건너뛰었는데,
 * 그러면 **같은 페이지 안의 앵커가 아무 검사도 안 받는다** — 대시보드의 점프 내비가
 * 없는 구획을 가리켜도 조용히 아무 일이 없다(M12).
 * 실제로 커밋 메시지에 「빌드가 앵커를 본다」고 적었는데 **거짓이었다**(2026-08-17 검토 P1).
 * 지금은 아래 루프가 `#` 만 있는 링크를 **그 파일 자신의 id** 와 대조한다.
 */
function isExternal(href: string): boolean {
  return (
    href === "" ||
    href.startsWith("//") ||
    href.startsWith("http:") ||
    href.startsWith("https:") ||
    href.startsWith("mailto:") ||
    href.startsWith("tel:") ||
    href.startsWith("data:") ||
    href.startsWith("javascript:")
  );
}

/**
 * `dir` 에서 본 `href` 가 가리키는 출력 경로.
 * ⚠**`..` 를 직접 처리한다.** Node 의 경로 함수는 플랫폼 구분자를 쓰는데
 * 출력 경로는 언제나 `/` 다 — 윈도우에서 섞이면 조용히 안 맞는다.
 */
function resolvePath(dir: string, href: string): string {
  const parts = dir === "" ? [] : dir.split("/");
  for (const seg of href.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") parts.pop();
    else parts.push(seg);
  }
  return parts.join("/");
}

/**
 * 전 페이지의 내부 링크를 검사한다.
 *
 * ⚠**`href` 와 `src` 를 함께 본다** — 이미지·스크립트가 빠져도 화면은 깨진다.
 * ⚠**앵커(`#`)와 쿼리(`?`)는 떼고 본다** — 파일 존재 여부만 묻는다.
 * ⚠**디렉터리 링크(`foo/`)는 `foo/index.html` 로 읽는다.**
 */
export function brokenLinks(files: readonly OutFile[]): BrokenLink[] {
  return brokenLinksIn(files.map(linkIndex));
}

/**
 * 색인만 받아 검사한다. **빌드는 이쪽을 쓴다** — 본문을 안 들고 있어도 되게.
 */
export function brokenLinksIn(files: readonly LinkIndex[]): BrokenLink[] {
  const have = new Set(files.map((f) => f.path));
  /**
   * 파일마다 그 안에 있는 `id`.
   *
   * ⚠**앵커까지 봐야 할 이유가 실제로 생겼다.** 타대회 화면을 대회별 탭으로 나누면서
   * 선수 페이지가 `postseason.html#pc-<대회id>` 를 가리키게 됐다(2026-08-16).
   * 파일 존재만 보면 그 링크가 맞는지 **아무것도 말하지 못한다** — 닫힌 탭을 여는 것이
   * 앵커의 일이므로, 앵커가 틀리면 화면은 열리는데 아무 일도 일어나지 않는다.
   */
  const ids = new Map<string, Set<string>>();
  for (const f of files) ids.set(f.path, f.ids);
  const out: BrokenLink[] = [];
  const seen = new Set<string>();
  for (const f of files) {
    if (!f.path.endsWith(".html")) continue;
    const slash = f.path.lastIndexOf("/");
    const dir = slash === -1 ? "" : f.path.slice(0, slash);
    for (const href of f.refs) {
      if (isExternal(href)) continue;
      const hash = href.indexOf("#");
      const frag = hash === -1 ? "" : href.slice(hash + 1);
      const clean = href.split("#")[0]?.split("?")[0] ?? "";
      /**
       * **같은 페이지 안의 앵커**(`#b-hweek`). 경로가 없으므로 **이 파일 자신**과 대조한다.
       * ⚠`clean === ""` 로 그냥 넘기면 검사가 통째로 빠진다 — 그게 예전 상태였다.
       */
      if (clean === "") {
        if (frag === "" || ids.get(f.path)?.has(frag) === true) continue;
        const selfKey = `${f.path} ${href}`;
        if (seen.has(selfKey)) continue;
        seen.add(selfKey);
        out.push({ from: f.path, href, to: f.path, kind: "anchor" });
        continue;
      }
      const target = resolvePath(dir, clean.endsWith("/") ? `${clean}index.html` : clean);
      const kind: "page" | "anchor" = have.has(target) ? "anchor" : "page";
      // 파일이 있고, 앵커를 안 물었거나 그 앵커가 있으면 통과다
      if (kind === "anchor" && (frag === "" || ids.get(target)?.has(frag) === true)) continue;
      // 같은 링크가 수백 장에 실린다 — 보고는 한 번이면 된다
      const key = `${f.path} ${href}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ from: f.path, href, to: target, kind });
    }

    /**
     * **ARIA 참조도 링크다.**
     *
     * ⚠**이 결함은 사람 눈으로 안 보인다**(2026-08-18 감사 P2). 予告先発 화면에서
     * 패널 **6개 전부**가 존재하지 않는 탭 id 를 가리키고 있었는데, 화면은 멀쩡했고
     * 빌드도 시험도 배포도 전부 통과했다 — 낭독기 사용자에게만 깨져 있었다.
     * ⚠**깨진 ARIA 참조는 없는 것보다 나쁘다**: 「이 패널의 이름은 저기」라고 말해 놓고
     * 그 자리가 비어 있으면, 낭독기는 이름 없는 패널을 이름 있는 척 읽는다.
     * ⚠**같은 문서 안에서만 본다** — ARIA 의 id 참조는 문서를 넘지 않는다.
     * ⚠**공백 구분 목록을 받는 속성이 있다**(`aria-controls` 는 여러 패널을 가리킬 수 있다).
     */
    const own = ids.get(f.path);
    for (const [attr, value] of f.aria) {
      for (const ref of value.split(/\s+/)) {
        if (ref === "" || own?.has(ref) === true) continue;
        const key = `${f.path} aria ${ref}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ from: f.path, href: `${attr}="${ref}"`, to: f.path, kind: "aria" });
      }
    }
  }
  return out;
}

/**
 * **홈에서 몇 번 눌러야 닿는가.**
 *
 * ⚠**CLAUDE.md §0-1 의 판정 기준인데 한 번도 안 쟀다**(2026-08-31 에 처음 쟀다):
 * 「첫 방문 → 원하는 선수 성적까지 **3클릭 이내**」.
 * 규약에 적혀 있고 제품의 가치 명제인데 **아무 장치도 그것을 보고 있지 않았다** —
 * 화면을 늘리거나 내비를 줄이면 **조용히 4클릭이 될 수 있고, 아무도 모른다.**
 *
 * ⚠**링크만 센다.** 검색칸은 타이핑이라 클릭이 아니고, **JS 가 꺼져도 닿아야 한다**(§0-1).
 * ⚠**앵커는 이동으로 세지 않는다** — 같은 화면 안이라 「도달」이 아니다.
 *
 * 첫 실측(2026-08-31 · 9시즌 dist): 전체 **9,370장 미도달 0** ·
 * 선수 페이지 **6,207장 전부 3클릭 이내**(현행 1~2 · 과거 시즌 2~3).
 *
 * @returns 경로 → 홈에서의 클릭 수. 안 나오는 경로는 **도달 불가**다.
 */
export function clickDepth(files: readonly LinkIndex[], start = "index.html"): Map<string, number> {
  const have = new Set(files.map((f) => f.path));
  const byPath = new Map(files.map((f) => [f.path, f]));
  const depth = new Map<string, number>();
  if (!have.has(start)) return depth;
  depth.set(start, 0);
  let frontier = [start];
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const p of frontier) {
      const d = depth.get(p) ?? 0;
      const f = byPath.get(p);
      if (f === undefined) continue;
      const slash = p.lastIndexOf("/");
      const dir = slash === -1 ? "" : p.slice(0, slash);
      for (const href of f.refs) {
        if (isExternal(href)) continue;
        const clean = href.split("#")[0]?.split("?")[0] ?? "";
        // ⚠같은 화면 안의 앵커는 이동이 아니다
        if (clean === "") continue;
        let to = resolvePath(dir, clean);
        if (to.endsWith("/")) to += "index.html";
        if (!to.endsWith(".html") || !have.has(to) || depth.has(to)) continue;
        depth.set(to, d + 1);
        next.push(to);
      }
    }
    frontier = next;
  }
  return depth;
}

/**
 * 3클릭을 넘거나 아예 못 닿는 **선수 페이지**. ⚠**비어 있어야 한다**(§0-1).
 *
 * ⚠**선수 페이지만 본다** — 규약이 말하는 것이 「선수 성적까지」이기 때문이다.
 * 과거 시즌은 `2025/players/…` 처럼 시즌 접두사가 붙으므로 그것도 센다
 * (시즌 전환이 한 번 더 들어 **3클릭이 상한선에 딱 걸린다** — 그래서 더 봐야 한다).
 */
export function tooDeepPlayerPages(
  files: readonly LinkIndex[],
  limit = 3,
  /**
   * 이미 걸어 둔 결과. ⚠**9,370장을 두 번 걷지 않기 위해서다** —
   * 안 넘기면 여기서 다시 걷는다(호출부가 하나뿐일 때는 그게 편하다).
   */
  precomputed?: ReadonlyMap<string, number>,
): { path: string; clicks: number | null }[] {
  const depth = precomputed ?? clickDepth(files);
  const out: { path: string; clicks: number | null }[] = [];
  for (const f of files) {
    if (!/(^|\/)players\/[^/]+\.html$/.test(f.path)) continue;
    const d = depth.get(f.path);
    if (d === undefined) out.push({ path: f.path, clicks: null });
    else if (d > limit) out.push({ path: f.path, clicks: d });
  }
  return out;
}
