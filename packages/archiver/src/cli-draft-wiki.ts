#!/usr/bin/env node
/**
 * 드래프트 wikipedia 취득 CLI — **연 1회 배치**.
 *
 * ⚠**발견과 취득은 `draft-wiki.ts` 에 있다** — 이 파일은 argv 와 출력만 맡는다.
 * `cli-draft.ts`↔`draft.ts` 와 같은 배치다(진입점에 top-level `parseArgs` 가 있으면
 * 시험이 import 하는 순간 그게 돌아 죽는다 · 실측).
 *
 * ⚠**개발 루프에서 부르지 마라**(작업규칙 11). 파서 시험은 `packages/parser/test/fixtures/` 의
 * 고정 픽스처로 돈다. 여기를 부르는 것은 **새 해가 열렸을 때와 규칙을 다시 재는 조사 때**뿐이다.
 *
 * 사용:
 *   node packages/archiver/src/cli-draft-wiki.ts --contact <닿는-연락처> --only 2025
 *   node packages/archiver/src/cli-draft-wiki.ts --contact <닿는-연락처> --from 2005 --to 2026
 */
import { parseArgs } from "node:util";
import { L1_MIN_DELAY_MS, PoliteFetcher, buildUserAgent, parseDelayMs } from "./fetcher.ts";
import { LocalSink } from "./sink.ts";
import { systemClock } from "./clock.ts";
import { summarize } from "./archive.ts";
import { collectDraftWiki, draftWikiUrl } from "./draft-wiki.ts";

const USAGE =
  "usage: node src/cli-draft-wiki.ts --contact <email> [--from 2005] [--to YYYY] [--only YYYY] [--out DIR] [--delay MS]";

const { values } = parseArgs({
  options: {
    /**
     * ⚠**하한 사유는 npb 쪽과 같다** — 2005 이전은 「그 시즌에 존재한 구단」 이력 마스터가 선행 조건이다
     * (`cli-draft.ts`). ⚠**그리고 위키 쪽에는 사유가 하나 더 있다**: 규칙표 §10-6 이
     * **「1990 이 이미 다르다」**고 적었다 — 소급하면 **규칙군이 늘어난다.**
     */
    from: { type: "string", default: "2005" },
    /**
     * ⚠**상한에 기본값을 두지 않는다.** 「올해」를 박으면 해가 바뀌는 순간 그 줄이 낡는다.
     * ⚠**단 위키에는 연도 색인이 없다** — npb 처럼 「소스가 나열하는 데까지」를 알 수 없으므로
     * **상한을 안 주면 던진다.** 조용히 무한 루프가 되느니 거절한다.
     */
    to: { type: "string" },
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

// ⚠**세 상태를 섞지 마라**(M11): `undefined` = 안 줬다 · `null` = 줬는데 정수가 아니다 · 숫자 = 유효.
const from = intOrNull(values.from);
const only = values.only === undefined ? undefined : intOrNull(values.only);
const to = values.to === undefined ? (only ?? null) : intOrNull(values.to);

if (from === null || only === null) {
  console.error(`연도는 정수여야 한다.\n${USAGE}`);
  process.exit(2);
}
if (to === null) {
  // ⚠**npb 와 다른 자리다.** 그쪽은 색인이 상한을 말해 주지만 위키는 아무도 말해 주지 않는다.
  console.error(`--to 또는 --only 가 필요하다 — 위키에는 연도 색인이 없어 상한을 아무도 말해 주지 않는다.\n${USAGE}`);
  process.exit(2);
}
if (from > to) {
  console.error(`--from ${from} 이 --to ${to} 보다 크다.\n${USAGE}`);
  process.exit(2);
}
// ⚠**범위 밖 `--only` 는 조용히 0건이 된다** — 그건 성공처럼 보이는 실패다.
if (only !== undefined && (only < from || only > to)) {
  console.error(`--only ${only} 가 범위 ${from}~${to} 밖이다 — 그대로 두면 조용히 0건이 된다.\n${USAGE}`);
  process.exit(2);
}

const contact = values.contact ?? process.env["BB_ARCHIVER_CONTACT"] ?? "";
if (!contact) {
  console.error("연락처가 필요하다. --contact <닿는-연락처> 또는 BB_ARCHIVER_CONTACT (CLAUDE.md L1)");
  process.exit(2);
}

// ⚠**검사는 `fetcher.ts` 한 벌이다**(M1) — 여기 있는 이유는 스택트레이스 대신 쓸 만한 메시지다.
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

console.error(
  `wikipedia 드래프트 취득 ${from}~${to}${only === undefined ? "" : ` · --only ${only}`}`
    + ` · 저장 ${values.out} · 간격 ${delayMs}ms · UA ${userAgent}`,
);
console.error(`  예: ${draftWikiUrl(to)}`);

const result = await collectDraftWiki({ from, to, only }, deps, (r) => {
  console.error(`  ${r.outcome.padEnd(9)} ${r.url}${r.error === null ? "" : ` — ${r.error}`}`);
});

const s = summarize(result.pages);
console.error(
  `\n대상 ${result.yearsAttempted.length}년 — 합계 ${s.total}장`
    + ` (신규 ${s.stored} / 변경없음 ${s.unchanged} / 부재 ${s.absent} / 실패 ${s.failed})`,
);
/**
 * ⚠**`absent`(404)는 결함이 아니다**(M11) — 그 해 기사가 아직 없을 수 있다.
 * ⚠**그렇다고 조용하지도 않다** — 과거 연도의 404 는 **표제가 바뀐 것**일 수 있고, 그건 사람이 봐야 한다.
 */
if (s.absent > 0) {
  console.error(`⚠404 가 ${s.absent}건이다 — 개최 전이면 정상이지만, **과거 연도면 표제가 바뀐 것**이다`);
}
process.exitCode = s.failed > 0 ? 1 : 0;
