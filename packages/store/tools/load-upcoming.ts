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

/**
 * ⚠**지우는 단위는 「읽은 달」이다**(2026-09-11 · 설계 D5 · 콜드 리뷰 지적). 예전에는 `DELETE … WHERE season = ?` 한 번이라
 * **파일이 빠진 달의 행까지 지워졌다**(복원 누락 · 경로 오류 · 아카이브 축소) — 이제 그 행이 누락 판정의 증거라 지우면 판정이 조용히 풀린다.
 */
const delUpcomingMonth = db.raw.prepare("DELETE FROM upcoming_game WHERE season = ? AND substr(game_date, 6, 2) = ?");
const delPlayedMonth = db.raw.prepare("DELETE FROM schedule_played WHERE season = ? AND substr(game_date, 6, 2) = ?");
const ins = db.raw.prepare(
  `INSERT INTO upcoming_game (season, game_date, home_code, away_code, seq, venue, start_time, source, fetched_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
);
/** 월간 일정이 「치렀다」(점수 링크)고 표시한 경기 — **1차 증거**(설계 D1-A) */
const insPlayed = db.raw.prepare(
  `INSERT INTO schedule_played (season, game_date, home_code, away_code, seq, source, fetched_at)
   VALUES (?, ?, ?, ?, ?, ?, ?)`,
);
/** 사본을 언제 받았는가 — 「사본이 새롭다」의 근거(설계 D1-B) */
const upsertMonth = db.raw.prepare(
  `INSERT INTO schedule_month (season, month, source, fetched_at, date_rows, games)
   VALUES (?, ?, ?, ?, ?, ?)
   ON CONFLICT (season, month) DO UPDATE SET
     source = excluded.source, fetched_at = excluded.fetched_at,
     date_rows = excluded.date_rows, games = excluded.games`,
);
/**
 * 그 시즌 그 달에서 **우리가 아는 가장 이른 날** — 개막 달의 앞부분 공백을 가르는 근거.
 *
 * ⚠⚠**`game` 만 보면 바로 그 누락이 근거에서 빠진다**(2026-09-11 · 3중 검토 3차 P1 · 실행 재현). 10/1 경기를 못 받았으면
 * `game` 의 가장 이른 날은 10/3 이라, 10/1 행이 잘린 사본이 「개막 달」로 통과해 **10/1 의 치러짐 표시를 지운다.**
 * → **전에 받은 사본이 관측한 날**(치러짐 표시 · 앞으로의 경기)도 본다. 이 조회는 그 달을 지우기 **전에** 돈다.
 */
const firstKnownOfMonth = db.raw.prepare(
  `SELECT MIN(d) AS d FROM (
     SELECT MIN(game_date) AS d FROM game WHERE season = ?1 AND substr(game_date, 6, 2) = ?2
     UNION ALL SELECT MIN(game_date) FROM schedule_played WHERE season = ?1 AND substr(game_date, 6, 2) = ?2
     UNION ALL SELECT MIN(game_date) FROM upcoming_game WHERE season = ?1 AND substr(game_date, 6, 2) = ?2
   )`,
);

/**
 * **날짜 완결성** — 그 달 날짜 행이 **말일까지 끊김 없이** 이어지는가.
 *
 * ⚠**「파싱이 됐다」가 「그 달 전부를 담았다」는 아니다**(설계 D5 · 콜드 리뷰 지적). 일부 날짜만 담긴 응답으로 달을 교체하면
 * 사라진 날의 치러짐 표시를 지우고 사본은 새로워져 누락 판정이 함께 풀린다.
 * ⚠**앞부분이 비어도 되는 것은 개막 달뿐이다** — 실측: 월간 일정 75장 중 66장이 모든 날을 싣고, 나머지 9장은 전부 개막 달
 * (8시즌의 3월 · 2020년 6월)이며 **빠진 것이 앞부분뿐**이다. 그래서 「그 달에 첫 날짜 행보다 이른 날을 우리가 모를 때」만 허용한다
 * (경기 행 · 전에 받은 사본의 치러짐 표시 · 앞으로의 경기 — `firstKnownOfMonth`).
 * ⚠개막이 미뤄져 개막 달의 첫 날짜가 **뒤로** 밀리면 전에 관측한 날이 앞서므로 멈춘다 — 조용히 받는 것보다 안전한 쪽이다.
 * @returns 빠진 날(`[]` 이면 완결)
 */
function missingDays(mm: string, dateKeys: readonly string[]): number[] {
  const last = new Date(Date.UTC(season, Number(mm), 0)).getUTCDate();
  const days = new Set(dateKeys.filter((k) => k.slice(0, 2) === mm).map((k) => Number(k.slice(2))));
  const present = [...days].sort((a, b) => a - b);
  const all = Array.from({ length: last }, (_, i) => i + 1);
  if (present.length === 0) return all;
  const first = present[0]!;
  const gaps = all.filter((d) => d >= first && !days.has(d));
  if (first === 1) return gaps;
  // 앞부분이 빈다 — 개막 달인가
  const firstListed = `${season}-${mm}-${String(first).padStart(2, "0")}`;
  const earliest = (firstKnownOfMonth.get(season, mm) as { d: string | null } | undefined)?.d ?? null;
  const prefix = earliest !== null && earliest < firstListed ? all.filter((d) => d < first) : [];
  return [...prefix, ...gaps];
}

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

let months = 0, kept = 0, playedRows = 0, nonTeam = 0;
/**
 * ⚠**달 판정 — 여기가 M7 의 급소다.** 분류는 파서의 `classifyScheduleRows` 한 벌이다(수집기 `discover.ts` 와 같다 · M1).
 *
 * | 조건 | 판정 |
 * |---|---|
 * | 날짜 행 0 | 구조 변경 — 되돌린다 |
 * | 못 읽은 행 1 이상 | 구조 변경 — **되돌린다** |
 * | 날짜 행은 있고 경기·구단 아님·예정 표기·못 읽음이 전부 0 | **경기가 없는 달** — 정상 |
 *
 * ⚠**옛 가드는 「경기 행 0」을 전부 구조 변경으로 봤다.** 그 근거(「월간 일정 페이지에는 반드시 경기 행이 있다」)가
 * 경기가 없는 달(12~2월)에는 거짓이고, **수집기는 같은 모양을 정상으로 받는데 적재기만 반대 전제**였다(2026-09-11).
 * ⚠**「못 읽음」을 커밋 뒤 exit 1 로 두던 것도 바꿨다** — 그러면 DELETE 가 이미 커밋돼 기존 일정이 사라진다.
 * 반증자가 실제로 재현했던 모양(마크업을 바꾸자 `upcoming_game` 8행 → 0행 · 2026-08-18 감사 P1)은
 * 이제 파서가 「못 읽음」으로 세고 여기서 되돌린다.
 */
const noDateRowMonths: string[] = [];
const unreadableMonths: string[] = [];
const incompleteMonths: string[] = [];
const noGameMonths: string[] = [];
const files = readdirSync(dir).filter((f) => /^schedule_\d{2}\.html\.gz$/.test(f)).sort();

/**
 * ⚠**읽을 파일이 0개면 아무것도 지우지 않고 멈춘다**(설계 D5 · 콜드 리뷰 지적). 예전에는 반복문이 0회라 가드가 하나도 안 돌고
 * **`DELETE` 만 커밋됐다.** 새 시즌 일정이 아직 공표되지 않은 경우(404 관측)는 설계 D7 이 따로 다룬다.
 */
if (files.length === 0) {
  console.error(`⚠${season} 시즌 일정 파일이 하나도 없다: ${dir} — **기존 일정을 건드리지 않고 멈춘다**`);
  db.close();
  process.exit(1);
}
/** 전에 사본을 받았던 달 — 이번에 파일이 없으면 「사본이 사라진 달」이다 */
const knownMonths = new Set(
  (db.raw.prepare("SELECT month FROM schedule_month WHERE season = ?").all(season) as unknown as { month: number }[])
    .map((r) => String(r.month).padStart(2, "0")),
);

/**
 * ⚠**던져서 트랜잭션을 되돌린다.** 여기서 그냥 종료 코드만 1로 두면
 * **DELETE 는 이미 커밋돼** 표가 빈 채로 남는다 — 감지기가 데이터를 못 지킨다.
 */
class ScheduleShapeError extends Error {}

try {
db.transaction(() => {
  /** ⚠**같은 날 같은 카드의 번호.** 더블헤더가 아니어도 키를 채워야 한다 */
  const seqOf = new Map<string, number>();
  for (const f of files) {
    months += 1;
    const mm = f.slice(9, 11);
    const html = gunzipSync(readFileSync(join(dir, f))).toString("utf8");
    const fetchedAt = fetchedAtOf(join(dir, f.replace(/\.html\.gz$/, ".meta.json")));
    const r = parseUpcoming(html, season);
    nonTeam += r.nonTeamRows;
    if (r.dateRows === 0) noDateRowMonths.push(f);
    else if (r.unreadableRows > 0) unreadableMonths.push(`${f}(${r.unreadableRows}행)`);
    else {
      const missing = missingDays(mm, r.dateKeys);
      if (missing.length > 0) {
        incompleteMonths.push(`날짜가 빠진 달 ${mm}(없는 날 ${missing.slice(0, 6).join(",")}${missing.length > 6 ? `… 외 ${missing.length - 6}` : ""})`);
      } else if (r.games.length + r.nonTeamRows + r.placeholderRows === 0) {
        noGameMonths.push(f);
      }
    }
    // ⚠**그 달만** 지우고 다시 넣는다 — 문제가 있는 달이 하나라도 있으면 아래에서 던져 **전부 되돌린다**
    delUpcomingMonth.run(season, mm);
    delPlayedMonth.run(season, mm);
    upsertMonth.run(season, Number(mm), sourceOf(f), fetchedAt, r.dateRows, r.games.length);
    for (const g of r.games) {
      if (g.played) {
        playedRows += 1;
        const card = `${g.date}|${g.homeCode}|${g.awayCode}`;
        const nth = (playedSeen.get(card) ?? 0) + 1;
        playedSeen.set(card, nth);
        insPlayed.run(season, g.date, g.homeCode, g.awayCode, nth - 1, sourceOf(f), fetchedAt);
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
  if (noDateRowMonths.length > 0) {
    throw new ScheduleShapeError(
      `일정 표에서 날짜 행을 하나도 못 찾은 달이 있다: ${noDateRowMonths.join("·")}\n` +
        `  마크업이 바뀌었을 가능성이 높다. **기존 일정을 지우지 않고 멈춘다**(M7).`,
    );
  }
  if (unreadableMonths.length > 0) {
    throw new ScheduleShapeError(
      `일정 표에 못 읽은 행이 있는 달이 있다: ${unreadableMonths.join("·")}\n` +
        `  칸에 글자가 있는데 경기로 못 읽었거나, 점수 숫자가 있는데 점수 링크가 없다 — 표기가 바뀌었을 수 있다.\n` +
        `  **기존 일정을 지우지 않고 멈춘다**(M7).`,
    );
  }
  if (incompleteMonths.length > 0) {
    throw new ScheduleShapeError(
      `일정 표에서 ${incompleteMonths.join(" · ")}\n` +
        `  일부 날짜만 담긴 응답으로 달을 바꾸면 사라진 날의 치러짐 표시가 지워진다(개막 달의 앞부분 공백만 허용).\n` +
        `  **기존 일정을 지우지 않고 멈춘다**.`,
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
    ` · 구단 아닌 행 ${nonTeam}건 · 경기가 없는 달 ${noGameMonths.length}개` +
    (noGameMonths.length === 0 ? "" : `(${noGameMonths.join("·")})`),
);
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

/**
 * ⚠**사본이 사라진 달** — 전에 받았는데 이번엔 파일이 없다. 그 달의 행은 **지우지 않았다**(달 단위 교체).
 * 아카이브가 줄어든 것은 비정상이므로 **실패로 알린다** — 읽은 달의 갱신은 이미 커밋됐고 그것은 옳다.
 */
const readMonths = new Set(files.map((f) => f.slice(9, 11)));
const vanished = [...knownMonths].filter((m) => !readMonths.has(m)).sort();
db.close();
if (vanished.length > 0) {
  console.error(
    `⚠사본이 사라진 달 ${vanished.join("·")} — 전에 받은 일정 사본이 아카이브에 없다. **그 달의 기존 행은 보존했다.**\n` +
      `   아카이브 복원 누락이나 경로 오류를 의심하라(\`scripts/archive-guard.ts\` 가 줄어든 아카이브를 따로 잡는다).`,
  );
  process.exitCode = 1;
} else {
  // ⚠못 읽은 행·날짜가 빠진 달은 위에서 되돌리고 exit 1 로 끝났다 — 여기까지 왔으면 읽은 달은 전부 판정이 섰다
  process.exitCode = 0;
}
