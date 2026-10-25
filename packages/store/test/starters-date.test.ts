/**
 * 予告先発 연도 규칙(순수) — `src/starters-date.ts`(PR-4 설계 `docs/superpowers/specs/2026-10-24-offseason-readiness-design.md` D3).
 *
 * ⚠**적재 표에 미치는 효과(맥박만 · 실패면 세 표 불변)는 `starters-load.test.ts` 가 도구를 띄워 잰다.** 여기는 규칙 자체 —
 *   설계가 적은 **전칭 명제**를 날짜 전수로 잰다: 「받으면 `|lag| ≤ 183` · 고른 해가 가장 가깝다 · 동률은 과거 · 실패는 2월 29일에서만」.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { STARTERS_MAX_LAG_DAYS, resolveStartersDate } from "../src/starters-date.ts";

const DAY = 86_400_000;
const iso = (t: number): string => new Date(t).toISOString().slice(0, 10);

test("⚠⚠전수 — 취득일 2026-01-01~2029-12-31(윤년 2028 포함) × 게시 MM-DD 366 개: 받으면 |lag| ≤ 183 · 가장 가까운 실재 해 · 동률은 과거 · 실패는 02-29 뿐", () => {
  const monthDays: string[] = [];
  for (let t = Date.UTC(2028, 0, 1); t < Date.UTC(2029, 0, 1); t += DAY) monthDays.push(iso(t).slice(5));
  assert.equal(monthDays.length, 366, "게시 날짜 후보가 366 개가 아니다 — 이 시험이 공회전한다");
  let calls = 0;
  let failures = 0;
  let pasts = 0;
  for (let t = Date.UTC(2026, 0, 1); t <= Date.UTC(2029, 11, 31); t += DAY) {
    const fetched = iso(t);
    const year = Number(fetched.slice(0, 4));
    for (const md of monthDays) {
      calls += 1;
      const r = resolveStartersDate(fetched, md);
      // 실재하는 후보 해와 그 거리 — 시험이 따로 센다(같은 식을 베끼지 않으려고 `Date.parse` 왕복으로 실재를 가른다)
      const cands = [year - 1, year, year + 1]
        .map((y) => ({ y, at: Date.parse(`${String(y)}-${md}T00:00:00Z`) }))
        .filter((c) => !Number.isNaN(c.at) && iso(c.at) === `${String(c.y)}-${md}`)
        .map((c) => ({ y: c.y, lag: Math.round((c.at - t) / DAY) }));
      if (!r.ok) {
        failures += 1;
        assert.equal(md, "02-29", `${fetched} · ${md}: 2월 29일이 아닌데 실패했다 — ${r.reason}`);
        continue;
      }
      assert.ok(Math.abs(r.lag) <= STARTERS_MAX_LAG_DAYS, `${fetched} · ${md}: |lag| ${String(r.lag)} > 183 인데 받았다`);
      const best = Math.min(...cands.map((c) => Math.abs(c.lag)));
      assert.equal(Math.abs(r.lag), best, `${fetched} · ${md}: 가장 가까운 해가 아니다`);
      const tied = cands.filter((c) => Math.abs(c.lag) === best);
      if (tied.length > 1) assert.ok(r.lag < 0, `${fetched} · ${md}: 동률(${tied.map((c) => c.lag).join("·")})을 과거로 고르지 않았다`);
      assert.equal(r.date, `${String(cands.find((c) => c.lag === r.lag)!.y)}-${md}`);
      if (r.lag < 0) pasts += 1;
    }
  }
  assert.equal(calls, 1461 * 366, "전수가 아니다");
  assert.ok(failures > 0, "실패가 한 번도 안 났다 — 2/29 경계를 재지 않았다");
  assert.ok(pasts > 0, "지난 날짜를 한 번도 안 골랐다");
  console.log(`  · 호출 ${String(calls)} · 실패 ${String(failures)}(전부 02-29) · 지난 날짜 ${String(pasts)}`);
});

test("⚠설계 경계 사례 — ±183 받음 · ±184 실패 · 동률(±183)은 과거 · 후보 0 은 실패", () => {
  const ok = (f: string, md: string): { date: string; lag: number } => {
    const r = resolveStartersDate(f, md);
    assert.ok(r.ok, `${f} · ${md}: ${r.ok ? "" : r.reason}`);
    return { date: r.date, lag: r.lag };
  };
  assert.deepEqual(ok("2027-08-30", "02-29"), { date: "2028-02-29", lag: 183 });
  assert.deepEqual(ok("2028-08-30", "02-29"), { date: "2028-02-29", lag: -183 });
  assert.deepEqual(ok("2027-08-31", "03-01"), { date: "2027-03-01", lag: -183 }, "동률을 미래로 골랐다");
  assert.deepEqual(ok("2027-01-05", "11-01"), { date: "2026-11-01", lag: -65 });
  assert.deepEqual(ok("2026-12-31", "01-01"), { date: "2027-01-01", lag: 1 });
  assert.deepEqual(ok("2026-08-15", "08-16"), { date: "2026-08-16", lag: 1 });
  for (const [f, md, why] of [["2027-08-29", "02-29", /184일/], ["2028-08-31", "02-29", /184일/], ["2026-12-31", "02-29", /후보 해가 없다/]] as const) {
    const r = resolveStartersDate(f, md);
    assert.equal(r.ok, false, `${f} · ${md}`);
    if (!r.ok) assert.match(r.reason, why);
  }
});

test("입력이 날짜 모양이 아니면 실패로 돌려준다(던지지 않는다 · 모르는 날짜를 지어내지 않는다)", () => {
  for (const [f, md] of [["2026-02-30", "08-16"], ["2026/08/15", "08-16"], ["", "08-16"], ["2026-08-15", "8-16"], ["2026-08-15", "13-01"], ["2026-08-15", "00-10"], ["2026-08-15", "08-32"]] as const) {
    const r = resolveStartersDate(f, md);
    assert.equal(r.ok, false, `${JSON.stringify(f)} · ${JSON.stringify(md)} 를 받았다`);
  }
});

/** ⚠**잎이어야 한다** — 적재 도구가 직접 가져온다. import 가 생기면 그 사슬의 결함이 적재기를 죽인다 */
test("⚠starters-date.ts 는 import 가 0개인 잎이다 · 시계를 읽지 않는다", () => {
  const src = readFileSync(fileURLToPath(new URL("../src/starters-date.ts", import.meta.url)), "utf8").replace(/\r\n/g, "\n");
  assert.equal(/^\s*import\b/m.test(src), false, "starters-date.ts 에 import 문이 있다");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(?<!:)\/\/[^\n]*/g, "");
  assert.equal(/new\s+Date\s*\(\s*\)|Date\s*\.\s*now\s*\(/.test(code), false, "시계를 읽는다(M6)");
});
