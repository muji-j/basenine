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

/**
 * ⚠**10·11월 예외로 받은 행은 표기를 로그에 찍는다**(2026-09-11 · 수정분 재검토 1차 R1 · 2차 권고).
 * 예외는 「진짜 미정 표기(`CS勝者`)」와 「약칭이 깨진 미래 경기」를 못 가른다 — 표본이 없어 패턴으로 좁히면 추측이 틀릴 때
 * 10월 정지가 되살아난다. 그래서 **좁히지 않고 보이게** 한다. 런북의 확인 날짜(리그 우승 확정 직후)에 사람이 이 줄을 본다.
 */
test("⚠10·11월 예외로 받은 대진 미정 행의 표기를 요약에 찍는다", async () => {
  await withLoad({ "10": row("1010", "阪神", "CS勝者", "甲子園", "18:00") + row("1011", "阪神", "CS勝者", "甲子園", "18:00") }, (_db, out, err, code) => {
    assert.equal(code, 0, `대진 미정 행이 있는 10월을 실패로 봤다: ${err}`);
    assert.match(out, /대진 미정 팀 칸 2행/, "예외로 받은 행 수를 안 찍었다");
    assert.match(out, /阪神−CS勝者/, "예외로 받은 표기를 안 찍었다 — 진짜 미정 표기인지 로그로 못 가른다");
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
 * ⚠**롤백 반경은 「이번 실행에서 읽은 전체」다**(2026-09-11 · 3중 검토 1차 F1 · 2차가 실험으로 확인).
 * 교체 **단위**는 달이지만 트랜잭션은 실행 하나다 — 9월이 못 읽힌 날에는 **정상인 8월의 새 치러짐 표시·사본 시각도 함께 되돌린다.**
 * 의도다: 그날은 이미 exit 1 로 잡이 실패해 배포가 막히고, 달마다 커밋해도 그건 같다. 잃는 것은 실패 기간의 부분 갱신뿐이고
 * B(사본이 낡으면 예고로 판정)가 하루 전체 누락을 여전히 잡는다. **바꾸려면 이 시험부터 바꿔라** — 조용히 반경이 바뀌지 않게.
 */
test("⚠한 실행에서 못 읽은 달이 있으면 같이 읽은 정상 달의 갱신도 되돌린다 — 반경은 실행 전체다", async () => {
  await withArchive(async ({ games, run, db }) => {
    await writeMonth(games, "08", padMonth("08", row("0816", "巨人", "阪神", "東京ドーム", "18:00", "/scores/2026/0816/t-g-15/")));
    await writeMonth(games, "09", padMonth("09", row("0901", "巨人", "阪神", "東京ドーム", "18:00")));
    assert.equal(run().code, 0);
    // 8월은 정상으로 새 치러짐 표시가 붙고, 9월은 팀 칸이 비어 못 읽는다
    await writeMonth(
      games, "08",
      padMonth("08", row("0816", "巨人", "阪神", "東京ドーム", "18:00", "/scores/2026/0816/t-g-15/") + row("0820", "阪神", "巨人", "甲子園", "18:00", "/scores/2026/0820/g-t-16/")),
      "2026-08-21T00:44:00.000Z",
    );
    await writeMonth(games, "09", padMonth("09", row("0901", "", "阪神", "東京ドーム", "18:00")), "2026-08-21T00:44:00.000Z");
    const r = run();
    assert.equal(r.code, 1, "못 읽은 달이 있는데 성공으로 끝냈다");
    assert.match(r.err, /못 읽은 행이 있는 달/);
    const d = db();
    try {
      assert.equal(count(d, "SELECT COUNT(*) n FROM schedule_played WHERE game_date = '2026-08-20'"), 0, "같은 실행의 정상 달 갱신을 커밋했다 — 반경이 달로 바뀌었다");
      const m = d.raw.prepare("SELECT fetched_at f FROM schedule_month WHERE month = 8").get() as unknown as { f: string };
      assert.equal(m.f, "2026-08-17T00:44:00.000Z", "같은 실행의 정상 달 사본 시각을 새로 썼다");
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
    // 같은 사본을 다시 받아도 정상이다 — 전에 관측한 가장 이른 날이 첫 날짜 행과 같다
    await writeMonth(games, "03", march(), "2026-03-29T00:44:00.000Z");
    const again = run();
    assert.equal(again.code, 0, `개막 달을 다시 적재하자 실패로 봤다: ${again.err}`);
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
    assert.match(r.err, /근거: 경기 행·치러짐 표시가 2026-03-20/, "멈춘 근거(사실)를 말하지 않는다");
  });
});

/**
 * ⚠⚠**앞부분 공백을 허용할지 `game` 만 보고 정하면 바로 그 누락이 근거에서 빠진다**(2026-09-11 · 3중 검토 3차 P1 · 실행 재현).
 * 10/1 경기를 못 받아 `game` 에 10/3 만 있을 때, 10/1 행이 잘린 사본(10/2~31)이 오면 「그 달에 첫 날짜 행보다 이른 경기가 없다」가
 * 참이 되어 **개막 달로 받아들이고** — 10/1 의 치러짐 표시를 지우고 사본 시각을 새로 써서 A·B 가 **함께 풀린다.**
 * → 근거는 둘이다(설계 D5): ⑴ 치러진 사실(경기 행 · 치러짐 표시) ⑵ **받아들인 전 사본의 내용 있는 첫 날짜**(`schedule_month.first_content`)가
 *   이미 왔는데 새 사본에 없다. 아래 두 경우는 전 사본이 10/1 부터 실었으므로 ⑵ 가 잡는다(첫 경우는 ⑴ 도).
 */
test("⚠⚠전에 관측한 날이 빠진 사본은 개막 달이 아니다 — 누락 증거를 지우지 않고 멈춘다", async () => {
  const oct = (withFirst: boolean, first: string): string => {
    let s = withFirst ? first : "";
    s += row("1003", "巨人", "阪神", "東京ドーム", "18:00", "/scores/2026/1003/t-g-03/");
    for (let d = 2; d <= 31; d++) {
      if (d === 3) continue;
      s += `<tr id="date10${String(d).padStart(2, "0")}" class=""><th>10/${d}</th><td>&nbsp;</td><td>&nbsp;</td></tr>`;
    }
    return s;
  };
  const cases = [
    { label: "치러짐 표시", first: row("1001", "DeNA", "広島", "横　浜", "18:00", "/scores/2026/1001/c-db-01/"), table: "schedule_played" },
    { label: "앞으로의 경기", first: row("1001", "DeNA", "広島", "横　浜", "18:00"), table: "upcoming_game" },
  ];
  for (const c of cases) {
    await withArchive(async ({ games, run, db }) => {
      const pre = db();
      upsertGame(pre, {
        gameId: "oct3", season: 2026, gameDate: "2026-10-03", awayCode: "t", homeCode: "g", gameNo: 1,
        status: "played", notPlayedReason: null, competition: "regular", sourceUrl: "https://npb.jp/x",
        fetchedAt: NOW, awayRuns: 0, homeRuns: 1,
      });
      pre.close();
      await writeMonth(games, "10", oct(true, c.first));
      assert.equal(run().code, 0, `${c.label}: 완결된 사본의 첫 적재가 실패했다`);
      // 10/1 행이 잘린 사본 — 10/2 부터 싣는다
      await writeMonth(games, "10", oct(false, c.first), "2026-10-04T00:44:00.000Z");
      const r = run();
      assert.equal(r.code, 1, `${c.label}: 전에 관측한 10/1 이 빠진 사본을 개막 달로 받았다`);
      assert.match(r.err, /날짜가 빠진 달 10/);
      const d = db();
      try {
        assert.equal(count(d, `SELECT COUNT(*) n FROM ${c.table} WHERE game_date = '2026-10-01'`), 1, `${c.label}: 10/1 관측을 지웠다`);
        const m = d.raw.prepare("SELECT fetched_at f FROM schedule_month WHERE month = 10").get() as unknown as { f: string };
        assert.equal(m.f, "2026-08-17T00:44:00.000Z", `${c.label}: 되돌리지 않고 사본 시각을 새로 썼다`);
      } finally {
        d.close();
      }
    });
  }
});

/**
 * ⚠⚠**잘림의 증거는 「받아들인 전 사본이 실었던 첫 날」이다**(2026-09-11 · 3라운드 재검토 2·3차 · 실행 재현).
 *
 * 1회: `game` 만 봤다 → 누락된 바로 그 경기가 근거에서 빠졌다(3중 검토 3차 P1).
 * 2회: 앞으로의 경기 · 予告先発을 「관측한 날」로 더했다 → 予告先発은 **어디서도 안 지워지고 `load-starters` 가 아카이브에서 되살려**,
 *   개막이 미뤄진 옛 날짜가 **지나는 순간** 적재기를 시즌 내내 멈췄고 런북 복구도 같은 실행에서 되돌려졌다(재검토 2·3차).
 * → 다른 표의 관측으로 추측하지 않고 **그 달 페이지 자신의 이력**을 본다: 받아들인 사본의 내용 있는 첫 날짜를 `schedule_month.first_content` 에 두고(빈 행은 세지 않는다 · 4라운드 F2),
 *   새 사본이 그보다 늦게 시작하는데 **그 날이 이미 왔으면**(사본을 받은 JST 날짜 ≥ 그 날) 잘린 것이다.
 *   ⚠예정 표기(대진 미정)만 있던 날도 날짜 행이라 첫 날짜가 된다 — 予告先発에 기대지 않고 B 의 근거를 지킨다.
 */
test("⚠⚠전 사본이 실었던 첫 날이 이미 왔는데 빠진 사본은 멈춘다 — 예정 표기만 있던 날도 · 予告先発 없이", async () => {
  const ph = (mmdd: string): string =>
    `<tr id="date${mmdd}" class=""><th>${Number(mmdd.slice(0, 2))}/${Number(mmdd.slice(2))}</th><td><div class="commentLong">セ・CSファーストS</div></td><td><div class="place"></div></td></tr>`;
  const oct = (withFirst: boolean): string => {
    let s = withFirst ? ph("1001") : "";
    for (let d = 2; d <= 31; d++) s += `<tr id="date10${String(d).padStart(2, "0")}" class=""><th>10/${d}</th><td>&nbsp;</td><td>&nbsp;</td></tr>`;
    return s;
  };
  await withArchive(async ({ games, run, db }) => {
    await writeMonth(games, "10", oct(true), "2026-09-30T00:44:00.000Z");
    assert.equal(run().code, 0, "완결된 사본의 첫 적재가 실패했다");
    await writeMonth(games, "10", oct(false), "2026-10-04T00:44:00.000Z");
    const r = run();
    assert.equal(r.code, 1, "전 사본이 10/1 부터 실었는데 10/1 이 빠진 사본을 개막 달로 받았다 — B 가 꺼진다");
    assert.match(r.err, /날짜가 빠진 달 10/);
    assert.match(r.err, /전 사본이 2026-10-01 부터 내용을 실었/, "멈춘 근거(전 사본의 첫 날)를 말하지 않는다 — 운영자가 엉뚱한 행을 지운다");
    const d = db();
    try {
      const m = d.raw.prepare("SELECT fetched_at f, first_content l FROM schedule_month WHERE month = 10").get() as unknown as { f: string; l: string };
      assert.equal(m.f, "2026-09-30T00:44:00.000Z", "되돌리지 않고 사본 시각을 새로 썼다 — B 가 꺼진다");
      assert.equal(m.l, "2026-10-01", "되돌리지 않고 기준선을 옮겼다");
    } finally {
      d.close();
    }
  });
});

/**
 * ⚠**「이미 왔다」의 경계는 JST 자정이다**(3라운드 재검토 2차 R3-3). 그날 받은 사본은 그날을 싣는다 — 경기가 중지돼도 날짜 행은 링크를 단 채 남는다
 * (실물 중지 287행). 날짜를 지우는 일정 변경은 **미리** 공표된다. ⚠2차는 「그날 22:00」을 제안했지만 그러면 그날 낮의 잘린 사본 한 장이
 * 기준선을 넘겨 이후 잘림이 안 보인다.
 */
test("⚠「이미 왔다」는 JST 날짜로 가른다 — 9/30 23:59 JST 에 받은 사본은 10/1 을 몰라도 되고 10/1 00:00 JST 사본은 실어야 한다", async () => {
  const oct = (from: number): string => {
    let s = from === 1 ? row("1001", "巨人", "阪神", "東京ドーム", "18:00") : "";
    for (let d = Math.max(from, 2); d <= 31; d++) s += `<tr id="date10${String(d).padStart(2, "0")}" class=""><th>10/${d}</th><td>&nbsp;</td><td>&nbsp;</td></tr>`;
    return s;
  };
  for (const [checkedAt, want] of [["2026-09-30T14:59:00.000Z", 0], ["2026-09-30T15:00:00.000Z", 1]] as const) {
    await withArchive(async ({ games, run }) => {
      await writeMonth(games, "10", oct(1), "2026-09-29T00:44:00.000Z");
      assert.equal(run().code, 0);
      await writeMonth(games, "10", oct(2), checkedAt);
      const r = run();
      assert.equal(r.code, want, `${checkedAt}(JST ${want === 0 ? "9/30 23:59" : "10/1 00:00"}) 사본의 판정이 틀렸다: ${r.err}`);
    });
  }
});

/**
 * ⚠⚠**아직 오지 않은 날은 정당하게 사라질 수 있다 — 개막이 같은 달 안에서 늦춰지면**(2026-09-11 · 수정분 재검토 2차 D1 · 3라운드 2·3차 R3-1 · 실행 재현).
 * 다른 표의 관측을 근거로 삼자 3/26 개막을 본 뒤 3/30 으로 늦춘 사본이 멈췄고(멈추면 되돌리므로 영원히), 날짜를 가려도 **予告先発은 안 지워져**
 * 옛 개막일이 **지나는 순간** 다시 멈췄다. 이제 근거는 **받아들인 사본의 첫 날짜**라 3/11 사본을 받는 순간 기준선이 3/30 으로 옮겨 가고,
 * 옛 날짜가 지나도 예고 행이 남아도 멈추지 않는다.
 */
test("⚠⚠개막이 같은 달 안에서 늦춰진 사본은 받는다 — 아직 오지 않은 날의 관측으로 멈추지 않는다", async () => {
  await withArchive(async ({ games, run, db }) => {
    let early = row("0326", "巨人", "阪神", "東京ドーム", "18:00");
    for (let d = 27; d <= 31; d++) early += `<tr id="date03${d}" class=""><th>3/${d}</th><td>&nbsp;</td><td>&nbsp;</td></tr>`;
    await writeMonth(games, "03", early, "2026-03-10T00:44:00.000Z");
    assert.equal(run().code, 0);
    // 원래 개막일의 예고도 이미 나와 있었다 — 아직 오지 않은 날의 예고도 잘림의 증거가 아니다
    const pre = db();
    for (const [team, opp] of [["g", "t"], ["t", "g"]] as const) {
      pre.raw.prepare(
        `INSERT INTO probable_pitcher (game_date, team_code, opponent_code, player_id, source_name, venue, start_time, league, source_url, fetched_at)
         VALUES ('2026-03-26', ?, ?, NULL, NULL, NULL, '18:00', 'cl', 'https://npb.jp/announcement/starter/', '2026-03-10T04:00:00.000Z')`,
      ).run(team, opp);
    }
    pre.close();
    const late = row("0330", "巨人", "阪神", "東京ドーム", "18:00") + `<tr id="date0331" class=""><th>3/31</th><td>&nbsp;</td><td>&nbsp;</td></tr>`;
    await writeMonth(games, "03", late, "2026-03-11T00:44:00.000Z");
    const r = run();
    assert.equal(r.code, 0, `개막 연기(아직 오지 않은 3/26 이 사라짐)를 잘린 사본으로 봤다: ${r.err}`);
    assert.equal(run().code, 0, "다음 실행에서도 풀리지 않았다");
    // ⚠⚠옛 개막일(3/26)이 **지난 뒤**에 받은 사본도 받는다 — 예고 행이 남아 있어도(3라운드 재검토 2·3차 R3-1 · 실행 재현)
    await writeMonth(games, "03", late, "2026-03-27T00:44:00.000Z");
    const after = run();
    assert.equal(after.code, 0, `옛 개막일이 지나자 받아들였던 연기 사본을 다시 거부했다 — 시즌 내내 멈춘다: ${after.err}`);
    const d = db();
    try {
      const dates = (d.raw.prepare("SELECT game_date g FROM upcoming_game WHERE game_date LIKE '2026-03-%' ORDER BY 1").all() as unknown as { g: string }[]).map((x) => x.g);
      assert.deepEqual(dates, ["2026-03-30"], "늦춰진 개막으로 앞으로의 경기를 바꾸지 않았다");
    } finally {
      d.close();
    }
  });
  // ⚠사본 시각을 모르면 「이미 지난 날」을 가를 수 없다 — 전부 세어 멈춘다(안전한 쪽 · M11)
  await withArchive(async ({ games, run }) => {
    let early = row("0326", "巨人", "阪神", "東京ドーム", "18:00");
    for (let d = 27; d <= 31; d++) early += `<tr id="date03${d}" class=""><th>3/${d}</th><td>&nbsp;</td><td>&nbsp;</td></tr>`;
    await writeMonth(games, "03", early, "2026-03-10T00:44:00.000Z");
    assert.equal(run().code, 0);
    const late = row("0330", "巨人", "阪神", "東京ドーム", "18:00") + `<tr id="date0331" class=""><th>3/31</th><td>&nbsp;</td><td>&nbsp;</td></tr>`;
    await writeMonth(games, "03", late, "not-a-date");
    const r = run();
    assert.equal(r.code, 1, "사본 시각을 모르는데 전에 관측한 날이 빠진 사본을 받았다");
    assert.match(r.err, /날짜가 빠진 달 03/);
  });
});

/**
 * ⚠⚠**기준선은 「내용이 있는 첫 날짜 행」이다 — 빈 행은 세지 않는다**(2026-09-11 · 4라운드 재검토 2차 F2).
 * 개막 전에 받은 3월 페이지가 3/1 부터 빈 행을 싣고(⚠실물 표본 없음) 뒤 페이지가 개막일부터 싣는다면, 빈 행까지 센 기준선(03-01)은
 * 「이미 온 날이 빠졌다」로 **3월부터 적재기를 멈춘다.** ⚠대가: 전 사본에서 비어 있던 날이 빠진 것은 받아들인다 — 그 사이 경기가 생겼거나
 * 잘림이 첫 내용일을 넘어 이어지면 못 잡는다(5라운드 재검토 2차 D1 · 설계 §5).
 */
test("⚠⚠빈 행으로 시작하던 개막 달 사본 뒤에 개막일부터 싣는 사본은 받는다 — 빈 행은 기준선이 아니다", async () => {
  await withArchive(async ({ games, run, db }) => {
    let pre = "";
    for (let d = 1; d <= 26; d++) pre += `<tr id="date03${String(d).padStart(2, "0")}" class=""><th>3/${d}</th><td>&nbsp;</td><td>&nbsp;</td></tr>`;
    const tail = row("0327", "巨人", "阪神", "東京ドーム", "18:00") +
      [28, 29, 30, 31].map((d) => `<tr id="date03${d}" class=""><th>3/${d}</th><td>&nbsp;</td><td>&nbsp;</td></tr>`).join("");
    await writeMonth(games, "03", pre + tail, "2026-03-02T00:44:00.000Z");
    assert.equal(run().code, 0);
    await writeMonth(games, "03", tail, "2026-03-20T00:44:00.000Z");
    const r = run();
    assert.equal(r.code, 0, `빈 행 3/1~26 이 빠진 개막 달 사본을 잘린 사본으로 봤다 — 3월부터 멈춘다: ${r.err}`);
    const d = db();
    try {
      const m = d.raw.prepare("SELECT first_content c FROM schedule_month WHERE month = 3").get() as unknown as { c: string };
      assert.equal(m.c, "2026-03-27");
    } finally {
      d.close();
    }
  });
});

/**
 * ⚠**기준선은 문서 순서가 아니라 날짜 순서의 첫 내용 행이다**(5라운드 재검토 1차 V1 · 2차 확정 · 실행 재현).
 * 파서의 내용 키는 페이지에 **나온 순서**라, 날짜가 뒤바뀐 페이지(실물 75장에는 0장)에서 첫 원소를 쓰면 너무 늦은 날이 기준선이 되고
 * 그 뒤의 잘림이 조용히 통과한다. 옆의 `first`(첫 날짜 행)는 이미 정렬해서 구했다 — 같은 방어를 쓴다.
 */
test("⚠날짜 순서가 뒤바뀐 페이지에서도 기준선은 가장 이른 내용 행이다 — 그 뒤 잘림을 놓치지 않는다", async () => {
  await withArchive(async ({ games, run, db }) => {
    const blank = (d: number): string => `<tr id="date03${String(d).padStart(2, "0")}" class=""><th>3/${d}</th><td>&nbsp;</td><td>&nbsp;</td></tr>`;
    // 3/1 공백 · 3/5 경기(문서상 먼저) · 3/2 경기(문서상 나중) · 나머지 공백
    let body = blank(1) + row("0305", "巨人", "阪神", "東京ドーム", "18:00") + row("0302", "阪神", "巨人", "甲子園", "18:00");
    for (let d = 3; d <= 31; d++) if (d !== 5) body += blank(d);
    await writeMonth(games, "03", body, "2026-02-20T00:44:00.000Z");
    assert.equal(run().code, 0);
    const d1 = db();
    try {
      const m = d1.raw.prepare("SELECT first_content c FROM schedule_month WHERE month = 3").get() as unknown as { c: string };
      assert.equal(m.c, "2026-03-02", "문서 순서의 첫 내용 행을 기준선으로 썼다 — 날짜 순서의 첫 내용 행이어야 한다");
    } finally {
      d1.close();
    }
    let truncated = row("0305", "巨人", "阪神", "東京ドーム", "18:00");
    for (let d = 6; d <= 31; d++) truncated += blank(d);
    await writeMonth(games, "03", truncated, "2026-03-06T00:44:00.000Z");
    assert.equal(run().code, 1, "3/2 경기까지 잘린 사본을 받았다 — 기준선이 너무 늦었다");
  });
});

/**
 * ⚠**기준선은 그 달의 내용 행만 본다**(5라운드 재검토 2차 M18 — 월 필터를 지워도 통과하던 생존 뮤턴트).
 * 한 달 파일에 다른 달 날짜 행이 섞이면 그 날의 「일」이 그 달 기준선이 될 수 있다(`0901` → `2026-10-01`).
 */
test("⚠기준선은 그 달의 내용 행만 본다 — 파일에 섞인 다른 달 날짜 행은 기준선이 아니다", async () => {
  await withArchive(async ({ games, run, db }) => {
    let body = row("0901", "巨人", "阪神", "東京ドーム", "18:00"); // 10월 파일에 섞인 9/1(링크 없음)
    for (let d = 1; d <= 4; d++) body += `<tr id="date10${String(d).padStart(2, "0")}" class=""><th>10/${d}</th><td>&nbsp;</td><td>&nbsp;</td></tr>`;
    body += row("1005", "阪神", "巨人", "甲子園", "18:00");
    for (let d = 6; d <= 31; d++) body += `<tr id="date10${String(d).padStart(2, "0")}" class=""><th>10/${d}</th><td>&nbsp;</td><td>&nbsp;</td></tr>`;
    await writeMonth(games, "10", body, "2026-09-20T00:44:00.000Z");
    assert.equal(run().code, 0);
    const d = db();
    try {
      const m = d.raw.prepare("SELECT first_content c FROM schedule_month WHERE month = 10").get() as unknown as { c: string };
      assert.equal(m.c, "2026-10-05", "다른 달 날짜 행의 「일」을 그 달 기준선으로 썼다");
    } finally {
      d.close();
    }
  });
});

/**
 * ⚠**기준선 날이 지난 뒤 앞당겨진 사본도 받는다**(4라운드 재검토 2차 F6) — 앞부분이 **늘어난** 것은 잘림이 아니다.
 * ⚠`기준선 < 새 첫 날짜` 를 `기준선 ≠ 새 첫 날짜` 로 바꾸면 이 경우를 멈춘다(생존 뮤턴트였다).
 */
test("⚠기준선 날이 지난 뒤 개막이 앞당겨진 사본도 받는다 — 앞부분이 늘어난 것은 잘림이 아니다", async () => {
  await withArchive(async ({ games, run }) => {
    await writeMonth(games, "03", row("0330", "巨人", "阪神", "東京ドーム", "18:00") + `<tr id="date0331" class=""><th>3/31</th><td>&nbsp;</td><td>&nbsp;</td></tr>`, "2026-03-10T00:44:00.000Z");
    assert.equal(run().code, 0);
    let early = row("0327", "巨人", "阪神", "東京ドーム", "18:00");
    for (let d = 28; d <= 31; d++) early += `<tr id="date03${d}" class=""><th>3/${d}</th><td>&nbsp;</td><td>&nbsp;</td></tr>`;
    await writeMonth(games, "03", early, "2026-03-31T00:44:00.000Z");
    const r = run();
    assert.equal(r.code, 0, `앞부분이 늘어난 사본을 잘린 사본으로 봤다: ${r.err}`);
  });
});

/**
 * ⚠**기준선은 시즌마다 따로다**(4라운드 재검토 2차 F6) — 조회에서 시즌을 빼면 전 시즌 같은 달의 기준선이 새 시즌 개막 달을 멈춘다(생존 뮤턴트였다).
 */
test("⚠기준선은 시즌마다 따로다 — 전 시즌 3월의 기준선이 새 시즌 개막 달을 멈추지 않는다", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bb-upcoming-seasons-"));
  const dbPath = join(dir, "t.sqlite");
  openDb(dbPath, NOW).close();
  const load = async (season: number, body: string, checkedAt: string): Promise<number> => {
    const g = join(dir, "archive", "npb", "games", String(season));
    await mkdir(g, { recursive: true });
    await writeMonth(g, "03", body, checkedAt);
    return spawnSync(process.execPath, [TOOL, join(dir, "archive"), dbPath, String(season)], { encoding: "utf8" }).status ?? 1;
  };
  try {
    const full = padMonth("03", row("0301", "巨人", "阪神", "東京ドーム", "18:00"), 2025);
    assert.equal(await load(2025, full, "2025-02-20T00:44:00.000Z"), 0);
    let opening = row("0327", "巨人", "阪神", "東京ドーム", "18:00");
    for (let d = 28; d <= 31; d++) opening += `<tr id="date03${d}" class=""><th>3/${d}</th><td>&nbsp;</td><td>&nbsp;</td></tr>`;
    assert.equal(await load(2026, opening, "2026-03-20T00:44:00.000Z"), 0, "전 시즌 3월의 기준선(2025-03-01)으로 2026 개막 달을 멈췄다");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
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
