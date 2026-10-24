/**
 * **재현 도구 셋의 「문서에 적는 수」가 고정 범위(`DOC_SEASONS`)로 세는가** — 프로세스로 띄워서 잰다(2026-10-24 · 이중 검토 P3).
 *
 * `scripts/rpw-measure.ts` · `scripts/runner-seq-measure.ts` · `scripts/venue-measure.ts --pf` 는 고정 수치 시험
 * (`park-db.test.ts` · `runner-seq.test.ts`)의 **근거 재현 명령**이다. 그런데 셋 다 「완결 시즌」을 **데이터로** 쟀다 —
 * 정규시즌이 끝난 날 2026 을 넣어, 시험·문서가 2018〜2025 를 말하는데 재현 명령은 2026 을 섞은 수를 「문서에 적는 수」로 냈다.
 * → 「문서에 적는 수」는 `DOC_SEASONS` 로 세고, 데이터상 완결 시즌은 **참고 줄**로 따로 낸다.
 *
 * ⚠**합성 DB 로 잰다** — 실DB 는 날마다 다르고, 이 결함은 **데이터상 완결 ≠ 고정 범위**인 날에만 보인다.
 * 그래서 그 상태를 일부러 만든다: 2026 은 정규시즌을 전부 치렀고(12구단 × 143 · 범위 밖) 2025 는 몇 경기뿐이다(범위 안 · 미완결).
 * ⚠**외부 요청 0** · 도구는 DB 를 **읽기 전용**으로 연다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ensurePlayer, openDb, upsertGame } from "@bb-app/store";
import type { Db } from "@bb-app/store";
import { DOC_SEASONS } from "@bb-app/domain";

const SCRIPTS = fileURLToPath(new URL("../", import.meta.url));
const FIXED_AT = "2026-10-24T00:00:00.000Z";

function game(db: Db, gameId: string, date: string, home: string, away: string, venue: string | null, homeRuns: number, awayRuns: number): void {
  upsertGame(db, {
    gameId, season: Number(date.slice(0, 4)), gameDate: date, awayCode: away, homeCode: home, gameNo: 1,
    status: "played", notPlayedReason: null, competition: "regular", sourceUrl: "https://npb.jp/x",
    fetchedAt: FIXED_AT, awayRuns, homeRuns, venue,
  });
}

function runner(db: Db, gameId: string, seq: number): void {
  db.raw.prepare(
    `INSERT INTO runner_event (game_id, seq, inning, half, after_seq, outs_before, bases, runner_id, kind, base, double_steal, raw)
     VALUES (?, ?, 1, 'top', 0, 0, '1--', 'R1', 'steal', '2b', 0, '二塁盗塁成功')`,
  ).run(gameId, seq);
}

/**
 * 합성 DB — **데이터상 완결 = {2026} · 고정 범위 안의 경기 = 2025 의 3경기**.
 * - 2026: 12구단 × 143경기(하루 6경기 × 143일). `g` 홈의 72경기만 구장 `東京ドーム` 이 있다(파크팩터 표본) · 주자 사건 2건
 * - 2025: `t` 홈 甲子園 2경기 · `s` 홈 神宮 1경기(전부 센트럴끼리) · 주자 사건 1건
 */
async function withSynthetic(fn: (dbPath: string) => void): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "bb-measure-scope-"));
  const dbPath = join(dir, "t.sqlite");
  const db = openDb(dbPath, FIXED_AT);
  try {
    db.raw.exec("BEGIN");
    ensurePlayer(db, "R1", "走者", FIXED_AT);
    const teams = ["g", "t", "s", "c", "db", "d", "h", "l", "f", "m", "e", "b"];
    for (let k = 0; k < 143; k += 1) {
      const date = new Date(Date.parse("2026-04-01T00:00:00Z") + k * 86_400_000).toISOString().slice(0, 10);
      for (let i = 0; i < teams.length; i += 2) {
        // 홈을 번갈아 둔다 — `g` 홈 경기(구장 東京ドーム)가 파크팩터 표본이 된다
        const [home, away] = k % 2 === 0 ? [teams[i]!, teams[i + 1]!] : [teams[i + 1]!, teams[i]!];
        game(db, `r${k}-${i}`, date, home, away, home === "g" ? "東京ドーム" : null, 2, 1);
      }
    }
    runner(db, "r0-0", 1);
    runner(db, "r1-0", 1);
    game(db, "y1", "2025-06-01", "t", "g", "甲子園", 5, 4);
    game(db, "y2", "2025-06-02", "t", "g", "甲子園", 5, 4);
    game(db, "y3", "2025-06-03", "s", "c", "神宮", 3, 3);
    runner(db, "y1", 1);
    db.raw.exec("COMMIT");
  } finally {
    db.close();
  }
  try {
    fn(dbPath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function run(script: string, args: string[]): string {
  const r = spawnSync(process.execPath, [join(SCRIPTS, script), ...args], { encoding: "utf8", maxBuffer: 1 << 26 });
  assert.equal(r.status, 0, `${script} 가 실패했다: ${r.stderr}`);
  return r.stdout;
}
/** 그 표지가 든 줄 — 없으면 떨어진다(「문서에 적는 수」 줄 자체가 없으면 안내가 거짓이다) */
function line(out: string, mark: string): string {
  const hit = out.split("\n").find((l) => l.includes(mark));
  assert.ok(hit !== undefined, `「${mark}」 줄이 없다:\n${out}`);
  return hit!;
}

test("⚠rpw-measure — 「문서에 적는 수」(리그내 대 교류전 포함의 차)는 DOC_SEASONS 로 센다 · 데이터상 완결은 참고 줄", () => withSynthetic((dbPath) => {
  const out = run("rpw-measure.ts", [dbPath]);
  // 고정 범위 안의 경기는 2025 센트럴뿐 → 1건. 데이터상 완결(2026)은 센트럴·퍼시픽 → 2건. 전 시즌 → 3건
  assert.match(line(out, "## 리그내 대 교류전 포함의 차 (문서 범위"), /— 1건 ·/, "문서에 적는 수에 범위 밖(2026)이 섞였다");
  assert.match(line(out, "## 리그내 대 교류전 포함의 차 (참고 · 데이터상 완결"), /— 2건 ·/);
  assert.match(line(out, "## 리그내 대 교류전 포함의 차 (참고 · 전 시즌"), /— 3건 ·/);
  assert.match(line(out, "문서 범위(DOC_SEASONS):"), new RegExp(DOC_SEASONS.join(" ")));
}));

test("⚠runner-seq-measure — 「문서에 적는 수」(주자 사건)는 DOC_SEASONS 로 센다 · 데이터상 완결은 참고 줄", () => withSynthetic((dbPath) => {
  const out = run("runner-seq-measure.ts", [dbPath]);
  assert.match(line(out, "문서 범위(DOC_SEASONS)** · 정규 · played"), /주자 사건 1건/, "문서에 적는 수에 범위 밖(2026)이 섞였다");
  assert.match(line(out, "(참고) 데이터상 완결 시즌 · 정규 · played"), /주자 사건 2건/);
  assert.match(line(out, "보유 전 시즌 · 정규 · played"), /주자 사건 3건/);
}));

test("⚠venue-measure --pf — 「문서에 적는 수」(파크팩터 기준 표본)는 DOC_SEASONS 로 센다 · 데이터상 완결은 참고 줄", () => withSynthetic((dbPath) => {
  const out = run("venue-measure.ts", [dbPath, "--pf"]);
  assert.match(line(out, "## ⑤ 파크팩터 — 문서 범위"), new RegExp(`${DOC_SEASONS.length}시즌\\(${DOC_SEASONS.join("·")}\\)`));
  // 고정 범위 안의 홈구장 경기 = 2025 의 3경기(甲子園 2 · 神宮 1) · 데이터상 완결(2026)의 표본은 g 홈 東京ドーム 72경기
  assert.match(line(out, "기준 표본: **"), /\*\*3경기\*\*/, "문서에 적는 기준 표본에 범위 밖(2026)이 섞였다");
  assert.match(line(out, "(참고) 데이터상 완결"), /1시즌\(2026\)[^]*기준 표본 72경기/);
}));
