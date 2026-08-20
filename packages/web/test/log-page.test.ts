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
  return { scheduled: 6, played: 6, notPlayed: 0, withPa: 6, upcoming: 0, ...over };
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
    quarantine: [],
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

test("⚠日程にはあるのに結果が入っていない日を「試合なし」と同じ顔にしない — 감사 ①", () => {
  // context() 의 생성일은 2026-08-15 다
  const out = renderLogPage(
    data({
      coverage: [
        // 생성일 당일 — 아직 치르지 않았다. **경고가 아니다**
        day({ date: "2026-08-15", scheduled: 0, played: 0, withPa: 0, upcoming: 6 }),
        // 어제 — 일정에는 있는데 결과가 없다. **이것이 조용한 실패다**
        day({ date: "2026-08-14", scheduled: 0, played: 0, withPa: 0, upcoming: 6 }),
        // 휴장 — 일정에도 없다
        day({ date: "2026-08-13", scheduled: 0, played: 0, withPa: 0, upcoming: 0 }),
      ],
    }),
    context(),
  );
  // ⚠「[^]」로 쓴다 — 템플릿 리터럴 안에서는 역슬래시 이스케이프가 먼저 먹혀 [\s\S] 가 [sS] 가 된다
  // ⚠**표의 칸에서 찾는다** — 구획 제목의 「2026年8月15日までの3日」이 먼저 걸린다
  const rowOf = (d: string): string =>
    new RegExp(`<td class="l">${d}</td>[^]{0,300}?</tr>`).exec(out)?.[0] ?? "";
  const missing = rowOf("2026年8月14日");
  assert.ok(missing.includes('class="l bad"'), "결과가 안 들어온 날이 경고로 안 보인다");
  assert.match(missing, /未取得（予定6試合の結果が入っていません）/);

  const today = rowOf("2026年8月15日");
  assert.ok(!today.includes('class="l bad"'), "생성일 당일을 결함으로 칠했다");
  assert.match(today, /6試合予定（結果はこれから）/);

  const off = rowOf("2026年8月13日");
  assert.ok(!off.includes('class="l bad"'), "휴장일이 결함으로 칠해졌다");
  assert.match(off, /試合なし/);
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

test("격리 0건을 「화면이 없는 것」과 구별해 말한다", () => {
  const out = renderLogPage(data(), context());
  // ⚠「이상 없음」만 쓰면 화면이 있는지 없는지 알 수 없다. 무엇을 셌는지 함께 말한다
  assert.ok(out.includes("規則の外にあった記録は<b>0件</b>です"));
  assert.match(out, /判断待ちの記録/);
});

test("⚠격리에는 원문이 함께 나온다 — 「3건」만으로는 무엇을 정할지 모른다", () => {
  const out = renderLogPage(
    data({
      totals: { games: 632, pa: 46899, players: 695, quarantine: 3 },
      quarantine: [
        {
          kind: "unknownToken",
          count: 3,
          samples: [{ raw: "謎の記号", detail: "打席3", gameId: "2026/0814/b-f-19" }],
        },
      ],
    }),
    context(),
  );
  assert.match(out, /unknownToken/);
  assert.match(out, /謎の記号/, "원문이 화면에 없다");
  assert.match(out, /判断待ちの一覧/, "불구합 목록으로 읽히면 안 된다");
});

test("⚠격리를 실패로 칠하지 않는다 — 버그가 아니라 판단 요청이다", () => {
  const out = renderLogPage(
    data({
      totals: { games: 1, pa: 1, players: 1, quarantine: 1 },
      quarantine: [{ kind: "paMismatch", count: 1, samples: [{ raw: "x", detail: null, gameId: null }] }],
    }),
    context(),
  );
  const from = out.indexOf('id="b-quarantine"');
  const section = from < 0 ? "" : out.slice(from, out.indexOf("</section>", from));
  assert.ok(section.length > 0, "격리 블록이 없다");
  assert.ok(!section.includes('class="l bad"'), "격리를 실패색으로 칠했다");
});
