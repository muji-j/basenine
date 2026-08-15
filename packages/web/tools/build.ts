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
import { dirname, join, resolve } from "node:path";
import { openDb } from "@bb-app/store";
import { systemClock, toJstDateString } from "@bb-app/archiver";
import { buildSite } from "../src/site.ts";
import { loadSite } from "../src/query.ts";

const [dbArg, outArg, seasonArg, throughArg] = process.argv.slice(2);

if (dbArg === undefined || outArg === undefined || seasonArg === undefined) {
  console.error("usage: build.ts <db> <outDir> <season> [through=YYYY-MM-DD]");
  process.exitCode = 2;
} else {
  const season = Number(seasonArg);
  if (!Number.isInteger(season)) {
    console.error(`시즌이 정수가 아니다: ${seasonArg}`);
    process.exitCode = 2;
  } else {
    const now = systemClock.now();
    const builtOn = toJstDateString(now);
    const outDir = resolve(outArg);

    const db = openDb(resolve(dbArg), now.toISOString());
    try {
      const t0 = process.hrtime.bigint();
      const data = loadSite(db, {
        season,
        builtOn,
        ...(throughArg === undefined ? {} : { through: throughArg }),
      });
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

      const result = buildSite(data, site, builtOn);

      rmSync(outDir, { recursive: true, force: true });
      let bytes = 0;
      for (const f of result.files) {
        const path = join(outDir, f.path);
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, f.content, "utf8");
        bytes += Buffer.byteLength(f.content, "utf8");
      }

      const mb = (bytes / 1024 / 1024).toFixed(1);
      console.log(`생성: ${result.files.length}파일 / ${mb}MB / 선수 ${result.playerCount}명`);
      console.log(`집계: ${loadMs.toFixed(0)}ms · 최신 경기일 ${result.latestGameDate ?? "없음"} · 생성일 ${builtOn}`);
      if (site.contact === "") {
        console.warn("⚠ BB_CONTACT 미설정 — 삭제·정정 요청 창구가 화면에 나오지 않는다(공개 전 필수)");
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
