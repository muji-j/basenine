/**
 * **타자 연속 기록의 「今季 ↔ 通算」 전환** — 정의서 §4-3 이 「시즌 넘김에서 깨지는 전제」로 적어 둔
 * ①~⑦ 이 화면에서 실제로 안 깨지는가.
 *
 * ## 이 전환이 깨뜨리는 것
 *
 * | # | 무엇 | 안 고치면 |
 * |---|---|---|
 * | ② | 머리의 분모 `${season}年 · 打席のあった${games}試合` | 通算 탭에서 **거짓**이 된다(M2) |
 * | ③ | 각주의 `⚠${season}年のなかだけで数えています` | 通算 탭에서 **정면으로 거짓**이다 |
 * | ⑤ | 분모 `games` | 시즌 값을 그대로 쓰면 **분모가 마루보다 작아지는** 화면이 나온다 |
 * | ⑥ | `bestFrom`/`bestTo` 만 있고 넘긴 시즌이 없다 | 荻野의 36경기(2019-09-13〜2020-07-19)에서 **10개월 공백이 안 보인다** |
 *
 * ⚠**토글은 「시즌 넘김 기록이 있는 선수」에게만 붙는다**(사용자 결정 ⑶) —
 * 그래서 **「토글이 없다」가 「기록이 없다」로 읽히지 않게** 각주가 그 자리를 메운다(정의서 §1-6).
 * ⚠**`連続試合無安打` 에는 통산이 없다**(사용자 결정 ⑺ · 정의서 §4-4) — **빠뜨린 게 아니라고
 * 화면이 말해야 한다.**
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderPlayerPage } from "../src/player-page.ts";
import { freshness } from "../src/layout.ts";
import { termOf } from "../src/glossary.ts";
import { context, playerPage } from "./fixtures.ts";
import type { CareerStreakScope, StreakBlockData } from "../src/player-page.ts";

function heldContext(heldTo: number) {
  return context({ freshness: freshness("2026-08-14", "2026-08-15", "2026-08-14", { from: 2018, to: heldTo }) });
}

function streakBlockOf(out: string): string {
  const from = out.indexOf('id="b-streak"');
  assert.notEqual(from, -1, "連続記録 구획이 없다");
  const to = out.indexOf("</section>", from);
  assert.notEqual(to, -1, "連続記録 구획이 닫히지 않았다");
  return out.slice(from, to);
}

/** 시즌을 넘는 마루 — **荻野의 36경기**(2019-09-13 〜 2020-07-19 · 10개월 공백) */
const CROSSING = {
  length: 36,
  from: "2019-09-13",
  to: "2020-07-19",
  seasons: [2019, 2020],
  atRangeStart: false,
} as const;

function careerScope(over: Partial<CareerStreakScope> = {}): CareerStreakScope {
  return {
    hitting: { current: null, best: { ...CROSSING } },
    onBase: { current: null, best: { ...CROSSING, length: 45 } },
    games: 1002,
    fromSeason: 2018,
    toSeason: 2026,
    ...over,
  };
}

function render(career: CareerStreakScope | null, over: Partial<StreakBlockData> = {}): string {
  const base = playerPage({ asOf: "2026-08-14" });
  return streakBlockOf(
    renderPlayerPage(
      playerPage({ asOf: "2026-08-14", streaks: { ...base.streaks!, career, ...over } }),
      heldContext(2026),
    ),
  );
}

test("⚠시즌 넘김 기록이 없으면 탭이 없고, 왜 없는지 말한다", () => {
  const blk = render(null);
  assert.ok(!blk.includes('data-tabgroup="streak"'), "시즌 넘김 기록이 없는데 탭을 만들었다");
  assert.match(blk, /シーズンをまたぐ連続記録はないため、範囲の切り替えは出していません/);
  // 패널이 하나뿐이라 머리의 분모가 거짓이 될 수 없다
  assert.match(blk, /2026年 · 打席のあった104試合/);
});

/**
 * ⚠**②·⑤ — 머리에 분모를 적으면 通算 탭에서 거짓이 된다.**
 * 머리는 하나인데 패널은 둘이라, 탭을 바꿔도 머리가 안 따라간다 —
 * **화면이 두 개의 분모를 동시에 주장하는** 상태가 되고 그건 M2 가 막으려던 바로 그것이다.
 */
test("⚠탭이 생기면 머리에서 분모를 빼고, 각 패널이 자기 분모를 말한다", () => {
  const blk = render(careerScope());
  assert.match(blk, /data-tabgroup="streak"/, "탭이 없다");
  assert.ok(!blk.includes('class="qt">2026年 · 打席のあった104試合'), "탭이 있는데 머리에 분모를 적었다");
  assert.match(blk, /2026年のなかだけで数えています/, "今季 패널이 범위를 말하지 않았다");
  assert.match(blk, /打席のあった試合は1002試合です/, "通算 패널의 분모가 시즌 것으로 남았다");
});

/**
 * ⚠**③ — 「${season}年のなかだけで数えています」가 通算 패널에 남으면 정면으로 거짓이다.**
 * ⚠**그런데 뒷문장은 살려야 한다** — 우리 통산과 NPB `通算成績` 이 다르다는 것을 말하는 유일한 자리다.
 */
test("⚠通算 패널은 「그 해 안에서만 셌다」고 말하지 않는다 — 다만 NPB 통산과 다르다는 말은 남긴다", () => {
  const blk = render(careerScope());
  const career = blk.slice(blk.indexOf('data-panelkey="career"'));
  assert.ok(!career.includes("2026年のなかだけで数えています"), "통산 패널이 시즌 문장을 그대로 썼다");
  assert.match(career, /当サイトが保有する<b>2018〜2026年<\/b>/, "우리 범위를 말하지 않았다");
  assert.match(career, /NPBが公表する通算成績とは範囲が違います/, "NPB 통산과 다르다는 것을 말하지 않았다");
  assert.match(career, /「通算」は下の<b>通算成績<\/b>（出典：NPB）/, "출처가 다른 표로 가는 안내가 사라졌다");
});

/**
 * ⚠**⑥ — 날짜만 보이면 10개월 공백이 안 보인다.** 시즌을 넘으면 **연도를 붙이고**,
 * 등판·출장이 없던 시즌이 있으면 **그 시즌을 말한다**(정의서 §1-6).
 */
test("⚠시즌 넘김 마루는 연도를 붙인다 — 안 붙이면 거꾸로 읽힌다", () => {
  const blk = render(careerScope());
  assert.match(blk, /2019年9月13日〜2020年7月19日/, "연도가 없어 「9月13日〜7月19日」로 거꾸로 읽힌다");
});

test("⚠건너뛴 시즌을 말한다 — 島本형 공백은 날짜만으로는 안 보인다", () => {
  const gap = { length: 27, from: "2019-08-01", to: "2022-08-24", seasons: [2019, 2022], atRangeStart: false };
  const blk = render(careerScope({ hitting: { current: null, best: gap } }));
  assert.match(blk, /2020・2021年は出場なし/, "건너뛴 시즌이 안 보인다");
});

/**
 * ⚠**「2017」을 박지 않는다**(사용자 결정 ⑵) — `fromSeason − 1` 에서 유도한다.
 * 하한이 바뀌면 문구가 따라가야 하고, 박았으면 여기서 떨어진다.
 */
test("⚠범위의 시작에 닿은 마루는 「N試合以上」이고, 사유를 하한에서 유도한다", () => {
  const atStart = { ...CROSSING, atRangeStart: true };
  const blk = render(careerScope({ hitting: { current: null, best: atStart } }));
  assert.match(blk, /36試合以上/, "범위 시작에 닿았는데 「以上」이 없다");
  assert.match(blk, /2017年以前は未参照/);

  const older = render(careerScope({ hitting: { current: null, best: atStart }, fromSeason: 2005 }));
  assert.match(older, /2004年以前は未参照/, "「2017」이 어딘가에 박혀 있다");
});

/**
 * ⚠**`current === null` 은 「기록이 없다」가 아니라 「마지막 경기에서 끊겼다」다**(M11) —
 * 시즌 축의 `current: 0` 과 **같은 것을 같게 그린다.**
 */
test("⚠通算의 「지금」이 끊겨 있으면 0試合이다 — 빈칸이 아니다", () => {
  const blk = render(careerScope());
  const career = blk.slice(blk.indexOf('data-panelkey="career"'));
  assert.match(career, />0試合</, "끊긴 기록을 0으로 안 그렸다");
});

/**
 * ⚠**빠뜨린 게 아니라 「안 낸다」고 말해야 한다**(사용자 결정 ⑺ · 정의서 §4-4).
 * 안 말하면 「그 선수에게 무안타 기록이 없다」로 읽힌다.
 */
test("⚠通算에 連続試合無安打가 없고, 왜 없는지 말한다", () => {
  const blk = render(careerScope());
  const career = blk.slice(blk.indexOf('data-panelkey="career"'));
  assert.ok(!career.includes(`data-term="hitlessStreak"`), "통산 축에 連続試合無安打를 냈다");
  assert.match(career, new RegExp(`${termOf("hitlessStreak")!.label}はこの範囲では出していません`));
  assert.match(career, /当サイトが作った記録になってしまう/, "왜 안 내는지 말하지 않았다");
  // 今季 패널에는 그대로 있다 — 지표를 지운 것이 아니다
  const season = blk.slice(blk.indexOf('data-panelkey="season"'), blk.indexOf('data-panelkey="career"'));
  assert.match(season, /data-term="hitlessStreak"/, "시즌 축에서 지표가 사라졌다");
});

/** ⚠**라벨은 용어집에서 나온다**(M1) — 통산 패널에서도 툴팁이 붙어야 한다 */
test("⚠通算 패널의 라벨도 용어집에서 나오고 툴팁이 붙는다", () => {
  const career = render(careerScope());
  for (const key of ["hitStreak", "onBaseStreak"]) {
    assert.ok(career.includes(`data-term="${key}"`), `${key} 의 툴팁이 없다`);
  }
});
