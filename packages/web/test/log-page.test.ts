/**
 * 収集ログ 화면.
 *
 * ⚠**이 화면이 잡아야 하는 것은 「조용한 죽음」이다.** 크론이 안 도는 것과
 * 경기가 없는 것은 DB만 봐서는 같아 보이고, 성공 로그로도 구별되지 않는다.
 * 그래서 여기서 고정하는 것은 「예쁘게 나오는가」가 아니라 **둘을 구별해 말하는가**다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderLogPage } from "../src/log-page.ts";
import type { CoverageDay, LogPageData, RunRecord } from "../src/log-page.ts";
import { context } from "./fixtures.ts";

function day(over: Partial<CoverageDay> & { date: string }): CoverageDay {
  return { scheduled: 6, played: 6, notPlayed: 0, withPa: 6, ...over };
}

function run(over: Partial<RunRecord> = {}): RunRecord {
  return {
    ranAt: "2026-08-15T12:00:00.000Z",
    todayJst: "2026-08-15",
    latestGameDate: "2026-08-14",
    games: 632,
    pa: 46899,
    players: 695,
    noHand: 0,
    quarantine: 0,
    stale: false,
    ...over,
  };
}

function data(over: Partial<LogPageData> = {}): LogPageData {
  return {
    season: 2026,
    coverage: [day({ date: "2026-08-14" })],
    runs: [run()],
    archive: { files: 3354, bytes: 28_868_037, updatedAt: "2026-08-15T13:27:13.764Z" },
    totals: { games: 632, pa: 46899, players: 695, quarantine: 0 },
    politeness: { minDelayMs: 3000, concurrency: 1 },
    ...over,
  };
}

test("⚠「試合なし」와「取り込めていない」를 다른 말로 낸다 — 같은 화면이면 그게 결함이다", () => {
  const out = renderLogPage(
    data({
      coverage: [
        day({ date: "2026-08-14" }),
        // 휴장일 — 일정 자체가 0건이다. 경고가 아니다
        day({ date: "2026-08-10", scheduled: 0, played: 0, withPa: 0 }),
        // ⚠치러졌는데 타석 로그가 없다. 이건 진짜 결함이다
        day({ date: "2026-08-09", played: 6, withPa: 4 }),
      ],
    }),
    context(),
  );
  assert.match(out, /試合なし/);
  assert.match(out, /打席ログ2試合ぶん未取得/);
  // 휴장일에는 경고 표시가 붙지 않는다 — 붙이면 경고가 소음이 된다
  const holiday = /2026年8月10日[\s\S]{0,200}?<\/tr>/.exec(out)?.[0] ?? "";
  assert.ok(!holiday.includes('class="l bad"'), "휴장일이 결함으로 칠해졌다");
});

test("실행 기록이 없는 것과 0건인 것을 구별해 말한다(M12)", () => {
  const none = renderLogPage(data({ runs: [] }), context());
  assert.match(none, /実行の記録がまだありません/);
  assert.match(none, /記録なし/);

  const some = renderLogPage(data(), context());
  assert.ok(!some.includes("実行の記録がまだありません"));
  assert.match(some, /直近1回/);
});

test("⚠실행 시각을 JST로 읽어 준다 — 경기일은 JST인데 실행만 UTC면 사람이 헷갈린다", () => {
  const out = renderLogPage(
    data({ runs: [run({ ranAt: "2026-08-15T12:00:00.000Z" })] }),
    context(),
  );
  // 12:00 UTC = 21:00 JST
  assert.match(out, /2026-08-15 21:00/);
  assert.ok(!out.includes("2026-08-15T12:00"), "UTC 원문을 그대로 냈다");
});

test("낡은 실행은 그 사실이 보인다", () => {
  const out = renderLogPage(data({ runs: [run({ stale: true })] }), context());
  assert.match(out, /class="l bad">古い/);
});

test("격리가 있으면 눈에 띈다 — 버그가 아니라 판단 요청이다", () => {
  const out = renderLogPage(data({ runs: [run({ quarantine: 3 })] }), context());
  assert.match(out, /class="bad">3</);
  assert.match(out, /人が判断する/);
});

test("원본 아카이브가 없으면 0이 아니라 「—」다(M11)", () => {
  const out = renderLogPage(data({ archive: null }), context());
  assert.match(out, /原本アーカイブの記録がまだありません/);
  // ⚠칸을 0으로 채우면 「원본이 0건 있다」로 읽힌다. 없는 것은 「—」로 그린다
  assert.match(out, /原本保管<\/dt><dd class="v">—<\/dd>/);
  assert.match(out, /容量<\/dt><dd class="v">—<\/dd>/);

  const withArchive = renderLogPage(data(), context());
  assert.match(withArchive, /原本保管<\/dt><dd class="v">3,354<\/dd>/);
  assert.match(withArchive, /27\.5MB/);
});

test("⚠수집 규약을 화면이 코드에서 읽어 말한다 — 문서와 화면이 어긋나지 않게(L1)", () => {
  const out = renderLogPage(data(), context());
  assert.match(out, /1リクエストにつき3秒以上あけ、同時接続は1本/);
  assert.match(out, /1日1回/);
});

test("원본은 외부에 내보내지 않는다는 것을 말한다(L6)", () => {
  const out = renderLogPage(data(), context());
  assert.match(out, /原本は外に出しません/);
  assert.match(out, /独自に再計算/);
});

test("출처와 삭제·정정 창구가 있다(L3·L4)", () => {
  const out = renderLogPage(data(), context());
  assert.match(out, /npb\.jp/);
  assert.match(out, /削除・訂正/);
});

test("경기가 하나도 없으면 빈 상태를 말한다", () => {
  const out = renderLogPage(data({ coverage: [] }), context());
  assert.match(out, /まだ試合が入っていません/);
});
