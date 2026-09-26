/**
 * **덜 받은 날의 판정 I/O 를 실제로 돌린다**(감사 C10 · 3중 검토 2차 F1 · 3차 P2).
 *
 * ⚠**왜 실행 시험인가.** 판정 I/O 가 `update.ts` 안에 있을 때는 import 하는 순간 수집을 시작해서 소스 모양만 볼 수 있었고,
 *   그래서 `update.ts` 사본에 넣은 변이 5개가 **전부 초록**이었다(2차 F1) — 그중 `archived.push(g.gameId)`→`push(e.name)` 은
 *   **모든 날을 「덜 받음」으로 만들어 요청을 늘리는데** 아무 시험도 못 잡았다(L1). 그래서 I/O 를 import 해도 부작용 없는
 *   `scripts/collected-through.ts` 로 떼고, 여기서 **임시 SQLite(실제 스키마 — `openDb` 마이그레이션 + `upsertGame`)와
 *   임시 아카이브**로 돌린다. 최소 표를 손으로 만들면 실제 칸 이름이 바뀌어도 초록이 된다.
 * ⚠시계는 안 읽는다(M6) — 「지금」은 고정값이다: 07:00 JST 08-19 · 어제 08-18 · 판정 범위 아래 끝 08-11.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { openDb } from "../../packages/store/src/db.ts";
import { upsertGame } from "../../packages/store/src/load.ts";
import { gameFromBoxPath } from "../../packages/store/src/game-slug.ts";
import { catchupNotes, readCollectedThrough } from "../collected-through.ts";
import type { CollectedThrough, Note } from "../collected-through.ts";
import { targetDates } from "../date-window.ts";

const NOW = new Date("2026-08-18T22:00:00Z");
const STAMP = "2026-08-18T12:00:00.000Z";

/** `2026-08-16` + `b-f-21` → `2026/0816/b-f-21` */
const gid = (date: string, slug: string): string => `${date.slice(0, 4)}/${date.slice(5, 7)}${date.slice(8, 10)}/${slug}`;

type Row = readonly [id: string, status?: "played" | "notPlayed"];
interface Setup {
  /** DB 경기 행(실제 스키마) */
  rows?: readonly Row[];
  /** `box.html.gz` 가 든 경기 폴더 */
  folders?: readonly string[];
  /** 그 밖의 아카이브 모양(잡 폴더 · 파일 자리 등) */
  extra?: (archiveRoot: string) => void;
  /** 실제 스키마 대신 쓸 DB(표 없음 · 표 모양 다름) */
  rawDb?: (db: DatabaseSync) => void;
  /** DB 파일을 만들지 않는다 */
  noDb?: boolean;
}

function dayDir(archiveRoot: string, date: string): string {
  return join(archiveRoot, "npb", "scores", date.slice(0, 4), `${date.slice(5, 7)}${date.slice(8, 10)}`);
}

function withFixture<T>(s: Setup, fn: (f: { dbPath: string; archiveRoot: string }) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "bb-ct-"));
  try {
    const dbPath = join(dir, "bb.sqlite");
    const archiveRoot = join(dir, "archive");
    mkdirSync(archiveRoot);
    if (s.rawDb !== undefined) {
      const raw = new DatabaseSync(dbPath);
      try {
        s.rawDb(raw);
      } finally {
        raw.close();
      }
    } else if (s.noDb !== true) {
      const db = openDb(dbPath, STAMP);
      try {
        for (const [id, status = "played"] of s.rows ?? []) {
          const g = gameFromBoxPath(`x/scores/${id}/box.html.gz`);
          assert.ok(g !== null, `시험 자료의 경기 id 가 틀렸다: ${id}`);
          upsertGame(db, {
            gameId: id, season: g.season, gameDate: g.gameDate, awayCode: g.awaySlug, homeCode: g.homeSlug, gameNo: g.gameNo,
            status, notPlayedReason: status === "notPlayed" ? "雨天中止" : null, competition: "regular", series: null,
            sourceUrl: "https://example.invalid/", fetchedAt: STAMP,
          });
        }
      } finally {
        db.raw.close();
      }
    }
    for (const id of s.folders ?? []) {
      const d = join(archiveRoot, "npb", "scores", ...id.split("/"));
      mkdirSync(d, { recursive: true });
      writeFileSync(join(d, "box.html.gz"), "");
    }
    s.extra?.(archiveRoot);
    return fn({ dbPath, archiveRoot });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function read(s: Setup, now: Date = NOW): { collected: CollectedThrough | undefined; notes: Note[] } {
  return withFixture(s, (f) => readCollectedThrough({ dbPath: f.dbPath, archiveRoot: f.archiveRoot, now }));
}

/** 판정 결과를 창까지 끌고 간다 — `update.ts` 가 하는 그대로(`include` 없는 창 = 원래 창) */
function windows(c: CollectedThrough, now: Date = NOW): { base: string[]; dates: string[] } {
  return {
    base: targetDates(now, { collectedThrough: c.since }),
    dates: targetDates(now, { collectedThrough: c.since, include: c.include }),
  };
}

const D15 = "2026-08-15", D16 = "2026-08-16", D17 = "2026-08-17", D18 = "2026-08-18";

test("C10 완결 — 판정 범위의 날마다 폴더 = 행이면 더하는 날이 없고 알림도 없다 · 창은 예전과 같다(요청 0 증가)", () => {
  const ids = [gid(D15, "b-f-21"), gid(D15, "c-t-18"), gid(D16, "b-f-22"), gid(D16, "c-t-19")];
  const { collected, notes } = read({ rows: ids.map((id) => [id] as const), folders: ids });
  assert.ok(collected !== undefined);
  assert.equal(collected.since, D16);
  assert.deepEqual(collected.include, []);
  assert.deepEqual(collected.days.map((d) => [d.date, d.status]), [[D15, "complete"], [D16, "complete"]], "폴더가 있는 날만 판정한다");
  assert.deepEqual(notes, []);
  const w = windows(collected);
  assert.deepEqual(w.dates, w.base, "완결인데 창이 넓어졌다");
});

test("⚠C10 덜 받음 — 폴더는 있는데 행이 없는 경기가 있으면 그날을 더하고 그 id 를 말한다", () => {
  const { collected, notes } = read({ rows: [[gid(D16, "b-f-22")]], folders: [gid(D16, "b-f-22"), gid(D16, "c-t-19")] });
  assert.ok(collected !== undefined);
  assert.deepEqual(collected.include, [D16]);
  assert.deepEqual(collected.days, [{ date: D16, status: "incomplete", missing: [gid(D16, "c-t-19")], reason: null }]);
  assert.deepEqual(notes, []);
});

test("⚠C10 box.html.gz 가 없는 폴더는 경기가 아니다 — 다른 페이지만 있는 폴더를 세면 매 실행 그날을 다시 받는다", () => {
  const { collected } = read({
    rows: [[gid(D16, "b-f-22")]],
    folders: [gid(D16, "b-f-22")],
    extra: (root) => {
      const d = join(dayDir(root, D16), "c-t-19");
      mkdirSync(d, { recursive: true });
      writeFileSync(join(d, "index.html.gz"), "");
      writeFileSync(join(d, "box.html.gz.123.tmp"), "");
    },
  });
  assert.ok(collected !== undefined);
  assert.deepEqual(collected.include, [], "box 없는 폴더를 경기로 셌다");
});

test("⚠C10 잡 폴더(`.staging` · 2조각 · 마지막이 수가 아님)와 파일은 경기가 아니다 — 적재기와 같은 판정(D2)", () => {
  const { collected } = read({
    rows: [[gid(D16, "b-f-22")]],
    folders: [gid(D16, "b-f-22")],
    extra: (root) => {
      for (const name of [".staging", "b-21", "b-f-x"]) {
        mkdirSync(join(dayDir(root, D16), name), { recursive: true });
        writeFileSync(join(dayDir(root, D16), name, "box.html.gz"), "");
      }
      writeFileSync(join(dayDir(root, D16), "notes.txt"), "");
    },
  });
  assert.ok(collected !== undefined);
  assert.deepEqual(collected.include, [], "적재기가 경기로 안 보는 폴더를 셌다");
  assert.deepEqual(collected.days.map((d) => d.status), ["complete"]);
});

/**
 * ⚠**그날 폴더가 없는데 DB 에 행이 있으면 경고 한 줄**(3중 검토 2차 F2) — 아카이브 손실이나 `--archive` 설정 오류의 신호다.
 * 판정은 **완결**(요청을 늘리지 않는 쪽)이고, 경기가 없는 날(폴더도 행도 없음)은 조용하다.
 */
test("⚠C10 ENOENT — 그날 폴더가 없으면 판정하지 않고(완결 쪽) · DB 에 행이 있는 날만 경고 한 줄로 모아 말한다", () => {
  const { collected, notes } = read({
    rows: [[gid(D15, "b-f-21")], [gid(D15, "c-t-18")], [gid(D16, "b-f-22")]],
    folders: [gid(D16, "b-f-22")],
  });
  assert.ok(collected !== undefined);
  assert.deepEqual(collected.include, []);
  assert.deepEqual(collected.noFolder, [{ date: D15, rows: 2 }]);
  assert.deepEqual(collected.days.map((d) => d.date), [D16], "폴더가 없는 날을 판정했다");
  assert.equal(notes.length, 1, `경고가 ${notes.length}줄이다(한 줄이어야 한다)`);
  assert.equal(notes[0]!.level, "warn");
  assert.match(notes[0]!.text, /2026-08-15/);
  assert.match(notes[0]!.text, /아카이브 손실|--archive/);
});

test("⚠C10 ENOTDIR — 그날 자리가 파일이면 그날만 모름(넓히지 않는다) · 나머지 날은 판정한다", () => {
  const { collected, notes } = read({
    rows: [[gid(D15, "b-f-21")], [gid(D16, "b-f-22")]],
    folders: [gid(D16, "b-f-22"), gid(D16, "c-t-19")],
    extra: (root) => {
      mkdirSync(join(root, "npb", "scores", "2026"), { recursive: true });
      writeFileSync(dayDir(root, D15), "");
    },
  });
  assert.ok(collected !== undefined);
  assert.deepEqual(collected.include, [D16], "모르는 날을 더했거나 아는 날을 뺐다");
  const d15 = collected.days.find((d) => d.date === D15);
  assert.equal(d15?.status, "unknown");
  assert.match(d15?.reason ?? "", /ENOTDIR/);
  assert.ok(notes.some((n) => n.level === "warn" && n.text.includes(D15) && n.text.includes("모른다")), "모름을 말하지 않는다");
});

test("⚠C10 game 표가 없으면 마지막 경기일을 못 읽는다 — 판정 없음(undefined) · 경고", () => {
  const { collected, notes } = read({ rawDb: (db) => db.exec("CREATE TABLE other (a TEXT)") });
  assert.equal(collected, undefined);
  assert.equal(notes.length, 1);
  assert.equal(notes[0]!.level, "warn");
  assert.match(notes[0]!.text, /마지막 경기일을 못 읽었다/);
});

test("⚠C10 마지막 경기일이 YYYY-MM-DD 가 아니면 판정하지 않는다 — 모르는 기준점으로 범위를 만들지 않는다(M11)", () => {
  const { collected, notes } = read({
    rawDb: (db) => {
      db.exec("CREATE TABLE game (game_id TEXT, game_date TEXT, status TEXT)");
      db.exec("INSERT INTO game VALUES ('2026/0816/b-f-22', '2026/08/16', 'played')");
    },
  });
  assert.equal(collected, undefined);
  assert.equal(notes.length, 1);
  assert.match(notes[0]!.text, /YYYY-MM-DD/);
});

test("⚠C10 여러 날이 덜 받혔으면 전부 더한다(오름차순)", () => {
  const { collected } = read({
    rows: [[gid("2026-08-13", "b-f-19")], [gid(D15, "c-t-18")], [gid(D16, "e-g-20")]],
    folders: [gid("2026-08-13", "b-f-19"), gid("2026-08-13", "l-m-18"), gid(D15, "c-t-18"), gid(D16, "e-g-20"), gid(D16, "h-s-20")],
  });
  assert.ok(collected !== undefined);
  assert.deepEqual(collected.include, ["2026-08-13", D16]);
});

/**
 * ⚠**부분 실패**(3중 검토 3차 P2 · 2차 F3). 한 실행 안에서 08-16 의 재수집은 실패하고 08-17 은 성공해 `since` 가 08-17 로 전진했다.
 * 예전 판정(since 하나만)은 08-17 이 완결이라 **08-16 을 영영 다시 안 봤다.**
 */
test("⚠C10 부분 실패 — D 덜 받음 · D+1 완결(since = D+1)이어도 D 가 창에 든다", () => {
  const { collected } = read({
    rows: [[gid(D16, "b-f-22")], [gid(D17, "b-f-23")], [gid(D17, "c-t-20")]],
    folders: [gid(D16, "b-f-22"), gid(D16, "c-t-19"), gid(D17, "b-f-23"), gid(D17, "c-t-20")],
  });
  assert.ok(collected !== undefined);
  assert.equal(collected.since, D17);
  assert.deepEqual(collected.include, [D16]);
  const w = windows(collected);
  assert.deepEqual(w.base, [D18], "전제(예전 창)가 틀렸다");
  assert.deepEqual(w.dates, [D16, D18], "덜 받은 08-16 이 창에 없다");
});

test("⚠C10 판정 범위의 경계 — 어제 − 상한(08-11)은 보고 · 그 앞(08-10)은 안 본다", () => {
  const { collected } = read({
    rows: [[gid("2026-08-10", "b-f-15")], [gid("2026-08-11", "c-t-15")], [gid(D16, "e-g-20")]],
    folders: [gid("2026-08-10", "b-f-15"), gid("2026-08-10", "h-s-15"), gid("2026-08-11", "c-t-15"), gid("2026-08-11", "d-g-15"), gid(D16, "e-g-20")],
  });
  assert.ok(collected !== undefined);
  assert.deepEqual(collected.include, ["2026-08-11"]);
  assert.ok(!collected.days.some((d) => d.date === "2026-08-10"), "판정 범위 밖(08-10)을 봤다");
});

test("⚠C10 간격이 상한을 넘으면 판정하지 않는다 — 백필은 사람의 일", () => {
  const { collected, notes } = read({
    rows: [[gid("2026-08-10", "b-f-15")]],
    folders: [gid("2026-08-10", "b-f-15"), gid("2026-08-10", "h-s-15")],
  });
  assert.ok(collected !== undefined);
  assert.equal(collected.since, "2026-08-10");
  assert.deepEqual(collected.include, []);
  assert.deepEqual(collected.days, []);
  assert.deepEqual(notes, []);
});

test("⚠C10 DB 의 경기 목록을 못 읽으면 넓히지 않는다 — 빈 목록으로 두면 모든 날을 덜 받음으로 오판한다 · since 는 지킨다", () => {
  const { collected, notes } = read({
    rawDb: (db) => {
      db.exec("CREATE TABLE game (game_date TEXT, status TEXT)");
      db.exec("INSERT INTO game VALUES ('2026-08-16', 'played')");
    },
    folders: [gid(D16, "b-f-22")],
  });
  assert.ok(collected !== undefined, "since 까지 버렸다 — 빠진 날 메우기가 꺼진다");
  assert.equal(collected.since, D16);
  assert.deepEqual(collected.include, [], "못 읽은 DB 목록을 빈 목록으로 봤다");
  assert.equal(notes.length, 1);
  assert.equal(notes[0]!.level, "warn");
  assert.match(notes[0]!.text, /DB 의 경기 목록을 못 읽었다/);
});

test("C10 미성립 행도 행이다 — 상태 무관(비 온 날마다 덜 받음이 되지 않는다)", () => {
  const { collected } = read({
    rows: [[gid(D16, "b-f-22")], [gid(D16, "c-t-19"), "notPlayed"]],
    folders: [gid(D16, "b-f-22"), gid(D16, "c-t-19")],
  });
  assert.ok(collected !== undefined);
  assert.deepEqual(collected.include, []);
});

test("C10 DB 가 없으면 판정 없음 · 안내 한 줄(첫 실행)", () => {
  const { collected, notes } = read({ noDb: true, folders: [gid(D16, "b-f-22")] });
  assert.equal(collected, undefined);
  assert.equal(notes.length, 1);
  assert.equal(notes[0]!.level, "info");
  assert.match(notes[0]!.text, /아직 없다/);
});

test("C10 치러진 경기가 없는 DB 면 판정 없음 · 알림 없음", () => {
  const { collected, notes } = read({ rows: [[gid(D16, "b-f-22"), "notPlayed"]], folders: [gid(D16, "b-f-22")] });
  assert.equal(collected, undefined);
  assert.deepEqual(notes, []);
});

/** ⚠**음수 간격**(since 가 어제보다 뒤 — 밤 실행 뒤 재실행) — 판정은 어제까지만 한다. 오늘은 22시 이후 실행의 몫이다 */
test("⚠C10 since 가 어제보다 뒤여도 어제까지만 판정한다 · 어제는 원래 창에 있으니 「다시 받는다」를 말하지 않는다", () => {
  const { collected } = read({
    rows: [[gid(D18, "b-f-24")], [gid("2026-08-19", "c-t-21")]],
    folders: [gid(D18, "b-f-24"), gid(D18, "d-g-22"), gid("2026-08-19", "c-t-21"), gid("2026-08-19", "e-s-22")],
  });
  assert.ok(collected !== undefined);
  assert.equal(collected.since, "2026-08-19");
  assert.deepEqual(collected.include, [D18]);
  assert.ok(!collected.days.some((d) => d.date === "2026-08-19"), "오늘(08-19)을 판정했다");
  const w = windows(collected);
  assert.deepEqual(w.dates, w.base, "어제는 원래 창에 있다 — 창이 달라지면 안 된다");
  assert.deepEqual(catchupNotes(collected, w.base, w.dates), [], "원래 창에 있던 날을 「다시 받는다」고 말했다(요청 수를 셀 때 오독한다)");
});

/** ⚠**새로 더한 날만 말한다**(3중 검토 2차 Minor) — 로그로 요청 수를 셀 때 오독하지 않게 */
test("⚠C10 알림은 새로 더한 날만 — 날짜 · 건수 · 그 id · 「다시 받는다」", () => {
  const { collected } = read({
    rows: [[gid(D16, "b-f-22")], [gid(D17, "b-f-23")]],
    folders: [gid(D16, "b-f-22"), gid(D16, "c-t-19"), gid(D17, "b-f-23")],
  });
  assert.ok(collected !== undefined);
  const w = windows(collected);
  const notes = catchupNotes(collected, w.base, w.dates);
  assert.equal(notes.length, 1);
  assert.equal(notes[0]!.level, "info");
  for (const part of [D16, "1건", gid(D16, "c-t-19"), "다시 받는다"]) assert.ok(notes[0]!.text.includes(part), `알림에 ${part} 가 없다: ${notes[0]!.text}`);
});

/**
 * ⚠**I1** — `update.ts`(수집 오케스트레이터)가 이 모듈을 가져온다. store **배럴**을 가져오면 parser·domain 까지 평가돼
 * 무관한 모듈의 로드 오류가 수집을 시작 전에 죽인다. 잎 서브패스만 허용한다. ⚠M6(시계)은 `clock-injection.test.ts` 가 전 파일을 센다.
 */
test("⚠I1 collected-through.ts 는 store 배럴을 가져오지 않는다 — @bb-app 가져오기는 잎 game-slug 하나뿐이다", () => {
  const src = readFileSync(new URL("../collected-through.ts", import.meta.url), "utf8")
    .replace(/\r\n/g, "\n")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(?<!:)\/\/[^\n]*/g, "");
  // ⚠`from "…"` 만 보면 부수효과 가져오기(`import "@bb-app/store";`)와 동적 가져오기(`import("…")`)를 놓친다 — 지정자 전체를 본다
  const specifiers = [
    ...src.matchAll(/\bimport\b[^"'`;]*["']([^"']+)["']/g),
    ...src.matchAll(/\bexport\b[^"'`;]*\bfrom\s*["']([^"']+)["']/g),
  ].map((m) => m[1]!);
  assert.ok(specifiers.includes("./date-window.ts"), `가져오기를 못 찾았다(${specifiers.join(", ")}) — 이 시험이 공회전한다`);
  assert.deepEqual(specifiers.filter((s) => s.startsWith("@bb-app/")), ["@bb-app/store/game-slug"], "잎 서브패스 밖의 @bb-app 모듈을 가져온다");
});

test("⚠C10 덜 받은 날이 창에 없으면 경고한다 — 판정 범위와 창 규칙이 어긋난 결함의 신호(조용히 넘기지 않는다)", () => {
  const c: CollectedThrough = {
    since: D16,
    include: [D15],
    days: [{ date: D15, status: "incomplete", missing: [gid(D15, "b-f-21")], reason: null }],
    noFolder: [],
  };
  const notes = catchupNotes(c, [D18], [D18]);
  assert.equal(notes.length, 1);
  assert.equal(notes[0]!.level, "warn");
  assert.match(notes[0]!.text, /2026-08-15/);
});
