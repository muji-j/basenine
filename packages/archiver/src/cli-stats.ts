/**
 * 공표 성적표 취득 — **외부 대조 전용**.
 *
 * ⚠**이 페이지들은 화면에 나가지 않는다**(L6). 우리가 계산한 값이 맞는지 확인하기 위해서만
 * 받고, 받은 원문은 아카이브에 내부 보관한다. 대조 결과는 리포트지 페이지가 아니다.
 *
 * ⚠**새 소스가 아니다.** `docs/sources/2026-08-14-feasibility-report.md`가 v1 소스로
 * 이미 판정한 `idb1_*`/`idp1_*`/`std_*`다.
 *
 * ⚠**예의도 멱등도 기존 취득기와 같은 한 벌을 쓴다**(L1·L7·M5·M8) —
 * `PoliteFetcher`(1req/3초 · 동시 1커넥션 · 조건부 요청 · 식별 UA)와 `archiveUrl`.
 * 여기서 `fetch`를 직접 부르거나 revision 규칙을 새로 쓰지 않는다.
 *
 * 사용:
 *   node packages/archiver/src/cli-stats.ts --season 2026 --contact you@example.com
 */
import { parseArgs } from "node:util";
import { L1_MIN_DELAY_MS, PoliteFetcher, buildUserAgent, parseDelayMs } from "./fetcher.ts";
import { LocalSink } from "./sink.ts";
import { systemClock } from "./clock.ts";
import { archiveUrl, summarize } from "./archive.ts";
import type { PageResult } from "./archive.ts";

const { values } = parseArgs({
  options: {
    season: { type: "string" },
    out: { type: "string", default: "data/archive" },
    contact: { type: "string" },
    delay: { type: "string", default: "3000" },
    only: { type: "string" },
  },
});

const season = Number(values.season);
if (!Number.isInteger(season)) {
  console.error("usage: node src/cli-stats.ts --season 2026 --contact <email> [--out DIR] [--only KEY]");
  process.exit(2);
}

const contact = values.contact ?? process.env["BB_ARCHIVER_CONTACT"] ?? "";
if (!contact) {
  console.error("연락처가 필요하다. --contact you@example.com 또는 BB_ARCHIVER_CONTACT (CLAUDE.md L1)");
  process.exit(2);
}

/** 12구단. npb.jp 성적표 파일명이 구단 코드를 그대로 쓴다 */
const TEAM_CODES = ["g", "t", "db", "c", "d", "s", "h", "f", "m", "l", "e", "b"] as const;

/** 받을 페이지. **팀별 개인 성적 + 리그 순위·팀 합계** */
function targets(year: number): { key: string; url: string }[] {
  const out: { key: string; url: string }[] = [];
  const add = (name: string): void => {
    out.push({ key: `npb/stats/${year}/${name}`, url: `https://npb.jp/bis/${year}/stats/${name}.html` });
  };
  for (const code of TEAM_CODES) {
    add(`idb1_${code}`);
    add(`idp1_${code}`);
  }
  for (const lg of ["c", "p"]) {
    add(`std_${lg}`);
    add(`tmb_${lg}`);
    add(`tmp_${lg}`);
  }
  return out;
}

const all = targets(season);
const list = values.only === undefined ? all : all.filter((t) => t.key.includes(values.only!));
if (list.length === 0) {
  console.error(`--only ${values.only} 에 맞는 대상이 없다`);
  process.exit(2);
}

// ⚠**`Number(values.delay)` 를 직접 넘기지 마라** — `NaN` 은 nullish 가 아니라서
//   `minDelayMs ?? 3000` 을 통과하고 **간격이 조용히 0이 된다**(L1 · `fetcher.ts` 참조).
const delayMs = parseDelayMs(values.delay);
if (delayMs === null) {
  console.error(`--delay 는 ${L1_MIN_DELAY_MS}ms 이상이어야 한다 (L1: 1req/2~5초): ${values.delay}`);
  process.exit(2);
}

const deps = {
  fetcher: new PoliteFetcher({
    userAgent: buildUserAgent(contact),
    minDelayMs: delayMs,
    clock: systemClock,
  }),
  sink: new LocalSink(values.out),
  clock: systemClock,
};

console.error(
  `공표 성적표 ${list.length}장 · 저장 ${values.out} · 간격 ${delayMs}ms · UA ${buildUserAgent(contact)}`,
);

const results: PageResult[] = [];
for (const t of list) {
  const r = await archiveUrl(t.key, t.url, deps);
  results.push(r);
  console.error(`  ${r.outcome.padEnd(9)} ${t.url}${r.error === null ? "" : ` — ${r.error}`}`);
}

const s = summarize(results);
console.error(
  `\n합계: ${s.total}장 (신규 ${s.stored} / 변경없음 ${s.unchanged} / 부재 ${s.absent} / 실패 ${s.failed})`,
);
// ⚠**부재는 실패가 아니다**(M11) — 그 표가 없는 것과 못 받은 것은 다르다
process.exit(s.failed > 0 ? 1 : 0);
