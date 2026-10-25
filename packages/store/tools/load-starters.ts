/**
 * 아카이브한 予告先発 페이지 → `probable_pitcher` 테이블.
 *
 *   node packages/store/tools/load-starters.ts data/archive data/bb.sqlite [--season 2026]
 *
 * ⚠**페이지에 연도가 없다**(`8月16日の予告先発投手`). 연도는 여기서 붙인다 — 규칙은 `../src/starters-date.ts` 한 벌이다
 * (PR-4 설계 `docs/superpowers/specs/2026-10-24-offseason-readiness-design.md` D3 · 연말 경계에서 조용히 틀리기 좋은 곳이다).
 * ⚠**지난 날짜 게시(`lag < 0`)는 맥박만 남긴다** — 비시즌의 낡은 페이지가 옛 예고를 「다시 받은 것」으로 만들지 않게(아래 루프).
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
import { resolveStartersDate } from "../src/starters-date.ts";

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

/**
 * **받은 날마다 맥박 한 행**(`starters_fetch` · 설계 D3).
 *
 * ⚠**옛 맥박은 경기가 없으면 멈췄다.** 신선도의 「予告先発 수집이 멈췄다」가 `probable_pitcher` 의 `MAX(fetched_at)` 을 봤는데,
 * 휴식 공표 페이지는 아래에서 `continue` 로 행을 안 남기므로 **3일 넘는 휴식과 오프시즌 내내 「멈췄다」**가 됐다.
 * ⚠**파서가 성공한 파일만** 남긴다 — 「받았다」와 「읽었다」를 섞지 않는다. 파일마다 그 날의 마지막 취득이 덮으므로 upsert 다.
 * ⚠`fetched_at` 이 NULL 이면 「취득 시각을 모른다」다 — 적재 시각으로 메우지 않는다(017 선례 · M11).
 */
const upsertFetch = db.raw.prepare(
  `INSERT INTO starters_fetch (fetched_date, game_date, no_games, source_url, fetched_at)
   VALUES (?, ?, ?, ?, ?)
   ON CONFLICT (fetched_date) DO UPDATE SET
     game_date = excluded.game_date, no_games = excluded.no_games,
     source_url = excluded.source_url, fetched_at = excluded.fetched_at`,
);

let games = 0;
let announced = 0;
let pending = 0;
let failed = 0;
/** 경기가 예정되지 않은 날. **실패가 아니다** — 적재할 것이 없을 뿐이다(M11) */
let restDays = 0;
/** 게시 날짜가 취득일보다 이른 페이지(비시즌의 낡은 페이지) — **맥박만** 남겼다(설계 D3-5) */
let pastPulses = 0;
const problems: string[] = [];

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
   * ⚠**연도를 정할 수 없으면 실패다**(M7 · 설계 D3-2·4) — 창 [취득일 − 351, 취득일 + 14](366일) 안에 그 날짜가 없다. 평년 날짜는 언제나 걸리므로
   *   **사실상 2/29 뿐**이다(낡은 비시즌 페이지는 351일까지 맥박만 · 3판).
   * ⚠**그 파일은 어느 표도 안 바꾼다** — 맥박(`starters_fetch`)도 남기지 않는다(「받았다」와 「읽었다」를 섞지 않는다 · 위 파서 실패와 같다).
   * ⚠**아카이브 전체를 매번 다시 읽으므로 그 파일은 매 실행 실패한다**(저절로 안 낫는다 · 처치는 런북 `docs/operations/deploy.md` §7-L 「予告先発 파일이 매 실행 실패할 때」).
   */
  const resolved = resolveStartersDate(fetchedDate, parsed.monthDay);
  if (!resolved.ok) {
    failed += 1;
    problems.push(`${file}: 게시 ${parsed.monthDay}의 연도를 정할 수 없다 — ${resolved.reason}`);
    continue;
  }
  const gameDate = resolved.date;
  if (values.season !== undefined && !gameDate.startsWith(`${values.season}-`)) continue;

  /**
   * ⚠⚠**지난 날짜 게시는 맥박만 남긴다**(설계 D3-5) — 게시 날짜 · `no_games` 는 페이지대로, `probable_pitcher`·`player` 는 안 쓴다.
   * 시즌 중 실측 68회는 전부 0·+1일이다(설계 R4) — 음수는 비시즌의 **낡은 페이지**뿐이다. 그 페이지로 예고를 다시 쓰면
   *   ⑴ 옛 예고의 `fetched_at` 이 올라가 「예고보다 늦은 휴식 공표」 순서(9/11 D1-B · `probableWithdrawal`)가 뒤집히고
   *   ⑵ 「받았다」(맥박)와 「새 예고」가 섞인다. ⚠옛 갈래(1월 취득 ∧ 12월 게시 → 실패)도 여기로 흡수된다.
   * ⚠대가: 자정 직후 어제 게시를 다시 보면 그 예고 행을 안 갱신한다(관측 0/68).
   */
  if (resolved.lag < 0) {
    pastPulses += 1;
    upsertFetch.run(fetchedDate, gameDate, parsed.noGamesScheduled ? 1 : 0, STARTERS_URL, fetchedAt);
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
    // ⚠**휴식 공표도 맥박이다** — NPB 가 날짜를 붙여 「그날은 경기가 없다」고 적은 것이다(예비 경기 날의 근거 · 설계 D4)
    upsertFetch.run(fetchedDate, gameDate, 1, STARTERS_URL, fetchedAt);
    continue;
  }

  db.transaction(() => {
    upsertFetch.run(fetchedDate, gameDate, 0, STARTERS_URL, fetchedAt);
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
    (restDays > 0 ? ` · 경기 없는 날 ${restDays}` : "") +
    // ⚠**맥박만 남긴 지난 날짜 게시도 센다**(설계 D3-5) — 비시즌 내내 이 수가 는다면 그 페이지가 낡은 채 멈춰 있다는 뜻이다
    (pastPulses > 0 ? ` · 지난 날짜 게시 ${pastPulses}건(맥박만)` : ""),
);
if (problems.length > 0) {
  console.error(`⚠문제 ${problems.length}건`);
  for (const p of problems.slice(0, 10)) console.error(`  ${p}`);
}
process.exitCode = failed > 0 ? 1 : 0;
