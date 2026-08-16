/**
 * 「対戦を選ぶ」의 빠른 선택.
 *
 * ⚠**이 화면은 라이브를 취득하지 않는다**(§6). 「누가 대전하는가」는 予告先発로 공표된
 * 사실이고, 「지금 누가 던지는가」는 여전히 화면을 보는 사람이 고른다.
 * 그러니 이 기능이 지켜야 할 것은 **고르기 쉬움**이지 정보의 신선도가 아니다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { batterPick, pitcherPick, renderMatchupPage, unseenPitcherPick } from "../src/pages.ts";
import type { MatchupPageData, MatchupPick, MatchupTeam } from "../src/pages.ts";
import { colorOf, shortNameOf, teamOf } from "@bb-app/domain";
import { context, pastSeasonContext } from "./fixtures.ts";

function pick(name: string, usage: string, probable = false): MatchupPick {
  return { playerId: `P_${name}`, name, usage, probable };
}

function team(code: string, pitchers: MatchupPick[], batters: MatchupPick[]): MatchupTeam {
  return {
    teamCode: code,
    shortName: shortNameOf(code),
    name: teamOf(code).name,
    color: colorOf(code),
    pitchers,
    batters,
  };
}

function data(over: Partial<MatchupPageData> = {}): MatchupPageData {
  return {
    season: 2026,
    asOf: "2026-08-15",
    pickDate: "2026-08-16",
    builtOn: "2026-08-16",
    games: [
      {
        key: "s-db",
        venue: "神宮",
        startTime: "18:00",
        sides: [
          team("s", [pick("奥川", "118回", true), pick("木澤", "40.1回")], [pick("村上", "412打席")]),
          team("db", [pick("東", "140回", true)], [pick("牧", "440打席"), pick("佐野", "300打席")]),
        ],
      },
    ],
    ...over,
  };
}

test("오늘 대전하는 두 팀의 선수가 버튼으로 나온다 — 이름을 칠 필요가 없다", () => {
  const out = renderMatchupPage(data(), context());
  assert.match(out, /2026年8月16日（本日）の対戦から選ぶ/);
  assert.match(out, /data-tab="s-db"[^>]*>ヤクルト − DeNA</);
  for (const n of ["奥川", "木澤", "村上", "東", "牧", "佐野"]) {
    assert.ok(out.includes(`data-n="${n}"`), `${n} 버튼이 없다`);
  }
});

/**
 * ⚠**양 팀 모두에 投手와 打者를 둔다.** 「어느 쪽이 공격 중인가」를 먼저 묻는 화면으로 만들면
 * 조작이 한 단계 늘고, 그 답은 화면을 보는 사람이 이미 알고 있다.
 */
test("어느 쪽이 공격 중인지 먼저 묻지 않는다 — 양 팀에 投手와 打者가 다 있다", () => {
  const out = renderMatchupPage(data(), context());
  const teams = out.split('class="pickteam"').slice(1);
  assert.equal(teams.length, 2);
  for (const t of teams) {
    assert.ok(t.includes('data-pick="pitcher"'), "이 팀에는 투수 버튼이 없다");
    assert.ok(t.includes('data-pick="batter"'), "이 팀에는 타자 버튼이 없다");
  }
});

test("予告先発에 표식이 붙는다 — 이 화면에서 가장 눌릴 버튼이다", () => {
  const out = renderMatchupPage(data(), context());
  const at = out.indexOf('data-n="奥川"');
  assert.ok(at > 0);
  assert.match(out.slice(at, at + 160), /<em>予告<\/em>/);
  // 표식이 없는 투수에는 붙지 않는다
  const other = out.indexOf('data-n="木澤"');
  assert.ok(!out.slice(other, other + 160).includes("予告"));
});

/**
 * ⚠**버튼에 비율을 싣지 않는다.** 타율을 적으면 분모까지 적어야 하고(M2),
 * 그러면 버튼이 문장이 되어 「고르는 화면」이 「읽는 화면」으로 바뀐다.
 * 대신 세는 값(打席·投球回)만 쓴다 — 분모 문제가 없고 주전인지도 그 값이 말한다.
 */
test("버튼의 숫자는 세는 값이다 — 분모 없는 비율을 내지 않는다", () => {
  const out = renderMatchupPage(data(), context());
  const list = out.slice(out.indexOf('class="picklist"'), out.indexOf("</section>"));
  assert.match(list, /<s>118回<\/s>/);
  assert.match(list, /<s>412打席<\/s>/);
  assert.ok(!/打率|防御率|OPS/.test(list), "버튼에 비율이 들어갔다");
});

/**
 * ⚠**버튼을 만드는 입구가 하나다.** 비율을 넣을 수 있게 열어 두면 언젠가 들어가고,
 * 그러면 분모 없는 비율이 화면에 뜬다(M2). 시험이 아니라 **형태**로 막는다.
 */
test("빠른 선택은 세는 값만 받는 입구를 지난다", () => {
  assert.deepEqual(batterPick("P1", "村上", 412), {
    playerId: "P1", name: "村上", usage: "412打席", probable: false,
  });
  // 355아웃 = 118과 1/3이닝. **소수 첫째 자리는 아웃 수이지 10분위가 아니다**
  assert.deepEqual(pitcherPick("P2", "奥川", 355), {
    playerId: "P2", name: "奥川", usage: "118.1回", probable: false,
  });
  // ⚠올 시즌 등판이 없는 예고선발이 실재한다(1군 승격·이적 직후).
  // 「0回」라고 쓰면 던져서 0이닝인 것과 구별되지 않는다(M11)
  assert.deepEqual(unseenPitcherPick("P3", "新人"), {
    playerId: "P3", name: "新人", usage: "今季登板なし", probable: true,
  });
});

test("긴 목록은 묶음이라고 말하고, 어느 팀의 무엇인지도 말한다", () => {
  const out = renderMatchupPage(data(), context());
  const labels = [...out.matchAll(/class="picklist" role="toolbar"[\s\S]{0,60}?aria-label="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(labels, [
    "ヤクルトの投手（左右キーで移動）",
    "ヤクルトの打者（左右キーで移動）",
    "DeNAの投手（左右キーで移動）",
    "DeNAの打者（左右キーで移動）",
  ]);
});

test("고른 것과 실행 버튼은 한 자리에 붙어 있다 — 목록이 길어도 화면에서 사라지지 않는다", () => {
  const out = renderMatchupPage(data(), context());
  const bar = out.slice(out.indexOf('class="pickbar"'), out.indexOf('id="pickToday"'));
  assert.ok(bar.includes('id="pick-pitcher-chosen"'), "투수 선택 표시가 띠 밖에 있다");
  assert.ok(bar.includes('id="pick-batter-chosen"'), "타자 선택 표시가 띠 밖에 있다");
  assert.ok(bar.includes('id="pickGo"'), "실행 버튼이 띠 밖에 있다");
});

/**
 * ⚠**두 길을 나란히 둔다.** 버튼은 「오늘 대전하는 두 팀」만 담으므로,
 * 그 밖의 선수를 찾는 길이 **접힌 채로 있으면 없는 것과 같다**(사용자 지적).
 * 한때 details 로 접었다가 되돌린 자리다.
 */
test("이름 검색은 항상 보인다 — 접지 않는다", () => {
  const out = renderMatchupPage(data(), context());
  assert.ok(!out.includes("<details"), "이름 검색이 접혀 있다");
  assert.match(out, /名前でさがす/);
  // 검색창 두 개가 실제로 있다
  assert.match(out, /id="pickPitcher"/);
  assert.match(out, /id="pickBatter"/);
});

test("예고가 없으면 빠른 선택을 만들지 않고 이름 검색만 남는다", () => {
  const out = renderMatchupPage(data({ pickDate: null, games: [] }), context());
  assert.ok(!out.includes('id="pickToday"'), "빈 빠른 선택이 남았다");
  assert.match(out, /名前でさがす/);
  assert.match(out, /予告先発がまだ発表されていない/, "왜 이 모양인지 말하지 않았다");
});

test("이름 검색이 먼저, 오늘 대전 버튼이 그다음 — 어느 쪽도 접히지 않는다", () => {
  const out = renderMatchupPage(data(), context());
  const find = out.indexOf('class="pickfind"');
  const quick = out.indexOf('id="pickToday"');
  assert.ok(find > 0 && quick > 0);
  assert.ok(find < quick, "이름 검색이 버튼 목록 아래로 내려갔다");
  // 버튼에 없는 선수는 위에서 찾으라고 화면이 말한다
  assert.match(out, /名前でさがす」から選べます/);
});

test("⚠경기일이 생성일과 다르면 「本日」라고 쓰지 않는다", () => {
  const out = renderMatchupPage(data({ pickDate: "2026-08-17" }), context());
  assert.match(out, /2026年8月17日の対戦から選ぶ/);
  assert.ok(!out.includes("（本日）"));
});

test("버튼이 넘기는 값은 검색 색인과 같은 모양이다 — 뒤가 두 갈래로 갈리지 않는다", () => {
  const out = renderMatchupPage(data(), context());
  const at = out.indexOf('data-i="P_村上"');
  const btn = out.slice(out.lastIndexOf("<button", at), out.indexOf("</button>", at));
  assert.match(btn, /data-pick="batter"/);
  assert.match(btn, /data-n="村上"/);
  assert.match(btn, /data-t="東京ヤクルトスワローズ"/, "구단 표기가 검색 색인과 다르다");
  assert.match(btn, /aria-pressed="false"/, "눌림 상태를 말하지 않는다");
});

/**
 * ⚠**끝난 시즌에서 「いま投げている投手を選ぶと」는 거짓말이다.**
 * 그 시즌에 진행 중인 경기는 없다. 시즌 전환 띠로 실제로 갈 수 있는 화면이라 눈에 띈다.
 */
test("끝난 시즌의 対戦 화면은 「지금 던지고 있는 투수」라고 말하지 않는다", () => {
  const out = renderMatchupPage(
    data({ season: 2025, pickDate: null, games: [] }),
    pastSeasonContext(["matchup.html"]),
  );
  assert.ok(!out.includes("いま投げている投手"), "끝난 시즌에 진행 중인 경기가 있는 것처럼 말했다");
  assert.match(out, /2025年は終了したシーズンです/);
});

test("진행 중인 시즌에서는 지금까지대로 말한다", () => {
  const out = renderMatchupPage(data(), context());
  assert.match(out, /いま投げている投手/);
});
