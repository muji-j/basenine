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
import { avg3, dec2 } from "./format.ts";

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
  avg: number | null;
  obp: number | null;
  iso: number | null;
  bbRate: number | null;
  kRate: number | null;
}

export function battingProfile(b: BattingProfileInput): ProfileAxis[] {
  const contact = b.kRate === null ? null : 1 - b.kRate;
  return [
    { label: "打率", scaled: scale(b.avg, PROFILE_ANCHORS.avg), text: avg3(b.avg) },
    { label: "出塁", scaled: scale(b.obp, PROFILE_ANCHORS.obp), text: avg3(b.obp) },
    { label: "長打", scaled: scale(b.iso, PROFILE_ANCHORS.iso), text: avg3(b.iso) },
    { label: "選球", scaled: scale(b.bbRate, PROFILE_ANCHORS.bbRate), text: avg3(b.bbRate) },
    { label: "接触", scaled: scale(contact, PROFILE_ANCHORS.contact), text: avg3(contact) },
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
  k9: number | null;
  bb9: number | null;
  hr9: number | null;
  whip: number | null;
  era: number | null;
}

export function pitchingProfile(p: PitchingProfileInput): ProfileAxis[] {
  return [
    { label: "奪三振", scaled: scale(p.k9, PITCHING_ANCHORS.k9), text: dec2(p.k9) },
    { label: "制球", scaled: scaleInverted(p.bb9, PITCHING_ANCHORS.bb9), text: dec2(p.bb9) },
    { label: "被弾", scaled: scaleInverted(p.hr9, PITCHING_ANCHORS.hr9), text: dec2(p.hr9) },
    { label: "抑制", scaled: scaleInverted(p.whip, PITCHING_ANCHORS.whip), text: dec2(p.whip) },
    { label: "失点", scaled: scaleInverted(p.era, PITCHING_ANCHORS.era), text: dec2(p.era) },
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
