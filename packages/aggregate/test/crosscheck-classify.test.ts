/**
 * **외부 대조의 판정 규칙** — 「결함」과 「정의·표기 차이」를 가르는 자리.
 *
 * ⚠**이 판정이 대조의 전부다.** 여기서 잘못 접으면 **진짜 결함이 조용히 지나가고**,
 * 반대로 안 접으면 도구가 늘 붉어져 **아무도 안 보게 된다.** 둘 다 대조를 죽인다.
 *
 * ## ⚠CI 배선 첫날에 잡힌 것 (2026-08-28)
 *
 * `crosscheck` 를 워크플로에 넣은 **첫 실행이 배포를 막았다** — 게이트가 의도대로 문 것이다.
 * 공표표가 08-16 → **08-27** 로 갱신되면서 **11일치 새 경기가 처음 외부 대조를 받았고**,
 * 日本ハム **清宮 虎多朗** 에서 2건이 걸렸다. 공표 원문(실측):
 *
 * `登板 1 · 打者 3 · 投球回 + · 安打 2 · 四球 1 · 失点 1 · 自責点 1 · 防御率 ----`
 *
 * **3타자에게 안타 2 + 사사구 1 이면 아웃이 0** 이다 — npb.jp 는 그런 등판을
 * 投球回 `+` · 防御率 `----` 로 적는다. **우리 `0` 과 `—` 가 맞고, 결함이 아니라 표기다.**
 *
 * ⚠**이름으로 면제하지 않았다.** 그랬다면 **그 사람만** 넘어가고 다음 투수가 같은 등판을
 * 하는 날 또 붉어졌을 것이다. **표기의 뜻**을 가르쳤으므로 다음에도 성립한다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyDiff } from "../src/crosscheck-classify.ts";
import type { CrosscheckDiff } from "../src/crosscheck-classify.ts";

function diff(o: Partial<CrosscheckDiff>): CrosscheckDiff {
  return { team: "f", kind: "pitching", name: "テスト", field: "投球回", ours: "0", published: "+", ...o };
}

test("⚠아웃 0 인 등판의 공표 표기 「+」를 우리 「0」과 같은 뜻으로 본다 — 실측 사례", () => {
  const why = classifyDiff(diff({ name: "清宮", field: "投球回", ours: "0", published: "+" }));
  assert.notEqual(why, null, "실제로 CI 를 멈춘 사례가 결함으로 남는다");
  assert.match(why!, /아웃 0/);
});

test("⚠이닝 0 이면 방어율이 정의되지 않는다 — 공표 「----」와 우리 「—」", () => {
  const why = classifyDiff(diff({ field: "防御率", ours: "-", published: "----" }));
  assert.notEqual(why, null);
  assert.match(why!, /정의되지 않는다/);
});

/**
 * ⚠**여기가 급소다.** 「`+` 면 무조건 넘긴다」로 짰다면 **우리가 3이닝인데 공표가 `+`** 인
 * 진짜 결함까지 지나간다 — 그건 **우리가 있지도 않은 아웃을 셌다**는 뜻이다.
 */
test("⚠우리 쪽이 0 이 아니면 「+」를 넘기지 않는다 — 진짜 결함을 접지 않는다", () => {
  for (const ours of ["3", "0.1", "1", "76.1"]) {
    assert.equal(
      classifyDiff(diff({ field: "投球回", ours, published: "+" })),
      null,
      `우리 ${ours} 인데 공표가 「+」인 것을 정의 차이로 접었다 — 있지도 않은 아웃을 센 것이다`,
    );
  }
});

/** ⚠**우리가 수를 냈는데 공표가 `----`** 면 분모 0 에 값을 낸 것이다(M2 위반) — 접지 않는다 */
test("⚠우리 쪽이 값을 냈으면 「----」를 넘기지 않는다", () => {
  for (const ours of ["0.00", "4.13", "-0.00"]) {
    assert.equal(
      classifyDiff(diff({ field: "防御率", ours, published: "----" })),
      null,
      `우리 ${ours} 인데 공표가 「----」인 것을 접었다 — 분모 0 에 값을 낸 상태다`,
    );
  }
});

/** ⚠**다른 항목까지 번지지 않는다** — 표기 규칙은 그 항목의 것이다 */
test("⚠「+」 규칙이 다른 항목으로 번지지 않는다", () => {
  assert.equal(classifyDiff(diff({ field: "安打", ours: "0", published: "+" })), null);
  assert.equal(classifyDiff(diff({ kind: "batting", field: "投球回", ours: "0", published: "+" })), null);
});

/** 기존 두 규칙이 그대로 산다 — 새 규칙을 넣다가 옛 규칙을 지우지 않았는지 */
test("옛 규칙 둘이 그대로 성립한다", () => {
  assert.match(
    classifyDiff(diff({ kind: "batting", field: "打率", ours: "-", published: ".000" }))!,
    /M11/,
  );
  assert.match(
    classifyDiff(diff({ kind: "batting", field: "試合", ours: "10", published: "12" }))!,
    /出場試合/,
  );
});

/** ⚠**아무것도 안 접는 상태**가 기본이다 — 모르면 결함 후보로 남긴다(M7 의 정신) */
test("⚠모르는 차이는 결함 후보로 남는다", () => {
  assert.equal(classifyDiff(diff({ field: "三振", ours: "54", published: "55" })), null);
});
