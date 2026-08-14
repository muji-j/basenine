"""실 DOM 대비 스윕 — 「렌더된 픽셀」을 직접 샘플링해 텍스트 대비를 잰다.

사용법:  py -3 .claude/skills/auditing-multi-dimensionally/tools/contrast_sweep.py [앱이름]
         (앱이름 생략 시 9앱 전부. 각 앱의 preview.html 을 미리 생성해 둘 것)

왜 이 방식인가 — **정적 CSS 스크린으로는 절반을 놓친다**(실측으로 확인):
  ・별칭 토큰 경유(`--heat-danger` = `--danger-soft`)는 이름이 달라 검색에 안 걸린다
  ・면은 부모 규칙·잉크는 자식 규칙에 있는 조합이 통째로 빠진다
  ・`--rc` 같은 런타임 주입 색은 CSS 파일만 봐서는 값을 알 수 없다

⚠이 도구는 만드는 과정에서 **네 번 틀렸다**. 같은 함정을 다시 밟지 않도록 전부 기록한다:
  1. 조상 체인의 backgroundColor 합성 → `linear-gradient` 지(배경이 background-image)와
     「겹쳐진 형제」(position 의 .l1-ind 가 .l1-txt 뒤에 깔림)를 못 봐서 CR 1.00 위양성 다발.
     → 픽셀 샘플링으로 전환.
  2. full_page 스크린샷 → 이 리포는 배경을 `body::before{position:fixed}` 로 깔기 때문에
     첫 뷰포트 밖의 지가 비어 버린다. → 뷰포트 단위로 스크롤하며 캡처.
  3. 요소 박스를 샘플 → 셀 안의 흰 점(.rp-dot)·연한 배지를 지로 오인(실측 6.28 이 1.10 으로).
     → 직접 텍스트 노드의 **행 박스**(Range.getClientRects)만 샘플.
  5. **그림자 밴드를 샘플** → sticky 헤더의 box-shadow 가 드리운 띠에 텍스트가 겹치면 지가 실제보다
     어둡게 찍힌다. 히트테스트는 **그림자를 보지 않으므로** 4번 가드를 통과해 버린다
     (실측: ess `.di-sub` 가 자연 상태 5.57 인데 스윕만 3.80. 스크롤 위치에 따라 나왔다 안 나왔다 한다.
      이 위양성을 근거로 토큰을 과하게 어둡게 했다가 되돌린 적이 있다).
     → sticky/fixed 요소의 矩形을 box-shadow 확산만큼 부풀려, 그 안의 점은 버린다.
  6. **배경 도트 위 샘플은 흔들린다** → `body::before` 의 도트 패턴 위에 문자가 얹히면 몇 %p 낮게 나오고,
     행 박스가 1px 흔들리는 것만으로 통과/실패가 뒤집힌다(실측: wiki `.app-foot code` 4.46 ↔ 통과).
     이건 위양성이 **아니다** — 그 픽셀에서는 실제로 낮다. 도트 위에서도 통과하도록 잉크를 잡는 게 맞다.
  4. 가려진 지점을 샘플 → sticky 헤더가 덮은 셀에서 헤더 색을 읽었다(duty 12종 중 6종이 위양성).
     → `elementFromPoint` 히트테스트로 자기(or 자손)가 최전면인 점만 채택.

그 외 필수 전처리:
  ・온보딩 투어를 억제(dim 레이어가 화면 전체를 덮어 전부 어둡게 나온다)
  ・테마 전환·스크롤 후 충분히 대기(transition 미착지 값을 읽으면 경계값이 흔들린다)
  ・`color(srgb …)` 직렬화 전용 파서(이걸 못 읽으면 1.00 위양성이 난다)

판정: WCAG 2.2 AA. large text(≥24px, 또는 ≥18.66px+bold)는 3:1, 그 외 4.5:1.

⚠**測る前に必ず preview.html を作り直すこと。**
  preview.html は .gitignore 対象の生成物なので、別のチェックアウト（マージ直後の main 等）では
  **古いまま or 存在しない**。実測: main で走らせたら duty に 2件出たが、make_preview.py を回したら 0件だった
  ——「直したのに直っていない」と誤読する典型。各アプリで py -3 make_preview.py を先に回す。
"""
import asyncio, io, json, os, sys
from collections import defaultdict

# ⚠**この道具の出力は日本語・韓国語を含む。Windows の既定コンソールは cp932 なので、
#   これが無いと最初の print で UnicodeEncodeError を投げ、**計測は全部終えたのに結果を1件も出さずに死ぬ**。
#   しかもシェルのループで回すと exit code 0 に見える＝「0件（＝合格）」と読み違える。
#   この道具は「0件」と「0回測った」を取り違えないために作ったのに、自分自身が同じ罠に落ちていた（2026-07-31 実測）。
for _s in (sys.stdout, sys.stderr):
    try: _s.reconfigure(encoding='utf-8', errors='replace')
    except Exception: pass

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from state_driver import drive_states   # 起動画面の外（オーバーレイ・各タブ）まで測る
from playwright.async_api import async_playwright
from PIL import Image

# ⚠ROOT を固定パスで書かない: ワークツリーを消した/マージした瞬間に動かなくなる。
#   このファイルは <repo>/.claude/skills/auditing-multi-dimensionally/tools/ にあるので 4つ上がリポ根。
#   別のチェックアウトを測りたいときは環境変数 PPS_ROOT で上書きする。
ROOT = os.environ.get("PPS_ROOT") or os.path.abspath(
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", ".."))
APPS = ['portal', 'master', 'duty', 'ess', 'energy', 'notice', 'wiki', 'position', 'chat-notify']
TOUR_KEYS = ['tourDone', 'tour.dash', 'tour.shift', 'tour.wiki']

COLLECT = r"""
() => {
  const ownText = el => {
    for (const n of el.childNodes) {
      if (n.nodeType === 3 && n.nodeValue && n.nodeValue.trim()) return n.nodeValue.trim();
    }
    return '';
  };
  const cls = el => (typeof el.className === 'string' ? el.className : '').trim().split(/\s+/).filter(Boolean);
  const sig = el => {
    let s = el.tagName.toLowerCase();
    if (el.id) s += '#' + el.id;
    const c = cls(el);
    if (c.length) s += '.' + c.slice(0, 3).join('.');
    // ⚠クラスも id も無い要素(<b> <small> <strong> …)は署名がタグ名だけになり、
    //   「どの画面の話か特定できない」＝直せない報告になる(実測: `b` 4.08 が出たが場所不明)。
    //   直近のクラス付き祖先を前置して、必ず現場が分かる署名にする。
    if (!el.id && !c.length) {
      let p = el.parentElement, hop = 0;
      while (p && hop < 4) {
        const pc = cls(p);
        if (pc.length) { s = p.tagName.toLowerCase() + '.' + pc.slice(0, 2).join('.') + ' > ' + s; break; }
        p = p.parentElement; hop++;
      }
    }
    return s;
  };
  const out = [];
  let i = 0;
  for (const el of document.querySelectorAll('body *')) {
    const t = ownText(el);
    if (!t) continue;
    if (el.closest('[aria-hidden="true"]')) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') continue;
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) continue;
    let opa = 1, n = el;
    while (n && n.nodeType === 1) { const o = parseFloat(getComputedStyle(n).opacity); if (!isNaN(o)) opa *= o; n = n.parentElement; }
    if (opa < 0.25) continue;
    el.setAttribute('data-cs-i', String(i));
    out.push({
      i: i, sig: sig(el), text: t.slice(0, 18), fg: cs.color,
      size: parseFloat(cs.fontSize) || 16, weight: parseInt(cs.fontWeight, 10) || 400,
      x: r.left + window.scrollX, y: r.top + window.scrollY, w: r.width, h: r.height
    });
    i++;
  }
  return out;
}
"""

HIDE = r"""
() => {
  const s = document.createElement('style');
  s.id = '__cs_hide';
  // ⚠状態駆動を入れてから「レイアウト/不透明度がまだ動いている最中」に撮る事故が出た
  //   （実測: ess .vt-btn.is-active が 1.03 と報告されたが、計算値は 7.4 で正常。タブのフェード中に
  //     撮ったせいで矩形とピクセルが食い違っていた）。測定中はアニメーションを完全に止める。
  // ⚠`animation: none` は使えない: `animation-fill-mode: both` で保持されていた最終状態まで解除され、
  //   静的な `opacity: 0` へ戻ってしまう（duty `.an-enter`）。その結果、下の可視性ガードが
  //   サブツリーごとスキップし **分析ビュー全体が測定不能**になった（レビュー実測で発覚）。
  //   → 止めるのではなく「即座に着地」させる。fill-mode は保たれる。
  s.textContent = '*, *::before, *::after { transition: none !important;'
                + ' animation-duration: .001s !important; animation-delay: 0s !important; }'
                + '*, *::before, *::after { color: transparent !important;' +
                  ' text-shadow: none !important; -webkit-text-fill-color: transparent !important; }' +
                  ' img, svg, canvas { visibility: hidden !important; }';
  document.head.appendChild(s);
}
"""

UNHIDE = r"""
() => { const e = document.getElementById('__cs_hide'); if (e) e.remove(); return true; }
"""


def parse(s):
    s = (s or '').strip()
    if s.startswith('color('):
        p = s[6:].rstrip(')').replace('/', ' ').split()
        v = [float(x) for x in p[1:]]
        return tuple(x * 255.0 for x in v[:3]), (v[3] if len(v) > 3 else 1.0)
    if s == 'transparent':
        return (0, 0, 0), 0.0
    try:
        n = [float(x) for x in s.replace('rgba(', '').replace('rgb(', '').replace(')', '').split(',')]
    except ValueError:
        return None, None
    return (n[0], n[1], n[2]), (n[3] if len(n) > 3 else 1.0)


def lum(c):
    def f(v):
        v = v / 255.0
        return v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2])


def cr(a, b):
    la, lb = lum(a), lum(b)
    hi, lo = max(la, lb), min(la, lb)
    return round((hi + 0.05) / (lo + 0.05), 2)


def threshold(size, weight):
    if size >= 24 or (size >= 18.66 and weight >= 700):
        return 3.0
    return 4.5


def sample(img, x, y, w, h, dpr, fracs=None):
    """요소 영역에서 몇 점을 뽑아 가장 '밝은'/'어두운' 극단이 아니라 최빈에 가까운 지색을 고른다.
       그라데이션 위라면 글자와 가장 대비가 나쁜 점을 쓰는 게 안전하므로 후보를 모두 반환."""
    pts = []
    for fx, fy in (fracs or ((0.5, 0.5), (0.35, 0.5), (0.65, 0.5), (0.5, 0.35), (0.5, 0.65))):
        px = int((x + w * fx) * dpr)
        py = int((y + h * fy) * dpr)
        if 0 <= px < img.width and 0 <= py < img.height:
            pts.append(img.getpixel((px, py))[:3])
    return pts


async def main():
    only = sys.argv[1] if len(sys.argv) > 1 else None
    grand = []
    # ⚠「0件」と「0回測った」を取り違えないための分母。この道具は長らく**失敗しか出さず**、
    #   何個測ったかを一度も出していなかった（forced_colors_sweep で同じ取り違えを実際にやった後も）。
    #   状態数・収集したテキストノード数・実際に画素を採れた数を必ず併記する。
    census = defaultdict(lambda: {'states': 0, 'collected': 0, 'measured': 0})
    async with async_playwright() as pw:
        b = await pw.chromium.launch()
        for app in APPS:
            if only and app != only:
                continue
            for theme in ('light', 'dark'):
                ctx = await b.new_context(viewport={'width': 1440, 'height': 1000}, device_scale_factor=1)
                pg = await ctx.new_page()
                keys = json.dumps(['%s.%s' % (app, k) for k in TOUR_KEYS])
                await pg.add_init_script(
                    "try { %s.forEach(k => localStorage.setItem(k,'1')); } catch (e) {}" % keys)
                await pg.goto('file:///' + (ROOT + '\\' + app + r"\preview.html").replace('\\', '/'))
                await pg.wait_for_timeout(2600)
                await pg.evaluate("() => { if (window.GTour && GTour.end) GTour.end(); window.__tourActive = false; }")
                await pg.evaluate("t => document.documentElement.setAttribute('data-theme', t)", theme)
                await pg.wait_for_timeout(800)
                # 起動画面だけを測ると「0件」と「0回」を取り違える（forced_colors_sweep で実証）。
                # オーバーレイ・各タブへ駆動しながら、状態ごとに収集→隠す→サンプル→戻すを繰り返す。
                async for _state in drive_states(pg):
                    rows = await pg.evaluate(COLLECT)
                    meta = {r['i']: r for r in rows}
                    census[app]['states'] += 1
                    census[app]['collected'] += len(rows)
                    await pg.evaluate(HIDE)
                    await pg.wait_for_timeout(250)
                    # ⚠full_page 캡처는 쓰지 않는다: 이 리포는 배경을 body::before{position:fixed} 로 깔기 때문에
                    #   전체 페이지 캡처에서는 첫 뷰포트 밖의 지가 비어 버리고, 지색이 통째로 틀린다(실측 위양성 다발).
                    #   뷰포트 단위로 스크롤하며 그때그때의 화면을 찍는다.
                    vh = await pg.evaluate("() => window.innerHeight")
                    total = await pg.evaluate("() => document.documentElement.scrollHeight")
                    worst_of = {}
                    y = 0
                    while y < total:
                        await pg.evaluate("y => window.scrollTo(0, y)", y)
                        await pg.wait_for_timeout(220)
                        shot = await pg.screenshot()
                        img = Image.open(io.BytesIO(shot)).convert('RGB')
                        vis = await pg.evaluate("""() => {
                          // ⚠要素ボックスではなく「直接テキストノードの行ボックス」を測る。
                          //   ボックスだと中の装飾(白いドット・淡いバッジ)を拾って地色を誤る（実測で 6.28 が 1.10 になった）。
                          // ⚠ヒットテストは**影を見ない**。sticky/fixed 要素の box-shadow が落とす帯に
                          //   重なった点を採ると、地が実際より暗く出て偽陽性になる（実測: ess .di-sub が
                          //   自然状態 5.57 なのにスイープだけ 3.80。スクロール位置で出たり出なかったりする）。
                          //   → sticky/fixed 要素の矩形を影の広がりぶん膨らませ、その中の点は捨てる。
                          const shade = [];
                          document.querySelectorAll('*').forEach(el => {
                            const cs = getComputedStyle(el);
                            if (cs.position !== 'sticky' && cs.position !== 'fixed') return;
                            const r = el.getBoundingClientRect();
                            if (!r.width || !r.height) return;
                            // ⚠影の広がりは**レイヤ単位**で判定する。初版は box-shadow 文字列から px を全部拾って
                            //   最大値を取っていたので、次の3つで壊れた（実測 2026-07-31・master が**アプリ丸ごと未計測**）:
                            //   ① `inset` は要素の**外に滲まない**のに外へ広げていた
                            //   ② **透明**(alpha 0)の影は地を暗くしないのに除外対象にしていた
                            //   ③ 上限が無く、セル罫線代わりの `0 0 0 9999px inset` が**ビューポート全面**を影帯にした
                            //      → 全サンプル点が捨てられ、census は「収集 9550 / 実測 0」。
                            //        「0件」ではなく「0回測った」——この道具が防ぐはずだった取り違えそのもの。
                            // ④**見えない sticky/fixed を帯にしない。** 初版は可視性を一切見ずに矩形を積んだので、
                            //   閉じている全画面ドロワー(`div.drawer-overlay`)がビューポート全面を「影」にしていた。
                            if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.05) return;
                            const layers = (cs.boxShadow || 'none').split(/,(?![^(]*[)])/);
                            let grow = 0;
                            for (const ly of layers) {
                              if (!ly || ly.indexOf('none') >= 0) continue;
                              if (ly.indexOf('inset') >= 0) continue;              // ①外へ滲まない
                              const a = ly.match(/rgba?[(]([^)]*)[)]/);
                              if (a) {
                                const parts = a[1].split(/[^0-9.]+/).filter(Boolean);
                                if (parts.length >= 4 && parseFloat(parts[3]) <= 0.02) continue;  // ②透明
                              }
                              const m = ly.replace(/rgba?[(][^)]*[)]/g, '').match(/(-?[0-9.]+)px/g);
                              if (m) for (const v of m) grow = Math.max(grow, Math.abs(parseFloat(v)));
                            }
                            grow = Math.min(grow, 64);                              // ③常識的な上限
                            if (grow <= 0) return;                                  // 影を落とさない要素は帯を作らない
                            shade.push({ l: r.left - grow, t: r.top - grow, r: r.right + grow, b: r.bottom + grow, el: el });
                          });
                          // ⚠**sticky 要素の中身も帯として捨てる（＝自己除外はしない）。** これは仕様である。
                          //   一度「ヘッダ内の文字が一度も測れていない」と考えて自己除外 `!s.el.contains(e)` を入れたが、
                          //   **過矯正だった**（実測 2026-07-31: 未達 3種 → 30種 に暴発し、その大半が
                          //   `.app-tab.is-active` 1.01 や `div.brand-txt > h2` 1.13 のような偽陽性）。
                          //   決定的な反証: 同じ `.app-tab.is-active` を duty で直接測ると **6.94**（ダーク）である。
                          //   ヘッダ・タブバー内部は重なり・グラデ・アニメが密で画素サンプルが信頼できない。
                          //   → その領域は**測らない**のが正しい。測りたければ計算値（トークン）で別途評価すること。
                          const shaded = (x, y) => shade.some(s => x >= s.l && x <= s.r && y >= s.t && y <= s.b);
                          const out = [];
                          document.querySelectorAll('[data-cs-i]').forEach(e => {
                            // ⚠タブを巡回すると、非アクティブなペインが opacity:0 のまま DOM に残る。
                            //   透明な要素でも **ヒットテストは通る**ので、後ろの暗い地を測って 1.00 の偽陽性になる
                            //   （実測: duty .an-seg-part）。祖先の不透明度・可視性を先に確かめる。
                            let __q = e, __hidden = false;
                            while (__q && __q.nodeType === 1) {
                              const __cs = getComputedStyle(__q);
                              if (__cs.display === "none" || __cs.visibility === "hidden" || Number(__cs.opacity) < 0.15)
                                { __hidden = true; break; }
                              __q = __q.parentElement;
                            }
                            if (__hidden) return;
                            for (const n of e.childNodes) {
                              if (n.nodeType !== 3 || !n.nodeValue || !n.nodeValue.trim()) continue;
                              const rg = document.createRange(); rg.selectNodeContents(n);
                              // ⚠行ボックスは要素の clip を無視して外へ伸びる。overflow:hidden の狭い要素
                              //   （duty .an-seg-part は min-width:2px）だと、見えていない位置を測って別の地を拾う
                              //   （実測 1.00 の偽陽性）。要素の箱と交差させてから測る。
                              const __eb = e.getBoundingClientRect();
                              for (const r0 of rg.getClientRects()) {
                                const r = { left: Math.max(r0.left, __eb.left), right: Math.min(r0.right, __eb.right),
                                            top: Math.max(r0.top, __eb.top), bottom: Math.min(r0.bottom, __eb.bottom) };
                                r.width = r.right - r.left; r.height = r.bottom - r.top;
                                if (!(r.top >= 0 && r.bottom <= window.innerHeight && r.width >= 4 && r.height >= 6)) continue;
                                // ⚠sticky ヘッダ等に覆われた位置を測ると「上に重なった要素の地」を拾ってしまう。
                                //   ヒットテストで自分（or 子孫）が最前面にある点だけを採用する。
                                const pts = [[0.5,0.5],[0.35,0.5],[0.65,0.5],[0.5,0.35],[0.5,0.65]].filter(f => {
                                  const px = r.left + r.width*f[0], py = r.top + r.height*f[1];
                                  if (shaded(px, py)) return false;   // sticky/fixed の影の帯は測らない
                                  const t = document.elementFromPoint(px, py);
                                  return t && (t === e || e.contains(t));
                                });
                                if (!pts.length) continue;
                                out.push({ i: +e.getAttribute('data-cs-i'), x: r.left, y: r.top, w: r.width, h: r.height, pts: pts });
                              }
                              rg.detach && rg.detach();
                            }
                          });
                          return out;
                        }""")
                        for v in vis:
                            r = meta.get(v['i'])
                            if not r:
                                continue
                            fg, fa = parse(r['fg'])
                            if fg is None or fa <= 0.05:
                                continue
                            pts = sample(img, v['x'], v['y'], v['w'], v['h'], 1,
                                         [tuple(f) for f in v.get('pts') or []])
                            for bg in pts:
                                f2 = tuple(c * fa + o * (1 - fa) for c, o in zip(fg, bg)) if fa < 1 else fg
                                val = cr(bg, f2)
                                if v['i'] not in worst_of or val < worst_of[v['i']]:
                                    worst_of[v['i']] = val
                        y += int(vh * 0.9)
                    census[app]['measured'] += len(worst_of)
                    for i, val in worst_of.items():
                        r = meta[i]
                        need = threshold(r['size'], r['weight'])
                        if val < need:
                            grand.append((app, theme, val, need, r['sig'], r['text']))
                    await pg.evaluate(UNHIDE)
                    await pg.wait_for_timeout(150)
                await pg.close()
                await ctx.close()
        await b.close()

    agg = defaultdict(lambda: {'worst': 99, 'themes': set(), 'text': '', 'need': 4.5})
    for app, theme, v, need, sig, text in grand:
        a = agg[(app, sig)]
        a['worst'] = min(a['worst'], v)
        a['themes'].add(theme)
        a['need'] = need
        if not a['text']:
            a['text'] = text
    # 分母を先に出す。ここが 0 なら「合格」ではなく「測っていない」。
    print('조사량(라이트+다크 합계):')
    for app in APPS:
        if app not in census:
            continue
        c = census[app]
        flag = '  ⚠측정 0 — 합격이 아니라 「잰 게 없음」' if c['measured'] == 0 else ''
        print('  %-12s 상태 %3d회 / 텍스트노드 수집 %5d / 픽셀 실측 %5d%s'
              % (app, c['states'], c['collected'], c['measured'], flag))
    print('픽셀 실측 미달: %d 인스턴스 / %d 종\n' % (len(grand), len(agg)))
    cur = None
    for (app, sig), a in sorted(agg.items(), key=lambda x: (x[0][0], x[1]['worst'])):
        if app != cur:
            print('### %s' % app)
            cur = app
        print('  %5.2f (기준 %.1f) %-4s %-40s %s' % (
            a['worst'], a['need'], '/'.join(sorted(t[0] for t in a['themes'])), sig[:40], a['text'][:16]))

asyncio.run(main())
