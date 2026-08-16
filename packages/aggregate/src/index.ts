export { aggregateSeason } from "./season.ts";
export type {
  Decisions,
  PitcherRole,
  SeasonAggregate,
  SeasonBatting,
  SeasonPitching,
} from "./season.ts";
export {
  battingEntries,
  battingEntryOf,
  blendConstants,
  buildLeagues,
  entriesOfRole,
  pitchingEntries,
  pitchingEntryOf,
  qualifyingOuts,
  rankBatters,
  rankPitchers,
  rankPitchersInRole,
} from "./leaderboard.ts";
export type { BattingEntry, LeagueBundle, PitchingEntry } from "./leaderboard.ts";
export { ALL_STATES, buildRunExpectancy, paValue, stateKey } from "./run-expectancy.ts";
export type { RunExpectancy, StateKey } from "./run-expectancy.ts";
export { addSrc, addSrp, computeSrc, computeSrp, missingStates, srcPer600Of, srpPer9Of } from "./situational.ts";
export type { SrcEntry, SrcTotals, SrpEntry, SrpTotals } from "./situational.ts";
export { battingSplits, matchups, pitchingSplits } from "./splits.ts";
export type { Matchup, PlayerSplits, SplitDimension, SplitLine } from "./splits.ts";
export {
  STAR_ER,
  STAR_HITS,
  STAR_LIMIT,
  STAR_OUTS,
  STAR_RBI,
  STAR_SO,
  dayResults,
  gameDates,
  latestGameDate,
} from "./day.ts";
export type { DayGame, DayPitcherRef, DaySide, DayStar, GameDay } from "./day.ts";
export { RECENT_GAMES, gamesBehind, teamStandings, winPct } from "./standings.ts";
export type { TeamRecord } from "./standings.ts";
export { KEY_PLAY_LIMIT, gameDetails } from "./game.ts";
export type { GameDetail, GamePlay, HalfInning } from "./game.ts";
export { battingStreaks, emptyStreaks } from "./streaks.ts";
export type { PlayerStreaks, Streak } from "./streaks.ts";
