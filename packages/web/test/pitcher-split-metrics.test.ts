/**
 * **투수 스플릿에 투수다운 지표** — 축마다 낼 수 있는 것이 다르다.
 *
 * > 사용자 지적: 「투수 성적에 … 타 구단과의 성적을 보면 **피안타율 같은거만** 나와서
 * > **타자랑 수치가 역전된거만** 존재한다 · **구단별 방어율**이 있는게 더 투수답지 않나?」
 *
 * ## ⚠축이 「경기 단위」인지가 전부다
 *
 * 자책점은 **타석 로그에 없다**(`pa_event` 컬럼 실측: `runs_scored` 는 있어도 `er` 이 없다).
 * **공식 기록자의 판정**이라 타석 결과에서 유도할 수 없다. 이닝도 등판 전체에 붙은 수다.
 *
 * → **경기 단위 축**(구단별·홈원정·구장별·월별)은 `pitching_line` 을 그대로 합쳐
 * **진짜 방어율**을 낸다. 실측(2025): 선수-상대 조합 **2,181 중 2,172(99.6%)** 가 이닝을 갖는다.
 * → **타석 단위 축**(대좌우·주자상황·타순)은 **한 등판이 여러 칸으로 갈려** 낼 수 없다.
 *
 * ⚠**여기가 이 시험의 급소다**: 「없다」를 **그냥 비우면 결함으로 읽힌다.**
 * 화면이 **왜 없는지**를 말해야 한다(M11·M12 의 정신).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderPlayerPage } from "../src/player-page.ts";
import type { PitchingSplitCell, SplitAxisData } from "../src/player-page.ts";
import { GAME_LEVEL_OF } from "../src/query.ts";
import { context, playerPage, pitchingBlock, pitcherMark, reliefBlock } from "./fixtures.ts";

const ROWS: SplitAxisData["rows"] = [
  {
    key: "h",
    label: "ソフトバンク",
    line: { pa: 200, ab: 180, h: 44, double: 8, triple: 0, hr: 6, bb: 8, ibb: 0, hbp: 1, sf: 1, sh: 2, so: 52, roe: 0 },
    rbi: 0,
    avg: { value: 44 / 180, denominator: 180 },
    obp: { value: 53 / 200, denominator: 200 },
    slg: { value: 70 / 180, denominator: 180 },
    ops: { value: 0.6, denominator: 200 },
  },
];

const CELLS = new Map<string, PitchingSplitCell>([
  // 54.0이닝 · 자책 16 → 방어율 2.67
  ["h", { games: 7, outs: 162, er: 16, h: 44, hr: 6, bb: 8, so: 52 }],
]);

function render(axis: Partial<SplitAxisData>): string {
  const full: SplitAxisData = {
    id: "opponent",
    label: "対戦球団別（今季）",
    allowed: true,
    rows: ROWS,
    unclassified: 0,
    thinBelow: 10,
    span: null,
    pitching: null,
    ...axis,
  };
  const out = renderPlayerPage(
    playerPage({
      role: "pitcher",
      pitching: pitchingBlock(),
      mark: pitcherMark(),
      relief: reliefBlock(),
      splits: [full],
    } as never),
    context(),
  );
  return /<section class="block"[^>]*id="b-splits"[\s\S]*?\n<\/section>/.exec(out)?.[0] ?? "";
}

test("⚠경기 단위 축에는 진짜 투수 지표가 나온다 — 등판·이닝·방어율·WHIP", () => {
  const s = render({ pitching: CELLS });
  for (const col of ["登板", "投球回", "防御率", "WHIP"]) {
    assert.ok(s.includes(col), `${col} 열이 없다`);
  }
  assert.match(s, /2\.67/, "방어율이 안 나온다(자책 16 · 54이닝)");
  assert.match(s, /0\.96/, "WHIP 이 안 나온다((44+8)/54)");
  // ⚠**피~ 로 남는다** — 투수가 친 것으로 읽히면 안 된다
  for (const col of ["被安打", "被本塁打", "与四球", "奪三振"]) {
    assert.ok(s.includes(col), `${col} 열이 없다`);
  }
});

/** ⚠**막대의 뜻이 바뀐다** — 타자는 OPS(길수록 좋다), 이 축은 방어율(짧을수록 좋다) */
test("⚠막대가 방어율이라고 화면이 말한다 — 「被OPS」라고 적으면 거짓말이다", () => {
  const s = render({ pitching: CELLS });
  assert.match(s, /棒は防御率/, "막대가 무엇인지 안 적었다");
  assert.match(s, /短いほど良い/, "방향을 안 적었다");
  assert.ok(!/棒は被OPS/.test(s), "방어율 표인데 被OPS 라고 적었다");
});

/**
 * ⚠**「없다」를 그냥 비우면 결함으로 읽힌다.** 타석 단위 축에 방어율이 없는 것은
 * 데이터가 빠진 게 아니라 **원리적으로 나눌 수 없어서**다 — 화면이 그 이유를 말한다.
 */
test("⚠타석 단위 축에는 방어율이 없고, 화면이 그 이유를 말한다", () => {
  const s = render({ id: "hand", label: "対左右", pitching: null });
  // ⚠**「防御率」이라는 글자로 재면 안 된다** — 각주가 「防御率はありません」이라고 말하므로
  //   그 글자는 **반드시 나온다.** 재야 할 것은 **열이 없다**는 것이다(첫 판이 여기 걸렸다).
  assert.ok(!/<th>[^<]*防御率/.test(s), "타석 단위 축에 방어율 열이 나왔다 — 나눌 수 없는 수다");
  assert.ok(!/<th>投球回<\/th>/.test(s), "타석 단위 축에 투구회 열이 나왔다");
  assert.match(s, /防御率はありません/, "왜 없는지를 화면이 말하지 않는다");
  assert.match(s, /登板全体につく数/, "이유(등판 전체에 붙은 수)를 안 적었다");
  // 그 축은 여전히 被~ 로 낸다
  assert.match(s, /棒は被OPS/);
});

/**
 * ⚠**여기가 「지어낸 수」를 막는 자리다.**
 *
 * 위 시험들은 축을 **직접 만들어** 넘기므로 `GAME_LEVEL_OF` 를 지나지 않는다 —
 * 실제로 뮤테이션(`hand` 를 경기 단위로 등록)을 걸었더니 **하나도 안 울었다.**
 * 대응표 자체를 재지 않으면, 누가 타석 단위 축을 여기 넣는 날
 * **「없는 값」이 아니라 그럴듯한 거짓 이닝**이 화면에 나간다.
 *
 * ⚠**「경기 단위인가」는 이름으로 추론할 수 없다** — 그래서 표를 손으로 적었고,
 * 이 시험이 그 표를 못 박는다.
 */
test("⚠경기 단위 축 목록이 정확하다 — 타석 단위 축이 섞이면 거짓 이닝이 나간다", () => {
  // 한 등판이 **통째로 한 칸**에 들어가는 축
  assert.deepEqual(
    Object.keys(GAME_LEVEL_OF).sort(),
    ["homeAway", "month", "opponent", "opponentCareer", "venue"],
    "경기 단위 축 목록이 바뀌었다 — 타석 단위 축을 넣으면 이닝을 나눌 수 없는데 나눈 것이 된다",
  );
  // 한 등판이 **여러 칸으로 갈리는** 축은 절대 들어오면 안 된다
  for (const paLevel of ["hand", "base", "order"] as const) {
    assert.equal(
      (GAME_LEVEL_OF as Record<string, unknown>)[paLevel],
      undefined,
      `${paLevel} 은 타석 단위 축이다 — 한 등판이 여러 칸으로 갈려 이닝·자책점을 나눌 수 없다`,
    );
  }
  // ⚠**대응이 뒤집히지 않았는지**도 본다 — 이름이 비슷해 베끼기 쉽다
  assert.equal(GAME_LEVEL_OF.opponent, "opponentTeam");
  assert.equal(GAME_LEVEL_OF.opponentCareer, "opponentTeam");
  assert.equal(GAME_LEVEL_OF.venue, "venue");
  assert.equal(GAME_LEVEL_OF.month, "month");
});

/** ⚠**이닝이 0 이면 방어율은 정의되지 않는다** — `0.00` 이 아니라 「—」다(M2·M11) */
test("⚠이닝 0 인 칸은 방어율을 「—」로 낸다 — 0.00 이 아니다", () => {
  const zero = new Map<string, PitchingSplitCell>([
    ["h", { games: 1, outs: 0, er: 1, h: 2, hr: 0, bb: 1, so: 0 }],
  ]);
  const s = render({ pitching: zero });
  assert.ok(!/>0\.00</.test(s), "이닝 0 인데 방어율을 0.00 으로 냈다 — 분모가 0 이다(M2)");
  assert.match(s, /—/, "정의되지 않는 값을 「—」로 안 냈다");
});
