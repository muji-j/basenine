/**
 * ⚠**아카이버가 받는 경기 페이지 목록과 적재기가 대조하는 목록은 같은 네 장이다**(2026-09-26 · 3중 검토 2차 F5).
 *
 * 아카이버는 `GAME_PAGES`(`packages/archiver/src/discover.ts`)를 `pageKey` 로 잎 이름(`index` · `playbyplay` …)에 옮겨
 * 세트로 기록하고, 적재기는 `GAME_PAGE_LEAVES`(`packages/store/src/page-integrity.ts`)로 무결성·세트를 대조한다.
 * 둘은 패키지가 달라 서로를 import 하지 않는다 — **한쪽에만 페이지를 더하면** 적재기가 새 페이지를 안 보거나
 * (세트 밖의 페이지가 조용히 섞인다) 아카이버가 안 받는 페이지를 찾는다.
 * 그래서 둘을 여기서 **순서까지** 맞댄다. 잎 이름은 `pageKey` 자체로 낸다 — 규칙을 여기서 다시 쓰지 않는다(M1).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { GAME_PAGES, pageKey } from "../../packages/archiver/src/discover.ts";
import { GAME_PAGE_LEAVES } from "../../packages/store/src/page-integrity.ts";

test("GAME_PAGES 를 pageKey 의 잎 이름으로 옮기면 GAME_PAGE_LEAVES 와 순서까지 같다", () => {
  const ref = { season: 2026, date: "2026-08-14", slug: "s-db-17", path: "/scores/2026/0814/s-db-17/", venue: null };
  const leaves = GAME_PAGES.map((page) => pageKey(ref, page).split("/").at(-1));
  assert.equal(leaves.length, 4, `아카이버 경기 페이지가 ${leaves.length}장이다`);
  assert.deepEqual(leaves, [...GAME_PAGE_LEAVES]);
});
