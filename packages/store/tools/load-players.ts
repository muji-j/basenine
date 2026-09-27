/**
 * 아카이브한 선수 페이지 → `player` 테이블의 속성 컬럼.
 *
 *   node packages/store/tools/load-players.ts data/archive data/bb.sqlite
 *
 * ⚠**투타를 못 읽은 선수를 임의로 채우지 않는다.** null로 두고 몇 명인지 보고한다 —
 * 좌우 스플릿의 근거이므로 모르는 채로 섞이면 스플릿이 조용히 틀린다.
 *
 * ⚠**옛 판이 새 판을 덮지 못한다**(2026-09-27 · 감사 N3 · 설계 `docs/superpowers/specs/2026-09-27-profile-version-guard-design.md` §5).
 *   선수마다 **적용 판**(`player.profile_revision` = 적용한 본문의 sha256)과 아카이브 본문을 맞대, 본문이 다르고 내용이 더 이르면
 *   **프로필과 통산을 함께** 건너뛴다(DB 를 지킨다 · 종료 0 + `::warning::`). 순서를 **모르면** 건너뛰고 종료 1 이다.
 *   건너뛴 선수는 같은 실행의 재취득 선정(`emit-stale-player-ids.ts --archive`)이 적재 **전에** 뽑아 다시 받는다.
 *
 *   node packages/store/tools/load-players.ts data/archive data/bb.sqlite --run-started-at <ISO>
 *
 * ⚠**`--run-started-at` — 이번 실행의 시작 시각**(2026-09-27 · 반영분 재검토 P2 · 설계 §5-2 5번). 순서 기준선이 없는 행에 다른 본문이 오면
 *   **이번 실행에서 받은 200**(사이드카가 부재가 아니고 본 시각 ≥ 이 시각)일 때만 새 판으로 받는다. `update.ts` 가 한 번 읽은 시계를 넘긴다(M6).
 *   ⚠없으면(단독 실행) 증명이 없다 — 그런 행은 판 모름(종료 1)으로 남는다. 시각으로 안 읽히면 **아무것도 안 하고** 종료 2 다.
 */
import { readdir } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { join } from "node:path";
import { parseCareer, parsePlayerProfile } from "@bb-app/parser";
import { openDb } from "../src/db.ts";
import { normalizeFetchedAt } from "../src/meta.ts";
import { judgePlayerVersion, playerArchiveOf } from "../src/player-version.ts";
import type { MetaSnapshot } from "../src/player-version.ts";
import { playersInRefetchWindow } from "../src/refetch-window.ts";

const USAGE = "usage: node tools/load-players.ts <archive-root> <db-path> [--run-started-at <ISO8601>]";
const args = process.argv.slice(2);
/** 이번 실행의 시작(정규화된 ISO) — `null` 이면 단독 실행이라 「이번 실행 증명」이 없다 */
let runStartedAt: string | null = null;
const runArg = args.indexOf("--run-started-at");
if (runArg !== -1) {
  const raw = args[runArg + 1];
  // ⚠모르는 값으로 증명을 만들지 않는다 — 없거나 · 다음 인자이거나 · 시간대 없는 값이면 멈춘다(`normalizeFetchedAt` 한 벌 · M1)
  const norm = raw === undefined || raw.startsWith("--") ? null : normalizeFetchedAt(raw);
  if (norm === null) {
    console.error(`--run-started-at 뒤에 시각(시간대가 붙은 ISO8601)이 없다: ${JSON.stringify(raw ?? null)}\n${USAGE}`);
    process.exit(2);
  }
  runStartedAt = norm;
  args.splice(runArg, 2);
}
const [archiveRoot, dbPath] = args;
if (!archiveRoot || !dbPath) {
  console.error(USAGE);
  process.exit(2);
}

const nowIso = new Date().toISOString();
const dir = join(archiveRoot, "npb", "players");

let files: string[];
try {
  files = (await readdir(dir)).filter((f) => f.endsWith(".html.gz"));
} catch {
  console.error(`선수 페이지 디렉터리가 없다: ${dir}`);
  process.exit(1);
}

const db = openDb(dbPath, nowIso);
const stmt = db.raw.prepare(
  // ⚠**연도만 남긴다**(L5 데이터 최소화 · 2026-08-18 감사 P3). 화면이 쓰는 것이 연도뿐이다
  //
  // ⚠**못 읽은 값이 이미 있는 값을 지우지 않게 한다**(M11 · 2026-08-18 감사 P3).
  //   예전에는 무조건 덮어써서, 프로필에서 投打 를 못 읽으면 **경기별 명단이 채워 둔 값이
  //   NULL 로 되돌아갔다.** update.ts 는 명단(2단계) → 프로필(3단계) 순이라
  //   **마지막에 도는 이쪽이 언제나 이겼다.** 「못 읽었다」와 「없다」를 같은 NULL 로 쓰면 안 된다.
  //   ⚠`COALESCE(?, col)` = 읽었으면 그 값, 못 읽었으면 **지금 값 그대로**.
  //   ⚠**권위는 여전히 여기다** — 읽은 값은 그대로 덮어쓴다(M1). 못 읽었을 때만 양보한다.
  //
  // ⚠**`profile_fetched_at` 은 「언제 받았나」다 — 「언제 적재했나」가 아니다**(M4 · 2026-09-26 감사 C7).
  //   여기는 적재 시각(`nowIso`)을 넣고 있었다. 적재는 매일 아카이브 **전체**를 다시 훑으므로
  //   8월에 받은 페이지가 매일 「오늘 받은 것」이 됐다 — 아래 통산 INSERT 는 사이드카 시각을 쓰는데
  //   **같은 페이지의 같은 루프 안에서** 두 방식이 갈려 있었다.
  //   → 통산 행과 **같은 값**(판정이 낸 시각 한 벌)을 넣는다.
  //   ⚠**사이드카를 못 읽으면(`null`) NULL 이다 — 이 칸에는 `COALESCE` 를 걸지 않는다**(M11 · 2026-09-26 3중 검토 2차 반영).
  //     처음에는 `COALESCE(?, profile_fetched_at)` 로 **이전 시각을 남겼는데**, 같은 UPDATE 가 위 프로필 값은
  //     **이번 페이지로** 덮어쓰므로 「값은 새 판 · 시각은 옛 판」이 됐다 — 그 시각은 값의 출처를 거짓으로 말한다(M4).
  //     같은 페이지의 통산 행은 그때 NULL 이다. **모르면 모름**으로 한 벌을 맞춘다. 「지금」으로 메우지도 않는다.
  //     ⚠**예외 하나**(감사 N3 · 설계 §5-2 「C7 과의 조정」) — 적용 판과 **같은 본문**이면 사이드카를 못 읽어도 DB 시각을 남긴다.
  //     그 시각은 **바로 이 본문**을 확인한 시각이라 값과 한 벌이다(판정이 `same` 의 시각으로 낸다).
  //   ⚠~~「옛 판이 새 판을 덮지 못하게」 하는 순서 가드는 넣지 않았다~~ 는 2026-09-27 부로 낡았다(감사 N3) — 이 UPDATE 전체와
  //     통산 갈아 넣기를 **한 판정으로 함께** 막는다(`judgePlayerVersion` · 아래 루프). 시각에만 가드를 걸지 않은 이유(값과 시각이
  //     갈린다)는 그대로 지켰다 — 건너뛸 때는 **값도 시각도 안 쓴다.**
  //   ⚠**`profile_revision` 은 적용한 본문의 sha256 이다**(023) — 이 칸에도 `COALESCE` 를 걸지 않는다(값·시각과 한 벌).
  //   ⚠**`profile_content_at` 은 그 본문의 내용 시각 — 순서 전용이다**(023 · 3중 검토 3차 P2). 표시 칸(`profile_fetched_at`)은
  //     404 확인으로 오르므로 순서 기준선으로 쓰면 더 새 본문을 옛 판으로 버린다. 판정이 두 칸을 따로 낸다(`v.time` · `v.contentAt`).
  `UPDATE player SET position = COALESCE(?, position), throws = COALESCE(?, throws),
     bats = COALESCE(?, bats), birth_year = COALESCE(?, birth_year),
     physique = COALESCE(?, physique), draft = COALESCE(?, draft), kana = COALESCE(?, kana),
     uniform_number = COALESCE(?, uniform_number), profile_revision = ?, profile_fetched_at = ?, profile_content_at = ?
   WHERE player_id = ?`,
);

/**
 * 사이드카를 **한 번** 읽은 스냅샷(설계 §5-3 ①). ⚠**`fetchedAtOf` 로 파일을 다시 읽지 않는다** — 판정한 판과 다른 판의 시각이
 * 들어간다(경기 가드 부록 D A2 · TOCTOU). ENOENT 는 「없음」, 그 밖의 읽기 오류와 깨진 JSON 은 「깨짐」이다(둘 다 시각을 모른다).
 */
function readMetaSnapshot(path: string): MetaSnapshot {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (err) {
    if ((err as { code?: unknown }).code === "ENOENT") return { state: "missing" };
    return { state: "broken", error: err instanceof Error ? err.message : String(err) };
  }
  try {
    return { state: "ok", value: JSON.parse(raw) as unknown };
  } catch (err) {
    return { state: "broken", error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * 年度別成績.
 *
 * ⚠**우리 경기 데이터와 다른 표에 넣는다**(M4) — 출처가 NPB 공표치라 섞으면
 * 「어디서 온 숫자인가」에 답할 수 없다.
 * ⚠**갈아끼운다**(선수 단위 DELETE 후 INSERT). 이적으로 행이 늘거나 줄 수 있고,
 * UPSERT 만 하면 **없어진 행이 남는다** — 옛 구단 줄이 영원히 붙어 다닌다.
 */
const CAREER_SOURCE = "npb.jp/bis/players (年度別成績)";
const delBat = db.raw.prepare("DELETE FROM career_batting WHERE player_id = ?");
const delPit = db.raw.prepare("DELETE FROM career_pitching WHERE player_id = ?");
/** 지우기 **전에** 지금 몇 행을 갖고 있는지 — 「있던 표가 0행이 됐다」를 재는 분모다(감사 C8) */
const hadBat = db.raw.prepare("SELECT COUNT(*) AS n FROM career_batting WHERE player_id = ?");
const hadPit = db.raw.prepare("SELECT COUNT(*) AS n FROM career_pitching WHERE player_id = ?");
const insBat = db.raw.prepare(
  `INSERT INTO career_batting (player_id, year, team, games, pa, ab, runs, h, d2, d3, hr, tb, rbi,
     sb, cs, sh, sf, bb, hbp, so, gidp, source, fetched_at, seq)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
);
const insPit = db.raw.prepare(
  `INSERT INTO career_pitching (player_id, year, team, games, w, l, sv, hld, hp, cg, sho, nbb, bf,
     outs, h, hr, bb, hbp, so, wp, balk, runs, er, source, fetched_at, seq)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
);
let careerBat = 0;
let careerPit = 0;
let careerFailed = 0;
/**
 * 통산 표가 **하나도 없던** 페이지(타격·투구 둘 다 0행 · 있던 행도 없음).
 * ⚠**실패로 세지 않는다 — 대신 센다.** 1군 기록이 아직 없는 선수의 페이지가 이 모양일 수 있는데
 *   그 실물을 본 적이 없다(보유 선수 페이지 파일 11,699장 중 0장 · 감사 C8). 「0장」과 「안 쟀음」을 가르려고 찍는다.
 */
let careerAbsent = 0;
/**
 * **취득 시각을 모른 채(NULL) 쓴 선수** — 프로필 `profile_fetched_at` 과 통산 `fetched_at` 을 NULL 로 넣었다(M11 · 모르면 모름).
 * ⚠~~취득시각 결손~~ 이었고 **사이드카가 본문을 말하지 않는 페이지를 전부** 셌다(2026-09-27 · 3중 검토 2차 m4) — 그러면
 *   건너뛴 선수(판 모름 · 아무것도 안 썼다)와 같은 본문이라 DB 시각을 지킨 선수(NULL 이 아니다)까지 들어가, 「NULL 로 들어간 행이
 *   몇 명분인가」에 답하지 못했다. 이제 **실제로 NULL 로 쓴 선수만** 센다. 건너뛴 선수는 판 가드 줄이 따로 센다.
 */
let writtenWithoutTime = 0;

let updated = 0;
let missing = 0;
let failed = 0;
let noHand = 0;
/** 이번에 **읽은 페이지 중** 읽는 법을 얻은 장수. 커버리지 임계값의 분자다 */
let kanaRead = 0;
const unknownPlayers: string[] = [];

/**
 * **판 판정별 수**(감사 N3 · 설계 §5-3). ⚠요약 줄을 0 이어도 찍는다 — 「0건」과 「안 쟀음」을 가른다.
 * `stale` 은 실패가 아니라 목록(DB 를 지켰다 · 종료 0 + `::warning::`)이고, `unknown`·`invalid-db` 는 **실패**다(순서를 몰라
 * 건너뛰었으니 아카이브가 실제로 새것이면 갱신을 조용히 잃는다 — M7 · 종료 1). 선을 가른 기준은 「DB(=화면)에 틀린 값이
 * 들어갈 수 있는가」다(설계 §5-5 · 옛 판에서 경기 가드와 다른 종료 코드를 고른 이유 여섯은 거기에).
 */
const verdictCount = { "no-row": 0, first: 0, same: 0, newer: 0 };
/**
 * 옛 판으로 건너뛴 선수와 **왜 저절로 안 풀리는가**(2026-09-27 · 3중 검토 2차 m1). 셋으로 가른다(위에서부터 처음 맞는 것):
 * - `absent` 부재라 못 고침 — 마지막 관측이 404/410 이라 다시 받아도 못 고친다
 * - `outside` 선정 밖이라 못 고침 — 재취득 선정의 창 밖(400일 밖 · 출장 기록 없음)이라 선정기가 **영영 안 뽑는다**
 * - 그 밖 재취득 대상 — 같은 실행(또는 다음 실행)의 선정이 뽑는다
 * ⚠`outside` 를 재취득 대상에 섞으면 「할 일 없음」이라 적힌 선수가 매 실행 경고로 남는다 — 사람이 결함으로 못 읽는다.
 * 루프는 부재만 적어 두고, 창은 루프가 끝난 뒤 가른다(아래 요약 · 창 질의가 수 초라 옛 판이 없는 날은 재지 않는다).
 */
type StaleClass = "refetch" | "absent" | "outside";
const staleProfiles: { playerId: string; absent: boolean }[] = [];
let versionUnknown = 0;
let dbTimeInvalid = 0;
/**
 * DB 에 순서 기준선(`profile_content_at`)이 없었는데 **이번 실행에서 받은 200**(`--run-started-at` 이상)이라 새 판으로 받은 선수
 * (§5-2 5번 · 2026-09-27 반영분 재검토 P2). ⚠실패가 아니다 — 그러나 **조용히 넘기지도 않는다**: 따로 찍는다.
 * ⚠~~기준선이 없으면 무조건 새 판~~ 이었다 — 복원된 옛 사본도 받아 DB 를 되돌렸다. 증명이 없으면 판 모름(`VERSION UNKNOWN` · 종료 1)이다.
 */
const noBaseline: string[] = [];

db.transaction(() => {
  for (const f of files) {
    const playerId = f.replace(/\.html\.gz$/, "");
    // ① 사이드카를 **한 번** 읽는다(스냅샷 — 판정과 쓰는 시각이 같은 사이드카에서 나온다)
    const meta = readMetaSnapshot(join(dir, `${playerId}.meta.json`));
    // ② 본문을 읽고 푼다 — 실패하면 지금처럼 PARSE ERROR
    let body: Buffer;
    try {
      // 트랜잭션 안이라 동기 읽기를 쓴다 — await 하면 트랜잭션이 열린 채로 이벤트 루프가 돈다.
      body = gunzipSync(readFileSync(join(dir, f)));
    } catch (err) {
      failed += 1;
      console.error(`PARSE ERROR ${playerId} — ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    /**
     * ③·④ **판을 가른다**(감사 N3 · 설계 §5-2 표) — 쓰기와 **같은 트랜잭션 안**이다(루프 전체가 트랜잭션 하나).
     * ⚠**취득 시각은 아카이브가 갖고 있다** — 적재 시각(`nowIso`)과 다르다.
     * ⚠**모르면 `null` 그대로 넣는다. 적재 시각으로 메우지 마라**(M11 · 2026-08-17 재검토 P1).
     *   메우면 두 가지가 동시에 망가진다: 화면이 그 날짜를 「진짜 취득일」이라 말하고,
     *   재취득 선정이 그것을 「가장 신선함」으로 읽어 **그 선수를 영영 다시 안 받는다.**
     * ⚠**판정이 낸 한 값(`v.time`)을 프로필과 통산이 같이 쓴다**(2026-09-26 감사 C7). 통산 행은 선수 단위로 갈아 넣으므로
     *   `null` 이 그대로 들어가고, 프로필의 `profile_fetched_at` 도 **`null` 이 그대로 들어간다**(위 SQL — 한 벌).
     */
    const archive = playerArchiveOf(meta, body);
    // ⚠실행 시작을 넘긴다 — 기준선 없는 행의 「이번 실행 증명」(§5-2 5번 · 반영분 재검토 P2). 단독 실행이면 null(증명 없음)
    const v = judgePlayerVersion(db, playerId, archive, { runStartedAt });
    // ⑤ 건너뛴다 — **파싱하지 않는다**(옛 판의 파싱 실패가 종료 1 을 만들지 않게). 프로필과 통산을 **함께** 건너뛴다
    if (v.kind === "stale") {
      staleProfiles.push({ playerId, absent: v.absentNow });
      continue;
    }
    if (v.kind === "unknown") {
      failed += 1;
      versionUnknown += 1;
      console.error(`VERSION UNKNOWN ${playerId} — ${v.reason}`);
      continue;
    }
    if (v.kind === "invalid-db") {
      failed += 1;
      dbTimeInvalid += 1;
      console.error(`DB VERSION INVALID ${playerId} — ${v.value}`);
      continue;
    }
    const fetchedAt = v.time;
    // ⑥ 나머지는 지금처럼 — 파싱 → UPDATE → changes() 셈 → 통산 savepoint
    const html = body.toString("utf8");
    let profile;
    try {
      profile = parsePlayerProfile(html);
    } catch (err) {
      failed += 1;
      console.error(`PARSE ERROR ${playerId} — ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    // ⚠**판정별 수는 파싱이 된 뒤에 센다**(2026-09-27 · 3중 검토 2차 m4) — 예전에는 파싱 전에 세서 파싱에 실패한 선수가
    //   「처음·같은 본문·새 판」과 「파싱 실패」에 **두 번** 들어갔다(요약의 수를 더하면 페이지 수보다 컸다). 이제 판정별 수는 쓴 선수다.
    verdictCount[v.kind] += 1;
    if (v.kind === "newer" && v.noBaseline) noBaseline.push(playerId);
    if (profile.throws === null || profile.bats === null) {
      noHand += 1;
      unknownPlayers.push(playerId);
    }
    // ⚠**읽은 장수 기준의 커버리지를 센다.** DB 전체(`player` 표)를 분모로 하면
    // 「페이지를 받지 않은 선수」와 「페이지는 있는데 못 읽은 선수」가 섞여, 마크업이
    // 바뀌어도 비율이 크게 안 움직인다 — 그러면 임계값이 아무것도 못 잡는다
    if (profile.kana !== null) kanaRead += 1;
    stmt.run(
      profile.position,
      profile.throws,
      profile.bats,
      // ⚠**월·일을 버린다** — 파서는 원문대로 읽고, 무엇을 남길지는 여기서 정한다
      profile.birthDate === null ? null : Number(profile.birthDate.slice(0, 4)),
      profile.physique,
      profile.draft,
      profile.kana,
      profile.uniformNumber,
      // ⚠**적용 판 = 이 본문의 sha256**(감사 N3 · 023) — 값·시각과 한 벌로 쓴다
      archive.bodySha256,
      // ⚠**`nowIso` 가 아니다**(감사 C7) — 아래 통산 행과 같은 판정 시각. `null` 이면 NULL 이다(모르면 모름)
      fetchedAt,
      // ⚠**순서 기준선**(3중 검토 3차 P2) — 표시 시각과 따로 낸다. 같은 본문의 404 는 이것을 올리지 않는다
      v.contentAt,
      playerId,
    );
    /**
     * ⚠**여기서 바로 센다.** 아래 통산 INSERT 가 끼어들면 `changes()` 가 **그쪽**을 읽는다 —
     * SQLite 의 `changes()` 는 「가장 최근 완료된 INSERT/UPDATE/DELETE」의 행 수다.
     * 전 선수가 타격 행을 가지므로 값이 **항상 1**이 되어, 「DB에 없는 선수」가
     * 영원히 0으로 보고된다(2026-08-17 이중 검토 지적).
     * 지금은 실제로도 0이라 **틀린 것과 안 재는 것이 구별되지 않는다** — 작업규칙 7이 막는 상태다.
     */
    const changed = (db.raw.prepare("SELECT changes() AS n").get() as { n: number }).n;
    if (changed === 0) missing += 1;
    else {
      updated += 1;
      // ⚠**실제로 NULL 로 쓴 선수만** 센다(3중 검토 2차 m4 · 위 `writtenWithoutTime` 주석) — 행이 없어 안 쓴 선수는 안 센다
      if (fetchedAt === null) writtenWithoutTime += 1;
    }

    /**
     * 年度別成績.
     * ⚠**프로필과 같은 페이지를 두 번 읽지 않는다** — 이미 문자열을 갖고 있다.
     * ⚠**여기서 실패해도 프로필은 살린다**(blast radius) — 한 선수의 표 하나 때문에
     *   투타·읽는 법까지 잃으면 배포가 통째로 멈춘다. 대신 **센다**.
     */
    try {
      /**
       * ⚠**이 선수분만 되돌릴 수 있게 감싼다**(2026-08-18 감사 P1).
       * 예전에는 예외를 잡아 세기만 해서, `DELETE` 는 되고 `INSERT` 가 끊긴 상태가
       * **그대로 커밋**됐다 — 그 선수의 통산이 조용히 잘리고,
       * 화면에는 「데이터 없음」이 아니라 **정상적인 작은 수**로 보인다(M11·M2).
       * 이제 실패하면 **어제 값 그대로** 남는다 — 주석이 약속한 blast radius 가 실제로 성립한다.
       */
      db.savepoint(`career_${playerId}`, () => {
      const career = parseCareer(html);
      /**
       * ⚠**있던 통산 표가 0행이 되면 실패다**(2026-09-26 · 감사 C8).
       *
       * 표를 못 찾으면 예전 파서는 빈 배열을 냈고, 여기서 지운 뒤 아무것도 안 넣어 **통산이 조용히 사라지고 종료 0** 이었다.
       * 파서는 이제 「그 표가 있다고 말하는데(탭·구획) 표가 없다」와 「통계 구획에 모르는 표가 있다」(id 가 한꺼번에
       * 바뀐 경우)를 던진다. 그래도 **탭·구획·표가 통째로 사라진** 페이지는 야수 페이지와 모양이 같아 파서가 원리적으로
       * 못 가른다. 그래서 **결과 쪽에서 한 번 더** 막는다 — **1군 기록은 사라지지 않는다.**
       * 있던 표가 0행이 되는 것은 원래 없음이 아니라 **못 읽은 것**이다.
       * ⚠**이 불변식은 있던 행이 있어야 운다** — 신규 선수는 못 지킨다. 그 몫은 파서의 「모르는 표」 검사다
       *   (2026-09-26 · 3중 검토 3차 P2 — 처음에는 id 일괄 변경을 여기에만 맡겨 **신규 투수가 조용히 빌** 수 있었다).
       * 실측(2026-09-26 · 선수 페이지 스냅숏 8벌 · 1,644명 · 서로 다른 판 3,291개 사이의 전이 1,647개):
       * 표가 있다가 없어진 전이 **0건**(생긴 전이도 0건).
       * ⚠던지면 위 `savepoint` 가 이 선수의 DELETE/INSERT 를 되돌려 **어제 값이 그대로 남는다** — 그리고 아래에서 센다.
       * ⚠실패하면 종료 1 이라 배포가 막힌다 — 무엇을 확인하고 어떻게 푸는가는 런북 `docs/operations/deploy.md` §7-F.
       */
      const had = {
        batting: (hadBat.get(playerId) as { n: number }).n,
        pitching: (hadPit.get(playerId) as { n: number }).n,
      };
      const vanished = [
        ...(had.batting > 0 && career.batting.length === 0 ? [`打撃成績 ${had.batting}행`] : []),
        ...(had.pitching > 0 && career.pitching.length === 0 ? [`投手成績 ${had.pitching}행`] : []),
      ];
      if (vanished.length > 0) {
        throw new Error(
          `있던 통산 표가 0행이 됐다(${vanished.join(" · ")}) — 1군 기록은 사라지지 않는다. ` +
            "표를 못 읽은 것이다(페이지 구조 변경 의심) · 기존 행을 지켰다",
        );
      }
      if (career.batting.length === 0 && career.pitching.length === 0) careerAbsent += 1;
      delBat.run(playerId);
      delPit.run(playerId);
      for (const [i, r] of career.batting.entries()) {
        insBat.run(playerId, r.year, r.team, r.games, r.pa, r.ab, r.runs, r.h, r.d2, r.d3, r.hr,
          r.tb, r.rbi, r.sb, r.cs, r.sh, r.sf, r.bb, r.hbp, r.so, r.gidp, CAREER_SOURCE, fetchedAt, i);
        careerBat += 1;
      }
      for (const [i, r] of career.pitching.entries()) {
        insPit.run(playerId, r.year, r.team, r.games, r.w, r.l, r.sv, r.hld, r.hp, r.cg, r.sho,
          r.nbb, r.bf, r.outs, r.h, r.hr, r.bb, r.hbp, r.so, r.wp, r.balk, r.runs, r.er,
          CAREER_SOURCE, fetchedAt, i);
        careerPit += 1;
      }
      });
    } catch (err) {
      careerFailed += 1;
      console.error(`CAREER ERROR ${playerId} — ${err instanceof Error ? err.message : String(err)}`);
    }

  }
});

/** ⚠**세어 두고 안 쓰면 그것도 침묵이다.** 통산이 몇 줄 들어왔는지 보고한다 */
console.error(
  `年度別成績 타격 ${careerBat}행 · 투구 ${careerPit}행 · 실패 ${careerFailed}명 · ` +
    `통산 표가 하나도 없는 페이지 ${careerAbsent}장 · 취득시각 모름(NULL)으로 쓴 선수 ${writtenWithoutTime}명`,
);

const total = (db.raw.prepare("SELECT COUNT(*) AS n FROM player").get() as { n: number }).n;
const withHand = (
  db.raw.prepare("SELECT COUNT(*) AS n FROM player WHERE throws IS NOT NULL AND bats IS NOT NULL").get() as {
    n: number;
  }
).n;

// ⚠`failed` 에는 판 모름·DB 시각 무효도 들어 있다(종료 코드 한 식 · 설계 §5-3) — 이 줄의 「파싱 실패」는 그 둘을 뺀 수다(아래 판 가드 줄이 따로 센다)
console.log(
  `선수 페이지 ${files.length}장 · 갱신 ${updated} · DB에 없는 선수 ${missing} · 파싱 실패 ${failed - versionUnknown - dbTimeInvalid}`,
);
/**
 * ⚠**판 가드 — 0 이어도 찍는다**(감사 N3 · 설계 §5-3). 옛 판은 **실패가 아니다** — 순서를 알고 DB 를 지켰다(종료 0).
 *   재취득 대상 · 부재(상류가 페이지를 지웠다 — 받아도 404) · **선정 밖**(선정기가 영영 안 뽑는다 · 3중 검토 2차 m1)을 **나눠서** 센다.
 *   처치는 런북 §7-G. ⚠「같은 선수가 며칠 계속 찍히면 결함」이라는 판단(설계 §10-1 뒤집힐 조건)은 **재취득 대상만** 센다 —
 *   못 고치는 두 갈래는 매 실행 남는 것이 정상이다.
 * ⚠**창은 선정기와 한 벌이다**(M1 · `src/refetch-window.ts`) — 적재기는 경기 표를 안 바꾸므로 선정기가 본 창과 같다.
 *   ⚠옛 판(부재 아님)이 있을 때만 잰다 — 창 질의는 수 초 걸리고(실측 CI 사본 약 7초 · 선정기도 같은 질의를 돈다) 옛 판이 없는 날이 보통이다.
 */
const refetchable = staleProfiles.some((s) => !s.absent) ? playersInRefetchWindow(db) : new Set<string>();
const classOf = (s: { playerId: string; absent: boolean }): StaleClass =>
  s.absent ? "absent" : refetchable.has(s.playerId) ? "refetch" : "outside";
const staleCount = (cls: StaleClass): number => staleProfiles.filter((s) => classOf(s) === cls).length;
const staleRefetch = staleCount("refetch");
const staleAbsent = staleCount("absent");
const staleOutside = staleCount("outside");
console.log(
  `판 가드 — 처음 ${verdictCount.first} · 같은 본문 ${verdictCount.same} · 새 판 ${verdictCount.newer} · ` +
    `옛 판 건너뜀 ${staleProfiles.length}(재취득 대상 ${staleRefetch} · 부재라 못 고침 ${staleAbsent} · 선정 밖이라 못 고침 ${staleOutside}) · ` +
    `판 모름 건너뜀 ${versionUnknown} · DB 시각 무효 ${dbTimeInvalid} · DB 에 없는 선수 ${verdictCount["no-row"]}`,
);
if (staleProfiles.length > 0) {
  // ⚠**선수 ID 를 전부 찍는다**(한 줄 20개 · ID 순) — 자르지 않는다. 잘린 목록은 처치할 선수를 조용히 빠뜨린다
  const sorted = [...staleProfiles].sort((a, b) => (a.playerId < b.playerId ? -1 : a.playerId > b.playerId ? 1 : 0));
  const tag = { refetch: "", absent: "(부재)", outside: "(선정 밖)" } as const;
  console.log(`⚠아카이브가 DB 보다 옛 판인 선수 ${staleProfiles.length}명 — 적재하지 않았다(DB 를 지켰다)`);
  for (let i = 0; i < sorted.length; i += 20) {
    console.log(`   ${sorted.slice(i, i + 20).map((s) => `${s.playerId}${tag[classOf(s)]}`).join(", ")}`);
  }
  // ⚠러너가 주석으로 읽는다(`update.ts` 가 `stdio: "inherit"` 로 띄운다) · 로컬에서는 그냥 한 줄이다
  console.log(
    `::warning::선수 페이지 ${staleProfiles.length}장이 DB 보다 옛 판이라 적재하지 않았다 — ` +
      `재취득 대상 ${staleRefetch} · 부재라 못 고침 ${staleAbsent} · 선정 밖이라 못 고침 ${staleOutside} · 절차 docs/operations/deploy.md §7-G`,
  );
}
if (noBaseline.length > 0) {
  // ⚠**기준선 없는 행을 「이번 실행에서 받은 200」 증명으로 받았다는 사실을 남긴다**(§5-2 5번 · 반영분 재검토 P2) — 실패가 아니지만
  //   조용히 넘기지 않는다. 드물다: 사이드카가 본문을 말하지 않던 첫 적재 뒤에만 생긴다. ID 전부(자르지 않는다)
  console.log(
    `⚠순서 기준선(profile_content_at)이 없었는데 이번 실행에서 받은 판이라 새 판으로 받은 선수 ${noBaseline.length}명 — ` +
      `${[...noBaseline].sort().join(", ")} · 절차 docs/operations/deploy.md §7-G`,
  );
}
console.log(`투타 확인 ${withHand} / 전체 ${total}명 (미상 ${total - withHand}명)`);
// ⚠**분모를 같이 낸다.** 「카나 있음 737」만 내면 121명이 빠진 것인지 그런 선수가 없는 것인지 모른다.
// ⚠등번호 없음은 **결손이 아니라 「지금 등록이 없다」**(M11) — 은퇴·이적 선수다
const withKana = (db.raw.prepare("SELECT COUNT(*) AS n FROM player WHERE kana IS NOT NULL").get() as { n: number }).n;
const withNo = (db.raw.prepare("SELECT COUNT(*) AS n FROM player WHERE uniform_number IS NOT NULL").get() as { n: number }).n;
console.log(`읽는 법 ${withKana} / 전체 ${total}명 · 등번호 ${withNo} / 전체 ${total}명(없음 = 현役登録なし)`);
if (unknownPlayers.length > 0) {
  console.log(`⚠투타를 읽지 못한 선수: ${unknownPlayers.slice(0, 10).join(", ")}${unknownPlayers.length > 10 ? " …" : ""}`);
}

/**
 * ⚠**표제부는 한 장 단위로 던지지 않는다 — 여기서 집계로 멈춘다.**
 *
 * 파서가 한 장이라도 실패하면 던지게 두면, 선수 한 명의 페이지가 달라진 것만으로
 * **투타·생년월일 갱신이 스킵되고 그날 배포가 통째로 멈춘다**(`failed>0 → exit 1`).
 * 반대로 조용히 null 로 두기만 하면 마크업이 바뀐 날 **858명의 읽는 법이 한꺼번에 사라져도**
 * 아무도 모른다. 그 사이를 커버리지 임계값이 가른다.
 *
 * 실측(2026-08-17): 읽은 858장 중 읽는 법 **858장(100%)**. 여유를 두고 90%로 건다 —
 * 한두 명이 특이해도 넘어가고, 구조가 바뀌면 반드시 걸린다.
 */
const KANA_COVERAGE_MIN = 0.9;
/**
 * ⚠**분모에서 판 가드가 건너뛴 장수를 뺀다**(감사 N3 · 설계 §5-3) — 건너뛴 페이지는 파싱하지 않으므로 분자에 못 들어간다.
 *   안 빼면 옛 판을 많이 건너뛴 날 분자만 줄어 **거짓 커버리지 실패**(종료 1)가 난다. 건너뛴 것이 0 이면 지금과 글자까지 같다.
 */
const judged = files.length - (staleProfiles.length + versionUnknown + dbTimeInvalid);
const coverage = judged === 0 ? 1 : kanaRead / judged;
if (coverage < KANA_COVERAGE_MIN) {
  console.error(
    `⚠읽는 법 커버리지가 ${(coverage * 100).toFixed(1)}% (${kanaRead}/${judged}장) — ` +
      `임계값 ${KANA_COVERAGE_MIN * 100}% 미만이다. 선수 페이지의 표제부(#pc_vitals) 구조 변경을 의심하라`,
  );
}

db.close();
/**
 * ⚠**`careerFailed` 를 넣는다**(2026-08-17 이중 검토 지적).
 * 年度別成績 파싱이 깨지면 그 선수의 취입만 멈추고 **파이프라인은 성공으로 끝나고 있었다** —
 * 화면은 「1つでも合わなければ取り込みを止めます」라고 말하는데 절반만 사실이었다(M7).
 * ⚠**판 모름(`VERSION UNKNOWN`) · DB 시각 무효(`DB VERSION INVALID`)는 `failed` 로 들어간다**(종료 1 · 감사 N3) —
 *   **옛 판(`stale`)은 안 들어간다**(DB 를 지켰다 · `::warning::` · 설계 §5-5 · §10-1 조정자 결정 · 사용자 번복 가능).
 */
process.exitCode = failed > 0 || careerFailed > 0 || coverage < KANA_COVERAGE_MIN ? 1 : 0;
