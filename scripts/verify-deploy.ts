/**
 * **배포한 것이 실제로 「지금 보이는 것」이 되었는가.**
 *
 * ⚠**이 검사가 없어서 조사가 하루 걸렸다**(2026-08-30). 사용자가 8월 18일자 화면을 보고 있는데
 * 우리가 가진 증거는 전부 초록이었다 — DB 도 빌드도 배포도. `wrangler` 는 매번
 * `✨ Deployment complete!` 를 찍었고 **그 줄은 「업로드가 끝났다」까지만 말한다.**
 * 올린 것이 프로덕션이 되었는지는 **아무도 안 봤다.**
 *
 * ⚠**말이 갈리는 자리가 실재한다.** `wrangler pages deploy --branch main` 은
 * 프로젝트의 프로덕션 브랜치가 `main` 일 때만 프로덕션이 된다. 다르면 **매번 프리뷰**가 만들어지고
 * 성공 로그도 똑같이 나오며, 사람이 보는 주소는 **옛 배포에 멈춘 채로 남는다.**
 * 그 상태가 정확히 이 사고의 모양이라 **가설로 두지 않고 매일 잰다.**
 *
 * ⚠**「못 쟀다」를 「통과」로 만들지 않는다**(`scripts/access-config.ts` 와 같은 규율).
 * 토큰에 Pages 읽기 권한이 없으면 그것은 **검사가 돌지 않은 것**이지 정상이 아니다.
 * ⚠**Cloudflare 는 범위 밖 자원에 403 이 아니라 빈 결과를 주기도 한다**(2026-08-24 실측) —
 * 그래서 `null` 도 「못 쟀다」로 읽는다.
 *
 * ⚠**시각은 인자로 받는다**(M6) — 여기서 `Date.now()` 를 부르지 마라.
 */

/** Pages 프로젝트에서 우리가 보는 만큼. ⚠**모르는 필드는 안 적는다** — 없으면 없다고 말해야 한다 */
export interface PagesDeployment {
  id: string;
  /** `production` | `preview`. 없을 수 있다 */
  environment?: string | null;
  created_on?: string | null;
}

export interface PagesProject {
  production_branch?: string | null;
  /** **지금 프로덕션 주소가 가리키는 것.** 이것이 이 검사의 본체다 */
  canonical_deployment?: PagesDeployment | null;
  /** 가장 최근에 만들어진 것(프리뷰일 수 있다) */
  latest_deployment?: PagesDeployment | null;
}

export type DeployVerdict =
  | { kind: "unmeasured"; why: string }
  | { kind: "wrong-branch"; productionBranch: string; deployBranch: string }
  | { kind: "not-live"; liveId: string; latestId: string; liveAgeHours: number | null }
  | { kind: "stale"; liveId: string; liveAgeHours: number }
  | { kind: "ok"; liveId: string; liveAgeHours: number | null };

/**
 * 몇 시간이 넘으면 「살아 있는 배포가 낡았다」고 볼 것인가.
 *
 * ⚠**하루 3회 배포**(00:00 · 09:00 · 18:00 JST 부근)이므로 정상이면 최대 9시간이다.
 * 여유를 두어 **12시간**으로 잡는다 — 재시도 슬롯이 밀린 날에 거짓 경보를 내지 않기 위해서다.
 * ⚠**이 값을 늘려서 경보를 끄지 마라.** 늘리는 순간 이 사고가 다시 조용해진다.
 */
export const LIVE_STALE_AFTER_HOURS = 12;

/**
 * ⚠**순수 함수라 네트워크 없이 시험한다** — 판정이 검증되지 않은 채로 남는 것이 이 저장소의 지병이다.
 *
 * @param nowIso 지금(ISO). **주입한다**(M6)
 * @param deployBranch `wrangler ... --branch` 에 넘긴 값
 */
export function verdictFor(
  project: PagesProject | null,
  deployBranch: string,
  nowIso: string,
): DeployVerdict {
  if (project === null) return { kind: "unmeasured", why: "프로젝트를 못 읽었다" };

  const prodBranch = project.production_branch ?? "";
  if (prodBranch === "") return { kind: "unmeasured", why: "production_branch 가 응답에 없다" };
  if (prodBranch !== deployBranch) {
    return { kind: "wrong-branch", productionBranch: prodBranch, deployBranch };
  }

  const live = project.canonical_deployment ?? null;
  if (live === null || live.id === "") {
    return { kind: "unmeasured", why: "canonical_deployment 가 응답에 없다" };
  }
  const ageHours = ageInHours(live.created_on ?? null, nowIso);

  const latest = project.latest_deployment ?? null;
  // ⚠**`latest` 를 모르면 「어긋났다」고 말하지 않는다** — 모르는 것과 어긋난 것은 다르다(M11)
  if (latest !== null && latest.id !== "" && latest.id !== live.id) {
    return { kind: "not-live", liveId: live.id, latestId: latest.id, liveAgeHours: ageHours };
  }

  if (ageHours !== null && ageHours > LIVE_STALE_AFTER_HOURS) {
    return { kind: "stale", liveId: live.id, liveAgeHours: ageHours };
  }
  return { kind: "ok", liveId: live.id, liveAgeHours: ageHours };
}

/** ⚠**못 읽으면 `null` 이다. 0 으로 메우지 마라**(M11) — 0시간은 「방금」이라는 뜻이 되어 버린다 */
export function ageInHours(createdOn: string | null, nowIso: string): number | null {
  if (createdOn === null || createdOn === "") return null;
  const a = Date.parse(createdOn);
  const b = Date.parse(nowIso);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return (b - a) / 3_600_000;
}

/** 사람이 읽는 한 줄. ⚠**무엇을 해야 하는지까지 적는다** — 진단만 있으면 아무도 안 고친다 */
export function describe(v: DeployVerdict): { level: "ok" | "warning" | "error"; text: string } {
  switch (v.kind) {
    case "ok":
      return {
        level: "ok",
        text: `프로덕션이 방금 올린 배포다 (${v.liveId}${age(v.liveAgeHours)})`,
      };
    case "unmeasured":
      return {
        level: "warning",
        text:
          `배포 반영을 **못 쟀다** — ${v.why}. 통과가 아니라 검사가 돌지 않은 것이다.\n` +
          "토큰에 Cloudflare Pages 읽기 권한을 붙이면 이 검사가 산다.",
      };
    case "wrong-branch":
      return {
        level: "error",
        text:
          `S1 배포 경로가 어긋났다 — 프로젝트의 프로덕션 브랜치는 '${v.productionBranch}' 인데 ` +
          `'${v.deployBranch}' 로 올리고 있다. **매번 프리뷰가 만들어지고 사람이 보는 주소는 옛 배포에 멈춘다.**\n` +
          "고치는 곳은 둘 중 하나다: Pages 프로젝트의 프로덕션 브랜치, 또는 daily.yml 의 --branch.",
      };
    /**
     * ⚠**나이를 봐서 가른다.** 배포 직후에는 `canonical` 갱신이 몇 초 늦을 수 있고,
     * 그때마다 붉어지면 **이 검사는 「또 그거네」가 되어 곧 지워진다.**
     * 그런데 지금 보이는 것이 **이미 낡았는데** 최신과도 다르면 그것은 전파 지연이 아니다.
     * ⚠**나이를 모르면 경고에 머문다**(M11) — 모르는 것으로 배포를 세우지 않는다.
     */
    case "not-live": {
      const lagging = v.liveAgeHours !== null && v.liveAgeHours > LIVE_STALE_AFTER_HOURS;
      return {
        level: lagging ? "error" : "warning",
        text:
          `올린 배포가 프로덕션이 되지 않았다 — 지금 보이는 것은 ${v.liveId}${age(v.liveAgeHours)} 인데 ` +
          `가장 최근 배포는 ${v.latestId} 다.` +
          (lagging ? "" : "\n방금 올렸다면 전파 중일 수 있다. 다음 실행에서도 같으면 전달 경로가 끊긴 것이다."),
      };
    }
    case "stale":
      return {
        level: "error",
        text:
          `지금 보이는 배포가 ${v.liveAgeHours.toFixed(1)}시간 전 것이다(${v.liveId}). ` +
          `하루 3회 배포이므로 ${LIVE_STALE_AFTER_HOURS}시간을 넘으면 전달 경로가 끊긴 것이다.`,
      };
  }
}

function age(h: number | null): string {
  return h === null ? "" : ` · ${h.toFixed(1)}시간 전`;
}

interface ApiResult<T> {
  success: boolean;
  result: T;
}

const API = "https://api.cloudflare.com/client/v4";

async function main(): Promise<number> {
  const token = process.env["CLOUDFLARE_API_TOKEN"];
  const account = process.env["CLOUDFLARE_ACCOUNT_ID"];
  const projectName = process.env["BB_PAGES_PROJECT"] ?? "bb-app";
  const branch = process.env["BB_PAGES_BRANCH"] ?? "main";

  let project: PagesProject | null = null;
  let why = "";
  if (token === undefined || account === undefined || token === "" || account === "") {
    why = "CLOUDFLARE_API_TOKEN 또는 CLOUDFLARE_ACCOUNT_ID 가 없다";
  } else {
    try {
      const res = await fetch(`${API}/accounts/${account}/pages/projects/${projectName}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = (await res.json().catch(() => null)) as ApiResult<PagesProject> | null;
      if (body?.success === true && body.result !== undefined) project = body.result;
      else why = `HTTP ${res.status}`;
    } catch (e) {
      why = `요청 실패: ${String(e).slice(0, 80)}`;
    }
  }

  const v =
    project === null
      ? ({ kind: "unmeasured", why } satisfies DeployVerdict)
      : verdictFor(project, branch, new Date().toISOString());
  const { level, text } = describe(v);
  if (level === "error") {
    console.error(`::error::${text.split("\n")[0]}`);
    console.error(text);
    return 1;
  }
  if (level === "warning") {
    console.log(`::warning::${text.split("\n")[0]}`);
    console.log(text);
    return 0;
  }
  console.log(text);
  return 0;
}

// ⚠**진입점에서만 시계를 읽는다**(M6 · scripts/ 는 목록에 적힌 만큼 예외다)
if (process.argv[1]?.endsWith("verify-deploy.ts") === true) {
  process.exit(await main());
}
