/**
 * **실패한 실행이 사이트 자체를 아티팩트로 올리지 않는가.**
 *
 * ⚠**공개 저장소에서 아티팩트는 누구나 받는다.** 그런데 예전에는 실패한 실행이
 * `dist` 를 통째로 올렸다 — **Cloudflare Access 담장 뒤에 있어야 할 사이트 전체**다.
 *
 * 실측(2026-09-06 공개 감사):
 *
 * | | |
 * |---|---|
 * | `dist` | **1.5 GB · 9,536파일** |
 * | 과거 만들어진 아티팩트 | **28건** · 최대 **187,448,953 B**(zip) |
 * | 최근 100실행의 실패 | **22건** — 「가끔」이 아니라 **5회 중 1회** |
 *
 * §2-5 **S1** 이 「재배포 형태를 취하지 않는다」인데, 그 상태로 공개하면 **담장이 뚫린다.**
 *
 * ⚠**목적은 없애지 않았다.** 원래 의도는 「무엇이 만들어졌는데 안 올라갔는가」이고
 * 그건 **경로와 크기**로 답할 수 있다 — 내용은 애초에 필요 없었다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const YML = join(dirname(fileURLToPath(import.meta.url)), "..", "..", ".github", "workflows", "daily.yml");
const yml = readFileSync(YML, "utf8");

/** 주석이 아닌 실행 줄만 — ⚠주석에도 `path: dist` 를 적을 수 있고 그건 결함이 아니다 */
function liveLines(): string[] {
  return yml.split(/\r?\n/u).filter((l) => !/^\s*#/u.test(l));
}

test("⚠업로드하는 경로가 `dist` 가 아니다 — 사이트 전체를 아티팩트로 내보내지 않는다", () => {
  const bad = liveLines().filter((l) => /^\s*path:\s*dist\s*$/u.test(l));
  assert.deepEqual(
    bad,
    [],
    "아티팩트가 `dist` 를 통째로 올린다. 공개 저장소에서는 누구나 받으므로 " +
      "Access 담장 뒤의 사이트가 그대로 나간다(§2-5 S1)",
  );
});

test("⚠그래도 실패한 날에 무엇이 만들어졌는지는 남는다 — 목적을 없애지 않았다", () => {
  const live = liveLines().join("\n");
  assert.match(
    live,
    /upload-artifact/u,
    "아티팩트 스텝이 통째로 사라졌다. 실패한 날 「무엇이 만들어졌는가」를 볼 방법이 없어진다",
  );
  assert.match(
    live,
    /dist-manifest/u,
    "목록 아티팩트가 없다 — 사이트를 안 올리기로 했으면 대신 경로·크기라도 남겨야 한다",
  );
});

test("⚠성공한 날에는 안 올린다 — 그때는 Pages 에 같은 것이 있고 아무도 안 본다", () => {
  const steps = [...yml.matchAll(/^ {6}- name: (.+)$/gmu)];
  const idx = steps.findIndex((m) => m[1]!.includes("산출물 목록 보관"));
  assert.notEqual(idx, -1, "「산출물 목록 보관」 스텝을 못 찾았다 — 이 시험이 공회전한다");
  const body = yml.slice(
    steps[idx]!.index! + steps[idx]![0]!.length,
    steps[idx + 1]?.index ?? yml.length,
  );
  assert.match(
    body,
    /if:\s*\$\{\{\s*failure\(\)\s*\|\|\s*cancelled\(\)\s*\}\}/u,
    "실패·취소일 때만 올리는 조건이 없다. 매일 올리면 그만큼을 태우고, 성공한 날의 그것은 아무도 안 본다",
  );
});
