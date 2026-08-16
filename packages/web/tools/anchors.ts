/**
 * 成績の紋 — 정규화 앵커를 다시 잰다.
 *
 * ⚠**이 도구가 없으면 앵커는 검증할 수 없는 수가 된다.**
 * 이중 검토에서 실제로 그 일이 났다 — 커밋이 「48.1% 대 75.0%」라고 적었는데
 * 리뷰어가 같은 모집단으로 재니 37.6% 대 65.7%가 나왔다. 두 수가 다른 이유는
 * **모집단이 달랐기 때문**(규정 도달자 대 도형이 그려지는 표본)인데, 그게 어디에도 안 적혀 있었다.
 * M4의 정신 — 「어제 본 숫자와 다른데?」에 답할 수 있어야 한다.
 *
 * ⚠**재측정 시점은 `marks.ts`가 정한다** — 2026 시즌 종료 후 한 번, 그 뒤로는 2027 종료 후.
 * 재측정하면 도형이 조금 달라진다. 그때 무엇을 언제 다시 쟀는지 그 파일에 남긴다.
 *
 * ```
 * node packages/web/tools/anchors.ts data/bb.sqlite
 * ```
 * ⚠**쓰기를 하지 않는다** — 읽고 표만 낸다. DB 사본을 쓰고 싶으면 사본 경로를 넘겨라.
 */
import { openDb } from "@bb-app/store";
import { aggregateSeason } from "@bb-app/aggregate";
import {
  battingAverage, earnedRunAverage, homeRunsPer9, iso, onBasePercentage,
  strikeoutRate, strikeoutsPer9, walkRate, walksPer9, whip,
} from "@bb-app/metrics";
import { PITCHING_ANCHORS, PROFILE_ANCHORS, battingProfile, pitchingProfile } from "../src/marks.ts";

/** 도형이 그려질 만한 최소 표본. ⚠**등급(`grade.ts`)과 같은 값이다** — 갈리면 화면이 딴말을 한다 */
const MIN_PA = 50;
const MIN_OUTS = 60;
const SEASONS = [2025, 2026];

const path = process.argv[2] ?? "data/bb.sqlite";
const db = openDb(path, "1970-01-01T00:00:00.000Z");

const bat: Record<string, number[]> = { avg: [], obp: [], iso: [], bbRate: [], contact: [] };
const pit: Record<string, number[]> = { k9: [], bb9: [], hr9: [], whip: [], era: [] };
const batR: number[] = [];
const pitR: number[] = [];
const batIds = new Set<string>();
const pitIds = new Set<string>();

try {
  for (const season of SEASONS) {
    const agg = aggregateSeason(db, season, "regular", "9999-12-31");
    for (const b of agg.batting) {
      if (b.line.pa < MIN_PA) continue;
      batIds.add(b.playerId);
      const push = (k: string, v: number | null): void => { if (v !== null) bat[k]!.push(v); };
      push("avg", battingAverage(b.line).value);
      push("obp", onBasePercentage(b.line).value);
      push("iso", iso(b.line).value);
      push("bbRate", walkRate(b.line).value);
      const k = strikeoutRate(b.line).value;
      push("contact", k === null ? null : 1 - k);
      const axes = battingProfile({
        avg: battingAverage(b.line), obp: onBasePercentage(b.line), iso: iso(b.line),
        bbRate: walkRate(b.line), kRate: strikeoutRate(b.line),
      });
      const v = axes.map((a) => a.scaled).filter((x): x is number => x !== null);
      if (v.length === axes.length) batR.push(v.reduce((a, c) => a + c, 0) / v.length);
    }
    for (const p of agg.pitching) {
      if (p.line.outs < MIN_OUTS) continue;
      pitIds.add(p.playerId);
      const push = (k: string, v: number | null): void => { if (v !== null) pit[k]!.push(v); };
      push("k9", strikeoutsPer9(p.line).value);
      push("bb9", walksPer9(p.line).value);
      push("hr9", homeRunsPer9(p.line).value);
      push("whip", whip(p.line).value);
      push("era", earnedRunAverage(p.line).value);
      const axes = pitchingProfile({
        k9: strikeoutsPer9(p.line), bb9: walksPer9(p.line), hr9: homeRunsPer9(p.line),
        whip: whip(p.line), era: earnedRunAverage(p.line),
      });
      const v = axes.map((a) => a.scaled).filter((x): x is number => x !== null);
      if (v.length === axes.length) pitR.push(v.reduce((a, c) => a + c, 0) / v.length);
    }
  }
} finally {
  db.close();
}

/** ⚠**백분위 정의를 여기 고정한다** — 정의가 다르면 같은 데이터에서 다른 앵커가 나온다 */
const q = (a: readonly number[], p: number): number => {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.max(0, Math.round((s.length - 1) * p)))]!;
};

const show = (title: string, data: Record<string, number[]>, cur: Readonly<Record<string, readonly number[]>>): void => {
  console.log(`\n── ${title} ──`);
  console.log("축         p10      p50      p90     | 지금 코드의 값");
  for (const [k, arr] of Object.entries(data)) {
    const next = [q(arr, 0.1), q(arr, 0.5), q(arr, 0.9)];
    const now = cur[k] ?? [];
    const same = next.every((v, i) => Math.abs(v - (now[i] ?? NaN)) < 0.0006);
    console.log(
      `${k.padEnd(9)} ${next.map((v) => v.toFixed(4).padStart(8)).join(" ")} | ` +
      `${now.join(", ")}${same ? "" : "   ⚠다르다 — marks.ts 를 갱신하라"}`,
    );
  }
};

console.log(`기준: ${SEASONS.join("·")} 정규시즌 · 타자 ${MIN_PA}타석↑ · 투수 ${MIN_OUTS}아웃↑`);
console.log(
  `모집단: 타자 ${batR.length} 선수-시즌(실인원 ${batIds.size}명) · ` +
  `투수 ${pitR.length} 선수-시즌(실인원 ${pitIds.size}명)`,
);
show("타자", bat, PROFILE_ANCHORS);
show("투수", pit, PITCHING_ANCHORS);

// ⚠**두 도형이 같은 뜻인가** — 이 도구의 존재 이유다. 중앙값이 갈리면 한쪽이 크게 보인다
console.log("\n── 평균 반지름(5축 평균) ──");
for (const [t, a] of [["타자", batR], ["투수", pitR]] as const) {
  console.log(
    `${t}  n=${String(a.length).padEnd(4)} p10 ${(q(a, 0.1) * 100).toFixed(1)}%  ` +
    `중앙 ${(q(a, 0.5) * 100).toFixed(1)}%  p90 ${(q(a, 0.9) * 100).toFixed(1)}%`,
  );
}
console.log(`중앙값의 차 ${(Math.abs(q(batR, 0.5) - q(pitR, 0.5)) * 100).toFixed(1)}%p`);
