/**
 * 주자 상황 스플릿의 **이름**.
 *
 * ⚠**여기서 잡는 것은 값이 아니라 뜻이다.** 이 축은 값도 분모도 맞는데 이름 하나가 틀려서
 * 화면이 거짓을 말하고 있었고, **값이 맞으니 타입도 린트도 M2 도 못 잡았다**(2026-08-21 감사 P1).
 *
 * 분할은 `packages/aggregate/src/splits.ts` 의 CASE 가 정한다 — 세 칸이 **서로 배타적**이다:
 *   `empty`   = `bases = ''`                      → 주자 없음
 *   `scoring` = `bases LIKE '%2%' OR '%3%'`       → 2루 또는 3루 = 득점권
 *   `onBase`  = 그 밖                              → **1루만**
 *
 * 실측(감사 · DB 전수): `bases` 값 집합은 정확히 8개이고
 * `'' 318,069 / 1 102,437 / 2 46,939 / 12 39,866 / 13 15,617 / 3 13,839 / 23 12,223 / 123 14,843`.
 * 표준 어의의 「走者あり」는 **245,764** 인데 `onBase` 가 담는 것은 **102,437(41.7%)** 뿐이다.
 * 그래서 「走者あり」라고 부르면 **부분집합인 得点圏(143,327)이 더 큰 분모**를 갖는다 —
 * 배포물에서 그 모순이 보이는 페이지가 **4,152장**이었다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { splitLabel } from "../src/query.ts";
import { BASE_LABEL } from "../src/game-page.ts";

/** 타자 표(`allowed=false`)와 투수 표(`allowed=true`) 둘 다 본다 — 갈리면 화면마다 다른 말을 한다 */
const SIDES = [false, true] as const;

test("⚠「1루만」을 「주자 있음」이라고 부르지 않는다 — 부분집합이 전체보다 큰 분모를 갖게 된다", () => {
  for (const allowed of SIDES) {
    const onBase = splitLabel("base", "onBase", allowed);
    assert.ok(
      !onBase.includes("走者あり"),
      `${allowed ? "투수" : "타자"} 표의 onBase 가 「走者あり」다 — 得点圏을 포함하지 않는데 그렇게 읽힌다: ${onBase}`,
    );
    assert.equal(onBase, "一塁のみ", `${allowed ? "투수" : "타자"} 표의 onBase 이름이 다르다`);
  }
});

test("세 칸이 서로 다른 이름을 갖는다 — 같은 이름이 둘이면 분할이 아니다", () => {
  for (const allowed of SIDES) {
    const names = ["empty", "onBase", "scoring"].map((k) => splitLabel("base", k, allowed));
    assert.equal(new Set(names).size, 3, `이름이 겹쳤다: ${names.join(" / ")}`);
  }
});

/**
 * ⚠**정답 이름을 이 저장소가 이미 갖고 있었다**(M1). `BASE_LABEL` 이 `bases === "1"` 을
 * 「一塁」로 부른다 — 새 이름은 그 어법에서 벗어나지 않아야 한다.
 * 이 시험이 없으면 언젠가 경기 화면과 스플릿 표가 같은 상태를 다르게 부른다.
 */
test("⚠경기 화면의 어법과 어긋나지 않는다 — 같은 상태를 두 이름으로 부르지 않는다", () => {
  assert.equal(BASE_LABEL["1"], "一塁", "경기 화면의 정본 표기가 바뀌었다 — 스플릿 이름도 같이 봐라");
  for (const allowed of SIDES) {
    assert.ok(
      splitLabel("base", "onBase", allowed).startsWith(BASE_LABEL["1"]!),
      "스플릿 이름이 경기 화면의 「一塁」 어법에서 벗어났다",
    );
  }
});

test("다른 축은 건드리지 않았다 — 좌우·홈원정의 뜻은 표마다 다르다", () => {
  assert.equal(splitLabel("hand", "left", false), "対左投手", "타자 표의 좌우가 바뀌었다");
  assert.equal(splitLabel("hand", "left", true), "対左打者", "투수 표의 좌우가 바뀌었다");
  assert.equal(splitLabel("homeAway", "away", false), "ビジター");
});
