/**
 * **`player.position` 이 실제로 채워지고 있는가** — 「있는데 안 도는 장치」를 막는 canary.
 *
 * ⚠**이 칸이 비면 화면이 조용히 반대편을 그린다.** 선수 페이지의 역할 판정이
 * `position === "投手"` 를 먼저 보므로, 미상이면 투수가 타자로 판정되고
 * **자기 타석이 0이라 스플릿이 통째로 사라진다** — 에러가 아니라 빈 화면이다.
 *
 * 실측(2026-08-27 · 고치기 전): 투타 양쪽 기록을 가진 **2,374 선수-시즌** 중 **917** 이
 * 그 상태였고, 사라진 투구가 **상대한 타자 합 163,631 · 한 명 최대 847**이었다.
 * 소급 시즌일수록 심했다 — **2018년 191명 · 2026년 0명**.
 *
 * ## ⚠**「고쳤다」와 「계속 돈다」는 다른 말이다**
 *
 * 명단(`roster.html`)의 구획 머리에서 채운다. 그 마크업이 바뀌면 파서가 **멈추지만**(M7),
 * 적재기는 명단 실패를 **세고 넘어간다**(보충이지 본체가 아니므로 그게 맞다) —
 * 즉 **적재는 계속 성공하고 포지션만 서서히 안 채워진다.** 그 상태를 잡는 것이 이 시험이다.
 *
 * ⚠**`roleOf` 의 마지막 갈래가 이걸 완화하지만 없애지는 않는다.** 그쪽은 「투구가 자기 타석보다
 * 많으면 투수」라 **구원 투수는 구제되지만 야수의 포지션 표시는 여전히 빈다.**
 *
 * ⚠**DB 가 없으면 건너뛴다.** CI 는 `BB_REQUIRE_DB=1` 로 막고, 적재가 시험보다 먼저 돈다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { openDb } from "../src/db.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const DB = join(ROOT, "data", "bb.sqlite");
const HAS_DB = existsSync(DB);

if (process.env["BB_REQUIRE_DB"] === "1" && !HAS_DB) {
  throw new Error(`BB_REQUIRE_DB=1 인데 ${DB} 가 없다`);
}

const NOW = "2026-08-27T00:00:00.000Z";
const skip = HAS_DB ? false : "data/bb.sqlite 없음";

/**
 * ⚠**임계를 0 으로 두지 않는다.** 오늘 실측은 **1,640명 중 0명 미상**이지만,
 * 갓 들어온 경기의 선수가 명단 적재 전에 잠깐 비는 일이 **원리적으로** 있을 수 있다.
 * 0 으로 두면 그런 날 CI 가 헛되이 붉어지고, **헛되이 붉어지는 시험은 곧 무시된다.**
 * 대신 **비율**로 잰다 — 마크업이 바뀌어 보충이 멈추면 미상이 **수백 명 단위**로 불어난다
 * (고치기 전이 829/1,640 = 50.5% 였다).
 */
const MAX_UNKNOWN_RATIO = 0.02;

test("⚠포지션 보충이 계속 돌고 있다 — 멈추면 투수가 타자로 그려진다", { skip }, () => {
  const db = openDb(DB, NOW);
  try {
    const r = db.raw
      .prepare(
        "SELECT COUNT(*) AS total, SUM(CASE WHEN position IS NULL THEN 1 ELSE 0 END) AS unknown FROM player",
      )
      .get() as unknown as { total: number; unknown: number };
    const ratio = r.total === 0 ? 0 : r.unknown / r.total;
    // ⚠**분모를 같이 낸다**(작업규칙 7)
    console.log(`  · 포지션 미상 ${r.unknown} / 선수 ${r.total} (${(ratio * 100).toFixed(1)}%)`);
    assert.ok(
      ratio <= MAX_UNKNOWN_RATIO,
      `포지션 미상이 ${r.unknown}/${r.total} (${(ratio * 100).toFixed(1)}%) 이다.\n`
        + "⚠**명단에서 채우는 보충이 멈췄을 가능성이 크다** — `roster.html` 의 구획 머리\n"
        + "  (`<th colspan=\"3\">投手</th>`)를 파서가 못 읽으면 여기가 먼저 부푼다.\n"
        + "⚠**코드만 고치고 적재를 안 돌렸으면 옛 값이 남아 있다** — load-archive.ts 를 다시 돌려라.",
    );
  } finally {
    db.close();
  }
});

/**
 * ⚠**어휘가 넷뿐인 것이 이 설계의 전제다.** 선수 페이지의 「ポジション」과 명단의 구획이
 * 같은 어휘라서 **같은 칸에 채울 수 있다** — 어느 한쪽이 다른 말을 쓰기 시작하면
 * 화면의 역할 판정(`position === "投手"`)이 조용히 어긋난다.
 */
test("⚠포지션 어휘가 네 가지뿐이다 — 두 출처가 같은 말을 쓴다는 전제", { skip }, () => {
  const db = openDb(DB, NOW);
  try {
    const rows = db.raw
      .prepare("SELECT position AS p, COUNT(*) AS n FROM player WHERE position IS NOT NULL GROUP BY 1")
      .all() as unknown as { p: string; n: number }[];
    const seen = rows.map((x) => x.p).sort();
    console.log(`  · ${rows.map((x) => `${x.p} ${x.n}`).join(" · ")}`);
    const known = ["投手", "捕手", "内野手", "外野手"];
    const unexpected = seen.filter((p) => !known.includes(p));
    assert.deepEqual(
      unexpected,
      [],
      "모르는 포지션 값이 들어왔다 — 명단 파서와 선수 페이지 파서 중 한쪽이 새 말을 쓰기 시작했다",
    );
    assert.ok(seen.includes("投手"), "投手 가 하나도 없다 — 이 시험이 공회전한다");
  } finally {
    db.close();
  }
});
