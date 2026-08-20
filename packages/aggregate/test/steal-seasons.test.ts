/**
 * **화면이 말하는 리그 전체 수치가 아직 참인가** — 실DB로.
 *
 * ⚠**이 시험의 존재 이유는 「낡음」이다**(2026-08-20 이중 검토 P1).
 * `player-page.ts` 의 走塁 각주는 「9시즌으로 本盗 성공 **47**·盗塁刺 **146**, 그중 **40** 이
 * 더블스틸」이라고 **문자열로** 말하고, 그 각주는 배포물 **1,808장**에 복제된다.
 * 오늘은 참이지만 **시즌을 하나 백필하면 그 순간 1,808장이 거짓 숫자를 말한다** —
 * CLAUDE.md §2-2 가 「이 줄이 낡으면 판정 기준 자체가 거짓이 된다」로 이미 한 번 당한 실패 모드이고,
 * 이번엔 문서가 아니라 **유저 화면**이다.
 *
 * → 그래서 **DB 에서 다시 세어 화면 문자열과 맞대 본다.** 백필하면 여기서 떨어지고,
 *   떨어진 자리가 「각주도 같이 고쳐라」라고 말한다.
 *
 * ⚠**시험이 화면 문자열을 파싱한다** — 소스를 읽는 것이 이상해 보이지만, 그 수가 **거기에만**
 * 있으므로 다른 방법이 없다. (수를 데이터로 흘려보내는 쪽이 더 낫지만, 각주는 시즌 하나가 아니라
 * **보유 전 시즌 합계**를 말하는데 빌드는 시즌마다 도므로 그 배선이 간단하지 않다.)
 *
 * ⚠**DB 가 없으면 건너뛴다.** CI 는 `BB_REQUIRE_DB=1` 로 막는다(작업규칙 7·8).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const HERE = dirname(fileURLToPath(import.meta.url));
const DB = join(HERE, "..", "..", "..", "data", "bb.sqlite");
const NOTE_SOURCE = join(HERE, "..", "..", "web", "src", "player-page.ts");
const HAS_DB = existsSync(DB);
if (process.env["BB_REQUIRE_DB"] === "1" && !HAS_DB) {
  throw new Error(`BB_REQUIRE_DB=1 인데 ${DB} 가 없다`);
}

/** ⚠**정규시즌만**(§2-1) · **미성립 경기 제외** — 화면 각주가 그렇게 말한다 */
const SQL = `
SELECT r.kind AS kind, r.base AS base, r.double_steal AS ds, COUNT(*) AS n
FROM runner_event r JOIN game g ON g.game_id = r.game_id
WHERE g.status = 'played' AND g.competition = 'regular'
GROUP BY r.kind, r.base, r.double_steal
`;

interface Row {
  kind: string;
  base: string;
  ds: number;
  n: number;
}

function counts(): { get: (kind: string, base: string) => number; homeDoubleSteal: number; total: number } {
  const db = new DatabaseSync(DB, { readOnly: true });
  try {
    const rows = db.prepare(SQL).all() as unknown as Row[];
    const by = new Map<string, number>();
    let homeDoubleSteal = 0;
    let total = 0;
    for (const r of rows) {
      const k = `${r.kind}|${r.base}`;
      by.set(k, (by.get(k) ?? 0) + Number(r.n));
      total += Number(r.n);
      if (r.kind === "steal" && r.base === "home" && Number(r.ds) === 1) homeDoubleSteal += Number(r.n);
    }
    return { get: (kind, base) => by.get(`${kind}|${base}`) ?? 0, homeDoubleSteal, total };
  } finally {
    db.close();
  }
}

test("⚠화면이 말하는 本盗 수치가 아직 참이다 — 백필하면 여기서 떨어진다", { skip: HAS_DB ? false : "DB 없음" }, () => {
  const c = counts();
  // 공회전 방지: 주자 사건을 하나도 못 읽으면 아래 단언이 전부 0 대 0이 된다
  assert.ok(c.total > 10000, `주자 사건을 ${c.total}건밖에 못 읽었다 — 이 시험이 공회전한다`);

  const note = readFileSync(NOTE_SOURCE, "utf8");
  const m = /成功(\d+)・盗塁刺(\d+)/.exec(note);
  assert.ok(m !== null, "走塁 각주에서 本盗 수치를 못 찾았다 — 문구를 바꿨으면 이 시험도 같이 고쳐라");
  const ds = /成功\d+のうち(\d+)はダブルスチール/.exec(note);
  assert.ok(ds !== null, "走塁 각주에서 더블스틸 수치를 못 찾았다");

  const sbHome = c.get("steal", "home");
  const csHome = c.get("caughtStealing", "home");
  assert.equal(
    Number(m[1]),
    sbHome,
    `각주의 本盗 성공 ${m[1]} 이 실제(${sbHome})와 다르다 — 시즌을 넣었으면 player-page.ts 의 각주도 고쳐라`,
  );
  assert.equal(
    Number(m[2]),
    csHome,
    `각주의 本盗 도루자 ${m[2]} 이 실제(${csHome})와 다르다 — player-page.ts 의 각주를 고쳐라`,
  );
  assert.equal(
    Number(ds[1]),
    c.homeDoubleSteal,
    `각주의 더블스틸 ${ds[1]} 이 실제(${c.homeDoubleSteal})와 다르다 — player-page.ts 의 각주를 고쳐라`,
  );

  // ⚠**「실패가 성공보다 많다」는 각주의 주장 자체**다. 뒤집히면 문구가 거짓이 된다
  assert.ok(csHome > sbHome, `本盗 는 실패가 더 많다고 각주가 말하는데 성공 ${sbHome} · 실패 ${csHome} 이다`);
});

/**
 * ⚠**루별 수치는 코드 주석·정의서에도 흩어져 있다**(`steal.ts` · `docs/metrics/README.md`).
 * 그쪽은 화면이 아니라 읽는 사람용이지만, 낡으면 다음 사람이 그 수를 믿고 판단한다.
 * 여기서 한 번에 고정해 **백필 때 같이 고치게** 만든다.
 */
test("⚠루별 도루·도루자·견제사가 문서에 적힌 수와 같다", { skip: HAS_DB ? false : "DB 없음" }, () => {
  const c = counts();
  assert.deepEqual(
    {
      sb: { "2b": c.get("steal", "2b"), "3b": c.get("steal", "3b"), home: c.get("steal", "home") },
      cs: {
        "2b": c.get("caughtStealing", "2b"),
        "3b": c.get("caughtStealing", "3b"),
        home: c.get("caughtStealing", "home"),
      },
      pickoff: {
        "1b": c.get("pickoff", "1b"),
        "2b": c.get("pickoff", "2b"),
        "3b": c.get("pickoff", "3b"),
      },
    },
    {
      sb: { "2b": 7471, "3b": 288, home: 47 },
      cs: { "2b": 3238, "3b": 128, home: 146 },
      pickoff: { "1b": 392, "2b": 131, "3b": 21 },
    },
    "루별 수치가 바뀌었다 — packages/aggregate/src/steal.ts 의 주석과 docs/metrics/README.md §1-A 도 같이 고쳐라",
  );
  // ⚠**1루를 훔칠 수는 없다**(실측 0). 여기 수가 생기면 데이터나 파서가 이상한 것이다
  assert.equal(c.get("steal", "1b"), 0, "1루 도루가 생겼다 — 데이터나 파서를 의심하라");
});
