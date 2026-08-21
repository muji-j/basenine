/**
 * 화면 테스트용 픽스처.
 *
 * ⚠**DB를 켜지 않는다**(작업규칙 11). 렌더러가 순수해야 하는 이유가 이것이고,
 * 순수하지 않게 되면 이 파일이 먼저 컴파일되지 않는다.
 */
import type { BattingLine, PitchingLine, Rate } from "@bb-app/metrics";
import { colorOf } from "@bb-app/domain";
import { battingProfile, pitchingProfile } from "../src/marks.ts";
import type { ProfileAxis } from "../src/marks.ts";
import type {
  BattingBlockData,
  PitchingBlockData,
  PlayerPageData,
  RankingPanel,
  ReliefBlockData,
  RenderContext,
} from "../src/player-page.ts";
import { freshness, pathsFor } from "../src/layout.ts";

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

/**
 * 각주가 쓰는 **리그 전체 本盗** — 픽스처 값.
 *
 * ⚠**일부러 실제와 다른 수를 쓴다.** 화면이 예전처럼 「47・146」을 소스에 박아 두면
 * 이 픽스처로 렌더링해도 그 수가 나오므로 **시험이 통과해 버린다.**
 * 여기 수가 그대로 화면에 나오는 것이 「DB 에서 읽는다」의 증거다(작업규칙 9).
 * 실제 수는 `steal-seasons.test.ts` 가 실DB 로 잰다.
 */
export const LEAGUE_HOME = { from: 2011, to: 2019, sb: 40, cs: 120, doubleSteal: 33 };

export function battingBlock(over: Partial<BattingBlockData> = {}): BattingBlockData {
  return {
    games: 104,
    runs: 76,
    rbi: 76,
    sb: 5,
    /**
     * ⚠**루별 내역의 합이 총계와 맞아야 한다** — 도루 5(2루 4 · 3루 1) · 도루자 2(2루 1 · 3루 1).
     * 픽스처가 어긋나 있으면 화면 시험이 「합이 안 맞는 표」를 정상으로 고정한다.
     */
    steal: {
      cs: 2,
      pickoff: 1,
      rate: { value: 5 / 7, denominator: 7 },
      byBase: [
        { label: "二盗", base: "2b", sb: 4, cs: 1, rate: { value: 0.8, denominator: 5 } },
        { label: "三盗", base: "3b", sb: 1, cs: 1, rate: { value: 0.5, denominator: 2 } },
      ],
      pickoffByBase: [{ label: "一塁", n: 1 }],
      doubleSteal: 1,
      leagueHome: LEAGUE_HOME,
    },
    gidp: 9,
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
    batted: {
    groundOuts: 120, airOuts: 110, left: 140, center: 120, right: 100,
    infield: 90, infieldHits: 8, swinging: 70, looking: 25,
  },
  needPa: 332,
    ...over,
  };
}

export function pitchingBlock(over: Partial<PitchingBlockData> = {}): PitchingBlockData {
  return {
    games: 18,
    line: PITCHING_LINE,
    decisions: { w: 9, l: 4, sv: 0, hld: 0, reliefW: 0 },
  batted: {
    groundOuts: 120, airOuts: 110, left: 140, center: 120, right: 100,
    infield: 90, infieldHits: 8, swinging: 70, looking: 25,
  },
  quality: { starts: 22, qs: 14, hqs: 7, cg: 1, sho: 0 },
    era: r(2.7, 300),
    whip: r(1.1, 300),
    fip: r(2.9, 300),
    k9: r(9.9, 300),
    bb9: r(2.25, 300),
    hr9: r(0.72, 300),
    ranks: { era: 3, fip: 5, whip: 4, so: 2 },
    qualified: true,
    needOuts: 300,
    // 기본 픽스처는 **순수 선발**이다 — 구원 등판이 0이므로 「先発・救援別」은 빈 상태를 낸다
    role: "starter",
    starts: 18,
    srp: { srp: 12.4, bf: 400, skipped: 0, srpPer9: 1.12 },
    pitches: 1620,
    wp: 2,
    balk: 0,
    // 300아웃에 1620구 = 5.40 — 선발 중위권
    pitchesPerOut: r(5.4, 300),
    asStarter: { games: 18, line: PITCHING_LINE, era: r(2.7, 300), whip: r(1.1, 300), k9: r(9.9, 300) },
    asReliever: null,
    ...over,
  };
}

/** 선발과 구원을 겸하는 투수. **45명이 실재하고, 이들에게 하나의 방어율은 거짓말에 가깝다** */
export function mixedPitchingBlock(over: Partial<PitchingBlockData> = {}): PitchingBlockData {
  return pitchingBlock({
    games: 26,
    starts: 5,
    role: "reliever",
    asStarter: { games: 5, line: PITCHING_LINE, era: r(3.2, 90), whip: r(1.3, 90), k9: r(7.5, 90) },
    asReliever: { games: 21, line: PITCHING_LINE, era: r(3.2, 210), whip: r(1.05, 210), k9: r(9.5, 210) },
    ...over,
  });
}

/**
 * 투수의 紋 — **축이 타자와 다르고 넷이 뒤집혀 있다.**
 *
 * ⚠기본 픽스처는 타자 축이라 `role: "pitcher"`만 바꾸면 **투수 페이지에 타자 축이 나온다.**
 * 실제 파이프라인은 역할에 따라 축을 바꾸므로, 투수를 시험할 때는 이걸 함께 넘긴다.
 */
export function pitcherMark(): { axes: ProfileAxis[]; sampleText: string } {
  return {
    axes: pitchingProfile({
      k9: r(9.9, 300), bb9: r(2.25, 300), hr9: r(0.72, 300),
      whip: r(1.1, 300), era: r(2.7, 300),
    }),
    sampleText: "100回",
  };
}

/**
 * 火消し 블록.
 *
 * ⚠**기본값은 자격선을 넘긴 투수다** — 넘기지 못한 쪽(`{ dousedRate: null }`)은
 * 시험이 따로 만든다. 둘 다 화면 분기가 있으므로 하나만 두면 절반이 안 그려진다.
 */
export function reliefBlock(over: Partial<ReliefBlockData> = {}): ReliefBlockData {
  return {
    from: 2018,
    to: 2026,
    career: { midInning: 51, inherited: 44, inheritedRunners: 78, doused: 28 },
    season: { midInning: 8, inherited: 7, inheritedRunners: 12, doused: 5 },
    dousedRate: r(28 / 44, 44),
    enteringRe: r(0.94, 44),
    reMissing: 0,
    minForRate: 10,
    ...over,
  };
}

/** 성적이 없는 선수의 紋 — **축이 하나도 없다.** 실제로 신인·부상 선수에서 나온다 */
export const EMPTY_MARK = { axes: [] as ProfileAxis[], sampleText: "0打席" };

export function rankingPanel(over: Partial<RankingPanel> = {}): RankingPanel {
  return {
    id: "wrcPlus",
    label: "wRC+",
    digits: 1,
    unit: "打席",
    denAsInnings: false,
    qualifier: "規定打席 332 に達した選手だけに順位がつきます。",
    qualifiedCount: 10,
    allCount: 10,
    /**
     * ⚠**기본 픽스처는 자격 미달 행이 하나도 없다**(전원 `rank` 가 있다) —
     * 그러면 최소 표본 입력이 안 붙는 패널이고, 그때 값은 **null 이지 0 이 아니다**(M11).
     * 입력이 붙는 패널을 재려면 `over` 로 덮어써라(`standings-page.test.ts` 가 그렇게 한다).
     */
    minTop: null,
    rows: Array.from({ length: 10 }, (_, i) => ({
      rank: i + 1,
      rankAll: i + 1,
      summary: "打率 .317（382打数）",
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
    // ⚠기본값은 **진행 중**이다 — 기존 시험은 현재형 문구를 기대한다
    seasonOver: false,
    summary: "打率 .317（382打数）",
    bunts: [{ bases: "1", outs: 0, n: 895, before: 0.716, delta: -0.121 }],
    timesThrough: [
      { round: 1, pa: 12040, ab: 10820, h: 2705, hr: 208, bb: 980, so: 2320 },
      { round: 2, pa: 9880, ab: 8890, h: 2311, hr: 196, bb: 800, so: 1780 },
      { round: 3, pa: 5120, ab: 4610, h: 1245, hr: 121, bb: 410, so: 860 },
      // ⚠4순회는 표본이 얇다 — 임계값 아래라 화면에 나오지 않아야 한다
      { round: 4, pa: 180, ab: 165, h: 47, hr: 5, bb: 12, so: 30 },
    ],
    season: 2026,
    teamCode: "t",
    teamName: "阪神タイガース",
    league: "central",
    leagueName: "セントラル・リーグ",
    color: colorOf("t"),
    position: "内野手",
    throws: "right",
    bats: "left",
    birthYear: 1999,
    physique: "187cm／96kg",
    draft: "2016年ドラフト1位",
    career: {
      batting: [
        { year: 2024, team: "阪神",  games: 100, faced: 400, line: ".280（350打数）· 98安打 12本 55打点 3盗塁1刺",
          sort: { games: 100, pa: 400, h: 98, hr: 12, rbi: 55, sb: 3 } },
        // ⚠**같은 해에 두 줄** — 시즌 도중 이적. 「몇 시즌」을 셀 때 행 수로 세면 틀린다
        { year: 2025, team: "阪神",  games: 60, faced: 240, line: ".300（200打数）· 60安打 8本 30打点 1盗塁0刺",
          sort: { games: 60, pa: 240, h: 60, hr: 8, rbi: 30, sb: 1 } },
        { year: 2025, team: "巨人",  games: 40, faced: 160, line: ".250（140打数）· 35安打 4本 20打点 0盗塁0刺",
          sort: { games: 40, pa: 160, h: 35, hr: 4, rbi: 20, sb: 0 } },
      ],
      pitching: [],
      battingSeasons: 2,
      pitchingSeasons: 0,
      battingTotal: "200試合 800打席 · .276（690打数）· 193安打 24本 105打点 4盗塁1刺",
      pitchingTotal: null,
      from: 2024,
      to: 2025,
      source: "npb.jp/bis/players (年度別成績)",
      asOf: "2026-08-17",
    },
    uniformNumber: "18",
    role: "batter",
    batting: battingBlock(),
    pitching: null,
    splits: [
      {
        id: "hand",
        label: "対左右",
        allowed: false,
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
        gameSlug: "2026-0814-t-g-17",
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
        opponentTeam: "b",
        line: { ...BATTING_LINE, pa: 14, ab: 12, h: 4 },
        avg: r(0.333, 12),
        rbi: 3,
      },
      {
        opponentId: "91045112",
        opponentName: "戸郷",
        opponentTeam: "g",
        line: { ...BATTING_LINE, pa: 5, ab: 5, h: 3 },
        avg: r(0.6, 5),
        rbi: 1,
      },
    ],
    matchupTotal: 2,
    ranking: [rankingPanel()],
    mark: {
      axes: battingProfile({
        avg: r(0.317, 382), obp: r(0.403, 442), iso: r(0.304, 382),
        bbRate: r(0.127, 442), kRate: r(0.265, 442),
      }),
      sampleText: "442打席",
    },
    spark: [
      { label: "3月", value: 0.812 },
      { label: "4月", value: 1.104 },
      { label: "5月", value: 0.99 },
      { label: "6月", value: null },
      { label: "7月", value: 1.201 },
    ],
    streaks: {
      hitting: { current: 3, best: 12, bestFrom: "2026-05-02", bestTo: "2026-05-17" },
      onBase: { current: 8, best: 21, bestFrom: "2026-04-20", bestTo: "2026-05-17" },
      hitless: { current: 0, best: 3, bestFrom: "2026-06-01", bestTo: "2026-06-04" },
      games: 104,
      // 픽스처는 **최신 경기일에 나온 선수**다 — `asOf`와 같으므로 「今」이 붙는다
      lastGameDate: "2026-08-14",
    },
    sparkLabel: "月別OPS",
    /**
     * カウント別. ⚠**격리분이 0이 아닌 픽스처**를 기본으로 둔다 —
     * 0이면 「격리 수를 말하는 줄」이 영영 그려지지 않아 그 분기를 아무도 안 본다.
     */
    count: {
      pa: 442,
      quarantined: 1,
      twoStrike: r(0.52, 442),
      firstPitch: r(0.117, 442),
      fullCount: r(0.121, 442),
      threeBall: r(0.151, 442),
      rows: [
        {
          label: "2ストライク前",
          line: { ...BATTING_LINE, pa: 212, ab: 190, h: 68 },
          avg: r(0.358, 190),
          ops: r(0.98, 212),
        },
        {
          label: "2ストライク後",
          line: { ...BATTING_LINE, pa: 230, ab: 214, h: 44, so: 88 },
          avg: r(0.206, 214),
          ops: r(0.58, 230),
        },
      ],
    },
    // 기본 픽스처는 타자다 — 火消し는 투수만 (`pitcherPage()` 가 채운다)
    relief: null,
    asOf: "2026-08-14",
    // 기본 픽스처는 **이적하지 않은 선수**다 — 이력이 비어 있으면 화면에 안 나온다
    stints: [],
    postseason: [],
    ...over,
  };
}

/**
 * 화면 시험용 문맥.
 *
 * ⚠**기본은 「시즌이 하나뿐」이다** — 시즌 전환 띠가 안 나온다.
 * 전환을 시험할 때는 `seasonContext()`를 쓴다.
 */
export function context(over: Partial<RenderContext> = {}): RenderContext {
  return {
    site: { name: "bb-app", contact: "example@example.invalid" },
    freshness: freshness("2026-08-14", "2026-08-15"),
    paths: pathsFor([], 2026),
    hasPostseason: false,
    ...over,
  };
}

/** 시즌이 둘인 문맥. `paths2025`에 없는 경로는 「그 시즌엔 없음」으로 다뤄진다 */
export function seasonContext(paths2025: readonly string[] = []): RenderContext {
  return context({
    paths: pathsFor(
      [
        { season: 2026, prefix: "", paths: new Set<string>() },
        { season: 2025, prefix: "2025/", paths: new Set(paths2025) },
      ],
      2026,
    ),
  });
}

/**
 * **지난 시즌**의 문맥 — 2025 화면을 그리는 상황.
 *
 * ⚠끝난 시즌의 화면이 「発表待ち」·「いま投げている投手」처럼 현재형으로 말하는지 보려면
 * 이것이 필요하다. `seasonContext`(현재 시즌 쪽)와 방향이 반대다.
 */
export function pastSeasonContext(paths2025: readonly string[] = []): RenderContext {
  return context({
    paths: pathsFor(
      [
        { season: 2026, prefix: "", paths: new Set<string>() },
        { season: 2025, prefix: "2025/", paths: new Set(paths2025) },
      ],
      2025,
    ),
  });
}
