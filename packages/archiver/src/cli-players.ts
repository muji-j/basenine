#!/usr/bin/env node
/**
 * 선수 페이지 아카이버 CLI.
 *
 *   node packages/archiver/src/cli-players.ts --ids data/player-ids.txt --contact you@example.com
 *
 * ID 목록은 한 줄에 하나. `#`로 시작하는 줄과 빈 줄은 무시한다.
 */
import { parseArgs } from "node:util";
import { readFile } from "node:fs/promises";
import { systemClock } from "./clock.ts";
import { PoliteFetcher, buildUserAgent } from "./fetcher.ts";
import { LocalSink } from "./sink.ts";
import { archivePlayers } from "./players.ts";
import { summarize } from "./archive.ts";

const { values } = parseArgs({
  options: {
    ids: { type: "string" },
    out: { type: "string", default: "data/archive" },
    contact: { type: "string" },
    delay: { type: "string", default: "3000" },
    /** 이미 받아둔 선수는 건너뛴다. 900명 × 3초 = 45분이라 기본값은 건너뛰기다 */
    refresh: { type: "boolean", default: false },
  },
});

const contact = values.contact ?? process.env["BB_ARCHIVER_CONTACT"] ?? "";
if (!contact) {
  console.error("연락처가 필요하다. --contact you@example.com 또는 BB_ARCHIVER_CONTACT (CLAUDE.md L1)");
  process.exit(2);
}
if (!values.ids) {
  console.error("usage: node src/cli-players.ts --ids <file> --contact <email> [--out DIR] [--refresh]");
  process.exit(2);
}

const ids = (await readFile(values.ids, "utf8"))
  .split(/\r?\n/)
  .map((l) => l.trim())
  .filter((l) => l !== "" && !l.startsWith("#"));

const clock = systemClock;
const fetcher = new PoliteFetcher({
  userAgent: buildUserAgent(contact),
  minDelayMs: Number(values.delay),
  clock,
});
const sink = new LocalSink(values.out);

console.error(
  `선수 ${ids.length}명 · 저장 위치 ${values.out} · 간격 ${values.delay}ms · ` +
    `${values.refresh ? "전량 재취득" : "기존은 건너뜀"}`,
);

const results = await archivePlayers(ids, { fetcher, sink, clock }, {
  skipExisting: !values.refresh,
  onEach: (r, i, total) => {
    if (r.outcome === "failed") console.error(`  FAILED ${r.url} — ${r.error}`);
    if ((i + 1) % 50 === 0 || i + 1 === total) console.error(`  ${i + 1}/${total}`);
  },
});

const s = summarize(results);
console.error(
  `\n합계 ${s.total}명 (신규 ${s.stored} / 변경없음·건너뜀 ${s.unchanged} / 부재 ${s.absent} / 실패 ${s.failed})`,
);

process.exitCode = s.failed > 0 ? 1 : 0;
