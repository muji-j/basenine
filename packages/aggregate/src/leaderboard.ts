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
  woba,
  wraa,
  wrcPlus,
} from "@bb-app/metrics";
import type { LeagueConstants, Ranked, Rate } from "@bb-app/metrics";
import type { PitcherRole, SeasonAggregate, SeasonBatting, SeasonPitching } from "./season.ts";
import { TEAMS } from "@bb-app/domain";
import type { League } from "@bb-app/domain";

export interface LeagueBundle {
  league: League;
  constants: LeagueConstants;
  batting: SeasonBatting[];
  pitching: SeasonPitching[];
  /** 이 리그에서 가장 많이 소화한 팀 경기수. 자격 기준의 분모 */
  teamGames: number;
}

export function buildLeagues(agg: SeasonAggregate): LeagueBundle[] {
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

    const teamGames = Math.max(
      ...TEAMS.filter((t) => t.league === league).map((t) => agg.teamGames.get(t.code) ?? 0),
    );

    out.push({
      league,
      teamGames,
      batting,
      pitching,
      constants: leagueConstants({
        season: agg.season,
        league,
        batting: sumBatting(batting.map((b) => b.line)),
        pitching: sumPitching(pitching.map((p) => p.line)),
        // 리그 득점은 타자들의 득점 합계다.
        runs: batting.reduce((n, b) => n + b.runs, 0),
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
    woba: woba(player.line),
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

export function rankBatters(
  bundle: LeagueBundle,
  entries: readonly BattingEntry[],
  pick: (e: BattingEntry) => Rate,
  higherIsBetter = true,
): Ranked<BattingEntry>[] {
  const need = qualifiedBatterPa(bundle.teamGames);
  return rankQualified(entries, pick, (e) => e.player.line.pa >= need, higherIsBetter);
}

export function rankPitchers(
  bundle: LeagueBundle,
  entries: readonly PitchingEntry[],
  pick: (e: PitchingEntry) => Rate,
  higherIsBetter = false,
): Ranked<PitchingEntry>[] {
  const need = qualifiedPitcherOuts(bundle.teamGames);
  return rankQualified(entries, pick, (e) => e.player.line.outs >= need, higherIsBetter);
}

/** 이 역할의 투수만 남긴다. **부문이 다르면 애초에 같은 표에 올리지 않는다** */
export function entriesOfRole(
  entries: readonly PitchingEntry[],
  role: PitcherRole,
): PitchingEntry[] {
  return entries.filter((e) => e.player.role === role);
}

/**
 * 역할별 자격선(아웃 카운트). **선발은 NPB 공식 규정투구회, 구원은 우리 기준**이다.
 *
 * ⚠이 차이를 화면이 말해야 한다 — 공식 기준과 자체 기준을 같은 얼굴로 내보내면
 * 「NPB가 그렇게 정했다」는 오해가 생긴다.
 */
export function qualifyingOuts(bundle: LeagueBundle, role: PitcherRole): number {
  return role === "starter"
    ? qualifiedPitcherOuts(bundle.teamGames)
    : qualifiedRelieverOuts(bundle.teamGames);
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
  const need = qualifyingOuts(bundle, role);
  return rankQualified(
    entriesOfRole(entries, role),
    pick,
    (e) => e.player.line.outs >= need,
    higherIsBetter,
  );
}
