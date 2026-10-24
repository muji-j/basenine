/**
 * 포스트시즌 화면 시험의 DB 픽스처 — 설계 `docs/superpowers/specs/2026-10-24-postseason-display-design.md` §6.
 *
 * ⚠**이미 있는 입구만 쓴다**(`openDb`·`upsert*`·`loadSite`·`buildSite`). 시험이 아직 없는 함수를 부르면
 * 고치기 전 코드에서 **ERROR**(돌지도 않음)가 되어 RED 로 칠 수 없다 — 그래서 단언은 **화면 산출물**로 한다(설계 §6).
 * ⚠**외부 요청 0** — 마이그레이션을 적용한 임시 DB 에 행을 넣고 잰다.
 * ⚠**시계를 읽지 않는다**(M6) — 생성일·취득 시각은 전부 인자다.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  collectionEvidence,
  openDb,
  upsertBatting,
  upsertGame,
  upsertPitching,
  upsertPlayer,
  upsertProbablePitcher,
} from "@bb-app/store";
import type { Db } from "@bb-app/store";
import { loadSite } from "../src/query.ts";
import type { SiteData } from "../src/query.ts";
import { buildSite, seasonPaths } from "../src/site.ts";
import { collectionStatus } from "../src/layout.ts";
import type { CollectionStatus } from "../src/layout.ts";

/** 픽스처 시각. ⚠취득 시각은 시험이 따로 준다 — 이 값은 「적재 시각」 자리에만 쓴다 */
export const NOW = "2026-10-24T00:00:00.000Z";

export const CODES = ["g", "t", "db", "c", "d", "s", "h", "f", "m", "l", "e", "b"] as const;
/** ⚠**숫자로 시작해야 한다** — `compareShardOf` 가 ID 첫 글자로 샤드를 고른다(build-gates.test.ts 와 같은 이유) */
export const batId = (code: string): string => String(9_100_000 + CODES.indexOf(code as (typeof CODES)[number]) * 10 + 1);
export const pitId = (code: string): string => String(9_100_000 + CODES.indexOf(code as (typeof CODES)[number]) * 10 + 2);

export type Competition = "regular" | "climaxSeries" | "nipponSeries" | "allStar";

export interface GameSpec {
  date: string;
  home: string;
  away: string;
  competition?: Competition;
  /** 대회 표기 원문(`game.series`). 정규는 기본 `セ・リーグ公式戦` 꼴 */
  series?: string | null;
  /** npb.jp 슬러그의 번호 — 「第N戦」의 N 이다 */
  gameNo?: number;
  status?: "played" | "notPlayed";
  reason?: string | null;
  homeRuns?: number | null;
  awayRuns?: number | null;
  venue?: string;
  /** 같은 날 같은 카드가 둘일 때 ID 를 가른다(더블헤더 시험) */
  idSuffix?: string;
  /** 선수 줄을 넣는가. 기본 넣는다(정규·포스트시즌 모두) — 구단·리그 번들이 비지 않게 */
  lines?: boolean;
}

/** 시즌 하나를 짓는 임시 DB */
export class Fixture {
  readonly db: Db;
  private readonly dir: string;

  constructor() {
    this.dir = mkdtempSync(join(tmpdir(), "bb-postseason-"));
    this.db = openDb(join(this.dir, "t.sqlite"), NOW);
    for (const c of CODES) {
      upsertPlayer(this.db, batId(c), `${c}打者`, NOW);
      upsertPlayer(this.db, pitId(c), `${c}投手`, NOW);
    }
  }

  close(): void {
    this.db.close();
    rmSync(this.dir, { recursive: true, force: true });
  }

  /** 행을 한 트랜잭션으로 넣는다 — 자동 커밋이면 143일 시즌 시드가 1초를 넘는다(실측 1,385ms → 88ms) */
  batch(fn: () => void): void {
    this.db.raw.exec("BEGIN");
    try {
      fn();
      this.db.raw.exec("COMMIT");
    } catch (err) {
      this.db.raw.exec("ROLLBACK");
      throw err;
    }
  }

  /** 경기 한 개. ID 는 실물 슬러그 모양(`2026/1017/t-db-04`)이다 */
  game(g: GameSpec): string {
    const season = Number(g.date.slice(0, 4));
    const mmdd = g.date.slice(5, 7) + g.date.slice(8, 10);
    const no = g.gameNo ?? 1;
    const gameId = `${season}/${mmdd}/${g.home}-${g.away}-${String(no).padStart(2, "0")}${g.idSuffix ?? ""}`;
    const competition = g.competition ?? "regular";
    const played = (g.status ?? "played") === "played";
    upsertGame(this.db, {
      gameId,
      season,
      gameDate: g.date,
      awayCode: g.away,
      homeCode: g.home,
      gameNo: no,
      status: played ? "played" : "notPlayed",
      notPlayedReason: played ? null : (g.reason ?? "中止"),
      competition,
      series: g.series === undefined ? (competition === "regular" ? "セ・リーグ公式戦" : null) : g.series,
      sourceUrl: "https://npb.jp/x",
      fetchedAt: NOW,
      awayRuns: played ? (g.awayRuns === undefined ? 1 : g.awayRuns) : null,
      homeRuns: played ? (g.homeRuns === undefined ? 2 : g.homeRuns) : null,
      awayHits: played ? 6 : null,
      homeHits: played ? 8 : null,
      awayErrors: played ? 0 : null,
      homeErrors: played ? 1 : null,
      venue: g.venue ?? "甲子園",
    });
    if (played && g.lines !== false && competition !== "allStar") {
      upsertBatting(this.db, {
        gameId, playerId: batId(g.home), side: "home", battingOrder: "1", position: "(遊)",
        pa: 4, ab: 4, h: 1, d2: 0, d3: 0, hr: 0, bb: 0, ibb: 0, hbp: 0,
        sf: 0, sh: 0, so: 1, roe: 0, runs: 0, rbi: 0, sb: 0,
      });
      upsertPitching(this.db, {
        gameId, playerId: pitId(g.away), side: "away", decision: null,
        outs: 21, bf: 28, pitches: 90, h: 5, hr: 0, bb: 2, hbp: 0, so: 7, runs: 1, er: 1, wp: 0, balk: 0,
      });
    }
    return gameId;
  }

  /** 予告先発 두 행(양 팀). ⚠취득 시각은 **아카이브 사이드카의 시각**이다 — 모르면 null */
  probable(date: string, home: string, away: string, fetchedAt: string | null, awayFetchedAt: string | null = fetchedAt): void {
    for (const [me, you, at] of [[home, away, fetchedAt], [away, home, awayFetchedAt]] as const) {
      upsertProbablePitcher(this.db, {
        gameDate: date, teamCode: me, opponentCode: you, playerId: pitId(me),
        sourceName: `${me}投手`, venue: "甲子園", startTime: "18:00",
        league: "central", sourceUrl: "https://npb.jp/announcement/starter/", fetchedAt: at,
      });
    }
  }

  /** 予告先発 페이지의 「試合が予定されていません」 — 그 페이지를 받은 날·제목의 날짜·취득 시각 */
  rest(fetchedDate: string, gameDate: string, fetchedAt: string | null): void {
    this.db.raw
      .prepare("INSERT INTO starters_fetch (fetched_date, game_date, no_games, source_url, fetched_at) VALUES (?, ?, 1, 'x', ?)")
      .run(fetchedDate, gameDate, fetchedAt);
  }

  /** 앞으로의 경기(월간 일정). `seq` 는 그 날 표의 행 순서다 */
  upcoming(date: string, home: string, away: string, o: { seq?: number; venue?: string; startTime?: string | null } = {}): void {
    this.db.raw
      .prepare(
        `INSERT INTO upcoming_game (season, game_date, home_code, away_code, seq, venue, start_time, source, fetched_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'https://npb.jp/games/', ?)`,
      )
      .run(Number(date.slice(0, 4)), date, home, away, o.seq ?? 0, o.venue ?? "横浜", o.startTime === undefined ? "18:30" : o.startTime, NOW);
  }

  load(season: number, builtOn: string): SiteData {
    return loadSite(this.db, { season, builtOn });
  }

  /** 빌드와 같은 사이트 전체 수집 판정(`tools/build.ts` 와 같은 식) */
  collection(builtOn: string): CollectionStatus {
    return collectionStatus(collectionEvidence(this.db, builtOn));
  }
}

/** 날짜에 n 일을 더한다(UTC 달력 · 시계를 읽지 않는다) */
export function plusDays(iso: string, n: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

/** 짝 지은 12구단 — 같은 리그끼리 6쌍 */
export const PAIRS: readonly (readonly [string, string])[] = [
  ["t", "g"], ["db", "c"], ["s", "d"], ["h", "f"], ["l", "m"], ["b", "e"],
];

/**
 * **정규시즌을 짓는다** — 6쌍이 `days` 일 동안 하루 한 경기씩(홈을 번갈아).
 * ⚠`days` 를 규정 수(143)로 주면 12구단 전원이 정규를 소진한다(설계 D7 ⑴).
 * ⚠`skip` 에 든 구단은 마지막 날 경기를 치르지 않는다 — 「11/12 구단만 소진」(T9 ⑷)
 */
export function regularSeason(fx: Fixture, o: { first: string; days: number; skipLast?: readonly string[] }): string {
  let last = o.first;
  for (let i = 0; i < o.days; i += 1) {
    const date = plusDays(o.first, i);
    last = date;
    for (const [a, b] of PAIRS) {
      if (i === o.days - 1 && (o.skipLast ?? []).some((c) => c === a || c === b)) continue;
      const [home, away] = i % 2 === 0 ? [a, b] : [b, a];
      fx.game({ date, home, away, gameNo: Math.floor(i / 2) + 1, series: leagueSeries(home), idSuffix: `-r${i}` });
    }
  }
  return last;
}

function leagueSeries(code: string): string {
  return ["g", "t", "db", "c", "d", "s"].includes(code) ? "セ・リーグ公式戦" : "パ・リーグ公式戦";
}

/** 한 시즌의 산출물 — 경로 → 본문 */
export function build(
  sites: readonly { data: SiteData; season: number }[],
  builtOn: string,
  collection?: CollectionStatus,
): Map<string, string> {
  const current = sites[0]!.season;
  // ⚠수집 로그 화면은 굽지 않는다(`buildSite` 에 log 를 안 넘긴다) — 경로 목록도 그것과 맞춘다
  const plans = sites.map((s) => ({
    season: s.season,
    prefix: s.season === current ? "" : `${s.season}/`,
    paths: seasonPaths(s.data, false),
  }));
  const out = new Map<string, string>();
  for (const s of sites) {
    const r = buildSite(s.data, { name: "BaseNine", contact: "x@example.invalid" }, builtOn, undefined, plans, collection);
    for (const f of r.files) out.set(f.path, f.content);
  }
  return out;
}

/** HTML 에서 태그를 지운 글자 — 문구 단언용(공백은 하나로 접는다) */
export function text(html: string): string {
  return html.replace(/<[^>]*>/g, "").replace(/\s+/g, " ");
}

/** 그 구획(`id="…"`)의 본문만 잘라 낸다 — 다른 구획의 같은 말에 시험이 속지 않게 */
export function section(html: string, id: string): string {
  const at = html.indexOf(`id="${id}"`);
  if (at < 0) return "";
  const end = html.indexOf("</section>", at);
  return html.slice(at, end < 0 ? undefined : end);
}
