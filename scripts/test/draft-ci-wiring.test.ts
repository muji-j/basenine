/**
 * **드래프트를 일일 배치에 붙인 두 스텝이, 붙지 말아야 할 것에 붙지 않았는가.**
 *
 * ⚠**이 시험이 있는 이유는 실제로 한 번 틀렸기 때문이다**(2026-09-06 · 머지 전 검수에서 잡힘).
 * 초판은 복원 스텝을 이렇게 썼다:
 *
 * ```sh
 * set -euo pipefail
 * if gh release download ...; then
 *   tar -xf ...        # ← 여기가 실패하면?
 * fi
 * ```
 *
 * `set -e` 는 `if CMD; then BODY; fi` 에서 **`CMD` 만** 면제한다. `BODY` 의 `tar` 가 실패하면
 * 스텝이 죽고, **바로 뒤의 `수집·적재` 는 `if:` 가 없어 통째로 건너뛴다** — 그날 경기가
 * 한 건도 안 들어온다. ⚠**이 저장소는 2026-08-17 에 선수 페이지에서 같은 모양을 이미 겪었다**
 * (「일과성 오류 하나가 그날 수집한 경기 전부를 버렸다」). 드래프트 배선이 그것을 되풀이할 뻔했다.
 *
 * ## 무엇을 고정하는가
 *
 * ⚠**「손해의 크기가 다른 것을 같은 운명에 묶지 않는다」**가 이 시험의 한 줄 요약이다.
 *
 * | 스텝 | 하루 못 돌면 | 그래서 |
 * |---|---|---|
 * | 드래프트 복원·적재 | **손해 0** — 연 1회 바뀌고 DB 에 어제 값이 남는다 | **격리한다**(`continue-on-error`) |
 * | 수집·적재 | 그날 경기가 밀린다 | **격리하지 않는다** — 시끄럽게 죽어야 한다 |
 *
 * ⚠**`continue-on-error` 는 결과를 감추는 스위치가 아니라 전파를 끊는 스위치다.**
 * 그래서 실패 경로가 `::error::` 를 내는 것까지 같이 고정한다 — 조용해지면 이 배선은
 * 「에러가 아니라 빈 화면」이 되고, 그건 이 저장소가 가장 싫어하는 실패 모양이다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const YML = join(dirname(fileURLToPath(import.meta.url)), "..", "..", ".github", "workflows", "daily.yml");
const yml = readFileSync(YML, "utf8");

const RESTORE = "드래프트 원본 복원";
const LOAD = "드래프트 적재";
const COLLECT = "수집·적재";
const GUARD = "복원 검증";

/**
 * `      - name: …` 로 시작하는 스텝을 순서대로 자른다.
 * ⚠**YAML 파서를 쓰지 않는다** — 이 저장소의 다른 워크플로 시험(`retry-slot.test.ts`)이
 * 같은 방식이고, 의존을 늘리지 않는 쪽을 따른다.
 */
function steps(): { name: string; body: string; index: number }[] {
  const re = /^ {6}- name: (.+)$/gm;
  const heads = [...yml.matchAll(re)];
  assert.ok(heads.length > 0, "daily.yml 에서 스텝을 하나도 못 잘랐다 — 이 시험이 공회전한다");
  return heads.map((m, i) => ({
    name: m[1]!.trim(),
    body: yml.slice(m.index! + m[0]!.length, heads[i + 1]?.index ?? yml.length),
    index: i,
  }));
}

function stepStartingWith(prefix: string): { name: string; body: string; index: number } {
  const found = steps().filter((s) => s.name.startsWith(prefix));
  assert.equal(found.length, 1, `「${prefix}」로 시작하는 스텝이 ${found.length}개다 — 1개여야 한다`);
  return found[0]!;
}

test("드래프트 두 스텝이 실재한다 — 이름이 바뀌면 아래 시험 전부가 공회전한다", () => {
  for (const prefix of [RESTORE, LOAD, COLLECT, GUARD]) {
    stepStartingWith(prefix);
  }
});

test("⚠드래프트 복원이 실패해도 그날 경기 수집을 막지 않는다 — continue-on-error 로 격리한다", () => {
  const s = stepStartingWith(RESTORE);
  assert.match(
    s.body,
    /^ {8}continue-on-error: true$/m,
    "드래프트 복원 스텝에 `continue-on-error: true` 가 없다. " +
      "이 스텝은 `수집·적재` 보다 앞에 있으므로, 죽으면 그날 경기가 한 건도 안 들어온다",
  );
});

test("⚠드래프트 적재가 실패해도 빌드·배포를 막지 않는다 — 손해의 크기가 다르다", () => {
  const s = stepStartingWith(LOAD);
  assert.match(
    s.body,
    /^ {8}continue-on-error: true$/m,
    "드래프트 적재 스텝에 `continue-on-error: true` 가 없다. " +
      "드래프트는 연 1회 바뀌는데 그것 때문에 그날 사이트가 안 나가는 것은 균형이 안 맞는다",
  );
});

test("⚠수집·적재는 격리하지 않는다 — 그날 경기가 안 들어온 것은 시끄럽게 죽어야 한다", () => {
  const s = stepStartingWith(COLLECT);
  assert.doesNotMatch(
    s.body,
    /^ {8}continue-on-error:/m,
    "`수집·적재` 에 continue-on-error 가 붙었다. 이 스텝의 실패는 감추면 안 된다 — " +
      "감추면 「경기가 안 들어온 날」이 「성공한 날」로 보이고 재시도 슬롯이 그것을 보고 거른다",
  );
});

test("⚠격리한 스텝은 조용해지지 않는다 — 실패 경로가 ::error:: 를 낸다", () => {
  for (const prefix of [RESTORE, LOAD]) {
    const s = stepStartingWith(prefix);
    assert.match(
      s.body,
      /echo "::error::/,
      `「${prefix}」의 실패 경로에 ::error:: 주석이 없다. continue-on-error 는 전파를 끊는 것이지 ` +
        "결과를 감추는 것이 아니다 — 주석이 없으면 이 배선은 조용히 안 도는 쪽이 된다",
    );
  }
});

test("⚠복원은 archive-guard 뒤에 온다 — 앞에 두면 매니페스트 대조가 like-for-like 가 아니다", () => {
  assert.ok(
    stepStartingWith(GUARD).index < stepStartingWith(RESTORE).index,
    "드래프트 복원이 `복원 검증` 보다 앞에 있다. 그러면 매니페스트에 없는 550파일이 검증 대상에 섞여 " +
      "「이 스텝이 넣은 것」인지 「아카이브가 변한 것」인지 구별할 수 없다",
  );
});

test("⚠펴기 전에 tar 를 읽어 본다 — 잘린 것을 그냥 펴면 반쪽이 다음 날 정본이 된다", () => {
  const s = stepStartingWith(RESTORE);
  const check = s.body.indexOf("tar -tf");
  const extract = s.body.indexOf("tar -xf");
  assert.notEqual(check, -1, "`tar -tf` 무결성 확인이 없다 — 잘린 tar 가 그대로 펴진다");
  assert.notEqual(extract, -1, "`tar -xf` 가 없다 — 이 시험이 공회전한다");
  assert.ok(
    check < extract,
    "무결성 확인이 펴는 것보다 뒤에 있다. 그러면 확인이 아무것도 막지 못한다 — " +
      "반쯤 펴진 드래프트가 `data/archive` 에 남고 그날 세대 tar 가 그것을 접어 올린다",
  );
});

test("⚠적재에 `--to` 를 주지 않는다 — 상한을 박으면 새 해가 열린 날 조용히 빠진다", () => {
  const s = stepStartingWith(LOAD);
  const cmd = /load-draft-archive\.ts[^\n]*/.exec(s.body);
  assert.notEqual(cmd, null, "적재 스텝에서 load-draft-archive.ts 호출을 못 찾았다 — 이 시험이 공회전한다");
  assert.match(cmd![0], /--from \d{4}/, "`--from` 이 없다 — 하한이 없으면 소급 범위가 흐려진다");
  assert.doesNotMatch(
    cmd![0],
    /--to\b/,
    "`--to` 가 붙었다. 상한을 박으면 다음 드래프트가 열린 해에 그 해만 조용히 빠진다 — " +
      "이 저장소가 「연도를 박지 마라」로 여러 번 데인 자리다",
  );
});

test("⚠복원이 **두 출처를 따로 센다** — 하나로 접으면 「위키가 없다」가 「좀 적다」로 보인다", () => {
  const s = stepStartingWith(RESTORE);
  assert.match(
    s.body,
    /data\/archive\/wikipedia\/draft/,
    "복원 스텝이 `data/archive/wikipedia/draft` 를 세지 않는다. " +
      "그러면 위키 원본이 자산에서 빠진 날 **2023~2025 의 1位指名 경합만 조용히 사라진다** — " +
      "에러가 아니라 빈 화면이라 아무도 결함으로 못 읽는다",
  );
  assert.match(
    s.body,
    /data\/archive\/npb\/draft/,
    "복원 스텝이 npb 쪽을 세지 않는다 — 이 시험이 공회전한다",
  );
});

test("⚠파일을 세는 줄이 `set -e` 로 스텝을 죽이지 않는다 — 뿌리가 없는 날이 반드시 온다", () => {
  /**
   * ⚠**실측이다**: `set -euo pipefail` 아래에서 `n=$(find 없는경로 2>/dev/null | wc -l)` 는
   * **`echo` 까지 못 간다.** `find` 가 exit 1 이고 `pipefail` 이 그걸 파이프 밖으로 내보내며
   * `set -e` 가 대입문에서 죽는다. ⚠**그 「없는 날」이 바로 자산을 아직 안 넓힌 첫날**이고,
   * 그때 죽으면 로그가 **복원 결과를 한 줄도 안 남긴다.**
   */
  const s = stepStartingWith(RESTORE);
  const counts = s.body.split(/\r?\n/u).filter((l) => /=\$\(.*find .*wc -l/u.test(l));
  assert.ok(counts.length >= 2, `파일을 세는 줄을 ${counts.length}개 찾았다 — 2개 이상이어야 한다(이 시험이 공회전한다)`);
  for (const line of counts) {
    assert.match(
      line,
      /\|\| true/u,
      "`|| true` 가 없다 — 뿌리가 없으면 이 줄에서 스텝이 죽는다(실측): " + line.trim(),
    );
  }
});

test("⚠적재 가드가 두 뿌리를 다 본다 — npb 만 보면 위키만 있는 날 조용히 건너뛴다", () => {
  const s = stepStartingWith(LOAD);
  const guard = /if \[ ! -d ([^\]]+)\] && \[ ! -d ([^\]]+)\]; then/.exec(s.body);
  assert.notEqual(guard, null, "적재 스텝의 아카이브 가드를 못 찾았다 — 이 시험이 공회전한다");
  const both = `${guard![1]} ${guard![2]}`;
  assert.match(both, /npb\/draft/, "가드에 npb 뿌리가 없다");
  assert.match(both, /wikipedia\/draft/, "가드에 wikipedia 뿌리가 없다");
});

test("⚠적재는 외부 요청을 내지 않는다 — CI 가 npb.jp 를 다시 치면 L7 위반이다", () => {
  const s = stepStartingWith(LOAD);
  assert.doesNotMatch(
    s.body,
    /cli-draft|curl|wget|fetch/,
    "적재 스텝이 수집기를 부르거나 외부를 친다. 그 소스는 ETag·Last-Modified 를 안 주므로 " +
      "재취득은 275요청을 상대에게 다시 무는 일이다(L1·L7)",
  );
});
