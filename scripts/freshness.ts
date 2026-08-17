#!/usr/bin/env node
/**
 * 데이터 신선도 점검.
 *
 *   node scripts/freshness.ts data/bb.sqlite [경고_일수]
 *
 * ⚠**이것이 이 서비스의 주 감시 장치다.** 조사에서 무료 외부 감시 3종이 전부 시한부로
 * 판명됐다(Free에 헬스체크 없음 · GH Actions 60일 · healthchecks.io 1년).
 * 그래서 감시를 제품 안에 둔다 — **제품의 일부인 감시는 만료되지 않는다.**
 *
 * 종료 코드: 낡았으면 1. 크론이 그대로 실패로 잡을 수 있다.
 */
import { DatabaseSync } from "node:sqlite";

const [dbPath, staleDaysArg] = process.argv.slice(2);
if (!dbPath) {
  console.error("usage: node scripts/freshness.ts <db-path> [stale-days]");
  process.exit(2);
}
const staleDays = Number(staleDaysArg ?? "2");

const db = new DatabaseSync(dbPath);

const latest = db.prepare(
  "SELECT MAX(game_date) AS d FROM game WHERE status = 'played'",
).get() as { d: string | null };

const counts = db.prepare(`
  SELECT
    (SELECT COUNT(*) FROM game WHERE status='played') AS games,
    (SELECT COUNT(*) FROM pa_event) AS pa,
    (SELECT COUNT(*) FROM player) AS players,
    (SELECT COUNT(*) FROM player WHERE throws IS NULL OR bats IS NULL) AS noHand,
    (SELECT COUNT(*) FROM quarantine) AS quarantine
`).get() as { games: number; pa: number; players: number; noHand: number; quarantine: number };

// JST 기준 오늘. 경기일은 JST로만 의미가 있다.
const nowJst = new Date(Date.now() + 9 * 60 * 60 * 1000);
const todayJst = nowJst.toISOString().slice(0, 10);

console.log(`최신 경기일 ${latest.d ?? "없음"} · 오늘(JST) ${todayJst}`);
console.log(
  `경기 ${counts.games.toLocaleString()} · 타석 ${counts.pa.toLocaleString()} · ` +
    `선수 ${counts.players} (투타 미상 ${counts.noHand}) · 격리 ${counts.quarantine}`,
);

let stale = false;
if (latest.d === null) {
  console.error("⚠경기 데이터가 하나도 없다");
  stale = true;
} else {
  const ageDays = Math.floor(
    (Date.parse(`${todayJst}T00:00:00Z`) - Date.parse(`${latest.d}T00:00:00Z`)) / 86_400_000,
  );
  console.log(`데이터 나이 ${ageDays}일`);
  if (ageDays > staleDays) {
    console.error(
      `⚠**데이터가 낡았다** — 최신 경기일이 ${ageDays}일 전이다(허용 ${staleDays}일).\n` +
        `   수집이 조용히 멈췄을 수 있다. 이 서비스가 죽는 가장 흔한 방식이다.`,
    );
    stale = true;
  }
}

/**
 * **통산 기록이 며칠 낡았는가.**
 *
 * ⚠**이것이 없어서 사고가 났다**(2026-08-17). 선수 페이지를 8/15에 받고 다시 안 받았는데
 * 이 감시는 `MAX(game_date)` 만 보고 있어서 열흘 내내 「데이터 나이 1일」로 초록이었다.
 * 낡은 것은 경기가 아니라 **통산**이었고, 그것을 보는 눈이 아예 없었다.
 * 그 결과 원인을 **남 탓(「NPB 가 늦다」)으로 오진**하고 엉뚱한 처방까지 얹었다.
 *
 * ⚠**재취득이 조용히 멈추는 길은 여럿이다** — 목록 생성 실패 · 상한 잠식 · 404 누적 ·
 * 사이드카 미갱신. 어느 길로 멈춰도 여기서 잡힌다. **원인마다 감시를 두지 않고 결과를 잰다.**
 * ⚠취득 시각이 **NULL 인 선수**(사이드카를 못 읽은 경우)도 「낡음」으로 센다 — 「모른다」는 안전하지 않다(M11).
 *
 * ⚠**최근 출장한 선수만 본다.** 전원을 보면 「NPB 를 떠나 페이지를 받을 수 없는 선수」가
 * 영원히 「낡음」으로 잡혀 감시가 늘 빨갛게 되고, 결국 아무도 안 본다.
 * ⚠**`MAX`(가장 최근)가 아니라 `MIN`(가장 오래된)을 본다.** 한 장만 새로 받아도 초록이 되면
 * 감시가 아니다 — 재취득이 멈추면 **가장 오래된 쪽부터** 밀린다.
 */
const career = db.prepare(`
  WITH appearance AS (
    SELECT b.player_id AS id, MAX(g.game_date) AS last
      FROM batting_line b JOIN game g ON g.game_id = b.game_id
     WHERE g.status = 'played' GROUP BY b.player_id
    UNION ALL
    SELECT t.player_id AS id, MAX(g.game_date) AS last
      FROM pitching_line t JOIN game g ON g.game_id = t.game_id
     WHERE g.status = 'played' GROUP BY t.player_id
  ),
  last_seen AS (SELECT id, MAX(last) AS last FROM appearance GROUP BY id),
  fetched AS (
    SELECT player_id AS id,
           MAX(SUBSTR(datetime(fetched_at, '+9 hours'), 1, 10)) AS day
      FROM (SELECT player_id, fetched_at FROM career_batting
            UNION ALL
            SELECT player_id, fetched_at FROM career_pitching)
     GROUP BY player_id
  )
  SELECT COUNT(*) AS players,
         SUM(f.day IS NULL) AS unknown,
         MIN(f.day) AS oldest,
         MAX(f.day) AS newest,
         /**
          * ⚠**이것이 진짜 지표다** — 「아직 못 받은 선수 중, 가장 오래전에 뛴 사람의 그 경기일」.
          *
          * 「가장 오래된 취득일」로 재면 **헛경보가 난다**: 부상으로 한 달 쉬는 선수는
          * 페이지가 바뀔 리 없어 다시 받지 않는데, 취득일만 계속 늙는다.
          * 반대로 여기 걸리는 선수는 **뛰었는데도 아직 못 받은** 사람이라, 재취득이 멈추면
          * 그 날짜가 하루씩 뒤로 밀린다 — 멈춤을 직접 가리킨다.
          * ⚠재취득이 정상이면 이 값은 **NULL**(대상 0명)이거나 어제다.
          */
         (SELECT MIN(l2.last) FROM last_seen l2
            LEFT JOIN fetched f2 ON f2.id = l2.id
           WHERE (f2.day IS NULL OR f2.day <= l2.last)
             AND l2.last >= (SELECT DATE(MAX(game_date), '-400 days') FROM game WHERE status = 'played')
         ) AS stalestPlayed
    FROM fetched f
    JOIN last_seen l ON l.id = f.id
   WHERE l.last >= (SELECT DATE(MAX(game_date), '-400 days') FROM game WHERE status = 'played')
`).get() as {
  players: number; unknown: number; oldest: string | null; newest: string | null;
  stalestPlayed: string | null;
};

if (career.players === 0) {
  console.log("통산 기록 없음 — 아직 선수 페이지를 적재하지 않았다");
} else {
  /**
   * ⚠**「아직 못 받은 선수가 마지막으로 뛴 날」로 잰다** — 「가장 오래된 취득일」이 아니다.
   * 후자는 부상으로 쉬는 선수 때문에 헛경보가 난다(그 페이지는 바뀔 리 없어 다시 받을 이유가 없다).
   */
  const careerAge = career.stalestPlayed === null
    ? 0
    : Math.floor((Date.parse(`${todayJst}T00:00:00Z`) - Date.parse(`${career.stalestPlayed}T00:00:00Z`)) / 86_400_000);
  console.log(
    `통산 기록(최근 출장자) ${career.players}명 · 취득일 ${career.oldest ?? "?"}〜${career.newest ?? "?"}` +
      ` · 취득일 모름 ${career.unknown}명 · ` +
      (career.stalestPlayed === null
        ? "**아직 못 받은 선수 없음**"
        : `아직 못 받은 선수의 마지막 출장 ${career.stalestPlayed}(${careerAge}일 전)`),
  );
  /**
   * ⚠**경기 데이터보다 넉넉하다.** 선수 페이지는 하루 상한(기본 400명)으로 나눠 받으므로
   * 전원이 같은 날일 수 없고, 긴 중단 뒤에는 따라잡는 데 며칠 걸린다(980명이면 3일).
   * 그래도 **가장 오래된 것**이 이보다 밀리면 재취득이 멈춘 것이다.
   */
  /**
   * ⚠**경기 데이터보다 조금 넉넉하다.** 하루 상한(기본 400명)으로 나눠 받으므로
   * 밀린 몫이 하루이틀 남을 수 있다. 그래도 그 이상 밀리면 재취득이 멈춘 것이다.
   * ⚠**임계를 크게 잡지 않는다** — 이번 사고가 「열흘 내내 아무도 몰랐다」였다.
   */
  const careerStaleDays = staleDays + 2;
  if (careerAge > careerStaleDays) {
    console.error(
      `⚠**통산 기록이 낡았다** — 아직 못 받은 선수가 ${careerAge}일 전에 뛰었다` +
        `(허용 ${careerStaleDays}일). 선수 페이지 재취득이 멈췄을 수 있다.\n` +
        `   확인: node packages/store/tools/emit-stale-player-ids.ts ${dbPath} --limit 400`,
    );
    stale = true;
  }
  if (career.unknown > 0) {
    console.error(
      `⚠취득일을 모르는 선수 ${career.unknown}명 — 아카이브 사이드카(*.meta.json)가 없거나 깨졌다.\n` +
        `   화면이 그 선수의 통산에 「取得日は記録がありません」이라고 적는다.`,
    );
  }
}

/**
 * **予告先発이 따라오고 있는가.**
 *
 * ⚠**이 자료만 「거르면 영영 못 받는다」**(`update.ts`) — 페이지가 하루치만 보여주므로
 * 어제 것을 오늘 받을 방법이 없다. 그런데 감시가 **아예 없었다**(2026-08-17 점검).
 * ⚠**「행이 없다」로 판정하면 안 된다.** 월요일처럼 **경기가 없는 날**이 정상적으로 존재한다
 *   (실측: 2026-08-17은 월요일이라 페이지가 「試合が予定されていません」이었다).
 *   그래서 **일정과 대조**해서 「경기가 있는데 예고가 없다」만 잡는다.
 */
const starters = db.prepare(`
  SELECT
    (SELECT MAX(game_date) FROM probable_pitcher) AS latest,
    (SELECT COUNT(*) FROM probable_pitcher
      WHERE game_date = (SELECT MAX(game_date) FROM probable_pitcher)) AS teams,
    (SELECT COUNT(*) FROM probable_pitcher
      WHERE game_date = (SELECT MAX(game_date) FROM probable_pitcher)
        AND player_id IS NOT NULL) AS named
`).get() as { latest: string | null; teams: number; named: number };

/**
 * 오늘(JST) 이후로 **가장 가까운 경기일**. 없으면 시즌이 끝났거나 일정을 못 받은 것이다.
 *
 * ⚠**`game` 만 보면 이 값은 언제나 「오늘 아니면 없음」이다**(2026-08-18 감사 P3).
 * 일일 배치는 **치러진 경기**만 넣으므로 그 표에는 미래가 한 건도 없다 —
 * 그래서 이 값을 근거로 삼는 아래 검사가 **사실상 죽어 있었다.**
 * 지금은 `upcoming_game`(NPB 공표 예정)이 있으므로 **둘 중 이른 쪽**을 쓴다.
 * ⚠**예정 표가 비어 있어도 동작한다** — 그때는 예전과 같은 값이 나온다(퇴행 없음).
 */
const nextGameDay = (db.prepare(
  `SELECT MIN(d) AS d FROM (
     SELECT MIN(game_date) AS d FROM game WHERE game_date >= ?
     UNION ALL
     SELECT MIN(game_date) FROM upcoming_game WHERE game_date >= ?
   )`,
).get(todayJst, todayJst) as { d: string | null }).d;

/**
 * **앞으로의 일정을 얼마나 들고 있는가.**
 *
 * ⚠**주 감시 장치가 이 표를 전혀 안 보고 있었다**(2026-08-18 감사 P3).
 * 캘린더와 오늘·내일 토글이 이것으로 그려지는데, 비어도 아무도 몰랐다 —
 * 화면에는 「일정을 아직 안 받았다」라고만 뜨고 그것이 정상인지 사고인지 구별되지 않는다(M12).
 * ⚠**월말이 특히 위험하다** — 월간 페이지는 그 달만 담아서, 다음 달을 안 받으면 앞날이 0이 된다.
 */
const upcoming = db.prepare(
  `SELECT COUNT(*) AS n, MAX(game_date) AS last,
          MAX(SUBSTR(datetime(fetched_at, '+9 hours'), 1, 10)) AS fetched
     FROM upcoming_game WHERE game_date >= ?`,
).get(todayJst) as { n: number; last: string | null; fetched: string | null };
console.log(
  `앞으로의 일정 ${upcoming.n}件` +
    (upcoming.last === null ? "" : ` · ${upcoming.last} まで · 取得 ${upcoming.fetched ?? "?"}`),
);
if (upcoming.n === 0) {
  console.error(
    "⚠**앞으로의 일정이 0건이다** — 캘린더와 오늘·내일 토글이 「予定なし」로 그려진다.\n" +
      "   시즌 중이라면 월간 일정 페이지를 못 받았거나 파서가 못 읽은 것이다(§2-2-1).",
  );
}

/**
 * **일정에 기대지 않는 값**: 마지막으로 받은 시각(JST 날짜).
 * ⚠블록 밖에 둔다 — 아래 JSONL 기록이 이 값을 쓴다.
 */
const startersFetched = (db.prepare(
  "SELECT MAX(SUBSTR(datetime(fetched_at, '+9 hours'), 1, 10)) AS d FROM probable_pitcher",
).get() as { d: string | null }).d;

if (starters.latest === null) {
  console.log("予告先発 기록 없음");
} else {
  console.log(
    `予告先発 최신 ${starters.latest} · 그 날 ${starters.teams}팀 중 발표 ${starters.named}팀` +
      ` · 다음 경기일 ${nextGameDay ?? "없음"}`,
  );
  /**
   * ⚠**다음 경기일보다 뒤처져 있으면 수집이 멈춘 것이다.**
   * 예고는 **전날 저녁**에 나오므로, 다음 경기일이 오늘이면 그날치가 이미 있어야 한다.
   * ⚠**다음 경기일이 내일 이후면 아직 안 나왔을 수 있다** — 그건 정상이라 안 잡는다.
   *
   * ⚠**예전에는 이 검사가 사실상 안 돌았다**(2026-08-18 정정). `game` 표에는 미래가 없어서
   * `nextGameDay` 가 언제나 오늘이거나 없음이었다 — CLAUDE.md §2-2-1 의
   * 「받고 있는데 안 읽던 것」이 여기서도 나왔다.
   * 지금은 `nextGameDay` 가 `upcoming_game` 도 보므로 **실제로 앞을 본다.**
   * ⚠그래도 아래 **일정에 기대지 않는 검사**는 남긴다 — 일정 자체를 못 받은 날이 있기 때문이다.
   */
  if (nextGameDay !== null && nextGameDay <= todayJst && starters.latest < nextGameDay) {
    console.error(
      `⚠**予告先発이 뒤처졌다** — 다음 경기일이 ${nextGameDay}인데 예고는 ${starters.latest}까지다.\n` +
        `   이 자료는 **거르면 영영 못 받는다**(페이지가 하루치만 보여준다).`,
    );
    stale = true;
  }
  /**
   * **일정에 기대지 않는 검사**: 마지막으로 받은 시각이 며칠 전인가.
   *
   * ⚠**경기가 없는 날에도 받는다**(페이지 자체는 매일 있다). 그래서 「받은 지 며칠」은
   * 경기 유무와 무관하게 성립하고, **수집이 멈춘 것을 직접 잡는다.**
   * ⚠이것이 위 검사보다 먼저 필요하다 — 위 검사는 미래 일정이 들어와야 비로소 돈다.
   */
  const startersAge = startersFetched === null
    ? null
    : Math.floor((Date.parse(`${todayJst}T00:00:00Z`) - Date.parse(`${startersFetched}T00:00:00Z`)) / 86_400_000);
  console.log(`  予告先発 마지막 취득 ${startersFetched ?? "?"} (${startersAge ?? "?"}일 전)`);
  if (startersAge === null || startersAge > staleDays) {
    console.error(
      `⚠**予告先発 수집이 멈췄다** — 마지막 취득이 ${startersAge ?? "알 수 없는 시점"}일 전이다(허용 ${staleDays}일).\n` +
        `   페이지가 하루치만 보여주므로 **거른 날은 영영 못 받는다.**`,
    );
    stale = true;
  }
}

if (counts.quarantine > 0) {
  console.error(`⚠격리 ${counts.quarantine}건 — 버그가 아니라 판단 요청이다. 원문을 보고 규칙을 정하라`);
  for (const r of db.prepare("SELECT kind, COUNT(*) AS n FROM quarantine GROUP BY kind").all() as {
    kind: string;
    n: number;
  }[]) {
    console.error(`   ${r.kind}: ${r.n}`);
  }
}

/**
 * 실행 기록을 **한 줄 JSON**으로 덧붙인다.
 *
 * ⚠**산문 로그를 화면이 파싱하게 만들지 않는다**(M7의 정신). 사람이 읽는 로그는 그대로 두고,
 * 화면이 읽을 것은 처음부터 구조화해서 남긴다 — 문구를 한 번 다듬는 순간
 * 파서가 조용히 0을 뱉는 길을 만들지 않기 위해서다.
 *
 * ⚠**경기가 0건인 날과 크론이 안 돈 날은 DB만 봐서는 구별되지 않는다.**
 * 이 기록이 그 둘을 가르는 유일한 근거다.
 */
const jsonAt = process.argv.indexOf("--json");
if (jsonAt >= 0) {
  const path = process.argv[jsonAt + 1];
  if (path === undefined) {
    console.error("--json 뒤에 경로가 필요하다");
    process.exitCode = 2;
  } else {
    const { appendFileSync } = await import("node:fs");
    const record = {
      // 실행 시각(UTC). ⚠경기일은 JST, 실행 시각은 UTC — 섞지 않는다
      ranAt: new Date().toISOString(),
      todayJst,
      latestGameDate: latest.d,
      games: counts.games,
      pa: counts.pa,
      players: counts.players,
      noHand: counts.noHand,
      quarantine: counts.quarantine,
      // ⚠**통산 신선도도 남긴다** — 이 값이 없어서 「열흘 내내 초록」이었던 것을 나중에 증명할 수 없었다
      careerPlayers: career.players,
      careerOldest: career.oldest,
      careerNewest: career.newest,
      careerUnknown: career.unknown,
      careerStalestPlayed: career.stalestPlayed,
      startersLatest: starters.latest,
      startersFetched,
      startersTeams: starters.teams,
      startersNamed: starters.named,
      nextGameDay,
      stale,
    };
    appendFileSync(path, `${JSON.stringify(record)}\n`, "utf8");
  }
}

db.close();
process.exitCode = stale ? 1 : 0;
