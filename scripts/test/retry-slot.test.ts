/**
 * **재시도 슬롯이 무엇을 보고 돌지 말지를 정하는가.**
 *
 * 두 가지가 어긋날 수 있고, 어긋나면 **조용히** 잘못 돈다.
 *
 * ## ⑴ 크론과 `case` 가 글자까지 같아야 한다
 *
 * `decide` 는 **크론 표현식으로** 「이번이 재시도 슬롯인가」를 판정한다.
 * 한쪽만 고치면 재시도가 **「정시 슬롯」으로 판정돼 성공한 날에도 수집이 돈다**(하루 3회 → 6회).
 * ⚠**`daily.yml` 이 「글자까지 같아야 한다」고 적어 두고 있었지만, 그걸 확인하는 장치는 없었다**
 * (2026-08-25). 이 저장소가 반복해 데인 모양이라 여기서 장치로 만든다.
 *
 * ## ⑵ 「직전 실행」이 정시 실행이어야 한다
 *
 * ⚠**필터가 없어서 수동 실행과 옛 `push` 실행까지 집혔다**(감사 P3 #11).
 * **위험한 방향은 「건너뜀」이다**: 정시가 실패했는데 그 뒤 수동 실행이 성공하면
 * 재시도가 「직전이 성공」으로 읽고 거른다 — **予告先発은 거르면 영영 못 받는다.**
 *
 * 실측(2026-08-25 · 완료 실행 **100건**): 정시 실행 **44건** 중
 * **필터를 넣으면 답이 달라지는 것 4건**, 그중 **3건이 그 위험한 방향**이었다.
 * ⚠**그 4건이 재시도 슬롯이었는지는 미확정** — `gh` 가 실행별 크론을 안 알려준다.
 * **노출 측정이지 실해 증명이 아니다**(작업규칙 7).
 * ⚠이력에 `push` 이벤트 실행이 남아 있다(트리거는 이후 제거됐다) — 필터 없는 질의는 그것도 집는다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DAILY, runBash, runOf, stepNamed } from "./workflow-shell.ts";

const YML = join(dirname(fileURLToPath(import.meta.url)), "..", "..", ".github", "workflows", "daily.yml");
const yml = readFileSync(YML, "utf8");

/** `schedule:` 아래의 크론들. 「재시도 슬롯」 주석 앞뒤로 가른다 */
function crons(): { regular: string[]; retry: string[] } {
  const at = yml.indexOf("재시도 슬롯");
  assert.notEqual(at, -1, "daily.yml 에서 「재시도 슬롯」 구분 주석을 못 찾았다 — 이 시험이 공회전한다");
  const all = [...yml.matchAll(/^\s*-\s*cron:\s*"([^"]+)"/gm)];
  const regular: string[] = [];
  const retry: string[] = [];
  for (const m of all) (m.index < at ? regular : retry).push(m[1]!);
  return { regular, retry };
}

/** `decide` 의 `case` 에 적힌 패턴들 */
function casePatterns(): string[] {
  const m = /case\s+"\$\{SCHEDULE:-\}"\s+in([\s\S]*?)esac/.exec(yml);
  assert.notEqual(m, null, "decide 의 case 블록을 못 찾았다 — 이 시험이 공회전한다");
  const line = /^\s*("(?:[^"]+)"(?:\|"[^"]+")*)\)/m.exec(m![1]!);
  assert.notEqual(line, null, "case 의 크론 패턴 줄을 못 찾았다 — 이 시험이 공회전한다");
  return line![1]!.split("|").map((s) => s.replace(/"/g, ""));
}

test("⚠크론과 case 를 뽑는 방식이 헛돌지 않는다", () => {
  const { regular, retry } = crons();
  assert.ok(regular.length >= 3, `정시 크론을 ${regular.length}개밖에 못 찾았다`);
  assert.ok(retry.length >= 3, `재시도 크론을 ${retry.length}개밖에 못 찾았다`);
  assert.ok(casePatterns().length >= 3, "case 패턴을 3개 미만으로 읽었다");
  console.log(`  · 정시 ${regular.length}개 · 재시도 ${retry.length}개 · case ${casePatterns().length}개`);
});

/** ⚠**어긋나면 성공한 날에도 수집이 하루 6회 돈다** — L1 의 「하루 1회 배치가 기본」에서 그만큼 멀어진다 */
test("⚠재시도 크론과 decide 의 case 가 글자까지 같다", () => {
  const { retry } = crons();
  assert.deepEqual(
    [...casePatterns()].sort(),
    [...retry].sort(),
    "재시도 크론과 case 가 어긋났다.\n" +
      "⚠**한쪽만 고치면 재시도가 「정시 슬롯」으로 판정돼 성공한 날에도 수집이 돈다**(하루 6회).\n" +
      "  두 곳을 **글자까지 같게** 맞춰라.",
  );
});

/** ⚠**정시 크론이 case 에 들어가면 정시 실행이 「재시도」로 판정돼 건너뛸 수 있다** */
test("⚠정시 크론은 case 에 없다", () => {
  const { regular } = crons();
  const leaked = casePatterns().filter((p) => regular.includes(p));
  assert.deepEqual(leaked, [], "정시 크론이 재시도 case 에 들어갔다 — 그 슬롯이 조용히 건너뛸 수 있다");
});

test("⚠직전 실행을 물을 때 정시 실행과 이 브랜치로 거른다", () => {
  const m = /gh api "repos\/\$REPO\/actions\/workflows\/daily\.yml\/runs\?([^"]+)"/.exec(yml);
  assert.notEqual(m, null, "직전 실행 질의를 못 찾았다 — 이 시험이 공회전한다");
  const q = m![1]!;
  assert.match(q, /(^|&)event=schedule(&|$)/, "event=schedule 필터가 없다 — 수동 실행이 판정에 섞인다");
  assert.match(q, /(^|&)branch=/, "branch 필터가 없다 — 다른 브랜치의 실행이 판정에 섞인다");
  assert.match(q, /(^|&)status=completed(&|$)/, "status=completed 가 빠졌다 — 진행 중 실행을 본다");
  assert.match(q, /(^|&)per_page=1(&|$)/, "per_page=1 이 빠졌다");
});

/**
 * ## ⚠깊은 실행(전 시즌 스캔) 배선 (2026-08-31)
 *
 * `BB_FULL_SCAN` 한 값이 **페이지 표본**과 **시즌 범위** 두 가지를 겸하고 있었고,
 * 켠 근거로 적힌 것은 페이지 쪽뿐인데 **비용은 시즌 쪽에서 났다**
 * (CI 실측 295.7초 = 시험 490초의 60% · run 33379836307).
 * 갈라서 시즌 쪽을 **하루 한 번**으로 돌렸다.
 *
 * ⚠**여기가 조용히 깨지는 자리다.** 크론 글자에 오타가 나면 `deep=1` 이 **영영 안 뜨고**,
 * 그래도 시험은 전부 초록이다 — 얕게 도는 것은 실패가 아니기 때문이다.
 * **덜 재는 쪽으로 조용히 넘어가는** 그 모양을 여기서 못 박는다.
 */

/** `decide` 에서 `deep=1` 을 켜는 크론 글자들 */
function deepCrons(): string[] {
  return [...yml.matchAll(/^\s*"([^"]+)"\)\s*deep=1\s*;;/gm)].map((m) => m[1]!);
}

test("⚠깊은 실행 슬롯이 정확히 하나이고, 그 글자가 정시 크론에 실재한다", () => {
  const deep = deepCrons();
  assert.equal(deep.length, 1, `deep=1 슬롯이 ${deep.length}개다 — 하나여야 한다: ${deep.join(" · ")}`);
  const { regular, retry } = crons();
  assert.ok(
    regular.includes(deep[0]!),
    `깊은 실행 슬롯 "${deep[0]}" 이 정시 크론에 없다 — 오타면 전 시즌 스캔이 영영 안 돈다.\n` +
      `  정시 크론: ${regular.join(" · ")}`,
  );
  assert.ok(
    !retry.includes(deep[0]!),
    `깊은 실행 슬롯 "${deep[0]}" 이 재시도 크론이다 — 재시도는 실패한 날에만 돌므로 거의 안 돈다`,
  );
  console.log(`  · 깊은 실행 슬롯 "${deep[0]}"`);
});

/**
 * ⚠**`case` 는 `exit 0` 으로 빠져나간다.** `deep` 을 그 뒤에 내면 **정시 슬롯에서 값이 비어 나가고**,
 * 빈 문자열은 얕은 쪽이라 **전 시즌 스캔이 한 번도 안 돈다.** 순서가 곧 값이다.
 */
test("⚠deep 을 재시도 판정보다 먼저 낸다 — 뒤에 두면 정시 슬롯에서 비어 나간다", () => {
  const emit = yml.indexOf('echo "deep=${deep}"');
  assert.notEqual(emit, -1, "deep 을 GITHUB_OUTPUT 에 내는 줄을 못 찾았다 — 이 시험이 공회전한다");
  const retryCase = yml.indexOf('case "${SCHEDULE:-}" in');
  assert.notEqual(retryCase, -1, "재시도 case 를 못 찾았다 — 이 시험이 공회전한다");
  assert.ok(emit < retryCase, "deep 출력이 재시도 case 보다 뒤에 있다 — 정시 슬롯에서 비어 나간다");
});

test("⚠시험 단계가 BB_ALL_SEASONS 를 decide 의 deep 에 잇는다", () => {
  const heads = [...yml.matchAll(/^ +- name: 시험$/gm)];
  assert.equal(heads.length, 1, `「시험」 단계가 ${heads.length}개다 — 어느 것을 재는지 모른다`);
  const at = heads[0]!.index;
  const next = yml.indexOf("- name: ", at + 10);
  const step = yml.slice(at, next < 0 ? yml.length : next);
  assert.match(
    step,
    /^ +BB_ALL_SEASONS: \$\{\{ needs\.decide\.outputs\.deep \}\}$/m,
    "「시험」 단계가 BB_ALL_SEASONS 를 decide 의 deep 에 잇지 않는다 — 전 시즌 스캔이 안 돈다",
  );
  assert.match(yml, /^ +deep: \$\{\{ steps\.check\.outputs\.deep \}\}$/m, "decide 가 deep 을 outputs 에 안 낸다");
});

/**
 * ⚠**이 값을 읽는 시험이 실재하는가.** 배선만 맞고 읽는 쪽이 없으면 아무것도 안 바뀐다 —
 * 「없는 장치를 있다고 적는」 그 모양이고 이 저장소가 여러 번 앓았다.
 */
test("⚠BB_ALL_SEASONS 를 실제로 읽는 시험이 있다", () => {
  const roots = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "packages", "web", "test");
  const readers = readdirSync(roots)
    .filter((f) => f.endsWith(".test.ts"))
    .filter((f) => readFileSync(join(roots, f), "utf8").includes('process.env["BB_ALL_SEASONS"]'));
  assert.ok(
    readers.length >= 2,
    `BB_ALL_SEASONS 를 읽는 시험이 ${readers.length}개뿐이다 — 배선만 있고 읽는 쪽이 없다`,
  );
  console.log(`  · 읽는 시험 ${readers.length}본: ${readers.join(" · ")}`);
});

/**
 * ## ⚠`slot` 출력(2026-10-02 · 정정 자동 재수집 · 설계 D1 · D6 의 4)
 *
 * 새 단계(`정정 감지 · 자동 재수집`)는 **정시·수동 실행만** 받는다 — 재시도 슬롯은 받지 않는다(하루 6회가 되면 L1 에서 멀어진다).
 * 그 판정에 쓰는 `BB_RUN_SLOT` 은 `decide` 의 `slot` 출력(`scheduled` · `retry` · `manual`)이고, **재시도 크론 목록은 위 `case` 한 곳**이다.
 *
 * ⚠**`case` 는 `exit 0` 으로 빠져나간다.** 정시 갈래에서 `slot` 을 `exit 0` 뒤에 내면 **값이 비어 나가고**, 진입점은 빈 값을
 * `slot_unknown`(받지 않음)으로 읽는다 — **정정 자동 재수집이 영영 안 도는데 아무것도 안 붉다.** 순서가 곧 값이다(`deep` 과 같은 모양).
 *
 * ⚠**글자 검사로는 부족하다** — `decide` 의 셸을 **실제로 돌려** 크론마다 무엇이 나오는지 본다(외부 호출 앞에서 자른다 · `gh` 0).
 */

/** `decide` 의 run 에서 `case "${SCHEDULE:-}" in … esac` 까지(그 뒤의 `gh api` 호출 앞) */
function decideUntilEsac(): string {
  const run = runOf(stepNamed(DAILY, "decide", "재시도 슬롯인가"));
  const open = run.indexOf('case "${SCHEDULE:-}" in');
  assert.notEqual(open, -1, "decide 의 재시도 case 를 못 찾았다 — 이 시험이 공회전한다");
  const close = run.indexOf("esac", open);
  assert.notEqual(close, -1);
  return `${run.slice(0, close + 4)}\necho FALLTHROUGH`;
}

function decideOutputs(schedule: string): { out: Map<string, string>; fell: boolean; status: number | null } {
  const r = runBash(decideUntilEsac(), { SCHEDULE: schedule, GITHUB_OUTPUT: "out.txt" }, (dir) => writeFileSync(join(dir, "out.txt"), ""));
  assert.ok(r.status === 0, `decide 조각이 실패했다(${String(r.status)}): ${r.stderr}`);
  const out = new Map<string, string>();
  for (const l of readFileSync(join(r.dir, "out.txt"), "utf8").split("\n")) {
    const m = /^([a-z]+)=(.*)$/.exec(l);
    if (m !== null) out.set(m[1]!, m[2]!);
  }
  return { out, fell: r.stdout.includes("FALLTHROUGH"), status: r.status };
}

test("⚠T12 slot — 정시 크론은 scheduled · 곧바로 run=true 로 끝난다(case 뒤로 안 내려간다)", () => {
  const { regular } = crons();
  for (const c of regular) {
    const r = decideOutputs(c);
    assert.equal(r.out.get("slot"), "scheduled", `정시 크론 "${c}" 의 slot`);
    assert.equal(r.out.get("run"), "true", `정시 크론 "${c}" 는 늘 돈다`);
    assert.equal(r.fell, false, `정시 크론 "${c}" 가 case 를 지나 직전 실행 판정까지 내려갔다`);
    assert.ok(r.out.has("deep"), "deep 이 비어 나갔다");
  }
});

test("⚠T12 slot — 재시도 크론은 retry · run 은 아직 정하지 않는다(직전 실행을 본 뒤에 정한다)", () => {
  const { retry } = crons();
  for (const c of retry) {
    const r = decideOutputs(c);
    assert.equal(r.out.get("slot"), "retry", `재시도 크론 "${c}" 의 slot`);
    assert.equal(r.fell, true, `재시도 크론 "${c}" 가 직전 실행 판정으로 안 내려갔다`);
    assert.equal(r.out.has("run"), false, `재시도 크론 "${c}" 가 직전 실행을 보기 전에 run 을 정했다`);
  }
});

test("⚠T12 slot — 수동(크론 없음)은 manual · 모르는 크론은 scheduled 다(retry 로 새지 않는다)", () => {
  const manual = decideOutputs("");
  assert.equal(manual.out.get("slot"), "manual");
  assert.equal(manual.out.get("run"), "true");
  assert.equal(manual.fell, false);
  const unknown = decideOutputs("17 3 * * *");
  assert.equal(unknown.out.get("slot"), "scheduled", "모르는 크론은 정시로 읽어 돈다(모르면 돈다 — 위 주석)");
  assert.equal(unknown.out.get("run"), "true");
});
