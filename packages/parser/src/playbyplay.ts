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
  | {
      status: "played";
      events: PlayEvent[];
      runners: RunnerEvent[];
      /**
       * 읽지 못한 주자 행의 원문.
       *
       * ⚠**던지지 않고 여기 담는 이유는 blast radius다.** 던지면 `parsePlayByPlay` 가 통째로
       * 실패해 **그 경기의 타석 로그 전량**(투수×타자 상대전적의 유일한 출처)이 사라진다 —
       * 도루 표기 1건의 변화가 훨씬 큰 것을 가져간다.
       * `tokens.ts` 도 같은 이유로 「한 셀 때문에 경기 전체를 죽이지 않는다」를 택했다.
       *
       * ⚠**그렇다고 조용히 넘기는 것이 아니다**(M7). 적재가 이것을 **격리에 넣고 센다** —
       * 「멈춘다」는 목적을 경기 단위가 아니라 **적재 단위**에서 달성한다.
       * 호출자가 이 배열을 무시하면 그때부터 조용한 실패가 된다.
       */
      unreadRunners: string[];
    }
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
function runnerFactsOf(
  text: string,
): { kind: RunnerEvent["kind"]; base: RunnerEvent["base"]; doubleSteal: boolean } | null {
  const doubleSteal = text.includes("（ダブルスチール）");
  const m = /^(一塁|二塁|三塁|本塁)(盗塁成功|盗塁失敗|牽制アウト)/.exec(text);
  // ⚠**null 은 「없다」가 아니라 「못 읽었다」**다. 호출부가 격리에 담아 세고,
  // 적재가 임계값을 건다 — 여기서 던지면 경기 하나의 타석 로그 전량이 함께 사라진다
  if (!m) return null;
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

/** 교대 표기의 화살표(U+2192). ⚠`&rarr;`·`&#8594;` 같은 엔티티는 풀지 않는다 — 그 모양이 오면 글자 쪽이 0 이라 던진다 */
const ARROW = "→";

const occurrences = (s: string, needle: string): number => s.split(needle).length - 1;

/**
 * 투수 표기 행(`（先発投手） A` · `（投手交代） 旧 → 新`) 한 줄에서 **그 하프의 새 현재 투수**를 낸다.
 *
 * ⚠**모양을 검증한다 — 예전에는 「링크가 하나라도 있으면 마지막 링크가 새 투수」였다**(2026-09-27 · 감사 N2 ·
 * 설계 `docs/superpowers/specs/2026-09-27-profile-version-guard-design.md` §7). 교대 행에서 **새 투수의 링크만** 못 읽으면
 * `ids = [旧]` 가 되어 **다음 교대까지의 타석이 이전 투수에게 조용히** 붙었다(반증자 실물 변이: 6회초 5타석).
 * 정렬(`store/src/align.ts`)은 타자별 타석 수만 맞대고 투수 ID 는 옮기기만 해서 그것을 못 잡는다.
 * ⚠**규칙**(위에서부터):
 *   · 두 표기가 한 행에 같이 있으면 → 던진다
 *   · `先発投手`: 글자의 화살표 **0** · 링크 **정확히 1** → 그 ID
 *   · `投手交代`: 화살표가 **글자와 본문 양쪽에서 정확히 1**(속성 안 화살표·엔티티로 둘이 갈리면 나눌 자리를 모른다) ·
 *     화살표 **뒤** 링크 정확히 1(새 투수) · 앞 링크 0~1 — 있으면 **그 하프의 현재 투수와 같아야** 한다(빠진 先発 행 ·
 *     하프 헤더 오판을 같은 행의 정보로 잡는다). ⚠**앞 링크 0 은 살린다** — 옛 투수 링크만 없는 경우도 새 투수는 안다.
 * ⚠실측(설계 §4-3 · 보유 경과 전수): 로컬 **63,357행 · CI 사본 64,150행에서 위반 0** · 옛 투수 대조 어긋남 0/48,900.
 *   규칙을 만족하는 행에서는 새 투수 = 예전의 `ids.at(-1)` 이라 **기존 귀속이 한 타석도 안 바뀐다.**
 * ⚠**던지면 그 경기의 경과 전체가 실패다**(적재기 `PBP ERROR` · `failed` · 종료 1) — 타석·주자 로그는 **건드리지 않는다**
 *   (주자 행처럼 격리로 흘리지 않는 이유: 투수 귀속이 틀린 채 들어가면 상대전적이 **조용히** 틀린다. 주자 행 하나는 그 행만 잃는다).
 * @throws {PlayByPlayParseError} 기대한 모양이 아니면
 */
function pitcherOfNotation(body: string, half: "top" | "bottom", current: string | null): string {
  const text = strip(body);
  const links = playerIdsIn(body);
  const head = `half=${half} · row=${JSON.stringify(text.slice(0, 80))} · links=${links.length}`;
  const hasStart = text.includes("先発投手");
  const hasChange = text.includes("投手交代");
  if (hasStart && hasChange) {
    throw new PlayByPlayParseError("先発投手 와 投手交代 가 한 행에 같이 있다", head);
  }
  if (hasStart) {
    const arrows = occurrences(text, ARROW);
    if (arrows !== 0 || links.length !== 1) {
      throw new PlayByPlayParseError("先発投手 표기에서 투수 링크를 정확히 하나 읽지 못했다", `${head} · arrows=${arrows}`);
    }
    return links[0]!;
  }
  const textArrows = occurrences(text, ARROW);
  const bodyArrows = occurrences(body, ARROW);
  if (textArrows !== 1 || bodyArrows !== 1) {
    throw new PlayByPlayParseError(
      "投手交代 표기의 화살표(→)가 정확히 하나가 아니다",
      `${head} · arrows=글자 ${textArrows}/본문 ${bodyArrows} · current=${current ?? "-"}`,
    );
  }
  const at = body.indexOf(ARROW);
  const before = playerIdsIn(body.slice(0, at));
  const after = playerIdsIn(body.slice(at + ARROW.length));
  const detail = `${head} · old=${before.join(",") || "-"} · new=${after.join(",") || "-"} · current=${current ?? "-"}`;
  if (after.length !== 1) {
    throw new PlayByPlayParseError("投手交代 표기의 화살표 뒤에서 새 투수 링크를 정확히 하나 읽지 못했다", detail);
  }
  if (before.length > 1) {
    throw new PlayByPlayParseError("投手交代 표기의 화살표 앞 링크가 둘 이상이다", detail);
  }
  if (before.length === 1 && before[0] !== current) {
    throw new PlayByPlayParseError("投手交代 의 옛 투수가 그 하프의 현재 투수와 다르다", detail);
  }
  return after[0]!;
}

/**
 * @throws {PlayByPlayParseError} 이닝 헤더나 주자 표기를 해석하지 못했을 때 · 투수 표기 행이 기대 모양이 아닐 때(`pitcherOfNotation`).
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
  /** ⚠**버리지 않고 센다**(M7). 적재가 이것을 격리에 넣는다 */
  const unreadRunners: string[] = [];
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
      // ⚠모양이 기대와 다르면 **이전 투수에게 조용히 붙이지 않고 던진다**(감사 N2 · `pitcherOfNotation`)
      if (/先発投手|投手交代/.test(strip(body))) currentPitcher[half] = pitcherOfNotation(body, half, currentPitcher[half]);
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
      /**
       * ⚠**여기서 조용히 버리지 않는다**(M7). 이 지점은 「아웃 카운트가 있고 루 상태가 있는데
       * 타자가 없는 행」이라, 우리가 아는 것은 주자 사건뿐이다. 모르는 형태가 오면
       * **도루 성공률의 분모가 서서히 줄고 아무도 눈치채지 못한다** — 이 파일이 막으려는 실패 모드다.
       *
       * ⚠**같은 함수의 다른 분기는 전부 던진다**(루 상태 미상 · 도루 표기 미상 · 타석 0건).
       * 여기만 `continue` 로 두면 그 비대칭이 곧 구멍이다.
       *
       * 실측(2026-08-17): 아카이브 playbyplay **2,732장**의 「타자 없는 5칸 행」 **3,976건이
       * 전부** `（走者・` 를 갖는다. 임계값 0으로 걸 수 있다.
       * (대주자 등 보조 표기는 앞의 `outs` 검사에서 이미 걸러진다.)
       */
      if (!runnerText) {
        unreadRunners.push(strip(body));
        continue;
      }
      {
        const ids = playerIdsIn(runnerText[1]!);
        if (ids.length === 0) {
          unreadRunners.push(strip(body));
          continue;
        }
        if (inning === 0) {
          throw new PlayByPlayParseError("이닝 헤더보다 주자 행이 먼저 나왔다", `runner=${ids[0]}`);
        }
        const raw = strip(runnerText[2]!);
        const facts = runnerFactsOf(raw);
        if (facts === null) {
          unreadRunners.push(strip(body));
          continue;
        }
        runners.push({
          inning,
          half,
          // ⚠**직전 타석의 순번**이다. 아직 타석이 없으면 0 — 「1번 타석 앞」과 구별해야 한다
          afterSeq: events.length,
          outsBefore: Number(outs[1]),
          bases,
          runnerId: ids[0]!,
          ...facts,
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
  return { status: "played", events, runners, unreadRunners };
}
