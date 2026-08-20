import { test } from "node:test";
import assert from "node:assert/strict";
import { WOBA_SCALE, WOBA_WEIGHTS, woba, wobaRaw } from "../src/woba.ts";
import type { BattingLine } from "../src/lines.ts";

const LINE: BattingLine = {
  pa: 600, ab: 500, h: 150, double: 30, triple: 2, hr: 20,
  bb: 70, ibb: 5, hbp: 10, sf: 20, sh: 0, so: 100, roe: 0,
};

/**
 * ⚠**이 본의 이름이 예전에는 「wOBA 계수는 1.02 공개값과 일치한다」였다**(2026-08-20 교체).
 * 지금 이 상수는 **우리가 유도한 폴백**이고, 화면이 쓰는 것은 리그·시즌마다 유도한 쪽이다
 * (`LeagueConstants.wobaWeights`). 여기서 고정하는 것은 **값 자체가 아니라 성질**이다 —
 * 값을 그대로 베껴 적으면 다음 백필에서 이 본은 「구현이 무엇이든 통과」하는 복사가 된다
 * (규정타석 P0 가 그 모양이었다 · `ranking.ts` 표제부).
 */
test("⚠폴백 계수는 우리 유도값이고, 사건 사이의 크기 관계가 서 있다", () => {
  const w = WOBA_WEIGHTS;
  assert.ok(w.bb < w.hbp, "사구는 볼넷보다 크다");
  /**
   * ⚠**실책 출루가 단타보다 크다** — 처음에 「사구와 단타 사이」로 적었다가 실측에 틀렸다.
   * 우리 로그가 그렇게 말한다: 2025 센트럴에서 실책 출루의 평균 득점가치 **+0.404** ·
   * 단타 **+0.372**. 실책은 타자를 살리면서 **주자를 단타보다 멀리 보내는 일이 잦다.**
   * ⚠**추측을 시험에 적지 마라** — 우리는 이 값을 재고 있고, 재는 쪽이 이긴다.
   */
  assert.ok(w.hbp < w.roe, "실책 출루는 사구보다 크다");
  assert.ok(w.single < w.roe && w.roe < w.double, "실책 출루는 단타와 2루타 사이다");
  assert.ok(w.single < w.double && w.double < w.triple && w.triple < w.hr);
  // 눈금이 출루율 쪽이라 단타가 0.8~0.95, 홈런이 2 넘는 자리에 있다.
  // ⚠**범위이지 값이 아니다** — 백필로 조금 움직여도 참이고, 눈금이 깨지면 잡힌다
  assert.ok(w.single > 0.8 && w.single < 0.95, `단타 ${w.single}`);
  assert.ok(w.hr > 2 && w.hr < 2.5, `홈런 ${w.hr}`);
  assert.ok(WOBA_SCALE > 1.1 && WOBA_SCALE < 1.6, `scale ${WOBA_SCALE}`);
});

test("⚠wOBA는 볼넷에서 고의사구를 뺀다", () => {
  const w = WOBA_WEIGHTS;
  const single = 150 - 30 - 2 - 20; // 98
  // 失策出塁 항은 공개 소스가 없어 생략한다(정의서에 명시).
  const numerator =
    w.bb * (70 - 5) + w.hbp * 10 + w.single * single + w.double * 30 + w.triple * 2 + w.hr * 20;
  const denominator = 500 + (70 - 5) + 10 + 20;
  assert.ok(Math.abs(woba(LINE).value! - numerator / denominator) < 1e-12);
  assert.equal(woba(LINE).denominator, denominator);
});

test("고의사구가 늘면 wOBA 분모와 분자가 함께 줄어든다", () => {
  const moreIbb: BattingLine = { ...LINE, ibb: 20 };
  assert.notEqual(woba(moreIbb).value, woba(LINE).value);
  assert.equal(woba(moreIbb).denominator, 500 + (70 - 20) + 10 + 20);
});

test("⚠실책 출루(失策出塁)가 wOBA에 반영된다", () => {
  // 소스 조사에서는 「공개 소스 없음」으로 판정했으나, 박스스코어 타석 셀(`三ゴ失`)에
  // 인코딩돼 있음을 실측했다(2026-08-15). 따라서 공식 산식을 생략 없이 계산한다.
  const withRoe: BattingLine = { ...LINE, roe: 4 };
  const gain = woba(withRoe).value! - woba(LINE).value!;
  const denominator = 500 + (70 - 5) + 10 + 20;
  assert.ok(
    Math.abs(gain - (WOBA_WEIGHTS.roe * 4) / denominator) < 1e-12,
    "실책 출루 4개가 계수 0.966으로 분자에만 더해져야 한다",
  );
});

test("⚠실책 출루는 wOBA 분모를 바꾸지 않는다 — 이미 타수에 들어 있다", () => {
  assert.equal(woba({ ...LINE, roe: 9 }).denominator, woba(LINE).denominator);
});

test("wOBA는 홈런이 늘면 증가한다", () => {
  const more: BattingLine = { ...LINE, h: 151, hr: 21, ab: 501 };
  assert.ok(woba(more).value! > woba(LINE).value!);
});

test("wOBA는 단타보다 장타에 큰 가중을 준다", () => {
  const w = WOBA_WEIGHTS;
  assert.ok(w.single < w.double);
  assert.ok(w.double < w.triple);
  assert.ok(w.triple < w.hr);
  assert.ok(w.bb < w.single, "볼넷은 단타보다 가치가 낮다");
});

test("⚠타석이 없으면 null이다", () => {
  const empty: BattingLine = {
    pa: 0, ab: 0, h: 0, double: 0, triple: 0, hr: 0, bb: 0, ibb: 0, hbp: 0, sf: 0, sh: 0, so: 0, roe: 0,
  };
  assert.equal(woba(empty).value, null);
  assert.equal(wobaRaw(empty), null);
});

test("성적을 전부 2배로 해도 wOBA는 변하지 않는다", () => {
  const doubled = Object.fromEntries(
    Object.entries(LINE).map(([k, v]) => [k, v * 2]),
  ) as unknown as BattingLine;
  assert.ok(Math.abs(woba(doubled).value! - woba(LINE).value!) < 1e-12);
});
