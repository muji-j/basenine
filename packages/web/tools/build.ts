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
import { brokenLinksIn, duplicateIds, linkIndex } from "../src/link-check.ts";
import type { LinkIndex } from "../src/link-check.ts";
import { dirname, join, resolve } from "node:path";
import { openDb } from "@bb-app/store";
import { systemClock, toJstDateString } from "@bb-app/archiver";
import { buildSite, seasonPaths } from "../src/site.ts";
import type { BuildResult } from "../src/site.ts";
// ⚠**연락처 게이트의 판정은 한 벌이다**(M1) — 조건을 여기서 다시 쓰지 않는다
import { contactGate } from "../src/layout.ts";
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
      /**
       * ⚠**링크 검사는 전 시즌을 모은 뒤에 한다** — `../2025/…` 처럼 시즌을 넘는 링크가 있다.
       * ⚠**그렇다고 본문을 들고 있으면 안 된다**(2026-08-18 실측). 15,434장의 본문이
       * 약 900MB 라 CI 러너의 기본 힙(약 2GB)에서 **9시즌째에 OOM 으로 죽었다**(run 32126443819).
       * 검사가 실제로 보는 것은 `id` 집합과 링크·ARIA 참조뿐이라, **쓰자마자 색인만 남기고 버린다.**
       */
      const all: LinkIndex[] = [];
      for (const l of loaded) {
        const r = buildSite(l.data, site, builtOn, l.season === season ? log : undefined, plans);
        if (l.season === season) current = r;
        for (const f of r.files) {
          const path = join(outDir, f.path);
          mkdirSync(dirname(path), { recursive: true });
          writeFileSync(path, f.content, "utf8");
          bytes += Buffer.byteLength(f.content, "utf8");
          fileCount += 1;
          all.push(linkIndex(f));
        }
        console.log(
          `  ${l.season}年${l.prefix === "" ? "(現行)" : ` → /${l.prefix}`} : ${r.files.length}파일 · 선수 ${r.playerCount}명 · 최신 ${r.latestGameDate ?? "없음"}`,
        );
      }
      const result = current!;

      /**
       * ⚠**목록에 적었는데 데이터가 없는 시즌을 조용히 배포하지 않는다.**
       *
       * DB는 매 실행 아카이브 전체를 다시 훑어 만들어지므로, **아카이브에 없는 시즌을
       * 시즌 목록에 적으면 그 시즌이 빈 화면으로 생성된다.** 그런데 그것을 막는 것이
       * 아무것도 없었다 — 신선도 검사는 **현재 시즌만** 보고, 링크 검사는 선수가 0명이면
       * 링크도 0개라 통과한다. 로그에 `선수 0명` 한 줄이 찍히고 배포는 그대로 진행된다
       * (2026-08-17 이중 검토 지적).
       *
       * ⚠**0명은 「없다」가 아니라 「잘못 적었다」로 본다**(M12) — 시즌을 목록에 적는 것은
       * 사람의 선언이고, 그 선언이 데이터와 어긋나면 그건 사고다.
       */
      const emptySeasons = loaded.filter((l) => l.data.players.length === 0).map((l) => l.season);
      if (emptySeasons.length > 0) {
        console.error(
          `⚠시즌 목록에 있는데 선수가 0명이다: ${emptySeasons.join("·")} — ` +
            "보관소 아카이브에 그 시즌이 있는지 확인하라. **빈 화면을 배포하지 않는다**",
        );
        process.exitCode = 1;
      }

      /**
       * ⚠**우승 판정이 통째로 사라진 채 배포하지 않는다**(2026-08-19 검토 m2).
       *
       * 성적(`w/l/t/games`)과 대전표가 어긋나면 `seasonRace` 가 시즌 전체를 `unknown` 으로
       * 떨어뜨려 **12구단 페이지의 판정이 한꺼번에 없어진다.** 그런데 화면 문구는 정직하고
       * (「優勝争いはまだ判定できません」) 신호는 `console.warn` 하나뿐이었다 —
       * CI 가 stderr 를 안 읽으면 아무도 모른다. **M7 의 「실패로」에 반쯤만 닿아 있었다.**
       *
       * ⚠**`basis: "unknown"` 전체를 막는 것이 아니다.** 교류전이 안 끝난 4~5월의 `unknown` 은
       * **정상 상태**다(실측: 2026 타임라인에서 06-01 부터 `confirmed`). 여기서 보는 것은
       * 「성적과 대전표가 서로 다른 세계의 것이다」뿐이고, 그건 언제나 파이프라인 결함이다.
       * ⚠**산출물은 남긴다** — `stale`·`emptySeasons` 와 같은 형식이다. 배포만 막는다.
       */
      const disagreedSeasons = loaded.filter((l) => l.data.raceDisagreed.length > 0);
      if (disagreedSeasons.length > 0) {
        console.error(
          "⚠ 성적과 대전표가 어긋난다 — 우승 경쟁 판정이 통째로 사라진 채 나갈 뻔했다. 배포하지 않는다",
        );
        for (const l of disagreedSeasons) {
          console.error(`   ${l.season}: ${l.data.raceDisagreed.length}구단 — ${l.data.raceDisagreed.join(" ")}`);
        }
        process.exitCode = 1;
      }

      const mb = (bytes / 1024 / 1024).toFixed(1);
      console.log(`생성: ${fileCount}파일 / ${mb}MB / 시즌 ${seasons.join("·")}`);
      console.log(`집계: ${loadMs.toFixed(0)}ms · 최신 경기일 ${result.latestGameDate ?? "없음"} · 생성일 ${builtOn}`);
      /**
       * ⚠**연락처가 없으면 화면이 조용하지 않다**(L4 · 2026-08-20).
       * 꼬리말이 「連絡先が未設定です（公開前に設定してください）」라는 **개발자 지시문**을
       * 방문자에게 낸다 — 그것도 15,340장 전부에서. 예전에는 `console.warn` 하나뿐이라
       * 종료 코드가 0이었고, `emptySeasons`·`stale`·`raceDisagreed` 와 **등급이 달랐다**.
       * ⚠**판정은 `layout.ts` 의 `contactGate` 가 한다** — 여기서 조건을 다시 쓰면 두 벌이 된다.
       *   로컬을 막지 않는 이유와 `BB_REQUIRE_CONTACT` 를 켜는 자리도 거기에 적혀 있다.
       */
      const contact = contactGate(site.contact, process.env["BB_REQUIRE_CONTACT"]);
      if (contact.fatal) {
        console.error(contact.message);
        process.exitCode = 1;
      } else if (contact.missing) {
        console.warn(contact.message);
      }
      /**
       * ⚠**깨진 링크로 배포하지 않는다.**
       * `daily.yml`은 테스트도 타입체크도 돌리지 않고 빌드 뒤 바로 배포한다 — 여기가 마지막 그물이다.
       * 실제로 구단 페이지를 만들며 240개가 한 번에 404가 된 적이 있고(2026-08-16),
       * 그건 타입도 시험도 못 잡았다. 문자열이 문자열로 맞았기 때문이다.
       */
      const broken = brokenLinksIn(all);
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

      /**
       * ⚠**중복 id 로 배포하지 않는다.**
       *
       * 링크 검사는 「가리키는 곳이 있는가」만 봤고 「그곳이 **하나인가**」는 못 봤다 —
       * `LinkIndex.ids` 가 `Set` 이었기 때문이다. 그래서 **그물이 있는데 구멍이 있었다**:
       * 순위표 9장(시즌별 8 + 현행 1)에 중복 id **86종 / 172노드**가 있었는데
       * 앵커 검사도 ARIA 검사도 전부 통과했다(2026-08-19 감사 실측).
       * 그동안 `ranking.html#pn-rankmetric-starter-era` 로 들어가면
       * 브라우저가 먼저 나온 セ 사본을 열어 **パ의 개인 지표에 도달하는 URL 이 없었다.**
       * ⚠**id 가 겹치면 앵커·ARIA 검사 자체가 무의미해진다** — 그래서 링크 검사보다
       * 약한 신호가 아니라 **같은 등급의 배포 차단**이다.
       */
      const dups = duplicateIds(all);
      if (dups.length > 0) {
        const pages = new Set(dups.map((d) => d.path));
        console.error(
          `⚠ 같은 문서에 중복된 id ${dups.length}종 / ${pages.size}장 — 그 자리로 가는 URL 이 다른 곳을 연다. 배포하지 않는다`,
        );
        for (const d of dups.slice(0, 20)) console.error(`   ${d.path} → id="${d.id}"`);
        if (dups.length > 20) console.error(`   … 그 밖에 ${dups.length - 20}종`);
        process.exitCode = 1;
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
