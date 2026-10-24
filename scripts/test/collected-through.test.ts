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
  /** 실제 스키마(`openDb`)에 경기 행을 넣은 **뒤** 손댄다 — 일정 증거 행을 넣거나 표를 망가뜨린다(PR-2b T5) */
  after?: (db: DatabaseSync) => void;
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
        s.after?.(db.raw);
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
test("⚠I1 collected-through.ts 는 store 배럴을 가져오지 않는다 — @bb-app 가져오기는 잎 game-slug · schedule-owed 둘뿐이다", () => {
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
  assert.deepEqual(
    specifiers.filter((s) => s.startsWith("@bb-app/")).sort(),
    ["@bb-app/domain/season-calendar", "@bb-app/store/game-slug", "@bb-app/store/schedule-owed"],
    "잎 서브패스 밖의 @bb-app 모듈을 가져온다",
  );
});

/**
 * ⚠⚠**비시즌 달(`NO_GAME_MONTHS`)을 잎에 넘긴다**(PR-2b 검토 P2-1 · PR-4 설계 D1-c). 12월은 그 달 일정 사본이 없어서,
 * 넘기지 않으면 확인된 휴식일이 11/30 에서 멈춰 12월 첫 주마다 사이 메우기가 는다(최대 +6 날짜 자식).
 */
test("⚠⚠P2-1 사본 없는 12월 — 12/05 07:00 JST · 마지막 경기 11/01 · 11월 사본 12/01 · 12월 사본 없음 → gapFrom 12/04", () => {
  const ID = gid("2026-11-01", "db-h-01");
  const { collected, notes } = read(
    {
      rows: [[ID]],
      folders: [ID],
      after: (db) => db.prepare("INSERT INTO schedule_month (season, month, source, fetched_at, date_rows, games, first_content) VALUES (2026, 11, 'x', ?, 30, 1, '2026-11-01')")
        .run("2026-12-01T00:00:00.000Z"),
    },
    new Date("2026-12-04T22:00:00Z"),
  );
  assert.ok(collected !== undefined);
  assert.equal(collected.since, "2026-11-01");
  assert.equal(collected.gapFrom, "2026-12-04", "사본 없는 12월에서 확인이 멈췄다 — 비시즌 달을 잎에 안 넘겼다");
  assert.deepEqual(collected.owed, []);
  assert.deepEqual(notes, []);
});

test("⚠C10 덜 받은 날이 창에 없으면 경고한다 — 판정 범위와 창 규칙이 어긋난 결함의 신호(조용히 넘기지 않는다)", () => {
  const c: CollectedThrough = {
    since: D16,
    gapFrom: D16,
    include: [D15],
    owed: [],
    days: [{ date: D15, status: "incomplete", missing: [gid(D15, "b-f-21")], reason: null }],
    noFolder: [],
  };
  const notes = catchupNotes(c, [D18], [D18]);
  assert.equal(notes.length, 1);
  assert.equal(notes[0]!.level, "warn");
  assert.match(notes[0]!.text, /2026-08-15/);
});

/**
 * ## ⚠받았어야 할 날(owed) · 확인된 휴식일(gapFrom) — 읽기 계약 (PR-2b · 설계 `docs/superpowers/specs/2026-10-24-catchup-owed-days-design.md` D3 · 시험 T5)
 *
 * owed·gapFrom 쿼리는 **기존 BEGIN…COMMIT 안 · 같은 연결 · 같은 스냅숏**에서 돈다. 오류 행렬(설계 D3 표) 네 줄:
 * | 상황 | collected | gapFrom / owed | 경고 |
 * | DB 없음 · 열기 실패 · MAX 실패 · MAX NULL · since 모양 틀림 | undefined(현행) | 없음 — **모르면 owed 를 더하지 않는다** | 현행 |
 * | 경기 목록(C10) 실패 | {since, include:[]}(현행) | since · [] | 현행 + 「owed 도 못 구했다」 |
 * | 일정 증거 쿼리 실패 | {since, include} 보존 | since · [] | 「일정 증거를 못 읽었다 — 따라잡기는 예전 규칙」 |
 * | 증거 표가 비었음 | 정상 | since · [] | 없음 |
 */

/** 07:00 JST 2026-11-03 — 어제 11/02 · 판정 범위 아래 끝 10/26(since 10/17 은 그보다 이르다 → C10 판정 0일) */
const NOV3 = new Date("2026-11-02T22:00:00Z");
/** 최신 CI DB 사본의 10월·11월 사본 본 시각(JST 2026-10-21 18:50) */
const SEEN_1021 = "2026-10-21T09:50:36.996Z";
const JS_DATES = ["2026-10-24", "2026-10-25", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-31", "2026-11-01"] as const;

/** 최신 CI DB 의 모양 — 마지막 경기 10/17 · 사본 10/21(첫 내용일 10/01 · 11/01) · 일본시리즈 예정 7일(경기 행 없음) */
function seedOutage(db: DatabaseSync): void {
  const month = db.prepare("INSERT INTO schedule_month (season, month, source, fetched_at, date_rows, games, first_content) VALUES (2026, ?, 'x', ?, 31, 1, ?)");
  month.run(10, SEEN_1021, "2026-10-01");
  month.run(11, SEEN_1021, "2026-11-01");
  db.prepare("INSERT INTO schedule_played (season, game_date, home_code, away_code, seq, source, fetched_at) VALUES (2026, '2026-10-17', 'h', 'f', 0, 'x', ?)").run(STAMP);
  const up = db.prepare(
    "INSERT INTO upcoming_game (season, game_date, home_code, away_code, seq, venue, start_time, source, fetched_at) VALUES (2026, ?, 'db', 'h', 0, '', '18:00', 'x', ?)",
  );
  for (const d of JS_DATES) up.run(d, SEEN_1021);
}
const ROW_1017: Row = [gid("2026-10-17", "h-f-01")];

test("⚠⚠T5 owed — 장애 뒤 첫 실행(11/03 07:00 JST): 받았어야 할 날 7일 + 확인된 휴식일 끝 10/20 · C10 판정 0일 · 알림 없음", () => {
  const { collected, notes } = read({ rows: [ROW_1017], folders: [ROW_1017[0]], after: seedOutage }, NOV3);
  assert.ok(collected !== undefined);
  assert.equal(collected.since, "2026-10-17");
  assert.equal(collected.gapFrom, "2026-10-20", "확인된 휴식일(10/18~10/20)을 기준점에 반영하지 않았다");
  assert.deepEqual(collected.owed.map((o) => o.date), [...JS_DATES]);
  assert.deepEqual(collected.owed.find((o) => o.date === "2026-10-31")?.reasons.map((r) => r.kind).sort(), ["month-end", "scheduled"], "⒝(월말 뒤 못 본 사본)를 못 봤다");
  assert.deepEqual([collected.include, collected.days], [[], []]);
  assert.deepEqual(notes, []);
});

test("⚠T5 owed 는 C10 판정 범위가 비어 있지 않아도 같은 스냅숏에서 구한다 — 10/25 07:00 JST · 판정 [10/17] · owed [10/24]", () => {
  const { collected, notes } = read({ rows: [ROW_1017], folders: [ROW_1017[0]], after: seedOutage }, new Date("2026-10-24T22:00:00Z"));
  assert.ok(collected !== undefined);
  assert.deepEqual(collected.days.map((d) => [d.date, d.status]), [["2026-10-17", "complete"]]);
  assert.deepEqual(collected.owed.map((o) => o.date), ["2026-10-24"]);
  assert.equal(collected.gapFrom, "2026-10-20");
  assert.deepEqual(notes, []);
});

test("⚠⚠T5 계약 1행 — MAX(played) 가 NULL 이면 일정 증거가 있어도 collected 는 undefined · owed 를 구하지 않는다(모르면 더하지 않는다)", () => {
  const { collected, notes } = read(
    { rows: [[gid("2026-10-17", "h-f-01"), "notPlayed"]], folders: [gid("2026-10-17", "h-f-01")], after: seedOutage },
    NOV3,
  );
  assert.equal(collected, undefined, "치러진 경기가 없는데 기준점을 만들었다");
  assert.deepEqual(notes, [], "기준점이 없는데 owed 를 말했다");
});

test("⚠T5 계약 1행 — DB 파일 없음 · game 표 없음(MAX 실패) · since 모양 틀림 → collected undefined(현행 그대로)", () => {
  assert.equal(read({ noDb: true }, NOV3).collected, undefined);
  assert.equal(read({ rawDb: (db) => db.exec("CREATE TABLE other (a TEXT)") }, NOV3).collected, undefined);
  const odd = read({
    rawDb: (db) => {
      db.exec("CREATE TABLE game (game_id TEXT, game_date TEXT, status TEXT, home_code TEXT, away_code TEXT)");
      db.exec("INSERT INTO game VALUES ('2026/1017/h-f-01', '2026/10/17', 'played', 'h', 'f')");
    },
  }, NOV3);
  assert.equal(odd.collected, undefined);
});

/**
 * ⚠⚠**계약 2행** — 경기 목록(C10) 쿼리가 실패하면 owed 를 **구하지 않는다**. `game_id` 만 이름을 바꿔 C10 쿼리만 떨어뜨렸다 —
 * owed·gapFrom 쿼리는 이 DB 에서 **돌 수 있다**(그 칸을 안 쓴다). 그래서 구현이 owed 를 그대로 구했다면 여기서 비지 않는다.
 */
test("⚠⚠T5 계약 2행 — 경기 목록 실패 → {since, gapFrom: since, include: [], owed: []} · 현행 경고 한 줄에 「owed 도 못 구했다」", () => {
  const { collected, notes } = read(
    {
      rows: [ROW_1017],
      folders: [ROW_1017[0]],
      after: (db) => {
        seedOutage(db);
        db.exec("ALTER TABLE game RENAME COLUMN game_id TO gid_renamed");
      },
    },
    new Date("2026-10-24T22:00:00Z"),
  );
  assert.ok(collected !== undefined, "since 까지 버렸다 — 빠진 날 메우기가 꺼진다");
  assert.equal(collected.since, "2026-10-17");
  assert.equal(collected.gapFrom, "2026-10-17", "경기 목록을 못 읽었는데 확인된 휴식일을 반영했다");
  assert.deepEqual([collected.include, collected.owed], [[], []], "경기 목록을 못 읽었는데 owed 를 구했다");
  assert.equal(notes.length, 1, `경고가 ${String(notes.length)}줄이다(한 줄이어야 한다)`);
  assert.equal(notes[0]!.level, "warn");
  assert.match(notes[0]!.text, /DB 의 경기 목록을 못 읽었다/);
  assert.match(notes[0]!.text, /받았어야 할 날\(owed\)도 못 구했다/);
});

/**
 * ⚠⚠**계약 3행** — 일정 증거 쿼리가 실패하면(표 없음 = 021 미적용 · 칸 다름) **둘 다** 예전 규칙이다: `gapFrom = since` · `owed = []`.
 * `upcoming_game` 에서 `seq` 만 빼서 owed 쿼리만 떨어뜨렸다 — 확인된 휴식일 쿼리는 이 DB 에서 **돌 수 있고** 돌면 10/20 을 낸다.
 * 반쯤 구한 값을 내보내지 않는다(모르면 넓히지 않는다 · M11). C10 의 `include` 는 그대로 지킨다.
 */
test("⚠⚠T5 계약 3행 — 일정 증거 쿼리 실패 → gapFrom = since · owed = [] · include 는 보존 · 경고 한 줄", () => {
  const D24 = "2026-10-24";
  const { collected, notes } = read(
    {
      rows: [ROW_1017, [gid(D24, "db-h-01")]],
      folders: [ROW_1017[0], gid(D24, "db-h-01"), gid(D24, "c-t-01")],
      after: (db) => {
        seedOutage(db);
        db.exec("DROP TABLE upcoming_game");
        db.exec("CREATE TABLE upcoming_game (season INTEGER, game_date TEXT, home_code TEXT, away_code TEXT)");
      },
    },
    new Date("2026-10-25T22:00:00Z"),
  );
  assert.ok(collected !== undefined);
  assert.equal(collected.since, D24);
  assert.deepEqual(collected.include, [D24], "일정 증거 실패가 C10 의 덜 받은 날까지 지웠다");
  assert.equal(collected.gapFrom, D24);
  assert.deepEqual(collected.owed, []);
  const warns = notes.filter((n) => n.level === "warn");
  assert.equal(warns.length, 1, notes.map((n) => n.text).join("\n"));
  assert.match(warns[0]!.text, /일정 증거를 못 읽었다/);
  assert.match(warns[0]!.text, /예전 규칙/);
});

test("⚠⚠T5 계약 3행 — 반쯤 구한 값을 내보내지 않는다: 확인된 휴식일은 구해지는 DB 에서도 owed 가 실패하면 gapFrom = since", () => {
  const { collected } = read(
    {
      rows: [ROW_1017],
      folders: [ROW_1017[0]],
      after: (db) => {
        seedOutage(db);
        db.exec("DROP TABLE upcoming_game");
        db.exec("CREATE TABLE upcoming_game (season INTEGER, game_date TEXT, home_code TEXT, away_code TEXT)");
      },
    },
    NOV3,
  );
  assert.ok(collected !== undefined);
  assert.equal(collected.gapFrom, "2026-10-17", "owed 가 실패했는데 확인된 휴식일(10/20)을 내보냈다");
  assert.deepEqual(collected.owed, []);
});

test("⚠T5 계약 3행 — 일정 증거 표가 아예 없어도(021 미적용) 같다", () => {
  const { collected, notes } = read({ rows: [ROW_1017], folders: [ROW_1017[0]], after: (db) => db.exec("DROP TABLE schedule_month") }, NOV3);
  assert.ok(collected !== undefined);
  assert.deepEqual([collected.since, collected.gapFrom, collected.owed], ["2026-10-17", "2026-10-17", []]);
  assert.equal(notes.length, 1);
  assert.match(notes[0]!.text, /일정 증거를 못 읽었다/);
});

test("⚠T5 계약 4행 — 증거 표가 비었으면(정상 · 비시즌) gapFrom = since · owed = [] · 알림 없음", () => {
  const { collected, notes } = read({ rows: [ROW_1017], folders: [ROW_1017[0]] }, NOV3);
  assert.ok(collected !== undefined);
  assert.deepEqual([collected.since, collected.gapFrom, collected.owed, collected.include], ["2026-10-17", "2026-10-17", [], []]);
  assert.deepEqual(notes, []);
});

// ---- catchupNotes — owed · 확인된 휴식일 · 미룬 수 ---------------------------------------------------

const OWED_C: CollectedThrough = {
  since: "2026-10-17",
  gapFrom: "2026-10-20",
  include: [],
  owed: [
    { date: "2026-10-24", reasons: [{ kind: "scheduled", homeCode: "db", awayCode: "h", seq: 0, seenOn: "2026-10-21" }] },
    { date: "2026-10-25", reasons: [{ kind: "played", homeCode: "db", awayCode: "h", seq: 0 }] },
    { date: "2026-10-31", reasons: [{ kind: "scheduled", homeCode: "db", awayCode: "h", seq: 0, seenOn: "2026-10-21" }, { kind: "month-end", month: "2026-10", seenOn: "2026-10-21" }] },
    { date: "2026-11-01", reasons: [{ kind: "scheduled", homeCode: "db", awayCode: "h", seq: 0, seenOn: null }] },
    { date: "2026-11-02", reasons: [{ kind: "played", homeCode: "h", awayCode: "db", seq: 0 }] },
  ],
  days: [],
  noFolder: [],
};

test("⚠⚠T6 catchupNotes — 새로 더한 owed 날마다 사유(예정 · 치러짐 표시 · 월말) · 미룬 날의 수 · 확인된 휴식일 · 원래 창에 있던 날은 말하지 않는다", () => {
  const base = ["2026-11-02"];
  const dates = ["2026-10-24", "2026-10-25", "2026-11-02"];
  const notes = catchupNotes(OWED_C, base, dates, { deferred: ["2026-10-31", "2026-11-01"], room: 2 });
  const text = notes.map((n) => n.text).join("\n");
  assert.ok(notes.every((n) => n.level === "info"), text);
  for (const part of ["2026-10-17", "2026-10-20", "휴식일"]) assert.ok(text.includes(part), `확인된 휴식일 알림에 ${part} 가 없다:\n${text}`);
  const d24 = notes.find((n) => n.text.includes("2026-10-24"));
  assert.ok(d24 !== undefined && /예정/.test(d24.text) && d24.text.includes("db-h") && d24.text.includes("2026-10-21"), `10/24 의 사유가 없다:\n${text}`);
  const d25 = notes.find((n) => n.text.includes("2026-10-25"));
  assert.ok(d25 !== undefined && /치렀다/.test(d25.text), `10/25 의 사유(치러짐 표시)가 없다:\n${text}`);
  const deferred = notes.find((n) => /미룬다/.test(n.text));
  assert.ok(deferred !== undefined, `미룬 날을 말하지 않는다:\n${text}`);
  for (const part of ["2일", "2026-10-31", "2026-11-01", "2"]) assert.ok(deferred.text.includes(part), `미룬 알림에 ${part} 가 없다: ${deferred.text}`);
  assert.equal(notes.filter((n) => n.text.includes("2026-11-02")).length, 0, "원래 창에 있던 어제를 「받는다」고 말했다(요청 수를 셀 때 오독한다)");
});

test("⚠T6 catchupNotes — ⒝(월말 뒤 못 본 사본)를 받으면 그 달과 「새로 받는다」를 말한다", () => {
  const notes = catchupNotes(OWED_C, ["2026-11-02"], ["2026-10-31", "2026-11-02"], { deferred: [], room: 5 });
  const d31 = notes.find((n) => n.text.includes("2026-10-31"));
  assert.ok(d31 !== undefined, notes.map((n) => n.text).join("\n"));
  assert.ok(d31.text.includes("2026-10 일정 사본"), `그 달을 말하지 않는다: ${d31.text}`);
  assert.match(d31.text, /월말/);
  assert.match(d31.text, /새로 받는다/);
});

test("⚠T6 catchupNotes — owed 날이 창에도 없고 미룬 것도 아니면 경고한다(두 규칙이 어긋난 코드 결함) · 휴식일이 없으면 그 알림도 없다", () => {
  const c: CollectedThrough = { ...OWED_C, gapFrom: OWED_C.since, owed: [OWED_C.owed[0]!] };
  const notes = catchupNotes(c, ["2026-11-02"], ["2026-11-02"], { deferred: [], room: 5 });
  assert.equal(notes.length, 1, notes.map((n) => n.text).join("\n"));
  assert.equal(notes[0]!.level, "warn");
  assert.match(notes[0]!.text, /2026-10-24/);
});

test("T6 catchupNotes — include 로 이미 더한 날은 owed 로 또 말하지 않는다(한 날 한 줄)", () => {
  const c: CollectedThrough = {
    ...OWED_C,
    gapFrom: OWED_C.since,
    include: ["2026-10-24"],
    owed: [OWED_C.owed[0]!],
    days: [{ date: "2026-10-24", status: "incomplete", missing: [gid("2026-10-24", "db-h-01")], reason: null }],
  };
  const notes = catchupNotes(c, ["2026-10-25"], ["2026-10-24", "2026-10-25"], { deferred: [], room: 5 });
  assert.equal(notes.length, 1, notes.map((n) => n.text).join("\n"));
  assert.match(notes[0]!.text, /다시 받는다/);
});
