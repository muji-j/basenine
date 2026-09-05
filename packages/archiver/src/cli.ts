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
import { L1_MIN_DELAY_MS, PoliteFetcher, buildUserAgent, parseDelayMs } from "./fetcher.ts";
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
    "연락처가 필요하다. --contact <닿는-연락처> 또는 BB_ARCHIVER_CONTACT 환경변수를 설정하라.\n" +
      "이유: 연락처 없는 UA로 긁으면 상대가 문제를 알릴 방법이 차단밖에 없다 (CLAUDE.md L1).",
  );
  process.exit(2);
}

// ⚠**`Number(values.delay)` 를 직접 넘기지 마라** — `NaN` 은 nullish 가 아니라서
//   `minDelayMs ?? 3000` 을 통과하고 **간격이 조용히 0이 된다**(L1 · `fetcher.ts` 참조).
//   ⚠여기는 경기 페이지를 날짜 수 × 4장 도는 자리다.
const delayMs = parseDelayMs(values.delay);
if (delayMs === null) {
  console.error(`--delay 는 ${L1_MIN_DELAY_MS}ms 이상이어야 한다 (L1: 1req/2~5초): ${values.delay}`);
  process.exit(2);
}

const clock = systemClock;
const dates = resolveDates();

const fetcher = new PoliteFetcher({
  userAgent: buildUserAgent(contact),
  minDelayMs: delayMs,
  clock,
});
const sink = new LocalSink(values.out);

console.error(`대상 ${dates.length}일 · 저장 위치 ${values.out} · 요청 간격 ${delayMs}ms`);

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

/**
 * **다음 달 일정을 한 장 더 받는다.**
 *
 * ⚠**월말마다 「앞으로의 경기」가 비었다**(2026-08-18 감사 P2). 월간 일정 페이지는 **그 달만** 담는데,
 * 우리는 **수집 대상 날짜의 달**만 받는다 — 8/30 에 8월 일정을 받으면 거기 남은 미래는 8/31 하루뿐이고,
 * 9월분은 9/1 이 되어야 들어온다. 즉 **월말 이틀은 캘린더의 앞날이 통째로 비고**,
 * 화면은 그것을 「일정을 아직 안 받았다」로 그린다 — 사실은 시즌이 한창인데도.
 *
 * ⚠**비용은 하루 1요청이다**(L1: 1req/2~5초 · 하루 1회 배치).
 * ⚠**여기에 조건부 요청은 안 걸려 있다**(2026-08-18 감사 P3에서 정정).
 *   예전에 이 자리에 「조건부 요청이 걸리므로 대부분 304 다(L7)」라고 적혀 있었는데
 *   **코드가 안 하는 일을 문서가 보증하고 있었다** — 월간 일정만 `fetcher.get(url)` 을
 *   이전 메타 없이 부른다(다른 경로는 전부 넘긴다).
 *   ⚠**틀린 보증이 값 자체보다 위험하다.** 다음 사람이 이 문장을 근거로
 *   「L7 은 이미 지켜진다」고 판단하면 그 판단이 틀린다.
 *   못 고친 이유: 304 를 받으면 파싱할 본문이 없는데 `Sink` 에 **본문 읽기가 없다.**
 *   인터페이스를 넓히는 변경이라 수집 경로를 건드린다 — 얻는 것은 월 10요청분의 바이트뿐이다.
 *   ⚠수집 경로를 손볼 일이 생기면 그때 같이 넣어라.
 * ⚠**실패해도 종료 코드를 더럽히지 않는다** — 이건 앞을 내다보려는 덤이지, 그날 수집의 일부가 아니다.
 *   12월에 다음 해 1월을 물으면 404 인 것이 정상이다.
 */
const last = dates[dates.length - 1];
if (last !== undefined) {
  const y = Number(last.slice(0, 4));
  const m = Number(last.slice(5, 7));
  const nextY = m === 12 ? y + 1 : y;
  const nextM = m === 12 ? 1 : m + 1;
  try {
    const found = await schedule.get(nextY, nextM, { fetcher, sink, clock });
    console.error(`다음 달 일정(${nextY}-${String(nextM).padStart(2, "0")}) 확보 · 경기 ${found.length}건`);
  } catch (err) {
    console.error(
      `다음 달 일정(${nextY}-${String(nextM).padStart(2, "0")}) 은 못 받았다 — ` +
        `${err instanceof Error ? err.message : String(err)}（오프시즌이면 정상）`,
    );
  }
}

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
