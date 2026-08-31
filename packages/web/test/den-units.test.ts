/**
 * **비율 옆의 분모가 그 지표의 정의 분모인가** — 배포물을 직접 읽어서 확인한다.
 *
 * ⚠**「분모가 없다」보다 「틀린 분모가 인접해 있다」가 나쁘다.**
 * 2026-08-19 감사가 `dist/starters.html` 에서 잡은 것이 그것이다:
 * 열이 `…の打者 | 打席 | 安打 | 本塁打 | 三振 | 打率` 인데 `打率` 에 분모가 없어서,
 * 옆의 두 수로 검산하면 값이 안 맞았다 — `万波 9打席 2安打 .250`(= 2/8) ·
 * `郡司 8打席 3安打 .429`(= 3/7). 그 화면 전체에서 「打数」가 **0회**였다.
 * 나머지 화면(順位表 · 구단 · 선수)은 전부 맞았으므로, **한 화면만 규칙 밖에 있는 상태**를
 * 다음에도 잡으려면 화면 하나가 아니라 **전 화면을 같은 표로 재야 한다.**
 *
 * ⚠**단위 검사만으로는 모자란다.** `出塁率` 의 분모는 `打数+四球+死球+犠飛` 라
 * **옆의 `打席` 열과 다르다**(실측 2026-08-19 `dist/teams/b.html` 西川: 打席 열 465 · 出塁率 분모 464).
 * 그래서 「인접 열이 분모를 말한다」를 인정하는 지표와 인정하지 않는 지표를 아래 표가 나눈다.
 *
 * ⚠**타입도 린트도 이걸 못 잡는다** — 숫자는 전부 정상적으로 나오기 때문이다.
 * `tag-integrity.test.ts` 와 같은 이유로 **산출물을 직접 보는 수밖에 없다.**
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { GLOSSARY } from "../src/glossary.ts";

const DIST = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "dist");

const REQUIRE_DIST = process.env["BB_REQUIRE_DIST"] === "1";
if (REQUIRE_DIST && !existsSync(DIST)) {
  throw new Error(`BB_REQUIRE_DIST=1 인데 ${DIST} 가 없다 — 빌드 뒤에 돌려라`);
}

/** 표본 수만 말하는 일반 열. 머리에 지표 이름이 없으므로 **칸의 단위까지** 봐야 한다 */
const SAMPLE_COLUMN = "母数";

interface RateSpec {
  /** 값에 붙는 분모의 꼬리(`format.ts` 의 `denominator()` 가 내는 단위) */
  unit: string;
  /**
   * 같은 행에서 분모를 **대신 말할 수 있는** 열 머리.
   * ⚠**「비슷한 수가 있는 열」이 아니다.** 그 열의 값이 곧 정의 분모여야 한다.
   */
  neighbors: readonly string[];
  /** 정의(docs/metrics) — 왜 그것이 분모인가 */
  why: string;
}

/**
 * ⚠**이 표가 정본이다.** 화면이 늘어도 여기 없는 비율은 아래 검사가 거부한다 —
 * 「새 지표를 넣었는데 분모를 안 정했다」가 조용히 지나가지 않게 하기 위해서다.
 */
const RATES: Readonly<Record<string, RateSpec>> = {
  打率: { unit: "打数", neighbors: ["打数"], why: "安打 ÷ 打数" },
  /**
   * 투수 화면의 같은 계산. ⚠**`打率` 와 같은 키로 묶지 않는다** — 뜻이 반대라
   * 용어집도 `avg`/`allowedAvg` 로 나눠 두고 있다(그쪽 시험이 그 사실을 고정한다).
   * カウント別 블록(2026-08-20)이 이 이름을 표 머리로 처음 쓴다.
   */
  被打率: { unit: "打数", neighbors: ["打数"], why: "被安打 ÷ 打数（打者の打率と同じ計算で立場が逆）" },
  長打率: { unit: "打数", neighbors: ["打数"], why: "塁打 ÷ 打数" },
  /**
   * 투수 화면의 같은 계산 둘. ⚠**타자 쪽과 같은 키로 묶지 않는다** — 뜻이 반대다
   * (`被打率` 를 따로 둔 것과 같은 이유). 스플릿 표(2026-08-28)가 이 이름을 처음 쓴다.
   * ⚠**분모는 타자 쪽과 같다** — 계산이 같고 **입장만 반대**이기 때문이다.
   */
  被出塁率: {
    unit: "出塁機会",
    neighbors: [],
    why: "(被安打+与四球+与死球) ÷ (打数+与四球+与死球+犠飛) — 打者の出塁率と同じ計算で立場が逆",
  },
  被長打率: { unit: "打数", neighbors: ["打数"], why: "許した塁打 ÷ 打数 — 打者の長打率と同じ計算で立場が逆" },
  /**
   * ⚠**打席 열을 분모로 인정하지 않는다** — 犠打만큼 어긋난다(실측 465 vs 464).
   * ⚠**2026-08-20 에 단위 자체를 고쳤다.** 예전에는 `打席` 라고 **불렀는데** 그 수가 打席이 아니라,
   * 같은 화면에 뜻이 다른 「打席」이 두 개 있었다(中野拓夢: 打席 열 434 · 出塁率 분모 414).
   */
  出塁率: { unit: "出塁機会", neighbors: [], why: "(安打+四球+死球) ÷ (打数+四球+死球+犠飛) = 打席 − 犠打" },
  // ⚠**OPS 는 정말 打席이다** — `ops()` 가 `denominator: line.pa` 를 낸다(metrics/batting.ts).
  //   出塁率 쪽 분모가 아니다. 그래서 같은 행에서 出塁率과 다른 수가 나오는 것이 정상이다
  OPS: { unit: "打席", neighbors: [], why: "出塁率 + 長打率 — 표본은 打席으로 말한다(metrics/batting.ts)" },
  // ⚠아래 셋은 `率` 로 끝나지 않아 `looksLikeRate` 의 어미 규칙에 안 걸린다. **표에 있으면 걸린다**
  wOBA: { unit: "wOBA機会", neighbors: [], why: "가중 출루 ÷ (打数+四球−敬遠+死球+犠飛) = 出塁機会 − 敬遠" },
  BABIP: { unit: "インプレー打球", neighbors: [], why: "(安打−本塁打) ÷ (打数−三振−本塁打+犠飛)" },
  SRP: { unit: "対戦打者", neighbors: [], why: "打席마다 재는 값이라 분모는 아웃이 아니라 상대 타자 수다" },
  // ⚠**投球回 열은 분모를 「回」 없이 숫자로만 낸다.** 값에 붙이거나 母数 열이 말해야 한다
  防御率: { unit: "回", neighbors: [], why: "自責点 × 9 ÷ 投球回" },
  WHIP: { unit: "回", neighbors: [], why: "(被安打 + 与四球) ÷ 投球回" },
  /**
   * 勝敗分 칸이 `67勝39敗1分` 이라 분모(勝 + 敗)가 그 칸에서 그대로 읽힌다.
   *
   * ⚠**단위를 `試合` 에서 `決着` 로 고쳤다**(2026-08-20 · 배포물 실측). 값에 분모를 붙이는
   * 화면(구단 카드·구단 페이지)이 `.562` 옆에 **`105試合`** 이라고 썼는데, 阪神이 그 시점에
   * 치른 경기는 **106**(59-46-1)이다 — 105는 무승부를 뺀 수이므로 **「試合」이 사실이 아니었다.**
   * 2026 정규시즌 12구단 중 **11구단**이 이 상태였고 무승부 0인 구단만 우연히 맞았다.
   * ⚠**구단과 투수 개인이 같은 단위를 쓴다** — 산식이 같기 때문이다(`勝 ÷ (勝 + 敗)`).
   * 여기서 갈라 두면 같은 이름의 열이 화면마다 다른 것을 가리키게 된다(直前 라운드의 BABIP·SRP).
   */
  勝率: { unit: "決着", neighbors: ["勝敗分"], why: "勝 ÷ (勝 + 敗) — 引き分けもノーデシジョンも分母に入らない" },
  /**
   * 선수 페이지의 **루별 도루**. 분모는 그 루의 企図(성공 + 盗塁刺)다.
   * ⚠**牽制死는 들어가지 않는다** — NPB 기록에서 盗塁刺 와 별개다(§2-2 · 용어집이 이미 그렇게 정의).
   *
   * ⚠**`neighbors` 를 비워 둔다 — 「企図」 열이 옆에 있는데도.**
   * 그 열은 정말 분모가 맞지만, 인정해 버리면 **단위 문자열이 무엇이든 통과한다**
   * (아래 검사는 `attached` 가 실패해도 `neighbor` 가 참이면 넘어간다).
   * 실제로 처음엔 `neighbors: ["企図"]` 로 써서, 단위를 `打数` 로 바꾸는 뮤테이션이
   * **그대로 통과했다**(2026-08-20 · 이 시험이 그 지표를 안 재고 있었다).
   * 이 화면은 값에 분모를 **항상 붙이므로**, 붙은 쪽만 인정하는 것이 더 좁고 정확하다.
   */
  盗塁成功率: { unit: "企図", neighbors: [], why: "その塁の 盗塁 ÷ (盗塁 + 盗塁刺) — 牽制死は分母外" },
  /**
   * カウント別 블록(투수)의 OPS. ⚠**`OPS` 와 같은 키로 묶지 않는다** — 뜻이 반대다.
   */
  被OPS: { unit: "打席", neighbors: [], why: "被出塁率 + 被長打率 — 표본은 打席으로 말한다" },
  /**
   * 引き分けの解剖(2026-08-20). ⚠**`neighbors` 를 비워 둔다** — `試合` 열이 옆에 있지만
   * 인정하면 단위 문자열이 무엇이든 통과한다(`盗塁成功率` 이 먼저 밟은 함정).
   */
  引分率: { unit: "試合", neighbors: [], why: "引き分け ÷ 成立した試合" },
  /** ⚠**분모가 「試合」이 아니라 「延長試合」이다** — 옆의 `試合` 열을 분모로 읽으면 틀린다 */
  延長決着率: { unit: "延長試合", neighbors: [], why: "(延長試合 − 延長引き分け) ÷ 延長試合" },
  /**
   * 남은 경기를 전부 이겼을 때와 전부 졌을 때의 **가정 승률**.
   * 분모는 `勝 + 敗 + 残り` 이고, `勝敗分` 과 `残り` 두 열이 같은 행에 있다.
   */
  "全勝〜全敗の勝率": { unit: "試合", neighbors: ["勝敗分", "残り"], why: "(勝 + 残り) ÷ (勝 + 敗 + 残り) 〜 勝 ÷ (勝 + 敗 + 残り)" },
};

/**
 * 머리가 비율처럼 보이는데 위 표에 없으면 거부한다.
 * ⚠**표에 있는 이름도 전부 본다** — `wOBA`·`BABIP`·`SRP` 는 어미가 `率` 가 아니라
 * 어미 규칙만으로는 영영 안 걸렸다. 표에 넣는 것이 곧 검사 대상에 넣는 것이다.
 */
function looksLikeRate(head: string): boolean {
  return head.endsWith("率") || head === "OPS" || head === "WHIP" || head in RATES;
}

function textOf(fragment: string): string {
  return fragment.replace(/<[^>]*>/g, "").trim();
}

/**
 * 화면 표본. ⚠**렌더러는 한 벌이므로 화면 종류를 덮으면 된다**(M1) —
 * 같은 표가 9시즌 × 수천 장으로 복제될 뿐이다. 대신 **종류를 빠뜨리면 못 본다**:
 * `tag-integrity.test.ts` 가 최상위 화면만 골랐다가 선수 페이지의 결함을 놓친 전례가 있다.
 */
function samplePages(): string[] {
  if (!existsSync(DIST)) return [];
  const top = [
    "index.html", "ranking.html", "teams.html", "starters.html", "postseason.html",
    "today.html", "compare.html", "matchup.html", "log.html", "days.html",
  ];
  const dirs: [string, number][] = [
    ["players", 5], ["teams", 5], ["games", 3], ["days", 2], ["starters", 2],
  ];
  const nested: string[] = [];
  for (const [d, n] of dirs) {
    const p = join(DIST, d);
    if (!existsSync(p)) continue;
    for (const f of readdirSync(p).filter((x) => x.endsWith(".html")).slice(0, n)) nested.push(join(d, f));
  }
  return [...top, ...nested, ...rareBlockPages()].filter((f) => existsSync(join(DIST, f)));
}

/**
 * ⚠**앞에서 N장씩 자르는 표본은 「드문 블록」을 못 본다.**
 *
 * 走塁 표(`盗塁成功率`)가 있는 선수 페이지는 **172/698 = 25%** 다(2026-08-20 실측).
 * 앞 5장만 보면 **약 3분의 1의 확률로 그 지표를 통째로 안 재게 된다** — 거짓 통과는 아니지만
 * 「검사했다」가 「검사할 것이 없었다」와 구별되지 않는 상태이고, 그건 이 파일의 머리말이
 * 경계하는 바로 그 상태다(작업규칙 8).
 * → **그 블록을 실제로 가진 페이지를 내용으로 골라** 표본에 더한다. 파일명을 박아 두면
 *   데이터가 바뀌는 날 조용히 사라지므로 **찾아서** 넣는다.
 */
function rareBlockPages(): string[] {
  const dir = join(DIST, "players");
  if (!existsSync(dir)) return [];
  const marker = '<th class="l">狙った塁</th>';
  const out: string[] = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".html"))) {
    if (!readFileSync(join(dir, f), "utf8").includes(marker)) continue;
    out.push(join("players", f));
    if (out.length >= 2) break;
  }
  return out;
}

interface Table {
  page: string;
  heads: string[];
  /** 행마다 칸의 **원문 HTML**. `.den` 을 봐야 하므로 태그를 지우지 않는다 */
  rows: string[][];
}

/**
 * ⚠**버려진 행이 여기 쌓인다.** 비어 있지 않으면 이 시험은 **자기가 못 본 표가 있다**는 뜻이다 —
 * 「통과했다」가 「검사했다」가 아니게 되는 자리이므로 **경고가 아니라 실패**로 만든다.
 */
const misaligned: string[] = [];

function tablesOf(page: string, html: string): Table[] {
  const out: Table[] = [];
  for (const t of html.match(/<table\b[^>]*>[\s\S]*?<\/table>/g) ?? []) {
    const head = /<thead\b[^>]*>([\s\S]*?)<\/thead>/.exec(t);
    if (head === null) continue;
    const headRows = head[1]?.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/g) ?? [];
    const last = headRows.at(-1);
    if (last === undefined) continue;
    const heads = (last.match(/<th\b[^>]*>[\s\S]*?<\/th>/g) ?? []).map(textOf);
    if (heads.length === 0) continue;
    const body = /<tbody\b[^>]*>([\s\S]*?)<\/tbody>/.exec(t);
    const rows: string[][] = [];
    for (const r of body?.[1]?.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/g) ?? []) {
      const cells = r.match(/<t[dh]\b[^>]*>[\s\S]*?<\/t[dh]>/g) ?? [];
      // 칸 수가 안 맞는 행(colspan · 소계)은 열을 짚을 수 없으므로 세지 않는다
      if (cells.length === heads.length) {
        rows.push(cells);
        continue;
      }
      if (cells.length === 0) continue;
      /**
       * ⚠**이 버리기가 조용해서 M2 가드가 눈을 감았다**(2026-08-31).
       * スプリット 표의 머리에 `打数` 를 더하고 본문 칸을 안 더하자 **모든 행**이 안 맞게 되어
       * **표 전체가 통째로 건너뛰어졌고**, 그 표의 비율 4종은 분모 없이 배포됐다.
       * 총량 문턱(`checked >= 40`)은 **표 하나가 사라지는 것**을 잡지 못한다.
       * ⚠**`colspan` 을 더해서 다시 센다** — 소계 행처럼 **제대로 걸친** 행은 정당하므로 버리고,
       * **걸치지도 못한 행**만 결함으로 올린다. 실측(2026-08-31 · dist 표 377개):
       * 정당한 colspan 행 **0** · 어긋난 행 **0**.
       * ⚠**이 부류의 정본 검사는 `table-columns.test.ts` 다** — 여기서는 「이 시험이 눈을 감았다」만 막는다.
       */
      const span = cells.reduce(
        (n, c) => n + Number(/\bcolspan\s*=\s*"?(\d+)"?/i.exec(c)?.[1] ?? 1),
        0,
      );
      if (span !== heads.length) misaligned.push(`${page}: 머리 ${heads.length}칸 / 행 ${span}칸`);
    }
    out.push({ page, heads, rows });
  }
  return out;
}

const PAGES = samplePages();

test("⚠비율 옆의 분모가 그 지표의 정의 분모다 — 화면마다 다르면 어느 쪽이 거짓말인지 알 수 없다", {
  skip: PAGES.length === 0 ? "dist 없음" : false,
}, () => {
  assert.ok(PAGES.includes("starters.html"), "予告先発 화면이 표본에 없다 — 이 시험이 원래 잡은 결함을 못 본다");

  const problems: string[] = [];
  let checked = 0;
  let byValue = 0;
  let byNeighbor = 0;
  const seen = new Map<string, number>();

  for (const page of PAGES) {
    for (const t of tablesOf(page, readFileSync(join(DIST, page), "utf8"))) {
      for (const [i, head] of t.heads.entries()) {
        if (!looksLikeRate(head)) continue;
        const spec = RATES[head];
        if (spec === undefined) {
          problems.push(`${page}: 「${head}」의 분모 정의가 이 시험의 표에 없다 — 새 비율 지표를 넣었으면 표에 추가해라`);
          continue;
        }
        // 데이터가 한 행도 없는 표는 아무것도 증명하지 못한다 — 세지 않는다
        if (t.rows.length === 0) continue;
        checked += 1;
        seen.set(head, (seen.get(head) ?? 0) + 1);

        const den = new RegExp(`<span class="den">[^<]*${spec.unit}</span>`);
        const attached = t.rows.every((cells) => den.test(cells[i] ?? ""));
        const neighbor = t.heads.some((h, j) => j !== i && spec.neighbors.includes(h));
        const sampleAt = t.heads.indexOf(SAMPLE_COLUMN);
        const sample = sampleAt >= 0 && sampleAt !== i
          && t.rows.every((cells) => textOf(cells[sampleAt] ?? "").endsWith(spec.unit));

        if (attached) byValue += 1;
        else if (neighbor || sample) byNeighbor += 1;
        else {
          problems.push(
            `${page}: 「${head}」(${spec.why})의 분모가 그 행에 없다 — ` +
              `값에 「${spec.unit}」를 붙이거나 ${[...spec.neighbors, SAMPLE_COLUMN].join("·")} 열을 둬라. ` +
              `열: ${t.heads.join(" | ")} / 첫 행: ${(t.rows[0] ?? []).map(textOf).join(" / ")}`,
          );
        }
      }
    }
  }

  /**
   * ⚠**공회전 방지.** 표본이 줄거나 마크업이 바뀌어 표를 하나도 못 읽으면
   * 이 시험은 「전부 통과」로 보이면서 아무것도 재지 않는다(작업규칙 8·9).
   * 기준선은 2026-08-19 실측이다 — 화면이 늘면 이 값도 올라간다.
   */
  assert.ok(checked >= 40, `비율 열을 ${checked}개밖에 못 읽었다 — 이 시험이 공회전한다`);
  assert.ok(byValue >= 20, `값에 분모가 붙은 열이 ${byValue}개뿐이다 — 「값에 붙인다」 쪽이 사라졌다`);
  assert.ok(byNeighbor >= 1, `인접 열이 분모인 경우를 ${byNeighbor}개 봤다 — 그 갈래가 사라졌다`);
  // 지표 종류가 줄면 표본이 한쪽으로 쏠린 것이다
  assert.ok(seen.size >= 5, `본 비율 지표가 ${seen.size}종뿐이다 — ${[...seen.keys()].join("·")}`);

  /**
   * ⚠**이 시험이 못 본 표가 있으면 먼저 그것부터 말한다.** 아래 `problems` 가 비어 있어도
   * 그건 「어긋난 것이 없다」가 아니라 **「본 것 중에 없다」**일 뿐이다.
   */
  assert.deepEqual(
    misaligned,
    [],
    `머리와 칸 수가 어긋난 행이 있어 그 표를 통째로 못 봤다 — 분모 검사가 눈을 감은 상태다\n` +
      `${misaligned.slice(0, 5).join("\n")}\n(정본 검사: packages/web/test/table-columns.test.ts)`,
  );

  assert.deepEqual(problems, [], `분모가 어긋난 비율 ${problems.length}건 / 검사한 비율 열 ${checked}개`);
});

// ── 같은 지표, 다른 화면 ────────────────────────────────────────────────────

/**
 * ⚠**같은 지표의 분모 단위가 화면마다 달랐다**(2026-08-20 감사 P2 · 배포물 실측).
 *
 * 위 시험은 「한 행 안에서 분모가 맞는가」를 본다. 그런데 **화면과 화면 사이**는 아무도 안 봤다:
 *
 * | 지표 | 선수 페이지 | `compare/*.json` | 어긋난 선수 |
 * |---|---|---|---|
 * | BABIP | `打球` | **`打数`** | 342명 |
 * | SRP | `対戦打者` | **`打者`** | 356명 |
 *
 * ⚠**BABIP 는 어긋난 정도가 아니라 거짓이었다** — 中野拓夢의 카드가 `317打数` 라고 썼는데
 * 그 사람의 打数는 **380** 이다(317 = `打数−三振−本塁打+犠飛`).
 * ⚠**값은 7,664건 전수 일치였다.** 틀린 것이 말뿐이라 **타입도 린트도 값 대조도 못 잡는다** —
 * 배포물의 **글자**를 직접 보는 수밖에 없다.
 *
 * ⚠**정본은 `glossary.ts` 의 `den` 이다**(M1). 그래서 이 시험은 두 화면이 서로 같은지와
 * **둘 다 정의서와 같은지**를 동시에 묻는다 — 앞의 것만 물으면 「둘 다 똑같이 틀린」 상태를 통과시킨다.
 */

/** `414出塁機会` → `出塁機会` · `138.1回` → `回`. **수를 떼고 단위만 남긴다** */
function unitOf(den: string): string {
  return den.replace(/^[\d.,]+/, "");
}

/** 용어집이 분모 단위를 선언한 지표만 본다. 나머지는 이 시험의 대상이 아니다 */
function declared(key: string): string | null {
  return GLOSSARY[key]?.den ?? null;
}

function addUnit(into: Map<string, Set<string>>, key: string, unit: string): void {
  let s = into.get(key);
  if (s === undefined) {
    s = new Set();
    into.set(key, s);
  }
  s.add(unit);
}

/**
 * 선수 페이지의 `<dt>지표</dt><dd>값<span class="den">분모</span></dd>`.
 *
 * ⚠**라벨이 아니라 `data-term`(용어집 키)으로 짚는다.** 라벨로 짚으면 `打率`/`被打率` 처럼
 * 뜻이 반대인 것이 섞이고, 라벨을 바꾼 날 이 시험이 조용히 0건이 된다.
 */
function playerPageUnits(): { units: Map<string, Set<string>>; pages: number } {
  const dir = join(DIST, "players");
  const units = new Map<string, Set<string>>();
  if (!existsSync(dir)) return { units, pages: 0 };
  const files = readdirSync(dir).filter((f) => f.endsWith(".html"));
  for (const f of files) {
    const html = readFileSync(join(dir, f), "utf8");
    const re = /<dt>(?:<button[^>]*data-term="([A-Za-z0-9]+)"[^>]*>)?[^<]*(?:<\/button>)?<\/dt><dd[^>]*>([\s\S]*?)<\/dd>/g;
    for (const m of html.matchAll(re)) {
      const key = m[1];
      if (key === undefined || declared(key) === null) continue;
      const den = /<span class="den">([^<]*)<\/span>/.exec(m[2] ?? "");
      if (den === null) continue;
      addUnit(units, key, unitOf(den[1] ?? ""));
    }
  }
  return { units, pages: files.length };
}

/** 比較 데이터(`compare/{첫글자}.json`)의 `d` 필드 */
function compareUnits(): { units: Map<string, Set<string>>; cards: number } {
  const dir = join(DIST, "compare");
  const units = new Map<string, Set<string>>();
  let cards = 0;
  if (!existsSync(dir)) return { units, cards };
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) {
    const shard = JSON.parse(readFileSync(join(dir, f), "utf8")) as
      Record<string, { stats: { k: string; d: string | null }[] }>;
    for (const card of Object.values(shard)) {
      cards += 1;
      for (const s of card.stats) {
        if (s.d === null || declared(s.k) === null) continue;
        addUnit(units, s.k, unitOf(s.d));
      }
    }
  }
  return { units, cards };
}

/**
 * ⚠**이 넷이 안 보이면 시험이 헛돈 것이다.** 감사가 잡은 지표들이라, 표본에서 사라지면
 * 「통과」가 아니라 「안 쟀음」이다(작업규칙 8). 두 출처 **양쪽**에서 요구한다.
 */
const MUST_APPEAR = ["obp", "woba", "babip", "srp"] as const;

test("⚠같은 지표의 분모 단위가 선수 페이지와 比較 데이터에서 같고, 용어집과도 같다", {
  skip: PAGES.length === 0 ? "dist 없음" : false,
}, () => {
  const player = playerPageUnits();
  const compare = compareUnits();

  assert.ok(player.pages > 100, `선수 페이지를 ${player.pages}장밖에 못 읽었다 — 이 시험이 공회전한다`);
  assert.ok(compare.cards > 100, `比較 카드를 ${compare.cards}건밖에 못 읽었다 — 이 시험이 공회전한다`);

  const problems: string[] = [];
  const checkedAgainstGlossary: string[] = [];

  for (const [source, units] of [["선수 페이지", player.units], ["compare/*.json", compare.units]] as const) {
    for (const [key, seenUnits] of units) {
      const want = declared(key);
      if (want === null) continue;
      checkedAgainstGlossary.push(`${source}:${key}`);
      const wrong = [...seenUnits].filter((u) => u !== want);
      if (wrong.length > 0) {
        problems.push(`${source} 의 ${key} 가 「${wrong.join("·")}」로 나간다 — 정의서는 「${want}」다`);
      }
    }
  }

  // ⚠**두 화면을 직접 맞대 본다.** 위 검사만 두면 정의서를 느슨하게 하는 순간 이 축이 사라진다
  for (const key of new Set([...player.units.keys(), ...compare.units.keys()])) {
    const a = player.units.get(key);
    const b = compare.units.get(key);
    if (a === undefined || b === undefined) continue;
    const av = [...a].sort().join("·");
    const bv = [...b].sort().join("·");
    if (av !== bv) problems.push(`${key}: 선수 페이지는 「${av}」인데 比較 데이터는 「${bv}」다`);
  }

  for (const key of MUST_APPEAR) {
    assert.ok(player.units.has(key), `선수 페이지에서 ${key} 의 분모를 한 번도 못 봤다 — 이 시험이 그 지표를 안 재고 있다`);
    assert.ok(compare.units.has(key), `比較 데이터에서 ${key} 의 분모를 한 번도 못 봤다 — 이 시험이 그 지표를 안 재고 있다`);
  }

  // 지표 종류가 줄면 표본이 한쪽으로 쏠린 것이다(2026-08-20 실측: 선수 20종 + 比較 19종)
  assert.ok(
    checkedAgainstGlossary.length >= 30,
    `정의서와 맞대 본 (출처×지표)가 ${checkedAgainstGlossary.length}건뿐이다 — 이 시험이 공회전한다`,
  );

  assert.deepEqual(
    problems,
    [],
    `분모 단위가 어긋난 곳 ${problems.length}건 / 선수 ${player.pages}장 · 比較 ${compare.cards}건`,
  );
});
