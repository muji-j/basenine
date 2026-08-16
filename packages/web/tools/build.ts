/**
 * 정적 사이트 생성.
 *
 * ```
 * node packages/web/tools/build.ts data/bb.sqlite dist 2026
 * ```
 *
 * ⚠**서버가 없다.** 데이터는 하루 1회만 바뀌므로 요청마다 계산할 이유가 없고,
 * 정적 파일이면 D1 읽기 예산도 배포 때 1회만 쓴다.
 * ⚠**시계는 여기서 한 번만 읽는다**(M6). 아래로 내려가는 것은 `YYYY-MM-DD` 문자열이다.
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { brokenLinks } from "../src/link-check.ts";
import type { OutFile } from "../src/link-check.ts";
import { dirname, join, resolve } from "node:path";
import { openDb } from "@bb-app/store";
import { systemClock, toJstDateString } from "@bb-app/archiver";
import { buildSite, seasonPaths } from "../src/site.ts";
import type { BuildResult } from "../src/site.ts";
import { loadLog, loadSite } from "../src/query.ts";

const [dbArg, outArg, seasonArg, throughArg] = process.argv.slice(2);

if (dbArg === undefined || outArg === undefined || seasonArg === undefined) {
  console.error("usage: build.ts <db> <outDir> <season[,season...]> [through=YYYY-MM-DD]");
  process.exitCode = 2;
} else {
  /**
   * ⚠**첫 시즌이 「현재 시즌」이다.** 그 시즌만 사이트 루트에 놓이고 나머지는 `/{연도}/` 아래로 간다.
   * 기존 URL(`/players/x.html`)이 계속 현재 시즌을 가리키게 하기 위한 배치다.
   */
  const seasons = seasonArg.split(",").map((x) => Number(x.trim()));
  if (seasons.length === 0 || seasons.some((x) => !Number.isInteger(x))) {
    console.error(`시즌이 정수가 아니다: ${seasonArg}`);
    process.exitCode = 2;
  } else if (new Set(seasons).size !== seasons.length) {
    console.error(`시즌이 중복됐다: ${seasonArg}`);
    process.exitCode = 2;
  } else {
    const season = seasons[0]!;
    const now = systemClock.now();
    const builtOn = toJstDateString(now);
    const outDir = resolve(outArg);

    const db = openDb(resolve(dbArg), now.toISOString());
    try {
      const t0 = process.hrtime.bigint();
      /**
       * ⚠**전 시즌을 먼저 읽는다.** 시즌 전환이 「그 시즌에 같은 화면이 있는가」를 물어야 하고,
       * 그건 렌더링 **전에** 알아야 한다 — 없는 곳으로 링크하면 404가 되고 조용하다.
       */
      const loaded = seasons.map((s) => ({
        season: s,
        prefix: s === season ? "" : `${s}/`,
        data: loadSite(db, {
          season: s,
          builtOn,
          ...(throughArg === undefined ? {} : { through: throughArg }),
        }),
      }));
      const loadMs = Number(process.hrtime.bigint() - t0) / 1e6;

      const site = {
        /**
         * 제품명. **화면에 보이는 이름은 여기 하나뿐이다** — 표제·`<title>`·꼬리말이 전부 이 값을 쓴다.
         *
         * ⚠리포명(`bb-app`)·패키지명(`@bb-app/*`)·Pages 프로젝트명은 **내부 식별자**라
         * 제품명과 별개다. 바꿀 이유가 없고, 바꾸면 이력과 링크만 끊긴다.
         * 호스트명은 전용 도메인을 붙일 때 정리한다(deploy.md §7-2).
         */
        name: process.env["BB_SITE_NAME"] ?? "BaseNine",
        // ⚠**삭제·정정 요청 창구**(L4). 비어 있으면 화면이 「미설정」이라고 말한다 — 가짜 주소를 넣지 마라
        contact: process.env["BB_CONTACT"] ?? "",
      };

      // 운영 파일은 리포 안에 있다. 없으면 収集ログ 페이지가 「기록 없음」으로 그려진다
      // ⚠**수집 로그는 현재 시즌에만 붙인다.** 과거 시즌 화면에 「어제 수집했다」는 무의미하다
      const log = loadLog(db, {
        season,
        builtOn,
        runLogPath: "ops/collection-log.jsonl",
        manifestPath: "ops/archive-manifest.json",
        ...(throughArg === undefined ? {} : { through: throughArg }),
      });

      const plans = loaded.map((l) => ({
        season: l.season,
        prefix: l.prefix,
        paths: seasonPaths(l.data, l.season === season),
      }));

      rmSync(outDir, { recursive: true, force: true });
      let bytes = 0;
      let fileCount = 0;
      let current: BuildResult | null = null;
      // ⚠**링크 검사는 전 시즌을 모은 뒤에 한다** — `../2025/…` 처럼 시즌을 넘는 링크가 있다
      const all: OutFile[] = [];
      for (const l of loaded) {
        const r = buildSite(l.data, site, builtOn, l.season === season ? log : undefined, plans);
        if (l.season === season) current = r;
        for (const f of r.files) {
          const path = join(outDir, f.path);
          mkdirSync(dirname(path), { recursive: true });
          writeFileSync(path, f.content, "utf8");
          bytes += Buffer.byteLength(f.content, "utf8");
          fileCount += 1;
          all.push(f);
        }
        console.log(
          `  ${l.season}年${l.prefix === "" ? "(現行)" : ` → /${l.prefix}`} : ${r.files.length}파일 · 선수 ${r.playerCount}명 · 최신 ${r.latestGameDate ?? "없음"}`,
        );
      }
      const result = current!;

      const mb = (bytes / 1024 / 1024).toFixed(1);
      console.log(`생성: ${fileCount}파일 / ${mb}MB / 시즌 ${seasons.join("·")}`);
      console.log(`집계: ${loadMs.toFixed(0)}ms · 최신 경기일 ${result.latestGameDate ?? "없음"} · 생성일 ${builtOn}`);
      if (site.contact === "") {
        console.warn("⚠ BB_CONTACT 미설정 — 삭제·정정 요청 창구가 화면에 나오지 않는다(공개 전 필수)");
      }
      /**
       * ⚠**깨진 링크로 배포하지 않는다.**
       * `daily.yml`은 테스트도 타입체크도 돌리지 않고 빌드 뒤 바로 배포한다 — 여기가 마지막 그물이다.
       * 실제로 구단 페이지를 만들며 240개가 한 번에 404가 된 적이 있고(2026-08-16),
       * 그건 타입도 시험도 못 잡았다. 문자열이 문자열로 맞았기 때문이다.
       */
      const broken = brokenLinks(all);
      if (broken.length > 0) {
        const pages = broken.filter((b) => b.kind === "page").length;
        console.error(
          `⚠ 깨진 내부 링크 ${broken.length}개(페이지 없음 ${pages} · 앵커 없음 ${broken.length - pages}) — 배포하지 않는다`,
        );
        for (const b of broken.slice(0, 20)) {
          console.error(`   ${b.from} → ${b.href}（${b.kind === "page" ? `${b.to} 없음` : "그 앵커가 없음"}）`);
        }
        if (broken.length > 20) console.error(`   … 그 밖에 ${broken.length - 20}개`);
        process.exitCode = 1;
      } else {
        console.log(
          `링크: ${all.filter((f) => f.path.endsWith(".html")).length}장 검사(앵커 포함) · 깨진 것 없음`,
        );
      }
      if (result.stale) {
        console.error("⚠ 데이터가 낡았다 — 수집이 멈췄는지 확인하라");
        process.exitCode = 1;
      }
    } finally {
      db.close();
    }
  }
}
