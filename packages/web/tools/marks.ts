/**
 * 선수 식별 마크 3안 비교표를 만든다 — **사진 대안의 검토용**.
 *
 *   node packages/web/tools/marks.ts data/bb.sqlite docs/mockups/2026-08-15-identity-marks.html 2026
 *
 * ⚠**제품 화면이 아니다.** 고르기 위한 비교표이고, 고른 뒤에 선수 페이지에 넣는다.
 * ⚠**한 선수만 보면 고를 수 없다.** 식별 표시의 값어치는 「선수마다 다른가」와
 * 「성적이 얇은 선수에서 무너지지 않는가」에 있으므로 여러 선수를 나란히 낸다.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { openDb } from "@bb-app/store";
import { aggregateSeason } from "@bb-app/aggregate";
import { colorOf, teamOf } from "@bb-app/domain";
import { babip, battingAverage, iso, onBasePercentage, strikeoutRate, walkRate } from "@bb-app/metrics";
import { html, toString } from "../src/html.ts";
import type { RawHtml } from "../src/html.ts";
import { CSS } from "../src/assets.ts";
import { denominator, avg3 } from "../src/format.ts";
import { positionMark } from "../src/player-page.ts";
import { battingProfile, markProfile, markStamp, markStrip, paKind } from "../src/marks.ts";
import type { MarkPlayer, PaKind } from "../src/marks.ts";

const [dbArg, outArg, seasonArg] = process.argv.slice(2);
if (dbArg === undefined || outArg === undefined || seasonArg === undefined) {
  console.error("usage: marks.ts <db> <out.html> <season>");
  process.exitCode = 2;
} else {
  const season = Number(seasonArg);
  const db = openDb(resolve(dbArg), new Date().toISOString());
  const agg = aggregateSeason(db, season);

  /** 서로 성질이 다른 선수를 고른다 — 한 종류만 보면 무너지는 경우를 못 본다 */
  const picks = [
    { why: "主砲（長打型）", pick: () => [...agg.batting].sort((a, b) => b.line.hr - a.line.hr)[0] },
    {
      why: "三振の少ない打者（コンタクト型）",
      pick: () =>
        [...agg.batting]
          .filter((b) => b.line.pa >= 300)
          .sort((a, b) => a.line.so / a.line.pa - b.line.so / b.line.pa)[0],
    },
    {
      why: "四球の多い打者（選球型）",
      pick: () =>
        [...agg.batting]
          .filter((b) => b.line.pa >= 300)
          .sort((a, b) => b.line.bb / b.line.pa - a.line.bb / a.line.pa)[0],
    },
    {
      why: "⚠標本の薄い選手（ここで壊れないか）",
      pick: () => [...agg.batting].filter((b) => b.line.pa >= 8 && b.line.pa <= 18)[0],
    },
    {
      why: "⚠投手（打撃成績がほとんどない）",
      pick: () => {
        const ids = new Set(agg.pitching.filter((p) => p.line.outs > 200).map((p) => p.playerId));
        return [...agg.batting].filter((b) => ids.has(b.playerId) && b.line.pa <= 40)[0];
      },
    },
  ];

  const paStmt = db.raw.prepare(
    `SELECT e.outcome AS outcome
     FROM pa_event e JOIN game g ON g.game_id = e.game_id
     WHERE g.season = ? AND g.status = 'played' AND g.competition = 'regular'
       AND e.status = 'final' AND e.batter_id = ?
     ORDER BY g.game_date DESC, e.game_id DESC, e.seq DESC
     LIMIT 90`,
  );

  const rows: RawHtml[] = [];
  let shown = 0;

  for (const { why, pick } of picks) {
    const b = pick();
    if (b === undefined) continue;
    shown += 1;

    const team = teamOf(b.teamCode);
    const player: MarkPlayer = {
      playerId: b.playerId,
      name: b.displayName,
      teamName: team.name,
      color: colorOf(b.teamCode),
      positionMark: positionMark(null, "—"),
    };

    // ⚠비율을 값만이 아니라 분모까지 통째로 넘긴다 — 축이 자기 분모를 들고 다녀야 M2를 지킨다
    const axes = battingProfile({
      avg: battingAverage(b.line),
      obp: onBasePercentage(b.line),
      iso: iso(b.line),
      bbRate: walkRate(b.line),
      kRate: strikeoutRate(b.line),
    });

    // 최근 순으로 받아 뒤집는다 — 띠는 왼쪽이 과거다
    const kinds = (paStmt.all(season, b.playerId) as { outcome: string }[])
      .map((r) => paKind(r.outcome))
      .reverse() as PaKind[];

    rows.push(html`<tr>
  <td class="l">
    <b>${b.displayName}</b><br>
    <span class="hp">${team.name}</span><br>
    <span class="hp">${why}</span>
  </td>
  <td class="mkcell">${markStamp(player, 52)}</td>
  <td class="mkcell">${markProfile(player, axes, denominator(b.line.pa), 52)}
    <s>${denominator(b.line.pa)}</s></td>
  <td class="mkcell">${markStrip(player, kinds, 52)}
    <s>${kinds.length === 0 ? "打席なし" : `直近${kinds.length}打席`}</s></td>
  <td class="l num">${avg3(battingAverage(b.line).value)} / ${avg3(onBasePercentage(b.line).value)} /
    ${avg3(iso(b.line).value)}<br>
    <span class="hp">K ${avg3(strikeoutRate(b.line).value)} · BB ${avg3(walkRate(b.line).value)} ·
    BABIP ${avg3(babip(b.line).value)}</span></td>
</tr>`);
  }

  db.close();

  const doc = html`<!doctype html>
<html lang="ja" data-base="">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>選手識別マーク 3案 — 写真の代わりに</title>
<meta name="robots" content="noindex, nofollow">
<meta name="color-scheme" content="light dark">
<style>${html`${[CSS]}`}
.wrap{padding:20px;max-width:960px}
.wrap h1{font-size:19px;letter-spacing:.08em;margin:0 0 4px}
.wrap h2{font-size:12px;letter-spacing:.16em;color:var(--tx-2);margin:26px 0 8px}
.wrap p{font-size:12.5px;max-width:70ch;color:var(--tx-2)}
.wrap table{margin-top:8px}
.mkcell{text-align:center;padding:9px 8px}
.mkcell s{display:block;text-decoration:none;font-size:9.5px;color:var(--tx-3);margin-top:4px}
.mk{display:inline-block;vertical-align:middle}
.num{font-family:var(--f-num);font-variant-numeric:tabular-nums}
.hp{font-size:10.5px;color:var(--tx-3)}
.warn{border-left:3px solid var(--warn);padding:10px 12px;background:var(--panel);font-size:12.5px;max-width:70ch}
.warn b{color:var(--warn)}
</style>
</head>
<body>
<div class="wrap">
<h1>選手識別マーク 3案</h1>
<p>写真の代わりに「このページが誰のものか」を一目で示すための案です。${shown}人ぶんを実データで描いています。</p>

<div class="warn">
  <b>実在選手の似顔絵（カリカチュア）は作りません。</b>
  写真の問題は著作権だけではありません。パブリシティ権は「肖像<b>等</b>」を対象としており、
  似顔絵もそこに含まれます（ピンク・レディー事件・最高裁 2012-02-02）。媒体を変えても外れません。
  さらに参照写真から描けばその写真の二次的著作物になり（著作権法 §27）、
  この規模で作るとなると規模そのものが不利にはたらきます。<br>
  そこで、写真が<b>画面でしていた仕事</b>だけを、肖像ではない方法で置き換えます。
</div>

<h2>3案の比較</h2>
<div class="scroller"><table>
<thead><tr>
  <th class="l">選手</th>
  <th>A 印</th><th>B 成績の紋</th><th>C 打席の帯</th>
  <th class="l">打率 / 出塁 / 長打</th>
</tr></thead>
<tbody>${rows}</tbody>
</table></div>

<h2>それぞれの性質</h2>
<div class="scroller"><table>
<thead><tr><th class="l">案</th><th class="l">出どころ</th><th class="l">強み</th><th class="l">弱み</th></tr></thead>
<tbody>
<tr><td class="l"><b>A 印</b></td><td class="l">選手ID（固定）</td>
  <td class="l">完全に固有。成績がなくても描ける。毎日変わらない</td>
  <td class="l"><b>意味がない</b>。模様が選手について何も語らない</td></tr>
<tr><td class="l"><b>B 成績の紋</b></td><td class="l">打率・出塁・長打・選球・接触</td>
  <td class="l"><b>形がそのまま情報</b>。長打型と選球型が違う形になる</td>
  <td class="l">標本が薄いと形が暴れる。目盛りがないので値は読めない</td></tr>
<tr><td class="l"><b>C 打席の帯</b></td><td class="l">直近の打席結果（最大90）</td>
  <td class="l">加工が最も少ない。<b>リズムが見える</b></td>
  <td class="l">毎日変わる。打席が少ないと痩せる</td></tr>
</tbody>
</table></div>

<h2>組み合わせも選べます</h2>
<p>A は「固有で安定」、B・C は「意味がある」。たとえば <b>A を一覧の小さなマークに、
B を選手ページの大きなマークに</b>使う、といった分担もできます。
どれを選んでも、比率のとなりには母数を必ず添えます。</p>

<p class="hp">${shown}人 / ${season}年 · 生成物であり、原本の表を再現するものではありません。</p>
</div>
</body>
</html>`;

  const outPath = resolve(outArg);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, toString(doc), "utf8");
  console.log(`마크 비교표: ${outPath} (${shown}명)`);

  // 미리보기 서버로도 볼 수 있게 둔다. ⚠`build:web`이 dist를 지우므로 그때는 다시 돌려야 한다
  if (existsSync("dist")) {
    writeFileSync(resolve("dist", "marks.html"), toString(doc), "utf8");
    console.log("  dist/marks.html 에도 복사 (http://127.0.0.1:4173/marks.html)");
  }
}
