/**
 * **표시명 드리프트 측정** — 「그 시즌의 박스가 쓴 이름」과 지금 화면에 나가는 이름이 얼마나 다른가.
 *
 *   node scripts/name-drift-measure.ts [data/bb.sqlite] [data/archive]
 *
 * ## 왜 이 스크립트가 있는가
 *
 * ⚠**표시명이 「아카이브 최초 등장 경기」의 이름으로 영구 고정돼 있었다**(2026-08-21 감사 확정 P1).
 * `load-archive.ts` 가 `seenPlayers` 로 첫 접촉에만 `upsertPlayer` 를 부르는데
 * 순회가 **날짜 오름차순**이라 첫 접촉 = 가장 오래된 경기다.
 *
 * ⚠**「최신이 이긴다」로 고치면 오히려 나빠진다.** NPB 박스 표기는 「신·구 등록명」이 아니라
 * **그 시점의 로스터 식별 표기**라 방향이 양쪽이다(`松井雅→松井` · `山田哲→山田`).
 * 그래서 이 스크립트는 **세 가지를 나란히** 낸다 — 지금 / 최종으로 통일 / 최초로 통일.
 * 셋 다 「그 시즌의 이름」을 정본으로 놓고 몇 쌍이 틀리는지를 센다.
 *
 * ⚠**이 수가 회귀 기준이다.** 시즌 스코프 표시명을 배선하면 `player_season_name` 열이 0 이 되어야 한다.
 * ⚠**「0건」과 「안 쟀음」을 구별한다** — 아카이브에 박스가 없는 경기는 분모에서 빠지고, 그 수를 함께 낸다.
 */
import { gunzipSync } from "node:zlib";
import { existsSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { parseBoxScore } from "@bb-app/parser";

const [dbPath = "data/bb.sqlite", archiveRoot = "data/archive"] = process.argv.slice(2);
if (!existsSync(dbPath)) {
  console.error(`DB 가 없다: ${dbPath}`);
  process.exit(2);
}

const db = new DatabaseSync(dbPath, { readOnly: true });
const games = db
  .prepare("SELECT game_id AS id, season FROM game WHERE status='played' ORDER BY game_id")
  .all() as unknown as { id: string; season: number }[];

/** (playerId → 시즌 → 그 시즌 박스가 쓴 이름들) */
const seen = new Map<string, Map<number, Map<string, number>>>();
let parsed = 0;
let noArchive = 0;
let parseFailed = 0;

for (const g of games) {
  const path = `${archiveRoot}/npb/scores/${g.id}/box.html.gz`;
  if (!existsSync(path)) {
    noArchive += 1;
    continue;
  }
  let box;
  try {
    box = parseBoxScore(gunzipSync(readFileSync(path)).toString("utf8"));
  } catch {
    parseFailed += 1;
    continue;
  }
  if (box.status !== "played") continue;
  parsed += 1;
  for (const team of [box.away, box.home]) {
    for (const row of [...team.batters, ...team.pitchers]) {
      if (row.isTeamTotal || row.playerId === null || row.name === "") continue;
      let bySeason = seen.get(row.playerId);
      if (bySeason === undefined) {
        bySeason = new Map();
        seen.set(row.playerId, bySeason);
      }
      let names = bySeason.get(g.season);
      if (names === undefined) {
        names = new Map();
        bySeason.set(g.season, names);
      }
      names.set(row.name, (names.get(row.name) ?? 0) + 1);
    }
  }
}

/**
 * 그 시즌에서 **가장 많이 쓰인 표기**를 그 시즌의 이름으로 본다.
 *
 * ⚠**이 정의는 「정답」이 아니라 「측정 기준」이다.** 배선 뒤에도 **10/6,207(0.16%)** 이 남는데
 * 실측 결과 **10건 전부 「시즌 도중에 표기가 바뀐 경우」**다 — 동명이인이 들어와 이름을 늘리는 일이 잦다
 * (`松田×85 → 松田宣×73` · `DJ.ジョンソン×28 → ジョンソン×16` 등, 2026-08-21 `BB_DRIFT_DETAIL=1` 실측).
 * 저장층은 **그 시즌 마지막 경기의 표기**를 고르고 여기서는 **최빈값**을 고른다.
 * ⚠**어느 쪽이 옳은지 정해지지 않았다.** 10건 중 하나(`23125136` 2026)는 **28 대 28 동률**이라
 * 최빈값 자체가 문자열 순서로 갈린다 — **이 수를 0 으로 만들려고 쫓지 마라.**
 */
function canonical(names: Map<string, number>): string {
  return [...names.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]![0];
}

const nowName = new Map(
  (db.prepare("SELECT player_id AS id, display_name AS n FROM player").all() as unknown as {
    id: string;
    n: string;
  }[]).map((r) => [r.id, r.n]),
);

/** 시즌 스코프 표가 이미 있으면 그것도 잰다 — 배선 뒤에는 이 열이 0 이어야 한다 */
const hasSeasonTable =
  (db
    .prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='player_season_name'")
    .get() as unknown as { n: number }).n > 0;
const seasonName = new Map<string, string>();
if (hasSeasonTable) {
  for (const r of db
    .prepare("SELECT player_id AS id, season AS s, display_name AS n FROM player_season_name")
    .all() as unknown as { id: string; s: number; n: string }[]) {
    seasonName.set(`${r.id} ${r.s}`, r.n);
  }
}

let pairs = 0;
let wrongNow = 0;
let wrongLatest = 0;
let wrongFirst = 0;
let wrongSeasonTable = 0;
let missingSeasonRow = 0;
const drifted: string[] = [];
/** ⚠**남는 어긋남의 정체를 추정하지 않기 위해** 실물을 낸다 — `BB_DRIFT_DETAIL=1` */
const detail: string[] = [];

for (const [id, bySeason] of seen) {
  const seasons = [...bySeason.entries()].sort((a, b) => a[0] - b[0]);
  const canon = seasons.map(([s, names]) => [s, canonical(names)] as const);
  const first = canon[0]![1];
  const last = canon.at(-1)![1];
  if (new Set(canon.map(([, n]) => n)).size > 1) drifted.push(id);
  for (const [s, name] of canon) {
    pairs += 1;
    if (nowName.get(id) !== name) wrongNow += 1;
    if (last !== name) wrongLatest += 1;
    if (first !== name) wrongFirst += 1;
    if (hasSeasonTable) {
      const got = seasonName.get(`${id} ${s}`);
      if (got === undefined) missingSeasonRow += 1;
      else if (got !== name) { wrongSeasonTable += 1; detail.push(`${id} ${s} 표=${got} 최빈=${name} 내역=${[...bySeason.get(s)!.entries()].sort((a, b) => b[1] - a[1]).map(([n2, c]) => `${n2}×${c}`).join(" ")}`); }
    }
  }
}

const pct = (n: number): string => `${((n / pairs) * 100).toFixed(2)}%`;

console.log(`박스 파싱 ${parsed} / 실시 경기 ${games.length} · 아카이브 없음 ${noArchive} · 파싱 실패 ${parseFailed}`);
console.log(`선수 ${seen.size} · (선수 × 시즌) 쌍 ${pairs} · 이름이 흔들린 선수 ${drifted.length}`);
console.log("");
console.log("정본 = 「그 시즌의 박스가 쓴 이름」. 아래는 그것과 다른 쌍의 수다.");
console.log(`  고정 이름(player.display_name): ${wrongNow} (${pct(wrongNow)})`);
console.log(`  「최종 이름으로 통일」이면      : ${wrongLatest} (${pct(wrongLatest)})`);
console.log(`  「최초 이름으로 통일」이면      : ${wrongFirst} (${pct(wrongFirst)})`);
if (hasSeasonTable) {
  console.log(`  지금 화면(시즌 스코프)          : ${wrongSeasonTable} (${pct(wrongSeasonTable)}) · 행 없음 ${missingSeasonRow}`);
  console.log("");
  console.log("⚠**「지금 화면」 줄이 이 표의 결론이다** — 배선(2026-08-21)이 그 줄을 쓴다. 「행 없음」이 0 이 아니면 적재가 안 돌았다는 뜻이다.");
} else {
  console.log("");
  console.log("⚠`player_season_name` 표가 없다 — 마이그레이션 018 이 적용되지 않았다.");
}
console.log("");
console.log("⚠**「최종 통일」이 「최초 통일」보다 큰 것이 이 표의 요점이다** — 어느 한 시점으로 통일하면");
console.log("  반드시 다른 시즌이 틀리고, 최신 쪽이 더 많이 틀린다. 옳은 것은 시즌 스코프뿐이다.");
db.close();

if (process.env.BB_DRIFT_DETAIL === "1" && detail.length > 0) {
  console.log("");
  console.log(`=== 어긋난 쌍 ${detail.length}건 (표=저장층이 고른 이름 · 최빈=그 시즌 최빈 표기) ===`);
  for (const d of detail) console.log(`  ${d}`);
}
