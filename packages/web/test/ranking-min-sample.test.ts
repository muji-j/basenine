/**
 * **「最少○○」를 아무리 올려도 답이 나오는가** — DB 로 재서 못 박는다.
 *
 * ⚠**이 시험이 생긴 이유**(2026-08-20): 순위표는 패널마다 **규정 상위 30 ∪ 전원 상위 30**만
 * 싣고, 최소 표본 입력은 **이미 실린 행 안에서만** 거른다. 그래서 이런 선수가 두 화면 어디에도
 * 없었다 — 규정에 못 미쳐 규정 상위 30 밖이고, 표본이 작은 선수들에게 밀려 전원 상위 30 에도
 * 못 든다. **하한을 아무리 올려도 안 나온다. 하한 기능이 노리던 바로 그 선수다.**
 *
 * 실측(고치기 전 · 9시즌 18 리그-시즌 · 하한을 실재 분모 전량으로 훑음):
 * 입력이 붙는 **23개 지표가 전부** 걸렸고(414 패널-리그-시즌 중 **144**),
 * 가장 나쁜 자리는 **상위 10 중 4명**이 화면에 없었다(2024 パ 救援 BB/9 · 하한 120아웃 ·
 * 그때의 보증 수 `RANKING_MIN_TOP = 10` 기준).
 * 재현 절차는 `scripts/ranking-cut-measure.ts`.
 *
 * ## 이 시험의 규약
 *
 * ⚠**기대값을 손으로 적지 않는다**(`scripts/test/doc-figures.test.ts` 와 같은 결).
 * 「누가 상위 N 인가」를 **DB 에서 다시 세어** 화면이 고른 행과 맞댄다 —
 * 손으로 적으면 시험과 화면이 같이 낡고, 그건 검사가 아니라 복사다.
 * ⚠**N 은 `RANKING_MIN_TOP` 이 정한다** — 이 파일 어디에도 그 수를 손으로 적지 않는다.
 *
 * ⚠**하한을 임의의 격자(30·50·70…)로 훑지 않는다.** 답이 바뀌는 지점은 **패널에 실재하는
 * 분모 값**뿐이므로 그 전부를 훑는다. 격자로 재면 「그 격자에서는 괜찮다」밖에 말할 수 없다 —
 * 실제로 처음 보고된 실측이 `防御率` 한 패널 × 다섯 격자였고, **어느 패널이 걸리는지가 달랐다.**
 *
 * ⚠**개수 지표(홈런·세이브·도루)는 대상이 아니다** — 자격 기준이 없어 입력칸 자체가 안 그려진다
 * (`minTop === null`). 거기도 「상위 N 이 빠지는 하한」은 있지만(실측 165건) **아무 조작으로도
 * 닿을 수 없으므로** 행을 넓혀 봐야 바이트만 는다. 「0건」이 아니라 **「기능이 없다」**이고,
 * 그 구별을 아래 시험이 수로 남긴다(작업규칙 7).
 *
 * ⚠**대회 경계**: `loadSite` 의 기본값이 `regular` 다(§2-1).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { openDb } from "@bb-app/store";
import { RANKING_MIN_TOP, RANKING_PAGE_ROWS, loadSite, rankingRowsFor } from "../src/query.ts";
import type { RankingRow } from "../src/player-page.ts";

const DB = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "data", "bb.sqlite");
const HAS_DB = existsSync(DB);
if (process.env["BB_REQUIRE_DB"] === "1" && !HAS_DB) {
  throw new Error(`BB_REQUIRE_DB=1 인데 ${DB} 가 없다`);
}
/**
 * ⚠**기본은 한 시즌, 깊은 실행은 전 시즌.**
 * `loadSite` 1회가 실측 약 30초라, 9시즌을 기본으로 두면 이 파일 하나가 스위트를 두 배로 만든다.
 *
 * ## ⚠이름이 `BB_FULL_SCAN` 이 아니다 — 한 값이 서로 다른 두 가지를 켜고 있었다 (2026-08-31)
 *
 * `BB_FULL_SCAN` 은 **두 뜻을 겸하고 있었다**: `topbar-consistency`·`steal-note-dist` 의
 * **페이지 표본**(디렉터리당 12장 → 전수)과, 이 파일·`woba-weights-wired` 의 **시즌 범위**(1 → 9).
 * ⚠**그런데 그 값을 켠 근거로 적힌 것은 페이지 쪽뿐이었다** — 「그물이 3.4%면 통과가
 * 아무것도 뜻하지 않는다」. 시즌 쪽은 **딸려 왔고 근거가 따로 적힌 적이 없다.**
 *
 * ⚠**비용은 딸려 온 쪽에서 나왔다**(CI 로그 실측 · run 33379836307):
 * 시험 490초 중 **이 본이 145.0초 · `woba-weights-wired` 가 150.7초 = 60%** 이고,
 * 페이지 쪽 둘은 상위 15본에 들지도 않는다(CI 는 직전 단계가 dist 를 방금 써서 캐시가 따뜻하다).
 * ⚠**로컬 시간으로 판단하지 마라** — 같은 날 로컬에서 가장 느린 것은 `배포물에 HTML 주석이 없다`
 * (144초)였는데 **CI 에서는 6.0초**다. 디스크가 다르면 순위가 뒤집힌다.
 *
 * ⚠**그래서 갈랐다.** 페이지 표본은 매 실행 전수(근거가 있고 싸다) · 시즌은 **하루 한 번**.
 * 정당화는 **완결 시즌은 얼어 있다**는 것이다 — 2018~2025 는 스케줄 실행 사이에 바뀌지 않으므로
 * 하루 90번 다시 재는 것은 검사가 아니라 반복이다. **바뀌는 것은 진행 중 시즌 하나**이고
 * 그건 매 실행 검사한다(기본값이 최신 시즌이다).
 * ⚠**수동 실행은 언제나 전수다** — 그때는 코드가 바뀌었을 가능성이 높고, 코드는 전 시즌에 걸린다.
 */
const FULL = process.env["BB_ALL_SEASONS"] === "1";

/** 어느 시즌을 볼 것인가 — **DB 에 물어본다.** 목록을 손으로 적으면 백필할 때 낡는다 */
function seasonsToScan(db: ReturnType<typeof openDb>): number[] {
  const rows = db.raw
    .prepare(
      `SELECT season AS s, COUNT(*) AS n FROM game
        WHERE competition = 'regular' AND status = 'played'
        GROUP BY season HAVING n > 100 ORDER BY season`,
    )
    .all() as unknown as { s: number; n: number }[];
  const all = rows.map((r) => Number(r.s));
  assert.ok(all.length > 0, "정규시즌이 하나도 없다 — 이 시험이 공회전한다");
  // 한 시즌만 볼 때는 **가장 최근**을 본다. 진행 중이어도 상관없다 — 재는 것은 고르는 규칙이다
  return FULL ? all : [all.at(-1)!];
}

interface Miss {
  where: string;
  min: number;
  who: string;
  rankAll: number;
  den: number;
}

/**
 * 한 패널을 훑는다.
 *
 * 분모가 큰 쪽부터 행을 넣으면서 **「지금까지 넣은 것 중 전원 순위가 가장 좋은 k개」**를 들고 간다.
 * 어떤 분모 값까지 다 넣은 시점의 그 k개가 곧 **「하한 = 그 분모」에서의 참 상위 k**다.
 * → 하한을 하나씩 다시 계산할 필요가 없다. O(행 × k).
 *
 * ⚠**구현이 `everTop`(query.ts)과 일부러 다르다.** 저쪽은 「나를 밀어낸 행이 k개 이상인가」를
 * 세고, 여기는 **각 하한에서의 상위 k를 실제로 만들어 본다.** 같은 알고리즘을 두 번 쓰면
 * 같은 착각을 두 번 하게 된다.
 */
function sweep(where: string, rows: readonly RankingRow[], k: number, shown: ReadonlySet<string>): {
  misses: Miss[];
  thresholds: number;
} {
  const withValue = rows.filter((r) => r.rankAll !== null);
  const byDen = [...withValue].sort(
    (a, b) => b.value.denominator - a.value.denominator || (a.rankAll ?? 0) - (b.rankAll ?? 0),
  );
  const best: RankingRow[] = [];
  const put = (r: RankingRow): void => {
    let p = best.length;
    best.push(r);
    while (p > 0 && (best[p - 1]!.rankAll ?? 0) > (r.rankAll ?? 0)) {
      best[p] = best[p - 1]!;
      p -= 1;
    }
    best[p] = r;
    if (best.length > k) best.length = k;
  };

  const misses: Miss[] = [];
  let thresholds = 0;
  let i = 0;
  while (i < byDen.length) {
    const min = byDen[i]!.value.denominator;
    while (i < byDen.length && byDen[i]!.value.denominator === min) put(byDen[i++]!);
    thresholds += 1;
    for (const r of best) {
      if (shown.has(r.playerId)) continue;
      misses.push({ where, min, who: `${r.name}(${r.playerId})`, rankAll: r.rankAll ?? 0, den: r.value.denominator });
    }
  }
  return { misses, thresholds };
}

/**
 * 두 방향을 **한 번의 `loadSite` 로** 잰다.
 *
 * ⚠**나누면 30초가 두 번이다**(`gidp-by-team.test.ts` 가 같은 이유로 그렇게 한다).
 * 재는 것이 같은 산출물이므로 한 시험에 담되, **실패했을 때 어느 방향인지** 메시지가 말한다:
 * ① 하한을 올려도 답이 나오는가 · ② 그러느라 표가 부풀지 않았는가.
 * ②가 없으면 ①은 「전부 실으면 통과」다 — 그러면 페이지가 두 배가 되고 아무도 못 잡는다.
 */
test(
  "⚠어느 최소 표본을 넣어도 상위 N이 표 안에 있고, 그러느라 표가 부풀지도 않았다(실DB)",
  { skip: HAS_DB ? false : "DB 없음" },
  () => {
    const db = openDb(DB, "1970-01-01T00:00:00.000Z");
    try {
      const misses: Miss[] = [];
      let panels = 0;
      let skipped = 0;
      let thresholds = 0;
      /**
       * **행 수의 예산.**
       *
       * ⚠**공식이 아니라 재서 넣은 수다.** 여유를 좁게 잡는 이유는
       * **느슨한 천장은 아무것도 안 막기 때문**이다.
       * ⚠~~실측(2026-08-20 · `RANKING_PAGE_ROWS = 30`): 평균 34.6행 · 최대 52행~~ 은
       * **상한을 50 으로 올리기 전 값이다**(2026-08-31). 지금 값은 아래에 적었다.
       * ⚠`RANKING_MIN_TOP` 을 올리면 **여기가 먼저 떨어진다**(실측 k=20 → 최대 60 · k=30 → 72).
       * 그것은 고장이 아니라 **바이트를 다시 재라는 물음**이다 — 재고 이 수를 같이 고쳐라.
       */
      /**
       * ⚠**60 이었다 → 70**(2026-08-31 · `RANKING_PAGE_ROWS` 를 30 → 50 으로 올리면서).
       * **이 시험이 물은 대로 바이트를 다시 쟀다**: `ranking.html` brotli **38 → 50.1KB**.
       * 실측(9시즌 · 상한 50): 평균 **51.7행** · 최대 **61행**(패널 84개) — 60 을 1 넘었다.
       *
       * ⚠**「어차피 늘어날 테니 넉넉히」로 올리지 마라.** 여유를 좁게 잡는 이유가
       * 「느슨한 천장은 아무것도 안 막는다」이고, 그건 지금도 그대로다.
       * 70 은 **실측 61 에 여유 9**이지 어림수가 아니다.
       * ⚠**이 화면의 무게는 별개로 남아 있다** — 사용자가 실기 체감 뒤 판단하기로 했다.
       */
      const CEILING = 70;
      const fat: string[] = [];
      let allPanels = 0;
      let allRows = 0;

      for (const season of seasonsToScan(db)) {
        /**
         * ⚠**고르기 전 전량을 받는다.** 고른 뒤의 표만 보면 「없는 사람이 왜 없는지」를
         * 물을 수 없다 — 표 안에는 안 적혀 있기 때문이다.
         */
        const site = loadSite(db, {
          season,
          builtOn: "1970-01-01",
          rankingRows: Number.POSITIVE_INFINITY,
        });
        for (const lg of site.ranking.leagues) {
          for (const cat of lg.categories) {
            for (const p of cat.panels) {
              const where = `${season} ${lg.id}/${cat.id}/${p.id}`;
              const picked = rankingRowsFor(p.rows, RANKING_PAGE_ROWS);
              allPanels += 1;
              allRows += picked.length;
              // ② 기록이 있는 선수가 애초에 그보다 적으면 자란 것이 아니다
              if (picked.length > CEILING && picked.length < p.allCount) {
                fat.push(`${where}: ${picked.length}행`);
              }
              // 입력칸이 없는 패널(개수 지표)은 좁히기 자체가 없다 — 「걸림」이 아니라 「기능 없음」
              if (p.minTop === null) {
                skipped += 1;
                continue;
              }
              const valued = p.rows.filter((r) => r.rankAll !== null).length;
              assert.equal(
                valued,
                p.allCount,
                `${where}: 전량이 안 왔다(${valued} vs ${p.allCount}) — ` +
                  "rankingRows 를 무한으로 줬는데도 잘렸다면 이 시험은 잘린 표를 잘린 표와 맞대는 셈이다",
              );
              /**
               * ⚠**보증 수가 상수를 따라오는가.** 시험이 수를 손으로 들고 있으면
               * `RANKING_MIN_TOP` 을 올려도 **예전 약속만 검사하고 초록**이 된다.
               * 아래 훑기는 `p.minTop` 을 그대로 쓰고, 그 수가 정본과 같은지를 여기서 못 박는다.
               */
              assert.equal(
                p.minTop,
                Math.min(RANKING_MIN_TOP, RANKING_PAGE_ROWS),
                `${where}: 보증 수가 상수에서 안 나왔다`,
              );
              const shown = new Set(picked.map((r) => r.playerId));
              const got = sweep(where, p.rows, p.minTop, shown);
              misses.push(...got.misses);
              thresholds += got.thresholds;
              panels += 1;
            }
          }
        }
      }

      // ⚠**공회전 방지**(작업규칙 8). 「0건」과 「안 쟀음」을 가른다
      assert.ok(panels >= 20, `입력이 붙는 패널을 ${panels}개밖에 못 봤다 — 이 시험이 공회전한다`);
      assert.ok(skipped >= 10, `입력이 없는 패널이 ${skipped}개뿐이다 — 패널 목록을 못 읽었다`);
      assert.ok(thresholds >= 1000, `하한을 ${thresholds}개밖에 안 훑었다 — 이 시험이 공회전한다`);

      // ① 하한을 올려도 답이 나오는가
      assert.deepEqual(
        misses
          .slice(0, 20)
          .map((m) => `${m.where} 最少${m.min}: ${m.who} 전원${m.rankAll}위·분모${m.den} 가 표에 없다`),
        [],
        `①하한을 올리면 답이 사라지는 자리가 ${misses.length}건 있다. ` +
          "고칠 곳은 순위 정의가 아니라 **싣는 행**이다(query.ts 의 `rankingRowsFor`/`everTop`) — " +
          "새 순위를 만들면 동률 규칙이 두 벌이 된다(M1·M3).",
      );

      // ② 그러느라 표가 부풀지 않았는가
      assert.deepEqual(
        fat.slice(0, 20),
        [],
        `②한 패널이 ${CEILING}행을 넘었다(평균 ${(allRows / allPanels).toFixed(1)}행 · 패널 ${allPanels}개). ` +
          "행이 늘면 `ranking.html` 이 그대로 커진다 — 넓히는 규칙을 다시 보라",
      );
    } finally {
      db.close();
    }
  },
);
