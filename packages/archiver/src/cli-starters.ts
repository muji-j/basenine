#!/usr/bin/env node
/**
 * 予告先発 아카이버 CLI. **하루 1요청.**
 *
 *   node packages/archiver/src/cli-starters.ts --contact you@example.com
 */
import { parseArgs } from "node:util";
import { systemClock, toJstDateString } from "./clock.ts";
import { PoliteFetcher, buildUserAgent } from "./fetcher.ts";
import { LocalSink } from "./sink.ts";
import { archiveStarters } from "./starters.ts";

const { values } = parseArgs({
  options: {
    out: { type: "string", default: "data/archive" },
    contact: { type: "string" },
    delay: { type: "string", default: "3000" },
    /** 취득일. 기본은 오늘(JST) */
    date: { type: "string" },
  },
});

const contact = values.contact ?? process.env["BB_ARCHIVER_CONTACT"] ?? "";
if (!contact) {
  console.error("연락처가 필요하다. --contact you@example.com 또는 BB_ARCHIVER_CONTACT (CLAUDE.md L1)");
  process.exit(2);
}

const clock = systemClock;
// ⚠시계는 한 번만 읽는다(M6)
const jstDate = values.date ?? toJstDateString(clock.now());

const result = await archiveStarters(jstDate, {
  fetcher: new PoliteFetcher({
    userAgent: buildUserAgent(contact),
    minDelayMs: Number(values.delay),
    clock,
  }),
  sink: new LocalSink(values.out),
  clock,
});

console.log(`予告先発 ${jstDate}: ${result.outcome}${result.status === null ? "" : ` (${result.status})`}`);
if (result.error !== null) console.error(`  ⚠${result.error}`);
// 취득 실패는 그날 예고를 영영 못 받는다는 뜻이다 — 조용히 성공으로 끝내지 않는다
process.exitCode = result.outcome === "failed" ? 1 : 0;
