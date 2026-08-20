/**
 * カウント別成績의 **구조적 불변식** — 실DB로.
 *
 * ⚠**이 지표에는 대조할 무료 소스가 없다**(T2 성질검증). nf3·データパーク가 같은 값을 내지만
 * 공표 수치를 우리가 정당하게 받아올 경로가 없어서, **값을 맞대는 대신 「그럴 수밖에 없는 성질」**을 건다.
 * 성질이 깨지면 `ball_count` 의 뜻이 우리가 생각한 것과 다르다는 뜻이고, 그때는 전 파생값이 무효다.
 *
 * ## 무엇을 거는가
 *
 * 1. **2스트라이크가 아닌 타석에는 삼진이 (거의) 없다.** 삼진은 3번째 스트라이크로 끝나므로
 *    마지막 1구를 던진 카운트에는 반드시 2스트라이크가 서 있다.
 * 2. **볼넷의 종료 볼 카운트는 3이다.** 4번째 볼로 끝나므로.
 *    실측: 전 시즌 정규 **42,568 / 42,579 (99.974%)**. 완전 100%가 아니므로 임계값을 건다.
 * 3. **정의역 밖은 극히 드물지만 0이 아니다** — `4-2より` 1건. 격리 장치가 죽으면 여기가 말한다.
 *
 * ## ⚠「= 0」으로 걸면 지금 떨어진다 — **원문 쪽 오기가 실재한다** (2026-08-20 실측)
 *
 * 처음 이 시험을 「非2S 삼진 = 0」으로 걸었고 **떨어졌다.** 근거였던 「2025 정규 非2S
 * 30,832타석 중 삼진 0건」은 **한 시즌·한 대회만** 본 수치였고, 보유 9시즌 전 대회로 넓히면
 * **9건**이 나온다(정규 8 · 일본시리즈 1 · 2018:1 · 2019:1 · 2020:1 · 2021:3 · 2022:2 · 2023:1).
 *
 * ⚠**우리 파서의 결함이 아니다 — 원문을 직접 열어 확인했다.**
 * `data/archive/npb/scores/2023/0704/h-f-12/playbyplay.html.gz` 에서 그 타석의 원문이
 * 그대로 `0-1より` `空振り三振` 이다. npb.jp 쪽 기입 오류이고, 우리가 고칠 것도 숨길 것도 없다.
 *
 * → 그래서 **「0」이 아니라 「무시할 만한 비율인가」**를 건다. `ball_count` 의 뜻이 통째로
 *   바뀌면(예: 「타석 시작 카운트」가 되면) 이 비율이 100% 근처로 튀어 반드시 떨어진다.
 *   ⚠**「0건」과 「안 쟀음」을 구별해 쓴다**(작업규칙 7) — 여기 있는 것은 「9건 / 264,956」이다.
 *
 * ⚠**DB 가 없으면 건너뛴다.** CI 는 `BB_REQUIRE_DB=1` 로 막는다(작업규칙 7·8).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { parseBallCount } from "../src/count.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const DB = join(HERE, "..", "..", "..", "data", "bb.sqlite");
const HAS_DB = existsSync(DB);
if (process.env["BB_REQUIRE_DB"] === "1" && !HAS_DB) {
  throw new Error(`BB_REQUIRE_DB=1 인데 ${DB} 가 없다`);
}

/** ⚠**대회를 섞지 않는다**(§2-1) · 미성립 경기 제외 · 잠정값 제외(M9) */
const SQL = `
SELECT e.ball_count AS ballCount, e.outcome AS outcome, COUNT(*) AS n
FROM pa_event e JOIN game g ON g.game_id = e.game_id
WHERE g.status = 'played' AND g.competition = 'regular' AND e.status = 'final'
GROUP BY e.ball_count, e.outcome
`;

interface Row {
  ballCount: string | null;
  outcome: string;
  n: number;
}

function rows(): Row[] {
  const db = new DatabaseSync(DB, { readOnly: true });
  try {
    return db.prepare(SQL).all() as unknown as Row[];
  } finally {
    db.close();
  }
}

/** 삼진으로 세는 결과. ⚠**낫아웃 출루도 삼진이다**(`fold.ts` 가 그렇게 접는다) */
const STRIKEOUTS = new Set(["strikeout", "strikeoutReached"]);

/** 원문 오기의 허용선. **실측 9 / 110,353 = 0.008%** 이고 여기는 그 100배 자리에 둔다 */
const STRIKEOUT_ANOMALY_LIMIT = 0.01;

test(
  "⚠2스트라이크가 아닌 타석의 삼진이 무시할 만한 비율이다 — 이것이 깨지면 ball_count 의 뜻이 다르다",
  { skip: HAS_DB ? false : "DB 없음" },
  () => {
    const all = rows();
    let notTwoStrikePa = 0;
    let notTwoStrikeSo = 0;
    let strikeouts = 0;
    let total = 0;
    for (const r of all) {
      const n = Number(r.n);
      total += n;
      const isSo = STRIKEOUTS.has(r.outcome);
      if (isSo) strikeouts += n;
      const c = parseBallCount(r.ballCount);
      if (c === null || c.strikes === 2) continue;
      notTwoStrikePa += n;
      if (isSo) notTwoStrikeSo += n;
    }
    // ⚠**공회전 방지**: 아무것도 못 읽으면 아래 단언이 0 대 0 으로 조용히 통과한다
    assert.ok(total > 400000, `타석을 ${total}건밖에 못 읽었다 — 이 시험이 공회전한다`);
    assert.ok(
      notTwoStrikePa > 100000,
      `非2S 타석이 ${notTwoStrikePa}건뿐이다 — 분모가 이상하다(이 시험이 공회전한다)`,
    );
    assert.ok(strikeouts > 50000, `삼진을 ${strikeouts}건밖에 못 읽었다 — 이 시험이 공회전한다`);
    const ratio = notTwoStrikeSo / strikeouts;
    assert.ok(
      ratio < STRIKEOUT_ANOMALY_LIMIT,
      `2스트라이크가 아닌데 삼진인 타석이 ${notTwoStrikeSo}건 / 삼진 ${strikeouts}건 ` +
        `(${(ratio * 100).toFixed(3)}%) — 실측 기준선은 9건(0.008%)이고 전부 npb.jp 원문의 기입 오류였다. ` +
        "여기까지 커졌다면 `ball_count` 가 「마지막 1구를 던진 카운트」가 아니게 됐거나 어휘가 바뀐 것이고, " +
        "packages/aggregate/src/count.ts 의 전제가 무너진다",
    );
  },
);

test(
  "⚠볼넷의 종료 볼 카운트가 3이다 — 99.9% 이상",
  { skip: HAS_DB ? false : "DB 없음" },
  () => {
    let walks = 0;
    let threeBall = 0;
    for (const r of rows()) {
      if (r.outcome !== "walk") continue;
      const n = Number(r.n);
      walks += n;
      const c = parseBallCount(r.ballCount);
      if (c !== null && c.balls === 3) threeBall += n;
    }
    assert.ok(walks > 30000, `볼넷을 ${walks}건밖에 못 읽었다 — 이 시험이 공회전한다`);
    const ratio = threeBall / walks;
    // 실측 2026-08-20: 42,568 / 42,579 = 0.99974
    assert.ok(
      ratio >= 0.999,
      `볼넷의 3볼 비율이 ${(ratio * 100).toFixed(3)}% (${threeBall}/${walks}) — ` +
        "0.1% 를 넘게 어긋나면 `ball_count` 의 뜻을 다시 확인하라",
    );
  },
);

test(
  "⚠정의역 밖 값이 실재하고, 그것은 전체의 0.01% 미만이다 — 격리가 죽으면 여기가 말한다",
  { skip: HAS_DB ? false : "DB 없음" },
  () => {
    let bad = 0;
    let total = 0;
    const samples: string[] = [];
    for (const r of rows()) {
      const n = Number(r.n);
      total += n;
      if (parseBallCount(r.ballCount) !== null) continue;
      bad += n;
      if (samples.length < 5) samples.push(String(r.ballCount));
    }
    assert.ok(total > 400000, `타석을 ${total}건밖에 못 읽었다 — 이 시험이 공회전한다`);
    /**
     * ⚠**「0건이어야 한다」로 걸지 않는다** — 실제로 1건 있고, 그 1건이 이 지표에 격리 장치를
     * 넣은 이유다. 여기서 재는 것은 **그 비율이 무시할 만한가**이고, 커지면 격리가 값을 갉아먹는다.
     */
    assert.ok(
      bad / total < 0.0001,
      `읽을 수 없는 볼카운트가 ${bad}/${total} (${((bad / total) * 100).toFixed(4)}%) — ` +
        `표본: ${samples.join(" · ")}. 소스 표기가 바뀌었는지 확인하라(M7)`,
    );
  },
);
