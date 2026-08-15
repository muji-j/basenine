import { test } from "node:test";
import assert from "node:assert/strict";
import { toString } from "../src/html.ts";
import {
  PITCHING_ANCHORS,
  PROFILE_ANCHORS,
  battingProfile,
  isEmptyProfile,
  markLetter,
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
  const axes = battingProfile({ avg: 0.317, obp: 0.403, iso: 0.304, bbRate: 0.127, kRate: 0.265 });
  assert.equal(axes.length, 5);
  assert.deepEqual(
    axes.map((a) => a.label),
    ["打率", "出塁", "長打", "選球", "接触"],
  );
  assert.equal(axes[0]!.text, ".317");
});

test("⚠삼진은 적을수록 좋다 — 뒤집어 넣지 않으면 모양이 정반대가 된다", () => {
  const few = battingProfile({ avg: 0.25, obp: 0.3, iso: 0.1, bbRate: 0.08, kRate: 0.1 });
  const many = battingProfile({ avg: 0.25, obp: 0.3, iso: 0.1, bbRate: 0.08, kRate: 0.35 });
  assert.ok(few[4]!.scaled! > many[4]!.scaled!, "삼진이 적은 쪽의 接触이 더 커야 한다");
});

test("정규화는 0~1로 잘린다 — 앵커 밖의 값이 도형을 뚫고 나가지 않는다", () => {
  const extreme = battingProfile({ avg: 0.9, obp: 0.9, iso: 0.9, bbRate: 0.9, kRate: 0 });
  for (const a of extreme) assert.equal(a.scaled, 1);
  const zero = battingProfile({ avg: 0, obp: 0, iso: 0, bbRate: 0, kRate: 1 });
  for (const a of zero) assert.equal(a.scaled, 0);
});

test("값이 없으면 null이고 0이 아니다(M11)", () => {
  const none = battingProfile({ avg: null, obp: null, iso: null, bbRate: null, kRate: null });
  for (const a of none) {
    assert.equal(a.scaled, null);
    assert.equal(a.text, "—");
  }
});

test("성적이 하나도 없어도 도형이 깨지지 않는다 — 투수 페이지에서 실제로 일어난다", () => {
  const none = battingProfile({ avg: null, obp: null, iso: null, bbRate: null, kRate: null });
  const svg = toString(markProfile(player(), none, "0打席"));
  assertFiniteCoords(svg);
  assert.match(svg, /<polygon/);
});

test("분모가 접근성 라벨에 들어간다(M2)", () => {
  const axes = battingProfile({ avg: 0.317, obp: 0.403, iso: 0.304, bbRate: 0.127, kRate: 0.265 });
  assert.match(toString(markProfile(player(), axes, "442打席")), /442打席/);
});

test("축이 3개 미만이면 그리지 않는다 — 다각형이 되지 않는다", () => {
  assert.equal(toString(markProfile(player(), [{ label: "a", scaled: 1, text: "1" }], "10打席")), "");
});

test("앵커를 코드 밖에서 확인할 수 있다 — 표시 배율이지 지표가 아니다", () => {
  assert.deepEqual(PROFILE_ANCHORS.iso, [0, 0.3]);
  assert.deepEqual(PROFILE_ANCHORS.contact, [0.6, 1]);
});

// ── 투수 축 ───────────────────────────────────────────────────────────────

test("투수 프로필도 5축이고 값 표기는 소수 2자리다", () => {
  const axes = pitchingProfile({ k9: 9.9, bb9: 2.25, hr9: 0.72, whip: 1.1, era: 2.7 });
  assert.deepEqual(
    axes.map((a) => a.label),
    ["奪三振", "制球", "被弾", "抑制", "失点"],
  );
  assert.equal(axes[0]!.text, "9.90");
});

test("⚠좋은 투수가 큰 도형이 된다 — 네 축이 뒤집혀 있지 않으면 뜻이 정반대가 된다", () => {
  const good = pitchingProfile({ k9: 10, bb9: 1.6, hr9: 0.4, whip: 1.02, era: 2.1 });
  const bad = pitchingProfile({ k9: 5, bb9: 4.5, hr9: 1.6, whip: 1.6, era: 5.2 });
  for (const [i, a] of good.entries()) {
    assert.ok(
      a.scaled! > bad[i]!.scaled!,
      `${a.label} 축이 뒤집히지 않았다 (좋음 ${a.scaled} vs 나쁨 ${bad[i]!.scaled})`,
    );
  }
});

test("투수 앵커를 코드 밖에서 확인할 수 있다", () => {
  assert.deepEqual(PITCHING_ANCHORS.era, [2, 5.5]);
  assert.deepEqual(PITCHING_ANCHORS.k9, [4, 12]);
});

test("등판이 없으면 축이 전부 값 없음이고, 대체 마크로 간다(M11)", () => {
  const none = pitchingProfile({ k9: null, bb9: null, hr9: null, whip: null, era: null });
  assert.ok(isEmptyProfile(none));
  const svg = toString(markLetter(player(), "投", 40));
  assert.match(svg, />投</);
  assert.match(svg, /aria-label="佐藤（成績なし）"/);
});

test("값이 하나라도 있으면 대체 마크로 가지 않는다", () => {
  const some = pitchingProfile({ k9: 8, bb9: null, hr9: null, whip: null, era: null });
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
  const axes = battingProfile({ avg: 0.3, obp: 0.35, iso: 0.15, bbRate: 0.08, kRate: 0.2 });
  const all = [
    toString(markStamp(player())),
    toString(markProfile(player(), axes, "400打席")),
    toString(markStrip(player(), ["hit", "so"])),
  ].join("");
  assert.ok(!all.includes("players_photo"));
  assert.ok(!all.includes("<image"));
  assert.ok(!all.includes("href"));
});

test("세 안 모두 구단 색을 쓴다 — 배면과 같은 정체성", () => {
  const axes = battingProfile({ avg: 0.3, obp: 0.35, iso: 0.15, bbRate: 0.08, kRate: 0.2 });
  for (const svg of [
    toString(markStamp(player())),
    toString(markProfile(player(), axes, "400打席")),
    toString(markStrip(player(), ["hit"])),
  ]) {
    assert.ok(svg.includes(colorOf("t").base), "구단 바탕색이 없다");
    assert.ok(svg.includes(colorOf("t").ink), "구단 글자색이 없다");
  }
});
