import { test } from "node:test";
import { r } from "./fixtures.ts";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { toString } from "../src/html.ts";
import {
  PITCHING_ANCHORS,
  PROFILE_ANCHORS,
  battingProfile,
  isEmptyProfile,
  isThinProfile,
  markLetter,
  markFigure,
  markProfile,
  markStamp,
  markStrip,
  paKind,
  pitchingProfile,
} from "../src/marks.ts";
import type { MarkPlayer, PaKind } from "../src/marks.ts";
import { colorOf } from "@bb-app/domain";

function player(playerId = "41045153"): MarkPlayer {
  return {
    playerId,
    name: "佐藤",
    teamName: "阪神タイガース",
    color: colorOf("t"),
    positionMark: "内",
  };
}

/** SVG 좌표에 NaN이 섞이면 브라우저가 그 도형을 통째로 버린다 — 조용히 사라진다 */
function assertFiniteCoords(svg: string): void {
  for (const m of svg.matchAll(/(?:points|[xy]|width|height|cx|cy|r)="([^"]*)"/g)) {
    for (const n of m[1]!.split(/[\s,]+/).filter((s) => s !== "")) {
      assert.ok(Number.isFinite(Number(n)), `좌표가 유한한 수가 아니다: ${JSON.stringify(n)}`);
    }
  }
}

// ── A안 印 ────────────────────────────────────────────────────────────────

/**
 * 테스트용 축 생성기 — **값만 주면 분모를 붙여 준다.**
 *
 * ⚠분모는 축마다 다르지만(打数/打席/投球回) 이 테스트들이 보는 것은 **모양과 방향**이다.
 * 분모가 값과 함께 나가는지는 M2 테스트가 따로 본다.
 */
function bp(o: { avg: number | null; obp: number | null; iso: number | null; bbRate: number | null; kRate: number | null }) {
  return battingProfile({
    avg: r(o.avg, 382), obp: r(o.obp, 442), iso: r(o.iso, 382),
    bbRate: r(o.bbRate, 442), kRate: r(o.kRate, 442),
  });
}
function pp(o: { k9: number | null; bb9: number | null; hr9: number | null; whip: number | null; era: number | null }) {
  return pitchingProfile({
    k9: r(o.k9, 300), bb9: r(o.bb9, 300), hr9: r(o.hr9, 300),
    whip: r(o.whip, 300), era: r(o.era, 300),
  });
}

test("같은 선수는 언제나 같은 문양이다 — 빌드마다 바뀌면 식별 표시가 아니다", () => {
  assert.equal(toString(markStamp(player())), toString(markStamp(player())));
});

test("다른 선수는 다른 문양이 된다", () => {
  const seen = new Set<string>();
  for (const id of ["41045153", "63165134", "71575132", "51255159", "21725159", "81985157"]) {
    seen.add(toString(markStamp(player(id))));
  }
  assert.equal(seen.size, 6, "서로 다른 ID가 같은 문양을 냈다");
});

test("문양은 좌우 대칭이다 — 무작위 잡음이 아니라 형태로 보이게", () => {
  const svg = toString(markStamp(player(), 50));
  const xs = [...svg.matchAll(/<rect x="([\d.]+)"/g)].map((m) => Number(m[1]));
  const cell = 50 / 5;
  const mirrored = xs.map((x) => Number((50 - cell - x).toFixed(1)));
  assert.deepEqual([...new Set(xs)].sort(), [...new Set(mirrored)].sort());
});

test("문양 좌표는 유한하다", () => {
  assertFiniteCoords(toString(markStamp(player())));
});

// ── B안 成績の紋 ──────────────────────────────────────────────────────────

test("성적 프로필은 5축이고 값과 표기를 함께 낸다", () => {
  const axes = bp({ avg: 0.317, obp: 0.403, iso: 0.304, bbRate: 0.127, kRate: 0.265 });
  assert.equal(axes.length, 5);
  assert.deepEqual(
    axes.map((a) => a.label),
    ["打率", "出塁", "長打", "選球", "接触"],
  );
  assert.equal(axes[0]!.text, ".317");
});

test("⚠삼진은 적을수록 좋다 — 뒤집어 넣지 않으면 모양이 정반대가 된다", () => {
  const few = bp({ avg: 0.25, obp: 0.3, iso: 0.1, bbRate: 0.08, kRate: 0.1 });
  const many = bp({ avg: 0.25, obp: 0.3, iso: 0.1, bbRate: 0.08, kRate: 0.35 });
  assert.ok(few[4]!.scaled! > many[4]!.scaled!, "삼진이 적은 쪽의 接触이 더 커야 한다");
});

test("정규화는 0~1로 잘린다 — 앵커 밖의 값이 도형을 뚫고 나가지 않는다", () => {
  const extreme = bp({ avg: 0.9, obp: 0.9, iso: 0.9, bbRate: 0.9, kRate: 0 });
  for (const a of extreme) assert.equal(a.scaled, 1);
  const zero = bp({ avg: 0, obp: 0, iso: 0, bbRate: 0, kRate: 1 });
  for (const a of zero) assert.equal(a.scaled, 0);
});

test("값이 없으면 null이고 0이 아니다(M11)", () => {
  const none = bp({ avg: null, obp: null, iso: null, bbRate: null, kRate: null });
  for (const a of none) {
    assert.equal(a.scaled, null);
    assert.equal(a.text, "—");
  }
});

test("성적이 하나도 없어도 도형이 깨지지 않는다 — 투수 페이지에서 실제로 일어난다", () => {
  const none = bp({ avg: null, obp: null, iso: null, bbRate: null, kRate: null });
  const svg = toString(markProfile(player(), none, "0打席"));
  assertFiniteCoords(svg);
  assert.match(svg, /<polygon/);
});

test("분모가 접근성 라벨에 들어간다(M2)", () => {
  const axes = bp({ avg: 0.317, obp: 0.403, iso: 0.304, bbRate: 0.127, kRate: 0.265 });
  assert.match(toString(markProfile(player(), axes, "442打席")), /442打席/);
});

test("축이 3개 미만이면 그리지 않는다 — 다각형이 되지 않는다", () => {
  assert.equal(toString(markProfile(player(), [{ label: "a", scaled: 1, text: "1", sample: "10打席", term: "avg", note: "", thin: false }], "10打席")), "");
});

test("앵커를 코드 밖에서 확인할 수 있다 — 표시 배율이지 지표가 아니다", () => {
  assert.deepEqual(PROFILE_ANCHORS.iso, [0.038, 0.098, 0.188]);
  assert.deepEqual(PROFILE_ANCHORS.contact, [0.701, 0.801, 0.872]);
});

// ── 투수 축 ───────────────────────────────────────────────────────────────

test("투수 프로필도 5축이고 값 표기는 소수 2자리다", () => {
  const axes = pp({ k9: 9.9, bb9: 2.25, hr9: 0.72, whip: 1.1, era: 2.7 });
  assert.deepEqual(
    axes.map((a) => a.label),
    ["奪三振", "制球", "被弾", "抑制", "失点"],
  );
  assert.equal(axes[0]!.text, "9.90");
});

test("⚠좋은 투수가 큰 도형이 된다 — 네 축이 뒤집혀 있지 않으면 뜻이 정반대가 된다", () => {
  const good = pp({ k9: 10, bb9: 1.6, hr9: 0.4, whip: 1.02, era: 2.1 });
  const bad = pp({ k9: 5, bb9: 4.5, hr9: 1.6, whip: 1.6, era: 5.2 });
  for (const [i, a] of good.entries()) {
    assert.ok(
      a.scaled! > bad[i]!.scaled!,
      `${a.label} 축이 뒤집히지 않았다 (좋음 ${a.scaled} vs 나쁨 ${bad[i]!.scaled})`,
    );
  }
});

test("투수 앵커를 코드 밖에서 확인할 수 있다", () => {
  assert.deepEqual(PITCHING_ANCHORS.era, [1.643, 2.869, 4.673]);
  assert.deepEqual(PITCHING_ANCHORS.k9, [5.358, 7.613, 10.255]);
});

/**
 * ⚠**두 도형은 같은 뜻이어야 한다.** 같은 화면에 나란히 놓이는데 한쪽만 크게 나오면,
 * 보는 사람은 그것을 「이 선수가 더 낫다」로 읽는다.
 *
 * 실측(2026-08-16): 두 점 앵커일 때 **중앙값 타자의 평균 반지름 48.1%(면적 23%) 대
 * 중앙값 투수 75.0%(면적 56%)** — 투수 도형이 2.4배 넓었다.
 * 원인은 분포의 쏠림이다. 야구 지표는 오른쪽 꼬리가 길어서, 「높을수록 좋다」인 축은
 * 중앙값이 안쪽으로, 그것을 뒤집은 축은 바깥쪽으로 간다.
 * **중앙을 앵커로 넣으면** 양쪽 모두 중앙값이 정확히 절반에 온다.
 */
test("⚠중앙값 선수는 타자든 투수든 절반 크기다 — 두 도형이 같은 뜻이 되는 조건", () => {
  // 2025·2026 정규시즌의 중앙값(타자 50타석 이상 458명 · 투수 20이닝 이상 407명)
  const median = bp({ avg: 0.238, obp: 0.3, iso: 0.098, bbRate: 0.067, kRate: 1 - 0.801 });
  for (const a of median) {
    assert.ok(
      Math.abs(a.scaled! - 0.5) < 0.005,
      `${a.label} 축의 중앙값이 절반이 아니다(${a.scaled})`,
    );
  }
  const medianP = pp({ k9: 7.613, bb9: 2.656, hr9: 0.643, whip: 1.19, era: 2.869 });
  for (const a of medianP) {
    assert.ok(
      Math.abs(a.scaled! - 0.5) < 0.005,
      `${a.label} 축의 중앙값이 절반이 아니다(${a.scaled})`,
    );
  }
});

test("⚠하위 10%는 양쪽 다 0, 상위 10%는 양쪽 다 1 — 눈금이 같다", () => {
  const low = bp({ avg: 0.182, obp: 0.238, iso: 0.038, bbRate: 0.03, kRate: 1 - 0.701 });
  const high = bp({ avg: 0.284, obp: 0.355, iso: 0.188, bbRate: 0.113, kRate: 1 - 0.872 });
  for (const a of low) assert.ok(a.scaled! < 0.005, `${a.label} 하위 앵커가 0이 아니다(${a.scaled})`);
  for (const a of high) assert.ok(a.scaled! > 0.995, `${a.label} 상위 앵커가 1이 아니다(${a.scaled})`);

  // 투수는 네 축이 뒤집혀 있으므로 「나쁜 값」이 0이다
  const lowP = pp({ k9: 5.358, bb9: 4.229, hr9: 1.249, whip: 1.504, era: 4.673 });
  const highP = pp({ k9: 10.255, bb9: 1.612, hr9: 0.227, whip: 0.945, era: 1.643 });
  for (const a of lowP) assert.ok(a.scaled! < 0.005, `${a.label} 하위 앵커가 0이 아니다(${a.scaled})`);
  for (const a of highP) assert.ok(a.scaled! > 0.995, `${a.label} 상위 앵커가 1이 아니다(${a.scaled})`);
});

/**
 * ⚠**양 끝은 자른다.** 눈금 없는 도형에서 바깥으로 무한히 뻗으면 모양이 값을 과장한다.
 * 상위 10%보다 훨씬 잘해도 도형은 더 커지지 않는다 — 정확한 값은 옆의 숫자에 있다.
 */
test("앵커 밖의 값은 잘린다 — 도형이 값을 과장하지 않는다", () => {
  const monster = bp({ avg: 0.45, obp: 0.55, iso: 0.5, bbRate: 0.3, kRate: 0.02 });
  for (const a of monster) assert.equal(a.scaled, 1, `${a.label}이 1을 넘었다`);
  const awful = bp({ avg: 0.05, obp: 0.08, iso: 0, bbRate: 0, kRate: 0.6 });
  for (const a of awful) assert.equal(a.scaled, 0, `${a.label}이 0 아래로 갔다`);
});

test("등판이 없으면 축이 전부 값 없음이고, 대체 마크로 간다(M11)", () => {
  const none = pp({ k9: null, bb9: null, hr9: null, whip: null, era: null });
  assert.ok(isEmptyProfile(none));
  const svg = toString(markLetter(player(), "投", 40));
  assert.match(svg, />投</);
  assert.match(svg, /aria-label="佐藤（成績なし）"/);
});

test("값이 하나라도 있으면 대체 마크로 가지 않는다", () => {
  const some = pp({ k9: 8, bb9: null, hr9: null, whip: null, era: null });
  assert.equal(isEmptyProfile(some), false);
});

// ── C안 打席の帯 ──────────────────────────────────────────────────────────

test("타석이 없으면 빈 띠가 아니라 아무것도 그리지 않는다", () => {
  assert.equal(toString(markStrip(player(), [])), "");
});

test("띠는 타석 수만큼 막대를 낸다", () => {
  const kinds: PaKind[] = ["hit", "so", "hr", "out", "walk"];
  const svg = toString(markStrip(player(), kinds));
  // 배경 rect 1개 + 타석 5개
  assert.equal([...svg.matchAll(/<rect/g)].length, 6);
  assertFiniteCoords(svg);
});

test("홈런이 안타보다 높고, 삼진이 가장 낮다", () => {
  const h = (k: PaKind): number =>
    Number(/height="([\d.]+)"[^>]*fill-opacity/.exec(toString(markStrip(player(), [k])))?.[1] ?? 0);
  assert.ok(h("hr") > h("hit"));
  assert.ok(h("hit") > h("walk"));
  assert.ok(h("out") > h("so"));
});

test("타석이 많아도 막대 폭이 0이 되지 않는다", () => {
  const many: PaKind[] = Array.from({ length: 90 }, () => "out");
  const svg = toString(markStrip(player(), many, 52));
  for (const m of svg.matchAll(/<rect x="[\d.]+" y="[\d.]+"\s*width="([\d.]+)"/g)) {
    assert.ok(Number(m[1]) >= 0.6, `막대 폭이 너무 좁다: ${m[1]}`);
  }
});

test("결과 분류는 parser의 Outcome을 그대로 접는다 — 문자열을 다시 해석하지 않는다(M1)", () => {
  assert.equal(paKind("homerun"), "hr");
  assert.equal(paKind("single"), "hit");
  assert.equal(paKind("double"), "hit");
  assert.equal(paKind("triple"), "hit");
  assert.equal(paKind("walk"), "walk");
  assert.equal(paKind("intentionalWalk"), "walk");
  assert.equal(paKind("hitByPitch"), "walk");
  assert.equal(paKind("strikeout"), "so");
  assert.equal(paKind("strikeoutReached"), "so");
  assert.equal(paKind("fieldedOut"), "out");
  assert.equal(paKind("sacFly"), "out");
  assert.equal(paKind("なにか知らないもの"), "out");
});

// ── 공통 ─────────────────────────────────────────────────────────────────

test("어느 안도 선수의 얼굴·사진 URL을 담지 않는다", () => {
  const axes = bp({ avg: 0.3, obp: 0.35, iso: 0.15, bbRate: 0.08, kRate: 0.2 });
  const all = [
    toString(markStamp(player())),
    toString(markProfile(player(), axes, "400打席")),
    toString(markStrip(player(), ["hit", "so"])),
  ].join("");
  assert.ok(!all.includes("players_photo"));
  assert.ok(!all.includes("<image"));
  assert.ok(!all.includes("href"));
});

// ── 확대판(고를 수 있는 紋) ──────────────────────────────────────────────

test("⚠축마다 자기 분모를 들고 다닌다 — 打率는 打数, 出塁는 打席이다", () => {
  const axes = battingProfile({
    avg: r(0.317, 382), obp: r(0.403, 442), iso: r(0.304, 382),
    bbRate: r(0.127, 442), kRate: r(0.265, 442),
  });
  assert.deepEqual(
    axes.map((a) => a.sample),
    ["382打数", "442打席", "382打数", "442打席", "442打席"],
  );
  // 분모가 비어 있으면 M2가 무너진다
  for (const a of axes) assert.ok(a.sample.length > 0, `${a.label}에 분모가 없다`);
});

test("투수 축의 분모는 이닝으로 나온다 — 아웃 카운트를 그대로 쓰지 않는다", () => {
  const axes = pitchingProfile({
    k9: r(9.9, 300), bb9: r(2.25, 300), hr9: r(0.72, 300),
    whip: r(1.1, 300), era: r(2.7, 300),
  });
  for (const a of axes) assert.equal(a.sample, "100回", `${a.label}: 300아웃은 100이닝이다`);
  assert.ok(!axes.some((a) => a.sample.includes("300")), "아웃 수가 그대로 나갔다");
});

test("⚠뒤집힌 축은 그 사실을 말한다 — 안 말하면 도형을 반대로 읽는다", () => {
  const axes = pp({ k9: 9.9, bb9: 2.25, hr9: 0.72, whip: 1.1, era: 2.7 });
  // 奪三振만 방향이 그대로다
  assert.equal(axes[0]!.note, "", "뒤집히지 않은 축에 반전 문구가 붙었다");
  for (const a of axes.slice(1)) {
    assert.match(a.note, /低いほど良い/, `${a.label}에 방향 설명이 없다`);
    assert.match(a.note, /外側ほど良く/, `${a.label}에 도형 방향 설명이 없다`);
  }
});

test("接触은 K%가 아니라는 것을 말한다 — .735를 삼진율로 읽으면 정반대다", () => {
  const axes = bp({ avg: 0.3, obp: 0.35, iso: 0.15, bbRate: 0.08, kRate: 0.265 });
  const contact = axes[4]!;
  assert.equal(contact.label, "接触");
  assert.equal(contact.text, ".735");
  assert.match(contact.note, /1 − K%/);
  assert.equal(contact.term, "kRate", "설명은 용어집에서 온다(M1)");
});

test("모든 축이 용어집에 닿는다 — 설명 없는 축을 만들지 않는다", async () => {
  const { termOf } = await import("../src/glossary.ts");
  const all = [
    ...bp({ avg: 0.3, obp: 0.35, iso: 0.15, bbRate: 0.08, kRate: 0.2 }),
    ...pp({ k9: 9, bb9: 2, hr9: 0.7, whip: 1.1, era: 2.7 }),
  ];
  const missing = all.filter((a) => termOf(a.term) === undefined).map((a) => a.label);
  assert.deepEqual(missing, [], `용어집에 없는 축: ${missing.join(", ")}`);
});

test("확대판의 꼭짓점은 조작 요소다 — 클릭만 붙이면 키보드에서 못 고른다", () => {
  const axes = bp({ avg: 0.3, obp: 0.35, iso: 0.15, bbRate: 0.08, kRate: 0.2 });
  const svg = toString(markFigure(player(), axes, "400打席"));
  const groups = [...svg.matchAll(/<g class="mf-ax"[^>]*>/g)].map((m) => m[0]);
  assert.equal(groups.length, 5);
  for (const g of groups) {
    assert.match(g, /role="button"/);
    assert.match(g, /tabindex="0"/);
    assert.match(g, /aria-label="/);
  }
  // 값과 분모가 읽어 주는 이름에 들어 있다
  assert.match(groups[0]!, /aria-label="打率 [^"]*打数"/);
});

test("⚠손잡이는 둘레에 고르게 놓인다 — 값 위치에 두면 낮은 축이 중앙에 겹친다", () => {
  // 한 축만 아주 낮은 선수
  const axes = bp({ avg: 0.15, obp: 0.25, iso: 0, bbRate: 0.08, kRate: 0.2 });
  const svg = toString(markFigure(player(), axes, "400打席"));
  const hits = [...svg.matchAll(/<circle class="mf-hit" cx="([\d.]+)" cy="([\d.]+)"/g)].map((m) => ({
    x: Number(m[1]),
    y: Number(m[2]),
  }));
  assert.equal(hits.length, 5);
  const c = 88;
  // 전부 같은 반지름 위에 있어야 한다(= 값과 무관하게 고르게 배치)
  const radii = hits.map((h) => Math.hypot(h.x - c, h.y - c));
  for (const rad of radii) assert.ok(Math.abs(rad - radii[0]!) < 0.5, `반지름이 흔들린다: ${radii.join(", ")}`);
  // 어느 두 손잡이도 서로 겹치지 않는다(판정 반지름 21)
  for (let i = 0; i < hits.length; i += 1) {
    for (let j = i + 1; j < hits.length; j += 1) {
      const d = Math.hypot(hits[i]!.x - hits[j]!.x, hits[i]!.y - hits[j]!.y);
      assert.ok(d > 24, `손잡이 ${i}와 ${j}가 ${d.toFixed(1)}만큼 붙어 있다`);
    }
  }
});

test("축이 3개 미만이면 확대판도 그리지 않는다", () => {
  assert.equal(toString(markFigure(player(), [], "0打席")), "");
});

test("세 안 모두 구단 색을 쓴다 — 배면과 같은 정체성", () => {
  const axes = bp({ avg: 0.3, obp: 0.35, iso: 0.15, bbRate: 0.08, kRate: 0.2 });
  for (const svg of [
    toString(markStamp(player())),
    toString(markProfile(player(), axes, "400打席")),
    toString(markStrip(player(), ["hit"])),
  ]) {
    assert.ok(svg.includes(colorOf("t").base), "구단 바탕색이 없다");
    assert.ok(svg.includes(colorOf("t").ink), "구단 글자색이 없다");
  }
});

/**
 * ⚠**「없음」과 「얇음」과 「낮음」은 셋 다 다르다**(M11).
 * 눈금은 타자 50타석·투수 20이닝 이상으로 맞췄는데 도형은 1타석부터 그려진다.
 * 실측(2026-08-16): 그 바깥에서 평균 반지름 중앙값이 **타자 9.9% 대 투수 31.8%** 로 갈린다 —
 * **눈금을 고치기 전의 격차보다 크다.** 즉 얇은 표본에서는 두 도형이 다시 딴말을 한다.
 *
 * 값은 진짜다. 믿을 수 없는 것은 **비교**다 — 그래서 지우지 않고 **속을 비운다.**
 * 같은 화면의 등급이 같은 임계값에서 색을 보류하는 것과 같은 일이다.
 */
test("⚠표본이 눈금 모집단에 못 미치면 얇음으로 표시한다(M11)", () => {
  const thick = battingProfile({
    avg: r(0.28, 300), obp: r(0.35, 350), iso: r(0.15, 300), bbRate: r(0.09, 350), kRate: r(0.18, 350),
  });
  assert.equal(isThinProfile(thick), false, "충분한 표본을 얇다고 했다");

  // 49타석 — 등급이 색을 보류하는 그 경계 바로 아래다
  const thin = battingProfile({
    avg: r(0.28, 44), obp: r(0.35, 49), iso: r(0.15, 44), bbRate: r(0.09, 49), kRate: r(0.18, 49),
  });
  assert.equal(isThinProfile(thin), true, "얇은 표본을 얇다고 하지 않았다");
});

test("투수도 같은 경계를 쓴다 — 임계값이 두 벌이면 언젠가 갈린다(M1)", () => {
  const thick = pitchingProfile({
    k9: r(8, 300), bb9: r(2.5, 300), hr9: r(0.6, 300), whip: r(1.1, 300), era: r(2.8, 300),
  });
  assert.equal(isThinProfile(thick), false);
  // 59아웃 — 19.2이닝. 20이닝 경계 바로 아래
  const thin = pitchingProfile({
    k9: r(8, 59), bb9: r(2.5, 59), hr9: r(0.6, 59), whip: r(1.1, 59), era: r(2.8, 59),
  });
  assert.equal(isThinProfile(thin), true);
});

test("⚠얇은 표본의 도형은 속이 비고, 화면 낭독도 그렇게 말한다", () => {
  const thin = battingProfile({
    avg: r(0.28, 44), obp: r(0.35, 49), iso: r(0.15, 44), bbRate: r(0.09, 49), kRate: r(0.18, 49),
  });
  const out = toString(markProfile(player(), thin, "49打席"));
  assert.match(out, /fill-opacity="0"/, "얇은데 속을 채웠다");
  assert.match(out, /stroke-dasharray="2 2"/, "얇음을 구별할 표시가 없다");
  assert.match(out, /標本が少ないため参考値/, "낭독이 얇음을 말하지 않는다");

  const thick = battingProfile({
    avg: r(0.28, 300), obp: r(0.35, 350), iso: r(0.15, 300), bbRate: r(0.09, 350), kRate: r(0.18, 350),
  });
  const full = toString(markProfile(player(), thick, "350打席"));
  assert.match(full, /fill-opacity="\.85"/, "충분한 표본인데 속이 비었다");
  assert.ok(!full.includes("標本が少ないため"), "충분한 표본을 얇다고 말했다");
});

/**
 * ⚠**앵커가 오름차순이 아니면 멈춰야 한다.** 뒤집힌 축을 「좋은 순」으로 적는 실수가
 * 이 파일에서 가장 저지르기 쉬운데, 그렇게 적어도 `scale()` 은 던지지 않고 **조용히 0.5** 를 낸다 —
 * 制球 축이 대부분의 투수에서 0.5로 굳는데 도형은 그럴듯하게 그려진다(M7).
 */
test("⚠앵커가 오름차순인지 코드가 스스로 검사한다", () => {
  for (const [name, group] of [["타자", PROFILE_ANCHORS], ["투수", PITCHING_ANCHORS]] as const) {
    for (const [k, v] of Object.entries(group)) {
      assert.ok(v[0] < v[1] && v[1] < v[2], `${name} ${k} 앵커가 오름차순이 아니다: ${v.join(" ")}`);
    }
  }
  // 그리고 그 검사가 **코드에** 있다 — 주석에만 있으면 아무도 안 지킨다
  const src = readFileSync(new URL("../src/marks.ts", import.meta.url), "utf8");
  assert.match(src, /assertAscending\("PROFILE_ANCHORS"/, "타자 앵커 검사가 없다");
  assert.match(src, /assertAscending\("PITCHING_ANCHORS"/, "투수 앵커 검사가 없다");
});
