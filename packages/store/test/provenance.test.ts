/**
 * **§0-10(출처 추적성) — 어느 행을 집어도 「어디서 · 언제 · 몇 번째 판」에 답할 수 있는가.**
 *
 * ⚠**감사(#9)의 지적은 「`as_of` 가 11개 표 어디에도 없다 → 판정 기준이 거짓」이었다.**
 * 실측해 보니 **기준은 정말 거짓**인데, **거짓인 방식이 감사가 적은 것과 다르다.**
 *
 * ## 실측 (2026-08-27 · 표 11개 · 수집 레코드만)
 *
 * ⚠**컬럼 이름으로 세면 틀린다.** 처음에 `source`/`fetched_at`/`as_of`/`revision` 이라는
 * **글자만** 찾아서 `player` 를 「아무것도 없음」으로 셌는데, 실제로는
 * `first_seen_at`·`last_seen_at`·**`profile_fetched_at`** 을 갖고 있다.
 * **물어야 할 것은 이름이 아니라 「답할 수 있는가」다.**
 *
 * 자식 넷(`batting_line`·`pitching_line`·`pa_event`·`runner_event` · 합 **851,072행**)은
 * `game_id` 로 부모를 타고 답한다 — **같은 값을 851,072행에 복사할 이유가 없다.**
 * 「M4 4종이 전 수집 표에 존재」를 글자대로 지키려면 그 복사를 해야 하는데,
 * 그건 **목적이 아니라 기준을 위한 일**이다.
 *
 * ## ⚠기준을 약하게 바꾸는 것이 아니다
 *
 * 바꾸는 것은 **무엇을 요구하는가**이지 **얼마나 요구하는가**가 아니다:
 * 「어디서·언제」는 **모든 수집 표가 반드시** 답해야 하고(자기든 부모든),
 * 「몇 번째 판」은 **정정이 개념적으로 성립하는 표만** 답한다 —
 * 통째로 지우고 다시 넣는 표(`upcoming_game`·`player_season_name`)에서 `revision` 은 뜻이 없다.
 * ⚠**그 면제에는 사유를 적는다.** 「없어도 된다」가 아니라 **「왜 없는 것이 맞는가」**다.
 *
 * ⚠**이 시험은 데이터가 없어도 돈다** — 빈 DB 에 마이그레이션을 적용해 스키마만 본다.
 * 그래서 CI 에서 아카이브 복원 전에도 성립하고, 새 표가 생기면 **그날 바로** 운다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../src/db.ts";

/** 수집 레코드가 아닌 표 — 출처를 물을 대상이 아니다 */
const NOT_COLLECTED: Readonly<Record<string, string>> = {
  quarantine: "규칙 밖의 원문을 담아 두는 곳이다. 원문 자체가 출처이고, 그것을 담으려고 있는 표다",
  schema_migration: "우리가 만든 이력이지 수집한 값이 아니다",
};

interface Provenance {
  /** 어디서 — 이 표 자신의 컬럼, 또는 `→표.컬럼` */
  where: string;
  /** 언제 */
  when: string;
  /** 몇 번째 판. `null` 이면 정정이 성립하지 않는 표이고, 그 사유를 적는다 */
  revision: string | null;
  /** `revision` 이 `null` 일 때 필수 */
  why?: string;
}

/**
 * ⚠**부모를 타고 답하는 것은 정당하다.** 자식 행은 부모(경기)를 통째로 다시 넣을 때
 * 같이 갈리므로, 출처가 갈릴 자리가 없다(`replacePaEvents`).
 */
const PROVENANCE: Readonly<Record<string, Provenance>> = {
  game: { where: "source_url", when: "fetched_at", revision: "revision" },
  batting_line: { where: "→game.source_url", when: "→game.fetched_at", revision: "→game.revision" },
  pitching_line: { where: "→game.source_url", when: "→game.fetched_at", revision: "→game.revision" },
  pa_event: { where: "→game.source_url", when: "→game.fetched_at", revision: "→game.revision" },
  runner_event: { where: "→game.source_url", when: "→game.fetched_at", revision: "→game.revision" },
  probable_pitcher: { where: "source_url", when: "fetched_at", revision: "revision" },
  career_batting: {
    where: "source",
    when: "fetched_at",
    revision: null,
    why:
      "선수 페이지의 통산 표를 **통째로 다시 넣는다** — 한 행만 정정되는 일이 없다. "
      + "⚠판이 궁금하면 아카이브 사이드카(`*.meta.json`)의 `revision` 이 답한다.",
  },
  career_pitching: {
    where: "source",
    when: "fetched_at",
    revision: null,
    why: "career_batting 과 같은 이유 — 같은 페이지에서 함께 온다",
  },
  player: {
    where: "profile_fetched_at",
    when: "profile_fetched_at",
    revision: null,
    why:
      "선수 프로필은 **현재 상태의 스냅숏**이라 「몇 번째 판」이 성립하지 않는다. "
      + "⚠`first_seen_at`·`last_seen_at` 이 「언제부터 언제까지 봤는가」를 따로 답한다.",
  },
  player_season_name: {
    where: "source",
    when: "as_of",
    revision: null,
    why:
      "시즌마다의 표시명은 **그 시즌 경기에서 유도한 값**이라 정정이 아니라 재계산이다. "
      + "⚠`as_of` 가 「어느 시즌 기준인가」를 답한다 — 이 표만 그 이름을 쓴다.",
  },
  upcoming_game: {
    where: "source",
    when: "fetched_at",
    revision: null,
    why:
      "매 실행이 **시즌 단위로 지우고 다시 넣는다**(`load-upcoming.ts`) — 판이 쌓이지 않는다. "
      + "⚠예정은 원래 바뀌는 것이고(M9의 정신) 바뀐 이력을 우리가 주장하지 않는다.",
  },
  // 019 드래프트 — 경기와 달리 부모(game_id)가 없다. npb.jp 가 ETag·Last-Modified 를
  // 주지 않으므로 revision 은 본문 해시이고, 네 표 모두 자기 컬럼으로 M4 를 답한다.
  draft_event: { where: "source", when: "fetched_at", revision: "revision" },
  draft_pick: { where: "source", when: "fetched_at", revision: "revision" },
  draft_bid: { where: "source", when: "fetched_at", revision: "revision" },
  draft_note: { where: "source", when: "fetched_at", revision: "revision" },
};

async function schema(): Promise<Map<string, string[]>> {
  const dir = await mkdtemp(join(tmpdir(), "bb-prov-"));
  const db = openDb(join(dir, "t.sqlite"), "1970-01-01T00:00:00.000Z");
  try {
    const out = new Map<string, string[]>();
    const tables = db.raw
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
      .all() as unknown as { name: string }[];
    for (const { name } of tables) {
      const cols = db.raw.prepare(`PRAGMA table_info(${name})`).all() as unknown as { name: string }[];
      out.set(name, cols.map((c) => c.name));
    }
    return out;
  } finally {
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
}

const TABLES = await schema();

test("⚠스키마를 읽는 방식이 헛돌지 않는다 — 아래 시험이 여기에 얹혀 있다", () => {
  assert.ok(TABLES.size >= 10, `표를 ${TABLES.size}개밖에 못 읽었다 — 마이그레이션이 안 돌았다`);
  assert.ok(TABLES.has("game"), "game 표가 없다");
  console.log(`  · 표 ${TABLES.size}개 (수집 ${TABLES.size - Object.keys(NOT_COLLECTED).length}개)`);
});

/** ⚠**새 표가 출처 없이 생기면 여기서 먼저 운다** — 그게 이 시험의 존재 이유다 */
test("⚠모든 수집 표가 출처를 밝힌다 — 새 표를 조용히 들이지 않는다", () => {
  const unknown = [...TABLES.keys()]
    .filter((t) => !(t in PROVENANCE) && !(t in NOT_COLLECTED))
    .sort();
  assert.deepEqual(
    unknown,
    [],
    "출처를 안 밝힌 표가 있다.\n"
      + "⚠**「어디서·언제」는 모든 수집 표가 답해야 한다**(§0-10) — 자기 컬럼이든 부모를 타고든.\n"
      + "  수집한 값이 아니라면 NOT_COLLECTED 에 **왜 아닌지**와 함께 적어라.",
  );
});

/** ⚠**사유만 남고 대상이 없으면 낡은 주장이다** */
test("⚠적어 둔 표가 실제로 있다", () => {
  const gone = [...Object.keys(PROVENANCE), ...Object.keys(NOT_COLLECTED)]
    .filter((t) => !TABLES.has(t))
    .sort();
  assert.deepEqual(gone, [], "목록에 있는데 스키마에 없는 표다 — 지워졌으면 목록에서도 빼라");
});

/** ⚠**적어 둔 컬럼이 실제로 있어야 한다** — 이름만 맞춰 두면 그건 주장이지 사실이 아니다 */
test("⚠적어 둔 컬럼이 실제로 존재한다", () => {
  const bad: string[] = [];
  const check = (table: string, ref: string, role: string): void => {
    const m = /^→([a-z_]+)\.([a-z_]+)$/.exec(ref);
    const [owner, col] = m === null ? [table, ref] : [m[1]!, m[2]!];
    const cols = TABLES.get(owner);
    if (cols === undefined) bad.push(`${table}.${role}: 부모 표 ${owner} 가 없다`);
    else if (!cols.includes(col)) bad.push(`${table}.${role}: ${owner}.${col} 컬럼이 없다`);
  };
  for (const [t, p] of Object.entries(PROVENANCE)) {
    check(t, p.where, "where");
    check(t, p.when, "when");
    if (p.revision !== null) check(t, p.revision, "revision");
  }
  assert.deepEqual(bad, [], `적어 둔 컬럼이 스키마에 없다:\n  ${bad.join("\n  ")}`);
});

/**
 * ⚠**부모를 타고 답하려면 그 열쇠가 있어야 한다.** `→game.…` 이라고 적어 놓고
 * `game_id` 가 없으면 그건 답이 아니라 **답하는 척**이다.
 */
test("⚠부모를 타고 답한다고 적은 표에는 그 열쇠가 있다", () => {
  const bad: string[] = [];
  for (const [t, p] of Object.entries(PROVENANCE)) {
    const m = /^→([a-z_]+)\./.exec(p.where);
    if (m === null) continue;
    const key = `${m[1]!}_id`;
    if (!(TABLES.get(t) ?? []).includes(key)) bad.push(`${t}: ${key} 가 없는데 ${p.where} 를 탄다고 적었다`);
  }
  assert.deepEqual(bad, [], bad.join("\n"));
});

/**
 * ⚠**「몇 번째 판」을 면제하려면 사유가 있어야 한다.**
 * 「없어도 된다」가 아니라 **「왜 없는 것이 맞는가」**를 적는다 — 그게 다음 사람이 읽을 것이다.
 */
test("⚠revision 을 면제한 표는 사유를 적었다", () => {
  const noWhy = Object.entries(PROVENANCE)
    .filter(([, p]) => p.revision === null && (p.why === undefined || p.why.trim() === ""))
    .map(([t]) => t);
  assert.deepEqual(
    noWhy,
    [],
    "revision 을 비워 두고 사유를 안 적었다 — **정정이 왜 성립하지 않는지** 적어라",
  );
  const exempt = Object.entries(PROVENANCE).filter(([, p]) => p.revision === null).length;
  console.log(`  · revision 있음 ${Object.keys(PROVENANCE).length - exempt}개 · 사유와 함께 면제 ${exempt}개`);
});

/** ⚠**수집이 아니라고 적은 표에도 사유가 필요하다** — 여기가 빠져나가는 문이 되면 안 된다 */
test("⚠수집 레코드가 아니라고 적은 표는 사유를 적었다", () => {
  const noWhy = Object.entries(NOT_COLLECTED).filter(([, why]) => why.trim() === "").map(([t]) => t);
  assert.deepEqual(noWhy, [], "NOT_COLLECTED 에 사유 없는 항목이 있다 — 여기가 빠져나가는 문이 된다");
});
