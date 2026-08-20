#!/usr/bin/env node
/**
 * **ASRC / ASRP 재측정 — 9시즌 · 18 리그-시즌**
 *
 * 스펙: `docs/superpowers/specs/2026-08-20-asrc-asrp-design.md`
 *
 * ⚠**이 파일이 존재하는 이유**: 앞선 설계의 실측은 전부 인라인 프로브였고
 * 워킹트리를 되돌린 뒤 **재현이 불가능해졌다**(스펙 §13-6). 이 저장소는
 * 「재현 절차 없는 실측」을 결함으로 취급한다. 그래서 파일로 남긴다.
 *
 * ⚠**DB 를 쓰지 않는다.** readOnly 로 연다 — 쓰기는 SQLite 가 거부한다(실측 확인).
 * ⚠**계산 커널을 새로 쓰지 않는다**(M1) — paValue/afterStateOf/buildRunExpectancy 를
 *   packages/aggregate 에서 **그대로 가져다 쓴다.** 여기서 식을 다시 쓰면 화면과 갈린다.
 *
 * 쓰는 법:
 *   node scripts/asrc-asrp-measure.ts data/bb.sqlite all
 *   node scripts/asrc-asrp-measure.ts data/bb.sqlite reliability
 *   node scripts/asrc-asrp-measure.ts data/bb.sqlite grid
 *   node scripts/asrc-asrp-measure.ts data/bb.sqlite effect
 *   node scripts/asrc-asrp-measure.ts data/bb.sqlite ceiling
 *   node scripts/asrc-asrp-measure.ts data/bb.sqlite invariant
 *   node scripts/asrc-asrp-measure.ts data/bb.sqlite cases
 *
 * 옵션:
 *   --lamB 0.8 --kB 150 --lamP 0.7 --kP 800   채택 상수를 바꿔서 재본다
 *   --trials 200                              천장 시뮬 시행 수
 *   --seed 20260820                           난수 씨앗(재현 가능)
 *
 * ⚠**대회 경계**: regular 만. 올스타·CS·일본시리즈 제외(CLAUDE.md §2-1).
 * ⚠**2026 은 진행 중 시즌이다.** 출력에서 별표로 표시하고 완결 8시즌과 분리해 읽어라.
 */
import { DatabaseSync } from "node:sqlite";
import { parseArgs } from "node:util";
import type { Db } from "@bb-app/store";
import { TEAMS } from "@bb-app/domain";
import type { League } from "@bb-app/domain";
import { qualifiedBatterPa, qualifiedPitcherOuts, qualifiedRelieverOuts } from "@bb-app/metrics";
import {
  afterStateOf,
  buildRunExpectancy,
  paValue,
} from "../packages/aggregate/src/run-expectancy.ts";
import type { RunExpectancy } from "../packages/aggregate/src/run-expectancy.ts";

/* ------------------------------------------------------------------ 상수 */

/** 보유 시즌. ⚠**늘어나면 여기만 고친다** */
const SEASONS: readonly number[] = [2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026];
/** ⚠**진행 중 시즌.** 완결 시즌과 섞어서 결론 내지 마라 */
const IN_PROGRESS: ReadonlySet<number> = new Set([2026]);
const LEAGUES: readonly League[] = ["central", "pacific"];
const COMPETITION = "regular";
/** 사례 절이 어느 역할을 볼 것인가. --role 로 바꾼다(기본 선발) */
let CASE_ROLE: "starter" | "reliever" = "starter";

/** 스펙 §4-2 채택값. 명령행으로 덮어쓸 수 있다 */
interface Constants { lamB: number; kB: number; lamP: number; kP: number }

type Side = "bat" | "pitch";

const BAT_TEAM = "CASE e.half WHEN 'top' THEN g.away_code ELSE g.home_code END";
const PIT_TEAM = "CASE e.half WHEN 'top' THEN g.home_code ELSE g.away_code END";
const BAT_TEAM_BL = "CASE bl.side WHEN 'away' THEN g.away_code ELSE g.home_code END";
const PIT_TEAM_PL = "CASE t.side WHEN 'away' THEN g.away_code ELSE g.home_code END";

/* ------------------------------------------------------------- 잡 유틸 */

function nf(x: number, d = 2): string {
  if (!Number.isFinite(x)) return "n/a";
  return x.toFixed(d);
}
function pctOf(a: number, b: number): string {
  if (b === 0) return "0/0";
  return `${a}/${b}(${((a / b) * 100).toFixed(0)}%)`;
}

/** 재현 가능한 난수(xorshift32). ⚠Math.random 을 쓰지 않는다 — 씨앗을 적어야 재현이 된다 */
function makeRng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 0x1_0000_0000;
  };
}

/** Box-Muller. 표준정규 */
function makeNormal(rng: () => number): () => number {
  let spare: number | null = null;
  return () => {
    if (spare !== null) { const v = spare; spare = null; return v; }
    let u = 0, v = 0, s = 0;
    do { u = rng() * 2 - 1; v = rng() * 2 - 1; s = u * u + v * v; } while (s === 0 || s >= 1);
    const m = Math.sqrt((-2 * Math.log(s)) / s);
    spare = v * m;
    return u * m;
  };
}

function mean(xs: readonly number[]): number {
  if (xs.length === 0) return NaN;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}
/** 모집단 표준편차(n). ⚠앞선 설계의 sd 와 같은 정의로 맞춘다 */
function sd(xs: readonly number[]): number {
  if (xs.length === 0) return NaN;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) * (b - m), 0) / xs.length);
}
/** 표본 표준편차(n−1). 잡음 평가에 쓴다 */
function sdSample(xs: readonly number[]): number {
  if (xs.length < 2) return NaN;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) * (b - m), 0) / (xs.length - 1));
}
function pearson(xs: readonly number[], ys: readonly number[]): number {
  const n = xs.length;
  if (n < 3) return NaN;
  const mx = mean(xs), my = mean(ys);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = xs[i]! - mx, dy = ys[i]! - my;
    sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
  }
  if (sxx === 0 || syy === 0) return NaN;
  return sxy / Math.sqrt(sxx * syy);
}
function median(xs: readonly number[]): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const h = Math.floor(s.length / 2);
  if (s.length % 2 === 1) return s[h]!;
  return (s[h - 1]! + s[h]!) / 2;
}

/** 선수 ID ↔ 정수 인덱스. **이름으로 조인하지 않는다**(M10) */
class Interner {
  private readonly map = new Map<string, number>();
  readonly ids: string[] = [];
  index(id: string): number {
    const hit = this.map.get(id);
    if (hit !== undefined) return hit;
    const i = this.ids.length;
    this.ids.push(id);
    this.map.set(id, i);
    return i;
  }
}

/* ------------------------------------------------------------------- DB */

/**
 * ⚠openDb 를 쓰지 않는다 — 그쪽은 **마이그레이션을 적용한다**(쓰기).
 * buildRunExpectancy 가 요구하는 것은 db.raw 뿐이라 껍데기로 충분하다.
 */
function openReadOnly(path: string): { raw: DatabaseSync; db: Db } {
  const raw = new DatabaseSync(path, { readOnly: true });
  const db = {
    raw,
    transaction: <T>(fn: () => T): T => fn(),
    savepoint: <T>(_n: string, fn: () => T): T => fn(),
    close: () => raw.close(),
  } as unknown as Db;
  return { raw, db };
}

function codesOf(lg: League): string[] {
  return TEAMS.filter((t) => t.league === lg).map((t) => t.code);
}

/** SQL 안 리터럴 목록. ⚠코드는 우리 상수지만 **형식을 확인하고** 넣는다 */
function inList(codes: readonly string[]): string {
  for (const c of codes) {
    if (!/^[a-z]+$/.test(c)) throw new RangeError(`구단 코드 형식이 이상하다: ${c}`);
  }
  return "(" + codes.map((c) => "'" + c + "'").join(",") + ")";
}

/* ------------------------------------------------------- 유니버스 적재 */

/**
 * 한 리그-시즌의 **평가 완료 타석 묶음**.
 *
 * ⚠**side 가 유니버스를 정한다**(스펙 §4-1):
 *   bat   = 공격팀이 그 리그 (computeSrc 의 SQL 과 같은 모집단)
 *   pitch = 투구팀이 그 리그 (computeSrp 의 SQL 과 같은 모집단 · pitcher_id IS NOT NULL)
 * ⚠**RE 행렬은 양쪽 다 그 리그의 공격으로 만든 것을 쓴다** — computeSrp 가 그렇게 부른다.
 *   교류전 타석이 두 유니버스에서 다른 v 를 갖는 것은 **기존 성질**이고 여기서 고치지 않는다(스펙 §6).
 */
interface Universe {
  season: number;
  league: League;
  side: Side;
  bat: Int32Array;
  pit: Int32Array;
  v: Float64Array;
  ok: Uint8Array;
  rows: number;
  valued: number;
  skipped: number;
  unknownPitcher: number;
}

interface PaRow {
  gameId: string; inning: number; half: string; seq: number;
  bases: string; outs: number; runs: number;
  batterId: string; pitcherId: string | null;
}

function paSql(side: Side, codes: readonly string[]): string {
  let teamExpr = PIT_TEAM;
  if (side === "bat") teamExpr = BAT_TEAM;
  let pitcherFilter = "";
  if (side === "pitch") pitcherFilter = "AND e.pitcher_id IS NOT NULL";
  const lines = [
    "SELECT e.game_id AS gameId, e.inning AS inning, e.half AS half, e.seq AS seq,",
    "       e.bases AS bases, e.outs_before AS outs, e.runs_scored AS runs,",
    "       e.batter_id AS batterId, e.pitcher_id AS pitcherId",
    "FROM pa_event e",
    "JOIN game g ON g.game_id = e.game_id",
    "JOIN player b ON b.player_id = e.batter_id",
    "WHERE g.season = ? AND g.status = 'played' AND g.competition = ?",
    "  AND e.status = 'final' " + pitcherFilter,
    "  AND " + teamExpr + " IN " + inList(codes),
    "ORDER BY e.game_id, e.seq",
  ];
  return lines.join("\n");
}

function loadUniverse(
  raw: DatabaseSync, season: number, league: League, side: Side, re: RunExpectancy, ix: Interner,
): Universe {
  const rows = raw.prepare(paSql(side, codesOf(league))).all(season, COMPETITION) as unknown as PaRow[];
  const n = rows.length;
  const u: Universe = {
    season, league, side,
    bat: new Int32Array(n), pit: new Int32Array(n), v: new Float64Array(n), ok: new Uint8Array(n),
    rows: n, valued: 0, skipped: 0, unknownPitcher: 0,
  };
  for (let i = 0; i < n; i += 1) {
    const cur = rows[i]!;
    const next = rows[i + 1];
    /* ⚠**커널 그대로**(M1). 여기서 판정을 새로 쓰면 SRC 와 다른 수가 나온다 */
    const after = afterStateOf(cur, next);
    let value: number | null = null;
    if (after !== null) {
      let afterState: { bases: string; outs: number } | null = null;
      if (after.use === "next") afterState = { bases: next!.bases, outs: next!.outs };
      value = paValue(re, { bases: cur.bases, outs: cur.outs }, afterState, cur.runs);
    }
    u.bat[i] = ix.index(cur.batterId);
    u.pit[i] = -1;
    if (cur.pitcherId === null) {
      u.unknownPitcher += 1;
    } else {
      u.pit[i] = ix.index(cur.pitcherId);
    }
    if (value === null) { u.skipped += 1; continue; }
    u.v[i] = value;
    u.ok[i] = 1;
    u.valued += 1;
  }
  return u;
}

/* ------------------------------------------------- 시즌별 누적(파워레벨 재료) */

/** playerIdx → 시즌별 Σv 와 n. 시즌 축은 SEASONS 의 순서다 */
interface Tally { sum: Map<number, Float64Array>; n: Map<number, Float64Array> }

function emptyTally(): Tally { return { sum: new Map(), n: new Map() }; }

function bump(t: Tally, player: number, sIdx: number, v: number): void {
  let s = t.sum.get(player);
  if (s === undefined) { s = new Float64Array(SEASONS.length); t.sum.set(player, s); }
  let c = t.n.get(player);
  if (c === undefined) { c = new Float64Array(SEASONS.length); t.n.set(player, c); }
  s[sIdx]! += v;
  c[sIdx]! += 1;
}

/**
 * 파워레벨(스펙 §4-2).
 *
 *   level(S) = ( Σ_s λ^|S−s| · Σv_s ) / ( Σ_s λ^|S−s| · n_s ) × N/(N+k),  N = Σ_s λ^|S−s| · n_s
 *
 * ⚠**시즌 S 자신을 포함하고 S 이후 시즌도 포함한다**(양방향). 예측이 아니라 **회고 추정**이다.
 * ⚠exclude 를 주면 그 시즌을 뺀다 — **유도(격자탐색)는 뺀 판을 쓴다.**
 */
function powerLevels(t: Tally, sIdx: number, lam: number, k: number, exclude = false): Map<number, number> {
  const out = new Map<number, number>();
  for (const [player, sums] of t.sum) {
    const cnts = t.n.get(player)!;
    let num = 0, den = 0;
    for (let j = 0; j < SEASONS.length; j += 1) {
      if (exclude && j === sIdx) continue;
      const w = Math.pow(lam, Math.abs(sIdx - j));
      num += w * sums[j]!;
      den += w * cnts[j]!;
    }
    /* N=0 이면 「모름」이다(M11). 지도에 넣지 않는다 */
    if (den <= 0) continue;
    out.set(player, (num / den) * (den / (den + k)));
  }
  return out;
}

/* ------------------------------------------------------------- 자격 기준 */

interface BatterQual { pa: number; teamCode: string }
interface PitcherQual { outs: number; starts: number; spOuts: number; rpOuts: number; bf: number; teamCode: string }

function teamGames(raw: DatabaseSync, season: number): Map<string, number> {
  const sql = [
    "SELECT code, COUNT(*) AS n FROM (",
    "  SELECT away_code AS code FROM game WHERE season = ? AND status = 'played' AND competition = ?",
    "  UNION ALL",
    "  SELECT home_code AS code FROM game WHERE season = ? AND status = 'played' AND competition = ?",
    ") GROUP BY code",
  ].join("\n");
  const rows = raw.prepare(sql).all(season, COMPETITION, season, COMPETITION) as unknown as
    { code: string; n: number }[];
  return new Map(rows.map((r) => [r.code, r.n]));
}

/**
 * 리그 안의 타자 자격 재료. **battingByLeague 와 같은 모양**으로 접는다.
 * ⚠소속은 **가장 최근에 뛴 팀**(leaderboard.ts 의 규칙 그대로).
 */
function battersOfLeague(raw: DatabaseSync, season: number, league: League): Map<string, BatterQual> {
  const sql = [
    "SELECT bl.player_id AS pid, " + BAT_TEAM_BL + " AS teamCode,",
    "       SUM(bl.pa) AS pa, MAX(g.game_date) AS lastDate",
    "FROM batting_line bl",
    "JOIN game g ON g.game_id = bl.game_id",
    "WHERE g.season = ? AND g.status = 'played' AND g.competition = ?",
    "  AND " + BAT_TEAM_BL + " IN " + inList(codesOf(league)),
    "GROUP BY bl.player_id, teamCode",
  ].join("\n");
  const rows = raw.prepare(sql).all(season, COMPETITION) as unknown as
    { pid: string; teamCode: string; pa: number; lastDate: string }[];
  const out = new Map<string, BatterQual>();
  const last = new Map<string, string>();
  for (const r of rows) {
    const cur = out.get(r.pid);
    if (cur === undefined) {
      out.set(r.pid, { pa: r.pa, teamCode: r.teamCode });
      last.set(r.pid, r.lastDate);
      continue;
    }
    cur.pa += r.pa;
    if (r.lastDate > last.get(r.pid)!) { cur.teamCode = r.teamCode; last.set(r.pid, r.lastDate); }
  }
  return out;
}

/**
 * 리그 안의 투수 자격 재료. **season.ts 의 starter CTE 와 같은 판정**을 쓴다 —
 * 선발 = 각 하프이닝의 첫 타석을 던진 투수.
 */
function pitchersOfLeague(raw: DatabaseSync, season: number, league: League): Map<string, PitcherQual> {
  const sql = [
    "WITH starter AS (",
    "  SELECT e.game_id AS game_id, e.pitcher_id AS pitcher_id",
    "  FROM pa_event e",
    "  JOIN (SELECT e2.game_id AS game_id, e2.half AS half, MIN(e2.seq) AS s",
    "          FROM pa_event e2 JOIN game g2 ON g2.game_id = e2.game_id",
    "         WHERE g2.season = ? AND g2.competition = ?",
    "         GROUP BY e2.game_id, e2.half) m",
    "    ON m.game_id = e.game_id AND m.half = e.half AND m.s = e.seq",
    "  WHERE e.pitcher_id IS NOT NULL",
    ")",
    "SELECT t.player_id AS pid, " + PIT_TEAM_PL + " AS teamCode,",
    "       MAX(g.game_date) AS lastDate,",
    "       SUM(t.outs) AS outs,",
    "       SUM(CASE WHEN s.pitcher_id IS NOT NULL THEN 1 ELSE 0 END) AS starts,",
    "       SUM(CASE WHEN s.pitcher_id IS NOT NULL THEN t.outs ELSE 0 END) AS spOuts,",
    "       SUM(CASE WHEN s.pitcher_id IS NOT NULL THEN 0 ELSE t.outs END) AS rpOuts,",
    "       SUM(COALESCE(t.bf, 0)) AS bf",
    "FROM pitching_line t",
    "JOIN game g ON g.game_id = t.game_id",
    "LEFT JOIN starter s ON s.game_id = t.game_id AND s.pitcher_id = t.player_id",
    "WHERE g.season = ? AND g.status = 'played' AND g.competition = ?",
    "  AND " + PIT_TEAM_PL + " IN " + inList(codesOf(league)),
    "GROUP BY t.player_id, teamCode",
  ].join("\n");
  const rows = raw.prepare(sql).all(season, COMPETITION, season, COMPETITION) as unknown as {
    pid: string; teamCode: string; lastDate: string;
    outs: number; starts: number; spOuts: number; rpOuts: number; bf: number;
  }[];
  const out = new Map<string, PitcherQual>();
  const last = new Map<string, string>();
  for (const r of rows) {
    const cur = out.get(r.pid);
    if (cur === undefined) {
      out.set(r.pid, {
        outs: r.outs, starts: r.starts, spOuts: r.spOuts, rpOuts: r.rpOuts, bf: r.bf, teamCode: r.teamCode,
      });
      last.set(r.pid, r.lastDate);
      continue;
    }
    cur.outs += r.outs; cur.starts += r.starts; cur.spOuts += r.spOuts;
    cur.rpOuts += r.rpOuts; cur.bf += r.bf;
    if (r.lastDate > last.get(r.pid)!) { cur.teamCode = r.teamCode; last.set(r.pid, r.lastDate); }
  }
  return out;
}

/** season.ts 의 판정 그대로 — 아웃이 같으면 선발 등판 유무로 가른다 */
function roleOf(q: PitcherQual): "starter" | "reliever" {
  if (q.spOuts > q.rpOuts) return "starter";
  if (q.spOuts === q.rpOuts && q.starts > 0) return "starter";
  return "reliever";
}

/* ------------------------------------------------------------------ 순위 */

interface RankRow { id: string; value: number }

/** rankBy 와 같은 규칙 — **동률은 같은 순위, 다음은 건너뛴다** */
function rankMap(rows: readonly RankRow[]): Map<string, number> {
  const sorted = [...rows].sort((a, b) => b.value - a.value);
  const out = new Map<string, number>();
  let prevValue: number | null = null;
  let prevRank = 0;
  sorted.forEach((r, i) => {
    let rank = i + 1;
    if (prevValue !== null && r.value === prevValue) rank = prevRank;
    prevValue = r.value; prevRank = rank;
    out.set(r.id, rank);
  });
  return out;
}

function leadersOf(m: ReadonlyMap<string, number>): Set<string> {
  const out = new Set<string>();
  for (const [id, r] of m) if (r === 1) out.add(id);
  return out;
}

function sameSet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

/* -------------------------------------------------------------- 적재 전체 */

interface Loaded {
  ix: Interner;
  names: Map<string, string>;
  uni: Map<string, Universe>;
  batTally: Tally;
  pitTally: Tally;
  totals: { rows: number; valued: number; skipped: number; unknownPitcher: number };
}

function ukey(season: number, league: League, side: Side): string {
  return season + "|" + league + "|" + side;
}

function loadAll(raw: DatabaseSync, db: Db): Loaded {
  const ix = new Interner();
  const uni = new Map<string, Universe>();
  const batTally = emptyTally();
  const pitTally = emptyTally();
  const totals = { rows: 0, valued: 0, skipped: 0, unknownPitcher: 0 };
  const sides: Side[] = ["bat", "pitch"];

  for (let s = 0; s < SEASONS.length; s += 1) {
    const season = SEASONS[s]!;
    for (const league of LEAGUES) {
      const m = buildRunExpectancy(db, season, league, codesOf(league), COMPETITION);
      for (const side of sides) {
        const u = loadUniverse(raw, season, league, side, m, ix);
        uni.set(ukey(season, league, side), u);
        totals.rows += u.rows; totals.valued += u.valued;
        totals.skipped += u.skipped; totals.unknownPitcher += u.unknownPitcher;
        let t = pitTally;
        if (side === "bat") t = batTally;
        for (let i = 0; i < u.rows; i += 1) {
          if (u.ok[i] === 0) continue;
          let who = u.pit[i]!;
          if (side === "bat") who = u.bat[i]!;
          bump(t, who, s, u.v[i]!);
        }
      }
    }
  }

  const names = new Map<string, string>();
  const prows = raw.prepare("SELECT player_id AS id, display_name AS n FROM player").all() as unknown as
    { id: string; n: string }[];
  for (const r of prows) names.set(r.id, r.n);

  return { ix, names, uni, batTally, pitTally, totals };
}

/* --------------------------------------------------------------- 절 1: 신뢰도 */

/** 연도간 상관 — **시즌쌍마다** 갈라서 낸다. 하나의 평균으로 뭉개지 않는다 */
function reliability(L: Loaded, minN: number): void {
  console.log(`\n=== [1] 파워레벨 신뢰도 — 연도간 상관 (표본 하한 ${minN}) ===`);
  console.log("⚠분모 병기. 2026 은 진행 중(*)이므로 완결 시즌쌍과 분리해 읽어라.");
  const sets: { label: string; t: Tally }[] = [
    { label: "타자 β(Σv/PA)", t: L.batTally },
    { label: "투수 π(Σv/BF)", t: L.pitTally },
  ];
  for (const { label, t } of sets) {
    const lines: string[] = [];
    const rs: number[] = [];
    const rsComplete: number[] = [];
    const poolX: number[] = [], poolY: number[] = [];
    for (let j = 0; j + 1 < SEASONS.length; j += 1) {
      const a = SEASONS[j]!, b = SEASONS[j + 1]!;
      const xs: number[] = [], ys: number[] = [];
      for (const [player, cnts] of t.n) {
        if (cnts[j]! < minN || cnts[j + 1]! < minN) continue;
        const sums = t.sum.get(player)!;
        xs.push(sums[j]! / cnts[j]!);
        ys.push(sums[j + 1]! / cnts[j + 1]!);
      }
      const r = pearson(xs, ys);
      poolX.push(...xs); poolY.push(...ys);
      rs.push(r);
      const partial = IN_PROGRESS.has(a) || IN_PROGRESS.has(b);
      if (!partial) rsComplete.push(r);
      let mark = " ";
      if (partial) mark = "*";
      lines.push(`  ${a}→${b}${mark}  r=${nf(r, 3)}  쌍=${xs.length}`);
    }
    console.log(`\n[${label}]`);
    for (const l of lines) console.log(l);
    console.log(`  --- 폭(전 ${rs.length}쌍): ${nf(Math.min(...rs), 3)} ~ ${nf(Math.max(...rs), 3)} · 중앙 ${nf(median(rs), 3)}`);
    console.log(`  --- 폭(완결 ${rsComplete.length}쌍): ${nf(Math.min(...rsComplete), 3)} ~ ${nf(Math.max(...rsComplete), 3)} · 중앙 ${nf(median(rsComplete), 3)}`);
    console.log(`  --- 전 쌍 풀링: r=${nf(pearson(poolX, poolY), 3)} · 쌍 합계=${poolX.length}`);
  }
}

interface Talent { sd: number; obsSd: number; m: number; totalN: number; withinVar: number }

/**
 * 참 실력 산포(런/타석)의 **적률추정**.
 *
 *   Var(관측, 표본가중) = Var(참) + σ²·m / Σn      (σ² = 타석 하나의 v 분산)
 *
 * 천장 시뮬의 입력이고, 그 자체가 「상대 강약이 원리적으로 얼마나 벌어지는가」의 답이다.
 */
function trueTalentSd(t: Tally, uni: Map<string, Universe>, side: Side, minN: number): Talent {
  let n = 0, s1 = 0, s2 = 0;
  for (const [k, u] of uni) {
    if (!k.endsWith("|" + side)) continue;
    for (let i = 0; i < u.rows; i += 1) {
      if (u.ok[i] === 0) continue;
      n += 1; s1 += u.v[i]!; s2 += u.v[i]! * u.v[i]!;
    }
  }
  const withinVar = s2 / n - (s1 / n) * (s1 / n);

  let totalN = 0, totalSum = 0, m = 0;
  const pts: { x: number; w: number }[] = [];
  for (const [player, cnts] of t.n) {
    const sums = t.sum.get(player)!;
    for (let j = 0; j < SEASONS.length; j += 1) {
      if (cnts[j]! < minN) continue;
      pts.push({ x: sums[j]! / cnts[j]!, w: cnts[j]! });
      totalN += cnts[j]!; totalSum += sums[j]!; m += 1;
    }
  }
  const mu = totalSum / totalN;
  let vobs = 0;
  for (const p of pts) vobs += p.w * (p.x - mu) * (p.x - mu);
  vobs /= totalN;
  const varTrue = vobs - (withinVar * m) / totalN;
  return { sd: Math.sqrt(Math.max(varTrue, 0)), obsSd: Math.sqrt(vobs), m, totalN, withinVar };
}

/* ----------------------------------------------------------- 절 2: 격자탐색 */

const LAM_GRID = [1.0, 0.95, 0.9, 0.85, 0.8, 0.75, 0.7, 0.65, 0.6, 0.55, 0.5, 0.4, 0.3];
const K_GRID = [0, 25, 50, 75, 100, 125, 150, 175, 200, 250, 300, 400, 500, 600, 800, 1000, 1200, 1600, 2000, 3000, 4000];

interface GridOut {
  best: { lam: number; k: number; ratio: number };
  perSeasonRatio: (lam: number, k: number) => number[];
  ratioOf: (lam: number, k: number) => number;
  argminPerSeason: { season: number; lam: number; k: number; ratio: number }[];
  evalN: number; evalRows: number;
}

/**
 * **leave-season-out 예측 격자탐색**(스펙 §3-3).
 *
 * ⚠**유도는 시즌 S 를 빼고 예측한다. 적용(§4-2)은 S 를 포함한다.** 범위가 다르다 —
 * 그 사실 자체를 정의서에 적어야 한다. 여기서 하는 것은 유도 쪽뿐이다.
 * 손실은 표본가중 SSE, 기준선은 0(리그평균) 예측이다.
 */
function grid(t: Tally, minEval: number): GridOut {
  const targets: { player: number; s: number; obs: number; w: number }[] = [];
  for (const [player, cnts] of t.n) {
    const sums = t.sum.get(player)!;
    for (let j = 0; j < SEASONS.length; j += 1) {
      if (cnts[j]! < minEval) continue;
      targets.push({ player, s: j, obs: sums[j]! / cnts[j]!, w: cnts[j]! });
    }
  }
  const bySeason: { player: number; obs: number; w: number }[][] = SEASONS.map(() => []);
  for (const g of targets) bySeason[g.s]!.push({ player: g.player, obs: g.obs, w: g.w });
  const baseBySeason = new Float64Array(SEASONS.length);
  for (const g of targets) baseBySeason[g.s]! += g.w * g.obs * g.obs;

  const cache = new Map<string, Float64Array>();
  const sseOf = (lam: number, k: number): Float64Array => {
    const ck = lam + "|" + k;
    const hit = cache.get(ck);
    if (hit !== undefined) return hit;
    const out = new Float64Array(SEASONS.length);
    for (let j = 0; j < SEASONS.length; j += 1) {
      const lv = powerLevels(t, j, lam, k, true);
      for (const g of bySeason[j]!) {
        const pred = lv.get(g.player) ?? 0;
        out[j]! += g.w * (g.obs - pred) * (g.obs - pred);
      }
    }
    cache.set(ck, out);
    return out;
  };

  const ratioOf = (lam: number, k: number): number => {
    const sse = sseOf(lam, k);
    let a = 0, b = 0;
    for (let j = 0; j < SEASONS.length; j += 1) { a += sse[j]!; b += baseBySeason[j]!; }
    return a / b;
  };
  const perSeasonRatio = (lam: number, k: number): number[] => {
    const sse = sseOf(lam, k);
    return [...sse].map((x, j) => x / baseBySeason[j]!);
  };

  let best = { lam: NaN, k: NaN, ratio: Infinity };
  for (const lam of LAM_GRID) {
    for (const k of K_GRID) {
      const r = ratioOf(lam, k);
      if (r < best.ratio) best = { lam, k, ratio: r };
    }
  }

  const argminPerSeason: { season: number; lam: number; k: number; ratio: number }[] = [];
  for (let j = 0; j < SEASONS.length; j += 1) {
    let bj = { lam: NaN, k: NaN, ratio: Infinity };
    for (const lam of LAM_GRID) {
      for (const k of K_GRID) {
        const r = perSeasonRatio(lam, k)[j]!;
        if (r < bj.ratio) bj = { lam, k, ratio: r };
      }
    }
    argminPerSeason.push({ season: SEASONS[j]!, lam: bj.lam, k: bj.k, ratio: bj.ratio });
  }

  let evalRows = 0;
  for (const g of targets) evalRows += g.w;
  return { best, perSeasonRatio, ratioOf, argminPerSeason, evalN: targets.length, evalRows };
}

function gridSection(L: Loaded, C: Constants, minEval: number): void {
  console.log(`\n=== [2] 수축 상수 재유도 — 9시즌 전량 · leave-season-out 격자탐색 (평가 하한 ${minEval}) ===`);
  console.log(`격자: λ ${LAM_GRID.length}값 × k ${K_GRID.length}값 = ${LAM_GRID.length * K_GRID.length}점`);
  console.log(`  λ: ${LAM_GRID.join(",")}`);
  console.log(`  k: ${K_GRID.join(",")}`);
  console.log("⚠**k=150 을 격자에 넣었다** — 앞선 설계의 채택값이 격자 위에 없었다(스펙 §3-3).");
  const sets: { label: string; t: Tally; adopted: { lam: number; k: number } }[] = [
    { label: "타자 β", t: L.batTally, adopted: { lam: C.lamB, k: C.kB } },
    { label: "투수 π", t: L.pitTally, adopted: { lam: C.lamP, k: C.kP } },
  ];
  for (const { label, t, adopted } of sets) {
    const g = grid(t, minEval);
    console.log(`\n[${label}] 평가 대상 ${g.evalN} 선수-시즌 · 가중 n=${g.evalRows}`);
    for (const lam of LAM_GRID) {
      const cells = K_GRID.filter((k) => k === 0 || (k >= 100 && k <= 1200))
        .map((k) => k + ":" + g.ratioOf(lam, k).toFixed(5));
      console.log(`  lam=${lam.toFixed(2)} ${cells.join(" ")}`);
    }
    console.log(`  BEST lambda=${g.best.lam} k=${g.best.k} ratio=${g.best.ratio.toFixed(5)}`);
    const adoptedRatio = g.ratioOf(adopted.lam, adopted.k);
    console.log(`  채택안 lambda=${adopted.lam} k=${adopted.k} ratio=${adoptedRatio.toFixed(5)}  Δ=${(adoptedRatio - g.best.ratio).toFixed(5)}`);

    const rb = g.perSeasonRatio(g.best.lam, g.best.k);
    const ra = g.perSeasonRatio(adopted.lam, adopted.k);
    const d = ra.map((x, j) => x - rb[j]!);
    const se = sdSample(d) / Math.sqrt(d.length);
    const per = d.map((x, j) => {
      let mark = "";
      if (IN_PROGRESS.has(SEASONS[j]!)) mark = "*";
      return SEASONS[j]! + mark + "=" + x.toFixed(5);
    });
    console.log(`  시즌별 Δ(채택−최적): ${per.join(" ")}`);
    console.log(`  Δ 평균 ${mean(d).toFixed(5)} · 표본sd ${sdSample(d).toFixed(5)} · SE ${se.toFixed(5)} · t=${(mean(d) / se).toFixed(2)} (n=${d.length})`);
    console.log("  시즌별 argmin(격자 최적이 시즌마다 얼마나 흔들리는가):");
    for (const a of g.argminPerSeason) {
      let mark = " ";
      if (IN_PROGRESS.has(a.season)) mark = "*";
      console.log(`    ${a.season}${mark} λ=${a.lam} k=${a.k} ratio=${a.ratio.toFixed(5)}`);
    }
    const lamSpread = g.argminPerSeason.map((a) => a.lam);
    const kSpread = g.argminPerSeason.map((a) => a.k);
    console.log(`    → λ 폭 ${Math.min(...lamSpread)}~${Math.max(...lamSpread)} · k 폭 ${Math.min(...kSpread)}~${Math.max(...kSpread)}`);
    let flat = 0;
    const flatPts: string[] = [];
    for (const lam of LAM_GRID) {
      for (const k of K_GRID) {
        const rr = g.perSeasonRatio(lam, k);
        const dd = rr.map((x, j) => x - rb[j]!);
        const s = sdSample(dd) / Math.sqrt(dd.length);
        if (mean(dd) <= s) {
          flat += 1;
          if (flatPts.length < 30) flatPts.push("λ" + lam + "/k" + k);
        }
      }
    }
    console.log(`  평탄 구간(최적과의 시즌평균 Δ ≤ 시즌간 SE): ${flat}/${LAM_GRID.length * K_GRID.length}점`);
    console.log(`    ${flatPts.join(" ")}`);
    let verdict = "아니오";
    if (mean(d) <= se) verdict = "예";
    console.log(`  → 채택안이 평탄 구간 안인가: ${verdict}`);
  }
}

/* ------------------------------------------------------------ 절 3: 효과 크기 */

interface EffectRow {
  season: number; league: League; group: string;
  n: number; baseSd: number; olSd: number; olMin: number; olMax: number;
  rankMoved: number; maxMove: number; leaderSame: boolean;
  qualLine: string;
}

interface OlOut {
  ol: Map<number, number>;
  base: Map<number, number>;
  den: Map<number, number>;
  barLevel: number;
  used: number;
  noLevel: number;
}

/**
 * OL 을 계산해 돌려준다.
 *
 *   OL_b = Σ_i ( π_{p(i)} − π̄ ),  π̄ = 그 유니버스의 타석가중 평균
 *
 * ⚠**분모는 SRC/SRP 와 같은 타석 집합**(평가된 타석만).
 * ⚠**base 는 subject 가 bat 이면 SRC, pit 이면 SRP**(부호를 뒤집는다 — computeSrp 와 같다).
 */
function olOf(u: Universe, level: Map<number, number>, subject: Side): OlOut {
  const isBat = subject === "bat";
  let sum = 0, used = 0, noLevel = 0;
  for (let i = 0; i < u.rows; i += 1) {
    if (u.ok[i] === 0) continue;
    let o = u.bat[i]!;
    if (isBat) o = u.pit[i]!;
    let lv: number | undefined = undefined;
    if (o >= 0) lv = level.get(o);
    if (lv === undefined) { noLevel += 1; continue; }
    sum += lv; used += 1;
  }
  let bar = 0;
  if (used > 0) bar = sum / used;
  const ol = new Map<number, number>();
  const base = new Map<number, number>();
  const den = new Map<number, number>();
  for (let i = 0; i < u.rows; i += 1) {
    if (u.ok[i] === 0) continue;
    let me = u.pit[i]!;
    let o = u.bat[i]!;
    if (isBat) { me = u.bat[i]!; o = u.pit[i]!; }
    let contrib = -u.v[i]!;
    if (isBat) contrib = u.v[i]!;
    base.set(me, (base.get(me) ?? 0) + contrib);
    den.set(me, (den.get(me) ?? 0) + 1);
    let lv: number | undefined = undefined;
    if (o >= 0) lv = level.get(o);
    if (lv === undefined) continue;
    ol.set(me, (ol.get(me) ?? 0) + (lv - bar));
  }
  for (const k of base.keys()) if (!ol.has(k)) ol.set(k, 0);
  return { ol, base, den, barLevel: bar, used, noLevel };
}

function measure(
  season: number, league: League, group: string,
  rows: readonly { id: string; base: number; adj: number; ol: number }[],
  qualLine: string,
): EffectRow {
  const r1 = rankMap(rows.map((r) => ({ id: r.id, value: r.base })));
  const r2 = rankMap(rows.map((r) => ({ id: r.id, value: r.adj })));
  let moved = 0, maxMove = 0;
  for (const r of rows) {
    const d = Math.abs(r2.get(r.id)! - r1.get(r.id)!);
    if (d > 0) moved += 1;
    if (d > maxMove) maxMove = d;
  }
  const ols = rows.map((r) => r.ol);
  let olMin = NaN, olMax = NaN;
  if (ols.length > 0) { olMin = Math.min(...ols); olMax = Math.max(...ols); }
  if (!sameSet(leadersOf(r1), leadersOf(r2))) {
    console.log("  [1위 변동] " + season + " " + league + " " + group + ": " + [...leadersOf(r1)].join(",") + " -> " + [...leadersOf(r2)].join(","));
  }
  return {
    season, league, group,
    n: rows.length,
    baseSd: sd(rows.map((r) => r.base)),
    olSd: sd(ols),
    olMin, olMax,
    rankMoved: moved, maxMove,
    leaderSame: sameSet(leadersOf(r1), leadersOf(r2)),
    qualLine,
  };
}

function printEffect(rows: readonly EffectRow[]): void {
  for (const g of ["ASRC 타자", "ASRP 선발", "ASRP 구원"]) {
    const mine = rows.filter((r) => r.group === g);
    console.log(`\n[${g}]`);
    console.log("  시즌   리그      자격자  기준sd   OLsd    OL범위             순위이동   최대  1위     자격선");
    for (const r of mine) {
      let mark = " ";
      if (IN_PROGRESS.has(r.season)) mark = "*";
      let lead = "그대로";
      if (!r.leaderSame) lead = "**바뀜**";
      console.log(
        "  " + r.season + mark + " " + r.league.padEnd(8) + " " + String(r.n).padStart(5) +
        "  " + nf(r.baseSd).padStart(6) + "  " + nf(r.olSd).padStart(6) +
        "  [" + nf(r.olMin).padStart(6) + ".." + nf(r.olMax).padStart(6) + "]  " +
        pctOf(r.rankMoved, r.n).padStart(13) + "  " + String(r.maxMove).padStart(4) + "  " +
        lead + "  " + r.qualLine,
      );
    }
    const done = mine.filter((r) => !IN_PROGRESS.has(r.season));
    const flips = mine.filter((r) => !r.leaderSame);
    const flipsDone = done.filter((r) => !r.leaderSame);
    console.log(`  --- 완결 ${done.length} 리그-시즌: 1위 변동 ${flipsDone.length}/${done.length} · OLsd ${nf(Math.min(...done.map((r) => r.olSd)))}~${nf(Math.max(...done.map((r) => r.olSd)))} · 최대이동 ${Math.max(...done.map((r) => r.maxMove))}계단`);
    let flipList = "";
    if (flips.length > 0) flipList = " → " + flips.map((r) => r.season + " " + r.league).join(", ");
    console.log(`  --- ${mine.length} 리그-시즌 전체: 1위 변동 ${flips.length}/${mine.length}${flipList}`);
    let movedSum = 0, nSum = 0;
    for (const r of mine) { movedSum += r.rankMoved; nSum += r.n; }
    console.log(`  --- 순위가 움직인 인원 합계: ${pctOf(movedSum, nSum)}`);
    const ratios = mine.map((r) => (r.olSd / r.baseSd) * 100);
    console.log(`  --- OLsd/기준sd 폭: ${nf(Math.min(...ratios), 1)}% ~ ${nf(Math.max(...ratios), 1)}% · 중앙 ${nf(median(ratios), 1)}%`);
  }
}

function effectSection(raw: DatabaseSync, L: Loaded, C: Constants, mode: string): EffectRow[] {
  const out: EffectRow[] = [];
  let modeLabel = "BF 절단(옛 4개판 비교용)";
  if (mode === "qual") modeLabel = "화면 실물(규정타석/규정투구회)";
  console.log(`\n=== [3] ASRC · ASRP 효과 크기 — 18 리그-시즌 · 자격=${modeLabel} ===`);
  for (let s = 0; s < SEASONS.length; s += 1) {
    const season = SEASONS[s]!;
    const tg = teamGames(raw, season);
    const maxGames = Math.max(...tg.values());
    const beta = powerLevels(L.batTally, s, C.lamB, C.kB);
    const pi = powerLevels(L.pitTally, s, C.lamP, C.kP);
    for (const league of LEAGUES) {
      const myCodes = codesOf(league);
      const gsList = [...tg.entries()].filter((e) => myCodes.includes(e[0])).map((e) => e[1]);
      {
        const u = L.uni.get(ukey(season, league, "bat"))!;
        const res = olOf(u, pi, "bat");
        const q = battersOfLeague(raw, season, league);
        const rows: { id: string; base: number; adj: number; ol: number }[] = [];
        for (const [pidx, src] of res.base) {
          const id = L.ix.ids[pidx]!;
          const qq = q.get(id);
          if (qq === undefined) continue;
          const need = qualifiedBatterPa(tg.get(qq.teamCode) ?? maxGames);
          let ok = res.den.get(pidx)! >= 400;
          if (mode === "qual") ok = qq.pa >= need;
          if (!ok) continue;
          const olv = res.ol.get(pidx)!;
          rows.push({ id, base: src, adj: src - olv, ol: olv });
        }
        const needs = gsList.map(qualifiedBatterPa);
        let line = "PA>=400";
        if (mode === "qual") line = "規定打席 " + Math.min(...needs) + "~" + Math.max(...needs);
        out.push(measure(season, league, "ASRC 타자", rows, line));
        if (res.noLevel > 0) console.log(`  ⚠${season} ${league} 타자: 상대 π 를 못 구한 타석 ${res.noLevel}`);
      }
      {
        const u = L.uni.get(ukey(season, league, "pitch"))!;
        const res = olOf(u, beta, "pitch");
        const q = pitchersOfLeague(raw, season, league);
        const sp: { id: string; base: number; adj: number; ol: number }[] = [];
        const rp: { id: string; base: number; adj: number; ol: number }[] = [];
        for (const [pidx, srp] of res.base) {
          const id = L.ix.ids[pidx]!;
          const qq = q.get(id);
          if (qq === undefined) continue;
          const games = tg.get(qq.teamCode) ?? maxGames;
          const role = roleOf(qq);
          const bf = res.den.get(pidx)!;
          let ok = false;
          if (mode === "qual") {
            let need = qualifiedRelieverOuts(games);
            if (role === "starter") need = qualifiedPitcherOuts(games);
            ok = qq.outs >= need;
          } else if (role === "starter") {
            ok = bf >= 400;
          } else {
            ok = bf >= 100 && bf < 400;
          }
          if (!ok) continue;
          const olv = res.ol.get(pidx)!;
          const row = { id, base: srp, adj: srp + olv, ol: olv };
          if (role === "starter") sp.push(row); else rp.push(row);
        }
        let spLine = "BF>=400";
        let rpLine = "100<=BF<400";
        if (mode === "qual") {
          spLine = "規定投球回 " + Math.min(...gsList.map(qualifiedPitcherOuts)) / 3 + "~" + Math.max(...gsList.map(qualifiedPitcherOuts)) / 3 + "回";
          rpLine = "救援下限 " + Math.min(...gsList.map(qualifiedRelieverOuts)) / 3 + "~" + Math.max(...gsList.map(qualifiedRelieverOuts)) / 3 + "回";
        }
        out.push(measure(season, league, "ASRP 선발", sp, spLine));
        out.push(measure(season, league, "ASRP 구원", rp, rpLine));
        if (res.noLevel > 0) console.log(`  ⚠${season} ${league} 투수: 상대 β 를 못 구한 타석 ${res.noLevel}`);
      }
    }
  }
  printEffect(out);
  return out;
}

/* ---------------------------------------------------------- 절 4: 천장 시뮬 */

interface SimOut { subjects: number; iidSd: number; iidMax: number; structSd: number; structMax: number }

/**
 * 상대 실력을 **완벽히 안다고 가정**했을 때 보정이 얼마나 벌어질 수 있는가.
 *
 * - **iid**: 상대 실력을 서로 독립으로 뽑는다(앞선 설계의 방식). 팀 상관을 무시한다.
 * - **구조보존**: 우리 추정치의 배치를 그대로 두고 참sd 로 스케일만 맞춘다 —
 *   **강타선 팀의 투수는 자기 팀 타선을 절대 안 만난다**는 실제 구조가 남는다.
 */
function simulate(
  u: Universe, subject: Side, isQual: (p: number) => boolean, talentSd: number,
  trials: number, seed: number, level: Map<number, number>,
): SimOut {
  const isBat = subject === "bat";
  const otherAll = new Map<number, number>();
  const bySubject = new Map<number, Map<number, number>>();
  const paOf = new Map<number, number>();
  let total = 0;
  for (let i = 0; i < u.rows; i += 1) {
    if (u.ok[i] === 0) continue;
    let me = u.pit[i]!;
    let other = u.bat[i]!;
    if (isBat) { me = u.bat[i]!; other = u.pit[i]!; }
    if (other < 0) continue;
    otherAll.set(other, (otherAll.get(other) ?? 0) + 1);
    total += 1;
    if (!isQual(me)) continue;
    let m = bySubject.get(me);
    if (m === undefined) { m = new Map(); bySubject.set(me, m); }
    m.set(other, (m.get(other) ?? 0) + 1);
    paOf.set(me, (paOf.get(me) ?? 0) + 1);
  }
  const others = [...otherAll.keys()];
  const idxOf = new Map(others.map((o, i) => [o, i]));
  const weights = new Float64Array(others.length);
  others.forEach((o, i) => { weights[i] = otherAll.get(o)!; });

  const est = new Float64Array(others.length);
  others.forEach((o, i) => { est[i] = level.get(o) ?? 0; });
  let em = 0, ev = 0;
  for (let i = 0; i < others.length; i += 1) em += est[i]! * weights[i]!;
  em /= total;
  for (let i = 0; i < others.length; i += 1) ev += weights[i]! * (est[i]! - em) * (est[i]! - em);
  ev = Math.sqrt(ev / total);
  let scale = 0;
  if (ev > 0) scale = talentSd / ev;
  const struct = new Float64Array(others.length);
  for (let i = 0; i < others.length; i += 1) struct[i] = (est[i]! - em) * scale;

  const rng = makeRng(seed);
  const normal = makeNormal(rng);
  const subjects = [...bySubject.keys()];
  const runOne = (skill: Float64Array): { sd: number; max: number } => {
    let mu = 0;
    for (let i = 0; i < others.length; i += 1) mu += skill[i]! * weights[i]!;
    mu /= total;
    const adj: number[] = [];
    let mx = 0;
    for (const sub of subjects) {
      let a = 0;
      for (const [o, c] of bySubject.get(sub)!) a += c * skill[idxOf.get(o)!]!;
      a -= paOf.get(sub)! * mu;
      adj.push(a);
      if (Math.abs(a) > mx) mx = Math.abs(a);
    }
    return { sd: sd(adj), max: mx };
  };

  let iidSdSum = 0, iidMax = 0;
  const skill = new Float64Array(others.length);
  for (let t = 0; t < trials; t += 1) {
    for (let i = 0; i < others.length; i += 1) skill[i] = normal() * talentSd;
    const r = runOne(skill);
    iidSdSum += r.sd;
    if (r.max > iidMax) iidMax = r.max;
  }
  const st = runOne(struct);
  return { subjects: subjects.length, iidSd: iidSdSum / trials, iidMax, structSd: st.sd, structMax: st.max };
}

function ceilingSection(raw: DatabaseSync, L: Loaded, C: Constants, trials: number, seed: number): void {
  console.log(`\n=== [4] 천장 시뮬 — 상대 실력을 **완벽히 안다고 가정** · 18 리그-시즌 · ${trials}회 시행 ===`);
  const talP = trueTalentSd(L.pitTally, L.uni, "pitch", 100);
  const talB = trueTalentSd(L.batTally, L.uni, "bat", 100);
  console.log("참 실력 산포(적률추정 · 100타석 이상 선수-시즌):");
  console.log(`  투수 π: 참sd=${talP.sd.toFixed(4)} 런/BF (관측sd ${talP.obsSd.toFixed(4)} · 선수-시즌 ${talP.m} · n합 ${talP.totalN} · 타석내분산 ${talP.withinVar.toFixed(4)})`);
  console.log(`  타자 β: 참sd=${talB.sd.toFixed(4)} 런/PA (관측sd ${talB.obsSd.toFixed(4)} · 선수-시즌 ${talB.m} · n합 ${talB.totalN} · 타석내분산 ${talB.withinVar.toFixed(4)})`);

  for (let s = 0; s < SEASONS.length; s += 1) {
    const season = SEASONS[s]!;
    const tg = teamGames(raw, season);
    const maxGames = Math.max(...tg.values());
    const beta = powerLevels(L.batTally, s, C.lamB, C.kB);
    const pi = powerLevels(L.pitTally, s, C.lamP, C.kP);
    for (const league of LEAGUES) {
      let mark = " ";
      if (IN_PROGRESS.has(season)) mark = "*";
      {
        const u = L.uni.get(ukey(season, league, "bat"))!;
        const q = battersOfLeague(raw, season, league);
        const isQual = (pidx: number): boolean => {
          const qq = q.get(L.ix.ids[pidx]!);
          if (qq === undefined) return false;
          return qq.pa >= qualifiedBatterPa(tg.get(qq.teamCode) ?? maxGames);
        };
        let off = 1;
        if (league === "central") off = 0;
        const r = simulate(u, "bat", isQual, talP.sd, trials, seed + s * 7 + off, pi);
        console.log(`  ${season}${mark} ${league.padEnd(8)} 타자측(ASRC) 자격 ${String(r.subjects).padStart(3)}명: iid sd=${nf(r.iidSd)} max=${nf(r.iidMax)} · 구조보존 sd=${nf(r.structSd)} max=${nf(r.structMax)}`);
      }
      {
        const u = L.uni.get(ukey(season, league, "pitch"))!;
        const q = pitchersOfLeague(raw, season, league);
        const isQual = (pidx: number): boolean => {
          const qq = q.get(L.ix.ids[pidx]!);
          if (qq === undefined) return false;
          if (roleOf(qq) !== "starter") return false;
          return qq.outs >= qualifiedPitcherOuts(tg.get(qq.teamCode) ?? maxGames);
        };
        let off = 1;
        if (league === "central") off = 0;
        const r = simulate(u, "pitch", isQual, talB.sd, trials, seed + 1000 + s * 7 + off, beta);
        console.log(`  ${season}${mark} ${league.padEnd(8)} 투수측(ASRP선발) 자격 ${String(r.subjects).padStart(3)}명: iid sd=${nf(r.iidSd)} max=${nf(r.iidMax)} · 구조보존 sd=${nf(r.structSd)} max=${nf(r.structMax)}`);
      }
    }
  }
  console.log("⚠**iid** = 상대 실력을 서로 독립으로 뽑는다(앞선 설계의 방식). 팀 타선·팀 투수진의 상관을 무시한다.");
  console.log("⚠**구조보존** = 우리 추정치의 배치를 그대로 두고 참sd 로 스케일만 맞춘다. **우리가 더한 것이다.**");
}

/* ------------------------------------------------------------ 절 5: 불변식 */

function invariantSection(L: Loaded, C: Constants): void {
  console.log("\n=== [5] 불변식 Σ OL = 0 — 18 리그-시즌 전부 ===");
  console.log("⚠중심화의 **따름정리**다. 성립하면 「보정은 리그 안에서 주고받을 뿐 런을 만들지도 없애지도 않는다」.");
  let worstBat = 0, worstPit = 0;
  for (let s = 0; s < SEASONS.length; s += 1) {
    const season = SEASONS[s]!;
    const beta = powerLevels(L.batTally, s, C.lamB, C.kB);
    const pi = powerLevels(L.pitTally, s, C.lamP, C.kP);
    for (const league of LEAGUES) {
      const b = olOf(L.uni.get(ukey(season, league, "bat"))!, pi, "bat");
      const p = olOf(L.uni.get(ukey(season, league, "pitch"))!, beta, "pitch");
      let sb = 0, sp = 0, srcSum = 0;
      for (const v of b.ol.values()) sb += v;
      for (const v of p.ol.values()) sp += v;
      for (const v of b.base.values()) srcSum += v;
      const asrcSum = srcSum - sb;
      worstBat = Math.max(worstBat, Math.abs(sb));
      worstPit = Math.max(worstPit, Math.abs(sp));
      let mark = " ";
      if (IN_PROGRESS.has(season)) mark = "*";
      console.log(
        "  " + season + mark + " " + league.padEnd(8) +
        " ΣOL(타자)=" + sb.toExponential(3) + " ΣOL(투수)=" + sp.toExponential(3) +
        " | ΣSRC=" + srcSum.toFixed(6) + " ΣASRC=" + asrcSum.toFixed(6) +
        " 차=" + (asrcSum - srcSum).toExponential(3),
      );
    }
  }
  console.log(`  --- 18/18 최대 |ΣOL|: 타자 ${worstBat.toExponential(3)} · 투수 ${worstPit.toExponential(3)}`);
}

/* -------------------------------------------------------------- 절 6: 사례 */

/** 그 선수가 **어느 팀을 몇 타석 상대했는가**. 사례 설명의 근거다 */
function opponentTeams(raw: DatabaseSync, ix: Interner, season: number, league: League, side: Side): Map<number, Map<string, number>> {
  let oppExpr = BAT_TEAM;
  let meExpr = "e.pitcher_id";
  let myTeam = PIT_TEAM;
  if (side === "bat") { oppExpr = PIT_TEAM; meExpr = "e.batter_id"; myTeam = BAT_TEAM; }
  const sql = [
    "SELECT " + meExpr + " AS pid, " + oppExpr + " AS opp, COUNT(*) AS n",
    "FROM pa_event e JOIN game g ON g.game_id = e.game_id",
    "WHERE g.season = ? AND g.status = 'played' AND g.competition = ? AND e.status = 'final'",
    "  AND " + meExpr + " IS NOT NULL AND " + myTeam + " IN " + inList(codesOf(league)),
    "GROUP BY pid, opp",
  ].join("\n");
  const rows = raw.prepare(sql).all(season, COMPETITION) as unknown as
    { pid: string; opp: string; n: number }[];
  const out = new Map<number, Map<string, number>>();
  for (const r of rows) {
    const i = ix.index(r.pid);
    let m = out.get(i);
    if (m === undefined) { m = new Map(); out.set(i, m); }
    m.set(r.opp, r.n);
  }
  return out;
}

/** 팀별 파워레벨 평균(타석가중). 12팀 전부 — 교류전 상대도 설명해야 하기 때문이다 */
function teamLevels(raw: DatabaseSync, ix: Interner, season: number, level: Map<number, number>, side: Side): Map<string, { s: number; n: number }> {
  let teamExpr = PIT_TEAM;
  let meExpr = "e.pitcher_id";
  if (side === "bat") { teamExpr = BAT_TEAM; meExpr = "e.batter_id"; }
  const sql = [
    "SELECT " + teamExpr + " AS team, " + meExpr + " AS pid, COUNT(*) AS n",
    "FROM pa_event e JOIN game g ON g.game_id = e.game_id",
    "WHERE g.season = ? AND g.status = 'played' AND g.competition = ? AND e.status = 'final'",
    "  AND " + meExpr + " IS NOT NULL",
    "GROUP BY team, pid",
  ].join("\n");
  const rows = raw.prepare(sql).all(season, COMPETITION) as unknown as
    { team: string; pid: string; n: number }[];
  const out = new Map<string, { s: number; n: number }>();
  for (const r of rows) {
    const v = level.get(ix.index(r.pid));
    if (v === undefined) continue;
    const cur = out.get(r.team) ?? { s: 0, n: 0 };
    cur.s += v * r.n; cur.n += r.n;
    out.set(r.team, cur);
  }
  return out;
}

function fmtTeamLevels(m: Map<string, { s: number; n: number }>, codes: readonly string[]): string {
  const rows = [...m.entries()].filter((e) => codes.includes(e[0]));
  rows.sort((a, b) => b[1].s / b[1].n - a[1].s / a[1].n);
  return rows.map((e) => e[0] + "=" + (e[1].s / e[1].n).toFixed(4)).join(" ");
}

function casesSection(raw: DatabaseSync, L: Loaded, C: Constants, top: number, only: readonly number[]): void {
  console.log(`\n=== [6] 설명 가능한 사례 — |OL| 상위 ${top} (완결 시즌) ===`);
  for (let s = 0; s < SEASONS.length; s += 1) {
    const season = SEASONS[s]!;
    if (IN_PROGRESS.has(season)) continue;
    if (only.length > 0 && !only.includes(season)) continue;
    const tg = teamGames(raw, season);
    const maxGames = Math.max(...tg.values());
    const beta = powerLevels(L.batTally, s, C.lamB, C.kB);
    const pi = powerLevels(L.pitTally, s, C.lamP, C.kP);
    const tBeta = teamLevels(raw, L.ix, season, beta, "bat");
    const tPi = teamLevels(raw, L.ix, season, pi, "pitch");
    const allCodes = TEAMS.map((t) => t.code);
    console.log(`\n  --- ${season} 팀 타선 β̄: ${fmtTeamLevels(tBeta, allCodes)}`);
    console.log(`      ${season} 팀 투수 π̄(높을수록 많이 내준다): ${fmtTeamLevels(tPi, allCodes)}`);
    for (const league of LEAGUES) {
      {
        const res = olOf(L.uni.get(ukey(season, league, "pitch"))!, beta, "pitch");
        const q = pitchersOfLeague(raw, season, league);
        const cand: { pidx: number; ol: number; srp: number; bf: number }[] = [];
        for (const [pidx, srp] of res.base) {
          const qq = q.get(L.ix.ids[pidx]!);
          if (qq === undefined) continue;
          if (roleOf(qq) !== CASE_ROLE) continue;
          let needOuts = qualifiedRelieverOuts(tg.get(qq.teamCode) ?? maxGames);
          if (CASE_ROLE === "starter") needOuts = qualifiedPitcherOuts(tg.get(qq.teamCode) ?? maxGames);
          if (qq.outs < needOuts) continue;
          cand.push({ pidx, ol: res.ol.get(pidx)!, srp, bf: res.den.get(pidx)! });
        }
        cand.sort((a, b) => Math.abs(b.ol) - Math.abs(a.ol));
        const opp = opponentTeams(raw, L.ix, season, league, "pitch");
        for (const c of cand.slice(0, top)) {
          const id = L.ix.ids[c.pidx]!;
          const oppMap = opp.get(c.pidx) ?? new Map<string, number>();
          const detail = [...oppMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map((e) => {
            const tb = tBeta.get(e[0]);
            let bv = "?";
            if (tb !== undefined) bv = (tb.s / tb.n).toFixed(4);
            return e[0] + " " + e[1] + "타석(β̄ " + bv + ")";
          }).join(" · ");
          const qq = q.get(id)!;
          console.log(`      [투수] ${(L.names.get(id) ?? id).padEnd(10)} ${qq.teamCode.padEnd(3)} SRP=${nf(c.srp)} OL=${nf(c.ol)} → ASRP=${nf(c.srp + c.ol)} (BF ${c.bf}) | 최다상대 ${detail}`);
        }
      }
      {
        const res = olOf(L.uni.get(ukey(season, league, "bat"))!, pi, "bat");
        const q = battersOfLeague(raw, season, league);
        const cand: { pidx: number; ol: number; src: number; pa: number }[] = [];
        for (const [pidx, src] of res.base) {
          const qq = q.get(L.ix.ids[pidx]!);
          if (qq === undefined) continue;
          if (qq.pa < qualifiedBatterPa(tg.get(qq.teamCode) ?? maxGames)) continue;
          cand.push({ pidx, ol: res.ol.get(pidx)!, src, pa: res.den.get(pidx)! });
        }
        cand.sort((a, b) => Math.abs(b.ol) - Math.abs(a.ol));
        const opp = opponentTeams(raw, L.ix, season, league, "bat");
        for (const c of cand.slice(0, top)) {
          const id = L.ix.ids[c.pidx]!;
          const oppMap = opp.get(c.pidx) ?? new Map<string, number>();
          const detail = [...oppMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map((e) => {
            const tp = tPi.get(e[0]);
            let pv = "?";
            if (tp !== undefined) pv = (tp.s / tp.n).toFixed(4);
            return e[0] + " " + e[1] + "타석(π̄ " + pv + ")";
          }).join(" · ");
          const qq = q.get(id)!;
          console.log(`      [타자] ${(L.names.get(id) ?? id).padEnd(10)} ${qq.teamCode.padEnd(3)} SRC=${nf(c.src)} OL=${nf(c.ol)} → ASRC=${nf(c.src - c.ol)} (PA ${c.pa}) | 최다상대 ${detail}`);
        }
      }
    }
  }
}

/* -------------------------------------------------------------------- 본체 */

function main(): void {
  const parsed = parseArgs({
    allowPositionals: true,
    options: {
      lamB: { type: "string" }, kB: { type: "string" },
      lamP: { type: "string" }, kP: { type: "string" },
      trials: { type: "string" }, seed: { type: "string" },
      minPair: { type: "string" }, minEval: { type: "string" },
      top: { type: "string" }, caseSeasons: { type: "string" }, role: { type: "string" },
    },
  });
  const values = parsed.values;
  const path = parsed.positionals[0] ?? "data/bb.sqlite";
  const section = parsed.positionals[1] ?? "all";
  const C: Constants = {
    lamB: Number(values.lamB ?? 0.8), kB: Number(values.kB ?? 150),
    lamP: Number(values.lamP ?? 0.7), kP: Number(values.kP ?? 800),
  };
  const trials = Number(values.trials ?? 200);
  const seed = Number(values.seed ?? 20260820);
  const minPair = Number(values.minPair ?? 300);
  const minEval = Number(values.minEval ?? 50);
  const top = Number(values.top ?? 2);
  if (values.role === "reliever") CASE_ROLE = "reliever";
  const caseSeasons = (values.caseSeasons ?? "").split(",").filter((x) => x !== "").map(Number);

  const t0 = process.hrtime.bigint();
  const opened = openReadOnly(path);
  const raw = opened.raw;
  console.log(`DB=${path} (readOnly) · 시즌 ${SEASONS[0]}~${SEASONS[SEASONS.length - 1]} · 대회=${COMPETITION} 만`);
  console.log(`상수: λ_B=${C.lamB} k_B=${C.kB} · λ_P=${C.lamP} k_P=${C.kP} · seed=${seed}`);
  const L = loadAll(raw, opened.db);
  const t1 = process.hrtime.bigint();
  let batValued = 0, pitValued = 0;
  for (const [k, u] of L.uni) {
    if (k.endsWith("|bat")) batValued += u.valued; else pitValued += u.valued;
  }
  console.log(`적재: 행 ${L.totals.rows} · 평가 ${L.totals.valued} · 미계산 ${L.totals.skipped} · 투수미상 ${L.totals.unknownPitcher} · ${(Number(t1 - t0) / 1e9).toFixed(1)}s`);
  console.log(`⚠**두 유니버스의 합이다**. 타격 유니버스 ${batValued} · 투구 유니버스 ${pitValued}`);
  console.log(`선수: 타자 ${L.batTally.n.size}명 · 투수 ${L.pitTally.n.size}명`);

  const wants = (name: string): boolean => section === "all" || section === name;
  if (wants("reliability")) reliability(L, minPair);
  if (wants("grid")) gridSection(L, C, minEval);
  if (wants("effect")) { effectSection(raw, L, C, "qual"); effectSection(raw, L, C, "bf"); }
  if (wants("ceiling")) ceilingSection(raw, L, C, trials, seed);
  if (wants("invariant")) invariantSection(L, C);
  if (wants("cases")) casesSection(raw, L, C, top, caseSeasons);

  const t2 = process.hrtime.bigint();
  console.log(`\nTOTAL ${(Number(t2 - t0) / 1e9).toFixed(1)}s`);
  raw.close();
}

main();
