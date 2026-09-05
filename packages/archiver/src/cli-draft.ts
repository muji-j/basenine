#!/usr/bin/env node
/**
 * 드래프트 취득 CLI — **연 1회 배치**.
 *
 * ⚠**일일 배치(`scripts/update.ts`)에 붙이지 않는다** — 그쪽은 날짜 창 기반이라 층이 다르다.
 *
 * ⚠**예의도 멱등도 기존 취득기와 같은 한 벌을 쓴다**(L1·L7·M5·M8) —
 * `PoliteFetcher`(간격 기본 3초 · 동시 1커넥션 · 조건부 요청 · 식별 UA)와 `archiveUrl`.
 * **여기서 `fetch` 를 직접 부르거나 revision 규칙을 새로 쓰지 않는다.**
 * ⚠**받은 원문은 내부 보관이다**(L6).
 *
 * ⚠**발견과 취득은 `draft.ts` 에 있다** — 이 파일은 argv 와 출력만 맡는다.
 * `cli-players.ts`↔`players.ts` · `cli-starters.ts`↔`starters.ts` 와 같은 배치다.
 *
 * 사용:
 *   node packages/archiver/src/cli-draft.ts --from 2005 --contact you@example.com
 *   node packages/archiver/src/cli-draft.ts --only 2025 --contact you@example.com
 */
import { parseArgs } from "node:util";
import { L1_MIN_DELAY_MS, PoliteFetcher, buildUserAgent, parseDelayMs } from "./fetcher.ts";
import { LocalSink } from "./sink.ts";
import { systemClock } from "./clock.ts";
import { summarize } from "./archive.ts";
import { collectDraft, countSkips } from "./draft.ts";

const USAGE =
  "usage: node src/cli-draft.ts --contact <email> [--from 2005] [--to YYYY] [--only YYYY] [--out DIR] [--delay MS]";

const { values } = parseArgs({
  options: {
    /**
     * ⚠**하한에는 사유가 있다.** 2005 이전으로 소급하려면 **「그 시즌에 존재한 구단」 이력
     * 마스터가 선행 조건**이다 — 2001 색인에는 近鉄(`bu`)·ブルーウェーブ(`bw`)가 있고
     * 현행 12구단 표를 박으면 그 둘이 **어느 표에도 없이 조용히 사라진다**.
     * (2026-09-04 사용자 결정 · `docs/sources/2026-09-04-draft-source-survey.md`)
     */
    from: { type: "string", default: "2005" },
    /**
     * ⚠**상한에는 사유가 없어서 기본값을 두지 않는다.** 「올해」를 박으면 해가 바뀌는 순간
     * 그 줄이 낡고, **새로 열린 드래프트가 조용히 안 들어온다.** 안 주면 색인이 나열하는
     * 최신 해까지 받는다.
     */
    to: { type: "string" },
    /** 한 해만. ⚠범위 밖이면 **조용한 0건**이 되므로 아래에서 걸러 낸다 */
    only: { type: "string" },
    out: { type: "string", default: "data/archive" },
    contact: { type: "string" },
    delay: { type: "string", default: "3000" },
  },
});

function intOrNull(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const n = Number(raw);
  return Number.isInteger(n) ? n : null;
}

// ⚠**세 상태를 섞지 마라**(M11): `undefined` = 안 줬다 · `null` = 줬는데 정수가 아니다 ·
//   숫자 = 줬고 유효하다. 「안 줬다」를 「0」이나 「올해」로 메우면 조용히 엉뚱한 범위를 받는다.
const from = intOrNull(values.from);
const to = values.to === undefined ? Number.POSITIVE_INFINITY : intOrNull(values.to);
const only = values.only === undefined ? undefined : intOrNull(values.only);

if (from === null || to === null || only === null) {
  console.error(`연도는 정수여야 한다.\n${USAGE}`);
  process.exit(2);
}
/** 사람이 읽는 상한. ⚠`Infinity` 를 그대로 내보내지 않는다 */
const toLabel = to === Number.POSITIVE_INFINITY ? "(상한 없음)" : String(to);

if (from > to) {
  console.error(`--from ${from} 이 --to ${toLabel} 보다 크다.\n${USAGE}`);
  process.exit(2);
}
// ⚠**범위 밖 `--only` 는 조용히 0건이 된다** — 그건 성공처럼 보이는 실패다.
if (only !== undefined && (only < from || only > to)) {
  console.error(`--only ${only} 가 범위 ${from}~${toLabel} 밖이다 — 그대로 두면 조용히 0건이 된다.\n${USAGE}`);
  process.exit(2);
}

const contact = values.contact ?? process.env["BB_ARCHIVER_CONTACT"] ?? "";
if (!contact) {
  console.error("연락처가 필요하다. --contact you@example.com 또는 BB_ARCHIVER_CONTACT (CLAUDE.md L1)");
  process.exit(2);
}

// ⚠**검사는 `fetcher.ts` 한 벌이다**(M1). 생성자도 같은 술어로 막으므로 여기를 지워도
//   하한 아래로 나가지는 않는다 — 여기 있는 이유는 **스택트레이스 대신 쓸 만한 메시지**다.
// ⚠**경고가 아니라 거부다.** 「경고만 찍고 계속」은 `--delay 500` 을 그대로 통과시켰고,
//   그 상태에서 시험 한 본이 **222페이지를 0.583초 간격으로 실제로 받아 버렸다**(실측).
const delayMs = parseDelayMs(values.delay);
if (delayMs === null) {
  console.error(`--delay 는 ${L1_MIN_DELAY_MS}ms 이상이어야 한다 (L1: 1req/2~5초): ${values.delay}\n${USAGE}`);
  process.exit(2);
}

const clock = systemClock;
const userAgent = buildUserAgent(contact);
const deps = {
  fetcher: new PoliteFetcher({ userAgent, minDelayMs: delayMs, clock }),
  sink: new LocalSink(values.out),
  clock,
};

const range = `${from}~${toLabel}${only === undefined ? "" : ` · --only ${only}`}`;
console.error(`드래프트 취득 ${range} · 저장 ${values.out} · 간격 ${delayMs}ms · UA ${userAgent}`);

const result = await collectDraft({ from, to, only }, deps, (r) => {
  console.error(`  ${r.outcome.padEnd(9)} ${r.url}${r.error === null ? "" : ` — ${r.error}`}`);
});

const s = summarize(result.pages);
const skips = countSkips(result.skipped);

console.error(
  `\n연도: 색인 ${result.yearsListed.length}개 중 범위 안 ${result.yearsAttempted.length}개` +
    ` — 슬러그를 얻은 해 ${result.slugsByYear.size}개 / 건너뛴 해 ${skips.total}개`,
);
console.error(`합계: ${s.total}장 (신규 ${s.stored} / 변경없음 ${s.unchanged} / 부재 ${s.absent} / 실패 ${s.failed})`);

/**
 * ⚠**옛 사본으로 진행한 것을 반드시 말한다.**
 *
 * 취득이 실패해도 아카이브에 이전 성공분이 있으면 발견을 계속한다(L7). 그 자체는 맞지만,
 * **이 줄이 없으면** 로그에 「실패 1」만 찍히고 뒤따르는 구단 페이지는 `stored` 로
 * **정상처럼 보인다** — 그 목록이 낡은 슬러그에서 나왔다는 것을 **사후에 알 수 없다.**
 */
if (result.stale.index) {
  console.error(`⚠연도 목록이 옛 사본이다 — 색인 취득이 실패했다. 새로 열린 해가 빠져 있을 수 있다`);
}
if (result.stale.years.length > 0) {
  console.error(
    `⚠옛 사본의 슬러그로 받은 해 ${result.stale.years.length}개: ${result.stale.years.join(" ")}` +
      ` — 그해 구단이 늘었으면 그 구단이 통째로 빠진다. 다시 돌려라`,
  );
}

if (skips.total > 0) {
  console.error(
    `건너뜀 내역: 부재 ${skips.absent} / 취득실패 ${skips.failed} /` +
      ` 슬러그0건 ${skips.index} / 어휘깨짐 ${skips.parse} / 예상밖 ${skips.error}`,
  );
  for (const { year, skip } of result.skipped) {
    // ⚠**관측을 그대로 적는다**(A1). 「아직 안 열렸다」로 바꿔 쓰지 마라 —
    //   그 판정에는 「그 해가 과거인가」가 필요하고 **파서도 이 CLI 도 그걸 안 본다**.
    //   ⚠**과거 연도의 `no-team-links` 는 개최 전이 아니라 붕괴다.**
    const detail = skip.kind === "index" ? `${skip.kind}/${skip.observed}` : skip.kind;
    const why = skip.kind === "absent" ? `HTTP ${skip.status}` : skip.error;
    console.error(`  ${year}  ${detail} — ${why}`);
  }
}

/**
 * ⚠**부재는 실패가 아니다**(M11) — **페이지 단위에서는.**
 *
 * ⚠**연도 단위에서는 다르다.** 색인이 「그 해가 있다」고 방금 말했는데 연도 톱이 404 면
 * 그건 정상적인 부재가 아니라 **모순**이다. 그래서 **건너뛴 해가 하나라도 있으면 알린다** —
 * 갈래가 무엇이든 사람이 봐야 한다. ⚠**「슬러그 0건」을 「아직」으로 삼키지 않는 것이
 * 이 종료코드의 존재 이유다**(A1).
 */
process.exitCode = s.failed > 0 || skips.total > 0 ? 1 : 0;
