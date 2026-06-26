// mermaid.js — ```mermaid コードブロックを SVG 図へ変換する (ADR-0012)
// 重要: 必ず DOMPurify を通した後（renderPreview が el.preview に挿入した後）に呼ぶ。
//   流れ: marked → DOMPurify → mermaid.render(securityLevel:'strict') → DOMPurify(svg) → DOM
//   ＝ 入力テキストと出力 SVG の二重サニタイズ。描画前 sanitize の不変条件を壊さない。
(function (Bricola) {
  'use strict';

  let seq = 0;

  function currentTheme() {
    const dark = Bricola.theme && Bricola.theme.current && Bricola.theme.current() === 'dark';
    return dark ? 'dark' : 'default';
  }

  // テーマを毎回反映するため initialize を呼ぶ（冪等）。
  function init() {
    if (!window.mermaid) return false;
    window.mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: currentTheme()
    });
    return true;
  }

  Bricola.mermaid = {
    available: function () { return !!window.mermaid; },

    // root 内の language-mermaid を SVG 図へ置換する。
    enhance: function (root) {
      if (!init()) return;
      const blocks = root.querySelectorAll('code.language-mermaid');
      blocks.forEach(function (code) {
        const host = code.closest('pre') || code;
        const src = code.textContent;
        const id = 'bricola-mmd-' + (seq++);
        try {
          // 先に parse で構文検証する。render は不正入力でも throw せず空図を作るため。
          window.mermaid.parse(src);
          // v9 の render はコールバック同期。svg を svg プロファイルで再サニタイズして挿入。
          window.mermaid.render(id, src, function (svg) {
            const fig = document.createElement('div');
            fig.className = 'mermaid-figure';
            fig.innerHTML = window.DOMPurify.sanitize(svg, {
              USE_PROFILES: { svg: true, svgFilters: true, html: true }
            });
            host.replaceWith(fig);
          });
        } catch (e) {
          // 構文エラー等は図にせずソースを残して原因を見せる。
          const err = document.createElement('pre');
          err.className = 'mermaid-error';
          err.textContent = 'Mermaid 描画エラー: ' + (e && e.message ? e.message : String(e)) + '\n\n' + src;
          host.replaceWith(err);
          // render が body に残しうる一時要素を掃除する。
          const tmp = document.getElementById('d' + id) || document.getElementById(id);
          if (tmp && tmp.parentNode) tmp.parentNode.removeChild(tmp);
        }
      });
    }
  };
})(window.Bricola = window.Bricola || {});
