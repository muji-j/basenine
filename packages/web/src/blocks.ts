/**
 * 블록 카탈로그와 프리셋.
 *
 * 선수 페이지는 **블록의 나열**이고, 무엇을 켤지와 순서는 사용자가 정한다
 * (`docs/superpowers/specs/2026-08-15-ui-meikan-design.md` §3).
 *
 * ⚠**이 목록은 서버(생성 시)와 클라이언트(조립 UI) 양쪽이 쓴다.** 두 벌로 나누면
 * 반드시 어긋난다 — 여기 1벌만 두고 클라이언트에는 JSON으로 실어 보낸다(M1의 정신).
 *
 * ⚠**프리셋이 먼저고 조립은 나중이다.** 설정 화면부터 보여주는 도구는 아무도 안 쓴다.
 */

export type BlockId =
  | "standard"
  | "advanced"
  | "splits"
  | "scorebook"
  | "situation"
  | "rolesplit"
  | "timesthrough"
  | "count"
  | "relief"
  | "streak"
  | "matchup"
  | "career"
  | "ranking";

export interface BlockMeta {
  id: BlockId;
  /** 조립 UI에 나오는 이름(일본어) */
  name: string;
  /** 한 줄 설명. **무엇이 들어있는지 말한다** — 이름만으로는 고를 수 없다 */
  desc: string;
}

export const BLOCKS: readonly BlockMeta[] = [
  { id: "standard", name: "基本成績", desc: "打率・本塁打・打点など。順位つき" },
  { id: "advanced", name: "セイバー", desc: "wOBA・wRC+・SRC・ISO・BABIP" },
  { id: "splits", name: "スプリット", desc: "対左右／走者状況／本拠地／月別" },
  { id: "scorebook", name: "打席記録", desc: "直近の打席を1つずつ" },
  { id: "situation", name: "得点期待値", desc: "24状況の期待値と、立った打席数" },
  { id: "rolesplit", name: "先発・救援別", desc: "投手のみ。役割ごとに分けた成績" },
  { id: "timesthrough", name: "打順一巡", desc: "投手のみ。NPB全体の巡目別成績（この選手の記録ではありません）" },
  /**
   * ⚠**재료는 계속 있었다** — `pa_event.ball_count` 563,833행이 채워진 채 읽는 코드가 0곳이었다.
   * ⚠**독창이 아니다**(nf3·データパーク 등이 이미 낸다). 화면 문구가 그렇게 말한다.
   */
  { id: "count", name: "カウント別", desc: "追い込まれ率・2ストライク後の成績・初球決着率" },
  /**
   * ⚠**용어집에 `inheritedRunner` 가 있는데 그것을 재는 지표가 없었다.** 여기가 그 구멍을 닫는다.
   * ⚠**통산 전용이다** — 한 시즌으로는 1인당 4회 남짓이라 값이 아니라 소음이다(M3).
   */
  { id: "relief", name: "火消し", desc: "投手のみ。走者を背負って登板した場面と、その結果（通算）" },
  { id: "streak", name: "連続記録", desc: "打者のみ。連続安打・連続出塁" },
  { id: "matchup", name: "対戦成績", desc: "投手別。打席数の多い順" },
  /**
   * ⚠**출처가 다른 유일한 블록이다**(M4). 다른 블록은 우리가 경기에서 쌓은 값이고,
   * 이것은 **NPB 공표치**다 — 화면이 그렇게 말한다.
   */
  { id: "career", name: "通算成績", desc: "デビューからの年度別と、その合計（出典：選手ページ）" },
  { id: "ranking", name: "リーグ順位", desc: "指標を切り替えて上位と自分の位置" },
];

export type PresetId = "standard" | "record" | "analysis" | "simple";

export interface PresetMeta {
  id: PresetId;
  name: string;
  blocks: readonly BlockId[];
}

export const PRESETS: readonly PresetMeta[] = [
  // `rolesplit`은 타자 페이지에서 걸러진다(`presetsFor`) — 투수에게만 기본으로 켜진다
  { id: "standard", name: "標準", blocks: ["standard", "rolesplit", "advanced", "splits", "ranking"] },
  { id: "record", name: "記録", blocks: ["standard", "career", "streak", "scorebook", "splits", "matchup"] },
  // ⚠`count` 는 타자·투수 양쪽, `relief` 는 투수에게만 남는다(`presetsFor` 가 거른다)
  { id: "analysis", name: "分析", blocks: ["advanced", "rolesplit", "count", "relief", "situation", "timesthrough", "splits", "matchup", "ranking"] },
  { id: "simple", name: "簡易", blocks: ["standard"] },
];

/**
 * 투수 페이지의 블록.
 *
 * ⚠**`situation`(득점기대치)은 여전히 없다.** 그건 타석에 선 쪽의 이야기이고,
 * 투수용으로 옮기려면 「이 투수가 만든 득점기대치 변화」라는 다른 지표가 필요하다.
 * 있는 척하는 빈 화면보다 **없는 것이 정직하다** — 만들 때까지 목록에서 뺀다.
 *
 * `splits`는 2026-08-15에 투수 축(対左右打者·본거지·주자상황·월별)을 만들어 넣었다.
 */
const PITCHER_BLOCKS = new Set<BlockId>([
  "standard",
  "advanced",
  "rolesplit",
  /**
   * ⚠**`situation` 과 달리 이것은 투수 쪽 이야기다.**
   * 得点期待値는 「타석에 선 쪽」의 값이라 투수 목록에서 빼 두었는데,
   * 타순 순회는 **같은 투수가 같은 타자를 몇 번째로 만나는가**라 투수의 이야기다.
   * ⚠**그래도 이 선수의 기록은 아니다** — NPB 전체의 값이고, 화면이 그렇게 말한다.
   *   개인 순위를 매기지 않는다(개인의 3순회 표본은 얇다).
   */
  "timesthrough",
  "count",
  /** ⚠**투수 전용이다** — 타자에게는 뜻이 없다. `rolesplit` 과 같은 이유로 양쪽 목록에 명시한다 */
  "relief",
  "splits",
  "scorebook",
  "matchup",
  "career",
  "ranking",
]);

/**
 * 타자 페이지의 블록.
 *
 * ⚠**`rolesplit`(선발·구원별)은 투수만의 이야기다.** 예전에는 타자에게 「전 블록」을 주고
 * 투수만 걸렀는데, 그러면 투수 전용 블록을 새로 만들 때마다 **타자 페이지에 빈 블록이 샌다.**
 * 양쪽을 명시한다 — 목록이 둘이면 어긋날 수 있지만, 어긋나는 것을 테스트가 잡는다.
 */
const BATTER_BLOCKS = new Set<BlockId>([
  "standard",
  "streak",
  "advanced",
  "count",
  "splits",
  "scorebook",
  "situation",
  "matchup",
  "career",
  "ranking",
]);

function allowed(role: "batter" | "pitcher"): Set<BlockId> {
  return role === "pitcher" ? PITCHER_BLOCKS : BATTER_BLOCKS;
}

export function blocksFor(role: "batter" | "pitcher"): BlockMeta[] {
  const ok = allowed(role);
  return BLOCKS.filter((b) => ok.has(b.id));
}

export function presetsFor(role: "batter" | "pitcher"): PresetMeta[] {
  const ok = allowed(role);
  return PRESETS.map((p) => ({ ...p, blocks: p.blocks.filter((b) => ok.has(b)) })).filter(
    (p) => p.blocks.length > 0,
  );
}
