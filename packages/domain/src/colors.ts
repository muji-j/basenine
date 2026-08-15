/**
 * 구단 색 — **UI 액센트 전용**.
 *
 * ⚠**로고·엠블럼은 쓰지 않는다.** 데이터 권리 조사에서 구단 로고·마크는 별도 권리로 확인됐다.
 * 색은 화면의 정체성을 만드는 액센트로만 쓰고, 구단의 상표를 재현하지 않는다.
 * ⚠여기 값은 **공식 브랜드 자산이 아니라 근사치**다. 정확한 지정색이 필요해지면 그때 확인한다.
 *
 * `ink`는 그 색 위에 올릴 글자색이다. **대비를 눈대중하지 마라** —
 * 阪神의 노랑처럼 밝은 색에는 어두운 글자, 中日의 감색에는 밝은 글자가 필요하다.
 */
import { TEAMS } from "./teams.ts";

export interface TeamColor {
  /** 배면·배지에 쓰는 바탕색 */
  base: string;
  /** 그 위에 올릴 글자색 */
  ink: string;
}

const COLORS: Readonly<Record<string, TeamColor>> = {
  g: { base: "#f4780f", ink: "#1a1005" },
  t: { base: "#f2c800", ink: "#17170f" },
  db: { base: "#0b5fa5", ink: "#f4f8fb" },
  c: { base: "#c8102e", ink: "#fff4f5" },
  d: { base: "#0a2f7a", ink: "#eef3fb" },
  s: { base: "#7cab2b", ink: "#12180a" },
  h: { base: "#f5c400", ink: "#171509" },
  f: { base: "#0b5c9c", ink: "#f2f7fb" },
  m: { base: "#22262b", ink: "#f1f2f4" },
  l: { base: "#12357f", ink: "#eef2fb" },
  e: { base: "#8a1123", ink: "#fdf2f3" },
  b: { base: "#1d1f4e", ink: "#eeeff8" },
};

/** 구단이 아닌 코드(올스타 등)나 미상에 쓰는 중립색. */
export const NEUTRAL_COLOR: TeamColor = { base: "#6b7280", ink: "#f7f8f9" };

export function colorOf(code: string): TeamColor {
  return COLORS[code] ?? NEUTRAL_COLOR;
}

/** 구단 마스터와 색표가 어긋나지 않게 — 테스트가 이걸 고정한다. */
export function coloredTeamCodes(): string[] {
  return Object.keys(COLORS);
}

export { TEAMS };
