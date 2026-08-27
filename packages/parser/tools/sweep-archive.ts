/**
 * 아카이브 전체에 파서를 돌려 **자기 검증**한다.
 *
 * 핵심 착안: 박스스코어는 `打数`·`安打`·`打点` 를 **컬럼으로도 주고 타석 셀로도** 준다.
 * 우리가 셀에서 도출한 값이 npb.jp가 낸 합계와 어긋나면 **토큰 해석이 틀린 것**이다.
 * 이 대조는 우리 산식으로 우리 산식을 검증하는 게 아니라 **외부 정답과 맞춰보는 것**이다.
 *
 *   node packages/parser/tools/sweep-archive.ts data/archive
 */
import { readdir, readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { join } from "node:path";
import { parseBoxScore } from "../src/box.ts";
import { countsAsAtBat, countsAsHit } from "../src/tokens.ts";
import type { BatterRow } from "../src/box.ts";

const rootArg = process.argv[2];
if (rootArg === undefined) {
  console.error("usage: node tools/sweep-archive.ts <archive-root>");
  process.exit(2);
}
const root = rootArg;

async function* walk(dir: string): AsyncGenerator<string> {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.name === "box.html.gz") yield p;
  }
}

const unknownTokens = new Map<string, number>();
const outcomeCounts = new Map<string, number>();
/**
 * **출처 자신이 어긋난 행** — 우리 파서의 결함이 아니다.
 *
 * ⚠**개수 임계가 아니라 이름을 적는다.** 「1건까지 허용」으로 두면 **다른 행이 어긋나도**
 * 개수가 같아서 통과한다 — 그건 검사가 아니라 눈감기다.
 *
 * ⚠**적어도 되는 것은 「출처의 열과 출처의 셀이 서로 다르다」를 확인한 것뿐**이다.
 * 우리 도출이 틀렸을 가능성이 남아 있으면 여기 넣지 마라 — 그때는 파서를 고쳐야 한다.
 */
interface Mismatch {
  field: "打数" | "安打" | "打点";
  /** 아카이브 루트 기준 경로. ⚠**구분자를 `/` 로 맞춘다** — 윈도우와 CI 가 다르다 */
  file: string;
  side: string;
  name: string;
  expected: number;
  derived: number;
  cells: string;
}

const KNOWN: readonly { field: string; file: string; side: string; name: string; why: string }[] = [
  {
    field: "打点",
    file: "npb/scores/2024/0508/e-b-08/box.html.gz",
    side: "home",
    name: "石原",
    why:
      "⚠**출처 자신의 열과 셀이 어긋난다**(2026-08-26 실측). 박스의 打点 열은 **1** 인데 "
      + "그 선수의 타석 셀 넷(右前安·三振·三振·左飛)에 **타점 표식이 하나도 없다** — "
      + "打数 4 와 셀 4개는 맞으므로 행이 잘린 것도 아니다. "
      + "어느 쪽이 옳은지는 아카이브만으로 판정할 수 없다. **우리 도출은 셀을 정직하게 읽은 값이다.**",
  },
];

const mismatches: Mismatch[] = [];

/** 목록과 대조할 때 쓰는 열쇠 */
function keyOf(m: { field: string; file: string; side: string; name: string }): string {
  return `${m.field}|${m.file}|${m.side}|${m.name}`;
}

function describe(m: Mismatch): string {
  return `${m.field}  기대 ${m.expected} 도출 ${m.derived}  ${m.file} ${m.side} ${m.name}  ${m.cells}`;
}
let games = 0;
let batters = 0;
let parseErrors = 0;
let notPlayed = 0;
/** 종료 표시가 없는 박스. 아카이브에는 원래 없어야 한다 — 있으면 그 자체가 신호다 */
let unfinished = 0;

const playerIds = new Set<string>();
const missingId = new Map<string, number>();
const pitcherMismatches: string[] = [];
let pitcherChecked = 0;

function checkBatter(file: string, side: string, b: BatterRow): void {
  if (b.isTeamTotal) return; // 합계 행은 타석 셀이 없다. 별도 대조 대상이다.
  batters += 1;
  // M10: 이름이 아니라 공식 ID로 조인해야 한다. ID가 없는 행이 있으면 그 자체가 설계 제약이다.
  if (b.playerId === null) missingId.set(b.name, (missingId.get(b.name) ?? 0) + 1);
  else playerIds.add(b.playerId);
  let ab = 0;
  let hits = 0;
  let rbi = 0;
  for (const pa of b.plateAppearances) {
    outcomeCounts.set(pa.outcome, (outcomeCounts.get(pa.outcome) ?? 0) + 1);
    if (pa.outcome === "unknown") unknownTokens.set(pa.raw, (unknownTokens.get(pa.raw) ?? 0) + 1);
    if (countsAsAtBat(pa.outcome)) ab += 1;
    if (countsAsHit(pa.outcome)) hits += 1;
    rbi += pa.rbi;
  }
  const cells = b.plateAppearances.map((p) => `${p.raw}[${p.outcome}]`).join(" ");
  /**
   * ⚠**구분자만 맞춘다.** 호출부가 이미 루트를 떼고 넘긴다(`short`) — 여기서 또 자르면 앞이 더 사라진다.
   * ⚠**실제로 그랬다**(2026-08-26): `file.slice(root.length)` 로 썼다가
   * `npb/scores/2024/…` 가 `024/0508/…` 이 됐고, 그 값이 목록과 안 맞아
   * **「알려진 불일치가 더는 나지 않는다」는 거짓 경보**가 났다.
   * ⚠윈도우는 `\`, CI(리눅스)는 `/` 라 **구분자는 반드시 맞춰야** 목록이 양쪽에서 같게 걸린다.
   */
  const rel = file.replace(/\\/g, "/");
  const add = (field: Mismatch["field"], expected: number, derived: number): void => {
    mismatches.push({ field, file: rel, side, name: b.name, expected, derived, cells });
  };
  if (ab !== b.ab) add("打数", b.ab, ab);
  if (hits !== b.hits) add("安打", b.hits, hits);
  if (rbi !== b.rbi) add("打点", b.rbi, rbi);
}

for await (const file of walk(root)) {
  let box;
  try {
    box = parseBoxScore(gunzipSync(await readFile(file)).toString("utf8"));
  } catch (err) {
    parseErrors += 1;
    console.error(`PARSE ERROR ${file} — ${err instanceof Error ? err.message : String(err)}`);
    continue;
  }
  if (box.status === "notPlayed") {
    notPlayed += 1;
    continue;
  }
  /**
   * ⚠**끝나지 않은 경기는 대조하지 않는다**(M9). 진행 중이면 합계가 아직 안 맞을 수 있고,
   * 그걸 「컬럼이 밀렸다」로 보고하면 진짜 구조 변경이 소음에 묻힌다.
   * 아카이브에는 원래 없어야 하는 것이라 **세어서 보여준다** — 있으면 그 자체가 신호다.
   */
  if (box.status === "inProgress") {
    unfinished += 1;
    continue;
  }
  games += 1;
  const short = file.slice(root.length + 1);
  for (const b of box.away.batters) checkBatter(short, "away", b);
  for (const b of box.home.batters) checkBatter(short, "home", b);

  // ⚠투수 컬럼 정합성 교차 대조. 한쪽 투수진의 피안타 합계는 **상대 타자진의 안타 합계**와 같다.
  // 컬럼이 한 칸이라도 밀리면 여기서 드러난다(중첩 이닝 테이블 때문에 실제로 밀린 적이 있다).
  for (const [side, pitchers, opposingBatters] of [
    ["away", box.away.pitchers, box.home.batters],
    ["home", box.home.pitchers, box.away.batters],
  ] as const) {
    const allowed = opposingBatters.find((b) => b.isTeamTotal)?.hits;
    if (allowed === undefined) continue;
    const conceded = pitchers.filter((p) => !p.isTeamTotal).reduce((n, p) => n + (p.hits ?? 0), 0);
    pitcherChecked += 1;
    if (conceded !== allowed) {
      pitcherMismatches.push(`被安打 상대합계 ${allowed} 투수합계 ${conceded}  ${short} ${side}`);
    }
  }
}

console.log(
  `성립 경기 ${games}건 · 미성립(중지 등) ${notPlayed}건 · 타자 행 ${batters}건 · 파싱 오류 ${parseErrors}건` +
    (unfinished > 0 ? ` · ⚠종료 표시 없음 ${unfinished}건` : ""),
);

console.log(
  `\n=== 선수 ID (M10) ===\n고유 선수 ${playerIds.size}명 · ID 없는 타자 행 ${[...missingId.values()].reduce((a, b) => a + b, 0)}건`,
);
for (const [name, n] of [...missingId].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
  console.log(`${String(n).padStart(6)}  ${name}`);
}

console.log(`\n=== 결과 분류 ===`);
for (const [o, n] of [...outcomeCounts].sort((a, b) => b[1] - a[1])) {
  console.log(`${String(n).padStart(6)}  ${o}`);
}

console.log(`\n=== 미해석 토큰 (고유 ${unknownTokens.size}종) ===`);
for (const [t, n] of [...unknownTokens].sort((a, b) => b[1] - a[1])) {
  console.log(`${String(n).padStart(6)}  ${t}`);
}

/**
 * ⚠**알려진 것과 새 것을 갈라 센다.** 뭉뚱그리면 「1건이던 것이 여전히 1건」인지
 * 「다른 1건으로 바뀐」 것인지 알 수 없다 — 그 둘은 전혀 다른 사건이다.
 */
const known = new Set(KNOWN.map(keyOf));
const seen = new Set(mismatches.map(keyOf));
const fresh = mismatches.filter((m) => !known.has(keyOf(m)));
/** ⚠**사유만 남고 대상이 없으면 낡은 주장이다** — 고쳐졌으면 목록에서 빼라 */
const stale = KNOWN.filter((k) => !seen.has(keyOf(k)));

console.log(
  `\n=== npb.jp 합계와의 불일치 — 타격 (${mismatches.length}건 / 타자 ${batters}행` +
    ` · 그중 알려진 출처 불일치 ${mismatches.length - fresh.length}건) ===`,
);
for (const m of fresh.slice(0, 20)) console.log(`  ${describe(m)}`);
if (fresh.length > 20) console.log(`  ... 외 ${fresh.length - 20}건`);
for (const k of KNOWN) {
  if (seen.has(keyOf(k))) console.log(`  (알려진) ${k.field} ${k.file} ${k.side} ${k.name}`);
}
for (const k of stale) {
  console.error(
    `⚠알려진 불일치가 더는 나지 않는다: ${k.field} ${k.file} ${k.side} ${k.name}\n` +
      "  고쳐졌거나 그 경기가 아카이브에서 빠졌다 — **KNOWN 에서 빼라.** 사유만 남으면 낡은 주장이다.",
  );
}

console.log(`\n=== 투수 컬럼 교차 대조 (${pitcherMismatches.length}건 / ${pitcherChecked}팀) ===`);
for (const m of pitcherMismatches.slice(0, 20)) console.log(`  ${m}`);
if (pitcherMismatches.length > 20) console.log(`  ... 외 ${pitcherMismatches.length - 20}건`);

/**
 * ⚠**알려진 출처 불일치는 실패로 만들지 않는다** — 매일 붉은 검사는 아무도 안 본다.
 * 대신 **새 불일치는 무조건 실패**다: 그때는 우리 파서가 틀렸을 수 있고,
 * 그 판정을 자동으로 할 방법이 없다. **모르면 멈추는 쪽이 맞다**(M7).
 * ⚠**사유만 남고 대상이 없어도 실패**한다 — 낡은 면제는 다음 사람을 속인다.
 */
process.exitCode =
  parseErrors > 0
  || unknownTokens.size > 0
  || fresh.length > 0
  || stale.length > 0
  || pitcherMismatches.length > 0
    ? 1
    : 0;
