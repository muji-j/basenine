export {
  NON_TEAM_CODES,
  REGULAR_SEASON_GAMES,
  TEAMS,
  TEAM_CODE_ALIASES,
  canonicalTeamCode,
  regularSeasonGames,
  competitionFromLabel,
  competitionOf,
  isTeamShortName,
  leagueOf,
  shortNameOf,
  teamByName,
  teamCodeByShortName,
  teamOf,
} from "./teams.ts";
export type { Competition, League, Team } from "./teams.ts";
export { NEUTRAL_COLOR, colorOf, coloredTeamCodes } from "./colors.ts";
export type { TeamColor } from "./colors.ts";
export {
  VENUES,
  homeVenueKind,
  isHomeVenue,
  knownVenueNames,
  primaryVenue,
  venueById,
  venueOf,
} from "./venues.ts";
export type { HomeVenueKind, Venue, VenueHome, VenueName } from "./venues.ts";
