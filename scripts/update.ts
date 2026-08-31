#!/usr/bin/env node
/**
 * 일일 갱신 — 수집부터 적재까지 한 번에.
 *
 *   node scripts/update.ts --contact you@example.com
 *   node scripts/update.ts --contact you@example.com --date 2026-08-16
 *
 * 하는 일:
 *   1. 그날 경기 페이지를 아카이브 (없으면 조용히 0건)
 *   2. 아카이브 → DB 적재 (멱등)
 *   3. 새로 등장한 선수의 프로필을 아카이브하고 적재
 *   4. **앞으로의 일정**을 적재 — 이미 받아 둔 월간 일정 페이지를 읽기만 한다(외부 요청 0회)
 *   5. 予告先発(선발 예고)을 아카이브하고 적재 — 경기 **전** 정보라 「오늘의 매치업」의 근거가 된다
 *   6. **신선도 보고** — 마지막 경기일이 언제인지, 며칠 전인지
 *
 * ⚠**「돌았다」가 아니라 「몇 건을 언제까지 넣었는가」를 보고한다.** 크론이 조용히
 * 안 도는 것이 이 서비스의 가장 흔한 죽음이고, 그건 성공 로그로는 구별되지 않는다.
 */
import { parseArgs } from "node:util";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { JST_TODAY_FROM_HOUR, targetDates } from "./date-window.ts";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const { values } = parseArgs({
  options: {
    contact: { type: "string" },
    date: { type: "string" },
    archive: { type: "string", default: "data/archive" },
    db: { type: "string", default: "data/bb.sqlite" },
    /**
     * 적재 1회의 쓰기 상한.
     *
     * ⚠**기본값을 둔다**(2026-08-18 감사 P2). 없으면 로더 기본값(D1 무료 한도 10만 행)이 쓰이는데,
     * 이 도구는 **아카이브 전체를 재적재**하므로 9시즌이면 86만 행이다 —
     * 문서에 적힌 사용례(`node scripts/update.ts --contact …`)가 **매번 도중에 멈춘다.**
     * 예전에는 그때도 종료 코드가 0이라 「정상 종료」로 보고됐다(그쪽도 같이 고쳤다).
     * ⚠**D1 로 옮기면 이 값을 다시 봐라** — 지금은 파일 SQLite 라 한도가 없다.
     */
    "max-writes": { type: "string", default: "5000000" },
    delay: { type: "string", default: "3000" },
    /** 며칠 이상 낡으면 경고할지 */
    "stale-days": { type: "string", default: "2" },
    /**
     * 하루에 다시 받을 선수 페이지 수의 상한.
     *
     * ⚠**상한이 있어야 한다.** 「전원이 낡은」 날이 실재한다(백필 직후·장기 중단 후) —
     * 그날 980요청을 한 번에 보내면 L1 의 정신에서 벗어난다.
     * ⚠**기본 400은 실측 기반이다**(2026-08-20 갱신 · CI DB 실측):
     * 하루에 낡는 선수는 **264명**이고 3초 간격이면 약 13분이다.
     * ⚠**「어제 뛴 선수」(약 190명)가 아니라 「최근 두 경기일에 뛴 선수」(267명)가 분모다** —
     * npb.jp 선수 페이지가 경기 다음날 02:00 JST 에도 아직 그 경기를 안 싣기 때문에
     * (실측: 08-19 01:05 JST 취득분이 08-18 경기를 안 담았다) **한 경기일당 두 번 받아야** 실린다.
     * 밀린 몫은 다음 날 받는다 — 넘친 수는 로그에 낸다(조용히 자르지 않는다).
     */
    "player-limit": { type: "string", default: "400" },
    /**
     * 오늘 경기를 **지금** 받는다(시각 판정을 넘긴다).
     *
     * ⚠**손으로 돌릴 때를 위한 것**이지 크론용이 아니다. 크론은 시각으로 판정한다 —
     * 어느 슬롯인지를 워크플로가 인자로 알려 주게 하면, 크론 표현식을 고칠 때
     * **인자를 같이 안 고쳐서** 조용히 어긋난다.
     */
    today: { type: "boolean" },
  },
});

const contact = values.contact ?? process.env["BB_ARCHIVER_CONTACT"] ?? "";
if (!contact) {
  console.error("연락처가 필요하다. --contact you@example.com 또는 BB_ARCHIVER_CONTACT (CLAUDE.md L1)");
  process.exit(2);
}

/**
 * ⚠**「어제만」이었던 것을 「어제와 오늘」로 넓혔다**(2026-08-18).
 *
 * ## 왜 어제만이었나
 *
 * 진행 중인 경기를 받으면 미확정 성적이 확정으로 저장된다(M9 위반).
 * 「경기가 끝났는가」를 판정할 방법이 없다고 보고, 대신 **구조적으로 안전한 시각**을 썼다 —
 * 자정 이후에 돌리면 어제 경기는 확실히 끝나 있다. 대가는 **경기 결과가 최대 9시간 늦는 것**이었다.
 *
 * ## 왜 바뀌었나
 *
 * ⚠**판정 방법이 실재했다.** 「종료 표시가 없다」는 것은 **일정 페이지 헤더** 얘기였고,
 * **개별 경기의 박스스코어**에는 그 경기 자신의 종료 표시가 있다:
 *
 * ```
 * 【試合終了】 ◇開始 18:00 ◇終了 21:05 ◇試合時間 3時間5分 ◇入場者 31,645人
 * ```
 *
 * 실측(2026-08-18 · 외부 접속 0회 · 아카이브 전수 **9시즌 7,630박스**): 라벨 없는 박스 **0건**.
 * `試合時間` 은 `終了 − 開始` 이라 경기가 끝나기 전에는 존재할 수 없다.
 * 파서가 그것을 보고 **끝나지 않은 박스를 `inProgress` 로 돌려주며**(M9 를 타입으로 지킨다),
 * 적재는 그것을 **저장하지 않는다.** 그래서 오늘 것을 받아도 잠정값이 섞이지 않는다.
 *
 * ⚠**날짜를 명시하면 그 하루만 받는다** — 소급 수집·재수집의 어법을 바꾸지 않는다.
 * ⚠**어제를 계속 받는 이유**: 연장·서스펜디드·늦게 끝난 경기가 있으면 그날 밤 실행이
 *   `inProgress` 로 건너뛴다. 다음 실행이 그것을 메운다. **거르면 영영 안 들어온다.**
 * ⚠**요청이 두 배가 되지 않는다**(L7): 어제 경기는 이미 받아 둔 것이라 조건부 요청으로 304 가 돌아온다.
 *
 * ⚠**판정 자체는 `scripts/date-window.ts` 한 벌**이고 **거기에 시험이 붙어 있다.**
 * 여기 두면 이 파일이 import 하는 순간 수집을 시작해서 시험할 수가 없다 —
 * 실제로 그래서 이 판단이 한 번도 검증된 적이 없었다(2026-08-18).
 */
/**
 * 이미 받아 둔 **마지막 경기일** — 따라잡기의 기준점.
 *
 * ⚠**모르면 넘기지 않는다**(M11). DB 가 아직 없거나(첫 실행) 읽지 못하면 `undefined` 이고,
 * 그러면 창은 예전과 같은 `[어제]` 다. **모르는 것을 「어제」로 메우면 빈 날이 있어도 안 메운다.**
 * ⚠**읽기 실패를 삼키지 않되 멈추지도 않는다** — 수집 자체는 DB 없이도 성립하고(아카이브가 먼저다),
 * 여기서 죽으면 **DB 가 깨진 날 수집까지 같이 멈춘다.** 그건 되돌릴 수 없는 쪽이다.
 */
function collectedThrough(): string | undefined {
  const path = join(ROOT, values.db);
  if (!existsSync(path)) {
    console.log(`  · ${values.db} 가 아직 없다 — 따라잡기 없이 어제만 받는다`);
    return undefined;
  }
  try {
    const db = new DatabaseSync(path, { readOnly: true });
    try {
      const row = db.prepare("SELECT MAX(game_date) AS d FROM game WHERE status = 'played'").get() as
        | { d: string | null }
        | undefined;
      return row?.d ?? undefined;
    } finally {
      db.close();
    }
  } catch (e) {
    console.error(`  ⚠마지막 경기일을 못 읽었다(${String(e)}) — 따라잡기 없이 어제만 받는다`);
    return undefined;
  }
}

const since = values.date === undefined ? collectedThrough() : undefined;
const dates = targetDates(new Date(), {
  ...(values.date === undefined ? {} : { date: values.date }),
  ...(values.today === true ? { forceToday: true } : {}),
  ...(since === undefined ? {} : { collectedThrough: since }),
});
console.log(
  `대상 경기일 ${dates.join(" · ")}` +
    (values.date !== undefined
      ? ""
      : dates.length > 1
        ? " (어제와 오늘 JST · 끝나지 않은 경기는 저장하지 않는다)"
        : ` (어제 JST · 오늘 것은 ${JST_TODAY_FROM_HOUR}시 이후 실행에서 받는다)`),
);
// ⚠**기준점을 말한다.** 창이 조용히 넓어지면 「왜 오늘 요청이 많지」에 아무도 답할 수 없다.
//   위 「대상 경기일」 줄과 나란히 읽으면 넓어졌는지가 그 자리에서 보인다.
if (since !== undefined) console.log(`  · 마지막으로 받아 둔 경기일 ${since}`);

function run(label: string, args: string[]): number {
  console.log(`\n── ${label} ──`);
  const r = spawnSync(process.execPath, args, { cwd: ROOT, stdio: "inherit" });
  if (r.status !== 0) console.error(`  ⚠${label} 종료 코드 ${r.status}`);
  return r.status ?? 1;
}

let failures = 0;

// 1. 경기 페이지
// ⚠**날짜마다 따로 센다.** 한 날이 실패해도 다른 날은 받는다 — 부분 실패를 전체 실패로 만들지 않는다
for (const d of dates) {
  failures += run(`경기 아카이브 ${d}`, [
    "packages/archiver/src/cli.ts",
    "--date", d,
    "--out", values.archive,
    "--contact", contact,
    "--delay", values.delay,
  ]) === 0 ? 0 : 1;
}

// 2. 적재
failures += run("DB 적재", [
  "packages/store/tools/load-archive.ts",
  values.archive,
  values.db,
  ...(values["max-writes"] === undefined ? [] : ["--max-writes", values["max-writes"]]),
]) === 0 ? 0 : 1;

/**
 * 3. 선수 프로필.
 *
 * ⚠**두 단계다. 순서가 중요하다.**
 * 3-1) **낡은 페이지를 다시 받는다**(`--refresh`). 여기가 통산 기록의 신선도를 지키는 자리다.
 * 3-2) 그 다음 **아직 한 번도 못 받은 페이지**를 받는다(기존 파일은 건너뛴다).
 *
 * ⚠**3-1 이 없어서 통산이 조용히 낡았다**(2026-08-17). 아카이버는 `skipExisting` 이 기본이라
 * 한 번 받은 선수 페이지를 **다시 받지 않았다** — 실측 당시 698장이 8/15에 멈춰 있었고
 * 이미 안타 213·홈런 25가 밀려 있었다. 화면은 그것을 **「NPB 가 늦다」고 오진**했다.
 * ⚠**그리고 3-1 의 선정식 자체가 절반만 들었다**(2026-08-20). 날짜로 판정하던 때는
 * 「출장 다음날에 받았지만 그 경기가 아직 안 실린 사본」을 최신으로 봤고, 그 선수가 그 뒤로
 * 안 뛰면 **영영 안 고쳐졌다**(실측 1,643명 중 264명). 지금은 **사본의 출장량을 우리 집계와
 * 맞대서** 판정한다 — 자세한 근거는 `emit-stale-player-ids.ts` 머리주석.
 * ⚠**순서를 바꾸면 같은 선수를 하루에 두 번 받는다**(L1) — 3-1 이 먼저 받아 두면
 * 3-2 의 `skipExisting` 이 그것을 건너뛴다.
 */
const staleFile = join(ROOT, "data", "stale-player-ids.txt");
const stale = spawnSync(
  process.execPath,
  ["packages/store/tools/emit-stale-player-ids.ts", values.db, "--limit", values["player-limit"]],
  { cwd: ROOT, encoding: "utf8" },
);
if (stale.stderr) console.log(`  낡은 선수 페이지: ${stale.stderr.trim()}`);
if (stale.status === 0 && stale.stdout.trim() !== "") {
  const { writeFileSync } = await import("node:fs");
  writeFileSync(staleFile, stale.stdout, "utf8");
  failures += run("낡은 선수 프로필 재취득", [
    "packages/archiver/src/cli-players.ts",
    "--ids", staleFile,
    "--out", values.archive,
    "--contact", contact,
    "--delay", values.delay,
    "--refresh",
  ]) === 0 ? 0 : 1;
} else if (stale.status !== 0) {
  console.error("낡은 선수 목록을 만들지 못했다 — 재취득을 건너뛴다");
  failures += 1;
}

const idsFile = join(ROOT, "data", "player-ids.txt");
const emit = spawnSync(process.execPath, ["packages/store/tools/emit-player-ids.ts", values.db], {
  cwd: ROOT,
  encoding: "utf8",
});
if (emit.status === 0 && emit.stdout) {
  const { writeFileSync } = await import("node:fs");
  writeFileSync(idsFile, emit.stdout, "utf8");
  failures += run("신규 선수 프로필", [
    "packages/archiver/src/cli-players.ts",
    "--ids", idsFile,
    "--out", values.archive,
    "--contact", contact,
    "--delay", values.delay,
  ]) === 0 ? 0 : 1;
  failures += run("선수 프로필 적재", [
    "packages/store/tools/load-players.ts",
    values.archive,
    values.db,
  ]) === 0 ? 0 : 1;
} else {
  console.error("선수 ID 목록을 만들지 못했다 — 프로필 갱신을 건너뛴다");
  failures += 1;
}

/**
 * 4. 앞으로의 일정.
 *
 * ⚠**외부 요청 0회다** — 경기 아카이버가 대상 날짜의 달을 받으면서 **월 단위로 통째** 저장해
 * 두었고, 이 단계는 그걸 읽기만 한다(§2-2-1 「받고 있는데 안 읽던 것」).
 * ⚠**경기 적재 뒤에 둔다** — 치러진 경기가 먼저 들어와야 일정에서 빠질 것이 정해진다.
 * ⚠**시즌은 대상 날짜에서 낸다.** 벽시계를 읽지 않는다(M6).
 */
failures += run("앞으로의 일정 적재", [
  "packages/store/tools/load-upcoming.ts",
  values.archive,
  values.db,
  // ⚠**가장 늦은 대상일의 해**를 쓴다. 연말에 어제와 오늘의 해가 갈릴 수 있다
  dates[dates.length - 1]!.slice(0, 4),
]) === 0 ? 0 : 1;

// 5. 予告先発 — 하루 1요청. ⚠거르면 그날 예고는 영영 못 받는다(페이지가 하루치만 보여준다)
failures += run("予告先発 아카이브", [
  "packages/archiver/src/cli-starters.ts",
  "--out", values.archive,
  "--contact", contact,
  "--delay", values.delay,
]) === 0 ? 0 : 1;
failures += run("予告先発 적재", [
  "packages/store/tools/load-starters.ts",
  values.archive,
  values.db,
]) === 0 ? 0 : 1;

// 6. 신선도 보고
console.log(`\n── 신선도 ──`);
const freshness = spawnSync(
  process.execPath,
  ["scripts/freshness.ts", values.db, values["stale-days"]!],
  { cwd: ROOT, stdio: "inherit" },
);
if (freshness.status !== 0) failures += 1;

console.log(`\n${failures === 0 ? "정상 종료" : `⚠실패 단계 ${failures}건`}`);
process.exitCode = failures > 0 ? 1 : 0;
