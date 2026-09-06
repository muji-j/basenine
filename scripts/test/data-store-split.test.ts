/**
 * **원시 아카이브는 코드 저장소에 없다** — 그 경계가 워크플로에서 유지되는가.
 *
 * ⚠**왜 갈랐나**(2026-09-06 · `docs/decisions/2026-09-06-repo-public-and-data-store.md`):
 * 비공개 저장소는 Actions 무료분이 월 2,000분이고 **8/31 에 실제로 소진돼 배포가 죽었다.**
 * 공개로 돌리면 그 한도가 사라지는데, **릴리스 자산 1.34 GiB 가 npb.jp 원본 그대로**라
 * 공개하는 순간 **누구나 받아 간다**(§2-5 2층 편집물 · 3층 데드카피 · L6).
 * → **코드는 공개, 데이터는 비공개 저장소.**
 *
 * ## 조용히 틀리는 방식
 *
 * ⚠**`gh release` 에서 `--repo` 하나가 빠지면 그 명령은 실패하지 않는다** —
 * **코드 저장소를 보고** 거기엔 자산이 없으므로 「보관소 릴리스가 없다 = 첫 실행」으로 읽는다.
 * 복원 쪽이면 **빈 DB 로 전부 다시 만들고**, 업로드 쪽이면 **공개될 저장소에 원본을 올린다.**
 * 둘 다 에러가 아니다. **그래서 시험으로 잡는다.**
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const YML = join(dirname(fileURLToPath(import.meta.url)), "..", "..", ".github", "workflows", "daily.yml");
const yml = readFileSync(YML, "utf8");

/** 주석을 뺀 실행 줄만. ⚠주석에도 `gh release` 가 나오므로 그것까지 세면 분모가 부푼다 */
function commandLines(): string[] {
  return yml
    .split(/\r?\n/u)
    .filter((l) => !/^\s*#/u.test(l))
    .filter((l) => l.includes("gh release"));
}

test("데이터 저장소가 env 에 한 곳으로 있다 — 여기저기 박으면 한쪽만 바뀐다(M1)", () => {
  assert.match(yml, /^ {2}DATA_REPO: \S+$/mu, "`DATA_REPO` 가 워크플로 env 에 없다");
});

test("⚠모든 `gh release` 가 데이터 저장소를 가리킨다 — 빠지면 조용히 코드 저장소를 본다", () => {
  const lines = commandLines();
  assert.ok(lines.length >= 8, `\`gh release\` 실행 줄을 ${lines.length}개 찾았다 — 이 시험이 공회전한다`);

  const offenders = lines.filter(
    (l) => !l.includes('--repo "$DATA_REPO"') && !l.includes('--repo "$GITHUB_REPOSITORY"'),
  );
  assert.deepEqual(
    offenders,
    [],
    "`--repo` 없는 `gh release` 가 있다. 그 명령은 **실패하지 않고** 코드 저장소를 보므로 " +
      "「첫 실행」으로 오인하거나 공개될 저장소에 원본을 올린다:\n  " +
      offenders.map((l) => l.trim()).join("\n  "),
  );
});

test("⚠릴리스를 만지는 스텝은 데이터 저장소 토큰을 쓴다 — 기본 토큰은 남의 저장소를 못 본다", () => {
  const steps = [...yml.matchAll(/^ {6}- name: (.+)$/gmu)];
  assert.ok(steps.length > 0, "스텝을 못 잘랐다 — 이 시험이 공회전한다");

  let checked = 0;
  for (const [i, m] of steps.entries()) {
    const body = yml.slice(m.index! + m[0]!.length, steps[i + 1]?.index ?? yml.length);
    if (!commandLinesIn(body).some((l) => l.includes('--repo "$DATA_REPO"'))) continue;
    checked += 1;
    assert.match(
      body,
      /GH_TOKEN: \$\{\{ secrets\.BB_DATA_TOKEN \}\}/u,
      `「${m[1]!.trim()}」가 데이터 저장소를 만지는데 기본 토큰을 쓴다 — ` +
        "`github.token` 은 이 저장소만 볼 수 있어 비공개 데이터 저장소에서 404 가 난다",
    );
  }
  assert.ok(checked >= 3, `데이터 저장소를 만지는 스텝을 ${checked}개 찾았다 — 3개 이상이어야 한다`);
});

function commandLinesIn(body: string): string[] {
  return body
    .split(/\r?\n/u)
    .filter((l) => !/^\s*#/u.test(l))
    .filter((l) => l.includes("gh release"));
}

test("⚠L6 게이트가 **두 가지**를 묻는다 — 데이터가 비공개인가, 코드 쪽에 옛 자산이 안 남았는가", () => {
  const m = /^ {6}- name: L6 확인[^\n]*\n([\s\S]*?)(?=^ {6}- name: )/mu.exec(yml);
  assert.notEqual(m, null, "L6 스텝을 못 찾았다 — 이 시험이 공회전한다");
  const body = m![1]!;

  assert.match(
    body,
    /repos\/\$DATA_REPO/u,
    "L6 가 데이터 저장소의 공개 범위를 안 본다 — 원본이 실제로 있는 곳이 거기다",
  );
  assert.match(
    body,
    /--repo "\$GITHUB_REPOSITORY"/u,
    "L6 가 코드 저장소에 남은 옛 자산을 안 센다. 이전이 끝났는지를 **매일 다시** 물어야 한다 — " +
      "사람이 손으로 다시 올릴 수 있다",
  );
  assert.doesNotMatch(
    body,
    /L6 위반 — 이 리포가 공개다/u,
    "옛 판정(「이 저장소가 공개면 멈춘다」)이 남아 있다. 코드 저장소는 이제 공개해도 된다 — " +
      "그 문장을 남겨 두면 공개 전환 자체가 막힌다",
  );
});

test("⚠「모른다」를 「안전하다」로 읽지 않는다 — 조회에 실패하면 멈춘다", () => {
  const m = /^ {6}- name: L6 확인[^\n]*\n([\s\S]*?)(?=^ {6}- name: )/mu.exec(yml);
  assert.notEqual(m, null, "L6 스텝을 못 찾았다");
  const body = m![1]!;
  const guards = body.match(/if \[ -z "\$\w+" \]; then/gu) ?? [];
  assert.ok(
    guards.length >= 2,
    `조회 실패를 막는 빈 값 가드가 ${guards.length}개다 — 두 질문 각각에 하나씩 있어야 한다. ` +
      "없으면 API 가 흔들린 날 게이트가 조용히 통과한다",
  );
});
