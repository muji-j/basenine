# -*- coding: utf-8 -*-
"""forced-colors（Windows ハイコントラスト）実測スイープ。

なぜ要るか
  이 리포는 forced-colors 대응을 **CSS 로 쓰기만** 했고 그 모드에서 확인한 적이 없었다.
  강제 배색에서는 background / background-image / box-shadow 가 일률적으로 시스템 색으로
  치환되므로, 「색만이 식별자」였던 곳은 **조용히 구별 불가**가 된다. CSS 를 읽는 것으로는 판정할 수 없다.

⚠왜 픽셀이 아니라 계산값인가 (초판의 실패)
  처음엔 contrast_sweep.py 처럼 픽셀을 찍었는데 **위양성만** 나왔다(선택 요소가 sticky 헤더 뒤로
  스크롤아웃되거나, 형제 페어링 인덱스와 샘플 좌표가 어긋남). forced-colors 는 **used value 자체가
  치환**되므로 `getComputedStyle` 이 그 결과를 돌려준다. 실측 근거(저자가 쓴 값 → 강제 배색의 계산값):

      background: #ff0000            → rgb(255,255,255)   (Canvas 로 강제)
      color: #00ff00                 → rgb(0,0,0)         (CanvasText 로 강제)
      background: linear-gradient()  → none               (**그라데는 통째로 사라진다**)
      box-shadow: inset 3px 0 0 #f00 → none               (**그림자는 사라진다**)
      background: Highlight          → rgb(55,0,110)      (저자가 쓴 시스템 색은 통과)
      SVG fill / stroke              → **강제되지 않음**(원색 유지)

  ⚠마지막 줄이 중요하다: SVG 는 강제 대상이 아니므로 `forced-color-adjust:none` 이 no-op 일 수 있고,
    반대로 아이콘의 accent 색이 흑배경 고대비 테마에서 그대로 남아 저대비가 될 수 있다(별도 확인 필요).

⚠**0 건 ≠ 결함 없음.** 이 도구의 가장 위험한 성질이다.
  실측: 초판은 「9앱 0건」이라 보고했지만 검사 B·C 는 **한 번도 실행되지 않았고**(대상이 부트 DOM 에
  존재하지 않음), A 도 약 12쌍만 비교했으며 master·chat-notify 는 **마커 0개로 통째로 미감사**였다.
  그 사이 wiki `.kn-card.is-sel`(문서 목록의 주 선택 상태)이 강제 배색에서 구별 불가인 채 남아 있었다.
  → **비교 건수를 반드시 함께 출력**한다. 0건과 0회를 눈으로 구별할 수 없으면 도구가 아니라 함정이다.

아직 못 보는 것 (알고 쓰라)
  ・의사요소(::before/::after)로만 표시하는 선택(밑줄 바 등)
  ・자손이 상태를 나르는 경우(부모 skin 은 같고 자식 pip 만 다름)
  ・기본 화면에 없는 상태(모달·토스트·탭 전환 후·데이터 로드 후 생성되는 셀)
  ・SVG fill/stroke 의 대비

사용법: py -3 forced_colors_sweep.py [앱이름]

⚠**測る前に必ず preview.html を作り直すこと。**
  preview.html は .gitignore 対象の生成物なので、別のチェックアウト（マージ直後の main 等）では
  **古いまま or 存在しない**。実測: main で走らせたら duty に 2件出たが、make_preview.py を回したら 0件だった
  ——「直したのに直っていない」と誤読する典型。各アプリで py -3 make_preview.py を先に回す。
"""
import asyncio, json, os, sys
from collections import defaultdict

# ⚠cp932 コンソールでは日本語・韓国語の print が UnicodeEncodeError で落ち、**結果を1件も出さずに死ぬ**。
#   直前ラウンドで本道具が「1回も実行されなかった」のはこれが理由の可能性が高い（contrast_sweep と同根・2026-07-31 実測）。
for _s in (sys.stdout, sys.stderr):
    try: _s.reconfigure(encoding='utf-8', errors='replace')
    except Exception: pass
from playwright.async_api import async_playwright

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from state_driver import drive_states          # 起動画面の外まで駆動して測る（0件と0回を取り違えないため）

try:                                   # cp932 콘솔에서 최종 출력이 죽는 것 방지
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

# ⚠ROOT を固定パスで書かない: ワークツリーを消した/マージした瞬間に動かなくなる。
#   このファイルは <repo>/.claude/skills/auditing-multi-dimensionally/tools/ にあるので 4つ上がリポ根。
#   別のチェックアウトを測りたいときは環境変数 PPS_ROOT で上書きする。
ROOT = os.environ.get("PPS_ROOT") or os.path.abspath(
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", ".."))
APPS = ('portal', 'master', 'duty', 'ess', 'energy', 'notice', 'wiki', 'chat-notify', 'position')
TOUR_KEYS = ('tourDone', 'tourSeen', 'gtourDone')

PROBE = r"""() => {
  // ⚠이 리포가 실제로 쓰는 상태 클래스명을 전부 넣는다. 초판은 .is-on/.is-sel/.is-cur/.on 이 빠져
  //   「선례로 든 .ie-tool.is-on 을 도구가 못 보는」 상태였다.
  const MARKS = ["[aria-selected='true']", "[aria-current]:not([aria-current='false'])",
                 '.is-active', '.active', '.is-selected', '.selected',
                 '.is-on', '.is-sel', '.is-cur', '.on'];
  const SEL_MARK = MARKS.join(', ');
  const sig = (e) => (e.tagName.toLowerCase() + '.' +
    (e.className || '').toString().trim().split(/\s+/).filter(Boolean).slice(0, 3).join('.')).slice(0, 46);

  // 배경이 투명이면 조상을 거슬러 실효 배경을 구한다.
  //   （강제 배색에서 투명은 rgba(255,255,255,0)、불투명 Canvas 는 rgb(255,255,255) 로 **문자열이 달라져**
  //     그냥 비교하면 「구별됨」으로 통과해 버린다 = 위음성）
  const effBg = (e) => {
    let q = e;
    while (q) {
      const c = getComputedStyle(q).backgroundColor;
      if (c && !/,\s*0\)\s*$/.test(c) && c !== 'transparent') return c;
      q = q.parentElement;
    }
    return 'rgb(255,255,255)';
  };
  const skin = (e) => {
    const cs = getComputedStyle(e);
    return [effBg(e), cs.backgroundImage, cs.color,
            cs.borderTopColor + '/' + cs.borderTopWidth,
            cs.borderLeftColor + '/' + cs.borderLeftWidth,
            cs.outlineColor + '/' + cs.outlineWidth + '/' + cs.outlineStyle,
            cs.boxShadow, cs.textDecorationLine, cs.fontWeight].join('|');
  };

  // A: 선택 vs 비선택 형제. ⚠가시성을 요구하지 않는다 — 계산값 비교에 가시성은 불필요하고,
  //    요구하면 비표시 탭(master 는 마커 97개 중 85개)이 통째로 미감사가 된다.
  const pairs = [];
  document.querySelectorAll(SEL_MARK).forEach(e => {
    const p = e.parentElement; if (!p) return;
    const other = Array.from(p.children).find(c => c !== e && c.tagName === e.tagName && !c.matches(SEL_MARK));
    if (!other) return;
    // ⚠표시 토글(탭 패인 등)은 대상이 아니다. 구별을 담당하는 것이 색이 아니라 display 이므로
    //   강제 배색과 무관하다(초판은 master `.tab-pane.active` 를 결함으로 잘못 보고했다).
    const da = getComputedStyle(e).display, db = getComputedStyle(other).display;
    if ((da === 'none') !== (db === 'none')) return;
    // ⚠상태를 **자손**이 나르는 경우가 있다(chat-notify `.nf-card.is-on` 은 자식 pip/스위치가 표시).
    //   부모 skin 만 보면 위양성이 되므로, 자손 다이제스트도 함께 비교한다.
    const digest = (root) => Array.prototype.slice.call(root.querySelectorAll('*'), 0, 24)
      .map(skin).join('#');
    pairs.push({ sig: sig(e), sel: skin(e) + '##' + digest(e), other: skin(other) + '##' + digest(other) });
  });

  // B: 데이터 색 그룹(색으로 의미를 내는 셀들)
  const DATA_SELS = ['.heat-cell', '.an-seg-part', '.an-bar-fill', '.mini-bar', '.bar-fill', '.cap-cell',
                     '.pip', '.rv-dot', '.lg-dot', '.legend-dot', '.sw-track'];
  // ⚠親ごとに束ねてはいけない。ess の凡例は `<span class="hl-i"><span class="heat-cell">` と
  //   **1セル1親**なので、親グループ化だと全部 1件になり `< 3` で捨てられていた（実測: B が 0回）。
  //   知りたいのは「この種類のデータセルが強制配色で 1色に潰れていないか」なので**セレクタ単位**で束ねる。
  const groups = [];
  DATA_SELS.forEach(sel => {
    const els = Array.prototype.slice.call(document.querySelectorAll(sel));
    if (els.length < 3) return;
    groups.push({ sig: sel, n: els.length,
                  colors: new Set(els.map(e => effBg(e) + '|' + getComputedStyle(e).borderTopColor +
                                                '|' + getComputedStyle(e).color)).size });
  });

  // C: 부유 면의 경계. ⚠rect 를 요구하지 않는다(닫힌 모달도 계산값은 읽힌다).
  const FLOAT_SELS = ['.su-toast', '.su-prog', '.ngpop', '.modal', '.pop', '.sheet', '.tip', '.card-pop',
                      '.su-dlg', '.drawer', '.menu-pop'];
  const floats = [];
  FLOAT_SELS.forEach(s => document.querySelectorAll(s).forEach(e => {
    const cs = getComputedStyle(e);
    const bw = ['Top', 'Right', 'Bottom', 'Left'].map(d => parseFloat(cs['border' + d + 'Width']) || 0);
    floats.push({ sig: sig(e), maxBorder: Math.max.apply(null, bw), outline: parseFloat(cs.outlineWidth) || 0 });
  }));

  return { pairs, groups, floats };
}"""


async def probe(b, app, theme, forced):
    ctx = await b.new_context(viewport={'width': 1440, 'height': 1000},
                              forced_colors=('active' if forced else 'none'))
    pg = await ctx.new_page()
    keys = json.dumps(['%s.%s' % (app, k) for k in TOUR_KEYS])
    await pg.add_init_script("try { %s.forEach(k => localStorage.setItem(k,'1')); } catch (e) {}" % keys)
    await pg.goto('file:///' + (ROOT + '\\' + app + r"\preview.html").replace('\\', '/'))
    await pg.wait_for_timeout(2600)
    await pg.evaluate("() => { if (window.GTour && GTour.end) GTour.end(); window.__tourActive = false; }")
    await pg.evaluate("t => document.documentElement.setAttribute('data-theme', t)", theme)
    await pg.wait_for_timeout(800)   # transition 착지 대기
    # 起動画面だけでなく、オーバーレイ・各タブでも測る。
    #   ⚠状態ごとに結果を **合流** させる（同じ sig が別状態で出るので、状態名も持つ）。
    got = {'pairs': [], 'groups': [], 'floats': []}
    async for state in drive_states(pg):
        d = await pg.evaluate(PROBE)
        for k in got:
            for it in d[k]:
                it['state'] = state
                got[k].append(it)
    await pg.close(); await ctx.close()
    return got


async def main():
    only = sys.argv[1] if len(sys.argv) > 1 else None
    rows, seen = [], {'A': 0, 'B': 0, 'C': 0}
    async with async_playwright() as pw:
        b = await pw.chromium.launch()
        for app in APPS:
            if only and app != only:
                continue
            for theme in ('light', 'dark'):
                nor = await probe(b, app, theme, forced=False)
                fce = await probe(b, app, theme, forced=True)

                nmap = defaultdict(list)
                for p in nor['pairs']:
                    nmap[p['sig']].append(p['sel'] != p['other'])
                for p in fce['pairs']:
                    was = nmap.get(p['sig'])
                    if not was or not any(was):
                        continue                      # 통상에서도 구별 못 하면 별건(대비 라운드 소관)
                    seen['A'] += 1
                    if p['sel'] == p['other']:
                        rows.append((app, theme, 'A 선택이 비선택과 동일', p['sig'], p['sel'][:70]))

                nc = {}
                for g in nor['groups']:
                    nc[g['sig']] = max(nc.get(g['sig'], 0), g['colors'])
                for g in fce['groups']:
                    if nc.get(g['sig'], 0) >= 3:
                        seen['B'] += 1
                        if g['colors'] <= 1:
                            rows.append((app, theme, 'B 데이터색이 1색으로', g['sig'],
                                         '통상 %d색 → 강제 %d색 (%d셀)' % (nc[g['sig']], g['colors'], g['n'])))

                for f in fce['floats']:
                    seen['C'] += 1
                    if f['maxBorder'] < 1 and f['outline'] < 1:
                        rows.append((app, theme, 'C 부유면 경계 없음', f['sig'], 'border/outline 0'))
        await b.close()

    agg = defaultdict(set)
    for app, theme, kind, s, note in rows:
        agg[(app, kind, s, note)].add(theme)
    # ⚠비교 건수를 반드시 같이 낸다. 0건과 0회를 구별할 수 없으면 도구가 아니라 함정이다.
    print('비교 실행: A %d 쌍 / B %d 그룹 / C %d 면' % (seen['A'], seen['B'], seen['C']))
    print('forced-colors 실측 미비: %d 건 / %d 종\n' % (len(rows), len(agg)))
    cur = None
    for (app, kind, s, note), themes in sorted(agg.items()):
        if app != cur:
            print('### %s' % app); cur = app
        t = '/'.join(sorted('l' if x == 'light' else 'd' for x in themes))
        print('   %-22s %-46s %-4s %s' % (kind, s, t, note))

asyncio.run(main())
