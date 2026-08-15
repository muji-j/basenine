/**
 * 용어집과 수준 등급.
 *
 * ⚠**여기서 지키는 것은 「조용히 사라지는 것」과 「조용히 뒤집히는 것」이다.**
 * 툴팁은 안 떠도 화면이 멀쩡해 보이고, 색이 반대로 칠해져도 값은 맞으므로,
 * 사람 눈으로는 둘 다 발견되지 않는다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { GLOSSARY, glossaryKeys, termKeyForLabel, termOf } from "../src/glossary.ts";
import { GRADE_LABEL, SCALES, gradeClass, gradeOf, gradeOrder, isGraded } from "../src/grade.ts";
import { statRate, statRateOuts, term, termAttr } from "../src/parts.ts";
import { toString } from "../src/html.ts";
import { r } from "./fixtures.ts";

// ─── 용어집 ──────────────────────────────────────────────────────────────

test("모든 용어가 화면 라벨로 도달 가능하다 — 역인덱스가 끊기면 툴팁이 조용히 사라진다", () => {
  const unreachable = glossaryKeys().filter((k) => termKeyForLabel(GLOSSARY[k]!.label) !== k);
  assert.deepEqual(unreachable, [], `라벨로 되찾을 수 없는 용어: ${unreachable.join(", ")}`);
});

test("라벨이 중복되지 않는다 — 겹치면 한쪽 설명이 다른 쪽을 덮어쓴다", () => {
  const labels = glossaryKeys().map((k) => GLOSSARY[k]!.label);
  assert.equal(new Set(labels).size, labels.length, `중복된 라벨: ${labels.join(", ")}`);
});

test("⚠打率와 被打率는 다른 용어다 — 같은 키로 묶이면 투수 화면이 타자 설명을 낸다", () => {
  assert.equal(termKeyForLabel("打率"), "avg");
  assert.equal(termKeyForLabel("被打率"), "allowedAvg");
  assert.notEqual(termOf("allowedAvg")!.short, termOf("avg")!.short);
  // 방향이 반대라는 사실을 말하고 있어야 한다
  assert.match(termOf("allowedAvg")!.caveat ?? "", /低いほど良い/);
});

test("설명은 비어 있지 않다 — 빈 툴팁은 없는 것보다 나쁘다", () => {
  for (const k of glossaryKeys()) {
    const t = GLOSSARY[k]!;
    assert.ok(t.label.length > 0, `${k}: 라벨이 비었다`);
    assert.ok(t.short.length >= 8, `${k}: 설명이 너무 짧다 — ${t.short}`);
  }
});

test("⚠백틱이 없다 — 클라이언트 스크립트가 템플릿 리터럴로 실려 나간다", () => {
  const json = JSON.stringify(GLOSSARY);
  assert.ok(!json.includes("`"), "백틱이 들어가면 site.js가 통째로 깨진다");
});

test("등급이 있는 지표는 전부 용어집에도 있다 — 색만 있고 설명이 없으면 읽을 수 없다", () => {
  const missing = Object.keys(SCALES).filter((k) => termOf(k) === undefined);
  assert.deepEqual(missing, [], `설명 없는 등급 지표: ${missing.join(", ")}`);
});

// ─── 등급 ────────────────────────────────────────────────────────────────

test("임계값은 오름차순이다 — 뒤집히면 등급이 조용히 뭉개진다", () => {
  for (const [k, s] of Object.entries(SCALES)) {
    const sorted = [...s.thresholds].every((v, i, a) => i === 0 || a[i - 1]! < v);
    assert.ok(sorted, `${k}: 임계값이 오름차순이 아니다 — ${s.thresholds.join(", ")}`);
  }
});

test("⚠방향이 맞다 — 낮을수록 좋은 지표에서 좋은 값이 「とても良い」로 나온다", () => {
  // 실데이터의 양 끝 (2026 시즌 실측)
  assert.equal(gradeOf("era", 0.36, 300), "veryGood");
  assert.equal(gradeOf("era", 6.9, 300), "veryBad");
  assert.equal(gradeOf("whip", 0.8, 300), "veryGood");
  assert.equal(gradeOf("bb9", 5.0, 300), "veryBad");
  assert.equal(gradeOf("kRate", 0.3, 300), "veryBad");
  assert.equal(gradeOf("kRate", 0.1, 300), "veryGood");
  // 높을수록 좋은 쪽
  assert.equal(gradeOf("wrcPlus", 227, 300), "veryGood");
  assert.equal(gradeOf("wrcPlus", 60, 300), "veryBad");
  assert.equal(gradeOf("k9", 11, 300), "veryGood");
});

test("⚠표본이 모자라면 등급이 없다 — 10타석 .400을 「とても良い」로 칠하지 않는다", () => {
  assert.equal(gradeOf("avg", 0.4, 10), null);
  assert.equal(gradeOf("avg", 0.4, 300), "veryGood");
  // 경계: minSample 미만은 null, 딱 맞으면 등급이 난다
  const min = SCALES["avg"]!.minSample;
  assert.equal(gradeOf("avg", 0.3, min - 1), null);
  assert.notEqual(gradeOf("avg", 0.3, min), null);
});

test("등급을 매기지 않는 지표가 있다 — 운(BABIP)과 자체 지표(SRC)", () => {
  assert.equal(isGraded("babip"), false);
  assert.equal(isGraded("src"), false);
  assert.equal(isGraded("srcPer600"), false);
  assert.equal(gradeOf("babip", 0.4, 500), null);
});

test("값이 없으면 등급도 없다 — null은 「ふつう」가 아니다", () => {
  assert.equal(gradeOf("avg", null, 500), null);
  assert.equal(gradeOf("avg", Number.NaN, 500), null);
  assert.equal(gradeClass(null), "");
});

test("5단계가 전부 이름을 갖는다", () => {
  assert.equal(gradeOrder().length, 5);
  for (const g of gradeOrder()) {
    assert.ok(GRADE_LABEL[g].length > 0, `${g}: 이름이 없다`);
    assert.equal(gradeClass(g), `g-${g}`);
  }
});

test("임계값 사이의 값이 각 단계로 흩어진다 — 전부 한 단계에 몰리지 않는다", () => {
  const t = SCALES["ops"]!.thresholds;
  const got = [t[0]! - 0.05, t[0]!, t[1]!, t[2]!, t[3]!].map((v) => gradeOf("ops", v, 300));
  assert.deepEqual(got, ["veryBad", "bad", "average", "good", "veryGood"]);
});

// ─── 렌더링 ──────────────────────────────────────────────────────────────

test("용어 라벨은 누를 수 있는 버튼이 된다 — span+hover는 터치에서 열 수 없다", () => {
  const out = toString(term("打率"));
  assert.match(out, /<button class="term" type="button" data-term="avg"/);
  assert.match(out, /aria-describedby="tip"/);
});

test("용어집에 없는 라벨은 그냥 글자다 — 열리지 않는 버튼을 만들지 않는다", () => {
  assert.equal(toString(term("試合")), "試合");
});

test("⚠정렬 헤더에는 속성만 붙는다 — 버튼 안에 버튼을 넣을 수 없다", () => {
  assert.equal(termAttr("打率"), ' data-term="avg"');
  assert.equal(termAttr("球団"), "");
  assert.ok(!termAttr("打率").includes("<"), "속성이어야 한다");
});

test("색과 함께 **글자로도** 등급이 나간다 — 색각 이상과 스크린리더에서 색은 전달되지 않는다", () => {
  const out = toString(statRate("打率", r(0.32, 400), "打数"));
  assert.match(out, /class="v g-veryGood"/);
  assert.match(out, /<span class="vh">（とても良い）<\/span>/);
  // 분모는 여전히 붙는다(M2)
  assert.match(out, /400打数/);
});

test("표본이 얇으면 색도 등급 글자도 없다 — 분모만 남는다", () => {
  const out = toString(statRate("打率", r(0.4, 10), "打数"));
  assert.ok(!out.includes("g-veryGood"), "10타수에 색이 붙었다");
  assert.ok(!out.includes('class="vh"'), "10타수에 등급 글자가 붙었다");
  assert.match(out, /10打数/);
});

test("⚠아웃 분모 지표도 같은 규칙을 탄다 — 분모는 이닝으로 나온다", () => {
  const out = toString(statRateOuts("防御率", r(1.8, 300)));
  assert.match(out, /class="v g-veryGood"/);
  assert.match(out, /100回/, "300아웃은 100이닝이다");
  assert.ok(!out.includes("300回"), "아웃 수를 그대로 이닝이라 쓰면 분모가 3배가 된다");
});

test("등급이 없는 지표는 색 없이 그려진다 — BABIP", () => {
  const out = toString(statRate("BABIP", r(0.4, 400), "打数"));
  assert.match(out, /class="v"/);
  assert.ok(!out.includes("g-"), "BABIP에 등급이 붙었다");
  assert.match(out, /data-term="babip"/, "설명은 붙어야 한다");
});
