/**
 * 월간 일정 페이지에서 **앞으로의 경기**를 적재한다.
 *
 *   node packages/store/tools/load-upcoming.ts data/archive data/bb.sqlite 2026
 *
 * ⚠**외부 요청 0회.** 이미 받아 둔 일정 페이지를 읽을 뿐이다 —
 * 경기 아카이버가 대상 날짜의 달을 받으면서 **월 단위로 통째** 저장해 두었다(§2-2-1).
 *
 * ⚠**시즌 단위로 지우고 다시 넣는다**(멱등 · M5). 경기가 치러지면 일정 페이지에
 * 점수 링크가 붙고 파서가 `played:true` 로 표시하므로, 다시 넣을 때 **자동으로 빠진다.**
 * 손으로 지우는 경로를 만들지 않는다 — 그런 경로는 언젠가 안 돈다.
 *
 * ⚠**받지 않은 달은 조용히 0건이 아니다.** 몇 달치를 읽었는지 보고한다(§3-7).
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { join } from "node:path";
import { parseUpcoming } from "@bb-app/parser";
import { fetchedAtOf, openDb } from "../src/index.ts";

const [archiveDir, dbPath, seasonArg] = process.argv.slice(2);
if (!archiveDir || !dbPath || !seasonArg) {
  console.error("usage: node tools/load-upcoming.ts <archive-dir> <db-path> <season>");
  process.exit(2);
}
const season = Number(seasonArg);
if (!Number.isInteger(season)) {
  console.error(`시즌이 정수가 아니다: ${seasonArg}`);
  process.exit(2);
}

const dir = join(archiveDir, "npb", "games", String(season));
if (!existsSync(dir)) {
  console.error(`일정 아카이브가 없다: ${dir}`);
  process.exit(1);
}

/**
 * 이 행이 **어느 페이지에서 왔는가**(M4).
 *
 * ⚠**`MM` 을 치환하지 않은 템플릿을 그대로 넣고 있었다**(2026-08-18 감사 P3).
 * 그래서 모든 행이 `schedule_MM_detail` 이라는 **존재하지 않는 페이지**를 가리켰고,
 * 「이 예정은 어디서 왔나」에 답할 수 없었다 — 달마다 페이지가 다른데도.
 */
const sourceOf = (file: string): string =>
  `npb.jp/games/${season}/${file.replace(/\.html\.gz$/, "_detail")}`;
const nowIso = new Date().toISOString();
const db = openDb(dbPath, nowIso);

const del = db.raw.prepare("DELETE FROM upcoming_game WHERE season = ?");
const ins = db.raw.prepare(
  `INSERT INTO upcoming_game (season, game_date, home_code, away_code, seq, venue, start_time, source, fetched_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
);

/**
 * **이미 적재된 경기.** `일정표는 「치러졌다」는데 우리에게 행이 없는` 경기를 세기 위한 것이다.
 *
 * ⚠**그 상태가 실재한다**(2026-08-25 · 감사 P3 #12). 아래 `if (g.played) continue` 는
 * **우리가 그 경기를 가졌는지 안 본다.** 경기가 시작되면 일정표에 점수 링크가 붙어
 * 이 표에서 빠지는데, 박스가 「試合終了」를 말하기 전이면 `load-archive` 가
 * 그 경기를 **저장하지 않는다**(M9). 그 사이 경기는 **`game` 에도 `upcoming_game` 에도 없다.**
 * 그러면 그 날 화면에서 경기가 통째로 사라지고, **「未取得」 표시조차 안 뜬다** —
 * 조용한 실패를 잡으라고 만든 표가 바로 그 조용한 실패를 못 보여주는 모양이다.
 *
 * ⚠**지속 상태로는 0건이다**(실측 2026-08-25 · 2026·2025·2024 의 `played` 행 **2,484건 전수**).
 * 경기가 끝나면 다음 실행이 `game` 행을 만들어 **창이 스스로 닫히기 때문**이다.
 * 그래서 **지나간 뒤에는 못 잰다** — 여기서 그때그때 세는 것이 유일한 방법이다.
 *
 * ⚠**여기서는 세기만 한다. 고치지 않는다.**
 * 이 행을 그냥 남기면 today 화면이 **진행 중인 경기를 「予定 18:00」이라고** 말하게 된다 —
 * 사라지는 대신 **다른 거짓말**을 하는 것이라 그게 더 낫다고 단정할 수 없다.
 * 제대로 가르려면 `upcoming_game` 에 「일정표는 치러졌다고 한다」는 칸이 필요하고,
 * 그건 스키마 변경이라 **사용자가 고를 일**이다(작업규칙 3).
 * ⚠`load-archive` 가 이 스크립트보다 **먼저** 돈다(`scripts/update.ts`) — 그래서 이 대조가 성립한다.
 */
const loaded = new Map<string, number>();
for (
  const r of db.raw.prepare(
    "SELECT game_date d, home_code h, away_code a, COUNT(*) n FROM game WHERE season = ? GROUP BY 1,2,3",
  ).all(season) as unknown as { d: string; h: string; a: string; n: number }[]
) {
  loaded.set(`${r.d}|${r.h}|${r.a}`, r.n);
}
/** 같은 카드가 하루에 둘일 수 있다(더블헤더) — 몇 번째인지 세어 가며 맞춘다 */
const playedSeen = new Map<string, number>();
const orphans: string[] = [];

let months = 0, kept = 0, playedRows = 0, nonTeam = 0, unreadable = 0;
/**
 * ⚠**아무 행도 나오지 않은 달.** 여기가 M7 의 급소다.
 *
 * 일정 표의 마크업이 바뀌면 `team1` 칸 자체가 사라지므로 **「못 읽은 행」으로도 안 잡힌다** —
 * 파서는 0건을 돌려주고, 적재는 DELETE 만 하고 **종료 코드 0으로 끝난다.**
 * 그러면 화면이 「앞으로의 경기가 없습니다」라고 말한다. 조용한 0 그 자체다.
 * 반증자가 실제로 재현했다: 마크업을 바꾸자 `upcoming_game` 이 **8행 → 0행**(2026-08-18 감사 P1).
 * ⚠**월간 일정 페이지에는 반드시 경기 행이 있다**(치러진 것이든 앞으로의 것이든) —
 * 아카이브에 있는 달이 0행이면 그건 「경기가 없다」가 아니라 **「못 읽었다」**다.
 */
const emptyMonths: string[] = [];
const files = readdirSync(dir).filter((f) => /^schedule_\d{2}\.html\.gz$/.test(f)).sort();

/**
 * ⚠**던져서 트랜잭션을 되돌린다.** 여기서 그냥 종료 코드만 1로 두면
 * **DELETE 는 이미 커밋돼** 표가 빈 채로 남는다 — 감지기가 데이터를 못 지킨다.
 */
class ScheduleShapeError extends Error {}

try {
db.transaction(() => {
  del.run(season);
  /** ⚠**같은 날 같은 카드의 번호.** 더블헤더가 아니어도 키를 채워야 한다 */
  const seqOf = new Map<string, number>();
  for (const f of files) {
    months += 1;
    const html = gunzipSync(readFileSync(join(dir, f))).toString("utf8");
    const fetchedAt = fetchedAtOf(join(dir, f.replace(/\.html\.gz$/, ".meta.json")));
    const r = parseUpcoming(html, season);
    nonTeam += r.nonTeamRows;
    unreadable += r.unreadableRows;
    if (r.games.length + r.nonTeamRows + r.unreadableRows === 0) emptyMonths.push(f);
    for (const g of r.games) {
      if (g.played) {
        playedRows += 1;
        const card = `${g.date}|${g.homeCode}|${g.awayCode}`;
        const nth = (playedSeen.get(card) ?? 0) + 1;
        playedSeen.set(card, nth);
        if ((loaded.get(card) ?? 0) < nth) orphans.push(card);
        continue;
      }
      const key = `${g.date}|${g.homeCode}|${g.awayCode}`;
      const seq = seqOf.get(key) ?? 0;
      seqOf.set(key, seq + 1);
      ins.run(season, g.date, g.homeCode, g.awayCode, seq, g.venue, g.startTime, sourceOf(f), fetchedAt);
      kept += 1;
    }
  }
  if (emptyMonths.length > 0) {
    throw new ScheduleShapeError(
      `일정 표에서 경기 행을 하나도 못 읽은 달이 있다: ${emptyMonths.join("·")}\n` +
        `  마크업이 바뀌었을 가능성이 높다. **기존 일정을 지우지 않고 멈춘다**(M7).`,
    );
  }
});
} catch (err) {
  if (err instanceof ScheduleShapeError) {
    console.error(`⚠${err.message}`);
    db.close();
    process.exit(1);
  }
  throw err;
}

console.log(
  `일정 ${months}개월분 · 앞으로의 경기 ${kept}건 적재 · 치러진 행 ${playedRows}건 제외` +
    ` · 구단 아닌 행 ${nonTeam}건 · 못 읽은 행 ${unreadable}건`,
);
if (unreadable > 0) {
  console.error(`⚠못 읽은 행이 ${unreadable}건 있다 — 일정 표의 표기가 바뀌었을 수 있다(M7)`);
}
/**
 * ⚠**「0건」과 「안 쟀음」을 구별해 쓴다**(작업규칙 7) — 그래서 0 이어도 말한다.
 * ⚠**실패로 만들지 않는다.** 경기 중에 수집하면 정상적으로 잠깐 생기는 상태이고,
 * 다음 실행이 닫는다. 여기서 종료 코드를 세우면 **정상인 날 배포가 멈춘다.**
 */
if (orphans.length === 0) {
  console.log("  · 일정표는 치러졌다는데 우리에게 없는 경기 0건");
} else {
  console.error(
    `⚠**일정표는 치러졌다는데 우리에게 없는 경기 ${orphans.length}건** — 이 경기들은\n` +
      `   \`game\` 에도 \`upcoming_game\` 에도 없어 **화면에서 통째로 사라지고 「未取得」도 안 뜬다**(감사 P3 #12).\n` +
      `   경기 중에 수집하면 정상적으로 생기고 다음 실행이 닫는다 — **닫히지 않으면 그때가 결함이다.**\n` +
      `   ${orphans.slice(0, 8).join(" · ")}${orphans.length > 8 ? ` … 외 ${orphans.length - 8}건` : ""}`,
  );
}

/**
 * ⚠**받지 않은 달을 말한다.** 「앞으로의 경기 70건」만 보면 그게 시즌 전체인지
 * 한 달치인지 알 수 없다. 정규시즌은 3~10월이다.
 */
const have = new Set(files.map((f) => f.slice(9, 11)));
const missing = ["03", "04", "05", "06", "07", "08", "09", "10"].filter((m) => !have.has(m));
if (missing.length > 0) {
  console.log(`  ⚠받지 않은 달: ${missing.join("·")} — 그 달의 경기는 이 표에 없다`);
}

db.close();
process.exitCode = unreadable > 0 ? 1 : 0;
