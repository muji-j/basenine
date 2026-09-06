/**
 * **빌드가 조용히 통과하면 안 되는 자리** — 화면은 정직한데 데이터가 거짓인 두 가지.
 *
 * ⚠**M7 의 나머지 절반은 「알아챌 수 있게 하기」다.** 이 리포는 그 절반을 두 번 놓쳤다:
 * ⑴ `disagreed`(성적과 대전표가 어긋남)가 `console.warn` 하나뿐이라 **12구단의 우승 판정이
 *    통째로 사라진 채 배포**됐다. 화면 문구는 정직하다(「まだ判定できません」) — 그래서 더 안 보인다.
 * ⑵ 予告先発이 **낡았을 때와 아직 안 나왔을 때가 화면에서 같은 문장**(「発表待ち」)이다.
 *    실측(2026-08-19 검토): `dist/starters.html` 대상일 **2026-08-16** · 빌드일 **2026-08-19** ·
 *    12구단 전부의 다음 경기가 8/19 → **12/12 「発表待ち」**. NPB 予告先発은 전날 발표되므로
 *    그 예고는 **현실에는 존재했다.** 화면이 말한 이유(「아직 발표 안 됨」)가 사실이 아니었다.
 *
 * ⚠**시험이 DB 를 만든다.** 이 두 신호는 실데이터로는 태울 수 없다 —
 * `probable_pitcher` 는 2026-08-16 하루치(12행)뿐이고, `disagreed` 는 정상 데이터에서 비어 있다
 * (2026-08-19 실측). 픽스처가 유일한 재현 수단이다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadDraft,
  openDb,
  upsertBatting,
  upsertGame,
  upsertPitching,
  upsertPlayer,
  upsertProbablePitcher,
} from "@bb-app/store";
import type { Db } from "@bb-app/store";
import { regularSeasonGames } from "@bb-app/domain";
import { loadSite } from "../src/query.ts";
import { contactGate } from "../src/layout.ts";

const NOW = "2026-08-19T00:00:00.000Z";
/** 빌드 기준일. **주입한다**(M6) — 시험이 시계를 읽으면 날마다 다른 시험이 된다 */
const BUILT_ON = "2026-08-19";

let seq = 0;

/**
 * 픽스처 선수 ID.
 *
 * ⚠**숫자로 시작해야 한다.** `compareShardOf` 가 ID 첫 글자로 比較 샤드를 정하고
 * 숫자가 아니면 **던진다** — 실측(2026-08-21): 옛 `BAT_t` 픽스처로 `build.ts` 를 자식 프로세스로
 * 태우면 `buildSite` 가 「比較 샤드를 정할 수 없다」로 죽어서 게이트까지 가지도 못했다.
 * 아래 자식 프로세스 시험이 **같은 픽스처**를 쓰려면 여기가 숫자여야 한다(M1 — 픽스처를 두 벌로 두지 않는다).
 */
const CODES: readonly string[] = ["g", "t", "db", "c", "d", "s", "h", "f", "m", "l", "e", "b"];
const batId = (code: string): string => String(9_000_000 + CODES.indexOf(code) * 10 + 1);
const pitId = (code: string): string => String(9_000_000 + CODES.indexOf(code) * 10 + 2);

/**
 * 치러진 경기 한 개.
 *
 * ⚠**양 리그에 선수를 남긴다.** 리그 번들이 없으면 `teamPages` 가 그 리그의 팀을 통째로
 * 건너뛰어서, 「発表待ち」를 세는 자리 자체가 안 돈다.
 */
function played(db: Db, date: string, home: string, away: string, season = 2026): void {
  seq += 1;
  const gameId = `g${seq}`;
  upsertGame(db, {
    gameId, season, gameDate: date, awayCode: away, homeCode: home, gameNo: 1,
    status: "played", notPlayedReason: null, competition: "regular",
    sourceUrl: "https://npb.jp/x", fetchedAt: NOW, awayRuns: 1, homeRuns: 2,
  });
  upsertBatting(db, {
    gameId, playerId: batId(home), side: "home", battingOrder: "1", position: "(遊)",
    pa: 4, ab: 4, h: 1, d2: 0, d3: 0, hr: 0, bb: 0, ibb: 0, hbp: 0,
    sf: 0, sh: 0, so: 0, roe: 0, runs: 0, rbi: 0, sb: 0,
  });
  upsertPitching(db, {
    gameId, playerId: pitId(away), side: "away", decision: null,
    outs: 21, bf: 28, pitches: 90, h: 5, hr: 0, bb: 2, hbp: 0, so: 7, runs: 1, er: 1, wp: 0, balk: 0,
  });
}

/** 12구단 전부의 선수를 남긴다. 경기가 없는 팀은 화면에 안 나오므로 이것만으로는 아무 일도 안 난다 */
function roster(db: Db): void {
  for (const c of CODES) {
    upsertPlayer(db, batId(c), `${c}打者`, NOW);
    upsertPlayer(db, pitId(c), `${c}投手`, NOW);
  }
}

/**
 * **규정 대전수를 유도할 수 있는 최소 시즌**(→ `basis: "confirmed"`).
 *
 * `deriveSeriesLengths` 는 순위표에 **12구단이 정확히 6:6** 으로 있을 것을 요구하고,
 * 교류전 최대 관측값에서 리그내 대전수를 역산한다 — 143경기 시즌에서 정수가 나오는 것은
 * 교류전이 **3** 일 때뿐이라(`(143 − 3×6) / 5 = 25`), 한 쌍만 3경기를 치르면 유도가 선다.
 * 리그내 최대는 1이라 25 이하 조건도 만족한다. **9경기로 `confirmed` 가 된다.**
 */
function confirmableSeason(db: Db, season: number): void {
  const plan: readonly [string, string, number][] = [
    // 교류전 최대치 3 — 이게 유도의 열쇠다
    ["t", "l", 3],
    // 나머지 10구단을 리그 안에서 한 경기씩 등장시킨다
    ["g", "c", 1], ["d", "s", 1], ["db", "t", 1],
    ["m", "h", 1], ["b", "f", 1], ["e", "l", 1],
  ];
  let day = 1;
  for (const [home, away, n] of plan) {
    for (let i = 0; i < n; i += 1) {
      played(db, `${season}-04-${String(day).padStart(2, "0")}`, home, away, season);
      day += 1;
    }
  }
}

/** 예정 경기 한 개. `game` 표가 아니라 `upcoming_game` 이다(마이그레이션 015의 이유) */
function upcoming(db: Db, date: string, home: string, away: string): void {
  db.raw
    .prepare(
      `INSERT INTO upcoming_game (season, game_date, home_code, away_code, seq, venue, start_time, source, fetched_at)
       VALUES (?, ?, ?, ?, 1, '甲子園', '18:00', 'https://npb.jp/games/', ?)`,
    )
    .run(2026, date, home, away, NOW);
}

interface Fixture {
  /**
   * 팀당 치를 경기 수. `regularSeasonGames(2026) + 1` 을 주면
   * 성적이 스스로 어긋나 `disagreed` 가 채워진다(`isRecordSane` 의 상한 검사)
   */
  games: number;
  upcomingDate: string | null;
  probableDate: string | null;
  /**
   * **더 나중 시즌의 경기를 넣는다** → `seasonIsOver(2026)` 이 참이 된다.
   * ⚠「끝났다」의 정의가 **「더 나중 시즌의 경기가 있다」**라서(`seasonIsOver`) 이렇게 만든다.
   */
  laterSeason?: boolean;
  /** 2026 을 **12구단 6:6 · 유도 가능** 시즌으로 만든다 → `basis: "confirmed"` */
  confirmable?: boolean;
}

function seed(db: Db, o: Fixture): void {
  roster(db);
  if (o.confirmable === true) confirmableSeason(db, 2026);
  else {
    for (let i = 0; i < o.games; i += 1) {
      // 4월 1일부터 하루 한 경기씩. 144경기라도 8월 안에 들어간다
      const d = new Date(Date.UTC(2026, 3, 1) + i * 86_400_000).toISOString().slice(0, 10);
      played(db, d, "t", "g");
      // ⚠**파 리그는 항상 3경기다.** 어긋남을 센트럴에만 만들어야 「어긋난 팀만 잡히는가」를
      //   잴 수 있고, 144경기를 두 벌 만들지 않아 시험이 10초 이상 빨라진다(실측)
      if (i < 3) played(db, d, "l", "m");
    }
  }
  if (o.laterSeason === true) played(db, "2027-04-01", "t", "g", 2027);
  if (o.upcomingDate !== null) {
    upcoming(db, o.upcomingDate, "t", "g");
    upcoming(db, o.upcomingDate, "l", "m");
  }
  if (o.probableDate !== null) {
    for (const [me, you, league] of [["t", "g", "central"], ["g", "t", "central"]] as const) {
      upsertProbablePitcher(db, {
        gameDate: o.probableDate, teamCode: me, opponentCode: you, playerId: pitId(me),
        sourceName: `${me}投手`, venue: "甲子園", startTime: "18:00", league,
        sourceUrl: "https://npb.jp/games/", fetchedAt: NOW,
      });
    }
  }
}

async function withSite(
  o: Fixture,
  fn: (site: ReturnType<typeof loadSite>, warnings: string[]) => void,
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "bb-build-gates-"));
  const db = openDb(join(dir, "t.sqlite"), NOW);
  const original = console.warn;
  const warnings: string[] = [];
  try {
    seed(db, o);
    console.warn = (...args: unknown[]): void => {
      warnings.push(args.map((a) => String(a)).join(" "));
    };
    const site = loadSite(db, { season: 2026, builtOn: BUILT_ON });
    console.warn = original;
    fn(site, warnings);
  } finally {
    console.warn = original;
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * **`build.ts` 를 자식 프로세스로 실제로 돌린다.**
 *
 * ⚠**소스를 글자로 읽는 검사는 「그 코드에 닿는가」를 못 잰다.** 이 저장소는
 * 「소스 문자열 검사가 도달 불가능한 죽은 코드를 GREEN 으로 통과시킨」 사례를 이미 갖고 있다.
 * 여기서는 진짜로 돌려서 **stderr 문구**로 어느 게이트가 울렸는지 가른다.
 *
 * ⚠**종료 코드로는 어느 게이트인지 못 가른다**(실측 2026-08-21 · 이 픽스처 1회 실행에서
 * `raceStatus`·`wobaDerivation`·`stale` **3개**가 동시에 `exitCode = 1` 을 세웠다).
 * 픽스처에 타석 로그가 0건이면 wOBA 는 반드시 폴백이고, `stale` 은 `systemClock` 을 직접 읽는
 * `builtOn` 과 비교하므로 **주입점이 없다.** 그래서 종료 코드는 「1이다」까지만 보고
 * **귀속은 문구로** 한다. 「그 줄이 종료 코드를 세우는가」는 아래 `gate()` 소스 검사가 맡는다.
 */
async function withBuild(
  seasonArg: string,
  seedFn: (db: Db) => void,
  fn: (r: { status: number | null; stdout: string; stderr: string }) => void,
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "bb-build-run-"));
  const dbPath = join(dir, "t.sqlite");
  const db = openDb(dbPath, NOW);
  try {
    seedFn(db);
  } finally {
    db.close();
  }
  try {
    const r = spawnSync(
      process.execPath,
      [join(import.meta.dirname, "..", "tools", "build.ts"), dbPath, join(dir, "dist"), seasonArg],
      {
        encoding: "utf8",
        cwd: join(import.meta.dirname, "..", "..", ".."),
        /**
         * ⚠**연락처 스위치를 꺼서 넘긴다.** CI 가 `BB_REQUIRE_CONTACT=1` 을 켜 둔 채로
         * 이 시험이 돌면 연락처 게이트가 끼어들어 종료 코드의 뜻이 또 하나 늘어난다.
         */
        env: { ...process.env, BB_CONTACT: "", BB_REQUIRE_CONTACT: "" },
      },
    );
    fn({ status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * `build.ts` 에서 그 게이트의 **`if` 블록만** 잘라 낸다.
 *
 * ⚠**고정 폭 창은 옆 게이트를 삼킨다**(2026-08-21 검토 ②). 예전에는 마커부터 800자를 잘라
 * `process.exitCode = 1` 이 그 안에 있는지만 봤다 — **블록 순서를 바꾸면 다음 게이트의
 * 종료 코드가 우연히 창에 들어와 없는 게이트가 통과**한다. 지금은 마커 다음의 첫 `if (` 부터
 * **중괄호를 세어** 그 블록만 본다: 창 밖의 코드는 어떤 순서로 놓여도 들어오지 않는다.
 *
 * `head` = 마커부터 블록이 열리기 전까지(= **판정식**) · `block` = 그 `if` 의 몸통(= **효과**).
 * 둘을 나누는 이유는, 무엇을 보고 판단하는가와 그래서 무엇을 하는가가 다른 질문이기 때문이다.
 */
function gate(src: string, marker: string): { head: string; block: string } {
  const at = src.indexOf(marker);
  assert.notEqual(at, -1, `빌드가 ${marker} 를 아예 안 본다`);
  const ifAt = src.indexOf("if (", at);
  assert.notEqual(ifAt, -1, `${marker} 뒤에 판정하는 if 가 없다`);
  const open = src.indexOf("{", ifAt);
  assert.notEqual(open, -1, `${marker} 의 게이트 블록이 열리지 않는다`);
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") {
      depth -= 1;
      if (depth === 0) return { head: src.slice(at, open), block: src.slice(open, i + 1) };
    }
  }
  assert.fail(`${marker} 의 게이트 블록이 닫히지 않았다`);
}

const buildSrc = (): string =>
  readFileSync(join(import.meta.dirname, "..", "tools", "build.ts"), "utf8");

// ── m2. 성적과 대전표가 어긋나면 **배포하지 않는다** ───────────────────────────

/**
 * ⚠**`disagreed` 가 비지 않은 것은 파이프라인 결함이다**(정상 상태가 아니다).
 * 그때 12구단 페이지의 우승 판정이 통째로 사라지는데 **화면 문구는 정직하다** —
 * 「優勝争いはまだ判定できません」. 그래서 눈으로는 발견되지 않는다.
 *
 * ⚠**`basis: "unknown"` 전체를 막는 것이 아니다.** 교류전이 안 끝난 4~5월에는
 * 규정 대전수를 유도할 수 없어 `unknown` 이 **정상**이다(실측: 2026 타임라인에서 06-01 부터
 * `confirmed`). 가르는 것은 `disagreed` 다.
 */
test("⚠성적이 스스로 어긋나면 그 사실이 SiteData 까지 나온다 — 빌드가 판단할 수 있게", async () => {
  const total = regularSeasonGames(2026);
  await withSite({ games: total + 1, upcomingDate: null, probableDate: null }, (site) => {
    // ⚠**어긋난 팀만 잡힌다** — 파 리그(3경기)는 멀쩡하다. 「전부 채워진다」면 아무것도 안 재는 것이다
    assert.deepEqual(
      [...site.raceDisagreed].sort(),
      ["g", "t"],
      `${total + 1}경기(규정 ${total})를 치른 팀이 어긋난 것으로 안 잡혔다`,
    );
  });
});

/** ⚠**반대편도 잰다** — 늘 채워지는 값이면 위 시험은 아무것도 안 재는 것이다 */
test("⚠정상 데이터에서는 어긋난 구단이 없다", async () => {
  await withSite({ games: 3, upcomingDate: null, probableDate: null }, (site) => {
    assert.deepEqual(site.raceDisagreed, [], "정상 픽스처인데 어긋났다고 했다");
  });
});

/**
 * ⚠**빌드를 세우는 것까지가 이 지적의 내용이다**(2026-08-19 검토 m2).
 * `console.warn` 만으로는 CI 가 stderr 를 읽지 않는 한 아무도 모른다 —
 * 「M7 의 실패로」에 반쯤만 닿아 있었다.
 *
 * ⚠**이 검사는 소스를 글자로 읽는다.** 종료 코드로 재려 해도 **낡은 데이터·빈 시즌·깨진 링크가
 * 전부 같은 `1`** 이라 무엇 때문에 1인지 구별되지 않는다(픽스처 DB 는 반드시 낡았다 —
 * 실측 2026-08-21: 자식 프로세스 1회 실행에서 3개 게이트가 동시에 1을 세웠다).
 * 같은 이유로 이 리포에는 이미 글자로 읽는 검사가 있다(`assets-source.test.ts`).
 * ⚠**단 창을 고정 폭으로 두지 않는다**(검토 ②) — `gate()` 가 그 `if` 블록만 잘라 준다.
 */
test("⚠어긋난 구단이 있으면 빌드가 실패한다 — 경고로 끝내지 않는다", () => {
  // 그 가지 **안에서** 종료 코드를 바꾸는가. `emptySeasons`·`stale` 과 같은 형식이다
  assert.match(
    gate(buildSrc(), "raceDisagreed").block,
    /process\.exitCode = 1/,
    "raceDisagreed 를 보긴 하는데 종료 코드를 안 바꾼다 — 경고만으로는 그대로 배포된다",
  );
});

// ── ①. **끝난 시즌인데 우승 판정이 없다** — `disagreed` 가 못 보는 갈래 ──────────

/**
 * ⚠**위 게이트는 `disagreed` 만 본다.** 그런데 `deriveSeriesLengths` 가 실패하는 경로는
 * **`disagreed` 를 비운 채** 12구단 판정을 전멸시킨다 — 조합표의
 * 「`unknown` · `series: null` · `disagreed: []`」 갈래이고, 그건 4~5월에는 **정상**이다.
 *
 * ⚠**CLAUDE.md §2-2 의 2018 오릭스 `bs` 슬러그 사고가 정확히 이 모양이다.** 148경기가
 * 「모르는 팀 코드」로 실패했고, 그대로 뒀으면 그 시즌 성적이 화면에서 사라진 채
 * 「그 시즌은 원래 그렇다」로 읽혔을 것이다. 유도는 **순위표에 12구단이 6:6** 일 것을 요구하므로,
 * 팀 코드가 하나만 새도 여기로 떨어진다.
 *
 * 이 픽스처는 4구단뿐이라 유도가 서지 않는다 — **사고와 같은 모양을 만드는 가장 싼 방법**이다.
 */
test("⚠끝난 시즌인데 판정이 없으면 그 사실이 SiteData 까지 나온다 — disagreed 는 비어 있다", async () => {
  await withSite(
    { games: 3, upcomingDate: null, probableDate: null, laterSeason: true },
    (site) => {
      assert.deepEqual(
        site.raceDisagreed,
        [],
        "이 갈래는 disagreed 가 비어 있다 — 그래서 기존 게이트가 못 본다. 비어 있지 않으면 다른 것을 재고 있다",
      );
      assert.deepEqual(site.raceStatus, { basis: "unknown", series: null, seasonOver: true });
    },
  );
});

/**
 * ⚠**반대편을 잰다 — 4~5월의 `unknown` 은 정상이다.** 교류전이 안 끝나면 규정 대전수를
 * 유도할 수 없고(실측: 2026 타임라인에서 06-01 부터 `confirmed`), 그때 막으면
 * **시즌 초 두 달 동안 매일 배포가 거부된다.** 가르는 것은 `seasonOver` 하나다.
 */
test("⚠시즌이 안 끝났으면 unknown 이어도 정상이다 — 게이트가 4~5월을 막지 않는다", async () => {
  await withSite({ games: 3, upcomingDate: null, probableDate: null }, (site) => {
    assert.deepEqual(site.raceStatus, { basis: "unknown", series: null, seasonOver: false });
  });
});

/**
 * ⚠**「늘 unknown 인 픽스처」로 위 두 시험을 하면 아무것도 안 재는 것이다.**
 * 12구단이 6:6 으로 있고 교류전 최대가 3이면 유도가 서고(`(143 − 18) / 5 = 25`)
 * 판정이 `confirmed` 가 된다 — **9경기면 된다.**
 */
test("⚠12구단이 갖춰지면 판정이 선다 — 위 시험이 「늘 unknown」을 재고 있지 않다는 증거", async () => {
  await withSite(
    { games: 0, upcomingDate: null, probableDate: null, confirmable: true },
    (site) => {
      assert.deepEqual(site.raceDisagreed, []);
      assert.deepEqual(site.raceStatus, {
        basis: "confirmed",
        series: { intra: 25, inter: 3 },
        seasonOver: false,
      });
    },
  );
});

/**
 * ⚠**빌드를 실제로 돌려서 「그 코드에 닿는가」까지 잰다**(검토 ② 의 대안).
 *
 * 소스를 글자로 읽는 검사는 **도달 불가능한 죽은 코드도 GREEN 으로** 통과시킨다 —
 * 이 저장소에는 그 실측 사례가 2건 있다. 그래서 이 게이트만큼은 자식 프로세스로 태운다.
 *
 * **한 번의 실행으로 진리표 전부를 잰다**(실측 비용: 1회 약 0.7~1초):
 * ```
 * 2024  12구단 6:6 → confirmed · 뒤 시즌이 있으니 seasonOver   → 막지 않는다
 * 2025  4구단      → unknown   · 뒤 시즌이 있으니 seasonOver   → **여기만 막는다**
 * 2026  4구단      → unknown   · 마지막 시즌이라 아직 안 끝남  → 막지 않는다(4~5월의 정상 상태)
 * ```
 * ⚠**「1시즌」이라는 수 자체가 판정식 양쪽을 다 재는 단언이다** — `seasonOver` 를 빼면 2026 이,
 * `basis` 를 뒤집으면 2024 가 같이 잡혀서 수가 달라진다.
 */
test("⚠빌드를 실제로 돌리면 끝난 시즌의 판정 부재만 막는다 — 죽은 코드가 아니다", async () => {
  await withBuild(
    "2026,2025,2024",
    (db) => {
      roster(db);
      confirmableSeason(db, 2024);
      for (const season of [2025, 2026]) {
        for (let i = 0; i < 3; i += 1) {
          const d = `${season}-04-0${i + 1}`;
          played(db, d, "t", "g", season);
          played(db, d, "l", "m", season);
        }
      }
    },
    (r) => {
      // ⚠**빌드가 게이트까지 갔는가부터 확인한다.** 도중에 죽으면 아래 「안 났다」가 공허해진다
      assert.match(r.stdout, /생성: \d+파일/, `빌드가 게이트까지 가지도 못했다:\n${r.stderr}`);
      assert.match(
        r.stderr,
        /이미 끝난 시즌인데 우승 판정이 서지 않았다 — 1시즌/,
        `끝난 시즌의 판정 부재를 안 막았다(또는 몇 시즌인지가 다르다):\n${r.stderr}`,
      );
      assert.match(r.stderr, /\n\s+2025: 규정 대전수 유도 실패/, "어느 시즌인지 안 말한다");
      assert.doesNotMatch(r.stderr, /\n\s+2024: 규정 대전수/, "판정이 선 시즌까지 막았다");
      assert.doesNotMatch(r.stderr, /\n\s+2026: 규정 대전수/, "아직 안 끝난 시즌까지 막았다");
      assert.equal(r.status, 1, "배포를 세우지 않았다");
    },
  );
});

/**
 * ⚠**「막는가」는 위에서 쟀다. 여기서는 「그 줄이 종료 코드를 세우는가」를 잰다.**
 * 자식 프로세스로는 그것을 못 가른다 — 실측(2026-08-21)으로 한 번의 실행에서
 * `raceStatus`·`wobaDerivation`·`stale` **3개**가 동시에 1을 세웠기 때문이다.
 * ⚠**창은 그 `if` 블록이다**(검토 ②) — 고정 폭이면 옆 게이트의 종료 코드가 들어온다.
 */
test("⚠끝난 시즌의 판정 부재가 종료 코드를 바꾼다 — 경고로 끝내지 않는다", () => {
  const g = gate(buildSrc(), "raceMissing");
  // 판정식이 **양쪽을 다 본다** — 하나만 보면 4~5월을 막거나 판정이 선 시즌을 막는다
  assert.match(g.head, /seasonOver/, "빌드가 시즌 종료 여부를 안 본다");
  assert.match(g.head, /basis/, "빌드가 판정 근거를 안 본다");
  assert.match(
    g.block,
    /process\.exitCode = 1/,
    "보긴 하는데 종료 코드를 안 바꾼다 — 경고만으로는 그대로 배포된다",
  );
});

// ── 드래프트만 굽는 시즌. **「데이터가 있는데 안 적었다」** ─────────────────────

/**
 * 그 시즌에 드래프트 행 하나를 남긴다 — **경기 데이터와는 독립이다**(그게 이 게이트의 전제).
 * ⚠**`bids: null`** — 「이 시즌 소스는 경합을 아예 안 쓴다」이고, `[]`(=안 겹쳤다)와 다른 사실이다(M11).
 */
function draftOf(db: Db, season: number, team: string): void {
  const at = { source: `https://npb.jp/draft/${season}/`, fetchedAt: NOW, revision: "sha256:x" };
  loadDraft(db, {
    season,
    team,
    picks: [{ team, kind: "shihaika", roundNo: 1, waiverDir: null, nameDisplay: "山田 太郎", position: null, fromOrg: null }],
    bids: null,
    page: { ...at, source: `https://npb.jp/draft/${season}/draftlist_${team}.html` },
    event: at,
  });
}

/**
 * ⚠⚠**분류에 「경기가 있는가」를 묻는 자리가 없었다**(2026-09-07 이중 검토 P3).
 *
 * `draftOnly` 는 **「빌드 인자 목록에 없는 드래프트 시즌」**을 전부 드래프트 전용으로 본다.
 * 2017 을 백필해 놓고 `package.json` 의 시즌 목록 갱신을 잊으면 그 시즌이 **조용히 한 장으로만
 * 구워지고** 선수·경기·순위가 통째로 사라진 채 **「그 해는 원래 드래프트만 있는 해」로 읽힌다.**
 * ⚠**빈 화면조차 안 남는다** — `emptySeasons` 는 **목록에 적힌** 시즌만 보므로 이 갈래에 닿지 않고,
 * 링크 검사도 통과한다(없는 화면은 링크도 없다). M7 의 「조용한 0」보다 더 안 보이는 모양이다.
 *
 * **한 번의 실행으로 양쪽을 다 잰다**:
 * ```
 * 2025  드래프트 있음 · 경기 있음 · 목록 밖  → **여기만 막는다**
 * 2010  드래프트 있음 · 경기 없음 · 목록 밖  → 막지 않는다(이 기능의 정상 사용)
 * ```
 */
test("⚠경기가 있는 시즌을 드래프트 한 장으로 굽지 않는다 — 목록에서 빠진 것을 조용히 지우지 않는다", async () => {
  await withBuild(
    "2026",
    (db) => {
      roster(db);
      played(db, "2026-04-01", "t", "g", 2026);
      played(db, "2025-04-01", "t", "g", 2025);
      draftOf(db, 2025, "t");
      draftOf(db, 2010, "t");
    },
    (r) => {
      // ⚠**게이트까지 갔는가부터 확인한다** — 도중에 죽으면 아래 「안 났다」가 공허해진다
      assert.match(r.stdout, /생성: \d+파일/, `빌드가 게이트까지 가지도 못했다:\n${r.stderr}`);
      assert.match(
        r.stderr,
        /경기가 있는 시즌을 ドラフト 한 장으로만 구웠다: 2025 —/,
        `경기가 있는 시즌이 한 장으로 구워지는데 아무 말도 안 했다:\n${r.stderr}`,
      );
      assert.doesNotMatch(r.stderr, /구웠다:[^\n]*2010/, "경기가 없는 시즌까지 막았다 — 이 기능이 죽는다");
      assert.equal(r.status, 1, "배포를 세우지 않았다");
    },
  );
});

/**
 * ⚠**「막는가」는 위에서 쟀다. 여기서는 「그 줄이 종료 코드를 세우는가」를 잰다** —
 * 자식 프로세스의 종료 코드는 이 픽스처에서 세 게이트가 함께 세우므로 귀속이 안 된다.
 */
test("⚠그 시즌이 빠진 것이 종료 코드를 바꾼다 — 경고로 끝내지 않는다", () => {
  const g = gate(buildSrc(), "droppedSeasons");
  assert.match(
    g.block,
    /process\.exitCode = 1/,
    "보긴 하는데 종료 코드를 안 바꾼다 — 경고만으로는 그대로 배포된다",
  );
});

// ── wOBA 계수 유도. **세어 놓고 아무도 안 읽던 자리** ──────────────────────────

/**
 * ⚠**이 픽스처에는 타석 로그(`pa_event`)가 없다** — 박스스코어만 있다.
 * 그건 **폴백 계수로 떨어지는 조건 그 자체**라, 여기서 그 상태를 값으로 잡을 수 있다.
 *
 * ⚠**폴백은 화면에 한 글자도 안 드러난다.** 값이 사라지는 게 아니라 **눈금이 밀리고**
 * (자격자 중앙 약 1 wRC+), 그러는 동안 용어집은
 * 「係数は当サイトがリーグ・シーズンごとに算出」이라고 쓴다 — **화면이 거짓말을 한다.**
 * 예전 신호는 `console.warn` 하나뿐이라 종료 코드가 0이었다(2026-08-21 검토 P2-③).
 */
test("⚠타석 로그가 없으면 폴백으로 떨어진 사실이 SiteData 까지 나온다", async () => {
  await withSite({ games: 3, upcomingDate: null, probableDate: null }, (site) => {
    assert.deepEqual(
      [...site.wobaDerivation].sort((a, b) => a.league.localeCompare(b.league)),
      [
        { league: "central", fellBack: true, skipped: 0, unrecognized: 0 },
        { league: "pacific", fellBack: true, skipped: 0, unrecognized: 0 },
      ],
      "타석 로그가 0건인데 폴백으로 떨어졌다고 말하지 않는다",
    );
  });
});

/**
 * ⚠**빌드를 세우는 것까지가 이 지적의 내용이다**(P2-②·③).
 * `deriveRunValues` 는 `skipped`(M11)·`unrecognized`(M7)를 세는데
 * **유일한 프로덕션 소비자가 `.runValues` 만 꺼내 나머지를 그 줄에서 버리고 있었다.**
 * ⚠소스를 글자로 읽는 이유는 위 `raceDisagreed` 시험과 같다.
 */
test("⚠wOBA 계수 유도가 온전하지 않으면 빌드가 실패한다 — 경고로 끝내지 않는다", () => {
  const g = gate(buildSrc(), "wobaDerivation");
  // 셋을 **전부** 판정식에서 본다 — 하나만 보면 나머지 둘이 다시 조용해진다
  for (const key of ["fellBack", "skipped", "unrecognized"]) {
    assert.match(g.head, new RegExp(key), `빌드의 판정식이 ${key} 를 안 본다`);
  }
  assert.match(
    g.block,
    /process\.exitCode = 1/,
    "wobaDerivation 을 보긴 하는데 종료 코드를 안 바꾼다 — 경고만으로는 그대로 배포된다",
  );
});

// ── Important. 予告先発이 「아직 안 나왔다」인지 「우리가 안 받았다」인지 ──────────

/**
 * ⚠**화면 문구는 그대로 둔다**(「発表待ち」). 방문자가 알아야 할 것이 아니라 운영자가 알아야 할 것이다 —
 * `disagreed` 경고와 **같은 자리·같은 형식**으로 빌드 로그에 낸다.
 */
test("⚠予告先発을 하나도 못 받았는데 다음 경기가 있으면 빌드 로그가 말한다", async () => {
  await withSite(
    { games: 3, upcomingDate: "2026-08-20", probableDate: null },
    (site, warnings) => {
      assert.ok(
        site.teams.some((t) => t.now.next !== null && t.now.probable === null),
        "픽스처가 「発表待ち」를 하나도 안 만들었다 — 이 시험이 아무것도 안 재고 있다",
      );
      const hit = warnings.filter((w) => w.includes("予告先発"));
      assert.equal(hit.length, 1, `予告先発 경고가 ${hit.length}건이다:\n${warnings.join("\n")}`);
      assert.match(hit[0]!, /2026/, "어느 시즌인지 안 말한다");
    },
  );
});

/**
 * ⚠**「아직 안 나왔다」에 경고를 내면 4~5월의 정상 상태가 매일 울린다.**
 * NPB 予告先発은 **전날** 발표되므로, 빌드 기준일의 예고를 갖고 있는데
 * 그 다음 날 경기의 예고가 아직 없는 것은 **정상**이다 — 그때는 화면의 「発表待ち」가 사실이다.
 */
test("⚠기준일의 予告先発을 갖고 있으면 다음 날 것이 없어도 경고하지 않는다", async () => {
  await withSite(
    { games: 3, upcomingDate: "2026-08-20", probableDate: BUILT_ON },
    (site, warnings) => {
      assert.ok(
        site.teams.some((t) => t.now.next !== null && t.now.probable === null),
        "픽스처가 「発表待ち」를 안 만들었다 — 경고가 안 난 이유가 화면이 조용해서일 수 있다",
      );
      assert.deepEqual(
        warnings.filter((w) => w.includes("予告先発")),
        [],
        "발표 전인 정상 상태에 경고를 냈다",
      );
    },
  );
});

/**
 * ⚠**휴식일에는 경고하지 않는다**(2026-08-19 재검토 — Minor ②).
 *
 * 옛 조건(「가장 최근 예고일 < 빌드일」)은 경기 없는 날에 주 1회급으로 오탐했다.
 * DB 실측(2026-07-01~08-19 · 50일): **10일이 경기 없는 날**(월요일 4 · 7/28~30 올스타
 * 브레이크 3 · 8/17~19 3). 이 픽스처는 그 모양을 그대로 재현한다 — `probableDate`(예고를
 * 받은 날)는 빌드일보다 **먼저**이고(`starters.gameDate < builtOn`, 옛 조건이면 무조건 발화),
 * `upcomingDate`(다음 경기)는 빌드일보다 **나중**이다 — 즉 빌드 시점에는 아직 그 경기의
 * 予告先発이 나올 시점이 아니다(NPB 予告先発은 전날 발표된다). 옛 조건이면 여기서 울렸다.
 *
 * ⚠**이 시험이 되돌림(뮤테이션)을 잡는다** — ②를 옛 조건으로 되돌리면 이 시험이 떨어져야 한다.
 */
test("⚠휴식일 — 다음 경기가 빌드일보다 나중이면 예고가 낡아도 경고하지 않는다", async () => {
  await withSite(
    { games: 3, upcomingDate: "2026-08-20", probableDate: "2026-08-15" },
    (site, warnings) => {
      assert.ok(
        site.teams.some((t) => t.now.next !== null && t.now.probable === null),
        "픽스처가 「発表待ち」를 안 만들었다 — 경고가 안 난 이유가 화면이 조용해서일 수 있다",
      );
      assert.deepEqual(
        warnings.filter((w) => w.includes("予告先発")),
        [],
        "다음 경기가 아직 오지 않았는데(빌드일보다 나중) 예고가 낡았다고 경고했다",
      );
    },
  );
});

/**
 * ⚠**끝난 시즌에는 경고하지 않는다.** 9시즌을 한 번에 만드는 빌드에서 소급 시즌 8개가
 * 매번 울리면 **진짜 신호가 소음에 묻힌다** — 이 리포가 daily.yml 에 이미 적어 둔 함정이다
 * (「그 예외가 매일 나고 진짜 구조 변경 경보가 소음에 묻힌다」).
 * 실측(2026-08-19): `probable_pitcher` 는 **2026-08-16 하루치 12행**뿐이라
 * 2018~2025 는 전부 `gameDate === null` 이다. 다음 경기가 없으면 화면은 「発表待ち」라고
 * 말하지 않으므로(`—`) 거짓말이 성립하지 않는다.
 */
test("⚠다음 경기가 없으면 予告先発을 못 받았어도 경고하지 않는다", async () => {
  await withSite({ games: 3, upcomingDate: null, probableDate: null }, (site, warnings) => {
    assert.ok(
      site.teams.every((t) => t.now.next === null),
      "픽스처에 예정 경기가 남아 있다 — 이 시험이 다른 것을 재고 있다",
    );
    assert.deepEqual(
      warnings.filter((w) => w.includes("予告先発")),
      [],
      "가리킬 경기가 없는데 予告先発이 낡았다고 했다",
    );
  });
});

// ── 중복 id. **그물이 있는데 그 그물에 구멍이 있었다** ─────────────────────────

/**
 * ⚠**T8 과 같은 모양의 실패다**(「그물이 있는데 그 크기를 아무도 안 쟀다」).
 *
 * 링크 검사는 앵커와 ARIA 참조를 전수로 보는데, `LinkIndex.ids` 가 `Set` 이라
 * **같은 id 가 두 번 있어도 「있다」로만** 보였다 — 검사 통과, 브라우저는 다른 곳.
 * 실측(2026-08-19 감사): `dist` 15,340장 중 `ranking.html` **9장**에 중복 id
 * **86종 / 172노드** · `#pn-rankmetric-starter-era` 로 들어갔을 때 열린 리그 패널이
 * **`['central']`** — パ의 개인 지표에 도달하는 URL 이 존재하지 않았다.
 *
 * ⚠**이 검사는 소스를 글자로 읽는다.** 위 `raceDisagreed` 시험과 같은 이유다 —
 * `build.ts` 는 import 만으로 실행되는 스크립트라 그 가지만 태울 수 없고,
 * 종료 코드로 재려 해도 낡은 데이터·빈 시즌·깨진 링크가 **전부 같은 `1`** 이라 구별되지 않는다.
 * 검출 로직 자체는 `link-check.test.ts` 가 값으로 잰다.
 */
test("⚠중복 id 가 있으면 빌드가 실패한다 — 앵커 검사가 통과하는 종류의 결함이다", () => {
  assert.match(
    gate(buildSrc(), "duplicateIds(all)").block,
    /process\.exitCode = 1/,
    "중복 id 를 보긴 하는데 종료 코드를 안 바꾼다 — 경고만으로는 그대로 배포된다",
  );
});

/**
 * ⚠**「N종」의 N 이 종수가 아니었다**(2026-08-20 최종 검토 ⑥).
 * `duplicateIds()` 한 건은 **(문서, id) 쌍**이라, 한 id 가 9장에 있으면 9건이다 —
 * 그걸 「9종」이라고 적으면 규모가 9배로 부풀어 읽힌다. 작업규칙 7(분모와 단위를 정확히)의 정신에
 * 어긋나고, 하필 **배포를 막는 메시지**라 판단 근거가 된다.
 * ⚠**시험이 소스를 글자로 읽는다** — 위 시험과 같은 이유다(`build.ts` 는 import 만으로 실행된다).
 */
test("⚠중복 id 의 수를 「종」이라고 부르지 않는다 — 그 수는 (문서, id) 쌍이다", () => {
  const region = gate(buildSrc(), "duplicateIds(all)").block;
  assert.doesNotMatch(
    region,
    /\$\{dups\.length\}종/,
    "쌍의 개수를 「종」이라고 부른다 — 한 id 가 9장에 있으면 9종으로 읽힌다",
  );
  assert.doesNotMatch(
    region,
    /\$\{dups\.length - 20\}종/,
    "뒷줄에서도 쌍의 개수를 「종」이라고 부른다",
  );
  // 종수를 말하려면 **id 를 따로 세야 한다**
  assert.match(region, /new Set\(dups\.map\(\(d\) => d\.id\)\)/, "id 의 종수를 세는 곳이 없다");
});

// ── 연락처(L4). **화면이 조용하지 않은데 빌드는 조용했다** ────────────────────

/**
 * ⚠**빈 연락처는 「표시가 없다」가 아니라 「개발자 지시문이 나간다」다**(2026-08-20 감사 ④).
 * 꼬리말이 방문자에게 「連絡先が未設定です（公開前に設定してください）」라고 말하고,
 * 그 꼬리말은 **15,340장 전부**에 있다. L4(삭제·정정 요청 창구)도 그 순간 없는 것이 된다.
 * 그런데 신호는 `console.warn` 하나뿐이라 **종료 코드가 0**이었다 —
 * `emptySeasons`·`stale`·`raceDisagreed` 와 같은 등급이어야 하는데 혼자 경고였다.
 *
 * ⚠**지금 배포본에는 이 문구가 없다.** CI 가 `secrets.BB_CONTACT` 를 넘기고 있고
 * 배포 로그에 `BB_CONTACT: ***` 가 찍힌다. 감사가 잰 것은 **시크릿 없는 로컬 빌드**였다.
 * 막는 것은 「지금 나가는 결함」이 아니라 **시크릿이 비는 날**이다.
 *
 * ⚠**로컬을 막으면 안 된다** — 연락처는 시크릿 스토어에만 있으니 개발자 머신에서는
 * **항상 비어 있는 것이 정상**이고, 매번 실패하면 진짜 신호가 소음에 묻힌다.
 * 그래서 `BB_REQUIRE_CONTACT=1` 을 **CI 만** 켠다(`BB_REQUIRE_DIST`·`BB_REQUIRE_DB` 와 같은 형식).
 *
 * ⚠**여기는 소스를 글자로 읽지 않는다.** 위 두 시험과 달리 판정이 `layout.ts` 의 순수 함수로
 * 나와 있어 **양방향으로 직접 태울 수 있다**(작업규칙 9).
 */
test("⚠연락처가 있으면 아무 소리도 내지 않는다 — 늘 우는 게이트는 게이트가 아니다", () => {
  for (const require of [undefined, "1"]) {
    const g = contactGate("hello@example.com", require);
    assert.deepEqual(
      g,
      { missing: false, fatal: false, message: "" },
      `연락처가 있는데 무언가 말했다(BB_REQUIRE_CONTACT=${String(require)})`,
    );
  }
});

test("⚠연락처가 없고 BB_REQUIRE_CONTACT=1 이면 빌드가 실패한다", () => {
  const g = contactGate("", "1");
  assert.equal(g.fatal, true, "CI 조건인데 종료 코드를 안 바꾼다 — 개발자 지시문이 그대로 배포된다");
  assert.equal(g.missing, true);
  // 로그가 **무엇이 화면에 나가는지**를 말해야 한다 — 「미설정」만으로는 심각도가 안 보인다
  assert.match(g.message, /BB_CONTACT/, "무슨 값이 없는지 안 말한다");
  assert.match(g.message, /連絡先が未設定です/, "화면에 무엇이 나가는지 안 말한다");
});

test("⚠연락처가 없어도 스위치가 없으면 경고로 끝난다 — 로컬 빌드를 막지 않는다", () => {
  for (const require of [undefined, "", "0", "true"]) {
    const g = contactGate("", require);
    assert.equal(g.missing, true, `연락처가 없는데 없다고 안 한다(BB_REQUIRE_CONTACT=${String(require)})`);
    assert.equal(g.fatal, false, `로컬 빌드를 세웠다(BB_REQUIRE_CONTACT=${String(require)})`);
    assert.match(g.message, /BB_REQUIRE_CONTACT/, "CI 에서 어떻게 막는지 안 알려준다");
  }
});

/**
 * ⚠**스위치를 만들고 CI 에서 안 켜면 아무것도 안 고친 것이다.**
 * 이 리포에는 그 전례가 있다 — `BB_REQUIRE_DIST` 가 없어 시험이 조용히 skip 되고
 * 종료 코드 0으로 「합격」이 됐다(2026-08-18 감사 P3).
 */
test("⚠daily.yml 이 화면 생성 단계에서 BB_REQUIRE_CONTACT 를 켠다", () => {
  const yml = readFileSync(
    join(import.meta.dirname, "..", "..", "..", ".github", "workflows", "daily.yml"),
    "utf8",
  );
  const at = yml.indexOf("BB_CONTACT: ${{ secrets.BB_CONTACT }}");
  assert.notEqual(at, -1, "daily.yml 이 BB_CONTACT 를 아예 안 넘긴다");
  // ⚠**같은 env 블록 안**이어야 한다. 다른 단계에 켜 두면 빌드가 안 보는 값이 된다
  assert.match(
    yml.slice(at, at + 900),
    /BB_REQUIRE_CONTACT:\s*"?1"?/,
    "시크릿은 넘기는데 스위치를 안 켰다 — 시크릿이 비는 날 그대로 배포된다",
  );
});

/** ⚠**빌드가 그 판정을 실제로 쓰는가.** 순수 함수만 맞고 호출부가 없으면 아무 일도 안 일어난다 */
test("⚠빌드가 contactGate 의 판정으로 종료 코드를 바꾼다", () => {
  assert.match(
    gate(buildSrc(), "contactGate(site.contact").block,
    /process\.exitCode = 1/,
    "판정만 받고 종료 코드를 안 바꾼다 — 경고만으로는 그대로 배포된다",
  );
});

/**
 * ⚠**S1(지인한정)의 인가 경계가 Cloudflare 대시보드 설정에만 있었다**(2026-08-21 감사 확정 P1).
 * 추적 파일 전수 grep 에서 인가 관련 히트가 **2건 · 둘 다 주석**이었고 게이트는 0건.
 * 그 사이 이 워크플로는 하루 3회 **새 배포 별칭**을 만들고 있었다.
 * ⚠**이 고장은 2026-08-15 에 실제로 한 번 났다**(deploy.md) — prod 302 · 별칭 200.
 *
 * ⚠**안전장치를 사람이 기억해서 붙이면 빠뜨려도 아무도 모른다** — 그래서 여기서 고정한다.
 * 단계가 **배포보다 앞**에 있어야 한다 — 뒤에 두면 이미 올라간 뒤에 울게 된다.
 */
test("⚠daily.yml 이 배포 앞에서 Access 담장을 확인한다", () => {
  const yml = readFileSync(
    join(import.meta.dirname, "..", "..", "..", ".github", "workflows", "daily.yml"),
    "utf8",
  );
  const gateAt = yml.indexOf("- name: S1 확인");
  const deployAt = yml.indexOf("- name: 배포");
  assert.notEqual(gateAt, -1, "S1 확인 단계가 없다 — 인가 경계를 확인하는 것이 리포에 아무것도 없다");
  assert.notEqual(deployAt, -1, "배포 단계를 못 찾았다 — 이 시험이 공회전한다");
  assert.ok(gateAt < deployAt, "S1 확인이 배포보다 뒤에 있다 — 올린 뒤에 울면 늦다");

  const block = yml.slice(gateAt, deployAt);
  // ⚠**상태 코드와 AUD 둘 다 본다.** 한 쪽만 보면 다른 앱으로 바뀜어도 통과한다
  assert.match(block, /EXPECT_AUD:/, "기대하는 AUD 가 없다 — 「302 면 된다」는 다른 앱으로 바뀜어도 통과한다");
  assert.match(block, /kid=\$\{EXPECT_AUD\}/, "AUD 를 실제로 대조하지 않는다");
  // ⚠**아직 배포되지 않은 별칭**을 본다 — 오늘 만들 별칭이 그것이다
  assert.match(block, /urandom/, "무작위 별칭을 안 본다 — 오늘 만들 호스트가 담장 밖인지 모른 채 올린다");
  // ⚠**페이지 문구로 판정하지 않는다** — 감사가 준 문자열은 실제와 달랐다
  assert.ok(
    !/Log in to bb-app/.test(block),
    "Cloudflare 의 페이지 문구로 판정한다 — 그 문구는 실측과 달랐고 언제든 바뀐다",
  );
});

/**
 * ⚠**워크플로 파일이 깨지면 아무도 안 말해 준다**(2026-08-21 실측).
 *
 * `run: |` 블록 안에 **열 0 으로 떨어진 줄**을 하나 넣었더니
 * 블록 스칼라가 거기서 끝나 YAML 이 통째로 깨졌다
 * (원인: 셀 명령에 `
` 을 쓰려다 **실제 개행이 들어갔다**).
 * 그러면 GitHub 은 **0초짜리 실패 run** 을 내고 끝이다 — 로그도 잡도 없고,
 * `workflow_dispatch` 도 「트리거가 없다」고 거절된다(파일을 못 읽으니까).
 * **크론이 그날 통째로 안 돌 수 있는 종류의 사고**다.
 *
 * ⚠**YAML 파서를 부르지 않는다** — 이 저장소에 없고, 이 것 하나를 위해
 * 의존성을 늘리지 않는다(공급망은 감사 축이다). 대신 **그 실패 형태만** 정확히 재다:
 * `jobs:` 아래는 전부 들여쓰기가 있으므로, 거기서 **열 0 으로 시작하는 줄**은
 * 무엇인가가 빠져나온 것이다.
 */
test("⚠daily.yml 의 jobs 안에 열 0 으로 떨어진 줄이 없다 — 블록 스칼라가 거기서 끝난다", () => {
  const yml = readFileSync(
    join(import.meta.dirname, "..", "..", "..", ".github", "workflows", "daily.yml"),
    "utf8",
  );
  const lines = yml.split(String.fromCharCode(10)).map((l) => l.replace(/\r$/, ""));
  const jobsAt = lines.findIndex((l) => /^jobs:\s*$/.test(l));
  assert.notEqual(jobsAt, -1, "daily.yml 에 jobs: 가 없다 — 이 시험이 공회전한다");
  const bad: string[] = [];
  for (let i = jobsAt + 1; i < lines.length; i += 1) {
    const l = lines[i]!;
    if (l === "") continue;
    if (/^\s/.test(l)) continue;
    bad.push(`${i + 1}: ${l.slice(0, 60)}`);
  }
  assert.deepEqual(
    bad,
    [],
    `jobs: 아래에 열 0 줄이 있다 — YAML 이 거기서 깨진다: ${bad.join(" / ")}`,
  );
});

/** ⚠**트리거가 사라지면 크론이 안 도는데 아무도 안 말해 준다.** 둘 다 있어야 한다 */
test("⚠daily.yml 이 schedule 과 workflow_dispatch 를 둘 다 갖는다", () => {
  const yml = readFileSync(
    join(import.meta.dirname, "..", "..", "..", ".github", "workflows", "daily.yml"),
    "utf8",
  );
  const head = yml.slice(0, yml.indexOf("jobs:"));
  assert.match(head, /^\s*schedule:/m, "크론 트리거가 없다");
  assert.match(head, /^\s*workflow_dispatch:/m, "손으로 돌릴 수 있는 트리거가 없다");
});
