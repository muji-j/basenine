/**
 * 리그 상수 산출과 순위 편성.
 *
 * ⚠**리그를 섞지 않는다.** 센트럴과 퍼시픽은 DH 유무만으로도 득점 환경이 다르다.
 * 리그 상수·순위·자격 기준을 전부 리그 단위로 만든다.
 */
import {
  battingAverage,
  earnedRunAverage,
  fip,
  leagueConstants,
  onBasePercentage,
  ops,
  qualifiedBatterPa,
  qualifiedPitcherOuts,
  qualifiedRelieverOuts,
  rankBy,
  sluggingPercentage,
  sumBatting,
  sumPitching,
  whip,
  wobaWith,
  wraa,
  wrcPlus,
} from "@bb-app/metrics";
import type { LeagueConstants, Ranked, Rate, WobaWeights } from "@bb-app/metrics";
import type { PitcherRole, SeasonAggregate, SeasonBatting, SeasonPitching } from "./season.ts";
import { TEAMS } from "@bb-app/domain";
import type { League } from "@bb-app/domain";

export interface LeagueBundle {
  league: League;
  constants: LeagueConstants;
  batting: SeasonBatting[];
  pitching: SeasonPitching[];
  /** 이 리그에서 가장 많이 소화한 팀 경기수. 자격 기준의 분모 */
  /**
   * ⚠**리그 최다 팀의 시합수다. 자격 판정에 쓰지 마라** — 그 용도로는 `teamGamesOf` 를 쓴다.
   * 화면이 「이 리그는 지금 몇 경기째인가」를 말할 때만 쓴다.
   */
  teamGames: number;
  /**
   * **구단별 소화 시합수.** 자격 기준의 분모다.
   *
   * ⚠**규정타석은 「四捨五入(팀 시합수 × 3.1)」이다**(npb.jp 공표 각주 · `docs/metrics` §5).
   * 리그 최다 팀의 수를 전원에게 쓰면 **적게 치른 팀의 선수가 부당하게 탈락한다** —
   * 실측(2026-08-18): 최다 111경기(日本ハム) 대 최소 102경기(広島)로 **9경기 차**이고,
   * 규정타석이 **345 대 317로 28타석** 벌어진다. 히로시마 선수는 규정을 채웠는데도
   * 순위에서 빠졌고, 화면은 그것을 **「NPB公式」이라고 적고 있었다**(2026-08-18 다방면 감사 P1).
   */
  teamGamesByCode: ReadonlyMap<string, number>;
}

export function buildLeagues(
  agg: SeasonAggregate,
  /**
   * 그 리그의 **선형가중치**(득점 단위 · 아웃 원점 이동 후). `deriveRunValues` 가 만든다.
   *
   * ⚠**안 주면 폴백 계수로 떨어진다.** 화면 경로(`loadSite`)는 반드시 준다 —
   * 폴백은 리그·시즌을 모르는 값이라, 조용히 쓰이면 화면이 「우리가 유도한 계수」라고
   * 말하면서 아닌 값을 보이게 된다. 안 주는 자리는 도구·단위 시험뿐이다.
   */
  runValuesOf?: (league: League) => WobaWeights | undefined,
): LeagueBundle[] {
  const out: LeagueBundle[] = [];

  for (const league of ["central", "pacific"] as const) {
    /**
     * ⚠**리그별로 나눈 쪽을 쓴다**(`*ByLeague`). 시즌 합계(`agg.batting`)를 쓰면
     * 리그를 넘어 이적한 선수의 **반대 리그 성적까지** 이 리그의 순위와 상수에 들어간다.
     * NPB의 개인 타이틀은 소속 리그 성적만 센다(2026-08-16 확정).
     * 실측: 2026년 山本는 DeNA 105타석 · ソフトバンク 97타석인데,
     * 합산 202타석이 「セントラル 순위」에 실려 있었다.
     */
    const batting = agg.battingByLeague.filter((b) => b.league === league);
    const pitching = agg.pitchingByLeague.filter((p) => p.league === league);
    if (batting.length === 0 || pitching.length === 0) continue;

    const codes = TEAMS.filter((t) => t.league === league).map((t) => t.code);
    const teamGames = Math.max(...codes.map((c) => agg.teamGames.get(c) ?? 0));
    const teamGamesByCode = new Map(codes.map((c) => [c, agg.teamGames.get(c) ?? 0]));

    out.push({
      league,
      teamGames,
      teamGamesByCode,
      batting,
      pitching,
      constants: leagueConstants({
        season: agg.season,
        league,
        batting: sumBatting(batting.map((b) => b.line)),
        pitching: sumPitching(pitching.map((p) => p.line)),
        // 리그 득점은 타자들의 득점 합계다.
        runs: batting.reduce((n, b) => n + b.runs, 0),
        runValues: runValuesOf?.(league),
      }),
    });
  }

  return out;
}

export interface BattingEntry {
  player: SeasonBatting;
  avg: Rate;
  obp: Rate;
  slg: Rate;
  ops: Rate;
  woba: Rate;
  wraa: Rate;
  wrcPlus: Rate;
}

export interface PitchingEntry {
  player: SeasonPitching;
  era: Rate;
  whip: Rate;
  fip: Rate;
}

/**
 * 성적 한 줄에서 지표를 낸다. **여기가 유일한 입구다**(M1).
 *
 * ⚠**상수를 인자로 받는다.** 예전에는 번들에 묶여 있어서 「번들 밖의 성적」을 잴 방법이 없었고,
 * 그래서 리그를 넘어 이적한 선수의 **시즌 합계를 화면에 낼 수 없었다**(2026-08-16 이중 검토 P0).
 */
export function battingEntryOf(player: SeasonBatting, lc: LeagueConstants): BattingEntry {
  return {
    player,
    avg: battingAverage(player.line),
    obp: onBasePercentage(player.line),
    slg: sluggingPercentage(player.line),
    ops: ops(player.line),
    // ⚠**리그·시즌의 계수로 계산한다.** 폴백 계수(`woba(line)`)를 쓰면 화면의 wOBA 와
    //   같은 화면의 wRAA·wRC+ 가 **다른 계수로 계산된 수**가 되어 서로 어긋난다
    woba: wobaWith(player.line, lc.wobaWeights),
    wraa: wraa(player.line, lc),
    wrcPlus: wrcPlus(player.line, lc),
  };
}

export function pitchingEntryOf(player: SeasonPitching, lc: LeagueConstants): PitchingEntry {
  return {
    player,
    era: earnedRunAverage(player.line),
    whip: whip(player.line),
    fip: fip(player.line, lc),
  };
}

export function battingEntries(bundle: LeagueBundle): BattingEntry[] {
  return bundle.batting.map((player) => battingEntryOf(player, bundle.constants));
}

export function pitchingEntries(bundle: LeagueBundle): PitchingEntry[] {
  return bundle.pitching.map((player) => pitchingEntryOf(player, bundle.constants));
}

/**
 * 표본으로 가중한 리그 상수 — **리그를 넘어 이적한 선수의 시즌 합계**를 재기 위한 것.
 *
 * ⚠**이것은 날조가 아니라 증명 가능한 일반화다.**
 * wOBA는 타석 가중 평균이므로 `wOBA(합계)×PA(합계) = Σ wOBA(리그i)×PA(리그i)` 가 항등식이다.
 * 따라서 평균 wOBA를 **타석으로 가중**하면
 * `wRAA(합계, 가중상수) = wRAA(セ) + wRAA(パ)` 가 **정확히** 성립한다.
 * FIP도 같다 — raw FIP가 아웃 가중 평균이므로 `cFip`를 아웃으로 가중하면 리그별 FIP의 아웃 가중 평균이 된다.
 * wRC+의 기준선(`runsPerPa`)도 같은 이유로 타석 가중이다.
 *
 * ⚠**리그를 넘지 않은 선수에게는 아무 일도 하지 않는다** — 가중치가 한쪽으로 무너져 그 리그의 상수 그대로다.
 * 실측 2025·2026 두 시즌에서 리그를 넘은 이적은 7명이다.
 *
 * @param parts 리그별 (상수, 표본). 표본은 타자면 타석, 투수면 아웃
 */
export function blendConstants(
  parts: readonly { constants: LeagueConstants; weight: number }[],
): LeagueConstants {
  // ⚠**상수를 무에서 만들 수는 없다.** 여기서 기본값을 지어내면 그 값으로 계산된 wRC+가
  // 화면까지 나가고, 아무도 그것이 지어낸 값인 줄 모른다. 멈추는 쪽이 맞다(M7)
  if (parts.length === 0) {
    throw new RangeError("리그 상수가 하나도 없다 — 이 시즌에 집계 가능한 리그가 없다");
  }
  const usable = parts.filter((p) => p.weight > 0);
  // ⚠표본이 0이면 가중할 것이 없다. 첫 상수를 그대로 쓴다 — 나눗셈으로 NaN을 만들지 않는다
  if (usable.length === 0) return parts[0]!.constants;
  if (usable.length === 1) return usable[0]!.constants;
  const total = usable.reduce((n, p) => n + p.weight, 0);
  const mean = (of: (c: LeagueConstants) => number): number =>
    usable.reduce((n, p) => n + of(p.constants) * p.weight, 0) / total;
  // 가장 표본이 많은 쪽의 이름을 남긴다 — 어느 리그 기준인지 물으면 답할 수 있어야 한다
  const primary = usable.reduce((a, b) => (b.weight > a.weight ? b : a)).constants;
  return {
    season: primary.season,
    league: primary.league,
    averageWoba: mean((c) => c.averageWoba),
    cFip: mean((c) => c.cFip),
    runsPerPa: mean((c) => c.runsPerPa),
    /**
     * ⚠**계수도 섞는다**(2026-08-20). 계수가 리그·시즌마다 달라졌으므로 안 섞으면
     * 리그를 넘은 선수의 시즌 합계가 **한쪽 리그의 계수로만** 계산된다.
     *
     * ⚠**그 대신 가법성이 정확에서 근사로 내려간다.** 예전 주석이 자랑하던
     * 「`wRAA(합계, 혼합상수) = wRAA(セ) + wRAA(パ)` 가 **정확히** 성립한다」는
     * 계수가 양 리그 공통일 때의 이야기다. 계수가 다르면 합계 라인의 wOBA 는
     * 두 리그 wOBA 의 가중평균이 아니다.
     * ⚠**대상은 리그를 넘어 이적한 선수뿐**이고 실측 규모는 정의서에 적었다.
     */
    wobaWeights: {
      bb: mean((c) => c.wobaWeights.bb),
      hbp: mean((c) => c.wobaWeights.hbp),
      roe: mean((c) => c.wobaWeights.roe),
      single: mean((c) => c.wobaWeights.single),
      double: mean((c) => c.wobaWeights.double),
      triple: mean((c) => c.wobaWeights.triple),
      hr: mean((c) => c.wobaWeights.hr),
    },
    wobaScale: mean((c) => c.wobaScale),
  };
}

/**
 * 자격자만으로 순위를 매기고, 미달자는 **순위 null로 목록에 남긴다**(M3·M11).
 *
 * ⚠**자격 판정을 순위 계산 뒤로 미루면 안 된다.** 미달자를 포함해 매긴 뒤 순위를 지우면
 * 규정타석에 못 미친 타자가 1위를 차지하고 나머지를 한 칸씩 밀어낸다.
 * ⚠지표마다 `Rate`의 분모가 다르므로(타율은 타수, 출루율은 타수+사사구+희생플라이)
 * **분모로 자격을 판정할 수 없다.** 자격은 타석·아웃으로 따로 잰다.
 */
function rankQualified<T>(
  entries: readonly T[],
  pick: (e: T) => Rate,
  isQualified: (e: T) => boolean,
  higherIsBetter: boolean,
): Ranked<T>[] {
  const qualified = entries.filter(isQualified);
  const ranked = rankBy(qualified, pick, { minDenominator: 0, higherIsBetter });
  const unqualified = entries
    .filter((e) => !isQualified(e))
    .map((item) => ({ item, rank: null, rate: pick(item) }));
  return [...ranked, ...unqualified];
}

/**
 * 그 선수의 **소속 구단** 소화 시합수. 자격 기준의 분모다.
 *
 * ⚠**리그 최다가 아니다**(2026-08-18 감사 P1). NPB 규칙은 「소속 구단의 시합수」이고,
 * 팀마다 소화 수가 다르다 — 실측 2026-08-18 에 9경기(규정타석 28) 벌어져 있었다.
 * ⚠**소속은 「가장 최근에 뛴 팀」이다** — 이 리포가 이미 세워 둔 규칙(`SeasonBatting.lastDate`).
 *   시즌 중 이적한 선수의 정확한 NPB 취급은 공표된 형태로 확인할 수 없어, 그 규칙을 따른다.
 *   ⚠**표본이 적다**(2026 리그 내 이적 소수) — 이 한계를 화면이 말해야 하면 그때 적는다.
 * ⚠**모르는 코드면 리그 최다로 떨어진다** — 조용히 0이 되면 **전원이 자격을 얻는다**(M11).
 */
export function teamGamesOf(bundle: LeagueBundle, teamCode: string): number {
  return bundle.teamGamesByCode.get(teamCode) ?? bundle.teamGames;
}

/**
 * **「이 선수가 규정을 채웠는가」는 여기 한 벌뿐이다**(M1 · 2026-08-18 감사 P1).
 *
 * ⚠**같은 규칙이 네 곳에 복제돼 있었고, 어제 그중 절반만 고쳤다.**
 * 순위는 소속 구단 기준으로 매겨지는데 선수 페이지의 「規定」 뱃지는 리그 최다 기준이라,
 * **순위표가 「打率21位」라고 쓴 선수의 페이지가 같은 시각에 「順位がつきません」**이라고 썼다
 * (실측: 浅村 楽天 333타석 · 팀기준 326 · 리그최다기준 345).
 * 투수는 그 절반 수정에서 통째로 빠져 **자격을 채운 5명이 순위에서 사라져 있었다.**
 * → 판정과 표기가 **같은 함수**에서 나온다. 다음에 절반만 고쳐질 자리를 없앴다.
 *
 * ⚠**분모는 소속 구단의 소화 경기수다**(NPB 규칙). 리그 최다를 전원에게 쓰면
 * 적게 치른 팀의 선수가 부당하게 탈락한다.
 */
export function neededPa(bundle: LeagueBundle, teamCode: string): number {
  return qualifiedBatterPa(teamGamesOf(bundle, teamCode));
}

/** 그 선수의 자격선(아웃). **선발은 NPB 공식, 구원은 우리 기준**이다 */
export function neededOuts(bundle: LeagueBundle, teamCode: string, role: PitcherRole): number {
  const games = teamGamesOf(bundle, teamCode);
  return role === "starter" ? qualifiedPitcherOuts(games) : qualifiedRelieverOuts(games);
}

export function isQualifiedBatter(bundle: LeagueBundle, e: BattingEntry): boolean {
  return e.player.line.pa >= neededPa(bundle, e.player.teamCode);
}

export function isQualifiedPitcher(bundle: LeagueBundle, e: PitchingEntry): boolean {
  return e.player.line.outs >= neededOuts(bundle, e.player.teamCode, e.player.role);
}

/**
 * 리그 전체를 향해 말할 때의 **범위**.
 *
 * ⚠**하나의 수로 말할 수 없다.** 기준이 구단마다 다른데 리그 최다 하나를 대표로 적으면
 * 그 문장이 **사실이 아니게 된다** — 「規定打席 345」라고 써 놓고 333타석 선수에게
 * 순위를 붙이고 있었다(2026-08-18 감사 P1).
 */
export function neededPaRange(bundle: LeagueBundle): { min: number; max: number } {
  const v = [...bundle.teamGamesByCode.values()].map(qualifiedBatterPa);
  return { min: Math.min(...v), max: Math.max(...v) };
}

export function neededOutsRange(
  bundle: LeagueBundle,
  role: PitcherRole,
): { min: number; max: number } {
  const f = role === "starter" ? qualifiedPitcherOuts : qualifiedRelieverOuts;
  const v = [...bundle.teamGamesByCode.values()].map(f);
  return { min: Math.min(...v), max: Math.max(...v) };
}

export function rankBatters(
  bundle: LeagueBundle,
  entries: readonly BattingEntry[],
  pick: (e: BattingEntry) => Rate,
  higherIsBetter = true,
): Ranked<BattingEntry>[] {
  return rankQualified(entries, pick, (e) => isQualifiedBatter(bundle, e), higherIsBetter);
}

/**
 * 역할을 나누지 않은 투수 순위.
 *
 * ⚠**여기는 전원에게 선발 기준(NPB 공식 규정투구회)을 건다** — 역할별 기준을 섞으면
 * 구원이 1/3 기준으로 같은 표에 올라와 선발과 나란히 서게 된다.
 * 화면이 쓰는 것은 `rankPitchersInRole` 쪽이고, 이 함수는 도구용이다.
 */
export function rankPitchers(
  bundle: LeagueBundle,
  entries: readonly PitchingEntry[],
  pick: (e: PitchingEntry) => Rate,
  higherIsBetter = false,
): Ranked<PitchingEntry>[] {
  return rankQualified(
    entries,
    pick,
    (e) => e.player.line.outs >= qualifiedPitcherOuts(teamGamesOf(bundle, e.player.teamCode)),
    higherIsBetter,
  );
}

/** 이 역할의 투수만 남긴다. **부문이 다르면 애초에 같은 표에 올리지 않는다** */
export function entriesOfRole(
  entries: readonly PitchingEntry[],
  role: PitcherRole,
): PitchingEntry[] {
  return entries.filter((e) => e.player.role === role);
}

/**
 * 역할 안에서 순위를 매긴다.
 *
 * ⚠**전체 성적으로 줄 세우되, 줄은 역할마다 따로 세운다.** 선발 등판분만 떼어 재지 않는 것은
 * NPB 공식 타이틀(방어율·승리)이 전 등판을 합쳐 매기기 때문이다 — 우리가 다른 정의를 쓰면
 * 같은 이름의 값이 공표값과 어긋난다. 역할은 **어느 줄에 서는가**와
 * **어떤 잣대로 색을 칠하는가**만 결정한다.
 */
export function rankPitchersInRole(
  bundle: LeagueBundle,
  entries: readonly PitchingEntry[],
  role: PitcherRole,
  pick: (e: PitchingEntry) => Rate,
  higherIsBetter = false,
): Ranked<PitchingEntry>[] {
  /**
   * ⚠**자격선을 미리 한 번 계산해 전원에게 쓰면 안 된다**(2026-08-18 감사 P1).
   * 여기가 `qualifyingOuts(bundle, role)` 로 **리그 최다 팀**을 분모로 한 값을
   * 전원에게 걸고 있었다. 실측으로 早川·エスピノーザ·星·ハーン·藤平 **5명**이
   * 자기 팀 기준을 채우고도 순위에서 통째로 빠졌고, 그 위의 등수가 전부 한 칸씩 밀렸다.
   * 화면은 그것을 「NPB公式」이라고 적고 있었다.
   */
  return rankQualified(
    entriesOfRole(entries, role),
    pick,
    (e) => isQualifiedPitcher(bundle, e),
    higherIsBetter,
  );
}
