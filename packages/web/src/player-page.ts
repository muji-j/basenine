/**
 * 선수 페이지 — 名鑑 한 장.
 *
 * ⚠**여기 있는 함수는 전부 순수하다.** DB를 모르고, 시계를 모르고, 파일을 모른다.
 * 데이터는 `query.ts`가 만들어 넘긴다 — 그래야 픽스처만으로 화면을 테스트할 수 있다(작업규칙 11).
 */
import { html, raw } from "./html.ts";
import type { RawHtml } from "./html.ts";
import type { BattingLine, PitchingLine, Rate } from "@bb-app/metrics";
import { TEAMS, shortNameOf } from "@bb-app/domain";
import type { League, TeamColor } from "@bb-app/domain";
import { blocksFor, presetsFor } from "./blocks.ts";
import type { BlockId } from "./blocks.ts";
import {
  bars,
  block,
  buttonGroup,
  columns,
  denText,
  gradeLegend,
  note,
  panel,
  rankValue,
  scroller,
  statCount,
  statRate,
  statRateOuts,
  statSigned,
  statText,
  tablist,
  term,
  termAttr,
} from "./parts.ts";
import type { BarRow, RankDigits } from "./parts.ts";
import { NO_VALUE, avg3, gameDate, innings, throwsBats } from "./format.ts";
import { isEmptyProfile, markLetter, markProfile } from "./marks.ts";
import type { MarkPlayer, ProfileAxis } from "./marks.ts";
import { page } from "./layout.ts";
import type { Freshness, SiteMeta } from "./layout.ts";

/** 지표별 순위. 없으면 자격 미달이거나 값이 없다 — **둘 다 「순위 없음」으로 같게 다룬다** */
export type Ranks = Readonly<Record<string, number | null>>;

function rk(ranks: Ranks, key: string): number | null {
  return ranks[key] ?? null;
}

export interface BattingBlockData {
  games: number;
  runs: number;
  rbi: number;
  sb: number;
  line: BattingLine;
  avg: Rate;
  obp: Rate;
  slg: Rate;
  ops: Rate;
  woba: Rate;
  wrcPlus: Rate;
  wraa: Rate;
  iso: Rate;
  babip: Rate;
  kRate: Rate;
  bbRate: Rate;
  /** SRC. RE 행렬이 없는 리그(올스타 등)면 null */
  src: { src: number; pa: number; skipped: number; srcPer600: number | null } | null;
  ranks: Ranks;
  qualified: boolean;
  /** 규정타석 */
  needPa: number;
}

export interface PitchingBlockData {
  games: number;
  line: PitchingLine;
  /** 승·패·세이브·홀드. 박스스코어의 결정 표기에서 센다 */
  decisions: { w: number; l: number; sv: number; hld: number };
  era: Rate;
  whip: Rate;
  fip: Rate;
  k9: Rate;
  bb9: Rate;
  hr9: Rate;
  ranks: Ranks;
  qualified: boolean;
  /** 규정투구회(아웃 카운트) */
  needOuts: number;
}

export type SplitAxisId = "hand" | "base" | "homeAway" | "month";

export interface SplitRow {
  /** 원본 구분값(`2026-04` 등). **정렬은 라벨이 아니라 이걸로 한다** — 「10月」은 「4月」보다 앞에 온다 */
  key: string;
  label: string;
  line: BattingLine;
  avg: Rate;
  obp: Rate;
  slg: Rate;
  ops: Rate;
  rbi: number;
}

export interface SplitAxisData {
  id: SplitAxisId;
  label: string;
  /**
   * 투수의 스플릿인가. **값의 뜻이 반대다** — 타율이 아니라 피안타율이다.
   * 라벨을 「被~」로 바꾸는 데 쓴다.
   */
  allowed: boolean;
  rows: SplitRow[];
  /** 이 축으로 나눌 수 없었던 타석. **숨기지 않는다** */
  unclassified: number;
  /** 이 축에서 「얇다」고 볼 타석 수 */
  thinBelow: number;
}

export interface ScorebookRow {
  date: string;
  opponent: string;
  inning: number;
  half: "top" | "bottom";
  outs: number;
  bases: string;
  outcome: string;
  rbi: number;
  /** 안타·홈런처럼 강조할 결과인가 */
  hit: boolean;
}

export interface SituationCell {
  bases: string;
  outs: number;
  /** 리그 득점기대치 */
  re: number | null;
  /** 이 선수가 그 상황에서 선 타석 수 */
  pa: number;
}

/**
 * 상대전적 한 줄. **타자 페이지에서는 상대가 투수, 투수 페이지에서는 상대가 타자**다 —
 * 같은 표를 양쪽에서 쓰므로 이름을 「상대」로 둔다.
 */
export interface MatchupRow {
  opponentId: string;
  opponentName: string;
  opponentTeam: string;
  line: BattingLine;
  avg: Rate;
  rbi: number;
}

export interface RankingRow {
  rank: number | null;
  playerId: string;
  name: string;
  teamCode: string;
  value: Rate;
  isMe: boolean;
}

export interface RankingPanel {
  id: string;
  label: string;
  digits: RankDigits;
  unit: string;
  /** 분모가 아웃 카운트면 true — 표기는 이닝으로 바꾼다 */
  denAsInnings: boolean;
  rows: RankingRow[];
  /** 자격 기준 설명. **규칙이 곧 값이다**(M3) */
  qualifier: string;
}

/**
 * 표제 옆의 작은 꺾은선. **사진 대신 이 선수를 구별하는 표시**가 된다.
 *
 * ⚠**선수 사진은 쓰지 않는다.** 기록은 사실이라 저작물이 아니지만(CLAUDE.md §2-5 1층),
 * 사진은 촬영자의 저작물이고 선수의 초상권도 붙는다 — 「공개 정보」 논리가 닿지 않는다.
 * L5(공개된 직업활동 성적만) · L6(외부 노출은 파생값)에도 걸린다.
 * 대신 **우리가 계산한 값으로 만든 우리 그림**을 놓는다. 정보량도 사진보다 많다.
 */
export interface SparkPoint {
  label: string;
  value: number | null;
}

/**
 * 표제의 식별 마크(B안 成績の紋). **선수마다 모양이 다르고, 그 모양이 정보다.**
 * 축은 타자와 투수가 다르고, 표본이 없으면 포지션 한 글자로 대체한다.
 */
export interface MarkData {
  axes: ProfileAxis[];
  /**
   * 분모 표기. **이미 사람이 읽는 형태여야 한다**(`442打席` · `138.1回`).
   *
   * ⚠숫자와 단위를 따로 받지 않는다 — 투수 표본은 아웃 카운트라 `415アウト`가 되고,
   * 사이트의 다른 곳(이닝 표기)과 어긋난다. 어긋나는 경로를 타입에서 없앤다.
   */
  sampleText: string;
}

export interface PlayerPageData {
  playerId: string;
  name: string;
  season: number;
  teamCode: string;
  teamName: string;
  league: League;
  leagueName: string;
  color: TeamColor;
  position: string | null;
  throws: string | null;
  bats: string | null;
  birthDate: string | null;
  physique: string | null;
  /** 어느 쪽 페이지로 만들 것인가. 투수도 타석에 서지만 주역은 하나다 */
  role: "batter" | "pitcher";
  batting: BattingBlockData | null;
  pitching: PitchingBlockData | null;
  splits: SplitAxisData[];
  scorebook: ScorebookRow[];
  /** 이 선수의 전체 타석 수. `scorebook`이 잘렸는지 말하기 위한 값 */
  scorebookTotal: number;
  situation: SituationCell[];
  matchups: MatchupRow[];
  /** 대전한 투수(또는 타자)의 총 수. `matchups`가 잘렸는지 말하기 위한 값 */
  matchupTotal: number;
  ranking: RankingPanel[];
  /** 표제의 식별 마크 */
  mark: MarkData;
  /** 월별 추이. 표제 옆의 꺾은선이 된다 */
  spark: SparkPoint[];
  /** 그 꺾은선이 무엇인지 (`月別OPS` 등) */
  sparkLabel: string;
  /** 반영 기준 경기일 */
  asOf: string | null;
}

export interface RenderContext {
  site: SiteMeta;
  freshness: Freshness;
}

const POSITION_MARK: Readonly<Record<string, string>> = {
  投手: "投",
  捕手: "捕",
  内野手: "内",
  外野手: "外",
};

/**
 * 포지션 한 글자. 표제의 마크와 색인 목록이 **같은 규칙**을 써야 한다(M1의 정신) —
 * 두 곳에 적으면 언젠가 어긋나고, 그때는 어느 쪽이 맞는지 알 수 없다.
 * @param fallback 포지션을 모를 때 낼 문자
 */
export function positionMark(position: string | null, fallback = ""): string {
  if (position === null || position === "") return fallback;
  return POSITION_MARK[position] ?? position.slice(0, 1);
}

const BASE_LABEL: Readonly<Record<string, string>> = {
  "-": "走者なし",
  "": "走者なし",
  "1": "一塁",
  "2": "二塁",
  "3": "三塁",
  "12": "一二塁",
  "13": "一三塁",
  "23": "二三塁",
  "123": "満塁",
};

const BASE_ORDER = ["-", "1", "2", "3", "12", "13", "23", "123"];

/** 표본이 이보다 적은 칸은 시각적 무게를 뺀다. 값은 그대로 보인다 */
const THIN_SITUATION_PA = 10;
const THIN_MATCHUP_PA = 10;
/** 선수 페이지 순위표에 싣는 상위 인원. `query.ts`와 같은 값이어야 한다 */
const RANKING_TOP = 10;

/**
 * 월별 추이 꺾은선.
 *
 * ⚠**축을 그리지 않는다.** 눈금 없는 선은 「값」이 아니라 **모양**이고, 정확한 값은
 * 스플릿 블록에 분모와 함께 있다. 여기서 읽히면 안 되는 것을 읽히게 만들지 않는다.
 */
function sparkline(points: readonly SparkPoint[], label: string): RawHtml {
  const values = points.map((p) => p.value).filter((v): v is number => v !== null);
  if (values.length < 2) return raw("");

  const w = 108;
  const h = 26;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || 1;
  const step = w / (points.length - 1);

  const coords = points.map((p, i) => ({
    x: i * step,
    y: p.value === null ? null : h - ((p.value - lo) / span) * h,
  }));
  const line = coords
    .filter((c): c is { x: number; y: number } => c.y !== null)
    .map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`)
    .join(" ");
  const last = [...coords].reverse().find((c) => c.y !== null);

  return html`<div class="spark">
  <svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img"
    aria-label="${label}：${points.map((p) => `${p.label} ${p.value === null ? "なし" : p.value.toFixed(3)}`).join("、")}">
    <polyline points="${line}" fill="none" stroke="var(--team,#6b7280)" stroke-width="1.6"
      stroke-linejoin="round" stroke-linecap="round"></polyline>
    ${last === undefined ? null : html`<circle cx="${last.x.toFixed(1)}" cy="${last.y!.toFixed(1)}" r="2.4" fill="var(--team,#6b7280)"></circle>`}
  </svg>
  <span class="sl">${label}　${points[0]?.label ?? ""}→${points.at(-1)?.label ?? ""}</span>
</div>`;
}

function idLine(d: PlayerPageData): RawHtml {
  const who: MarkPlayer = {
    playerId: d.playerId,
    name: d.name,
    teamName: d.teamName,
    color: d.color,
    positionMark: positionMark(d.position, "—"),
  };
  // ⚠성적이 없는 선수를 아주 작은 도형으로 그리지 않는다 — 「나쁘다」로 읽힌다(M11)
  const mark = isEmptyProfile(d.mark.axes)
    ? markLetter(who, who.positionMark, 52)
    : markProfile(who, d.mark.axes, d.mark.sampleText, 52);

  const bio = [
    d.teamName,
    d.position ?? "ポジション不明",
    throwsBats(d.throws, d.bats),
    d.birthDate === null ? null : `${d.birthDate.slice(0, 4)}年生`,
    d.physique,
  ].filter((s): s is string => s !== null && s !== "" && s !== NO_VALUE);

  return html`<header class="idline">
  <span class="mark">${mark}</span>
  <div class="idtext">
    <span class="nm">${d.name}</span>
    <span class="sub">${bio.join(" · ")}</span>
    <span class="asof">${d.season}年${d.asOf === null ? "" : ` · ${gameDate(d.asOf)}まで`}</span>
  </div>
  ${sparkline(d.spark, d.sparkLabel)}
</header>`;
}

function rail(d: PlayerPageData): RawHtml {
  const presets = presetsFor(d.role);
  return html`<nav class="rail" aria-label="表示の切り替え">
  <span class="lbl">構成</span>
  ${presets.map(
    (p) => html`<button class="tab" type="button" data-preset="${p.id}" aria-pressed="${p.id === "standard" ? "true" : "false"}">${p.name}</button>`,
  )}
  <button class="tab" type="button" id="editBtn" aria-pressed="false" aria-controls="editor">組み替え</button>
  <span class="grow"></span>
  <span class="lbl">密度</span>
  <button class="tab" type="button" data-density="normal" aria-pressed="true">標準</button>
  <button class="tab" type="button" data-density="compact" aria-pressed="false">高密度</button>
</nav>
${gradeLegend()}`;
}

function editor(): RawHtml {
  return html`<section class="editor" id="editor" hidden aria-label="ブロックの組み替え">
  <h3>ブロックの組み替え</h3>
  <p>表示するブロックと並び順を決めます。設定はこの端末に保存されます。</p>
  <div class="blocks" id="blockList"></div>
  <div class="fixed-note">
    <b>消せない表示があります。</b>比率の横の母数（打席数・打数）は設定で消せません。
    10打席の .400 を順位として見せないための決まりで、好みの問題ではないからです。
  </div>
</section>`;
}

// ─── 블록 ────────────────────────────────────────────────────────────────

/**
 * 자격 표시.
 *
 * ⚠**「順位はつきません」로 끝내면 화면과 어긋난다.** 본루타·탈삼진 같은 누계 지표에는
 * 자격 기준이 걸리지 않아 미달자에게도 순위 배지가 붙는다. 무엇에 안 붙는지 말한다.
 */
function qualifierText(qualified: boolean, have: number, need: number, unit: string): string {
  return qualified
    ? `規定到達（${have}${unit} / ${need}${unit}）`
    : `規定未満（${have}${unit} / ${need}${unit}）— 率の指標には順位がつきません`;
}

function standardBatting(b: BattingBlockData): RawHtml {
  return block({
    id: "standard",
    title: "基本成績",
    qualifier: qualifierText(b.qualified, b.line.pa, b.needPa, "打席"),
    body: columns(
      html`${statRate("打率", b.avg, "打数", 3, rk(b.ranks, "avg"))}
        ${statRate("出塁率", b.obp, "打席", 3, rk(b.ranks, "obp"))}
        ${statRate("長打率", b.slg, "打数", 3, rk(b.ranks, "slg"))}
        ${statRate("OPS", b.ops, "打席", 3, rk(b.ranks, "ops"))}`,
      html`${statCount("試合", b.games)}
        ${statCount("打席", b.line.pa)}
        ${statCount("打数", b.line.ab)}
        ${statCount("安打", b.line.h)}`,
      html`${statCount("二塁打", b.line.double)}
        ${statCount("三塁打", b.line.triple)}
        ${statCount("本塁打", b.line.hr, rk(b.ranks, "hr"))}
        ${statCount("打点", b.rbi, rk(b.ranks, "rbi"))}`,
      html`${statCount("得点", b.runs)}
        ${statCount("盗塁", b.sb, rk(b.ranks, "sb"))}
        ${statCount("四球", b.line.bb)}
        ${statCount("死球", b.line.hbp)}`,
      html`${statCount("三振", b.line.so)}
        ${statCount("犠飛", b.line.sf)}
        ${statCount("犠打", b.line.sh)}
        ${statCount("敬遠", b.line.ibb)}`,
    ),
  });
}

function standardPitching(p: PitchingBlockData): RawHtml {
  const d = p.decisions;
  return block({
    id: "standard",
    title: "基本成績",
    qualifier: qualifierText(p.qualified, Math.floor(p.line.outs / 3), Math.floor(p.needOuts / 3), "回"),
    body: columns(
      html`${statRateOuts("防御率", p.era, 2, rk(p.ranks, "era"))}
        ${statRateOuts("WHIP", p.whip, 2, rk(p.ranks, "whip"))}
        ${statText("投球回", innings(p.line.outs))}
        ${statCount("試合", p.games)}`,
      html`${statCount("勝", d.w, rk(p.ranks, "w"))}
        ${statCount("敗", d.l)}
        ${statCount("セーブ", d.sv, rk(p.ranks, "sv"))}
        ${statCount("ホールド", d.hld, rk(p.ranks, "hld"))}`,
      html`${statCount("被安打", p.line.h)}
        ${statCount("被本塁打", p.line.hr)}
        ${statCount("与四球", p.line.bb)}
        ${statCount("与死球", p.line.hbp)}`,
      html`${statCount("奪三振", p.line.so, rk(p.ranks, "so"))}
        ${statCount("失点", p.line.r)}
        ${statCount("自責点", p.line.er)}
        ${statCount("対戦打者", p.line.bf)}`,
    ),
  });
}

function advancedBatting(b: BattingBlockData): RawHtml {
  const src = b.src;
  return block({
    id: "advanced",
    title: "セイバーメトリクス",
    body: html`${columns(
      html`${statRate("wOBA", b.woba, "打席", 3, rk(b.ranks, "woba"))}
        ${statRate("wRC+", b.wrcPlus, "打席", 1, rk(b.ranks, "wrcPlus"))}
        ${statSigned("wRAA", b.wraa.value, b.wraa.denominator, "打席", rk(b.ranks, "wraa"))}`,
      html`${statRate("ISO", b.iso, "打数", 3)}
        ${statRate("BABIP", b.babip, "打球", 3)}`,
      html`${statRate("K%", b.kRate, "打席", 3)}
        ${statRate("BB%", b.bbRate, "打席", 3)}`,
      src === null
        ? html`${statText("SRC", NO_VALUE)}`
        : html`${statSigned("SRC", src.src, src.pa, "打席", rk(b.ranks, "src"))}
            ${statSigned("SRC/600", src.srcPer600, src.pa, "打席")}`,
    )}
    ${note(
      "SRC（状況得点貢献）は、打席ごとに得点期待値をどれだけ動かしたかを合計した自前の指標です。" +
        "打撃だけを測り、守備・走塁・ポジション補正は含みません。WARではなく、WARと比較できません。" +
        (src === null || src.skipped === 0 ? "" : ` 期待値表にない状況が${src.skipped}打席あり、計算から外しています。`),
    )}`,
  });
}

function advancedPitching(p: PitchingBlockData): RawHtml {
  return block({
    id: "advanced",
    title: "セイバーメトリクス",
    body: html`${columns(
      html`${statRateOuts("FIP", p.fip, 2, rk(p.ranks, "fip"))}
        ${statRateOuts("WHIP", p.whip, 2, rk(p.ranks, "whip"))}`,
      html`${statRateOuts("K/9", p.k9, 2)}
        ${statRateOuts("BB/9", p.bb9, 2)}
        ${statRateOuts("HR/9", p.hr9, 2)}`,
    )}
    ${note("FIPは本塁打・四死球・奪三振だけから防御率の目盛りに換算した値です。守備の影響を切り離す代わりに、打球の質は測っていません。")}`,
  });
}

function splitsBlock(axes: readonly SplitAxisData[]): RawHtml {
  if (axes.length === 0) {
    return block({
      id: "splits",
      title: "スプリット",
      body: html`<p class="empty">打席がありません。</p>`,
    });
  }

  const controls = tablist(
    "splits",
    axes.map((a) => ({ id: a.id, label: a.label })),
    true,
  );

  const allowed = axes[0]!.allowed;

  const panels = axes.map((a, ai) => {
    const max = Math.max(0.001, ...a.rows.map((r) => r.ops.value ?? 0));
    const rows: BarRow[] = a.rows.map((r) => ({
      label: r.label,
      // ⚠**투수는 막대가 짧을수록 좋다.** 그래서 뒤집지 않는다 — 뒤집으면 같은 길이가
      // 타자 화면에서는 좋고 투수 화면에서는 나쁜 것이 되어 눈이 배운 규칙이 무너진다.
      // 대신 「棒が短いほど良い」라고 화면이 말한다.
      fill: (r.ops.value ?? 0) / max,
      thin: r.line.pa < a.thinBelow,
      text: html`${avg3(r.avg.value)} / ${avg3(r.obp.value)} / ${avg3(r.slg.value)}<span class="den">${r.line.pa}打席</span>`,
    }));
    return panel(
      "splits",
      a.id,
      ai === 0,
      html`${a.rows.length === 0 ? html`<p class="empty">この区分の打席がありません。</p>` : bars(rows)}
      ${note(
        (allowed
          ? `棒は被OPS（短いほど良い）。数字は 被打率 / 被出塁率 / 被長打率 と対戦打席数です。`
          : `棒はOPS。数字は 打率 / 出塁率 / 長打率 と打席数です。`) +
          `${a.thinBelow}打席未満は棒を薄くしています — 値は小さな標本のもので、順位ではありません。` +
          (a.unclassified === 0
            ? ""
            : ` この軸で分類できない打席が${a.unclassified}あります（${allowed ? "相手打者" : "相手投手"}の投打が不明など）。`),
      )}`,
    );
  });

  return block({
    id: "splits",
    title: allowed ? "スプリット（被成績）" : "スプリット",
    controls,
    body: html`${panels}`,
  });
}

function scorebookBlock(rows: readonly ScorebookRow[], total: number): RawHtml {
  const body =
    rows.length === 0
      ? html`<p class="empty">打席記録がありません。</p>`
      : html`${scroller(html`<table>
          <thead><tr>
            <th class="l">試合日</th><th class="l">相手</th><th>回</th><th class="l">状況</th>
            <th class="l">結果</th><th>打点</th>
          </tr></thead>
          <tbody>${rows.map(
            (r) => html`<tr>
              <td class="l">${gameDate(r.date)}</td>
              <td class="l">${r.opponent}</td>
              <td>${r.inning}${r.half === "top" ? "表" : "裏"}</td>
              <td class="l">${BASE_LABEL[r.bases] ?? r.bases} ${r.outs}死</td>
              <td class="l"><span class="pa${r.hit ? " h" : ""}">${r.outcome}</span></td>
              <td>${r.rbi === 0 ? NO_VALUE : r.rbi}</td>
            </tr>`,
          )}</tbody>
        </table>`)}
        ${note(
          `新しい順。結果の表記はボックススコアの原文です。` +
            // ⚠**자른 것을 말한다.** 「전부」로 읽히면 그것도 거짓말이다
            (total > rows.length ? ` 全${total}打席のうち直近${rows.length}件を表示しています。` : ""),
        )}`;
  return block({ id: "scorebook", title: "打席記録", body });
}

function situationBlock(cells: readonly SituationCell[], leagueName: string): RawHtml {
  if (cells.length === 0) {
    return block({
      id: "situation",
      title: "得点期待値",
      body: html`<p class="empty">得点期待値を計算できていません。</p>`,
    });
  }
  const byKey = new Map(cells.map((c) => [`${c.bases === "" ? "-" : c.bases}|${c.outs}`, c]));

  return block({
    id: "situation",
    title: "得点期待値",
    body: html`${scroller(html`<div class="dg">
      <div class="h"></div><div class="h">0死</div><div class="h">1死</div><div class="h">2死</div>
      ${BASE_ORDER.map(
        (b) => html`<div class="rl">${BASE_LABEL[b]}</div>
          ${[0, 1, 2].map((o) => {
            const cell = byKey.get(`${b}|${o}`);
            const thin = cell === undefined || cell.pa < THIN_SITUATION_PA;
            return html`<div class="c${thin ? " thin" : ""}">
              <u>${cell === undefined || cell.re === null ? NO_VALUE : cell.re.toFixed(2)}</u>
              <s>${cell === undefined ? 0 : cell.pa}打席</s>
            </div>`;
          })}`,
      )}
    </div>`)}
    ${note(
      `大きい数字は${leagueName}の得点期待値（その状況からイニング終了までに入る平均得点）で、リーグ全体の値です。` +
        `小さい数字はこの選手がその状況で立った打席数。${THIN_SITUATION_PA}打席未満は薄くしています。`,
    )}`,
  });
}

/**
 * 상대전적 — **검색하고 골라 보는 표**.
 *
 * ⚠**타율순 정렬은 10타석 이상으로 제한한다.** 대전 표본은 대부분 한 자릿수라
 * 그대로 타율로 정렬하면 「5타석 3안타」가 맨 위에 오고, 그건 순위가 아니라 잡음이다.
 * 제한한다는 사실을 탭 이름에 쓴다 — 숨겨진 규칙을 만들지 않는다.
 */
/**
 * 정렬 가능한 열. **키는 행의 `data-*`와 같은 이름**이어야 한다 — 어긋나면 조용히 정렬이 안 먹는다.
 * `rate`인 열은 표본이 작으면 오독되므로 클라이언트가 경고를 낸다.
 */
const MATCHUP_COLUMNS: readonly {
  key: string;
  label: string;
  align: "l" | "r";
  type: "text" | "num";
  rate?: true;
}[] = [
  { key: "name", label: "", align: "l", type: "text" },
  { key: "team", label: "球団", align: "l", type: "text" },
  { key: "pa", label: "打席", align: "r", type: "num" },
  { key: "ab", label: "打数", align: "r", type: "num" },
  { key: "h", label: "安打", align: "r", type: "num" },
  { key: "hr", label: "本塁打", align: "r", type: "num" },
  { key: "bb", label: "四球", align: "r", type: "num" },
  { key: "so", label: "三振", align: "r", type: "num" },
  { key: "rbi", label: "打点", align: "r", type: "num" },
  { key: "avg", label: "打率", align: "r", type: "num", rate: true },
];

/** 최소 타석 선택지. **10이 기본이 아니다** — 기본은 전부 보이는 것이고, 좁히는 것은 선택이다 */
const MATCHUP_MIN_PA = [1, 3, 5, 10, 20];

/**
 * 상대전적 — **검색하고 정렬해서 보는 표**.
 *
 * ⚠**타율로 정렬할 수 있게 하되, 그것이 순위가 아님을 화면이 계속 말한다.**
 * 대전 표본은 대부분 한 자릿수라 「5타석 3안타」가 맨 위에 온다. 막지는 않는다 —
 * 대신 **지금 무엇으로 정렬돼 있고 몇 타석 이상만 보고 있는지**를 상태 줄에 항상 낸다.
 * ⚠`THIN_MATCHUP_PA` 미만은 여전히 색을 낮춘다. 값은 지우지 않는다.
 */
function matchupBlock(rows: readonly MatchupRow[], total: number, opponent: string): RawHtml {
  if (rows.length === 0) {
    return block({ id: "matchup", title: "対戦成績", body: html`<p class="empty">対戦記録がありません。</p>` });
  }

  const controls = buttonGroup(
    "matchupMin",
    MATCHUP_MIN_PA.map((n) => ({ id: String(n), label: n === 1 ? "すべて" : `${n}打席以上` })),
    "最少打席でしぼる",
  );

  const head = MATCHUP_COLUMNS.map(
    (c) => html`<th class="${c.align === "l" ? "l" : ""}" scope="col" aria-sort="${c.key === "pa" ? "descending" : "none"}">
      <button class="sortable" type="button" data-sortkey="${c.key}" data-sorttype="${c.type}"
        ${raw(termAttr(c.label))}${raw(c.rate === true ? ' data-sortrate="1"' : "")}>${c.label === "" ? opponent : c.label}<i></i></button>
    </th>`,
  );

  // 구단 선택지는 **실제로 대전한 구단만** 낸다 — 없는 구단을 고르게 하면 0건 화면이 된다
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.opponentTeam, (counts.get(r.opponentTeam) ?? 0) + 1);
  const teams = TEAMS.filter((t) => counts.has(t.code));

  const body = html`<div class="mfind">
  <label for="matchupFilter">${opponent}名でしぼる</label>
  <input id="matchupFilter" type="search" autocomplete="off" placeholder="例：山本">
  <label for="matchupTeam">球団</label>
  <select id="matchupTeam">
    <option value="">すべての球団</option>
    ${teams.map(
      (t) => html`<option value="${t.code}">${shortNameOf(t.code)}（${counts.get(t.code)}）</option>`,
    )}
  </select>
  <span class="count"><span id="matchupCount">${rows.length}件</span> / 全${total}件</span>
</div>
${scroller(html`<table id="matchupTable">
  <thead><tr>${head}</tr></thead>
  <tbody>${rows.map(
    (r) => html`<tr class="${r.line.pa < THIN_MATCHUP_PA ? "thin" : ""}"
      data-name="${r.opponentName}" data-team="${shortNameOf(r.opponentTeam)}" data-teamcode="${r.opponentTeam}"
      data-pa="${r.line.pa}" data-ab="${r.line.ab}" data-h="${r.line.h}" data-hr="${r.line.hr}"
      data-bb="${r.line.bb}" data-so="${r.line.so}" data-rbi="${r.rbi}"
      ${raw(r.avg.value === null ? "" : `data-avg="${r.avg.value.toFixed(4)}"`)}>
      <td class="l"><a href="${r.opponentId}.html">${r.opponentName}</a></td>
      <td class="l">${shortNameOf(r.opponentTeam)}</td>
      <td>${r.line.pa}</td><td>${r.line.ab}</td><td>${r.line.h}</td><td>${r.line.hr}</td>
      <td>${r.line.bb}</td><td>${r.line.so}</td><td>${r.rbi}</td>
      <td>${avg3(r.avg.value)}</td>
    </tr>`,
  )}</tbody>
</table>`)}
<p class="empty" id="matchupEmpty" hidden role="status">この条件の対戦記録はありません。</p>
<p class="note" id="matchupStatus" role="status">打席の多い順</p>
${note(
    `見出しを押すと並べ替わります（もう一度押すと逆順）。${THIN_MATCHUP_PA}打席未満は薄く表示しています — ` +
      `対戦成績は大半が一桁打席で、率で並べると少ない打席が先頭に来ます。` +
      `並び順と絞り込みは上の行に出ています。${opponent}名を押すとその選手のページに移ります。`,
  )}`;

  return block({ id: "matchup", title: "対戦成績", controls, body });
}

function rankingBlock(panels: readonly RankingPanel[], base: string): RawHtml {
  if (panels.length === 0) {
    return block({ id: "ranking", title: "リーグ順位", body: html`<p class="empty">順位を計算できていません。</p>` });
  }
  const controls = tablist(
    "pranking",
    panels.map((p) => ({ id: p.id, label: p.label })),
    true,
  );

  const body = panels.map((p, pi) =>
    panel(
      "pranking",
      p.id,
      pi === 0,
      html`${scroller(html`<table>
        <thead><tr><th>順位</th><th class="l">選手</th><th class="l">球団</th><th>${term(p.label)}</th><th>${term("母数")}</th></tr></thead>
        <tbody>${p.rows.map(
          (r) => html`<tr class="${r.isMe ? "me" : ""}">
            <td>${r.rank === null ? NO_VALUE : r.rank}</td>
            <td class="l"><a href="${base}players/${r.playerId}.html">${r.name}</a></td>
            <td class="l">${r.teamCode.toUpperCase()}</td>
            <td>${rankValue(r.value.value, p.digits)}</td>
            <td>${denText(r.value.denominator, p.unit, p.denAsInnings)}</td>
          </tr>`,
        )}</tbody>
      </table>`)}
      ${note(`${p.qualifier} 上位${RANKING_TOP}人とこの選手の行だけを表示しています。`)}`,
    ),
  );

  return block({ id: "ranking", title: "リーグ順位", controls, body: html`${body}` });
}

// ─── 페이지 ──────────────────────────────────────────────────────────────

function renderBlock(id: BlockId, d: PlayerPageData, base: string): RawHtml {
  switch (id) {
    case "standard":
      if (d.role === "pitcher" && d.pitching !== null) return standardPitching(d.pitching);
      if (d.batting !== null) return standardBatting(d.batting);
      return block({ id: "standard", title: "基本成績", body: html`<p class="empty">成績がありません。</p>` });
    case "advanced":
      if (d.role === "pitcher" && d.pitching !== null) return advancedPitching(d.pitching);
      if (d.batting !== null) return advancedBatting(d.batting);
      return block({ id: "advanced", title: "セイバーメトリクス", body: html`<p class="empty">成績がありません。</p>` });
    case "splits":
      return splitsBlock(d.splits);
    case "scorebook":
      return scorebookBlock(d.scorebook, d.scorebookTotal);
    case "situation":
      return situationBlock(d.situation, d.leagueName);
    case "matchup":
      return matchupBlock(d.matchups, d.matchupTotal, d.role === "pitcher" ? "打者" : "投手");
    case "ranking":
      return rankingBlock(d.ranking, base);
  }
}

/** `block()`이 내는 첫 태그. 여기가 바뀌면 숨김 처리가 조용히 안 먹는다. */
const BLOCK_OPEN = '<section class="block"';

/**
 * 프리셋 밖의 블록을 접어 둔다.
 *
 * ⚠**조용히 실패하면 전 블록이 펼쳐진 페이지가 나간다.** 마크업이 바뀌면 던진다(M7의 정신).
 */
function hidden(rendered: RawHtml): RawHtml {
  if (!rendered.__raw.startsWith(BLOCK_OPEN)) {
    throw new Error(`블록 마크업이 바뀌었다 — 숨김 처리가 깨진다: ${rendered.__raw.slice(0, 60)}`);
  }
  return raw(`${BLOCK_OPEN} hidden${rendered.__raw.slice(BLOCK_OPEN.length)}`);
}

/**
 * 클라이언트에 실을 카탈로그. **서버가 그린 것과 같은 목록**이어야 한다.
 * @see blocks.ts — 목록은 거기 1벌만 있다
 */
export function bootstrapFor(role: "batter" | "pitcher"): string {
  const blocks = blocksFor(role).map((b) => ({ id: b.id, name: b.name, desc: b.desc }));
  const presets: Record<string, string[]> = {};
  for (const p of presetsFor(role)) presets[p.id] = [...p.blocks];
  return `window.__BLOCKS__=${JSON.stringify(blocks)};window.__PRESETS__=${JSON.stringify(presets)};`;
}

export function renderPlayerPage(d: PlayerPageData, ctx: RenderContext): string {
  const base = "../";
  const catalog = blocksFor(d.role);
  const initial = new Set(presetsFor(d.role).find((p) => p.id === "standard")?.blocks ?? []);

  const body = html`${idLine(d)}
${rail(d)}
${editor()}
${catalog.map((meta) => {
    const rendered = renderBlock(meta.id, d, base);
    // JS가 없어도 「標準」은 보인다. 나머지는 조립에서 켜면 나온다.
    return initial.has(meta.id) ? rendered : hidden(rendered);
  })}
<div id="blocksEnd" hidden></div>
<nav class="find" aria-label="ほかの選手">
  <a href="${base}index.html">${d.teamName}の選手一覧</a> · <a href="${base}ranking.html">リーグ順位表</a>
</nav>`;

  return page({
    title: `${d.name} — ${d.teamName} ${d.season}年`,
    base,
    color: d.color,
    spine: `${d.teamName}　${d.name}`,
    freshness: ctx.freshness,
    site: ctx.site,
    nav: "player",
    body,
    bootstrapJs: bootstrapFor(d.role),
  });
}

/** 임계값을 코드에만 두지 않는다 — 테스트가 이 값을 고정한다. */
export const THRESHOLDS = { situationPa: THIN_SITUATION_PA, matchupPa: THIN_MATCHUP_PA };

export { BASE_LABEL, BASE_ORDER };
