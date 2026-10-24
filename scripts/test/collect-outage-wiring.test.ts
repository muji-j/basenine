/**
 * `daily.yml` — 받기 실패만 있는 실행(rc 75)은 **배포하고 붉게 끝낸다**(설계 `docs/superpowers/specs/2026-10-24-collection-resilience-design.md` D6 · 시험 T9).
 *
 * ⚠**세 겹으로 잰다**: ⑴ `수집·적재` 의 셸을 **실제 bash + 가짜 node**(셸 함수)로 돌린다 ⑵ collect 잡의 **모든 단계 `if:` 글자**를 설계 D6 표와
 *   맞댄다(바꾸지 않은 단계는 그대로) ⑶ **GitHub 식 평가기**(아래 · 순차 · `failure()` = 앞선 실패 · 단계의 `exit 1` 이 뒤 `failure()` 를 참으로)로
 *   다섯 경우의 마지막 메시지 수를 센다 — rc 75 이고 취소가 아니면 **정확히 1**(A 또는 B) · 취소와 rc≠75 는 0.
 * ⚠YAML 파서를 쓰지 않는다(이 저장소의 다른 워크플로 시험과 같은 방식 · `workflow-shell.ts`).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DAILY, jobBlock, runBash, runOf, stepNamed, stepsOf } from "./workflow-shell.ts";
import type { Step } from "./workflow-shell.ts";

const STEPS = stepsOf(DAILY, "collect");

/** 주석 줄을 뺀 단계 본문 */
const noComment = (s: string): string =>
  s
    .split("\n")
    .filter((l) => !/^\s*#/.test(l))
    .join("\n");

/** 단계의 `if:` 글자(없으면 null) */
function ifOf(s: Step): string | null {
  const m = /^ {8}if: (.*)$/m.exec(noComment(s.body));
  return m === null ? null : m[1]!.trim();
}

const coe = (s: Step): boolean => /^ {8}continue-on-error: true$/m.test(noComment(s.body));

// ---- ⑴ 수집·적재 의 셸 — 실제 bash ----------------------------------------------------

const UPDATE_STEP = stepNamed(DAILY, "collect", "수집·적재");

function runUpdateShell(rc: number): { status: number | null; rcLine: string; out: string } {
  // ⚠가짜 node — 셸 함수가 PATH 의 명령보다 먼저다. 진짜 update.ts 는 안 돈다(외부 요청 0)
  const r = runBash(`node() { return ${String(rc)}; }\n${runOf(UPDATE_STEP)}`, { GITHUB_OUTPUT: "out.txt" });
  const out = readFileSync(join(r.dir, "out.txt"), "utf8");
  return { status: r.status, rcLine: out.trim(), out: `${r.stdout}${r.stderr}` };
}

test("⚠T9 수집·적재 — rc 0 은 통과 · 75 는 0 으로 통과하고 rc=75 와 경고 · 1·2·137 은 그 코드로 실패(rc 는 먼저 남긴다)", () => {
  const ok = runUpdateShell(0);
  assert.equal(ok.status, 0);
  assert.equal(ok.rcLine, "rc=0");
  const up = runUpdateShell(75);
  assert.equal(up.status, 0, "75 를 실패로 끝냈다 — 이미 받은 데이터로 배포할 수 없다");
  assert.equal(up.rcLine, "rc=75");
  assert.match(up.out, /::warning::npb\.jp 받기 실패만 있었다 — 이미 받은 데이터로 배포한다/);
  for (const rc of [1, 2, 137]) {
    const r = runUpdateShell(rc);
    assert.equal(r.status, rc, `rc ${String(rc)} 를 통과시켰다 — 적재·파싱 실패가 배포로 흘러간다`);
    assert.equal(r.rcLine, `rc=${String(rc)}`, "실패하기 전에 rc 를 안 남겼다");
  }
});

test("⚠T9 수집·적재 — id update · 단계 제한 30분(걸쇠) · 회로 env · continue-on-error 없음 · env 로만", () => {
  const b = noComment(UPDATE_STEP.body);
  assert.match(b, /^ {8}id: update$/m);
  assert.match(b, /^ {8}timeout-minutes: 30$/m);
  assert.match(b, /^ {10}BB_NPB_CIRCUIT_N: \$\{\{ needs\.decide\.outputs\.slot == 'retry' && '1' \|\| '3' \}\}$/m, "재시도 슬롯 1 · 그 밖 3 이 아니다");
  assert.doesNotMatch(b, /^ {8}continue-on-error:/m, "수집·적재를 격리했다 — 1 이 배포를 막지 못한다");
  assert.equal(runOf(UPDATE_STEP).includes("${{"), false, "run: 에 식이 직접 들어갔다 — env 로만 넘겨라");
  // ⚠잡 시간 제한 45 는 그대로다(정정 경로의 예산이 그 값을 쓴다)
  assert.match(jobBlock(DAILY, "collect"), /^ {4}timeout-minutes: 45$/m);
});

// ---- ⑵ 모든 단계의 if: — 설계 D6 표 ------------------------------------------------------

/** [이름 접두(`exact` 면 글자 그대로) · uses 접두] → 기대 `if:`(없으면 null) · 차례도 이 표다 */
const TABLE: { name?: string; exact?: true; uses?: string; if: string | null }[] = [
  { name: "잡 시작 시각", if: null },
  { uses: "actions/checkout@", if: null },
  { uses: "actions/setup-node@", if: null },
  { name: "의존성 설치", if: null },
  { name: "L6 확인", if: null },
  { name: "아카이브·DB 복원", if: null },
  { name: "복원 검증", if: null },
  { name: "드래프트 원본 복원", if: null },
  { name: "수집·적재", if: null },
  { name: "드래프트 적재", if: null },
  { name: "공표 성적표 갱신", if: "success() && steps.update.outputs.rc != '75'" },
  { name: "정정 감지 · 자동 재수집", if: "success() && steps.update.outputs.rc != '75'" },
  { name: "수집 후 재검증", if: "always()" },
  { name: "보관소에 올림", if: "always() && steps.guard.outcome == 'success'" },
  { name: "기록 갱신과 커밋", if: "always()" },
  { name: "파서 자기 검증", if: null },
  { name: "득점 대조", if: null },
  { name: "외부 대조", if: null },
  { name: "화면 생성", if: null },
  { name: "서체 부분집합", if: null },
  { name: "npb 픽스처 복원", if: null },
  { name: "시험", if: null },
  { name: "S1 확인", if: "success()" },
  { name: "Access 설정 확인", if: "success()" },
  { name: "배포", exact: true, if: "success()" },
  { name: "배포 반영 확인", if: "${{ !cancelled() }}" },
  { name: "산출물 목록 만들기", if: "${{ failure() || cancelled() }}" },
  { name: "산출물 목록 보관", if: "${{ failure() || cancelled() }}" },
  { name: "상류 장애 요약", if: "failure() && steps.update.outputs.rc == '75'" },
  { name: "상류 장애 — 실행을 붉게 끝낸다", if: "success() && steps.update.outputs.rc == '75'" },
];

test("⚠⚠T9 collect 잡의 모든 단계 if: 가 설계 D6 표와 같다 — 바꾼 것은 공표 성적표·정정 둘과 새 A·B 뿐 · 맨 끝이 A → B", () => {
  assert.equal(STEPS.length, TABLE.length, `단계가 ${String(STEPS.length)}개다(표 ${String(TABLE.length)}개) — 표를 고치거나 단계를 확인하라: ${STEPS.map((s) => s.name || s.uses).join(" | ")}`);
  STEPS.forEach((s, i) => {
    const want = TABLE[i]!;
    if (want.uses !== undefined) assert.ok(s.uses.startsWith(want.uses), `${String(i)}번째 단계가 ${s.uses || s.name} 다(기대 ${want.uses})`);
    else if (want.exact === true) assert.equal(s.name, want.name, `${String(i)}번째 단계`);
    else assert.ok(s.name.startsWith(want.name!), `${String(i)}번째 단계가 「${s.name}」다(기대 「${want.name!}」)`);
    assert.equal(ifOf(s), want.if, `「${s.name || s.uses}」의 if: 가 바뀌었다`);
  });
});

test("⚠T9 continue-on-error: true 는 정확히 셋(드래프트 원본 복원 · 드래프트 적재 · 공표 성적표 갱신) — 새 단계에는 없다", () => {
  assert.deepEqual(
    STEPS.filter(coe).map((s) => s.name.split(" ")[0]),
    ["드래프트", "드래프트", "공표"],
  );
  assert.equal((noComment(jobBlock(DAILY, "collect")).match(/continue-on-error: true/g) ?? []).length, 3);
});

test("⚠T9 B 는 ::error:: 를 찍고 exit 1 · A 는 요약만 찍는다(실행은 이미 붉다)", () => {
  const a = STEPS.at(-2)!;
  const b = STEPS.at(-1)!;
  const runB = runBash(runOf(b));
  assert.equal(runB.status, 1);
  assert.match(runB.stdout, /^::error::npb\.jp 받기 실패 — 이미 받은 데이터로 배포했다/m);
  const runA = runBash(runOf(a));
  assert.equal(runA.status, 0);
  assert.match(runA.stdout, /^::error::npb\.jp 받기 실패에 다른 실패가 겹쳤다/m);
});

test("⚠T9 화면 생성은 rc 75 일 때만 BB_UPSTREAM_OUTAGE=1 을 받는다(낡음 게이트만 경고로)", () => {
  const b = noComment(stepNamed(DAILY, "collect", "화면 생성").body);
  assert.match(b, /^ {10}BB_UPSTREAM_OUTAGE: \$\{\{ steps\.update\.outputs\.rc == '75' && '1' \|\| '' \}\}$/m);
  assert.equal((DAILY.match(/BB_UPSTREAM_OUTAGE/g) ?? []).length >= 1, true);
  // 다른 단계에는 넘기지 않는다
  for (const s of STEPS) if (!s.name.startsWith("화면 생성")) assert.equal(noComment(s.body).includes("BB_UPSTREAM_OUTAGE:"), false, `「${s.name}」에 BB_UPSTREAM_OUTAGE 가 있다`);
});

test("⚠T9 외부 대조 — 실패했고 rc 75 면 「정정: 상류 장애로 건너뜀」(관문 판정은 그대로)", () => {
  const gate = stepNamed(DAILY, "collect", "외부 대조");
  assert.match(noComment(gate.body), /^ {10}UPDATE_RC: \$\{\{ steps\.update\.outputs\.rc \}\}$/m);
  const code = noComment(runOf(gate));
  const tail = code.slice(code.indexOf('if [ "$fail" != 0 ]; then')).replaceAll("/tmp/correction-refetch", "work");
  const r = runBash(`fail=1\n${tail}`, { UPDATE_RC: "75" });
  assert.equal(r.status, 1, "관문의 종료 코드가 바뀌었다");
  assert.match(r.stdout, /정정: 상류 장애로 건너뜀/);
  assert.doesNotMatch(r.stdout, /보고 없음/, "건너뛴 실행에 「보고 없음」(롤백 표지)을 찍었다");
});

// ---- ⑶ GitHub 식 평가기 — 다섯 경우의 메시지 수 ----------------------------------------------

/**
 * 작은 GitHub 식 평가기 — 이 워크플로가 쓰는 것만: `success()` `failure()` `cancelled()` `always()` · `steps.<id>.outcome` ·
 * `steps.<id>.outputs.<name>` · `'글자'` · `==` `!=` `&&` `||` `!` `( )`.
 * ⚠상태 함수가 없는 식은 앞에 `success() &&` 가 붙는다(GitHub 규칙) · `${{ }}` 는 벗긴다.
 */
interface World {
  failed: boolean;
  cancelled: boolean;
  outcomes: Map<string, string>;
  outputs: Map<string, Map<string, string>>;
}

function evaluate(raw: string | null, w: World): boolean {
  let src = (raw ?? "success()").trim();
  const wrapped = /^\$\{\{([\s\S]*)\}\}$/.exec(src);
  if (wrapped !== null) src = wrapped[1]!.trim();
  if (!/\b(success|failure|cancelled|always)\(\)/.test(src)) src = `success() && (${src})`;
  const tokens = src.match(/'[^']*'|==|!=|&&|\|\||!|\(|\)|[A-Za-z_][\w.-]*\(\)|[A-Za-z_][\w.-]*/g) ?? [];
  let i = 0;
  const peek = (): string | undefined => tokens[i];
  const take = (): string => tokens[i++]!;
  const value = (): unknown => {
    const t = take();
    if (t === "(") {
      const v = or();
      assert.equal(take(), ")");
      return v;
    }
    if (t === "!") return !truthy(value());
    if (t.startsWith("'")) return t.slice(1, -1);
    if (t === "success()") return !w.failed && !w.cancelled;
    if (t === "failure()") return w.failed;
    if (t === "cancelled()") return w.cancelled;
    if (t === "always()") return true;
    const out = /^steps\.([\w-]+)\.outputs\.([\w-]+)$/.exec(t);
    if (out !== null) return w.outputs.get(out[1]!)?.get(out[2]!) ?? "";
    const oc = /^steps\.([\w-]+)\.outcome$/.exec(t);
    if (oc !== null) return w.outcomes.get(oc[1]!) ?? "";
    throw new Error(`평가기가 모르는 낱말: ${t}`);
  };
  const truthy = (v: unknown): boolean => v === true || (typeof v === "string" && v !== "");
  const cmp = (): unknown => {
    const l = value();
    if (peek() === "==" || peek() === "!=") {
      const op = take();
      const r = value();
      const eq = String(l).toLowerCase() === String(r).toLowerCase();
      return op === "==" ? eq : !eq;
    }
    return l;
  };
  const and = (): unknown => {
    let l = cmp();
    while (peek() === "&&") {
      take();
      const r = cmp();
      l = truthy(l) && truthy(r);
    }
    return l;
  };
  const or = (): unknown => {
    let l = and();
    while (peek() === "||") {
      take();
      const r = and();
      l = truthy(l) || truthy(r);
    }
    return l;
  };
  const v = or();
  assert.equal(i, tokens.length, `식을 다 못 읽었다: ${src}`);
  return truthy(v);
}

/**
 * 잡을 차례대로 흉내 낸다. `rc` = 수집·적재의 rc · `fail` = 실패시킬 단계(이름 접두) · `cancelAt` = 그 단계에서 실행이 취소된다.
 * 돌린 단계 이름을 돌려준다. ⚠수집·적재는 rc 0·75 면 성공, 그 밖이면 실패다(위 ⑴ 이 셸로 잰 것).
 */
function simulate(o: { rc: number; fail?: string; cancelAt?: string }): string[] {
  const w: World = { failed: false, cancelled: false, outcomes: new Map(), outputs: new Map() };
  const ran: string[] = [];
  // 단계 이름은 「머리 — 설명」 모양이다 — 머리 글자 그대로이거나 「머리 —」로 시작하면 그 단계다(「배포」 ≠ 「배포 반영 확인」)
  const is = (name: string, head: string): boolean => name === head || name.startsWith(`${head} —`);
  for (const s of STEPS) {
    const id = /^ {8}id: ([\w-]+)$/m.exec(noComment(s.body))?.[1];
    const name = s.name || s.uses;
    if (o.cancelAt !== undefined && is(name, o.cancelAt)) {
      w.cancelled = true;
      if (id !== undefined) w.outcomes.set(id, "cancelled");
      continue;
    }
    if (!evaluate(ifOf(s), w)) {
      if (id !== undefined) w.outcomes.set(id, "skipped");
      continue;
    }
    ran.push(name);
    let outcome = "success";
    if (name.startsWith("수집·적재")) {
      w.outputs.set("update", new Map([["rc", String(o.rc)]]));
      if (o.rc !== 0 && o.rc !== 75) outcome = "failure";
    }
    if (o.fail !== undefined && is(name, o.fail)) outcome = "failure";
    if (name.startsWith("상류 장애 — 실행을 붉게")) outcome = "failure"; // B 는 exit 1 이다(위 시험이 셸로 잰다)
    if (id !== undefined) w.outcomes.set(id, outcome);
    if (outcome === "failure" && !coe(s)) w.failed = true;
  }
  return ran;
}

const A = "상류 장애 요약";
const B = "상류 장애 — 실행을 붉게";
const messagesOf = (ran: string[]): string[] => ran.filter((n) => n.startsWith(A) || n.startsWith(B));
const deployed = (ran: string[]): boolean => ran.includes("배포");

test("⚠⚠T9 평가기 — rc 75 + 전부 성공 → 배포가 돌고 메시지는 정확히 1(B)", () => {
  const ran = simulate({ rc: 75 });
  assert.ok(deployed(ran), "rc 75 인데 배포가 안 돌았다");
  assert.ok(!ran.some((n) => n.startsWith("공표 성적표 갱신")), "rc 75 인데 공표표를 또 받았다(장애 중 30요청)");
  assert.ok(!ran.some((n) => n.startsWith("정정 감지")), "rc 75 인데 정정 받기를 돌렸다");
  for (const keep of ["수집 후 재검증", "보관소에 올림", "기록 갱신과 커밋", "외부 대조", "화면 생성", "시험", "배포 반영 확인"]) {
    assert.ok(ran.some((n) => n.startsWith(keep)), `rc 75 인데 「${keep}」가 안 돌았다`);
  }
  const m = messagesOf(ran);
  assert.equal(m.length, 1, m.join(" | "));
  assert.ok(m[0]!.startsWith(B));
});

test("⚠⚠T9 평가기 — rc 75 + 외부 대조 실패 → 배포 안 함 · 메시지는 정확히 1(A)", () => {
  const ran = simulate({ rc: 75, fail: "외부 대조" });
  assert.ok(!deployed(ran), "외부 대조가 실패했는데 배포했다");
  const m = messagesOf(ran);
  assert.equal(m.length, 1, m.join(" | "));
  assert.ok(m[0]!.startsWith(A));
});

test("⚠⚠T9 평가기 — rc 75 + 배포 실패 → 메시지는 정확히 1(A)", () => {
  const ran = simulate({ rc: 75, fail: "배포" });
  const m = messagesOf(ran);
  assert.equal(m.length, 1, m.join(" | "));
  assert.ok(m[0]!.startsWith(A));
});

test("⚠T9 평가기 — rc 75 + 취소 → 0 · rc≠75 → 0(성공이든 실패든)", () => {
  assert.deepEqual(messagesOf(simulate({ rc: 75, cancelAt: "시험" })), []);
  assert.deepEqual(messagesOf(simulate({ rc: 0 })), []);
  assert.deepEqual(messagesOf(simulate({ rc: 0, fail: "외부 대조" })), []);
  for (const rc of [1, 2, 137]) {
    const ran = simulate({ rc });
    assert.deepEqual(messagesOf(ran), [], `rc ${String(rc)}`);
    assert.ok(!deployed(ran), `rc ${String(rc)} 인데 배포했다`);
    assert.ok(ran.some((n) => n.startsWith("보관소에 올림")) && ran.some((n) => n.startsWith("기록 갱신과 커밋")), "부분 수집분 보존·기록이 안 돌았다");
  }
});

test("⚠T9 평가기 — rc 0 + 전부 성공이면 공표표·정정을 받고 배포하며 A·B 는 안 돈다(평소와 같다)", () => {
  const ran = simulate({ rc: 0 });
  for (const keep of ["공표 성적표 갱신", "정정 감지"]) assert.ok(ran.some((n) => n.startsWith(keep)), `rc 0 인데 「${keep}」가 안 돌았다`);
  assert.ok(deployed(ran));
  assert.deepEqual(messagesOf(ran), []);
});
