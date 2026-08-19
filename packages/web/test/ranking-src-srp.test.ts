/**
 * **순위표의 SRC/SRP 가 「무엇을 몇으로 나눈 값인가」를 실데이터로 고정한다.**
 *
 * ⚠**시험 1,442본 중 어느 것도 아래 둘을 못 잡았다**(2026-08-20). 둘 다 화면의 숫자가
 * 틀리는 결함이었고, 둘 다 **픽스처로는 보이지 않는다** — 「리그를 넘어 이적한 선수」와
 * 「분모의 단위」는 내가 만든 세계에서는 내 오해가 그대로 통과하기 때문이다.
 *
 * ## ① SRP 순위의 분모가 상대 타자 수를 이닝으로 찍고 있었다
 * `denominator` 는 **BF**(상대 타자 수)인데 `denAsInnings=true` 로 넘어가
 * `parts.ts` 의 `denText()` 가 **`bf/3` 을 「投球回」로** 그렸다.
 * 실측(고치기 전 `dist/ranking.html` · SRP 행 **123건 중 123건**이 어긋남):
 * 村上(13315153) 화면 **179.2回** 대 실제 **138.1回**(415아웃 · BF 539) ·
 * 達(01205155) **122.2回** 대 **89.2回** · 大津(01305157) **147.2回** 대 **112.1回**.
 * (⚠감사 보고의 「414아웃」은 어긋난 값이다 — 138.1回 = **415아웃**. 고치기 전 코드로
 *  되돌려 이 시험을 돌린 실측이 415 를 냈다.)
 * 같은 선수 페이지가 위쪽에는 `SRP +19.5 / 539対戦打者`, 순위 패널에는 `179.2回`,
 * 그리고 같은 장에 `138.1回`(投球回)를 34번 쓰고 있었다.
 *
 * ## ② SRC/SRP 순위가 리그마다 다른 정의를 쓰고 있었다
 * 지도를 **리그 루프 안에서 누적하면서 같은 루프 안에서 순위를 만들어**,
 * 먼저 도는 센트럴은 리그별 값을, 나중 도는 퍼시픽은 두 리그 합계를 받았다.
 * 실측: 山本(23125136)의 퍼시픽 SRC 가 **13.3 / 206打席**(시즌 합계)인데
 * 같은 표의 다른 행은 전부 `101打席 / 90打数`였고, **소프트뱅크 구단 페이지는 13.5** 였다 —
 * 같은 선수·같은 팀의 SRC 가 사이트 안에 **두 값**으로 있었다.
 *
 * ---
 * ⚠**선수 ID 를 하드코딩하지 않는다.** 데이터가 바뀌면 낡는 시험이 된다 —
 * 여기서 단언하는 것은 **관계**다(「분모가 저 표의 아웃과 같다」·「순위와 구단 페이지가 같다」).
 * ⚠**공회전을 막는다.** 대상이 0명이면 조용히 통과하므로, 시즌을 **데이터로 고른다** —
 * 리그를 넘어 이적한 타자·투수가 **둘 다** 있는 가장 최근 시즌이다(2024 는 이적 투수가 0명이라
 * 「최신 시즌」으로 고정하면 그 해에는 투수 쪽이 통째로 헛돈다).
 * ⚠**DB 가 없으면 건너뛴다**(개발자 머신마다 상태가 다르다). CI 는 `BB_REQUIRE_DB=1` 로 막는다 —
 * 「0건 통과」와 「안 쟀음」을 가른다(작업규칙 7·8).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { openDb } from "@bb-app/store";
import type { Db } from "@bb-app/store";
import { canonicalTeamCode, leagueOf } from "@bb-app/domain";
import type { League } from "@bb-app/domain";
import { foldSrc, foldSrp, loadSite } from "../src/query.ts";
import type { SiteData } from "../src/query.ts";

const DB = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "data", "bb.sqlite");
const HAS_DB = existsSync(DB);
if (process.env["BB_REQUIRE_DB"] === "1" && !HAS_DB) {
  throw new Error(`BB_REQUIRE_DB=1 인데 ${DB} 가 없다`);
}

/** 「그 선수가 그 시즌에 뛴 리그들」. 둘이면 리그를 넘어 이적한 선수다 */
const LEAGUES_SQL = (table: "batting_line" | "pitching_line"): string =>
  `SELECT x.player_id AS pid,
          (CASE x.side WHEN 'away' THEN g.away_code ELSE g.home_code END) AS code
   FROM ${table} x JOIN game g ON g.game_id = x.game_id
   WHERE g.season = ? AND g.status = 'played' AND g.competition = 'regular'
   GROUP BY pid, code`;

function crossLeague(db: Db, season: number, table: "batting_line" | "pitching_line"): Set<string> {
  const rows = db.raw.prepare(LEAGUES_SQL(table)).all(season) as { pid: string; code: string }[];
  const by = new Map<string, Set<League>>();
  for (const r of rows) {
    // ⚠**팀 코드를 정규화한다** — 2018 오릭스는 슬러그가 `bs` 였다(CLAUDE.md §2-2)
    const s = by.get(r.pid) ?? new Set<League>();
    s.add(leagueOf(canonicalTeamCode(r.code)));
    by.set(r.pid, s);
  }
  return new Set([...by].filter(([, s]) => s.size > 1).map(([pid]) => pid));
}

/** 리그별 **실제 투구 실적**. 순위표의 분모와 대볼 바깥쪽 근거다(박스스코어 원문) */
function pitchingByLeague(db: Db, season: number): Map<string, { outs: number; bf: number }> {
  const rows = db.raw
    .prepare(
      `SELECT p.player_id AS pid,
              (CASE p.side WHEN 'away' THEN g.away_code ELSE g.home_code END) AS code,
              SUM(p.outs) AS outs, SUM(p.bf) AS bf
       FROM pitching_line p JOIN game g ON g.game_id = p.game_id
       WHERE g.season = ? AND g.status = 'played' AND g.competition = 'regular'
       GROUP BY pid, code`,
    )
    .all(season) as { pid: string; code: string; outs: number; bf: number }[];
  const out = new Map<string, { outs: number; bf: number }>();
  for (const r of rows) {
    const k = `${r.pid}|${leagueOf(canonicalTeamCode(r.code))}`;
    const cur = out.get(k) ?? { outs: 0, bf: 0 };
    out.set(k, { outs: cur.outs + r.outs, bf: cur.bf + r.bf });
  }
  return out;
}

interface Loaded {
  season: number;
  site: SiteData;
  /** 리그를 넘어 이적한 선수 — **이 시험이 헛돌지 않는다는 증거** */
  crossBat: Set<string>;
  crossPit: Set<string>;
  pitchLine: Map<string, { outs: number; bf: number }>;
}

/**
 * ⚠**한 번만 읽는다.** `loadSite` 는 실측 약 6초라, 시험마다 부르면 이 파일만으로 30초가 넘는다.
 */
let loaded: Loaded | null = null;
function load(): Loaded {
  if (loaded !== null) return loaded;
  const db = openDb(DB, "1970-01-01T00:00:00.000Z");
  const seasons = (
    db.raw
      .prepare(
        `SELECT DISTINCT season FROM game
         WHERE status = 'played' AND competition = 'regular' ORDER BY season DESC`,
      )
      .all() as { season: number }[]
  ).map((r) => r.season);

  for (const season of seasons) {
    const crossBat = crossLeague(db, season, "batting_line");
    const crossPit = crossLeague(db, season, "pitching_line");
    if (crossBat.size === 0 || crossPit.size === 0) continue;
    loaded = {
      season,
      site: loadSite(db, { season, builtOn: "1970-01-01" }),
      crossBat,
      crossPit,
      pitchLine: pitchingByLeague(db, season),
    };
    // ⚠**여기서 닫아도 안전하다** — 위 셋은 전부 **평범한 값**이고 DB 를 붙들지 않는다.
    //   열어 둔 채 두면 시험 파일이 병렬로 도는 동안 핸들이 남는다
    db.close();
    return loaded;
  }
  db.close();
  throw new Error(
    `리그를 넘어 이적한 타자와 투수가 둘 다 있는 시즌이 없다(확인한 시즌 ${seasons.length}개) — ` +
      "이 시험이 재려는 결함을 재현할 수 있는 데이터가 없다",
  );
}

// ─── ① SRP 순위의 분모 ───────────────────────────────────────────────────

test("① 「投球回」라고 쓴 분모는 전부 실제 아웃 카운트다 — SRP 는 여기 섞이면 안 된다", { skip: !HAS_DB }, () => {
  const { site, pitchLine } = load();
  let checked = 0;
  const wrong: string[] = [];
  for (const lg of site.ranking.leagues) {
    for (const cat of lg.categories) {
      if (cat.id === "batter") continue;
      for (const p of cat.panels) {
        // 이 시험이 보는 것은 **이닝이라고 주장하는 분모**뿐이다
        if (!p.denAsInnings) continue;
        for (const r of p.rows) {
          const line = pitchLine.get(`${r.playerId}|${lg.id}`);
          if (line === undefined) continue;
          checked += 1;
          if (r.value.denominator !== line.outs) {
            wrong.push(
              `${lg.id}/${cat.id}/${p.id} ${r.name}(${r.playerId}) 母数=${r.value.denominator} ` +
                `실제 아웃=${line.outs}(BF ${line.bf})`,
            );
          }
        }
      }
    }
  }
  // ⚠공회전 방지 — 볼 행이 없으면 「0건 어긋남」은 아무 뜻이 없다(작업규칙 7)
  assert.ok(checked > 100, `이닝 분모 행이 ${checked}건뿐이다 — 시험이 헛돌고 있다`);
  assert.deepEqual(wrong, [], `이닝이 아닌 수를 「投球回」로 그린 행 ${wrong.length}건 / 검사 ${checked}건`);
});

test("① SRP 의 분모는 상대 타자 수이고, 화면 단위도 선수 페이지와 같은 「対戦打者」다", { skip: !HAS_DB }, () => {
  const { site, pitchLine } = load();
  let panels = 0;
  let checked = 0;
  const wrong: string[] = [];
  for (const lg of site.ranking.leagues) {
    for (const cat of lg.categories) {
      if (cat.id === "batter") continue;
      const p = cat.panels.find((x) => x.id === "srp");
      assert.notEqual(p, undefined, `${lg.id}/${cat.id} 에 SRP 패널이 없다`);
      panels += 1;
      // ⚠**단위를 선수 페이지에 맞춘다**(M1). 선수 페이지는 `statSigned("SRP", …, "対戦打者")` 다 —
      //   같은 값이 한 화면에서 `539対戦打者`, 다른 화면에서 `179.2回` 이면 그 자체가 거짓말이다
      assert.equal(p!.unit, "対戦打者", `${lg.id}/${cat.id} SRP 母数의 단위`);
      assert.equal(p!.denAsInnings, false, `${lg.id}/${cat.id} SRP 母数를 이닝으로 그리고 있다`);
      for (const r of p!.rows) {
        const line = pitchLine.get(`${r.playerId}|${lg.id}`);
        if (line === undefined) continue;
        checked += 1;
        // ⚠계산에서 빠진 타석(`skipped`)이 있으면 BF 보다 작아진다. 실측(2026-08-20)으로
        //   2018~2026 아홉 시즌 전부 `skipped` 총합이 **0** 이라 여기서는 같아야 한다
        if (r.value.denominator !== line.bf) {
          wrong.push(`${lg.id}/${cat.id} ${r.name}(${r.playerId}) 母数=${r.value.denominator} BF=${line.bf}`);
        }
      }
    }
  }
  assert.equal(panels, 4, "리그 2개 × 부문 2개의 SRP 패널이 있어야 한다");
  assert.ok(checked > 50, `SRP 행이 ${checked}건뿐이다 — 시험이 헛돌고 있다`);
  assert.deepEqual(wrong, [], `SRP 母数가 상대 타자 수와 다른 행 ${wrong.length}건 / 검사 ${checked}건`);
});

// ─── ② 리그별 정의 ───────────────────────────────────────────────────────

interface Sum {
  value: number | null;
  den: number;
}

/**
 * 구단 페이지가 싣는 **「이 구단에서 낸 몫」을 리그로 모은 것.**
 *
 * ⚠**이것이 순위표와 같아야 한다**(M1). 구단 페이지는 `선수|구단` 키를 쓰므로 이적해도
 * 섞이지 않는다 — 순위표만 시즌 합계를 쓰면 **같은 선수의 SRC 가 사이트에 두 값**이 된다.
 */
function teamTotals(site: SiteData, pick: "src" | "srp"): Map<string, Sum> {
  const out = new Map<string, Sum>();
  const add = (key: string, v: { value: number | null; denominator: number }): void => {
    const cur = out.get(key);
    out.set(key, {
      // ⚠**`null` 을 0 으로 만들지 않는다**(M11) — 「타석 로그 없음」과 「기여 0」은 다르다
      value: v.value === null ? (cur?.value ?? null) : (cur?.value ?? 0) + v.value,
      den: (cur?.den ?? 0) + v.denominator,
    });
  };
  for (const t of site.teams) {
    const lg = leagueOf(canonicalTeamCode(t.teamCode));
    if (pick === "src") for (const b of t.batters) add(`${b.playerId}|${lg}`, b.src);
    else for (const p of t.pitchers) add(`${p.playerId}|${lg}`, p.srp);
  }
  return out;
}

test("② 순위표의 SRC/SRP 는 그 리그 구단 페이지의 합과 같다 — 이적 선수만 정의가 달라지면 안 된다", { skip: !HAS_DB }, () => {
  const { site, crossBat, crossPit } = load();
  const totals = { src: teamTotals(site, "src"), srp: teamTotals(site, "srp") };
  let checked = 0;
  let crossChecked = 0;
  const wrong: string[] = [];
  for (const lg of site.ranking.leagues) {
    for (const cat of lg.categories) {
      for (const p of cat.panels) {
        if (p.id !== "src" && p.id !== "srp") continue;
        const t = p.id === "src" ? totals.src : totals.srp;
        const cross = p.id === "src" ? crossBat : crossPit;
        for (const r of p.rows) {
          const want = t.get(`${r.playerId}|${lg.id}`) ?? { value: null, den: 0 };
          checked += 1;
          if (cross.has(r.playerId)) crossChecked += 1;
          if (r.value.denominator !== want.den) {
            wrong.push(
              `${lg.id}/${cat.id}/${p.id} ${r.name}(${r.playerId}) 母数 순위=${r.value.denominator} 구단합=${want.den}`,
            );
            continue;
          }
          // 분모가 0이면 값도 없다 — 비교할 것이 없다(M11)
          if (want.den === 0 || want.value === null || r.value.value === null) continue;
          if (Math.abs(r.value.value - want.value) > 1e-9) {
            wrong.push(
              `${lg.id}/${cat.id}/${p.id} ${r.name}(${r.playerId}) 값 순위=${r.value.value} 구단합=${want.value}`,
            );
          }
        }
      }
    }
  }
  assert.ok(checked > 50, `SRC/SRP 행이 ${checked}건뿐이다 — 시험이 헛돌고 있다`);
  // ⚠**핵심 공회전 방지**: 결함은 리그를 넘어 이적한 선수에게만 나타난다.
  //   그 선수가 한 명도 표에 없으면 나머지 전부가 통과해도 아무것도 안 잰 것이다
  assert.ok(crossChecked > 0, "리그를 넘어 이적한 선수의 행이 순위표에 하나도 없다 — 결함이 나타나는 자리를 안 보고 있다");
  assert.deepEqual(wrong, [], `순위표와 구단 페이지가 어긋난 행 ${wrong.length}건 / 검사 ${checked}건`);
});

test("② 이적 선수 본인 행 — 선수 페이지의 순위 패널도 그 리그 몫만 싣는다", { skip: !HAS_DB }, () => {
  const { site, crossBat, crossPit } = load();
  const totals = { src: teamTotals(site, "src"), srp: teamTotals(site, "srp") };
  const byId = new Map(site.players.map((p) => [p.playerId, p]));
  let checked = 0;
  const wrong: string[] = [];
  /**
   * ⚠**선수 페이지의 순위 패널은 상위 N 밖이어도 본인 행을 반드시 넣는다**(`panelsForPlayer`).
   * 그래서 이적 선수를 **확실히** 볼 수 있는 유일한 자리다 — 순위 화면은 30행에서 잘린다.
   */
  for (const pid of [...crossBat, ...crossPit]) {
    const page = byId.get(pid);
    if (page === undefined) continue;
    for (const panel of page.ranking) {
      if (panel.id !== "src" && panel.id !== "srp") continue;
      const me = panel.rows.find((r) => r.isMe);
      if (me === undefined) continue;
      const want = (panel.id === "src" ? totals.src : totals.srp).get(`${pid}|${page.league}`);
      if (want === undefined) continue;
      checked += 1;
      if (me.value.denominator !== want.den) {
        wrong.push(`${page.name}(${pid}) ${panel.id} 母数 순위=${me.value.denominator} 구단합=${want.den}`);
      } else if (want.value !== null && me.value.value !== null && Math.abs(me.value.value - want.value) > 1e-9) {
        wrong.push(`${page.name}(${pid}) ${panel.id} 값 순위=${me.value.value} 구단합=${want.value}`);
      }
    }
  }
  assert.ok(checked > 0, "이적 선수의 SRC/SRP 본인 행을 한 건도 못 봤다 — 시험이 헛돌고 있다");
  assert.deepEqual(wrong, [], `이적 선수 본인 행이 어긋났다 ${wrong.length}건 / 검사 ${checked}건`);
});

// ─── ③ 순서 의존성 ───────────────────────────────────────────────────────

/**
 * ⚠**결함의 본체는 「리그 루프 안에서 누적하면서 같은 루프에서 순위를 만든 것」**이었다.
 * 접기를 함수로 떼어 낸 이유가 이것이고, 그러니 **접기가 순서에 기대지 않는다는 것**을 못 박는다.
 * 픽스처는 결함이 드러나는 모양이어야 한다 — 같은 선수가 **두 리그에** 있고,
 * 한쪽 리그 안에서는 **두 구단**에 걸쳐 있다.
 */
const SRC_C = [
  { playerId: "p1", displayName: "이적", teamCode: "db", src: 10, pa: 105, skipped: 0, srcPer600: null },
  { playerId: "p1", displayName: "이적", teamCode: "t", src: 2, pa: 20, skipped: 0, srcPer600: null },
  { playerId: "p2", displayName: "잔류", teamCode: "g", src: 5, pa: 300, skipped: 1, srcPer600: null },
];
const SRC_P = [
  { playerId: "p1", displayName: "이적", teamCode: "h", src: 13.5, pa: 101, skipped: 0, srcPer600: null },
];
const SRP_C = [
  { playerId: "q1", displayName: "이적투", teamCode: "db", srp: 0.81, bf: 214, skipped: 0, outs: 150, srpPer9: null },
];
const SRP_P = [
  { playerId: "q1", displayName: "이적투", teamCode: "h", srp: 1.2, bf: 47, skipped: 0, outs: 36, srpPer9: null },
];

test("③ 접기는 리그 순서에 기대지 않는다 — 번들 순서를 뒤집어도 같은 값이다", () => {
  const forward = foldSrc([
    { league: "central", entries: SRC_C },
    { league: "pacific", entries: SRC_P },
  ]);
  const reversed = foldSrc([
    { league: "pacific", entries: SRC_P },
    { league: "central", entries: SRC_C },
  ]);
  for (const key of ["byPlayer", "byLeague", "byTeam"] as const) {
    assert.deepEqual(
      [...forward[key].entries()].sort(),
      [...reversed[key].entries()].sort(),
      `SRC ${key} 가 리그 순서에 따라 달라진다`,
    );
  }

  const fp = foldSrp([
    { league: "central", entries: SRP_C },
    { league: "pacific", entries: SRP_P },
  ]);
  const rp = foldSrp([
    { league: "pacific", entries: SRP_P },
    { league: "central", entries: SRP_C },
  ]);
  for (const key of ["byPlayer", "byLeague", "byTeam"] as const) {
    assert.deepEqual(
      [...fp[key].entries()].sort(),
      [...rp[key].entries()].sort(),
      `SRP ${key} 가 리그 순서에 따라 달라진다`,
    );
  }
});

test("③ 접기의 세 단위는 서로 다른 것을 가리킨다 — 하나로 대신할 수 없다", () => {
  const f = foldSrc([
    { league: "central", entries: SRC_C },
    { league: "pacific", entries: SRC_P },
  ]);
  // 시즌 합계 — 리그를 넘어도 한 줄
  assert.deepEqual(f.byPlayer.get("p1"), { src: 25.5, pa: 226, skipped: 0 });
  // 리그별 — **순위가 쓰는 것**. 합계(226타석)와 다르다는 것이 이 시험의 요점이다
  assert.deepEqual(f.byLeague.get("p1|central"), { src: 12, pa: 125, skipped: 0 });
  assert.deepEqual(f.byLeague.get("p1|pacific"), { src: 13.5, pa: 101, skipped: 0 });
  // 구단별 — 구단 페이지가 쓰는 것
  assert.deepEqual(f.byTeam.get("p1|db"), { src: 10, pa: 105, skipped: 0 });
  assert.deepEqual(f.byTeam.get("p1|t"), { src: 2, pa: 20, skipped: 0 });
  assert.deepEqual(f.byTeam.get("p1|h"), { src: 13.5, pa: 101, skipped: 0 });
  // ⚠**빠진 타석도 더한다**(M11) — 「계산 못 한 타석」이 조용히 사라지면 분모가 거짓말이 된다
  assert.equal(f.byPlayer.get("p2")?.skipped, 1);
  // Σ(리그별) = 시즌 합계. 두 단위가 같은 원재료에서 나온다는 뜻이다(M1)
  const sum = [...f.byLeague].filter(([k]) => k.startsWith("p1|")).reduce((n, [, v]) => n + v.pa, 0);
  assert.equal(sum, f.byPlayer.get("p1")!.pa);
});
