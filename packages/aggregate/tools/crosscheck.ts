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
 *   node packages/aggregate/tools/crosscheck.ts data/bb.sqlite 2026 [--archive data/archive]
 */
import { parseArgs } from "node:util";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { openDb } from "@bb-app/store";
import { parseTeamBatting, parseTeamPitching } from "@bb-app/parser";
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
import { classifyDiff } from "../src/crosscheck-classify.ts";
import type { CrosscheckDiff as Diff } from "../src/crosscheck-classify.ts";
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
     * 주지 않으면 공표표의 `fetchedAt` 에서 유도하고, **무엇을 가정했는지 화면에 적는다.**
     */
    through: { type: "string" },
    verbose: { type: "boolean", default: false },
  },
});
const dbPath = positionals[0] ?? "data/bb.sqlite";
const season = Number(positionals[1] ?? 2026);

/**
 * 공표표가 어느 날까지를 담고 있는가.
 *
 * ⚠**추측이지 사실이 아니다.** 페이지에 기준일이 적혀 있지 않으므로 취득 시각으로 유도한다 —
 * JST 날짜에서 하루를 뺀다(경기는 오후에 시작하므로 낮에 받은 표는 전날까지를 담는다).
 * 그래서 **화면에 가정을 적고**, 맞지 않으면 `--through` 로 덮어쓸 수 있게 둔다.
 */
function publishedThrough(): { date: string; from: string } {
  if (values.through !== undefined) return { date: values.through, from: "--through" };
  try {
    const meta = JSON.parse(
      readFileSync(`${values.archive}/npb/stats/${season}/idb1_c.meta.json`, "utf8"),
    ) as { fetchedAt?: string };
    if (typeof meta.fetchedAt === "string") {
      const jst = new Date(new Date(meta.fetchedAt).getTime() + 9 * 3600 * 1000 - 24 * 3600 * 1000);
      return { date: jst.toISOString().slice(0, 10), from: `취득 ${meta.fetchedAt} 에서 유도` };
    }
  } catch {
    // 메타가 없으면 아래로
  }
  return { date: "9999-12-31", from: "⚠유도 실패 — 전 기간으로 비교한다(거짓 경보가 난다)" };
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

function cmp(team: string, kind: Diff["kind"], name: string, field: string, ours: string, published: string): void {
  comparedFields += 1;
  if (ours !== published) diffs.push({ team, kind, name, field, ours, published });
}

// ── 타격 ────────────────────────────────────────────────────────────────
const BAT_SQL = `
SELECT p.display_name AS name,
       COUNT(DISTINCT b.game_id) AS games,
       SUM(b.pa) AS pa, SUM(b.ab) AS ab, SUM(b.runs) AS runs, SUM(b.h) AS h,
       SUM(b.d2) AS d2, SUM(b.d3) AS d3, SUM(b.hr) AS hr, SUM(b.rbi) AS rbi,
       SUM(b.sb) AS sb, SUM(b.sh) AS sh, SUM(b.sf) AS sf,
       SUM(b.bb) AS bb, SUM(b.ibb) AS ibb, SUM(b.hbp) AS hbp, SUM(b.so) AS so
FROM batting_line b
JOIN game g ON g.game_id = b.game_id
JOIN player p ON p.player_id = b.player_id
WHERE g.season = ? AND g.status = 'played' AND g.competition = ?
  AND g.game_date <= ?
  AND ((b.side = 'away' AND g.away_code = ?) OR (b.side = 'home' AND g.home_code = ?))
GROUP BY b.player_id
`;

const PIT_SQL = `
SELECT p.display_name AS name,
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
WHERE g.season = ? AND g.status = 'played' AND g.competition = ?
  AND g.game_date <= ?
  AND ((pl.side = 'away' AND g.away_code = ?) OR (pl.side = 'home' AND g.home_code = ?))
GROUP BY pl.player_id
`;

/** 아웃 카운트 → `100.1` 같은 이닝 표기 */
function innings(outs: number): string {
  const whole = Math.floor(outs / 3);
  const rest = outs % 3;
  return rest === 0 ? String(whole) : `${whole}.${rest}`;
}

for (const team of TEAMS) {
  // ── 타격 ──
  const batHtml = readArchived(`npb/stats/${season}/idb1_${team.code}`);
  if (batHtml === null) {
    console.error(`⚠ 공표 타격 성적표 없음: ${team.code} — 먼저 cli-stats.ts로 받아라`);
  } else {
    const pub = parseTeamBatting(batHtml);
    const ours = db.raw.prepare(BAT_SQL).all(season, values.competition, through.date, team.code, team.code) as unknown as {
      name: string; games: number; pa: number; ab: number; runs: number; h: number;
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
        cmp(team.code, "batting", o.name, f, String(a), String(b));
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
      cmp(team.code, "batting", o.name, "打率", avg3(battingAverage(line).value), p.avg);
      cmp(team.code, "batting", o.name, "長打率", avg3(sluggingPercentage(line).value), p.slg);
      cmp(team.code, "batting", o.name, "出塁率", avg3(onBasePercentage(line).value), p.obp);
    }
    for (const p of pub) if (!used.has(p)) unmatchedPub.push(`${team.code}/打 ${p.rawName}`);
  }

  // ── 투구 ──
  const pitHtml = readArchived(`npb/stats/${season}/idp1_${team.code}`);
  if (pitHtml === null) {
    console.error(`⚠ 공표 투구 성적표 없음: ${team.code}`);
    continue;
  }
  const pub = parseTeamPitching(pitHtml);
  const ours = db.raw.prepare(PIT_SQL).all(season, values.competition, through.date, team.code, team.code) as unknown as {
    name: string; games: number; w: number; l: number; sv: number; hld: number;
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
      cmp(team.code, "pitching", o.name, f, String(a), String(b));
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
    cmp(team.code, "pitching", o.name, "投球回", innings(o.outs), p.innings);
    cmp(team.code, "pitching", o.name, "防御率", dec2(earnedRunAverage(line).value), p.era);
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

if (real.length === 0) {
  console.log(`\n결함 후보 없음 — 우리가 계산한 값이 공표값과 전부 맞는다`);
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

// ⚠**정의 차이로 실패하지 않는다.** 그러면 이 도구가 늘 빨간불이라 아무도 안 보게 되고,
// 그 안에 섞인 진짜 1건이 묻힌다.
// ⚠**미해결은 실패가 아니라 미측정이다.** 「0건」과 「안 쟀음」을 구별해 낸다
process.exit(real.length > 0 ? 1 : 0);
