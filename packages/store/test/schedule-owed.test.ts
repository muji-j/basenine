/**
 * **받았어야 할 날(owed)과 확인된 휴식일** — 잎 `schedule-owed.ts` 를 실제 스키마의 임시 SQLite 로 잰다
 * (설계 `docs/superpowers/specs/2026-10-24-catchup-owed-days-design.md` D1 · D2 · 시험 T1 · T2).
 *
 * ⚠**행으로 재현한다** — 마이그레이션을 적용한 임시 DB 에 실제로 넣고 잰다(최소 표를 손으로 만들면 칸 이름이 바뀌어도 초록이 된다).
 * ⚠시계는 안 읽는다(M6) — 「오늘(JST)」은 문자열로 준다.
 * ⚠사본 본 시각(`schedule_month.fetched_at`)은 UTC ISO 다 — 판정은 **JST 달력 날짜**로 한다(`+9시간`). 경계 시험이 그것을 고정한다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { LOOKBACK_DAYS } from "@bb-app/domain";
import { NO_GAME_MONTHS } from "../../domain/src/season-calendar.ts";
import { openDb, upsertGame, upsertProbablePitcher } from "../src/index.ts";
import type { Db } from "../src/index.ts";
import { collectionEvidence } from "../src/collection-evidence.ts";
import { OWED_LOOKBACK_DAYS, confirmedRestThrough, owedDays } from "../src/schedule-owed.ts";
import type { OwedDay } from "../src/schedule-owed.ts";

const NOW = "2026-10-21T09:50:36.996Z";
/** 최신 CI DB 사본의 10월 사본 본 시각(JST 2026-10-21 18:50) */
const SEEN_1021 = "2026-10-21T09:50:36.996Z";

async function withDb(fn: (db: Db) => void): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "bb-owed-"));
  const db = openDb(join(dir, "t.sqlite"), NOW);
  try {
    fn(db);
  } finally {
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
}

let gid = 0;
function game(db: Db, date: string, home: string, away: string, status: "played" | "notPlayed" = "played"): void {
  gid += 1;
  upsertGame(db, {
    gameId: `o${String(gid)}`, season: Number(date.slice(0, 4)), gameDate: date, awayCode: away, homeCode: home, gameNo: 1,
    status, notPlayedReason: status === "notPlayed" ? "中止" : null,
    competition: "regular", sourceUrl: "https://npb.jp/x", fetchedAt: NOW,
    awayRuns: status === "notPlayed" ? null : 0, homeRuns: status === "notPlayed" ? null : 1,
  });
}
/** 월간 일정의 치러짐 표시(점수 링크) */
const played = (db: Db, date: string, home: string, away: string, seq = 0): void => {
  db.raw.prepare("INSERT INTO schedule_played (season, game_date, home_code, away_code, seq, source, fetched_at) VALUES (?, ?, ?, ?, ?, 'x', ?)")
    .run(Number(date.slice(0, 4)), date, home, away, seq, NOW);
};
/** 월간 일정의 예정(링크 없음 · 대진이 정해진 팀 카드) */
const upcoming = (db: Db, date: string, home: string, away: string, seq = 0): void => {
  db.raw.prepare(
    "INSERT INTO upcoming_game (season, game_date, home_code, away_code, seq, venue, start_time, source, fetched_at) VALUES (?, ?, ?, ?, ?, '', '18:00', 'x', ?)",
  ).run(Number(date.slice(0, 4)), date, home, away, seq, NOW);
};
/**
 * 그 달 사본을 언제 봤는가 — `null` 은 「모른다」.
 * `firstContent` 는 그 사본의 첫 내용일(경기 · 예정 표기 · 구단 아님 — `load-upcoming` 이 채운다) · 기본은 그 달 1일(내용 있음) · `null` 은 내용 없는 달
 */
const month = (db: Db, season: number, m: number, seenAt: string | null, firstContent: string | null = `${String(season)}-${String(m).padStart(2, "0")}-01`): void => {
  db.raw.prepare("INSERT INTO schedule_month (season, month, source, fetched_at, date_rows, games, first_content) VALUES (?, ?, 'x', ?, 31, 1, ?)")
    .run(season, m, seenAt, firstContent);
};

const dates = (o: readonly OwedDay[]): string[] => o.map((d) => d.date);
const kinds = (o: readonly OwedDay[], date: string): string[] => (o.find((d) => d.date === date)?.reasons ?? []).map((r) => r.kind).sort();

// ---- ⒜ 증거 후보 ---------------------------------------------------------------------------

test("⚠T1 ⒜ 예정 카드 · 사본이 D 뒤를 못 봤다 · 경기 행 없음 → 받았어야 할 날(사유: 예정 · 사본 본 날)", () => withDb((db) => {
  month(db, 2026, 10, SEEN_1021);
  upcoming(db, "2026-10-24", "db", "h");
  const o = owedDays(db.raw, "2026-10-30");
  assert.deepEqual(o, [{ date: "2026-10-24", reasons: [{ kind: "scheduled", homeCode: "db", awayCode: "h", seq: 0, seenOn: "2026-10-21" }] }]);
}));

/**
 * ⚠⚠**조건 4 — 사본이 D 다음 날 이후에 그 경기를 링크 없이 적고 있으면 NPB 가 안 치렀다고 한 것이다**(D1 ⒜-4 · D5 「행 지속」).
 * 2025 일본시리즈는 끝난 뒤에도 6·7차전 행이 링크 없이 남았다 — 이 조건이 없으면 그런 행을 30일 동안 매 실행 다시 받는다.
 */
test("⚠⚠T1 ⒜-4 링크 없는 예정 지속 — 사본을 D 뒤에 다시 봤으면 후보가 아니다(사본 갱신으로 닫힌다)", () => withDb((db) => {
  month(db, 2026, 10, "2026-10-26T00:00:00Z"); // JST 10/26 09:00 — 10/24 뒤에 봤다
  upcoming(db, "2026-10-24", "db", "h");
  assert.deepEqual(owedDays(db.raw, "2026-10-30"), [], "사본이 D 뒤에도 링크 없이 적은 경기를 다시 받으려 한다");
}));

test("⚠T1 ⒜-4 경계는 JST 달력 날짜 — D 의 23:59:59 JST 에 본 것은 「D 뒤」가 아니다 · D+1 00:00 JST 는 D 뒤다", async () => {
  await withDb((db) => {
    month(db, 2026, 10, "2026-10-24T14:59:59Z"); // JST 10/24 23:59:59
    upcoming(db, "2026-10-24", "db", "h");
    assert.deepEqual(dates(owedDays(db.raw, "2026-10-30")), ["2026-10-24"], "D 당일(JST)에 본 사본을 「D 뒤」로 읽었다");
  });
  await withDb((db) => {
    month(db, 2026, 10, "2026-10-24T15:00:00Z"); // JST 10/25 00:00
    upcoming(db, "2026-10-24", "db", "h");
    assert.deepEqual(owedDays(db.raw, "2026-10-30"), [], "D+1 00:00 JST 에 본 사본을 「D 뒤」로 안 읽었다(UTC 날짜로 비교했다)");
  });
});

test("⚠T1 ⒜-4 사본 본 시각을 모르면(NULL) · 그 달 사본 행이 없으면 후보다(본 적이 없다)", async () => {
  await withDb((db) => {
    month(db, 2026, 10, null);
    upcoming(db, "2026-10-24", "db", "h");
    const o = owedDays(db.raw, "2026-10-30");
    assert.deepEqual(dates(o), ["2026-10-24"]);
    assert.deepEqual(o[0]!.reasons, [{ kind: "scheduled", homeCode: "db", awayCode: "h", seq: 0, seenOn: null }]);
  });
  await withDb((db) => {
    upcoming(db, "2026-10-24", "db", "h");
    assert.deepEqual(dates(owedDays(db.raw, "2026-10-30")), ["2026-10-24"]);
  });
});

test("⚠T1 ⒜-3 그 카드의 경기 행이 있으면 후보가 아니다 — 상태 무관(중지도 받은 것이다)", async () => {
  await withDb((db) => {
    month(db, 2026, 10, SEEN_1021);
    upcoming(db, "2026-10-24", "db", "h");
    game(db, "2026-10-24", "db", "h");
    assert.deepEqual(owedDays(db.raw, "2026-10-30"), []);
  });
  await withDb((db) => {
    played(db, "2026-10-20", "c", "db");
    game(db, "2026-10-20", "c", "db", "notPlayed");
    assert.deepEqual(owedDays(db.raw, "2026-10-30"), [], "중지 행(링크 있음 · 경기 행 notPlayed)을 받았어야 할 날로 봤다");
  });
  await withDb((db) => {
    // ⚠카드가 다르면 대응하지 않는다(같은 날 다른 카드의 경기 행)
    played(db, "2026-10-20", "c", "db");
    game(db, "2026-10-20", "g", "t");
    assert.deepEqual(dates(owedDays(db.raw, "2026-10-30")), ["2026-10-20"]);
  });
});

test("⚠T1 ⒜ 치러짐 표시는 사본이 새로워도 후보다 — 경기 행이 없으면(조건 4 는 예정 카드만)", () => withDb((db) => {
  month(db, 2026, 10, "2026-10-29T00:00:00Z");
  played(db, "2026-10-20", "g", "t");
  assert.deepEqual(owedDays(db.raw, "2026-10-30"), [
    { date: "2026-10-20", reasons: [{ kind: "played", homeCode: "g", awayCode: "t", seq: 0 }] },
  ]);
}));

test("⚠T1 ⒜ 더블헤더 — 같은 카드 표시 둘(seq 0·1)에 경기 행 하나면 seq 1 만 사유다", () => withDb((db) => {
  played(db, "2026-10-20", "g", "t", 0);
  played(db, "2026-10-20", "g", "t", 1);
  game(db, "2026-10-20", "g", "t");
  assert.deepEqual(owedDays(db.raw, "2026-10-30"), [
    { date: "2026-10-20", reasons: [{ kind: "played", homeCode: "g", awayCode: "t", seq: 1 }] },
  ]);
}));

/**
 * ⚠⚠**조건 2 — `[오늘 − OWED_LOOKBACK_DAYS, 어제]`**. −30 은 포함 · −31 은 제외 · 오늘은 제외(오늘은 22시 이후 실행의 몫).
 * 치러짐 표시로 잰다 — 예정 카드는 사본 조건(4)과 ⒝ 가 끼어든다.
 */
test("⚠⚠T1 ⒜-2 lookback 경계 — 오늘 − 30 포함 · − 31 제외 · 어제 포함 · 오늘 제외", () => withDb((db) => {
  for (const d of ["2026-09-29", "2026-09-30", "2026-10-29", "2026-10-30"]) played(db, d, "g", "t");
  assert.deepEqual(dates(owedDays(db.raw, "2026-10-30")), ["2026-09-30", "2026-10-29"]);
}));

test("⚠T1 ⒜ 행 소멸 — 그 날 사본에 행이 없으면(증거 없음) 후보가 아니다", () => withDb((db) => {
  month(db, 2026, 10, SEEN_1021);
  upcoming(db, "2026-10-25", "db", "h");
  game(db, "2026-10-25", "db", "h");
  // 10/24 의 행이 사본에서 사라졌다 — 아무 표에도 10/24 가 없다
  assert.deepEqual(owedDays(db.raw, "2026-10-30"), []);
}));

test("T1 ⒜ 같은 날 여러 카드는 한 날로 모은다 · 날짜 오름차순 · 사유는 정해진 순서", () => withDb((db) => {
  month(db, 2026, 10, SEEN_1021);
  upcoming(db, "2026-10-25", "db", "h");
  played(db, "2026-10-22", "s", "d");
  upcoming(db, "2026-10-22", "c", "t");
  played(db, "2026-10-22", "b", "f");
  const o = owedDays(db.raw, "2026-10-30");
  assert.deepEqual(dates(o), ["2026-10-22", "2026-10-25"]);
  assert.deepEqual(o[0]!.reasons, [
    { kind: "played", homeCode: "b", awayCode: "f", seq: 0 },
    { kind: "played", homeCode: "s", awayCode: "d", seq: 0 },
    { kind: "scheduled", homeCode: "c", awayCode: "t", seq: 0, seenOn: "2026-10-21" },
  ]);
}));

// ---- ⒝ 월말 뒤 못 본 사본 ---------------------------------------------------------------------

/**
 * ⚠⚠**⒝** — 대진 미정 표기(`日本シリーズ セ本拠地球場` 등)는 `upcoming_game` 에 안 들어가서 ⒜ 가 그 날을 지정하지 못한다(콜드 리뷰 1 P1).
 * 그래서 날이 아니라 **사본**을 본다: 달이 끝났는데(`L < 오늘 ≤ L + 30`) 그 사본을 L 뒤에 본 적이 없으면(본 날 ≤ L 또는 모름) L 을 더한다 —
 * L 의 날짜 자식이 그 달 일정을 새로 받는다.
 */
test("⚠⚠T1 ⒝ 달이 끝났는데 사본을 월말 뒤에 못 봤다 → 말일(사유: 월말 · 그 달 · 본 날)", () => withDb((db) => {
  month(db, 2026, 10, SEEN_1021);
  const o = owedDays(db.raw, "2026-11-03");
  assert.deepEqual(o, [{ date: "2026-10-31", reasons: [{ kind: "month-end", month: "2026-10", seenOn: "2026-10-21" }] }]);
}));

test("⚠⚠T1 ⒝ 경계 — 본 날이 정확히 말일(JST)이면 발동 · 말일 다음 날 00:00 JST 면 비발동(L+1 아침 실행이 갱신한 정상 사본)", async () => {
  await withDb((db) => {
    month(db, 2026, 10, "2026-10-31T14:59:59Z"); // JST 10/31 23:59:59
    assert.deepEqual(dates(owedDays(db.raw, "2026-11-03")), ["2026-10-31"], "말일에 본 사본을 「월말 뒤」로 읽었다(≤ L 이어야 한다)");
  });
  await withDb((db) => {
    month(db, 2026, 10, "2026-10-31T15:00:00Z"); // JST 11/01 00:00
    assert.deepEqual(owedDays(db.raw, "2026-11-03"), [], "월말 뒤에 본 정상 사본에서 발동했다");
  });
  await withDb((db) => {
    month(db, 2026, 10, "2026-10-31T22:00:00Z"); // JST 11/01 07:00 — L+1 아침 실행
    assert.deepEqual(owedDays(db.raw, "2026-11-03"), []);
  });
});

test("⚠T1 ⒝ 본 시각 모름(NULL)은 발동 · 그 달 사본 행이 없으면 비발동(사본이 없으면 새로 받게 할 것이 없다)", async () => {
  await withDb((db) => {
    month(db, 2026, 10, null);
    assert.deepEqual(owedDays(db.raw, "2026-11-03"), [{ date: "2026-10-31", reasons: [{ kind: "month-end", month: "2026-10", seenOn: null }] }]);
  });
  await withDb((db) => {
    assert.deepEqual(owedDays(db.raw, "2026-11-03"), []);
  });
});

test("⚠T1 ⒝ 기간 — 달이 아직 안 끝났으면(오늘 ≤ L) 비발동 · L + 30 까지 발동 · L + 31 부터 비발동", () => withDb((db) => {
  month(db, 2026, 10, SEEN_1021);
  assert.deepEqual(owedDays(db.raw, "2026-10-31"), [], "말일 당일에 발동했다(달이 안 끝났다)");
  assert.deepEqual(dates(owedDays(db.raw, "2026-11-01")), ["2026-10-31"], "말일 다음 날에 발동하지 않았다");
  assert.deepEqual(dates(owedDays(db.raw, "2026-11-30")), ["2026-10-31"], "L + 30 에 발동하지 않았다");
  assert.deepEqual(owedDays(db.raw, "2026-12-01"), [], "L + 31 에 발동했다(lookback 밖)");
}));

/**
 * ⚠⚠**⒝ 는 내용이 있던 사본만 본다**(구현 중 발견 · 설계 D4 「비시즌 ⒝ = ∅」를 지키려고 좁혔다).
 * 12월→1월 경계에서는 말일(12/31)의 날짜 자식이 2026/12 사본을 새로 받아도 `update.ts` 의 앞으로의 일정 적재가 **마지막 대상일의 시즌(2027)** 만 읽어서
 * `schedule_month(2026, 12)` 가 갱신되지 않는다 — 1/1 실행이 전부 실패한 해에는 ⒝ 가 12/31 을 **30일 동안 매 실행** 더한다(설계의 「한 달에 한 번 2요청」이 깨진다).
 * 대진 미정 표기도 내용(`first_content`)이라 ⒝ 의 목적(대진 미정 날)은 그대로다 — 내용이 없던 달(비시즌)에는 새로 받아 찾을 것이 없다.
 */
test("⚠⚠T1 ⒝ 내용이 없던 달(first_content NULL — 비시즌)은 비발동 · 대진 미정 표기만 있던 달(내용 있음)은 발동", async () => {
  await withDb((db) => {
    month(db, 2026, 12, "2026-12-30T00:00:00Z", null);
    assert.deepEqual(owedDays(db.raw, "2027-01-05"), [], "내용 없는 12월 사본으로 12/31 을 더했다 — 해 넘김에서 30일 동안 헛요청이 된다");
  });
  await withDb((db) => {
    // 일본시리즈가 대진 미정 표기로만 적힌 11월(예정 표에 행 없음 · 첫 내용일은 있다)
    month(db, 2026, 11, "2026-11-20T00:00:00Z", "2026-11-21");
    assert.deepEqual(dates(owedDays(db.raw, "2026-12-03")), ["2026-11-30"]);
  });
});

test("T1 ⒜ 와 ⒝ 가 같은 날이면 한 날에 사유 둘 · 12월 말일과 해 넘김", async () => {
  await withDb((db) => {
    month(db, 2026, 10, SEEN_1021);
    upcoming(db, "2026-10-31", "db", "h");
    const o = owedDays(db.raw, "2026-11-03");
    assert.deepEqual(dates(o), ["2026-10-31"]);
    assert.deepEqual(kinds(o, "2026-10-31"), ["month-end", "scheduled"]);
  });
  await withDb((db) => {
    month(db, 2026, 12, "2026-12-20T00:00:00Z");
    assert.deepEqual(owedDays(db.raw, "2027-01-05"), [{ date: "2026-12-31", reasons: [{ kind: "month-end", month: "2026-12", seenOn: "2026-12-20" }] }]);
  });
});

test("⚠T1 현재 상태 재현(최신 CI DB 의 모양) — 11/03 에 일본시리즈 예정 7일 전부 + ⒝ 의 10/31", () => withDb((db) => {
  month(db, 2026, 10, SEEN_1021);
  month(db, 2026, 11, "2026-10-21T09:50:39.837Z");
  played(db, "2026-10-17", "h", "f");
  game(db, "2026-10-17", "h", "f");
  for (const [d, h, a] of [
    ["2026-10-24", "db", "h"], ["2026-10-25", "db", "h"], ["2026-10-27", "h", "db"], ["2026-10-28", "h", "db"],
    ["2026-10-29", "h", "db"], ["2026-10-31", "db", "h"], ["2026-11-01", "db", "h"],
  ] as const) upcoming(db, d, h, a);
  const o = owedDays(db.raw, "2026-11-03");
  assert.deepEqual(dates(o), ["2026-10-24", "2026-10-25", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-31", "2026-11-01"]);
  assert.deepEqual(kinds(o, "2026-10-31"), ["month-end", "scheduled"]);
  // 마지막 정상 상태(10/21 실행 직후) — ⒜ 0 · ⒝ 0
  assert.deepEqual(owedDays(db.raw, "2026-10-22"), []);
}));

test("⚠T1 OWED_LOOKBACK_DAYS 는 수집 판정의 LOOKBACK_DAYS 와 같다 — 감시가 우는 창과 owed 가 이어 받는 창이 같은 길이", () => {
  assert.equal(OWED_LOOKBACK_DAYS, LOOKBACK_DAYS);
  assert.equal(OWED_LOOKBACK_DAYS, 30);
});

test("T1 오늘이 YYYY-MM-DD 가 아니면 던진다(모르는 기준으로 범위를 만들지 않는다)", () => withDb((db) => {
  for (const bad of ["2026-10-3", "2026-02-30", "", "2026/10/30"]) assert.throws(() => owedDays(db.raw, bad), RangeError, JSON.stringify(bad));
}));

// ---- D2 확인된 휴식일 --------------------------------------------------------------------------

/**
 * ⚠⚠**D2** — `since` 다음 날부터 하루씩: 그 달 사본을 **그 날 뒤에** 봤고(JST 날짜 > d) 세 표(예정 · 치러짐 표시 · 경기)에 그 날 행이 0 이면
 * 확인된 휴식일이다. 이어진 끝(`gapFrom`)을 따라잡기 간격의 기준으로 넘긴다 — 휴식이 7일 상한을 갉아먹지 않게.
 */
test("⚠⚠T2 설계 예 — since 10/17 · 사본 10/21 → 10/18·19·20 확인 · 10/21(본 날 = 그 날)은 미확인 → 10/20", () => withDb((db) => {
  month(db, 2026, 10, SEEN_1021);
  game(db, "2026-10-17", "h", "f");
  upcoming(db, "2026-10-24", "db", "h");
  assert.equal(confirmedRestThrough(db.raw, "2026-10-17", "2026-10-26", NO_GAME_MONTHS), "2026-10-20");
}));

test("⚠⚠T2 본 날이 그 날과 같으면 확인이 아니다 — 경계는 JST 달력 날짜", async () => {
  await withDb((db) => {
    month(db, 2026, 10, "2026-10-21T14:59:59Z"); // JST 10/21 23:59:59
    assert.equal(confirmedRestThrough(db.raw, "2026-10-20", "2026-10-26", NO_GAME_MONTHS), "2026-10-20", "같은 날 본 사본으로 그 날을 휴식으로 확인했다");
  });
  await withDb((db) => {
    month(db, 2026, 10, "2026-10-21T15:00:00Z"); // JST 10/22 00:00
    assert.equal(confirmedRestThrough(db.raw, "2026-10-20", "2026-10-26", NO_GAME_MONTHS), "2026-10-21");
  });
});

test("⚠T2 그 날 행이 하나라도 있으면 거기서 멈춘다 — 예정 · 치러짐 표시 · 경기 행(중지 포함)", async () => {
  for (const put of [
    (db: Db) => upcoming(db, "2026-10-19", "db", "h"),
    (db: Db) => played(db, "2026-10-19", "db", "h"),
    (db: Db) => game(db, "2026-10-19", "db", "h", "notPlayed"),
  ]) {
    await withDb((db) => {
      month(db, 2026, 10, SEEN_1021);
      put(db);
      assert.equal(confirmedRestThrough(db.raw, "2026-10-17", "2026-10-26", NO_GAME_MONTHS), "2026-10-18");
    });
  }
});

test("⚠T2 월 경계 — 다음 달 날은 다음 달 사본으로 본다 · 다음 달 사본이 없으면 거기서 멈춘다", async () => {
  await withDb((db) => {
    month(db, 2026, 10, "2026-11-03T00:00:00Z");
    month(db, 2026, 11, "2026-11-03T00:00:00Z");
    assert.equal(confirmedRestThrough(db.raw, "2026-10-29", "2026-11-05", NO_GAME_MONTHS), "2026-11-02");
  });
  await withDb((db) => {
    month(db, 2026, 10, "2026-11-03T00:00:00Z");
    assert.equal(confirmedRestThrough(db.raw, "2026-10-29", "2026-11-05", NO_GAME_MONTHS), "2026-10-31", "다음 달 사본 없이 그 달 날을 확인했다");
  });
});

/** ⚠**대진 미정 날**(예정 표기라 `upcoming_game` 에 없다) — 사본을 그 날 **전에** 봤으면 확인하지 않는다(콜드 리뷰 1 P1) */
test("⚠T2 사본을 그 날 전에 봤으면 확인하지 않는다(대진 미정 날이 휴식으로 오인되지 않는다) · gapFrom ≥ since", () => withDb((db) => {
  month(db, 2026, 10, SEEN_1021);
  assert.equal(confirmedRestThrough(db.raw, "2026-10-21", "2026-10-30", NO_GAME_MONTHS), "2026-10-21");
  assert.equal(confirmedRestThrough(db.raw, "2026-10-25", "2026-10-30", NO_GAME_MONTHS), "2026-10-25");
}));

test("T2 사본 본 시각 모름 · 사본 없음 → 확인하지 않는다(M11)", async () => {
  await withDb((db) => {
    month(db, 2026, 10, null);
    assert.equal(confirmedRestThrough(db.raw, "2026-10-17", "2026-10-26", NO_GAME_MONTHS), "2026-10-17");
  });
  await withDb((db) => {
    assert.equal(confirmedRestThrough(db.raw, "2026-10-17", "2026-10-26", NO_GAME_MONTHS), "2026-10-17");
  });
});

test("T2 어제를 넘지 않는다 · since 가 어제 이후면 since 그대로", () => withDb((db) => {
  month(db, 2026, 10, "2026-11-30T00:00:00Z");
  assert.equal(confirmedRestThrough(db.raw, "2026-10-17", "2026-10-26", NO_GAME_MONTHS), "2026-10-25", "어제(10/25)를 넘었다 — 오늘 이후는 확인할 수 없다");
  assert.equal(confirmedRestThrough(db.raw, "2026-10-25", "2026-10-26", NO_GAME_MONTHS), "2026-10-25");
  assert.equal(confirmedRestThrough(db.raw, "2026-10-28", "2026-10-26", NO_GAME_MONTHS), "2026-10-28");
}));

/**
 * ## ⚠⚠비시즌 달(`NO_GAME_MONTHS` = 12·1·2) — 사본 없이도 세 표 0행이면 확인한다 (PR-2b 검토 P2-1 · PR-4 설계 D1-c 를 당겼다)
 *
 * 12·1·2월은 그 달 일정 사본이 없다(보유 9시즌 0장). 사본 조건만으로 확인하면 확인이 11/30 에서 멈춰 `gapFrom` 이 월말에 걸리고,
 * 12월 첫 주마다 사이 메우기로 날짜 자식이 최대 +6(약 126요청)이 됐다 — 「비시즌 0」이 거짓이었다.
 * ⚠**11월은 넣지 않는다** — 경기가 열리는 해가 있다. 사본 없는 11월 날은 여전히 미확인이다.
 * ⚠비시즌 달이라도 **그 날 행이 있으면 멈춘다**(보수적인 쪽).
 */
test("⚠⚠T2′ 11월 확인 · 12월 사본 없음 · 12/05 판정 → 12-04 (비시즌 달은 사본 조건 없이 세 표 0행으로 확인)", () => withDb((db) => {
  month(db, 2026, 11, "2026-12-01T00:00:00Z");
  game(db, "2026-11-01", "db", "h");
  assert.equal(confirmedRestThrough(db.raw, "2026-11-01", "2026-12-05", NO_GAME_MONTHS), "2026-12-04", "사본 없는 12월에서 멈췄다 — 12월 첫 주 사이 메우기가 는다");
  // 고치기 전 규칙(비시즌 달 없음)이면 11/30 에서 멈춘다
  assert.equal(confirmedRestThrough(db.raw, "2026-11-01", "2026-12-05", []), "2026-11-30");
}));

test("⚠⚠T2′ 12/31 까지 확인 · 1월 사본 없음 · 1/3 판정 → 01-02 (해 넘김에서도 멈추지 않는다)", () => withDb((db) => {
  month(db, 2026, 11, "2026-12-01T00:00:00Z");
  game(db, "2026-11-01", "db", "h");
  assert.equal(confirmedRestThrough(db.raw, "2026-11-01", "2027-01-03", NO_GAME_MONTHS), "2027-01-02");
}));

test("⚠⚠T2′ 11월 날은 사본이 없으면 미확인 — 11월은 비시즌 달이 아니다(경기가 열리는 해가 있다)", () => withDb((db) => {
  month(db, 2026, 10, "2026-11-03T00:00:00Z");
  game(db, "2026-10-29", "h", "db");
  assert.equal(confirmedRestThrough(db.raw, "2026-10-29", "2026-11-05", NO_GAME_MONTHS), "2026-10-31", "사본 없는 11월 날을 휴식으로 확인했다");
}));

test("⚠T2′ 비시즌 달이라도 그 날 행(예정 · 치러짐 표시 · 경기)이 있으면 멈춘다", async () => {
  for (const put of [
    (d: Db) => upcoming(d, "2026-12-03", "g", "t"),
    (d: Db) => played(d, "2026-12-03", "g", "t"),
    (d: Db) => game(d, "2026-12-03", "g", "t", "notPlayed"),
  ]) {
    await withDb((db) => {
      month(db, 2026, 11, "2026-12-01T00:00:00Z");
      put(db);
      assert.equal(confirmedRestThrough(db.raw, "2026-11-30", "2026-12-06", NO_GAME_MONTHS), "2026-12-02");
    });
  }
});

test("⚠T2′ ⒝ 는 사본 행이 없는 달·내용이 없던 달을 후보로 안 낸다 — 12월 · 1월", async () => {
  await withDb((db) => {
    month(db, 2026, 11, "2026-12-01T00:00:00Z");
    assert.deepEqual(owedDays(db.raw, "2027-01-05"), [], "사본 행이 없는 12월로 12/31 을 냈다");
  });
  await withDb((db) => {
    month(db, 2026, 12, "2026-12-15T00:00:00Z", null);
    month(db, 2027, 1, "2027-01-20T00:00:00Z", null);
    assert.deepEqual(owedDays(db.raw, "2027-02-03"), [], "내용 없는 비시즌 사본으로 말일을 냈다");
  });
});

test("T2′ 비시즌 달 목록이 1~12 의 정수가 아니면 던진다(모르는 달로 확인하지 않는다)", () => withDb((db) => {
  for (const bad of [[0], [13], [1.5], [Number.NaN]]) {
    assert.throws(() => confirmedRestThrough(db.raw, "2026-11-01", "2026-12-05", bad), RangeError, JSON.stringify(bad));
  }
}));

/**
 * ## ⚠⚠잎의 SQL 조각 ≡ 수집 판정 증거 A·B (PR-2b 검토 P3-3)
 *
 * 따라잡기의 owed ⒜ 와 감시(`collectionEvidence`)의 A·B 는 **같은 표 · 같은 식**을 두 곳에 적었다(잎은 import 0 이라 그 SQL 을 가져올 수 없다).
 * 같은 임시 DB 로 날 집합을 대조해 두 벌이 갈리면 여기서 붉게 한다.
 * ⚠**오늘 포함 여부는 의도된 차이다** — A·B 는 `[오늘 − 30, 오늘]` 이고 owed 는 `[오늘 − 30, 어제]`(오늘은 22시 이후 실행의 몫)다.
 * - A(치러짐인데 경기 없음) ≡ ⒜-치러짐 표시: 카드(날 · 홈 · 원정 · seq) 단위로 같다.
 * - B 의 「사본이 D 뒤에 안 보였다」 조각 ≡ ⒜-예정의 조건 4: 예고와 예정이 같은 날에 있고 그 날 경기 행·휴식 공표가 없을 때 날 집합이 같다.
 */
test("⚠⚠P3-3 owed ⒜-치러짐 표시 ≡ 수집 판정 A(카드 단위) · ⒜-예정의 사본 조건 ≡ B 의 사본 조건 — 오늘만 다르다(의도)", () => withDb((db) => {
  const TODAY = "2026-10-30";
  // A 쪽 — 경계(−30 · −31) · 오늘 · 어제 · 더블헤더 · 중지 · 올스타 · 다른 카드의 경기 행
  for (const d of ["2026-09-29", "2026-09-30", "2026-10-29", "2026-10-30"]) played(db, d, "g", "t");
  played(db, "2026-10-10", "s", "d", 0);
  played(db, "2026-10-10", "s", "d", 1);
  game(db, "2026-10-10", "s", "d");
  played(db, "2026-10-11", "c", "db");
  game(db, "2026-10-11", "c", "db", "notPlayed");
  played(db, "2026-10-12", "cl", "pl");
  played(db, "2026-10-13", "b", "f");
  game(db, "2026-10-13", "e", "m");
  // B 쪽 — 예고와 예정이 같은 날 · 경기 행 없음 · 사본(10/21 18:50 JST)이 그 날 뒤를 봤는지만 다르다
  month(db, 2026, 10, SEEN_1021);
  for (const d of ["2026-10-20", "2026-10-21", "2026-10-22", "2026-10-30"]) {
    upcoming(db, d, "h", "db");
    upsertProbablePitcher(db, {
      gameDate: d, teamCode: "h", opponentCode: "db", playerId: null, sourceName: null, venue: null,
      startTime: "18:00", league: "pl", sourceUrl: "https://npb.jp/announcement/starter/", fetchedAt: NOW,
    });
  }
  const e = collectionEvidence(db, TODAY);
  const o = owedDays(db.raw, TODAY);
  const owedPlayed = o.flatMap((x) => x.reasons.flatMap((r) => (r.kind === "played" ? [[x.date, r.homeCode, r.awayCode, r.seq]] : [])));
  const aCards = e.playedWithoutGame.map((m) => [m.date, m.homeCode, m.awayCode, m.seq]);
  assert.deepEqual(aCards.filter(([d]) => d !== TODAY), owedPlayed, "A 와 owed ⒜-치러짐 표시가 갈렸다 — 두 벌의 SQL 중 한쪽만 고쳤다");
  assert.ok(aCards.some(([d]) => d === TODAY) && !owedPlayed.some(([d]) => d === TODAY), "오늘의 차이(A 포함 · owed 제외)가 전제와 다르다");
  assert.ok(owedPlayed.length >= 4, `대조한 카드가 ${String(owedPlayed.length)}개뿐이다 — 이 시험이 공회전한다`);
  const owedScheduled = o.filter((x) => x.reasons.some((r) => r.kind === "scheduled")).map((x) => x.date);
  const bDates = [...new Set(e.announcedWithoutGame.map((m) => m.date))];
  assert.deepEqual(bDates.filter((d) => d !== TODAY), owedScheduled, "B 와 owed ⒜-예정의 사본 조건이 갈렸다");
  assert.deepEqual(owedScheduled, ["2026-10-21", "2026-10-22"], "사본 조건의 전제(10/20 은 사본이 뒤에 봤다 · 10/21·22 는 못 봤다)가 틀렸다");
}));

test("T2 since · 오늘이 YYYY-MM-DD 가 아니면 던진다", () => withDb((db) => {
  assert.throws(() => confirmedRestThrough(db.raw, "2026/10/17", "2026-10-26", NO_GAME_MONTHS), RangeError);
  assert.throws(() => confirmedRestThrough(db.raw, "2026-10-17", "2026-13-01", NO_GAME_MONTHS), RangeError);
}));

// ---- 잎 ----------------------------------------------------------------------------------------

/** ⚠줄끝을 `\n` 으로 맞춰 읽는다 — Windows 체크아웃은 CRLF 다 */
function readLf(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8").replace(/\r\n/g, "\n");
}

/**
 * ⚠**잎이어야 한다**(I1 · `refetch-limit.ts` · `game-slug.ts` 선례). `scripts/collected-through.ts`(→ `update.ts`)가 서브패스로 가져온다 —
 * 무엇이든 import 하면 그 사슬의 로드 오류가 **수집을 시작 전에** 죽인다.
 */
test("⚠I1 schedule-owed.ts 는 import 가 0개인 잎이고 · 서브패스 `@bb-app/store/schedule-owed` 로 같은 함수를 내보낸다", async () => {
  assert.equal(/^\s*import\b/m.test(readLf("../src/schedule-owed.ts")), false, "schedule-owed.ts 에 import 문이 있다");
  const pkg = JSON.parse(readLf("../package.json")) as { exports: Record<string, string> };
  assert.equal(pkg.exports["./schedule-owed"], "./src/schedule-owed.ts", "package.json 의 exports 에 ./schedule-owed 가 없다");
  const viaSubpath = (await import("@bb-app/store/schedule-owed")) as { owedDays: unknown; confirmedRestThrough: unknown };
  assert.equal(viaSubpath.owedDays, owedDays, "서브패스로 가져온 것이 같은 함수가 아니다");
  assert.equal(viaSubpath.confirmedRestThrough, confirmedRestThrough);
});
