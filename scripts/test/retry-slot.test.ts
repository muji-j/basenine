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
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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
