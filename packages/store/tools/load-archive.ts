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
import { parseBoxScore } from "@bb-app/parser";
import { competitionOf } from "@bb-app/domain";
import { openDb } from "../src/db.ts";
import { deriveBatting, derivePitching } from "../src/derive.ts";
import type { QuarantineRow } from "../src/derive.ts";
import { emptyBudget, replaceQuarantine, upsertBatting, upsertGame, upsertPitching, upsertPlayer } from "../src/load.ts";

const [archiveRoot, dbPath] = process.argv.slice(2);
if (!archiveRoot || !dbPath) {
  console.error("usage: node tools/load-archive.ts <archive-root> <db-path>");
  process.exit(2);
}

// 시계는 1회만 읽어 전체 적재에 같은 값을 쓴다(M6).
const nowIso = new Date().toISOString();

async function* walk(dir: string): AsyncGenerator<string> {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.name === "box.html.gz") yield p;
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
const quarantineKinds = new Map<string, number>();

for await (const file of walk(archiveRoot)) {
  const meta = gameFromPath(file);
  if (meta === null) {
    failed += 1;
    console.error(`경로에서 경기를 식별하지 못했다: ${file}`);
    continue;
  }

  let box;
  try {
    box = parseBoxScore(gunzipSync(await readFile(file)).toString("utf8"));
  } catch (err) {
    failed += 1;
    console.error(`PARSE ERROR ${meta.gameId} — ${err instanceof Error ? err.message : String(err)}`);
    continue;
  }

  const sourceUrl = `https://npb.jp/scores/${meta.season}/${meta.gameId.split("/")[1]}/${meta.gameId.split("/")[2]}/box.html`;

  // ⚠경기구분을 팀 코드로 판정한다. 올스타전(`cl`/`pl`)을 정규시즌에 섞으면
  // 선수 성적이 조용히 부풀어 오른다 — 실제로 佐藤의 시즌 홈런이 2개 많았다.
  let competition: string;
  try {
    competition = competitionOf(meta.awayCode, meta.homeCode);
  } catch (err) {
    failed += 1;
    console.error(`구분 판정 실패 ${meta.gameId} — ${err instanceof Error ? err.message : String(err)}`);
    continue;
  }

  if (box.status === "notPlayed") {
    notPlayed += 1;
    budget.games += upsertGame(db, {
      ...meta,
      status: "notPlayed",
      notPlayedReason: box.reason,
      competition,
      sourceUrl,
      fetchedAt: nowIso,
    });
    continue;
  }

  played += 1;
  budget.games += upsertGame(db, {
    ...meta,
    status: "played",
    notPlayedReason: null,
    competition,
    sourceUrl,
    fetchedAt: nowIso,
  });

  const quarantine: QuarantineRow[] = [];

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
      const row = derivePitching(meta.gameId, side, p);
      if (row === null) continue;
      if (!seenPlayers.has(row.playerId)) {
        seenPlayers.add(row.playerId);
        budget.players += upsertPlayer(db, row.playerId, p.name, nowIso);
      }
      budget.pitching += upsertPitching(db, row);
    }
  }

  budget.quarantine += replaceQuarantine(db, meta.gameId, quarantine, nowIso);
  for (const q of quarantine) quarantineKinds.set(q.kind, (quarantineKinds.get(q.kind) ?? 0) + 1);
}

budget.total = budget.players + budget.games + budget.batting + budget.pitching + budget.quarantine;

console.log(`성립 ${played}건 · 미성립 ${notPlayed}건 · 실패 ${failed}건`);
console.log(
  `\n=== 쓰기 예산 (D1 무료 한도 100,000행/일) ===\n` +
    `선수 ${budget.players} · 경기 ${budget.games} · 타격 ${budget.batting} · ` +
    `투구 ${budget.pitching} · 격리 ${budget.quarantine}\n` +
    `합계 ${budget.total}행 = 한도의 ${((budget.total / 100_000) * 100).toFixed(1)}%`,
);

console.log(`\n=== 격리 (${[...quarantineKinds.values()].reduce((a, b) => a + b, 0)}건) ===`);
if (quarantineKinds.size === 0) console.log("없음");
for (const [kind, n] of quarantineKinds) console.log(`${String(n).padStart(6)}  ${kind}`);

db.close();
process.exitCode = failed > 0 ? 1 : 0;
