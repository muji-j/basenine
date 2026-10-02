/**
 * 외부 대조 — 우리가 계산한 값과 npb.jp 공표값을 맞춰 본다.
 *
 * ⚠**이 도구의 값어치는 「맞았다」가 아니라 「어디가 다른가」에 있다.** 전부 맞으면
 * 한 줄로 끝나야 하고, 다르면 **무엇이 얼마나 다른지 전부** 나와야 한다.
 *
 * ⚠**공표값을 화면에 쓰지 않는다**(L6). 여기서 읽은 수치는 리포트에만 나오고,
 * 사이트가 내보내는 값은 언제나 우리가 계산한 것이다.
 *
 * ⚠**이름으로 짝짓는다** — 공표 성적표에 선수 ID가 없다(2026-08-16 실측).
 * M10이 금지하는 것은 제품의 조인이고 이건 검증 도구다. 다만 짝을 못 정하면
 * **추측하지 않고 미해결로 보고한다.** 잘못 짝지은 대조는 대조를 안 한 것보다 나쁘다.
 *
 * 사용:
 *   node packages/aggregate/tools/crosscheck.ts data/bb.sqlite 2026 [--archive data/archive] [--emit <path>]
 *
 * ## 감지 모드(`--emit <path>`) — 공표 정정 자동 재수집이 부른다
 *
 * 설계 `docs/superpowers/specs/2026-10-02-correction-auto-refetch-design.md` D2·D3. 사람용 출력은 **관문과 같은 것**을 찍고,
 * 결과를 JSON(스키마 1)으로 `<path>` 에 **원자적으로** 쓴다(`<path>.tmp-<pid>` → `rename` · 부르는 쪽이 호출 전에 `<path>` 를 지운다).
 *
 * | | `--emit` 없이(관문 · **불변**) | `--emit` 있음 |
 * |---|---|---|
 * | 측정 성공 · 결함 0 | 종료 0 | 종료 0 · `status: "no_defects"` |
 * | 측정 성공 · 결함 N | 종료 1 | 종료 0 · `status: "defects"` |
 * | 측정 실패(`asof_split`·`table_parse_error`·`tables_missing`·`compared_zero`) | 종료 1 또는 잡히지 않은 예외 | 종료 2 · `status: "unmeasured"` |
 * | 예상 밖 예외 | 0 이 아닌 종료 | 0·2 가 아닌 종료 · JSON 을 약속하지 않는다 |
 *
 * ⚠⚠**`--emit` 없이 부를 때의 출력과 종료코드는 바이트 단위로 그대로다**(사용자 결정 2026-10-02 · 관문 판정 불변).
 *   감지 모드의 갈래는 전부 `emitPath !== undefined` 뒤에 있고, 공표표 해석 실패도 **감지 모드에서만** 잡는다 —
 *   관문은 지금처럼 잡히지 않은 예외로 죽는다. `test/crosscheck-gate-unchanged.test.ts` 가 감지 모드 이전 출력과 바이트로 맞댄다.
 * ⚠**감지 모드는 관문보다 엄격하다** — 공표표가 한 장이라도 빠지면 `tables_missing` 이다(관문은 경고만 하고 넘어간다 · 설계 §7 · 기존 한계).
 * ⚠**`status` 가 `unmeasured` 여도 `defects` 는 이번에 실제로 맞댄 만큼 담는다**(기준일이 갈렸으면 맞대지 않으므로 빈 배열) —
 *   부분 측정이라 부르는 쪽은 그것으로 경기를 받지 않는다(설계 D6 의 관문 2).
 */
import { parseArgs } from "node:util";
import { readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { openDb } from "@bb-app/store";
import { StatsParseError, parseTeamBatting, parseTeamPitching, publishedAsOf } from "@bb-app/parser";
import type { PublishedBatting, PublishedPitching } from "@bb-app/parser";
import { TEAMS } from "@bb-app/domain";
import {
  battingAverage,
  earnedRunAverage,
  onBasePercentage,
  sluggingPercentage,
} from "@bb-app/metrics";
import type { BattingLine, PitchingLine } from "@bb-app/metrics";
// ⚠**판정 규칙은 여기 두지 않는다**(M1) — 시험이 직접 부를 수 있어야 한다
// ⚠**화면이 쓰는 그 이름을 쓴다**(M1) — 기본명은 「지금」의 이름이라 시즌마다 갈린다
import { seasonNameExpr, seasonNameJoin } from "../src/season-name.ts";
import {
  classifyDiff,
  crosscheckEmitExitCode,
  crosscheckEmitStatus,
  crosscheckUnmeasuredReasons,
} from "../src/crosscheck-classify.ts";
import type { CrosscheckDiff as Diff, CrosscheckEmitInput, CrosscheckUnmeasuredReason } from "../src/crosscheck-classify.ts";
// ⚠**범위 조각은 한 벌이다**(M1) — 공표 정정 자동 재수집의 후보 조회가 같은 조각으로 「이 도구가 센 경기」를 다시 찾는다
import { crosscheckScope, crosscheckScopeParams } from "../src/crosscheck-fields.ts";
// ⚠**화면과 같은 반올림을 쓴다.** 두 벌이면 대조가 거짓 경보를 낸다
import { avg3 as webAvg3, dec2 as webDec2 } from "../../web/src/format.ts";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    archive: { type: "string", default: "data/archive" },
    competition: { type: "string", default: "regular" },
    /**
     * ⚠**공표표는 스냅샷이다.** 우리 DB가 그보다 하루라도 앞서면 그날 뛴 선수가 **전부**
     * 불일치로 잡힌다 — 실측(2026-08-17): 기준일을 안 맞추면 「결함 후보 1,253건」이 나온다.
     * 그 상태의 대조 도구는 진짜 결함을 찾는 데 쓸 수 없다. **거짓 경보는 경보를 죽인다.**
     * ⚠**~~주지 않으면 `fetchedAt` 에서 유도한다~~ 는 낡았다**(2026-09-09) —
     * 이제 **공표표가 스스로 적은 기준일**을 읽는다(아래 `publishedThrough`).
     * 이 옵션은 그 문구가 없거나 못 믿을 때 사람이 덮어쓰는 수단으로만 남는다.
     */
    through: { type: "string" },
    verbose: { type: "boolean", default: false },
    /** 감지 모드 — 결과 JSON 을 쓸 경로(머리말 · 설계 D2). 없으면 관문(그대로) */
    emit: { type: "string" },
  },
});
const dbPath = positionals[0] ?? "data/bb.sqlite";
const season = Number(positionals[1] ?? 2026);

/** 감지 모드의 결과 경로. `undefined` 면 관문이다 — **관문 경로의 출력·종료코드는 이 값과 무관하게 그대로다** */
const emitPath = values.emit;
if (emitPath === "") throw new Error("--emit 에 경로가 없다");
/** 기대하는 공표표 장 수 — 12구단 × 타격(`idb1`)·투구(`idp1`) */
const TABLES_EXPECTED = TEAMS.length * 2;

/** 감지 모드에서만 잡아 센 공표표 해석 실패(관문은 잡지 않는다) */
interface ParseFailure {
  table: string;
  message: string;
  detail: string;
}
const parseFailures: ParseFailure[] = [];

/**
 * 공표표가 어느 날까지를 담고 있는가.
 *
 * ⚠⚠**~~취득 시각에서 유도한다~~ 를 버렸다**(2026-09-09). **공표표가 자기 기준일을 스스로 적는다** —
 * `2026年9月7日 現在` 가 진행 중 시즌의 모든 표에 있다(std_* · idb1_* · idp1_* · tmb_* 실측 5장).
 * **받고 있는데 안 읽던 것의 다섯 번째다**(CLAUDE.md §2-2-1).
 *
 * ⚠**옛 규칙이 실제로 배포를 막았다.** 「JST 날짜 − 1일」은 「낮에 받는다」를 전제하는데
 * **자정을 넘겨 받으면 하루를 앞지른다**: 2026-09-08T16:14Z(= JST 09-09 01:14)에 받은 표에서
 * 09-08 을 유도했지만 npb.jp 는 09-07 까지만 공표하고 있었다 →
 * **결함 후보 989건**(전부 정확히 한 경기치, 우리가 앞서 있었다) → `if: success()` 인 배포가 통째로 막혔다.
 * ⚠**크론 지연이 커질수록 이 창에 더 자주 들어간다** — 그래서 규칙을 고치는 쪽이 맞다.
 *
 * ⚠**적혀 있지 않으면 「완결 시즌」이다** — 끝난 시즌 표는 스냅숏이 아니라 확정이라
 * 「◯◯ 現在」라고 적을 것이 없다(2024 표 실측: `現在` 0건). 그때는 **자르지 않는다.**
 * 그 상태에서 우리 DB 가 앞선다면 그건 가정이 아니라 **진짜 불일치**이므로 잡혀야 한다.
 */
function publishedThrough(): {
  date: string;
  from: string;
  /** 기준일(`現在`) 판독 — 날짜 → 그 날짜를 적은 장들. `--through` 면 읽지 않으므로 `null`(감지 모드의 `as_of`·`with_genzai` 가 쓴다) */
  seen: ReadonlyMap<string, readonly string[]> | null;
} {
  if (values.through !== undefined) return { date: values.through, from: "--through", seen: null };

  // ⚠**한 장이 아니라 우리가 읽는 전부에서 읽는다**(2026-09-09 · 2차 검토 F5).
  //   예전에는 idb1_c 한 장만 봤는데, **어차피 아래에서 24장을 전부 파싱한다** — 이미 손에 든 HTML 이다.
  //   그 30장을 받는 데 CI 실측 53초가 걸리고(L1 이 2~5초/장을 요구한다),
  //   npb.jp 가 그 창을 지나며 페이지 단위로 갱신하면 **팀마다 기준일이 갈린다.**
  //   그러면 그 팀 전원이 불일치로 잡혀 **이 수정이 없애려는 바로 그 모양의 거짓 경보**가 난다.
  //   ⚠**원자적으로 갱신된다고 가정하지 않는다 — 안 쟀다.** 대신 갈리면 잡는다.
  const seen = new Map<string, string[]>();
  let read = 0;
  const missing: string[] = [];
  for (const t of TEAMS) {
    for (const kind of ["idb1", "idp1"] as const) {
      const html = readArchived(`npb/stats/${season}/${kind}_${t.code}`);
      if (html === null) {
        missing.push(`${kind}_${t.code}`);
        continue;
      }
      read += 1;
      let asOf: string | null;
      if (emitPath === undefined) {
        // ⚠관문 — 지금처럼 잡지 않는다(한 장 안에 날짜가 둘이면 그대로 죽는다)
        asOf = publishedAsOf(html);
      } else {
        try {
          asOf = publishedAsOf(html);
        } catch (e) {
          if (!(e instanceof StatsParseError)) throw e;
          noteParseFailure(`${kind}_${t.code}`, e);
          continue;
        }
      }
      if (asOf === null) continue;
      seen.set(asOf, [...(seen.get(asOf) ?? []), `${kind}_${t.code}`]);
    }
  }

  if (seen.size > 1) {
    // ⚠**고르지 않는다.** 어느 쪽을 골라도 그 쪽이 아닌 팀 전원이 불일치로 잡힌다
    const detail = [...seen].map(([d, who]) => `${d}(${String(who.length)}장)`).join(" / ");
    console.error(`⚠공표표의 기준일이 장마다 다르다 — ${detail}`);
    console.error("  갱신 중에 받았을 수 있다. 고르면 그쪽이 아닌 팀 전원이 불일치로 잡힌다.");
    if (emitPath !== undefined) {
      // 감지 모드 — 대조하지 않고 「잴 수 없었다(asof_split)」를 쓴다. 갈린 날짜 중 하나를 골라 적지 않는다
      emitAndExit({
        asOf: { date: null, source: "partial" },
        asOfDates: [...seen.keys()],
        tablesRead: read,
        withGenzai: withGenzaiOf(seen),
        missing,
        splitDetail: detail,
        compared: false,
        comparedPlayers: 0,
        comparedFields: 0,
        unmatchedOurs: 0,
        unmatchedPub: 0,
        folded: 0,
        defects: [],
      });
    }
    process.exit(1);
  }
  if (seen.size === 1) {
    const [date, who] = [...seen][0]!;
    return { date, from: `공표표에 적힌 「現在」 · ${String(who.length)}/${String(read)}장 일치`, seen };
  }
  if (read > 0) {
    // ⚠**「완결 시즌」과 「마크업이 바뀌어 못 찾음」을 구별할 수 없다**(2차 검토 F8).
    //   전자면 자를 것이 없는 게 맞고, 후자면 이 판정이 틀렸다. **로그가 둘 다 말해야 한다.**
    //   ⚠그래도 방향은 안전하다 — 안 자르면 **가장 엄격한 비교**가 되어 시끄럽게 끝난다.
    return {
      date: "9999-12-31",
      from: `${String(read)}장 어디에도 기준일이 없다 — 완결 시즌이거나 ⚠문구가 바뀐 것이다. 자르지 않는다`,
      seen,
    };
  }
  return { date: "9999-12-31", from: "⚠공표표를 한 장도 못 읽었다 — 전 기간으로 비교한다", seen };
}
const through = publishedThrough();

/** ⚠시계를 읽지 않는다(M6) — 이 도구는 쓰기를 하지 않으므로 고정값으로 연다 */
const db = openDb(dbPath, `${season}-01-01T00:00:00.000Z`);

function readArchived(key: string): string | null {
  try {
    return gunzipSync(readFileSync(`${values.archive}/${key}.html.gz`)).toString("utf8");
  } catch {
    return null;
  }
}

/**
 * 야구 표기 — **화면과 같은 포맷터를 쓴다**(M1).
 *
 * ⚠여기서 `toFixed`를 따로 쓰면 반올림 규칙이 두 벌이 되어, 화면은 7.43인데 대조는 7.42라고
 * 말하는 상태가 된다 — 대조 도구가 스스로 거짓 경보를 만든다.
 */
function avg3(v: number | null): string {
  return v === null || !Number.isFinite(v) ? "-" : webAvg3(v).replace("—", "-");
}
function dec2(v: number | null): string {
  return v === null || !Number.isFinite(v) ? "-" : webDec2(v).replace("—", "-");
}


const diffs: Diff[] = [];
const unmatchedOurs: string[] = [];
const unmatchedPub: string[] = [];
let comparedPlayers = 0;
let comparedFields = 0;

/**
 * 짝짓기. **완전 일치 → 접두사 유일** 순으로 보고, 그래도 정해지지 않으면 짝짓지 않는다.
 *
 * ⚠**접두사 후보가 둘 이상이면 추측하지 않는다.** 같은 팀에 「佐藤」가 둘 있으면
 * 어느 쪽인지 알 수 없고, 잘못 짝지으면 멀쩡한 값이 「불일치」로 보고된다.
 */
function match<T extends { name: string }>(ourName: string, pub: readonly T[]): T | null {
  const exact = pub.filter((p) => p.name === ourName);
  if (exact.length === 1) return exact[0]!;
  const pre = pub.filter((p) => p.name.startsWith(ourName));
  return pre.length === 1 ? pre[0]! : null;
}

/**
 * ⚠**`playerId` 를 함께 나른다**(설계 D2) — 짝짓기는 이름이지만(공표표에 ID 가 없다) **그 뒤는 ID 로만 간다**(M10).
 * 사람용 출력은 ID 를 찍지 않는다(관문 출력 불변).
 */
function cmp(
  team: string,
  kind: Diff["kind"],
  playerId: string,
  name: string,
  field: string,
  ours: string,
  published: string,
): void {
  comparedFields += 1;
  if (ours !== published) diffs.push({ team, kind, playerId, name, field, ours, published });
}

// ── 타격 ────────────────────────────────────────────────────────────────
// ⚠범위(시즌 · played · 대회 · 기준일 · 그 팀 쪽)는 `crosscheckScope` 한 벌이다 — 값은 `crosscheckScopeParams` 의 차례로 묶는다
const BAT_SQL = `
SELECT b.player_id AS player_id,
       ${seasonNameExpr("p")} AS name,
       COUNT(DISTINCT b.game_id) AS games,
       SUM(b.pa) AS pa, SUM(b.ab) AS ab, SUM(b.runs) AS runs, SUM(b.h) AS h,
       SUM(b.d2) AS d2, SUM(b.d3) AS d3, SUM(b.hr) AS hr, SUM(b.rbi) AS rbi,
       SUM(b.sb) AS sb, SUM(b.sh) AS sh, SUM(b.sf) AS sf,
       SUM(b.bb) AS bb, SUM(b.ibb) AS ibb, SUM(b.hbp) AS hbp, SUM(b.so) AS so
FROM batting_line b
JOIN game g ON g.game_id = b.game_id
JOIN player p ON p.player_id = b.player_id
${seasonNameJoin("b.player_id", "g.season")}
WHERE ${crosscheckScope("b")}
GROUP BY b.player_id
`;

const PIT_SQL = `
SELECT pl.player_id AS player_id,
       ${seasonNameExpr("p")} AS name,
       COUNT(DISTINCT pl.game_id) AS games,
       -- ⚠SUM(x = 'y')는 x가 전부 NULL이면 **NULL을 돌려준다**(0이 아니라).
       -- 결정 표기가 한 번도 없는 투수 79명이 그래서 「불일치」로 잡혔다 — 대조 도구의 버그였다
       SUM(CASE WHEN pl.decision = '○' THEN 1 ELSE 0 END) AS w,
       SUM(CASE WHEN pl.decision = '●' THEN 1 ELSE 0 END) AS l,
       SUM(CASE WHEN pl.decision = 'S' THEN 1 ELSE 0 END) AS sv,
       SUM(CASE WHEN pl.decision = 'H' THEN 1 ELSE 0 END) AS hld,
       SUM(pl.outs) AS outs, SUM(pl.h) AS h, SUM(pl.hr) AS hr,
       SUM(pl.bb) AS bb, SUM(pl.hbp) AS hbp, SUM(pl.so) AS so,
       SUM(pl.runs) AS runs, SUM(pl.er) AS er, SUM(pl.wp) AS wp, SUM(pl.balk) AS balk
FROM pitching_line pl
JOIN game g ON g.game_id = pl.game_id
JOIN player p ON p.player_id = pl.player_id
${seasonNameJoin("pl.player_id", "g.season")}
WHERE ${crosscheckScope("pl")}
GROUP BY pl.player_id
`;

/** 아웃 카운트 → `100.1` 같은 이닝 표기 */
function innings(outs: number): string {
  const whole = Math.floor(outs / 3);
  const rest = outs % 3;
  return rest === 0 ? String(whole) : `${whole}.${rest}`;
}

/** 이 루프가 읽은 공표표 장 수와 못 읽은 장(감지 모드의 `tables_missing` · 관문 출력에는 안 나온다) */
let tablesRead = 0;
const missingTables: string[] = [];

for (const team of TEAMS) {
  const scope = crosscheckScopeParams({ season, competition: values.competition, through: through.date, team: team.code });
  // ── 타격 ──
  const batHtml = readArchived(`npb/stats/${season}/idb1_${team.code}`);
  if (batHtml === null) {
    missingTables.push(`idb1_${team.code}`);
    console.error(`⚠ 공표 타격 성적표 없음: ${team.code} — 먼저 cli-stats.ts로 받아라`);
  } else {
    tablesRead += 1;
    // ⚠관문은 해석 실패를 잡지 않는다(지금처럼 그대로 죽는다) — 감지 모드만 세고 그 장을 건너뛴다
    const pub =
      emitPath === undefined ? parseTeamBatting(batHtml) : parsedOrNull(`idb1_${team.code}`, () => parseTeamBatting(batHtml));
    if (pub !== null) {
      const ours = db.raw.prepare(BAT_SQL).all(...scope) as unknown as {
        player_id: string; name: string; games: number; pa: number; ab: number; runs: number; h: number;
        d2: number; d3: number; hr: number; rbi: number; sb: number; sh: number; sf: number;
        bb: number; ibb: number; hbp: number; so: number;
      }[];

      const used = new Set<PublishedBatting>();
      for (const o of ours) {
        const p = match(o.name, pub);
        if (p === null) {
          unmatchedOurs.push(`${team.code}/打 ${o.name}`);
          continue;
        }
        used.add(p);
        comparedPlayers += 1;
        const line: BattingLine = {
          pa: o.pa, ab: o.ab, h: o.h, double: o.d2, triple: o.d3, hr: o.hr,
          bb: o.bb, ibb: o.ibb, hbp: o.hbp, sf: o.sf, sh: o.sh, so: o.so, roe: 0,
        };
        const c = (f: string, a: number, b: number): void =>
          cmp(team.code, "batting", o.player_id, o.name, f, String(a), String(b));
        c("試合", o.games, p.games);
        c("打席", o.pa, p.pa);
        c("打数", o.ab, p.ab);
        c("得点", o.runs, p.runs);
        c("安打", o.h, p.h);
        c("二塁打", o.d2, p.double);
        c("三塁打", o.d3, p.triple);
        c("本塁打", o.hr, p.hr);
        c("打点", o.rbi, p.rbi);
        c("盗塁", o.sb, p.sb);
        c("犠打", o.sh, p.sh);
        c("犠飛", o.sf, p.sf);
        c("四球", o.bb, p.bb);
        c("故意四", o.ibb, p.ibb);
        c("死球", o.hbp, p.hbp);
        c("三振", o.so, p.so);
        // ⚠비율은 **우리가 계산한 값을 공표와 같은 표기로 만들어** 문자열로 비교한다.
        // 반올림 규칙이 다르면 그것도 차이로 잡혀야 한다
        cmp(team.code, "batting", o.player_id, o.name, "打率", avg3(battingAverage(line).value), p.avg);
        cmp(team.code, "batting", o.player_id, o.name, "長打率", avg3(sluggingPercentage(line).value), p.slg);
        cmp(team.code, "batting", o.player_id, o.name, "出塁率", avg3(onBasePercentage(line).value), p.obp);
      }
      for (const p of pub) if (!used.has(p)) unmatchedPub.push(`${team.code}/打 ${p.rawName}`);
    }
  }

  // ── 투구 ──
  const pitHtml = readArchived(`npb/stats/${season}/idp1_${team.code}`);
  if (pitHtml === null) {
    missingTables.push(`idp1_${team.code}`);
    console.error(`⚠ 공표 투구 성적표 없음: ${team.code}`);
    continue;
  }
  tablesRead += 1;
  const pub =
    emitPath === undefined ? parseTeamPitching(pitHtml) : parsedOrNull(`idp1_${team.code}`, () => parseTeamPitching(pitHtml));
  if (pub === null) continue;
  const ours = db.raw.prepare(PIT_SQL).all(...scope) as unknown as {
    player_id: string; name: string; games: number; w: number; l: number; sv: number; hld: number;
    outs: number; h: number; hr: number; bb: number; hbp: number; so: number;
    runs: number; er: number; wp: number; balk: number;
  }[];

  const used = new Set<PublishedPitching>();
  for (const o of ours) {
    const p = match(o.name, pub);
    if (p === null) {
      unmatchedOurs.push(`${team.code}/投 ${o.name}`);
      continue;
    }
    used.add(p);
    comparedPlayers += 1;
    const line: PitchingLine = {
      outs: o.outs, bf: 0, h: o.h, hr: o.hr, bb: o.bb, ibb: 0, hbp: o.hbp,
      so: o.so, er: o.er, r: o.runs,
    };
    const c = (f: string, a: number, b: number): void =>
      cmp(team.code, "pitching", o.player_id, o.name, f, String(a), String(b));
    c("試合", o.games, p.games);
    c("勝利", o.w, p.w);
    c("敗戦", o.l, p.l);
    c("セーブ", o.sv, p.sv);
    c("ホールド", o.hld, p.hld);
    c("被安打", o.h, p.h);
    c("被本塁打", o.hr, p.hr);
    c("与四球", o.bb, p.bb);
    c("与死球", o.hbp, p.hbp);
    c("奪三振", o.so, p.so);
    c("失点", o.runs, p.runs);
    c("自責点", o.er, p.er);
    c("暴投", o.wp, p.wp);
    c("ボーク", o.balk, p.balk);
    cmp(team.code, "pitching", o.player_id, o.name, "投球回", innings(o.outs), p.innings);
    cmp(team.code, "pitching", o.player_id, o.name, "防御率", dec2(earnedRunAverage(line).value), p.era);
  }
  for (const p of pub) if (!used.has(p)) unmatchedPub.push(`${team.code}/投 ${p.rawName}`);
}

db.close();

// ── 보고 ────────────────────────────────────────────────────────────────
/**
 * 정의가 다른 것과 **틀린 것**을 가른다.
 *
 * ⚠**섞어서 세면 이 도구는 무시된다.** 「673건」이라고만 말하면 아무도 안 보고,
 * 그 안에 섞인 진짜 1건이 묻힌다. 「우리가 일부러 다르게 하는 것」을 명시적으로 빼고
 * 남은 것만 결함 후보로 센다.
 *
 * ⚠**여기에 넣는 것은 「우리가 왜 다르게 하는지 말할 수 있는 것」뿐이다.**
 * 설명 못 하는 차이를 여기 넣으면 그 순간 이 도구가 눈을 감는다.
 */

console.log(`\n=== 외부 대조 ${season}년 (${values.competition}) ===`);
// ⚠**가정을 적는다.** 기준일이 안 맞으면 그날 뛴 선수가 전부 불일치로 잡히고,
// 그 상태의 「결함 후보 N건」은 아무 뜻도 없다 — 거짓 경보는 경보를 죽인다
console.log(`공표표 기준일 ${through.date}（${through.from}）`);
console.log(`대조한 선수 ${comparedPlayers}명 · 항목 ${comparedFields}개`);

const known = new Map<string, Diff[]>();
const real: Diff[] = [];
for (const d of diffs) {
  const why = classifyDiff(d);
  if (why === null) real.push(d);
  else known.set(why, [...(known.get(why) ?? []), d]);
}

console.log(
  `**결함 후보 ${real.length}건** · 정의 차이 ${diffs.length - real.length}건 · ` +
    `우리쪽 미해결 ${unmatchedOurs.length}명 · 공표쪽 미해결 ${unmatchedPub.length}명`,
);

if (known.size > 0) {
  console.log(`\n--- 정의 차이(의도된 것) ---`);
  for (const [why, list] of known) console.log(`  ${String(list.length).padStart(5)}  ${why}`);
}

if (real.length === 0 && comparedPlayers > 0) {
  console.log(`\n결함 후보 없음 — 우리가 계산한 값이 공표값과 전부 맞는다`);
} else if (real.length === 0) {
  // ⚠**0명을 「전부 맞는다」로 쓰지 않는다**(2026-09-09 · 2차 검토 F1).
  //   종료코드만 고치고 이 문장을 두면 **로그를 읽는 사람에게는 여전히 거짓말**이다.
  console.log(`\n⚠비교한 것이 없다 — 「맞았다」가 아니라 「안 쟀다」이다`);
} else {
  // 어느 항목이 얼마나 어긋나는지부터 — 한 항목이 전부면 원인이 하나다
  const byField = new Map<string, number>();
  for (const d of real) byField.set(`${d.kind}/${d.field}`, (byField.get(`${d.kind}/${d.field}`) ?? 0) + 1);
  console.log(`\n--- 항목별 불일치 ---`);
  for (const [k, n] of [...byField].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(5)}  ${k}`);

  console.log(`\n--- 불일치 상세 (${values.verbose ? "전부" : "앞 40건"}) ---`);
  for (const d of values.verbose ? real : real.slice(0, 40)) {
    console.log(`  ${d.team.padEnd(3)} ${d.kind === "batting" ? "打" : "投"} ${d.name.padEnd(10)} ${d.field.padEnd(8)} 우리 ${d.ours}  공표 ${d.published}`);
  }
}

if (unmatchedOurs.length > 0) {
  console.log(`\n--- 짝을 못 정한 우리 선수 (${unmatchedOurs.length}명) ---`);
  for (const u of unmatchedOurs.slice(0, 30)) console.log(`  ${u}`);
}
if (unmatchedPub.length > 0) {
  console.log(`\n--- 짝을 못 정한 공표 선수 (${unmatchedPub.length}명) ---`);
  for (const u of unmatchedPub.slice(0, 30)) console.log(`  ${u}`);
}

// ⚠⚠**아무것도 안 쟀으면 통과가 아니다**(2026-09-09 · 2차 검토 F1).
//   실측: `--through 2025-10-05`(범위 밖) 과 `--archive /nonexistent` 둘 다
//   **「대조한 선수 0명 · 결함 후보 0건 · 우리가 계산한 값이 공표값과 전부 맞는다」 · exit 0** 이었다.
//   공표표 취득 단계가 `continue-on-error: true` 라 실패해도 워크플로가 안 죽고,
//   대조 단계는 **디렉터리만 있으면** 돌므로 — **게이트가 아무것도 재지 않고 초록**이 된다.
//   ⚠**이 저장소가 같은 병을 이미 두 번 앓았다**(「통과하는데 안 돌던 검사」).
//   §1 이 요구하는 것은 정확히 이것이다: **「0건」과 「안 쟀음」을 구별한다.**
if (comparedPlayers === 0) {
  console.error(
    `\n⚠대조한 선수가 0명이다 — 이것은 「전부 맞았다」가 아니라 「안 쟀다」이다.` +
      `\n  기준일 ${through.date} · 공표쪽 미해결 ${String(unmatchedPub.length)}명` +
      `\n  공표표를 못 받았거나, 기준일이 우리 데이터 범위 밖이거나, 시즌이 아직 시작 전이다.`,
  );
  if (emitPath === undefined) process.exit(1);
}

// ── 감지 모드 — 사람용 출력은 위에서 관문과 똑같이 찍었다. 결과를 쓰고 status 의 종료코드로 끝난다 ──
if (emitPath !== undefined) {
  emitAndExit({
    asOf: measuredAsOf(),
    asOfDates: through.seen === null ? [] : [...through.seen.keys()],
    tablesRead,
    withGenzai: through.seen === null ? null : withGenzaiOf(through.seen),
    missing: missingTables,
    splitDetail: null,
    compared: true,
    comparedPlayers,
    comparedFields,
    unmatchedOurs: unmatchedOurs.length,
    unmatchedPub: unmatchedPub.length,
    folded: diffs.length - real.length,
    defects: real,
  });
}

// ⚠**정의 차이로 실패하지 않는다.** 그러면 이 도구가 늘 빨간불이라 아무도 안 보게 되고,
// 그 안에 섞인 진짜 1건이 묻힌다.
// ⚠**미해결은 실패가 아니라 미측정이다.** 「0건」과 「안 쟀음」을 구별해 낸다
process.exit(real.length > 0 ? 1 : 0);

// ── 감지 모드의 도구들(함수 선언 — 위에서 부른다) ─────────────────────────────

/** 감지 모드에서만 — 공표표 해석 실패를 세고 사람용으로도 찍는다(관문은 이 자리에 오지 않고 예외로 죽는다) */
function noteParseFailure(table: string, e: StatsParseError): void {
  parseFailures.push({ table, message: e.message, detail: e.detail });
  console.error(`⚠공표표 해석 실패: ${table} — ${e.message}（${e.detail}）`);
}

/** 감지 모드에서만 부른다 — 해석이 던지면(`StatsParseError`) 세고 `null`. 그 밖의 예외는 그대로 던진다(버그다) */
function parsedOrNull<T>(table: string, parse: () => T): T | null {
  try {
    return parse();
  } catch (e) {
    if (!(e instanceof StatsParseError)) throw e;
    noteParseFailure(table, e);
    return null;
  }
}

/** 「現在」를 읽어 낸 장 수 — 날짜마다의 장을 더한다(해석이 던진 장은 들어 있지 않다) */
function withGenzaiOf(seen: ReadonlyMap<string, readonly string[]>): number {
  let n = 0;
  for (const who of seen.values()) n += who.length;
  return n;
}

type AsOfSource = "genzai" | "partial" | "absent" | "override";

/**
 * 대조를 마친 실행의 `as_of`(설계 D2·D3). 기준일이 갈린 실행은 여기 오지 않는다(`publishedThrough` 가 먼저 끝낸다).
 * - `override` — `--through` 로 사람이 정했다(「現在」는 읽지 않았다)
 * - `genzai` — **24장 전부**에 같은 「現在」 — 자동 재수집은 이때만 한다
 * - `partial` — 일부 장에만(못 읽은 장 · 문구 없는 장 · 해석이 던진 장이 섞였다)
 * - `absent` — 어디에도 없다(완결 시즌이거나 문구가 바뀌었다 — 못 가른다 · `date: null`)
 */
function measuredAsOf(): { date: string | null; source: AsOfSource } {
  if (values.through !== undefined) return { date: values.through, source: "override" };
  if (through.seen === null || through.seen.size === 0) return { date: null, source: "absent" };
  return {
    date: through.date,
    source: withGenzaiOf(through.seen) === TABLES_EXPECTED ? "genzai" : "partial",
  };
}

interface EmitInput {
  asOf: { date: string | null; source: AsOfSource };
  asOfDates: readonly string[];
  tablesRead: number;
  /** `--through` 면 「現在」를 읽지 않았으므로 `null`(= 안 쟀다 · 0 이 아니다) */
  withGenzai: number | null;
  missing: readonly string[];
  /** 기준일이 갈렸을 때 그 내역(`2026-09-27(1장) / 2026-09-28(23장)`) */
  splitDetail: string | null;
  /** 대조를 했는가 — 기준일이 갈리면 하지 않는다 */
  compared: boolean;
  comparedPlayers: number;
  comparedFields: number;
  unmatchedOurs: number;
  unmatchedPub: number;
  folded: number;
  defects: readonly Diff[];
}

/** 측정 실패 사유 하나를 사람이 읽는 글로 — `reason_detail` 의 글감 */
function reasonText(r: CrosscheckUnmeasuredReason, m: EmitInput): string {
  switch (r) {
    case "asof_split":
      return `공표표의 기준일이 장마다 다르다 — ${m.splitDetail ?? "(내역 없음)"}`;
    case "table_parse_error":
      // ⚠「장」이 아니라 「건」이다 — 한 장이 「現在」와 표 본문에서 두 번 실패할 수 있다
      return `공표표 해석 실패 ${String(parseFailures.length)}건 — ${parseFailures
        .map((f) => `${f.table}: ${f.message}（${f.detail}）`)
        .join(" / ")}`;
    case "tables_missing":
      return `공표표 ${String(TABLES_EXPECTED)}장 중 ${String(m.tablesRead)}장만 읽었다 — 없음: ${m.missing.join(", ")}`;
    case "compared_zero":
      return m.compared
        ? "대조한 선수가 0명이다 — 「0건」이 아니라 「안 쟀다」"
        : "대조한 선수가 0명이다 — 기준일이 갈려 대조하지 않았다";
  }
}

/** 결과를 쓰고(원자적으로) status 의 종료코드로 끝난다. **감지 모드에서만** 부른다 */
function emitAndExit(m: EmitInput): never {
  if (emitPath === undefined) throw new Error("감지 모드가 아닌데 결과를 쓰려 했다");
  const input: CrosscheckEmitInput = {
    asOfDates: m.asOfDates,
    tablesRead: m.tablesRead,
    tablesExpected: TABLES_EXPECTED,
    parseError: parseFailures.length > 0,
    comparedPlayers: m.comparedPlayers,
    defects: m.defects.length,
  };
  const { status, reason } = crosscheckEmitStatus(input);
  const reasons = crosscheckUnmeasuredReasons(input);
  const result = {
    schema: 1,
    season,
    competition: values.competition,
    status,
    reason,
    // 첫 사유를 포함해 걸린 사유 전부를 차례대로 — 첫 것만 `reason` 이다(설계 D2)
    reason_detail: reasons.length === 0 ? null : reasons.map((r) => reasonText(r, m)).join(" · "),
    as_of: m.asOf,
    tables: { expected: TABLES_EXPECTED, read: m.tablesRead, with_genzai: m.withGenzai },
    compared: { players: m.comparedPlayers, fields: m.comparedFields },
    unmatched: { ours: m.unmatchedOurs, published: m.unmatchedPub },
    folded: m.folded,
    // ⚠순서는 계약이 아니다(SQL 에 ORDER BY 가 없다) — 부르는 쪽이 정렬한다(설계 D6)
    defects: m.defects.map((d) => ({
      team: d.team,
      kind: d.kind,
      player_id: d.playerId,
      name: d.name,
      field: d.field,
      ours: d.ours,
      published: d.published,
    })),
  };
  writeAtomically(emitPath, `${JSON.stringify(result, null, 2)}\n`);
  process.exit(crosscheckEmitExitCode(status));
}

/**
 * `<path>.tmp-<pid>` 에 쓰고 `rename` 한다 — 읽는 쪽이 반쯤 쓴 파일을 보지 않는다.
 * ⚠쓰기에 실패하면 던진다(→ 0·2 가 아닌 종료 · 결과 JSON 을 약속하지 않는다). 임시 파일은 남기지 않는다.
 */
function writeAtomically(path: string, text: string): void {
  const tmp = `${path}.tmp-${String(process.pid)}`;
  try {
    writeFileSync(tmp, text);
    renameSync(tmp, path);
  } catch (e) {
    rmSync(tmp, { force: true });
    throw e;
  }
}
