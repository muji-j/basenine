/**
 * **구단 색 칩 — 몇 벌이고, 홀로 서는 자리가 있는가.**
 *
 * ⚠**「모든 표가 같은 한 벌을 쓴다(M1의 정신)」가 거짓이었다**(2026-08-25 · 감사 P3 #33).
 * 실측: 스와치 규칙 **9벌** · 크기 **5종**(8·9·10·11·12px) · **링 4 · 없음 5**.
 * (3px 막대 `.gstars li i` 와 4px 띠 둘은 스와치가 아니라 이 셈에서 뺐다.
 *  ⚠**나는 처음에 그것들을 섞어 「10벌 · 링 5」라고 적었다** — 아래 시험이 세어 주지 않았으면
 *  거짓 수가 그대로 주석에 남았을 것이다. **세는 규칙을 시험에 두는 이유가 이것이다.**)
 * 그 문장 **바로 다음 줄**이 「네 화면이 이 한 벌을 쓴다」라고 좁은 뜻을 적고 있었는데,
 * 첫 줄만 전칭으로 부풀어 있었다 — **이 저장소가 반복해 데인 모양**이다.
 *
 * ## ⚠그래도 링을 전부에 붙이지 않는다
 *
 * 링(`box-shadow:inset 0 0 0 1px var(--tx-2)`)은 대비 보증이다. 필요한 것은
 * **칩이 그 구단의 유일한 표시일 때**뿐이고, 실측으로 그런 자리가 **0건**이다:
 * dist **9,081장** · 칩 자리 **49,067개** · 뒤에 아무것도 없는 것 **0**.
 * 전부 바로 뒤에 구단 이름 글자가 온다 — 칩은 **정보를 나르지 않는 장식**이다.
 *
 * ⚠**예외가 하나 있었고 이미 고쳐져 있다**: `.gstars li i` 는 막대가 유일한 구단 표시였고
 * (2026-08-21 감사 P1) 그래서 링과 낭독용 이름을 함께 갖는다. **링은 「홀로 설 때」 붙는다.**
 *
 * ⚠**감사가 든 「보증 없는 8,955장(58.4%)」은 심각도를 부풀린다** — 보증이 필요한 자리가 0이면
 * 그 비율은 결함률이 아니라 **미관 불일치율**이다. 통일은 값이 아니라 손질이다.
 *
 * ⚠**측정이 세 번 만에 맞았다.** 처음엔 `<i></i>` 전부를 셌는데 정렬 표시(`.sortable i`)가
 * 같은 모양이라 61,900건이 섞였다 — **지표가 질문에 답하는지 먼저 보라**는 그 자리다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CSS } from "../src/assets.ts";

const css = CSS.replace(/\/\*[\s\S]*?\*\//g, "");

interface Chip { sel: string; size: string; ring: boolean }

/** 구단 색 스와치 규칙(크기가 있는 것만 — 4px 띠는 스와치가 아니다) */
function chipRules(): Chip[] {
  const out: Chip[] = [];
  for (const m of css.matchAll(/([^{}\n][^{}]*)\{([^{}]*)\}/g)) {
    const body = m[2]!;
    if (!body.includes("background:var(--chip")) continue;
    const w = /width:\s*(\d+)px/.exec(body);
    const h = /height:\s*(\d+)px/.exec(body);
    if (w === null || h === null) continue; // 세로가 없는 것은 띠다
    out.push({
      sel: m[1]!.trim().replace(/\s+/g, " "),
      size: `${w[1]!}x${h[1]!}`,
      ring: body.includes("box-shadow"),
    });
  }
  return out;
}

/**
 * ⚠**목록이지 「안전하다」가 아니다.** 새 칩을 만들면 여기서 먼저 운다 —
 * 그때 **「이 자리에서 칩이 홀로 서는가」를 재고** 서면 링을 붙여라.
 */
const KNOWN: readonly { sel: string; ring: boolean }[] = [
  { sel: ".tm i", ring: true },
  { sel: ".sname i", ring: false },
  { sel: ".picktm i", ring: false },
  { sel: ".hteam i", ring: true },
  { sel: ".gbt i", ring: false },
  { sel: ".gside .gt i", ring: false },
  { sel: ".tcn a i", ring: true },
  { sel: ".pbt i", ring: false },
  { sel: ".teamgroup h2 i", ring: true },
];

test("⚠칩 규칙을 뽑는 방식이 헛돌지 않는다", () => {
  const chips = chipRules();
  assert.ok(chips.length >= 8, `칩 규칙을 ${chips.length}개밖에 못 찾았다 — 정규식이 헛돈다`);
  const sizes = [...new Set(chips.map((c) => c.size))].sort();
  console.log(`  · 칩 규칙 ${chips.length}벌 · 크기 ${sizes.length}종 [${sizes.join(" ")}] · 링 ${chips.filter((c) => c.ring).length}`);
});

/** ⚠**전칭으로 부풀리지 않는다** — 몇 벌인지 세어서 적는다 */
test("⚠구단 색 칩은 한 벌이 아니다 — 목록에 없는 새 칩이 생기면 운다", () => {
  const chips = chipRules().filter((c) => c.sel.endsWith(" i"));
  const known = new Set(KNOWN.map((k) => k.sel));
  const unknown = chips.filter((c) => !known.has(c.sel)).map((c) => `${c.sel}(${c.size})`);
  assert.deepEqual(
    unknown,
    [],
    "새 구단 색 칩이 생겼다.\n" +
      "⚠**그 자리에서 칩이 홀로 서는지 먼저 재라**(아래 시험의 방법). 홀로 서면 링을 붙이고,\n" +
      "  아니면 KNOWN 에 더해라. ⚠「한 벌로 통일했다」고 적지 마라 — 세어 보고 적어라.",
  );
  const gone = KNOWN.filter((k) => !chips.some((c) => c.sel === k.sel)).map((k) => k.sel);
  assert.deepEqual(gone, [], "목록에 적힌 칩이 CSS 에 없다 — 통일했다면 목록에서 빼라");
});

const DIST = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "dist");
if (process.env["BB_REQUIRE_DIST"] === "1" && !existsSync(DIST)) {
  throw new Error(`BB_REQUIRE_DIST=1 인데 ${DIST} 가 없다 — 빌드 뒤에 돌려라`);
}

/** 칩을 쓰는 클래스들. ⚠`.gstars li` 는 낭독용 이름을 안에 담으므로 이 검사의 대상이 아니다 */
const CHIP_CLASS = "(?:tm|hteam|sname|picktm|gbt|gt|pbt|tcn)";
const CHIP_ALONE = new RegExp(`class="[^"]*\\b${CHIP_CLASS}\\b[^"]*"[^>]*>\\s*<i></i>\\s*</`, "g");
const CHIP_SITE = new RegExp(`class="[^"]*\\b${CHIP_CLASS}\\b[^"]*"[^>]*>\\s*<i></i>`, "g");

/**
 * ⚠**이것이 링을 전부에 안 붙이는 근거다.** 근거가 무너지면 여기서 먼저 운다.
 * ⚠표본은 배포물에서 고르게 뽑는다 — 전장(15,000+)을 여는 대신 시즌마다 몇 장씩 본다.
 */
test("⚠구단 색 칩이 홀로 서는 자리가 없다 — 전부 뒤에 구단 이름 글자가 온다", () => {
  if (!existsSync(DIST)) {
    console.log("  · dist 없음 — 건너뜀(BB_REQUIRE_DIST=1 이면 실패한다)");
    return;
  }
  const files: string[] = [];
  for (const name of ["index.html", "today.html", "teams.html", "postseason.html"]) {
    if (existsSync(join(DIST, name))) files.push(join(DIST, name));
  }
  for (const d of readdirSync(DIST, { withFileTypes: true })) {
    if (!d.isDirectory() || !/^\d{4}$/.test(d.name)) continue;
    for (const name of ["index.html", "today.html", "teams.html", "postseason.html", "matchup.html"]) {
      const f = join(DIST, d.name, name);
      if (existsSync(f)) files.push(f);
    }
    const games = join(DIST, d.name, "games");
    if (existsSync(games)) files.push(...readdirSync(games).slice(0, 2).map((g) => join(games, g)));
    const teams = join(DIST, d.name, "teams");
    if (existsSync(teams)) files.push(...readdirSync(teams).slice(0, 2).map((g) => join(teams, g)));
  }

  let sites = 0;
  const alone: string[] = [];
  for (const f of files) {
    const html = readFileSync(f, "utf8");
    sites += (html.match(CHIP_SITE) ?? []).length;
    if (CHIP_ALONE.test(html)) alone.push(f);
    CHIP_ALONE.lastIndex = 0;
  }
  assert.ok(sites > 100, `칩 자리를 ${sites}개밖에 못 찾았다 — 이 시험이 공회전한다`);
  assert.deepEqual(
    alone,
    [],
    "구단 색 칩이 글자 없이 홀로 선 자리가 생겼다.\n" +
      "⚠**그 자리에서는 칩이 유일한 구단 표시다** — 링(box-shadow)과 낭독용 이름을 붙여라\n" +
      "  (.gstars li i 가 그 선례다).",
  );
  console.log(`  · 표본 ${files.length}장 · 칩 자리 ${sites}개 · 홀로 선 것 ${alone.length}개`);
});
