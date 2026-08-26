/**
 * **소급 불가 자산의 원격 사본이 하나뿐이었다** — 세대 보관의 규칙을 붙든다.
 *
 * ⚠아카이브는 **소급 불가**다(오늘 못 받은 페이지는 내일도 못 받는다). 그런데 보관소의
 * `archive.tar` 는 매일 `--clobber` 로 덮였고, `gh release upload --help` 원문이
 * 「`--clobber` 사용 시 기존 자산을 **삭제한 뒤** 업로드하며, **업로드가 실패하면 원본 자산이 소실된다**」
 * 라고 적는다 — **하루 한 번 스스로 지우는 창**이 열려 있었다(감사 [4]-①).
 *
 * ## ⚠감사 명세의 이름을 그대로 쓰면 더 나빠진다
 *
 * 명세는 세대 이름으로 `archive-YYYYMMDD.tar` 를 제안했는데, **그건 이미 다른 뜻**이다 —
 * 복원이 `archive-*.tar` 를 「백필 덧붙임」으로 보고 **전부 전개**한다. 그대로 했으면
 * 세대를 매일 전부 풀고 전부 내려받았을 것이다. **그래서 접두사를 `store-` 로 나눴다.**
 *
 * ## 실측으로 확인한 기계 (2026-08-26 · 임시 릴리스에서 실행 후 삭제)
 *
 * ⑴ `gh release download --pattern` 은 **여러 번** 줄 수 있고 지정한 것만 받는다(옛 세대는 안 받는다)
 * ⑵ `gh release delete-asset` 로 가지치기가 된다
 * ⑶ **같은 이름 재업로드는 `--clobber` 없이 종료 1** — 이 워크플로는 **하루 3회** 도므로
 *    오늘 세대는 덮어써야 한다(시각을 이름에 넣으면 하루 329MiB × 3 이 쌓인다)
 * ⑷ 세대는 이름 정렬로 최신을 고를 수 있다(`sort | last`)
 *
 * ⚠**남는 위험을 숨기지 않는다**: 오늘 세대는 여전히 덮어쓰기 경로에 있다.
 * 다만 **어제 이전은 아예 그 경로에 없고**, 오늘 것을 잃어도 다음 실행이 그 페이지를 다시 받는다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const YML = join(dirname(fileURLToPath(import.meta.url)), "..", "..", ".github", "workflows", "daily.yml");
const yml = readFileSync(YML, "utf8");

/**
 * 주석을 걷어 낸 본문.
 *
 * ⚠**이 시험이 처음에 주석을 코드로 읽었다**(2026-08-26). 「⚠**KEEP=1 로 두지 마라**」라는
 * **경고문**을 값으로 집어서, `KEEP=3` 인데 `KEEP=1` 이라고 떨어졌다 —
 * 이 저장소가 반복해 데인 「주석 안의 예시가 규칙으로 잡힌다」 그 함정이다.
 * ⚠**값을 읽는 단언은 전부 이쪽을 본다.** 원문(`yml`)은 「그 스텝이 있는가」에만 쓴다.
 */
const code = yml.split(/\r?\n/).filter((l) => !/^\s*#/.test(l)).join("\n");

/** 세대 이름의 접두사. ⚠**`archive-` 를 쓰면 복원이 백필로 오인한다** */
const GEN_PREFIX = "store-";

test("⚠워크플로를 읽는 방식이 헛돌지 않는다", () => {
  assert.ok(yml.includes("보관소에 올림"), "업로드 스텝을 못 찾았다 — 이 시험이 공회전한다");
  assert.ok(yml.includes("아카이브·DB 복원"), "복원 스텝을 못 찾았다 — 이 시험이 공회전한다");
});

/** ⚠**이것이 함정이다** — 두 이름이 겹치면 복원이 세대를 백필로 보고 전부 푼다 */
test("⚠세대 접두사가 백필 덧붙임과 겹치지 않는다", () => {
  const gen = /GEN="([^"]+)"/.exec(code);
  assert.notEqual(gen, null, "세대 이름을 못 찾았다 — 이 시험이 공회전한다");
  assert.ok(
    gen![1]!.startsWith(GEN_PREFIX),
    `세대 이름이 "${GEN_PREFIX}" 로 시작하지 않는다: ${gen![1]}\n` +
      "⚠`archive-` 로 두면 복원의 「덧붙임 자산」 전개가 세대를 **전부 푼다.**",
  );
  assert.ok(
    !gen![1]!.startsWith("archive-"),
    "세대 이름이 백필 덧붙임(`archive-*.tar`)과 같은 접두사다 — 복원이 둘을 구별하지 못한다",
  );
});

/** ⚠**하루 3회 돈다** — 시각까지 넣으면 하루에 329MiB × 3 이 쌓인다 */
test("⚠세대 이름에 날짜만 넣는다 — 시각을 넣으면 하루에 셋이 쌓인다", () => {
  const gen = /GEN="([^"]+)"/.exec(code)![1]!;
  assert.match(gen, /%Y%m%d/, `세대 이름에 날짜가 없다: ${gen}`);
  assert.ok(!/%H|%M|%S/.test(gen), `세대 이름에 시각이 들어갔다: ${gen}`);
});

/**
 * ⚠**필요한 것만 받는다.** 인자 없이 부르면 **자산을 전부** 받고,
 * 세대 보관에서 그건 「매일 세대 전부를 내려받는다」는 뜻이 된다.
 */
test("⚠복원이 --pattern 으로 필요한 것만 받는다", () => {
  const downloads = [...code.matchAll(/gh release download[^\n]*(?:\n\s+[^\n]*)*/g)].map((m) => m[0]);
  assert.ok(downloads.length >= 1, "복원의 다운로드를 못 찾았다 — 이 시험이 공회전한다");
  const noPattern = downloads.filter((d) => !d.includes("--pattern"));
  assert.deepEqual(
    noPattern,
    [],
    "패턴 없이 받는 곳이 있다 — 자산을 전부 받게 되고, 세대가 쌓일수록 매일 그만큼 더 받는다",
  );
});

test("⚠최신 세대는 이름 정렬로 고른다", () => {
  assert.match(
    code,
    /select\(startswith\("store-"\)\)\] \| sort \| last/,
    "최신 세대를 고르는 식이 없다 — 복원이 어느 세대를 쓸지 모른다",
  );
});

/** ⚠**KEEP=1 은 세대 보관이 아니다** — 오늘 것 하나뿐이면 덮어쓰기 창이 그대로 남는다 */
test("⚠보관 세대 수가 2 이상이다", () => {
  const keep = /KEEP=(\d+)/.exec(code);
  assert.notEqual(keep, null, "KEEP 을 못 찾았다 — 이 시험이 공회전한다");
  assert.ok(
    Number(keep![1]!) >= 2,
    `KEEP=${keep![1]} 은 세대 보관이 아니다 — 어제 사본이 남지 않는다`,
  );
});

/**
 * ⚠**순서가 안전핀이다.** 크기 확인(「올린 것이 온전한가」)보다 **먼저** 지우면
 * **믿을 수 있는 사본이 없는 순간**이 생긴다.
 */
test("⚠지우는 것은 올린 것을 확인한 뒤다", () => {
  const verify = code.indexOf("보관소 확인: $name");
  const deleteAbsorbed = code.indexOf("흡수된 덧붙임 삭제");
  const prune = code.indexOf("옛 세대 삭제");
  assert.ok(verify > 0 && deleteAbsorbed > 0 && prune > 0, "세 자리를 다 못 찾았다 — 이 시험이 공회전한다");
  assert.ok(verify < deleteAbsorbed, "확인보다 먼저 흡수분을 지운다 — 믿을 사본이 없는 순간이 생긴다");
  assert.ok(verify < prune, "확인보다 먼저 세대를 지운다 — 믿을 사본이 없는 순간이 생긴다");
});

/**
 * ⚠**이번 실행에서 실제로 편 것만 지운다.** 도중에 누가 새 백필을 올렸는데 그것까지 지우면
 * **소급 불가 자산을 잃는다.** 그래서 전개 시점에 이름을 적어 둔다.
 */
test("⚠흡수분 삭제는 「이번에 편 것」 목록만 본다", () => {
  assert.match(code, /absorbed\.txt/, "전개한 덧붙임을 적어 두는 곳이 없다");
  const del = code.indexOf("흡수된 덧붙임 삭제");
  const window = code.slice(del - 400, del + 400);
  assert.match(window, /absorbed\.txt/, "삭제가 「이번에 편 것」 목록을 안 본다 — 새 백필까지 지울 수 있다");
});
