/**
 * 앞으로의 경기 적재.
 *
 * ⚠**도구를 프로세스로 띄워서 잰다.** SQL 을 시험 안에 복사하면 도구가 바뀌어도 초록이다 —
 * 그건 시험이 아니라 사본이다(`stale-players.test.ts` 와 같은 이유).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { openDb } from "../src/index.ts";

const TOOL = fileURLToPath(new URL("../tools/load-upcoming.ts", import.meta.url));
const NOW = "2026-08-17T00:00:00.000Z";

/** 일정 표 한 행. `link` 를 주면 「이미 치러진 경기」가 된다 */
function row(mmdd: string, home: string, away: string, venue: string, time: string, link?: string): string {
  return `<tr id="date${mmdd}" class="">
    <td>${link === undefined ? "" : `<a href="${link}">x</a>`}
      <div class="team1">${home}</div><div class="team2">${away}</div></td>
    <td><div class="place">${venue}</div><div class="time">${time}</div></td>
  </tr>`;
}

async function withLoad(
  monthly: Record<string, string>,
  fn: (db: ReturnType<typeof openDb>, out: string, err: string, code: number) => void,
  /** ⚠**멱등을 재려면 실제로 두 번 돌려야 한다.** 한 번 돌리고 세는 것은 멱등 시험이 아니다 */
  runs = 1,
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "bb-upcoming-"));
  const games = join(dir, "archive", "npb", "games", "2026");
  await mkdir(games, { recursive: true });
  for (const [mm, body] of Object.entries(monthly)) {
    await writeFile(join(games, `schedule_${mm}.html.gz`), gzipSync(`<table>${body}</table>`));
    await writeFile(
      join(games, `schedule_${mm}.meta.json`),
      JSON.stringify({ fetchedAt: "2026-08-17T00:44:00.000Z", checkedAt: "2026-08-17T00:44:00.000Z" }),
    );
  }
  const dbPath = join(dir, "t.sqlite");
  openDb(dbPath, NOW).close(); // 마이그레이션만 돌린다
  let r = spawnSync(process.execPath, [TOOL, join(dir, "archive"), dbPath, "2026"], { encoding: "utf8" });
  for (let i = 1; i < runs; i++) {
    r = spawnSync(process.execPath, [TOOL, join(dir, "archive"), dbPath, "2026"], { encoding: "utf8" });
  }
  const db = openDb(dbPath, NOW);
  try {
    fn(db, r.stdout, r.stderr, r.status ?? 1);
  } finally {
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
}

test("앞으로의 경기만 넣는다 — 치러진 경기는 일정 표에서 스스로 빠진다", async () => {
  await withLoad(
    {
      "08": row("0816", "巨人", "阪神", "東京ドーム", "18:00", "/scores/2026/0816/g-t-15/")
        + row("0818", "DeNA", "巨人", "横　浜", "17:45"),
    },
    (db, out, _err, code) => {
      assert.equal(code, 0, `도구가 실패했다: ${out}`);
      const rows = db.raw.prepare("SELECT * FROM upcoming_game ORDER BY game_date").all() as unknown as {
        game_date: string; home_code: string; away_code: string; venue: string; start_time: string | null;
      }[];
      assert.equal(rows.length, 1, "치러진 경기가 섞였거나 미래 경기가 빠졌다");
      assert.equal(rows[0]!.game_date, "2026-08-18");
      assert.equal(rows[0]!.home_code, "db", "홈이 DeNA 가 아니다 — 홈·원정이 뒤집혔다");
      assert.equal(rows[0]!.away_code, "g");
      assert.equal(rows[0]!.venue, "横浜", "구장 표기가 정규화되지 않았다");
      assert.equal(rows[0]!.start_time, "17:45");
    },
  );
});

/**
 * ⚠**멱등**(M5). 두 번 돌려도 결과가 한 번과 같아야 한다 —
 * 재시도·크론 중복 기동·수동 재적재가 전부 일어난다.
 */
test("⚠두 번 적재해도 결과가 같다(M5)", async () => {
  const body = row("0818", "DeNA", "巨人", "横　浜", "17:45")
    + row("0819", "巨人", "阪神", "東京ドーム", "18:00");
  let once = "";
  await withLoad({ "08": body }, (db) => {
    once = JSON.stringify(db.raw.prepare("SELECT * FROM upcoming_game ORDER BY game_date").all());
  });
  await withLoad({ "08": body }, (db, out, _err, code) => {
    assert.equal(code, 0, `두 번째 적재가 실패했다: ${out}`);
    const twice = JSON.stringify(db.raw.prepare("SELECT * FROM upcoming_game ORDER BY game_date").all());
    assert.equal(twice, once, "두 번 돌린 결과가 한 번과 다르다");
  }, 2);
});

/**
 * ⚠**미정 시각은 `null` 이다. 0시가 아니다**(M11).
 * 0시로 때우면 「이 경기는 자정에 시작한다」가 되어 정렬과 화면이 동시에 틀린다.
 */
test("⚠개시 시각 미정은 null 이다 — 0시가 아니다(M11)", async () => {
  await withLoad(
    { "08": '<tr id="date0818"><td><div class="team1">DeNA</div><div class="team2">巨人</div></td>'
      + '<td><div class="place">横　浜</div><div class="time"></div></td></tr>' },
    (db) => {
      const r = db.raw.prepare("SELECT start_time FROM upcoming_game").get() as unknown as { start_time: string | null };
      assert.equal(r.start_time, null, "미정을 0시로 때웠다");
    },
  );
});

/**
 * ⚠**받지 않은 달을 말한다**(§3-7). 「70건」만 보면 그게 시즌 전체인지 한 달치인지 알 수 없다.
 */
test("⚠받지 않은 달을 보고한다 — 조용히 0건으로 끝내지 않는다", async () => {
  await withLoad({ "08": row("0818", "DeNA", "巨人", "横　浜", "17:45") }, (_db, out) => {
    assert.match(out, /받지 않은 달/, "안 받은 달을 말하지 않는다");
    assert.match(out, /03·04·05·06·07·09·10/, "어느 달이 없는지 말하지 않는다");
  });
});

/**
 * ⚠**표기가 바뀌면 실패로 끝난다**(M7). 조용히 0건이면 「이번 주 경기가 없다」로 읽힌다.
 */
test("⚠팀 칸을 못 읽으면 종료 코드가 1이다(M7)", async () => {
  await withLoad(
    { "08": '<tr id="date0818"><td><div class="team1"></div></td></tr>' },
    (_db, _out, err, code) => {
      assert.equal(code, 1, "못 읽었는데 성공으로 끝냈다");
      assert.match(err, /못 읽은 행/);
    },
  );
});

/**
 * ⚠**마크업이 바뀌면 「경기가 없다」가 아니라 실패여야 한다**(M7).
 *
 * 일정 표의 클래스 이름이 바뀌면 `team1` 칸 자체가 사라진다. 옛 파서는 그 행을 **아예 행으로 안 쳐서**
 * 적재가 DELETE 만 한 뒤 **종료 코드 0으로 끝났다** — 화면이 「앞으로의 경기가 없습니다」라고 말한다.
 * 반증자가 실제로 재현했다: 마크업을 바꾸자 upcoming_game 이 **8행 → 0행**(2026-08-18 감사 P1).
 * ⚠**이제는 파서가 그 행을 「못 읽음」으로 센다**(2026-09-11 · 칸에 글자가 있는데 경기로 못 읽었다) —
 * 그래서 문구가 「경기 행을 하나도 못 읽은 달」에서 「못 읽은 행이 있는 달」로 바뀌었다.
 */
test("⚠일정 마크업이 바뀌면 실패로 끝난다 — 조용한 0을 내지 않는다(M7)", async () => {
  await withLoad(
    { "08": '<tr id="date0818"><td><div class="TEAM-A">DeNA</div><div class="TEAM-B">巨人</div></td></tr>' },
    (_db, _out, err, code) => {
      assert.equal(code, 1, "마크업이 바뀌었는데 성공으로 끝냈다");
      assert.match(err, /못 읽은 행이 있는 달/);
    },
  );
});

/**
 * ⚠**경기가 없는 달은 실패가 아니다**(2026-09-11 · 오프시즌 설계 D6).
 * 옛 가드는 「경기 행 0」을 전부 구조 변경으로 봐서, **12~2월처럼 날짜 행만 있는 달**을 받는 날마다 exit 1 이었다 —
 * 수집기(`discover.ts`)는 같은 모양을 정상으로 받는데 **적재기만 반대 전제**였다.
 * 실물 공백 행: `<th>11/3（月）</th><td>&nbsp;</td><td>&nbsp;</td>`(2025년 11월 페이지).
 */
test("⚠날짜 행이 공백뿐인 달은 「경기가 없는 달」로 정상 종료한다", async () => {
  const blank = (mmdd: string): string =>
    `<tr id="date${mmdd}" class=" last"><th class="holiday" rowspan="1">12/${Number(mmdd.slice(2))}（月）</th><td>&nbsp;</td><td>&nbsp;</td></tr>`;
  await withLoad({ "12": blank("1201") + blank("1202") }, (db, out, err, code) => {
    assert.equal(code, 0, `경기가 없는 달을 실패로 끝냈다: ${err}`);
    assert.match(out, /경기가 없는 달 1개/);
    const n = (db.raw.prepare("SELECT COUNT(*) n FROM upcoming_game").get() as unknown as { n: number }).n;
    assert.equal(n, 0);
  });
});

/**
 * ⚠**대진 미정 포스트시즌 자리는 구조 변경이 아니다** — 실물 2026년 10월 페이지에 30행 있다
 * (`セ・CSファーストS` · `(予備日)` · `日本シリーズ` + 장소 칸 `セ本拠地球場`). 이것을 막으면 **10월 일정을 받는 날 적재가 멈춘다.**
 */
test("⚠대진 미정 예정 표기만 있는 달은 정상 종료한다", async () => {
  const ph = (mmdd: string, label: string, place = ""): string =>
    `<tr id="date${mmdd}" class=""><th rowspan="1">10/${Number(mmdd.slice(2))}（土）</th>` +
    `<td> <div class="commentLong">${label}</div> </td>` +
    `<td> <div class="place">${place}</div> <div class="time"></div> <div class="weather"> &nbsp; </div> </td>` +
    `<td> <div class="comment"></div> </td><td>&nbsp;</td></tr>`;
  await withLoad({ "10": ph("1010", "セ・CSファーストS") + ph("1024", "日本シリーズ", "セ本拠地球場") }, (_db, _out, err, code) => {
    assert.equal(code, 0, `예정 표기만 있는 달을 실패로 끝냈다: ${err}`);
  });
});

test("⚠날짜 행이 하나도 없는 달은 구조 변경이다 — 실패로 끝난다", async () => {
  await withLoad({ "08": '<div class="new-layout"><span>8/18 DeNA-巨人</span></div>' }, (_db, _out, err, code) => {
    assert.equal(code, 1, "날짜 행이 없는데 성공으로 끝냈다");
    assert.match(err, /날짜 행을 하나도 못 찾은 달/);
  });
});

/**
 * ⚠**감지에 성공해도 데이터를 지켜야 한다.**
 * 처음에는 종료 코드만 1로 두었는데, 그 시점에 **DELETE 는 이미 커밋**돼 표가 빈 채로 남았다 —
 * 「감지기가 데이터를 못 지킨다」. 던져서 트랜잭션을 되돌린다.
 */
test("⚠실패할 때 기존 일정을 지우지 않는다 — 트랜잭션을 되돌린다", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bb-upcoming-keep-"));
  const games = join(dir, "archive", "npb", "games", "2026");
  await mkdir(games, { recursive: true });
  const write = async (body: string): Promise<void> => {
    await writeFile(join(games, "schedule_08.html.gz"), gzipSync(`<table>${body}</table>`));
    await writeFile(join(games, "schedule_08.meta.json"), JSON.stringify({ checkedAt: "2026-08-18T00:00:00.000Z" }));
  };
  const dbPath = join(dir, "t.sqlite");
  openDb(dbPath, NOW).close();
  try {
    // 1) 정상 마크업으로 넣는다
    await write(row("0818", "DeNA", "巨人", "横　浜", "17:45") + row("0819", "巨人", "阪神", "東京ドーム", "18:00"));
    let r = spawnSync(process.execPath, [TOOL, join(dir, "archive"), dbPath, "2026"], { encoding: "utf8" });
    assert.equal(r.status, 0, `첫 적재가 실패했다: ${r.stdout}${r.stderr}`);
    const db1 = openDb(dbPath, NOW);
    const before = (db1.raw.prepare("SELECT COUNT(*) n FROM upcoming_game").get() as unknown as { n: number }).n;
    db1.close();
    assert.equal(before, 2);

    // 2) 마크업이 바뀐다
    await write('<tr id="date0820"><td><div class="TEAM-A">DeNA</div></td></tr>');
    r = spawnSync(process.execPath, [TOOL, join(dir, "archive"), dbPath, "2026"], { encoding: "utf8" });
    assert.equal(r.status, 1, "마크업이 바뀌었는데 성공으로 끝냈다");

    // 3) ⚠**기존 일정이 남아 있어야 한다**
    const db2 = openDb(dbPath, NOW);
    const after = (db2.raw.prepare("SELECT COUNT(*) n FROM upcoming_game").get() as unknown as { n: number }).n;
    db2.close();
    assert.equal(after, before, "감지에는 성공했는데 기존 일정을 지워 버렸다");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
