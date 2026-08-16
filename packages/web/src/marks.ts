/**
 * 선수 식별 마크 3안 — **사진의 대체**.
 *
 * ⚠**실존 선수의 얼굴 그림(캐리커처 포함)은 만들지 않는다.** 사진의 문제는 저작권만이 아니다.
 * 퍼블리시티권은 ピンク・レディー 사건(최고재 2012-02-02)이 「**肖像等**」을 대상으로 삼았고
 * 似顔絵도 그 안에 든다 — 매체를 바꿔도 빠져나가지 못한다. 게다가 참조 사진에서 그리면
 * 그 사진의 2차적저작물(저작권법 §27)이 되고, 695명분을 만들면 규모가 가중요인이 된다.
 *
 * 그래서 사진이 화면에서 **하던 일**만 가져온다 — 「이 페이지가 누구 것인지 한눈에」.
 * 세 방향 모두 **우리가 만든 우리 그림**이고 초상이 아니다.
 *
 *   A 印(いん)      선수 ID에서 결정론적으로 나오는 문양. 고유하지만 **뜻이 없다**
 *   B 成績の紋      성적 프로필의 다각형. **모양이 곧 정보**다  ← **채택**(2026-08-15)
 *   C 打席の帯      최근 타석 결과의 띠. 원시 기록에 가장 가깝다
 *
 * A·C는 채택되지 않았지만 **지운다면 비교 근거가 사라진다.** 비교표(`tools/marks.ts`)가
 * 셋을 계속 그리고, 다시 고를 때 같은 조건에서 볼 수 있게 남겨 둔다.
 *
 * ⚠**B와 C는 값을 그린다. 그러므로 분모가 따라붙어야 한다**(M2).
 * 마크만 떼어 쓰는 경로를 만들지 않기 위해, 세 함수 모두 분모를 함께 그린다.
 */
import { html, raw } from "./html.ts";
import type { RawHtml } from "./html.ts";
import type { TeamColor } from "@bb-app/domain";
import type { Rate } from "@bb-app/metrics";
import { avg3, dec2, denominator, innings } from "./format.ts";
import { BATTER_MIN, RELIEVER_MIN } from "./grade.ts";

export interface MarkPlayer {
  playerId: string;
  name: string;
  teamName: string;
  color: TeamColor;
  /** 「投」「内」 등 한 글자 */
  positionMark: string;
}

// ── A안 印 ────────────────────────────────────────────────────────────────

/**
 * FNV-1a. **암호용이 아니다** — 같은 ID에서 항상 같은 문양이 나오기만 하면 된다.
 * ⚠`Math.random()`을 쓰면 빌드마다 문양이 바뀌어 식별 표시로서 쓸모가 없어진다.
 */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

const GRID = 5;

/**
 * A안 — 선수 ID에서 나오는 좌우대칭 문양.
 *
 * 장점: **완전히 고유**하고 계산이 공짜이며 성적이 없어도(신인·부상) 그려진다.
 * 단점: **뜻이 없다.** 무늬가 그 선수에 대해 아무것도 말하지 않는다.
 */
export function markStamp(p: MarkPlayer, size = 46): RawHtml {
  const h = hash(p.playerId);
  const cell = size / GRID;
  const half = Math.ceil(GRID / 2);
  const cells: RawHtml[] = [];

  for (let y = 0; y < GRID; y += 1) {
    for (let x = 0; x < half; x += 1) {
      // 비트를 하나씩 꺼내 쓴다. 좌우를 접어 대칭으로 만든다
      const on = ((h >>> ((y * half + x) % 32)) & 1) === 1;
      if (!on) continue;
      for (const mx of new Set([x, GRID - 1 - x])) {
        cells.push(
          html`<rect x="${(mx * cell).toFixed(1)}" y="${(y * cell).toFixed(1)}"
            width="${cell.toFixed(1)}" height="${cell.toFixed(1)}" fill="${p.color.ink}"></rect>`,
        );
      }
    }
  }

  return html`<svg class="mk" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"
  role="img" aria-label="${p.name}の識別マーク">
  <rect width="${size}" height="${size}" fill="${p.color.base}"></rect>
  ${cells}
</svg>`;
}

// ── B안 成績の紋 ──────────────────────────────────────────────────────────

export interface ProfileAxis {
  label: string;
  /** 0~1로 정규화한 길이. 값이 없으면 null */
  scaled: number | null;
  /** 사람이 읽는 원래 값 */
  text: string;
  /**
   * 이 축의 **분모**. ⚠값과 반드시 함께 나간다(M2).
   *
   * 축마다 다르다 — 打率는 打数, 出塁는 打席, 투수는 전부 投球回다.
   * 그래서 하나의 「표본」으로 뭉뚱그리지 않고 축이 자기 분모를 들고 다닌다.
   */
  sample: string;
  /**
   * 이 축이 실제로 무슨 지표인가 — 용어집 키(M1).
   *
   * ⚠**축 이름과 지표 이름이 다르다.** 「出塁」는 出塁率이고 「接触」은 K%의 뒤집힌 값이다.
   * 설명을 여기서 새로 쓰면 용어집과 두 벌이 되므로 키만 들고 다닌다.
   */
  term: string;
  /**
   * 축 고유의 한마디. **축 이름이 지표 이름과 다를 때와, 방향이 뒤집혔을 때** 쓴다.
   *
   * ⚠**뒤집힌 축에서 이 문장을 비우지 마라.** 도형은 「바깥쪽이 좋다」로 그려지는데
   * 값은 「낮을수록 좋다」이므로, 말하지 않으면 화면이 조용히 반대로 읽힌다.
   */
  note: string;
  /**
   * 이 축의 표본이 **눈금을 맞춘 모집단에 못 미치는가**.
   *
   * ⚠**「없음」과 「얇음」과 「낮음」은 셋 다 다르다**(M11).
   * 없으면 대체 마크(글자), 낮으면 작은 도형 — 그 사이에 「쟀지만 믿을 수 없다」가 있다.
   * 눈금은 타자 50타석·투수 20이닝 이상으로 맞췄는데 도형은 1타석부터 그려진다.
   * 실측(2026-08-16): 그 바깥에서 평균 반지름 중앙값이 **타자 9.9% 대 투수 31.8%** 로
   * 갈린다 — 눈금을 고치기 전의 격차보다 크다. 즉 **얇은 표본에서는 두 도형이 다시 딴말을 한다.**
   * ⚠같은 임계값을 등급이 이미 쓴다(`grade.ts`). **두 벌로 두지 않는다**(M1).
   */
  thin: boolean;
}

/**
 * B안 — 성적 프로필의 다각형.
 *
 * 장점: **모양이 곧 정보**다. 장타형·선구형·컨택트형이 다른 모양으로 나온다.
 * 단점: 정규화 기준을 정해야 하고, **표본이 얇으면 모양이 요동친다.**
 *
 * ⚠**축의 눈금을 그리지 않는다.** 눈금 없는 도형에서 값을 읽게 하면 안 된다 —
 * 정확한 값은 옆의 숫자와 분모에 있고, 이 도형은 **모양**을 보여줄 뿐이다.
 */
export function markProfile(
  p: MarkPlayer,
  axes: readonly ProfileAxis[],
  sampleText: string,
  size = 46,
): RawHtml {
  if (axes.length < 3) return raw("");
  const c = size / 2;
  const r = c - 3;

  const point = (i: number, len: number): string => {
    const angle = (Math.PI * 2 * i) / axes.length - Math.PI / 2;
    return `${(c + Math.cos(angle) * r * len).toFixed(1)},${(c + Math.sin(angle) * r * len).toFixed(1)}`;
  };

  const outline = axes.map((_, i) => point(i, 1)).join(" ");
  const shape = axes.map((a, i) => point(i, Math.max(0.06, Math.min(1, a.scaled ?? 0)))).join(" ");
  // ⚠**얇은 표본은 속을 비운다.** 꽉 찬 도형은 「이만큼이다」라는 단정인데, 눈금 밖 표본에서는
  // 그 단정이 참이 아니다. 같은 화면에서 등급이 색을 보류하는 것과 같은 일을 도형에서 한다
  const thin = isThinProfile(axes);

  return html`<svg class="mk" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"
  role="img" aria-label="${p.name}の成績プロフィール（${sampleText}${thin ? "・標本が少ないため参考値" : ""}）：${axes.map((a) => `${a.label} ${a.text}`).join("、")}">
  <rect width="${size}" height="${size}" fill="${p.color.base}"></rect>
  <polygon points="${outline}" fill="none" stroke="${p.color.ink}" stroke-opacity=".28" stroke-width="1"></polygon>
  <polygon points="${shape}" fill="${p.color.ink}" fill-opacity="${thin ? "0" : ".85"}"
    stroke="${p.color.ink}" stroke-opacity="${thin ? ".8" : "0"}" stroke-width="1"
    stroke-dasharray="${thin ? "2 2" : "0"}"></polygon>
</svg>`;
}

/** 확대 도형의 변. 비교 화면도 **같은 값**을 써야 두 도형이 겹쳐진다 */
export const MARK_FIGURE_SIZE = 176;

/** 紋 한 축의 화면 좌표. `grip`은 바깥 둘레, `value`는 도형 위, `label`은 그 바깥 */
export interface AxisGeometry {
  grip: { x: number; y: number };
  value: { x: number; y: number };
  label: { x: number; y: number; anchor: "start" | "middle" | "end" };
}

/**
 * 紋의 좌표 계산 — **한 벌만 둔다**(M1의 정신).
 *
 * ⚠**비교 화면이 이걸 클라이언트에서 다시 계산하면 두 벌이 된다.** 그러면 어느 날 한쪽만
 * 고쳐져 「같은 선수인데 두 화면에서 도형이 다르다」가 나온다. 서버가 좌표까지 계산해
 * 문자열로 넘기고, 클라이언트는 그리기만 한다.
 *
 * @param pad 라벨 자리로 바깥에 남길 여백
 */
export function profileGeometry(
  axes: readonly ProfileAxis[],
  size = MARK_FIGURE_SIZE,
  pad = 34,
): { size: number; center: number; outline: string; shape: string; axes: AxisGeometry[] } {
  const c = size / 2;
  const r = c - pad;

  const at = (i: number, len: number): { x: number; y: number } => {
    const angle = (Math.PI * 2 * i) / axes.length - Math.PI / 2;
    return { x: c + Math.cos(angle) * r * len, y: c + Math.sin(angle) * r * len };
  };
  const xy = (i: number, len: number): string => {
    const q = at(i, len);
    return `${q.x.toFixed(1)},${q.y.toFixed(1)}`;
  };
  // ⚠**0을 0으로 그리지 않는다.** 전 축이 0이면 도형이 점이 되어 「데이터 없음」과 구별되지 않는다
  const len = (a: ProfileAxis): number => Math.max(0.06, Math.min(1, a.scaled ?? 0));

  return {
    size,
    center: c,
    outline: axes.map((_, i) => xy(i, 1)).join(" "),
    shape: axes.map((a, i) => xy(i, len(a))).join(" "),
    axes: axes.map((a, i) => {
      const lab = at(i, 1.24);
      return {
        grip: at(i, 1),
        value: at(i, len(a)),
        // 라벨이 좌우 어느 쪽에 오는지에 따라 정렬을 바꾼다 — 안 그러면 도형에 겹친다
        label: { ...lab, anchor: lab.x < c - 4 ? "end" : lab.x > c + 4 ? "start" : "middle" },
      };
    }),
  };
}

/**
 * 확대한 成績の紋 — **꼭짓점을 고를 수 있는 판**.
 *
 * 표제의 마크(52px)는 신원 표시라 꼭짓점이 10px 간격으로 붙어 있어 누를 수 없다.
 * 그래서 「고를 수 있는 도형」은 크게 따로 그린다.
 *
 * ⚠**꼭짓점은 진짜 조작 요소여야 한다.** SVG 도형에 클릭만 붙이면 키보드로 못 고르고
 * 스크린리더에도 안 잡힌다. `role="button"` + `tabindex`를 주고 화살표로도 옮겨 다닌다.
 * ⚠**판정 영역을 보이는 점보다 크게** 잡는다 — 손가락은 4px 점을 못 누른다.
 * ⚠**눈금은 여전히 그리지 않는다.** 도형에서 값을 읽게 하지 않는다 — 값은 판독부에 글자로 있다.
 */
export function markFigure(
  p: MarkPlayer,
  axes: readonly ProfileAxis[],
  sampleText: string,
): RawHtml {
  if (axes.length < 3) return raw("");
  const g = profileGeometry(axes);
  const c = g.center;

  return html`<svg class="mkfig" viewBox="0 0 ${g.size} ${g.size}" role="group"
  aria-label="${p.name}の成績プロフィール（${sampleText}${isThinProfile(axes) ? "・標本が少ないため参考値" : ""}）">
  <polygon class="mf-grid" points="${g.outline}"></polygon>
  <!-- ⚠pathLength 로 둘레를 100으로 고정한다 — 그래야 도형이 무엇이든 같은 식으로 그릴 수 있다.
       모션은 prefers-reduced-motion 에서 꺼진다 -->
  <polygon class="mf-shape${isThinProfile(axes) ? " thin" : ""}" pathLength="100" points="${g.shape}"
    fill="${p.color.base}"></polygon>
  ${axes.map((a, i) => {
    // ⚠**손잡이는 바깥 둘레에, 값 표시점은 도형 위에.** 둘을 한 자리에 두면
    // 성적이 낮은 축의 점이 중앙으로 모여 서로 겹치고, 그러면 누를 수가 없다
    const q = g.axes[i]!;
    return html`<g class="mf-ax" role="button" tabindex="0" data-axis="${i}"
      aria-pressed="${i === 0 ? "true" : "false"}"
      aria-label="${a.label} ${a.text} ${a.sample}">
      <line class="mf-spoke" x1="${c}" y1="${c}" x2="${q.grip.x.toFixed(1)}" y2="${q.grip.y.toFixed(1)}"></line>
      <circle class="mf-hit" cx="${q.grip.x.toFixed(1)}" cy="${q.grip.y.toFixed(1)}" r="21"></circle>
      <circle class="mf-dot" cx="${q.value.x.toFixed(1)}" cy="${q.value.y.toFixed(1)}" r="3.5"></circle>
      <text class="mf-lab" x="${q.label.x.toFixed(1)}" y="${q.label.y.toFixed(1)}"
        text-anchor="${q.label.anchor}" dominant-baseline="middle">${a.label}</text>
    </g>`;
  })}
</svg>`;
}

// ── C안 打席の帯 ──────────────────────────────────────────────────────────

/** 타석 결과의 시각 구분. **원문 그대로가 아니라 5종으로 접는다** */
export type PaKind = "hr" | "hit" | "walk" | "so" | "out";

/**
 * C안 — 최근 타석을 시간 순으로 세운 띠.
 *
 * 장점: 가공이 가장 적다. **리듬이 보인다** — 안타가 몰린 구간이 눈에 띈다.
 * 단점: 타석이 적으면 빈약하고, 매일 바뀐다(식별 표시로서는 불안정).
 */
export function markStrip(p: MarkPlayer, kinds: readonly PaKind[], size = 46): RawHtml {
  if (kinds.length === 0) return raw("");
  const w = size / kinds.length;
  const height = (k: PaKind): number =>
    k === "hr" ? 1 : k === "hit" ? 0.72 : k === "walk" ? 0.44 : k === "so" ? 0.2 : 0.3;
  const opacity = (k: PaKind): string =>
    k === "hr" || k === "hit" ? "1" : k === "walk" ? ".7" : k === "so" ? ".26" : ".4";

  return html`<svg class="mk" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"
  role="img" aria-label="${p.name}の直近${kinds.length}打席">
  <rect width="${size}" height="${size}" fill="${p.color.base}"></rect>
  ${kinds.map((k, i) => {
    const h = height(k) * (size - 6);
    return html`<rect x="${(i * w).toFixed(2)}" y="${(size - 3 - h).toFixed(1)}"
      width="${Math.max(0.6, w - 0.25).toFixed(2)}" height="${h.toFixed(1)}"
      fill="${p.color.ink}" fill-opacity="${opacity(k)}"></rect>`;
  })}
</svg>`;
}

/**
 * 결과 분류 → 띠의 구분.
 * ⚠**분류는 `@bb-app/parser`의 `Outcome`을 그대로 받는다** — 여기서 문자열을 다시 해석하지 않는다(M1).
 */
export function paKind(outcome: string): PaKind {
  switch (outcome) {
    case "homerun":
      return "hr";
    case "single":
    case "double":
    case "triple":
      return "hit";
    case "walk":
    case "intentionalWalk":
    case "hitByPitch":
    /**
     * ⚠**방해 출루는 아웃이 아니다.** `default: return "out"` 에 떨어져 있었다 —
     * 「타자가 죽었다」로 그려지는데 실제로는 1루에 나간 것이다.
     * ⚠**`interferenceOut`(捕守妨)은 여기 오면 안 된다** — 그건 진짜 아웃이다.
     *   낱말이 닮았다고 묶으면 정반대가 된다.
     * 영향은 작다(실측 178,420타석 중 5건) — 그러나 어휘를 늘리면서 이 스위치를
     * 안 본 것이 사실이고, 그게 다음 번에 큰 것을 놓치는 방식이다.
     */
    case "interference":
    case "obstruction":
      return "walk";
    case "strikeout":
    case "strikeoutReached":
      return "so";
    default:
      return "out";
  }
}

/**
 * 정규화 기준 — **세 점**(하위 10% · 중앙 · 상위 10%)이다.
 *
 * ⚠**이것은 표시 배율이지 지표가 아니다.** 리그 백분위를 매번 다시 계산하면 기준이 매일 움직여
 * 「어제와 모양이 다른데 성적은 같다」가 생긴다. **한 번 재서 상수로 박고** 여기 적어 둔다.
 *
 * ⚠**왜 두 점이 아니라 세 점인가.** 두 점(하한·상한)으로 선형 사상하면
 * **분포의 쏠림이 도형의 크기가 된다.** 야구 지표는 대부분 오른쪽으로 꼬리가 길어서,
 * 「높을수록 좋다」인 축(타자)은 중앙값이 한가운데보다 **안쪽**에 오고,
 * 「낮을수록 좋다」를 뒤집은 축(투수)은 중앙값이 **바깥쪽**에 온다.
 * 실측(2026-08-16 · 아래 기준 모집단 · 옛 두 점 앵커): **중앙값 타자의 평균 반지름 37.6% 대
 * 중앙값 투수 65.7%** — 면적으로 **3.05배**였다.
 * (규정 도달자만으로 좁혀 재면 48.1% 대 75.0%가 나온다. **어느 모집단인지 적지 않으면
 * 아무도 재현할 수 없다** — 두 수가 다른 것은 모집단이 다르기 때문이다.)
 * 같은 화면에 나란히 놓이는 두 도형이 같은 뜻을 갖지 않으면 그 자체로 거짓말이다.
 * 중앙을 앵커로 넣으면 **양쪽 모두 중앙값이 정확히 절반**에 온다.
 *
 * ⚠**기준 모집단을 적어 둔다** — 2025·2026 정규시즌 중 도형이 실제로 그려지는 표본:
 * 타자 50타석 이상 **458 선수-시즌**(실인원 293명) · 투수 20이닝 이상 **407 선수-시즌**(실인원 276명).
 * 「명」이 아니라 선수-시즌이다 — 두 시즌을 각각 세므로 사람 수보다 1.5배쯤 크다.
 *
 * ⚠**2026은 아직 진행 중이다**(팀당 101~110경기 / 143). 진행 중 시즌은 표본이 얇아 꼬리가 넓고,
 * 지금 상수는 그 넓은 꼬리를 절반 물고 있다(2025 단독 ISO p90 .170 대 2026 .203).
 * **재측정 시점을 여기서 정한다: 2026 시즌 종료 후 한 번, 그 뒤로는 2027 종료 후.**
 * 재측정하면 도형이 조금 달라진다 — 그때는 「무엇을 언제 다시 쟀는지」를 이 주석에 남긴다.
 * 재측정 도구는 `packages/web/tools/anchors.ts`다.
 */
export const PROFILE_ANCHORS = {
  avg: [0.182, 0.238, 0.284],
  obp: [0.238, 0.300, 0.355],
  iso: [0.038, 0.098, 0.188],
  bbRate: [0.03, 0.067, 0.113],
  /** 삼진은 **적을수록 좋다** — 1 − K% 로 뒤집어 넣는다 */
  contact: [0.701, 0.801, 0.872],
} as const;

/**
 * 세 점 사이를 이어 0~1로 만든다.
 *
 * ⚠**중앙은 반드시 0.5로 간다.** 그것이 이 함수의 존재 이유다 —
 * 「바깥쪽일수록 좋다」가 타자와 투수에서 같은 뜻이 되려면 중앙이 같은 자리여야 한다.
 * ⚠양 끝은 자른다. 상위 10%보다 잘해도 도형은 더 커지지 않는다 —
 * 눈금 없는 도형에서 바깥으로 무한히 뻗으면 모양이 값을 과장한다.
 */
/**
 * ⚠**중앙에서 기울기가 꺾인다.** 위아래 구간의 폭이 다르므로 같은 값 차이가
 * 중앙 아래에서는 최대 **1.5배** 크게 보인다(실측: ISO 1.50 · BB/9 1.51 · 방어율 1.47).
 * 순서는 보존되므로 「누가 더 나은가」는 틀리지 않지만 「얼마나 더」는 위치에 따라 다르다.
 * 대체한 문제(면적 3.05배)보다 훨씬 작아서 받아들인 거래다.
 * ⚠**끝단 해상도도 내줬다** — 상·하위 10%는 서로 구별되지 않는다(축의 약 20%가 0 또는 1로 잘린다).
 */
function scale(value: number | null, [lo, mid, hi]: readonly [number, number, number]): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  if (value <= mid) {
    if (mid === lo) return value < mid ? 0 : 0.5;
    return Math.max(0, Math.min(0.5, (0.5 * (value - lo)) / (mid - lo)));
  }
  if (hi === mid) return 1;
  return Math.max(0.5, Math.min(1, 0.5 + (0.5 * (value - mid)) / (hi - mid)));
}

/**
 * ⚠**앵커가 오름차순이 아니면 멈춘다.**
 * 주석에만 적어 두면 아무도 안 지킨다 — 뒤집힌 축을 「좋은 순」으로 적는 실수가 이 파일에서
 * 가장 저지르기 쉽고, 그렇게 적어도 `scale()` 은 던지지 않고 **조용히 0.5를 낸다.**
 * 制球 축이 대부분의 투수에서 0.5로 굳는데 도형은 그럴듯하게 그려진다(M7).
 */
function assertAscending(name: string, a: Readonly<Record<string, readonly [number, number, number]>>): void {
  for (const [k, v] of Object.entries(a)) {
    if (!(v[0] < v[1] && v[1] < v[2])) {
      throw new RangeError(`${name}.${k} 앵커가 오름차순이 아니다: ${v.join(" ")} — 좋은 방향은 scaleInverted 한 곳에서만 뒤집는다`);
    }
  }
}
export interface BattingProfileInput {
  avg: Rate;
  obp: Rate;
  iso: Rate;
  bbRate: Rate;
  kRate: Rate;
}

/** 「낮을수록 좋다」를 뒤집어 그린 축이 반드시 다는 문장 */
const INVERTED_NOTE =
  "この指標は低いほど良いため、図では外側ほど良くなるよう反転しています。数字そのものは小さいほど良い値です。";

export function battingProfile(b: BattingProfileInput): ProfileAxis[] {
  // ⚠접촉률은 K%의 뒤집힌 값이다. **분모는 K%의 것을 그대로 쓴다** — 같은 타석에서 나온다
  const contact = b.kRate.value === null ? null : 1 - b.kRate.value;
  // ⚠**임계값을 여기서 새로 정하지 않는다**(M1) — 등급이 색을 보류하는 그 값을 그대로 쓴다
  const thin = b.obp.denominator < BATTER_MIN;
  return [
    {
      label: "打率", scaled: scale(b.avg.value, PROFILE_ANCHORS.avg), text: avg3(b.avg.value),
      sample: denominator(b.avg.denominator, "打数"), term: "avg", note: "", thin,
    },
    {
      label: "出塁", scaled: scale(b.obp.value, PROFILE_ANCHORS.obp), text: avg3(b.obp.value),
      sample: denominator(b.obp.denominator, "打席"), term: "obp", note: "", thin,
    },
    {
      label: "長打", scaled: scale(b.iso.value, PROFILE_ANCHORS.iso), text: avg3(b.iso.value),
      sample: denominator(b.iso.denominator, "打数"), term: "iso", note: "", thin,
    },
    {
      label: "選球", scaled: scale(b.bbRate.value, PROFILE_ANCHORS.bbRate), text: avg3(b.bbRate.value),
      sample: denominator(b.bbRate.denominator, "打席"), term: "bbRate", note: "", thin,
    },
    {
      label: "接触", scaled: scale(contact, PROFILE_ANCHORS.contact), text: avg3(contact),
      sample: denominator(b.kRate.denominator, "打席"), term: "kRate", thin,
      // ⚠**표시하는 수가 K%가 아니다.** 말하지 않으면 삼진율을 .735로 읽는다
      note: "三振にならなかった打席の割合（1 − K%）です。K%そのものではありません。",
    },
  ];
}

/**
 * 투수용 앵커 — 타자와 **같은 규칙**으로 잰 세 점이다(2025·2026 정규시즌 · 20이닝 이상 407명).
 *
 * ⚠**네 축이 「낮을수록 좋다」**라서 뒤집어 넣는다. 그대로 넣으면 좋은 투수가 작은 도형이 되고,
 * 모양의 뜻이 타자와 정반대가 된다 — 같은 화면에 나란히 놓으면 그 자체로 거짓말이다.
 * ⚠**뒤집는 축도 앵커는 오름차순으로 적는다** — 「값의 크기」 순이지 「좋은 순」이 아니다.
 * 좋은 방향은 `scaleInverted` 한 곳에서만 뒤집는다.
 */
export const PITCHING_ANCHORS = {
  k9: [5.358, 7.613, 10.255],
  /** BB/9 — 뒤집는다 */
  bb9: [1.612, 2.656, 4.229],
  /** HR/9 — 뒤집는다 */
  hr9: [0.227, 0.643, 1.249],
  /** WHIP — 뒤집는다 */
  whip: [0.945, 1.19, 1.504],
  /** 방어율 — 뒤집는다 */
  era: [1.643, 2.869, 4.673],
} as const;

/** 「낮을수록 좋다」를 0~1로 뒤집는다 */
function scaleInverted(
  value: number | null,
  anchors: readonly [number, number, number],
): number | null {
  const s = scale(value, anchors);
  return s === null ? null : 1 - s;
}

export interface PitchingProfileInput {
  k9: Rate;
  bb9: Rate;
  hr9: Rate;
  whip: Rate;
  era: Rate;
}

/**
 * ⚠투수 축의 분모는 **아웃 카운트**다. 이닝으로 바꿔 쓴다 —
 * `415アウト`라고 쓰면 사이트의 다른 분모와 단위가 어긋난다.
 */
function innsOf(r: Rate): string {
  return `${innings(r.denominator)}回`;
}

export function pitchingProfile(p: PitchingProfileInput): ProfileAxis[] {
  // ⚠등급과 같은 임계값을 쓴다(M1). 분모는 아웃 카운트다
  const thin = p.era.denominator < RELIEVER_MIN;
  return [
    {
      label: "奪三振", scaled: scale(p.k9.value, PITCHING_ANCHORS.k9), text: dec2(p.k9.value),
      sample: innsOf(p.k9), term: "k9", note: "", thin,
    },
    {
      label: "制球", scaled: scaleInverted(p.bb9.value, PITCHING_ANCHORS.bb9), text: dec2(p.bb9.value),
      sample: innsOf(p.bb9), term: "bb9", note: INVERTED_NOTE, thin,
    },
    {
      label: "被弾", scaled: scaleInverted(p.hr9.value, PITCHING_ANCHORS.hr9), text: dec2(p.hr9.value),
      sample: innsOf(p.hr9), term: "hr9", note: INVERTED_NOTE, thin,
    },
    {
      label: "抑制", scaled: scaleInverted(p.whip.value, PITCHING_ANCHORS.whip), text: dec2(p.whip.value),
      sample: innsOf(p.whip), term: "whip", note: INVERTED_NOTE, thin,
    },
    {
      label: "失点", scaled: scaleInverted(p.era.value, PITCHING_ANCHORS.era), text: dec2(p.era.value),
      sample: innsOf(p.era), term: "era", note: INVERTED_NOTE, thin,
    },
  ];
}

/**
 * 표본이 없을 때의 대체 마크 — 포지션 한 글자.
 *
 * ⚠**성적이 없는 선수를 「아주 작은 도형」으로 그리지 않는다.** 그건 「성적이 나쁘다」로 읽힌다.
 * 값이 없는 것과 값이 낮은 것은 다르다(M11).
 */
export function markLetter(p: MarkPlayer, letter: string, size = 46): RawHtml {
  return html`<svg class="mk" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"
  role="img" aria-label="${p.name}（成績なし）">
  <rect width="${size}" height="${size}" fill="${p.color.base}"></rect>
  <text x="${size / 2}" y="${size / 2}" fill="${p.color.ink}" font-size="${(size * 0.46).toFixed(1)}"
    font-weight="700" text-anchor="middle" dominant-baseline="central">${letter}</text>
</svg>`;
}

// ⚠**두 앵커가 다 선언된 뒤에 검사한다.** 위에서 부르면 선언 전 참조가 된다
assertAscending("PROFILE_ANCHORS", PROFILE_ANCHORS);
assertAscending("PITCHING_ANCHORS", PITCHING_ANCHORS);

/** 축이 전부 값 없음인가 — 대체 마크로 갈지 판정한다 */
export function isEmptyProfile(axes: readonly ProfileAxis[]): boolean {
  return axes.length === 0 || axes.every((a) => a.scaled === null);
}

/**
 * 표본이 눈금을 맞춘 모집단에 못 미치는가.
 *
 * ⚠**이걸로 도형을 지우지는 않는다.** 값은 진짜다 — 믿을 수 없는 것은 **비교**다.
 * 그래서 등급이 하는 것과 같은 일을 한다: 수는 보여주고 **단정을 보류**한다(속을 비운다).
 */
export function isThinProfile(axes: readonly ProfileAxis[]): boolean {
  return axes.length > 0 && axes.some((a) => a.thin);
}
