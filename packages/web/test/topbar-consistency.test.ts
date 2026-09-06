/**
 * **헤더는 어느 화면에서나 같아야 한다.**
 *
 * ⚠**이 시험이 없어서 홈만 탭이 하나 모자랐다**(2026-08-17 유저 지적:
 * 「홈화면에 있을때랑 탭이 활성화 되어 있을때랑 헤더 디자인이 다르다」).
 * 원인은 `home-page.ts` 가 `hasPostseason` 을 레이아웃에 **넘기지 않은 것**이었다 —
 * 다른 렌더러 8곳은 전부 넘기는데 홈만 빠져서 `他大会` 탭이 통째로 사라졌다.
 * 타입은 못 잡는다(`hasPostseason?: boolean` 이 선택값이라 빠뜨려도 컴파일된다).
 *
 * ⚠**「보이는 것」을 세는 시험이다.** 렌더러마다 인자를 넘겼는지 grep 하는 것으로는
 * 부족하다 — 넘겨도 값이 false 면 같은 증상이 난다. **생성된 HTML을 센다.**
 *
 * ⚠**최상위만 보고 있었다**(2026-08-19 T7 검토 ⓑ). `readdirSync(DIST)` 는 하위 디렉터리를
 * 재귀하지 않아 **11장만** 재고 있었고, 그 바깥에 실제 결함이 두 종류 살아 있었다:
 * ⑴ 선수 페이지 6,207장에 `aria-current` 가 **하나도 없었다**(`nav:"player"` 인데 그 탭이 없다).
 * ⑵ 구단 상세는 `球団` 탭이 생기는 순간 **다른 문서를 「지금 이 문서」라고** 부르게 돼 있었다.
 * 둘 다 이 파일을 재귀시켜서 드러났다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { closeSync, openSync, readFileSync, readSync, readdirSync, existsSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * ⚠**`cwd` 에 기대지 않는다.** 처음에 `"dist"` 라고만 적었더니
 * `packages/web` 에서 `npm test` 를 돌릴 때 **매번 조용히 skip** 됐다 —
 * 출력은 `pass 0 / fail 0 / skipped 3` 인데 종료 코드는 0이라 **「합격」으로 읽힌다.**
 * CLAUDE.md 작업규칙 8 이 경고하는 그 패턴이다(「E2E 5본이 전부 실행 불가인 채 0건=합격으로 오독」).
 * 이 파일 위치에서 저장소 루트를 거슬러 올라가 **어디서 돌려도 같은 곳을 본다.**
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const DIST = join(ROOT, "dist");

/**
 * 한 디렉터리에서 몇 장까지 열 것인가.
 *
 * ⚠**전수 비용을 상수처럼 적지 마라 — 환경에 따라 6배 이상 갈린다**(2026-08-19 검토 ③).
 * 여기 「22.8초」라고 한 줄로 적혀 있었는데, 검토자의 실측은 **149초**였다.
 * 지배 인자는 계산이 아니라 **파일 하나를 여는 비용**이고, 그건 OS·디스크·백신·페이지 캐시가 정한다.
 * **같은 기계·같은 날·같은 명령**으로도 이렇게 벌어진다(Windows 11 · dist 15,340장 · 약 1GB):
 *
 * ```
 *   이 파일만        차가운 캐시 110초 · 따뜻한 캐시 16.7초 (표본은 5.0초 · 0.9초)
 *   npm test 전체    표본 5회 = 50~60초 · 전수 6회 = 50~238초
 * ```
 *
 * → **「몇 초」라고 단정하지 마라.** 지배 인자는 계산이 아니라 **페이지 캐시 상태**이고,
 *   dist 가 1GB 라 반복 실행만으로도 밀려난다. 검토자의 149초도 이 폭 안이다.
 * ⚠**CI 는 따뜻한 쪽이어야 한다** — 바로 앞 단계가 그 15,340장을 **방금 쓴다.**
 *   그래서 배포 잡은 `BB_FULL_SCAN=1` 로 돌린다(daily.yml 「시험」 단계).
 *   ⚠**CI 에서는 아직 안 쟀다** — 위 값은 전부 로컬이다.
 *
 * ⚠**로컬 기본값이 표본인 이유**는 비용이지 정확성이 아니다. 헤더는 **렌더러 × 시즌**으로만
 * 갈리므로(데이터가 아니라) 디렉터리 45개를 전부 밟으면 그 조합은 다 밟힌다.
 * 실측 표본 **523장 / 45디렉터리**.
 * ⚠**그래도 표본은 표본이다** — 검토자가 표본 **밖**의 `dist/players/23325159.html` 에서
 * `aria-current="true"` 를 지우고 돌리자 **기본 실행이 통과했다**(그때 pass 4 · fail 0).
 * 이 변경 뒤에 같은 실험을 다시 했고 결과가 같다(2026-08-19 재현):
 * 기본 **pass 6 · fail 0**(못 본다) · `BB_FULL_SCAN=1` **pass 5 · fail 1**
 * (「현재 위치 표시가 없는 화면 1장(15340장 / 디렉터리 45개(전수)): players/23325159.html」).
 * **로컬 통과를 안전으로 읽지 마라.**
 */
const PER_DIR = 12;
const FULL = process.env["BB_FULL_SCAN"] === "1";

/**
 * 한 디렉터리의 표본 — **앞 6 + 뒤 6**.
 *
 * ⚠**앞에서 12장만 자르면 「디렉터리당 렌더러 1개」를 암묵 전제하게 된다**(2026-08-19 검토 ⑤).
 * 파일 이름순 앞쪽만 보므로, 새 렌더러가 **기존 디렉터리에 이름이 뒤로 가는 파일**을 쓰면
 * 그 렌더러는 표본에 한 장도 안 들어온다 — 그리고 그 사실이 아무 데도 안 나온다.
 * 오늘은 디렉터리 하나에 렌더러 하나라 성립하지만, 그건 **지금의 우연**이지 규약이 아니다.
 * → 같은 12장 비용으로 **양 끝**을 본다. 12장 이하인 디렉터리는 전부 본다(겹치지 않는다).
 */
function sample(files: readonly string[]): string[] {
  if (files.length <= PER_DIR) return [...files];
  const half = PER_DIR / 2;
  return [...files.slice(0, half), ...files.slice(-half)];
}

/**
 * 헤더가 확실히 들어가는 크기.
 * ⚠**바이트 수다.** 문자열 위치(최대 3,130)와 다르다 — 헤더는 일본어라 글자당 3바이트다.
 * 못 찾으면 그 파일만 통째로 읽는다(조용히 건너뛰지 않는다).
 */
const HEAD_BYTES = 16384;

/** 파일 머리에서 `<header>` 까지만. 전부 읽지 않는 것이 이 시험이 감당되는 이유다 */
function headOf(file: string): string {
  const fd = openSync(file, "r");
  let prefix: string;
  try {
    const buf = Buffer.alloc(HEAD_BYTES);
    const n = readSync(fd, buf, 0, HEAD_BYTES, 0);
    prefix = buf.subarray(0, n).toString("utf8");
  } finally {
    closeSync(fd);
  }
  const at = prefix.indexOf("</header>");
  const text = at >= 0 ? prefix.slice(0, at + "</header>".length) : readFileSync(file, "utf8");
  return (/<header class="topbar"[\s\S]*?<\/header>/.exec(text) ?? [""])[0];
}

/**
 * 그 화면의 탭 목록(순서 포함).
 *
 * ⚠**안쪽 태그를 벗겨서 「보이는 글자」만 남긴다**(2026-09-07). 예전 정규식은
 * `>([^<]*)</a>` 라서 **속에 요소가 하나라도 있으면 그 탭을 통째로 못 봤다** —
 * 드래프트만 굽는 시즌의 탭에 대체 표식(`<i>→</i>`)이 붙자 6개가 목록에서 사라졌고,
 * 아래 「탭 줄기가 같다」가 **라벨은 똑같은데** 빨개졌다.
 * ⚠**이 시험이 재는 것은 라벨이지 마크업이 아니다** — 표식 자체는
 * `draft-only-season.test.ts` 가 따로 못 박는다. 여기서 느슨해진 것은 없다.
 */
function tabsOf(head: string): string[] {
  const nav = /<nav class="tnav"[^>]*>([\s\S]*?)<\/nav>/.exec(head);
  if (nav === null) return [];
  return [...nav[1]!.matchAll(/<a\s[^>]*href="[^"]*"[^>]*>([\s\S]*?)<\/a>/g)].map((m) => label(m[1]!));
}

/**
 * 앵커 안에서 **라벨만** 남긴다 — `aria-hidden` 장식은 통째로 버린다.
 *
 * ⚠**장식은 라벨이 아니다.** 다른 시즌으로 보내는 탭에는 표식(`→`)이 붙는데,
 * 그건 낭독기가 안 읽는 조각이고 **시즌마다 붙고 안 붙는다.** 그것까지 라벨로 세면
 * 「시즌이 달라도 탭 줄기는 같다」가 **라벨은 똑같은데** 빨개진다.
 * ⚠**표식이 있는지는 여기서 안 잰다** — `draft-only-season.test.ts` 가 못 박는다.
 */
function label(inner: string): string {
  return inner
    .replace(/<([a-z]+)\s[^>]*aria-hidden="true"[^>]*>[\s\S]*?<\/\1>/g, "")
    .replace(/<[^>]*>/g, "")
    .trim();
}

/**
 * 이 화면의 헤더가 쓰는 `aria-current` 값들.
 *
 * ⚠**두 값이 다 정당하다** — `page`(바로 이 화면) · `true`(이 구획 안이지만 다른 화면).
 * `days.html`·`starters.html`·선수 페이지가 후자다. 처음에 `page` 만 찾도록 썼더니
 * **올바른 마크업을 결함이라고 불렀다** — 시험이 좁으면 고칠 것이 없는데도 빨개진다.
 */
function currentValues(head: string): string[] {
  return [...head.matchAll(/aria-current="([^"]+)"/g)].map((m) => m[1]!);
}

/**
 * ⚠**「dist 가 없어서 안 돌았다」가 합격으로 읽히면 안 된다**(작업규칙 8).
 * 위 주석은 `cwd` 문제만 고쳤을 뿐, **dist 자체가 없는 곳**(빌드 전 · CI)에서는
 * 여전히 3본이 조용히 skip 되고 종료 코드가 0이었다(2026-08-18 감사 P3).
 *
 * → **`BB_REQUIRE_DIST=1` 이면 던진다.** CI 는 빌드 뒤에 이 값을 켜고 시험을 돌리므로,
 *   거기서는 skip 이 불가능하다. 사람이 로컬에서 빌드 없이 돌릴 때만 skip 이 남는다.
 */
const REQUIRE_DIST = process.env["BB_REQUIRE_DIST"] === "1";
if (REQUIRE_DIST && !existsSync(DIST)) {
  throw new Error(
    `BB_REQUIRE_DIST=1 인데 ${DIST} 가 없다 — 빌드 뒤에 돌려라. skip 으로 넘기면 「합격」으로 읽힌다`,
  );
}

/** dist 안의 모든 `.html` — **디렉터리별로** 모은다(상한이 디렉터리 단위라서) */
function byDirectory(dir: string, out = new Map<string, string[]>()): Map<string, string[]> {
  for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const p = join(dir, e.name);
    if (e.isDirectory()) byDirectory(p, out);
    else if (e.name.endsWith(".html")) {
      const key = relative(DIST, dir).split(sep).join("/") || ".";
      // ⚠**배열을 새로 만들지 않는다** — 한 디렉터리에 878장인 곳이 있어서 복사가 제곱이 된다
      const list = out.get(key);
      if (list === undefined) out.set(key, [p]);
      else list.push(p);
    }
  }
  return out;
}

/**
 * 검사 대상. **한 번만 읽고 세 시험이 나눠 쓴다** — 세 번 읽으면 비용이 세 배다.
 *
 * ⚠`season` 은 탭 목록을 비교하는 단위다. `他大会` 는 **그 시즌에 기록이 있을 때만** 나오므로
 * (`hasPostseason`), 시즌을 섞어 비교하면 **올바른 설계를 결함이라고 부르게 된다.**
 */
interface Screen {
  file: string;
  season: string;
  tabs: string[];
  current: string[];
  hasHeader: boolean;
  /** 헤더 검색창의 **보이는 글자**와 **접근성 이름**. 헤더가 없으면 둘 다 `null` */
  q: { ph: string; aria: string } | null;
}

/**
 * 헤더 검색창을 뜯는다.
 *
 * ⚠**이 상자가 쓰는 것은 전부 시즌 자산이다** — 색인 `players.json` · 결과 링크
 * `players/*.html` · 「すべて見る」의 `players.html`. 그 시즌에 그게 없으면 **다른 시즌의
 * 것을 뒤진다**(`data-base`). 그 사실을 말하는지 아래 시험이 dist 전체에서 센다.
 */
function searchBoxOf(head: string): { ph: string; aria: string } | null {
  const input = /<input id="q"[^>]*>/.exec(head);
  if (input === null) return null;
  return {
    ph: (/placeholder="([^"]*)"/.exec(input[0]) ?? ["", ""])[1]!,
    aria: (/aria-label="([^"]*)"/.exec(input[0]) ?? ["", ""])[1]!,
  };
}

const dirs = existsSync(DIST) ? byDirectory(DIST) : new Map<string, string[]>();
const picked = [...dirs.values()].flatMap((fs) => (FULL ? fs : sample(fs)));
const screens: Screen[] = picked.map((f) => {
  const head = headOf(f);
  const rel = relative(DIST, f).split(sep).join("/");
  return {
    file: rel,
    // 과거 시즌은 `2025/…` 접두사를 갖는다. 없으면 현재 시즌이다
    season: /^(\d{4})\//.exec(rel)?.[1] ?? "current",
    tabs: tabsOf(head),
    current: currentValues(head),
    hasHeader: head !== "",
    q: searchBoxOf(head),
  };
});
/** 분모를 말한다(작업규칙 7) — 「전부 통과」가 아니라 「몇 장 중 몇 장」 */
const SCOPE = `${screens.length}장 / 디렉터리 ${dirs.size}개${FULL ? "(전수)" : `(디렉터리당 최대 ${PER_DIR}장)`}`;

/**
 * ⚠**그물의 크기 자체를 못 박는다**(2026-08-19 검토 ②).
 *
 * 범위와 관련된 유일한 하한이 아래의 `withTabs.length >= 5` 였다.
 * 그런데 **선수 페이지 6,207장에 `aria-current` 가 하나도 없던 그 상태**의 분모가
 * 정확히 **11장 · 디렉터리 1개**였고, `11 >= 5` 라 그때도 초록이었다.
 * 즉 누군가 `byDirectory` 를 옛 `readdirSync(DIST)`(최상위만)로 되돌려도 **아무 단언도 안 떨어진다.**
 * 재귀한다는 사실이 코드에만 있고, 그것을 지키는 것이 하나도 없었다.
 *
 * → **분모를 값으로 못 박는다.** 실측(2026-08-19): **45디렉터리 / 523장**.
 * ⚠**하한은 실측보다 낮게** 둔다 — 시즌이 줄거나 렌더러가 빠지는 것은 정상이고,
 *   그때마다 빨개지면 사람이 하한을 지운다. 다만 **최상위만 보는 상태(1개 / 11장)와는
 *   자릿수가 다르게** 둔다. 이 단언이 막는 것은 정확히 그 회귀 하나다.
 * ⚠**개수만으로는 부족하다.** 선수 페이지가 통째로 빠져도 다른 디렉터리가 수를 채워 준다 —
 *   그런데 이 시험이 실제로 결함을 찾아낸 곳이 바로 그 디렉터리다. **이름으로도 본다.**
 */
test(
  "⚠검사 범위가 dist 전체다 — 최상위만 보던 동안 선수 페이지 6,207장이 숨어 있었다",
  { skip: screens.length === 0 ? "dist 없음" : false },
  () => {
    /**
     * ⚠**하한을 시즌 수에 걸지 마라.** 처음엔 `dirs.size >= 40` · `screens.length >= 500`
     * (9시즌 dist 실측 45/523)이었는데, 그러면 **한 시즌만 빌드하고 시험을 돌리는 정상 워크플로가 떨어진다** —
     * `packages/web` 의 자체 `build` 는 2026 한 시즌만 만들고 **같은 `dist/` 에 쓴다**(2026-08-19 판정).
     * 이 시험이 잡아야 하는 것은 **「재귀가 끊겼는가」**이지 「dist 가 몇 시즌인가」가 아니다.
     * → 아래 셋은 전부 **시즌 수와 무관하게** 재귀 여부만 잰다.
     */
    // ⚠**루트 키는 `""` 가 아니라 `"."` 다**(`byDirectory` 의 `|| "."`). 처음에 `!== ""` 로 걸렀다가
    //   루트가 「하위 디렉터리」로 세어져 메시지가 「1개뿐」이라고 거짓말했다(2026-08-19 실측).
    const nested = [...dirs.keys()].filter((d) => d !== ".");
    assert.ok(
      nested.length >= 3,
      `하위 디렉터리가 ${nested.length}개뿐이다 — 재귀가 끊겼다(최상위만 보면 0개다). ${SCOPE}`,
    );
    /**
     * ⚠**이것이 진짜 그물이다.** 최상위만 보던 옛 코드에서는 이 값이 **0** 이고,
     * 선수 페이지가 정확히 **6,207장 숨어 있던 자리**다(2026-08-19). 시즌 수와 무관하게 성립한다 —
     * 한 시즌만 빌드해도 `players/` 는 생긴다.
     */
    const players = screens.filter((s) => s.file.startsWith("players/"));
    assert.ok(
      players.length > 0,
      `선수 페이지가 표본에 한 장도 없다 — 2026-08-19 에 잡은 결함이 있던 자리다(${SCOPE})`,
    );
    /** 표본이 최상위 11장 수준으로 쪼그라들지 않았는가(한 시즌 빌드에서도 80장 이상 나온다) */
    assert.ok(
      screens.length >= 50,
      `검사 대상이 ${screens.length}장뿐이다 — 재귀가 끊겼을 때의 규모다. ${SCOPE}`,
    );
  },
);

/**
 * ⚠**시즌 안에서 비교한다.** `他大会` 탭만이 시즌에 따라 있고 없다 —
 * 그 하나 때문에 전 시즌을 한 덩어리로 비교하면, 포스트시즌 기록이 아직 없는 시즌이
 * 통째로 빨개진다(2026년은 실제로 그런 시기가 있었다).
 */
test("⚠모든 화면의 탭 목록이 같다 — 홈만 하나 모자라던 결함", { skip: screens.length === 0 ? "dist 없음" : false }, () => {
  const withTabs = screens.filter((s) => s.tabs.length > 0);
  // ⚠**이 하한은 「탭이 있는 화면이 존재하는가」만 본다.** 범위(분모)를 지키는 것은
  //   위의 「검사 범위가 dist 전체다」다 — 여기 `>= 5` 는 최상위 11장에서도 참이었다
  assert.ok(withTabs.length >= 5, `검사한 화면이 너무 적다: ${withTabs.length}(${SCOPE})`);
  const bad: string[] = [];
  const wantOf = new Map<string, { file: string; tabs: string[] }>();
  for (const s of withTabs) {
    const want = wantOf.get(s.season);
    if (want === undefined) {
      wantOf.set(s.season, { file: s.file, tabs: s.tabs });
      continue;
    }
    if (s.tabs.join("|") !== want.tabs.join("|")) {
      bad.push(`${s.file}: ${s.tabs.join("·")}  (기준 ${want.file}: ${want.tabs.join("·")})`);
    }
  }
  assert.deepEqual(bad, [], `시즌 안에서 탭 목록이 화면마다 다르다(${SCOPE})\n  ${bad.join("\n  ")}`);
});

/**
 * ⚠**시즌이 달라도 「他大会」 말고는 같아야 한다.**
 * 위 시험이 시즌별이라, 시즌 사이에서 탭이 통째로 어긋나는 것은 아무도 안 보게 된다 —
 * 과거 시즌 렌더링 경로에만 생기는 결함(`base`/`root` 계산)이 실제로 있었던 자리다.
 */
test("⚠시즌이 달라도 탭 줄기는 같다 — 다른 것은 他大会 하나뿐이다", { skip: screens.length === 0 ? "dist 없음" : false }, () => {
  // ⚠**이 하나만 조건부다**(layout.ts `hasPostseason`). 늘어나면 여기도 함께 고쳐야 한다
  const OPTIONAL = new Set(["他大会"]);
  const shapes = new Map<string, string>();
  for (const s of screens) {
    if (s.tabs.length === 0) continue;
    const key = s.tabs.filter((t) => !OPTIONAL.has(t)).join("|");
    if (!shapes.has(key)) shapes.set(key, `${s.file}(${s.season})`);
  }
  assert.equal(
    shapes.size,
    1,
    `시즌에 따라 탭 줄기가 다르다(${SCOPE})\n  ${[...shapes].map(([k, f]) => `${f}: ${k}`).join("\n  ")}`,
  );
});

/**
 * ⚠**「지금 어디에 있는가」가 어느 화면에서나 보여야 한다.**
 * 홈에서는 `aria-current` 가 브랜드에 붙는데 `.brand[aria-current]` 에 **CSS 가 없어서**
 * 아무것도 선택돼 보이지 않았다. 마크업만 맞고 화면은 틀린 상태였다.
 * ⚠**재귀시키자 선수 페이지 6,207장이 여기 걸렸다**(2026-08-19) — `nav:"player"` 인데
 * 그 이름의 탭이 없어서 표시가 통째로 없었다. 최상위 11장만 보던 동안은 안 보였다.
 */
test("⚠모든 화면이 「지금 여기」를 표시한다", { skip: screens.length === 0 ? "dist 없음" : false }, () => {
  const bad = screens.filter((s) => s.hasHeader && s.current.length === 0).map((s) => s.file);
  assert.deepEqual(
    bad,
    [],
    `현재 위치 표시가 없는 화면 ${bad.length}장(${SCOPE}): ${bad.slice(0, 5).join(", ")}`,
  );
});

/**
 * ⚠**마크업만 맞고 화면은 비어 있을 수 있다.**
 * `days.html`·`starters.html` 이 정확히 그랬다 — `aria-current="true"` 는 붙어 있는데
 * CSS 가 `="page"` 만 스타일해서 **아무것도 선택돼 보이지 않았다**.
 * 그래서 **실제로 쓰이는 값마다 CSS 규칙이 있는지**까지 검사한다.
 */
test("⚠쓰이는 aria-current 값마다 CSS 규칙이 있다 — 보이지 않으면 표시가 아니다", { skip: screens.length === 0 ? "dist 없음" : false }, () => {
  const used = new Set(screens.flatMap((s) => s.current));
  assert.ok(used.size > 0, `aria-current 를 쓰는 화면이 없다(${SCOPE})`);
  const css = readFileSync(join(DIST, "assets", "site.css"), "utf8");
  const missing = [...used].filter((v) => !css.includes(`[aria-current="${v}"]`));
  assert.deepEqual(missing, [], `CSS 규칙이 없는 값: ${missing.join(", ")}(쓰이는 값: ${[...used].join(", ")})`);
});

/**
 * ⚠⚠**검색창이 조용히 다른 해를 뒤지고 있었다**(2026-09-07 이중 검토 P0).
 *
 * 드래프트만 굽는 시즌(2005~2017)에는 시즌 자산이 하나도 없어서 `data-base` 가 **다른 시즌**을
 * 가리킨다 — 그건 색인이 404 로 떨어지지 않게 하려고 일부러 그렇게 한 것이다(2026-09-07).
 * 그런데 **화면은 그 사실을 한 마디도 안 했다**: 2010년 화면에서 검색하면 2026년 선수가 나온다.
 * ⚠**링크 검사가 못 잡는다** — 그 URL 은 클라이언트가 `fetch` 로 만든다. **dist 를 직접 세는
 *   이 그물이 그 자리를 지키는 유일한 장치다.**
 * ⚠**두 방향 다 잰다**: 다른 해를 뒤지면 **반드시 말하고**, 자기 해를 뒤지면 **말하지 않는다.**
 *   후자를 안 재면 **9,379장**(2026-09-07 배포물 실측 · 전체 9,392장)에 없던 글자가 붙어도
 *   아무도 모른다 — 전 페이지가 새 파일이 되어 그날 배포가 통째로 다시 올라간다.
 */
test("⚠검색창이 자기가 뒤지는 해를 말한다 — 잠자코 다른 해를 내놓지 않는다", { skip: screens.length === 0 ? "dist 없음" : false }, () => {
  const withBox = screens.filter((s) => s.q !== null);
  assert.ok(withBox.length >= 50, `검색창이 있는 화면이 ${withBox.length}장뿐이다(${SCOPE})`);
  const bad: string[] = [];
  for (const s of withBox) {
    const q = s.q!;
    // ⚠**보이는 글자가 이름 안에 있어야 한다**(WCAG 2.5.3 label-in-name) — 예외 없다
    if (!q.aria.startsWith(q.ph)) bad.push(`${s.file}: 보이는 글자가 이름 안에 없다 ${q.ph} / ${q.aria}`);
    /**
     * **그 화면이 뒤지는 선수 일람이 자기 시즌에 있는가.** 있으면 같은 해, 없으면 다른 해다 —
     * ⚠**여기서 시즌을 다시 해석하지 않는다**(M1): 파일이 있는지만 본다.
     */
    const dir = s.season === "current" ? "" : `${s.season}/`;
    const own = existsSync(join(DIST, dir, "players.html"));
    if (own && q.ph !== "選手を検索") bad.push(`${s.file}: 자기 해를 뒤지는데 해를 적었다 — ${q.ph}`);
    if (own && q.aria !== "選手を検索") bad.push(`${s.file}: 자기 해를 뒤지는데 설명이 붙었다 — ${q.aria}`);
    if (!own && !/^\d{4}年の/.test(q.ph)) bad.push(`${s.file}: 다른 해를 뒤지는데 해를 안 적었다 — ${q.ph}`);
    if (!own && !/年へ移動します）$/.test(q.aria)) {
      bad.push(`${s.file}: 다른 해를 뒤지는데 어디로 가는지 말하지 않는다 — ${q.aria}`);
    }
  }
  assert.deepEqual(bad, [], `검색창이 자기가 뒤지는 해를 말하지 않는다(${SCOPE})\n  ${bad.slice(0, 5).join("\n  ")}`);
});

/**
 * ⚠**「CI 는 전수로 돈다」도 코드에만 있는 약속이었다**(2026-08-19 검토 ①).
 *
 * 위 시험들이 기본값에서 강제하는 분모는 **523/15,340 = 3.4%** 다. 나머지 96.6%는
 * `daily.yml` 의 「시험」 단계가 `BB_FULL_SCAN=1` 을 주기 때문에만 밟힌다 —
 * 그 한 줄이 지워지면 **아무것도 안 떨어지고**, 배포는 3.4% 짜리 그물로 계속 나간다.
 * ⚠**같은 종류의 구멍이 `BB_REQUIRE_DIST`·`BB_REQUIRE_DB` 에도 있다** — 둘 다
 * 「없으면 skip 되고 종료 코드 0」을 막는 값이라, 지워지면 **초록인 채로 아무것도 안 잰다.**
 * 셋을 한자리에서 못 박는다.
 *
 * ⚠**YAML 을 파싱하지 않는다** — 파서를 들이면 그 의존이 이 시험의 새 실패 원인이 된다.
 * 「시험」 단계의 글자를 잘라 보는 것으로 충분하고, 형식이 바뀌면 여기가 먼저 빨개진다.
 */
test("⚠배포 잡의 시험 단계가 전수로 돈다 — 3.4% 짜리 그물로 배포하지 않는다", () => {
  const wf = join(ROOT, ".github", "workflows", "daily.yml");
  const src = readFileSync(wf, "utf8").replace(/\r/g, "");
  // ⚠**「하나뿐인가」까지 본다** — 여럿이면 첫 번째만 재고 나머지는 그대로 새어 나간다
  const heads = [...src.matchAll(/^ +- name: 시험$/gm)];
  assert.equal(heads.length, 1, `daily.yml 의 「시험」 단계가 ${heads.length}개다 — 어느 것을 재는지 모른다: ${wf}`);
  const at = heads[0]!.index;
  const next = src.indexOf("- name: ", at + 10);
  const step = src.slice(at, next < 0 ? src.length : next);
  assert.match(step, /^ +run: npm test$/m, "「시험」 단계가 npm test 를 돌리지 않는다");
  for (const key of ["BB_REQUIRE_DIST", "BB_REQUIRE_DB", "BB_FULL_SCAN"]) {
    assert.match(
      step,
      new RegExp(`^ +${key}: "1"$`, "m"),
      `daily.yml 「시험」 단계에 ${key}: "1" 이 없다 — 그 값이 없으면 시험이 초록인 채로 덜 잰다`,
    );
  }
});
