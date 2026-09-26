#!/usr/bin/env node
/**
 * 일일 갱신 — 수집부터 적재까지 한 번에.
 *
 *   node scripts/update.ts --contact <닿는-연락처>
 *   node scripts/update.ts --contact <닿는-연락처> --date 2026-08-16
 *
 * 하는 일:
 *   1. 그날 경기 페이지를 아카이브 (없으면 조용히 0건)
 *   2. 아카이브 → DB 적재 (멱등)
 *   3. 새로 등장한 선수의 프로필을 아카이브하고 적재
 *   4. **앞으로의 일정**을 적재 — 이미 받아 둔 월간 일정 페이지를 읽기만 한다(외부 요청 0회)
 *   5. 予告先発(선발 예고)을 아카이브하고 적재 — 경기 **전** 정보라 「오늘의 매치업」의 근거가 된다
 *   6. **신선도 보고** — 마지막 경기일이 언제인지, 며칠 전인지
 *
 * ⚠**「돌았다」가 아니라 「몇 건을 언제까지 넣었는가」를 보고한다.** 크론이 조용히
 * 안 도는 것이 이 서비스의 가장 흔한 죽음이고, 그건 성공 로그로는 구별되지 않는다.
 */
import { parseArgs } from "node:util";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
// ⚠**잎 서브패스로 가져온다**(I1) — store 배럴이면 parser·domain 까지 평가돼 무관한 로드 오류가 수집을 시작 전에 죽인다
import { gameFromBoxPath } from "@bb-app/store/game-slug";
import { JST_TODAY_FROM_HOUR, MAX_CATCHUP_DAYS, jstDate, parseRefetchDates, sinceStatus, targetDates } from "./date-window.ts";
import type { SinceStatus } from "./date-window.ts";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const { values } = parseArgs({
  options: {
    contact: { type: "string" },
    date: { type: "string" },
    archive: { type: "string", default: "data/archive" },
    db: { type: "string", default: "data/bb.sqlite" },
    /**
     * 적재 1회의 쓰기 상한.
     *
     * ⚠**기본값을 둔다**(2026-08-18 감사 P2). 없으면 로더 기본값(D1 무료 한도 10만 행)이 쓰이는데,
     * 이 도구는 **아카이브 전체를 재적재**하므로 9시즌이면 86만 행이다 —
     * 문서에 적힌 사용례(`node scripts/update.ts --contact …`)가 **매번 도중에 멈춘다.**
     * 예전에는 그때도 종료 코드가 0이라 「정상 종료」로 보고됐다(그쪽도 같이 고쳤다).
     * ⚠**D1 로 옮기면 이 값을 다시 봐라** — 지금은 파일 SQLite 라 한도가 없다.
     */
    "max-writes": { type: "string", default: "5000000" },
    delay: { type: "string", default: "3000" },
    /**
     * **누락 유예(일)** — 받았어야 할 경기를 그 날에서 며칠 지나도 못 받으면 경고할지(`scripts/freshness.ts`).
     * ⚠**2026-09-11 에 뜻이 바뀌었다** — 「최신 경기가 며칠 전인가」의 임계였는데, 그 규칙은 휴식마다 수집 잡을 실패시켰다.
     */
    "stale-days": { type: "string", default: "2" },
    /**
     * 하루에 다시 받을 선수 페이지 수의 상한.
     *
     * ⚠**상한이 있어야 한다.** 「전원이 낡은」 날이 실재한다(백필 직후·장기 중단 후) —
     * 그날 980요청을 한 번에 보내면 L1 의 정신에서 벗어난다.
     * ⚠**기본 400은 실측 기반이다**(2026-08-20 갱신 · CI DB 실측):
     * 하루에 낡는 선수는 **264명**이고 3초 간격이면 약 13분이다.
     * ⚠**「어제 뛴 선수」(약 190명)가 아니라 「최근 두 경기일에 뛴 선수」(267명)가 분모다** —
     * npb.jp 선수 페이지가 경기 다음날 02:00 JST 에도 아직 그 경기를 안 싣기 때문에
     * (실측: 08-19 01:05 JST 취득분이 08-18 경기를 안 담았다) **한 경기일당 두 번 받아야** 실린다.
     * 밀린 몫은 다음 날 받는다 — 넘친 수는 로그에 낸다(조용히 자르지 않는다).
     */
    "player-limit": { type: "string", default: "400" },
    /**
     * 오늘 경기를 **지금** 받는다(시각 판정을 넘긴다).
     *
     * ⚠**손으로 돌릴 때를 위한 것**이지 크론용이 아니다. 크론은 시각으로 판정한다 —
     * 어느 슬롯인지를 워크플로가 인자로 알려 주게 하면, 크론 표현식을 고칠 때
     * **인자를 같이 안 고쳐서** 조용히 어긋난다.
     */
    today: { type: "boolean" },
  },
});

const contact = values.contact ?? process.env["BB_ARCHIVER_CONTACT"] ?? "";
if (!contact) {
  console.error("연락처가 필요하다. --contact <닿는-연락처> 또는 BB_ARCHIVER_CONTACT (CLAUDE.md L1)");
  process.exit(2);
}

/**
 * ⚠**「어제만」이었던 것을 「어제와 오늘」로 넓혔다**(2026-08-18).
 *
 * ## 왜 어제만이었나
 *
 * 진행 중인 경기를 받으면 미확정 성적이 확정으로 저장된다(M9 위반).
 * 「경기가 끝났는가」를 판정할 방법이 없다고 보고, 대신 **구조적으로 안전한 시각**을 썼다 —
 * 자정 이후에 돌리면 어제 경기는 확실히 끝나 있다. 대가는 **경기 결과가 최대 9시간 늦는 것**이었다.
 *
 * ## 왜 바뀌었나
 *
 * ⚠**판정 방법이 실재했다.** 「종료 표시가 없다」는 것은 **일정 페이지 헤더** 얘기였고,
 * **개별 경기의 박스스코어**에는 그 경기 자신의 종료 표시가 있다:
 *
 * ```
 * 【試合終了】 ◇開始 18:00 ◇終了 21:05 ◇試合時間 3時間5分 ◇入場者 31,645人
 * ```
 *
 * 실측(2026-08-18 · 외부 접속 0회 · 아카이브 전수 **9시즌 7,630박스**): 라벨 없는 박스 **0건**.
 * `試合時間` 은 `終了 − 開始` 이라 경기가 끝나기 전에는 존재할 수 없다.
 * 파서가 그것을 보고 **끝나지 않은 박스를 `inProgress` 로 돌려주며**(M9 를 타입으로 지킨다),
 * 적재는 그것을 **저장하지 않는다.** 그래서 오늘 것을 받아도 잠정값이 섞이지 않는다.
 *
 * ⚠**날짜를 명시하면 그 하루만 받는다** — 소급 수집·재수집의 어법을 바꾸지 않는다.
 * ⚠**어제를 계속 받는 이유**: 연장·서스펜디드·늦게 끝난 경기가 있으면 그날 밤 실행이
 *   `inProgress` 로 건너뛴다. 다음 실행이 그것을 메운다. **거르면 영영 안 들어온다.**
 * ⚠~~**요청이 두 배가 되지 않는다**(L7): 어제 경기는 이미 받아 둔 것이라 조건부 요청으로 304 가 돌아온다~~ 는 **틀렸다**
 *   (2026-09-26 · C10 설계 콜드 리뷰 ⑤) — npb.jp 는 검증자를 안 줘서 **매번 200 전체 본문**이다(`scripts/date-window.ts` 의 같은 정정).
 *
 * ⚠**판정 자체는 `scripts/date-window.ts` 한 벌**이고 **거기에 시험이 붙어 있다.**
 * 여기 두면 이 파일이 import 하는 순간 수집을 시작해서 시험할 수가 없다 —
 * 실제로 그래서 이 판단이 한 번도 검증된 적이 없었다(2026-08-18).
 */
/**
 * 이미 받아 둔 **마지막 경기일**(`since`)과 **그날이 덜 받혔는가** — 따라잡기의 기준점.
 *
 * ⚠**모르면 넘기지 않는다**(M11). DB 가 아직 없거나(첫 실행) 읽지 못하면 `undefined` 이고,
 * 그러면 창은 예전과 같은 `[어제]` 다. **모르는 것을 「어제」로 메우면 빈 날이 있어도 안 메운다.**
 * ⚠**읽기 실패를 삼키지 않되 멈추지도 않는다** — 수집 자체는 DB 없이도 성립하고(아카이브가 먼저다),
 * 여기서 죽으면 **DB 가 깨진 날 수집까지 같이 멈춘다.** 그건 되돌릴 수 없는 쪽이다.
 *
 * ## ⚠덜 받은 마지막 경기일 (2026-09-26 · 감사 C10 · 설계 `docs/superpowers/specs/2026-09-26-catchup-partial-day-design.md`)
 *
 * 적재기는 끝나지 않은 경기(`inProgress`)를 **행 없이** 건너뛴다. 23:30 실행이 D 의 끝난 경기만 저장하고 D+1 의 실행이
 * 전부 실패하면 `since` 가 D 에 머물고 창은 D+1 부터라 **D 의 그 경기는 영영 안 받혔다.** 그래서 `since` 하나만 본다 —
 * 그날 **아카이브에 경기 폴더는 있는데 DB 에 행이 없는** 경기가 있으면 `incomplete` 이고, 부르는 쪽이 `includeSince` 로 D 를 다시 받는다.
 * ⚠**읽는 순서를 고정한다**(D3): ① **DB 먼저** — 읽기 전용 연결 하나에서 `MAX(played)` 와 그날의 경기 id(상태 무관)를
 *   **한 트랜잭션**으로 읽는다. ② **그다음 아카이브.** 그 사이 다른 수집이 폴더를 더하면 「덜 받음」 쪽(더 받는 쪽)으로
 *   틀린다 — 빠뜨리는 쪽이 아니다(같은 아카이브에 수집기 둘은 원래 안 돌린다 · 일일 잡은 `concurrency` 로 직렬).
 * ⚠**경기 폴더 판별은 적재기와 한 벌이다**(D2 · M1) — `box.html.gz` 가 있고 잎 `gameFromBoxPath` 를 통과한 것만 센다.
 * ⚠**못 읽으면 `null`(모름)이지 빈 목록이 아니다**(D1) — 빈 목록으로 두면 그날 경기 **전부**를 「덜 받음」으로 오판한다.
 *   모름이면 넓히지 않고(요청 0 증가 쪽) 무엇을 못 읽었는지 말한다. ⚠**`since` 자체는 지킨다** — 그날 목록만 못 읽었으면
 *   예전 따라잡기(빠진 날 메우기)는 그대로 돈다.
 */
function collectedThrough(): { since: string; verdict: SinceStatus } | undefined {
  // ⚠`resolve` 다 — 자식 프로세스가 `cwd: ROOT` 로 같은 인자를 푸는 것과 같게(절대경로를 줘도 맞다)
  const path = resolve(ROOT, values.db);
  if (!existsSync(path)) {
    console.log(`  · ${values.db} 가 아직 없다 — 따라잡기 없이 어제만 받는다`);
    return undefined;
  }

  // ① DB 먼저 — 한 트랜잭션에서 마지막 경기일과 그날의 경기 id(상태 무관 — 미성립도 행이다)
  let since: string | undefined;
  let loaded: string[] | null = null;
  let loadedError = "";
  try {
    const db = new DatabaseSync(path, { readOnly: true });
    try {
      db.exec("BEGIN");
      const row = db.prepare("SELECT MAX(game_date) AS d FROM game WHERE status = 'played'").get() as
        | { d: string | null }
        | undefined;
      since = row?.d ?? undefined;
      if (since !== undefined) {
        try {
          const rows = db.prepare("SELECT game_id AS id FROM game WHERE game_date = ?").all(since) as { id: string }[];
          loaded = rows.map((r) => r.id);
        } catch (e) {
          loadedError = String(e);
        }
      }
      db.exec("COMMIT");
    } finally {
      db.close();
    }
  } catch (e) {
    console.error(`  ⚠마지막 경기일을 못 읽었다(${String(e)}) — 따라잡기 없이 어제만 받는다`);
    return undefined;
  }
  if (since === undefined) return undefined;

  // ② 그다음 아카이브 — 그날 폴더에서 적재기가 경기로 보는 것만(D2)
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(since);
  const dayDir = m === null ? null : resolve(ROOT, values.archive, "npb", "scores", m[1]!, `${m[2]}${m[3]}`);
  let archived: string[] | null = [];
  let archivedError = "";
  if (dayDir === null) {
    // ⚠적재기는 경로에서 `YYYY-MM-DD` 만 만든다 — 아니면 모르는 모양이다(M7 · 빈 목록으로 두지 않는다)
    archived = null;
    archivedError = `마지막 경기일이 YYYY-MM-DD 가 아니다: ${JSON.stringify(since)}`;
  } else {
    try {
      for (const e of readdirSync(dayDir, { withFileTypes: true })) {
        if (!e.isDirectory()) continue;
        const box = join(dayDir, e.name, "box.html.gz");
        if (!existsSync(box)) continue;
        const g = gameFromBoxPath(box);
        if (g !== null) archived.push(g.gameId);
      }
    } catch (e) {
      // ⚠그날 폴더가 **없으면** 받아 둔 경기가 0 이다(아카이브가 지워진 경우 — 설계 D1 「완결」). 그 밖의 오류는 모름이다
      if ((e as { code?: unknown }).code !== "ENOENT") {
        archived = null;
        archivedError = String(e);
      }
    }
  }

  const verdict = sinceStatus(archived, loaded);
  if (verdict.status === "unknown") {
    const unread = [
      ...(loaded === null ? [`DB 의 그날 경기 목록(${loadedError})`] : []),
      ...(archived === null ? [`아카이브의 그날 폴더 ${dayDir ?? "(경로 없음)"}(${archivedError})`] : []),
    ];
    console.error(
      `  ⚠마지막 경기일 ${since} 이 덜 받혔는지 모른다 — ${unread.join(" · ")} 를 못 읽었다. ` +
        "그날을 다시 받지는 않는다(빠진 날 메우기는 그대로)",
    );
  }
  return { since, verdict };
}

/**
 * ⚠**재수집 입력**(수동 실행 `refetch_dates` → `BB_REFETCH_DATES` · 설계 D4). 옛 판·세트·본문 불일치로 적재가
 * 실패했을 때 **그 날짜만** 다시 받는다. 틀리면 아무것도 받지 않고 멈춘다(종료 2).
 */
const refetch = parseRefetchDates(process.env["BB_REFETCH_DATES"]);
if (!refetch.ok) {
  console.error(`BB_REFETCH_DATES 가 틀렸다 — ${refetch.error}. 아무것도 받지 않는다`);
  process.exit(2);
}
if (refetch.dates !== null && values.date !== undefined) {
  console.error("--date 와 BB_REFETCH_DATES 를 같이 줄 수 없다 — 하나만 줘라");
  process.exit(2);
}
if (refetch.dates !== null && values.today === true) {
  console.error("--today 와 BB_REFETCH_DATES 를 같이 줄 수 없다 — 하나만 줘라");
  process.exit(2);
}

// ⚠**재수집·`--date` 면 판정하지 않는다**(C10 설계 D6) — 그때 창은 주어진 날짜뿐이라 기준점이 필요 없다
const collected = values.date === undefined && refetch.dates === null ? collectedThrough() : undefined;
const since = collected?.since;
// ⚠**시계는 여기서 한 번 읽는다**(M6 · 진입점) — 수집 창과 「앞으로의 일정」 시즌(4단계)이 같은 「지금」을 본다
const now = new Date();
const dates = refetch.dates ?? targetDates(now, {
  ...(values.date === undefined ? {} : { date: values.date }),
  ...(values.today === true ? { forceToday: true } : {}),
  ...(since === undefined ? {} : { collectedThrough: since }),
  // ⚠**덜 받았다고 확인됐을 때만**(C10 D4) — 완결·모름이면 안 넘긴다. 안 넘기면 창은 예전과 글자까지 같다(정상·휴식일 요청 0 증가)
  ...(collected?.verdict.status === "incomplete" ? { includeSince: true } : {}),
});
console.log(
  `대상 경기일 ${dates.join(" · ")}` +
    (refetch.dates !== null
      ? " (재수집 · BB_REFETCH_DATES)"
      : values.date !== undefined
        ? ""
        // ⚠**「오늘이 들었는가」로 가른다 — 날짜 수로 가르지 않는다**(2026-09-26 · C10 구현 보고).
        //   `dates.length > 1` 로 가르면 아침의 따라잡기 창(`[D, 어제]`)에도 「어제와 오늘」이라고 말한다 —
        //   C10 의 includeSince 로 그런 창이 더 자주 생긴다.
        : dates.at(-1) === jstDate(now)
          ? " (오늘 JST 까지 · 끝나지 않은 경기는 저장하지 않는다)"
          : ` (어제 JST 까지 · 오늘 것은 ${JST_TODAY_FROM_HOUR}시 이후 실행에서 받는다)`),
);
// ⚠**기준점을 말한다.** 창이 조용히 넓어지면 「왜 오늘 요청이 많지」에 아무도 답할 수 없다.
//   위 「대상 경기일」 줄과 나란히 읽으면 넓어졌는지가 그 자리에서 보인다.
if (since !== undefined) console.log(`  · 마지막으로 받아 둔 경기일 ${since}`);
// ⚠**덜 받은 날을 말한다**(C10 D5) — 창에 since 가 왜 다시 들어왔는지, 또는 왜 못 들어왔는지
if (collected?.verdict.status === "incomplete") {
  const { since: d, verdict } = collected;
  if (dates.includes(d)) {
    console.log(`  · 마지막 경기일 ${d} 에 저장 안 된 경기 ${verdict.missing}건 — ${d} 도 다시 받는다`);
  } else {
    // ⚠조용히 넘기지 않는다 — 창 밖이면 자동으로는 안 받힌다. 사람이 할 일을 적는다
    console.error(
      `  ⚠마지막 경기일 ${d} 에 저장 안 된 경기 ${verdict.missing}건 — 이번 창에 없다(` +
        (d > jstDate(now, -1)
          ? `오늘 이후 날짜라 ${JST_TODAY_FROM_HOUR}시 이후 실행이 받는다`
          : `간격이 따라잡기 상한 ${MAX_CATCHUP_DAYS}일을 넘었다 · 백필은 사람의 일: --date ${d}`) +
        ")",
    );
  }
}

function run(label: string, args: string[]): number {
  console.log(`\n── ${label} ──`);
  const r = spawnSync(process.execPath, args, { cwd: ROOT, stdio: "inherit" });
  if (r.status !== 0) console.error(`  ⚠${label} 종료 코드 ${r.status}`);
  return r.status ?? 1;
}

let failures = 0;

// 1. 경기 페이지
// ⚠**날짜마다 따로 센다.** 한 날이 실패해도 다른 날은 받는다 — 부분 실패를 전체 실패로 만들지 않는다
for (const d of dates) {
  failures += run(`경기 아카이브 ${d}`, [
    "packages/archiver/src/cli.ts",
    "--date", d,
    "--out", values.archive,
    "--contact", contact,
    "--delay", values.delay,
  ]) === 0 ? 0 : 1;
}

// 2. 적재
failures += run("DB 적재", [
  "packages/store/tools/load-archive.ts",
  values.archive,
  values.db,
  ...(values["max-writes"] === undefined ? [] : ["--max-writes", values["max-writes"]]),
]) === 0 ? 0 : 1;

/**
 * 3. 선수 프로필.
 *
 * ⚠**두 단계다. 순서가 중요하다.**
 * 3-1) **낡은 페이지를 다시 받는다**(`--refresh`). 여기가 통산 기록의 신선도를 지키는 자리다.
 * 3-2) 그 다음 **아직 한 번도 못 받은 페이지**를 받는다(기존 파일은 건너뛴다).
 *
 * ⚠**3-1 이 없어서 통산이 조용히 낡았다**(2026-08-17). 아카이버는 `skipExisting` 이 기본이라
 * 한 번 받은 선수 페이지를 **다시 받지 않았다** — 실측 당시 698장이 8/15에 멈춰 있었고
 * 이미 안타 213·홈런 25가 밀려 있었다. 화면은 그것을 **「NPB 가 늦다」고 오진**했다.
 * ⚠**그리고 3-1 의 선정식 자체가 절반만 들었다**(2026-08-20). 날짜로 판정하던 때는
 * 「출장 다음날에 받았지만 그 경기가 아직 안 실린 사본」을 최신으로 봤고, 그 선수가 그 뒤로
 * 안 뛰면 **영영 안 고쳐졌다**(실측 1,643명 중 264명). 지금은 **사본의 출장량을 우리 집계와
 * 맞대서** 판정한다 — 자세한 근거는 `emit-stale-player-ids.ts` 머리주석.
 * ⚠**순서를 바꾸면 같은 선수를 하루에 두 번 받는다**(L1) — 3-1 이 먼저 받아 두면
 * 3-2 의 `skipExisting` 이 그것을 건너뛴다.
 */
const staleFile = join(ROOT, "data", "stale-player-ids.txt");
const stale = spawnSync(
  process.execPath,
  ["packages/store/tools/emit-stale-player-ids.ts", values.db, "--limit", values["player-limit"]],
  { cwd: ROOT, encoding: "utf8" },
);
if (stale.stderr) console.log(`  낡은 선수 페이지: ${stale.stderr.trim()}`);
if (stale.status === 0 && stale.stdout.trim() !== "") {
  const { writeFileSync } = await import("node:fs");
  writeFileSync(staleFile, stale.stdout, "utf8");
  failures += run("낡은 선수 프로필 재취득", [
    "packages/archiver/src/cli-players.ts",
    "--ids", staleFile,
    "--out", values.archive,
    "--contact", contact,
    "--delay", values.delay,
    "--refresh",
  ]) === 0 ? 0 : 1;
} else if (stale.status !== 0) {
  console.error("낡은 선수 목록을 만들지 못했다 — 재취득을 건너뛴다");
  failures += 1;
}

const idsFile = join(ROOT, "data", "player-ids.txt");
const emit = spawnSync(process.execPath, ["packages/store/tools/emit-player-ids.ts", values.db], {
  cwd: ROOT,
  encoding: "utf8",
});
if (emit.status === 0 && emit.stdout) {
  const { writeFileSync } = await import("node:fs");
  writeFileSync(idsFile, emit.stdout, "utf8");
  failures += run("신규 선수 프로필", [
    "packages/archiver/src/cli-players.ts",
    "--ids", idsFile,
    "--out", values.archive,
    "--contact", contact,
    "--delay", values.delay,
  ]) === 0 ? 0 : 1;
  failures += run("선수 프로필 적재", [
    "packages/store/tools/load-players.ts",
    values.archive,
    values.db,
  ]) === 0 ? 0 : 1;
} else {
  console.error("선수 ID 목록을 만들지 못했다 — 프로필 갱신을 건너뛴다");
  failures += 1;
}

/**
 * 4. 앞으로의 일정.
 *
 * ⚠**외부 요청 0회다** — 경기 아카이버가 대상 날짜의 달을 받으면서 **월 단위로 통째** 저장해
 * 두었고, 이 단계는 그걸 읽기만 한다(§2-2-1 「받고 있는데 안 읽던 것」).
 * ⚠**경기 적재 뒤에 둔다** — 치러진 경기가 먼저 들어와야 일정에서 빠질 것이 정해진다.
 * ⚠**시즌은 대상 날짜에서 낸다** — 위에서 한 번 읽은 `now` 말고 시계를 다시 읽지 않는다(M6).
 * ⚠**재수집(`BB_REFETCH_DATES`)일 때는 JST 의 올해다**(2026-09-26 · 3중 검토 1차 P3 · 2차 F4).
 *   재수집 날짜는 **지난** 날짜이고 작년일 수도 있다 — 그 해를 쓰면 이번 실행은 **올해의 앞으로의 일정**을 건너뛴다.
 *   (재수집 실행은 올해 달의 일정 페이지를 새로 받지 않는다 — 앞선 정시 실행이 받아 둔 것을 읽는다.)
 *   `scripts/test/refetch-wiring.test.ts` 가 이 갈래를 지킨다.
 */
const upcomingSeason = refetch.dates !== null ? jstDate(now).slice(0, 4) :
  // ⚠**가장 늦은 대상일의 해**를 쓴다. 연말에 어제와 오늘의 해가 갈릴 수 있다
  dates[dates.length - 1]!.slice(0, 4);
failures += run("앞으로의 일정 적재", [
  "packages/store/tools/load-upcoming.ts",
  values.archive,
  values.db,
  upcomingSeason,
]) === 0 ? 0 : 1;

// 5. 予告先発 — 하루 1요청. ⚠거르면 그날 예고는 영영 못 받는다(페이지가 하루치만 보여준다)
failures += run("予告先発 아카이브", [
  "packages/archiver/src/cli-starters.ts",
  "--out", values.archive,
  "--contact", contact,
  "--delay", values.delay,
]) === 0 ? 0 : 1;
failures += run("予告先発 적재", [
  "packages/store/tools/load-starters.ts",
  values.archive,
  values.db,
]) === 0 ? 0 : 1;

// 6. 신선도 보고
console.log(`\n── 신선도 ──`);
const freshness = spawnSync(
  process.execPath,
  ["scripts/freshness.ts", values.db, values["stale-days"]!],
  { cwd: ROOT, stdio: "inherit" },
);
if (freshness.status !== 0) failures += 1;

console.log(`\n${failures === 0 ? "정상 종료" : `⚠실패 단계 ${failures}건`}`);
process.exitCode = failures > 0 ? 1 : 0;
