/**
 * **Access 앱 설정 게이트의 순수 부분.**
 *
 * ⚠**네트워크를 치지 않는다**(작업규칙 11). Cloudflare API 응답을 손으로 만들어 넣고
 * 「어긋남을 세는 함수」와 「못 쟀음을 가르는 함수」만 본다 — 그 둘이 이 게이트의 판단 전부다.
 *
 * ## 이 게이트가 왜 있는가
 *
 * ⚠**S1 담장의 설정이 대시보드 클릭으로만 존재했다.** 배포는 「담장이 살아 있는가」(302 + AUD)까지만
 * 보고 **세션이 몇 시간인지는 아무도 안 봤다.** 그래서 24시간짜리 세션이 그대로 있었고,
 * 지인이 **매일** 이메일 코드를 받아야 했다(2026-08-24 사용자 지적).
 *
 * ⚠**「어긋났다」와 「못 쟀다」를 반드시 가른다**(작업규칙 7). Pages 배포용 토큰에는
 * Zero Trust 권한이 없어서 이 검사는 **돌지 않을 수 있다.** 그때 `0`(통과)을 내면
 * 이 저장소가 이미 두 번 겪은 「없는 장치를 있다고 적는」 상태가 된다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { APP_AUD, TARGET, diff, unmeasured, verdictFor } from "../access-config.ts";
import type { AccessApp } from "../access-config.ts";

const OK: AccessApp = {
  id: "app-1",
  name: "bb-app",
  aud: APP_AUD,
  session_duration: TARGET.sessionDuration,
  allowed_idps: [],
  auto_redirect_to_identity: false,
};

test("목표와 같으면 어긋남이 0건이다", () => {
  assert.deepEqual(diff(OK), []);
});

/** ⚠**이것이 고치려던 상태 그 자체다** — 24시간이면 지인이 매일 코드를 받는다 */
test("⚠세션이 24시간으로 되돌아가면 잡는다", () => {
  const ds = diff({ ...OK, session_duration: "24h" });
  assert.equal(ds.length, 1);
  assert.equal(ds[0]!.what, "세션 길이");
  assert.equal(ds[0]!.now, "24h");
  assert.equal(ds[0]!.want, "730h");
});

/**
 * ⚠**`undefined` 와 `[]` 를 같게 본다.** API 가 둘 다 「제한 없음」으로 돌려준다 —
 * 다르게 세면 매일 「어긋났다」가 뜨고, 매일 뜨는 경고는 아무도 안 읽는다.
 */
test("⚠allowed_idps 가 없는 것과 빈 것은 같다 — 매일 우는 게이트를 만들지 않는다", () => {
  const bare: AccessApp = { id: "a", name: "n", aud: APP_AUD, session_duration: TARGET.sessionDuration };
  assert.deepEqual(diff(bare), [], "빈 값을 어긋남으로 세고 있다");
});

/**
 * ⚠**로그인 수단을 하나로 묶어 버리는 것**을 잡는다. Google 만 남기면
 * **Google 계정이 없는 지인이 못 들어온다** — One-time PIN 이 남아야 한다.
 */
test("⚠로그인 수단을 특정 IdP 로 좁히면 잡는다", () => {
  const ds = diff({ ...OK, allowed_idps: ["google-only"] });
  assert.equal(ds.length, 1);
  assert.equal(ds[0]!.what, "허용 로그인 수단");
  assert.equal(ds[0]!.now, "google-only");
  assert.equal(ds[0]!.want, "제한 없음");
});

/**
 * ⚠**자동 이동을 켜면 One-time PIN 화면에 갈 수 없다.** IdP 가 하나일 때는 편하지만,
 * Google 을 붙인 뒤에는 **Google 없는 사람을 막는 스위치**가 된다.
 */
test("⚠IdP 자동 이동이 켜지면 잡는다 — Google 없는 지인이 막힌다", () => {
  const ds = diff({ ...OK, auto_redirect_to_identity: true });
  assert.equal(ds.length, 1);
  assert.equal(ds[0]!.what, "IdP 자동 이동");
});

test("여러 곳이 어긋나면 전부 센다 — 하나만 보고 멈추지 않는다", () => {
  const ds = diff({ ...OK, session_duration: "24h", auto_redirect_to_identity: true });
  assert.equal(ds.length, 2, `어긋남을 ${ds.length}건만 셌다`);
});

/**
 * ⚠**권한 없음은 「통과」가 아니라 「안 쟀음」이다.**
 * Pages 배포용 토큰에는 Zero Trust 권한이 없다 — 그때 0 을 내면 게이트가 있다는 착각만 남는다.
 */
test("⚠401·403·5xx 는 「못 쟀음」이다", () => {
  for (const s of [401, 403, 500, 502, 503]) {
    assert.equal(unmeasured(s), true, `HTTP ${s} 를 「쟀다」로 보고 있다`);
  }
});

test("⚠200·400·404 는 「못 쟀음」이 아니다 — 답을 받았으니 판정할 수 있다", () => {
  for (const s of [200, 400, 404]) {
    assert.equal(unmeasured(s), false, `HTTP ${s} 를 「못 쟀다」로 보고 있다`);
  }
});

/**
 * ⚠**AUD 는 두 곳에 있고 갈리면 게이트가 딴 앱을 본다.**
 * `daily.yml` 의 `EXPECT_AUD` 와 이 파일의 `APP_AUD` 가 같아야 한다 — 한쪽만 고치는 사고를 막는다.
 */
test("⚠AUD 가 daily.yml 과 같다 — 한쪽만 고치면 게이트가 딴 앱을 본다", async () => {
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const yml = readFileSync(`${root}.github/workflows/daily.yml`, "utf8");
  const m = /EXPECT_AUD:\s*"([0-9a-f]{64})"/.exec(yml);
  assert.ok(m !== null, "daily.yml 에서 EXPECT_AUD 를 못 읽었다 — 이 시험이 공회전한다");
  assert.equal(m![1], APP_AUD, "AUD 가 갈렸다 — 둘을 같이 고쳐라");
});

/**
 * ⚠**이 셋이 이 게이트에서 가장 위험한 갈림길이다**(2026-08-24 실측으로 드러났다).
 *
 * 첫 실행에서 Cloudflare 가 **`success` + 빈 배열**을 돌려줬다 — 토큰이 Zero Trust 를 못 보는데
 * 403 이 아니라 「없다」처럼 답한 것이다. 그걸 「어긋났다」로 두면 **배포가 매일 깨진다**
 * (읽기 권한 하나 때문에 화면이 안 올라간다).
 *
 * ⚠**앱이 없어진 게 아니라는 근거가 있다** — S1 게이트가 매일 그 앱의 리다이렉트를 확인한다.
 */
test("⚠앱 목록이 비면 「못 쟀다」다 — 「없어졌다」가 아니다", () => {
  assert.equal(verdictFor([], APP_AUD), "unmeasured");
});

test("⚠목록은 있는데 그 AUD 가 없으면 「어긋났다」다", () => {
  assert.equal(verdictFor([{ ...OK, aud: "다른앱" }], APP_AUD), "missing");
});

test("찾으면 found 다", () => {
  assert.equal(verdictFor([{ ...OK, aud: "다른앱" }, OK], APP_AUD), "found");
});
