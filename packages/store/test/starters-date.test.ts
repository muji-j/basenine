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
import { STARTERS_MAX_AHEAD_DAYS, STARTERS_MAX_BEHIND_DAYS, resolveStartersDate } from "../src/starters-date.ts";

const DAY = 86_400_000;
const iso = (t: number): string => new Date(t).toISOString().slice(0, 10);

test("앞쪽 창은 14일 · 뒤쪽 창은 183일이다(실측 앞쪽 최대 +1일 · 설계 D3 · PR-4 3중 검토 1차 P3)", () => {
  assert.equal(STARTERS_MAX_AHEAD_DAYS, 14);
  assert.equal(STARTERS_MAX_BEHIND_DAYS, 183);
});

/**
 * ⚠⚠**규칙을 시험이 따로 다시 센다**(같은 식을 베끼지 않으려고 실재 판정은 `Date.parse` 왕복으로 한다):
 * 앞쪽 0~14일 안의 후보가 있으면 그것(정상) · 없으면 가장 가까운 지난 후보가 183일 안이면 그것(맥박만) · 그 밖은 실패.
 * ⚠「실패는 02-29 뿐」은 더는 참이 아니다 — 앞쪽 15일~ 의 날짜이면서 지난 후보가 183일 밖이면 실패다(낡은 페이지를 미래로 안 보낸다).
 */
test("⚠⚠전수 — 취득일 2026-01-01~2029-12-31(윤년 2028 포함) × 게시 MM-DD 366 개: 받으면 lag ∈ [−183, +14] · 앞쪽 14일 안이 먼저 · 그 밖은 가장 가까운 지난 해 · 나머지는 실패", () => {
  const monthDays: string[] = [];
  for (let t = Date.UTC(2028, 0, 1); t < Date.UTC(2029, 0, 1); t += DAY) monthDays.push(iso(t).slice(5));
  assert.equal(monthDays.length, 366, "게시 날짜 후보가 366 개가 아니다 — 이 시험이 공회전한다");
  let calls = 0;
  let failures = 0;
  let pasts = 0;
  let aheads = 0;
  for (let t = Date.UTC(2026, 0, 1); t <= Date.UTC(2029, 11, 31); t += DAY) {
    const fetched = iso(t);
    const year = Number(fetched.slice(0, 4));
    for (const md of monthDays) {
      calls += 1;
      const r = resolveStartersDate(fetched, md);
      const cands = [year - 1, year, year + 1]
        .map((y) => ({ y, at: Date.parse(`${String(y)}-${md}T00:00:00Z`) }))
        .filter((c) => !Number.isNaN(c.at) && iso(c.at) === `${String(c.y)}-${md}`)
        .map((c) => ({ y: c.y, lag: Math.round((c.at - t) / DAY) }));
      const ahead = cands.filter((c) => c.lag >= 0 && c.lag <= 14).sort((a, b) => a.lag - b.lag)[0];
      const behind = cands.filter((c) => c.lag < 0).sort((a, b) => b.lag - a.lag)[0];
      const want = ahead ?? (behind !== undefined && behind.lag >= -183 ? behind : undefined);
      if (want === undefined) {
        assert.equal(r.ok, false, `${fetched} · ${md}: 받았다(${r.ok ? `${r.date} ${String(r.lag)}` : ""}) — 앞쪽 14일 안도 지난 183일 안도 아니다`);
        failures += 1;
        continue;
      }
      assert.ok(r.ok, `${fetched} · ${md}: 실패했다(${r.ok ? "" : r.reason}) — ${String(want.y)}(${String(want.lag)}) 를 받아야 한다`);
      assert.deepEqual({ date: r.date, lag: r.lag }, { date: `${String(want.y)}-${md}`, lag: want.lag }, `${fetched} · ${md}`);
      assert.ok(r.lag >= -183 && r.lag <= 14, `${fetched} · ${md}: lag ${String(r.lag)} 가 [−183, +14] 밖인데 받았다`);
      if (r.lag < 0) pasts += 1;
      else aheads += 1;
    }
  }
  assert.equal(calls, 1461 * 366, "전수가 아니다");
  assert.ok(failures > 0 && pasts > 0 && aheads > 0, "세 갈래(앞쪽 · 지난 · 실패) 중 하나를 한 번도 안 지났다 — 이 시험이 공회전한다");
  console.log(`  · 호출 ${String(calls)} · 앞쪽 ${String(aheads)} · 지난(맥박만) ${String(pasts)} · 실패 ${String(failures)}`);
});

test("⚠설계 경계 사례 — 앞쪽 +14 받음 · +15 이상은 거부 · 뒤쪽 −183 받음 · −184 실패 · 후보 0 은 실패", () => {
  const ok = (f: string, md: string): { date: string; lag: number } => {
    const r = resolveStartersDate(f, md);
    assert.ok(r.ok, `${f} · ${md}: ${r.ok ? "" : r.reason}`);
    return { date: r.date, lag: r.lag };
  };
  assert.deepEqual(ok("2026-08-15", "08-16"), { date: "2026-08-16", lag: 1 });
  assert.deepEqual(ok("2026-12-31", "01-01"), { date: "2027-01-01", lag: 1 });
  assert.deepEqual(ok("2026-08-15", "08-29"), { date: "2026-08-29", lag: 14 }, "앞쪽 +14 를 안 받았다");
  assert.deepEqual(ok("2028-02-28", "02-29"), { date: "2028-02-29", lag: 1 });
  assert.deepEqual(ok("2028-08-30", "02-29"), { date: "2028-02-29", lag: -183 });
  assert.deepEqual(ok("2027-08-31", "03-01"), { date: "2027-03-01", lag: -183 }, "앞쪽 +183(2028-03-01)을 골랐다");
  assert.deepEqual(ok("2027-01-05", "11-01"), { date: "2026-11-01", lag: -65 });
  assert.deepEqual(ok("2027-05-01", "10-30"), { date: "2026-10-30", lag: -183 }, "앞쪽 +182 를 미래 예고로 받았다");
  for (const [f, md, why] of [
    ["2026-08-15", "08-30", /\+15일/],
    ["2027-08-30", "02-29", /\+183일/],
    ["2027-08-29", "02-29", /\+184일/],
    ["2028-08-31", "02-29", /-184일/],
    ["2027-06-15", "10-30", /-228일/],
    ["2020-06-10", "10-23", /-231일/],
    ["2026-12-31", "02-29", /후보 해가 없다/],
  ] as const) {
    const r = resolveStartersDate(f, md);
    assert.equal(r.ok, false, `${f} · ${md}: ${r.ok ? `${r.date} 를 받았다` : ""}`);
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
