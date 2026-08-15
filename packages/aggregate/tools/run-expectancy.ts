/**
 * 득점기대치(RE) 행렬을 출력한다.
 *
 *   node packages/aggregate/tools/run-expectancy.ts data/bb.sqlite 2026
 *
 * ⚠**표본 수를 함께 낸다.** 상태별로 표본이 크게 다르며(무사만루는 드물다),
 * 표본이 얇은 칸의 값은 그만큼 흔들린다.
 */
import { openDb } from "@bb-app/store";
import { TEAMS } from "@bb-app/domain";
import { ALL_STATES, buildRunExpectancy, stateKey } from "../src/run-expectancy.ts";

const [dbPath, seasonArg] = process.argv.slice(2);
if (!dbPath || !seasonArg) {
  console.error("usage: node tools/run-expectancy.ts <db-path> <season>");
  process.exit(2);
}
const season = Number(seasonArg);
const db = openDb(dbPath, "1970-01-01T00:00:00.000Z");

const BASES = ["-", "1", "2", "3", "12", "13", "23", "123"];
const LABEL: Record<string, string> = {
  "-": "주자없음", "1": "1루", "2": "2루", "3": "3루",
  "12": "1·2루", "13": "1·3루", "23": "2·3루", "123": "만루",
};

for (const league of ["central", "pacific"] as const) {
  const codes = TEAMS.filter((t) => t.league === league).map((t) => t.code);
  const re = buildRunExpectancy(db, season, league, codes);

  console.log(`\n${"=".repeat(64)}`);
  console.log(
    `${league} ${season} · 타석 ${re.totalPa.toLocaleString()} · 관측 상태 ${re.observedStates}/24`,
  );
  console.log(`\n  상태        0아웃            1아웃            2아웃`);
  for (const b of BASES) {
    const cells = [0, 1, 2].map((o) => {
      const k = stateKey(b === "-" ? "" : b, o);
      const v = re.matrix.get(k);
      const n = re.samples.get(k) ?? 0;
      return v === undefined ? "     —        " : `${v.toFixed(3)} (${String(n).padStart(5)})`;
    });
    console.log(`  ${LABEL[b]!.padEnd(8)}  ${cells.join("  ")}`);
  }

  const missing = ALL_STATES.filter((s) => !re.matrix.has(s));
  if (missing.length > 0) console.log(`  ⚠미관측 상태: ${missing.join(", ")}`);
}

db.close();
