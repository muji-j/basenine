import { test } from "node:test";
import assert from "node:assert/strict";
import { leagueConstants, sumBatting, sumPitching } from "../src/league.ts";
import { earnedRunAverage } from "../src/pitching.ts";
import type { BattingLine, PitchingLine } from "../src/lines.ts";

const A: BattingLine = { pa: 100, ab: 90, h: 27, double: 5, triple: 1, hr: 3, bb: 8, ibb: 1, hbp: 1, sf: 1, sh: 0, so: 20 };
const B: BattingLine = { pa: 200, ab: 180, h: 45, double: 8, triple: 0, hr: 6, bb: 15, ibb: 0, hbp: 2, sf: 3, sh: 0, so: 40 };

const P1: PitchingLine = { outs: 243, bf: 330, h: 75, hr: 9, bb: 22, ibb: 1, hbp: 4, so: 90, er: 27, r: 30 };
const P2: PitchingLine = { outs: 243, bf: 330, h: 75, hr: 9, bb: 23, ibb: 2, hbp: 5, so: 90, er: 27, r: 30 };

test("타격 집계는 전 필드를 더한다", () => {
  const s = sumBatting([A, B]);
  assert.equal(s.pa, 300);
  assert.equal(s.ab, 270);
  assert.equal(s.h, 72);
  assert.equal(s.ibb, 1);
  assert.equal(s.so, 60);
});

test("빈 배열의 집계는 전부 0이다", () => {
  const s = sumBatting([]);
  assert.equal(s.pa, 0);
  assert.equal(s.h, 0);
});

test("투구 집계는 아웃 카운트를 더한다", () => {
  const s = sumPitching([P1, P2]);
  assert.equal(s.outs, 486);
  assert.equal(s.bb, 45);
  assert.equal(s.hbp, 9);
});

test("⚠cFIP는 리그 전체를 넣었을 때 FIP가 리그 ERA와 같아지도록 정의된다", () => {
  const pitching = sumPitching([P1, P2]);
  const c = leagueConstants({
    season: 2026, league: "central", batting: sumBatting([A, B]), pitching, runs: 60,
  });
  const raw = ((13 * pitching.hr + 3 * (pitching.bb + pitching.hbp) - 2 * pitching.so) * 3) / pitching.outs;
  const leagueEra = earnedRunAverage(pitching).value;
  assert.ok(leagueEra !== null);
  assert.ok(Math.abs(raw + c.cFip - leagueEra) < 1e-9);
});

test("리그 득점/타석", () => {
  const c = leagueConstants({
    season: 2026, league: "central",
    batting: sumBatting([A, B]), pitching: sumPitching([P1, P2]), runs: 60,
  });
  assert.equal(c.runsPerPa, 60 / 300);
  assert.equal(c.season, 2026);
  assert.equal(c.league, "central");
});

test("⚠표본이 비면 상수를 만들지 않고 던진다", () => {
  assert.throws(
    () => leagueConstants({
      season: 2026, league: "central",
      batting: sumBatting([]), pitching: sumPitching([]), runs: 0,
    }),
    RangeError,
    "0으로 나눈 상수를 조용히 돌려주면 그 시즌 전 지표가 조용히 틀린다",
  );
});

test("⚠투구 표본만 비어도 던진다", () => {
  assert.throws(
    () => leagueConstants({
      season: 2026, league: "central",
      batting: sumBatting([A]), pitching: sumPitching([]), runs: 10,
    }),
    RangeError,
  );
});
