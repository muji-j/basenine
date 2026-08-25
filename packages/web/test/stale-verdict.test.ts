/**
 * **「古い」가 무엇이 낡았는지 말하는가.**
 *
 * ⚠**예전에는 안 말했다**(2026-08-25 · 감사 P3 #53). 감시는 축이 **다섯**인데
 * (試合データなし · 試合が古い · 通算が古い · 予告先発が遅れ · 予告先発が停止)
 * `log.html` 은 그 전부를 「古い」 한 글자로 뭉갰다. 바로 옆 칸이 「最新試合日 = 1일 전」이면
 * 읽는 사람은 **판정이 고장난 줄로 읽는다.**
 *
 * ⚠**그 오진이 실제로 났다**(2026-08-17). 낡은 것은 경기가 아니라 **통산**이었는데
 * 원인을 「NPB 가 늦다」로 남 탓하고 엉뚱한 처방까지 얹었다.
 *
 * ⚠**같은 「古い」인데 뜻이 두 벌이라는 것도 여기서 갈랐다.**
 * `log.html` 의 판정 = 다섯 감시 OR · 경기 임계 **2일**.
 * 나머지 페이지 상단 띠 = 경기 지연 하나 · 임계 **3일**(`layout.ts` `STALE_AFTER_DAYS`).
 * **일부러 다르다** — 경보는 띠보다 하루 먼저 울려야 한다. 그런데 그 사실이
 * 어디에도 안 적혀 있었다. 지금은 화면 각주와 아래 시험이 그 관계를 붙든다.
 * ⚠**실측(2026-08-25 · 로그 63행)**: 지연은 1일 49회 · 2일 14회뿐이고
 * **두 임계가 갈리는 창(지연 정확히 3일)에 아직 한 번도 안 들어갔다**(0/63).
 * 「0건」이지 「안 쟀음」이 아니다(작업규칙 7).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { staleVerdict } from "../src/log-page.ts";
import { STALE_AFTER_DAYS } from "../src/layout.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const MONITOR = readFileSync(join(ROOT, "scripts", "freshness.ts"), "utf8");

test("정상이면 축을 말하지 않는다", () => {
  assert.equal(staleVerdict({ stale: false }), "正常");
  assert.equal(staleVerdict({ stale: false, staleReasons: [] }), "正常");
});

/** ⚠**이것이 고친 대상이다** — 고치기 전에는 어느 경우에나 「古い」였다 */
test("⚠울렸으면 어느 축인지 말한다", () => {
  assert.equal(staleVerdict({ stale: true, staleReasons: ["career-lag"] }), "通算が古い");
  assert.equal(
    staleVerdict({ stale: true, staleReasons: ["game-lag", "starters-lag"] }),
    "試合が古い・予告先発が停止",
  );
});

/** ⚠**「이유를 안 남기던 시절」과 「이유가 없다」는 다르다**(M11) */
test("⚠옛 줄(이유 칸이 아예 없음)과 빈 이유를 구별해 말한다", () => {
  assert.equal(staleVerdict({ stale: true }), "古い（内訳の記録なし）");
  assert.equal(staleVerdict({ stale: true, staleReasons: [] }), "古い（内訳なし）");
});

/** ⚠**모르는 키를 삼키면 「울렸는데 이유가 안 보이는」 화면이 된다** — 그게 원래 결함의 모양이다(M7) */
test("⚠라벨이 없는 키는 키 자체를 보여준다 — 조용히 빼지 않는다", () => {
  assert.equal(staleVerdict({ stale: true, staleReasons: ["something-new"] }), "something-new");
});

/**
 * ⚠**감시와 화면이 갈라지는 것을 막는다**(M1 의 정신).
 * 키는 `scripts/freshness.ts` 가 정하고 문구는 `log-page.ts` 가 붙인다 —
 * 한쪽만 늘리면 화면에 **날 키가 그대로** 나간다.
 */
test("⚠감시가 미는 키 전부에 화면 문구가 있다", () => {
  const keys = [...MONITOR.matchAll(/staleReasons\.push\("([^"]+)"\)/g)].map((m) => m[1]!);
  assert.ok(keys.length >= 5, `감시에서 키를 ${keys.length}개밖에 못 찾았다 — 이 시험이 공회전한다`);
  const naked = keys.filter((k) => staleVerdict({ stale: true, staleReasons: [k] }) === k);
  assert.deepEqual(
    naked,
    [],
    "이 키들이 화면 문구 없이 날것으로 나간다 — `STALE_REASON_LABEL` 에 일본어 문구를 더해라",
  );
  console.log(`  · 감시 키 ${keys.length}개 [${keys.join(" ")}] 전부 문구 있음`);
});

/**
 * ⚠**경보가 띠보다 먼저 울려야 한다.** 반대가 되면 화면이 「更新が止まっています」라고
 * 말하는데 수집 로그는 「正常」인 날이 생긴다 — 그건 어느 쪽을 믿어야 할지 모르는 화면이다.
 */
test("⚠경보 임계가 띠 임계보다 엄격하다", () => {
  const m = /node scripts\/freshness\.ts data\/bb\.sqlite (\d+)/.exec(
    readFileSync(join(ROOT, ".github", "workflows", "daily.yml"), "utf8"),
  );
  assert.ok(m !== null, "daily.yml 에서 감시 임계 인자를 못 읽었다 — 이 시험이 공회전한다");
  const monitorDays = Number(m![1]!);
  assert.ok(
    monitorDays < STALE_AFTER_DAYS,
    `감시 임계 ${monitorDays}일이 띠 임계 ${STALE_AFTER_DAYS}일보다 엄격하지 않다.\n` +
      "⚠경보는 띠보다 **먼저** 울려야 한다. 띠가 먼저 울리면 화면이 「멈췄다」고 하는데\n" +
      "  수집 로그는 「正常」인 날이 생긴다.",
  );
  console.log(`  · 감시 ${monitorDays}일 < 띠 ${STALE_AFTER_DAYS}일`);
});
