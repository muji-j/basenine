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
import type { SeasonAggregate, SeasonBatting, SeasonPitching } from "./season.ts";
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
    const batting = agg.batting.filter((b) => b.league === league);
    const pitching = agg.pitching.filter((p) => p.league === league);
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

export function battingEntries(bundle: LeagueBundle): BattingEntry[] {
  return bundle.batting.map((player) => ({
    player,
    avg: battingAverage(player.line),
    obp: onBasePercentage(player.line),
    slg: sluggingPercentage(player.line),
    ops: ops(player.line),
    woba: woba(player.line),
    wraa: wraa(player.line, bundle.constants),
    wrcPlus: wrcPlus(player.line, bundle.constants),
  }));
}

export function pitchingEntries(bundle: LeagueBundle): PitchingEntry[] {
  return bundle.pitching.map((player) => ({
    player,
    era: earnedRunAverage(player.line),
    whip: whip(player.line),
    fip: fip(player.line, bundle.constants),
  }));
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
