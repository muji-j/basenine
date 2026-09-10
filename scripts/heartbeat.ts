/**
 * **파이프라인이 멈춘 것을 알린다.** 수집은 하지 않는다.
 *
 * ⚠**이 자리가 비어 있었다**(2026-09-09 발견). 우리 문서 여러 곳이 「화면의 신선도 띠가 뜨면 안다」를
 * 안전망으로 적어 왔는데 **거짓이다**: `packages/web/src/layout.ts:160` 이 `lagDays` 를
 * **`builtOn`**(빌드 시각)으로 계산하고 이 사이트는 **정적 생성물**이다 —
 * **파이프라인이 멈추면 페이지가 다시 안 구워지므로 그 값이 얼어붙는다.**
 * 마지막 빌드 당시가 신선했으면 **영원히 초록**이다. 정지를 그 배지로는 **원리적으로** 못 잡는다.
 * ⚠**CLAUDE.md §6 이 2026-08-30 사고에서 같은 함정을 이미 적어 뒀다** — 읽고도 되풀이했다.
 *
 * ## 이 도구가 묻는 것 하나
 *
 * **「최근 24시간 안에 수집이 한 번이라도 끝까지 돌았는가」.** 그 이상은 묻지 않는다.
 *
 * ⚠**못 잡는 것을 알고 쓴다**(설계서 §5):
 * **부분 장애**(세 슬롯 중 하나만 죽는 것) · **`deep` 의 영구 정지** ·
 * **予告先発 실취득 실패** · **지연** · **이 도구 자신의 정지**.
 * ⚠**마지막 것이 알려진 구멍이다** — 침묵이 「정상」과 「감시기 사망」 양쪽을 뜻한다.
 * 사람이 가끔 `gh run list --workflow heartbeat.yml` 로 살아 있는지 봐야 한다.
 *
 * ## 왜 복구(자동 재기동)를 안 하는가
 *
 * 콜드 리뷰가 잡았다: 복구 dispatch 를 넣으면 **탐지가 수집을 유발**해 중복 수집이 되살아나고,
 * 조회가 완료된 실행만 보므로 **진행 중인 정상 실행 위에 하나 더 얹는다.**
 * → **알린다. 고치는 것은 사람이 한다.**
 *
 * ⚠**시각은 인자로 받는다**(M6) — 판정 함수에서 `Date.now()` 를 부르지 마라.
 *
 * 사용: `node scripts/heartbeat.ts`  (env: `GH_TOKEN` · `REPO`)
 */

/** 되돌아보는 창. ⚠**검사 주기와 다른 것이다** — 실제 탐지 지연은 둘의 합이다(설계서 §4) */
export const LOOKBACK_HOURS = 24;

/**
 * `daily.yml` 실행 하나의 **`collect` 잡**.
 *
 * ⚠**실행(run)이 아니라 잡(job)이다.** `decide` 만 성공하고 `collect` 가 `skipped` 여도
 * **실행 결론은 `success`** 다 — 실물이 있다(2026-09-08 11:35). 실행 결론으로 판정하면
 * **수집이 멈춰도 조용하다.**
 * ⚠**`completedAt` 이 「끝난」 시각이다.** 생성 시각으로 재면 45분짜리 잡에서 경계가 어긋난다.
 */
export interface CollectJob {
  runId: number;
  /** `success` · `failure` · `skipped` · `cancelled` … */
  conclusion: string | null;
  /** ISO. 안 끝났으면 `null` */
  completedAt: string | null;
}

export type HeartbeatVerdict =
  /** 못 쟀다. ⚠**「정상」이 아니다** */
  | { kind: "unmeasured" }
  /** 창 안에 성공한 수집이 있다 */
  | { kind: "ok"; lastSuccessHoursAgo: number }
  /** 창 안에 성공한 수집이 없다 */
  | { kind: "stopped"; lastSuccessHoursAgo: number | null };

/**
 * ⚠**순수 함수라 네트워크 없이 시험한다** — 판정이 검증되지 않은 채 남는 것이 이 저장소의 지병이다.
 *
 * @param nowIso 지금(ISO). **주입한다**(M6)
 * @param jobs 최근 실행들의 `collect` 잡. **`null` 이면 못 쟀다는 뜻이다**
 */
export function heartbeatVerdict(nowIso: string, jobs: readonly CollectJob[] | null): HeartbeatVerdict {
  if (jobs === null) return { kind: "unmeasured" };

  const now = Date.parse(nowIso);
  let bestHoursAgo: number | null = null;
  for (const j of jobs) {
    // ⚠**성공한 것만 센다.** skipped·failure·cancelled 는 「수집됐다」가 아니다
    if (j.conclusion !== "success" || j.completedAt === null) continue;
    const hoursAgo = (now - Date.parse(j.completedAt)) / 3600_000;
    // ⚠**파싱 못 한 시각을 최솟값 자리에 넣지 마라**(이중 검토 Minor).
    //   `NaN` 이 들어가면 그 뒤 유효한 최근 성공이 와도 `NaN < NaN` 이 false 라 갱신되지 않아
    //   **멀쩡한 날에 경보가 난다.** 안전한 방향이긴 하지만 거짓 경보는 경보를 죽인다.
    if (!Number.isFinite(hoursAgo)) continue;
    if (bestHoursAgo === null || hoursAgo < bestHoursAgo) bestHoursAgo = hoursAgo;
  }

  if (bestHoursAgo !== null && bestHoursAgo <= LOOKBACK_HOURS) {
    return { kind: "ok", lastSuccessHoursAgo: bestHoursAgo };
  }
  return { kind: "stopped", lastSuccessHoursAgo: bestHoursAgo };
}

/** 사람이 읽을 한 줄. ⚠**무엇을 안 봤는지도 말한다** — 「조용하다」가 「전부 정상」으로 읽히면 안 된다 */
export function describe(v: HeartbeatVerdict): string {
  switch (v.kind) {
    case "unmeasured":
      return "⚠수집 이력을 못 읽었다 — 이것은 「정상」이 아니라 「안 쟀다」이다";
    case "ok":
      return `최근 수집 성공이 ${v.lastSuccessHoursAgo.toFixed(1)}시간 전이다`
        + `(창 ${String(LOOKBACK_HOURS)}시간). ⚠이 검사는 「하루에 한 번이라도 돌았는가」만 본다 —`
        + " 슬롯 하나만 죽는 부분 장애와 予告先発 실취득은 못 잡는다";
    case "stopped":
      return v.lastSuccessHoursAgo === null
        ? `⚠최근 실행 중 collect 가 성공한 것이 하나도 없다`
        : `⚠마지막 collect 성공이 ${v.lastSuccessHoursAgo.toFixed(1)}시간 전이다`
          + `(창 ${String(LOOKBACK_HOURS)}시간을 넘었다)`;
  }
}

// ─────────────────────────────────────────────────────────────────
// 여기부터는 배선이다. 판정은 위 순수 함수가 하고, 여기는 API 를 물어 그 입력을 만든다.
// ─────────────────────────────────────────────────────────────────

const API = "https://api.github.com";
/** ⚠**한 장이면 충분하다** — 하루 실행이 3~6건이다. 넘겨서 24시간이 안 덮이면 그건 이상이므로 알린다 */
const PER_PAGE = 20;

interface RunsResponse {
  workflow_runs?: { id?: number }[];
}
/** ⚠**`completed_at` 이다.** `created_at`·`started_at` 이 아니다 — 아래 `toCollectJob` 주석 참조 */
export interface ApiJob {
  name?: string;
  conclusion?: string | null;
  completed_at?: string | null;
  /** ⚠**읽지 않는다.** 여기 적어 두는 것은 「실수로 이걸 쓰지 마라」를 보이게 하기 위해서다 */
  started_at?: string | null;
  created_at?: string | null;
}
interface JobsResponse {
  jobs?: ApiJob[];
}

/**
 * API 의 잡 하나를 우리 판정 입력으로 옮긴다.
 *
 * ⚠**이 한 줄이 시험 밖에 있었다**(2026-09-09 · 이중 검토 F4). 설계서가 「`completed_at` 을
 * `created_at` 으로 바꾸면 붉어져야 한다」고 적어 뒀는데, 그 선택이 **시험에서 부르지 않는 함수 안**에
 * 있어서 검토자가 `started_at` 으로 바꿔 돌렸을 때 **9본이 전부 통과했다.**
 * 게다가 그 자리를 지킨다고 이름 붙인 시험의 단언 메시지가 **「created_at 으로 재고 있다」**고
 * 잡는다고 적고 있었다 — **메시지가 거짓말이었다.**
 * → **떼어내서 직접 잰다.**
 *
 * ⚠**왜 `completed_at` 인가**: 묻는 것은 「끝까지 돌았는가」이고 `collect` 는 `timeout-minutes: 45` 다.
 * 시작·생성 시각으로 재면 **23시간 50분 전에 끝난 성공**을 놓쳐 거짓 경보가 난다.
 */
export function toCollectJob(runId: number, job: ApiJob): CollectJob {
  return { runId, conclusion: job.conclusion ?? null, completedAt: job.completed_at ?? null };
}

async function gh<T>(path: string, token: string): Promise<T | null> {
  try {
    const res = await fetch(`${API}${path}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      // ⚠**요청 수 × 이 값이 잡 타임아웃을 넘으면 판정 대신 오경보가 난다**(이중 검토 Minor).
      //   최악 21요청 × 10초 = 210초 · 잡은 10분이다.
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/**
 * 최근 실행들의 `collect` 잡을 모은다.
 *
 * ⚠**한 건이라도 못 읽으면 `null` 을 준다** — 「일부만 봤다」를 「전부 봤다」로 쓰면
 * 조용한 실패가 된다(작업규칙 7: 「0건」과 「안 쟀음」을 구별한다).
 */
async function fetchCollectJobs(
  repo: string,
  token: string,
  branch: string,
): Promise<CollectJob[] | null> {
  // ⚠**브랜치를 박지 않는다**(이중 검토 Minor) — `daily.yml` 의 같은 질의는
  //   `${GITHUB_REF_NAME}` 을 쓴다. **기준이 두 벌이면 어느 날 갈린다.**
  const runs = await gh<RunsResponse>(
    `/repos/${repo}/actions/workflows/daily.yml/runs`
      + `?branch=${encodeURIComponent(branch)}&status=completed&per_page=${String(PER_PAGE)}`,
    token,
  );
  if (runs?.workflow_runs === undefined) return null;

  const out: CollectJob[] = [];
  for (const r of runs.workflow_runs) {
    if (typeof r.id !== "number") return null;
    const jobs = await gh<JobsResponse>(`/repos/${repo}/actions/runs/${String(r.id)}/jobs`, token);
    if (jobs?.jobs === undefined) return null;
    for (const j of jobs.jobs) {
      if (j.name !== "collect") continue;
      out.push(toCollectJob(r.id, j));
    }
  }
  return out;
}

async function main(): Promise<number> {
  const token = process.env["GH_TOKEN"];
  const repo = process.env["REPO"];
  if (token === undefined || token === "" || repo === undefined || repo === "") {
    console.error("::error::GH_TOKEN 또는 REPO 가 없다 — 이 검사가 돌지 않았다");
    return 1;
  }

  const branch = process.env["BRANCH"];
  const jobs = await fetchCollectJobs(repo, token, branch === undefined || branch === "" ? "main" : branch);
  // ⚠**진입점에서만 시계를 읽는다**(M6 · scripts/ 는 목록에 적힌 만큼 예외다)
  const v = heartbeatVerdict(new Date().toISOString(), jobs);
  const text = describe(v);

  if (v.kind === "ok") {
    console.log(text);
    return 0;
  }
  // ⚠**stopped 도 unmeasured 도 실패로 끝낸다** — 이 워크플로의 실패가 곧 알림이다
  console.error(`::error::${text}`);
  return 1;
}

if (process.argv[1]?.endsWith("heartbeat.ts") === true) {
  // ⚠**`process.exit()` 을 부르지 않는다**(2026-09-10 · 직접 돌려 발견).
  //   대기 중인 핸들(실패한 fetch 의 `AbortSignal.timeout` 타이머)가 남은 채 끊으면
  //   Windows 에서 **libuv 단언이 터져 exit 127** 이 된다 — 종료 코드가 뜻을 잃는다.
  //   ⚠**「리눅스 러너면 괜찮겠지」로 넣어두지 마라** — 감시기의 종료 코드가 곳 알림이다.
  //   `exitCode` 를 세우면 Node 가 핸들을 정리하고 스스로 끝난다.
  process.exitCode = await main();
}
