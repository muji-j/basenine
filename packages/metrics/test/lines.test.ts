import { test } from "node:test";
import assert from "node:assert/strict";
import { inningsPitched, singles, totalBases } from "../src/lines.ts";
import type { BattingLine, PitchingLine } from "../src/lines.ts";

const BAT: BattingLine = {
  pa: 600, ab: 520, h: 156, double: 30, triple: 3, hr: 25,
  bb: 60, ibb: 5, hbp: 8, sf: 6, sh: 6, so: 90,
};

test("단타 = 안타 − 2루타 − 3루타 − 홈런", () => {
  assert.equal(singles(BAT), 156 - 30 - 3 - 25);
});

test("루타 = 단타 + 2×2루타 + 3×3루타 + 4×홈런", () => {
  assert.equal(totalBases(BAT), 98 + 2 * 30 + 3 * 3 + 4 * 25);
});

const PIT: PitchingLine = {
  outs: 500, bf: 700, h: 150, hr: 12, bb: 45, ibb: 3, hbp: 5, so: 160, er: 60, r: 66,
};

test("⚠이닝 표기는 아웃 카운트에서 만든다 — 6.2는 6+2/3이지 6.2가 아니다", () => {
  assert.equal(inningsPitched({ ...PIT, outs: 20 }), "6.2");
  assert.equal(inningsPitched({ ...PIT, outs: 21 }), "7");
  assert.equal(inningsPitched({ ...PIT, outs: 19 }), "6.1");
  assert.equal(inningsPitched({ ...PIT, outs: 0 }), "0");
});

test("이닝 표기는 반올림하지 않는다", () => {
  assert.equal(inningsPitched({ ...PIT, outs: 500 }), "166.2");
});
