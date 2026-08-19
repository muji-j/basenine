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
import { openDb } from "@bb-app/store";
import { canonicalTeamCode, leagueOf } from "@bb-app/domain";
import type { League } from "@bb-app/domain";
import { loadSite } from "../src/query.ts";
import type { SiteData } from "../src/query.ts";
import type { RankingCategory } from "../src/pages.ts";
import { metricRank } from "../src/metric-order.ts";
import { denUnit } from "../src/glossary.ts";

const DB = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "data", "bb.sqlite");
const HAS_DB = existsSync(DB);
if (process.env["BB_REQUIRE_DB"] === "1" && !HAS_DB) {
  throw new Error(`BB_REQUIRE_DB=1 인데 ${DB} 가 없다`);
}

interface Loaded {
  season: number;
  site: SiteData;
  /** 리그별 최다 안타. **화면 밖에서 따로 센 값**이다 */
  topHits: Map<League, number>;
  /** `선수|리그` 의 승·패. 승률의 분모를 바깥 근거로 대본다 */
  decisions: Map<string, { w: number; l: number; games: number }>;
}

/**
 * ⚠**한 번만 읽는다** — `loadSite` 는 실측 약 6초다(`ranking-src-srp.test.ts` 와 같은 이유).
 */
let loaded: Loaded | null = null;
function load(): Loaded {
  if (loaded !== null) return loaded;
  const db = openDb(DB, "1970-01-01T00:00:00.000Z");
  const season = (
    db.raw
      .prepare(
        `SELECT MAX(season) AS season FROM game WHERE status = 'played' AND competition = 'regular'`,
      )
      .get() as { season: number | null }
  ).season;
  if (season === null) throw new Error("정규시즌 경기가 하나도 없다 — 이 시험이 아무것도 못 잰다");

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

  loaded = { season, site: loadSite(db, { season, builtOn: "1970-01-01" }), topHits, decisions };
  db.close();
  return loaded;
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
test("⚠最高勝率 순위가 있고 분모가 決着数다 — 登板数도 試合数도 아니다", { skip: HAS_DB ? false : "DB 없음" }, () => {
  const { site, decisions } = load();
  let rowsSeen = 0;
  let differsFromGames = 0;
  for (const league of LEAGUES) {
    const cat = categoryOf(site, league, "starter");
    const panel = cat.panels.find((p) => p.id === "winPct");
    assert.ok(panel !== undefined, `${league}: 勝率 순위가 없다 — 부문 ${cat.panels.map((p) => p.id).join("·")}`);
    assert.equal(panel.label, "勝率");
    assert.equal(panel.unit, denUnit("winPct"), "분모 단위가 용어집과 다르다");
    // ⚠**아웃 카운트가 아니다** — 켜 두면 `12決着` 이 `4回` 로 나간다(SRP 가 밟은 그 함정)
    assert.equal(panel.denAsInnings, false, "決着数를 이닝으로 그리고 있다");
    assert.equal(panel.digits, 3, "勝率은 소수 3자리다(.625)");

    for (const row of panel.rows) {
      const d = decisions.get(`${row.playerId}|${league}`);
      assert.ok(d !== undefined, `${row.name}: 투구 기록을 못 찾았다`);
      assert.equal(row.value.denominator, d.w + d.l, `${row.name}: 분모가 勝+敗가 아니다`);
      assert.equal(
        row.value.value,
        d.w + d.l === 0 ? null : d.w / (d.w + d.l),
        `${row.name}: 값이 勝 ÷ (勝+敗)가 아니다`,
      );
      rowsSeen += 1;
      if (d.games !== d.w + d.l) differsFromGames += 1;
    }
  }
  assert.ok(rowsSeen >= 20, `勝率 행을 ${rowsSeen}개밖에 못 봤다 — 이 시험이 공회전한다`);
  /**
   * ⚠**「분모 = 등판 수」여도 통과하는 상태를 막는다.** 노디시전이 한 번도 없으면
   * 두 수가 같아 위 단언이 아무것도 가르지 않는다. 실제로는 대부분의 선발이 노디시전을 갖는다.
   */
  assert.ok(
    differsFromGames >= 10,
    `분모가 등판 수와 다른 행이 ${differsFromGames}개뿐이다 — 이 시험이 「決着数 대 登板数」를 안 가르고 있다`,
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
   * ⚠**구원 목록에는 두지 않는다.** 最高勝率의 자격은 **NPB 규정투구회**인데
   * 구원 쪽 자격선은 그 3분의 1인 **우리 기준**이다 — 같은 타이틀 이름에 다른 자격을 붙이면
   * 자체 기준이 공식으로 읽힌다(§0-10 출처 추적성).
   */
  for (const league of LEAGUES) {
    const ids = categoryOf(site, league, "reliever").panels.map((p) => p.id);
    assert.ok(!ids.includes("winPct"), `${league}: 구원 목록에 勝率이 있다 — 자격 기준이 NPB 의 것이 아니다`);
  }
});
