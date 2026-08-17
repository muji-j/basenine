/**
 * 아카이브 → 데이터베이스 적재.
 *
 *   node packages/store/tools/load-archive.ts data/archive data/bb.sqlite
 *
 * ⚠**쓰기 행 수를 보고한다.** D1 무료는 하루 10만 행에서 차단되므로,
 * 예산을 모르는 채 적재를 걸면 도중에 왜 멈췄는지 알 수 없다.
 */
import { readdir, readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { join } from "node:path";
import { parseArgs } from "node:util";
import {
  parseBoxScore,
  parseCompetitionLabel,
  parseLineScore,
  parseGameRoster,
  parsePlayByPlay,
  venuesByGameId,
} from "@bb-app/parser";
import type { PlayEvent, RunnerEvent } from "@bb-app/parser";
import { competitionFromLabel, competitionOf } from "@bb-app/domain";
import { openDb } from "../src/db.ts";
import { alignPaEvents } from "../src/align.ts";
import { deriveRuns } from "../src/runs.ts";
import { deriveBatting, derivePitching } from "../src/derive.ts";
import type { QuarantineRow } from "../src/derive.ts";
import {
  D1_DAILY_WRITE_LIMIT,
  emptyBudget,
  replacePaEvents,
  replaceRunnerEvents,
  replaceQuarantine,
  upsertBatting,
  upsertGame,
  upsertPitching,
  upsertPlayer,
} from "../src/load.ts";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    from: { type: "string" },
    to: { type: "string" },
    /** ⚠D1 무료는 하루 10만 행에서 **차단**된다. 넘길 것 같으면 멈추고 재개 지점을 알린다 */
    "max-writes": { type: "string", default: String(D1_DAILY_WRITE_LIMIT) },
    "skip-events": { type: "boolean", default: false },
  },
});
const [archiveRoot, dbPath] = positionals;
if (!archiveRoot || !dbPath) {
  console.error(
    "usage: node tools/load-archive.ts <archive-root> <db-path> [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--max-writes N] [--skip-events]",
  );
  process.exit(2);
}
const maxWrites = Number(values["max-writes"]);

// 시계는 1회만 읽어 전체 적재에 같은 값을 쓴다(M6).
const nowIso = new Date().toISOString();

/**
 * @param leaf 찾을 파일명. ⚠**기본값을 두지 않는다** — 예전에 `box.html.gz` 고정이었는데
 *   일정 페이지를 찾으려다 **0건이 조용히 돌아왔다.** 무엇을 찾는지 호출자가 매번 말한다.
 */
async function* walk(dir: string, leaf: string): AsyncGenerator<string> {
  for (const e of await sortedEntries(dir)) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p, leaf);
    else if (e.name === leaf) yield p;
  }
}

/**
 * **이름순으로 정렬해서 돌려준다.**
 *
 * ⚠**`readdir` 의 순서는 파일시스템이 정한다**(ext4 는 해시 순서다 — 이름순도 생성순도 아니다).
 * 그런데 쓰기 상한에 걸렸을 때 이 도구가 안내하는 재개 지점은 `--from {날짜}` 다
 * (2026-08-18 감사 P3). 순회가 날짜순이 아니면 **그 안내를 그대로 따랐을 때
 * 아직 안 읽은 경기를 건너뛴다** — 그리고 로그에는 아무것도 안 남는다.
 *
 * ⚠**경로가 `.../{시즌}/{MMDD}/{슬러그}/` 라서 이름순 = 날짜순이다.**
 * 그래서 각 층을 이름으로 정렬하는 것만으로 순회 전체가 시간순이 된다.
 * ⚠덤으로 **적재가 재현 가능해진다** — 같은 아카이브면 같은 순서로 읽는다.
 */
async function sortedEntries(dir: string): Promise<{ name: string; isDirectory(): boolean }[]> {
  const es = await readdir(dir, { withFileTypes: true });
  return es.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/** 일정 페이지는 `schedule_08.html.gz`처럼 달마다 이름이 다르다 */
async function* walkSchedules(dir: string): AsyncGenerator<string> {
  for (const e of await sortedEntries(dir)) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walkSchedules(p);
    else if (/^schedule_\d{2}\.html\.gz$/.test(e.name)) yield p;
  }
}

/**
 * `.../npb/scores/2026/0814/s-db-17/box.html.gz` → 경기 식별 정보
 *
 * ⚠**슬러그는 `{홈}-{원정}-{경기번호}` 순서다.** 직관과 반대라서 실제로 한 번 틀렸고,
 * 그 결과 전 선수의 소속 구단이 상대 팀으로 뒤집혔다.
 * 실측 근거: 박스스코어의 `tablefix_t_b`(先攻=원정)에 붙은 팀명이 **슬러그 두 번째**와
 * 일치한다 — 630경기 전건 확인(2026-08-15).
 */
function gameFromPath(file: string): {
  gameId: string;
  season: number;
  gameDate: string;
  awayCode: string;
  homeCode: string;
  gameNo: number;
} | null {
  const m = /scores[\\/](\d{4})[\\/](\d{2})(\d{2})[\\/]([^\\/]+)[\\/]box\.html\.gz$/.exec(file);
  if (!m) return null;
  const [, season, mm, dd, slug] = m;
  const parts = slug!.split("-");
  const gameNo = Number(parts.at(-1));
  if (parts.length < 3 || !Number.isFinite(gameNo)) return null;
  return {
    gameId: `${season}/${mm}${dd}/${slug}`,
    season: Number(season),
    gameDate: `${season}-${mm}-${dd}`,
    awayCode: parts.slice(1, -1).join("-"),
    homeCode: parts[0]!,
    gameNo,
  };
}

const db = openDb(dbPath, nowIso);
const budget = emptyBudget();
const seenPlayers = new Set<string>();
let played = 0;
let notPlayed = 0;
let failed = 0;
/**
 * ⚠**라인스코어만 못 읽은 경기.**
 *
 * 박스스코어는 멀쩡한데 라인스코어(R·H·E)만 파싱에 실패하면, 그 경기는 **적재는 되지만
 * 득점이 null이 된다.** 그러면 순위표(`standings.ts`)와 경기 페이지(`game.ts`)가
 * `away_runs IS NOT NULL` 조건으로 그 경기를 **조용히 빼 버린다** —
 * 팀의 경기 수가 하나 줄고 승패가 어긋나는데, 요약은 「성립」이라고 말한다.
 * 이 프로젝트가 가장 두려워하는 「조용한 죽음」의 전형이라 따로 센다.
 * (2026-08-16 이중 검토에서 지적.)
 */
let lineScoreFailed = 0;
const lineScoreFailedIds: string[] = [];
const quarantineKinds = new Map<string, number>();

let stoppedAt: string | null = null;

/**
 * 구장 조회표. **월간 일정 페이지**에서 만든다.
 *
 * ⚠경기 페이지(`index.html`)에는 다른 경기들의 스코어 박스가 함께 있어
 * 거기서 뽑으면 **남의 구장**을 집어 온다(실측 2026-08-15: 8/14 페이지에서
 * 8/15 경기의 구장이 먼저 잡혔다).
 * ⚠일정 페이지를 못 읽어도 적재를 멈추지 않는다 — 그 달의 구장만 비어 있게 된다.
 * **없는 것을 0이나 빈 문자열로 뭉개지 않는다**(M11).
 */
/**
 * 경기별 명단에서 읽은 **가장 최근**의 투타·배번.
 *
 * ⚠**투타의 권위 있는 출처는 선수 페이지다**(`#pc_bio`). 여기는 **닿지 않는 선수를 위한 보충**이다 —
 * 선수 페이지는 현재 등록 선수만 받으므로, 소급 시즌을 백필하면 NPB를 떠난 선수가 대거 들어온다.
 * 실측(2026-08-17): 투타 미상 122명 **전원**이 이 명단에 있고, 양쪽에 값이 있는 858명은
 * **858/858 일치**한다. 그래도 **덮어쓰지 않는다** — 출처가 둘이 되면 언젠가 갈린다(M1).
 *
 * ⚠**가장 최근 경기의 값을 쓴다.** 표기가 갈린 선수가 2명 있었고(스위치 전향 등),
 * 최근 값이 선수 페이지와 일치했다.
 */
const rosterLatest = new Map<string, { date: string; throws: string; bats: string; uniformNumber: string | null }>();
let rosterFiles = 0;
let rosterFailed = 0;

const venueByGameId = new Map<string, string>();
for await (const f of walkSchedules(archiveRoot)) {
  try {
    const html = gunzipSync(await readFile(f)).toString("utf8");
    for (const [gameId, venue] of venuesByGameId(html)) venueByGameId.set(gameId, venue);
  } catch (err) {
    console.error(`일정 페이지를 읽지 못했다(구장만 비게 된다): ${f} — ${err instanceof Error ? err.message : String(err)}`);
  }
}

for await (const file of walk(archiveRoot, "box.html.gz")) {
  const meta = gameFromPath(file);
  if (meta === null) {
    failed += 1;
    console.error(`경로에서 경기를 식별하지 못했다: ${file}`);
    continue;
  }

  if (values.from !== undefined && meta.gameDate < values.from) continue;
  if (values.to !== undefined && meta.gameDate > values.to) continue;

  // ⚠예산을 넘기기 **전에** 멈춘다. 넘긴 뒤에는 D1이 쿼리를 거부하므로 복구가 번거롭다.
  // ⚠**주자 사건도 쓰기다.** 합계에서 빼면 한도를 조용히 넘긴다
  const spent = budget.players + budget.games + budget.batting + budget.pitching
    + budget.paEvents + budget.runnerEvents + budget.quarantine;
  if (spent >= maxWrites) {
    stoppedAt = meta.gameDate;
    break;
  }

  let box;
  let boxHtml: string;
  try {
    boxHtml = gunzipSync(await readFile(file)).toString("utf8");
    box = parseBoxScore(boxHtml);
  } catch (err) {
    failed += 1;
    console.error(`PARSE ERROR ${meta.gameId} — ${err instanceof Error ? err.message : String(err)}`);
    continue;
  }

  const sourceUrl = `https://npb.jp/scores/${meta.season}/${meta.gameId.split("/")[1]}/${meta.gameId.split("/")[2]}/box.html`;

  /**
   * 경기구분.
   *
   * ⚠**표기로 판정한다.** 팀 코드로는 CS·일본시리즈를 구별할 수 없다 —
   * 같은 구단 코드를 쓰기 때문이다. 실측(2026-08-16): 표기를 안 보던 동안
   * 2025년 CS 13경기와 일본시리즈 5경기가 「정규시즌」에 들어와 있었다.
   * ⚠올스타는 팀 코드로도 판정되므로 **둘을 대조**한다. 어긋나면 규칙이 틀린 것이니 던진다.
   */
  const series = parseCompetitionLabel(boxHtml);
  let competition: string;
  try {
    if (series === null) {
      throw new RangeError("대회 표기(【…】)를 찾지 못했다 — 페이지 구조 변경을 의심하라");
    }
    competition = competitionFromLabel(series);
    const byCode = competitionOf(meta.awayCode, meta.homeCode);
    // 팀 코드로 판정되는 것은 올스타뿐이다. 그 하나가 어긋나면 둘 중 하나가 틀렸다
    if (byCode === "allStar" !== (competition === "allStar")) {
      throw new RangeError(`구분이 표기(${series}→${competition})와 팀 코드(${byCode})에서 다르다`);
    }
  } catch (err) {
    failed += 1;
    console.error(`구분 판정 실패 ${meta.gameId} — ${err instanceof Error ? err.message : String(err)}`);
    continue;
  }

  const venue = venueByGameId.get(meta.gameId) ?? null;

  if (box.status === "notPlayed") {
    notPlayed += 1;
    budget.games += db.transaction(() => {
      const n = upsertGame(db, {
        ...meta,
        status: "notPlayed",
        notPlayedReason: box.reason,
        competition,
        series,
        sourceUrl,
        fetchedAt: nowIso,
        // ⚠중지 경기에 결과는 없다. **0-0이 아니라 「없음」**이다(M11)
        venue,
      });
      /**
       * ⚠**성립하지 않은 경기의 기록을 지운다.**
       *
       * 재적재가 멱등이려면(M5) 「전에 실시로 들어왔다가 지금 미성립으로 바뀐」 경우에
       * 이전 행이 남아 있으면 안 된다. 실제로 일어났다 — ノーゲーム 판정을 고치기 전에
       * 3경기가 실시로 적재돼 있었고, 그 기록이 시즌 성적에 섞여 있었다.
       * 상태만 바꾸고 자식 행을 두면 **화면은 「미성립」인데 성적에는 남는다.**
       */
      db.raw.prepare("DELETE FROM pa_event WHERE game_id = ?").run(meta.gameId);
      db.raw.prepare("DELETE FROM batting_line WHERE game_id = ?").run(meta.gameId);
      db.raw.prepare("DELETE FROM pitching_line WHERE game_id = ?").run(meta.gameId);
      db.raw.prepare("DELETE FROM quarantine WHERE game_id = ?").run(meta.gameId);
      return n;
    });
    continue;
  }

  /**
   * 경기 결과(R·H·E). 라인스코어에서 온다.
   *
   * ⚠**팀 승패를 투수의 `decision`으로 세지 마라.** 그건 개인 기록이라 무승부에서
   * 아무에게도 안 붙는다(실측: 632경기에 승 620·패 620 — 12경기가 무승부).
   * ⚠읽지 못하면 **넣지 않는다.** 0으로 채우면 0-0 무승부가 만들어진다.
   */
  let result: {
    awayRuns: number | null; homeRuns: number | null;
    awayHits: number | null; homeHits: number | null;
    awayErrors: number | null; homeErrors: number | null;
  } = {
    awayRuns: null, homeRuns: null, awayHits: null, homeHits: null,
    awayErrors: null, homeErrors: null,
  };
  try {
    const ls = parseLineScore(gunzipSync(await readFile(file)).toString("utf8"));
    result = {
      awayRuns: ls.awayTotal, homeRuns: ls.homeTotal,
      awayHits: ls.awayHits, homeHits: ls.homeHits,
      awayErrors: ls.awayErrors, homeErrors: ls.homeErrors,
    };
  } catch (err) {
    // ⚠**실패를 세지 않으면 아무도 모른다.** 이 경기는 적재되지만 득점이 없고,
    // 순위표와 경기 페이지에서 조용히 빠진다
    lineScoreFailed += 1;
    lineScoreFailedIds.push(meta.gameId);
    console.error(`라인스코어 ERROR ${meta.gameId} — ${err instanceof Error ? err.message : String(err)}`);
  }

  // 타석 이벤트의 재료를 **쓰기 전에** 읽어둔다. 트랜잭션 안에서 파일을 기다리지 않게 한다.
  let pbpEvents: PlayEvent[] | null = null;
  /** 주자 사건. ⚠**미성립 경기에는 아예 오지 않는다** — 파서가 `notPlayed` 를 돌려주기 때문이다 */
  let pbpRunners: RunnerEvent[] = [];
  /** 읽지 못한 주자 행. ⚠**파서가 던지지 않으므로 여기서 세지 않으면 조용한 실패가 된다**(M7) */
  let pbpUnreadRunners: string[] = [];
  let runsForCompleted: number[] = [];
  const runsQuarantine: QuarantineRow[] = [];
  if (!values["skip-events"]) {
    const pbpFile = file.replace(/box\.html\.gz$/, "playbyplay.html.gz");
    try {
      const pbpHtml = gunzipSync(await readFile(pbpFile)).toString("utf8");
      const pbp = parsePlayByPlay(pbpHtml);
      if (pbp.status === "played") {
        pbpEvents = pbp.events;
        pbpRunners = pbp.runners;
        pbpUnreadRunners = pbp.unreadRunners;
        // 타석별 득점을 유도하고 라인스코어로 검증한다.
        const derived = deriveRuns(meta.gameId, pbp.events.filter((e) => e.completed), parseLineScore(pbpHtml));
        runsForCompleted = derived.runsPerEvent;
        runsQuarantine.push(...derived.quarantine);
      }
    } catch (err) {
      failed += 1;
      console.error(`PBP ERROR ${meta.gameId} — ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * 명단(`roster.html`). ⚠**적재를 멈추지 않는다** — 이건 보충이지 본체가 아니다.
   * 실패하면 세어서 마지막에 보고한다(0이 아닌 값이 나오면 마크업이 바뀐 것이다).
   */
  {
    const rosterFile = file.replace(/box\.html\.gz$/, "roster.html.gz");
    try {
      const html = gunzipSync(await readFile(rosterFile)).toString("utf8");
      rosterFiles += 1;
      for (const e of parseGameRoster(html)) {
        const prev = rosterLatest.get(e.playerId);
        if (prev === undefined || prev.date <= meta.gameDate) {
          rosterLatest.set(e.playerId, {
            date: meta.gameDate, throws: e.throws, bats: e.bats, uniformNumber: e.uniformNumber,
          });
        }
      }
    } catch (err) {
      rosterFailed += 1;
      if (rosterFailed <= 3) {
        console.error(`ROSTER ERROR ${meta.gameId} — ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  played += 1;
  const quarantine: QuarantineRow[] = [];

  // ⚠경기 1건의 쓰기를 한 트랜잭션으로 묶는다. 개별 커밋은 느릴 뿐 아니라
  // 도중에 죽으면 **절반만 적재된 경기**를 남긴다.
  db.transaction(() => {
  /**
   * ⚠**재적재가 「줄어드는 방향」으로는 멱등이 아니었다**(M5 · 2026-08-18 감사 P2).
   * `upsertBatting`/`upsertPitching` 은 `(game_id, player_id)` 충돌 시 **갱신**만 한다 —
   * 즉 **이번에 안 나온 선수의 행은 영원히 남는다.** 미성립 경기 경로에는 이 삭제가
   * 이미 있었는데(위 254~257행) 실시 경로에는 없었다.
   *
   * ⚠**이건 「언젠가 생길 수 있는 문제」가 아니다.** 이 리포는 파서를 계속 고치고 있고
   * (規則違反アウト · 구형 박스 · 주자 행), 적재는 **아카이브 전체를 매번 다시 훑는다.**
   * 잘못 뽑힌 선수 행이 한 번 들어가면 파서를 고쳐도 **유령 행이 영구히 성적에 남는다.**
   * ⚠**pa_event 는 여기서 지우지 않는다** — 아래 자기 트랜잭션에서 삭제 후 삽입한다.
   */
  db.raw.prepare("DELETE FROM batting_line WHERE game_id = ?").run(meta.gameId);
  db.raw.prepare("DELETE FROM pitching_line WHERE game_id = ?").run(meta.gameId);

  budget.games += upsertGame(db, {
    ...meta,
    status: "played",
    notPlayedReason: null,
    competition,
    series,
    sourceUrl,
    fetchedAt: nowIso,
    ...result,
    venue,
  });

  /**
   * 박스가 말하는 **선수별** 도루 수. 아래에서 타석 로그와 대조한다.
   * ⚠**경기 합계로 비교하지 않는다** — A선수 +1 / B선수 −1이면 합계는 맞는데
   * 지키려는 불변식(한 선수의 블록 안에서 `盗塁`과 성공률 분모가 모순되지 않는다)은 깨진다.
   */
  const boxStealsBy = new Map<string, number>();
  for (const [side, team] of [["away", box.away], ["home", box.home]] as const) {
    for (const b of team.batters) {
      const derived = deriveBatting(meta.gameId, side, b);
      if (derived === null) continue;
      if (derived.row.sb > 0) {
        boxStealsBy.set(derived.row.playerId, (boxStealsBy.get(derived.row.playerId) ?? 0) + derived.row.sb);
      }
      if (!seenPlayers.has(derived.row.playerId)) {
        seenPlayers.add(derived.row.playerId);
        budget.players += upsertPlayer(db, derived.row.playerId, b.name, nowIso);
      }
      budget.batting += upsertBatting(db, derived.row);
      quarantine.push(...derived.quarantine);
    }
    for (const p of team.pitchers) {
      const derived = derivePitching(meta.gameId, side, p);
      if (derived === null) continue;
      quarantine.push(...derived.quarantine);
      // ⚠**읽지 못한 등판은 넣지 않는다.** 0으로 넣으면 그 등판이 사라진 채
      // 방어율만 부풀어 오른다 — 격리에 남았으므로 화면이 말해 준다
      if (derived.row === null) continue;
      const row = derived.row;
      if (!seenPlayers.has(row.playerId)) {
        seenPlayers.add(row.playerId);
        budget.players += upsertPlayer(db, row.playerId, p.name, nowIso);
      }
      budget.pitching += upsertPitching(db, row);
    }
  }

  // 타석 이벤트: playbyplay의 문맥에 박스의 **검증된** 결과를 붙인다.
  if (pbpEvents !== null) {
    const aligned = alignPaEvents(meta.gameId, box, pbpEvents, runsForCompleted);
    budget.paEvents += replacePaEvents(db, meta.gameId, aligned.events);
    quarantine.push(...aligned.quarantine, ...runsQuarantine);
  }

  /**
   * 주자 사건. ⚠**타석과 별개의 표다** — 타자가 없으므로 `pa_event` 에 넣으면 타석 수가 부풀어
   * 타율의 분모가 틀린다.
   *
   * ⚠**`pbpEvents === null` 일 때는 손대지 않는다.** `replaceRunnerEvents` 는 첫 줄이
   * `DELETE` 라, 빈 배열로 부르면 **이미 있던 도루 기록을 지운다.** 그리고 `pbpRunners` 는
   * ① `--skip-events` ② playbyplay 파싱 실패 ③ 미성립 경기 셋 다 `[]` 다 —
   * 「없었다」가 아니라 **「세지 못했다」**인데 지우면 그 구별이 사라진다(M11·M5).
   * ①은 문서화된 플래그이고 **종료 코드 0**이라 조용히 지운다.
   * `pa_event` 는 원래부터 이 보호가 있었다 — 두 표의 취급이 갈려 있던 것이 결함이다.
   */
  if (pbpEvents !== null) {
    budget.runnerEvents += replaceRunnerEvents(
      db,
      meta.gameId,
      pbpRunners.map((r, i) => ({ ...r, gameId: meta.gameId, seq: i + 1 })),
    );
  }

  /**
   * ⚠**박스의 `盗塁` 합계와 타석 로그의 도루 수를 대조한다.**
   *
   * 화면은 개수를 박스에서, 성공률의 분모를 타석 로그에서 가져온다. 둘이 어긋나면
   * 같은 블록에 **「盗塁 30」과 「28을 함축하는 성공률」이 나란히** 뜬다 —
   * 값 자체보다 나쁜 자기모순이다. 그러니 **읽는 쪽에서 폴백으로 덮지 말고 여기서 잡는다.**
   *
   * ⚠**pbp를 읽지 못한 경기는 비교하지 않는다.** 그건 「도루가 0이었다」가 아니라
   * 「세지 못했다」이고, 0으로 비교하면 그 경기 전부가 어긋남으로 잡힌다(M11).
   * 같은 이유로 `--skip-events` 일 때도 비교하지 않는다.
   *
   * 실측(2026-08-17): 2024〜2026 **2,395경기 중 어긋남 0건**이라 임계값 0으로 걸 수 있다.
   */
  /**
   * ⚠**읽지 못한 주자 행을 격리에 넣는다.** 파서는 던지지 않는다 —
   * 던지면 도루 표기 1건의 변화가 **그 경기의 타석 로그 전량**을 가져가기 때문이다.
   * 그 대신 「멈춘다」를 여기서 한다: 쌓이면 収集ログ에 종류별로 뜬다.
   */
  for (const raw of pbpUnreadRunners) {
    quarantine.push({ kind: "unreadRunner", gameId: meta.gameId, playerId: null, raw, detail: null });
  }

  if (pbpEvents !== null) {
    const logStealsBy = new Map<string, number>();
    for (const r of pbpRunners) {
      if (r.kind !== "steal") continue;
      logStealsBy.set(r.runnerId, (logStealsBy.get(r.runnerId) ?? 0) + 1);
    }
    // 양쪽 어디에라도 나온 선수를 전부 본다 — 한쪽에만 있는 것이 바로 어긋남이다
    for (const playerId of new Set([...boxStealsBy.keys(), ...logStealsBy.keys()])) {
      const box = boxStealsBy.get(playerId) ?? 0;
      const log = logStealsBy.get(playerId) ?? 0;
      if (box === log) continue;
      quarantine.push({
        kind: "stealMismatch",
        gameId: meta.gameId,
        playerId,
        raw: String(box),
        detail: `타석 로그 ${log}`,
      });
    }
  }

  budget.quarantine += replaceQuarantine(db, meta.gameId, quarantine, nowIso);
  });

  for (const q of quarantine) quarantineKinds.set(q.kind, (quarantineKinds.get(q.kind) ?? 0) + 1);
}

/**
 * ⚠**빈 자리만 채운다.** `WHERE throws IS NULL` 이 그 계약이고, 그래서 선수 페이지가
 * 언제나 이깁니다 — 출처가 둘이 되면 어느 날 갈린다(M1).
 * 배번도 같다: 페이지는 **현재** 번호, 명단은 **그 경기 시점**의 번호다.
 * 실측 782명 중 10명이 어긋났고 전부 실제 변경이었다(育成 `122` → 支配下 `64` 등).
 */
let filledHand = 0;
let filledNumber = 0;
if (rosterLatest.size > 0) {
  const hand = db.raw.prepare(
    "UPDATE player SET throws = ?, bats = ? WHERE player_id = ? AND (throws IS NULL OR bats IS NULL)",
  );
  const num = db.raw.prepare(
    "UPDATE player SET uniform_number = ? WHERE player_id = ? AND uniform_number IS NULL",
  );
  db.transaction(() => {
    for (const [playerId, r] of rosterLatest) {
      hand.run(r.throws, r.bats, playerId);
      filledHand += (db.raw.prepare("SELECT changes() AS n").get() as { n: number }).n;
      if (r.uniformNumber !== null) {
        num.run(r.uniformNumber, playerId);
        filledNumber += (db.raw.prepare("SELECT changes() AS n").get() as { n: number }).n;
      }
    }
  });
}

budget.total =
  budget.players + budget.games + budget.batting + budget.pitching
  + budget.paEvents + budget.runnerEvents + budget.quarantine;

console.log(`성립 ${played}건 · 미성립 ${notPlayed}건 · 실패 ${failed}건`);
// ⚠**분모를 같이 낸다.** 「보충 122명」만 내면 그것이 전부인지 일부인지 모른다
console.log(
  `명단 ${rosterFiles}장(실패 ${rosterFailed}) · 선수 ${rosterLatest.size}명 · ` +
    `투타 보충 ${filledHand}명 · 배번 보충 ${filledNumber}명`,
);
if (lineScoreFailed > 0) {
  // ⚠**「성립」 안에 숨어 있던 부분 실패를 드러낸다.** 이 경기들은 득점이 없어
  // 순위표·경기 페이지에서 빠진다 — 요약만 보면 정상으로 보인다
  console.log(
    `⚠ 라인스코어를 못 읽은 경기 ${lineScoreFailed}건 — 득점·안타·실책이 없어 순위표와 경기 화면에서 빠진다`,
  );
  for (const id of lineScoreFailedIds.slice(0, 20)) console.log(`   ${id}`);
}
console.log(
  `\n=== 쓰기 예산 (D1 무료 한도 ${D1_DAILY_WRITE_LIMIT.toLocaleString()}행/일) ===\n` +
    `선수 ${budget.players} · 경기 ${budget.games} · 타격 ${budget.batting} · ` +
    `투구 ${budget.pitching} · 타석 ${budget.paEvents} · 주자 ${budget.runnerEvents} · ` +
    `격리 ${budget.quarantine}\n` +
    `합계 ${budget.total}행 = 한도의 ${((budget.total / D1_DAILY_WRITE_LIMIT) * 100).toFixed(1)}%`,
);

if (stoppedAt !== null) {
  console.log(
    `\n⚠쓰기 예산 상한(${maxWrites.toLocaleString()}행)에 도달해 **${stoppedAt} 앞에서 멈췄다.**\n` +
      `   내일 이어서: --from ${stoppedAt}`,
  );
}

console.log(`\n=== 격리 (${[...quarantineKinds.values()].reduce((a, b) => a + b, 0)}건) ===`);
if (quarantineKinds.size === 0) console.log("없음");
for (const [kind, n] of quarantineKinds) console.log(`${String(n).padStart(6)}  ${kind}`);

db.close();
// ⚠**부분 실패도 실패다.** 조용히 0으로 끝내면 크론이 「성공」으로 보고하고,
// 그 사이 순위표에서 경기가 사라진 채로 배포된다
process.exitCode = failed > 0 || lineScoreFailed > 0 ? 1 : 0;
