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
 */
export function freshnessBar(f: Freshness): RawHtml {
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

export interface PageOptions {
  title: string;
  /** 사이트 루트까지의 상대 경로. 루트는 `""`, `players/` 아래는 `"../"` */
  base: string;
  color: TeamColor;
  /** 배면에 세로로 넣을 문자열. 없으면 배면은 색만 낸다 */
  spine?: string;
  freshness: Freshness;
  site: SiteMeta;
  /** 본문. 블록들이 여기 들어간다 */
  body: RawHtml;
  /** 조립 UI가 필요한 페이지만 true */
  interactive?: boolean;
  /** 클라이언트에 실어 보낼 스크립트 본문(블록 카탈로그 등) */
  bootstrapJs?: string;
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
  const script =
    o.interactive === true ? html`<script src="${o.base}assets/site.js" defer></script>` : raw("");

  const doc = html`<!doctype html>
<html lang="ja" data-base="${o.base}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${o.title}</title>
<meta name="robots" content="noindex, nofollow">
<link rel="stylesheet" href="${o.base}assets/site.css">
</head>
<body style="${style}">
<div class="shell">
  <div class="spine">${o.spine === undefined ? null : html`<span class="vt">${o.spine}</span>`}</div>
  <div class="main">
    ${freshnessBar(o.freshness)}
    ${o.body}
    <footer class="foot">
      出典：日本野球機構（NPB）公式サイト <a href="https://npb.jp/" rel="noreferrer noopener">npb.jp</a>。
      本ページの数値は公表記録をもとに<b>当サイトが独自に再計算</b>したものです。原本の表を再現するものではありません。<br>
      掲載内容の削除・訂正のご依頼は ${o.site.contact === "" ? html`<b>連絡先が未設定です（公開前に設定してください）</b>` : o.site.contact} まで。<br>
      ${o.site.name} by Lunomel · ${fullDate(o.freshness.builtOn)} 生成
    </footer>
  </div>
</div>
${boot}
${script}
</body>
</html>`;

  return toString(doc);
}
