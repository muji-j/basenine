/**
 * **NPB 공식 타이틀이 순위 화면에 다 있는가** — 실데이터로.
 *
 * ⚠**두 개가 빠져 있었다**(2026-08-20 배포물 실측):
 * · **最多安打** — 타자 순위 11부문 어디에도 없었다. `dist/ranking.html` 에서 「安打」 출현 **0회**.
 *   값은 `BattingEntry.player.line.h` 로 계속 계산돼 있었고 **부르는 곳만 없었다.**
 * · **最高勝率** — 개인 순위가 없었다. 같은 파일의 「勝率」 4회는 **전부 팀 순위표의 각주**다.
 *
 * ⚠**이 저장소는 같은 일을 이미 겪었다** — `打順一巡` 이 「집계와 시험은 있는데 화면 호출부가 0곳」이었다.
 * 그래서 여기서 묻는 것은 계산이 아니라 **화면까지 왔는가**이고, 값은 DB 에서 따로 세서 대본다.
 *
 * ⚠**DB 가 없으면 건너뛴다.** CI 는 `BB_REQUIRE_DB=1` 로 막는다(작업규칙 7·8).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { openDb, seasonIsOver } from "@bb-app/store";
import type { Db } from "@bb-app/store";
import { canonicalTeamCode, leagueOf } from "@bb-app/domain";
import type { League } from "@bb-app/domain";
import { loadSite } from "../src/query.ts";
import { rootSeason } from "../src/newest-season.ts";
import type { SiteData } from "../src/query.ts";
import type { RankingCategory } from "../src/pages.ts";
import { metricRank } from "../src/metric-order.ts";
import { denUnit } from "../src/glossary.ts";

const DB = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "data", "bb.sqlite");
const HAS_DB = existsSync(DB);
if (process.env["BB_REQUIRE_DB"] === "1" && !HAS_DB) {
  throw new Error(`BB_REQUIRE_DB=1 인데 ${DB} 가 없다`);
}

interface SeasonData {
  season: number;
  site: SiteData;
  /** 리그별 최다 안타. **화면 밖에서 따로 센 값**이다 */
  topHits: Map<League, number>;
  /** `선수|리그` 의 승·패. 승률의 분모를 바깥 근거로 대본다 */
  decisions: Map<string, { w: number; l: number; games: number }>;
}

interface Loaded extends SeasonData {
  /**
   * **가장 최근 끝난 시즌**(`seasonIsOver`) — 루트가 끝난 시즌이면 루트 그 자체다.
   * ⚠**공회전 하한(勝率 행 · 「분모 ≠ 등판」 행)은 여기서 잰다**(2026-10-25 · PR-4 마지막 재검토 N2) — 루트가 개막 2~7경기일째인
   *   새 시즌이면 勝率 행이 18~54 · 「분모 ≠ 등판」이 0~4 라(노디시전 1등판 선발은 행이 없다) 하한이 「시험」을 떨어뜨려 배포를 막았다.
   *   ⚠**하한을 낮추지 않는다** — 그것이 「분모 = 登板数」 회귀를 가르는 그물이다. 루트에서는 같은 단언(분모 · 값)만 한다.
   */
  settled: SeasonData;
}

/** 그 시즌의 바깥 근거(최다 안타 · 승패) — **화면과 따로 센다** */
function measure(db: Db, season: number, site: SiteData): SeasonData {
  const hitRows = db.raw
    .prepare(
      `SELECT (CASE b.side WHEN 'away' THEN g.away_code ELSE g.home_code END) AS code,
              b.player_id AS pid, SUM(b.h) AS h
       FROM batting_line b JOIN game g ON g.game_id = b.game_id
       WHERE g.season = ? AND g.status = 'played' AND g.competition = 'regular'
       GROUP BY pid, code`,
    )
    .all(season) as { code: string; pid: string; h: number }[];
  // ⚠**선수 × 리그로 묶는다** — NPB 의 개인 타이틀은 소속 리그 성적만 센다(`buildLeagues` 와 같은 경계)
  const byPlayerLeague = new Map<string, number>();
  for (const r of hitRows) {
    const key = `${r.pid}|${leagueOf(canonicalTeamCode(r.code))}`;
    byPlayerLeague.set(key, (byPlayerLeague.get(key) ?? 0) + Number(r.h));
  }
  const topHits = new Map<League, number>();
  for (const [key, h] of byPlayerLeague) {
    const league = key.split("|")[1] as League;
    topHits.set(league, Math.max(topHits.get(league) ?? 0, h));
  }

  const decRows = db.raw
    .prepare(
      // ⚠**승패는 박스스코어의 결정 표기(`○ ●`)에서 센다** — 집계와 같은 원천을 쓰되
      //   질의는 따로 짠다. 같은 함수를 부르면 「내 계산이 내 계산과 같다」밖에 증명 못 한다
      `SELECT (CASE p.side WHEN 'away' THEN g.away_code ELSE g.home_code END) AS code,
              p.player_id AS pid,
              SUM(CASE WHEN p.decision = '○' THEN 1 ELSE 0 END) AS w,
              SUM(CASE WHEN p.decision = '●' THEN 1 ELSE 0 END) AS l,
              COUNT(*) AS games
       FROM pitching_line p JOIN game g ON g.game_id = p.game_id
       WHERE g.season = ? AND g.status = 'played' AND g.competition = 'regular'
       GROUP BY pid, code`,
    )
    .all(season) as { code: string; pid: string; w: number; l: number; games: number }[];
  const decisions = new Map<string, { w: number; l: number; games: number }>();
  for (const r of decRows) {
    const key = `${r.pid}|${leagueOf(canonicalTeamCode(r.code))}`;
    const cur = decisions.get(key) ?? { w: 0, l: 0, games: 0 };
    decisions.set(key, { w: cur.w + Number(r.w), l: cur.l + Number(r.l), games: cur.games + Number(r.games) });
  }
  return { season, site, topHits, decisions };
}

/**
 * ⚠**한 번만 읽는다** — `loadSite` 는 비싸다(`ranking-src-srp.test.ts` 와 같은 이유 · ~~실측 약 6초~~ 는 낡았다 —
 *   2026-10-25 로컬 9시즌 DB 에서 이 파일 하나가 45.7~56.9초).
 * ⚠⚠**시즌은 빌드가 사이트 루트에 놓는 시즌이다**(`rootSeason` · 2026-10-25 · PR-4 재검토 F1) — 예전 `MAX(season)` 은
 *   개막 1~2경기일에 빌드가 아직 굽지 않는 새 시즌을 읽다 「표본 0」으로 떨어져 CI 「시험」 단계가 배포를 막았다.
 * ⚠루트가 진행 중이면 **끝난 시즌을 한 번 더 읽는다**(`settled`) — 시즌 중(4~10월)에는 `loadSite` 가 두 번이다
 *   (같은 로컬에서 이 파일 105.7~110.0초 · 대가로 받는다 — 하한을 낮추는 쪽이 싸지만 그물이 사라진다).
 */
let loaded: Loaded | null = null;
function load(): Loaded {
  if (loaded !== null) return loaded;
  const db = openDb(DB, "1970-01-01T00:00:00.000Z");
  try {
    const root = rootSeason(db, (s) => loadSite(db, { season: s, builtOn: "1970-01-01" }));
    const atRoot = measure(db, root.season, root.site);
    // 빌드가 굽는 시즌 중 가장 최근 끝난 것 — `root.seasons` 는 최신부터다
    const settledSeason = root.seasons.find((s) => seasonIsOver(db, s));
    assert.ok(settledSeason !== undefined, `끝난 시즌이 없다(${root.seasons.join("·")}) — 勝率 순위의 공회전 하한을 잴 곳이 없다`);
    const settled =
      settledSeason === root.season
        ? atRoot
        : measure(db, settledSeason, loadSite(db, { season: settledSeason, builtOn: "1970-01-01" }));
    loaded = { ...atRoot, settled };
    return loaded;
  } finally {
    db.close();
  }
}

function categoryOf(site: SiteData, league: string, id: string): RankingCategory {
  const section = site.ranking.leagues.find((l) => l.id === league);
  assert.ok(section !== undefined, `${league} 리그 구획이 없다`);
  const cat = section.categories.find((c) => c.id === id);
  assert.ok(cat !== undefined, `${league}/${id} 부문이 없다`);
  return cat;
}

const LEAGUES = ["central", "pacific"] as const;

test("⚠最多安打 순위가 화면에 있다 — 계산은 있는데 부르는 곳이 없었다", { skip: HAS_DB ? false : "DB 없음" }, () => {
  const { site, topHits, season } = load();
  let checked = 0;
  for (const league of LEAGUES) {
    const cat = categoryOf(site, league, "batter");
    const panel = cat.panels.find((p) => p.id === "h");
    assert.ok(panel !== undefined, `${league}: 安打 순위가 없다 — 부문 ${cat.panels.map((p) => p.id).join("·")}`);
    assert.equal(panel.label, "安打");

    const first = panel.rows[0];
    assert.ok(first !== undefined, `${league}: 安打 순위가 비었다`);
    // ⚠**바깥 근거와 대본다** — 화면이 스스로를 증명하게 두지 않는다
    assert.equal(
      first.value.value,
      topHits.get(league) ?? -1,
      `${league}: 1위의 安打가 DB 최다와 다르다(${season})`,
    );
    /**
     * ⚠**개수 지표에는 자격 기준이 없다**(NPB 공식도 없다). 규정타석을 걸면
     * 「安打 1위」가 화면에서 사라지는 선수가 생긴다.
     */
    assert.equal(first.rank, 1, `${league}: 1위에 순위가 안 붙었다 — 개수에 자격 기준을 걸었다`);
    assert.match(panel.qualifier, /規定打席・規定投球回はかかりません/);
    // 분모는 打席이다(M2) — 값만 있는 순위를 만들지 않는다
    assert.ok(first.value.denominator > 0, `${league}: 安打 순위에 분모가 없다`);
    checked += 1;
  }
  assert.equal(checked, 2, "리그 두 개를 다 못 봤다 — 이 시험이 공회전한다");
});

/**
 * ⚠**분모가 決着数(勝 + 敗)다.** 무승부도 노디시전도 들어가지 않는다(NPB 규칙).
 * ⚠**등판 수를 분모로 쓰면 조용히 틀린다** — 그것이 SRP 가 밟은 함정의 같은 얼굴이다
 * (분모를 붙이는 것만으로는 M2 를 지킨 것이 아니고 **맞는 분모**여야 한다).
 */
/** 한 시즌의 勝率 순위를 바깥 근거와 대본다 — 본 행 수와 「분모 ≠ 등판」 행 수를 돌려준다 */
function checkWinPct({ site, decisions, season }: SeasonData): { rowsSeen: number; differsFromGames: number } {
  let rowsSeen = 0;
  let differsFromGames = 0;
  for (const league of LEAGUES) {
    const cat = categoryOf(site, league, "starter");
    const panel = cat.panels.find((p) => p.id === "winPct");
    assert.ok(panel !== undefined, `${season} ${league}: 勝率 순위가 없다 — 부문 ${cat.panels.map((p) => p.id).join("·")}`);
    assert.equal(panel.label, "勝率");
    assert.equal(panel.unit, denUnit("winPct"), "분모 단위가 용어집과 다르다");
    // ⚠**아웃 카운트가 아니다** — 켜 두면 `12決着` 이 `4回` 로 나간다(SRP 가 밟은 그 함정)
    assert.equal(panel.denAsInnings, false, "決着数를 이닝으로 그리고 있다");
    assert.equal(panel.digits, 3, "勝率은 소수 3자리다(.625)");

    for (const row of panel.rows) {
      const d = decisions.get(`${row.playerId}|${league}`);
      assert.ok(d !== undefined, `${season} ${row.name}: 투구 기록을 못 찾았다`);
      assert.equal(row.value.denominator, d.w + d.l, `${season} ${row.name}: 분모가 勝+敗가 아니다`);
      assert.equal(
        row.value.value,
        d.w + d.l === 0 ? null : d.w / (d.w + d.l),
        `${season} ${row.name}: 값이 勝 ÷ (勝+敗)가 아니다`,
      );
      rowsSeen += 1;
      if (d.games !== d.w + d.l) differsFromGames += 1;
    }
  }
  return { rowsSeen, differsFromGames };
}

test("⚠最高勝率 순위가 있고 분모가 決着数다 — 登板数도 試合数도 아니다", { skip: HAS_DB ? false : "DB 없음" }, () => {
  const root = load();
  // 루트(빌드가 사이트 맨 앞에 두는 시즌)는 크기와 무관하게 같은 단언을 받는다 — 개막 직후의 작은 시즌이어도
  const atRoot = checkWinPct(root);
  // ⚠**공회전 하한은 끝난 시즌에서 잰다**(`Loaded.settled`) — 루트가 끝난 시즌이면 같은 것을 두 번 세지 않는다
  const { settled } = root;
  const { rowsSeen, differsFromGames } = settled.season === root.season ? atRoot : checkWinPct(settled);
  assert.ok(rowsSeen >= 20, `${settled.season}(끝난 시즌): 勝率 행을 ${rowsSeen}개밖에 못 봤다 — 이 시험이 공회전한다`);
  /**
   * ⚠**「분모 = 등판 수」여도 통과하는 상태를 막는다.** 노디시전이 한 번도 없으면
   * 두 수가 같아 위 단언이 아무것도 가르지 않는다. 실제로는 대부분의 선발이 노디시전을 갖는다.
   * ⚠⚠**그래서 끝난 시즌에서 잰다** — 개막 직후의 루트는 첫 로테이션이 한 바퀴 돌기 전이라 이 수가 거의 없다
   *   (2026 개막을 2027 로 옮긴 사본 실측 · 행/「분모 ≠ 등판」: 2경기일째 18/0 · 5경기일째 44/0 · 7경기일째 54/4 · 8경기일째 55/12).
   */
  assert.ok(
    differsFromGames >= 10,
    `${settled.season}(끝난 시즌): 분모가 등판 수와 다른 행이 ${differsFromGames}개뿐이다 — 이 시험이 「決着数 대 登板数」를 안 가르고 있다`,
  );
});

/**
 * ⚠**자리가 곧 주장이다**(`metric-order.ts`). 선발의 첫 지표가 한때 「勝利」였고,
 * FIP·WHIP·SRP 를 자체 산출하는 사이트가 승수를 앞세우는 것은 자기모순이라 옮겼다.
 * 勝率은 그 판단의 연장선이라 **맨 뒤**다.
 */
test("⚠勝率이 선발 순위의 맨 뒤에 온다 — 승패는 타선과 구원진이 절반을 정한다", { skip: HAS_DB ? false : "DB 없음" }, () => {
  const { site } = load();
  for (const league of LEAGUES) {
    const ids = categoryOf(site, league, "starter").panels.map((p) => p.id);
    assert.ok(ids.length >= 10, `${league}: 선발 지표가 ${ids.length}개뿐이다 — 이 시험이 공회전한다`);
    assert.equal(ids.at(-1), "winPct", `${league}: 선발 목록의 마지막이 勝率이 아니다 — ${ids.join(" · ")}`);
    // 순서가 우연이 아니라 정본에서 나온 것인지 확인한다
    assert.ok(ids.every((id, i) => i === 0 || metricRank(ids[i - 1]!) <= metricRank(id)), `${league}: 정본 순서가 아니다`);
  }
  /**
   * ⚠**구원 목록에는 두지 않는다.** 이 勝率 순위의 자격은 **NPB 규정투구회**인데
   * 구원 쪽 자격선은 그 3분의 1인 **우리 기준**이다 — 같은 순위 이름에 다른 자격을 붙이면
   * 자체 기준이 공식으로 읽힌다(§0-10 출처 추적성).
   * ⚠~~最高勝率의 자격은 NPB 규정투구회~~ 는 **틀렸다**(2026-09-26 1차 대조) — 표창의 자격은 승수다(아래 시험).
   */
  for (const league of LEAGUES) {
    const ids = categoryOf(site, league, "reliever").panels.map((p) => p.id);
    assert.ok(!ids.includes("winPct"), `${league}: 구원 목록에 勝率이 있다 — 구원의 자격선은 NPB 의 것이 아니다`);
  }
});

/**
 * ⚠**이 순위의 자격은 규정투구회이고, 표창의 자격이 아니다**(2026-09-26 · 1차 대조 ·
 * `docs/sources/2026-09-26-winpct-title-qualification.md`). NPB 표창 「勝率第一位投手賞」(통칭 最高勝率)은
 * **13勝以上**(120경기였던 2020パ 는 10勝以上)이라, 완결 16 리그-시즌 중 **4곳**에서 이 순위의 1위와
 * 수상자가 다르다(2018セ·2018パ·2020パ·2025パ). 화면이 그걸 말하지 않으면 수상자가 1위가 아니거나
 * 순위에 아예 없는 이유를 유저가 알 수 없다 — 예전 문구는 오히려 **규정투구회가 표창 자격이라고 단언했다.**
 */
test("⚠勝率 순위의 자격 문구가 「표창은 13勝以上이라 1위와 수상자가 다를 수 있다」를 말한다", { skip: HAS_DB ? false : "DB 없음" }, () => {
  const { site } = load();
  for (const league of LEAGUES) {
    const panels = categoryOf(site, league, "starter").panels;
    const winPct = panels.find((p) => p.id === "winPct");
    assert.ok(winPct !== undefined, `${league}: 勝率 순위가 없다`);
    assert.match(winPct.qualifier, /規定投球回/, `${league}: 이 순위의 자격(규정투구회)이 없다`);
    assert.match(winPct.qualifier, /勝率第一位投手賞/, `${league}: 표창의 이름이 없다`);
    assert.match(winPct.qualifier, /13勝以上/, `${league}: 표창의 자격(승수)이 없다`);
    assert.match(winPct.qualifier, /一致しないことがあります/, `${league}: 1위와 수상자가 다를 수 있다는 말이 없다`);
    // 표창 각주는 勝率만의 사정이다 — 다른 비율 순위에 새면 그 순위도 표창과 다르다고 읽힌다
    const era = panels.find((p) => p.id === "era");
    assert.ok(era !== undefined, `${league}: 防御率 순위가 없다 — 대조군이 없다`);
    assert.ok(!era.qualifier.includes("勝率第一位投手賞"), `${league}: 勝率의 표창 각주가 防御率에 샜다`);
  }
});
