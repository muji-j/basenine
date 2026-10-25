/**
 * **「이 시즌을 지금 굽는가」 한 벌**(M1 · PR-4 3중 검토 반영 재검토 F1 · 2026-10-25).
 *
 * ⚠⚠**빌드(`tools/build.ts`)와 실DB 시험이 같은 함수로 루트 시즌을 고른다.** 예전에는 새 시즌 유예가 빌드 안(`loadNewest`)에만 있어서,
 *   개막 1~2경기일에 빌드는 이전 시즌으로 굽고 종료 0 인데 CI 「시험」 단계의 실DB 시험 셋(`woba-weights-wired` · `ranking-title-metrics` ·
 *   `gidp-by-team`)이 **DB 의 최신 정규시즌을 그대로 `loadSite` 로 읽다 같은 「표본 0」으로 떨어져** 배포(`if: success()`)를 막았다 —
 *   실패 자리만 「화면 생성」에서 「시험」으로 옮겨 갔을 뿐이었다(실DB 사본을 개막 1경기일 모양으로 잘라 재현).
 *
 * - `dbSeasons` — 빌드 시즌 판정의 재료(치른 시즌 · 경기 행이 있는 시즌) 한 벌.
 * - `loadNewest` — 굽는 목록의 **최대 시즌을 먼저 읽고**, 계수 유도가 「표본 0」(`RunValueSampleError`)이면 조건(`deferNewestSeason`)이 맞을 때만
 *   그 시즌을 빼고 다음 시즌을 루트로 읽는다. 조건 밖(최대가 아닌 시즌 · 다른 오류 · 명시 목록 · 끝난 시즌 · 그 리그 8경기일째 이후 · 남는 시즌 없음)은 **그대로 던진다**(M7).
 * - `rootSeason` — 시험용 입구: `auto` 와 같은 판정(`resolveBuildSeasons`)으로 굽는 시즌을 정하고 `loadNewest` 로 루트를 읽는다.
 * ⚠**경기일은 그 리그로 센다**(재검토 F2) — 표본 0 은 리그 단위(`err.league`)로 나는데 시즌 전체로 세면, 리그 개막이 엇갈린 해에
 *   먼저 연 리그의 경기일이 상한(7)을 넘긴 뒤 늦게 연 리그의 개막일이 「결함」(종료 1)이 된다.
 */
import { RunValueSampleError } from "@bb-app/aggregate";
import { TEAMS } from "@bb-app/domain";
import { seasonIsOver } from "@bb-app/store";
import type { Db } from "@bb-app/store";
import { deferNewestSeason, deferNotice, resolveBuildSeasons } from "./build-seasons.ts";
import type { DbSeasons, SeasonArg } from "./build-seasons.ts";
import { gameSeasons, playedSeasons } from "./query.ts";

/** 빌드 시즌 판정의 재료 — 치른 시즌(무엇을 굽나 · 구멍) · 경기 행이 있는 시즌(하한 아래가 섞였나 · 상태 무관) */
export function dbSeasons(db: Db): DbSeasons {
  return { played: playedSeasons(db), withGames: gameSeasons(db) };
}

/**
 * **그 리그 구단이 치른 정규시즌 경기일 수**(재검토 F2) — 홈이든 원정이든 그 리그 구단이 나선 경기의 날짜.
 * ⚠교류전은 두 리그 모두에 센다(그날 그 리그 구단이 경기를 했다). 개막 직후에는 교류전이 없다.
 */
export function leagueGameDays(db: Db, season: number, league: string): { readonly n: number; readonly first: string | null } {
  const codes = TEAMS.filter((t) => t.league === league).map((t) => t.code);
  if (codes.length === 0) throw new RangeError(`모르는 리그다: ${league}`);
  const marks = codes.map(() => "?").join(",");
  return db.raw
    .prepare(
      `SELECT COUNT(DISTINCT game_date) AS n, MIN(game_date) AS first
         FROM game
        WHERE season = ? AND status = 'played' AND competition = 'regular'
          AND (home_code IN (${marks}) OR away_code IN (${marks}))`,
    )
    .get(season, ...codes, ...codes) as unknown as { n: number; first: string | null };
}

/** 굽지 않고 미룬 새 시즌 — 경고 한 줄(`noticeOf`)의 재료 */
export interface DeferredSeason {
  readonly season: number;
  readonly league: string;
  readonly event: string;
  /** 그 리그의 정규시즌 치른 경기일 수 */
  readonly gameDays: number;
  readonly firstDate: string | null;
  /** 이번 루트(미룬 시즌 다음으로 큰 시즌) */
  readonly root: number;
}

/** 미룬 사실의 `::warning::` 한 줄 — 문구는 `build-seasons.ts` 의 `deferNotice` 한 벌 */
export function noticeOf(d: DeferredSeason): string {
  return deferNotice({
    season: d.season,
    reason: `${d.league} 의 ${d.event === "origin" ? "원점(계수 0 사건)" : d.event} 표본 0`,
    gameDays: d.gameDays,
    firstDate: d.firstDate,
    root: d.root,
  });
}

/**
 * **굽는 목록의 최대(새) 시즌을 먼저 읽는다** — 「표본 0」이면 조건이 맞을 때만 그 시즌을 빼고 다음 시즌(새 루트)을 읽는다.
 * ⚠**오류 형으로 가른다**(`RunValueSampleError`) — 같은 `RangeError` 인 어휘·구조 오류(M7)는 그대로 던진다. 새 루트를 읽다 나는 오류도 그대로 던진다.
 * @returns 굽는 시즌(내림차순 · 첫째가 루트) · 루트의 자료 · 미뤘으면 그 사실(아니면 `null`)
 */
export function loadNewest<T>(
  db: Db,
  o: { readonly kind: SeasonArg["kind"]; readonly seasons: readonly number[]; readonly load: (season: number) => T },
): { readonly seasons: number[]; readonly first: T; readonly deferred: DeferredSeason | null } {
  const newest = o.seasons[0];
  if (newest === undefined) throw new RangeError("굽는 시즌이 없다");
  try {
    return { seasons: [...o.seasons], first: o.load(newest), deferred: null };
  } catch (err) {
    if (!(err instanceof RunValueSampleError) || err.season !== newest) throw err;
    const days = leagueGameDays(db, newest, err.league);
    const defer = deferNewestSeason({
      kind: o.kind,
      seasons: o.seasons,
      failedSeason: newest,
      failedSeasonOver: seasonIsOver(db, newest),
      gameDays: days.n,
    });
    if (!defer) throw err;
    const rest = o.seasons.slice(1);
    const root = rest[0]!;
    return {
      seasons: rest,
      first: o.load(root),
      deferred: { season: newest, league: err.league, event: err.event, gameDays: days.n, firstDate: days.first, root },
    };
  }
}

/**
 * **실DB 시험의 입구** — `auto` 빌드와 같은 판정으로 굽는 시즌을 정하고 루트 시즌을 읽는다(시험이 따로 `MAX(season)` 을 고르지 않는다).
 * ⚠판정이 실패하면(하한 아래 경기 · 구멍 · 치른 시즌 0) **던진다** — 빌드가 종료 1 로 멈추는 DB 에서 시험만 초록이면 안 된다.
 */
export function rootSeason<T>(
  db: Db,
  load: (season: number) => T,
): { readonly season: number; readonly site: T; readonly seasons: number[]; readonly deferred: DeferredSeason | null } {
  const r = resolveBuildSeasons({ kind: "auto" }, dbSeasons(db));
  if (!r.ok) throw new Error(`빌드 시즌 판정이 실패했다(빌드도 굽지 않는다):\n${r.message}`);
  const loaded = loadNewest(db, { kind: "auto", seasons: r.value, load });
  return { season: loaded.seasons[0]!, site: loaded.first, seasons: loaded.seasons, deferred: loaded.deferred };
}
