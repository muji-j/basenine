/**
 * **규정타석 경계를 실데이터로 검산한다.**
 *
 * ⚠**픽스처는 내가 만든 세계라 내 오해가 그대로 통과한다.** `aggregate.test.ts` 의 규정타석 시험은
 * 10경기·6경기짜리 손수 만든 세계에서 31·19 를 확인하는데, **10 과 6 은 둘 다 끝수가
 * `切り上げ` 와 `四捨五入` 에서 같은 답을 내는 자리**라 결함을 통과시켰다(31·19 는 양쪽이 같다).
 * 결함이 사는 곳은 **`팀 경기수 mod 10 ∈ {1,2,3,4}`** 이고, 143경기 시즌이 정확히 거기다.
 *
 * ⚠**이 파일이 재는 것은 「우리 계산끼리 앞뒤가 맞는가」가 아니다.** 1위·2위·자격자 수는
 * **npb.jp 가 공표한 사실**이고, 우리 값이 거기에 맞는지를 본다. 그래서 이 시험은
 * 우리가 규칙을 잘못 이해하면 **떨어진다** — 예전 시험은 구현과 같은 식을 기댓값으로 써서
 * 구현이 무엇이든 통과했고, 그래서 1,087본이 이 P0 를 놓쳤다.
 *
 * ⚠**DB 가 없으면 건너뛴다**(개발자 머신마다 상태가 다르다). CI 는 `BB_REQUIRE_DB=1` 로 막는다 —
 * 「0건 통과」와 「안 쟀음」을 가른다(작업규칙 7·8).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import type { Db } from "@bb-app/store";
import { aggregateSeason } from "../src/season.ts";
import {
  battingEntries,
  buildLeagues,
  isQualifiedBatter,
  neededPa,
  rankBatters,
  teamGamesOf,
} from "../src/leaderboard.ts";
import type { BattingEntry, LeagueBundle } from "../src/leaderboard.ts";
import type { League } from "@bb-app/domain";

const DB = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "data", "bb.sqlite");
const HAS_DB = existsSync(DB);
if (process.env["BB_REQUIRE_DB"] === "1" && !HAS_DB) {
  throw new Error(`BB_REQUIRE_DB=1 인데 ${DB} 가 없다`);
}

/**
 * **읽기 전용 핸들.** `openDb` 는 마이그레이션을 쓰므로 검산에 쓰지 않는다 —
 * 시험이 DB 를 고치면 그 시험은 더 이상 「지금 있는 데이터」를 재는 것이 아니다.
 * `aggregateSeason` 이 쓰는 것은 `raw` 뿐이고, 쓰기 경로는 불러도 던지게 둔다.
 */
function openReadOnly(): Db {
  const raw = new DatabaseSync(DB, { readOnly: true });
  return {
    raw,
    transaction<T>(): T {
      throw new Error("읽기 전용 핸들이다 — 검산 시험은 DB 를 쓰지 않는다");
    },
    savepoint<T>(): T {
      throw new Error("읽기 전용 핸들이다 — 검산 시험은 DB 를 쓰지 않는다");
    },
    close: () => raw.close(),
  };
}

function bundleOf(db: Db, season: number, league: League): LeagueBundle | undefined {
  return buildLeagues(aggregateSeason(db, season)).find((b) => b.league === league);
}

/**
 * **정확히 규정타석에 멈춘 선수들.**
 *
 * 실측(2026-08-20 · DB 전수 5,474 선수-팀-시즌): 「`四捨五入` 으로는 자격 · `切り上げ` 로는 미달」인
 * 경계가 **이 4건뿐**이다. 넷 다 **143경기 팀의 443타석** — 143 × 3.1 = 443.3 이라
 * 올림이 444 를 내어 **1타석 차이로 8개 비율 순위 전부에서 빠져 있었다.**
 *
 * ⚠**`rank` 는 npb.jp 공표 순위와 대조한 것**이고, 나머지는 우리 DB 에서 온 값이다.
 * 이 둘을 섞어 적지 않는다 — 어느 것이 외부 사실인지 모르면 검산이 자기대조로 퇴화한다.
 */
interface Boundary {
  season: number;
  league: League;
  teamCode: string;
  playerId: string;
  name: string;
  /** 그 시즌 그 선수의 타석. **정확히 규정타석과 같다** */
  pa: number;
  /** 打率 부문에서 받아야 할 순위. `null` = 외부 공표값을 대조하지 않은 자리 */
  avgRank: number | null;
}

const BOUNDARIES: readonly Boundary[] = [
  { season: 2021, league: "pacific", teamCode: "e", playerId: "11015138", name: "辰己", pa: 443, avgRank: null },
  // npb.jp 2023 セ 打率 2位 .305(実測で我々も2位)
  { season: 2023, league: "central", teamCode: "c", playerId: "71475132", name: "西川", pa: 443, avgRank: 2 },
  { season: 2024, league: "central", teamCode: "c", playerId: "01405130", name: "野間", pa: 443, avgRank: null },
  // npb.jp 2025 パ 打率 1位 .304 — **여기가 화면의 타이틀이 바뀐 자리다**
  { season: 2025, league: "pacific", teamCode: "h", playerId: "61465133", name: "牧原", pa: 443, avgRank: 1 },
];

/**
 * ⚠**공회전 방지**(작업규칙 8). 시즌이 하나도 DB 에 없으면 아래 루프가 안 돌고
 * 시험이 **조용히 통과**한다 — 그러면 「전부 통과」가 「한 번도 안 쟀다」를 덮는다.
 */
test("⚠규정타석에 정확히 멈춘 4명이 자격자가 된다 — 143 × 3.1 = 443", { skip: !HAS_DB }, () => {
  const db = openReadOnly();
  let checked = 0;
  const missing: string[] = [];
  try {
    for (const b of BOUNDARIES) {
      const bundle = bundleOf(db, b.season, b.league);
      if (bundle === undefined) {
        missing.push(`${b.season} ${b.league}`);
        continue;
      }
      const entry = battingEntries(bundle).find((e) => e.player.playerId === b.playerId);
      assert.ok(entry, `${b.season} ${b.name}(${b.playerId}) 이 그 리그 타자 목록에 없다`);

      const where = `${b.season} ${b.name}`;
      // 입력을 먼저 못 박는다 — DB 가 달라지면 아래 판정이 아니라 여기서 붉어져야 한다
      assert.equal(entry.player.teamCode, b.teamCode, `${where}: 소속 구단이 다르다`);
      assert.equal(entry.player.line.pa, b.pa, `${where}: 타석이 다르다`);
      assert.equal(teamGamesOf(bundle, b.teamCode), 143, `${where}: 팀 소화 경기수가 143 이 아니다`);

      // 규칙과 그 결과
      assert.equal(
        neededPa(bundle, b.teamCode),
        443,
        `${where}: 규정타석이 443 이 아니다 — 143 × 3.1 = 443.3 의 四捨五入 는 443 이고, 444 는 切り上げ다`,
      );
      assert.equal(
        isQualifiedBatter(bundle, entry),
        true,
        `${where}: 443타석으로 규정에 도달했는데 미달로 판정됐다 — 기준이 1 높다`,
      );
      checked += 1;
    }
  } finally {
    db.close();
  }
  assert.deepEqual(missing, [], `DB 에 없는 시즌이 있다: ${missing.join(", ")}`);
  assert.equal(checked, BOUNDARIES.length, "경계 4건을 전부 재지 못했다 — 이 시험이 공회전한다");
});

/**
 * **화면의 타이틀이 실제로 바뀌는 자리.**
 *
 * npb.jp 2025 パ・リーグ 打率: **1位 牧原 .304**(443打席) · 2位 柳町 .292.
 * 우리는 牧原을 규정 미달로 떨어뜨려 **柳町 을 1위로 내보내고 있었다.**
 */
test("⚠2025 퍼시픽 打率 1위는 牧原이다 — npb.jp 공표", { skip: !HAS_DB }, () => {
  const db = openReadOnly();
  try {
    const bundle = bundleOf(db, 2025, "pacific");
    assert.ok(bundle, "2025 퍼시픽 번들이 없다");
    const ranked = rankBatters(bundle, battingEntries(bundle), (e: BattingEntry) => e.avg, true);
    const first = ranked.find((r) => r.rank === 1);
    assert.ok(first, "1위가 없다");
    assert.equal(
      first.item.player.playerId,
      "61465133",
      `1위가 ${first.item.player.displayName} 다 — 牧原(443打席)이 규정 미달로 밀려나 있다`,
    );
    assert.equal(first.item.player.line.pa, 443, "1위의 타석이 443 이 아니다");

    // 자격자 수도 공표값과 맞춘다 — 1위만 보면 「경계 1명이 들어왔다」를 「순서가 우연히 맞았다」와 못 가른다
    const qualified = ranked.filter((r) => r.rank !== null);
    assert.equal(qualified.length, 22, "npb.jp 2025 パ 打率 자격자는 22명이다");
  } finally {
    db.close();
  }
});

/**
 * **경계가 들어오면 그 아래가 한 칸씩 내려간다.** 1위만 재면 「끼어들었다」는 확인되지만
 * 「나머지가 제자리로 돌아갔다」는 확인되지 않는다.
 */
test("⚠2023 센트럴 打率에서 西川이 2위다 — 빠져 있으면 아래가 한 칸씩 올라간다", { skip: !HAS_DB }, () => {
  const db = openReadOnly();
  try {
    let checked = 0;
    for (const b of BOUNDARIES) {
      if (b.avgRank === null) continue;
      const bundle = bundleOf(db, b.season, b.league);
      assert.ok(bundle, `${b.season} ${b.league} 번들이 없다`);
      const ranked = rankBatters(bundle, battingEntries(bundle), (e: BattingEntry) => e.avg, true);
      const me = ranked.find((r) => r.item.player.playerId === b.playerId);
      assert.ok(me, `${b.season} ${b.name} 이 순위 목록에 없다`);
      assert.equal(
        me.rank,
        b.avgRank,
        `${b.season} ${b.name}: 打率 순위가 npb.jp 공표(${b.avgRank}위)와 다르다 — rank=${me.rank}`,
      );
      checked += 1;
    }
    assert.ok(checked >= 2, `외부 공표 순위를 대조한 건수가 ${checked} 다 — 2건 이상이어야 한다`);
  } finally {
    db.close();
  }
});
