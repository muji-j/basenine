/**
 * 화면 테스트용 픽스처.
 *
 * ⚠**DB를 켜지 않는다**(작업규칙 11). 렌더러가 순수해야 하는 이유가 이것이고,
 * 순수하지 않게 되면 이 파일이 먼저 컴파일되지 않는다.
 */
import type { BattingLine, PitchingLine, Rate } from "@bb-app/metrics";
import { colorOf } from "@bb-app/domain";
import { battingProfile } from "../src/marks.ts";
import type {
  BattingBlockData,
  PitchingBlockData,
  PlayerPageData,
  RankingPanel,
  RenderContext,
} from "../src/player-page.ts";
import { freshness } from "../src/layout.ts";

export function r(value: number | null, denominator: number): Rate {
  return { value, denominator };
}

export const BATTING_LINE: BattingLine = {
  pa: 442, ab: 382, h: 121, double: 29, triple: 3, hr: 27,
  bb: 56, ibb: 6, hbp: 1, sf: 3, sh: 0, so: 117, roe: 4,
};

export const PITCHING_LINE: PitchingLine = {
  outs: 300, bf: 400, h: 85, hr: 8, bb: 25, ibb: 1, hbp: 3, so: 110, er: 30, r: 33,
};

export function battingBlock(over: Partial<BattingBlockData> = {}): BattingBlockData {
  return {
    games: 104,
    runs: 76,
    rbi: 76,
    sb: 5,
    line: BATTING_LINE,
    avg: r(0.3167, 382),
    obp: r(0.4032, 442),
    slg: r(0.6204, 382),
    ops: r(1.0236, 442),
    woba: r(0.4412, 436),
    wrcPlus: r(227.1, 442),
    wraa: r(51.8, 442),
    iso: r(0.3037, 382),
    babip: r(0.3421, 258),
    kRate: r(0.2647, 442),
    bbRate: r(0.1267, 442),
    src: { src: 44.2, pa: 442, skipped: 0, srcPer600: 60.0 },
    ranks: { avg: 1, obp: 1, slg: 1, ops: 1, hr: 2, rbi: 1, sb: 16, wrcPlus: 1, src: 1 },
    qualified: true,
    needPa: 332,
    ...over,
  };
}

export function pitchingBlock(over: Partial<PitchingBlockData> = {}): PitchingBlockData {
  return {
    games: 18,
    line: PITCHING_LINE,
    decisions: { w: 9, l: 4, sv: 0, hld: 0 },
    era: r(2.7, 300),
    whip: r(1.1, 300),
    fip: r(2.9, 300),
    k9: r(9.9, 300),
    bb9: r(2.25, 300),
    hr9: r(0.72, 300),
    ranks: { era: 3, fip: 5, whip: 4, so: 2 },
    qualified: true,
    needOuts: 300,
    ...over,
  };
}

export function rankingPanel(over: Partial<RankingPanel> = {}): RankingPanel {
  return {
    id: "wrcPlus",
    label: "wRC+",
    digits: 1,
    unit: "打席",
    denAsInnings: false,
    qualifier: "規定打席 332 に達した選手だけに順位がつきます。",
    rows: Array.from({ length: 10 }, (_, i) => ({
      rank: i + 1,
      playerId: `p${i}`,
      name: `選手${i}`,
      teamCode: "t",
      value: r(200 - i * 5, 400),
      isMe: false,
    })),
    ...over,
  };
}

export function playerPage(over: Partial<PlayerPageData> = {}): PlayerPageData {
  return {
    playerId: "41045153",
    name: "佐藤",
    season: 2026,
    teamCode: "t",
    teamName: "阪神タイガース",
    league: "central",
    leagueName: "セントラル・リーグ",
    color: colorOf("t"),
    position: "内野手",
    throws: "right",
    bats: "left",
    birthDate: "1999-03-13",
    physique: "187cm／96kg",
    role: "batter",
    batting: battingBlock(),
    pitching: null,
    splits: [
      {
        id: "hand",
        label: "対左右",
        rows: [
          {
            key: "right",
            label: "対右投手",
            line: { ...BATTING_LINE, pa: 320, ab: 280, h: 90 },
            avg: r(0.321, 280),
            obp: r(0.4, 320),
            slg: r(0.6, 280),
            ops: r(1.0, 320),
            rbi: 55,
          },
          {
            key: "left",
            label: "対左投手",
            line: { ...BATTING_LINE, pa: 20, ab: 18, h: 8 },
            avg: r(0.444, 18),
            obp: r(0.45, 20),
            slg: r(0.7, 18),
            ops: r(1.15, 20),
            rbi: 6,
          },
        ],
        unclassified: 12,
        thinBelow: 30,
      },
    ],
    scorebook: [
      {
        date: "2026-08-14",
        opponent: "読売ジャイアンツ",
        inning: 1,
        half: "bottom",
        outs: 0,
        bases: "12",
        outcome: "中本②",
        rbi: 2,
        hit: true,
      },
    ],
    situation: [{ bases: "", outs: 0, re: 0.381, pa: 88 }],
    scorebookTotal: 442,
    matchups: [
      {
        opponentId: "91045111",
        opponentName: "山本",
        opponentTeam: "B",
        line: { ...BATTING_LINE, pa: 14, ab: 12, h: 4 },
        avg: r(0.333, 12),
        rbi: 3,
      },
      {
        opponentId: "91045112",
        opponentName: "戸郷",
        opponentTeam: "G",
        line: { ...BATTING_LINE, pa: 5, ab: 5, h: 3 },
        avg: r(0.6, 5),
        rbi: 1,
      },
    ],
    matchupTotal: 2,
    ranking: [rankingPanel()],
    mark: {
      axes: battingProfile({ avg: 0.317, obp: 0.403, iso: 0.304, bbRate: 0.127, kRate: 0.265 }),
      sampleText: "442打席",
    },
    spark: [
      { label: "3月", value: 0.812 },
      { label: "4月", value: 1.104 },
      { label: "5月", value: 0.99 },
      { label: "6月", value: null },
      { label: "7月", value: 1.201 },
    ],
    sparkLabel: "月別OPS",
    asOf: "2026-08-14",
    ...over,
  };
}

export function context(over: Partial<RenderContext> = {}): RenderContext {
  return {
    site: { name: "bb-app", contact: "example@example.invalid" },
    freshness: freshness("2026-08-14", "2026-08-15"),
    ...over,
  };
}
