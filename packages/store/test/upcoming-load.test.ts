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
import { openDb, upsertGame } from "../src/index.ts";

const TOOL = fileURLToPath(new URL("../tools/load-upcoming.ts", import.meta.url));
const NOW = "2026-08-17T00:00:00.000Z";

/**
 * **그 달의 나머지 날짜를 실물처럼 공백 행으로 채운다.**
 *
 * ⚠**실물 월간 일정은 그 달 모든 날의 날짜 행을 싣는다**(75장 중 66장 · 나머지 9장은 개막 달의 앞부분만 빔 · 2026-09-11 실측).
 * 적재기가 이제 **날짜 완결성**을 요구하므로(설계 D5), 한두 행만 넣은 옛 픽스처는 「날짜가 빠진 달」로 떨어진다.
 * 구조 자체를 재는 시험(날짜 행이 없는 달 · 날짜가 빠진 달)만 채우지 않는다.
 */
function padMonth(mm: string, body: string, year = 2026): string {
  const have = new Set([...body.matchAll(/id=["']date(\d{4})["']/g)].map((m) => m[1]!));
  const last = new Date(Date.UTC(year, Number(mm), 0)).getUTCDate();
  let pad = "";
  for (let d = 1; d <= last; d++) {
    const key = `${mm}${String(d).padStart(2, "0")}`;
    if (!have.has(key)) pad += `<tr id="date${key}" class=""><th>${Number(mm)}/${d}</th><td>&nbsp;</td><td>&nbsp;</td></tr>`;
  }
  return body + pad;
}

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
  /** 나머지 날짜를 공백 행으로 채울지. 구조를 재는 시험만 `false` */
  pad = true,
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "bb-upcoming-"));
  const games = join(dir, "archive", "npb", "games", "2026");
  await mkdir(games, { recursive: true });
  for (const [mm, body] of Object.entries(monthly)) {
    await writeFile(join(games, `schedule_${mm}.html.gz`), gzipSync(`<table>${pad ? padMonth(mm, body) : body}</table>`));
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
  }, 1, false);
});

/**
 * ⚠**1차 증거 — 월간 일정이 「치렀다」(점수 링크)고 표시한 경기를 기록한다**(설계 D1-A · D5).
 * 옛 적재기는 이 행을 **세기만 하고 버렸다**(`orphans` 로그) — 「받고 있는데 안 읽던 것」의 여섯 번째다.
 * ⚠같은 날 같은 카드가 둘이면 **페이지 순서의 번째(seq)** 로 가른다 — 더블헤더 한 경기 누락을 경기 단위로 잡기 위해서다.
 */
test("⚠치러짐 표시와 사본의 취득 시각을 기록한다 — 같은 카드 두 경기는 번째로 가른다", async () => {
  await withLoad(
    {
      "08": row("0816", "巨人", "阪神", "東京ドーム", "13:00", "/scores/2026/0816/t-g-15/")
        + row("0816", "巨人", "阪神", "東京ドーム", "18:00", "/scores/2026/0816/t-g-16/")
        + row("0818", "DeNA", "巨人", "横　浜", "17:45"),
    },
    (db, out, err, code) => {
      assert.equal(code, 0, `도구가 실패했다: ${out}${err}`);
      const played = db.raw.prepare(
        "SELECT season, game_date, home_code, away_code, seq, source, fetched_at FROM schedule_played ORDER BY seq",
      ).all() as unknown as { season: number; game_date: string; home_code: string; away_code: string; seq: number; source: string; fetched_at: string }[];
      assert.deepEqual(
        played.map((p) => [p.game_date, p.home_code, p.away_code, p.seq]),
        [["2026-08-16", "g", "t", 0], ["2026-08-16", "g", "t", 1]],
        "치러짐 표시를 기록하지 않았거나 같은 카드 두 경기를 한 행으로 뭉갰다",
      );
      assert.equal(played[0]!.source, "npb.jp/games/2026/schedule_08_detail");
      assert.equal(played[0]!.fetched_at, "2026-08-17T00:44:00.000Z", "사본의 취득 시각이 아니다");
      const month = db.raw.prepare("SELECT season, month, source, fetched_at, date_rows, games FROM schedule_month").all() as unknown as {
        season: number; month: number; source: string; fetched_at: string; date_rows: number; games: number;
      }[];
      // ⚠`node:sqlite` 의 행은 프로토타입 없는 객체다 — 펼쳐서 비교한다
      assert.deepEqual(month.map((m) => ({ ...m })), [{
        season: 2026, month: 8, source: "npb.jp/games/2026/schedule_08_detail",
        // 날짜 행 = 16일 두 행 + 18일 한 행 + 나머지 29일의 공백 행
        fetched_at: "2026-08-17T00:44:00.000Z", date_rows: 32, games: 3,
      }]);
      const upcoming = db.raw.prepare("SELECT COUNT(*) n FROM upcoming_game").get() as unknown as { n: number };
      assert.equal(upcoming.n, 1, "앞으로의 경기 적재가 바뀌었다");
    },
  );
});

/** 한 시즌 아카이브를 직접 다루는 시험용 — 달마다 본문과 사이드카를 쓴다 */
async function writeMonth(games: string, mm: string, body: string, checkedAt = "2026-08-17T00:44:00.000Z"): Promise<void> {
  await writeFile(join(games, `schedule_${mm}.html.gz`), gzipSync(`<table>${body}</table>`));
  await writeFile(join(games, `schedule_${mm}.meta.json`), JSON.stringify({ checkedAt }));
}

async function withArchive(fn: (ctx: {
  games: string; run: () => { code: number; out: string; err: string }; db: () => ReturnType<typeof openDb>;
}) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "bb-upcoming-arch-"));
  const games = join(dir, "archive", "npb", "games", "2026");
  await mkdir(games, { recursive: true });
  const dbPath = join(dir, "t.sqlite");
  openDb(dbPath, NOW).close();
  try {
    await fn({
      games,
      run: () => {
        const r = spawnSync(process.execPath, [TOOL, join(dir, "archive"), dbPath, "2026"], { encoding: "utf8" });
        return { code: r.status ?? 1, out: r.stdout, err: r.stderr };
      },
      db: () => openDb(dbPath, NOW),
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const count = (db: ReturnType<typeof openDb>, sql: string): number =>
  (db.raw.prepare(sql).get() as unknown as { n: number }).n;

/**
 * ⚠**교체 단위는 「읽은 달」이다**(설계 D5 · 콜드 리뷰 지적). 시즌 단위로 지우면 **파일이 빠진 달의 증거까지 지워져**
 * 누락 판정이 조용히 풀린다(복원 누락 · 경로 오류). 사라진 달은 **행을 보존하고 exit 1** 로 알린다.
 */
test("⚠사본이 사라진 달의 행은 보존하고 실패로 알린다 — 읽은 달만 바꾼다", async () => {
  await withArchive(async ({ games, run, db }) => {
    await writeMonth(games, "08", padMonth("08", row("0816", "巨人", "阪神", "東京ドーム", "18:00", "/scores/2026/0816/t-g-15/")));
    await writeMonth(games, "09", padMonth("09", row("0901", "巨人", "阪神", "東京ドーム", "18:00", "/scores/2026/0901/t-g-20/")
      + row("0930", "DeNA", "巨人", "横　浜", "18:00")));
    let r = run();
    assert.equal(r.code, 0, `첫 적재가 실패했다: ${r.out}${r.err}`);
    // 9월 사본이 사라지고 8월은 내용이 바뀐다
    await rm(join(games, "schedule_09.html.gz"));
    await rm(join(games, "schedule_09.meta.json"));
    await writeMonth(games, "08", padMonth("08", row("0817", "阪神", "巨人", "甲子園", "18:00", "/scores/2026/0817/g-t-16/")), "2026-08-18T00:44:00.000Z");
    r = run();
    assert.equal(r.code, 1, "사본이 사라진 달이 있는데 성공으로 끝냈다");
    assert.match(r.err, /사본이 사라진 달 09/);
    const d = db();
    try {
      assert.equal(count(d, "SELECT COUNT(*) n FROM schedule_played WHERE game_date LIKE '2026-09-%'"), 1, "사라진 달의 치러짐 표시를 지웠다");
      assert.equal(count(d, "SELECT COUNT(*) n FROM upcoming_game WHERE game_date LIKE '2026-09-%'"), 1, "사라진 달의 앞으로의 경기를 지웠다");
      assert.equal(count(d, "SELECT COUNT(*) n FROM schedule_month WHERE month = 9"), 1, "사라진 달의 사본 기록을 지웠다");
      const aug = d.raw.prepare("SELECT game_date FROM schedule_played WHERE game_date LIKE '2026-08-%'").all() as unknown as { game_date: string }[];
      assert.deepEqual(aug.map((x) => x.game_date), ["2026-08-17"], "읽은 달(8월)을 바꾸지 않았다");
      const augMonth = d.raw.prepare("SELECT fetched_at f FROM schedule_month WHERE month = 8").get() as unknown as { f: string };
      assert.equal(augMonth.f, "2026-08-18T00:44:00.000Z");
    } finally {
      d.close();
    }
  });
});

/**
 * ⚠**「파싱이 됐다」가 「그 달 전부를 담았다」는 아니다**(설계 D5 · 콜드 리뷰 지적). 중간 날짜가 빠진 응답으로 달을 교체하면
 * 사라진 날의 치러짐 표시를 지우고 사본은 새로워져 누락 판정이 함께 풀린다 — **되돌리고 멈춘다.**
 */
test("⚠중간 날짜가 빠진 달은 되돌리고 멈춘다 — 기존 증거를 지우지 않는다", async () => {
  await withArchive(async ({ games, run, db }) => {
    const full = padMonth("10", row("1010", "巨人", "阪神", "東京ドーム", "18:00", "/scores/2026/1010/t-g-01/"));
    await writeMonth(games, "10", full);
    assert.equal(run().code, 0);
    // 10일 행이 빠진 응답
    const partial = full.replace(/<tr id="date1010"[\s\S]*?<\/tr>/, "");
    await writeMonth(games, "10", partial, "2026-10-12T00:44:00.000Z");
    const r = run();
    assert.equal(r.code, 1, "날짜가 빠진 달로 교체했다");
    assert.match(r.err, /날짜가 빠진 달 10/);
    const d = db();
    try {
      assert.equal(count(d, "SELECT COUNT(*) n FROM schedule_played WHERE game_date = '2026-10-10'"), 1, "기존 치러짐 표시를 지웠다");
      const m = d.raw.prepare("SELECT fetched_at f FROM schedule_month WHERE month = 10").get() as unknown as { f: string };
      assert.equal(m.f, "2026-08-17T00:44:00.000Z", "되돌리지 않고 사본 시각을 새로 썼다");
    } finally {
      d.close();
    }
  });
});

/**
 * **개막 달은 앞부분 날짜가 없다**(실측: 8시즌의 3월 · 2020년 6월 — 개막일부터 싣는다). 그 달에 DB 경기가 첫 날짜 행보다
 * 앞서 없으면 정상이다. ⚠있으면 앞부분이 **잘린** 것이다 — 되돌린다.
 */
test("개막 달의 앞부분 공백은 정상이다 — DB 에 더 이른 그 달 경기가 있으면 되돌린다", async () => {
  const march = (): string => {
    let s = row("0327", "巨人", "阪神", "東京ドーム", "18:00", "/scores/2026/0327/t-g-01/");
    for (let d = 28; d <= 31; d++) s += `<tr id="date03${d}" class=""><th>3/${d}</th><td>&nbsp;</td><td>&nbsp;</td></tr>`;
    return s;
  };
  await withArchive(async ({ games, run }) => {
    await writeMonth(games, "03", march());
    const r = run();
    assert.equal(r.code, 0, `개막 달의 앞부분 공백을 실패로 봤다: ${r.err}`);
  });
  await withArchive(async ({ games, run, db }) => {
    const d = db();
    upsertGame(d, {
      gameId: "early", season: 2026, gameDate: "2026-03-20", awayCode: "t", homeCode: "g", gameNo: 1,
      status: "played", notPlayedReason: null, competition: "regular", sourceUrl: "https://npb.jp/x",
      fetchedAt: NOW, awayRuns: 0, homeRuns: 1,
    });
    d.close();
    await writeMonth(games, "03", march());
    const r = run();
    assert.equal(r.code, 1, "그 달에 더 이른 경기가 DB 에 있는데 앞부분이 잘린 사본을 받았다");
    assert.match(r.err, /날짜가 빠진 달 03/);
  });
});

/**
 * ⚠**이 가드가 따로 막는 경우는 「사본 기록(`schedule_month`)이 없는데 파일도 0개」다**(뮤테이션으로 확인).
 * 기록이 있으면 파일이 사라진 달은 「사본이 사라진 달」이 이미 잡는다. 기록이 없으면(021 이전에 적재한 DB · 기록이 지워진 DB)
 * 가드가 없을 때 **「일정 0개월분」으로 조용히 exit 0** 이 된다.
 */
test("⚠시즌 폴더에 일정 파일이 0개면 아무것도 지우지 않고 실패로 끝난다 — 사본 기록이 없어도", async () => {
  await withArchive(async ({ games, run, db }) => {
    await writeMonth(games, "08", padMonth("08", row("0818", "DeNA", "巨人", "横　浜", "17:45")));
    assert.equal(run().code, 0);
    const pre = db();
    pre.raw.exec("DELETE FROM schedule_month"); // 021 이전에 적재한 DB 와 같은 상태
    pre.close();
    await rm(join(games, "schedule_08.html.gz"));
    await rm(join(games, "schedule_08.meta.json"));
    const r = run();
    assert.equal(r.code, 1, "읽을 파일이 없는데 성공으로 끝냈다");
    const d = db();
    try {
      assert.equal(count(d, "SELECT COUNT(*) n FROM upcoming_game"), 1, "읽을 파일이 없는데 기존 일정을 지웠다");
    } finally {
      d.close();
    }
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
    await writeFile(join(games, "schedule_08.html.gz"), gzipSync(`<table>${padMonth("08", body)}</table>`));
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
