/**
 * 아카이브한 予告先発 페이지 → `probable_pitcher` 테이블.
 *
 *   node packages/store/tools/load-starters.ts data/archive data/bb.sqlite [--season 2026]
 *
 * ⚠**페이지에 연도가 없다**(`8月16日の予告先発投手`). 연도는 여기서 붙이고,
 * 어떻게 붙였는지 아래에 적어 둔다 — 연말 경계에서 조용히 틀리기 좋은 곳이다.
 * ⚠**미발표는 실패가 아니다**(M11). 행은 만들되 `player_id`를 NULL로 둔다.
 */
import { readdir } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { parseAnnouncedStarters } from "@bb-app/parser";
import { teamByName } from "@bb-app/domain";
import { STARTERS_URL } from "@bb-app/archiver";
import { openDb } from "../src/db.ts";
import { ensurePlayer, upsertProbablePitcher } from "../src/load.ts";
import { fetchedAtOf } from "../src/meta.ts";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { season: { type: "string" } },
});
const [archiveRoot, dbPath] = positionals;
if (!archiveRoot || !dbPath) {
  console.error("usage: node tools/load-starters.ts <archive-root> <db-path> [--season 2026]");
  process.exit(2);
}

const nowIso = new Date().toISOString();
const dir = join(archiveRoot, "npb", "starters");

let files: string[];
try {
  files = (await readdir(dir)).filter((f) => f.endsWith(".html.gz")).sort();
} catch {
  console.error(`予告先発 디렉터리가 없다: ${dir}`);
  process.exit(1);
}

const db = openDb(dbPath, nowIso);

let games = 0;
let announced = 0;
let pending = 0;
let failed = 0;
/** 경기가 예정되지 않은 날. **실패가 아니다** — 적재할 것이 없을 뿐이다(M11) */
let restDays = 0;
const problems: string[] = [];

/**
 * 취득일(`YYYY-MM-DD`)과 페이지의 `MM-DD`로 경기일을 만든다.
 *
 * ⚠**예고는 취득일과 같은 날이거나 그 다음날이다**(실측: 8/15에 8/16분이 게시돼 있었다).
 * 그래서 「취득한 해」를 그대로 쓰되, **月이 12→1로 넘어간 경우에만** 해를 하나 올린다.
 * 반대 방향(1월에 12월분)은 있을 수 없으므로 나오면 문제로 보고한다.
 */
function resolveGameDate(fetchedDate: string, monthDay: string): string | null {
  const year = Number(fetchedDate.slice(0, 4));
  const fetchedMonth = Number(fetchedDate.slice(5, 7));
  const month = Number(monthDay.slice(0, 2));
  if (fetchedMonth === 12 && month === 1) return `${year + 1}-${monthDay}`;
  if (fetchedMonth === 1 && month === 12) return null;
  return `${year}-${monthDay}`;
}

for (const file of files) {
  const fetchedDate = file.replace(/\.html\.gz$/, "");
  /**
   * ⚠**언제 받았는가는 사이드카가 안다. 적재 시각을 넣지 마라**(M4 · 2026-08-18 감사 P1).
   *
   * 여기가 `nowIso`(적재 시각)를 넣고 있었다. 적재는 매일 돌면서 아카이브 **전체**를 다시 훑으므로
   * 8월 15일에 받은 페이지가 매일 「오늘 받은 것」이 됐고, `scripts/freshness.ts` 의
   * 「予告先発 수집이 멈췄다」 검사가 `MAX(fetched_at)` 을 보는 탓에 **한 번도 발화할 수 없었다.**
   * 같은 사고를 통산 기록에서 이미 겪고 `meta.ts` 에 그 교훈을 적어 뒀는데(2026-08-17),
   * 이 파일만 그 함수를 부르지 않고 있었다.
   * ⚠하필 이 자료가 **거르면 영영 못 받는 것**이다 — 손실을 알아챌 장치가 그만큼 중요하다.
   */
  const fetchedAt = fetchedAtOf(join(dir, `${fetchedDate}.meta.json`));
  let parsed;
  try {
    const html = gunzipSync(readFileSync(join(dir, file))).toString("utf8");
    parsed = parseAnnouncedStarters(html);
  } catch (err) {
    failed += 1;
    problems.push(`${file}: ${err instanceof Error ? err.message : String(err)}`);
    continue;
  }

  /**
   * ⚠**휴일은 실패가 아니다**(M11). NPB는 월요일이 대체로 휴일이고, 일요일 밤이면
   * 이 페이지가 이미 월요일자로 넘어가 「試合が予定されていません。」만 남는다.
   * 그것을 실패로 세면 **매주 일요일 밤에 수집이 exit 1로 끝나고, 빌드도 배포도 못 간다**
   * (2026-08-16 실측). 적재할 것이 없을 뿐이므로 세어 두고 다음 파일로 넘어간다.
   */
  if (parsed.noGamesScheduled) {
    restDays += 1;
    continue;
  }

  const gameDate = resolveGameDate(fetchedDate, parsed.monthDay);
  if (gameDate === null) {
    failed += 1;
    problems.push(`${file}: 취득일 ${fetchedDate}와 게시 ${parsed.monthDay}의 연도를 정할 수 없다`);
    continue;
  }
  if (values.season !== undefined && !gameDate.startsWith(`${values.season}-`)) continue;

  db.transaction(() => {
    for (const game of parsed.games) {
      const teams = game.sides.map((s) => {
        const team = teamByName(s.teamName);
        // ⚠로고 alt와 파일명의 코드가 어긋나면 소스 구조가 바뀐 것이다 — 조용히 한쪽을 믿지 않는다
        if (team.code !== s.teamCodeHint) {
          throw new Error(`구단 표기 불일치: ${s.teamName}(${team.code}) vs 로고 ${s.teamCodeHint}`);
        }
        return team.code;
      });

      game.sides.forEach((side, i) => {
        if (side.playerId !== null && side.displayName !== null) {
          // ⚠표기는 덮어쓰지 않는다 — 予告先発은 `柳　裕也`, 박스스코어는 `柳`다
          ensurePlayer(db, side.playerId, side.displayName, nowIso);
          announced += 1;
        } else {
          pending += 1;
        }
        upsertProbablePitcher(db, {
          gameDate,
          teamCode: teams[i]!,
          opponentCode: teams[1 - i]!,
          playerId: side.playerId,
          sourceName: side.displayName,
          venue: game.venue,
          startTime: game.startTime,
          league: game.league,
          sourceUrl: STARTERS_URL,
          fetchedAt,
        });
      });
      games += 1;
    }
  });
}

db.close();

console.log(
  `予告先発: 파일 ${files.length}건 · 경기 ${games} · 발표 ${announced} · 미발표 ${pending}` +
    // ⚠**「경기가 없는 날」을 세어서 보여준다.** 안 보이면 「왜 오늘은 0건이지?」에 답할 수 없다
    (restDays > 0 ? ` · 경기 없는 날 ${restDays}` : ""),
);
if (problems.length > 0) {
  console.error(`⚠문제 ${problems.length}건`);
  for (const p of problems.slice(0, 10)) console.error(`  ${p}`);
}
process.exitCode = failed > 0 ? 1 : 0;
