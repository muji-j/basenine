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
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
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

const NOW = "2026-08-19T00:00:00.000Z";
/** 빌드 기준일. **주입한다**(M6) — 시험이 시계를 읽으면 날마다 다른 시험이 된다 */
const BUILT_ON = "2026-08-19";

let seq = 0;

/**
 * 치러진 경기 한 개.
 *
 * ⚠**양 리그에 선수를 남긴다.** 리그 번들이 없으면 `teamPages` 가 그 리그의 팀을 통째로
 * 건너뛰어서, 「発表待ち」를 세는 자리 자체가 안 돈다.
 */
function played(db: Db, date: string, home: string, away: string): void {
  seq += 1;
  const gameId = `g${seq}`;
  upsertGame(db, {
    gameId, season: 2026, gameDate: date, awayCode: away, homeCode: home, gameNo: 1,
    status: "played", notPlayedReason: null, competition: "regular",
    sourceUrl: "https://npb.jp/x", fetchedAt: NOW, awayRuns: 1, homeRuns: 2,
  });
  upsertBatting(db, {
    gameId, playerId: `BAT_${home}`, side: "home", battingOrder: "1", position: "(遊)",
    pa: 4, ab: 4, h: 1, d2: 0, d3: 0, hr: 0, bb: 0, ibb: 0, hbp: 0,
    sf: 0, sh: 0, so: 0, roe: 0, runs: 0, rbi: 0, sb: 0,
  });
  upsertPitching(db, {
    gameId, playerId: `PIT_${away}`, side: "away", decision: null,
    outs: 21, bf: 28, pitches: 90, h: 5, hr: 0, bb: 2, hbp: 0, so: 7, runs: 1, er: 1, wp: 0, balk: 0,
  });
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

/**
 * @param games 팀당 치를 경기 수. `regularSeasonGames(2026) + 1` 을 주면
 *   성적이 스스로 어긋나 `disagreed` 가 채워진다(`isRecordSane` 의 상한 검사)
 */
async function withSite(
  o: { games: number; upcomingDate: string | null; probableDate: string | null },
  fn: (site: ReturnType<typeof loadSite>, warnings: string[]) => void,
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "bb-build-gates-"));
  const db = openDb(join(dir, "t.sqlite"), NOW);
  const original = console.warn;
  const warnings: string[] = [];
  try {
    // 세 리그(t·g)와 파 리그(l·m) 양쪽에 선수를 남긴다
    for (const c of ["t", "g", "l", "m"]) {
      upsertPlayer(db, `BAT_${c}`, `${c}打者`, NOW);
      upsertPlayer(db, `PIT_${c}`, `${c}投手`, NOW);
    }
    for (let i = 0; i < o.games; i += 1) {
      // 4월 1일부터 하루 한 경기씩. 144경기라도 8월 안에 들어간다
      const d = new Date(Date.UTC(2026, 3, 1) + i * 86_400_000).toISOString().slice(0, 10);
      played(db, d, "t", "g");
      // ⚠**파 리그는 항상 3경기다.** 어긋남을 센트럴에만 만들어야 「어긋난 팀만 잡히는가」를
      //   잴 수 있고, 144경기를 두 벌 만들지 않아 시험이 10초 이상 빨라진다(실측)
      if (i < 3) played(db, d, "l", "m");
    }
    if (o.upcomingDate !== null) {
      upcoming(db, o.upcomingDate, "t", "g");
      upcoming(db, o.upcomingDate, "l", "m");
    }
    if (o.probableDate !== null) {
      for (const [me, you, league] of [["t", "g", "central"], ["g", "t", "central"]] as const) {
        upsertProbablePitcher(db, {
          gameDate: o.probableDate, teamCode: me, opponentCode: you, playerId: `PIT_${me}`,
          sourceName: `${me}投手`, venue: "甲子園", startTime: "18:00", league,
          sourceUrl: "https://npb.jp/games/", fetchedAt: NOW,
        });
      }
    }
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
 * ⚠**이 검사는 소스를 글자로 읽는다.** `build.ts` 는 import 만으로 실행되는 스크립트라
 * 시험에서 그 가지만 태울 수 없고, 종료 코드로 재려 해도 **낡은 데이터·빈 시즌·깨진 링크가
 * 전부 같은 `1`** 이라 무엇 때문에 1인지 구별되지 않는다(픽스처 DB 는 반드시 낡았다).
 * 같은 이유로 이 리포에는 이미 글자로 읽는 검사가 있다(`assets-source.test.ts`).
 */
test("⚠어긋난 구단이 있으면 빌드가 실패한다 — 경고로 끝내지 않는다", () => {
  const src = readFileSync(join(import.meta.dirname, "..", "tools", "build.ts"), "utf8");
  const at = src.indexOf("raceDisagreed");
  assert.notEqual(at, -1, "빌드가 raceDisagreed 를 아예 안 본다");
  // 그 가지 안에서 종료 코드를 바꾸는가. `emptySeasons`·`stale` 과 같은 형식이다
  const region = src.slice(at, at + 800);
  assert.match(
    region,
    /process\.exitCode = 1/,
    "raceDisagreed 를 보긴 하는데 종료 코드를 안 바꾼다 — 경고만으로는 그대로 배포된다",
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
