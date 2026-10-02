/**
 * **정정 자동 재수집의 후보 조회 — 실제 스키마로 돈다**(설계 `docs/superpowers/specs/2026-10-02-correction-auto-refetch-design.md` D5 · 시험 T6).
 *
 * ⚠**임시 SQLite 에 실제 마이그레이션을 적용해 만든다**(`openDb` · `upsertGame` · `upsertBatting` · `upsertPitching`) —
 *   최소 표를 손으로 만들면 실제 칸 이름이 바뀌어도 초록이 된다(`collected-through.test.ts` 와 같은 이유).
 * ⚠**로컬 `data/bb.sqlite` 를 열지 않는다** — 열면 마이그레이션이 적용돼 파일이 바뀐다.
 * ⚠시계를 안 읽는다(M6) — 적재 시각은 고정값이다.
 *
 * 무엇을 고정하나: **ID 로만**(동명이인) · **그 팀 쪽**(이적·쪽 불일치) · 기준일 · 대회·상태·시즌 · 항목별 식(대상 29행 전부) ·
 * 결과 정렬(경기일 내림차순 → game_id 오름차순) · 값 조회(행 없음과 NULL 을 가른다) · 읽기 전용(파일이 안 바뀐다 · 없는 파일을 안 만든다).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CROSSCHECK_FIELDS, crosscheckScope } from "@bb-app/aggregate/crosscheck-fields";
import type { CrosscheckTargetField } from "@bb-app/aggregate/crosscheck-fields";
import { openDb } from "../../packages/store/src/db.ts";
import type { Db } from "../../packages/store/src/db.ts";
import { upsertBatting, upsertGame, upsertPitching, upsertPlayer } from "../../packages/store/src/load.ts";
import type { BattingRow, PitchingRow } from "../../packages/store/src/derive.ts";
import { candidateSql, openCandidateDb } from "../correction-candidates.ts";
import type { CandidateQuery, Direction } from "../correction-plan.ts";

const STAMP = "2026-09-24T21:00:00.000Z";
const P1 = "91095136"; // 髙橋(阪神)
const P2 = "91095999"; // 같은 이름 · 같은 팀(동명이인)
const P3 = "50000001"; // 시즌 중 이적(t → g)

interface G {
  id: string;
  date: string;
  away: string;
  home: string;
  season?: number;
  status?: "played" | "notPlayed";
  competition?: string;
}

const GAMES: G[] = [
  { id: "2026/0513/s-t-08", date: "2026-05-13", away: "t", home: "s" },
  { id: "2026/0917/t-c-20", date: "2026-09-17", away: "c", home: "t" },
  { id: "2026/0923/s-t-23", date: "2026-09-23", away: "t", home: "s" },
  { id: "2026/0928/t-g-24", date: "2026-09-28", away: "g", home: "t" }, // 기준일 뒤(E1)
  { id: "2026/0910/t-c-30", date: "2026-09-10", away: "c", home: "t", competition: "climaxSeries" },
  { id: "2026/0715/t-g-01", date: "2026-07-15", away: "g", home: "t", competition: "allStar" },
  { id: "2026/0601/t-d-10", date: "2026-06-01", away: "d", home: "t", status: "notPlayed" },
  { id: "2025/0917/t-c-20", date: "2025-09-17", away: "c", home: "t", season: 2025 },
  { id: "2026/0909/t-b-15", date: "2026-09-09", away: "b", home: "t" }, // 暴投 0
  { id: "2026/0911/t-b-16", date: "2026-09-11", away: "b", home: "t" }, // 暴投 NULL
  { id: "2026/0912/t-e-17", date: "2026-09-12", away: "e", home: "t" }, // P1 의 행이 away 쪽(= e) — 쪽 불일치
  { id: "2026/0915/t-c-19", date: "2026-09-15", away: "c", home: "t" }, // P2 만
  { id: "2026/0801/g-d-05", date: "2026-08-01", away: "d", home: "g" }, // P3 의 g 쪽
  // 같은 날 두 경기(정렬 확인용 — 일부러 큰 ID 를 먼저 넣는다)
  { id: "2026/0802/t-d-12", date: "2026-08-02", away: "d", home: "t" },
  { id: "2026/0802/t-d-11", date: "2026-08-02", away: "d", home: "t" },
];

function pit(gameId: string, playerId: string, side: "away" | "home", o: Partial<PitchingRow> = {}): PitchingRow {
  return { gameId, playerId, side, decision: null, outs: 3, bf: 4, pitches: 15, h: 0, hr: 0, bb: 0, hbp: 0, so: 1, runs: 0, er: 0, wp: 0, balk: 0, ...o };
}
function bat(gameId: string, playerId: string, side: "away" | "home", o: Partial<BattingRow> = {}): BattingRow {
  return {
    gameId, playerId, side, battingOrder: "1", position: "中",
    pa: 4, ab: 4, h: 1, d2: 0, d3: 0, hr: 0, bb: 0, ibb: 0, hbp: 0, sf: 0, sh: 0, so: 0, roe: 0, runs: 0, rbi: 0, sb: 0,
    ...o,
  };
}

function addGame(db: Db, g: G): void {
  upsertGame(db, {
    gameId: g.id, season: g.season ?? 2026, gameDate: g.date, awayCode: g.away, homeCode: g.home, gameNo: 1,
    status: g.status ?? "played", notPlayedReason: g.status === "notPlayed" ? "雨天中止" : null,
    competition: g.competition ?? "regular", series: null, sourceUrl: "https://example.invalid/", fetchedAt: STAMP,
  });
}

/** 항목별 식 시험의 선수·경기 — 대상 29행마다 선수 하나 · 경기 둘(값 없음 X · 값 있음 Y) */
function fieldFixture(f: CrosscheckTargetField, i: number): { player: string; x: G; y: G } {
  void f;
  const dd = String(i + 1).padStart(2, "0"); // 대상 29행 → 01~29(6월·8월 모두 있는 날)
  return {
    player: `8000${dd}`,
    x: { id: `2026/06${dd}/t-h-1`, date: `2026-06-${dd}`, away: "h", home: "t" },
    y: { id: `2026/08${dd}/t-h-2`, date: `2026-08-${dd}`, away: "h", home: "t" },
  };
}
const TARGETS = CROSSCHECK_FIELDS.filter((f): f is CrosscheckTargetField => f.refetch);

function build(): string {
  const dir = mkdtempSync(join(tmpdir(), "bb-corr-db-"));
  const path = join(dir, "bb.sqlite");
  const db = openDb(path, STAMP);
  try {
    db.transaction(() => {
      upsertPlayer(db, P1, "髙橋", STAMP);
      upsertPlayer(db, P2, "髙橋", STAMP);
      upsertPlayer(db, P3, "移籍", STAMP);
      for (const g of GAMES) addGame(db, g);
      // P1 — 暴投 > 0 은 5/13 · 9/17 · 9/23(범위 안) + 범위 밖 전부
      upsertPitching(db, pit("2026/0513/s-t-08", P1, "away", { wp: 1 }));
      upsertPitching(db, pit("2026/0917/t-c-20", P1, "home", { wp: 1 }));
      upsertPitching(db, pit("2026/0923/s-t-23", P1, "away", { wp: 1 }));
      upsertPitching(db, pit("2026/0928/t-g-24", P1, "home", { wp: 1 }));
      upsertPitching(db, pit("2026/0910/t-c-30", P1, "home", { wp: 1 }));
      upsertPitching(db, pit("2026/0715/t-g-01", P1, "home", { wp: 1 }));
      upsertPitching(db, pit("2026/0601/t-d-10", P1, "home", { wp: 1 }));
      upsertPitching(db, pit("2025/0917/t-c-20", P1, "home", { wp: 1 }));
      upsertPitching(db, pit("2026/0909/t-b-15", P1, "home", { wp: 0 }));
      upsertPitching(db, pit("2026/0911/t-b-16", P1, "home", { wp: null }));
      upsertPitching(db, pit("2026/0912/t-e-17", P1, "away", { wp: 1 }));
      // P2 — 같은 이름 · 같은 팀
      upsertPitching(db, pit("2026/0917/t-c-20", P2, "home", { wp: 2 }));
      upsertPitching(db, pit("2026/0915/t-c-19", P2, "home", { wp: 1 }));
      // P3 — t 쪽 둘 · g 쪽 하나 · 같은 날 두 경기
      upsertBatting(db, bat("2026/0513/s-t-08", P3, "away", { h: 2 }));
      upsertBatting(db, bat("2026/0917/t-c-20", P3, "home", { h: 1 }));
      upsertBatting(db, bat("2026/0801/g-d-05", P3, "home", { h: 3 }));
      upsertBatting(db, bat("2026/0802/t-d-12", P3, "home", { h: 0 }));
      upsertBatting(db, bat("2026/0802/t-d-11", P3, "home", { h: 0 }));
      // 항목별 — X 는 0(결정은 NULL) · Y 는 2(결정은 그 표기)
      TARGETS.forEach((f, i) => {
        const { player, x, y } = fieldFixture(f, i);
        upsertPlayer(db, player, `項目${String(i)}`, STAMP);
        addGame(db, x);
        addGame(db, y);
        const col = f.gameValue("x").slice(2);
        const mark = /= '(.+)'$/.exec(f.oursMore("x"))?.[1];
        const val = (on: boolean): Record<string, unknown> => (col === "decision" ? { decision: on ? mark : null } : { [col]: on ? 2 : 0 });
        if (f.kind === "batting") {
          upsertBatting(db, bat(x.id, player, "home", val(false) as Partial<BattingRow>));
          upsertBatting(db, bat(y.id, player, "home", val(true) as Partial<BattingRow>));
        } else {
          upsertPitching(db, pit(x.id, player, "home", val(false) as Partial<PitchingRow>));
          upsertPitching(db, pit(y.id, player, "home", val(true) as Partial<PitchingRow>));
        }
      });
    });
  } finally {
    db.close();
  }
  return path;
}

const PATH = build();
const sha = (p: string): string => createHash("sha256").update(readFileSync(p)).digest("hex");

function q(o: Partial<CandidateQuery> = {}): CandidateQuery {
  return {
    season: 2026,
    competition: "regular",
    through: "2026-09-27",
    team: "t",
    kind: "pitching",
    playerId: P1,
    field: "暴投",
    direction: "ours_more",
    ...o,
  };
}

function ids(query: CandidateQuery): string[] {
  const db = openCandidateDb(PATH);
  try {
    return db.candidates(query).map((r) => r.game_id);
  } finally {
    db.close();
  }
}

test("⚠T6 이번 사고 — o>p 는 범위 안에서 그 항목이 > 0 인 경기만 · 경기일 내림차순(기준일 뒤·다른 대회·미성립·작년·0·NULL·쪽 불일치 제외)", () => {
  const db = openCandidateDb(PATH);
  try {
    assert.deepEqual(db.candidates(q()), [
      { game_id: "2026/0923/s-t-23", game_date: "2026-09-23", fetched_at: STAMP, value: 1 },
      { game_id: "2026/0917/t-c-20", game_date: "2026-09-17", fetched_at: STAMP, value: 1 },
      { game_id: "2026/0513/s-t-08", game_date: "2026-05-13", fetched_at: STAMP, value: 1 },
    ]);
  } finally {
    db.close();
  }
});

test("⚠T6 o<p 는 「출장」 전부 — 값 0 · NULL 도 후보다(범위 조각은 그대로)", () => {
  const db = openCandidateDb(PATH);
  try {
    const rows = db.candidates(q({ direction: "ours_less" }));
    assert.deepEqual(
      rows.map((r) => [r.game_id, r.value]),
      [
        ["2026/0923/s-t-23", 1],
        ["2026/0917/t-c-20", 1],
        ["2026/0911/t-b-16", null],
        ["2026/0909/t-b-15", 0],
        ["2026/0513/s-t-08", 1],
      ],
    );
  } finally {
    db.close();
  }
});

test("⚠T6 ID 로만 잇는다 — 같은 이름 · 같은 팀의 다른 선수 경기가 섞이지 않는다(M10)", () => {
  assert.deepEqual(ids(q({ playerId: P2 })), ["2026/0917/t-c-20", "2026/0915/t-c-19"]);
  assert.ok(!ids(q()).includes("2026/0915/t-c-19"), "동명이인의 경기가 섞였다");
  // 정적 — 후보 SQL 에 이름이 나오지 않는다
  for (const f of TARGETS) {
    for (const d of ["ours_more", "ours_less"] as Direction[]) {
      const sql = candidateSql(f.kind, f.field, d);
      assert.doesNotMatch(sql, /display_name|\bname\b|JOIN\s+player\b/i, `${f.field}: 이름으로 잇는다`);
    }
  }
});

test("⚠T6 그 팀 쪽 — 이적한 선수는 팀마다 따로 · 쪽(away/home)과 팀 코드가 맞아야 한다", () => {
  assert.deepEqual(ids(q({ kind: "batting", playerId: P3, field: "安打" })), ["2026/0917/t-c-20", "2026/0513/s-t-08"]);
  assert.deepEqual(ids(q({ kind: "batting", playerId: P3, field: "安打", team: "g" })), ["2026/0801/g-d-05"]);
  // P1 의 9/12 행은 away 쪽(= e)이라 t 의 후보가 아니다
  assert.ok(!ids(q({ direction: "ours_less" })).includes("2026/0912/t-e-17"));
  assert.deepEqual(ids(q({ team: "e" })), ["2026/0912/t-e-17"]);
});

test("T6 기준일·대회·시즌은 인자로 바뀐다 — 범위 조각이 crosscheck 와 한 벌이다(M1)", () => {
  assert.deepEqual(ids(q({ through: "2026-09-30" })).slice(0, 1), ["2026/0928/t-g-24"]);
  assert.deepEqual(ids(q({ competition: "climaxSeries" })), ["2026/0910/t-c-30"]);
  assert.deepEqual(ids(q({ season: 2025, through: "2025-12-31" })), ["2025/0917/t-c-20"]);
  for (const f of TARGETS) assert.ok(candidateSql(f.kind, f.field, "ours_more").includes(crosscheckScope("x")), `${f.field}: 범위 조각이 다르다`);
});

test("T6 같은 날 두 경기는 game_id 코드 단위 오름차순", () => {
  const r = ids(q({ kind: "batting", playerId: P3, field: "打席", direction: "ours_less" }));
  assert.deepEqual(r, ["2026/0917/t-c-20", "2026/0802/t-d-11", "2026/0802/t-d-12", "2026/0513/s-t-08"]);
});

test("⚠T6 항목별 식 — 대상 29행 전부: o>p 는 값 있는 경기만 · o<p 는 둘 다 · 값은 그 칸", () => {
  assert.equal(TARGETS.length, 29);
  const db = openCandidateDb(PATH);
  try {
    TARGETS.forEach((f, i) => {
      const { player, x, y } = fieldFixture(f, i);
      const more = db.candidates(q({ kind: f.kind, playerId: player, field: f.field, through: "2026-12-31" }));
      assert.deepEqual(more.map((r) => r.game_id), [y.id], `${f.kind}/${f.field} o>p`);
      const isDecision = f.gameValue("x") === "x.decision";
      assert.equal(more[0]?.value, isDecision ? /= '(.+)'$/.exec(f.oursMore("x"))?.[1] : 2, `${f.kind}/${f.field} 값`);
      const less = db.candidates(q({ kind: f.kind, playerId: player, field: f.field, through: "2026-12-31", direction: "ours_less" }));
      assert.deepEqual(less.map((r) => r.game_id), [y.id, x.id], `${f.kind}/${f.field} o<p`);
    });
  } finally {
    db.close();
  }
});

test("T6 대상이 아닌 항목·없는 짝으로 SQL 을 만들지 않는다(던진다)", () => {
  assert.throws(() => candidateSql("batting", "打率", "ours_more"));
  assert.throws(() => candidateSql("pitching", "試合", "ours_less"));
  assert.throws(() => candidateSql("batting", "暴投", "ours_more"));
});

test("T6 값 조회 — 행이 있으면 그 값(NULL 은 NULL) · 행이 없으면 「행 없음」", () => {
  const db = openCandidateDb(PATH);
  try {
    assert.deepEqual(db.valueIn({ kind: "pitching", field: "暴投", gameId: "2026/0917/t-c-20", playerId: P1 }), { found: true, value: 1 });
    assert.deepEqual(db.valueIn({ kind: "pitching", field: "暴投", gameId: "2026/0911/t-b-16", playerId: P1 }), { found: true, value: null });
    assert.deepEqual(db.valueIn({ kind: "pitching", field: "暴投", gameId: "2026/0915/t-c-19", playerId: P1 }), { found: false });
  } finally {
    db.close();
  }
});

test("⚠T6 읽기 전용 — 조회해도 파일이 안 바뀐다 · 없는 파일은 만들지 않고 던진다", () => {
  const before = sha(PATH);
  ids(q());
  ids(q({ direction: "ours_less" }));
  assert.equal(sha(PATH), before);
  const missing = join(mkdtempSync(join(tmpdir(), "bb-corr-none-")), "absent.sqlite");
  assert.throws(() => openCandidateDb(missing));
  assert.equal(existsSync(missing), false, "없는 DB 파일을 만들었다");
});
