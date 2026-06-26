// outline.js — 見出し構造の抽出（右サイドバー用）
// レンダリング済みコンテナから h1-h6 を拾い、アンカー id を付与する。
(function (Bricola) {
  'use strict';

  Bricola.outline = {
    // container 内の見出しに id を振り、[{level, text, id}] を返す。
    build: function (container) {
      const headings = container.querySelectorAll('h1, h2, h3, h4, h5, h6');
      const items = [];
      headings.forEach(function (h, i) {
        if (!h.id) h.id = 'mdv-h-' + i;
        items.push({ level: parseInt(h.tagName.charAt(1), 10), text: h.textContent, id: h.id });
      });
      return items;
    }
  };
})(window.Bricola = window.Bricola || {});
