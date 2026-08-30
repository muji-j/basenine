/**
 * **「배포했다」와 「보인다」를 가르는 판정의 시험.**
 *
 * ⚠**이 판정이 없어서 사고가 조용했다**(2026-08-30). `wrangler` 의 성공 로그는
 * 「업로드가 끝났다」까지만 말하는데 우리는 그것을 「사람에게 닿았다」로 읽고 있었다.
 * ⚠**순수 함수로 뽑아 둔 이유가 이것이다** — 네트워크가 있으면 이 표를 못 고정한다.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  LIVE_STALE_AFTER_HOURS,
  ageInHours,
  describe as describeVerdict,
  verdictFor,
} from "../verify-deploy.ts";
import type { PagesProject } from "../verify-deploy.ts";

const NOW = "2026-08-30T00:20:00Z";

function project(over: Partial<PagesProject> = {}): PagesProject {
  return {
    production_branch: "main",
    canonical_deployment: { id: "dep-new", environment: "production", created_on: "2026-08-30T00:16:00Z" },
    latest_deployment: { id: "dep-new", environment: "production", created_on: "2026-08-30T00:16:00Z" },
    ...over,
  };
}

test("정상이면 ok — 지금 보이는 것이 방금 올린 것이다", () => {
  const v = verdictFor(project(), "main", NOW);
  assert.equal(v.kind, "ok");
  assert.equal(describeVerdict(v).level, "ok");
});

/**
 * ⚠**이 사고의 가설이 정확히 이것이다.** 프로젝트의 프로덕션 브랜치가 다르면
 * `--branch main` 은 **매번 프리뷰**를 만들고, 성공 로그는 똑같이 나오며,
 * 사람이 보는 주소는 옛 배포에 멈춘다.
 */
test("⚠프로덕션 브랜치가 다르면 error — 매번 프리뷰가 된다", () => {
  const v = verdictFor(project({ production_branch: "master" }), "main", NOW);
  assert.equal(v.kind, "wrong-branch");
  const d = describeVerdict(v);
  assert.equal(d.level, "error");
  assert.match(d.text, /프리뷰/, "무엇이 일어나는지를 안 적었다");
  assert.match(d.text, /daily\.yml/, "어디를 고쳐야 하는지를 안 적었다");
});

/**
 * ⚠**배포 직후에는 `canonical` 갱신이 몇 초 늦을 수 있다.** 그때마다 붉어지면
 * 이 검사는 「또 그거네」가 되어 곧 지워진다 — **그러면 사고가 다시 조용해진다.**
 * 그래서 **나이를 봐서 가른다.**
 */
test("⚠올린 것이 프로덕션이 안 됐는데 살아 있는 것이 새것이면 경고 — 전파 지연을 붉게 칠하지 않는다", () => {
  const v = verdictFor(
    project({ latest_deployment: { id: "dep-newer", created_on: "2026-08-30T00:16:00Z" } }),
    "main",
    NOW,
  );
  assert.equal(v.kind, "not-live");
  const d = describeVerdict(v);
  assert.equal(d.level, "warning");
  assert.match(d.text, /다음 실행에서도 같으면/, "다음에 무엇을 봐야 하는지를 안 적었다");
});

test("⚠살아 있는 것이 이미 낡았는데 최신과도 다르면 error — 그건 전파 지연이 아니다", () => {
  const v = verdictFor(
    project({
      canonical_deployment: { id: "dep-old", created_on: "2026-08-18T12:00:00Z" },
      latest_deployment: { id: "dep-newer", created_on: "2026-08-30T00:16:00Z" },
    }),
    "main",
    NOW,
  );
  assert.equal(v.kind, "not-live");
  assert.equal(describeVerdict(v).level, "error");
});

test("⚠나이를 모르면 경고에 머문다 — 모르는 것으로 배포를 세우지 않는다(M11)", () => {
  const v = verdictFor(
    project({
      canonical_deployment: { id: "dep-live" },
      latest_deployment: { id: "dep-newer", created_on: "2026-08-30T00:16:00Z" },
    }),
    "main",
    NOW,
  );
  assert.equal(v.kind, "not-live");
  assert.equal(describeVerdict(v).level, "warning");
});

/**
 * ⚠**사용자가 겪은 그 모양**: 배포는 계속 성공하는데 보이는 것은 며칠 전 것이다.
 * 12시간을 넘으면(하루 3회 배포이므로 정상 최대 9시간) 전달 경로가 끊긴 것이다.
 */
test("⚠지금 보이는 배포가 낡았으면 error — 사용자가 겪은 그 모양이다", () => {
  const old = { id: "dep-old", created_on: "2026-08-18T12:00:00Z" };
  const v = verdictFor(project({ canonical_deployment: old, latest_deployment: old }), "main", NOW);
  assert.equal(v.kind, "stale");
  assert.equal(describeVerdict(v).level, "error");
});

test(`경계: ${LIVE_STALE_AFTER_HOURS}시간 이내는 ok, 넘으면 stale`, () => {
  const at = (iso: string): string => {
    const d = { id: "d", created_on: iso };
    return verdictFor(project({ canonical_deployment: d, latest_deployment: d }), "main", NOW).kind;
  };
  // NOW 에서 정확히 12시간 전 → 아직 ok
  assert.equal(at("2026-08-29T12:20:00Z"), "ok");
  // 12시간 1분 전 → stale
  assert.equal(at("2026-08-29T12:19:00Z"), "stale");
});

/**
 * ⚠**「못 쟀다」를 「통과」로 만들지 않는다** — 하지만 **배포를 세우지도 않는다.**
 * 읽기 권한 하나 때문에 매일 화면이 안 올라가면 그 검사는 곧 지워진다
 * (`scripts/access-config.ts` 가 같은 이유로 경고에 머문다).
 */
test("⚠못 읽으면 unmeasured — 경고이지 통과가 아니고, 배포를 세우지도 않는다", () => {
  const v = verdictFor(null, "main", NOW);
  assert.equal(v.kind, "unmeasured");
  const d = describeVerdict(v);
  assert.equal(d.level, "warning");
  assert.match(d.text, /통과가 아니라/, "「못 쟀다」와 「통과」를 구별해 말하지 않았다");
});

test("응답에 필드가 없으면 unmeasured — 없는 것을 정상으로 읽지 않는다(M11)", () => {
  assert.equal(verdictFor({}, "main", NOW).kind, "unmeasured");
  assert.equal(verdictFor(project({ canonical_deployment: null }), "main", NOW).kind, "unmeasured");
});

/**
 * ⚠**모르는 것과 0 을 구별한다**(M11). `created_on` 이 없을 때 0시간으로 메우면
 * 「방금 배포됐다」는 뜻이 되어 **이 검사가 정확히 반대로 거짓말한다.**
 */
test("⚠취득 시각을 모르면 null 이다 — 0 으로 메우지 않는다(M11)", () => {
  assert.equal(ageInHours(null, NOW), null);
  assert.equal(ageInHours("", NOW), null);
  assert.equal(ageInHours("어제", NOW), null);
  assert.equal(ageInHours("2026-08-29T00:20:00Z", NOW), 24);
});

test("⚠시각을 몰라도 낡음으로 단정하지 않는다 — 모르는 것은 모르는 것이다", () => {
  const d = { id: "d" };
  const v = verdictFor(project({ canonical_deployment: d, latest_deployment: d }), "main", NOW);
  assert.equal(v.kind, "ok");
  assert.equal(describeVerdict(v).text.includes("시간 전"), false, "모르는 나이를 적었다");
});

/**
 * ⚠**「도구가 있다」와 「그것이 돈다」는 다른 말이다**(`crosscheck-wired.test.ts` 와 같은 병).
 * 이 검사는 **CI 에서만** 의미가 있다 — 로컬에는 Cloudflare 토큰이 없다.
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const yml = readFileSync(join(ROOT, ".github", "workflows", "daily.yml"), "utf8");
/** ⚠주석을 코드로 읽지 않는다 */
const code = yml.split(/\r?\n/).filter((l) => !/^\s*#/.test(l)).join("\n");

test("⚠배포 반영 확인이 CI 에서 돈다", () => {
  assert.match(code, /scripts\/verify-deploy\.ts/, "워크플로에서 안 돈다 — 토큰이 있는 곳은 여기뿐이다");
});

/**
 * ⚠**배포보다 뒤여야 한다.** 앞에 두면 **직전 배포**를 재게 되어 늘 한 판 늦고,
 * 오늘 올린 것이 프로덕션이 됐는지는 영영 안 본다.
 */
test("⚠배포 뒤에 돈다 — 앞에 두면 늘 한 판 늦는다", () => {
  const deploy = code.indexOf("wrangler pages deploy");
  const check = code.indexOf("scripts/verify-deploy.ts");
  assert.ok(deploy > 0 && check > 0, "두 자리를 다 못 찾았다 — 이 시험이 공회전한다");
  assert.ok(check > deploy, "확인이 배포보다 앞이다 — 직전 배포를 재게 된다");
});

/**
 * ⚠**배포가 실패한 날에도 돌아야 한다.** 그날이야말로 **지금 무엇이 보이는지**를 알아야 하는 날이다.
 * `if: success()` 로 묶으면 정확히 그때 입을 다문다.
 */
test("⚠배포가 실패한 날에도 돈다 — 그날이 가장 알고 싶은 날이다", () => {
  const at = yml.indexOf("배포 반영 확인");
  assert.ok(at > 0, "스텝 이름을 못 찾았다 — 이 시험이 공회전한다");
  const block = yml.slice(at, at + 1200);
  const ifLine = block.split(/\r?\n/).find((l) => /^\s*if:/.test(l)) ?? "";
  assert.ok(!/success\(\)/.test(ifLine), `success() 로 묶여 있다: ${ifLine.trim()}`);
  assert.match(ifLine, /cancelled\(\)/, "취소된 실행까지 도는 조건이 아니다");
});
