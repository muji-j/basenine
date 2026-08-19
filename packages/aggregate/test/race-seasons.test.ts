/**
 * **완결 시즌으로 우승 경쟁 판정을 검산한다.**
 *
 * ⚠**픽스처는 내가 만든 세계라 내 오해가 그대로 통과한다.** `race.test.ts` 의 대전표는 내가 손으로
 * 균일하게 채운 것이고, 거기서 초록이 나오는 것은 「내 가정끼리 모순이 없다」는 뜻밖에 안 된다.
 * 완결 시즌은 **사실**이다 — 시즌 마지막 시점에 리그 1위는 우승이 확정돼 있고 나머지는 전부 소멸이다.
 * 여기서 떨어지면 계산이 틀린 것이다.
 *
 * ⚠**DB 가 없으면 건너뛴다**(개발자 머신마다 상태가 다르다). CI 는 `BB_REQUIRE_DB=1` 로 막는다 —
 * 「0건 통과」와 「안 쟀음」을 가른다(작업규칙 7).
 *
 * ---
 * ## ⚠브리프대로 쓰면 이 시험은 **거짓으로 떨어진다** — 실측으로 확인한 결함 셋
 *
 * 1. **완결을 「행 수 ≥ 700」으로 판정하면 진행 중인 시즌이 완결로 들어온다.**
 *    한 시즌은 `143 × 12 ÷ 2 = 858` 행이므로 700행은 **팀당 약 117경기(82%)**에 지나지 않는다.
 *    실측(2026-08-19): 2026 은 641행 · 팀당 102~111경기로 아직 진행 중인데, 9월쯤 700행을 넘는다.
 *    그러면 **아직 안 끝난 시즌에 「1위는 우승 확정 · 나머지 전부 소멸」을 요구**하게 되어
 *    CI 가 어느 날 갑자기 거짓 실패한다.
 *    → 완결 = **12팀 전부가 `regularSeasonGames(season)` 에 도달**. 행 수로 세지 않는다
 *      (`home-page.ts:15` 가 행 수로 세다 팀당 144~153 을 얻어 잔여를 음수로 만든 자리다).
 * 2. **우승팀을 배정밀도 승률로 뽑으면 판정과 눈금이 다르다.** `race.ts` 는 `pctKey`(소수 3자리)로
 *    판정하는데 시험만 원값으로 1등을 하나 골라 나머지에 `eliminated === true` 를 요구하면,
 *    동률 우승에서 계산은 「동률 = 가능성 있음」이라 `false` 를 낸다.
 *    ⚠**이건 가정이 아니라 실제로 일어난다** — 2022 퍼시픽은 `h` 76-65-2 와 `b` 76-65-2 로
 *    **승·패·무가 완전히 같다**(실측 2026-08-19). 브리프대로면 이 한 시즌에서 거짓 실패한다.
 *    → **`pctKey` 최상위를 공유하는 팀 전부**를 우승 집합으로 잡는다.
 * 3. **두 질의의 `WHERE` 가 달랐다.** 브리프의 성적 질의에는 `away_runs IS NOT NULL` 이 있는데
 *    대전표 질의에는 없다. `games` 와 `playedPairs` 가 다른 모집단에서 나오면 `seasonRace` 의
 *    Σ 검사가 **전 시즌을 `unknown` 으로 떨어뜨린다**(그 함수의 입력 계약).
 *    → **한 질의의 같은 행에서 둘 다 만든다.** 필터가 갈릴 여지 자체를 없앴다
 *      (지금 DB 에는 `played`·`regular` 인데 득점이 `NULL` 인 행이 0건이라 오늘은 값이 같지만,
 *       같아 보이는 것과 같은 것은 다르다).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { pairKey, seasonRace } from "../src/race.ts";
import type { SeasonRace, TeamRaceInput } from "../src/race.ts";
import { pctKey, winPct } from "../src/standings.ts";
import { canonicalTeamCode, leagueOf, regularSeasonGames } from "@bb-app/domain";

const DB = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "data", "bb.sqlite");
const HAS_DB = existsSync(DB);
if (process.env["BB_REQUIRE_DB"] === "1" && !HAS_DB) {
  throw new Error(`BB_REQUIRE_DB=1 인데 ${DB} 가 없다`);
}

const LEAGUES = ["central", "pacific"] as const;

interface SeasonRows {
  season: number;
  /** 그 시즌의 규정 경기 수. **하드코딩하지 않는다** — 2020 은 120 이다 */
  total: number;
  teams: TeamRaceInput[];
  pairs: Map<string, number>;
  /** 12팀 전부가 규정에 도달했는가 */
  complete: boolean;
}

/**
 * **한 질의로 전 시즌을 읽고, 성적과 대전표를 같은 행에서 만든다.**
 *
 * ⚠**`games` 와 `playedPairs` 는 `seasonRace` 의 입력 계약상 같은 모집단이어야 한다.** 질의를 둘로
 * 나누면 `WHERE` 가 갈릴 여지가 생기고(브리프가 실제로 그랬다), 갈리면 Σ 검사가 시즌 전체를
 * `unknown` 으로 떨어뜨려 **이 시험이 재려던 것을 하나도 못 잰 채 붉어진다.**
 * 같은 행에서 둘 다 만들면 그 여지가 **구조적으로** 없어진다.
 *
 * ⚠**대회 구분을 섞지 않는다**(§2-1). CS·일본시리즈·올스타가 들어오면 경기수가 규정을 넘는다 —
 * 실측 DB 기준 `climaxSeries` 90 · `nipponSeries` 45 · `allStar` 16 경기가 같은 표에 있다.
 * 올스타는 팀 코드부터 `cl`/`pl` 이라 `leagueOf` 가 예외를 던진다.
 *
 * ⚠**팀 코드를 정규화한다.** 오릭스는 2018 시즌까지 슬러그가 `bs` 였다. 실측(2026-08-19)으로는
 * 적재 시점에 이미 정규화돼 있어 `game` 에 `bs` 가 0건이지만, 그건 **적재기의 성질이지
 * 이 시험의 전제가 아니다.** 정규화를 안 한 채 `bs` 가 섞이면 그 시즌만 13팀이 되어
 * `deriveSeriesLengths` 가 `null` 을 내고, 완결 판정에서 조용히 빠진다.
 */
function load(): readonly SeasonRows[] {
  const db = new DatabaseSync(DB, { readOnly: true });
  let rows: { season: number; a: string; h: string; ar: number; hr: number }[];
  try {
    rows = db
      .prepare(
        `SELECT season, away_code AS a, home_code AS h, away_runs AS ar, home_runs AS hr
           FROM game
          WHERE status='played' AND competition='regular'
            AND away_runs IS NOT NULL AND home_runs IS NOT NULL`,
      )
      .all() as { season: number; a: string; h: string; ar: number; hr: number }[];
  } finally {
    db.close();
  }

  const bySeason = new Map<number, { teams: Map<string, TeamRaceInput>; pairs: Map<string, number> }>();
  for (const r of rows) {
    let s = bySeason.get(r.season);
    if (s === undefined) {
      s = { teams: new Map(), pairs: new Map() };
      bySeason.set(r.season, s);
    }
    const away = canonicalTeamCode(r.a);
    const home = canonicalTeamCode(r.h);
    for (const code of [away, home]) {
      if (!s.teams.has(code)) s.teams.set(code, { teamCode: code, w: 0, l: 0, t: 0, games: 0 });
    }
    const A = s.teams.get(away)!;
    const H = s.teams.get(home)!;
    A.games += 1;
    H.games += 1;
    // ⚠**득점 비교로만 판정한다.** 투수의 승패 표기로 세면 승리투수가 없는 무승부가 통째로 사라진다
    if (r.ar > r.hr) {
      A.w += 1;
      H.l += 1;
    } else if (r.ar < r.hr) {
      A.l += 1;
      H.w += 1;
    } else {
      A.t += 1;
      H.t += 1;
    }
    const k = pairKey(away, home);
    s.pairs.set(k, (s.pairs.get(k) ?? 0) + 1);
  }

  return [...bySeason]
    .sort((x, y) => x[0] - y[0])
    .map(([season, s]) => {
      const total = regularSeasonGames(season);
      const teams = [...s.teams.values()];
      return {
        season,
        total,
        teams,
        pairs: s.pairs,
        complete: teams.length === 12 && teams.every((t) => t.games === total),
      };
    });
}

/**
 * ⚠**모듈 전역 가변 상태는 원칙적으로 금지지만**(CLAUDE.md §6) 여기는 예외로 둔다 —
 * 시험 파일은 프로세스 하나에서 **한 파일의 시험을 순차 실행**하고, 이 값은 읽기 전용 DB 스냅샷이라
 * 경합할 상대가 없다. 이유는 성능이다: 안 하면 8시즌 7,367행을 시험마다 다시 읽는다.
 */
let cache: readonly SeasonRows[] | null = null;

/**
 * ⚠**공회전 방지.** 완결 시즌이 0개면 아래 루프가 한 번도 안 돌고 시험이 **조용히 통과**한다.
 * 그러면 「전부 통과」가 「이 검산은 한 번도 안 돌았다」를 덮는다(작업규칙 7·8).
 * ⚠여기에 **본수를 적지 않는다** — 그 수가 낡는 순간 판정 기준 자체가 거짓이 된다.
 *
 * ⚠**개수를 하드코딩하지 않는다.** 백필로 늘어나는 값이라 못 박으면 다음 백필에서 거짓 실패한다 —
 * 대신 **바닥값**만 두고 실제로 발견한 개수와 시즌 목록을 실패 메시지에 넣는다.
 * (지연 로드라 첫 시험이 DB 를 읽고 나머지는 그 결과를 쓴다. 모듈 최상위에서 읽지 않는 것은
 *  DB 가 깨졌을 때 그것이 **파일 전체의 ERROR** 가 아니라 **한 시험의 FAIL** 로 보이게 하기 위함이다.)
 */
function finished(): readonly SeasonRows[] {
  if (cache === null) cache = load();
  const done = cache.filter((s) => s.complete);
  assert.ok(
    done.length > 0,
    `완결 시즌이 0개다 — 이 시험이 공회전한다. DB 가 가진 시즌: ${cache.map((s) => `${s.season}(${s.teams.length}팀 최대 ${Math.max(...s.teams.map((t) => t.games))}/${s.total})`).join(" ")}`,
  );
  return done;
}

function raceOf(s: SeasonRows): SeasonRace {
  return seasonRace({ season: s.season, teams: s.teams, leagueOf, playedPairs: s.pairs });
}

/**
 * 그 리그의 **우승 집합** — `pctKey` 최상위를 공유하는 팀 전부.
 *
 * ⚠**배정밀도로 하나만 고르면 안 된다.** `race.ts` 는 `pctKey`(소수 3자리)에서 비교하므로
 * 눈금이 다르면 「`pctKey` 로는 동률인데 원값으로는 한쪽이 위」인 상황에서 시험만 한 팀을 우승으로
 * 뽑고 나머지에 소멸을 요구한다 — 계산은 「동률 = 가능성 있음」이라 `eliminated: false` 를 낸다.
 * 실측 2022 퍼시픽(`h` 76-65-2 · `b` 76-65-2)이 정확히 그 자리다.
 */
function championCodes(s: SeasonRows, league: string): readonly string[] {
  const keys = s.teams
    .filter((x) => leagueOf(x.teamCode) === league)
    .map((x) => {
      const key = pctKey(winPct(x.w, x.l));
      // ⚠완결 시즌에 승률이 `null` 이면 그 팀은 승패가 0이다 — 조용히 넘기면 우승 집합이 뒤틀린다
      assert.ok(key !== null, `${s.season} ${x.teamCode}: 완결인데 승률이 null 이다(${x.w}승 ${x.l}패)`);
      return { code: x.teamCode, key };
    });
  assert.equal(keys.length, 6, `${s.season} ${league}: 리그에 ${keys.length}팀이다 — 6팀이어야 한다`);
  const top = Math.max(...keys.map((x) => x.key));
  return keys.filter((x) => x.key === top).map((x) => x.code);
}

/**
 * **그 시즌 리그 우승팀** — 이 파일에서 **유일하게 DB 밖에서 온 사실**이다.
 *
 * ⚠**왜 필요한가.** 위의 `championCodes` 는 우승팀을 **DB 에서 유도한다** — 즉 적재가 승패를
 * 통째로 잘못 세도 시험은 그 틀린 값끼리 앞뒤가 맞는지만 보고 **초록이 난다.**
 * 실측(2026-08-19 뮤테이션 D-4): 무승부를 패로 접어도 6/6 통과했고, 그때 2021 센트럴의
 * 「우승팀」은 ヤクルト(73-52-18)에서 阪神(77-56-10)으로 **조용히 바뀌었다.**
 * 이 표가 그 구멍을 막는다. 픽스처의 문제(「내 오해가 그대로 통과」)는 데이터 축에도 똑같이 있다.
 *
 * ⚠**모르는 시즌은 예외로 만든다**(M7 · `competitionFromLabel` 과 같은 태도).
 * 백필로 시즌이 늘면 여기서 먼저 붉어진다 — 조용히 안 세고 넘어가지 않는다.
 *
 * ⚠**동률 우승은 이 표로 갈리지 않는다.** `race.ts` 는 `pctKey` 까지만 보고 NPB 협약
 * ①当該球団間の対戦成績를 적용하지 않으므로(그건 `standings.ts` 의 몫이다 · M1),
 * 2022 퍼시픽처럼 승패무가 완전히 같은 해에는 **집합에 우승팀이 들어 있는지**까지만 본다.
 * (실측: 2022 `b` 대 `h` 맞대결 25경기에서 `b` 15승 10패 — 협약 ①이 오릭스를 가렸다.)
 */
const PENNANT: ReadonlyMap<number, Readonly<Record<(typeof LEAGUES)[number], string>>> = new Map([
  [2018, { central: "c", pacific: "l" }], // 広島 / 西武
  [2019, { central: "g", pacific: "l" }], // 巨人 / 西武
  [2020, { central: "g", pacific: "h" }], // 巨人 / ソフトバンク
  [2021, { central: "s", pacific: "b" }], // ヤクルト / オリックス
  [2022, { central: "s", pacific: "b" }], // ヤクルト / オリックス(⚠ソフトバンクと 76-65-2 동률 · 협약 ①로 결정)
  [2023, { central: "t", pacific: "b" }], // 阪神 / オリックス
  [2024, { central: "g", pacific: "h" }], // 巨人 / ソフトバンク
  [2025, { central: "t", pacific: "h" }], // 阪神 / ソフトバンク
]);

test("⚠완결 시즌이 충분히 있다 — 없으면 아래 검산이 전부 공회전한다", {
  skip: HAS_DB ? false : "data/bb.sqlite 없음",
}, () => {
  const done = finished();
  assert.ok(
    done.length >= 5,
    `완결 시즌이 ${done.length}개뿐이다(${done.map((s) => s.season).join(",")}) — 이 시험이 공회전한다`,
  );
});

/**
 * ⚠**진행 중인 시즌이 하나뿐임을 시계 없이 말한다**(M6 — `new Date()` 금지).
 * 「가장 새로운 시즌만 미완결일 수 있다」는 구조적 사실이고, 이걸 안 걸면
 * **과거 시즌이 경기를 잃어도 그냥 완결 목록에서 빠질 뿐** 아무도 모른다(조용한 손실).
 * ⚠`regularSeasonGames` 표가 낡아도 여기서 걸린다 — 2016 을 백필했는데 그해가 143이 아니면
 * 「과거 시즌인데 미완결」로 붉어진다. 그게 표를 고치라는 신호다.
 */
test("⚠가장 새로운 시즌을 뺀 전 시즌은 완결이다 — 과거 시즌이 조용히 경기를 잃지 않는다", {
  skip: HAS_DB ? false : "data/bb.sqlite 없음",
}, () => {
  finished();
  const all = cache!;
  assert.ok(all.length >= 2, `시즌이 ${all.length}개뿐이다 — 이 시험이 공회전한다`);
  for (const s of all.slice(0, -1)) {
    const short = s.teams.filter((t) => t.games !== s.total).map((t) => `${t.teamCode}:${t.games}`);
    assert.deepEqual(
      short,
      [],
      `${s.season}: 과거 시즌인데 규정 ${s.total}경기에 못 미치는 팀이 있다 — ${short.join(" ")}`,
    );
    assert.equal(s.teams.length, 12, `${s.season}: 구단이 ${s.teams.length}개다 — 슬러그가 바뀌었을 수 있다`);
  }
});

/**
 * ⚠**이것이 데이터 정합성의 실제 검산이다.** `disagreed` 가 비어 있지 않다는 것은
 * 성적(`w/l/t/games`)과 대전표(`playedPairs`)가 **다른 세계의 것**이라는 뜻이다.
 * 완결 시즌에서 이게 나오면 파이프라인을 봐야 한다(`race.ts` 의 조합표 세 번째 행).
 */
test("⚠완결 시즌: 판정이 서 있고 성적과 대전표가 어긋나지 않는다", {
  skip: HAS_DB ? false : "data/bb.sqlite 없음",
}, () => {
  for (const s of finished()) {
    const race = raceOf(s);
    assert.deepEqual(
      race.disagreed,
      [],
      `${s.season}: 성적과 대전표가 어긋난 팀이 있다 — ${race.disagreed.join(" ")}. 파이프라인을 봐라`,
    );
    assert.equal(race.basis, "confirmed", `${s.season}: 완결 시즌인데 유도가 안 됐다`);
    // 완결 시즌은 `confirmed` 이므로 유도가 성공했다 — `series` 가 `null` 이면 그 자체가 모순이다
    assert.notEqual(race.series, null, `${s.season}: confirmed 인데 series 가 null 이다`);
  }
});

/**
 * ⚠**「직접대결 잔여 = 규정 − 치름」이 성립하려면 대전 수가 실제로 균일해야 한다.**
 * `race.ts` 는 **최대값**만 보고 규정 대전수를 유도하므로, 어떤 쌍이 덜 치러져 있어도
 * 유도 자체는 성공한다 — 즉 유도가 됐다는 것이 균일하다는 뜻은 아니다.
 * 여기서 **전 쌍**을 확인해야 그 전제가 실측으로 고정된다.
 * 실측(2026-08-19 · 완결 8시즌): 리그내 30쌍 전부 `intra` · 교류전 36쌍 전부 `inter` · 예외 0건.
 * 2020 은 교류전을 열지 않아 36쌍이 전부 0이고 리그내가 24다.
 */
test("⚠완결 시즌: 리그내 30쌍·교류전 36쌍이 전부 유도된 규정 대전수와 같다", {
  skip: HAS_DB ? false : "data/bb.sqlite 없음",
}, () => {
  for (const s of finished()) {
    const race = raceOf(s);
    const series = race.series;
    assert.ok(series !== null, `${s.season}: series 가 null 이라 대전 수를 확인할 수 없다`);
    const codes = s.teams.map((t) => t.teamCode);
    const off: string[] = [];
    let intraPairs = 0;
    let interPairs = 0;
    for (let i = 0; i < codes.length; i += 1) {
      for (let j = i + 1; j < codes.length; j += 1) {
        const a = codes[i]!;
        const b = codes[j]!;
        const intra = leagueOf(a) === leagueOf(b);
        if (intra) intraPairs += 1;
        else interPairs += 1;
        const want = intra ? series.intra : series.inter;
        const got = s.pairs.get(pairKey(a, b)) ?? 0;
        if (got !== want) off.push(`${a}-${b}:${got}(기대 ${want})`);
      }
    }
    assert.equal(intraPairs, 30, `${s.season}: 리그내 쌍이 ${intraPairs}개다`);
    assert.equal(interPairs, 36, `${s.season}: 교류전 쌍이 ${interPairs}개다`);
    assert.deepEqual(off, [], `${s.season}: 대전 수가 규정(리그내 ${series.intra}·교류전 ${series.inter})과 다른 쌍 ${off.length}개 — ${off.join(" ")}`);
  }
});

/**
 * **이 파일의 본체.** 완결 시즌의 마지막 시점에서:
 * - 잔여는 **0**이다(`null` 도 음수도 아니다 — M11).
 * - `pctKey` 최상위 팀은 **소멸이 아니고 자력이 살아 있다.**
 * - 나머지는 **전부 소멸**이다.
 */
test("⚠완결 시즌: 최종 1위는 우승 확정 · 나머지는 전부 소멸", {
  skip: HAS_DB ? false : "data/bb.sqlite 없음",
}, () => {
  for (const s of finished()) {
    const race = raceOf(s);
    for (const league of LEAGUES) {
      const champs = championCodes(s, league);
      for (const x of s.teams.filter((t) => leagueOf(t.teamCode) === league)) {
        const r = race.teams.get(x.teamCode);
        assert.ok(r !== undefined, `${s.season} ${x.teamCode}: 판정이 없다`);
        // ⚠`0` 과 `null` 을 섞지 않는다(M11). 완결 시즌의 잔여는 **아는 값이고 0**이다
        assert.equal(r.remaining, 0, `${s.season} ${x.teamCode}: 완결인데 잔여가 ${r.remaining}`);
        if (champs.includes(x.teamCode)) {
          assert.equal(r.eliminated, false, `${s.season} ${league} ${x.teamCode}: 우승팀이 소멸로 판정됐다`);
          assert.equal(r.selfPossible, true, `${s.season} ${league} ${x.teamCode}: 우승팀의 자력이 없다고 판정됐다`);
        } else {
          assert.equal(
            r.eliminated,
            true,
            `${s.season} ${league} ${x.teamCode}: 끝났는데 소멸이 아니다(${x.w}-${x.l}-${x.t} · 우승 ${champs.join(",")})`,
          );
          assert.equal(r.selfPossible, false, `${s.season} ${league} ${x.teamCode}: 소멸했는데 자력이 있다고 판정됐다`);
        }
      }
    }
  }
});

/**
 * ⚠**우승 집합이 실제 리그 우승팀을 담고 있는가** — 이 파일에서 DB 밖 사실과 부딪히는 유일한 자리다.
 * 위의 다른 시험들은 전부 **DB 가 스스로 앞뒤가 맞는가**만 보므로, 적재가 통째로 틀려도 통과한다.
 */
test("⚠완결 시즌: pctKey 최상위 집합에 실제 리그 우승팀이 들어 있다", {
  skip: HAS_DB ? false : "data/bb.sqlite 없음",
}, () => {
  let single = 0;
  for (const s of finished()) {
    const want = PENNANT.get(s.season);
    assert.ok(
      want !== undefined,
      `${s.season} 의 리그 우승팀을 모른다 — 백필로 시즌이 늘었으면 이 파일의 PENNANT 표를 갱신하라(조용히 안 세고 넘어가지 않는다)`,
    );
    for (const league of LEAGUES) {
      const champs = championCodes(s, league);
      const teams = s.teams.filter((t) => leagueOf(t.teamCode) === league);
      const line = teams.map((t) => `${t.teamCode} ${t.w}-${t.l}-${t.t}`).join(" · ");
      assert.ok(
        champs.includes(want[league]),
        `${s.season} ${league}: 실제 우승팀은 ${want[league]} 인데 pctKey 최상위는 [${champs.join(",")}] 이다 — ${line}`,
      );
      // 동률이 아니면 집합이 **정확히** 우승팀 하나여야 한다
      if (champs.length === 1) {
        assert.deepEqual(champs, [want[league]], `${s.season} ${league}: 단독 최상위가 ${champs[0]} 인데 실제 우승팀은 ${want[league]} 다`);
        single += 1;
      }
    }
  }
  assert.ok(single > 0, `단독 우승 갈래가 ${single}번 돌았다 — 아무것도 안 쟀다`);
});

/**
 * ⚠**셈 자체의 불변식.** 위 시험들과 아래 시험은 전부 **DB 에서 유도한 우승팀**을 기준으로 삼으므로,
 * 적재가 승패를 잘못 세도 「틀린 값끼리 앞뒤가 맞는」 상태로 통과할 수 있다.
 * 이 셋은 그런 오염이 통과하지 못하게 하는 **외부 지식이 필요 없는 검산**이다.
 * - 한 경기는 승 1 + 패 1 **또는** 무 2 를 만든다 → `ΣW === ΣL` 이고 `ΣT` 는 짝수.
 * - 완결 시즌이면 `ΣW + ΣL + ΣT === 규정 × 12`.
 * 실측(2026-08-19): 2021 은 무승부가 204(=102경기)로 많은 해인데 전부 성립했다.
 */
test("⚠셈이 스스로 맞는다 — ΣW = ΣL · ΣT 는 짝수 · 완결이면 Σ = 규정 × 12", {
  skip: HAS_DB ? false : "data/bb.sqlite 없음",
}, () => {
  finished();
  for (const s of cache!) {
    const w = s.teams.reduce((a, t) => a + t.w, 0);
    const l = s.teams.reduce((a, t) => a + t.l, 0);
    const tie = s.teams.reduce((a, t) => a + t.t, 0);
    const g = s.teams.reduce((a, t) => a + t.games, 0);
    assert.equal(w, l, `${s.season}: ΣW ${w} 와 ΣL ${l} 이 다르다 — 한 경기가 승 1 + 패 1 을 만들지 않았다`);
    assert.equal(tie % 2, 0, `${s.season}: ΣT 가 ${tie} 로 홀수다 — 무승부는 양 팀에 한 번씩 붙는다`);
    assert.equal(w + l + tie, g, `${s.season}: ΣW+ΣL+ΣT ${w + l + tie} 와 Σgames ${g} 가 다르다`);
    if (s.complete) {
      assert.equal(g, s.total * 12, `${s.season}: 완결인데 Σgames 가 ${g} 다 — 규정 ${s.total} × 12 = ${s.total * 12} 여야 한다`);
    }
  }
});

/**
 * ⚠**「소멸한 팀의 매직」은 이 도메인에서 나올 수 있는 최악의 거짓말이다**(`race.ts` 의 표현).
 * 점등 조건은 **같은 리그의 다른 모든 팀이 자력우승 소멸**인 것이고, 그래서 동률 선두가 있으면
 * 아무에게도 안 켜진다. 완결 시즌은 그 두 갈래를 실물로 다 가지고 있다 —
 * 실측(2026-08-19 · 완결 8시즌 × 2리그 = **16개 리그·시즌**): 단독 우승 **15**에서 매직이 켜지고
 * 동률 우승 **1**(2022 퍼시픽 `h`·`b`)에서 안 켜졌다. 두 갈래가 다 실물로 있으므로 아래에서
 * **둘 다 실제로 돌았는지 세어 확인한다** — 한쪽만 돌면 나머지 절반은 안 잰 것이다.
 *
 * ⚠**매직의 「값」은 여기서 단언하지 않는다 — 안 쟀다는 뜻이지 맞다는 뜻이 아니다.**
 * 실측으로 **2021 센트럴의 우승팀 ヤクルト(`s`, 73-52-18 · .584)의 매직이 잔여 0인데 `5`** 다.
 * 2위 阪神(`t`)이 **77승**으로 우승팀보다 승수가 많고(무승부 18 대 10), 매직 식은 관례대로
 * 승수식(`2위 최대 승수 − 내 승수 + 1`)인데 순위 판정은 승률식이라 둘이 갈린다.
 * `race.ts` 는 이 눈금 차이를 명시하지만 클램프 주석은 「`0` = 이미 우승 확정」이라고 쓴다 —
 * 완결 시즌에 `5` 가 나오는 것은 그 주석과 모순이다.
 * **판정이 필요한 사항이라 시험으로 못 박지 않고 보고로 올린다**(`.superpowers/sdd/task-3-report.md`).
 * 여기서 초록이 나온다고 「매직 값이 검산됐다」고 읽지 마라.
 */
test("⚠완결 시즌: 매직은 소멸한 팀에 안 켜지고, 동률 우승이면 아무에게도 안 켜진다", {
  skip: HAS_DB ? false : "data/bb.sqlite 없음",
}, () => {
  let lit = 0;
  let tied = 0;
  for (const s of finished()) {
    const race = raceOf(s);
    for (const league of LEAGUES) {
      const champs = championCodes(s, league);
      for (const x of s.teams.filter((t) => leagueOf(t.teamCode) === league)) {
        const r = race.teams.get(x.teamCode)!;
        if (!champs.includes(x.teamCode)) {
          assert.equal(r.magic, null, `${s.season} ${league} ${x.teamCode}: 소멸한 팀에 매직 ${r.magic} 이 켜졌다`);
        } else if (champs.length === 1) {
          assert.equal(
            typeof r.magic,
            "number",
            `${s.season} ${league} ${x.teamCode}: 단독 우승인데 매직이 ${r.magic} 이다 — 점등 조건을 채웠어야 한다`,
          );
          lit += 1;
        } else {
          assert.equal(
            r.magic,
            null,
            `${s.season} ${league} ${x.teamCode}: 동률 우승(${champs.join(",")})인데 매직 ${r.magic} 이 켜졌다`,
          );
          tied += 1;
        }
      }
    }
  }
  // ⚠**두 갈래를 실제로 다 태웠는지 확인한다.** 한쪽만 돌면 나머지 절반은 안 쟀다는 뜻이다
  assert.ok(lit > 0, `단독 우승 갈래가 ${lit}번 돌았다 — 매직 점등을 한 번도 안 쟀다`);
  assert.ok(tied > 0, `동률 우승 갈래가 ${tied}번 돌았다 — 동률 미점등을 한 번도 안 쟀다`);
});
