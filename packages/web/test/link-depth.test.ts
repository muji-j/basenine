/**
 * **홈에서 선수 성적까지 3클릭 이내인가** (CLAUDE.md §0-1).
 *
 * ⚠**규약의 판정 기준인데 한 번도 안 쟀다**(2026-08-31 에 처음). 제품의 가치 명제가
 * 「설치·계정·설정 없이 URL 만으로 핵심 정보에 도달」인데, **그것을 보는 장치가 0개였다.**
 * 화면을 늘리거나 내비 항목을 줄이면 **조용히 4클릭이 되고, 아무것도 실패하지 않는다** —
 * 깨진 링크와 달리 **아무 데도 안 걸리기 때문**이다.
 *
 * ⚠**링크만 센다.** 검색칸은 타이핑이라 클릭이 아니고, **JS 가 꺼져도 닿아야 한다**(§0-1).
 *
 * 첫 실측(2026-08-31 · 9시즌 dist): 전체 **9,370장 미도달 0** ·
 * 선수 페이지 **6,207장 전부 3클릭 이내**(현행 1~2 · 과거 시즌 2~3).
 * ⚠**과거 시즌이 3에 딱 걸린다**(시즌 전환 한 번이 더 든다) — 여유가 없다는 뜻이므로
 * 내비를 건드릴 때 **이 시험이 먼저 붉어진다.**
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { clickDepthLazy, tooDeepIn } from "../src/link-check.ts";

const DIST = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "dist");
const DB = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "data", "bb.sqlite");
if (process.env["BB_REQUIRE_DB"] === "1" && !existsSync(DB)) {
  throw new Error(`BB_REQUIRE_DB=1 인데 ${DB} 가 없다`);
}

/**
 * ⚠**경로만 모은다. 링크는 안 들고 있는다**(2026-08-31 · CI 에서 **OOM 으로 죽었다**).
 * 배포물 9,370장의 링크 참조는 **2,651,860개 · 문자 5,330만자**다 —
 * 문자열로 들고 있으면 수백 MB 이고, CI 의 기본 힙에서 `JavaScript heap out of memory` 가 난다.
 * ⚠**이 저장소가 이미 적어 둔 함정을 다시 밟았다** — 빌드도 같은 이유로
 * 「본문을 버리고 색인만 남기게」 고쳐진 이력이 있다.
 */
function listPages(dir = DIST, base = ""): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const rel = base === "" ? e.name : `${base}/${e.name}`;
    if (e.isDirectory()) out.push(...listPages(join(dir, e.name), rel));
    else if (e.name.endsWith(".html")) out.push(rel);
  }
  return out;
}

const paths = existsSync(DIST) ? listPages() : [];
const pageSet = new Set(paths);
/**
 * ⚠**필요한 화면만 그때 읽고 버린다.** BFS 는 화면마다 최대 한 번만 읽으므로
 * 읽는 횟수는 전부 들고 있을 때와 같고, **보존량만 O(참조) → O(화면)** 이 된다.
 */
const refsOf = (p: string): string[] =>
  [...readFileSync(join(DIST, p), "utf8").matchAll(/\s(?:href|src)="([^"]*)"/g)].map((m) => m[1] ?? "");

/** ⚠**한 번만 걷는다** — 시험마다 다시 걸으면 9,370장을 세 번 훑는다 */
const depth = paths.length === 0 ? new Map<string, number>() : clickDepthLazy(pageSet, refsOf);
const deepPlayers = tooDeepIn(paths, depth);

test("⚠홈에서 모든 선수 페이지까지 3클릭 이내다 (§0-1)", { skip: paths.length === 0 ? "dist 없음" : false }, () => {
  const deep = deepPlayers;
  const players = paths.filter((p) => /(^|\/)players\/[^/]+\.html$/.test(p)).length;
  // ⚠**공회전 방지** — 선수 페이지를 못 찾으면 이 시험은 언제나 초록이다
  assert.ok(players > 500, `선수 페이지를 ${players}장밖에 못 찾았다 — 이 시험이 공회전한다`);
  assert.deepEqual(
    deep.map((d) => `${d.path}=${d.clicks ?? "도달 불가"}`),
    [],
    `${deep.length}장이 3클릭을 넘는다 / 선수 페이지 ${players}장`,
  );
});

/**
 * ⚠**「닿기는 하는가」와 「몇 번에 닿는가」는 다른 질문이다.** 링크 검사는 앞의 것도 안 본다 —
 * 어떤 화면도 안 가리키는 페이지는 **깨진 링크가 0개인 채로 존재만 한다.**
 */
test("⚠홈에서 못 닿는 화면이 없다 — 아무도 안 가리키는 페이지는 없는 것과 같다", {
  skip: paths.length === 0 ? "dist 없음" : false,
}, () => {

  const orphan = paths.filter((p) => !depth.has(p));
  assert.ok(paths.length > 1000, `화면을 ${paths.length}장밖에 못 찾았다 — 이 시험이 공회전한다`);
  assert.deepEqual(orphan.slice(0, 10), [], `홈에서 못 닿는 화면 ${orphan.length}장`);
});

/**
 * ⚠**여유가 얼마나 남았는지를 말한다.** 지금 과거 시즌이 3클릭으로 **상한에 딱 걸려 있다** —
 * 그 사실을 수치로 남겨야 다음 사람이 「한 단계 더 넣어도 되겠지」를 안 한다.
 * ⚠⚠**현행 시즌 선수 수에 하한을 박지 않는다**(2026-10-25 · PR-4 마지막 재검토 N3). 예전 `> 300` 은 새 시즌이 루트가 되는 날
 *   (개막 1~3경기일째 · 루트 선수 183~296 · 2026 실측)부터 「시험」을 떨어뜨려 배포를 막았다 — 루트의 선수 페이지는 **그 시즌에 나온 선수**다.
 *   여기는 **현행 선수가 하나라도 있는가**만 본다(0 이면 경로 규칙이 바뀐 것이다 · DB 가 없는 곳의 마지막 그물).
 *   ⚠**몇 장이어야 하는가는 아래 시험이 DB 로 정한다**(완화 검토 P2 — `≥ 1` 만으로는 현행 선수 페이지가 한 장만 남는 대량 소실도 통과했다).
 */
test("현행 시즌 선수는 2클릭 이내다 — 과거 시즌만 3클릭을 쓴다", {
  skip: paths.length === 0 ? "dist 없음" : false,
}, () => {

  const worst = paths
    .filter((p) => /^players\/[^/]+\.html$/.test(p))
    .map((p) => depth.get(p) ?? 99);
  assert.ok(worst.length >= 1, "현행 시즌 선수 페이지가 한 장도 없다 — 루트 경로 규칙이 바뀌었다(이 시험이 공회전한다)");
  assert.ok(Math.max(...worst) <= 2, `현행 시즌 선수가 ${Math.max(...worst)}클릭이다 — 과거 시즌의 여유가 사라진다`);
});

/**
 * ⚠⚠**현행 시즌 선수 페이지는 「그 시즌 정규시즌에 타석·등판 기록이 있는 선수」와 정확히 같다**(2026-10-25 · PR-4 완화 검토 P2).
 *
 * 고정 숫자는 둘 다 틀렸다 — `> 300` 은 개막 직후 배포를 막았고, `≥ 1` 은 시즌 중 현행 선수 페이지 수백 장이 사라져도 통과한다
 * (페이지와 링크가 같은 줄어든 집합에서 나오면 깨진 링크도 없고, 과거 시즌이 「선수 > 500」을 채운다).
 * → **기대 집합을 화면 밖에서 따로 센다**: DB 에서 그 시즌 정규시즌 실시 경기에 `batting_line` 또는 `pitching_line` 이 있는 선수.
 *   빌드가 선수 페이지를 만드는 조건과 같다 — 선수 = 그 시즌 집계의 타자 ∪ 투수(`packages/web/src/query.ts` 의 `ids`)이고,
 *   집계가 `status = 'played' AND competition = 'regular'` 로 거른다(`packages/aggregate/src/season.ts` 의 `BATTING_SQL` · `PITCHING_SQL`).
 *   ⚠**같은 함수를 부르지 않는다** — 그러면 「내 계산이 내 계산과 같다」밖에 증명 못 한다. 질의를 따로 짠다.
 * ⚠**시즌은 배포물이 스스로 말하는 루트 시즌이다**(`index.html` 의 제목 `YYYY年 …`) — 빌드가 새 시즌을 미루는 날(개막 1~3경기일째)에는
 *   DB 의 최신 시즌이 아니라 그 앞 시즌이 루트다. 제목에서 시즌을 못 읽으면 **실패다**(M7 — 조용히 건너뛰지 않는다).
 * ⚠**DB 는 읽기 전용으로 연다**(`openDb` 는 마이그레이션을 적용한다 — 쓴다) · DB 가 없으면 건너뛰고 `BB_REQUIRE_DB=1` 이면 맨 위에서 던진다(이웃 시험과 같은 관례).
 * 실측(2026-10-25 · 로컬 배포물 9/29 빌드 · 로컬 DB): 루트 2026 · 페이지 698 = 기대 698 · 빠진 것 0 · 남는 것 0.
 */
test("⚠현행 시즌 선수 페이지가 그 시즌 정규시즌 출장 선수(DB)와 정확히 같다", {
  skip: paths.length === 0 ? "dist 없음" : existsSync(DB) ? false : "DB 없음",
}, () => {
  const title = /<title>(\d{4})年 /.exec(readFileSync(join(DIST, "index.html"), "utf8"));
  assert.ok(title !== null, "index.html 의 제목에서 루트 시즌을 못 읽었다 — 제목 형식이 바뀌었으면 이 시험을 같이 고쳐라");
  const season = Number(title[1]);
  const pages = new Set(
    paths.filter((p) => /^players\/[^/]+\.html$/.test(p)).map((p) => p.slice("players/".length, -".html".length)),
  );
  const db = new DatabaseSync(DB, { readOnly: true });
  let expected: Set<string>;
  try {
    expected = new Set(
      (
        db
          .prepare(
            `SELECT b.player_id AS id FROM batting_line b JOIN game g ON g.game_id = b.game_id
              WHERE g.season = ? AND g.status = 'played' AND g.competition = 'regular'
             UNION
             SELECT t.player_id AS id FROM pitching_line t JOIN game g ON g.game_id = t.game_id
              WHERE g.season = ? AND g.status = 'played' AND g.competition = 'regular'`,
          )
          .all(season, season) as unknown as { id: string }[]
      ).map((r) => String(r.id)),
    );
  } finally {
    db.close();
  }
  assert.ok(expected.size > 0, `${season}(루트) 시즌의 정규시즌 출장 선수가 DB 에 0명이다 — 배포물과 DB 가 다른 것을 보고 있다`);
  const missing = [...expected].filter((id) => !pages.has(id)).sort();
  const extra = [...pages].filter((id) => !expected.has(id)).sort();
  assert.deepEqual(
    { missing: missing.slice(0, 10), extra: extra.slice(0, 10) },
    { missing: [], extra: [] },
    `${season}(루트): 선수 페이지 ${pages.size}장 · DB 기대 ${expected.size}명 — 빠진 것 ${missing.length} · 남는 것 ${extra.length}`,
  );
});
