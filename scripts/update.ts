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
 *   4. 予告先発(선발 예고)을 아카이브하고 적재 — 경기 **전** 정보라 「오늘의 매치업」의 근거가 된다
 *   5. **신선도 보고** — 마지막 경기일이 언제인지, 며칠 전인지
 *
 * ⚠**「돌았다」가 아니라 「몇 건을 언제까지 넣었는가」를 보고한다.** 크론이 조용히
 * 안 도는 것이 이 서비스의 가장 흔한 죽음이고, 그건 성공 로그로는 구별되지 않는다.
 */
import { parseArgs } from "node:util";
import { spawnSync } from "node:child_process";
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
     * ⚠**기본값은 D1 무료 한도(10만 행)다.** 지금 화면은 정적 사이트라 D1을 쓰지 않지만,
     * 옮길 때를 대비한 안전장치라 **기본값은 그대로 둔다.**
     * ⚠그런데 이 작업은 **아카이브 전체를 재적재**한다(파서 수정이 옛 행에도 반영되게 하려고).
     * 2시즌이면 169,800행이라 기본값에서는 도중에 멈추고, 매번 앞에서부터 훑으므로
     * **영원히 끝에 도달하지 못한다.** 그래서 전체 재적재를 하는 쪽이 상한을 명시한다.
     */
    "max-writes": { type: "string" },
    delay: { type: "string", default: "3000" },
    /** 며칠 이상 낡으면 경고할지 */
    "stale-days": { type: "string", default: "2" },
  },
});

const contact = values.contact ?? process.env["BB_ARCHIVER_CONTACT"] ?? "";
if (!contact) {
  console.error("연락처가 필요하다. --contact you@example.com 또는 BB_ARCHIVER_CONTACT (CLAUDE.md L1)");
  process.exit(2);
}

/**
 * ⚠**기본 대상은 오늘이 아니라 「어제」다.**
 *
 * 진행 중인 경기를 받으면 미확정 성적이 `final`로 저장된다(M9 위반).
 * npb.jp의 경기 페이지에는 **그 경기 자신의 종료 여부를 가리키는 안정된 표시가 없다**
 * (헤더의 「試合終了」는 그날 전 경기 목록이라 구별되지 않는다).
 * 감지기를 추측으로 만드는 대신 **구조적으로 안전한 시각**을 쓴다 —
 * 자정 이후에 돌리면 어제 경기는 확실히 끝나 있다.
 *
 * 만약 진행 중에 받아버려도 **수집은 멱등이고 내용 해시로 판정하므로**
 * 다음 실행에서 확정판으로 갱신된다. 낡은 값이 몇 시간 보일 뿐 영구 오염은 아니다.
 */
function yesterdayJst(): string {
  const jst = new Date(Date.now() + 9 * 60 * 60 * 1000 - 24 * 60 * 60 * 1000);
  return jst.toISOString().slice(0, 10);
}
const targetDate = values.date ?? yesterdayJst();
console.log(`대상 경기일 ${targetDate}${values.date === undefined ? " (기본값: 어제 JST)" : ""}`);

function run(label: string, args: string[]): number {
  console.log(`\n── ${label} ──`);
  const r = spawnSync(process.execPath, args, { cwd: ROOT, stdio: "inherit" });
  if (r.status !== 0) console.error(`  ⚠${label} 종료 코드 ${r.status}`);
  return r.status ?? 1;
}

let failures = 0;

// 1. 경기 페이지
failures += run("경기 아카이브", [
  "packages/archiver/src/cli.ts",
  "--date", targetDate,
  "--out", values.archive,
  "--contact", contact,
  "--delay", values.delay,
]) === 0 ? 0 : 1;

// 2. 적재
failures += run("DB 적재", [
  "packages/store/tools/load-archive.ts",
  values.archive,
  values.db,
  ...(values["max-writes"] === undefined ? [] : ["--max-writes", values["max-writes"]]),
]) === 0 ? 0 : 1;

// 3. 새 선수 프로필 (이미 받은 선수는 건너뛴다)
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

// 4. 予告先発 — 하루 1요청. ⚠거르면 그날 예고는 영영 못 받는다(페이지가 하루치만 보여준다)
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

// 5. 신선도 보고
console.log(`\n── 신선도 ──`);
const freshness = spawnSync(
  process.execPath,
  ["scripts/freshness.ts", values.db, values["stale-days"]!],
  { cwd: ROOT, stdio: "inherit" },
);
if (freshness.status !== 0) failures += 1;

console.log(`\n${failures === 0 ? "정상 종료" : `⚠실패 단계 ${failures}건`}`);
process.exitCode = failures > 0 ? 1 : 0;
