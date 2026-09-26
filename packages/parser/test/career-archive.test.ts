/**
 * 年度別成績 파서를 **보유 선수 페이지 전량**으로 잰다(2026-09-26 · 감사 C8).
 *
 * ⚠**합성 픽스처만으로는 신호가 실물과 맞는지 말할 수 없다** — `career.test.ts` 의 뼈대는
 *   「내가 읽은 실물 마크업」을 옮긴 것이라, 그 읽기가 틀렸으면 둘이 함께 틀린다.
 *   여기서 두 가지를 실물로 잰다:
 *   ⑴ **헛실패 0** — 정상 페이지가 던지지 않는다. 특히 **투수 표가 원래 없는 야수 페이지**가 던지면
 *      매일 수백 명이 실패로 세어져 배포가 멈춘다(감사 C8 의 함정).
 *   ⑵ **못 찾으면 던진다** — 표 id 만 바꾼 페이지가 **그 표가 있던 페이지 전부**에서 던진다.
 * ⚠npb.jp 원본은 저장소에 두지 않는다(`packages/parser/test/fixtures/README.md` · L6) — `data/archive` 를 읽는다.
 * ⚠`data/archive` 가 없으면 건너뛴다. CI 는 `BB_REQUIRE_DB=1` 로 막는다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { gunzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { parseCareer } from "../src/career.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const DIR = join(ROOT, "data", "archive", "npb", "players");
const FILES = existsSync(DIR) ? readdirSync(DIR).filter((f) => f.endsWith(".html.gz")).sort() : [];
const HAS = FILES.length > 0;
if (process.env["BB_REQUIRE_DB"] === "1" && !HAS) {
  throw new Error(`BB_REQUIRE_DB=1 인데 ${DIR} 에 선수 페이지가 없다`);
}
const skip = HAS ? false : "data/archive 의 선수 페이지 없음";

/** 한 번만 푼다 — 세 시험이 같은 페이지를 쓴다 */
const PAGES: readonly { id: string; html: string }[] = FILES.map((f) => ({
  id: f.slice(0, -".html.gz".length),
  html: gunzipSync(readFileSync(join(DIR, f))).toString("utf8"),
}));

const hasTable = (html: string, id: string): boolean => html.includes(`<table id="${id}">`);

test("실물 선수 페이지 전량에서 던지는 페이지가 0 이다 — 헛실패 0", { skip }, () => {
  const thrown: string[] = [];
  let withPitching = 0;
  let withoutPitching = 0;
  for (const p of PAGES) {
    try {
      const c = parseCareer(p.html);
      if (c.pitching.length > 0) withPitching += 1;
      else withoutPitching += 1;
    } catch (err) {
      thrown.push(`${p.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  assert.deepEqual(thrown, [], `${PAGES.length}장 중 ${thrown.length}장이 던졌다 — 정상 페이지를 실패로 센다`);
  // ⚠**두 갈래를 다 잰 것인지** 본다 — 투수 표가 없는 페이지가 0장이면 「원래 없음」을 안 잰 초록이다
  assert.ok(withPitching > 0, "투수 표가 있는 페이지가 0장 — 분모가 한쪽뿐이다");
  assert.ok(withoutPitching > 0, "투수 표가 없는 페이지가 0장 — 「원래 없음」 갈래를 안 쟀다");
});

for (const [id, renamed] of [["tablefix_b", "tablefix_bat"], ["tablefix_p", "tablefix_pit"]] as const) {
  test(`⚠${id} 의 id 만 바꾸면 그 표가 있던 페이지 **전부**가 던지고, 없던 페이지는 던지지 않는다`, { skip }, () => {
    let had = 0;
    let lacked = 0;
    const silent: string[] = [];
    const falseAlarm: string[] = [];
    for (const p of PAGES) {
      if (hasTable(p.html, id)) {
        had += 1;
        const moved = p.html.replace(`<table id="${id}">`, `<table id="${renamed}">`);
        try {
          parseCareer(moved);
          silent.push(p.id);
        } catch {
          // 기대한 쪽 — 못 찾았다고 말했다
        }
      } else {
        // ⚠**그 표가 원래 없던 페이지**는 변이가 아무것도 안 바꾼다 — 여전히 던지면 안 된다
        lacked += 1;
        try {
          parseCareer(p.html);
        } catch (err) {
          falseAlarm.push(`${p.id}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }
    assert.ok(had > 0, `${id} 가 있는 페이지가 0장 — 이 시험이 아무것도 안 잰다`);
    assert.deepEqual(silent, [], `${id} 를 잃은 ${had}장 중 ${silent.length}장이 조용히 빈 배열을 냈다`);
    assert.deepEqual(falseAlarm, [], `${id} 가 원래 없는 ${lacked}장 중 ${falseAlarm.length}장이 던졌다`);
  });
}
