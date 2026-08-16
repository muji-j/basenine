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
  parsePlayByPlay,
  venuesByGameId,
} from "@bb-app/parser";
import type { PlayEvent } from "@bb-app/parser";
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
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p, leaf);
    else if (e.name === leaf) yield p;
  }
}

/** 일정 페이지는 `schedule_08.html.gz`처럼 달마다 이름이 다르다 */
async function* walkSchedules(dir: string): AsyncGenerator<string> {
  for (const e of await readdir(dir, { withFileTypes: true })) {
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
  const spent = budget.players + budget.games + budget.batting + budget.pitching + budget.paEvents + budget.quarantine;
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
  let runsForCompleted: number[] = [];
  const runsQuarantine: QuarantineRow[] = [];
  if (!values["skip-events"]) {
    const pbpFile = file.replace(/box\.html\.gz$/, "playbyplay.html.gz");
    try {
      const pbpHtml = gunzipSync(await readFile(pbpFile)).toString("utf8");
      const pbp = parsePlayByPlay(pbpHtml);
      if (pbp.status === "played") {
        pbpEvents = pbp.events;
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

  played += 1;
  const quarantine: QuarantineRow[] = [];

  // ⚠경기 1건의 쓰기를 한 트랜잭션으로 묶는다. 개별 커밋은 느릴 뿐 아니라
  // 도중에 죽으면 **절반만 적재된 경기**를 남긴다.
  db.transaction(() => {
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

  for (const [side, team] of [["away", box.away], ["home", box.home]] as const) {
    for (const b of team.batters) {
      const derived = deriveBatting(meta.gameId, side, b);
      if (derived === null) continue;
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

  budget.quarantine += replaceQuarantine(db, meta.gameId, quarantine, nowIso);
  });

  for (const q of quarantine) quarantineKinds.set(q.kind, (quarantineKinds.get(q.kind) ?? 0) + 1);
}

budget.total =
  budget.players + budget.games + budget.batting + budget.pitching + budget.paEvents + budget.quarantine;

console.log(`성립 ${played}건 · 미성립 ${notPlayed}건 · 실패 ${failed}건`);
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
    `투구 ${budget.pitching} · 타석 ${budget.paEvents} · 격리 ${budget.quarantine}\n` +
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
