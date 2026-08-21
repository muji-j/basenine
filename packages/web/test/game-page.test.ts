/**
 * 경기 화면.
 *
 * ⚠**이 화면이 조용히 틀리는 두 길을 막는다.**
 * ① 공격이 없던 이닝에 `0`을 찍는 것 — 실측 1,487경기 중 674경기가 해당하므로
 *    절반의 페이지가 야구를 아는 사람에게 고장으로 보인다.
 * ② 복원이 어긋났는데 그냥 표를 내는 것 — 우리가 조립한 숫자라서 조용히 틀릴 수 있다.
 *
 * 그리고 **원본을 대체하지 않는다는 선**(L2·L3)도 여기서 고정한다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { baseLabel, basesMark, gameSlug, renderGamePage, situationLabel } from "../src/game-page.ts";
import type { GamePageData, GamePlayView, GameSide } from "../src/game-page.ts";
import { colorOf } from "@bb-app/domain";
import { toString } from "../src/html.ts";
import { context } from "./fixtures.ts";

function side(code: string, shortName: string, runs: number, hits: number, errors: number): GameSide {
  return { teamCode: code, name: `${shortName}チーム`, shortName, color: colorOf(code), runs, hits, errors };
}

function play(over: Partial<GamePlayView> = {}): GamePlayView {
  return {
    inning: 6,
    half: "bottom",
    outsBefore: 2,
    bases: "123",
    batter: { playerId: "B1", name: "長岡" },
    pitcher: { playerId: "P1", name: "松本凌" },
    rawBox: "右越本④",
    rbi: 4,
    runsScored: 4,
    swing: 3.48,
    awayScore: 0,
    homeScore: 7,
    ...over,
  };
}

/** 1회말 1점 · 6회말 6점 · 7회표 2점. **9회말은 치지 않았다** */
function innings() {
  const out = [];
  for (let i = 1; i <= 9; i += 1) {
    out.push({ inning: i, half: "top" as const, runs: i === 7 ? 2 : 0, batted: true });
    out.push({
      inning: i,
      half: "bottom" as const,
      runs: i === 1 ? 1 : i === 6 ? 6 : 0,
      // ⚠9회말은 공격이 없었다
      batted: i !== 9,
    });
  }
  return out;
}

function data(over: Partial<GamePageData> = {}): GamePageData {
  return {
    gameId: "2026/0814/s-db-17",
    gameDate: "2026-08-14",
    venue: "神宮",
    series: "JERA セ・リーグ公式戦",
    away: side("db", "DeNA", 2, 4, 2),
    home: side("s", "ヤクルト", 7, 9, 0),
    innings: innings(),
    reconciles: true,
    scoringPlays: [play()],
    keyPlays: [play()],
    keyPlayLimit: 5,
    win: { playerId: "PW", name: "奥川" },
    lose: { playerId: "PL", name: "平良" },
    save: null,
    sourceUrl: "https://npb.jp/scores/2026/0814/s-db-17/box.html",
    ...over,
  };
}

test("⚠공격이 없던 이닝은 「x」다 — 「0」이라고 쓰면 야구를 아는 사람에게 고장으로 보인다(M11)", () => {
  const out = renderGamePage(data(), context());
  assert.match(out, /<td class="x" aria-label="攻撃なし">x<\/td>/, "9회말이 x로 나오지 않았다");
  // 0점이지만 친 이닝은 0이어야 한다 — 전부 x가 되면 뜻이 없다
  assert.match(out, /<td class="">0<\/td>/, "0점 이닝이 사라졌다");
});

test("득점한 이닝을 강조한다 — 이 표에서 눈이 찾는 것은 「어디서 났는가」다", () => {
  const out = renderGamePage(data(), context());
  assert.match(out, /<td class="sc">6<\/td>/, "6점 이닝이 강조되지 않았다");
  assert.ok(!/<td class="sc">0</.test(out), "0점 이닝이 강조됐다");
});

test("⚠복원이 어긋나면 표보다 먼저 말한다 — 조용히 틀린 표를 내지 않는다", () => {
  const bad = renderGamePage(data({ reconciles: false }), context());
  assert.match(bad, /一致していません/);
  assert.ok(bad.indexOf("一致していません") < bad.indexOf("iscore"), "경고가 표보다 뒤에 있다");

  const good = renderGamePage(data(), context());
  assert.ok(!good.includes("一致していません"), "맞는데 경고가 나왔다");
});

/**
 * ⚠**「원본을 옮긴 것이 아니다」라고 쓰지 않는다**(2026-08-16 이중 검토에서 지적).
 * 이닝별 득점은 계산 구조상 라인스코어와 **항상 같은 수**가 된다 —
 * 반이닝의 마지막 타석을 라인스코어로 닫기 때문이다.
 * 검증되지 않은 안전 주장을 화면에 두면, 나중에 그 문장을 근거로 판단할 때 판단이 틀린다.
 */
test("⚠하지 않는 일을 했다고 쓰지 않는다 — 우리가 하는 것은 「대조」다(L2·M4)", () => {
  const out = renderGamePage(data(), context());
  assert.match(out, /組み直した合計と.*一致するか/s, "무엇을 하는지 말하지 않았다");
  assert.ok(
    !out.includes("原本の表を写したものではありません"),
    "검증되지 않은 안전 주장이 남아 있다 — 이 값은 실제로 공표값과 같은 수다",
  );
});

test("⚠원본으로 가는 링크를 둔다 — 대체하는 것이 아니라 가리킨다(L3)", () => {
  const out = renderGamePage(data(), context());
  assert.match(out, /https:\/\/npb\.jp\/scores\/2026\/0814\/s-db-17\/box\.html/);
});

test("⚠중계 문장을 옮기지 않는다 — 기록의 표준 기호만 쓴다(L2)", () => {
  const out = renderGamePage(data(), context());
  assert.match(out, /右越本④/, "기호 표기가 없다");
  assert.ok(!out.includes("ライト"), "중계 문장이 섞였다");
});

test("주자 상황을 그림과 말로 함께 낸다 — 그림만 있으면 읽어 주는 화면에서 사라진다", () => {
  const out = renderGamePage(data(), context());
  assert.match(out, /aria-label="2死 満塁"/);
});

test("다이아몬드는 채워진 베이스만 칠한다 — 색만으로 구별하지 않는다", () => {
  const full = toString(basesMark("123", 2));
  assert.equal(full.match(/class="db on"/g)?.length, 3, "만루인데 3개가 안 채워졌다");
  const empty = toString(basesMark("", 0));
  assert.ok(!empty.includes('class="db on"'), "주자가 없는데 베이스가 칠해졌다");
  assert.equal(empty.match(/class="do "/g)?.length, 3, "0아웃인데 아웃 점이 켜졌다");
});

test("주자 표기가 일본어 야구 표기다", () => {
  assert.equal(baseLabel(""), "走者なし");
  assert.equal(baseLabel("123"), "満塁");
  assert.equal(baseLabel("23"), "二三塁");
  assert.equal(situationLabel(1, "2"), "1死 二塁");
});

test("⚠득점기대치가 실력이 아니라는 것을 말한다 — SRC와 같은 주의가 붙는다", () => {
  const out = renderGamePage(data(), context());
  assert.match(out, /選手の実力を表すものではありません/);
  assert.match(out, /守備の貢献は含みません/);
  // ⚠주루가 섞여 들어간다는 사실도 같은 자리에서 말한다(분리할 수 없으므로)
  assert.match(out, /走塁（暴投・盗塁など）で入った点も同じ欄に入ります/);
});

test("자른 사실을 말한다 — 「上位5打席」", () => {
  const out = renderGamePage(data(), context());
  assert.match(out, /上位5打席/);
});

test("승·패·세이브를 라벨로 구분한다 — 색만으로는 구별되지 않는다", () => {
  const out = renderGamePage(data({ save: { playerId: "PS", name: "田口" } }), context());
  assert.match(out, /<b>勝<\/b>/);
  assert.match(out, /<b>負<\/b>/);
  assert.match(out, /<b>S<\/b>/);
});

test("이긴 쪽을 표시한다 — 무승부면 그렇게 말한다", () => {
  const won = renderGamePage(data(), context());
  assert.match(won, /gbside w/);
  const tie = renderGamePage(
    data({ away: side("db", "DeNA", 3, 8, 0), home: side("s", "ヤクルト", 3, 9, 1) }),
    context(),
  );
  assert.match(tie, /引き分け/);
  assert.ok(!/gbside w/.test(tie), "무승부인데 이긴 쪽 표시가 붙었다");
});

test("연장전이면 이닝 열이 늘어난다", () => {
  const ex = [...innings()];
  for (let i = 10; i <= 12; i += 1) {
    ex.push({ inning: i, half: "top" as const, runs: 0, batted: true });
    ex.push({ inning: i, half: "bottom" as const, runs: i === 12 ? 1 : 0, batted: true });
  }
  const out = renderGamePage(data({ innings: ex }), context());
  assert.match(out, /<th>12<\/th>/, "12회 열이 없다");
});

test("득점이 없는 경기는 그렇게 말한다 — 빈 목록을 남기지 않는다(M12)", () => {
  const out = renderGamePage(data({ scoringPlays: [], away: side("db", "DeNA", 0, 3, 0), home: side("s", "ヤクルト", 0, 2, 1) }), context());
  assert.match(out, /この試合に得点はありませんでした/);
});

test("⚠경기 ID를 파일 이름으로 바꾸는 규칙은 한 곳이다 — 어긋나면 404가 조용히 생긴다", () => {
  assert.equal(gameSlug("2026/0814/s-db-17"), "2026-0814-s-db-17");
});

test("선수 이름을 모르면 그 자리를 비운다 — 숫자 ID를 화면에 내지 않는다", () => {
  const blank = [play({ batter: null, pitcher: null })];
  const out = renderGamePage(data({ keyPlays: blank, scoringPlays: blank }), context());
  assert.ok(!out.includes("B1"), "선수 ID가 화면에 나왔다");
  assert.ok(!out.includes("P1"), "투수 ID가 화면에 나왔다");
});

/**
 * ⚠**「三振 2点」이 배포물에 실제로 있었다**(2026-08-16 이중 검토에서 발견).
 * 그 점은 타석 중에 일어난 주루(폭투 등)로 들어온 것인데, 화면은 타자가 낸 것처럼 보여 줬다.
 * 원천 기록에 주루가 별도 행으로 없어 **분리할 수 없으므로**, 숨기는 대신 표시한다.
 */
test("⚠타점 없이 들어온 점은 타자가 낸 점이 아니라고 말한다", () => {
  const out = renderGamePage(
    data({
      scoringPlays: [play({ rawBox: "三振", rbi: 0, runsScored: 2 })],
      keyPlays: [play({ rawBox: "三振", rbi: 0, runsScored: 2 })],
    }),
    context(),
  );
  assert.match(out, /打点なし/, "타점 없는 득점에 표시가 없다");
  assert.match(out, /em class="norbi"/, "타자의 성과처럼 강조됐다");
  assert.match(out, /走塁/, "왜 그런지 설명하지 않았다");
});

test("타점이 있는 득점에는 그 표시를 붙이지 않는다 — 붙으면 뜻이 없어진다", () => {
  const out = renderGamePage(data(), context());
  // ⚠설명문에는 「打点なし」라는 말이 나오므로, **표시 자체**로 확인한다
  assert.ok(!out.includes('em class="norbi"'), "타점 4점짜리 만루 홈런이 「타자가 낸 점이 아님」으로 표시됐다");
  assert.ok(!/<s>打点なし<\/s>/.test(out), "타점이 있는데 「打点なし」가 붙었다");
});

/**
 * ⚠**타석 로그의 「対 <투수>」가 링크가 아니었다**(2026-08-21 배포물 전수 실측).
 * 타순표·승패투수 이름은 링크인데 **타석마다 나오는 상대 투수만 생텍스트**라,
 * 「선수명을 눌러도 반응이 없다」의 가장 큰 덩어리였다.
 *
 * ⚠**가리킬 페이지가 있다는 것을 먼저 실측했다** — 타석 로그에 나오는 투수는
 * 2018~2026 9시즌 **투수-시즌 3,131건 전부** 그 시즌의 선수 페이지가 존재한다(페이지 없음 0).
 * 그래서 「없는 곳으로 가는 링크」가 되지 않는다.
 */
test("⚠「対 <투수>」도 그 선수 페이지로 간다 — 타자만 링크면 절반이 눌리지 않는다", () => {
  const out = renderGamePage(data(), context());
  assert.match(out, /<a href="[^"]*players\/P1\.html">松本凌<\/a>/, "상대 투수 이름이 링크가 아니다");
  assert.match(out, /<a href="[^"]*players\/B1\.html">長岡<\/a>/, "타자 링크가 사라졌다");
});

test("투수를 모르는 타석에는 「対」 자체를 내지 않는다 — 없는 곳을 가리키지 않는다", () => {
  const out = renderGamePage(
    data({ scoringPlays: [play({ pitcher: null })], keyPlays: [play({ pitcher: null })] }),
    context(),
  );
  assert.ok(!out.includes("対 "), "투수가 null인데 「対」가 나왔다");
});

/**
 * ⚠**경기 페이지에는 구단 링크가 한 개도 없었다**(2026-08-21 배포물 전수 실측: `games/*` 7,502장 · 구단 링크 0).
 * 보이는 구단명은 **장당 4곳**(대형 스코어 2 + 이닝표 행 머리 2) = **30,008곳**이었고 전부 생텍스트였다.
 * 여기는 이 화면의 「머리·요약」이라 사용자 결정에 따라 링크를 붙인다(조밀한 표는 붙이지 않는다).
 */
test("⚠경기 화면의 구단명이 그 구단 페이지로 간다 — 스코어와 이닝표 머리 둘 다", () => {
  const out = renderGamePage(data(), context());
  assert.match(out, /<span class="gbt"><i><\/i><a href="[^"]*teams\/db\.html">DeNAチーム<\/a><\/span>/, "대형 스코어의 원정 구단명이 링크가 아니다");
  assert.match(out, /<span class="gbt"><i><\/i><a href="[^"]*teams\/s\.html">ヤクルトチーム<\/a><\/span>/, "대형 스코어의 홈 구단명이 링크가 아니다");
  assert.match(out, /<th class="l tm" scope="row"><i><\/i><a href="[^"]*teams\/db\.html">DeNA<\/a><\/th>/, "이닝표 행 머리가 링크가 아니다");
});

/**
 * ⚠**올스타는 구단이 아니다**(`cl`/`pl`). 구단 페이지가 없으므로 **링크를 만들면 404다.**
 * 지금 올스타 경기 페이지는 만들어지지 않지만 그건 우연이고, 이 시험이 그 우연을 결정으로 바꾼다.
 */
test("⚠구단 페이지가 없는 코드에는 링크를 만들지 않는다 — 없는 곳을 가리키지 않는다", () => {
  const out = renderGamePage(
    data({ away: side("cl", "セ", 3, 5, 0), home: side("pl", "パ", 2, 7, 1) }),
    context(),
  );
  assert.ok(!/teams\/cl\.html/.test(out), "올스타 코드로 구단 페이지 링크를 만들었다");
  assert.ok(!/teams\/pl\.html/.test(out), "올스타 코드로 구단 페이지 링크를 만들었다");
  assert.match(out, /<span class="gbt"><i><\/i>セチーム<\/span>/, "링크를 안 만드는 대신 글자까지 사라졌다");
});
