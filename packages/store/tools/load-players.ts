/**
 * 아카이브한 선수 페이지 → `player` 테이블의 속성 컬럼.
 *
 *   node packages/store/tools/load-players.ts data/archive data/bb.sqlite
 *
 * ⚠**투타를 못 읽은 선수를 임의로 채우지 않는다.** null로 두고 몇 명인지 보고한다 —
 * 좌우 스플릿의 근거이므로 모르는 채로 섞이면 스플릿이 조용히 틀린다.
 */
import { readdir } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { join } from "node:path";
import { parseCareer, parsePlayerProfile } from "@bb-app/parser";
import { openDb } from "../src/db.ts";

const [archiveRoot, dbPath] = process.argv.slice(2);
if (!archiveRoot || !dbPath) {
  console.error("usage: node tools/load-players.ts <archive-root> <db-path>");
  process.exit(2);
}

const nowIso = new Date().toISOString();
const dir = join(archiveRoot, "npb", "players");

let files: string[];
try {
  files = (await readdir(dir)).filter((f) => f.endsWith(".html.gz"));
} catch {
  console.error(`선수 페이지 디렉터리가 없다: ${dir}`);
  process.exit(1);
}

const db = openDb(dbPath, nowIso);
const stmt = db.raw.prepare(
  `UPDATE player SET position = ?, throws = ?, bats = ?, birth_date = ?, physique = ?,
     draft = ?, kana = ?, uniform_number = ?, profile_fetched_at = ?
   WHERE player_id = ?`,
);

/**
 * 年度別成績.
 *
 * ⚠**우리 경기 데이터와 다른 표에 넣는다**(M4) — 출처가 NPB 공표치라 섞으면
 * 「어디서 온 숫자인가」에 답할 수 없다.
 * ⚠**갈아끼운다**(선수 단위 DELETE 후 INSERT). 이적으로 행이 늘거나 줄 수 있고,
 * UPSERT 만 하면 **없어진 행이 남는다** — 옛 구단 줄이 영원히 붙어 다닌다.
 */
const CAREER_SOURCE = "npb.jp/bis/players (年度別成績)";
const delBat = db.raw.prepare("DELETE FROM career_batting WHERE player_id = ?");
const delPit = db.raw.prepare("DELETE FROM career_pitching WHERE player_id = ?");
const insBat = db.raw.prepare(
  `INSERT INTO career_batting (player_id, year, team, games, pa, ab, runs, h, d2, d3, hr, tb, rbi,
     sb, cs, sh, sf, bb, hbp, so, gidp, source, fetched_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
);
const insPit = db.raw.prepare(
  `INSERT INTO career_pitching (player_id, year, team, games, w, l, sv, hld, hp, cg, sho, nbb, bf,
     outs, h, hr, bb, hbp, so, wp, balk, runs, er, source, fetched_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
);
let careerBat = 0;
let careerPit = 0;
let careerFailed = 0;

let updated = 0;
let missing = 0;
let failed = 0;
let noHand = 0;
/** 이번에 **읽은 페이지 중** 읽는 법을 얻은 장수. 커버리지 임계값의 분자다 */
let kanaRead = 0;
const unknownPlayers: string[] = [];

db.transaction(() => {
  for (const f of files) {
    const playerId = f.replace(/\.html\.gz$/, "");
    let profile;
    let html = "";
    try {
      // 트랜잭션 안이라 동기 읽기를 쓴다 — await 하면 트랜잭션이 열린 채로 이벤트 루프가 돈다.
      html = gunzipSync(readFileSync(join(dir, f))).toString("utf8");
      profile = parsePlayerProfile(html);
    } catch (err) {
      failed += 1;
      console.error(`PARSE ERROR ${playerId} — ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    if (profile.throws === null || profile.bats === null) {
      noHand += 1;
      unknownPlayers.push(playerId);
    }
    // ⚠**읽은 장수 기준의 커버리지를 센다.** DB 전체(`player` 표)를 분모로 하면
    // 「페이지를 받지 않은 선수」와 「페이지는 있는데 못 읽은 선수」가 섞여, 마크업이
    // 바뀌어도 비율이 크게 안 움직인다 — 그러면 임계값이 아무것도 못 잡는다
    if (profile.kana !== null) kanaRead += 1;
    stmt.run(
      profile.position,
      profile.throws,
      profile.bats,
      profile.birthDate,
      profile.physique,
      profile.draft,
      profile.kana,
      profile.uniformNumber,
      nowIso,
      playerId,
    );
    /**
     * 年度別成績.
     * ⚠**프로필과 같은 페이지를 두 번 읽지 않는다** — 이미 문자열을 갖고 있다.
     * ⚠**여기서 실패해도 프로필은 살린다**(blast radius) — 한 선수의 표 하나 때문에
     *   투타·읽는 법까지 잃으면 배포가 통째로 멈춘다. 대신 **센다**.
     */
    try {
      const career = parseCareer(html);
      delBat.run(playerId);
      delPit.run(playerId);
      for (const r of career.batting) {
        insBat.run(playerId, r.year, r.team, r.games, r.pa, r.ab, r.runs, r.h, r.d2, r.d3, r.hr,
          r.tb, r.rbi, r.sb, r.cs, r.sh, r.sf, r.bb, r.hbp, r.so, r.gidp, CAREER_SOURCE, nowIso);
        careerBat += 1;
      }
      for (const r of career.pitching) {
        insPit.run(playerId, r.year, r.team, r.games, r.w, r.l, r.sv, r.hld, r.hp, r.cg, r.sho,
          r.nbb, r.bf, r.outs, r.h, r.hr, r.bb, r.hbp, r.so, r.wp, r.balk, r.runs, r.er,
          CAREER_SOURCE, nowIso);
        careerPit += 1;
      }
    } catch (err) {
      careerFailed += 1;
      console.error(`CAREER ERROR ${playerId} — ${err instanceof Error ? err.message : String(err)}`);
    }

    const changes = db.raw.prepare("SELECT changes() AS n").get() as { n: number };
    if (changes.n === 0) missing += 1;
    else updated += 1;
  }
});

const total = (db.raw.prepare("SELECT COUNT(*) AS n FROM player").get() as { n: number }).n;
const withHand = (
  db.raw.prepare("SELECT COUNT(*) AS n FROM player WHERE throws IS NOT NULL AND bats IS NOT NULL").get() as {
    n: number;
  }
).n;

console.log(`선수 페이지 ${files.length}장 · 갱신 ${updated} · DB에 없는 선수 ${missing} · 파싱 실패 ${failed}`);
console.log(`투타 확인 ${withHand} / 전체 ${total}명 (미상 ${total - withHand}명)`);
// ⚠**분모를 같이 낸다.** 「카나 있음 737」만 내면 121명이 빠진 것인지 그런 선수가 없는 것인지 모른다.
// ⚠등번호 없음은 **결손이 아니라 「지금 등록이 없다」**(M11) — 은퇴·이적 선수다
const withKana = (db.raw.prepare("SELECT COUNT(*) AS n FROM player WHERE kana IS NOT NULL").get() as { n: number }).n;
const withNo = (db.raw.prepare("SELECT COUNT(*) AS n FROM player WHERE uniform_number IS NOT NULL").get() as { n: number }).n;
console.log(`읽는 법 ${withKana} / 전체 ${total}명 · 등번호 ${withNo} / 전체 ${total}명(없음 = 현役登録なし)`);
if (unknownPlayers.length > 0) {
  console.log(`⚠투타를 읽지 못한 선수: ${unknownPlayers.slice(0, 10).join(", ")}${unknownPlayers.length > 10 ? " …" : ""}`);
}

/**
 * ⚠**표제부는 한 장 단위로 던지지 않는다 — 여기서 집계로 멈춘다.**
 *
 * 파서가 한 장이라도 실패하면 던지게 두면, 선수 한 명의 페이지가 달라진 것만으로
 * **투타·생년월일 갱신이 스킵되고 그날 배포가 통째로 멈춘다**(`failed>0 → exit 1`).
 * 반대로 조용히 null 로 두기만 하면 마크업이 바뀐 날 **858명의 읽는 법이 한꺼번에 사라져도**
 * 아무도 모른다. 그 사이를 커버리지 임계값이 가른다.
 *
 * 실측(2026-08-17): 읽은 858장 중 읽는 법 **858장(100%)**. 여유를 두고 90%로 건다 —
 * 한두 명이 특이해도 넘어가고, 구조가 바뀌면 반드시 걸린다.
 */
const KANA_COVERAGE_MIN = 0.9;
const coverage = files.length === 0 ? 1 : kanaRead / files.length;
if (coverage < KANA_COVERAGE_MIN) {
  console.error(
    `⚠읽는 법 커버리지가 ${(coverage * 100).toFixed(1)}% (${kanaRead}/${files.length}장) — ` +
      `임계값 ${KANA_COVERAGE_MIN * 100}% 미만이다. 선수 페이지의 표제부(#pc_vitals) 구조 변경을 의심하라`,
  );
}

db.close();
process.exitCode = failed > 0 || coverage < KANA_COVERAGE_MIN ? 1 : 0;
