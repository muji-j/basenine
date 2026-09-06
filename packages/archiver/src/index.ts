export { systemClock, fixedClock, toJstDateString } from "./clock.ts";
export type { Clock } from "./clock.ts";
export {
  discoverGames,
  gamesOn,
  monthlyScheduleUrl,
  pageKey,
  pageUrl,
  GAME_PAGES,
  NoGamesFoundError,
} from "./discover.ts";
export type { GamePage, GameRef } from "./discover.ts";
export { PoliteFetcher, buildUserAgent } from "./fetcher.ts";
export type { FetchResponse, PoliteFetcherOptions } from "./fetcher.ts";
export { LocalSink, MemorySink, sha256 } from "./sink.ts";
export type { BlobMeta, Sink } from "./sink.ts";
export { archivePlayer, archivePlayers, playerKey, playerUrl } from "./players.ts";
export type { ArchivePlayersDeps } from "./players.ts";
export { STARTERS_URL, archiveStarters, startersKey } from "./starters.ts";
export type { ArchiveStartersDeps } from "./starters.ts";
/**
 * ⚠**키 규칙을 Task 2 가 베끼지 말고 여기서 가져가게 한다**(M1) —
 * `npb/draft/{year}/index` · `npb/draft/{year}/{slug}` 를 두 벌로 두면 한쪽만 고쳐진다.
 */
export {
  BACKNUMBER_KEY,
  BACKNUMBER_URL,
  DraftCollectError,
  collectDraft,
  countSkips,
  draftTargets,
  teamPageKey,
  teamPageUrl,
  yearIndexKey,
  yearIndexUrl,
} from "./draft.ts";
export type {
  DraftCollectOptions,
  DraftCollectResult,
  DraftTarget,
  DraftYearSkip,
  DraftYearSkipped,
} from "./draft.ts";
/**
 * ⚠**키 규칙을 적재가 베끼지 말고 여기서 가져가게 한다**(M1) — `wikipedia/draft/{year}`.
 * ⚠**`npb/draft/…` 와 나란히 두지 마라**: 출처도 라이선스도 배포 tar 도 다르다(L3·L6).
 */
export { DRAFT_WIKI_LICENSE, collectDraftWiki, draftWikiKey, draftWikiUrl } from "./draft-wiki.ts";
export type { DraftWikiCollectOptions, DraftWikiCollectResult } from "./draft-wiki.ts";
export {
  MonthlyScheduleCache,
  archiveDate,
  archiveDates,
  archiveGame,
  archivePage,
  isDayError,
  summarize,
} from "./archive.ts";
export type { ArchiveDeps, BlobExtra, DayError, DayResult, PageOutcome, PageResult } from "./archive.ts";
