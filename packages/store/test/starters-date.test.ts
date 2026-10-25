/**
 * 予告先発 연도 규칙(순수) — `src/starters-date.ts`(PR-4 설계 `docs/superpowers/specs/2026-10-24-offseason-readiness-design.md` D3).
 *
 * ⚠**적재 표에 미치는 효과(맥박만 · 실패면 세 표 불변)는 `starters-load.test.ts` 가 도구를 띄워 잰다.** 여기는 규칙 자체 —
 *   설계가 적은 **전칭 명제**를 날짜 전수로 잰다(3판 · 2026-10-25 · 조정자 결정):
 *   「후보 창은 [취득일 − 351, 취득일 + 14](366일) · 받으면 lag 가 그 창 안 · **이중 걸림이면 지난 해** · **실패는 02-29 뿐**」.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { STARTERS_MAX_AHEAD_DAYS, STARTERS_MAX_BEHIND_DAYS, resolveStartersDate } from "../src/starters-date.ts";

const DAY = 86_400_000;
const iso = (t: number): string => new Date(t).toISOString().slice(0, 10);

test("창은 [취득일 − 351, 취득일 + 14] 이다 — 앞쪽 14일(실측 최대 +1일) · 뒤쪽 351 = 365 − 14(창 366일 · 설계 D3 3판)", () => {
  assert.equal(STARTERS_MAX_AHEAD_DAYS, 14);
  assert.equal(STARTERS_MAX_BEHIND_DAYS, 351);
});

/**
 * ⚠⚠**규칙을 시험이 따로 다시 센다**(같은 식을 베끼지 않으려고 실재 판정은 `Date.parse` 왕복으로 한다):
 * 앞쪽 0~14일 안의 후보가 있으면 그것(정상) · 없으면 351일 안의 지난 후보(맥박만) · 그 밖은 실패.
 * ⚠**창이 366일이라 같은 MM-DD 가 두 번 걸리는 날이 있다** — 양 끝(−351 · +14)이 같은 날짜이고 그 사이에 2/29 가 없을 때뿐이다.
 *   그때는 **지난 해(맥박만)** 를 고른다(PR-4 재검토 m1) — 틀렸을 때 예고 행이 14일 앞으로 가 `starters-behind` 가 꺼지는 쪽(설계 G4)을 피한다.
 *   그 짝이 실제로 나오는지·그 밖의 이중 걸림은 없는지도 센다.
 */
test("⚠⚠전수 — 취득일 2026-01-01~2029-12-31(윤년 2028 포함) × 게시 MM-DD 366 개: 받으면 lag ∈ [−351, +14] · 이중 걸림은 지난 해 · 실패는 02-29 뿐", () => {
  const monthDays: string[] = [];
  for (let t = Date.UTC(2028, 0, 1); t < Date.UTC(2029, 0, 1); t += DAY) monthDays.push(iso(t).slice(5));
  assert.equal(monthDays.length, 366, "게시 날짜 후보가 366 개가 아니다 — 이 시험이 공회전한다");
  let calls = 0;
  let failures = 0;
  let pasts = 0;
  let aheads = 0;
  let ties = 0;
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
      const inWindow = cands.filter((c) => c.lag >= -351 && c.lag <= 14);
      if (inWindow.length > 1) {
        // 이중 걸림은 (−351, +14) 짝뿐이어야 한다
        assert.deepEqual(inWindow.map((c) => c.lag).sort((a, b) => a - b), [-351, 14], `${fetched} · ${md}: 창 안에 같은 날짜가 (−351, +14) 아닌 모양으로 두 번 걸렸다`);
        ties += 1;
      }
      const ahead = inWindow.find((c) => c.lag >= 0);
      const behind = inWindow.find((c) => c.lag < 0);
      // 이중 걸림이면 지난 해(시끄러운 쪽) — 평소에는 둘 중 하나만 창 안이다
      const want = behind ?? ahead;
      if (want === undefined) {
        assert.equal(r.ok, false, `${fetched} · ${md}: 받았다(${r.ok ? `${r.date} ${String(r.lag)}` : ""}) — 창 [−351, +14] 안에 그 날짜가 없다`);
        assert.equal(md, "02-29", `${fetched} · ${md}: 02-29 가 아닌 날짜가 창 밖이다 — 366일 창이면 평년 날짜는 언제나 한 번 걸린다`);
        failures += 1;
        continue;
      }
      assert.ok(r.ok, `${fetched} · ${md}: 실패했다(${r.ok ? "" : r.reason}) — ${String(want.y)}(${String(want.lag)}) 를 받아야 한다`);
      assert.deepEqual({ date: r.date, lag: r.lag }, { date: `${String(want.y)}-${md}`, lag: want.lag }, `${fetched} · ${md}`);
      assert.ok(r.lag >= -351 && r.lag <= 14, `${fetched} · ${md}: lag ${String(r.lag)} 가 [−351, +14] 밖인데 받았다`);
      if (r.lag < 0) pasts += 1;
      else aheads += 1;
    }
  }
  assert.equal(calls, 1461 * 366, "전수가 아니다");
  assert.ok(failures > 0 && pasts > 0 && aheads > 0 && ties > 0, "네 갈래(앞쪽 · 지난 · 실패 · 이중 걸림) 중 하나를 한 번도 안 지났다 — 이 시험이 공회전한다");
  console.log(`  · 호출 ${String(calls)} · 앞쪽 ${String(aheads)} · 지난(맥박만) ${String(pasts)} · 실패(전부 02-29) ${String(failures)} · 이중 걸림(지난 해를 고름) ${String(ties)}`);
});

test("⚠설계 경계 사례 — 앞쪽 +14 · 뒤쪽 184·300·351 은 지난 해 · 352 는 앞쪽 해 · +15 는 지난 해 · 이중 걸림은 지난 해 · 실패는 02-29 가 창 밖일 때뿐", () => {
  const ok = (f: string, md: string): { date: string; lag: number } => {
    const r = resolveStartersDate(f, md);
    assert.ok(r.ok, `${f} · ${md}: ${r.ok ? "" : r.reason}`);
    return { date: r.date, lag: r.lag };
  };
  // 앞쪽(예고)
  assert.deepEqual(ok("2026-08-15", "08-16"), { date: "2026-08-16", lag: 1 });
  assert.deepEqual(ok("2026-12-31", "01-01"), { date: "2027-01-01", lag: 1 });
  assert.deepEqual(ok("2026-08-15", "08-28"), { date: "2026-08-28", lag: 13 }, "앞쪽 +13 을 안 받았다");
  // ⚠평년 구간의 +14 는 −351 과 같은 날짜다(이중 걸림) → 지난 해. 윤일을 사이에 둔 구간에서만 +14 가 앞쪽으로 남는다(아래 2028-06-15 · 2028-02-15)
  assert.deepEqual(ok("2026-08-15", "08-29"), { date: "2025-08-29", lag: -351 }, "평년 구간의 +14(= −351)를 앞쪽 예고로 읽었다");
  assert.deepEqual(ok("2028-02-28", "02-29"), { date: "2028-02-29", lag: 1 });
  assert.deepEqual(ok("2028-02-15", "02-29"), { date: "2028-02-29", lag: 14 }, "2/29 앞쪽 +14 를 안 받았다");
  // 지난 해(맥박만) — 3판: 183 을 넘어도 351 까지는 지난 해다(개막이 늦은 해에 낡은 비시즌 페이지가 매 실행 막지 않는다)
  assert.deepEqual(ok("2026-08-15", "08-30"), { date: "2025-08-30", lag: -350 }, "+15 는 앞쪽 밖이라 지난 해(−350)여야 한다");
  assert.deepEqual(ok("2028-08-30", "02-29"), { date: "2028-02-29", lag: -183 });
  assert.deepEqual(ok("2028-08-31", "02-29"), { date: "2028-02-29", lag: -184 });
  assert.deepEqual(ok("2027-06-15", "12-13"), { date: "2026-12-13", lag: -184 });
  assert.deepEqual(ok("2027-06-15", "08-19"), { date: "2026-08-19", lag: -300 });
  assert.deepEqual(ok("2028-06-15", "06-30"), { date: "2027-06-30", lag: -351 }, "−351 을 지난 해로 안 받았다");
  assert.deepEqual(ok("2029-02-14", "02-29"), { date: "2028-02-29", lag: -351 }, "2/29 −351 을 지난 해로 안 받았다");
  assert.deepEqual(ok("2027-08-31", "03-01"), { date: "2027-03-01", lag: -183 }, "앞쪽 +183(2028-03-01)을 골랐다");
  assert.deepEqual(ok("2027-01-05", "11-01"), { date: "2026-11-01", lag: -65 });
  assert.deepEqual(ok("2027-05-01", "10-30"), { date: "2026-10-30", lag: -183 }, "앞쪽 +182 를 미래 예고로 받았다");
  assert.deepEqual(ok("2027-06-15", "10-30"), { date: "2026-10-30", lag: -228 }, "낡은 비시즌 페이지(−228)를 지난 해로 안 받았다");
  assert.deepEqual(ok("2020-06-10", "10-23"), { date: "2019-10-23", lag: -231 }, "2020형(늦은 개막) 낡은 페이지(−231)를 지난 해로 안 받았다");
  // 352 — 창 밖의 지난 날짜는 앞쪽 해로 읽힌다(연도 없는 MM-DD 는 366일 창에서 하나로만 정해진다)
  assert.deepEqual(ok("2027-06-15", "06-28"), { date: "2027-06-28", lag: 13 }, "−352 의 날짜는 앞쪽 +13 이어야 한다");
  assert.deepEqual(ok("2028-06-15", "06-29"), { date: "2028-06-29", lag: 14 }, "−352 의 날짜는 앞쪽 +14 이어야 한다(윤일을 사이에 둠)");
  // 이중 걸림 — 2026-06-29(−351)와 2027-06-29(+14)가 둘 다 창 안이다 → 지난 해(맥박만 · 틀려도 시끄러운 쪽 · 재검토 m1)
  assert.deepEqual(ok("2027-06-15", "06-29"), { date: "2026-06-29", lag: -351 }, "이중 걸림에서 앞쪽(+14 · 예고)을 골랐다 — 틀리면 starters-behind 가 14일 꺼진다");
  // 실패 — 02-29 가 창 밖일 때뿐
  for (const [f, md, why] of [
    ["2027-08-30", "02-29", /\+183일/],
    ["2027-08-29", "02-29", /\+184일/],
    ["2028-02-14", "02-29", /\+15일/],
    ["2029-02-15", "02-29", /-352일/],
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
