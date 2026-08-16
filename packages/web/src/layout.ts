/**
 * 페이지 셸 — 배면(背表紙)·신선도 띠·꼬리말.
 *
 * ⚠**꼬리말은 장식이 아니라 법적 안전장치다**(L3·L4). 출처 명기와 삭제·정정 요청 창구는
 * 전 화면에 있어야 한다. 지우지 마라.
 */
import { html, raw, toString } from "./html.ts";
import type { RawHtml } from "./html.ts";
import type { TeamColor } from "@bb-app/domain";
import { fullDate } from "./format.ts";

/**
 * 화면의 4상태(M12).
 * ⚠**「데이터 없음」과 「수집 실패」를 같은 화면으로 만들지 마라.** 그 자체가 결함이다.
 */
export type DataState =
  | { kind: "ok" }
  | { kind: "empty"; detail: string }
  | { kind: "failed"; detail: string }
  | { kind: "offseason"; detail: string };

/** 정적 생성이므로 「로딩」은 페이지 단위로는 존재하지 않는다 — 클라이언트가 가져오는 검색 색인에만 있다. */
export function stateNote(state: DataState): RawHtml {
  switch (state.kind) {
    case "ok":
      return raw("");
    case "empty":
      return html`<p class="empty">${state.detail}</p>`;
    case "failed":
      return html`<p class="empty" role="status">取得できていません — ${state.detail}</p>`;
    case "offseason":
      return html`<p class="empty">シーズン外 — ${state.detail}</p>`;
  }
}

export interface Freshness {
  /** 아카이브에 들어온 가장 최근 경기일 `YYYY-MM-DD` */
  latestGameDate: string | null;
  /** 이 사이트를 만든 날 `YYYY-MM-DD`. **주입된 시계에서 온다**(M6) */
  builtOn: string;
  /** 경기일과 생성일의 간격(일). null이면 경기가 하나도 없다 */
  lagDays: number | null;
}

/** 며칠까지를 「최신」으로 볼 것인가. 하루 1회 배치라 전날 경기까지가 정상이다. */
export const STALE_AFTER_DAYS = 3;

export function isStale(f: Freshness): boolean {
  return f.lagDays === null || f.lagDays > STALE_AFTER_DAYS;
}

function daysBetween(fromIso: string, toIso: string): number {
  const a = Date.parse(`${fromIso}T00:00:00Z`);
  const b = Date.parse(`${toIso}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

export function freshness(latestGameDate: string | null, builtOn: string): Freshness {
  return {
    latestGameDate,
    builtOn,
    lagDays: latestGameDate === null ? null : daysBetween(latestGameDate, builtOn),
  };
}

/**
 * 신선도 띠. **낡았을 때만 눈에 띄게** 한다 — 정상일 때 경고색을 쓰면 경고가 소음이 된다.
 *
 * @param pastSeason 지난 시즌의 화면인가.
 *   ⚠**끝난 시즌에 「更新が止まっています」라고 쓰지 마라.** 수집이 죽은 것이 아니라
 *   시즌이 끝난 것이고, 경고를 남발하면 진짜 경고가 안 보이게 된다.
 *   실측(2026-08-16): 2025년 화면 2,307장 전부가 「315일 전」이라는 빨간 띠를 달고 있었다.
 */
export function freshnessBar(f: Freshness, pastSeason = false): RawHtml {
  if (pastSeason) {
    return f.latestGameDate === null
      ? html`<div class="state fresh">このシーズンの試合はありません</div>`
      : html`<div class="state fresh">終了したシーズンです — 最後の試合は ${fullDate(f.latestGameDate)}</div>`;
  }
  if (f.latestGameDate === null) {
    return html`<div class="state stale" role="status">
      <b>データがありません</b> — まだ試合を取り込んでいません
    </div>`;
  }
  const latest = fullDate(f.latestGameDate);
  if (isStale(f)) {
    return html`<div class="state stale" role="status">
      <b>更新が止まっています</b> — 最新の試合は ${latest}（${f.lagDays}日前）。取得に失敗している可能性があります
    </div>`;
  }
  return html`<div class="state fresh">最新の試合 ${latest} まで反映</div>`;
}

export interface SiteMeta {
  /** 제품명 미확정 — 확정 전에는 `bb-app`(CLAUDE.md §7) */
  name: string;
  /** 삭제·정정 요청 창구(L4). **비어 있으면 화면이 그 사실을 말한다** */
  contact: string;
}

/** 전역 헤더에서 지금 어디에 있는지. `aria-current`로 나간다 */
export type NavKey = "today" | "index" | "ranking" | "matchup" | "compare" | "log" | "player";

/**
 * 시즌 전환의 한 칸.
 *
 * ⚠**같은 화면의 다른 시즌으로 보낸다.** 2026 순위표를 보다가 2025를 누르면 2025 순위표여야지
 * 첫 화면으로 튕기면 안 된다.
 * ⚠**없는 화면으로 링크하지 않는다.** 2026에만 있는 선수의 2025 페이지는 존재하지 않는다 —
 * 그때는 그 시즌의 선수 일람으로 보내고, 읽어 주는 화면이 그 사실을 말한다.
 */
export interface SeasonLink {
  season: number;
  /** 이 페이지에서 본 상대 경로 */
  href: string;
  current: boolean;
  /** 같은 화면이 없어서 다른 곳으로 보내는가 */
  fallback: boolean;
  /** 보내는 곳의 이름. ⚠**어디로 가는지 말하지 않는 링크는 눌러 보기 전에는 알 수 없다** */
  fallbackTo: string;
}

export interface PageOptions {
  title: string;
  /**
   * **그 시즌의 루트**까지의 상대 경로. 시즌 안의 링크는 전부 이걸 쓴다.
   * 현재 시즌의 최상위는 `""`, `players/` 아래는 `"../"`.
   */
  base: string;
  /**
   * **사이트 루트**까지의 상대 경로. 자산(CSS·JS)과 시즌 전환이 쓴다.
   *
   * ⚠현재 시즌은 `base`와 같지만, 과거 시즌은 한 단계 더 위다(`2025/players/x.html` → `../../`).
   * 둘을 하나로 합치면 과거 시즌에서 CSS가 조용히 404가 된다.
   */
  root: string;
  /** 시즌 전환. 시즌이 하나뿐이면 빈 배열 — 그때는 띠를 그리지 않는다 */
  seasons: readonly SeasonLink[];
  color: TeamColor;
  /** 배면에 세로로 넣을 문자열. 없으면 배면은 색만 낸다 */
  spine?: string;
  freshness: Freshness;
  site: SiteMeta;
  nav: NavKey;
  /** 본문. 블록들이 여기 들어간다 */
  body: RawHtml;
  /** 클라이언트에 실어 보낼 스크립트 본문(블록 카탈로그 등) */
  bootstrapJs?: string;
}

/**
 * 전역 헤더.
 *
 * ⚠**검색과 이동은 어느 화면에서나 손에 닿아야 한다.** 최하단 링크 하나로 두면
 * 1000행짜리 순위표 아래에 묻히고, 모바일에서는 사실상 없는 기능이 된다.
 */
function topbar(o: PageOptions): RawHtml {
  const here = (key: NavKey): RawHtml =>
    o.nav === key ? raw(' aria-current="page"') : raw("");
  return html`<header class="topbar">
  <a class="brand" href="${o.base}index.html">${o.site.name}<b>by Lunomel</b></a>
  <div class="qbox">
    <input id="q" type="search" autocomplete="off" placeholder="選手を検索"
      aria-label="選手を検索" role="combobox" aria-expanded="false" aria-controls="qhits" aria-autocomplete="list">
    <ul class="qhits" id="qhits" role="listbox" aria-label="検索結果" hidden></ul>
  </div>
  <nav class="tnav" aria-label="主要ページ">
    <a href="${o.base}today.html"${here("today")}>試合</a>
    <a href="${o.base}index.html"${here("index")}>一覧</a>
    <a href="${o.base}ranking.html"${here("ranking")}>順位</a>
    <a href="${o.base}matchup.html"${here("matchup")}>対戦</a>
    <a href="${o.base}compare.html"${here("compare")}>比較</a>
    <!-- ⚠수집 로그는 시즌별이 아니라 사이트 전체다(「언제 어디서 데이터가 들어왔나」).
         과거 시즌에는 만들지 않으므로 링크는 root로 현재 시즌의 것을 가리킨다.
         base로 두면 2025 화면 2,307장이 전부 404가 된다(2026-08-16 실측 1,585종). -->
    <a href="${o.root}log.html"${here("log")}>記録</a>
  </nav>
  <button class="tbtn" type="button" id="themeBtn" aria-label="表示テーマ">自動</button>
</header>`;
}

/**
 * 시즌 전환 띠.
 *
 * ⚠**시즌이 하나뿐이면 그리지 않는다.** 고를 것이 없는 조작은 화면을 무겁게 할 뿐이다.
 * ⚠**「シーズン」이라고 이름을 붙인다.** 연도 두 개만 떠 있으면 그게 무엇을 고르는 것인지
 *   알 수 없다 — 순위표의 리그 탭과 헷갈린다.
 * ⚠**같은 화면의 다른 시즌으로 간다.** 그 시즌에 같은 화면이 없으면(2026에만 있는 선수 등)
 *   그 시즌의 선수 일람으로 보내고, `aria-label`이 그렇게 말한다.
 */
/**
 * 이 페이지가 **지난 시즌**의 것인가.
 *
 * `seasons`는 새 시즌이 앞이므로, 첫 칸이 현재 페이지가 아니면 지난 시즌이다.
 */
function isPastSeason(o: PageOptions): boolean {
  return o.seasons.length > 1 && o.seasons[0]?.current === false;
}

function seasonBar(o: PageOptions): RawHtml {
  if (o.seasons.length < 2) return raw("");
  return html`<nav class="seasons" aria-label="シーズン">
  <span class="slab">シーズン</span>
  ${o.seasons.map(
    (s) =>
      html`<a href="${s.href}"${s.current ? raw(' aria-current="page"') : raw("")}
      ${s.fallback
        ? raw(` aria-label="${s.season}年（このページの${s.season}年版はありません。${s.fallbackTo}へ移動します）"`)
        : raw("")}>${s.season}年${s.fallback ? html`<i aria-hidden="true">→</i>` : null}</a>`,
  )}
</nav>`;
}


/**
 * 한 페이지의 경로 정보.
 *
 * ⚠**렌더러가 `base`를 손으로 적지 않는다.** 예전에는 각 렌더러가 `const base = "../"`처럼
 * 깊이를 직접 썼는데, 시즌 접두사가 붙는 순간 그 상수들이 전부 조용히 어긋난다.
 * **자기 경로만 말하면 깊이는 여기서 센다.**
 */
/**
 * 그 시즌에 같은 화면이 없을 때 보낼 곳.
 *
 * ⚠**날짜 화면을 選手一覧으로 보내지 않는다.** 2026-08-13은 2025년에 없지만
 * 「그 시즌의 날짜 일람」은 있다 — 가장 가까운 곳으로 보내는 편이 덜 놀랍다.
 */
export interface Fallback {
  path: string;
  label: string;
}

const DEFAULT_FALLBACK: Fallback = { path: "index.html", label: "選手一覧" };

export interface PagePaths {
  base: string;
  root: string;
  seasons: SeasonLink[];
}

/** 한 시즌의 배치 */
export interface SeasonPlan {
  season: number;
  /** 사이트 루트에서 이 시즌까지의 접두사. 현재 시즌은 `""`, 과거는 `"2025/"` */
  prefix: string;
  /** 이 시즌이 실제로 만드는 화면 경로(시즌 안 기준) */
  paths: ReadonlySet<string>;
}

/**
 * 시즌 배치에서 경로 계산기를 만든다.
 *
 * @param plans 전 시즌. **새 시즌이 앞**
 * @param current 지금 그리는 시즌
 */
export function pathsFor(
  plans: readonly SeasonPlan[],
  current: number,
): (selfPath: string, fallback?: Fallback) => PagePaths {
  const me = plans.find((p) => p.season === current);
  const prefixDepth = me === undefined || me.prefix === "" ? 0 : me.prefix.split("/").filter(Boolean).length;

  return (selfPath: string, fallback: Fallback = DEFAULT_FALLBACK): PagePaths => {
    const depth = selfPath.split("/").length - 1;
    const base = "../".repeat(depth);
    const root = "../".repeat(depth + prefixDepth);
    return {
      base,
      root,
      seasons: plans.map((p) => {
        if (p.season === current) {
          return {
            season: p.season, href: `${base}${selfPath}`, current: true,
            fallback: false, fallbackTo: fallback.label,
          };
        }
        // ⚠**없는 화면으로 링크하지 않는다.** 2026에만 있는 선수의 2025 페이지는 없다
        const has = p.paths.has(selfPath);
        return {
          season: p.season,
          href: `${root}${p.prefix}${has ? selfPath : fallback.path}`,
          current: false,
          fallback: !has,
          fallbackTo: fallback.label,
        };
      }),
    };
  };
}

/**
 * 화면이 공통으로 받는 것.
 *
 * ⚠**한 벌만 둔다**(M1의 정신). 예전에는 `pages.ts`·`player-page.ts`·`log-page.ts`에
 * 같은 이름의 타입이 각각 있었고, 필드를 늘릴 때마다 세 곳을 고쳐야 했다.
 */
export interface RenderContext {
  site: SiteMeta;
  freshness: Freshness;
  /** 이 페이지의 경로. **자기 경로만 말하면 나머지는 계산된다** */
  paths: (selfPath: string, fallback?: Fallback) => PagePaths;
}

const LT = String.fromCharCode(0x3c);
const LINE_SEP = String.fromCharCode(0x2028);
const PARA_SEP = String.fromCharCode(0x2029);

/**
 * 인라인 `<script>`에 넣기 전에 문서를 끊을 수 있는 문자를 죽인다.
 *
 * ⚠**`</script>`가 문자열 안에 있으면 브라우저가 거기서 스크립트를 끝낸다.** 선수명·팀명은
 * 우리가 만든 값이 아니므로 반드시 막는다. U+2028·U+2029는 JS 문법상 줄바꿈이라 같은 이유로 막는다.
 */
export function safeScript(js: string): string {
  return js
    .split(LT)
    .join("\\u003c")
    .split(LINE_SEP)
    .join("\\u2028")
    .split(PARA_SEP)
    .join("\\u2029");
}

export function page(o: PageOptions): string {
  const style = `--team:${o.color.base};--team-ink:${o.color.ink}`;
  const boot =
    o.bootstrapJs === undefined ? raw("") : html`<script>${raw(safeScript(o.bootstrapJs))}</script>`;

  const doc = html`<!doctype html>
<html lang="ja" data-base="${o.base}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${o.title}</title>
<meta name="robots" content="noindex, nofollow">
<meta name="color-scheme" content="light dark">
<link rel="stylesheet" href="${o.root}assets/site.css">
</head>
<body style="${style}">
<a class="skip" href="#main">本文へ</a>
${topbar(o)}
${seasonBar(o)}
<div class="shell">
  <div class="spine">${o.spine === undefined ? null : html`<span class="vt">${o.spine}</span>`}</div>
  <main class="main" id="main">
    ${freshnessBar(o.freshness, isPastSeason(o))}
    ${o.body}
    <footer class="foot">
      出典：日本野球機構（NPB）公式サイト <a href="https://npb.jp/" rel="noreferrer noopener">npb.jp</a>。
      本ページの数値は公表記録をもとに<b>当サイトが独自に再計算</b>したものです。原本の表を再現するものではありません。<br>
      選手の写真・球団ロゴは<b>使用していません</b>（記録は事実ですが、写真とロゴは別の権利です）。<br>
      掲載内容の削除・訂正のご依頼は ${o.site.contact === "" ? html`<b>連絡先が未設定です（公開前に設定してください）</b>` : o.site.contact} まで。<br>
      ${o.site.name} by Lunomel · ${fullDate(o.freshness.builtOn)} 生成
    </footer>
  </main>
</div>
<!-- 용어 설명. ⚠**모든 페이지에 있어야 한다** — 용어는 순위표에도 대전표에도 나온다 -->
<div id="tip" role="tooltip" hidden></div>
${boot}
<script src="${o.root}assets/site.js" defer></script>
</body>
</html>`;

  return toString(doc);
}
