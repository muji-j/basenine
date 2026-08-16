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

  return html`<svg class="mk" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"
  role="img" aria-label="${p.name}の成績プロフィール（${sampleText}）：${axes.map((a) => `${a.label} ${a.text}`).join("、")}">
  <rect width="${size}" height="${size}" fill="${p.color.base}"></rect>
  <polygon points="${outline}" fill="none" stroke="${p.color.ink}" stroke-opacity=".28" stroke-width="1"></polygon>
  <polygon points="${shape}" fill="${p.color.ink}" fill-opacity=".85"></polygon>
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
  aria-label="${p.name}の成績プロフィール（${sampleText}）">
  <polygon class="mf-grid" points="${g.outline}"></polygon>
  <polygon class="mf-shape" points="${g.shape}" fill="${p.color.base}"></polygon>
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
      return "walk";
    case "strikeout":
    case "strikeoutReached":
      return "so";
    default:
      return "out";
  }
}

/**
 * 정규화 기준.
 *
 * ⚠**이것은 표시 배율이지 지표가 아니다.** 리그 백분위로 잡으면 매일 기준이 움직여
 * 「어제와 모양이 다른데 성적은 같다」가 생긴다. 고정 앵커를 쓰고 여기 적어 둔다.
 */
export const PROFILE_ANCHORS = {
  avg: [0.15, 0.35],
  obp: [0.25, 0.45],
  iso: [0.0, 0.3],
  bbRate: [0.0, 0.2],
  /** 삼진은 **적을수록 좋다** — 뒤집어서 넣는다 */
  contact: [0.6, 1.0],
} as const;

function scale(value: number | null, [lo, hi]: readonly [number, number]): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(1, (value - lo) / (hi - lo)));
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
  return [
    {
      label: "打率", scaled: scale(b.avg.value, PROFILE_ANCHORS.avg), text: avg3(b.avg.value),
      sample: denominator(b.avg.denominator, "打数"), term: "avg", note: "",
    },
    {
      label: "出塁", scaled: scale(b.obp.value, PROFILE_ANCHORS.obp), text: avg3(b.obp.value),
      sample: denominator(b.obp.denominator, "打席"), term: "obp", note: "",
    },
    {
      label: "長打", scaled: scale(b.iso.value, PROFILE_ANCHORS.iso), text: avg3(b.iso.value),
      sample: denominator(b.iso.denominator, "打数"), term: "iso", note: "",
    },
    {
      label: "選球", scaled: scale(b.bbRate.value, PROFILE_ANCHORS.bbRate), text: avg3(b.bbRate.value),
      sample: denominator(b.bbRate.denominator, "打席"), term: "bbRate", note: "",
    },
    {
      label: "接触", scaled: scale(contact, PROFILE_ANCHORS.contact), text: avg3(contact),
      sample: denominator(b.kRate.denominator, "打席"), term: "kRate",
      // ⚠**표시하는 수가 K%가 아니다.** 말하지 않으면 삼진율을 .735로 읽는다
      note: "三振にならなかった打席の割合（1 − K%）です。K%そのものではありません。",
    },
  ];
}

/**
 * 투수용 앵커.
 *
 * ⚠**네 축이 「낮을수록 좋다」**라서 뒤집어 넣는다. 그대로 넣으면 좋은 투수가 작은 도형이 되고,
 * 모양의 뜻이 타자와 정반대가 된다 — 같은 화면에 나란히 놓으면 그 자체로 거짓말이다.
 */
export const PITCHING_ANCHORS = {
  k9: [4, 12],
  /** BB/9 — 뒤집는다 */
  bb9: [1.5, 5],
  /** HR/9 — 뒤집는다 */
  hr9: [0.3, 1.8],
  /** WHIP — 뒤집는다 */
  whip: [1, 1.7],
  /** 방어율 — 뒤집는다 */
  era: [2, 5.5],
} as const;

/** 「낮을수록 좋다」를 0~1로 뒤집는다 */
function scaleInverted(value: number | null, [lo, hi]: readonly [number, number]): number | null {
  const s = scale(value, [lo, hi]);
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
  return [
    {
      label: "奪三振", scaled: scale(p.k9.value, PITCHING_ANCHORS.k9), text: dec2(p.k9.value),
      sample: innsOf(p.k9), term: "k9", note: "",
    },
    {
      label: "制球", scaled: scaleInverted(p.bb9.value, PITCHING_ANCHORS.bb9), text: dec2(p.bb9.value),
      sample: innsOf(p.bb9), term: "bb9", note: INVERTED_NOTE,
    },
    {
      label: "被弾", scaled: scaleInverted(p.hr9.value, PITCHING_ANCHORS.hr9), text: dec2(p.hr9.value),
      sample: innsOf(p.hr9), term: "hr9", note: INVERTED_NOTE,
    },
    {
      label: "抑制", scaled: scaleInverted(p.whip.value, PITCHING_ANCHORS.whip), text: dec2(p.whip.value),
      sample: innsOf(p.whip), term: "whip", note: INVERTED_NOTE,
    },
    {
      label: "失点", scaled: scaleInverted(p.era.value, PITCHING_ANCHORS.era), text: dec2(p.era.value),
      sample: innsOf(p.era), term: "era", note: INVERTED_NOTE,
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

/** 축이 전부 값 없음인가 — 대체 마크로 갈지 판정한다 */
export function isEmptyProfile(axes: readonly ProfileAxis[]): boolean {
  return axes.length === 0 || axes.every((a) => a.scaled === null);
}
