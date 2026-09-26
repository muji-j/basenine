/**
 * 경과(`playbyplay.html`) 파서를 **보유 경과 전량**으로 잰다 — 감사 N2(투수 표기 행의 엄격 검증 · 2026-09-27).
 * 설계: `docs/superpowers/specs/2026-09-27-profile-version-guard-design.md` §7 · §9-3(2-5 · 2-6).
 *
 * ⚠**합성 픽스처만으로는 새 규칙이 실물에서 헛실패를 내지 않는지 말할 수 없다** — `playbyplay.test.ts` 의 뼈대는
 *   「내가 읽은 실물 마크업」을 옮긴 것이라, 그 읽기가 틀렸으면 둘이 함께 틀린다(`career-archive.test.ts` 와 같은 이유).
 *   여기서 두 가지를 실물로 잰다:
 *   ⑴ **헛실패 0** — 던지는 것은 「타석을 하나도 찾지 못했다」뿐이고, 그 경기는 **박스도 성립이 아니다**
 *      (적재기는 성립하지 않은 경기의 경과를 파싱하지 않는다 — 새 규칙과 무관한 기존 51장).
 *   ⑵ **반증자 재현** — 실물 교대 행에서 **새 투수의 링크만** 못 읽게 하면 던진다(예전에는 6회초 5타석이 조용히
 *      이전 투수에게 붙었다).
 * ⚠**범위: 기본은 가장 최근 시즌 · `BB_ALL_SEASONS=1` 이면 전 시즌**(완결 시즌은 얼어 있다 · `ranking-min-sample.test.ts` 선례).
 *   로컬 실측 전 시즌 7,805장 약 20~40초(디스크 캐시에 따라) · 한 시즌 약 3~5초.
 * ⚠npb.jp 원본은 저장소에 두지 않는다(`packages/parser/test/fixtures/README.md` · L6) — `data/archive` 를 읽는다.
 * ⚠`data/archive` 가 없으면 건너뛴다. CI 는 `BB_REQUIRE_DB=1` 로 막는다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { gunzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { PlayByPlayParseError, parsePlayByPlay } from "../src/playbyplay.ts";
import { parseBoxScore } from "../src/box.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const SCORES = join(ROOT, "data", "archive", "npb", "scores");
const SEASONS = existsSync(SCORES) ? readdirSync(SCORES).filter((d) => /^\d{4}$/.test(d)).sort() : [];
const HAS = SEASONS.length > 0;
if (process.env["BB_REQUIRE_DB"] === "1" && !HAS) {
  throw new Error(`BB_REQUIRE_DB=1 인데 ${SCORES} 에 경기 아카이브가 없다`);
}
const skip = HAS ? false : "data/archive 의 경기 아카이브 없음";
/** ⚠**기본은 한 시즌, 깊은 실행은 전 시즌**(CI 는 하루 한 번 `BB_ALL_SEASONS=1` · daily.yml 「시험」 단계) */
const FULL = process.env["BB_ALL_SEASONS"] === "1";
const SCAN = FULL ? SEASONS : SEASONS.slice(-1);

/** 이름순(= 날짜순)으로 경과 파일을 모은다 */
function* walk(dir: string): Generator<string> {
  for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.name === "playbyplay.html.gz") yield p;
  }
}

const count = (s: string, needle: string): number => s.split(needle).length - 1;
const gameOf = (file: string): string => relative(SCORES, dirname(file)).replace(/\\/g, "/");

test("⚠N2 2-6 · 보유 경과에서 던지는 것은 「타석을 하나도 찾지 못했다」뿐이고 그 경기는 박스도 성립이 아니다 — 투수 표기 행 오류 0", { skip }, () => {
  let files = 0;
  let parsed = 0;
  let startRows = 0;
  let changeRows = 0;
  /** 적재기가 원래 경과를 파싱하지 않는 경기(박스가 성립이 아니다) — 새 규칙과 무관 */
  const notPlayed: string[] = [];
  const bad: string[] = [];
  for (const season of SCAN) {
    for (const f of walk(join(SCORES, season))) {
      files += 1;
      const html = gunzipSync(readFileSync(f)).toString("utf8");
      startRows += count(html, "（先発投手）");
      changeRows += count(html, "（投手交代）");
      try {
        parsePlayByPlay(html);
        parsed += 1;
      } catch (err) {
        const game = gameOf(f);
        if (!(err instanceof PlayByPlayParseError) || !err.message.startsWith("타석을 하나도 찾지 못했다")) {
          bad.push(`${game}: ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}`);
          continue;
        }
        // ⚠「타석 0」이 **성립한 경기**에서 나면 그건 헛실패가 아니라 구조 변경이다 — 여기서 허용하면 이 시험이 그것을 삼킨다
        const boxFile = join(dirname(f), "box.html.gz");
        if (!existsSync(boxFile)) {
          bad.push(`${game}: 경과에 타석이 없는데 박스가 없다 — 성립 여부를 모른다`);
          continue;
        }
        const status = parseBoxScore(gunzipSync(readFileSync(boxFile)).toString("utf8")).status;
        if (status === "played") bad.push(`${game}: 박스는 성립인데 경과에서 타석을 하나도 못 찾았다`);
        else notPlayed.push(game);
      }
    }
  }
  console.log(
    `  · 시즌 ${SCAN.join(",")}${FULL ? "(전 시즌)" : "(가장 최근 · BB_ALL_SEASONS=1 이면 전 시즌)"} · 경과 ${files}장 · 파싱 ${parsed}장 · ` +
      `박스도 미성립인 경기 ${notPlayed.length}장 · 투수 표기 행 ${startRows + changeRows}(先発 ${startRows} · 交代 ${changeRows})`,
  );
  // ⚠**분모** — 0 이면 이 시험은 아무것도 안 잰 것이다
  assert.ok(files > 0, "경과가 0장이다 — 이 시험이 공회전한다");
  assert.ok(startRows > 0 && changeRows > 0, `투수 표기 행이 先発 ${startRows} · 交代 ${changeRows} — 한 갈래를 안 쟀다`);
  assert.deepEqual(bad, [], `${files}장 중 ${bad.length}장이 헛실패다(새 규칙이 정상 경과를 실패로 센다)`);
  assert.equal(parsed + notPlayed.length, files);
});

/**
 * ⚠**반증자 재현 그대로**(2026-09-27 · 감사 N2). 실물 `2026/0815/b-f-20` 의 첫 교대 `61465150 → 41745153` 에서
 * **새 투수 href 의 `.html` 만** 지운다 — 예전 파서는 예외 없이 6회초 5타석을 이전 투수(61465150)에게 붙였다.
 * `load-archive-guard.test.ts`·`load-archive-unlinked.test.ts` 와 같은 경기 — CI 가 `BB_REQUIRE_DB=1` 로 존재를 강제한다.
 */
const GAME = "2026/0815/b-f-20";
const GAME_PBP = join(SCORES, ...GAME.split("/"), "playbyplay.html.gz");
const HAS_GAME = existsSync(GAME_PBP);
if (process.env["BB_REQUIRE_DB"] === "1" && !HAS_GAME) {
  throw new Error(`BB_REQUIRE_DB=1 인데 픽스처 경기의 경과(${GAME_PBP})가 없다`);
}

test("⚠N2 2-5 · 실물 첫 교대에서 새 투수 링크만 못 읽게 하면 던진다 — 이전 투수에게 조용히 붙이지 않는다", { skip: HAS_GAME ? false : `픽스처 경기 ${GAME} 없음` }, () => {
  const html = gunzipSync(readFileSync(GAME_PBP)).toString("utf8");
  assert.doesNotThrow(() => parsePlayByPlay(html), "원본 경과가 던진다 — 픽스처 전제가 깨졌다");

  // 첫 교대 행(한 칸짜리 colspan 셀)을 찾는다
  const cell = [...html.matchAll(/<td[^>]*colspan[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1]!).find((b) => b.includes("（投手交代）"));
  assert.ok(cell !== undefined, "교대 행을 못 찾았다 — 픽스처 전제가 깨졌다");
  assert.match(cell, /61465150\.html[\s\S]*→[\s\S]*41745153\.html/, `첫 교대가 61465150 → 41745153 이 아니다 — 픽스처 전제가 깨졌다: ${cell}`);
  const arrow = cell.indexOf("→");
  const mutatedCell = cell.slice(0, arrow) + cell.slice(arrow).replace("/bis/players/41745153.html", "/bis/players/41745153");
  assert.notEqual(mutatedCell, cell, "변이가 행을 바꾸지 않았다");
  assert.equal(count(html, cell), 1, "첫 교대 행과 같은 셀이 페이지에 둘 이상이다 — 변이가 다른 곳을 건드린다");
  const mutated = html.replace(cell, mutatedCell);

  let caught: unknown;
  try {
    parsePlayByPlay(mutated);
  } catch (err) {
    caught = err;
  }
  assert.ok(caught instanceof PlayByPlayParseError, `새 투수 링크를 못 읽었는데 던지지 않았다 — 이전 투수에게 조용히 붙었다(${String(caught)})`);
  assert.match(caught.message, /投手交代 표기의 화살표 뒤에서 새 투수 링크를 정확히 하나 읽지 못했다/);
  assert.match(caught.detail, /old=61465150/);
});
