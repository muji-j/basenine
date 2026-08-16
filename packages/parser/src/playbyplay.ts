/**
 * `playbyplay.html`(試合経過) 파서.
 *
 * ⚠**결과 문자열을 해석하지 않는다.** 이 페이지의 결과 어휘는 566종이고(실측),
 * 박스스코어의 208종과 같은 사실을 다른 말로 적은 것이다. 같은 사실에 대한 해석을
 * 두 벌 만들면 반드시 어긋난다(M1) — 그래서 **결과 판정은 박스스코어 파서 한 벌만** 쓰고,
 * 여기서는 원문을 그대로 보존한다.
 *
 * 이 파서가 유일하게 제공하는 것:
 *   · **타석마다 누가 던졌는가** — 투수×타자 상대전적의 유일한 출처
 *   · **베이스-아웃 상태** — 득점기대치(RE24) 계열 지표의 재료
 *   · 경기 내 타석 순번 — 박스스코어의 타석 열과 맞춰볼 수 있다
 */

export interface PlayEvent {
  /** 1부터 */
  inning: number;
  /** `top`=표(원정 공격) · `bottom`=리(홈 공격) */
  half: "top" | "bottom";
  /** 경기 내 타석 순번(1부터) */
  seq: number;
  outsBefore: number;
  /** 주자 상태. `""` `1` `2` `3` `12` `13` `23` `123` */
  bases: string;
  batterId: string;
  batterName: string;
  /** 교대 기록에서 추적한 현재 투수. 첫 타석 앞에 선발 표기가 없으면 null */
  pitcherId: string | null;
  /** `3-2より` 같은 원문 */
  count: string;
  /** 결과 원문. **해석하지 않는다** */
  result: string;
  /**
   * 타석이 끝까지 갔는가.
   *
   * 결과를 해석하는 게 아니라 **타석의 성립 여부**를 나누는 것이라 여기서 판정한다.
   * 박스스코어와의 타석 수 차이 115건이 전부 이 두 표기였다.
   */
  completed: boolean;
}

/**
 * 타석이 성립하지 않은 행.
 *
 * · `（途中終了）` 102건 — 타석 도중에 이닝이 끝났다(주자가 도루 실패로 3아웃 등)
 * · `（途中交代）` 14건 — 타석 도중에 투수가 바뀌어 **같은 타석이 두 행으로 인쇄**된다.
 *   뒤 행이 실제 결과를 가지며, **그 행의 투수가 결과의 책임 투수**다.
 *
 * ⚠괄호로 시작하는 결과는 실측상 이 둘뿐이다(2026 시즌 전량). 새 표기가 나오면
 * 타석 수 대조가 깨지므로 스윕이 알려준다 — 조용히 넘어가지 않는다.
 */
const INCOMPLETE_MARKERS = new Set(["（途中終了）", "（途中交代）"]);

/**
 * 주자 사건(도루·도루자·견제사).
 *
 * ⚠**타석이 아니다.** 타석 사이에 일어나고 타자가 없다 — `pa_event` 에 넣을 수 없다
 * (`batter_id` 가 NOT NULL 이고, 넣으면 타석 수가 부풀어 타율 분모가 틀린다).
 *
 * ⚠**지금까지 이 행들은 버려지고 있었다.** 주자 행도 칸이 5개라 타석 행과 모양이 같은데,
 * 선수 이름 칸이 비어 있어서 「선수 링크가 없는 행」으로 걸러졌다(2026-08-17 확인).
 * 도루자(盗塁刺)는 §2-2 지표 카탈로그의 항목인데 박스스코어가 주지 않아 여기가 유일한 출처다.
 */
export interface RunnerEvent {
  inning: number;
  half: "top" | "bottom";
  /**
   * **직전 타석의 순번**(타석이 하나도 없었으면 0).
   * ⚠주자 사건에는 자기 순번이 없다 — 「몇 번째 타석 언저리에서 일어났는가」로만 위치를 말한다.
   */
  afterSeq: number;
  outsBefore: number;
  bases: string;
  runnerId: string;
  /** `steal`=도루 성공 · `caughtStealing`=도루 실패 · `pickoff`=견제사 */
  kind: "steal" | "caughtStealing" | "pickoff";
  /**
   * 원문이 말하는 루.
   * ⚠**뜻이 종류에 따라 다르다** — 도루는 **노린 루**(`二塁盗塁成功`=2루를 훔쳤다),
   * 견제사는 **있던 루**(`一塁牽制アウト`=1루에서 잡혔다). 하나로 뭉개면 나중에 못 되돌린다.
   */
  base: "1b" | "2b" | "3b" | "home";
  /** 더블스틸의 일부인가. 원문에 `（ダブルスチール）`가 붙는다 */
  doubleSteal: boolean;
  /** 원문 그대로(M4). 해석이 틀렸을 때 되돌아갈 자리다 */
  raw: string;
}

export type PlayByPlay =
  | { status: "played"; events: PlayEvent[]; runners: RunnerEvent[] }
  | { status: "notPlayed"; reason: string };

/** 루 표기 → 코드 */
const BASE_TOKEN: Readonly<Record<string, RunnerEvent["base"]>> = {
  "一塁": "1b", "二塁": "2b", "三塁": "3b", "本塁": "home",
};

/**
 * 주자 행 본문 한 줄을 읽는다. 읽지 못하면 **null 이 아니라 예외**다(M7).
 *
 * ⚠실측(2026-08-17, 2024〜2026 3시즌 2,484장 · 주자 행 3,623건)으로 고유 표기는 **12종**이고
 * 이 규칙이 전부를 덮는다. 조용히 흘리면 도루 성공률의 분모가 서서히 줄고 아무도 눈치채지 못한다.
 */
function runnerFactsOf(text: string): { kind: RunnerEvent["kind"]; base: RunnerEvent["base"]; doubleSteal: boolean } {
  const doubleSteal = text.includes("（ダブルスチール）");
  const m = /^(一塁|二塁|三塁|本塁)(盗塁成功|盗塁失敗|牽制アウト)/.exec(text);
  if (!m) {
    // ⚠문구를 「주자 표기」와 다르게 둔다 — 그건 **루 상태**(`1・2塁`)를 못 읽었을 때다.
    // 둘이 비슷하면 로그만 보고 어느 쪽이 깨졌는지 알 수 없다
    throw new PlayByPlayParseError("도루·견제 표기를 해석하지 못했다", `value=${JSON.stringify(text)}`);
  }
  const kind = m[2] === "盗塁成功" ? "steal" : m[2] === "盗塁失敗" ? "caughtStealing" : "pickoff";
  return { kind, base: BASE_TOKEN[m[1]!]!, doubleSteal };
}

export class PlayByPlayParseError extends Error {
  readonly detail: string;
  constructor(message: string, detail: string) {
    super(`${message} — ${detail}`);
    this.name = "PlayByPlayParseError";
    this.detail = detail;
  }
}

const NOT_PLAYED_MARKERS = ["中止", "ノーゲーム", "サスペンデッド"] as const;

/** 주자 표기 → 정규형. 실측 8종(2026 시즌 전량). */
const BASES: Readonly<Record<string, string>> = {
  "": "",
  "1塁": "1",
  "2塁": "2",
  "3塁": "3",
  "1・2塁": "12",
  "1・3塁": "13",
  "2・3塁": "23",
  満塁: "123",
};

function strip(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function playerIdsIn(html: string): string[] {
  return [...html.matchAll(/\/bis\/players\/(\d+)\.html/g)].map((m) => m[1]!);
}

/**
 * @throws {PlayByPlayParseError} 이닝 헤더나 주자 표기를 해석하지 못했을 때.
 * ⚠빈 배열로 넘기지 마라 — 그러면 「그 경기엔 타석이 없었다」가 된다.
 */
export function parsePlayByPlay(html: string): PlayByPlay {
  if (!/回[表裏]/.test(html)) {
    for (const marker of NOT_PLAYED_MARKERS) {
      if (html.includes(marker)) return { status: "notPlayed", reason: marker };
    }
    throw new PlayByPlayParseError(
      "이닝 표기가 없는데 중지 표기도 없다 — 페이지 구조 변경을 의심하라",
      `length=${html.length}`,
    );
  }

  const events: PlayEvent[] = [];
  const runners: RunnerEvent[] = [];
  let inning = 0;
  let half: "top" | "bottom" = "top";
  // 표(원정 공격)에서는 홈 팀이, 리(홈 공격)에서는 원정 팀이 던진다.
  // 그래서 현재 투수는 **하프별로 따로** 들고 있어야 한다.
  const currentPitcher: { top: string | null; bottom: string | null } = { top: null, bottom: null };

  // <h5>(이닝 전환)와 <tr>(타석·교대)을 **문서 순서대로** 훑는다. 순서가 곧 경기 진행이다.
  const token = /<h5[^>]*>([\s\S]*?)<\/h5>|<tr[^>]*>([\s\S]*?)<\/tr>/g;

  for (const m of html.matchAll(token)) {
    if (m[1] !== undefined) {
      const text = strip(m[1]);
      const head = /^(\d+)回([表裏])/.exec(text);
      if (!head) continue; // 이닝 헤더가 아닌 h5는 무시한다
      inning = Number(head[1]);
      half = head[2] === "表" ? "top" : "bottom";
      continue;
    }

    const rowHtml = m[2]!;
    if (rowHtml.includes("<th")) continue; // 표 머리글

    const cells = [...rowHtml.matchAll(/<td([^>]*)>([\s\S]*?)<\/td>/g)];

    // 투수 표기 행: `（先発投手） A` 또는 `（投手交代） A → B`
    if (cells.length === 1 && /colspan/i.test(cells[0]![1]!)) {
      const body = cells[0]![2]!;
      if (/先発投手|投手交代/.test(strip(body))) {
        const ids = playerIdsIn(body);
        // 교대는 `구 → 신` 이므로 **마지막 링크가 새 투수**다.
        if (ids.length > 0) currentPitcher[half] = ids.at(-1)!;
      }
      continue;
    }

    if (cells.length !== 5) continue;

    const outsText = strip(cells[0]![2]!);
    const outs = /^(\d+)アウト$/.exec(outsText);
    if (!outs) continue; // 타석 행이 아니다(대주자 등 보조 표기)

    const basesText = strip(cells[1]![2]!);
    const bases = BASES[basesText];
    if (bases === undefined) {
      throw new PlayByPlayParseError("주자 표기를 해석하지 못했다", `value=${JSON.stringify(basesText)}`);
    }

    const batterIds = playerIdsIn(cells[2]![2]!);
    if (batterIds.length === 0) {
      /**
       * 선수 이름 칸이 비었다 = 타석 행이 아니다. **주자 사건 행이 여기 온다.**
       * ⚠예전에는 여기서 그냥 버렸다 — 도루·도루자·견제사가 통째로 사라지고 있었다.
       */
      const body = cells[4]![2]!;
      const runnerText = /（走者・([\s\S]*?)）([\s\S]*)$/.exec(body);
      if (runnerText) {
        const ids = playerIdsIn(runnerText[1]!);
        if (ids.length === 0) {
          throw new PlayByPlayParseError("주자 행에 선수 링크가 없다", `value=${JSON.stringify(strip(body))}`);
        }
        if (inning === 0) {
          throw new PlayByPlayParseError("이닝 헤더보다 주자 행이 먼저 나왔다", `runner=${ids[0]}`);
        }
        const raw = strip(runnerText[2]!);
        runners.push({
          inning,
          half,
          // ⚠**직전 타석의 순번**이다. 아직 타석이 없으면 0 — 「1번 타석 앞」과 구별해야 한다
          afterSeq: events.length,
          outsBefore: Number(outs[1]),
          bases,
          runnerId: ids[0]!,
          ...runnerFactsOf(raw),
          raw,
        });
      }
      continue;
    }

    if (inning === 0) {
      throw new PlayByPlayParseError("이닝 헤더보다 타석 행이 먼저 나왔다", `batter=${batterIds[0]}`);
    }

    events.push({
      inning,
      half,
      seq: events.length + 1,
      outsBefore: Number(outs[1]),
      bases,
      batterId: batterIds[0]!,
      batterName: strip(cells[2]![2]!),
      pitcherId: currentPitcher[half],
      count: strip(cells[3]![2]!),
      result: strip(cells[4]![2]!),
      completed: !INCOMPLETE_MARKERS.has(strip(cells[4]![2]!)),
    });
  }

  if (events.length === 0) {
    throw new PlayByPlayParseError("타석을 하나도 찾지 못했다", `length=${html.length}`);
  }
  return { status: "played", events, runners };
}
