/**
 * **포스트시즌 화면**(PR-3) — CS·日本シリーズ를 試合 탭·홈에 대회 표기와 함께 싣는다.
 *
 * 설계: `docs/superpowers/specs/2026-10-24-postseason-display-design.md` §6 (T1~T13)
 *
 * ⚠**단언은 화면 산출물로 한다**(설계 §6). 아직 없는 함수를 부르면 고치기 전 코드에서 ERROR(돌지도 않음)라
 * RED 로 칠 수 없다 — 그래서 이 파일은 이미 있는 입구(`loadSite`·`buildSite`·`collectionEvidence`)만 쓴다.
 * ⚠**외부 요청 0 · 시계 0**(M6) — 생성일·취득 시각은 전부 시험이 준다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { posix } from "node:path";
import { collectionEvidence, japanSeriesDecided } from "@bb-app/store";
import { collectionVerdict } from "@bb-app/domain";
import { Fixture, build, plusDays, regularSeason, section, text } from "./postseason-fixture.ts";
import type { GameSpec } from "./postseason-fixture.ts";

/* ── 2026 의 모양(실측 · 최신 CI DB 사본 2026-10-24T00:49Z) ─────────────────────────── */

/** 정규 마지막 경기일 — 12구단 전부 143 에 닿은 날 */
const REG_LAST = "2026-10-08";
const FIRST = plusDays(REG_LAST, -142);

const CS: readonly GameSpec[] = [
  { date: "2026-10-10", home: "g", away: "db", series: "CS ファーストステージ", gameNo: 1, homeRuns: 1, awayRuns: 2, venue: "東京ドーム" },
  { date: "2026-10-10", home: "l", away: "f", series: "CS ファーストステージ", gameNo: 1, homeRuns: 3, awayRuns: 2, venue: "ベルーナドーム" },
  { date: "2026-10-11", home: "g", away: "db", series: "CS ファーストステージ", gameNo: 2, homeRuns: 1, awayRuns: 4, venue: "東京ドーム" },
  { date: "2026-10-11", home: "l", away: "f", series: "CS ファーストステージ", gameNo: 2, homeRuns: 0, awayRuns: 1, venue: "ベルーナドーム" },
  { date: "2026-10-12", home: "l", away: "f", series: "CS ファーストステージ", gameNo: 3, homeRuns: 1, awayRuns: 4, venue: "ベルーナドーム" },
  { date: "2026-10-14", home: "h", away: "f", series: "CS ファイナルステージ", gameNo: 1, homeRuns: 6, awayRuns: 4, venue: "みずほPayPay" },
  { date: "2026-10-14", home: "t", away: "db", series: "CS ファイナルステージ", gameNo: 1, homeRuns: 0, awayRuns: 2, venue: "甲子園" },
  { date: "2026-10-15", home: "h", away: "f", series: "CS ファイナルステージ", gameNo: 2, homeRuns: 6, awayRuns: 2, venue: "みずほPayPay" },
  { date: "2026-10-15", home: "t", away: "db", series: "CS ファイナルステージ", gameNo: 2, homeRuns: 0, awayRuns: 1, venue: "甲子園" },
  { date: "2026-10-16", home: "h", away: "f", series: "CS ファイナルステージ", gameNo: 3, homeRuns: 6, awayRuns: 2, venue: "みずほPayPay" },
  { date: "2026-10-16", home: "t", away: "db", series: "CS ファイナルステージ", gameNo: 3, homeRuns: 0, awayRuns: 4, venue: "甲子園" },
  { date: "2026-10-17", home: "t", away: "db", series: "CS ファイナルステージ", gameNo: 4, homeRuns: 5, awayRuns: 8, venue: "甲子園" },
].map((g) => ({ ...g, competition: "climaxSeries" as const }));

/** 予告先発 — 그 경기의 전날 저녁(실측 시각이 있는 날은 그 시각) */
const PROBABLES: readonly { date: string; home: string; away: string; at: string }[] = [
  { date: "2026-10-08", home: "t", away: "g", at: "2026-10-07T09:00:00.000Z" },
  ...CS.map((g) => ({ date: g.date, home: g.home, away: g.away, at: `${plusDays(g.date, -1)}T09:00:00.000Z` })),
  // ⚠열리지 않은 CS 5차전 — 10/17 09:05Z 에 예고, 11:05Z 에 휴식 공표(실측)
  { date: "2026-10-18", home: "t", away: "db", at: "2026-10-17T09:05:25.199Z" },
];

/** 予告先発 페이지의 휴식 공표(실측 6행) */
const RESTS: readonly { fetchedDate: string; gameDate: string; at: string }[] = [
  { fetchedDate: "2026-10-12", gameDate: "2026-10-13", at: "2026-10-12T12:48:26.278Z" },
  { fetchedDate: "2026-10-17", gameDate: "2026-10-18", at: "2026-10-17T11:05:08.179Z" },
  { fetchedDate: "2026-10-18", gameDate: "2026-10-18", at: "2026-10-17T18:24:37.964Z" },
  { fetchedDate: "2026-10-19", gameDate: "2026-10-20", at: "2026-10-19T13:50:32.089Z" },
  { fetchedDate: "2026-10-20", gameDate: "2026-10-20", at: "2026-10-19T20:08:08.333Z" },
  { fetchedDate: "2026-10-21", gameDate: "2026-10-21", at: "2026-10-21T09:52:30.793Z" },
];

/** 日本シリーズ 일정(10/21 사본 · 7행 · 전부 DeNA−ソフトバンク) */
const JS_UPCOMING: readonly { date: string; home: string; away: string; venue: string; time: string }[] = [
  { date: "2026-10-24", home: "db", away: "h", venue: "横浜", time: "18:30" },
  { date: "2026-10-25", home: "db", away: "h", venue: "横浜", time: "18:00" },
  { date: "2026-10-27", home: "h", away: "db", venue: "みずほPayPay", time: "18:00" },
  { date: "2026-10-28", home: "h", away: "db", venue: "みずほPayPay", time: "18:00" },
  { date: "2026-10-29", home: "h", away: "db", venue: "みずほPayPay", time: "18:00" },
  { date: "2026-10-31", home: "db", away: "h", venue: "横浜", time: "18:30" },
  { date: "2026-11-01", home: "db", away: "h", venue: "横浜", time: "18:00" },
];

/**
 * **빌드일 B 의 아침(JST 09:00 = 00:00Z) 에 DB 가 알던 것만** 넣는다 — 설계 §0 표의 재구성과 같은 방식.
 * - 경기: B 전날까지(수집은 다음 날 아침이다)
 * - 予告先発·휴식 공표: 그 시각 전에 받은 것
 * - 앞으로의 경기: CS 기간은 남은 CS 경기(일정 사본이 매일 갱신된 정상 상태) · 10/22 부터 日本S(10/21 사본)
 */
function stateAt(B: string, o: { regular?: boolean } = {}): Fixture {
  const cutoff = `${B}T00:00:00.000Z`;
  const fx = new Fixture();
  fx.batch(() => {
    if (o.regular !== false) regularSeason(fx, { first: FIRST, days: 143 });
    for (const g of CS) if (g.date < B) fx.game(g);
    for (const p of PROBABLES) if (p.at < cutoff) fx.probable(p.date, p.home, p.away, p.at);
    for (const r of RESTS) if (r.at < cutoff) fx.rest(r.fetchedDate, r.gameDate, r.at);
    if (B <= "2026-10-17") {
      for (const g of CS) if (g.date >= B) fx.upcoming(g.date, g.home, g.away, { venue: g.venue ?? "" });
    }
    if (B >= "2026-10-22") {
      for (const u of JS_UPCOMING) fx.upcoming(u.date, u.home, u.away, { venue: u.venue, startTime: u.time });
    }
  });
  return fx;
}

/** 그 상태로 2026 한 시즌을 굽는다 — 띠·次の予告先発가 쓰는 수집 판정까지 빌드와 같은 식으로 */
function site(fx: Fixture, builtOn: string): Map<string, string> {
  return build([{ data: fx.load(2026, builtOn), season: 2026 }], builtOn, fx.collection(builtOn));
}

function page(files: Map<string, string>, path: string): string {
  const out = files.get(path);
  assert.ok(out !== undefined, `${path} 가 만들어지지 않았다`);
  return out;
}

/* ── T1 타임라인 ─────────────────────────────────────────────────────────── */

test("⚠T1 試合의 「최신」은 타임라인(정규+CS+日本S)의 최신일이다 — 정규 10/08 에 멈추지 않는다", () => {
  const fx = stateAt("2026-10-24");
  try {
    const files = site(fx, "2026-10-24");
    const today = page(files, "today.html");
    assert.match(section(today, "b-results"), /2026年10月17日の結果/, "CS 마지막 날이 아니라 정규 마지막 날을 「최신」이라 불렀다");
    assert.match(today, /セ・リーグ CS ファイナルステージ 第4戦/, "CS 카드에 대회 표기가 없다");
    assert.ok(files.has("days/2026-10-08.html"), "정규 마지막 날의 날짜 화면이 없다 — 그 날은 이제 today.html 이 아니다");
    assert.ok(!files.has("days/2026-10-17.html"), "최신일(10/17)의 날짜 화면이 따로 생겼다 — 그 날은 today.html 이 맡는다");
    // 사이 날들(CS)도 날짜 화면이 있다
    for (const d of ["2026-10-10", "2026-10-11", "2026-10-12", "2026-10-14", "2026-10-15", "2026-10-16"]) {
      assert.ok(files.has(`days/${d}.html`), `${d} 의 날짜 화면이 없다`);
    }
  } finally {
    fx.close();
  }
});

/* ── T2 라우팅 ───────────────────────────────────────────────────────────── */

/** `「YYYY年M月D日」` → ISO. 글자에 날짜가 없으면 null */
function claimedDate(s: string): string | null {
  const m = /(\d{4})年(\d{1,2})月(\d{1,2})日/.exec(s);
  return m === null ? null : `${m[1]}-${m[2]!.padStart(2, "0")}-${m[3]!.padStart(2, "0")}`;
}

test("⚠T2 링크의 날짜 = 도착 화면의 날짜 — 구단 「直近の試合」 10/08 은 days/2026-10-08.html 로 간다", () => {
  const fx = stateAt("2026-10-24");
  try {
    const files = site(fx, "2026-10-24");
    const team = page(files, "teams/t.html");
    const recent = section(team, "b-teamgames");
    assert.match(recent, /href="\.\.\/days\/2026-10-08\.html"><b>[^<]*<\/b><span>2026年10月8日<\/span>/,
      "구단의 10/08 링크가 today.html(10/17 화면)로 간다 — 404 가 아니라 다른 날이라 링크 검사가 못 잡는다");

    // 사이트 전체 — 링크 글자가 날짜를 말하면 그 날짜가 도착 화면의 날짜다
    const todayDate = claimedDate(section(page(files, "today.html"), "b-results"));
    assert.equal(todayDate, "2026-10-17");
    let compared = 0;
    for (const [path, html] of files) {
      if (!path.endsWith(".html")) continue;
      for (const m of html.matchAll(/<a\b[^>]*\bhref="([^"#]*)(?:#[^"]*)?"[^>]*>([\s\S]*?)<\/a>/g)) {
        const target = posix.normalize(posix.join(posix.dirname(path), m[1]!));
        const landing: string | null = target === "today.html"
          ? todayDate
          : /^days\/(\d{4}-\d{2}-\d{2})\.html$/.exec(target)?.[1] ?? null;
        if (landing === null) continue;
        if (target !== "today.html") assert.ok(files.has(target), `${path} → ${target} 가 없다`);
        const claimed = claimedDate(text(m[2]!));
        if (claimed === null) continue;
        compared += 1;
        assert.equal(claimed, landing, `${path} 의 링크가 「${claimed}」라고 말하는데 ${target}(${landing})로 간다`);
      }
    }
    assert.ok(compared > 20, `날짜를 말하는 링크를 ${compared}개밖에 못 봤다 — 시험이 공회전한다`);
  } finally {
    fx.close();
  }
});

/* ── T3 경계 ─────────────────────────────────────────────────────────────── */

test("⚠T3 CS 행이 있어도 순위·집계·홈의 정규 내용은 바이트까지 같다 — 연속기록이 0행이 되지 않는다", () => {
  const without = stateAt("2026-10-24");
  const withCs = stateAt("2026-10-24");
  try {
    // 「없는 쪽」에서 CS 행을 지운다 — 나머지는 한 벌이다
    without.db.raw.exec("DELETE FROM batting_line WHERE game_id IN (SELECT game_id FROM game WHERE competition = 'climaxSeries')");
    without.db.raw.exec("DELETE FROM pitching_line WHERE game_id IN (SELECT game_id FROM game WHERE competition = 'climaxSeries')");
    without.db.raw.exec("DELETE FROM game WHERE competition = 'climaxSeries'");
    const a = without.load(2026, "2026-10-24");
    const b = withCs.load(2026, "2026-10-24");
    assert.ok(a.home.streaks.length > 0, "픽스처에 이어지는 연속기록이 없다 — 이 시험이 공회전한다");
    assert.deepEqual(b.home.streaks, a.home.streaks, "CS 가 있으면 「続いている記録」가 달라진다(정규 최신일 자리에 타임라인 최신일)");
    assert.deepEqual(b.home.leagues, a.home.leagues);
    assert.deepEqual(b.home.week, a.home.week);
    assert.deepEqual(b.home.paces, a.home.paces);
    assert.deepEqual(b.home.milestones, a.home.milestones);
    assert.deepEqual(b.ranking.standings, a.ranking.standings);
    assert.deepEqual(b.ranking.leagues, a.ranking.leagues);
    assert.deepEqual(
      b.teams.map((t) => ({ code: t.teamCode, batters: t.batters, pitchers: t.pitchers, months: t.months, vs: t.vs, recent: t.recent })),
      a.teams.map((t) => ({ code: t.teamCode, batters: t.batters, pitchers: t.pitchers, months: t.months, vs: t.vs, recent: t.recent })),
    );
    assert.deepEqual(
      b.players.map((p) => ({ id: p.playerId, batting: p.batting, pitching: p.pitching })),
      a.players.map((p) => ({ id: p.playerId, batting: p.batting, pitching: p.pitching })),
    );
    assert.equal(b.asOf, a.asOf, "화면의 정규 기준일이 달라졌다");
  } finally {
    without.close();
    withCs.close();
  }
});

/* ── T4 次の予告先発 ─────────────────────────────────────────────────────── */

/** 試合 화면의 「次の予告先発」 구획 글자 */
function nextBlock(files: Map<string, string>): string {
  return section(page(files, "today.html"), "b-probable");
}

const T4: readonly { builtOn: string; expect: RegExp; cards: boolean; why: string }[] = [
  { builtOn: "2026-10-09", expect: /予告先発はまだ発表されていません。次の試合は2026年10月10日です/, cards: false, why: "정규 끝 다음 날 — 발표 전" },
  { builtOn: "2026-10-11", expect: /2026年10月11日（本日）/, cards: true, why: "CS 2차전 당일 — 발표됐다" },
  { builtOn: "2026-10-13", expect: /予告先発はまだ発表されていません。次の試合は2026年10月14日です/, cards: false, why: "끝난 10/12 를 「次」라고 불렀다" },
  { builtOn: "2026-10-18", expect: /2026年10月18日の予告先発は発表されましたが、試合は行われませんでした/, cards: false, why: "열리지 않은 5차전" },
  { builtOn: "2026-10-19", expect: /次の試合の日程がまだありません（日程を取り込めていない場合もあります）/, cards: false, why: "지난 10/18 을 「次」라고 불렀다" },
  { builtOn: "2026-10-22", expect: /予告先発はまだ発表されていません。次の試合は2026年10月24日です/, cards: false, why: "日本S 전 — 발표 전" },
  { builtOn: "2026-10-24", expect: /2026年10月24日の予告先発を取り込めていません/, cards: false, why: "日本S 1차전 당일인데 예고를 못 받았다" },
];

for (const c of T4) {
  test(`⚠T4 次の予告先発 — ${c.builtOn} 빌드: ${c.why}`, () => {
    const fx = stateAt(c.builtOn);
    try {
      const block = nextBlock(site(fx, c.builtOn));
      assert.match(text(block), c.expect);
      assert.equal(/class="pbcard/.test(block), c.cards, c.cards ? "발표된 예고 카드가 없다" : "열리지 않았거나 지난 날의 예고 카드를 「次」로 냈다");
    } finally {
      fx.close();
    }
  });
}

test("⚠T4⑧ 예고 표가 비었는데 오늘 경기가 있으면 「取り込めていません」 — 「発表待ち」로 덮지 않는다", () => {
  const fx = new Fixture();
  try {
    fx.batch(() => {
      regularSeason(fx, { first: "2026-08-01", days: 10 });
      fx.upcoming("2026-08-11", "t", "g", { venue: "甲子園" });
    });
    const files = site(fx, "2026-08-11");
    assert.match(text(nextBlock(files)), /2026年8月11日の予告先発を取り込めていません/);
    // ⚠감시의 측정 범위는 안 바꾼다(설계 §9) — 예고 기록이 하나도 없으면 감시는 이 축을 재지 않는다
    const v = collectionVerdict(collectionEvidence(fx.db, "2026-08-11"), { grace: 2, backstopMargin: 0 });
    assert.ok(!v.reasons.includes("starters-behind"), "감시의 측정 범위가 바뀌었다");
  } finally {
    fx.close();
  }
});

test("⚠T4⑨ 정상인 전날 — 「発表待ち」에 다음 경기일을 적는다", () => {
  const fx = new Fixture();
  try {
    fx.batch(() => {
      regularSeason(fx, { first: "2026-08-01", days: 10 }); // 8/10 까지
      fx.probable("2026-08-10", "t", "g", "2026-08-09T09:00:00.000Z");
      fx.upcoming("2026-08-12", "t", "g", { venue: "甲子園" }); // 8/11 은 휴식
    });
    const files = site(fx, "2026-08-11");
    assert.match(text(nextBlock(files)), /予告先発はまだ発表されていません。次の試合は2026年8月12日です（発表は前日〜当日）/);
  } finally {
    fx.close();
  }
});

/**
 * ⚠**설계와 다르게 한 점을 고정한다**(보고 「다르게 한 것」 ①). 설계 D5 의 `N` 은 감시의 다음 경기일(`B` 이상)인데,
 * 그대로 ⑥ 의 문구에 쓰면 **저녁 빌드**(오늘 경기가 이미 기록에 들어온 뒤)에서 「次の試合は（오늘）」이라고 말한다 —
 * 바로 아래 결과 구획이 그 날의 결과를 싣고 있는데. 한 화면이 같은 날을 예정이자 종료로 선언하는 결함(2026-08-18 감사 P1)과 같은 모양이다.
 * → ⑥ 의 다음 경기일은 `max(B, L+1)` 이후의 가장 가까운 날(같은 질의 `nextGameDayOf`). ⑤ 는 감시의 날짜 그대로다.
 */
test("⚠T4+ 저녁 빌드 — 오늘 경기가 이미 기록에 있으면 「次の試合」는 그 다음 날이다(오늘을 「次」라고 부르지 않는다)", () => {
  const fx = new Fixture();
  try {
    fx.batch(() => {
      regularSeason(fx, { first: "2026-08-01", days: 12 }); // 8/12 까지 — 오늘(8/12) 경기도 이미 받았다
      fx.probable("2026-08-12", "t", "g", "2026-08-11T09:00:00.000Z");
      fx.upcoming("2026-08-13", "t", "g", { venue: "甲子園" });
    });
    const block = text(nextBlock(site(fx, "2026-08-12")));
    assert.match(block, /次の試合は2026年8月13日です/);
    assert.ok(!/次の試合は2026年8月12日/.test(block), "결과가 실린 오늘을 「次の試合」라고 불렀다");
  } finally {
    fx.close();
  }
});

test("⚠T4⑩ 다음 경기일을 모르면 「取り込めていない場合も」 — 정상 문구로 덮지 않는다", () => {
  const fx = new Fixture();
  try {
    fx.batch(() => {
      regularSeason(fx, { first: "2026-08-01", days: 10 });
      fx.probable("2026-08-10", "t", "g", "2026-08-09T09:00:00.000Z");
    });
    const block = text(nextBlock(site(fx, "2026-08-11")));
    assert.match(block, /次の試合の日程がまだありません（日程を取り込めていない場合もあります）/);
    assert.ok(!/予告先発はまだ発表されていません/.test(block), "모르는 것을 「아직 발표 전」이라는 정상 문구로 덮었다");
  } finally {
    fx.close();
  }
});

test("⚠T4⑪ 예고 보존 전의 과거 시즌 — 「保存は2026年から」 · 「今シーズンから」는 어디에도 없다", () => {
  const fx = new Fixture();
  try {
    fx.batch(() => {
      regularSeason(fx, { first: "2025-08-01", days: 5 });
      regularSeason(fx, { first: "2026-08-01", days: 5 });
      fx.probable("2026-08-16", "t", "g", "2026-08-15T09:00:00.000Z");
    });
    const files = build(
      [{ data: fx.load(2026, "2026-08-17"), season: 2026 }, { data: fx.load(2025, "2026-08-17"), season: 2025 }],
      "2026-08-17",
      fx.collection("2026-08-17"),
    );
    assert.match(text(section(page(files, "2025/today.html"), "b-probable")), /この年の予告先発は記録していません（保存は2026年から）/);
    for (const [path, html] of files) {
      assert.ok(!html.includes("今シーズンから"), `${path} 에 「今シーズンから」가 남았다 — 2027년에 거짓이 되는 문장이다`);
    }
  } finally {
    fx.close();
  }
});

/* ── T5 철회 술어 ────────────────────────────────────────────────────────── */

const P = "2026-08-12";
/** 예고 ① 늦은 공표 ② 이른 공표 ③ 한쪽 시각 NULL ④ 공표 없음 ⑤ 행마다 다름 */
const T5: readonly { name: string; home: string | null; away: string | null; restAt: string | null | undefined; screen: RegExp; withdrawn: boolean }[] = [
  { name: "① 늦은 공표", home: "2026-08-11T09:00:00.000Z", away: "2026-08-11T09:00:00.000Z", restAt: "2026-08-11T11:00:00.000Z", screen: /行われませんでした/, withdrawn: true },
  { name: "② 이른 공표", home: "2026-08-11T09:00:00.000Z", away: "2026-08-11T09:00:00.000Z", restAt: "2026-08-11T07:00:00.000Z", screen: /^(?![\s\S]*行われませんでした)(?![\s\S]*確認できません)/, withdrawn: false },
  { name: "③ 한쪽 시각 NULL", home: "2026-08-11T09:00:00.000Z", away: "2026-08-11T09:00:00.000Z", restAt: null, screen: /有効か確認できません（取得時刻が記録されていない行があります）/, withdrawn: false },
  { name: "④ 공표 없음", home: "2026-08-11T09:00:00.000Z", away: "2026-08-11T09:00:00.000Z", restAt: undefined, screen: /^(?![\s\S]*行われませんでした)(?![\s\S]*確認できません)/, withdrawn: false },
  { name: "⑤ 행마다 다름", home: "2026-08-11T09:00:00.000Z", away: "2026-08-11T12:00:00.000Z", restAt: "2026-08-11T11:00:00.000Z", screen: /有効か確認できません/, withdrawn: false },
];

for (const c of T5) {
  test(`⚠T5 철회 술어 ${c.name} — 화면은 ①만 「行われませんでした」 · 감시는 ①의 행만 뺀다`, () => {
    const fx = new Fixture();
    try {
      fx.batch(() => {
        regularSeason(fx, { first: "2026-08-01", days: 11 }); // 8/11 까지 — 8/12 경기 행은 없다
        fx.probable(P, "t", "g", c.home, c.away);
        if (c.restAt !== undefined) fx.rest("2026-08-11", P, c.restAt);
      });
      const files = site(fx, P);
      const starters = text(page(files, "starters.html"));
      const today = text(nextBlock(files));
      if (c.withdrawn) {
        // 생성일이 그 예고일이라 「（本日）」이 붙는다 — 날짜 표기는 지금 그대로다
        assert.match(starters, /2026年8月12日(?:（本日）)?の試合 — 行われませんでした/, "予告先発 화면이 철회를 말하지 않는다");
        assert.match(today, /2026年8月12日の予告先発は発表されましたが、試合は行われませんでした/);
      } else {
        assert.match(starters, c.screen, `予告先発 화면: ${c.name}`);
        assert.match(today, c.screen, `次の予告先発: ${c.name}`);
        assert.ok(!/行われませんでした/.test(starters + today), "철회가 아닌데 「行われませんでした」라고 했다 — 극성이 뒤집혔다");
      }
      // ⚠카드는 남긴다 — 발표된 사실이다(설계 D6)
      assert.match(page(files, "starters.html"), /class="card"/, "予告先発 화면이 발표된 카드를 지웠다");
      // 감시 — 다음 날 판정에서 B 후보(예고됐는데 경기 행 없음 · 사본 낡음)
      const missed = collectionEvidence(fx.db, "2026-08-13").announcedWithoutGame.filter((m) => m.date === P);
      assert.equal(missed.length, c.withdrawn ? 0 : c.name.startsWith("⑤") ? 1 : 2, `감시: ${c.name}`);
    } finally {
      fx.close();
    }
  });
}

/* ── T6 予告先発 화면 ───────────────────────────────────────────────────── */

test("⚠T6 予告先発 10/18 화면이 「行われませんでした」라고 말한다 — 카드는 남는다", () => {
  const fx = stateAt("2026-10-25");
  try {
    const files = site(fx, "2026-10-25");
    const html = files.get("starters/2026-10-18.html") ?? page(files, "starters.html");
    assert.match(text(html), /2026年10月18日の試合 — 行われませんでした/);
    assert.match(html, /class="card"/, "발표된 사실인데 카드를 지웠다");
  } finally {
    fx.close();
  }
});

/* ── T7 日本シリーズ ─────────────────────────────────────────────────────── */

/** 2018 의 모양 — 소프트뱅크(h) 4勝1敗1分(1차전 무승부) · 상대는 DeNA 로 바꿔 2026 에 얹는다 */
const JS_2018: readonly GameSpec[] = [
  { date: "2026-10-24", home: "db", away: "h", homeRuns: 2, awayRuns: 2, gameNo: 1 },
  { date: "2026-10-25", home: "db", away: "h", homeRuns: 5, awayRuns: 1, gameNo: 2 },
  { date: "2026-10-27", home: "h", away: "db", homeRuns: 9, awayRuns: 8, gameNo: 3 },
  { date: "2026-10-28", home: "h", away: "db", homeRuns: 4, awayRuns: 1, gameNo: 4 },
  { date: "2026-10-29", home: "h", away: "db", homeRuns: 5, awayRuns: 4, gameNo: 5 },
  { date: "2026-10-31", home: "db", away: "h", homeRuns: 0, awayRuns: 2, gameNo: 6 },
].map((g) => ({ ...g, competition: "nipponSeries" as const, series: "SMBC日本シリーズ", venue: g.home === "db" ? "横浜" : "みずほPayPay" }));

/** 10/22 까지의 2026(정규 143 + CS 12) 위에 日本シリーズ 경기를 얹는다 — 일정 사본은 비운다 */
function withJs(games: readonly GameSpec[]): Fixture {
  const fx = stateAt("2026-10-22");
  fx.batch(() => {
    fx.db.raw.exec("DELETE FROM upcoming_game");
    for (const g of games) fx.game(g);
  });
  return fx;
}

test("⚠T7 日本シリーズ 결착 카드 — 「ソフトバンクが4勝1敗1分で日本一」 · 次の予告先発은 시즌 종료", () => {
  const fx = withJs(JS_2018);
  try {
    const files = site(fx, "2026-11-01");
    const today = page(files, "today.html");
    assert.match(text(section(today, "b-results")), /日本シリーズ 第6戦/);
    assert.match(text(section(today, "b-results")), /ソフトバンクが4勝1敗1分で日本一/);
    assert.match(text(nextBlock(files)), /このシーズンの試合は終わりました/, "결착 뒤에도 다음 예고를 기다린다");
    // 3차전 카드 — 그 경기까지의 성적
    const g3 = text(section(page(files, "days/2026-10-27.html"), "b-results"));
    assert.match(g3, /日本シリーズ 第3戦/);
    assert.match(g3, /対戦成績 1勝1敗1分/, "3차전까지의 시리즈 성적이 아니다(동률이면 구단명 없이)");
    assert.ok(!/SMBC/.test(text(today)), "후원사 이름이 화면 표기에 나왔다 — 원문은 series 에 남는다");
  } finally {
    fx.close();
  }
});

test("⚠T7 중지는 세지 않는다(2024 모양) · 진행 중이면 앞선 구단을 말한다", () => {
  const games: GameSpec[] = ([
    { date: "2026-10-24", home: "db", away: "h", homeRuns: 1, awayRuns: 3, gameNo: 1 },
    { date: "2026-10-25", home: "db", away: "h", homeRuns: 2, awayRuns: 6, gameNo: 2 },
    { date: "2026-10-27", home: "h", away: "db", status: "notPlayed", gameNo: 3 },
    { date: "2026-10-28", home: "h", away: "db", homeRuns: 1, awayRuns: 4, gameNo: 3, idSuffix: "b" },
  ] as GameSpec[]).map((g) => ({ ...g, competition: "nipponSeries" as const, series: "SMBC日本シリーズ" }));
  const fx = withJs(games);
  try {
    const files = site(fx, "2026-10-29");
    const results = text(section(page(files, "today.html"), "b-results"));
    assert.match(results, /対戦成績 ソフトバンク 2勝1敗/, "중지 경기를 세었거나 앞선 구단을 말하지 않는다");
    const cancelled = text(section(page(files, "days/2026-10-27.html"), "b-results"));
    assert.match(cancelled, /日本シリーズ 第3戦/);
    assert.match(cancelled, /中止/);
  } finally {
    fx.close();
  }
});

test("⚠T7 알려진 4승 + 무승부 + 중지 + 득점 NULL — 결착은 서고 카드는 「確認できません」 · 시즌 종료", () => {
  const games: GameSpec[] = ([
    { date: "2026-10-24", home: "db", away: "h", homeRuns: 2, awayRuns: 2, gameNo: 1 },
    { date: "2026-10-25", home: "db", away: "h", homeRuns: 1, awayRuns: 5, gameNo: 2 },
    { date: "2026-10-27", home: "h", away: "db", status: "notPlayed", gameNo: 3 },
    { date: "2026-10-28", home: "h", away: "db", homeRuns: 4, awayRuns: 3, gameNo: 3, idSuffix: "b" },
    { date: "2026-10-29", home: "h", away: "db", homeRuns: 6, awayRuns: 0, gameNo: 4 },
    { date: "2026-10-31", home: "db", away: "h", homeRuns: 1, awayRuns: 7, gameNo: 5 },
    // 득점을 못 읽은 경기 — 결과를 모른다(M11)
    { date: "2026-11-01", home: "db", away: "h", homeRuns: null, awayRuns: null, gameNo: 6 },
  ] as GameSpec[]).map((g) => ({ ...g, competition: "nipponSeries" as const, series: "SMBC日本シリーズ" }));
  const fx = withJs(games);
  try {
    assert.equal(japanSeriesDecided(fx.db, 2026), true, "알려진 4승인데 결착이 안 섰다");
    const files = site(fx, "2026-11-02");
    const results = text(section(page(files, "today.html"), "b-results"));
    assert.match(results, /ソフトバンクが日本一（対戦成績は確認できません）/, "결측이 있는데 성적을 말했거나 결착을 숨겼다");
    // ⚠득점을 못 읽은 경기에 「引き分け」를 달지 않는다(M11) — 모르는 결과를 무승부로 단정한다
    assert.ok(!results.includes("引き分け"), "득점을 모르는 경기를 무승부라고 했다");
    assert.match(text(nextBlock(files)), /このシーズンの試合は終わりました/);
  } finally {
    fx.close();
  }
});

/* ── T8 CS 는 시리즈 성적을 내지 않는다 ───────────────────────────────────── */

test("⚠T8 CS 카드에 시리즈 성적이 없고 각주가 사유를 말한다", () => {
  const fx = stateAt("2026-10-24");
  try {
    const results = section(page(site(fx, "2026-10-24"), "today.html"), "b-results");
    const cards = [...results.matchAll(/<article class="gcard[\s\S]*?<\/article>/g)].map((m) => text(m[0]));
    assert.ok(cards.length > 0, "CS 카드가 없다 — 이 시험이 공회전한다");
    for (const c of cards) {
      assert.ok(!/対戦成績|[0-9]勝[0-9]敗/.test(c), `CS 카드에 시리즈 성적을 냈다(어드밴티지 1승이 데이터에 없다): ${c}`);
    }
    assert.match(text(results), /クライマックスシリーズの勝敗数は出していません/);
    assert.match(text(results), /アドバンテージ（1勝）/);
  } finally {
    fx.close();
  }
});

/* ── T9 구단 「次の試合」 ─────────────────────────────────────────────────── */

/** 구단 화면의 「次の試合」 한 줄 */
function nextGame(files: Map<string, string>, code: string): string {
  const m = /<s>次の試合<\/s><b>([\s\S]*?)<\/b>/.exec(page(files, `teams/${code}.html`));
  assert.ok(m !== null, `teams/${code}.html 에 「次の試合」 줄이 없다`);
  return text(m[1]!);
}

function regularDone(o: { skipLast?: readonly string[] } = {}): Fixture {
  const fx = new Fixture();
  fx.batch(() => regularSeason(fx, { first: FIRST, days: 143, ...o }));
  return fx;
}

test("⚠T9⑴ 12구단 정규 소진 + 정규 뒤 · 다른 리그 슬롯 → 「— 日本シリーズ」", () => {
  const fx = regularDone();
  try {
    fx.batch(() => { for (const u of JS_UPCOMING) fx.upcoming(u.date, u.home, u.away, { venue: u.venue, startTime: u.time }); });
    const files = site(fx, "2026-10-22");
    assert.equal(nextGame(files, "h"), "2026年10月24日 18:30 ＠DeNA（横浜） — 日本シリーズ");
    assert.equal(nextGame(files, "db"), "2026年10月24日 18:30 対ソフトバンク（横浜） — 日本シリーズ");
    assert.equal(nextGame(files, "t"), "レギュラーシーズンの全日程を終えました", "일정을 받아 두었는데 「取り込んでいない場合も」라고 했다");
    // 구단 목록도 같은 함수다(M1)
    assert.match(text(page(files, "teams.html")), /2026年10月24日 18:30 ＠DeNA（横浜） — 日本シリーズ/);
  } finally {
    fx.close();
  }
});

test("⚠T9⑵ 같은 리그 슬롯(CS)은 日本S 로 부르지 않는다 → 「全日程を終えました」", () => {
  const fx = regularDone();
  try {
    fx.batch(() => fx.upcoming("2026-10-14", "t", "db", { venue: "甲子園" }));
    const files = site(fx, "2026-10-13");
    assert.equal(nextGame(files, "t"), "レギュラーシーズンの全日程を終えました");
    assert.equal(nextGame(files, "db"), "レギュラーシーズンの全日程を終えました");
  } finally {
    fx.close();
  }
});

test("⚠T9⑶ 시즌이 끝났으면 남은 日本S 슬롯보다 「終了」가 먼저다", () => {
  const fx = withJs(JS_2018.slice(0, 5).map((g, i) => (i === 0 ? { ...g, homeRuns: 1, awayRuns: 3 } : g)));
  try {
    // 4승 결착(h) 뒤에도 일정 사본에 열리지 않을 6·7차전이 남아 있다(2025-11 사본의 실측 모양)
    fx.batch(() => {
      fx.upcoming("2026-10-31", "db", "h", { venue: "横浜" });
      fx.upcoming("2026-11-01", "db", "h", { venue: "横浜" });
    });
    assert.equal(japanSeriesDecided(fx.db, 2026), true);
    const files = site(fx, "2026-10-30");
    assert.equal(nextGame(files, "h"), "このシーズンは終了しています");
    assert.equal(nextGame(files, "db"), "このシーズンは終了しています");
    // ⚠**데이터 층도 막는다** — 「次の試合」이 없으니 予告先発 줄도 「発表待ち」가 아니라 「—」다(두 줄이 서로 다른 말을 하지 않게)
    const probableLine = (code: string): string =>
      text(/<s>予告先発<\/s><b>([\s\S]*?)<\/b>/.exec(page(files, `teams/${code}.html`))?.[1] ?? "(없음)");
    assert.equal(probableLine("h"), "—", "끝난 시즌에 열리지 않을 日本S 경기의 선발을 기다린다고 했다");
    assert.equal(probableLine("db"), "—");
  } finally {
    fx.close();
  }
});

test("⚠T9⑷ 정규가 남은 구단이 있으면 日本S 로 부르지 않는다", () => {
  const fx = regularDone({ skipLast: ["g"] }); // 巨人·阪神 142
  try {
    fx.batch(() => { for (const u of JS_UPCOMING) fx.upcoming(u.date, u.home, u.away, { venue: u.venue, startTime: u.time }); });
    const files = site(fx, "2026-10-22");
    assert.ok(!nextGame(files, "h").includes("日本シリーズ"), "12구단 소진이 아닌데 日本S 로 불렀다");
    assert.equal(nextGame(files, "h"), "レギュラーシーズンの全日程を終えました");
    assert.equal(nextGame(files, "g"), "予定はありません（日程をまだ取り込んでいない場合もあります）", "정말 모르는 경우를 다른 말로 덮었다");
  } finally {
    fx.close();
  }
});

test("⚠T9⑸ 정규 마지막 날 이전 날짜의 다른 리그 슬롯은 日本S 로 부르지 않는다", () => {
  const fx = regularDone();
  try {
    fx.batch(() => fx.upcoming("2026-10-06", "db", "h", { venue: "横浜" }));
    const files = site(fx, "2026-10-05");
    assert.ok(!nextGame(files, "h").includes("日本シリーズ"), "정규 날짜 범위 안의 슬롯을 日本S 로 불렀다(교류전 재편성일 수 있다)");
  } finally {
    fx.close();
  }
});

test("⚠T9⑹ 같은 날 두 행의 삽입 순서가 달라도 컷과 「次の試合」가 같다 — seq 로 정렬한 뒤 자른다", () => {
  const make = (flip: boolean): Fixture => {
    const fx = new Fixture();
    fx.batch(() => {
      regularSeason(fx, { first: FIRST, days: 141 }); // 141 — 두 경기 남았다
      // ⚠관련 구단 전부의 「次」는 10/07 이다 — 경계의 두 행(10/08)이 누구의 「次」도 아니어야
      //   더블헤더 가드(T13 · 예고를 붙이는 날)와 부딪히지 않고 **컷만** 잴 수 있다
      fx.upcoming("2026-10-07", "t", "g", { seq: 0, venue: "甲子園" });
      fx.upcoming("2026-10-07", "c", "db", { seq: 1, venue: "マツダ" });
      fx.upcoming("2026-10-07", "s", "d", { seq: 2, venue: "神宮" });
      const rows: [string, number][] = [["c", 0], ["s", 1]];
      for (const [opp, seq] of flip ? [...rows].reverse() : rows) fx.upcoming("2026-10-08", "t", opp, { seq, venue: "甲子園" });
    });
    return fx;
  };
  const a = make(false);
  const b = make(true);
  try {
    const fa = site(a, "2026-10-06");
    const fb = site(b, "2026-10-06");
    const cal = (f: Map<string, string>) => section(page(f, "teams/t.html"), "b-teamcal");
    assert.equal(cal(fb), cal(fa), "삽입 순서에 따라 컷이 달라졌다 — 같은 날 두 행의 순서를 SQLite 에 맡겼다");
    assert.match(text(cal(fa)), /広島/, "seq 0 의 행(広島)이 컷 안에 남아야 한다");
    assert.equal(nextGame(fb, "t"), nextGame(fa, "t"));
  } finally {
    a.close();
    b.close();
  }
});

/* ── T10 표기 ────────────────────────────────────────────────────────────── */

test("⚠T10 2020 단일 스테이지 — 「パ・リーグ クライマックスシリーズ 第2戦」", () => {
  const fx = new Fixture();
  try {
    fx.batch(() => {
      regularSeason(fx, { first: "2020-10-20", days: 10 });
      for (const [date, no] of [["2020-11-14", 1], ["2020-11-15", 2]] as const) {
        fx.game({ date, home: "h", away: "m", competition: "climaxSeries", series: "クライマックスシリーズ", gameNo: no, venue: "PayPayドーム" });
      }
    });
    const files = build([{ data: fx.load(2020, "2020-11-16"), season: 2020 }], "2020-11-16", fx.collection("2020-11-16"));
    assert.match(text(section(page(files, "today.html"), "b-results")), /パ・リーグ クライマックスシリーズ 第2戦/);
  } finally {
    fx.close();
  }
});

test("⚠T10 정규와 CS 가 같은 날(2018-10-13 모양) — 정규 → CS(セ→パ) 순서 · 부제가 둘을 가른다", () => {
  const fx = new Fixture();
  try {
    fx.batch(() => {
      regularSeason(fx, { first: "2026-09-20", days: 23 }); // 10/12 까지
      // ⚠**`game_id` 순서가 정답과 어긋나게 둔다** — パ CS(b-l) < セ CS(c-db) < 정규(d-t · m-e).
      //   id 순서가 우연히 정답이면 「정규 → CS」·「セ → パ」를 지우는 변이가 살아남는다(실물 2018-10-13 은 d-t·h-f·m-e·s-g)
      fx.game({ date: "2026-10-13", home: "b", away: "l", competition: "climaxSeries", series: "CS ファーストステージ", gameNo: 1 });
      fx.game({ date: "2026-10-13", home: "c", away: "db", competition: "climaxSeries", series: "CS ファーストステージ", gameNo: 1 });
      fx.game({ date: "2026-10-13", home: "d", away: "t", gameNo: 25, series: "セ・リーグ公式戦", idSuffix: "x" });
      fx.game({ date: "2026-10-13", home: "m", away: "e", gameNo: 25, series: "パ・リーグ公式戦", idSuffix: "x" });
    });
    const today = page(site(fx, "2026-10-14"), "today.html");
    const results = section(today, "b-results");
    const at = (needle: string): number => {
      const i = results.indexOf(needle);
      assert.ok(i >= 0, `${needle} 가 없다`);
      return i;
    };
    const order = [at("teams/d.html"), at("teams/m.html"), at("セ・リーグ CS ファーストステージ 第1戦"), at("パ・リーグ CS ファーストステージ 第1戦")];
    assert.deepEqual([...order].sort((x, y) => x - y), order, "한 날 안의 순서가 정규 → CS(セ→パ)가 아니다");
    assert.match(text(today), /2026年10月13日の結果 · 4試合（うちクライマックスシリーズ 2）/);
  } finally {
    fx.close();
  }
});

test("⚠T10 CS 중지 카드 — 대회 표기 + 「中止」", () => {
  const fx = new Fixture();
  try {
    fx.batch(() => {
      regularSeason(fx, { first: "2019-09-20", days: 10 });
      fx.game({ date: "2019-10-12", home: "g", away: "t", competition: "climaxSeries", series: "CS ファイナルステージ", gameNo: 4, status: "notPlayed", reason: "中止" });
      fx.game({ date: "2019-10-12", home: "l", away: "h", competition: "climaxSeries", series: "CS ファイナルステージ", gameNo: 4, status: "notPlayed", reason: "中止" });
    });
    const files = build([{ data: fx.load(2019, "2019-10-13"), season: 2019 }], "2019-10-13", fx.collection("2019-10-13"));
    const results = section(page(files, "today.html"), "b-results");
    assert.match(results, /gcard off/);
    assert.match(text(results), /セ・リーグ CS ファイナルステージ 第4戦/);
    assert.match(text(results), /パ・リーグ CS ファイナルステージ 第4戦/);
    assert.match(text(results), /中止/);
  } finally {
    fx.close();
  }
});

test("T10 他大会 CS 스테이지 제목은 바이트까지 그대로다(보호)", () => {
  const fx = stateAt("2026-10-24");
  try {
    const post = page(site(fx, "2026-10-24"), "postseason.html");
    for (const t of ["セ・リーグ CS ファーストステージ", "パ・リーグ CS ファーストステージ", "セ・リーグ CS ファイナルステージ", "パ・リーグ CS ファイナルステージ"]) {
      assert.ok(post.includes(`<h3 class="standname">${t}</h3>`), `他大会의 스테이지 제목 「${t}」가 바뀌었다`);
    }
  } finally {
    fx.close();
  }
});

/* ── T11 날짜 일람 ───────────────────────────────────────────────────────── */

test("⚠T11 날짜 일람 — CS 날에 「CS」 · 日本S 날에 「日本S」 · 머리에 「うちポストシーズン」", () => {
  const fx = withJs(JS_2018.slice(0, 2));
  try {
    const days = page(site(fx, "2026-10-26"), "days.html");
    const cell = (iso: string): string => {
      const m = new RegExp(`<a class="dayc[^"]*"\\s+href="[^"]*${iso === "2026-10-25" ? "today" : `days/${iso}`}\\.html">([\\s\\S]*?)</a>`).exec(days);
      assert.ok(m !== null, `${iso} 칸이 없다`);
      return text(m[1]!);
    };
    assert.match(cell("2026-10-17"), /CS/);
    assert.match(cell("2026-10-25"), /日本S/);
    assert.ok(!/CS|日本S/.test(cell("2026-10-08")), "정규 날에 대회 표기를 붙였다");
    assert.match(text(days), /試合（うちポストシーズン 14）/, "머리가 포스트시즌을 따로 세지 않는다(CS 12 + 日本S 2)");
  } finally {
    fx.close();
  }
});

/* ── T12 홈 ──────────────────────────────────────────────────────────────── */

test("⚠T12 홈 直近の結果 — 대회 표기 · 「レギュラーシーズンは…まで」 · 끝난 시즌 부제", () => {
  const fx = withJs(JS_2018);
  try {
    const home = page(site(fx, "2026-11-01"), "index.html");
    const latest = text(section(home, "b-hlatest"));
    assert.match(latest, /2026年10月31日の結果/);
    assert.match(latest, /日本シリーズ 第6戦/);
    assert.match(latest, /ソフトバンクが4勝1敗1分で日本一/);
    // ⚠**띠가 아니라 머리(`.idline .asof`)를 본다** — 띠는 이미 같은 한정어를 말하고 있어서 페이지 전체로 재면 공회전한다
    const head = /<header class="idline">[\s\S]*?<\/header>/.exec(home)?.[0] ?? "";
    assert.match(head, /<span class="asof">レギュラーシーズンは 2026年10月8日 まで<\/span>/, "직근 결과가 포스트시즌인데 머리의 기준일이 정규라는 것을 말하지 않는다");
    assert.match(text(head), /シーズンの結果を一枚で/);
  } finally {
    fx.close();
  }
});

test("⚠T12 홈 — 정규만인 날은 머리가 지금 그대로다(「…まで」)", () => {
  const fx = regularDone();
  try {
    const home = page(site(fx, "2026-10-09"), "index.html");
    assert.match(home, /<span class="asof">2026年10月8日まで<\/span>/);
    assert.match(home, /リーグの今を一枚で/);
  } finally {
    fx.close();
  }
});

for (const shape of ["전 경기 중지", "경기·중지 혼재"] as const) {
  test(`⚠T12 최신일이 ${shape} — 홈과 試合 화면의 같은 행이 같은 상태 문구 · 「—-—」 없음`, () => {
    const fx = new Fixture();
    try {
      fx.batch(() => {
        regularSeason(fx, { first: "2026-08-01", days: 10 });
        fx.game({ date: "2026-08-11", home: "t", away: "g", status: "notPlayed", reason: "中止" });
        if (shape === "경기·중지 혼재") fx.game({ date: "2026-08-11", home: "h", away: "f" });
      });
      const files = site(fx, "2026-08-12");
      const homeLatest = section(page(files, "index.html"), "b-hlatest");
      const todayCards = section(page(files, "today.html"), "b-results");
      assert.ok(!/—<s>-<\/s>—/.test(homeLatest), "중지 경기를 「—-—」(득점 모름)으로 그렸다");
      const homeRow = /<li>(?:(?!<\/li>)[\s\S])*?阪神(?:(?!<\/li>)[\s\S])*<\/li>/.exec(homeLatest)?.[0] ?? "";
      assert.match(text(homeRow), /中止/, "홈의 중지 행이 「中止」라고 말하지 않는다");
      assert.match(text(todayCards), /中止/);
    } finally {
      fx.close();
    }
  });
}

/* ── D11 비시즌 ──────────────────────────────────────────────────────────── */

/**
 * ⚠**비시즌(11월~개막)에는 최신 시즌의 최종 상태를 보인다**(설계 D11) — 다음 시즌 이야기를 하지 않는다.
 * 생성일을 12월로 **주입한다**(M6) — 띠 「終了」 · 試合 = 日本S 결착 경기 · 次の予告先発 = ① · 구단 = D7-1 · 홈 = 과거형 부제.
 */
test("⚠D11 비시즌(12/01 생성) — 띠 「終了」 · 試合는 日本一 · 次の予告先発 ① · 구단 「終了」 · 홈 과거형", () => {
  const fx = withJs(JS_2018);
  try {
    const files = site(fx, "2026-12-01");
    const today = page(files, "today.html");
    assert.match(text(today), /終了したシーズンです — 最後の試合は 2026年10月31日（レギュラーシーズンは 2026年10月8日 まで）/);
    assert.match(text(section(today, "b-results")), /2026年10月31日の結果[\s\S]*ソフトバンクが4勝1敗1分で日本一/);
    assert.match(text(nextBlock(files)), /このシーズンの試合は終わりました/);
    assert.equal(nextGame(files, "h"), "このシーズンは終了しています");
    assert.equal(nextGame(files, "t"), "このシーズンは終了しています");
    const home = page(files, "index.html");
    assert.match(home, /<span class="sub">シーズンの結果を一枚で<\/span>/);
    assert.match(home, /<span class="asof">レギュラーシーズンは 2026年10月8日 まで<\/span>/);
    assert.ok(!/2027/.test(text(today)), "비시즌에 다음 시즌 이야기를 했다");
  } finally {
    fx.close();
  }
});

/* ── T13 더블헤더 ────────────────────────────────────────────────────────── */

test("⚠T13 예고를 붙이는 날에 같은 팀의 경기가 둘이면 빌드가 멈춘다(M7) — 한 경기로 접지 않는다", () => {
  for (const where of ["upcoming", "game"] as const) {
    const fx = new Fixture();
    try {
      fx.batch(() => {
        regularSeason(fx, { first: "2026-08-01", days: 10 });
        fx.probable("2026-08-11", "t", "g", "2026-08-10T09:00:00.000Z");
        if (where === "upcoming") {
          fx.upcoming("2026-08-11", "t", "g", { seq: 0, venue: "甲子園" });
          fx.upcoming("2026-08-11", "t", "g", { seq: 1, venue: "甲子園" });
        } else {
          fx.game({ date: "2026-08-11", home: "t", away: "g", gameNo: 20, idSuffix: "a" });
          fx.game({ date: "2026-08-11", home: "t", away: "g", gameNo: 21, idSuffix: "b" });
        }
      });
      assert.throws(() => fx.load(2026, "2026-08-11"), /더블헤더|같은 날/, `${where}: 같은 팀 같은 날 두 경기를 조용히 한 경기로 접었다`);
    } finally {
      fx.close();
    }
  }
});
