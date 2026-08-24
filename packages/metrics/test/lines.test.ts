import { test } from "node:test";
import assert from "node:assert/strict";
import { inningsFromOuts, inningsPitched, singles, totalBases } from "../src/lines.ts";
import type { BattingLine, PitchingLine } from "../src/lines.ts";

const BAT: BattingLine = {
  pa: 600, ab: 520, h: 156, double: 30, triple: 3, hr: 25,
  bb: 60, ibb: 5, hbp: 8, sf: 6, sh: 6, so: 90, roe: 0,
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

/**
 * ⚠**「정본」이 실제로 쓰이는지 못 박는다**(2026-08-24 · 감사 P3 #52).
 *
 * 전에는 `inningsPitched` 가 **프로덕션 호출 0곳인 죽은 export** 였고 화면은 `web/format.ts` 의
 * 별벌을 썼다 — **죽은 정본은 「장치가 있다」는 착각만 남긴다.**
 * 지금은 규칙이 `inningsFromOuts` 하나이고 양쪽이 그것을 부른다.
 */
test("⚠inningsPitched 는 규칙을 다시 적지 않고 inningsFromOuts 를 쓴다", () => {
  for (const outs of [0, 1, 2, 3, 20, 21, 26, 431]) {
    assert.equal(
      inningsPitched({ ...PIT, outs }),
      inningsFromOuts(outs),
      `outs=${outs} 에서 두 답이 갈렸다 — 규칙이 다시 두 벌이 됐다`,
    );
  }
});

test("아웃 → 이닝 규칙", () => {
  assert.equal(inningsFromOuts(0), "0");
  assert.equal(inningsFromOuts(1), "0.1");
  assert.equal(inningsFromOuts(20), "6.2");
  assert.equal(inningsFromOuts(21), "7");
});
