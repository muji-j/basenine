/**
 * **외부 대조 도구(`tools/crosscheck.ts`)를 실제로 돌리는 시험의 재료** — 임시 DB 와 임시 공표표(시험 전용 헬퍼).
 *
 * 쓰는 곳: `crosscheck-gate-unchanged.test.ts`(관문 출력이 바이트 단위로 그대로인가) ·
 * `crosscheck-emit.test.ts`(감지 모드 `--emit` 의 계약 · 설계 `docs/superpowers/specs/2026-10-02-correction-auto-refetch-design.md` D2).
 *
 * ⚠**외부 요청 0 · 실데이터 0** — 경기·선수·공표표가 전부 여기서 만든 합성 값이다(이름은 지어낸 표기다).
 * ⚠**공표표를 합성해도 「아무것도 안 재는 초록」이 아니다** — 성적표 파서는 헤더 24·23열만 보고 행을 칸으로 자르는
 *   단순한 파서이고(`packages/parser/test/stats.test.ts` 도 같은 모양으로 만든다), 이 재료를 쓰는 시험은
 *   **「대조한 선수 N명」을 문장째로** 단정한다 — 파서가 행을 못 읽으면 그 줄이 갈려 붉어진다.
 *
 * ## 재료의 뼈대 — 이번 사고(설계 §1)를 줄인 모양
 *
 * 阪神(t)의 投 髙橋(`91095136`)가 暴投 3(5/13 · 9/17 · 9/23 하나씩)인데 공표는 2 다.
 * 그 둘레에 관문이 실제로 마주치는 갈래를 하나씩 둔다:
 *
 * | 무엇 | 왜 넣었나 |
 * |---|---|
 * | 기준일(9/28) 뒤 경기 · 오픈전(3/15) · 클라이맥스(10/10) · 치르지 않은 경기(6/1) | 범위 조각이 넷을 다 빼는가(빼지 못하면 합이 달라져 문장이 갈린다) — ⚠오픈전과 치르지 않은 경기는 **기준일 앞**이라 대회·상태 조건을 날짜와 따로 잰다 |
 * | 이적 선수(t 한 경기 · s 한 경기) | 「그 팀 쪽」 조건 — 두 팀 행이 서로 섞이지 않는가 |
 * | 打 森下의 安打 4 대 공표 5 | 대상 항목(o<p)과 그에 딸린 비율 셋(대상 아님) |
 * | 投 戸郷의 暴投·ボーク 가 전부 NULL | 우리 값이 `"null"` 로 나가는 자리(M11 — 0 으로 메우지 않는다) |
 * | 打 試合 · 0타수 타율 · 아웃 0 등판의 「+」·「----」 | 정의 차이로 접히는 넷 |
 * | 짝 없는 우리 선수 · 짝 없는 공표 선수 · 시즌 표시명이 다른 선수 | 이름 짝짓기의 세 갈래 |
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { openDb, upsertGame, upsertPlayer, upsertPlayerSeasonName } from "@bb-app/store";
import { TEAMS } from "@bb-app/domain";

export const TOOL = fileURLToPath(new URL("../tools/crosscheck.ts", import.meta.url));
export const SEASON = 2026;
/** 공표표가 적는 기준일(`2026年9月28日 現在`) */
export const AS_OF = "2026-09-28";
const NOW = "2026-10-02T00:00:00.000Z";

/** 공표표 한 장의 이름 — `idb1_t` 처럼 */
export type TableName = `${"idb1" | "idp1"}_${string}`;
/** 기대하는 24장(12구단 × 타격·투구) */
export const ALL_TABLES: readonly TableName[] = TEAMS.flatMap((t) => [`idb1_${t.code}`, `idp1_${t.code}`] as TableName[]);

export interface ScenarioOptions {
  /** 표마다 적을 「現在」 날짜(`YYYY-MM-DD`). `null` 이면 그 표에 문구가 없다. 기본: 전부 `AS_OF` */
  asOf?: (table: TableName) => string | readonly string[] | null;
  /** 아카이브에 두지 않을 표 */
  missing?: readonly TableName[];
  /** 헤더를 망가뜨릴 표(열 두 개의 순서를 바꾼다 — 파서가 던진다) */
  broken?: readonly TableName[];
  /** 공표값을 우리 값에 맞춘다 — 결함 후보 0 인 재료 */
  clean?: boolean;
  /** `npb/stats/<시즌>` 디렉터리 자체를 만들지 않는다(공표표 0장) */
  noStats?: boolean;
}

export interface Scenario {
  dir: string;
  db: string;
  archive: string;
  cleanup(): void;
}

// ── 우리 쪽(DB) ──────────────────────────────────────────────────────────────

interface GameDef {
  id: string;
  date: string;
  home: string;
  away: string;
  no: number;
  status?: "played" | "notPlayed";
  competition?: string;
}

/** ⚠슬러그는 `{홈}-{원정}-{번호}` 다(`packages/store/src/game-slug.ts`) */
const GAMES: readonly GameDef[] = [
  /**
   * ⚠정규시즌이 아니다(오픈전) — **기준일 앞**이라 대회 조건만이 이것을 뺀다.
   * 클라이맥스(10/10)는 기준일 뒤라 날짜 조건이 먼저 빼 버려서 대회 조건을 따로 재지 못한다(변이 시험에서 실측).
   */
  { id: "2026/0315/t-s-01", date: "2026-03-15", home: "t", away: "s", no: 1, competition: "preseason" },
  { id: "2026/0513/s-t-08", date: "2026-05-13", home: "s", away: "t", no: 8 },
  /** ⚠치르지 않은 경기 — 기준일 앞이라 상태 조건만이 이것을 뺀다(행이 있을 리 없지만 조건을 따로 재려고 심는다) */
  { id: "2026/0601/t-d-10", date: "2026-06-01", home: "t", away: "d", no: 10, status: "notPlayed" },
  { id: "2026/0917/t-c-20", date: "2026-09-17", home: "t", away: "c", no: 20 },
  { id: "2026/0920/g-db-21", date: "2026-09-20", home: "g", away: "db", no: 21 },
  { id: "2026/0923/s-t-23", date: "2026-09-23", home: "s", away: "t", no: 23 },
  /** ⚠기준일(9/28) 뒤 — 범위 조각이 빼야 한다 */
  { id: "2026/0929/g-t-24", date: "2026-09-29", home: "g", away: "t", no: 24 },
  /** ⚠정규시즌이 아니다 — 범위 조각이 빼야 한다 */
  { id: "2026/1010/t-g-01", date: "2026-10-10", home: "t", away: "g", no: 1, competition: "climax" },
];

/** [player_id, player.display_name, 그 시즌 표시명(없으면 null)] */
const PLAYERS: readonly (readonly [string, string, string | null])[] = [
  ["00000101", "森下", null],
  ["00000102", "佐藤", null],
  ["00000103", "中野", null],
  ["00000201", "清宮", null],
  ["00000202", "戸郷", null],
  ["00000301", "村上", null],
  /** ⚠기본명이 아니라 **그 시즌 이름**으로 짝지어야 한다(도구가 `seasonNameExpr` 를 쓴다) */
  ["00000401", "トレード旧", "トレード"],
  ["91095136", "髙橋", null],
];

/** 타격 한 줄: game, player, side, pa ab h d2 d3 hr bb ibb hbp sf sh so roe runs rbi sb */
type BatRow = readonly [string, string, "away" | "home", ...number[]];
const BATTING: readonly BatRow[] = [
  // 森下(t) — 정규·범위 안 세 경기 합: 13 11 4 1 0 1 1 0 0 1 0 1 0 1 3 1
  ["2026/0513/s-t-08", "00000101", "away", 4, 4, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0],
  ["2026/0917/t-c-20", "00000101", "home", 5, 4, 2, 1, 0, 1, 1, 0, 0, 0, 0, 0, 0, 1, 2, 1],
  ["2026/0923/s-t-23", "00000101", "away", 4, 3, 1, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0],
  ["2026/0929/g-t-24", "00000101", "away", 4, 4, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  ["2026/1010/t-g-01", "00000101", "home", 4, 4, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  // ⚠범위 밖(오픈전 · 치르지 않은 경기) — 세면 森下의 합이 달라져 문장이 갈린다
  ["2026/0315/t-s-01", "00000101", "home", 5, 5, 5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  ["2026/0601/t-d-10", "00000101", "home", 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  // 佐藤(t) — 0타수(볼넷 하나)
  ["2026/0917/t-c-20", "00000102", "home", 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  // 中野(t) — 공표표에 없다(짝 없는 우리 선수)
  ["2026/0513/s-t-08", "00000103", "away", 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0],
  // トレード — t 로 한 경기, s 로 한 경기(이적)
  ["2026/0513/s-t-08", "00000401", "away", 3, 3, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0],
  ["2026/0923/s-t-23", "00000401", "home", 4, 4, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0],
  // 村上(s)
  ["2026/0513/s-t-08", "00000301", "home", 4, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0],
];

/** 투구 한 줄: game, player, side, decision, outs bf h hr bb hbp so runs er, wp, balk */
type PitRow = readonly [string, string, "away" | "home", string | null, ...(number | null)[]];
function pitching(clean: boolean): readonly PitRow[] {
  return [
    // 髙橋(t) — 정규·범위 안 세 경기 합: 아웃 27 · 피안타 5 · 피홈런 1 · 사구 2 · 삼진 8 · 실점 2 · 자책 2 · 暴投 3
    ["2026/0513/s-t-08", "91095136", "away", null, 6, 8, 1, 0, 1, 0, 2, 0, 0, 1, 0],
    ["2026/0917/t-c-20", "91095136", "home", "○", 18, 22, 4, 1, 1, 0, 5, 2, 2, 1, 0],
    ["2026/0923/s-t-23", "91095136", "away", null, 3, 3, 0, 0, 0, 0, 1, 0, 0, 1, 0],
    ["2026/0929/g-t-24", "91095136", "away", null, 3, 4, 1, 0, 0, 0, 0, 0, 0, 1, 0],
    // ⚠범위 밖(오픈전 · 치르지 않은 경기) — 세면 暴投 가 5 · 6 이 된다
    ["2026/0315/t-s-01", "91095136", "home", null, 6, 7, 1, 0, 0, 0, 1, 0, 0, 2, 0],
    ["2026/0601/t-d-10", "91095136", "home", null, 3, 3, 0, 0, 0, 0, 0, 0, 0, 1, 0],
    // 清宮(g) — 아웃을 하나도 못 잡은 등판(공표 「+」·「----」)
    ["2026/0920/g-db-21", "00000201", "home", null, 0, 3, 2, 0, 1, 0, 0, 1, 1, 0, 0],
    // 戸郷(g) — 暴投·ボーク 가 결측(NULL)이면 우리 합이 null 이다(clean 이면 0)
    ["2026/0920/g-db-21", "00000202", "home", "○", 27, 30, 3, 0, 1, 1, 9, 0, 0, clean ? 0 : null, clean ? 0 : null],
  ];
}

// ── 공표 쪽(성적표) ──────────────────────────────────────────────────────────

/** 실측 헤더(2026-08-16 · `packages/parser/test/stats.test.ts` 와 같다) */
const BAT_HEADER =
  "選手,試合,打席,打数,得点,安打,二塁打,三塁打,本塁打,塁打,打点,盗塁,盗塁刺,犠打,犠飛,四球,故意四,死球,三振,併殺打,打率,長打率,出塁率";
const PIT_HEADER =
  "選手,登板,勝利,敗北,セーブ,ホールド,ＨＰ,完投,完封勝,無四球,勝率,打者,投球回,安打,本塁打,四球,故意四,死球,三振,暴投,ボーク,失点,自責点,防御率";

function publishedRows(table: TableName, clean: boolean): string[] {
  switch (table) {
    case "idb1_t":
      return [
        clean
          ? "森下 翔太,4,13,11,1,4,1,0,1,8,3,1,0,0,1,1,0,0,1,0,.364,.727,.385"
          : "森下 翔太,4,13,11,1,5,1,0,1,9,3,1,0,0,1,1,0,0,1,0,.455,.818,.462",
        "<sup>*</sup>佐藤 輝明,1,1,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,.000,.000,1.000",
        "トレード,1,3,3,0,1,0,0,0,1,0,0,0,0,0,0,0,0,1,0,.333,.333,.333",
        "大山 悠輔,10,40,35,5,10,2,0,3,21,8,0,0,0,1,4,0,0,8,1,.286,.600,.350",
      ];
    case "idb1_s":
      return [
        "村上 宗隆,1,4,4,0,0,0,0,0,0,0,0,0,0,0,0,0,0,2,0,.000,.000,.000",
        "トレード,1,4,4,1,2,0,0,0,2,1,0,0,0,0,0,0,0,0,0,.500,.500,.500",
      ];
    case "idp1_t":
      return [`髙橋 遥人,3,1,0,0,0,0,0,0,0,1.000,33,9,5,1,2,0,0,8,${clean ? 3 : 2},0,2,2,2.00`];
    case "idp1_g":
      return [
        "清宮 虎多朗,1,0,0,0,0,0,0,0,0,.000,3,+,2,0,1,0,0,0,0,0,1,1,----",
        "戸郷 翔征,1,1,0,0,0,0,1,1,0,1.000,30,9,3,0,1,0,1,9,0,0,0,0,0.00",
      ];
    default:
      return [];
  }
}

function jpDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${y!}年${Number(m)}月${Number(d)}日 現在`;
}

function tableHtml(table: TableName, opts: ScenarioOptions): string {
  const tr = (cells: string, tag: "th" | "td"): string =>
    `<tr>${cells.split(",").map((c) => `<${tag}>${c}</${tag}>`).join("")}</tr>`;
  let header = table.startsWith("idb1") ? BAT_HEADER : PIT_HEADER;
  // ⚠헤더를 망가뜨린다 — 타격표는 열 순서 검사(`헤더가 예상과 다르다`), 투구표는 열 이름 검사(`열이 없다`)에 걸린다
  if (opts.broken?.includes(table)) header = header.replace("打席,打数", "打数,打席").replace("暴投", "暴投X");
  const asOf = opts.asOf === undefined ? AS_OF : opts.asOf(table);
  const dates = asOf === null ? [] : typeof asOf === "string" ? [asOf] : asOf;
  const banner = dates.map((d) => `<p class="asof">${jpDate(d)}</p>`).join("\n");
  const rows = publishedRows(table, opts.clean === true).map((r) => tr(r, "td")).join("");
  return [
    "<!DOCTYPE html>",
    '<html lang="ja"><head><meta charset="utf-8"><title>合成</title></head><body>',
    banner,
    `<table class="tablefix2">${tr(header, "th")}${rows}</table>`,
    "</body></html>",
  ].join("\n");
}

// ── 조립 ─────────────────────────────────────────────────────────────────────

export function buildScenario(opts: ScenarioOptions = {}): Scenario {
  const dir = mkdtempSync(join(tmpdir(), "bb-crosscheck-"));
  const db = join(dir, "bb.sqlite");
  const archive = join(dir, "archive");
  mkdirSync(archive, { recursive: true });

  const d = openDb(db, NOW);
  try {
    for (const g of GAMES) {
      upsertGame(d, {
        gameId: g.id,
        season: SEASON,
        gameDate: g.date,
        awayCode: g.away,
        homeCode: g.home,
        gameNo: g.no,
        status: g.status ?? "played",
        notPlayedReason: g.status === "notPlayed" ? "雨天中止" : null,
        competition: g.competition ?? "regular",
        sourceUrl: `https://npb.jp/scores/${g.id}/`,
        fetchedAt: NOW,
      });
    }
    for (const [id, name, seasonName] of PLAYERS) {
      upsertPlayer(d, id, name, NOW);
      if (seasonName !== null) upsertPlayerSeasonName(d, id, SEASON, seasonName, "2026-09-23", "box");
    }
    const bat = d.raw.prepare(
      `INSERT INTO batting_line (game_id, player_id, side, pa, ab, h, d2, d3, hr, bb, ibb, hbp, sf, sh, so, roe, runs, rbi, sb)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const r of BATTING) bat.run(...r);
    const pit = d.raw.prepare(
      `INSERT INTO pitching_line (game_id, player_id, side, decision, outs, bf, h, hr, bb, hbp, so, runs, er, wp, balk)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const r of pitching(opts.clean === true)) pit.run(...r);
  } finally {
    d.close();
  }

  if (opts.noStats !== true) {
    const statsDir = join(archive, "npb", "stats", String(SEASON));
    mkdirSync(statsDir, { recursive: true });
    for (const t of ALL_TABLES) {
      if (opts.missing?.includes(t)) continue;
      writeFileSync(join(statsDir, `${t}.html.gz`), gzipSync(Buffer.from(tableHtml(t, opts), "utf8")));
    }
  }

  return {
    dir,
    db,
    archive,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

export interface ToolRun {
  /** 종료코드. 신호로 죽었으면 null */
  code: number | null;
  stdout: string;
  stderr: string;
}

/** 도구를 자식 프로세스로 돌린다(외부 요청 0 — 임시 DB·임시 아카이브만 읽는다) */
export function runTool(s: Scenario, extra: readonly string[] = []): ToolRun {
  const r = spawnSync(process.execPath, [TOOL, s.db, String(SEASON), "--archive", s.archive, ...extra], {
    encoding: "utf8",
  });
  if (r.error !== undefined) throw r.error;
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}
