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
import { brokenLinksIn, duplicateIds, linkIndex, tooDeepPlayerPages } from "../src/link-check.ts";
import type { LinkIndex } from "../src/link-check.ts";
import { dirname, join, resolve } from "node:path";
import { collectionEvidence, openDb } from "@bb-app/store";
import { systemClock, toJstDateString } from "@bb-app/archiver";
import { DRAFT_SEASON_PATHS, buildDraftSeason, buildSite, seasonPaths } from "../src/site.ts";
import type { BuildResult } from "../src/site.ts";
// ⚠**연락처 게이트의 판정은 한 벌이다**(M1) — 조건을 여기서 다시 쓰지 않는다
import { collectionStatus, contactGate } from "../src/layout.ts";
import {
  buildCareerContext,
  draftHeldSeasons,
  gameHeldSeasons,
  loadDraftPage,
  loadLog,
  loadSite,
} from "../src/query.ts";

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
       * ⚠**시즌을 넘는 계산은 한 번만 한다.**
       *
       * 火消し 의 이닝 도중 등판 조회와 등판 시점 RE 행렬은 **보유 첫 시즌부터** 필요하다.
       * 시즌마다 만들면 **시즌 수의 제곱**으로 늘어난다 — 9시즌 실측(2026-08-20)으로
       * 조회 누계 26.3초 · RE 90회 14.8초였고, 한 번씩만 만들면 2.5초 · 18회다.
       * ⚠**`loadSite` 는 이것 없이도 돈다**(스스로 만든다) — 여기서 넘기는 것은 **속도뿐**이고,
       *   답이 같다는 것을 `relief-seasons.test.ts` 가 실DB로 고정한다.
       */
      const held = db.raw
        .prepare("SELECT MIN(season) AS lo, MAX(season) AS hi FROM game")
        .get() as { lo: number | null; hi: number | null };
      const career = buildCareerContext(db, {
        from: held.lo ?? Math.min(...seasons),
        to: held.hi ?? Math.max(...seasons),
        ...(throughArg === undefined ? {} : { through: throughArg }),
      });
      /**
       * ⚠**투수를 모르는 타석은 火消し 를 조용히 줄인다**(M11). 실측(2026-08-21)으로
       * 정규시즌 `status='final'` **552,563행 중 0행**이지만, CLAUDE.md §2-2 가
       * 「소급 시즌은 투수 귀속이 얇을 수 있다」고 적어 뒀다 — 백필이 그 창을 열면 여기가 먼저 말한다.
       * **배포는 막지 않는다**(값이 없어지는 게 아니라 얇아진다).
       * ⚠**어느 시즌인지까지 말한다** — 합계만으로는 어느 백필을 되짚어야 하는지 모른다.
       */
      const unknownBySeason = [...career.reliefScan.unknownPitcher].sort((a, b) => a[0] - b[0]);
      const unknownPa = unknownBySeason.reduce((sum, [, n]) => sum + n, 0);
      if (unknownPa > 0) {
        console.warn(
          `⚠ 투수를 모르는 타석 ${unknownPa}건（${unknownBySeason.map(([s, n]) => `${s}:${n}`).join(" ")}）` +
            " — 火消し 의 교대 판정이 그만큼 성립하지 않는다",
        );
      }
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
          career,
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

      /**
       * **드래프트만 있는 시즌**(2026-09-07).
       *
       * ⚠**데이터는 이미 있고 화면만 없었다.** DB 가 가진 드래프트는 2005~2025 인데
       * 사이트가 굽는 시즌은 2018~2026 이라, **13년분이 「데이터는 있는데 화면이 없다」**였다.
       * 화면 스스로 그렇게 적고 있었다(「2018〜2025年を表示（収録は2005〜2025年）」).
       * ⚠**시즌을 통째로 늘리지 않는다** — 경기 데이터가 없어 선수·구단·순위가 전부
       * 빈 화면으로 생긴다. 경기를 소급 수집하려면 약 34시간의 외부 요청이 든다(CLAUDE.md §2-2).
       * ⚠**외부 요청 0** — `loadDraftPage` 는 DB 만 읽는다.
       * ⚠**내림차순으로 붙인다** — 시즌 띠가 `plans` 의 순서 그대로 그려지므로,
       *   현재 시즌(첫 칸)이 바뀌면 `pastSeasonOf` 판정까지 흔들린다.
       */
      const draftOnly = draftHeldSeasons(db)
        .filter((s) => !seasons.includes(s))
        .sort((a, b) => b - a);

      const plans = [
        ...loaded.map((l) => ({
          season: l.season,
          prefix: l.prefix,
          paths: seasonPaths(l.data, l.season === season),
        })),
        ...draftOnly.map((s) => ({ season: s, prefix: `${s}/`, paths: DRAFT_SEASON_PATHS })),
      ];

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
      /**
       * ⚠**수집 판정은 빌드마다 한 번 · 사이트 전체 · DB 증거로**(설계 D9). 감시(`scripts/freshness.ts`)와 **같은 증거·판정 함수**를
       * 유예 3 · 백스톱 +1 로 부른다 — 옛 규칙(최신 경기가 3일보다 오래됐다)은 **4일 넘는 휴식마다 빌드를 실패시켰다.**
       * ⚠모든 시즌에 **같은 값**을 넘긴다 — 그리는 시즌의 날짜로 따로 판정하면 과거 시즌 빌드가 다른 말을 한다.
       */
      const collection = collectionStatus(collectionEvidence(db, builtOn));
      for (const l of loaded) {
        const r = buildSite(l.data, site, builtOn, l.season === season ? log : undefined, plans, collection);
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
      /**
       * ⚠**여기서 만드는 것은 드래프트 한 장뿐이다.** 다른 화면을 만들면
       * 경기가 없는 시즌에 **빈 화면**이 생기고, 그건 「그 해는 원래 그렇다」로 읽힌다.
       * ⚠**상단 내비는 이 시즌에 없는 화면을 가장 최신 시즌으로 보낸다**(`pathsFor` 의 `navTo`).
       *   그 대체를 화면이 `→` 와 `aria-label` 로 말한다 — 조용히 해가 바뀌면 안 된다.
       */
      const heldGames = { from: held.lo ?? 0, to: held.hi ?? 0 };
      for (const s of draftOnly) {
        const files = buildDraftSeason(
          loadDraftPage(db, { season: s, builtOn, ...(throughArg === undefined ? {} : { through: throughArg }) }),
          site,
          builtOn,
          heldGames,
          plans,
        );
        for (const f of files) {
          const path = join(outDir, f.path);
          mkdirSync(dirname(path), { recursive: true });
          writeFileSync(path, f.content, "utf8");
          bytes += Buffer.byteLength(f.content, "utf8");
          fileCount += 1;
          all.push(linkIndex(f));
        }
      }
      if (draftOnly.length > 0) {
        console.log(`  ドラフトのみ ${draftOnly.length}시즌(${draftOnly.at(-1)}〜${draftOnly[0]}) : ${draftOnly.length}파일`);
      }
      const result = current!;

      /**
       * ⚠**경기가 있는 시즌을 드래프트 한 장으로 굽지 않는다**(2026-09-07 이중 검토 P3).
       *
       * `draftOnly` 는 **「빌드 인자 목록에 없는 드래프트 시즌」**을 전부 드래프트 전용으로 본다.
       * 그 분류에는 **경기가 있는지 묻는 자리가 없다** — 2017 을 백필해 놓고 `package.json` 의
       * 시즌 목록 갱신을 잊으면 그 시즌이 **조용히 한 장으로만 구워지고** 선수·경기·순위가
       * 통째로 사라진 채 **「그 해는 원래 드래프트만 있는 해」로 읽힌다.**
       * ⚠**빈 화면조차 안 남는다** — 바로 아래 `emptySeasons` 는 **목록에 적힌** 시즌만 보므로
       *   이 갈래에는 닿지 않는다. 링크 검사도 통과한다(없는 화면은 링크도 없다).
       *   M7 이 경계하는 「조용한 0」보다 더 안 보이는 모양이다.
       * ⚠**바로 아래 게이트와 방향이 반대인 짝이다**: 저쪽은 「적었는데 데이터가 없다」,
       *   이쪽은 **「데이터가 있는데 안 적었다」**다. 둘 다 사람의 선언과 데이터가 어긋난 사고다.
       * ⚠**산출물은 남긴다** — 다른 게이트와 같은 형식이다. 배포만 막는다.
       */
      const gameSeasons = new Set(gameHeldSeasons(db));
      const droppedSeasons = draftOnly.filter((s) => gameSeasons.has(s));
      if (droppedSeasons.length > 0) {
        console.error(
          `⚠ 경기가 있는 시즌을 ドラフト 한 장으로만 구웠다: ${droppedSeasons.join("·")} — ` +
            `시즌 목록(${seasons.join(",")})에 넣어라. **선수·경기·순위가 통째로 사라진다**. 배포하지 않는다`,
        );
        process.exitCode = 1;
      }

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

      /**
       * ⚠**끝난 시즌인데 우승 판정이 없는 채로 배포하지 않는다**(2026-08-21 검토 ①).
       *
       * 위 게이트는 `disagreed` 만 본다. 그런데 `deriveSeriesLengths` 가 실패하는 경로는
       * **`disagreed` 를 비운 채** 12구단 판정을 전멸시킨다 — 조합표의
       * 「`unknown` · `series: null` · `disagreed: []`」 갈래다(`race.ts`).
       * 유도는 **순위표에 12구단이 정확히 6:6 으로 있을 것**을 요구하므로,
       * 팀 코드가 하나라도 새거나 빠지면 그대로 이 갈래로 떨어진다.
       * ⚠**CLAUDE.md §2-2 의 2018 오릭스 `bs` 슬러그 사고가 정확히 그 모양이다** —
       * 148경기가 「모르는 팀 코드」로 실패했고, 그대로 뒀으면 **그 시즌 성적이 화면에서 사라진 채
       * 「그 시즌은 원래 그렇다」로 읽혔을 것**이다.
       *
       * ⚠**무조건 막을 수는 없다.** 교류전이 안 끝난 4~5월의 `unknown` 은 **정상**이다
       * (실측: 2026 타임라인에서 06-01 부터 `confirmed`). 가르는 것은 **시즌이 끝났는가**다 —
       * 끝난 시즌은 「아직 모른다」가 성립할 수 없다.
       * ⚠**판정 조건의 정본은 `query.ts` 다**(M1). 여기서 조건을 다시 쓰지 않고 그 결과만 읽는다 —
       *   아래 wOBA 계수 게이트와 같은 형식이다.
       * ⚠**실측(2026-08-21 · 로컬 DB 9시즌 전수): 2018~2026 전부 `confirmed` 라 발화 0건이다.**
       *   「0건」과 「안 쟀음」은 다르다 — 이 게이트가 있어야 그 0건이 매 배포마다 다시 확인된다.
       */
      const raceMissing = loaded.filter(
        (l) => l.data.raceStatus.seasonOver && l.data.raceStatus.basis === "unknown",
      );
      if (raceMissing.length > 0) {
        console.error(
          `⚠ 이미 끝난 시즌인데 우승 판정이 서지 않았다 — ${raceMissing.length}시즌. 배포하지 않는다`,
        );
        for (const l of raceMissing) {
          const s = l.data.raceStatus;
          console.error(
            `   ${l.season}: 규정 대전수 ${s.series === null
              ? "유도 실패（순위표의 팀 코드가 12개·6:6 인지 먼저 봐라）"
              : `リーグ内${s.series.intra}/交流戦${s.series.inter}`}` +
              ` · 어긋난 구단 ${l.data.raceDisagreed.length}개`,
          );
        }
        process.exitCode = 1;
      }

      /**
       * ⚠**wOBA 계수를 제대로 유도하지 못한 채 배포하지 않는다**(2026-08-21 최종 검토 P2-②·③).
       *
       * 셋 다 **화면에 한 글자도 안 드러난다**:
       * ⑴ `fellBack` — 폴백 계수로 떨어져도 값만 조금 밀린다(자격자 중앙 약 1 wRC+).
       *    그런데 용어집은 「係数は当サイトがリーグ・シーズンごとに算出」이라고 쓴다 — **화면이 거짓말을 한다.**
       * ⑵ `skipped` — 하프이닝 중간의 타석이 걸러졌다는 뜻이고, 그때는 값이 빠지는 게 아니라
       *    **남은 값이 틀린다.** 분모로도 결측 카운터로도 안 드러난다.
       * ⑶ `unrecognized` — 파서 어휘가 DB 보다 낡았다(M7).
       *
       * ⚠**예전에는 ⑴ 이 `console.warn` 하나였고 ⑵⑶ 은 아무도 안 읽었다.** 그래서 종료 코드가
       * 0이었고 `emptySeasons`·`stale`·`raceDisagreed` 와 **등급이 달랐다** — 연락처 게이트와 같은 모양이다.
       * ⚠**판정 조건의 정본은 `query.ts` 다**(M1). 여기서 조건을 다시 쓰지 않고 그 결과만 읽는다.
       * ⚠**실측(2026-08-21): 18/18 리그-시즌에서 셋 다 0이다.** 「0건」과 「안 쟀음」은 다르다 —
       *    이 게이트가 있어야 「0건」이 계속 참인지 매 배포마다 확인된다.
       */
      const wobaBad = loaded.flatMap((l) =>
        l.data.wobaDerivation
          .filter((w) => w.fellBack || w.skipped > 0 || w.unrecognized > 0)
          .map((w) => ({ season: l.season, ...w })),
      );
      if (wobaBad.length > 0) {
        console.error(
          `⚠ wOBA 계수 유도가 온전하지 않다 — ${wobaBad.length}개 리그-시즌. 배포하지 않는다`,
        );
        for (const w of wobaBad) {
          const why = w.fellBack
            ? "타석 로그가 0건이라 폴백 계수로 떨어졌다（화면은 「当サイトが算出」이라고 말한다）"
            : `미계산 타석 ${w.skipped}건 · 모르는 결과 문자열 ${w.unrecognized}건`;
          console.error(`   ${w.season} ${w.league}: ${why}`);
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
       * ⚠**「3클릭 이내」는 규약인데 아무도 안 보고 있었다**(CLAUDE.md §0-1 · 2026-08-31).
       * 화면을 늘리거나 내비를 줄이면 **조용히 4클릭이 되고 아무도 모른다** —
       * 깨진 링크와 달리 **아무것도 실패하지 않기 때문**이다.
       * ⚠**링크 그래프를 여기서 다시 만들지 않는다** — 바로 위 검사가 쓴 색인을 그대로 쓴다.
       * ⚠**배포를 막지 않고 경고로 둔다**: 판정이 「도달 가능성」이라 새 화면을 만드는 도중에
       * 잠시 깊어질 수 있고, 그때 배포가 멈추면 이 검사가 곧 지워진다.
       * 대신 **시험이 0건을 못 박는다**(`link-depth.test.ts`).
       */
      const deep = tooDeepPlayerPages(all);
      if (deep.length > 0) {
        console.warn(
          `⚠ 선수 페이지 ${deep.length}장이 홈에서 3클릭을 넘는다(§0-1) — ` +
            deep.slice(0, 5).map((d) => `${d.path}=${d.clicks ?? "도달 불가"}`).join(" · "),
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
        // ⚠**「종」이 아니다**(2026-08-20 최종 검토 ⑥). `dups` 한 건은 (문서, id) **쌍**이라
        //   같은 id 가 9장에 있으면 9건이다 — 「9종」으로 읽히면 규모가 9배로 부풀어 보인다.
        //   id 의 종수는 따로 센다(작업규칙 7 — 분모와 단위를 정확히 쓴다).
        const kinds = new Set(dups.map((d) => d.id));
        console.error(
          `⚠ 같은 문서에 중복된 id ${dups.length}건（${pages.size}장 · id ${kinds.size}종） — 그 자리로 가는 URL 이 다른 곳을 연다. 배포하지 않는다`,
        );
        for (const d of dups.slice(0, 20)) console.error(`   ${d.path} → id="${d.id}"`);
        if (dups.length > 20) console.error(`   … 그 밖에 ${dups.length - 20}건`);
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
