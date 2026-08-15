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
  | "matchup"
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
  { id: "matchup", name: "対戦成績", desc: "投手別。打席数の多い順" },
  { id: "ranking", name: "リーグ順位", desc: "指標を切り替えて上位と自分の位置" },
];

export type PresetId = "standard" | "record" | "analysis" | "simple";

export interface PresetMeta {
  id: PresetId;
  name: string;
  blocks: readonly BlockId[];
}

export const PRESETS: readonly PresetMeta[] = [
  { id: "standard", name: "標準", blocks: ["standard", "advanced", "splits", "ranking"] },
  { id: "record", name: "記録", blocks: ["standard", "scorebook", "splits", "matchup"] },
  { id: "analysis", name: "分析", blocks: ["advanced", "situation", "splits", "matchup", "ranking"] },
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
  "splits",
  "scorebook",
  "matchup",
  "ranking",
]);

export function blocksFor(role: "batter" | "pitcher"): BlockMeta[] {
  return role === "pitcher" ? BLOCKS.filter((b) => PITCHER_BLOCKS.has(b.id)) : [...BLOCKS];
}

export function presetsFor(role: "batter" | "pitcher"): PresetMeta[] {
  if (role === "batter") return [...PRESETS];
  return PRESETS.map((p) => ({ ...p, blocks: p.blocks.filter((b) => PITCHER_BLOCKS.has(b)) })).filter(
    (p) => p.blocks.length > 0,
  );
}
