/**
 * **경기 폴더 판별은 한 벌이다**(M1 · 설계 `docs/superpowers/specs/2026-09-26-catchup-partial-day-design.md` D2 · 감사 C10).
 *
 * 적재기(`tools/load-archive.ts`)가 어느 `box.html.gz` 를 경기로 적재하는가와, 수집 창(`scripts/update.ts`)이
 * 마지막 경기일의 어느 폴더를 「받아 둔 경기」로 세는가가 **같은 판정**이어야 한다. 갈리면 수집 창이 적재기가
 * 경기로 안 보는 폴더(`.staging` 같은 임의 이름)를 「덜 받음」으로 읽어 **매 실행 그 날을 다시 받거나**(L1),
 * 반대로 적재기가 경기로 보는 폴더를 빼고 세어 덜 받은 날을 놓친다.
 * ⚠판정은 적재기의 `gameFromPath` 에서 **그대로** 옮겼다 — 적재 결과를 바꾸지 않는다(팀 코드 정규화는 적재기에 남는다).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { gameFromBoxPath } from "../src/game-slug.ts";

/** ⚠줄끝을 `\n` 으로 맞춰 읽는다 — Windows 체크아웃은 CRLF 라 안 맞추면 거기서만 정규식이 떨어진다 */
function readLf(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8").replace(/\r\n/g, "\n");
}

/** 블록·행 주석을 걷어낸다(주석 속 낱말이 판정을 흐리지 않게). ⚠`://` 는 남긴다 */
function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(?<!:)\/\/[^\n]*/g, "");
}

const DAY = "data/archive/npb/scores/2026/0816";

test("D2 정상 경기 폴더 — game_id 는 슬러그 원문 그대로 · 날짜는 경로에서 · 슬러그는 {홈}-{원정}-{번호}", () => {
  assert.deepEqual(gameFromBoxPath(`${DAY}/b-f-21/box.html.gz`), {
    gameId: "2026/0816/b-f-21",
    season: 2026,
    gameDate: "2026-08-16",
    homeSlug: "b",
    awaySlug: "f",
    gameNo: 21,
  });
  // ⚠Windows 구분자도 같은 판정이다 — 옛 슬러그(2018 오릭스 `bs`)는 **원문 그대로** 돌려준다(정규화는 적재기 몫)
  assert.deepEqual(gameFromBoxPath("C:\\bb\\data\\archive\\npb\\scores\\2018\\0330\\h-bs-01\\box.html.gz"), {
    gameId: "2018/0330/h-bs-01",
    season: 2018,
    gameDate: "2018-03-30",
    homeSlug: "h",
    awaySlug: "bs",
    gameNo: 1,
  });
});

test("D2 조각이 2개인 슬러그는 경기가 아니다", () => {
  assert.equal(gameFromBoxPath(`${DAY}/b-21/box.html.gz`), null);
});

test("D2 마지막 조각이 수가 아닌 슬러그는 경기가 아니다", () => {
  assert.equal(gameFromBoxPath(`${DAY}/b-f-x/box.html.gz`), null);
});

test("D2 box.html.gz 가 아니면 경기가 아니다 — 다른 페이지 · 쓰는 중인 임시 파일 · 폴더 자체", () => {
  for (const p of [
    `${DAY}/b-f-21/index.html.gz`,
    `${DAY}/b-f-21/box.html.gz.1234.tmp`,
    `${DAY}/b-f-21`,
    `${DAY}/b-f-21/`,
  ]) {
    assert.equal(gameFromBoxPath(p), null, p);
  }
});

test("D2 임의 이름 폴더(`.staging` 등)와 경로 모양이 틀린 것은 경기가 아니다", () => {
  for (const p of [
    `${DAY}/.staging/box.html.gz`,
    "data/archive/npb/scores/26/0816/b-f-21/box.html.gz",
    "data/archive/npb/scores/2026/816/b-f-21/box.html.gz",
    "data/archive/npb/scores/2026/0816/b-f-21/sub/box.html.gz",
  ]) {
    assert.equal(gameFromBoxPath(p), null, p);
  }
});

/**
 * ⚠**잎이어야 한다**(I1 · `refetch-limit.ts` 선례). `scripts/update.ts`(수집 오케스트레이터)가 서브패스로
 * 직접 가져온다 — 이 파일이 무엇이든 import 하면 그 사슬의 로드 오류가 **수집을 시작 전에** 죽인다.
 */
test("⚠I1 game-slug.ts 는 import 가 0개인 잎이다", () => {
  const src = readLf("../src/game-slug.ts");
  assert.equal(/^\s*import\b/m.test(src), false, "game-slug.ts 에 import 문이 있으면 안 된다 — 그 자체가 배럴을 끌어올 수 있다");
});

test("⚠I1 서브패스 `@bb-app/store/game-slug` 로 내보내고 · 그것이 같은 함수다", async () => {
  const pkg = JSON.parse(readLf("../package.json")) as { exports: Record<string, string> };
  assert.equal(pkg.exports["./game-slug"], "./src/game-slug.ts", "package.json 의 exports 에 ./game-slug 가 없다");
  const viaSubpath = (await import("@bb-app/store/game-slug")) as { gameFromBoxPath: unknown };
  assert.equal(viaSubpath.gameFromBoxPath, gameFromBoxPath, "서브패스로 가져온 것이 같은 함수가 아니다 — 판정이 두 벌이다");
});

/**
 * ⚠**적재기가 같은 함수를 쓴다**(설계 §5). 판정이 적재기 안에 남아 있으면 한쪽만 고쳐졌을 때 수집 창과 적재기가 갈린다.
 * 소스로 본다 — 적재기는 import 하는 순간 적재를 시작하므로 실행 시험을 할 수 없다.
 */
test("⚠D2 load-archive.ts 의 gameFromPath 는 gameFromBoxPath 를 부르고 · 제 판정(경로 정규식·조각 수)을 따로 갖지 않는다", () => {
  const src = stripComments(readLf("../tools/load-archive.ts"));
  // ⚠분모 — 주석 걷기가 코드를 먹었으면 아래 「없다」 단언이 공회전한다
  assert.ok(src.includes('walk(archiveRoot, "box.html.gz")'), "적재기의 경기 순회를 못 찾았다 — 소스 모양이 바뀌었거나 주석 걷기가 코드를 먹었다");
  assert.match(src, /import \{ gameFromBoxPath \} from "\.\.\/src\/game-slug\.ts";/, "적재기가 잎 game-slug 에서 gameFromBoxPath 를 가져오지 않는다");
  const at = src.indexOf("function gameFromPath(");
  assert.notEqual(at, -1, "적재기에 gameFromPath 가 없다");
  // ⚠끝은 `"\n}\n"` 이다 — 반환 타입 리터럴이 줄머리 `} | null {` 로 닫혀 `"\n}"` 로 자르면 본문 앞에서 끊긴다
  const end = src.indexOf("\n}\n", at);
  assert.notEqual(end, -1, "gameFromPath 가 닫히지 않는다");
  const body = src.slice(at, end);
  assert.match(body, /gameFromBoxPath\(file\)/, "gameFromPath 가 gameFromBoxPath(file) 을 부르지 않는다");
  assert.equal(src.includes("scores[\\\\/]"), false, "적재기에 경로 정규식이 남아 있다 — 판정이 두 벌이다");
  assert.equal(/parts\.length\s*<\s*3/.test(src), false, "적재기에 조각 수 판정이 남아 있다 — 판정이 두 벌이다");
});
