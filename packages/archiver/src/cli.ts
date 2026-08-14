#!/usr/bin/env node
/**
 * 아카이버 CLI.
 *
 *   node packages/archiver/src/cli.ts --date 2026-08-14
 *   node packages/archiver/src/cli.ts --from 2026-08-01 --to 2026-08-14
 *
 * 연락처는 필수다(CLAUDE.md L1) — `--contact` 또는 `BB_ARCHIVER_CONTACT`.
 */
import { parseArgs } from "node:util";
import { systemClock, toJstDateString } from "./clock.ts";
import { PoliteFetcher, buildUserAgent } from "./fetcher.ts";
import { LocalSink } from "./sink.ts";
import { MonthlyScheduleCache, archiveDates, isDayError, summarize } from "./archive.ts";
import type { PageResult } from "./archive.ts";

const { values } = parseArgs({
  options: {
    date: { type: "string" },
    from: { type: "string" },
    to: { type: "string" },
    out: { type: "string", default: "data/archive" },
    contact: { type: "string" },
    delay: { type: "string", default: "3000" },
    "dry-run": { type: "boolean", default: false },
  },
});

const contact = values.contact ?? process.env["BB_ARCHIVER_CONTACT"] ?? "";
if (!contact) {
  console.error(
    "연락처가 필요하다. --contact you@example.com 또는 BB_ARCHIVER_CONTACT 환경변수를 설정하라.\n" +
      "이유: 연락처 없는 UA로 긁으면 상대가 문제를 알릴 방법이 차단밖에 없다 (CLAUDE.md L1).",
  );
  process.exit(2);
}

const clock = systemClock;
const dates = resolveDates();

const fetcher = new PoliteFetcher({
  userAgent: buildUserAgent(contact),
  minDelayMs: Number(values.delay),
  clock,
});
const sink = new LocalSink(values.out);

console.error(`대상 ${dates.length}일 · 저장 위치 ${values.out} · 요청 간격 ${values.delay}ms`);

const all: PageResult[] = [];
let daysFailed = 0;
let daysWithGames = 0;
const schedule = new MonthlyScheduleCache();

// ERROR(돌지도 않음)와 FAIL(떨어짐)을 분리해서 센다 (CLAUDE.md 작업규칙 8).
await archiveDates(dates, { fetcher, sink, clock, schedule }, (day) => {
  if (isDayError(day)) {
    daysFailed += 1;
    console.error(`${day.date}  ERROR — ${day.error}`);
    return;
  }
  const s = summarize(day.pages);
  all.push(...day.pages);
  if (day.gamesFound > 0) daysWithGames += 1;
  if (day.gamesFound > 0 || s.failed > 0) {
    console.error(
      `${day.date}  경기 ${day.gamesFound}건 · 페이지 ${s.total}장 ` +
        `(신규 ${s.stored} / 변경없음 ${s.unchanged} / 부재 ${s.absent} / 실패 ${s.failed})`,
    );
  }
  for (const p of day.pages) {
    if (p.outcome === "failed") console.error(`  FAILED ${p.url} — ${p.error}`);
  }
});

const total = summarize(all);
console.error(
  `\n합계: ${dates.length}일 중 ${dates.length - daysFailed}일 처리 (경기 있는 날 ${daysWithGames}일) · ` +
    `월간 일정 취득 ${schedule.fetchCount}회 · ` +
    `페이지 ${total.total}장 (신규 ${total.stored} / 변경없음 ${total.unchanged} / 부재 ${total.absent} / 실패 ${total.failed})`,
);

// ⚠`process.exit()`를 쓰지 마라. 네트워크 작업 뒤에 부르면 Windows에서 libuv가
// `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)` 로 죽는다(실측 2026-08-14).
// 크래시하면 종료 코드가 0xC0000409가 되어 **크론이 성공/실패를 오판한다.**
// exitCode만 세우고 이벤트 루프가 자연히 비도록 둔다.
process.exitCode = daysFailed > 0 || total.failed > 0 ? 1 : 0;

function resolveDates(): string[] {
  if (values.date) return [values.date];
  if (values.from || values.to) {
    const from = values.from ?? values.to;
    const to = values.to ?? values.from;
    if (!from || !to) throw new Error("--from 과 --to 를 함께 지정하라");
    return datesBetween(from, to);
  }
  return [toJstDateString(clock.now())];
}

function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end)) throw new RangeError(`날짜 형식이 잘못됐다: ${from}..${to}`);
  if (end < start) throw new RangeError(`--to 가 --from 보다 이르다: ${from}..${to}`);
  for (let t = start; t <= end; t += 86_400_000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}
