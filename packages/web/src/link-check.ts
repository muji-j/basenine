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
 */

/** 페이지 안의 `id` 를 줍는다. ⚠공백 뒤에 오는 것만 본다 — `[href=...]` 같은 문자열을 피한다 */
const ID_RE = /\sid="([^"]*)"/g;

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
  kind: "page" | "anchor";
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
  for (const f of files) {
    if (!f.path.endsWith(".html")) continue;
    ids.set(f.path, new Set([...f.content.matchAll(ID_RE)].map((m) => m[1] ?? "")));
  }
  const out: BrokenLink[] = [];
  const seen = new Set<string>();
  for (const f of files) {
    if (!f.path.endsWith(".html")) continue;
    const slash = f.path.lastIndexOf("/");
    const dir = slash === -1 ? "" : f.path.slice(0, slash);
    for (const m of f.content.matchAll(/\s(?:href|src)="([^"]*)"/g)) {
      const href = m[1] ?? "";
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
  }
  return out;
}
