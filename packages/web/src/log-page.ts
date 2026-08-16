/**
 * 収集ログ — **이 사이트의 숫자가 언제 어디서 왔는가**.
 *
 * ⚠**이 화면은 장식이 아니라 §0-10(출처 추적성)과 M4의 화면판이다.**
 * 「어제 본 숫자와 다른데?」에 답하지 못하면 버그와 정정을 구별할 수 없다.
 *
 * ⚠**경기가 없는 날과 수집이 멈춘 날은 DB만 봐서는 같아 보인다.**
 * 그래서 두 가지를 나란히 낸다 —
 *   ① 경기일별 취득 상황(DB) — 구멍이 보인다
 *   ② 실행 기록(JSONL) — 「돌았는데 0건」과 「안 돌았다」를 가른다
 * 하나만으로는 조용한 죽음을 못 잡는다. 이 서비스가 죽는 가장 흔한 방식이 그것이다.
 */
import { html, raw } from "./html.ts";
import type { RawHtml } from "./html.ts";
import { fullDate } from "./format.ts";
import { block, note, scroller } from "./parts.ts";
import { page } from "./layout.ts";
import type { Freshness, SiteMeta } from "./layout.ts";
import { NEUTRAL_COLOR } from "@bb-app/domain";

/** 경기일 하루치 취득 상황 */
export interface CoverageDay {
  /** `YYYY-MM-DD` (JST) */
  date: string;
  /** 그날 일정에 있던 경기 수 */
  scheduled: number;
  /** 실제로 치러진 경기 수 */
  played: number;
  /** 중지·연기 */
  notPlayed: number;
  /** 타석 로그가 들어온 경기 수. **치러졌는데 로그가 없으면 그것이 결함이다** */
  withPa: number;
}

/** 배치 1회의 기록. `scripts/freshness.ts --json`이 남긴다 */
export interface RunRecord {
  ranAt: string;
  todayJst: string;
  latestGameDate: string | null;
  games: number;
  pa: number;
  players: number;
  noHand: number;
  quarantine: number;
  stale: boolean;
}

/**
 * 격리된 기록 한 종류.
 *
 * ⚠**격리는 버그가 아니라 판단 요청이다.** 규칙 밖의 값을 버리지 않고 모아 둔 것이고,
 * 사람이 원문을 보고 규칙을 정해야 한다. 그래서 **빨간 실패로 칠하지 않는다** —
 * 정상 상태(0건)와 구별되기만 하면 된다.
 * ⚠**화면이 없으면 1건이 생겨도 아무도 모른다.** 그것이 이 표의 존재 이유다.
 */
export interface QuarantineKind {
  kind: string;
  count: number;
  /** 원문 표본 몇 개. **판단하려면 원문이 필요하다** */
  samples: { raw: string; detail: string | null; gameId: string | null }[];
}

export interface LogPageData {
  season: number;
  /** 최근 것이 앞. 화면에 싣는 만큼만 */
  coverage: CoverageDay[];
  /** 최근 것이 앞. 파일이 없으면 빈 배열 — **없는 것과 0건을 구별해 말한다**(M12) */
  runs: RunRecord[];
  /** 원시 아카이브 규모. 없으면 null */
  archive: { files: number; bytes: number; updatedAt: string } | null;
  totals: { games: number; pa: number; players: number; quarantine: number };
  /** 격리된 기록. 0건이면 빈 배열 — **「없다」와 「화면이 없다」는 다르다** */
  quarantine: QuarantineKind[];
  /** 수집 규약(L1). 코드에 있는 값을 그대로 표시한다 — 문서와 화면이 어긋나지 않게 */
  politeness: { minDelayMs: number; concurrency: number };
}

// ⚠**타입은 `layout.ts` 한 벌만 둔다.** 세 곳에 두면 필드를 늘릴 때마다 세 곳을 고친다
export type { RenderContext } from "./layout.ts";
import type { RenderContext } from "./layout.ts";

function mb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

/** UTC 실행 시각을 JST로 읽어 준다. ⚠경기일은 JST인데 실행 시각만 UTC면 사람이 헷갈린다 */
function jstStamp(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  const jst = new Date(t + 9 * 60 * 60 * 1000).toISOString();
  return `${jst.slice(0, 10)} ${jst.slice(11, 16)}`;
}

/**
 * 경기일별 취득 상황.
 *
 * ⚠**「일정 0건」과 「취득 실패」를 같은 칸에 그리지 않는다.** 월요일은 원래 경기가 없고,
 * 그날을 빨갛게 칠하면 경고가 소음이 된다. 반대로 **치러졌는데 타석 로그가 없는 날**은
 * 진짜 결함이므로 눈에 띄어야 한다.
 */
function coverageTable(days: readonly CoverageDay[]): RawHtml {
  if (days.length === 0) return html`<p class="empty">まだ試合が入っていません。</p>`;
  return html`${scroller(html`<table>
    <thead><tr><th class="l">試合日</th><th>予定</th><th>実施</th><th>中止</th><th>打席ログ</th><th class="l">状態</th></tr></thead>
    <tbody>${days.map((d) => {
      const missing = d.played - d.withPa;
      const state =
        d.scheduled === 0
          ? { cls: "", text: "試合なし" }
          : missing > 0
            ? { cls: "bad", text: `打席ログ${missing}試合ぶん未取得` }
            : { cls: "ok", text: "取得済み" };
      return html`<tr>
        <td class="l">${fullDate(d.date)}</td>
        <td>${d.scheduled}</td>
        <td>${d.played}</td>
        <td>${d.notPlayed === 0 ? "—" : d.notPlayed}</td>
        <td>${d.withPa}</td>
        <td class="l ${state.cls}">${state.text}</td>
      </tr>`;
    })}</tbody>
  </table>`)}
  ${note(
    "「中止」は雨天などで試合そのものが行われなかった日です。記録がないのではなく、記録すべき試合がありません。" +
      "⚠「試合なし」と「取り込めていない」は別ものです — 前者は日程どおり、後者は不具合です。",
  )}`;
}

/**
 * 배치 실행 기록.
 *
 * ⚠**기록이 없는 것과 0건인 것을 같은 화면으로 만들지 않는다**(M12).
 */
function runTable(runs: readonly RunRecord[]): RawHtml {
  if (runs.length === 0) {
    return html`<p class="empty">実行の記録がまだありません。次回の自動収集から記録されます。</p>`;
  }
  return html`${scroller(html`<table>
    <thead><tr><th class="l">実行（JST）</th><th class="l">最新試合日</th><th>試合</th><th>打席</th><th>選手</th><th>隔離</th><th class="l">判定</th></tr></thead>
    <tbody>${runs.map(
      (r) => html`<tr>
        <td class="l">${jstStamp(r.ranAt)}</td>
        <td class="l">${r.latestGameDate === null ? "—" : fullDate(r.latestGameDate)}</td>
        <td>${r.games.toLocaleString()}</td>
        <td>${r.pa.toLocaleString()}</td>
        <td>${r.players}</td>
        <td class="${r.quarantine > 0 ? "bad" : ""}">${r.quarantine}</td>
        <td class="l ${r.stale ? "bad" : "ok"}">${r.stale ? "古い" : "正常"}</td>
      </tr>`,
    )}</tbody>
  </table>`)}
  ${note(
    "⚠この記録がないと「試合が0件だった日」と「収集そのものが動かなかった日」を区別できません。" +
      "動いたことだけを残す成功ログでは、静かに止まった収集を見つけられないためです。" +
      "「隔離」は規則の外にあった記録で、捨てずに取っておいて人が判断するものです。",
  )}`;
}

/**
 * 격리된 기록.
 *
 * ⚠**0건을 「이상 없음」이라고만 쓰지 않는다.** 그러면 화면이 있는지 없는지 알 수 없다 —
 * 무엇을 세고 있는지 함께 말해야 「0건」이 정보가 된다.
 * ⚠**빨간 실패로 칠하지 않는다.** 격리는 버그가 아니라 판단 요청이다.
 */
function quarantineTable(kinds: readonly QuarantineKind[]): RawHtml {
  if (kinds.length === 0) {
    return html`<p class="empty">規則の外にあった記録は<b>0件</b>です。取り込みが規則どおりに進んでいます。</p>`;
  }
  return html`${scroller(html`<table>
    <thead><tr><th class="l">種類</th><th>件数</th><th class="l">原文の例</th></tr></thead>
    <tbody>${kinds.map(
      (k) => html`<tr>
        <td class="l">${k.kind}</td>
        <td>${k.count}</td>
        <td class="l">${k.samples.map(
          (s) => html`<code class="qs">${s.raw}</code>${s.detail === null ? null : html` <span class="qd">${s.detail}</span>`} `,
        )}</td>
      </tr>`,
    )}</tbody>
  </table>`)}
  ${note(
    "⚠これは不具合の一覧ではなく<b>判断待ちの一覧</b>です。規則にない書き方が出てきたとき、" +
      "捨てずに原文のまま取っておいて、人がどう数えるか決めます。" +
      "0で埋めてしまうと「その打席は無かった」ことになり、あとから直せません。",
  )}`;
}

export function renderLogPage(d: LogPageData, ctx: RenderContext): string {
  const { base, root, seasons } = ctx.paths("log.html");
  const a = d.archive;

  const body = html`<header class="idline">
  <div class="idtext">
    <span class="nm">収集ログ</span>
    <span class="sub">${d.season}年 · このサイトの数字がいつ・どこから入ったか</span>
  </div>
</header>

<section class="block">
  <h4>いまの中身<span class="qt">アーカイブ全体（2025年〜・ポストシーズン含む）</span></h4>
  <div class="cols">
    <dl>
      <dt>試合</dt><dd class="v">${d.totals.games.toLocaleString()}</dd>
      <dt>打席</dt><dd class="v">${d.totals.pa.toLocaleString()}</dd>
    </dl>
    <dl>
      <dt>選手</dt><dd class="v">${d.totals.players.toLocaleString()}</dd>
      <dt>隔離</dt><dd class="v">${d.totals.quarantine}</dd>
    </dl>
    <dl>
      <dt>原本保管</dt><dd class="v">${a === null ? "—" : a.files.toLocaleString()}</dd>
      <dt>容量</dt><dd class="v">${a === null ? "—" : mb(a.bytes)}</dd>
    </dl>
  </div>
  ${note(
    // ⚠**여기의 수는 시즌·대회로 거르지 않은 「아카이브 전체」다.** 표제가 「2026年」이라
    // 같은 화면의 順位(629試合)와 2.4배 어긋나 보였다 — 수를 바꾸지 말고 무엇을 센 수인지 적는다
    "上の数は当サイトが保管している記録の全体です — 2025年からの全シーズン・" +
      "ポストシーズン・オールスターを含みます。リーグ順位や個人成績のページはこのうち" +
      `${d.season}年の公式戦だけを使うので、試合数はそちらのほうが少なくなります。` +
      (a === null
        ? "原本アーカイブの記録がまだありません。"
        : `原本は${jstStamp(a.updatedAt)}時点のものです。取り込んだページはそのまま保管してあり、` +
          "解釈を変えたくなったときに元から作り直せます。⚠原本は外に出しません — 画面に出すのは当サイトが計算した値です。"),
  )}
</section>

${block({
    id: "coverage",
    title: "試合日ごとの取り込み",
    qualifier: `直近${d.coverage.length}日`,
    body: coverageTable(d.coverage),
  })}

${block({
    id: "runs",
    title: "自動収集の実行記録",
    qualifier: d.runs.length === 0 ? "記録なし" : `直近${d.runs.length}回`,
    body: runTable(d.runs),
  })}

${block({
    id: "quarantine",
    title: "判断待ちの記録",
    qualifier: d.quarantine.length === 0 ? "0件" : `${d.totals.quarantine}件`,
    body: quarantineTable(d.quarantine),
  })}

<section class="block">
  <h4>取り込みかた</h4>
  <p class="note">
    出典は日本野球機構（NPB）公式サイト <a href="https://npb.jp/" rel="noreferrer noopener">npb.jp</a> です。
    自動収集は<b>1リクエストにつき${(d.politeness.minDelayMs / 1000).toFixed(0)}秒以上あけ、同時接続は${d.politeness.concurrency}本</b>、
    連絡先を書いた識別可能なUAで、1日1回だけ動きます。
    すでに取り込んだページは条件付きリクエストで確認し、変わっていなければ受け取り直しません。
  </p>
  <p class="note">
    ⚠数字はすべて<b>当サイトが公表記録から独自に再計算</b>したものです。元の表を再現するものではありません。
    掲載内容の削除・訂正のご依頼は${ctx.site.contact === "" ? html`<b>（連絡先が未設定です）</b>` : ` ${ctx.site.contact} `}まで。
  </p>
</section>

<nav class="find" aria-label="ほかのページ">
  <a href="${base}index.html">選手一覧</a> · <a href="${base}ranking.html">リーグ順位</a>
</nav>`;

  return page({
    title: `収集ログ — ${ctx.site.name}`,
    base,
    root,
    seasons,
    color: NEUTRAL_COLOR,
    freshness: ctx.freshness,
    site: ctx.site,
    nav: "log",
    body,
  });
}

/** 화면 밖에서도 쓰는 상수. ⚠`archiver`의 기본값과 같아야 한다 — 어긋나면 화면이 거짓말이 된다 */
export const POLITENESS = { minDelayMs: 3000, concurrency: 1 } as const;

export { raw };
