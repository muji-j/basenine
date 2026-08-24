/**
 * **Cloudflare Access 앱 설정을 코드로 붙든다.**
 *
 *   node scripts/access-config.ts            # 확인만 (기본)
 *   node scripts/access-config.ts --apply    # 목표대로 바꾼다
 *
 * ## 왜 있는가
 *
 * ⚠**S1 담장의 설정이 대시보드 클릭으로만 존재했다.** 배포는 「담장이 살아 있는가」(302 + AUD)까지만
 * 보고, **세션이 몇 시간인지 · 로그인 수단이 무엇인지는 아무도 안 봤다.** 그래서 누가 되돌려도
 * 아무 일도 안 일어난다 — 이 저장소가 「없는 장치를 있다고 적는」 문제를 **두 번** 겪은 자리와 같은 모양이다
 * (M6 린트 · 走塁 각주).
 *
 * ## 무엇을 붙드는가
 *
 * ⚠**허용목록(누가 들어오는가)은 여기서 안 만진다.** 그건 정책(`friends_allowlist`)의 일이고,
 * 이 스크립트는 **앱 쪽 설정**만 본다 — 잘못 건드리면 담장이 열리는 자리라 손대는 범위를 좁혔다.
 *
 * ## ⚠세션을 늘리는 것의 대가
 *
 * 세션이 길면 **허용목록에서 뺀 사람이 즉시 차단되지 않는다.** Access 는 로그인 시점에 정책을
 * 평가해 토큰을 내주고, 그 뒤에는 토큰을 검증한다. 지우려면 **세션을 폐기**해야 한다
 * (`Zero Trust → Access → Sessions`, 또는 그 사용자의 세션 revoke).
 * ⚠**「엣지에서 매 요청 검증」은 그대로 성립한다** — 검증되는 것이 「그 토큰이 유효한가」이지
 * 「지금도 명단에 있는가」가 아닐 뿐이다. 둘을 같은 말로 쓰지 마라.
 *
 * ## 종료 코드 — ⚠**「어긋났다」와 「못 쟀다」를 구별한다**(작업규칙 7)
 *
 * | 코드 | 뜻 |
 * |---|---|
 * | `0` | 목표와 같다(또는 `--apply` 가 성공했다) |
 * | `1` | **어긋났다** — 설정이 목표와 다르다 |
 * | `2` | **못 쟀다** — 토큰에 Zero Trust 권한이 없거나 API 에 닿지 못했다 |
 *
 * ⚠**`2` 를 `0` 으로 취급하지 마라.** 「검사가 통과했다」가 아니라 **「검사가 돌지 않았다」**다.
 */

import { pathToFileURL } from "node:url";

/** 목표 설정. ⚠**여기가 정본이다** — 대시보드가 아니라 이 값이 맞는 값이다 */
export const TARGET = {
  /**
   * 세션 길이. Cloudflare 는 Go 기간 문자열을 쓴다 — 대시보드의 「1 month」가 `730h` 다.
   * ⚠**24시간이었다.** 그러면 지인이 **매일** 이메일 코드를 받는다(2026-08-24 사용자 지적).
   * ⚠**「1개월이 최대」라고 단언하지 마라** — 실측한 적 없다. 더 긴 값이 받아들여지면 그때 고친다.
   */
  sessionDuration: "730h",
  /**
   * 허용 로그인 수단. ⚠**빈 배열은 「제한 없음」**이고, 그러면 Zero Trust 에 설정된 IdP 가 전부 뜬다.
   * One-time PIN 은 기본 제공이라 목록에 없어도 나온다.
   * → **여기를 비워 두는 것이 목표다.** Google 을 붙이면 자동으로 같이 뜬다.
   * ⚠**Google 을 붙이는 것은 이 스크립트가 못 한다** — Google Cloud 에서 OAuth 클라이언트를
   * 만들어 Zero Trust 에 등록하는 사람 손이 필요하다(docs/operations/deploy.md §4-2).
   */
  allowedIdps: [] as readonly string[],
  /**
   * ⚠**자동 리다이렉트를 켜지 않는다.** 켜면 IdP 가 하나일 때 바로 넘어가 편하지만,
   * Google 을 붙인 뒤에는 **Google 없는 지인이 One-time PIN 화면에 못 간다.**
   */
  autoRedirectToIdentity: false,
} as const;

/** 우리 앱을 찾는 열쇠. `daily.yml` 의 `EXPECT_AUD` 와 **같은 값이어야 한다** */
export const APP_AUD = "3a221a604b448a571f306d79c26fc98b76df8d4947ce8abd94242eefd40a1048";

/** API 가 돌려주는 앱 중 우리가 보는 부분만 */
export interface AccessApp {
  id: string;
  name: string;
  aud: string;
  session_duration?: string;
  allowed_idps?: readonly string[];
  auto_redirect_to_identity?: boolean;
}

export interface Drift {
  what: string;
  now: string;
  want: string;
}

/**
 * 목표와 다른 곳을 센다. **순수 함수라 네트워크 없이 시험할 수 있다.**
 *
 * ⚠**`allowed_idps` 가 `undefined` 인 것과 `[]` 인 것을 같게 본다** — API 가 둘 다 「제한 없음」으로
 * 돌려준 적이 있고, 다르게 세면 매일 「어긋났다」가 뜬다(그러면 아무도 안 읽는다).
 */
export function diff(app: AccessApp, target: typeof TARGET = TARGET): Drift[] {
  const out: Drift[] = [];
  const session = app.session_duration ?? "(없음)";
  if (session !== target.sessionDuration) {
    out.push({ what: "세션 길이", now: session, want: target.sessionDuration });
  }
  const idps = app.allowed_idps ?? [];
  const wantIdps = target.allowedIdps;
  if (idps.length !== wantIdps.length || idps.some((v, i) => v !== wantIdps[i])) {
    out.push({
      what: "허용 로그인 수단",
      now: idps.length === 0 ? "제한 없음" : idps.join(","),
      want: wantIdps.length === 0 ? "제한 없음" : wantIdps.join(","),
    });
  }
  if ((app.auto_redirect_to_identity ?? false) !== target.autoRedirectToIdentity) {
    out.push({
      what: "IdP 자동 이동",
      now: String(app.auto_redirect_to_identity ?? false),
      want: String(target.autoRedirectToIdentity),
    });
  }
  return out;
}

/** ⚠**권한 없음과 진짜 오류를 가른다** — 앞의 것은 「못 쟀다」이고 뒤의 것도 「못 쟀다」다 */
export function unmeasured(status: number): boolean {
  return status === 401 || status === 403 || status >= 500;
}

interface ApiResult<T> {
  success: boolean;
  result: T;
  errors?: readonly { code: number; message: string }[];
}

const API = "https://api.cloudflare.com/client/v4";

async function call<T>(path: string, token: string, init?: RequestInit): Promise<{ status: number; body: ApiResult<T> | null }> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  let body: ApiResult<T> | null = null;
  try {
    body = (await res.json()) as ApiResult<T>;
  } catch {
    body = null;
  }
  return { status: res.status, body };
}

/** 사람이 읽는 한 줄 */
function line(d: Drift): string {
  return `  · ${d.what}: 지금 ${d.now} → 목표 ${d.want}`;
}

async function main(): Promise<number> {
  const token = process.env["CLOUDFLARE_API_TOKEN"];
  const account = process.env["CLOUDFLARE_ACCOUNT_ID"];
  const apply = process.argv.includes("--apply");
  if (!token || !account) {
    console.error("못 쟀다 — CLOUDFLARE_API_TOKEN 또는 CLOUDFLARE_ACCOUNT_ID 가 없다");
    return 2;
  }

  const list = await call<AccessApp[]>(`/accounts/${account}/access/apps?per_page=100`, token);
  if (unmeasured(list.status) || list.body === null || !list.body.success) {
    const why = list.body?.errors?.map((e) => `${e.code} ${e.message}`).join(" · ") ?? `HTTP ${list.status}`;
    console.error(`못 쟀다 — Access 앱 목록을 못 읽었다: ${why}`);
    console.error("⚠토큰에 **Zero Trust: Read/Edit** 권한이 필요하다. Pages 배포용 토큰에는 없다.");
    console.error("⚠이건 「통과」가 아니라 **「검사가 돌지 않았다」**다.");
    return 2;
  }

  const app = list.body.result.find((a) => a.aud === APP_AUD);
  if (app === undefined) {
    console.error(`어긋났다 — AUD ${APP_AUD.slice(0, 12)}… 인 앱이 없다.`);
    // ⚠**무엇을 찾았는지 말한다.** 「없다」만 적으면 다음 사람이 처음부터 다시 재야 한다 —
    //   AUD 도 도메인도 비밀이 아니다(무자격 요청의 리다이렉트에 그대로 실려 나온다)
    console.error(`계정에서 읽은 Access 앱 ${list.body.result.length}개:`);
    for (const a of list.body.result) {
      const doms = (a as unknown as { domain?: string }).domain ?? "(도메인 없음)";
      console.error(`  · ${a.name} · aud=${(a.aud ?? "").slice(0, 16)}… · ${doms} · 세션 ${a.session_duration ?? "(없음)"}`);
    }
    console.error("앱을 다시 만들었다면 APP_AUD 와 daily.yml 의 EXPECT_AUD 를 **같이** 고쳐라.");
    console.error("⚠목록이 0개면 토큰이 **다른 계정**을 보고 있거나 Zero Trust 범위가 좁은 것이다.");
    return 1;
  }

  const ds = diff(app);
  console.log(`앱 ${app.name} (${app.id})`);
  console.log(`  세션 ${app.session_duration ?? "(없음)"} · 로그인 수단 ${(app.allowed_idps ?? []).length === 0 ? "제한 없음" : (app.allowed_idps ?? []).join(",")}`);
  if (ds.length === 0) {
    console.log("목표와 같다.");
    return 0;
  }
  console.log(`목표와 다른 곳 ${ds.length}건:`);
  for (const d of ds) console.log(line(d));

  if (!apply) {
    console.error("⚠확인만 했다. 바꾸려면 --apply 를 붙여라.");
    return 1;
  }

  const patch = await call<AccessApp>(`/accounts/${account}/access/apps/${app.id}`, token, {
    method: "PATCH",
    body: JSON.stringify({
      session_duration: TARGET.sessionDuration,
      allowed_idps: TARGET.allowedIdps,
      auto_redirect_to_identity: TARGET.autoRedirectToIdentity,
    }),
  });
  if (unmeasured(patch.status) || patch.body === null || !patch.body.success) {
    const why = patch.body?.errors?.map((e) => `${e.code} ${e.message}`).join(" · ") ?? `HTTP ${patch.status}`;
    console.error(`적용 실패: ${why}`);
    return patch.body?.success === false && !unmeasured(patch.status) ? 1 : 2;
  }
  const after = diff(patch.body.result);
  if (after.length > 0) {
    console.error("⚠적용했는데도 목표와 다르다 — 값이 거부됐을 수 있다:");
    for (const d of after) console.error(line(d));
    return 1;
  }
  console.log("적용했다. 목표와 같아졌다.");
  return 0;
}

// ⚠**시험이 이 파일을 import 해도 실행되지 않게 한다** — 시험은 순수 함수만 보고 네트워크를 안 친다
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}
