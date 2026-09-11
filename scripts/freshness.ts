#!/usr/bin/env node
/**
 * 데이터 신선도 점검.
 *
 *   node scripts/freshness.ts data/bb.sqlite [유예_일수] [--json ops/collection-log.jsonl]
 *
 * ⚠**~~이것이 이 서비스의 주 감시 장치다~~ 는 낡았다**(2026-09-11 정정).
 * **주 감시는 `.github/workflows/heartbeat.yml` 이다.** 이 파일은 그 **입력을 만드는 한 층**이다.
 *
 * ⚠**두 층이 서로 다른 것을 잡는다 — 섞어 읽지 마라**:
 * | 층 | 잡는 것 | 못 잡는 것 |
 * |---|---|---|
 * | **이 파일**(`collect` 안에서 돈다) | **「돌지만 안 모은다」** — 받았어야 할 경기를 못 받으면 exit 1 → 잡 실패 | **파이프라인이 아예 안 도는 것.** 안 돌면 이 파일도 안 돈다 |
 * | **`heartbeat.yml`**(따로 돈다) | **24시간 안에 `collect` 성공이 없다** — 잡 실패든 실행 부재든 → **메일** | 부분 장애 · 予告 실취득 · 자기 자신의 정지 |
 * → **이 파일이 「조용한 누락」을 「잡 실패」로 바꾸고, 하트비트가 그 실패(또는 부재)를 「메일」로 바꾼다.**
 *
 * ⚠**옛 논거(「제품의 일부인 감시는 만료되지 않는다」)가 틀렸던 이유**: 이 파일은 파이프라인 **안**에서 돈다.
 * 파이프라인이 멈추면 **같이 멈춘다** — 멈춘 것을 멈춘 것이 알릴 수는 없다.
 * 화면의 신선도 띠도 같은 병이었다(빌드 시점 스냅숏이라 정지하면 영원히 초록이다).
 *
 * ## ⚠판정이 바뀌었다 — 「최신 경기가 며칠 전인가」에서 「치렀다고 표시한 경기를 못 받았나」로 (2026-09-11)
 *
 * ~~오프시즌 예외가 없다(`staleDays` 기본 2) — 일본시리즈 뒤 `collect` 가 매일 실패한다~~ 는 해결됐다.
 * 옛 규칙(「최신 경기가 2일보다 오래됐다」)은 **휴식마다** 실패했다 — 보유 완결 8시즌에 시즌 도중 3일 넘게 빈 구간이
 * **23개**(해마다 10월 CS 전후 두 번)였고 오프시즌은 118~240일이다. ⚠**첫 헛경보는 11월이 아니라 10월 초였다.**
 * → 이제 **NPB 공표와 대조한다**: 월간 일정이 「치렀다」(점수 링크)고 표시했는데 받지 못한 경기(A), 일정 사본이 낡았을 때
 *   예고됐는데 받지 못한 구단(B). 휴식·오프시즌엔 그런 표시가 없으므로 **날짜를 박지 않고도** 조용하다.
 * ⚠**판정은 이 파일에 없다** — 증거는 `@bb-app/store` 의 `collectionEvidence`, 판정은 `@bb-app/domain` 의 `collectionVerdict` 한 벌이고
 *   **화면의 신선도 띠·빌드 게이트도 같은 함수**를 쓴다(M1). 여기는 사람이 읽는 설명 · JSONL · 종료 코드만 맡는다.
 * 설계: `docs/superpowers/specs/2026-09-11-offseason-collection-verdict-design.md`
 *
 * 종료 코드: 사유가 하나라도 있으면 1 · 새 표가 없는 DB(마이그레이션 021 미적용)면 2.
 */
import { DatabaseSync } from "node:sqlite";
import { collectionEvidence } from "@bb-app/store";
import { LOOKBACK_DAYS, backstopDays, collectionVerdict } from "@bb-app/domain";

const [dbPath, staleDaysArg] = process.argv.slice(2);
if (!dbPath) {
  console.error("usage: node scripts/freshness.ts <db-path> [grace-days] [--json <path>]");
  process.exit(2);
}
/** ⚠**누락 유예(일)** — 워크플로 인자 2. 화면 띠는 3 이다(감시가 먼저 운다 · `packages/web/test/stale-verdict.test.ts`) */
const staleDays = Number(staleDaysArg ?? "2");

const db = new DatabaseSync(dbPath);

/**
 * ⚠**새 표가 없으면 조용히 틀리지 않고 멈춘다.** 적재기(`openDb`)가 마이그레이션을 적용하므로 정상 흐름(`update.ts`)에서는
 * 늘 있다 — 없으면 적재가 안 돈 DB 를 보고 있는 것이다.
 */
const missingTables = ["schedule_played", "schedule_month", "starters_fetch"].filter((t) =>
  (db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = ?").get(t) as { n: number }).n === 0);
if (missingTables.length > 0) {
  console.error(`⚠수집 판정 증거 표가 없다: ${missingTables.join("·")} — 마이그레이션 021 이 적용되지 않은 DB 다. 적재기를 먼저 돌려라`);
  db.close();
  process.exit(2);
}

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

const evidence = collectionEvidence(db, todayJst);
const verdict = collectionVerdict(evidence, { grace: staleDays, backstopMargin: 0 });
/**
 * **어느 감시가 울렸는가.** ⚠**키는 기계가 읽는다** — 화면 문구는 `log-page.ts` 가 붙이고, 키 목록의 정본은
 * `@bb-app/domain` 의 `STALE_REASON_KEYS` 다(시험이 문구표와 대조한다). 어느 축인지 말하지 않는 경보는
 * 「NPB 가 늦다」 같은 오진을 다시 만든다(2026-08-17 사고).
 */
const staleReasons = verdict.reasons;

console.log(`최신 경기일 ${evidence.latestPlayed ?? "없음"} · 오늘(JST) ${todayJst}`);
console.log(
  `경기 ${counts.games.toLocaleString()} · 타석 ${counts.pa.toLocaleString()} · ` +
    `선수 ${counts.players} (투타 미상 ${counts.noHand}) · 격리 ${counts.quarantine}`,
);

// ── 경기 — 받았어야 할 경기(D1)와 백스톱(D2) ─────────────────────────────
if (staleReasons.includes("no-games")) console.error("⚠경기 데이터가 하나도 없다");
if (verdict.ageDays !== null) {
  console.log(
    `데이터 나이 ${verdict.ageDays}일 · 백스톱 ${verdict.backstop}일(${evidence.latestSeasonOver ? "최신 시즌 종료" : "시즌 중"})`,
  );
}
if (staleReasons.includes("game-missed")) {
  const a = verdict.missedPlayed.map((m) => `${m.date} ${m.awayCode}@${m.homeCode}${m.seq > 0 ? `#${m.seq + 1}` : ""}`);
  const b = verdict.missedAnnounced.map((m) => `${m.date} ${m.teamCode}`);
  /**
   * ⚠**B 는 「발견 경로 고장」과 「사이드카 결손」이 같은 모양으로 운다**(설계 D1 ⑵⑷ · 3중 검토 2차 N2) —
   * 그 달 사본의 마지막 취득 시각을 적어야 사람이 원인을 가른다. **판정이 아니라 보고다**(판정은 증거 SQL 한 벌).
   */
  const monthCopy = db.prepare("SELECT fetched_at AS f FROM schedule_month WHERE season = ? AND month = ?");
  const copies = [...new Set(verdict.missedAnnounced.map((m) => m.date.slice(0, 7)))].sort().map((ym) => {
    const row = monthCopy.get(Number(ym.slice(0, 4)), Number(ym.slice(5, 7))) as { f: string | null } | undefined;
    if (row === undefined) return `${ym} 사본 기록 없음`;
    if (row.f === null) return `${ym} 사본 취득 시각 모름(사이드카 결손 · M4)`;
    return `${ym} 사본 마지막 취득 ${row.f}`;
  });
  console.error(
    `⚠**받았어야 할 경기를 못 받았다** — 가장 이른 날 ${verdict.missedEarliest}(유예 ${staleDays}일).\n` +
      (a.length > 0 ? `   일정표가 치렀다고 표시했는데 경기 행이 없다: ${a.length}경기 — ${a.slice(0, 8).join(" · ")}${a.length > 8 ? " …" : ""}\n` : "") +
      (b.length > 0
        ? `   예고됐는데 받지 못했다(그 달 일정 사본이 그 날 뒤에 안 받아졌다 — 발견 경로 고장 의심): ${b.length}구단분 — ${b.slice(0, 8).join(" · ")}${b.length > 8 ? " …" : ""}\n` +
          `   그 달 일정 사본: ${copies.join(" · ")}\n`
        : "") +
      `   수집이 조용히 멈췄을 수 있다. 이 서비스가 죽는 가장 흔한 방식이다.`,
  );
}
if (staleReasons.includes("game-lag")) {
  console.error(
    `⚠**데이터가 너무 오래됐다(백스톱)** — 최신 경기일이 ${verdict.ageDays}일 전이다` +
      `(허용 ${backstopDays(evidence.latestSeasonOver)}일).\n` +
      `   일정표·수집·予告先発이 **동시에** 조용해졌을 수 있다 — 받았어야 할 경기의 증거가 전부 사라진 상태다.`,
  );
}

// ── 통산 — 기존 규칙 그대로(설계 D10) ────────────────────────────────────
// ⚠요약(취득일 범위 · 모름)도 **증거 SQL 한 벌**에서 온다 — 판정과 같은 「최근 출장자」 범위다(3중 검토 1차 F4 · 2차 N2).
if (evidence.careerPlayers === 0) {
  console.log("통산 기록 없음 — 아직 선수 페이지를 적재하지 않았다");
} else {
  console.log(
    `통산 기록(최근 출장자) ${evidence.careerPlayers}명 · 취득일 ${evidence.careerOldest ?? "?"}〜${evidence.careerNewest ?? "?"}` +
      ` · 취득일 모름 ${evidence.careerUnknown}명 · ` +
      (evidence.careerStalestPlayed === null
        ? "**아직 못 받은 선수 없음**"
        : `아직 못 받은 선수의 마지막 출장 ${evidence.careerStalestPlayed}(${verdict.careerAge}일 전)`),
  );
  if (staleReasons.includes("career-lag")) {
    console.error(
      `⚠**통산 기록이 낡았다** — 아직 못 받은 선수가 ${verdict.careerAge}일 전에 뛰었다` +
        `(허용 ${staleDays + 2}일). 선수 페이지 재취득이 멈췄을 수 있다.\n` +
        `   확인: node packages/store/tools/emit-stale-player-ids.ts ${dbPath} --limit 400`,
    );
  }
  if (evidence.careerUnknown > 0) {
    console.error(
      `⚠취득일을 모르는 선수 ${evidence.careerUnknown}명 — 아카이브 사이드카(*.meta.json)가 없거나 깨졌다.\n` +
        `   화면이 그 선수의 통산에 「取得日は記録がありません」이라고 적는다.`,
    );
  }
}

// ── 予告先発 — 맥박(D3)과 뒤처짐(D4) ───────────────────────────────────
/**
 * ⚠**취득 시각을 모르는 予告先発 행은 맥박에서 빠진다**(설계 D3) — 그래서 따로 센다. 안 세면 사이드카 결손이
 * 「予告先発 수집이 멈췄다」로만 보인다(3중 검토 2차 N2).
 */
const startersUnknown = (db.prepare(
  // ⚠판정 창 안만 센다 — 오래된 「모름」 한 장이 매일 경고를 찍으면 경고가 무시된다(수정분 재검토 2차 Minor)
  "SELECT COUNT(*) AS n FROM starters_fetch WHERE fetched_at IS NULL AND fetched_date >= DATE(?, ?)",
).get(todayJst, `-${LOOKBACK_DAYS} days`) as { n: number }).n;
if (startersUnknown > 0) {
  console.error(`⚠予告先発 취득 시각 모름 ${startersUnknown}장(최근 ${LOOKBACK_DAYS}일) — 사이드카(*.meta.json)가 없거나 깨졌다. 이 행들은 맥박에서 빠진다`);
}
const upcoming = db.prepare(
  `SELECT COUNT(*) AS n, MAX(game_date) AS last,
          MAX(SUBSTR(datetime(fetched_at, '+9 hours'), 1, 10)) AS fetched
     FROM upcoming_game WHERE game_date >= ?`,
).get(todayJst) as { n: number; last: string | null; fetched: string | null };
console.log(
  `앞으로의 일정 ${upcoming.n}件` +
    (upcoming.last === null ? "" : ` · ${upcoming.last} まで · 取得 ${upcoming.fetched ?? "?"}`),
);
const startersDay = db.prepare(`
  SELECT
    (SELECT COUNT(*) FROM probable_pitcher WHERE game_date = (SELECT MAX(game_date) FROM probable_pitcher)) AS teams,
    (SELECT COUNT(*) FROM probable_pitcher WHERE game_date = (SELECT MAX(game_date) FROM probable_pitcher) AND player_id IS NOT NULL) AS named
`).get() as { teams: number; named: number };
if (evidence.startersLatest === null && evidence.startersPulseDate === null) {
  console.log("予告先発 기록 없음");
} else {
  console.log(
    `予告先発 최신 ${evidence.startersLatest ?? "없음"} · 그 날 ${startersDay.teams}팀 중 발표 ${startersDay.named}팀` +
      ` · 다음 경기일 ${evidence.nextGameDay ?? "없음"}` +
      (evidence.nextGameRestDeclared ? "(NPB 휴식 공표)" : "") +
      (evidence.nextGameSeasonOver ? "(그 시즌 종료)" : ""),
  );
  console.log(`  予告先発 마지막 취득 ${evidence.startersPulseDate ?? "?"} (${verdict.startersPulseAge ?? "?"}일 전 · 휴식 공표 페이지 포함)`);
  if (staleReasons.includes("starters-behind")) {
    console.error(
      `⚠**予告先発이 뒤처졌다** — 다음 경기일이 ${evidence.nextGameDay}인데 예고는 ${evidence.startersLatest}까지다.\n` +
        `   이 자료는 **거르면 영영 못 받는다**(페이지가 하루치만 보여준다).`,
    );
  }
  if (staleReasons.includes("starters-lag")) {
    console.error(
      `⚠**予告先発 수집이 멈췄다** — 마지막 취득이 ${verdict.startersPulseAge ?? "알 수 없는 시점"}일 전이다(허용 ${staleDays}일).\n` +
        `   페이지가 하루치만 보여주므로 **거른 날은 영영 못 받는다.**`,
    );
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
 * ⚠**통과한 이유를 남긴다**(설계 D11) — 「경기를 받아서 통과」와 「휴식이라 통과」를 나중에 구별하려고. **종료 코드에 쓰지 않는다.**
 */
const PERIOD_LABEL = { games: "경기 기간", rest: "휴식", offseason: "오프시즌", unknown: "모름" } as const;
console.log(`판정 근거: ${PERIOD_LABEL[verdict.period]} · 사유 ${staleReasons.length === 0 ? "없음" : staleReasons.join(" ")}`);

/**
 * 실행 기록을 **한 줄 JSON**으로 덧붙인다.
 *
 * ⚠**산문 로그를 화면이 파싱하게 만들지 않는다**(M7의 정신). 사람이 읽는 로그는 그대로 두고,
 * 화면이 읽을 것은 처음부터 구조화해서 남긴다.
 * ⚠**경기가 0건인 날과 크론이 안 돈 날은 DB만 봐서는 구별되지 않는다.** 이 기록이 그 둘을 가르는 유일한 근거다.
 * ⚠**`stale` 은 유도값이다** — 이유(`staleReasons`)가 원본이고 이 값이 그 길이에서 나온다. 어긋날 자리가 없다.
 */
const stale = staleReasons.length > 0;

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
      latestGameDate: evidence.latestPlayed,
      games: counts.games,
      pa: counts.pa,
      players: counts.players,
      noHand: counts.noHand,
      quarantine: counts.quarantine,
      // ⚠**통산 신선도도 남긴다** — 이 값이 없어서 「열흘 내내 초록」이었던 것을 나중에 증명할 수 없었다
      careerPlayers: evidence.careerPlayers,
      careerOldest: evidence.careerOldest,
      careerNewest: evidence.careerNewest,
      careerUnknown: evidence.careerUnknown,
      careerStalestPlayed: evidence.careerStalestPlayed,
      startersLatest: evidence.startersLatest,
      // ⚠**2026-09-11 부터 `starters_fetch` 맥박**(휴식 공표 페이지 포함)이다 — 그전 줄은 `probable_pitcher` 의 취득일이었다
      startersFetched: evidence.startersPulseDate,
      startersTeams: startersDay.teams,
      startersNamed: startersDay.named,
      nextGameDay: evidence.nextGameDay,
      // ⚠**2026-09-11 부터** — 통과한 이유 · 받았어야 할 경기의 수(단위가 달라 둘로 둔다)
      period: verdict.period,
      missedPlayed: verdict.missedPlayed.length,
      missedAnnounced: verdict.missedAnnounced.length,
      missedEarliest: verdict.missedEarliest,
      stale,
      // ⚠**어느 축이 울렸는가.** `[]` 는 「울린 감시가 없다」이고, **이 칸이 아예 없는 줄**은
      //   「이유를 안 남기던 시절(2026-08-25 이전)」이다 — 화면이 그 둘을 구별해 말한다(M11)
      staleReasons,
    };
    appendFileSync(path, `${JSON.stringify(record)}\n`, "utf8");
  }
}

db.close();
if (process.exitCode !== 2) process.exitCode = stale ? 1 : 0;
