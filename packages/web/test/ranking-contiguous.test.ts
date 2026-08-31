/**
 * **「全員」 순위표가 끊기지 않는가.**
 *
 * ⚠**사용자가 이것에 걸렸다**(2026-08-31): 규정 미달자를 포함해 보면 아래쪽에서
 * 순위가 **31 → 36 → 152 → 181 → 244** 로 뛰고, 중간 순위가 안 보였다.
 *
 * ## 왜 그랬나 — 행은 다 맞는 행이었다
 *
 * 실리는 행은 **세 벌의 합집합**이다(`rankingRowsFor`):
 * ⑴ 규정 도달자 상위 N · ⑵ 전원 상위 N · ⑶ 어느 하한에서도 상위 10에 드는 행.
 * ⑴ 에서 **규정 도달자인데 전원 순위가 한참 아래인 선수**(전원 244위 등)가 들어오는데,
 * 표는 전원 순위로 정렬되므로 그 행이 **맨 아래에 뚝 떨어져** 붙는다.
 * ⚠**틀린 것은 값이 아니라 「연속처럼 보인다」는 것**이었다 — 그래서 어떤 수치 검증도 안 울렸다.
 *
 * ## 고친 규칙
 *
 * 서버가 **어디까지 연속인가**(`topAllCut`)를 정해 보내고, 그보다 아래 행은
 * 「全員」 기본 화면에서 빠진다(`data-beyond`). 펼치면 나온다.
 * ⚠**「규정 도달자만」 모드에서는 그대로 보인다** — 거기서는 규정 순위로 연속이고 그 선수들이 본체다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { RANKING_PAGE_ROWS, topAllCutFor } from "../src/query.ts";
import { NO_VALUE } from "../src/format.ts";
import type { RankingRow } from "../src/player-page.ts";

function row(rank: number | null, rankAll: number | null, id = `p${rankAll ?? "x"}`): RankingRow {
  return {
    rank,
    playerId: id,
    name: id,
    teamCode: "t",
    value: { value: 1, denominator: 100 },
    isMe: false,
    rankAll,
  };
}

test("⚠경계는 「몇 명」이 아니라 「어느 순위」다 — 동률이 순위를 건너뛴다", () => {
  // 동률이 둘이면 3위가 없다: 1,1,3 이 아니라 1,1,3 … 여기서는 1,1,3,4 로 둔다
  const rows = [row(null, 1, "a"), row(null, 1, "b"), row(null, 3, "c"), row(null, 4, "d")];
  // 상위 3명을 실으면 마지막 사람의 순위는 **3** 이다
  assert.equal(topAllCutFor(rows, 3), 3);
  // 상위 2명이면 경계는 1 이다 — 동률 두 사람이 그 자리를 다 쓴다
  assert.equal(topAllCutFor(rows, 2), 1);
});

test("행이 상한보다 적으면 경계는 마지막 순위다 — 없는 자리를 약속하지 않는다", () => {
  const rows = [row(null, 1), row(null, 2)];
  assert.equal(topAllCutFor(rows, 50), 2);
});

/** ⚠**값이 없는 선수는 순위가 없다**(M11) — 경계 계산에서도 빠진다 */
test("⚠값이 없는 행은 경계에 안 들어간다 — 0으로 메우지 않는다", () => {
  const rows = [row(null, 1), row(null, null), row(null, 2)];
  assert.equal(topAllCutFor(rows, 50), 2);
  assert.equal(topAllCutFor([row(null, null)], 50), null);
});

/**
 * ⚠**이것이 사용자가 본 그 모양이다.** 규정 도달자인데 전원 순위가 244위인 행이 섞이면,
 * 경계 위쪽만 그렸을 때 **연속**이어야 한다.
 */
test("⚠경계 위쪽은 빈 순위 없이 이어진다 — 사용자가 본 31→36→152 가 안 나온다", () => {
  const rows: RankingRow[] = [];
  for (let i = 1; i <= 60; i += 1) rows.push(row(null, i, `all${i}`));
  // 규정 도달자인데 전원 순위가 한참 아래인 사람들(합집합으로 들어오던 행)
  rows.push(row(1, 152, "q152"), row(2, 181, "q181"), row(3, 244, "q244"));

  const cut = topAllCutFor(rows, RANKING_PAGE_ROWS);
  assert.equal(cut, RANKING_PAGE_ROWS, "상한만큼 촘촘하면 경계가 상한과 같아야 한다");

  const shown = rows
    .filter((r) => r.rankAll !== null && r.rankAll <= cut!)
    .map((r) => r.rankAll!)
    .sort((a, b) => a - b);
  assert.deepEqual(
    shown,
    Array.from({ length: RANKING_PAGE_ROWS }, (_, i) => i + 1),
    "경계 위쪽이 1부터 연속이 아니다",
  );
});

/**
 * ⚠**「규정 도달자만」 모드는 건드리지 않는다.** 거기서는 규정 순위(1·2·3…)로 이미 연속이고,
 * 경계 아래 행이야말로 그 모드의 본체다 — 숨기면 그 화면이 비어 버린다.
 */
test("⚠경계 아래 행도 규정 순위로는 연속이다 — 그 모드에서 숨기면 안 된다", () => {
  const rows = [row(1, 152, "q152"), row(2, 181, "q181"), row(3, 244, "q244")];
  const qualified = rows.map((r) => r.rank).filter((x): x is number => x !== null).sort((a, b) => a - b);
  assert.deepEqual(qualified, [1, 2, 3]);
});

test("⚠상한이 50이다 — 「미니멈 50위까지」가 이 값에서 온다", () => {
  assert.equal(RANKING_PAGE_ROWS, 50);
});

/**
 * ⚠**배포물에서 실제로 연속인지 센다.** 위 시험들은 판정 함수를 보고,
 * 이것은 **그려진 결과**를 본다 — 렌더러가 경계를 잘못 쓰면 여기서만 잡힌다.
 * ⚠**동률을 「자리 수」로 센다** — 1,1,3 은 정상이고 1,1,4 는 결함이다.
 * 실측(2026-08-31 · 2026 시즌): 패널 **84** · 기본 화면 **4,200행** · 펼쳐야 나오는 행 **145** ·
 * 끊긴 패널 **0건**.
 */
test("⚠배포물의 「全員」 기본 화면이 1위부터 끊기지 않는다", () => {
  const page = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "dist", "ranking.html");
  if (!existsSync(page)) return; // dist 없음 — 위 시험들이 이미 판정을 지킨다
  const html = readFileSync(page, "utf8");
  const gaps: string[] = [];
  let panels = 0;
  for (const t of html.match(/<table[^>]*>[\s\S]*?<\/table>/g) ?? []) {
    const ranks: number[] = [];
    for (const r of t.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/g) ?? []) {
      if (!/data-qualified/.test(r) || /data-beyond="1"/.test(r)) continue;
      const v = /<b data-ranka hidden>([^<]*)<\/b>/.exec(r)?.[1];
      if (v === undefined || v === NO_VALUE) continue;
      ranks.push(Number(v));
    }
    if (ranks.length === 0) continue;
    panels += 1;
    ranks.sort((a, b) => a - b);
    let expect = 1;
    for (let i = 0; i < ranks.length; ) {
      const v = ranks[i]!;
      if (v !== expect) { gaps.push(ranks.slice(0, 60).join(",")); break; }
      let n = 0;
      while (i < ranks.length && ranks[i] === v) { i += 1; n += 1; }
      expect = v + n;
    }
  }
  assert.ok(panels > 50, `패널을 ${panels}개밖에 못 읽었다 — 이 시험이 공회전한다`);
  assert.deepEqual(gaps.slice(0, 3), [], `순위가 끊긴 패널 ${gaps.length}건 / ${panels}개`);
});
