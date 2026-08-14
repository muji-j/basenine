# -*- coding: utf-8 -*-
"""UI を「基本画面の外」まで駆動して測るための共通ドライバ。

なぜ要るか
  contrast_sweep / forced_colors_sweep は **起動直後の画面しか見ていない**。実測でそれが露呈した:
  forced_colors_sweep の検査B(データ色)は 9アプリ全部で **0回** 実行されていた（ヒートマップ・積みバーは
  タブを切り替えるまで DOM に生成されない）。検査C(浮遊面)も全部 rect 0 で弾かれていた。
  「0件」と「0回」を取り違えると、測っていない場所を「問題なし」と報告してしまう。

⚠安全が最優先 — 測定のために壊してはいけない
  クリックは保存・削除・送信を起こしうる。この駆動は**読み取り専用**でなければならない:
    1. サーバ往復を無害化（プレビューは google.script.run をモックしているが、念のため
       APP.callServer / google.script.run を no-op に差し替える）
    2. クリック対象を **ナビゲーション（タブ・セグメント）だけ** に限定する
    3. 破壊的な語(削除/全置換/破棄/リセット/クリア/送信/保存/実行) を含むもの・
       .is-danger / [data-danger] は**絶対に押さない**
    4. 浮遊面(トースト・進行・確認)は**クリックせずプログラムで開く** —
       ボタンを押しに行くより速く、確実で、副作用が無い

使い方:
    from state_driver import drive_states
    async for name in drive_states(pg):
        ...  # その状態で測る
"""

GUARD = r"""() => {
  // ① サーバ往復を無害化（保存・削除が飛ばないように）
  try {
    if (window.APP) APP.callServer = function () { return Promise.resolve({ ok: true }); };
    if (window.google && google.script && google.script.run) {
      const noop = new Proxy({}, { get: () => () => noop });
      google.script.run = noop;
    }
  } catch (e) {}
  // ② 確認ダイアログは常に「いいえ」（万一クリックが破壊操作に到達しても止まる）
  try { if (window.APP) APP.confirmDialog = function () { return Promise.resolve(false); }; } catch (e) {}
  try { window.confirm = () => false; } catch (e) {}
  return true;
}"""

# ナビゲーションらしきものだけ。破壊的な語を含むものは除外する。
COLLECT_TABS = r"""() => {
  const NAV = ['[role="tab"]', '.app-tab', '[data-tab]', '.seg-btn', '.pm-btn', '.nb-tab',
               '.sub-tab', '.vt-btn', '.dst-btn', '.rt-btn'];
  const BAD = /(削除|全置換|破棄|リセット|クリア|送信|保存|実行|取込|アップロード|複製|生成|再構築|変更|登録)/;
  const seen = new Set(), out = [];
  NAV.forEach(sel => document.querySelectorAll(sel).forEach(e => {
    if (seen.has(e)) return;
    const t = (e.textContent || '') + ' ' + (e.getAttribute('aria-label') || '') + ' ' + (e.title || '');
    if (BAD.test(t)) return;                                   // 破壊的な語は触らない
    if (e.matches('.is-danger, [data-danger], [disabled]')) return;
    const cs = getComputedStyle(e), r = e.getBoundingClientRect();
    if (cs.display === 'none' || cs.visibility === 'hidden') return;
    if (r.width < 8 || r.height < 8) return;
    seen.add(e);
    e.setAttribute('data-sd-nav', String(out.length));
    out.push({ i: out.length, label: (t.trim().slice(0, 14) || e.className.toString().slice(0, 14)) });
  }));
  return out;
}"""

CLICK_NAV = r"""(i) => {
  const e = document.querySelector('[data-sd-nav="' + i + '"]');
  if (!e) return false;
  e.click();
  return true;
}"""

# 浮遊面はクリックせずプログラムで開く（副作用ゼロ・確実）
OPEN_OVERLAYS = r"""() => {
  const opened = [];
  try {
    if (window.SharedUI && SharedUI.toast) { SharedUI.toast('測定用', 'info'); opened.push('toast'); }
  } catch (e) {}
  try {
    if (window.SharedUI && SharedUI.progress) {
      window.__sdProg = SharedUI.progress({ title: '測定用', determinate: true, label: '…' });
      opened.push('progress');
    }
  } catch (e) {}
  try {
    const ov = document.querySelector('#confirmOverlay'), pop = document.querySelector('#confirmPop');
    if (ov && pop) {
      const t = document.querySelector('#confirmTitle'), m = document.querySelector('#confirmMsg');
      if (t) t.textContent = '測定用';
      if (m) m.textContent = '測定用のダイアログです';
      ov.hidden = false; pop.hidden = false;
      opened.push('confirm');
    }
  } catch (e) {}
  return opened;
}"""

CLOSE_OVERLAYS = r"""() => {
  try { if (window.__sdProg) { window.__sdProg.close(); window.__sdProg = null; } } catch (e) {}
  try {
    const ov = document.querySelector('#confirmOverlay'), pop = document.querySelector('#confirmPop');
    if (ov) ov.hidden = true;
    if (pop) pop.hidden = true;
  } catch (e) {}
  try { document.querySelectorAll('.su-toast').forEach(t => t.remove()); } catch (e) {}
  return true;
}"""


async def install_guard(pg):
    """クリック駆動の前に必ず呼ぶ（サーバ往復と確認ダイアログを無害化）。"""
    await pg.evaluate(GUARD)


async def drive_states(pg, settle_ms=700, max_tabs=12):
    """状態を切り替えながら状態名を yield する。呼び出し側は yield のたびに測る。

    ・最初に 'boot'（起動直後の画面）
    ・次に 'overlay'（トースト・進行・確認を同時に開いた状態）
    ・その後 各タブ（'tab:ラベル'）
    """
    await install_guard(pg)
    yield 'boot'

    opened = await pg.evaluate(OPEN_OVERLAYS)
    if opened:
        await pg.wait_for_timeout(settle_ms)
        yield 'overlay:' + '+'.join(opened)
    await pg.evaluate(CLOSE_OVERLAYS)
    await pg.wait_for_timeout(200)

    navs = await pg.evaluate(COLLECT_TABS)
    for n in navs[:max_tabs]:
        ok = await pg.evaluate(CLICK_NAV, n['i'])
        if not ok:
            continue
        await pg.wait_for_timeout(settle_ms)          # transition 착지 대기（測定トラップ②）
        yield 'tab:' + n['label']
