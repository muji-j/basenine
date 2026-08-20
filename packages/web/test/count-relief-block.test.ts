/**
 * カウント別 · 火消し 블록의 화면.
 *
 * ⚠**이 두 블록의 위험은 값이 아니라 「무엇을 재지 않는가」다.**
 * ① 은 투구 단위 데이터가 아닌데 그렇게 읽히기 쉽고,
 * ② 는 MLB 의 IS%(引き継ぎ走者の生還率)로 읽히기 쉽다 — 둘 다 **이름만으로는 구별되지 않는다.**
 * 그래서 화면에 그 문장이 실제로 있는지를 시험이 고정한다(M12 의 정신).
 *
 * ⚠**정의의 정본은 용어집이다**(M1) — 시험이 문장을 다시 쓰지 않고 거기 있는 것을 본다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderPlayerPage } from "../src/player-page.ts";
import { termOf } from "../src/glossary.ts";
import { context, pitcherMark, pitchingBlock, playerPage, reliefBlock, r } from "./fixtures.ts";

/** 그 블록의 구획만 잘라낸다 — 다른 블록의 글자가 섞이면 시험이 헐거워진다 */
function blockOf(html: string, id: string): string {
  const m = new RegExp(`<section class="block"[^>]*id="b-${id}"[\\s\\S]*?\\n</section>`).exec(html);
  assert.notEqual(m, null, `#b-${id} 구획이 없다`);
  return m![0];
}

const PITCHER = {
  role: "pitcher" as const,
  pitching: pitchingBlock(),
  mark: pitcherMark(),
  relief: reliefBlock(),
};

// ── ① カウント別 ───────────────────────────────────────────────────────

test("カウント別 블록이 나오고, 비율마다 분모가 붙는다(M2)", () => {
  const out = renderPlayerPage(playerPage(), context());
  const b = blockOf(out, "count");
  assert.match(b, /追い込まれ率/);
  for (const [value, den] of [
    [".520", "442打席"],
    [".117", "442打席"],
    [".121", "442打席"],
    [".151", "442打席"],
  ]) {
    assert.ok(
      b.includes(`${value}<span class="den">${den}</span>`),
      `${value} 옆에 ${den}가 붙어 있지 않다`,
    );
  }
});

test("2ストライク前後를 나란히 낸다 — 하나만 내면 「.206 は低い」로 읽힌다", () => {
  const b = blockOf(renderPlayerPage(playerPage(), context()), "count");
  assert.match(b, /2ストライク前/);
  assert.match(b, /2ストライク後/);
  // 표의 打率·OPS 에도 분모가 붙는다
  assert.ok(b.includes('.358<span class="den">190打数</span>'), "2S 전 打率에 분모가 없다");
  assert.ok(b.includes('.206<span class="den">214打数</span>'), "2S 후 打率에 분모가 없다");
  assert.ok(b.includes('.980<span class="den">212打席</span>'), "2S 전 OPS에 분모가 없다");
});

test("⚠「投球単位のデータではない」를 화면이 말한다 — 이름만으로는 구별되지 않는다", () => {
  const b = blockOf(renderPlayerPage(playerPage(), context()), "count");
  assert.match(b, /投球単位のデータではありません/);
  assert.match(b, /空振り/, "헛스윙을 못 센다는 사실이 화면에 없다");
  assert.match(b, /球数/, "투구 수를 못 센다는 사실이 화면에 없다");
});

test("⚠申告敬遠 제외를 화면이 말한다 — 안 적으면 「초구에 끝냈다」가 거짓이 된다", () => {
  const b = blockOf(renderPlayerPage(playerPage(), context()), "count");
  assert.match(b, /申告敬遠/);
});

test("⚠독창인 척하지 않는다 — 이미 다른 사이트가 내는 표준 지표다", () => {
  const b = blockOf(renderPlayerPage(playerPage(), context()), "count");
  assert.match(b, /当サイト独自のものではありません/);
});

test("⚠격리한 타석이 있으면 그 수를 낸다(M11)", () => {
  const b = blockOf(renderPlayerPage(playerPage(), context()), "count");
  assert.match(b, /カウント不明/, "격리한 타석이 1건인데 화면이 말하지 않는다");
  assert.match(b, /読めなかった打席が1件/);
});

test("격리가 0이면 그 줄을 만들지 않는다 — 늘 0인 줄은 아무도 안 읽는다", () => {
  const page = playerPage();
  const b = blockOf(
    renderPlayerPage({ ...page, count: { ...page.count!, quarantined: 0 } }, context()),
    "count",
  );
  assert.ok(!b.includes("カウント不明"), "격리 0인데 그 줄이 나왔다");
  assert.ok(!b.includes("読めなかった打席"), "격리 0인데 각주가 나왔다");
});

test("⚠투수는 「追い込み率」·「被打率」다 — 같은 라벨을 쓰면 투수 화면이 타자 설명을 낸다", () => {
  const b = blockOf(renderPlayerPage(playerPage(PITCHER), context()), "count");
  assert.match(b, /追い込み率/);
  assert.ok(!b.includes("追い込まれ率"), "투수 화면이 타자 쪽 이름을 냈다");
  assert.match(b, /data-term="allowedAvg"[^>]*>被打率</, "투수 표의 머리가 打率 그대로다");
  assert.match(b, /data-term="allowedOps"[^>]*>被OPS</, "투수 표의 머리가 OPS 그대로다");
  assert.match(b, /<th>被安打<\/th>/, "투수 표에 「安打」라고 썼다");
  assert.match(b, /<th>奪三振<\/th>/, "투수 표에 「三振」이라고 썼다");
});

test("타석 로그가 없으면 「0」이 아니라 「기록이 없다」를 낸다(M11·M12)", () => {
  const b = blockOf(renderPlayerPage(playerPage({ count: null }), context()), "count");
  assert.match(b, /打席の記録がありません/);
  assert.ok(!b.includes("<dd"), "값이 없는데 값 자리를 그렸다");
});

// ── ② 火消し ──────────────────────────────────────────────────────────

test("火消し 블록이 투수에게 나오고, 통산 범위를 화면이 말한다", () => {
  const b = blockOf(renderPlayerPage(playerPage(PITCHER), context()), "relief");
  assert.match(b, /通算 2018〜2026年/, "「통산」이라고만 쓰면 어느 시즌까지인지 알 수 없다");
  assert.match(b, /引き継ぎ登板/);
  assert.match(b, /背負った走者/);
});

test("⚠火消し率에 분모가 붙는다(M2) — 분모는 引き継ぎ登板이다", () => {
  const b = blockOf(renderPlayerPage(playerPage(PITCHER), context()), "relief");
  assert.ok(
    b.includes('.636<span class="den">44引き継ぎ登板</span>'),
    "火消し率 옆에 분모가 없다",
  );
  // 정의서(용어집)가 정본이다 — 여기서 단위를 다시 적지 않는다
  assert.equal(termOf("doused")!.den, "引き継ぎ登板");
});

test("⚠MLB 의 IS% 가 아니라는 것을 화면이 말한다 — 이름만으로는 구별되지 않는다", () => {
  const b = blockOf(renderPlayerPage(playerPage(PITCHER), context()), "relief");
  assert.match(b, /IS%/, "IS% 와 다르다는 문장이 없다");
  assert.match(b, /走者が誰かは分からない|走者が誰かは分かりません|走者が誰かは分からないため/);
});

test("⚠자격선 미만이면 비율 자리를 「—」로 채우지 않는다(M11·M12)", () => {
  const page = playerPage({
    ...PITCHER,
    relief: reliefBlock({
      career: { midInning: 6, inherited: 4, inheritedRunners: 7, doused: 3 },
      dousedRate: null,
    }),
  });
  const b = blockOf(renderPlayerPage(page, context()), "relief");
  assert.match(b, /10登板未満/, "자격 미달인데 그 사실을 말하지 않는다");
  assert.ok(!b.includes('class="den">4引き継ぎ登板'), "자격 미달인데 비율을 냈다");
});

test("⚠시즌 쪽은 개수만 낸다 — 한 시즌 표본으로는 순위가 성립하지 않는다(M3)", () => {
  const b = blockOf(renderPlayerPage(playerPage(PITCHER), context()), "relief");
  assert.match(b, /2026年の引き継ぎ登板/);
  assert.match(b, /シーズン順位はつけていません/);
});

test("⚠이닝 사이의 교대는 안 센다는 것을 화면이 말한다 — 교대의 85%가 그쪽이다", () => {
  const b = blockOf(renderPlayerPage(playerPage(PITCHER), context()), "relief");
  assert.match(b, /イニングの間の交代は入りません/);
});

test("⚠RE 를 못 구한 등판이 있으면 그 수를 낸다(M11)", () => {
  const page = playerPage({ ...PITCHER, relief: reliefBlock({ reMissing: 3, enteringRe: r(0.9, 41) }) });
  const b = blockOf(renderPlayerPage(page, context()), "relief");
  assert.match(b, /得点期待値を出せなかった登板が3件/);
  // 평균의 분모가 引き継ぎ登板 44 가 아니라 41 이다
  assert.ok(b.includes('<span class="den">41引き継ぎ登板</span>'), "RE 평균의 분모가 줄어들지 않았다");
});

test("RE 결측이 0이면 그 각주를 만들지 않는다", () => {
  const b = blockOf(renderPlayerPage(playerPage(PITCHER), context()), "relief");
  assert.ok(!b.includes("得点期待値を出せなかった登板"), "결측 0인데 각주가 나왔다");
});

test("이닝 도중 등판이 없으면 「0회」가 아니라 「없다」를 낸다(M11)", () => {
  const b = blockOf(renderPlayerPage(playerPage({ ...PITCHER, relief: null }), context()), "relief");
  assert.match(b, /イニング途中からの登板がありません/);
});

test("⚠火消し는 타자 페이지에 없다 — 타석에 서는 쪽의 이야기가 아니다", () => {
  const out = renderPlayerPage(playerPage(), context());
  assert.ok(!out.includes('id="b-relief"'), "투수 전용 블록이 타자 페이지에 샜다");
});

// ── 덤: 「없는 것」에 이유를 적는다 ─────────────────────────────────────

/**
 * ⚠**구원 투수의 개인 勝率이 사이트 어디에도 없는데 「왜 없는지」가 화면에 한 줄도 없었다**
 * (2026-08-20). 판단은 `query.ts` 의 `metricsFor` 에 적혀 있었지만 그건 코드 주석이라
 * 유저에게는 **「없는 것」과 「빠뜨린 것」이 구별되지 않는다**(M11·M12).
 */
test("⚠구원 투수 페이지가 「勝率 순위를 안 낸다」는 사실과 이유를 말한다", () => {
  const b = blockOf(
    renderPlayerPage(
      playerPage({ ...PITCHER, pitching: { ...pitchingBlock(), role: "reliever" } }),
      context(),
    ),
    "standard",
  );
  assert.match(b, /救援投手には勝率の順位をつけていません/);
  assert.match(b, /抜けているのではありません/, "「빠뜨린 것이 아니다」가 없다");
  assert.match(b, /規定投球回/, "왜 안 내는지(자격 기준)가 없다");
});

test("선발 투수 페이지에는 그 문장이 없다 — 선발에는 勝率 순위가 실제로 있다", () => {
  const b = blockOf(renderPlayerPage(playerPage(PITCHER), context()), "standard");
  assert.ok(!b.includes("救援投手には勝率の順位をつけていません"), "선발에게 구원용 각주가 샜다");
});
