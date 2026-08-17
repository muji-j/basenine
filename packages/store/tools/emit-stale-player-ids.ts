/**
 * **다시 받아야 할 선수**만 내보낸다. 선수 페이지 아카이버의 입력이 된다.
 *
 *   node packages/store/tools/emit-stale-player-ids.ts data/bb.sqlite > data/stale-ids.txt
 *
 * ⚠**이것이 없어서 통산 기록이 조용히 낡았다**(2026-08-17).
 * 선수 페이지 아카이버는 `skipExisting` 이 기본이라 **한 번 받은 페이지를 다시 받지 않는다.**
 * 그래서 `career_batting` 의 올해 행이 최초 취득 시점에 얼어 있었다 —
 * 실측 당시 698장이 8/15, 3장이 8/16, 그 뒤로 0장이었고, 이미 안타 213·홈런 25가 밀려 있었다.
 * 더 나쁜 것은 **시즌이 바뀌는 순간** 그 얼어붙은 행이 그대로 「확정된 작년 성적」이 되어
 * 전 선수의 통산이 **한 번에 줄어든다**는 것이다.
 *
 * ⚠**전원 재취득은 하지 않는다**(L1). 980명을 매일 받으면 3초 간격으로 약 50분이고,
 * 그중 대부분은 **어차피 안 바뀐 페이지**다. 선수의 年度別成績은 **그 선수가 나온 날에만** 변한다.
 * 그래서 「마지막 출장일 > 페이지를 받은 날」인 선수만 고른다.
 * ⚠`lastModified`·`etag` 가 둘 다 `null` 이라 조건부 요청(L7)으로는 줄일 수 없다 —
 * 실측으로 확인했다(아카이브 meta.json). 줄일 수 있는 지렛대는 **대상 선정**뿐이다.
 *
 * ⚠**취득 시각을 모르는 선수(`fetched_at` 결손)는 대상에 넣는다.** 「모른다」를 「최신」으로
 * 취급하면 영영 안 받는다(M11).
 */
import { openDb } from "../src/db.ts";

const dbPath = process.argv[2];
if (!dbPath) {
  console.error("usage: node tools/emit-stale-player-ids.ts <db-path> [--limit N]");
  process.exit(2);
}
const limitArg = process.argv.indexOf("--limit");
/**
 * 하루치 상한. ⚠**있어야 한다** — 백필 직후처럼 「전원이 낡은」 날이 실재하고,
 * 그날 980요청을 한 번에 보내면 L1 의 정신(하루 1회 배치 · 저빈도)에서 벗어난다.
 * ⚠**넘친 몫은 반드시 보고한다**(§3-7: 조용한 절단은 「전부 했음」으로 읽힌다).
 */
const limit = limitArg === -1 ? 400 : Number(process.argv[limitArg + 1]);
if (!Number.isInteger(limit) || limit <= 0) {
  console.error(`--limit 이 양의 정수가 아니다: ${process.argv[limitArg + 1]}`);
  process.exit(2);
}

const db = openDb(dbPath, "1970-01-01T00:00:00.000Z");

/**
 * 「마지막 출장일」은 **타격·투구 양쪽**을 본다. 투수는 batting_line 에 안 나오는 경기가 있다.
 * ⚠**대회를 가리지 않는다** — 올스타·포스트시즌에 나와도 선수 페이지는 갱신될 수 있고,
 * 여기서 고르는 것은 「집계 대상」이 아니라 「다시 받을 대상」이다.
 */
const rows = db.raw
  .prepare(
    `WITH appearance AS (
       SELECT b.player_id AS id, MAX(g.game_date) AS last
         FROM batting_line b JOIN game g ON g.game_id = b.game_id
        WHERE g.status = 'played'
        GROUP BY b.player_id
       UNION ALL
       SELECT t.player_id AS id, MAX(g.game_date) AS last
         FROM pitching_line t JOIN game g ON g.game_id = t.game_id
        WHERE g.status = 'played'
        GROUP BY t.player_id
     ),
     last_seen AS (SELECT id, MAX(last) AS last FROM appearance GROUP BY id),
     fetched AS (
       /**
        * JST 로 맞춘다(§2-1). fetched_at 은 ISO UTC 이고 game_date 는 JST 경기일이다.
        * 그냥 앞 10글자를 자르면 JST 00:00~08:59 에 받은 페이지가 하루 이르게 기록된다.
        * 지금 크론은 17:00 UTC(=02:00 JST)라 우연히 안전한 쪽으로만 어긋나지만,
        * 손으로 다른 시각에 돌리면 그 우연이 깨진다 — 우연에 기대지 않는다.
        * fetched_at 이 NULL 이면 datetime() 도 NULL 이다 — 「모른다」가 그대로 흐른다(M11).
        */
       SELECT player_id AS id, MAX(SUBSTR(datetime(fetched_at, '+9 hours'), 1, 10)) AS day
         FROM (SELECT player_id, fetched_at FROM career_batting
               UNION ALL
               SELECT player_id, fetched_at FROM career_pitching)
        GROUP BY player_id
     )
     SELECT p.player_id AS id, l.last AS last, f.day AS day
       FROM player p
       JOIN last_seen l ON l.id = p.player_id
       LEFT JOIN fetched f ON f.id = p.player_id
      /**
       * 최근에 뛴 선수만 본다.
       *
       * ⚠**이 조건이 없으면 「받을 수 없는 선수」가 매일 몫의 앞자리를 먹는다**(2026-08-17 재검토 P1).
       * 실측: 취득 기록이 없는 113명은 전원 **마지막 출장이 2023년**인 NPB 이탈 선수다
       * (2026 출장자 중 통산 행이 없는 사람은 **0명**이다 — 「데뷔 선수」가 아니었다).
       * 선수 페이지는 **현재 등록 선수만** 받을 수 있으므로 이들은 받아도 안 온다.
       * 소급 시즌을 넣을수록 이 무리가 시즌당 100~160명씩 늘어 상한을 통째로 잠식한다.
       * ⚠**그건 백필의 일이지 「신선도 유지」의 일이 아니다.** 여기서는 빼고, 몇 명 뺐는지 로그에 낸다.
       * ⚠**벽시계가 아니라 데이터 기준이다**(M6) — 우리가 가진 마지막 경기일에서 센다.
       */
      WHERE (f.day IS NULL OR f.day <= l.last)
        AND l.last >= (SELECT DATE(MAX(game_date), '-400 days') FROM game WHERE status = 'played')
      ORDER BY l.last DESC, p.player_id`,
  )
  .all() as unknown as { id: string; last: string; day: string | null }[];

/**
 * ⚠**두 무리를 「최근에 뛴 순」 하나로 줄 세운다.**
 *
 * 처음에는 「한 번도 못 받은 선수」에게 **절대 우선**을 줬는데(`ORDER BY (day IS NULL) DESC`),
 * 그 무리가 상한을 넘는 날에는 「받았지만 낡은」 선수가 그날 **한 명도 못 들어간다**
 * (2026-08-17 재검토 P2). 개막 직후처럼 신인이 대거 등록되는 날이 그렇다.
 * ⚠`l.last DESC` 하나로 세우면 두 무리가 **섞여서** 들어가므로 어느 쪽도 굶지 않는다 —
 * 그리고 「가장 최근에 뛴 선수부터」가 곧 「화면에서 가장 눈에 띌 선수부터」다.
 */
for (const r of rows.slice(0, limit)) console.log(r.id);

const never = rows.filter((r) => r.day === null).length;
const sent = rows.slice(0, limit);
const sentNever = sent.filter((r) => r.day === null).length;
/**
 * ⚠**제외한 수도 낸다**(§3-7: 「0건」과 「안 쟀음」을 구별한다).
 * 400일 조건으로 빠진 선수가 몇 명인지 안 보이면, 어느 날 그 무리가 커져도 아무도 모른다.
 */
const excluded = (
  db.raw
    .prepare(
      `WITH appearance AS (
         SELECT b.player_id AS id, MAX(g.game_date) AS last
           FROM batting_line b JOIN game g ON g.game_id = b.game_id
          WHERE g.status = 'played' GROUP BY b.player_id
         UNION ALL
         SELECT t.player_id AS id, MAX(g.game_date) AS last
           FROM pitching_line t JOIN game g ON g.game_id = t.game_id
          WHERE g.status = 'played' GROUP BY t.player_id
       ),
       last_seen AS (SELECT id, MAX(last) AS last FROM appearance GROUP BY id)
       SELECT COUNT(*) AS n FROM player p JOIN last_seen l ON l.id = p.player_id
        WHERE l.last < (SELECT DATE(MAX(game_date), '-400 days') FROM game WHERE status = 'played')`,
    )
    .get() as unknown as { n: number }
).n;
console.error(
  `다시 받을 선수 ${rows.length}명(취득기록 없음 ${never}명) 중 ${sent.length}명 출력` +
    `(그중 취득기록 없음 ${sentNever}명) · 최근 400일 미출장이라 제외 ${excluded}명` +
    // ⚠**밀린 수를 반드시 낸다** — 조용히 자르면 「전부 했음」으로 읽힌다(§3-7)
    (rows.length > limit
      ? ` — ⚠**${rows.length - limit}명이 오늘 몫에서 밀렸다**` +
        `(취득기록 없음 ${never - sentNever}명 포함 · 다음 실행에서 받는다)`
      : ""),
);
db.close();
